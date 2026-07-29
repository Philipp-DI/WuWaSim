"""
UE4 tagged-property reader + UDataTable row extractor.

Why this works without a .usmap:
  Classic UE tagged serialization is SELF-DESCRIBING. Every property is written
  as a tag -- Name, Type, Size, ArrayIndex, [type-specific data], [guid] --
  followed by exactly `Size` bytes of value. So we can decode the properties we
  understand and step cleanly over the ones we don't, because the tag tells us
  how many bytes to skip. A .usmap is only needed for *unversioned* property
  serialization, where the names/sizes are omitted.

Robustness rule enforced throughout:
  After each property, we reposition to (value_start + declared_size). Nested
  parsing (structs, arrays) is best-effort inside try/except -- a failure deep
  in a nested value can never desynchronise the outer walk.
"""
import struct
from ue_header import Package, i32, u32, i64, f32, read_fstring

# The set of property types UE can write as a tagged FPropertyTag is CLOSED,
# which makes it usable as an oracle: a walk whose every decoded type is a
# member is reading the name map correctly; one that decodes a type as an
# arbitrary field name is not. Used to validate a repaired name map -- see the
# NAME-MAP SKEW note on parse_datatable().
UE_PROPERTY_TYPES = frozenset({
    'BoolProperty', 'ByteProperty', 'EnumProperty', 'FloatProperty', 'DoubleProperty',
    'IntProperty', 'Int8Property', 'Int16Property', 'Int64Property',
    'UInt16Property', 'UInt32Property', 'UInt64Property',
    'NameProperty', 'StrProperty', 'TextProperty',
    'ObjectProperty', 'SoftObjectProperty', 'LazyObjectProperty', 'WeakObjectProperty',
    'ClassProperty', 'SoftClassProperty', 'InterfaceProperty',
    'DelegateProperty', 'MulticastDelegateProperty', 'FieldPathProperty',
    'StructProperty', 'ArrayProperty', 'SetProperty', 'MapProperty',
})

SIMPLE_READERS = {
    'FloatProperty':  (4, lambda b, p: round(struct.unpack_from('<f', b, p)[0], 6)),
    'DoubleProperty': (8, lambda b, p: struct.unpack_from('<d', b, p)[0]),
    'IntProperty':    (4, lambda b, p: struct.unpack_from('<i', b, p)[0]),
    'Int8Property':   (1, lambda b, p: struct.unpack_from('<b', b, p)[0]),
    'Int16Property':  (2, lambda b, p: struct.unpack_from('<h', b, p)[0]),
    'Int64Property':  (8, lambda b, p: struct.unpack_from('<q', b, p)[0]),
    'UInt16Property': (2, lambda b, p: struct.unpack_from('<H', b, p)[0]),
    'UInt32Property': (4, lambda b, p: struct.unpack_from('<I', b, p)[0]),
    'UInt64Property': (8, lambda b, p: struct.unpack_from('<Q', b, p)[0]),
}

# Structs UE serialises natively (not as tagged properties).
NATIVE_STRUCTS = {
    'Vector': 3, 'Rotator': 3, 'Vector2D': 2, 'Vector4': 4,
    'Quat': 4, 'LinearColor': 4,
}


class TaggedReader:
    def __init__(self, pkg: Package, buf: bytes):
        self.pkg = pkg
        self.b = buf
        self.max_depth = 8
        self.types_seen = set()   # every property type decoded, for the oracle

    def fname(self, p):
        return self.pkg.fname(self.b, p)

    # ---- value decoders -------------------------------------------------
    def read_value(self, p, ptype, size, struct_name, inner_type, depth):
        b = self.b
        if ptype in SIMPLE_READERS:
            width, fn = SIMPLE_READERS[ptype]
            return fn(b, p) if size >= width else None
        if ptype == 'NameProperty':
            return self.fname(p)[0]
        if ptype == 'StrProperty':
            return read_fstring(b, p)[0]
        if ptype == 'ObjectProperty':
            idx = i32(b, p)
            return {'__objref': idx}
        if ptype == 'SoftObjectProperty':
            asset, q = self.fname(p)
            sub, _ = read_fstring(b, q)
            return asset + (('.' + sub) if sub else '')
        if ptype == 'EnumProperty':
            return self.fname(p)[0]
        if ptype == 'ByteProperty':
            return b[p] if size == 1 else self.fname(p)[0]
        if ptype == 'StructProperty':
            return self.read_struct(p, struct_name, size, depth)
        if ptype == 'ArrayProperty':
            return self.read_array(p, inner_type, size, depth)
        return {'__raw': f'{ptype}[{size}B]'}

    def read_struct(self, p, struct_name, size, depth):
        if struct_name in NATIVE_STRUCTS:
            n = NATIVE_STRUCTS[struct_name]
            if size >= n * 4:
                vals = [round(struct.unpack_from('<f', self.b, p + i * 4)[0], 4)
                        for i in range(n)]
                return dict(zip('xyzw', vals)) if struct_name != 'Rotator' \
                    else dict(zip(('pitch', 'yaw', 'roll'), vals))
            return {'__struct': struct_name}
        if depth >= self.max_depth:
            return {'__struct': struct_name, '__truncated': True}
        try:
            inner, _ = self.read_properties(p, depth + 1, limit=p + size)
            return inner if inner else {'__struct': struct_name, '__empty': True}
        except Exception as ex:
            return {'__struct': struct_name, '__error': str(ex)[:60]}

    def read_array(self, p, inner_type, size, depth):
        b = self.b
        end = p + size
        try:
            count = i32(b, p)
            p += 4
            if count < 0 or count > 100000:
                return {'__array': inner_type, '__badcount': count}
            if count == 0:
                return []
            if inner_type == 'StructProperty':
                # UE writes one inner FPropertyTag, then untagged elements.
                _, q = self.fname(p)          # inner name
                _, q = self.fname(q)          # inner type
                q += 8                        # size + arrayindex
                s_name, q = self.fname(q)     # struct name
                q += 16                       # struct guid
                q += 1                        # has-guid byte
                if depth >= self.max_depth:
                    return {'__array': s_name, '__count': count}
                out = []
                for _ in range(count):
                    if q >= end:
                        break
                    props, q = self.read_properties(q, depth + 1, limit=end)
                    out.append(props)
                return out
            if inner_type in SIMPLE_READERS:
                width, fn = SIMPLE_READERS[inner_type]
                return [fn(b, p + i * width) for i in range(count)
                        if p + i * width + width <= end]
            if inner_type == 'NameProperty':
                return [self.fname(p + i * 8)[0] for i in range(count)
                        if p + i * 8 + 8 <= end]
            if inner_type == 'ObjectProperty':
                return [{'__objref': i32(b, p + i * 4)} for i in range(count)
                        if p + i * 4 + 4 <= end]
            if inner_type in ('StrProperty', 'SoftObjectProperty'):
                out, q = [], p
                for _ in range(count):
                    if q >= end:
                        break
                    if inner_type == 'StrProperty':
                        v, q = read_fstring(b, q)
                    else:
                        a, q = self.fname(q)
                        s, q = read_fstring(b, q)
                        v = a + (('.' + s) if s else '')
                    out.append(v)
                return out
            return {'__array': inner_type, '__count': count}
        except Exception as ex:
            return {'__array': inner_type, '__error': str(ex)[:60]}

    # ---- the tagged-property walk ---------------------------------------
    def read_properties(self, p, depth=0, limit=None):
        """Walk tagged properties until a 'None' name. Returns (dict, newpos)."""
        b = self.b
        out = {}
        guard = 0
        while True:
            guard += 1
            if guard > 4000:
                raise ValueError('property loop guard tripped')
            if limit is not None and p + 8 > limit:
                break
            name, p = self.fname(p)
            if name == 'None':
                break
            ptype, p = self.fname(p)
            if depth == 0:
                # Only the top-level walk's alignment is guaranteed; nested
                # struct/array parsing is best-effort and may decode garbage
                # inside a value without ever desynchronising this walk, so its
                # types would poison the oracle.
                self.types_seen.add(ptype)
            size = i32(b, p); p += 4
            _arr_idx = i32(b, p); p += 4

            struct_name = inner_type = None
            bool_val = None
            if ptype == 'StructProperty':
                struct_name, p = self.fname(p)
                p += 16
            elif ptype == 'BoolProperty':
                bool_val = b[p] != 0; p += 1
            elif ptype in ('ByteProperty', 'EnumProperty'):
                _enum, p = self.fname(p)
            elif ptype in ('ArrayProperty', 'SetProperty'):
                inner_type, p = self.fname(p)
            elif ptype == 'MapProperty':
                _k, p = self.fname(p)
                inner_type, p = self.fname(p)

            has_guid = b[p]; p += 1
            if has_guid:
                p += 16

            vstart = p
            if ptype == 'BoolProperty':
                out[strip_suffix(name)] = bool_val
            else:
                if size < 0 or vstart + size > len(b):
                    raise ValueError(f'bad size {size} for {name}')
                out[strip_suffix(name)] = self.read_value(
                    vstart, ptype, size, struct_name, inner_type, depth)
            # ALWAYS reposition by the declared size -- keeps us aligned.
            p = vstart + size
        return out, p


def strip_suffix(name):
    """UE appends _<idx>_<HASH> to user-defined-struct property names."""
    parts = name.split('_')
    if len(parts) >= 3 and len(parts[-1]) == 32:
        try:
            int(parts[-2])
            return '_'.join(parts[:-2])
        except ValueError:
            pass
    return name


class SkewedNames:
    """A Package view whose name lookups assume the .uexp addresses a name map
    with ONE extra entry inserted at `boundary` (see NAME-MAP SKEW below).
    Indices below the boundary are unaffected; the rest are one too high.
    """
    def __init__(self, pkg, boundary):
        self._pkg = pkg
        self._boundary = boundary

    def __getattr__(self, attr):
        return getattr(self._pkg, attr)

    def fname(self, b, p):
        idx = i32(b, p)
        num = i32(b, p + 4)
        if idx >= self._boundary:
            idx -= 1
        names = self._pkg.names
        base = names[idx] if 0 <= idx < len(names) else f'<bad:{idx}>'
        if num > 0:
            base = f'{base}_{num - 1}'
        return base, p + 8


def _decode_rows(pkg, uexp, start, targets, verbose=False):
    """One full decode attempt with `pkg`'s name resolution.

    Returns (obj_props, count, rows, endpos, reader) if some candidate row-map
    offset consumed the payload EXACTLY, else (None, best_attempt_message).
    """
    r = TaggedReader(pkg, uexp)
    obj_props, after_props = r.read_properties(start)   # UDataTable's own props

    attempts = []
    for target, target_label in targets:
        for pad in range(0, 33, 1):
            q = after_props + pad
            if q + 4 > len(uexp):
                break
            n = i32(uexp, q)
            if not (0 < n < 20000):
                continue
            try:
                p = q + 4
                rows = {}
                r.types_seen = set()      # judge only this candidate's walk
                for _ in range(n):
                    row_name, p = r.fname(p)
                    props, p = r.read_properties(p)
                    rows[row_name] = props
                attempts.append((pad, n, p, rows, target))
                if p == target:
                    if verbose:
                        print(f'[ok] row map at +{pad}, {n} rows, landed exactly on '
                              f'{target} ({target_label})')
                    return (obj_props, n, rows, p, r), None
            except Exception as ex:
                if verbose:
                    print(f'[--] pad +{pad} (n={n}, {target_label}) failed: {str(ex)[:70]}')
                continue

    if attempts:
        pad, n, p, rows, target = max(attempts, key=lambda a: a[2])
        return None, (f'no candidate consumed the payload exactly; best was pad +{pad} '
                      f'with {n} rows ending at {p} (expected {target}, delta {target - p})')
    return None, 'no plausible row map found'


def field_names(node, out):
    """Every property name appearing anywhere in a decoded row tree."""
    if isinstance(node, dict):
        for key, value in node.items():
            if not key.startswith('__'):
                out.add(key)
            field_names(value, out)
    elif isinstance(node, list):
        for value in node:
            field_names(value, out)


def _repair_name_map_skew(pkg, uexp, start, targets, vocabulary, verbose=False):
    """Find the insertion point that reconciles the .uexp with the .uasset.

    Two independent oracles have to agree before a repair is accepted:
      1. the walk must still land EXACTLY on the payload's end, and every
         decoded property type must be a real UE type (UE_PROPERTY_TYPES);
      2. the decoded FIELD names must match the vocabulary of the sibling
         tables that parsed cleanly -- because a type oracle alone cannot see
         a boundary that only moves property names.
    Returns (boundary, decoded) or (None, None).
    """
    # Only a boundary at or below the first tag's type index can fix a package
    # whose very first property already mis-reads, so the sweep is bounded.
    highest = i32(uexp, start + 8)
    if not (0 < highest <= pkg.name_count):
        return None, None

    best = None
    for boundary in range(1, highest + 1):
        try:
            decoded, _why = _decode_rows(SkewedNames(pkg, boundary), uexp, start, targets)
        except Exception:
            continue    # a wrong boundary desynchronises the walk; that IS the signal
        if decoded is None:
            continue
        _obj, _n, rows, _end, reader = decoded
        if not reader.types_seen <= UE_PROPERTY_TYPES:
            continue
        found = set()
        field_names(rows, found)
        score = len(found & vocabulary)
        if best is None or score > best[0]:
            best = (score, boundary, decoded)

    if best is None:
        return None, None
    score, boundary, decoded = best
    if verbose:
        print(f'[repair] name-map skew: one entry inserted at index {boundary}; '
              f'{score} field names matched the sibling-table vocabulary')
    return boundary, decoded


def parse_datatable(uasset_path, uexp_path, verbose=False, repair_vocabulary=None):
    """Parse a cooked UDataTable.

    The row map does not always begin immediately after the object's tagged
    properties (this package has 4 bytes of padding between them), so we probe
    a small window of candidate offsets and accept only the one whose full walk
    consumes EXACTLY the export's declared serial size. That exact-landing test
    is the validation: a single byte of misalignment anywhere in 335 KB of
    nested structs would make the walk terminate somewhere else.

    The export's declared serial_size is itself occasionally wrong (observed
    once: Xuanling's DT_SkillInfo under-reports by 112 bytes relative to the
    buffer's true end -- a ue_header.py export-table quirk on that specific
    asset, not a row-decode issue: replaying the row walk shows every property
    on every row decoding to a legible, sensible field name with no read
    errors). Every OTHER asset checked lands its walk exactly 4 bytes before
    the .uexp buffer's end (a small trailing footer), so once the declared
    target fails, retry treating `len(uexp) - 4` as the target -- cross-
    validated against that universal footer convention, not a guess.

    NAME-MAP SKEW (confirmed once: Lucilla's DT_SkillInfo, FemaleXL/Luosela)
      A package can ship a .uexp whose FName indices address one MORE name-map
      entry than the .uasset beside it declares. Her name table is provably
      intact -- 525 well-formed entries, alphabetically sorted, consuming the
      span to import_offset exactly, and her import map resolves perfectly at
      face value -- yet the payload's indices are one too high from somewhere
      in the enum block onward, so her row ids (low indices) read correctly
      while `RowStruct`/`ObjectProperty`/`None` do not, and the walk
      desynchronises at the first StructProperty. Passing `repair_vocabulary`
      (the field names of tables that DID parse) lets the reader find the
      insertion point and decode her anyway; `pkg.name_map_skew` reports it.
      Without a vocabulary the parse fails loudly, exactly as before.
    """
    pkg = Package(open(uasset_path, 'rb').read())
    uexp = open(uexp_path, 'rb').read()
    exp = pkg.exports[0]
    start = exp['serial_offset'] - pkg.total_header_size  # -> 0 in .uexp
    targets = [(exp['serial_size'], 'declared')]
    if len(uexp) - 4 != exp['serial_size']:
        targets.append((len(uexp) - 4, 'footer-fallback'))

    pkg.name_map_skew = None
    try:
        decoded, why = _decode_rows(pkg, uexp, start, targets, verbose)
    except Exception as ex:
        decoded, why = None, str(ex)

    if decoded is None and repair_vocabulary:
        boundary, repaired = _repair_name_map_skew(
            pkg, uexp, start, targets, repair_vocabulary, verbose)
        if repaired is not None:
            pkg.name_map_skew = boundary
            decoded = repaired

    if decoded is None:
        raise AssertionError(why)
    obj_props, count, rows, endpos, _reader = decoded
    return pkg, obj_props, count, rows, endpos
