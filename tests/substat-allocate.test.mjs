/**
 * Substat co-optimization — greedy marginal allocator (Phase C).
 *
 *   node tests/substat-allocate.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { allocateSubstats, allocationToSubstats, substatPool } from '../src/core/substat-allocate.js';
import { createBuild, setEcho, setWeapon } from '../src/core/build.js';
import { PROP } from '../src/core/stats.js';
import { possibleRollsFor } from '../src/core/echo-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
// Mirrors src/data/loader.js's runtime merge — stat-ranges.json is a separate
// file, unwrapped from its "stat_ranges" key.
d.statRanges = JSON.parse(readFileSync(resolve(__dirname, '../data/stat-ranges.json'), 'utf8'))?.stat_ranges ?? {};
const avgRoll = (propId, addType) => {
    const rolls = possibleRollsFor({ propId, addType }, d.statRanges);
    return rolls.reduce((a, b) => a + b, 0) / rolls.length;
};

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const hiyuki = d.resonators.find(r => r.id === 1108);
const rot = meta.characters['1108'].referenceRotation;

// Base build: mains-only echoes (Crit DMG 4-cost, Glacio 3-cost, ATK% ×3), NO substats.
function baseBuild(sonataId) {
    let b = setWeapon(createBuild(hiyuki), d.weapons.find(w => w.type === hiyuki.weaponType && w.rarity === 5).id);
    const mains = [
        { propId: PROP.CRIT_DMG, addType: 1, value: 44, isPercent: true },
        { propId: PROP.DMG_ELEMENT_BASE + 1, addType: 1, value: 30, isPercent: true },
        { propId: PROP.ATK_RATIO, addType: 2, value: 30, isPercent: true },
        { propId: PROP.ATK_RATIO, addType: 2, value: 18, isPercent: true },
        { propId: PROP.ATK_RATIO, addType: 2, value: 18, isPercent: true },
    ];
    [4, 3, 3, 1, 1].forEach((cost, i) => {
        b = setEcho(b, i, { id: null, cost, level: 25, sonataId, mainStat: mains[i], subStats: [] });
    });
    return { ...b, rotation: rot, rotationMeta: rot.map(() => ({})) };
}

// ── pool includes all 3 ratio stats + reflects the real average roll ────────
// All three ratio stats (ATK%/HP%/DEF%) are real, always-rollable substats in
// this game — the pool includes all of them unconditionally so the greedy
// search (not a pre-selected "scaling stat") discovers which one actually pays.
{
    const pool = substatPool('atk', d.statRanges);
    assert('pool has crit rate + crit dmg', pool.some(s => s.key === 'critRate') && pool.some(s => s.key === 'critDmg'));
    assert('pool has all 3 ratio stats regardless of scaling', ['atkRatio', 'hpRatio', 'defRatio'].every(k => pool.some(s => s.key === k)));
    const cr = pool.find(s => s.key === 'critRate');
    assert('pool values are the real average roll, not a hardcoded guess', Math.abs(cr.value - avgRoll(PROP.CRIT_RATE, 1)) < 1e-6);
}

// ── allocation respects the budget and improves damage ───────────────────────
{
    const alloc = allocateSubstats({ baseBuild: baseBuild(1), dataset: d, scaling: 'atk', budget: 20 });
    const total = Object.values(alloc.counts).reduce((a, b) => a + b, 0);
    assert('allocates no more than the budget', total <= 20);
    assert('allocation strictly raises damage over the bare-mains base', alloc.damage > alloc.base);
    assert('every allocated stat has a positive roll count', Object.values(alloc.counts).every(n => n > 0));
}

// ── greedy stops piling Crit Rate once it nears the cap ──────────────────────
{
    // Force a CR-saturated base: pre-load lots of Crit Rate as a main-ish stat,
    // then allocate. The allocator should NOT keep dumping rolls into critRate.
    let b = baseBuild(1);
    const e0 = b.echoes[0];
    b = { ...b, echoes: [{ ...e0, subStats: [{ propId: PROP.CRIT_RATE, addType: 1, value: 80, isPercent: true }] }, ...b.echoes.slice(1)] };
    const alloc = allocateSubstats({ baseBuild: b, dataset: d, scaling: 'atk', budget: 15 });
    const crRolls = alloc.counts.critRate ?? 0;
    assert('does not over-invest Crit Rate when already near cap', crRolls <= 3);
    assert('shifts budget to Crit DMG / ATK instead', (alloc.counts.critDmg ?? 0) + (alloc.counts.atkRatio ?? 0) > 0);
}

// ── allocationToSubstats round-trips counts into stat descriptors ────────────
// Expected roll values are the REAL average of data/stat-ranges.json's discrete
// roll list (possibleRollsFor), not a hardcoded literal — locks that
// rollValueOf is genuinely data-driven, not a fabricated guess.
{
    const subs = allocationToSubstats({ critRate: 2, critDmg: 4 }, 'atk', d.statRanges);
    const cr = subs.find(s => s.key === 'critRate');
    const cd = subs.find(s => s.key === 'critDmg');
    const crAvg = avgRoll(PROP.CRIT_RATE, 1);
    const cdAvg = avgRoll(PROP.CRIT_DMG, 1);
    assert('critRate descriptor carries 2 rolls × the real average roll', cr && cr.rolls === 2 && Math.abs(cr.value - 2 * crAvg) < 1e-6);
    assert('critDmg descriptor carries 4 rolls × the real average roll', cd && cd.rolls === 4 && Math.abs(cd.value - 4 * cdAvg) < 1e-6);
    assert('zero-count stats are omitted', !subs.some(s => s.rolls === 0));
}

console.log(`\nsubstat-allocate: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
