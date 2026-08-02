"""Extract the GENERIC negative-status buffs — the per-stack damage every one of
the six statuses deals on its own, independent of any kit.

This is the table `docs/NEGATIVE-STATUS-REFERENCE.md` listed as "pending
calibration" for Fusion Burst and Electro Flare, and that the engine carried as
community-reverse-engineered numbers for Glacio Chafe, Spectro Frazzle and Aero
Erosion. It was missed by the affliction sweep (extract_affliction_damage.py)
because those are KIT buffs carrying `ExtraEffectID 121`, while these are SYSTEM
buffs in a reserved id block with one dedicated ExtraEffectID per status:

    10011000  effect 1003  Glacio Chafe      霜渐效应
    10021000  effect 1004  Fusion Burst      聚爆效应
    10031000  effect 1002  Electro Flare     电磁效应
    10041000  effect 1001  Aero Erosion      风蚀效应
    10051000  effect 1005  Spectro Frazzle   光噪效应
    10061000  effect 1006  Havoc Bane        虚湮效应

Each row carries its own stack limit, stack duration, tick period (0 = not
periodic) and a `stacks#multiplier` table in the same 1/10000 convention the kit
tables use. Glacio Chafe's table is EXACTLY the community-calibrated curve the
engine already had (0.2450 .. 2.0377), which is what confirms the reading.

Havoc Bane's table is negative — it is a DEF reduction (-2%/stack), not damage,
matching the engine's `defReductionPerStack`.

Each status also ships a second, weaker variant (…0000 vs …1000). Glacio's pair
differs — …0000 is exactly half — and the calibrated curve matches …1000, so the
…1000 row is the one that describes what a player inflicts.

Output: data/status-damage.json (committed, like data/bindata/*.json).

    python tools/extract/extract_status_damage.py <fmodel-export-root>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from configdb import ConfigDB    # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The system buff that IS each status. Keyed by buff id so the pick is explicit
# rather than inferred from a tag we would have to translate.
STATUS_BUFFS = {
    10011000: ('glacio_chafe',    1003),
    10021000: ('fusion_burst',    1004),
    10031000: ('electro_flare',   1002),
    10041000: ('aero_erosion',    1001),
    10051000: ('spectro_frazzle', 1005),
    10061000: ('havoc_bane',      1006),
}


def parse_stack_table(text):
    """'1#2450|2#4442' -> {1: 0.2450, 2: 0.4442} (raw values are 1/10000)."""
    out = {}
    for pair in str(text).split('|'):
        stacks, _, value = pair.partition('#')
        stacks, value = stacks.strip(), value.strip()
        if stacks.isdigit() and value.lstrip('-').isdigit():
            out[int(stacks)] = int(value) / 10000
    return out


def main(export_root):
    buffs = ConfigDB(export_root).read(
        'db_buff', 'Buff',
        fields={'Id', 'ExtraEffectID', 'ExtraEffectParameters', 'StackLimitCount',
                'Period', 'DurationMagnitude'})
    by_id = {int(buff['Id']): buff for buff in buffs}

    statuses = {}
    for buff_id, (status, effect_id) in sorted(STATUS_BUFFS.items()):
        buff = by_id.get(buff_id)
        if buff is None:
            raise SystemExit(f'system buff {buff_id} ({status}) not in db_buff — id block moved?')
        if buff['ExtraEffectID'] != effect_id:
            raise SystemExit(f'buff {buff_id} ({status}) has ExtraEffectID '
                             f'{buff["ExtraEffectID"]}, expected {effect_id}')
        # The damage table is whichever parameter carries a stacks#value list.
        tables = [parse_stack_table(p) for p in (buff['ExtraEffectParameters'] or []) if '#' in str(p)]
        tables = [t for t in tables if t]
        if not tables:
            raise SystemExit(f'buff {buff_id} ({status}) carries no stacks#value table')
        # Several parameters can carry a stacks#value list. The DAMAGE one is the
        # table that prices every stack from 1 up to the cap: Glacio's row also
        # ships a per-stack RES reduction (all negative) and a sparse
        # `1#4000|11#4500|12#5000|13#5500` threshold list, neither of which is a
        # damage curve. Sign alone is not enough — the sparse list is positive too.
        limit = buff['StackLimitCount'] or 1
        covers = [t for t in tables if all(stack in t for stack in range(1, limit + 1))]
        positive = [t for t in covers if all(v > 0 for v in t.values())]
        table = (positive or covers or tables)[0]
        period = round(float(buff['Period'] or 0), 4)
        duration = buff['DurationMagnitude'] or []
        statuses[status] = {
            'buffId': buff_id,
            'maxStacks': buff['StackLimitCount'],
            'stackSeconds': round(float(duration[0]), 4) if duration else None,
            'tickIntervalS': period or None,
            'isDefReduction': all(v < 0 for v in table.values()),
            'byStacks': {str(k): v for k, v in sorted(table.items())},
        }

    out = {
        '_doc': 'GENERIC negative-status damage, straight from the game ConfigDB system buffs '
                '(one reserved id + ExtraEffectID per status). Per-stack multipliers in the same '
                '1/10000 convention as the kit tables in affliction-damage.json, plus each '
                "status's own stack limit, stack duration and tick period (tickIntervalS null = "
                'not periodic). Havoc Bane is a DEF reduction, not damage (isDefReduction). '
                'Generated by tools/extract/extract_status_damage.py; do not hand-edit.',
        'statuses': statuses,
    }
    path = os.path.join(ROOT, 'data', 'status-damage.json')
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, indent=1)
        handle.write('\n')

    for status, info in statuses.items():
        stacks = info['byStacks']
        top = max(stacks, key=int)
        kind = 'DEF reduction' if info['isDefReduction'] else 'DMG'
        tick = f", tick {info['tickIntervalS']}s" if info['tickIntervalS'] else ''
        print(f"  {status:16} cap {info['maxStacks']:2}  {info['stackSeconds']}s{tick}  "
              f"{kind} {stacks['1']}x at 1 .. {stacks[top]}x at {top}")
    print(f'wrote {path}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
