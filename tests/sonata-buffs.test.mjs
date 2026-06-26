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

import { parseSonataBuffs, detectDamageType } from '../src/core/sonata-buffs.js';

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

console.log(`\nsonata-buffs.test.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
