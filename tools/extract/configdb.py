"""Read any table out of the game's ConfigDB, using the client's own schema.

The game ships its config as ~500 SQLite files under
`Content/Aki/ConfigDB/db_*.db`, each holding one table of `(Id, BinData)` rows
where BinData is a FlatBuffers blob. It ALSO ships the matching accessors as
plain JavaScript under `Content/Aki/JavaScript/Core/Define/Config/*.js`, and
those spell out, per field, the vtable offset and the read type:

    id(){var t=this.J7.__offset(this.z7,4);return t?this.J7.readInt32(...)}

So the schema never has to be guessed or reverse-engineered — it is read from
the client. That is the whole point of this module: pair a `db_*.db` with its
`*.js` accessor and every field comes back correctly typed and named.

Why this exists: the project's pre-existing `data/bindata/*.json` are
third-party extractions of four of these tables (damage, baseproperty,
roleinfo, skill). They are trustworthy as data, but they are four tables out of
~500 and their field naming is someone else's convention. Anything the sim
still derives by regex over kit text — stack caps, gain triggers, status
tables — should be checked against the game's own table first.

Usage:
    from configdb import ConfigDB
    db = ConfigDB(r"G:/Software/fmodel/Output/Exports/Client")
    for row in db.read('db_buff', 'Buff'):
        print(row['Id'], row['StackLimitCount'])

`python configdb.py <export-root> <Accessor>` prints a field/offset summary,
which is the quickest way to see what a table holds before writing anything.
"""
import json
import os
import re
import sqlite3
import struct
import sys

# readInt32 → ('<i', 4) etc. Vectors reuse the same element codes.
_SCALAR = {
    'readInt8': ('<b', 1), 'readUint8': ('<B', 1),
    'readInt16': ('<h', 2), 'readUint16': ('<H', 2),
    'readInt32': ('<i', 4), 'readUint32': ('<I', 4),
    'readFloat32': ('<f', 4), 'readFloat64': ('<d', 8),
}


class Table:
    """One FlatBuffers table inside a blob."""

    def __init__(self, buf, pos):
        self.buf = buf
        self.pos = pos
        self.vtable = pos - struct.unpack_from('<i', buf, pos)[0]
        self.vtable_len = struct.unpack_from('<H', buf, self.vtable)[0]

    def _offset(self, vtable_offset):
        if vtable_offset >= self.vtable_len:
            return 0
        return struct.unpack_from('<H', self.buf, self.vtable + vtable_offset)[0]

    def _indirect(self, pos):
        return pos + struct.unpack_from('<I', self.buf, pos)[0]

    def scalar(self, vtable_offset, code, default=0):
        off = self._offset(vtable_offset)
        if not off:
            return default
        return struct.unpack_from(code, self.buf, self.pos + off)[0]

    def string(self, vtable_offset):
        off = self._offset(vtable_offset)
        if not off:
            return None
        pos = self._indirect(self.pos + off)
        length = struct.unpack_from('<I', self.buf, pos)[0]
        return self.buf[pos + 4:pos + 4 + length].decode('utf-8', 'replace')

    def _vector(self, vtable_offset):
        off = self._offset(vtable_offset)
        if not off:
            return None, 0
        pos = self._indirect(self.pos + off)
        return pos + 4, struct.unpack_from('<I', self.buf, pos)[0]

    def vec_scalar(self, vtable_offset, code, size):
        start, count = self._vector(vtable_offset)
        if start is None:
            return []
        return [struct.unpack_from(code, self.buf, start + i * size)[0] for i in range(count)]

    def vec_string(self, vtable_offset):
        start, count = self._vector(vtable_offset)
        if start is None:
            return []
        out = []
        for i in range(count):
            pos = self._indirect(start + i * 4)
            length = struct.unpack_from('<I', self.buf, pos)[0]
            out.append(self.buf[pos + 4:pos + 4 + length].decode('utf-8', 'replace'))
        return out


def parse_accessor(js_source):
    """Field spec from a client accessor: name → (offset, kind, code, size).

    kind is 'scalar' | 'string' | 'vec_scalar' | 'vec_string'. Fields the
    accessor exposes only as a nested table (TagLogic and friends) are skipped —
    they need their own accessor and are not what callers ask for by name.
    """
    fields = {}

    # A scalar accessor also encodes the field's FlatBuffers DEFAULT, as the
    # else-branch of `return t?read(...):<default>` — StackLimitCount defaults to
    # 1, Probability to 1e4. Dropping it would report an absent field as 0,
    # which for a stack limit is the difference between "one stack" and "none".
    for name, off, reader, default in re.findall(
            r'(\w+)\(\)\{var \w+=this\.\w+\.__offset\(this\.\w+,(\d+)\);'
            r'return \w+\?this\.\w+\.(read\w+)\([^)]*\):([\d.e+-]+)', js_source):
        code, size = _SCALAR[reader]
        fields[name] = (int(off), 'scalar', code, size, float(default) if '.' in default or 'e' in default else int(default))

    # Booleans read as `!!t&&!!this.X.readInt8(...)` / `!t||!!...` — same storage.
    for name, off in re.findall(
            r'(\w+)\(\)\{var \w+=this\.\w+\.__offset\(this\.\w+,(\d+)\);'
            r'return!\w*\|*\&*\|*!*\w*\&*\|*!!this\.\w+\.readInt8\(', js_source):
        fields.setdefault(name, (int(off), 'scalar', '<b', 1, 0))

    for name, off in re.findall(
            r'(\w+)\(\w+,?\w*\)\{var \w+=this\.\w+\.__offset\(this\.\w+,(\d+)\),'
            r'\w+=\w+\?this\.\w+\.__string\(this\.\w+\.__vector', js_source):
        fields[name] = (int(off), 'vec_string', None, 0, None)

    for name, off, reader in re.findall(
            r'(\w+)\(\w+\)\{var \w+=this\.\w+\.__offset\(this\.\w+,(\d+)\);'
            r'return \w+\?this\.\w+\.(read\w+)\(this\.\w+\.__vector', js_source):
        code, size = _SCALAR[reader]
        fields[name] = (int(off), 'vec_scalar', code, size, None)

    for name, off in re.findall(
            r'(\w+)\(\w*\)\{var \w+=this\.\w+\.__offset\(this\.\w+,(\d+)\),'
            r'\w+=\w+\?this\.\w+\.__string\(this\.\w+\+\w+,', js_source):
        fields[name] = (int(off), 'string', None, 0, None)

    # Pretty names, in declaration order: `get StackLimitCount(){return this.stacklimitcount()}`
    pretty = {}
    for m in re.finditer(r'get (\w+)\(\)\{return ', js_source):
        name = m.group(1)
        tail = js_source[m.end():m.end() + 200]
        impl = re.search(r'this\.(\w+?)(?:Length)?\b', tail)
        if impl:
            pretty[name] = impl.group(1)
    return fields, pretty


class ConfigDB:
    def __init__(self, export_root):
        self.root = export_root
        self.db_dir = os.path.join(export_root, 'Content', 'Aki', 'ConfigDB')
        self.js_dir = os.path.join(export_root, 'Content', 'Aki', 'JavaScript',
                                   'Core', 'Define', 'Config')
        if not os.path.isdir(self.db_dir):
            raise SystemExit(f'ConfigDB not found under {export_root!r} — pass the FModel '
                             f'export root (the folder holding Content/ and Client.uproject).')

    def schema(self, accessor):
        path = os.path.join(self.js_dir, accessor + '.js')
        if not os.path.exists(path):
            raise SystemExit(f'No accessor {accessor}.js in {self.js_dir}')
        with open(path, encoding='utf-8', errors='replace') as handle:
            return parse_accessor(handle.read())

    def read(self, db_name, accessor, fields=None, table=None):
        """Every row of a table as a dict. `fields` limits which are decoded.

        `table` names the SQLite table when the file holds more than one —
        db_property.db carries baseproperty, propertyindex and
        monsterpropertygrowth together, and the first-table default picks the
        wrong one there.
        """
        raw_fields, pretty = self.schema(accessor)
        wanted = {}
        for nice, impl in pretty.items():
            if impl in raw_fields and (fields is None or nice in fields):
                wanted[nice] = raw_fields[impl]

        path = os.path.join(self.db_dir, db_name + '.db')
        connection = sqlite3.connect(path)
        if table is None:
            table = connection.execute(
                "select name from sqlite_master where type='table'").fetchone()[0]
        columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
        key = columns[0]

        out = []
        for _, blob in connection.execute(f'select "{key}", BinData from "{table}"'):
            root = Table(blob, struct.unpack_from('<I', blob, 0)[0])
            row = {}
            for nice, (off, kind, code, size, default) in wanted.items():
                if kind == 'scalar':
                    row[nice] = root.scalar(off, code, default)
                elif kind == 'string':
                    row[nice] = root.string(off)
                elif kind == 'vec_scalar':
                    row[nice] = root.vec_scalar(off, code, size)
                else:
                    row[nice] = root.vec_string(off)
            out.append(row)
        connection.close()
        return out


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    database = ConfigDB(sys.argv[1])
    raw, pretty = database.schema(sys.argv[2])
    print(json.dumps({nice: raw.get(impl) for nice, impl in pretty.items()}, indent=1))
