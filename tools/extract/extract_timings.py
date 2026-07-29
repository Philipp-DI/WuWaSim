"""
Full-roster timing extraction.

    python3 extract_timings.py <asset_root> [-o out.json] [--report report.md]

Walks an FModel-exported asset tree, finds every DT_SkillInfo, resolves the
montages each skill references, parses their notify timelines, and emits one
joined JSON keyed by resonatorId -> skillId.

WHY THIS IGNORES FOLDER NAMES
  Character folders use internal westernised-from-Chinese codenames that do not
  match display names (Rebecca lives under .../Role/FemaleMS/Rebecca/, and her
  skeleton is R2T1RebeccaMd10011). We never parse or trust those names. The
  resonator id comes from the DATA: DT_SkillInfo row keys are the game's skill
  ids (e.g. 1308101), whose leading 4 digits are the resonator id (1308). That
  is the same id space the existing dataset already uses, so the join is exact
  and folder naming is irrelevant.
"""
import argparse
import json
import os
import re
import sys
from collections import defaultdict

from ue_asset import load
from ue_tagged import parse_datatable, field_names
from montage_timeline import montage_timeline

SKILL_ID_RE = re.compile(r'^(\d{4})(\d{3,})$')
# Some resonators (confirmed: Chixia/1202, under her internal codename
# "Maxiaofang") use a SHORTER row-id format -- a 4-digit resonator prefix plus
# only a 1-2 digit skill index (e.g. "120201"), which the primary regex's
# 3-digit-minimum suffix silently excluded entirely, making her look absent
# from an export where her table was present and parsing fine all along.
# Widening the suffix minimum to 1 digit would also start matching shared/
# common-table ids that happen to be short too (e.g. "100005", "2000xx") --
# confirmed by scanning every already-indexed table: those show up IDENTICALLY
# across many unrelated characters' own tables, while a real short resonator
# id (1202, 1302) only ever appears in that one character's table. Every
# resonator id in the roster (56+ characters checked) fits `1[1-6]\d{2}` (a
# fixed leading '1' + one of six element/role tiers), which no shared id does
# ("1000" fails at the tier digit; "2xxx"/"3xxx" fail at the leading digit) --
# use that as the validating filter for the short-suffix case specifically,
# rather than touching the already-proven 3+-digit path.
SHORT_SKILL_ID_RE = re.compile(r'^(1[1-6]\d{2})(\d{1,2})$')


# --------------------------------------------------------------------------
# asset index
# --------------------------------------------------------------------------
# A character's alternate-form combat moveset can live in its own DT_SkillInfo_*
# table alongside the base DT_SkillInfo.uasset -- confirmed for Aemeath's mech
# transformation (FemaleZ2/AimisiGD/Data/DT_SkillInfo_GD.uasset; her mech-form
# skillMap keys, e.g. skill_mech_1, resolve nowhere without it). Everything else
# under a DT_SkillInfo_* name found in a full-roster export (~70 files) is a
# non-combat game-mode variant -- _Rogue/_Rouge (roguelike mode), _Performance/
# _Quest/_Juqing (cutscenes), _Child_photos/_2_7photos (photo minigame),
# _MainLine/_MainTask (story-specific one-offs), _TowerDefense/_XCZ (minigames)
# -- deliberately NOT indexed: their rows can reuse the same id space as the
# real combat table with different (mode-specific) numbers, so blindly merging
# them risks silently overwriting real timing data. Extend this set only when a
# specific character's autoSkillMap keys are confirmed to need it, the same way
# _GD was confirmed here -- never wildcard-match DT_SkillInfo_*.
COMBAT_FORM_TABLE_NAMES = {'DT_SkillInfo.uasset', 'DT_SkillInfo_GD.uasset'}


def build_index(root):
    """Map normalised '/Game/...' style suffixes -> filesystem .uasset paths."""
    index = {}
    dt_files = []
    stray_montages = []
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            if not fn.endswith('.uasset'):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace('\\', '/')
            index[rel.lower()] = full
            if fn in COMBAT_FORM_TABLE_NAMES:
                dt_files.append(full)
            elif fn.startswith('AM_'):
                stray_montages.append(full)
    return index, dt_files, stray_montages


def resolve_game_path(game_path, index):
    """'/Game/Aki/.../AM_X.AM_X' -> filesystem .uasset path, or None.

    The export root's depth relative to '/Game/' is unknown (it may start at
    Client/Content/, Aki/, or -- as with a Role-only bulk export -- as deep as
    Role/ itself, which is BELOW the montage's own path). A plain "index path
    ends with the full wanted path" test only fires when the index is rooted
    at or above the game path's start, so it silently misses anything rooted
    deeper. Instead, walk trailing path segments from most to least specific
    and stop at the first depth that has any match at all -- that is the most
    specific comparison the shorter of the two paths allows. A tie at that
    depth is genuine ambiguity (e.g. two characters sharing a relative
    sub-path), not something to guess past.
    """
    if not game_path:
        return None
    p = game_path.split('.')[0]                 # drop the .ObjectName suffix
    p = p.lstrip('/')
    if p.lower().startswith('game/'):
        p = p[5:]
    want_parts = (p + '.uasset').lower().split('/')
    for k in range(len(want_parts), 0, -1):
        suffix = '/'.join(want_parts[-k:])
        hits = [full for rel, full in index.items()
                if rel == suffix or rel.endswith('/' + suffix)]
        if hits:
            return hits[0] if len(hits) == 1 else None
    return None


def pair(uasset_path):
    """Return (uasset, uexp) if the .uexp sibling exists."""
    uexp = uasset_path[:-len('.uasset')] + '.uexp'
    return (uasset_path, uexp) if os.path.exists(uexp) else (uasset_path, None)


# --------------------------------------------------------------------------
# extraction
# --------------------------------------------------------------------------
def montage_names_from_row(row):
    """Pull montage asset references out of a DT_SkillInfo row."""
    out = []
    for field in ('Animations', 'MontagePaths'):
        v = row.get(field)
        if isinstance(v, list):
            for el in v:
                if isinstance(el, str) and '/Game/' in el:
                    out.append(el)
                elif isinstance(el, dict):
                    for k, vv in el.items():
                        if k.startswith('__'):
                            continue
                        if isinstance(k, str) and '/Game/' in k:
                            out.append(k)
                        elif isinstance(vv, str) and '/Game/' in vv:
                            out.append(vv)
    seen, uniq = set(), []
    for p in out:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    return uniq


def extract(root, verbose=True):
    index, dt_files, stray = build_index(root)
    if verbose:
        print(f'[index] {len(index)} .uasset files | {len(dt_files)} DT_SkillInfo '
              f'| {len(stray)} AM_* montages', file=sys.stderr)

    result = {'_meta': {}, 'resonators': {}}
    errors = []
    repairs = []
    montage_cache = {}
    referenced = set()

    # Pass 1: decode every table on its own terms, and bank the field names of
    # the ones that succeed. A table whose .uexp addresses a name map its
    # .uasset does not match cannot be decoded from itself (see the NAME-MAP
    # SKEW note on parse_datatable) -- that shared vocabulary is the evidence
    # that pins the skew, so the retry has to wait until every table is in.
    parsed = []
    deferred = []
    for dt in dt_files:
        _, dt_uexp = pair(dt)
        if not dt_uexp:
            errors.append({'file': dt, 'error': 'missing .uexp sibling'})
            continue
        try:
            # parse_datatable already validates exact-landing internally (against
            # the declared serial_size, falling back to the buffer's true end) and
            # raises if neither lands exactly -- trust its success, don't re-check
            # against the possibly-wrong declared serial_size here.
            _pkg, _obj, _nrows, rows, _endpos = parse_datatable(dt, dt_uexp)
        except Exception as ex:
            deferred.append((dt, dt_uexp, str(ex)))
            continue
        parsed.append((dt, rows))

    vocabulary = set()
    for _dt, rows in parsed:
        field_names(rows, vocabulary)

    for dt, dt_uexp, first_error in deferred:
        try:
            pkg, _obj, _nrows, rows, _endpos = parse_datatable(
                dt, dt_uexp, repair_vocabulary=vocabulary)
        except Exception:
            errors.append({'file': dt, 'error': f'DataTable parse failed: {first_error}'})
            continue
        repairs.append({'file': os.path.relpath(dt, root).replace('\\', '/'),
                        'name_map_skew_at': pkg.name_map_skew,
                        'original_error': first_error})
        parsed.append((dt, rows))

    for dt, rows in parsed:
        for row_id, row in rows.items():
            m = SKILL_ID_RE.match(str(row_id)) or SHORT_SKILL_ID_RE.match(str(row_id))
            if not m:
                # shared/common rows (e.g. '100005') have no resonator prefix
                continue
            rid = m.group(1)
            res = result['resonators'].setdefault(rid, {'source_table': [], 'skills': {}})
            table = os.path.relpath(dt, root).replace('\\', '/')
            if table not in res['source_table']:
                res['source_table'].append(table)

            cd = row.get('CooldownConfig') or {}
            entry = {
                'skill_name': row.get('SkillName'),
                'genre': row.get('SkillGenre'),
                'cooldown_s': cd.get('CdTime'),
                'next_skill_id': cd.get('NextSkillId'),
                'montages': [],
                'timing': None,
                'provenance': 'extracted',
            }

            timings = []
            for gp in montage_names_from_row(row):
                referenced.add(gp.split('.')[0].lower())
                fs = resolve_game_path(gp, index)
                rec = {'game_path': gp, 'asset': gp.split('/')[-1].split('.')[0],
                       'resolved': bool(fs)}
                if fs:
                    _, mx = pair(fs)
                    if not mx:
                        rec['error'] = 'missing .uexp'
                    else:
                        if fs not in montage_cache:
                            try:
                                montage_cache[fs] = montage_timeline(fs, mx)
                            except Exception as ex:
                                montage_cache[fs] = {'__error': str(ex)}
                        t = montage_cache[fs]
                        if '__error' in t:
                            rec['error'] = t['__error']
                        else:
                            rec['timeline'] = t['derived']
                            rec['sequence_length_s'] = t['sequence_length_s']
                            timings.append(t['derived'])
                else:
                    rec['error'] = 'montage not found in tree'
                entry['montages'].append(rec)

            if timings:
                entry['timing'] = merge_timings(timings)
            res['skills'][str(row_id)] = entry

    # montages present on disk but never referenced by any DT_SkillInfo
    referenced_norm = set()
    for r in referenced:
        rr = r.lstrip('/')
        if rr.startswith('game/'):
            rr = rr[5:]
        referenced_norm.add(rr)

    unreferenced = []
    for am in stray:
        rel = os.path.relpath(am, root).replace('\\', '/')
        key = rel[:-len('.uasset')].lower()
        if not any(key == r or key.endswith('/' + r) or r.endswith('/' + key)
                   for r in referenced_norm):
            unreferenced.append(rel)

    result['_meta'] = {
        'asset_root': os.path.abspath(root),
        'datatables_parsed': len(dt_files),
        'resonators_found': len(result['resonators']),
        'montages_parsed': len([v for v in montage_cache.values() if '__error' not in v]),
        'montage_parse_failures': len([v for v in montage_cache.values() if '__error' in v]),
        'errors': errors,
        'name_map_repairs': repairs,
        'unreferenced_montages': unreferenced,
        'notify_vocabulary': {
            'hit': 'TsAnimNotifyReSkillEvent',
            'cancel_window': 'TsAnimNotifyStateNextAtt',
            'freeze': 'TsAnimNotifyStateAbsoluteTimeStop / TsAnimNotifyStateTimeStopRequest',
            'skill_end': 'TsAnimNotifyEndSkill',
        },
        'WARNING': ('sequence_length_s includes the idle-return tail and is NOT '
                    'the skill duration (a basic attack measured 5.83s long but '
                    'ended at 0.63s). Use skill_end_s / actionable_at_s.'),
    }
    return result


def merge_timings(timings):
    """A skill may reference several montages; combine conservatively."""
    if len(timings) == 1:
        return timings[0]
    hits = sorted({h for t in timings for h in (t.get('hit_times_s') or [])})
    freeze = [t.get('freeze_total_s') for t in timings if t.get('freeze_total_s')]
    cancels = [t.get('cancel_window_opens_s') for t in timings
               if t.get('cancel_window_opens_s') is not None]
    ends = [t.get('skill_end_s') for t in timings if t.get('skill_end_s') is not None]
    acts = [t.get('actionable_at_s') for t in timings
            if t.get('actionable_at_s') is not None]
    return {
        'hit_times_s': hits or None,
        'hit_count': len(hits),
        'freeze_total_s': max(freeze) if freeze else None,
        'cancel_window_opens_s': min(cancels) if cancels else None,
        'skill_end_s': max(ends) if ends else None,
        'actionable_at_s': min(acts) if acts else None,
        '_merged_from': len(timings),
    }


def write_report(res, path):
    lines = ['# Timing extraction report', '']
    m = res['_meta']
    lines += [f"- asset root: `{m['asset_root']}`",
              f"- DataTables parsed: {m['datatables_parsed']}",
              f"- resonators found: {m['resonators_found']}",
              f"- montages parsed: {m['montages_parsed']} "
              f"(failures: {m['montage_parse_failures']})", '']
    lines += ['## Coverage by resonator', '',
              '| resonator | skills | with timing | no montage | hits found |',
              '|---|---|---|---|---|']
    for rid, r in sorted(res['resonators'].items()):
        sk = r['skills']
        with_t = sum(1 for s in sk.values() if s['timing'])
        nomont = sum(1 for s in sk.values() if not s['montages'])
        hits = sum((s['timing'] or {}).get('hit_count', 0) or 0 for s in sk.values())
        lines.append(f"| {rid} | {len(sk)} | {with_t} | {nomont} | {hits} |")
    if m['errors']:
        lines += ['', '## Errors', '']
        for e in m['errors'][:80]:
            lines.append(f"- `{e.get('file','')}` — {e['error']}")
    if m['unreferenced_montages']:
        lines += ['', f"## Unreferenced montages ({len(m['unreferenced_montages'])})",
                  '', 'Present on disk but not referenced by any DT_SkillInfo row '
                  '(e.g. Liberation-state animations in BurstAimAttack/). Review '
                  'these manually — they often hold the in-burst attack timings.', '']
        for u in m['unreferenced_montages'][:120]:
            lines.append(f'- `{u}`')
    open(path, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('-o', '--out', default='timing-data.json')
    ap.add_argument('--report', default=None)
    a = ap.parse_args()
    res = extract(a.root)
    json.dump(res, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f"wrote {a.out}: {res['_meta']['resonators_found']} resonators, "
          f"{res['_meta']['montages_parsed']} montages", file=sys.stderr)
    if a.report:
        write_report(res, a.report)
        print(f'wrote {a.report}', file=sys.stderr)


if __name__ == '__main__':
    main()
