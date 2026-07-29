"""
Parse a cooked UE4 .uasset package header: summary -> name table -> export map.

Robustness strategy: rather than trusting a hand-derived field layout (the
summary layout varies with engine version, and this package reports
FileVersionUE4 == 0 because it's cooked), we LOCATE the summary fields by
validation: we know NameOffset empirically, so we find the int32 that equals it
and read the surrounding fields, then sanity-check every offset before use.
"""
import struct


def i32(b, p):
    return struct.unpack_from('<i', b, p)[0]


def u32(b, p):
    return struct.unpack_from('<I', b, p)[0]


def i64(b, p):
    return struct.unpack_from('<q', b, p)[0]


def f32(b, p):
    return struct.unpack_from('<f', b, p)[0]


def read_fstring(b, p):
    """UE FString: int32 len; positive=ASCII incl. null, negative=UTF-16LE."""
    n = i32(b, p)
    p += 4
    if n == 0:
        return '', p
    if n > 0:
        s = b[p:p + n - 1].decode('utf-8', errors='replace')
        return s, p + n
    n = -n
    s = b[p:p + n * 2 - 2].decode('utf-16-le', errors='replace')
    return s, p + n * 2


class Package:
    def __init__(self, uasset_bytes):
        self.b = uasset_bytes
        self.parse_summary()
        self.parse_names()
        self.parse_exports()

    def parse_summary(self):
        b = self.b
        assert u32(b, 0) == 0x9E2A83C1, 'not a UE package'
        self.legacy_version = i32(b, 4)
        self.total_header_size = i32(b, 24)

        # Locate NameOffset by validation: it must point at a plausible
        # in-file offset, and NameCount (the int32 immediately before it) must
        # be a plausible count. Scan the summary region for the pair.
        cand = None
        for p in range(28, 120, 1):
            no = i32(b, p)
            nc = i32(b, p - 4)
            if 100 < no < len(b) and 0 < nc < 100000:
                # verify: a valid FString must start at `no`
                ln = i32(b, no)
                if 0 < ln < 512 and b[no + 4 + ln - 1] == 0:
                    cand = (p, nc, no)
                    break
        assert cand, 'could not locate name table'
        p_nameoff, self.name_count, self.name_offset = cand
        after = p_nameoff + 4

        # After NameOffset the order is (4.26, cooked, FilterEditorOnly set):
        #   [GatherableTextDataCount, GatherableTextDataOffset],
        #   ExportCount, ExportOffset, ImportCount, ImportOffset, DependsOffset
        # The gatherable-text pair may or may not be present; try both and keep
        # whichever yields self-consistent offsets.
        for skip in (8, 0):
            q = after + skip
            ec, eo = i32(b, q), i32(b, q + 4)
            ic, io = i32(b, q + 8), i32(b, q + 12)
            do = i32(b, q + 16)
            ok = (0 < ec < 100000 and 0 < ic < 100000
                  and self.name_offset < io < eo < len(b)
                  and eo < do <= len(b))
            if ok:
                self.export_count, self.export_offset = ec, eo
                self.import_count, self.import_offset = ic, io
                self.depends_offset = do
                self.gatherable_skipped = skip
                return
        raise AssertionError('could not locate export/import map offsets')

    def parse_names(self):
        b = self.b
        self.names = []
        p = self.name_offset
        for _ in range(self.name_count):
            s, p = read_fstring(b, p)
            p += 4  # two uint16 hashes (VER_UE4_NAME_HASHES_SERIALIZED)
            self.names.append(s)
        self.name_table_end = p

    def fname(self, b, p):
        """FName = int32 NameIndex + int32 Number."""
        idx = i32(b, p)
        num = i32(b, p + 4)
        base = self.names[idx] if 0 <= idx < len(self.names) else f'<bad:{idx}>'
        if num > 0:
            base = f'{base}_{num - 1}'
        return base, p + 8

    def parse_exports(self):
        """Only need SerialSize/SerialOffset; locate them by validation."""
        b = self.b
        self.exports = []
        size = (self.total_header_size - self.export_offset) // self.export_count
        for e in range(self.export_count):
            base = self.export_offset + e * size
            # ObjectName is an FName early in the struct; SerialSize/Offset are
            # int64s. Find the int64 pair where offset == total_header_size
            # (first export always starts right after the header).
            ser_size = ser_off = None
            for q in range(base, base + size - 16, 4):
                so = i64(b, q + 8)
                ss = i64(b, q)
                if so == self.total_header_size and 0 < ss < 1 << 31:
                    ser_size, ser_off = ss, so
                    break
            self.exports.append({'serial_size': ser_size,
                                 'serial_offset': ser_off,
                                 'raw_base': base, 'entry_size': size})
