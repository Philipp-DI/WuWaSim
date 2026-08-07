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

# A buff states its own SCOPE as data, in two shapes, instead of as the English
# skill names `skill-scope.mjs` has to match:
#
#   type 1 SkillIds  — a PREFIX of our damage ids (maintainer's reading,
#     confirmed): Suisui's 1110010#1110022 prefix the hits behind
#     `skill_awakening_spring` and `intro`, which is her clause verbatim. Same
#     longest-prefix route map-timings.mjs uses, so the join is the codebase's own.
#   type 5 BulletIds — the game's own bullet ids, joined through
#     `data/bullet-timings.json` (`bulletDamageIds`, the montage→bullet→damage
#     chain) to a damage id and from there to a skill key. Hiyuki's +500% Crit.
#     DMG is scoped this way and this way only.
#
# The client checks both by EXACT membership (`ExtraEffectLibrary.js`:
# `t.SkillIds.includes(BigInt(e.SkillId))`, `t.BulletIds.includes(e.BulletId)`).
REQUIREMENT_SKILL_IDS = 1
REQUIREMENT_BULLET_IDS = 5
SCOPE_REQUIREMENTS = (REQUIREMENT_SKILL_IDS, REQUIREMENT_BULLET_IDS)

# `ExtraEffectReqSetting` is the client's `RequireAndLimits.CheckType`: 0 means
# EVERY requirement must hold, 1 means ANY ONE of them does. It decides whether a
# pair of scope lists intersects or unions — and, when an ANY-combined buff also
# carries a requirement that is not a scope at all, whether the list is a scope
# in the first place. Ciaccona's 1407000060 fires on four named skills OR on
# DamageType 2; taken as a scope, that would have silenced the whole DamageType
# branch.
CHECK_ANY = 1

# The coarse stat FAMILY a modifier belongs to. Scope is keyed by it as well as
# by value, because a value alone collides: Hiyuki has a +500% Crit. DMG on two
# Liberations (scoped by BulletIds, which we cannot map) and a separate 500%
# amplify on two Resonance Skills (scoped by SkillIds, which we can). Keyed on
# value alone, the crit clause inherited the amplify's scope and pointed at the
# wrong two skills entirely.
def family_of(attr):
    if attr == 8:
        return 'critRate'
    if attr == 9:
        return 'critDmg'
    if attr is None or attr in ADDITIVE_ATTRS or attr == DAMAGE_REDUCE_ATTR:
        return 'damage'
    return 'other'


def resolve_skill_ids(raw, owner, hit_map, _bullets):
    """Game skill ids → our skill keys, by prefix over hit-map.json."""
    keys = set()
    for chunk in str(raw or '').split('#'):
        if not chunk.isdigit():
            continue
        for key, hit_ids in (hit_map.get(str(owner)) or {}).items():
            if any(str(hit_id).startswith(chunk) for hit_id in hit_ids or []):
                keys.add(key)
    return keys


def resolve_bullet_ids(raw, owner, hit_map, bullets):
    """Game bullet ids → our skill keys, through the bullet's own damage ids.

    A bullet id is matched EXACTLY, not by prefix: it is already the most
    specific id the game has, and `bulletDamageIds` carries the redirects
    (a bullet that spawns child bullets reports their damage ids too).
    """
    keys = set()
    for chunk in str(raw or '').split('#'):
        if not chunk.isdigit():
            continue
        for damage_id in bullets.get(chunk) or [chunk]:
            for key, hit_ids in (hit_map.get(str(owner)) or {}).items():
                if any(str(hit_id) == str(damage_id) for hit_id in hit_ids or []):
                    keys.add(key)
    return keys


RESOLVERS = {REQUIREMENT_SKILL_IDS: resolve_skill_ids, REQUIREMENT_BULLET_IDS: resolve_bullet_ids}


def scope_of(buff, owner, hit_map, bullets):
    """The skill keys a buff scopes itself to, or [] when it names none.

    `ExtraEffectReqPara` is indexed by the requirement's own POSITION — the
    client loops `for ([index, type] of Requirements.entries())` and reads
    `RequirementPara[index]`. Reading para[0] unconditionally mis-read 16 buffs
    whose skill list sits behind an element or buff-stack gate, and skipped the
    scope those buffs actually state.
    """
    requirements = [int(r) for r in (buff.get('ExtraEffectRequirements') or []) if str(r).isdigit()]
    paras = buff.get('ExtraEffectReqPara') or []
    if not any(requirement in SCOPE_REQUIREMENTS for requirement in requirements):
        return []
    any_check = buff.get('ExtraEffectReqSetting') == CHECK_ANY
    if any_check and any(requirement not in SCOPE_REQUIREMENTS for requirement in requirements):
        return []                        # fires outside the list too — not a scope

    resolved = []
    for index, requirement in enumerate(requirements):
        if requirement not in SCOPE_REQUIREMENTS or index >= len(paras):
            continue
        resolved.append(RESOLVERS[requirement](paras[index], owner, hit_map, bullets))
    if not resolved:
        return []
    # ANY means either list admits the hit; ALL means both must, so the scope is
    # what they agree on. An unmappable list intersects to nothing, which is the
    # safe answer rather than a scope that is too wide.
    keys = set.union(*resolved) if any_check else set.intersection(*resolved)
    return sorted(keys)


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

    hit_map = json.load(open(os.path.join(ROOT, 'data', 'hit-map.json'), encoding='utf-8'))['map']
    bullets = json.load(open(os.path.join(ROOT, 'data', 'bullet-timings.json'),
                             encoding='utf-8'))['bulletDamageIds']

    seen = defaultdict(set)      # (owner, value) → {buckets}
    scopes = defaultdict(set)      # (owner, family, value) → {tuple of keys}
    unscoped = set()               # (owner, family, value) seen WITHOUT a scope
    for buff in buffs:
        prefix = str(int(buff['Id']))[:4]
        if not prefix.isdigit() or int(prefix) not in owners:
            continue
        # SCOPE is collected for every buff that carries a value, not only for
        # the ones with a damage-increase bucket: a Crit. DMG buff has no bucket
        # to correct but very much has a scope, and Suisui's +500% is exactly
        # that case.
        any_value = attr_and_value(buff)
        if any_value and any_value[1]:
            keys = scope_of(buff, int(prefix), hit_map, bullets)
            family = family_of(any_value[0])
            slot = (int(prefix), family, round(abs(any_value[1]), 6))
            if keys:
                # One ENTRY per buff, not a union. Two buffs of one owner can
                # share a value and scope to different skills — Hiyuki has a
                # +500% Crit. DMG on two Liberations and a separate 500% amplify
                # on two Resonance Skills. Unioning them invented a scope that
                # matched neither, which is worse than having none.
                scopes[slot].add(tuple(keys))
            else:
                # A buff at the same value that scopes to NOTHING is just as
                # disqualifying as two that disagree: Jinhsi's "gains 20% Spectro
                # DMG Bonus" is global, and borrowing the scope of an unrelated
                # 20% buff narrowed it to two Forte keys and cost her 6%.
                unscoped.add(slot)

        read = bucket_of(buff)
        if not read:
            continue
        bucket, value = read
        if value <= 0:
            continue
        seen[(int(prefix), round(value, 6))].add(bucket)

    facts, ambiguous, ambiguous_scopes = {}, 0, 0
    scope_keys = {(owner, value) for owner, _family, value in scopes}
    for owner, value in sorted(set(seen) | scope_keys):
        buckets = seen.get((owner, value), set())
        if len(buckets) > 1:
            ambiguous += 1
            continue
        entry = {}
        if buckets:
            entry['bucket'] = next(iter(buckets))
        for family in ('critRate', 'critDmg', 'damage', 'other'):
            slot = (owner, family, value)
            candidates = set() if slot in unscoped else scopes.get(slot, set())
            if slot in unscoped and scopes.get(slot):
                ambiguous_scopes += 1
            if len(candidates) == 1:
                entry.setdefault('scopeByFamily', {})[family] = sorted(next(iter(candidates)))
            elif len(candidates) > 1:
                ambiguous_scopes += 1
        if entry:
            facts.setdefault(str(owner), {})[('%.6f' % value).rstrip('0').rstrip('.')] = entry

    out = {
        '_doc': ('Per resonator, the BUCKET the game puts a damage-increase value in: '
                 '"additive" (Proto_DamageChange + element + attack-type bonus, one '
                 '(1 + sum) factor) or "amplify" (Proto_SpecialDamageChange, and the '
                 'target-side negative DamageReduce, both separate multiplicative '
                 'factors) — per CharacterDamageCalculations.js. Keyed '
                 'facts.<resonatorId>.<value> -> {bucket, skillKeys?}, where '
                 'scopeByFamily maps a stat family (critRate/critDmg/damage/other) to the '
                 'skill keys the buff states as data: ExtraEffectRequirements type 1 '
                 '(SkillIds, by prefix against data/hit-map.json) and type 5 (BulletIds, '
                 'through data/bullet-timings.json to a damage id). ExtraEffectReqPara is '
                 'read at the requirement\'s own index, and ExtraEffectReqSetting decides '
                 'union (ANY) vs intersection (ALL). The family is part of the key because a '
                 'value alone collides between unrelated buffs of one owner. A value that appears under '
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
    bucketed = sum(1 for v in facts.values() for b in v.values() if b.get('bucket'))
    additive = sum(1 for v in facts.values() for b in v.values() if b.get('bucket') == ADDITIVE)
    scoped = sum(1 for v in facts.values() for b in v.values() if b.get('scopeByFamily'))
    print('resonators with facts: %d' % len(facts))
    print('values: %d  (bucketed %d — additive %d, amplify %d)' % (total, bucketed, additive, bucketed - additive))
    print('values carrying a skill-id scope: %d' % scoped)
    print('dropped as ambiguous: %d bucket, %d scope' % (ambiguous, ambiguous_scopes))
    print('Wrote', destination)


if __name__ == '__main__':
    main()
