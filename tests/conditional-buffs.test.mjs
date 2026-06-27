/**
 * Conditional buff extraction — weapons + multi-stage sonata clauses, gated.
 *
 *   node tests/conditional-buffs.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
    substituteParams, extractConditionalContribution,
    weaponConditionalContribution, sonataConditionalContribution,
} from '../src/core/conditional-buffs.js';
import { simulateRotation } from '../src/core/sim.js';
import { createBuild, setWeapon, setEcho } from '../src/core/build.js';
import { PROP } from '../src/core/stats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
const resoOf = (id) => d.resonators.find(r => r.id === id);
const weaponByName = (n) => d.weapons.find(w => w.name === n);

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const hiyuki = resoOf(1108);   // inflicts Glacio Chafe
const carlotta = resoOf(1107); // does not

// ── substituteParams ─────────────────────────────────────────────────────────
{
    const w = weaponByName('Emerald of Genesis');
    const t = substituteParams(w.effect, w.effectParams, 1);
    assert('substitutes {0} with a real value', !t.includes('{0}') && /12\.8%/.test(t));
    const t5 = substituteParams(w.effect, w.effectParams, 5);
    assert('rank 5 substitutes the rank-5 value', /25\.6%/.test(t5));
}

// ── weapon conditional contributions ─────────────────────────────────────────
{
    const eog = weaponConditionalContribution(weaponByName('Emerald of Genesis'), 1, hiyuki, d);
    assert('EoG → conditional stacking ATK (6%×2)', Math.abs(eog.atkRatio - 0.12) < 1e-6);

    const lr = weaponConditionalContribution(weaponByName('Lustrous Razor'), 1, hiyuki, d);
    assert('Lustrous Razor → Liberation DMG (7%×3)', Math.abs((lr.dmgBySkillType.liberation ?? 0) - 0.21) < 1e-6);

    // Frostburn: Glacio-Chafe-gated amplify — ON for Hiyuki, OFF for Carlotta.
    const fbH = weaponConditionalContribution(weaponByName('Frostburn'), 1, hiyuki, d);
    assert('Frostburn amplify present for a Chafe inflictor', (fbH.amplifyByElement[1] ?? 0) > 0);
    const fbC = weaponConditionalContribution(weaponByName('Frostburn'), 1, carlotta, d);
    assert('Frostburn amplify gated off for a non-Chafe resonator', (fbC.amplifyByElement[1] ?? 0) === 0);
}

// ── extraction gating directly ───────────────────────────────────────────────
{
    const text = 'ATK is increased by 12%. After the wielder applies Glacio Chafe, Glacio DMG is Amplified by 28%.';
    const onH = extractConditionalContribution(text, { resonator: hiyuki, dataset: d });
    const onC = extractConditionalContribution(text, { resonator: carlotta, dataset: d });
    assert('Chafe amplify extracted for Hiyuki', (onH.amplifyByElement[1] ?? 0) > 0);
    assert('Chafe amplify gated for Carlotta', (onC.amplifyByElement[1] ?? 0) === 0);
    assert('leading ATK sentence skipped (handled by weapon-buffs)', onH.atkRatio === 0);
}

// ── sonata conditional: only crit/amplify, gated ─────────────────────────────
{
    const build5 = (reso, sonataId) => {
        let b = createBuild(reso);
        for (let i = 0; i < 5; i++) b = setEcho(b, i, { id: null, cost: [4, 3, 3, 1, 1][i], level: 25, sonataId, mainStat: null, subStats: [] });
        return b;
    };
    // Wishes of Quiet Snowfall (30): Snowfall +25% Crit Rate, gated on Glacio Chafe.
    const wH = sonataConditionalContribution(build5(hiyuki, 30), d, hiyuki);
    assert('Wishes Snowfall crit extracted for Hiyuki', wH.critRate > 0);
    const wC = sonataConditionalContribution(build5(carlotta, 30), d, carlotta);
    assert('Wishes Snowfall crit gated off for Carlotta', wC.critRate === 0);
    // Does NOT double-count element DMG (that's the window path's job).
    assert('sonata conditional contributes no element DMG bucket', !('dmgByElement' in wH));
}

// ── amplify actually flows into damage (Frostburn raises Hiyuki's Glacio dmg) ─
{
    const rot = meta.characters['1108'].referenceRotation;
    let withFb = setWeapon(createBuild(hiyuki), weaponByName('Frostburn').id);
    let noWeap = createBuild(hiyuki);
    for (let i = 0; i < 5; i++) {
        const e = { id: null, cost: [4, 3, 3, 1, 1][i], level: 25, sonataId: 1, mainStat: { propId: PROP.CRIT_DMG, addType: 1, value: 44, isPercent: true }, subStats: [] };
        withFb = setEcho(withFb, i, e); noWeap = setEcho(noWeap, i, { ...e });
    }
    withFb = { ...withFb, rotation: rot, rotationMeta: rot.map(() => ({})) };
    noWeap = { ...noWeap, rotation: rot, rotationMeta: rot.map(() => ({})) };
    const dFb = simulateRotation({ build: withFb, dataset: d, target: { level: 90, atkLv: 90, resistances: {} } }).totals.damage;
    const d0 = simulateRotation({ build: noWeap, dataset: d, target: { level: 90, atkLv: 90, resistances: {} } }).totals.damage;
    assert('Frostburn (amplify + passive) raises Hiyuki damage vs no weapon', dFb > d0);
}

console.log(`\nconditional-buffs: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
