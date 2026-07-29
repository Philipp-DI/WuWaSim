"""
Generic cooked-UE4 asset reader: parses the import map, export map, and every
export's tagged properties. Works on any asset that uses classic tagged
serialization (DataTables, AnimMontages, Blueprints' CDOs, ...).

Why the import map matters for AnimMontages: notify *classes* appear as
imports. Reading them tells you what kinds of events the montage fires
(hit/bullet spawn, cancel window, time dilation, ...) even before decoding
their trigger times.
"""
import struct
from ue_header import Package, i32, i64, read_fstring
from ue_tagged import TaggedReader

IMPORT_ENTRY = 28   # ClassPackage(8) ClassName(8) OuterIndex(4) ObjectName(8)


class Asset(Package):
    def __init__(self, uasset_bytes, uexp_bytes=None):
        super().__init__(uasset_bytes)
        self.uexp = uexp_bytes
        self.parse_imports()
        self.parse_export_map()

    # ---- import map -----------------------------------------------------
    def parse_imports(self):
        b = self.b
        self.imports = []
        span = self.export_offset - self.import_offset
        entry = span // self.import_count if self.import_count else IMPORT_ENTRY
        for k in range(self.import_count):
            p = self.import_offset + k * entry
            cls_pkg, p2 = self.fname(b, p)
            cls_name, p2 = self.fname(b, p2)
            outer = i32(b, p2); p2 += 4
            obj_name, _ = self.fname(b, p2)
            self.imports.append({
                'class_package': cls_pkg, 'class_name': cls_name,
                'outer': outer, 'object_name': obj_name,
            })
        self.import_entry_size = entry

    def resolve(self, package_index):
        """FPackageIndex: >0 -> export[i-1], <0 -> import[-i-1], 0 -> null."""
        if package_index == 0:
            return None
        if package_index < 0:
            k = -package_index - 1
            return ('import', self.imports[k]['object_name']) if k < len(self.imports) else ('import', f'?{k}')
        k = package_index - 1
        return ('export', self.exports[k]['object_name']) if k < len(self.exports) else ('export', f'?{k}')

    # ---- export map -----------------------------------------------------
    def parse_export_map(self):
        """Export map spans [export_offset, depends_offset)."""
        b = self.b
        span = self.depends_offset - self.export_offset
        entry = span // self.export_count
        self.export_entry_size = entry
        self.exports = []
        for k in range(self.export_count):
            p = self.export_offset + k * entry
            cls_idx = i32(b, p)
            obj_name, _ = self.fname(b, p + 16)
            ser_size = i64(b, p + 28)
            ser_off = i64(b, p + 36)
            self.exports.append({
                'index': k,
                'class_index': cls_idx,
                'class': None,
                'object_name': obj_name,
                'serial_size': ser_size,
                'serial_offset': ser_off,
            })
        for e in self.exports:
            r = self.resolve(e['class_index'])
            e['class'] = r[1] if r else None

    # ---- export payloads ------------------------------------------------
    def read_export(self, k):
        """Parse export k's tagged properties out of the .uexp."""
        if self.uexp is None:
            raise ValueError('no .uexp supplied')
        e = self.exports[k]
        start = e['serial_offset'] - self.total_header_size
        r = TaggedReader(self, self.uexp)
        props, endpos = r.read_properties(start)
        return props, start, endpos

    def summary(self):
        lines = [
            f"names={self.name_count} imports={self.import_count} "
            f"exports={self.export_count} header={self.total_header_size}",
            f"import entry={self.import_entry_size}B export entry={self.export_entry_size}B",
            '', 'IMPORTS:',
        ]
        for k, im in enumerate(self.imports):
            lines.append(f"  [{-(k+1):>4}] {im['class_name']:<28} {im['object_name']}")
        lines.append('')
        lines.append('EXPORTS:')
        for e in self.exports:
            lines.append(f"  [{e['index']}] {str(e['class']):<24} {e['object_name']:<32} "
                         f"off={e['serial_offset']} size={e['serial_size']}")
        return '\n'.join(lines)


def load(uasset_path, uexp_path=None):
    b = open(uasset_path, 'rb').read()
    u = open(uexp_path, 'rb').read() if uexp_path else None
    return Asset(b, u)
