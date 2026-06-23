/**
 * Calibration tests — pin the damage engine to real in-game observations.
 *
 *   node test/calibration.test.mjs
 *
 * See docs/CALIBRATION.md for the methodology. Each CASE below is a damage
 * number read off a training dummy in-game, with the exact inputs used to
 * produce it. The test runs the SAME inputs through computeDamage and asserts
 * the sim matches within tolerance.
 *
 * WORKFLOW for adding a confirmed case:
 *   1. Capture in-game per docs/CALIBRATION.md §2 (clean build, single hit,
 *      record non-crit AND crit numbers, record every input exactly).
 *   2. Copy the CASE_TEMPLATE below, fill in `inputs` + `observed`, set
 *      status:'active'.
 *   3. Run this file. If it fails, EITHER the code has a bug OR an input was
 *      mis-recorded — investigate per CALIBRATION.md §5 before "fixing" code.
 *
 * Cases with status:'pending' are skipped (placeholders to capture later).
 * Ratio checks run on any two active cases tagged as a pair, and can catch a
 * mis-bucketed effect even when absolute constants are still being dialed in.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { computeDamage } from '../src/core/formula.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Relative tolerance for absolute-number comparison (display rounding margin).
const TOL = 0.01;   // 1%

let passed = 0, failed = 0, skipped = 0;
function ok(name, cond, detail) {
    if (cond) { passed++; }
    else { failed++; console.error(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}
function within(actual, expected, tol = TOL) {
    if (expected === 0) return Math.abs(actual) < 1e-6;
    return Math.abs(actual - expected) / Math.abs(expected) <= tol;
}

// =============================================================================
// CASE TEMPLATE — copy this block, fill it, set status:'active'.
// =============================================================================
//
// {
//   id: 'C1',
//   status: 'active',                 // 'active' runs; 'pending' is skipped
//   note: 'Carlotta basic-1, clean build, 0-RES dummy',
//   pairWith: null,                   // e.g. 'C1' to form a ratio check
//   inputs: {
//     stats: {                        // shape: resolveTotalStats output (subset)
//       atk: 0, hp: 0, def: 0,
//       critRate: 0, critDmg: 1.5,
//       dmgBonusByElement: {},        // { 2: 0.20 } for +20% Glacio, etc.
//       dmgBonusBySkillType: {},      // { basic: 0.10 }, etc.
//       energyRegen: 1.0,
//     },
//     skill:  { skillType: 'basic', multiplier: 0, scaling: 'atk', element: 0, flat: 0 },
//     target: { level: 90, atkLv: 90, resistances: {}, defShred: 0, defIgnore: 0, dmgReduction: 0 },
//     context: {},                    // active buffs, if any (prefer none for clean cases)
//   },
//   observed: { nonCrit: 0, crit: 0 },// numbers read off the in-game screen
// }

// =============================================================================
// CAPTURED CASES
// =============================================================================
// Start empty (all pending). Fill from docs/CALIBRATION.md §4 as you capture.

const CASES = [
    { id: 'C1',  status: 'pending', note: 'Base core: single-hit ATK skill, no bonuses, 0-RES dummy' },
    { id: 'C2',  status: 'pending', note: 'Crit: same as C1, crit number', pairWith: 'C1' },
    { id: 'C3',  status: 'pending', note: 'DMG bonus: C1 + known element/type bonus', pairWith: 'C1' },
    { id: 'C4',  status: 'pending', note: 'HP scaling skill' },
    { id: 'C5',  status: 'pending', note: 'DEF scaling skill' },
    { id: 'C6',  status: 'pending', note: 'Amplify bucket' },
    { id: 'C7',  status: 'pending', note: 'Deepen bucket' },
    { id: 'C8a', status: 'pending', note: 'DefMult: enemy level A' },
    { id: 'C8b', status: 'pending', note: 'DefMult: enemy level B', pairWith: 'C8a' },
    { id: 'C9',  status: 'pending', note: 'RES linear band (0<RES<0.8)' },
    { id: 'C10', status: 'pending', note: 'RES negative band (shred below 0)' },
    { id: 'C11', status: 'pending', note: 'DEF shred / ignore' },
    { id: 'C12', status: 'pending', note: 'Liberation skill type' },
];

// =============================================================================
// RATIO CHECKS — declarative; each runs only if both referenced cases active.
// =============================================================================
// kind:
//   'crit'      → crit/nonCrit of the SAME case should equal its critDmg
//   'dmgBonus'  → A.nonCrit / B.nonCrit should equal (1 + delta)
//   'generic'   → A.nonCrit / B.nonCrit should equal `expected`
const RATIO_CHECKS = [
    { name: 'C2 crit ratio = critDmg', kind: 'crit', case: 'C2' },
    { name: 'C3/C1 = 1 + dmgBonus',    kind: 'dmgBonus', a: 'C3', b: 'C1' },
    { name: 'C8a/C8b DefMult ratio',   kind: 'generic', a: 'C8a', b: 'C8b', expected: null },
];

// =============================================================================
// RUNNER
// =============================================================================
const byId = new Map(CASES.map(c => [c.id, c]));

for (const c of CASES) {
    if (c.status !== 'active') { skipped++; continue; }
    const r = computeDamage(c.inputs);
    if (r.error) { ok(`${c.id} computes`, false, r.error); continue; }
    if (c.observed?.nonCrit != null) {
        ok(`${c.id} non-crit matches in-game`, within(r.nonCrit, c.observed.nonCrit),
           `sim ${Math.round(r.nonCrit)} vs game ${c.observed.nonCrit}`);
    }
    if (c.observed?.crit != null) {
        ok(`${c.id} crit matches in-game`, within(r.crit, c.observed.crit),
           `sim ${Math.round(r.crit)} vs game ${c.observed.crit}`);
    }
    c._result = r;   // stash for ratio checks
}

for (const rc of RATIO_CHECKS) {
    if (rc.kind === 'crit') {
        const c = byId.get(rc.case);
        if (!c || c.status !== 'active' || c.observed?.nonCrit == null || c.observed?.crit == null) continue;
        const ratio = c.observed.crit / c.observed.nonCrit;
        const cd = c.inputs.stats.critDmg ?? 1.5;
        ok(rc.name, within(ratio, cd, 0.015), `ratio ${ratio.toFixed(3)} vs critDmg ${cd}`);
    } else {
        const a = byId.get(rc.a), b = byId.get(rc.b);
        if (!a || !b || a.status !== 'active' || b.status !== 'active') continue;
        if (a.observed?.nonCrit == null || b.observed?.nonCrit == null) continue;
        const ratio = a.observed.nonCrit / b.observed.nonCrit;
        if (rc.kind === 'dmgBonus') {
            // delta = (sum of A's dmg bonuses) − (sum of B's). For the common
            // C3/C1 case where B has none, expected = 1 + A's bonus.
            const sumBonus = (st) => {
                const e = Object.values(st.dmgBonusByElement ?? {}).reduce((s, v) => s + v, 0);
                const t = Object.values(st.dmgBonusBySkillType ?? {}).reduce((s, v) => s + v, 0);
                const c = st.__contextDmgBonus ?? 0;
                return e + t + c;
            };
            const expected = 1 + (sumBonus(a.inputs.stats) - sumBonus(b.inputs.stats));
            ok(rc.name, within(ratio, expected, 0.015), `ratio ${ratio.toFixed(3)} vs ${expected.toFixed(3)}`);
        } else if (rc.kind === 'generic' && rc.expected != null) {
            ok(rc.name, within(ratio, rc.expected, 0.015), `ratio ${ratio.toFixed(3)} vs ${rc.expected}`);
        }
    }
}

// =============================================================================
// FORMULA SANITY CHECKS — these run with NO in-game data, guarding the bucket
// structure against accidental regressions (they assert the formula's shape,
// not its calibration). Cheap insurance that survives even when CASES is empty.
// =============================================================================
{
    const base = {
        stats: { atk: 1000, critRate: 0, critDmg: 1.5, dmgBonusByElement: {}, dmgBonusBySkillType: {} },
        skill: { skillType: 'basic', multiplier: 1.0, scaling: 'atk', element: 1 },
        target: { level: 90, atkLv: 90, resistances: { 1: 0 }, defShred: 0, defIgnore: 0 },
        context: {},
    };
    const r0 = computeDamage(base);

    // crit hit = non-crit × critDmg
    ok('crit = nonCrit × critDmg', within(r0.crit, r0.nonCrit * 1.5));

    // +50% DMG bonus multiplies non-crit by 1.5
    const rB = computeDamage({ ...base, context: { dmgBonus: 0.5 } });
    ok('+50% dmgBonus ⇒ ×1.5', within(rB.nonCrit, r0.nonCrit * 1.5));

    // amplify and deepen are SEPARATE multiplicative buckets, not additive with dmgBonus
    const rA = computeDamage({ ...base, context: { dmgBonus: 0.5, amplify: 0.5 } });
    ok('dmgBonus & amplify multiply separately', within(rA.nonCrit, r0.nonCrit * 1.5 * 1.5));

    // RES linear band: 10% RES ⇒ ×0.9
    const rR = computeDamage({ ...base, target: { ...base.target, resistances: { 1: 0.1 } } });
    ok('10% RES ⇒ ×0.9', within(rR.nonCrit, r0.nonCrit * 0.9));

    // RES negative band: −20% RES ⇒ ×(1 − (−0.2)/2) = ×1.1
    const rNeg = computeDamage({ ...base, target: { ...base.target, resistances: { 1: -0.2 } } });
    ok('−20% RES ⇒ ×1.1', within(rNeg.nonCrit, r0.nonCrit * 1.1));

    // HP scaling reads stats.hp, not stats.atk
    const rHp = computeDamage({
        stats: { atk: 1000, hp: 5000, critRate: 0, critDmg: 1.5, dmgBonusByElement: {}, dmgBonusBySkillType: {} },
        skill: { skillType: 'skill', multiplier: 1.0, scaling: 'hp', element: 1 },
        target: base.target, context: {},
    });
    const rAtk = computeDamage({ ...base, skill: { ...base.skill, multiplier: 1.0 } });
    ok('hp scaling uses hp stat', rHp.nonCrit > rAtk.nonCrit * 4 && rHp.nonCrit < rAtk.nonCrit * 6);
}

console.log(`\ncalibration: ${passed} passed, ${failed} failed, ${skipped} case(s) pending capture`);
process.exit(failed === 0 ? 0 : 1);
