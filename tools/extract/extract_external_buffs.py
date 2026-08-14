"""Extract EXTERNAL buff grants — weapons first — from the game's own tables.

"External" means everything that buffs a resonator without being part of that
resonator's own kit: weapon passives, sonata (echo set) bonuses, echo skills.
Today the engine derives all three by parsing English tooltips, and that fails
in ways the text cannot reveal:

  * a value written BEFORE its stat ("gain 25% Fusion DMG Bonus") is unread,
    because the readers only match "+N%" / "by N%" — silently, with no diff;
  * a tier stating TWO grants can only carry one, so the second is dropped and
    the first can inherit the other's trigger;
  * a stat the reader cannot classify is applied as a FLAT whole-step
    multiplier, which is right only when the wielder is mono-element.

None of that is necessary. The game states every grant as data, one row per
grant, with its own attribute id, magnitude, duration and trigger:

    WeaponConf.ItemId
      -> ResonId
      -> WeaponReson(Level = refinement 1..5).Effect[]     ← buff ids
      -> db_buff
           GameAttributeID + ModifierMagnitude             ← a direct grant
           ExtraEffectID 1  (CommonSnapshotModify)         ← attribute in params
           ExtraEffectID 35 (AddPassiveSkill) -> db_PassiveSkill.SkillActionParams
           ExtraEffectID 2  (AddBuffTrigger)  -> chained buff ids

`data/extra-effects.json` names those ExtraEffectIDs; `Protocol.js` names the
attribute ids. Both come from the client, so nothing here is guessed.

WHY THE WALK DEDUPES BY BUFF ID. A weapon commonly reaches one grant from
SEVERAL trigger paths — Everbright Polestar's DEF-ignore and RES-shred are each
added by two passives, one listening for Tune Rupture - Shifting and one for
Fusion Burst. They are the same 8-second buff, not two. Emitting per path would
double every such grant, which is the one failure mode worse than dropping it:
inflation looks like nothing is wrong.

WHAT THIS DOES NOT COVER. A weapon's UNCONDITIONAL leading sentence ("ATK is
increased by 12%", "Increases All-Attribute DMG Bonus by 12%") is NOT in
ConfigDB. Verified exhaustively, not assumed: it is absent from the buff chain,
from the rank tags the chain grants, and from WeaponConf's own FirstPropId /
SecondPropId (those are base ATK and the secondary stat — {Id:7} and {Id:8}) —
and 0 of 127 rank-1 WeaponReson rows carry a permanent attribute buff at all.
It most likely lives in the ability blueprints. So the leading stat keeps its
existing reader (`weaponPassiveStats`), which is reliable precisely because that
clause is always first and always unconditional; this file owns the CONDITIONAL
grants, which is where the text reader actually fails.

    python tools/extract/extract_external_buffs.py <fmodel-export-root>

Output: data/external-buffs.json (committed, like data/status-damage.json).
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from configdb import ConfigDB    # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ExtraEffectID meanings (data/extra-effects.json — the client's own enum).
SNAPSHOT_MODIFY = 1      # CommonSnapshotModify: attribute id sits in the params
ADD_BUFF_TRIGGER = 2     # AddBuffTrigger: chains to further buff ids
ADD_PASSIVE_SKILL = 35   # AddPassiveSkill: routes through db_PassiveSkill
# DamageAmplifyOnHit / OnBeHit — the MULTIPLICATIVE lane. These carry no
# GameAttributeID at all; the magnitude is in ExtraEffectParametersGrow1. They
# compose exactly like Proto_SpecialDamageChange (95), which is the attribute the
# engine already routes to its `amplify` bucket, so they are emitted under 95.
AMPLIFY_EFFECTS = (37, 38)
SPECIAL_DAMAGE_CHANGE = 95

# WHO RECEIVES A WEAPON PASSIVE'S GRANT — and why it takes BOTH fields.
#
# ~~TriggerPreset[0] says who the grant is for: '0' the wielder, '1' the whole
# team.~~ That read one half of a conjunction the original note had already
# observed ("…and they carry InstigatorType 'Attacker' where the self ones carry
# 'Owner'"). TriggerPreset is handed to the trigger as its own `Preset`
# (`CharacterPassiveSkillComponent` → `AddTrigger({Type, Preset, …})`), so its
# meaning is PER TRIGGER TYPE — it says who may FIRE the passive, never who
# receives what it grants. The recipient is `InstigatorType`, which the same
# component resolves the action's target from (`jxm(skillId, r.InstigatorType,
# …)`, stored as `TargetKey`): 'Owner' is the wielder, 'Attacker' is whoever
# caused the triggering event.
#
# A grant is therefore team-wide only when a TEAMMATE CAN FIRE IT *and* the
# recipient is the firer. Each half alone is wrong, and the game ships both
# counterexamples:
#   preset 1 + Owner    — Phasic Homogenizer, Boson Astrolabe: "After a Resonator
#                         in the team casts a Tune Break skill, it grants …
#                         TO THE WIELDER." The trigger is team-wide; the buff is
#                         not. This is the "a trigger's scope is not the effect's
#                         scope" invariant, in the weapon lane.
#   preset 0 + Attacker — Spectrum Blaster: only the owner can fire it, so
#                         "whoever fired it" IS the owner. Self.
# Both together leave Kumokiri and Forged Dwarf Star, whose tooltips are the
# only two that say "Resonators in the team".
TEAM_TRIGGER_FLAG = '1'
INSTIGATOR_TRIGGERING_ENTITY = 'Attacker'

# `FormationPolicy` is an ENUM, not a flag, and the client branches on each value
# in a different component. Two of them mean "the whole team gets this":
#
#   1  RoleBuffComponent.ShareApplyBuffInner — `1 === e.Config?.FormationPolicy`
#      walks `SceneTeamModel.GetTeamEntities()` and calls `AddBuffLocal` on every
#      member that is not the holder. The holder keeps their own copy, the others
#      receive one. Rejuvenating Glow's ATK buff is this, and its passive is
#      described 声骸套装-触发治疗时给队友加攻击力 — "echo set: on healing, give
#      TEAMMATES ATK".
#   5  RoleBuffComponent.AddBuffInner — `5 === t.FormationPolicy` routes the add
#      to `GetFormationBuffComp()` (component 216) INSTEAD of the character's own
#      buff component, so the buff is held by the FORMATION. Every read of it in
#      the file pairs with the same branch (RemoveBuffLocal, RemoveBuffOrder,
#      GetBuffApplyTarget), so this is a whole-team buff by construction.
#
# 2 and 3 are NOT team-wide: `RoleInheritComponent.StateInherit` re-adds those to
# the INCOMING role on a swap (3 also removes the outgoing copy) — the swap
# inheritance lane, which the engine models separately as `recipient: 'incoming'`.
#
# WHY THIS MATTERS. Accepting only 1 read exactly ONE of the sixteen team-wide
# sonata grants; the other fifteen are policy 5. With the flag missing, the
# engine fell back to a per-TIER text check, and a tier that grants one thing to
# the team and another to the caster ("Casting Resonance Liberation grants all
# Resonators in the team 15% Fusion DMG Bonus and THE CASTER 20% Resonance
# Liberation DMG Bonus" — Flaming Clawprint) handed both halves to everyone.
FORMATION_TEAM_POLICIES = (1, 5)
# Swap inheritance, listed so a future reader does not mistake them for team-wide.
FORMATION_INHERIT_ON_SWAP = (2, 3)

# `AddBuffTrigger` parameters, from the client's own InitParameters:
#   [EventType, TargetType, '#'-joined BuffIds, InstigatorType?]
# TargetType is the RECIPIENT (ExtraEffectPassiveEffects.GetTargetByType):
#   0 Owner, 1 Opponent, 2 Instigator, 3 the buff holder's skill target.
# TargetType 0 is the wielder. TargetType 1 is `OpponentBuffComponent`, which is
# NOT "the enemy" — `BuffEffectBase.Check` sets `OpponentEntityId` from whichever
# entity the firing event supplies, so "opponent" means COUNTERPARTY OF THIS
# EVENT and nothing more.
ADD_BUFF_TRIGGER_TARGET_OWNER = 0
ADD_BUFF_TRIGGER_TARGET_OPPONENT = 1
# TargetType 2 is `InstigatorBuffComponent` — whoever CAUSED the buff. For a
# gear grant fired by the wielder's own action that is the wielder, so it is
# treated as self. The one case in the data confirms it from three directions:
# Crown of Valor's 3-piece sits behind EventType 7 (shield gained), which
# `CharacterShieldComponent` fires as `this.m1t.TriggerEvents(7, this.m1t, {})` —
# passing its OWN buff component, so the instigator of a self-applied shield is
# that same character; its `ExtraEffectCD 0.5` and `StackLimitCount 5` match the
# tooltip's "once every 0.5s" and "stacks up to 5 times"; and its sibling
# `31000020001` reaches the same character through TargetType 0.
ADD_BUFF_TRIGGER_TARGET_INSTIGATOR = 2
SELF_TARGET_TYPES = (ADD_BUFF_TRIGGER_TARGET_OWNER, ADD_BUFF_TRIGGER_TARGET_INSTIGATOR)

# EventType is the key `BaseBuffComponent.TriggerEvents(type, entity, ctx)` fires
# on, and the entity it passes becomes that counterparty. Event 10 is raised by
# `RoleElementComponent.TriggerEvents`, whose caller is `RoleQteComponent` — the
# QTE being the Outro -> Intro handoff:
#
#     this.m1t.TriggerEvents(10, t.m1t, e);   // on the OUTGOING role,
#     t.m1t.TriggerEvents(13, this.m1t, e);   // passing the INCOMING one
#
# So on event 10 the "opponent" is the resonator swapping IN. A TargetType-1
# grant behind it is the incoming-resonator transfer the tooltips describe
# ("casting an Outro Skill grants the incoming Resonator …"), which the engine
# already models as its own lane (incomingResonatorContribution).
EVENT_ROLE_SWAP_OUTGOING = 10

# Requirement kinds (data/extra-effects.json `requirement`) that ARE a damage
# scope. DamageTypes carries the same 0..5 tag as `skill.damage[*].type`:
# 0 basic, 1 heavy, 2 liberation, 3 intro, 4 skill, 5 echo.
REQUIREMENT_DAMAGE_TYPES = 12
REQUIREMENT_ELEMENT_TYPES = 7
# ExtraEffectReqSetting: 0 = every requirement must hold, 1 = any one does.
CHECK_ANY = 1

# A grant with no duration row is permanent for as long as its source holds.
PERMANENT = None

# `CalculationPolicy[0]` says HOW to read `ModifierMagnitude`, and only two of
# its modes yield a flat value (CLAUDE.md, the gauge-income invariant):
#   0  flat add                     1  scale base
#   2/4/9  a FRACTION OF policy[1]  3  override
# A 2/4/9 row is a coefficient in a runtime formula, not a percentage. Halo of
# Starry Radiance is the worked example: "every 1% of Off-Tune Buildup Rate
# grants a 0.2% ATK increase … up to 25%" ships as magnitude 200000 under
# `[2, 141, 1, 1, 0, 0, 100, 2500]` — the 100 is the per-unit divisor and the
# 2500 the 25% cap. Read as a flat fraction that is +2000% ATK, which is exactly
# what it did to the team page before this guard existed.
FLAT_CALCULATION_POLICIES = (0, 1)


def attribute_names(export_root):
    """id -> Proto_* name, read from the client's own attribute enum.

    Protocol.js holds SEVERAL enums whose members are named Proto_*, and they
    overlap on the low ids — a window centred on the damage attributes picks up a
    logging enum for everything under 13 and reports attribute 7 as
    `Proto_LogType_SecWorldInfoFlow_Start` instead of `Proto_Atk`. So the block
    is anchored on its own first member, which is unique in the file, and read
    strictly FORWARD from there.

    The ids this yields are the same ones `src/core/stats.js` PROP already uses —
    7 Atk, 8 Crit, 9 CritDamage, 11 EnergyEfficiency, 35 HealChange, 21..27 the
    element DMG bonuses. That is not a coincidence to rely on silently, so
    `tests/external-buffs.test.mjs` asserts it.
    """
    path = os.path.join(export_root, 'Content', 'Aki', 'JavaScript', 'Core',
                        'Define', 'Net', 'Protocol.js')
    with open(path, encoding='utf-8', errors='replace') as handle:
        source = handle.read()
    start = source.index('e[0]="Proto_EAttributeType_None"')
    window = source[start:start + 40000]
    names = {}
    for number, name in re.findall(r'e\[(\d+)\]="(Proto_\w+)"\]=\1\b', window):
        names.setdefault(int(number), name)
    if names.get(7) != 'Proto_Atk' or names.get(99) != 'Proto_IgnoreDefRate':
        raise SystemExit('attribute enum did not parse as expected — '
                         f'7={names.get(7)!r} 99={names.get(99)!r}')
    return names


def _ids_from(value):
    """Buff/skill ids as the tables write them.

    Three encodings appear and all three must be handled or the walk silently
    finds nothing: FlatBuffers vectors decode as FLOATS (110046101.0), passive
    skill actions store ids as STRINGS, and several fields pack more than one id
    into a '#'-joined string.
    """
    out = []
    for item in (value if isinstance(value, list) else [value]):
        if isinstance(item, (int, float)):
            if item:
                out.append(int(item))
            continue
        for part in str(item).split('#'):
            part = part.strip()
            if part.isdigit():
                out.append(int(part))
    return out


class Resolver:
    """Walks a buff id down to the attribute grants it ultimately applies."""

    def __init__(self, buffs, passives):
        self.buffs = buffs
        self.passives = passives

    def grants(self, root_ids):
        """Every distinct attribute grant reachable from these buff ids.

        Keyed by (buff id, teamWide) so a grant reached by several trigger paths
        is counted ONCE — see the module docstring — while still allowing the
        rare buff that is genuinely handed out both to the wielder and to the
        team to appear as both.

        The team flag propagates DOWN the walk: it is a property of the passive
        that hands the buff out, not of the buff row itself. Kumokiri's
        Liberation stack is reached through a preset-'0' passive and its
        all-element bonus through preset-'1' ones, which is exactly the
        self/team split its tooltip describes.
        """
        found = {}
        seen = set()
        self.recipient_of = {}
        self.trigger_of = {}
        stack = [(buff_id, False) for buff_id in root_ids]
        while stack:
            buff_id, team_wide = stack.pop()
            if (buff_id, team_wide) in seen:
                continue
            seen.add((buff_id, team_wide))
            row = self.buffs.get(buff_id)
            if row is None:
                continue

            grant = self._grant_of(row)
            if grant is not None:
                found[(buff_id, team_wide)] = dict(
                    grant,
                    teamWide=team_wide or row.get('FormationPolicy') in FORMATION_TEAM_POLICIES,
                )

            effect = row.get('ExtraEffectID')
            params = row.get('ExtraEffectParameters') or []
            if effect == ADD_PASSIVE_SKILL:
                for passive_id in _ids_from(params):
                    for passive in self.passives.get(passive_id, []):
                        if passive.get('SkillAction') != 'AddBuff':
                            continue
                        preset = passive.get('TriggerPreset') or []
                        to_team = team_wide or (
                            bool(preset) and str(preset[0]) == TEAM_TRIGGER_FLAG
                            and passive.get('InstigatorType') == INSTIGATOR_TRIGGERING_ENTITY)
                        for next_id in _ids_from(passive.get('SkillActionParams') or []):
                            stack.append((next_id, to_team))
                            # Remember WHAT fires this grant. The text can only
                            # offer the tier's casts, and a tier with two clauses
                            # offers the wrong one — Chromatic Foam's self buff
                            # fires on inflicting Fusion Burst, but its sentence
                            # also names an Outro Skill for the OTHER clause.
                            self.trigger_of.setdefault(next_id, passive.get('TriggerType'))
            elif effect == ADD_BUFF_TRIGGER and len(params) >= 3:
                # [EventType, TargetType, BuffIds, InstigatorType?] — the client's
                # own parameter order. A chain that hands the buff to anyone but
                # the Owner is followed but MARKED, so the caller can refuse to
                # credit it to the wielder.
                as_int = lambda text: int(text) if str(text).lstrip('-').isdigit() else None
                event_type, target_type = as_int(params[0]), as_int(params[1])
                if target_type == ADD_BUFF_TRIGGER_TARGET_OPPONENT and \
                        event_type == EVENT_ROLE_SWAP_OUTGOING:
                    recipient = 'incoming'
                elif target_type in SELF_TARGET_TYPES:
                    recipient = None
                else:
                    recipient = 'other'
                for next_id in _ids_from(params[2]):
                    stack.append((next_id, team_wide))
                    if recipient:
                        self.recipient_of[next_id] = recipient
        return found

    @staticmethod
    def _scope_of(row):
        """The SCOPE the buff states as data, or None when it states none.

        `ExtraEffectRequirements` is a list of requirement TYPES and
        `ExtraEffectReqPara` holds one parameter per requirement AT THE SAME
        INDEX (the client loops the requirements and reads `para[index]` —
        CLAUDE.md records this; reading `para[0]` unconditionally mis-reads any
        buff whose scope sits behind another requirement).

        Only the requirement kinds that are genuinely a damage scope are read:
          12 DamageTypes  — the game's own type tag, the same 0..5 that
                            `skill.damage[*].type` carries (2 = Liberation).
          7  ElementTypes — element ids.
        Everything else (IsCritical, WeaponTypes, part/bullet tags …) is a firing
        CONDITION rather than a scope and is deliberately not turned into one.

        `ExtraEffectReqSetting` 1 means ANY requirement suffices, so the listed
        types are not a restriction the effect always obeys — under ANY a scope
        list cannot be treated as a scope at all, and is dropped.
        """
        requirements = row.get('ExtraEffectRequirements') or []
        paras = row.get('ExtraEffectReqPara') or []
        if not requirements:
            return None
        if row.get('ExtraEffectReqSetting') == CHECK_ANY:
            return None
        scope = {}
        for index, requirement in enumerate(requirements):
            para = paras[index] if index < len(paras) else None
            values = [int(p) for p in str(para).split('#') if str(p).strip().isdigit()]
            if not values:
                continue
            if int(requirement) == REQUIREMENT_DAMAGE_TYPES:
                scope.setdefault('damageTypes', []).extend(values)
            elif int(requirement) == REQUIREMENT_ELEMENT_TYPES:
                scope.setdefault('elementTypes', []).extend(values)
        return scope or None

    @staticmethod
    def _grant_of(row):
        """The attribute this buff changes, or None if it changes no attribute.

        Two shapes carry a value. A direct `GameAttributeID` states it in
        `ModifierMagnitude`; `CommonSnapshotModify` states the attribute id in
        parameter 1 and the value in `ExtraEffectParametersGrow1`. Magnitudes are
        the game's 1e4 fixed point throughout.
        """
        duration = (row.get('DurationMagnitude') or [None])[0]
        base = {
            'durationSeconds': duration if duration and duration > 0 else PERMANENT,
            'stackLimit': int(row.get('StackLimitCount') or 1),
            'scope': Resolver._scope_of(row),
        }

        attribute = row.get('GameAttributeID')
        if attribute:
            magnitudes = row.get('ModifierMagnitude') or []
            if not magnitudes:
                return None
            # Refuse anything whose magnitude is not a flat value — see
            # FLAT_CALCULATION_POLICIES. Dropping it understates; reading it
            # inflates by orders of magnitude.
            policy = row.get('CalculationPolicy') or []
            if policy and int(policy[0]) not in FLAT_CALCULATION_POLICIES:
                return dict(base, attribute=int(attribute),
                            value=round(magnitudes[0] / 10000.0, 6),
                            derived=True, calculationPolicy=[int(p) for p in policy])
            return dict(base, attribute=int(attribute),
                        value=round(magnitudes[0] / 10000.0, 6))

        effect = row.get('ExtraEffectID')
        grow = row.get('ExtraEffectParametersGrow1') or []

        if effect == SNAPSHOT_MODIFY:
            params = row.get('ExtraEffectParameters') or []
            if len(params) > 1 and str(params[1]).isdigit() and grow:
                return dict(base, attribute=int(params[1]),
                            value=round(grow[0] / 10000.0, 6))

        # The multiplicative lane states no attribute; its magnitude is the grow
        # parameter alone. Emitted as Proto_SpecialDamageChange so it routes to
        # the engine's `amplify` bucket like every other multiplicative value,
        # with the originating effect id kept for traceability.
        if effect in AMPLIFY_EFFECTS and grow and grow[0]:
            return dict(base, attribute=SPECIAL_DAMAGE_CHANGE,
                        value=round(grow[0] / 10000.0, 6), extraEffectId=int(effect))
        return None


def extract_weapons(db, resolver, names):
    weapons = db.read('db_weapon', 'WeaponConf', table='weaponconf',
                      fields=['ItemId', 'ResonId'])
    resons = db.read('db_weapon', 'WeaponReson', table='weaponreson',
                     fields=['ResonId', 'Level', 'Effect'])
    by_reson = {}
    for row in resons:
        by_reson.setdefault(int(row.get('ResonId') or 0), []).append(row)

    out = {}
    for weapon in weapons:
        item_id = int(weapon.get('ItemId') or 0)
        reson_id = int(weapon.get('ResonId') or 0)
        if not item_id or reson_id not in by_reson:
            continue
        ranks = {}
        for row in sorted(by_reson[reson_id], key=lambda r: r.get('Level') or 0):
            level = int(row.get('Level') or 0)
            if not level:
                continue
            grants = resolver.grants(_ids_from(row.get('Effect') or []))
            if not grants:
                continue
            ranks[str(level)] = [
                dict(grant, buffId=buff_id, attributeName=names.get(grant['attribute']))
                for (buff_id, _team), grant in sorted(grants.items())
            ]
        if ranks:
            out[str(item_id)] = {'resonId': reson_id, 'ranks': ranks}
    return out


def extract_sonatas(db, resolver, names):
    """Sonata (echo set) grants: PhantomFetter.BuffIds -> the same buff walk.

    THE JOIN. A fetter row names itself `PhantomFetter_<sonataId>_Name`, and its
    buff ids independently encode the same number (`31000027001` -> set 27).
    Both agree on all 64 rows, which is what makes the mapping trustworthy — one
    of them alone would be a convention, two agreeing is a join.

    PIECE COUNT. The row id carries it: sets 10+ use `sonataId*10 + pieces`
    (272 / 275), and sets 1-9 the older sequential pair (13 = 7's 2-piece,
    14 = its 5-piece). The result is checked against the tier's own
    `EffectDescriptionParam` further down rather than trusted.

    The 2-PIECE bonus is deliberately NOT taken from here. It lives in the
    fetter's `AddProp`, a nested table the accessor does not expose, and the
    dataset already carries it (`sonata.tiers[].addProp`) as a plain propId /
    value pair. Re-deriving it would be duplication, not correction.
    """
    fetters = db.read('db_phantom', 'PhantomFetter', table='phantomfetter',
                      fields=['Id', 'Name', 'BuffIds', 'EffectDescriptionParam'])
    out = {}
    for row in fetters:
        match = re.match(r'PhantomFetter_(\d+)_Name', str(row.get('Name') or ''))
        row_id = int(row.get('Id') or 0)
        if not match or not row_id:
            continue
        sonata_id = int(match.group(1))
        pieces = (row_id % 10) if row_id >= 100 else (2 if row_id % 2 else 5)
        buff_ids = _ids_from(row.get('BuffIds') or [])
        if not buff_ids:
            continue
        grants = resolver.grants(buff_ids)
        if not grants:
            continue
        entry = out.setdefault(str(sonata_id), {'tiers': {}})
        entry['tiers'][str(pieces)] = {
            'fetterId': row_id,
            'params': list(row.get('EffectDescriptionParam') or []),
            'grants': [
                dict(grant, buffId=buff_id, attributeName=names.get(grant['attribute']),
                     triggerType=resolver.trigger_of.get(buff_id),
                     **({'recipient': resolver.recipient_of[buff_id]}
                        if buff_id in resolver.recipient_of else {}))
                for (buff_id, _team), grant in sorted(grants.items())
            ],
        }
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    export_root = sys.argv[1]
    db = ConfigDB(export_root)
    names = attribute_names(export_root)

    buffs = {}
    for row in db.read('db_buff', 'Buff'):
        if row.get('Id') is not None:
            buffs[int(row['Id'])] = row
    passives = {}
    for row in db.read('db_PassiveSkill', 'PassiveSkill'):
        if row.get('Id') is not None:
            passives.setdefault(int(row['Id']), []).append(row)

    resolver = Resolver(buffs, passives)
    weapons = extract_weapons(db, resolver, names)
    sonatas = extract_sonatas(db, resolver, names)

    payload = {
        '_doc': ('External buff grants read from the game ConfigDB — see '
                 'tools/extract/extract_external_buffs.py. Values are fractions '
                 '(0.32 = 32%). `durationSeconds` null = lasts as long as its '
                 'source. A grant reachable from several trigger paths appears '
                 'ONCE, keyed by its buff id.'),
        'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'attributeNames': {str(k): v for k, v in sorted(names.items())},
        'weapons': weapons,
        'sonatas': sonatas,
    }
    destination = os.path.join(ROOT, 'data', 'external-buffs.json')
    with open(destination, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=1, ensure_ascii=False)
        handle.write('\n')

    grants = sum(len(rank) for w in weapons.values() for rank in w['ranks'].values())
    sonata_grants = sum(len(tier['grants']) for s in sonatas.values() for tier in s['tiers'].values())
    print(f'weapons with conditional grants: {len(weapons)}  (grants, all ranks: {grants})')
    print(f'sonatas with grants:             {len(sonatas)}  (grants: {sonata_grants})')
    print(f'wrote {os.path.relpath(destination, ROOT)}')


if __name__ == '__main__':
    main()
