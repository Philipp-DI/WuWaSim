/**
 * Tests for sonata-buffs.js's detectDamageType (P11 wrap-up: dmg-type buff
 * colouring) — distinguishes "Heavy Attack DMG +25%" (boosts heavy damage)
 * from a mere trigger mention like "after a Heavy Attack" (no boosted DMG
 * keyword), and feeds both sim.js's shortBuffLabel and (via the rendered
 * label, for callers without the structured ParsedBuff) buff-bar.js's
 * colour classification.
 *
 *   node tests/sonata-buffs.test.mjs
 */

import { parseSonataBuffs, detectDamageType, isIncomingResonatorBuff } from '../src/core/buffs/sonata-buffs.js';

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── detectDamageType ─────────────────────────────────────────────────────────
{
    assert('Heavy Attack DMG detected', detectDamageType('Heavy Attack DMG increased by 25% for 12s') === 'heavy');
    assert('Basic Attack DMG detected', detectDamageType('Basic Attack DMG +18%') === 'basic');
    assert('Resonance Skill DMG detected', detectDamageType('Resonance Skill DMG +20% for 15s') === 'skill');
    assert('Resonance Liberation DMG detected', detectDamageType('Resonance Liberation DMG +20%') === 'liberation');
    assert('Echo DMG detected', detectDamageType('Echo DMG +30%') === 'echo');
    assert('Intro Skill DMG detected', detectDamageType('Intro Skill DMG +15%') === 'intro');
    assert('Outro Skill DMG detected', detectDamageType('Outro Skill DMG +15%') === 'outro');

    assert('trigger-only mention (no DMG after) does not match',
        detectDamageType('After using a Heavy Attack, ATK is increased by 10%') === null);
    assert('unrelated text → null', detectDamageType('Increases max HP by 10%') === null);
    assert('element DMG text does not match a damage type', detectDamageType('Glacio DMG Bonus +25%') === null);
}

// ── parseSonataBuffs — dmgType lands on the parsed buff ─────────────────────
{
    const tier = {
        buffIds: [1],
        effect: 'After using Resonance Skill, Resonance Skill DMG is increased by 20% for 15s.',
    };
    const [buff] = parseSonataBuffs(tier);
    assert('parsed buff carries dmgType', buff.dmgType === 'skill');
    assert('parsed buff keeps its trigger separately', buff.trigger === 'skill');
}

// ── detectBonusKind: clause-local, matches the % parseBonusPct reads (2026-07-14) ─
// The FIX: recognize the team-recipient "ATK of all party members by 15%"
// phrasing (previously dropped as 'unknown', so party-wide ATK sonatas were
// never credited). The TRAP the fix must NOT fall into: a later unrelated
// "ATK by 20%" clause hijacking the kind of the earlier headline bonus.
{
    const kindOf = (effect) => parseSonataBuffs({ buffIds: [1], effect })[0]?.bonusKind;
    assert('party-wide "ATK … by N%" is atk (the fix)', kindOf('Increases the ATK of all party members by 15% for 30s upon healing allies.') === 'atk');
    assert('self "ATK by N%" is atk', kindOf("Increase the Resonator's ATK by 15%.") === 'atk');
    assert('legacy "ATK +N%" still atk', kindOf('ATK + 20% for 15s.') === 'atk');
    assert('element headline stays element even with a later ATK clause',
        kindOf("Increase the Resonator's Coordinated Attack DMG by 80%. Upon a critical hit, increase the Resonator's ATK by 20% for 4s.") === 'unknown');
    assert('element DMG headline is element', kindOf('Aero DMG +10% for all Resonators in the team by 15%.') === 'element');
}

// ── isIncomingResonatorBuff: Outro→Intro transfers are not the wielder's ────
{
    assert('"ATK of the next Resonator by X%" is an incoming transfer',
        isIncomingResonatorBuff('Upon using Outro Skill, increases the ATK of the next Resonator by 22.5% for 15s.') === true);
    assert('"incoming Resonator" is a transfer', isIncomingResonatorBuff('Casting Outro Skill increases the ATK of the incoming Resonator by 15%.') === true);
    assert('a party-wide buff is NOT an incoming transfer', isIncomingResonatorBuff('Increases the ATK of all party members by 15%.') === false);
    assert('a self buff is NOT an incoming transfer', isIncomingResonatorBuff("Increase the Resonator's ATK by 15%.") === false);
}

console.log(`\nsonata-buffs.test.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
