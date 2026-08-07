"""Check every parsed Resonance-Chain effect against the game's OWN buff table.

The sim derives chain/inherent effects by reading English kit text with regexes
(`tools/preprocess/effects.mjs`). That reader fails silently — a phrasing it has
never seen yields no effect, no warning and no diff — and the 2026-08-07 coverage
pass found 109 of 324 buff clauses producing nothing at all. Fixing the reader
told us WHICH clauses parse. It could not tell us whether the numbers are right.

The game answers that directly. Its ConfigDB ships:

    db_resonate_chain  →  one row per S1..S6 node, with a `BuffIds` column
    db_buff            →  24,777 Unreal GameplayEffect rows: GameAttributeID,
                          CalculationPolicy, ModifierMagnitude, DurationPolicy /
                          Magnitude, the whole Stacking* family, and four
                          *TagRequirements pairs that ARE the gating conditions
    db_property        →  propertyindex: attribute id → key + IsPercent

and `GameAttributeID` is the SAME id space `src/core/stats.js` already uses
(7 Atk, 9 CritDamage, 22..27 element DMG bonus), so no translation is needed —
which is itself the finding that makes this comparison meaningful.

This script changes NO engine behaviour. It reads both sides, lines them up per
node, and prints where they disagree:

    matched            our stat and value equal the game's
    value mismatch     same stat, different number  ← a real parser bug
    missing            the game modifies a stat we emit nothing for
    unmatched (ours)   we emit an attribute effect the node's buffs don't carry
    no attribute lane  multiplierUp / amplify — damage-pipeline effects that are
                       NOT attribute modifiers, so this table cannot judge them

SCOPE: Resonance Chains only. Inherent skills reach their buffs through
`db_skillTree.SkillBranchIds` → another table, not through a `BuffIds` column,
so they need a second hop this version does not make.

    python tools/extract/reconcile_effects.py <fmodel-export-root> [--depth N]

Writes docs/effect-reconciliation.md (gitignored, like the other QA reports).
"""
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from configdb import ConfigDB    # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# A buff whose ExtraEffectID is 5 APPLIES another buff; its parameters are
# [target mode, buff id, stack count]. Following it is what reaches a modifier
# that sits behind a listener rather than on the node itself.
APPLY_BUFF_EFFECT = 5
# ExtraEffectID 35 REGISTERS a passive skill of the same id. That passive is the
# listener — its TriggerType/TriggerFormula say when it fires and its
# SkillActionParams name the buffs it then applies. Without this hop a chain node
# reaches only the buffs stapled directly to it, which for most kits is the
# listener and nothing else: Denia S1's +30% ATK sits three links down
# (chain → 1211702103 → passive → 1211702104 → apply → 1211100011).
REGISTER_PASSIVE_EFFECT = 35

# GameAttributeID → the effect stat this engine would emit for it.
# `calc` distinguishes the ATK lanes: CalculationPolicy 1 is a ratio of base
# (our `atkRatio`), 0 is a flat add (which no chain effect models).
ATTR_TO_STAT = {
    8:  ('critRate', None),
    9:  ('critDmg', None),
    11: ('energyRegen', None),
    14: ('skillTypeBonus', 'skill'),
    17: ('skillTypeBonus', 'basic'),
    18: ('skillTypeBonus', 'heavy'),
    19: ('skillTypeBonus', 'liberation'),
    35: ('healingBonus', None),
}
# 22..27 → elementBonus on elementId 1..6 (the same 21+elementId rule stats.js uses).
for _attr in range(22, 28):
    ATTR_TO_STAT[_attr] = ('elementBonus', _attr - 21)

# Effect stats that are NOT attribute modifiers. They live in the damage
# pipeline (a skill's own rate, or the amplify bucket), so a buff row has no
# column for them and their absence here is not evidence of anything.
NO_ATTRIBUTE_LANE = {'multiplierUp', 'amplify', 'afflictionCritRate', 'afflictionCritDmg', 'dmgBonus'}

TOLERANCE = 1e-6


def modifiers_of(buff, percent_attrs):
    """The (stat, scope, value) an attribute buff applies, or None."""
    attr = buff.get('GameAttributeID')
    if not attr:
        return None
    magnitudes = buff.get('ModifierMagnitude') or []
    if not magnitudes:
        return None
    calc = (buff.get('CalculationPolicy') or [0])[0]
    raw = magnitudes[0]
    # The 1/10000 convention every percentage in this dump uses. `IsPercent`
    # describes the ATTRIBUTE, not the modifier: Atk is a flat stat (IsPercent 0)
    # but a CalculationPolicy-1 modifier on it is a RATIO of base, and its
    # magnitude is scaled like every other percentage. Reading IsPercent alone
    # reported Camellya's +58% ATK as "5800 vs 0.58".
    ratio = calc == 1
    value = raw / 10000.0 if (attr in percent_attrs or ratio) else raw
    if attr == 7:
        return ('atkRatio' if ratio else 'atkFlat', None, value)
    mapped = ATTR_TO_STAT.get(attr)
    if not mapped:
        return ('attr:%d' % attr, None, value)
    return (mapped[0], mapped[1], value)


def ids_in(params):
    """Buff ids inside an ExtraEffectParameters / SkillActionParams vector.

    Entries are strings, a leading one is a target mode ('0'), and several rows
    pack a LIST into one entry with '#' ("1211400001#1211400004"). Anything
    shorter than five digits is a mode or a count, not an id.
    """
    out = []
    for param in params or []:
        for piece in str(param).split('#'):
            if piece.isdigit() and len(piece) > 4:
                out.append(int(piece))
    return out


def gated_by_tag(buffs):
    """tag → buff ids whose application/ongoing requirements demand that tag.

    The Unreal idiom, and the reason a purely FORWARD walk finds so little: a
    chain node often grants nothing but a TAG ("角色.….共鸣.共鸣1"), and the
    modifier is a separate buff that requires it. Carlotta S1 is the whole
    pattern in one node — its only buff is a marker, and the +30 Substance her
    kit text promises lives on a buff gated on that marker's tag.
    """
    index = {}
    for bid, buff in buffs.items():
        for field in ('OngoingTagRequirements', 'ApplicationTagRequirements',
                      'ApplicationSourceTagRequirements'):
            for tag in buff.get(field) or []:
                index.setdefault(tag, set()).add(bid)
    return index


def expand(buff_ids, buffs, passives, depth, tag_index=None):
    """Buff ids reachable from a node, following the grant graph `depth` deep."""
    seen, frontier = set(), [int(b) for b in buff_ids]
    for _ in range(depth + 1):
        nxt = []
        for bid in frontier:
            if bid in seen:
                continue
            seen.add(bid)
            buff = buffs.get(bid)
            if buff:
                if buff.get('ExtraEffectID') == APPLY_BUFF_EFFECT:
                    nxt += ids_in(buff.get('ExtraEffectParameters'))
                if buff.get('ExtraEffectID') == REGISTER_PASSIVE_EFFECT:
                    nxt += ids_in(buff.get('ExtraEffectParameters'))
                for key in ('RelatedAttributeBuffId', 'RelatedExtraEffectBuffId'):
                    related = buff.get(key)
                    # Scalar in some rows, a vector in others — the accessor
                    # types follow the client, and the client is not consistent.
                    for value in (related if isinstance(related, list) else [related]):
                        if value:
                            nxt.append(int(value))
                if tag_index:
                    for tag in buff.get('GrantedTags') or []:
                        nxt += list(tag_index.get(tag, ()))
            passive = passives.get(bid)
            if passive and passive.get('SkillAction') == 'AddBuff':
                nxt += ids_in(passive.get('SkillActionParams'))
        frontier = nxt
        if not frontier:
            break
    return seen


def our_effects(node):
    """(stat, scope, value) for each parsed effect, plus the ones we can't judge."""
    comparable, unjudgeable = [], []
    for effect in node.get('effects') or []:
        stat = effect.get('stat')
        value = effect.get('perStack') if effect.get('stackable') else effect.get('value')
        if stat in NO_ATTRIBUTE_LANE:
            unjudgeable.append((stat, None, value))
            continue
        scope = effect.get('element') if stat == 'elementBonus' else (
            effect.get('skillType') if stat == 'skillTypeBonus' else None)
        comparable.append((stat, scope, value))
    return comparable, unjudgeable


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    export_root = sys.argv[1]
    depth = 2
    if '--depth' in sys.argv:
        depth = int(sys.argv[sys.argv.index('--depth') + 1])

    db = ConfigDB(export_root)
    percent_attrs = {row['Id'] for row in db.read('db_property', 'PropertyIndex', table='propertyindex')
                     if row.get('IsPercent')}
    buffs = {int(row['Id']): row for row in db.read('db_buff', 'Buff')}
    passives = {int(row['Id']): row for row in db.read('db_PassiveSkill', 'PassiveSkill')}
    tag_index = gated_by_tag(buffs)
    chains = [row for row in db.read('db_resonate_chain', 'ResonantChain') if row.get('BuffIds')]

    dataset = json.load(open(os.path.join(ROOT, 'data', 'wuwa-data.json'), encoding='utf-8'))
    resonators = {r['id']: r for r in dataset['resonators']}

    by_group = {}
    for row in chains:
        by_group.setdefault(row.get('GroupId'), {})[row.get('GroupIndex')] = row

    tally = Counter()
    lines, unmapped_attrs = [], Counter()

    for resonator_id, nodes in sorted(by_group.items()):
        resonator = resonators.get(resonator_id)
        if not resonator:
            continue
        for level in sorted(k for k in nodes if k):
            row = nodes[level]
            reachable = expand(row['BuffIds'], buffs, passives, depth, tag_index)
            game = []
            non_stat = 0
            for bid in reachable:
                buff = buffs.get(bid)
                if not buff:
                    continue
                modifier = modifiers_of(buff, percent_attrs)
                if modifier is None:
                    non_stat += 1
                    continue
                game.append(modifier)
            tally['game non-stat buffs'] += non_stat

            node = next((n for n in resonator.get('resonanceChain') or [] if n.get('level') == level), None)
            if node is None:
                continue
            mine, unjudgeable = our_effects(node)
            tally['no attribute lane'] += len(unjudgeable)

            remaining = list(game)
            for stat, scope, value in mine:
                hit = next((g for g in remaining if g[0] == stat and g[1] == scope
                            and abs((g[2] or 0) - (value or 0)) < TOLERANCE), None)
                if hit:
                    remaining.remove(hit)
                    tally['matched'] += 1
                    continue
                near = next((g for g in remaining if g[0] == stat and g[1] == scope), None)
                if near:
                    remaining.remove(near)
                    tally['value mismatch'] += 1
                    lines.append('| %s S%s | `%s`%s | **%s** | %s |' % (
                        resonator['name'], level, stat, '' if scope is None else ' (%s)' % scope,
                        fmt(near[2]), fmt(value)))
                    continue
                tally['unmatched (ours)'] += 1
                lines.append('| %s S%s | `%s`%s | — | %s |' % (
                    resonator['name'], level, stat, '' if scope is None else ' (%s)' % scope, fmt(value)))
            for stat, scope, value in remaining:
                if stat.startswith('attr:'):
                    unmapped_attrs[stat] += 1
                    tally['unmapped attribute'] += 1
                    continue
                tally['missing'] += 1
                lines.append('| %s S%s | `%s`%s | %s | — |' % (
                    resonator['name'], level, stat, '' if scope is None else ' (%s)' % scope, fmt(value)))

    report = ['# Resonance-chain reconciliation',
              '',
              'Parsed effects vs the game\'s own `db_buff` rows, reached through',
              '`db_resonate_chain.BuffIds` (apply-buff links followed %d deep).' % depth,
              'Generated by `tools/extract/reconcile_effects.py`; changes no engine behaviour.',
              '',
              '| outcome | count |', '| --- | --- |']
    order = ['matched', 'value mismatch', 'missing', 'unmatched (ours)',
             'no attribute lane', 'unmapped attribute', 'game non-stat buffs']
    for key in order:
        report.append('| %s | %d |' % (key, tally[key]))
    judged = tally['matched'] + tally['value mismatch'] + tally['missing'] + tally['unmatched (ours)']
    if judged:
        report += ['', '**%d of %d judgeable modifiers agree (%.1f%%).**'
                   % (tally['matched'], judged, 100.0 * tally['matched'] / judged)]
    if unmapped_attrs:
        report += ['', 'Unmapped attributes (the game modifies these; we have no effect stat for them):', '']
        for attr, count in unmapped_attrs.most_common():
            report.append('- `%s` x%d' % (attr, count))
    report += ['', '## Disagreements', '',
               '| node | stat | game | ours |', '| --- | --- | --- | --- |'] + lines

    out = os.path.join(ROOT, 'docs', 'effect-reconciliation.md')
    with open(out, 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(report) + '\n')
    print('\n'.join(report[:20]))
    print('\nWrote', out, '(%d disagreements listed)' % len(lines))


def fmt(value):
    if value is None:
        return '—'
    return ('%.4f' % value).rstrip('0').rstrip('.')


if __name__ == '__main__':
    main()
