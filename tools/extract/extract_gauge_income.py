"""
Gauge income and expenditure, straight from the game's own tables.

    python3 extract_gauge_income.py <export-root> [-o data/gauge-income.json]

WHAT THIS ANSWERS
  A kit's named stack gauge (Denia's Dark Core, Changli's Enflamement, Sigrika's
  Full Stop) is a `SpecialEnergy{N}` attribute. Its CAP has always been readable
  (`SpecialEnergy{N}Max`, baseproperty.json). Its INCOME was believed unreadable,
  so `RESOURCE_DEFS` in src/core/rotation-rules.js carries hand-curated `gains`
  with this note: "The game states a gauge's cap in baseproperty.json but grants
  these named stack gauges through its Buff table, which is not among the four
  BinData dumps in data/bindata/ ... Income becomes extractable if that table is
  ever dumped."

  The Buff table IS reachable — `configdb.py` reads every `db_*.db` using the
  client's own accessors. This joins it to the casts.

THE JOIN, AND WHY IT IS EXACT AT EVERY HOP
  1. Every character ships a `DT_SkillInfo` DataTable whose rows ARE its casts.
     `ue_tagged.parse_datatable` decodes them (it validates by consuming the
     export's declared payload exactly, and repairs the known name-map skew).
  2. A row's `SkillBuff` / `SkillStartBuff` / `SkillEndBuff` hold buff IDs — the
     literal integers, no decoding.
  3. `db_buff` gives each buff a `GameAttributeID`. When that id is an Energy or
     SpecialEnergy channel, the buff moves a gauge, and `ModifierMagnitude` says
     by how much.

  Nothing is parsed out of prose and nothing is inferred from folder names: the
  resonator id comes from the row id's own 4-digit prefix, the same rule
  extract_timings.py documents.

  Cross-check that pins the whole chain (Denia, 1211) — three gauges, three caps
  and three grants, each matching her kit text to the digit with no text parsing
  involved:
     "hold up to 3 [Dark Cores]" + "obtains 1 upon casting Intro Skill"
        -> SpecialEnergy2Max 3; rows 1211061/1211062 (both QTE) grant +1
     "up to 100 [Void Particle]" + "...or Resonance Skill [Phantom Bubble]
        grants 25"        -> SpecialEnergy1Max 100; rows 1211041/1211061 grant +25
     "up to 100 [Conformal Charge]" + "[Banish - Breakdown Form Stage 2] grants
        40"               -> SpecialEnergy3Max 100; row 1211048 grants +40

MAGNITUDE SEMANTICS ARE READ FROM THE CLIENT, NOT GUESSED
  `ActiveBuff.ModifyStateAttribute` switches on `CalculationPolicy[0]`, and a
  SpecialEnergy attribute is a state attribute, so that is the branch that runs:

      case 0: AddBaseValue(attr, V1 * stacks)                    flat add
      case 1: SetBaseValue(attr, base * (V1/10000 * stacks + 1)) scale the base
      case 2: AddBaseValue(attr, (V1/10000 * srcAttr + V2) * stacks)
      case 3: SetBaseValue(attr, V1)                             override
      case 5: AddBaseValue(attr, V1 * duration * stacks)
      case 6: AddBaseValue(attr, (V1/10000 * attr + V2) * duration * stacks)
      (4 and 9 are variants of 2; `CalculationPolicy[1]` names the source attr.)

  So `-10000` under policy 1 multiplies the gauge by zero, and `0` under policy 3
  overwrites it with zero — both are "spend it all", which is why the same intent
  shows up with three different encodings across the roster.

  `effect` normalises ONLY the unambiguous cases and every row keeps its raw
  `policy` + `magnitude`. A shape this file cannot name resolves to
  `{"kind": "unknown"}` rather than a guess.

TWO LANES, AND ONLY ONE IS A CAST
  `cast`    — DT_SkillInfo rows: the gauge moves because a skill was cast.
              This is the lane RESOURCE_DEFS models (per-cast constants).
  `trigger` — db_PassiveSkill rows (`SkillAction: AddBuff`): the gauge moves
              because something HAPPENED — a hit landed (`DamageTrigger`), a
              timer elapsed, a tag was gained. These carry their own `CDTime`.
              rotation-resources.js puts this lane explicitly out of scope
              ("Gauge income from hit counts, off-field actions and real-time
              ticks is out of scope"), so it is extracted and reported but NOT
              wired. It is here because it is the reason some gauges look empty
              in the cast lane: Changli's Enflamement and Camellya's Crimson Bud
              are earned on hit, not on cast.

Generated file; do not hand-edit.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from configdb import ConfigDB
from ue_tagged import parse_datatable, field_names

# Aki.Protocol.Vks, the client's own EAttributeId enum (Core/Define/Net/
# Protocol.js). Only the gauge channels — a buff touching anything else is not
# income and is skipped. The Max entries are included because a kit that RAISES
# a cap states it the same way, and reading one as income would be a silent lie.
GAUGE_ATTRIBUTES = {
    59: 'EnergyMax', 60: 'Energy',
    61: 'SpecialEnergy1Max', 62: 'SpecialEnergy1',
    63: 'SpecialEnergy2Max', 64: 'SpecialEnergy2',
    65: 'SpecialEnergy3Max', 66: 'SpecialEnergy3',
    67: 'SpecialEnergy4Max', 68: 'SpecialEnergy4',
}

# Which SpecialEnergy channel an attribute is, so a caller can line a grant up
# with `resonator.specialEnergyCaps` without re-deriving the mapping.
CHANNEL_OF = {62: 1, 64: 2, 66: 3, 68: 4}
MAX_CHANNEL_OF = {61: 1, 63: 2, 65: 3, 67: 4}
# Every attribute that is a CEILING rather than a level. A grant against one of
# these raises the cap; it is not income, and must never be summed as if it were.
MAX_ATTRIBUTES = frozenset(MAX_CHANNEL_OF) | {59}

# Fields on a DT_SkillInfo row that hold buff ids the cast APPLIES. The two
# `*RemoveBuffIds` fields are deliberately absent: removing a buff is not a gauge
# move, and a removal id resolving to a gauge buff would read as income.
GRANT_FIELDS = ('SkillBuff', 'SkillStartBuff', 'SkillEndBuff', 'SpecialBuffInCode')

# Mirrors extract_timings.py COMBAT_FORM_TABLE_NAMES — a mode-specific table
# (_Rogue, _photos, _story) reuses the same id space with different numbers, so
# merging one would silently overwrite real combat data.
COMBAT_TABLE_NAMES = {'DT_SkillInfo.uasset', 'DT_SkillInfo_GD.uasset'}

SKILL_ID_RE = re.compile(r'^(\d{4})(\d{3,})$')
SHORT_SKILL_ID_RE = re.compile(r'^(1[1-6]\d{2})(\d{1,2})$')
# A leading '1' plus one of six element/role tiers — the shape every roster id
# fits and no shared/monster id does.
RESONATOR_ID_RE = re.compile(r'^1[1-6]\d{2}\d+$')

# The client's 1/10000 fixed-point scale (CharacterAttributeTypes
# DIVIDED_TEN_THOUSAND), used by every fractional policy.
TEN_THOUSAND = 10000


def level_value(magnitude):
    """The value a magnitude vector contributes.

    `AbilityUtils.GetLevelValue(vector, level, 0)` indexes by buff level. Every
    gauge grant found so far is level-invariant (a one-element vector); a longer
    one is a real level curve and is returned whole for the caller to see rather
    than collapsed to its first entry.
    """
    if not magnitude:
        return None
    values = list(magnitude)
    return values[0] if len(set(values)) == 1 else values


def classify(policy, magnitude):
    """Normalise a (CalculationPolicy, ModifierMagnitude) pair, or say unknown.

    Only shapes whose meaning is fixed by the client's own switch are named. The
    raw pair always travels alongside, so an unknown here costs nothing.
    """
    if not policy:
        return {'kind': 'unknown', 'why': 'no CalculationPolicy'}
    kind = int(policy[0])
    value = level_value(magnitude)
    if value is None:
        return {'kind': 'unknown', 'why': 'no ModifierMagnitude'}
    if isinstance(value, list):
        return {'kind': 'unknown', 'why': 'level-varying magnitude'}

    if kind == 0:
        return {'kind': 'add', 'amount': value}
    if kind == 1:
        # base * (V1/10000 + 1) — only the annihilating case has a stable
        # meaning without knowing the live base value.
        if value == -TEN_THOUSAND:
            return {'kind': 'spendAll', 'via': 'scale-to-zero'}
        return {'kind': 'scaleBase', 'factor': value / TEN_THOUSAND + 1}
    if kind in (2, 4, 9):
        source = int(policy[1]) if len(policy) > 1 else None
        # Subtracting 100% of a gauge's own ceiling empties it, whatever it held.
        if value == -TEN_THOUSAND and source in MAX_ATTRIBUTES:
            return {'kind': 'spendAll',
                    'via': f'-100% of {GAUGE_ATTRIBUTES.get(source, source)}'}
        return {'kind': 'addFraction', 'fraction': value / TEN_THOUSAND,
                'sourceAttribute': GAUGE_ATTRIBUTES.get(source, source)}
    if kind == 3:
        return {'kind': 'spendAll', 'via': 'override-to-zero'} if value == 0 \
            else {'kind': 'set', 'value': value}
    return {'kind': 'unknown', 'why': f'CalculationPolicy[0]={kind}'}


def gauge_buffs(db):
    """buffId -> the gauge move it performs, for every buff that performs one."""
    out = {}
    for row in db.read('db_buff', 'Buff'):
        attribute = int(row.get('GameAttributeID') or 0)
        if attribute not in GAUGE_ATTRIBUTES:
            continue
        policy = [int(x) for x in (row.get('CalculationPolicy') or [])]
        magnitude = list(row.get('ModifierMagnitude') or [])
        out[int(row['Id'])] = {
            'buffId': int(row['Id']),
            'attribute': GAUGE_ATTRIBUTES[attribute],
            'attributeId': attribute,
            'channel': CHANNEL_OF.get(attribute) or MAX_CHANNEL_OF.get(attribute),
            'isCap': attribute in MAX_ATTRIBUTES,
            'policy': policy,
            'magnitude': magnitude,
            'effect': classify(policy, magnitude),
        }
    return out


def combat_tables(root):
    role_dir = os.path.join(root, 'Content', 'Aki', 'Character', 'Role')
    if not os.path.isdir(role_dir):
        role_dir = root
    found = []
    for dirpath, _dirs, files in os.walk(role_dir):
        for name in files:
            if name in COMBAT_TABLE_NAMES:
                found.append(os.path.join(dirpath, name))
    return sorted(found)


def parse_all(tables, verbose):
    """Decode every table, retrying the skew cases against the others' vocabulary.

    Same two-pass shape as extract_timings.py: a table whose .uexp addresses one
    more name-map entry than its .uasset declares cannot be decoded from itself,
    and the field names of the tables that DID decode are the evidence that pins
    the insertion point.
    """
    parsed, deferred, failures = [], [], []
    for table in tables:
        uexp = table[:-len('.uasset')] + '.uexp'
        if not os.path.exists(uexp):
            failures.append({'table': table, 'error': 'missing .uexp sibling'})
            continue
        try:
            _pkg, _obj, _count, rows, _end = parse_datatable(table, uexp)
        except Exception as ex:
            deferred.append((table, uexp, str(ex)))
            continue
        parsed.append((table, rows))

    vocabulary = set()
    for _table, rows in parsed:
        field_names(rows, vocabulary)

    repaired = 0
    for table, uexp, first_error in deferred:
        try:
            _pkg, _obj, _count, rows, _end = parse_datatable(
                table, uexp, repair_vocabulary=vocabulary)
        except Exception:
            failures.append({'table': table, 'error': first_error[:120]})
            continue
        parsed.append((table, rows))
        repaired += 1

    if verbose:
        print(f'[parse] {len(parsed)} tables ok ({repaired} via skew repair), '
              f'{len(failures)} failed', file=sys.stderr)
    return parsed, repaired, failures


def cast_lane(parsed, buffs, root):
    """resonatorId -> the gauge moves its casts perform."""
    out = {}
    for table, rows in parsed:
        table_name = os.path.relpath(table, root).replace('\\', '/')
        for row_id, row in rows.items():
            match = SKILL_ID_RE.match(str(row_id)) or SHORT_SKILL_ID_RE.match(str(row_id))
            if not match:
                continue        # shared/common rows carry no resonator prefix
            resonator = match.group(1)
            for field in GRANT_FIELDS:
                for buff_id in (row.get(field) or []):
                    try:
                        move = buffs.get(int(buff_id))
                    except (TypeError, ValueError):
                        continue
                    if not move:
                        continue
                    out.setdefault(resonator, []).append({
                        'skillId': str(row_id),
                        'skillName': row.get('SkillName'),
                        'field': field,
                        'table': table_name,
                        **move,
                    })
    for grants in out.values():
        grants.sort(key=lambda g: (g['skillId'], g['attributeId'], g['buffId']))
    return out


def trigger_lane(db, buffs):
    """resonatorId -> gauge moves fired by an event rather than by a cast.

    `SkillActionParams` for an `AddBuff` action is a plain list of buff ids, so
    this is a membership test, not a parse. Only DIRECT grants are reported: a
    param that resolves to a buff with no `GameAttributeID` may still reach a
    gauge through an ExtraEffect chain, and following that chain would be
    inference — those are counted as `indirect` and left alone.
    """
    out, indirect = {}, 0
    for row in db.read('db_PassiveSkill', 'PassiveSkill'):
        if str(row.get('SkillAction')) != 'AddBuff':
            continue
        row_id = str(int(row['Id']))
        # db_PassiveSkill is GLOBAL — monsters, echoes and system passives share
        # its id space, and a bare 4-digit prefix admits all of them (团子 2300,
        # bossrush 6229, ...). The cast lane needs no such filter because it only
        # ever walks the Role tree. Every roster id fits `1[1-6]\d{2}`, the same
        # validating shape extract_timings.py uses for its short-id case.
        if not RESONATOR_ID_RE.match(row_id):
            continue
        match = SKILL_ID_RE.match(row_id) or SHORT_SKILL_ID_RE.match(row_id)
        if not match:
            continue
        params = row.get('SkillActionParams') or []
        for param in params:
            try:
                buff_id = int(str(param).strip())
            except (TypeError, ValueError):
                continue
            move = buffs.get(buff_id)
            if not move:
                indirect += 1
                continue
            out.setdefault(match.group(1), []).append({
                'passiveId': row_id,
                'triggerType': row.get('TriggerType'),
                'cooldownSeconds': row.get('CDTime'),
                'desc': row.get('SkillDesc'),
                **move,
            })
    for moves in out.values():
        moves.sort(key=lambda g: (g['passiveId'], g['attributeId'], g['buffId']))
    return out, indirect


def extract(root, verbose=True):
    db = ConfigDB(root)
    buffs = gauge_buffs(db)
    tables = combat_tables(root)
    if verbose:
        print(f'[index] {len(tables)} combat tables | '
              f'{len(buffs)} gauge-moving buffs', file=sys.stderr)
    parsed, repaired, failures = parse_all(tables, verbose)

    casts = cast_lane(parsed, buffs, root)
    triggers, indirect = trigger_lane(db, buffs)

    resonators = {}
    for resonator in sorted(set(casts) | set(triggers)):
        resonators[resonator] = {
            'cast': casts.get(resonator, []),
            'trigger': triggers.get(resonator, []),
        }

    return {
        '_doc': (
            'Gauge income/expenditure per resonator, joined from the game\'s own '
            'tables: DT_SkillInfo rows -> SkillBuff/SkillStartBuff/SkillEndBuff '
            '-> db_buff GameAttributeID (Aki.Protocol.Vks Energy / SpecialEnergy '
            'channels). `cast` moves happen because a skill was cast and are what '
            'RESOURCE_DEFS models; `trigger` moves happen on a hit, a timer or a '
            'tag and are out of the per-cast resource model\'s scope. `effect` '
            'normalises CalculationPolicy per ActiveBuff.ModifyStateAttribute; '
            'raw policy+magnitude always travel with it. Generated by '
            'tools/extract/extract_gauge_income.py; do not hand-edit.'
        ),
        'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'attributes': {str(k): v for k, v in sorted(GAUGE_ATTRIBUTES.items())},
        'source': {
            'tables': len(tables),
            'parsed': len(parsed),
            'skewRepaired': repaired,
            'failed': failures,
            'gaugeBuffs': len(buffs),
            'indirectTriggerParams': indirect,
        },
        'resonators': resonators,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    parser.add_argument('root', help='FModel export root (holds Content/)')
    parser.add_argument('-o', '--out', default=None, help='output JSON path')
    parser.add_argument('-q', '--quiet', action='store_true')
    args = parser.parse_args()

    result = extract(args.root, verbose=not args.quiet)
    payload = json.dumps(result, ensure_ascii=False, indent=1)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as handle:
            handle.write(payload + '\n')
        if not args.quiet:
            total = sum(len(v['cast']) + len(v['trigger'])
                        for v in result['resonators'].values())
            print(f'[out] {len(result["resonators"])} resonators, {total} gauge '
                  f'moves -> {args.out}', file=sys.stderr)
    else:
        print(payload)


if __name__ == '__main__':
    main()
