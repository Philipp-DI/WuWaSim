"""Extract the game's ExtraEffect enum — the id → behaviour map for `db_buff`.

Every buff row carries an `ExtraEffectID`. It is the single most load-bearing
number in the buff table: it says what the buff DOES beyond its plain attribute
modifier, and everything the sim currently curates by hand — team-wide
distribution, amplify, stack-cap raises, gauge income — is one of these ids.

It never had to be guessed. The client ships the dispatch switch:

    Content/Aki/JavaScript/Game/NewWorld/Character/Common/Component/
        Abilities/ExtraEffect/ExtraEffectDefine.js

        function getBuffEffectClass(e){switch(e){
            case 9: return ExtraEffectDamageAugment_1.DamageAugment; …

with a second switch for EXECUTION effects (the ones that fire on a trigger
rather than persisting). This reads both and writes the pair out, so the rest of
the pipeline can name an id instead of matching a magic number.

Two things worth knowing about the classes it names, both read off their own
`InitParameters`:

  9  DamageAugment  — bonus damage computed from an ATTRIBUTE, not an amplify:
     `max(attrValue * rate + flat, 0)`, where the rate comes from
     `ExtraEffectParametersGrow1` and the flat from `Grow2` — NOT from the plain
     `ExtraEffectParameters`, which hold only the attribute id and whether to
     read its base or current value.
  12 DamageModifier — a snapshot ModifierCalculator; its parameters pack a
     reference attribute, target type and value type into one '#'-joined string.

Output: data/extra-effects.json (committed, like data/status-damage.json).

    python tools/extract/extract_extra_effects.py <fmodel-export-root>
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DEFINE = ('Content/Aki/JavaScript/Game/NewWorld/Character/Common/Component/'
          'Abilities/ExtraEffect/ExtraEffectDefine.js')

# Ids that ROUTE a buff onward — the edges of the grant graph. Anything reading
# "which buffs does this node ultimately apply" has to follow these, and a
# forward walk that follows only `ExecuteBulletOrBuff` (5) sees a fraction of
# the roster (measured: 16% of chain nodes reach any modifier that way).
ROUTING = {
    2:   'AddBuffTrigger',
    5:   'ExecuteBulletOrBuff',
    24:  'AddBuffToAdjacentRoleExecution',
    25:  'AddBuffOnChangeTeam',
    28:  'ExecuteAddBuffByStackCount',
    35:  'AddPassiveSkill',
    41:  'AddBuffToVision',
    53:  'BindBuffToTeam',
    58:  'PeriodAddBuffToAdjacentEntity',
    65:  'ConvertBuffToAnother',
    80:  'ExtraEffectBuffCopy',
    82:  'ExtraEffectBuffTransfer',
    90:  'ModifyTeamMemberBuff',
    106: 'BuffMapper',
    129: 'ReplaceBuffOnAddEffect',
}


BASE = ('Content/Aki/JavaScript/Game/NewWorld/Character/Common/Component/'
        'Abilities/ExtraEffect/ExtraEffectBase.js')


def switch_map(source, function_name):
    match = re.search(function_name + r'\(e\)\{switch\(e\)\{(.*?)\}\}', source, re.S)
    if not match:
        return {}
    return {int(num): cls for num, cls in re.findall(r'case (\d+):return \w+_1\.(\w+)', match.group(1))}


def requirement_map(source):
    """ExtraEffectRequirements type → the RequirementPayload field it checks.

    `ExtraEffectRequirements` + `ExtraEffectReqPara` are how a buff states WHEN
    and to WHAT it applies, and type 1 is the one that matters most here: an
    explicit list of SKILL IDS. That is the same scope `skill-scope.mjs` has to
    infer from English skill names, stated as data:

        Qiuyuan  1411800100  req [1] ['1411110#1411120#1411130']
                 → his three "Thus Spoke the Blade" heavies, by id
        Aemeath  1210066008  req [12] ['2']
                 → damage type 2, i.e. Resonance Liberation

    Both of those are modifiers on attribute 16 `DamageReduce` with a NEGATIVE
    magnitude applied to TargetType 1 (the target) — which is how the game says
    "targets take N% more DMG", and why neither value could be found while the
    search only looked for positive bonuses under the wielder.
    """
    match = re.search(r'switch\((?:\w+\.)?Type\)\{(.{0,2000}?)\}\}', source, re.S)
    if not match:
        return {}
    out = {}
    for num, body in re.findall(r'case (\d+):(.{0,90}?)(?=case \d+:|$)', match.group(1), re.S):
        field = re.search(r'(?:Payload|t)\.(\w+)', body)
        if field and int(num) not in out:
            out[int(num)] = field.group(1)
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    path = os.path.join(sys.argv[1], DEFINE)
    if not os.path.exists(path):
        raise SystemExit('No ExtraEffectDefine.js at ' + path)
    source = open(path, encoding='utf-8', errors='replace').read()

    base_path = os.path.join(sys.argv[1], BASE)
    requirements = requirement_map(
        open(base_path, encoding='utf-8', errors='replace').read()) if os.path.exists(base_path) else {}

    effects = switch_map(source, 'getBuffEffectClass')
    executions = switch_map(source, 'getBuffExecutionClass')
    overlap = set(effects) & set(executions)
    if overlap:
        raise SystemExit('id in both switches, the reader assumes disjoint: %s' % sorted(overlap))

    out = {
        '_doc': ('ExtraEffectID -> the client class that implements it, read from '
                 'getBuffEffectClass / getBuffExecutionClass in ' + DEFINE + '. '
                 '"effect" persists while the buff is held; "execution" fires on a '
                 'trigger. `routing` lists the ids that apply FURTHER buffs, i.e. '
                 'the edges of the grant graph. Generated by '
                 'tools/extract/extract_extra_effects.py; do not hand-edit.'),
        'effect': {str(k): v for k, v in sorted(effects.items())},
        'execution': {str(k): v for k, v in sorted(executions.items())},
        'routing': {str(k): v for k, v in sorted(ROUTING.items())},
        'requirement': {str(k): v for k, v in sorted(requirements.items())},
    }
    known = set(effects) | set(executions)
    unknown = sorted(set(ROUTING) - known)
    if unknown:
        raise SystemExit('routing ids absent from both switches: %s' % unknown)

    destination = os.path.join(ROOT, 'data', 'extra-effects.json')
    with open(destination, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, indent=1, ensure_ascii=False)
        handle.write('\n')
    print('effect classes:    %d' % len(effects))
    print('execution classes: %d' % len(executions))
    print('routing ids:       %d' % len(ROUTING))
    print('requirement types: %d' % len(requirements))
    print('Wrote', destination)


if __name__ == '__main__':
    main()
