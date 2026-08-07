"""Extract, per resonator, which BUCKET the game puts each buff value in.

The engine's damage formula has the right SHAPE; what it gets wrong is which
bucket a value lands in, and that is not recoverable from kit text. The client's
own `CharacterDamageCalculations.js` settles the shape:

    t = 1 + Proto_DamageChange/10000 + elementBonus + attackTypeBonus   ← ADDITIVE
    damage = base * crit * defMult * t * resMult
                  * (1 - Proto_DamageReduce/10000)          ← multiplicative
                  * (1 + Proto_SpecialDamageChange/10000)   ← multiplicative
                  * …

So `DamageChange` (attribute 15) is summed with the element and attack-type
bonuses inside ONE `(1 + …)` factor, while `SpecialDamageChange` and
`DamageReduce` are separate multiplicative factors. Our `dmgBonus` bucket is the
first; our `amplify` bucket is the second.

The assignment cannot be read off the sentence, because the game does not decide
it that way — the SAME English lands in different lanes for different kits:

    Sigrika    "targets take 30% more DMG"  → ExtraEffectID 37, multiplicative
    Cartethyia "take 30% more DMG"          → attribute 15, ADDITIVE
    Yinlin     "deal 70% more DMG"          → attribute 15, ADDITIVE

`tools/preprocess/buff-facts.mjs` reads this file and moves a parsed effect into
the bucket the game uses, falling back to the text-derived bucket whenever this
file cannot answer confidently.

THE JOIN, and why it refuses more than it accepts. A fact is keyed by
(resonatorId, value) — NOT by our stat name, since the stat name is part of what
is being corrected. A value that appears under two different buckets for the
same resonator is AMBIGUOUS and is dropped: binding it would be a coin flip.
Values are rounded to 6 places, and only the damage-increase buckets are
emitted; a Crit Rate or ATK buff has only one lane and needs no correction.

Output: data/buff-facts.json (committed, like data/status-damage.json).

    python tools/extract/extract_buff_facts.py <fmodel-export-root>
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from configdb import ConfigDB    # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Attributes that live in the ADDITIVE (1 + …) factor, per the formula above.
ADDITIVE_ATTRS = {15, 14, 17, 18, 19, 20, 114} | set(range(21, 28))
# The target's own damage reduction — a separate multiplicative factor. A
# NEGATIVE magnitude here is how the game writes "targets take N% more DMG",
# and it composes exactly like our `amplify`, so the two are one bucket for us.
DAMAGE_REDUCE_ATTR = 16
# ExtraEffectIDs whose value is the multiplicative SpecialDamageChange lane.
AMPLIFY_EFFECTS = {37, 38}
SNAPSHOT_MODIFY = 1

ADDITIVE, AMPLIFY = 'additive', 'amplify'


def attr_and_value(buff):
    """(attribute, value, isTargetSide) for a buff's damage modifier, or None."""
    attr = buff.get('GameAttributeID')
    if attr:
        magnitudes = buff.get('ModifierMagnitude') or []
        if not magnitudes:
            return None
        return attr, magnitudes[0] / 10000.0, False
    grow = buff.get('ExtraEffectParametersGrow1') or []
    if not grow or not grow[0]:
        return None
    effect = buff.get('ExtraEffectID')
    if effect in AMPLIFY_EFFECTS:
        return None, grow[0] / 10000.0, False
    if effect == SNAPSHOT_MODIFY:
        params = buff.get('ExtraEffectParameters') or []
        if len(params) < 2 or not str(params[1]).isdigit():
            return None
        return int(params[1]), grow[0] / 10000.0, str(params[0]) == '1'
    return None


def bucket_of(buff):
    """ADDITIVE / AMPLIFY for a buff's damage modifier, or None if it is neither."""
    read = attr_and_value(buff)
    if not read:
        return None
    attr, value, target_side = read
    if attr is None:                      # ExtraEffectID 37/38 — SpecialDamageChange
        return AMPLIFY, value
    if attr == DAMAGE_REDUCE_ATTR and target_side:
        # Negative reduction on the target = "takes N% more DMG". Multiplicative,
        # same composition as amplify, so report the magnitude as positive.
        return (AMPLIFY, -value) if value < 0 else None
    if attr in ADDITIVE_ATTRS:
        return ADDITIVE, value
    return None


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    db = ConfigDB(sys.argv[1])
    buffs = db.read('db_buff', 'Buff')
    dataset = json.load(open(os.path.join(ROOT, 'data', 'wuwa-data.json'), encoding='utf-8'))
    owners = {resonator['id'] for resonator in dataset['resonators']}

    seen = defaultdict(set)      # (owner, value) → {buckets}
    for buff in buffs:
        prefix = str(int(buff['Id']))[:4]
        if not prefix.isdigit() or int(prefix) not in owners:
            continue
        read = bucket_of(buff)
        if not read:
            continue
        bucket, value = read
        if value <= 0:
            continue
        seen[(int(prefix), round(value, 6))].add(bucket)

    facts, ambiguous = {}, 0
    for (owner, value), buckets in sorted(seen.items()):
        if len(buckets) != 1:
            ambiguous += 1
            continue
        facts.setdefault(str(owner), {})[('%.6f' % value).rstrip('0').rstrip('.')] = next(iter(buckets))

    out = {
        '_doc': ('Per resonator, the BUCKET the game puts a damage-increase value in: '
                 '"additive" (Proto_DamageChange + element + attack-type bonus, one '
                 '(1 + sum) factor) or "amplify" (Proto_SpecialDamageChange, and the '
                 'target-side negative DamageReduce, both separate multiplicative '
                 'factors) — per CharacterDamageCalculations.js. Keyed '
                 'facts.<resonatorId>.<value> -> bucket. A value that appears under '
                 'BOTH buckets for one resonator is omitted as ambiguous rather than '
                 'guessed. Generated by tools/extract/extract_buff_facts.py; do not '
                 'hand-edit.'),
        'facts': facts,
    }
    destination = os.path.join(ROOT, 'data', 'buff-facts.json')
    with open(destination, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, indent=1, ensure_ascii=False)
        handle.write('\n')
    total = sum(len(v) for v in facts.values())
    additive = sum(1 for v in facts.values() for b in v.values() if b == ADDITIVE)
    print('resonators with facts: %d' % len(facts))
    print('values: %d  (additive %d, amplify %d)' % (total, additive, total - additive))
    print('dropped as ambiguous: %d' % ambiguous)
    print('Wrote', destination)


if __name__ == '__main__':
    main()
