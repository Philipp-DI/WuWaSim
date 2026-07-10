/**
 * Tests for P12 marginal weights + priority derivation (tools/optimize/weights.js).
 *
 *   node tests/optimize-weights.test.mjs
 *
 * Covers (§10): finite weights, relevant stat > 0, irrelevant stat ≈ 0,
 * central/forward gradient agreement, and the three solo-mode priority orders.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { referenceBuild, standardSonatasFor, withTotalEr } = await import('../tools/optimize/reference-build.js');
const { computeWeights, gradientOneStat, derivePriority, normalizeWeights, NEAR_ZERO } = await import('../tools/optimize/weights.js');
const { analyzeErMode } = await import('../tools/optimize/breakpoints.js');
const { weightStatSet } = await import('../tools/optimize/sim-eval.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
d.statRanges = JSON.parse(readFileSync(resolve(__dirname, '../data/stat-ranges.json'), 'utf8'))?.stat_ranges ?? {};

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

function anchorFor(id, er = 1.25) {
    const r = d.resonators.find(x => x.id === id);
    return { r, anchor: withTotalEr(referenceBuild({ resonator: r, dataset: d, sequenceLevel: 0, sonataId: standardSonatasFor(r)[0] }), d, er) };
}

// ── Finite weights; relevant > 0; irrelevant ≈ 0 ─────────────────────────────
{
    const { r, anchor } = anchorFor(1107);                 // Carlotta
    const { weights, baseline } = computeWeights(anchor, d, r);
    assert('baseline damage is finite and positive', Number.isFinite(baseline) && baseline > 0);
    assert('every weight is a finite number', Object.values(weights).every(Number.isFinite));
    assert('Crit Rate has a positive weight (Carlotta crits)', weights.critRate > 0);
    assert('Crit DMG has a positive weight', weights.critDmg > 0);
    assert('scaling stat (ATK%) has a positive weight', weights.atkRatio > 0);
    assert('element DMG bonus has a positive weight', weights['dmgBonus.element'] > 0);
}

{
    // Jinhsi casts no Heavy in her reference rotation → Heavy DMG bonus weight ≈ 0.
    const { r, anchor } = anchorFor(1304);
    const { weights } = computeWeights(anchor, d, r);
    assert('irrelevant stat (Jinhsi Heavy DMG) has a near-zero weight', weights['dmgBonus.heavy'] < NEAR_ZERO || weights['dmgBonus.heavy'] === 0);
    assert('Jinhsi Liberation DMG weight is materially positive (Liberation DPS)', weights['dmgBonus.liberation'] > 0);
}

// ── Central vs forward gradient agree within tolerance (§10) ──────────────────
{
    const { r, anchor } = anchorFor(1205);
    for (const statDef of weightStatSet(r.element)) {
        const g = gradientOneStat(anchor, d, statDef);
        if (Math.abs(g.central) < 1) continue;            // skip ~zero gradients
        const relDiff = Math.abs(g.central - g.forward) / Math.abs(g.central);
        assert(`${statDef.key}: central/forward gradients agree within 5%`, relDiff < 0.05);
    }
}

// ── Non-ER-scaling kit: ER weight is exactly 0 (ER doesn't enter the formula) ─
{
    const { r, anchor } = anchorFor(1107);
    const { weights } = computeWeights(anchor, d, r);
    assert('Carlotta (non-ER-scaling) has ER weight 0', weights.energyRegen === 0);
}

// ── derivePriority: the three solo modes ─────────────────────────────────────
{
    const { r, anchor } = anchorFor(1107);
    const { weights, baseline } = computeWeights(anchor, d, r);
    const erMeta = analyzeErMode({ resonator: r, dataset: d, erWeight: weights.energyRegen, baseline });

    const dmg = derivePriority(weights, erMeta, 'dmgFocus', d.statRanges);
    assert('dmgFocus excludes energyRegen entirely', !dmg.some(e => e.key === 'energyRegen'));
    assert('dmgFocus is sorted by per-roll value descending', dmg.every((e, i) => i === 0 || dmg[i - 1].rollValue >= e.rollValue));
    assert('dmgFocus drops zero-weight stats', dmg.every(e => e.weight > 0));

    const bal = derivePriority(weights, erMeta, 'balanced', d.statRanges);
    assert('balanced (libCostKnown) leads with the ER target', bal[0].key === 'energyRegen' && bal[0].gate === true);
    assert('balanced ER entry is a soft target, not a fabricated breakpoint', /target/.test(bal[0].note));

    const erF = derivePriority(weights, erMeta, 'erFocus', d.statRanges);
    assert('erFocus (non-scaling) notes the deferred solo breakpoint', erF[0].key === 'energyRegen' && /multi-cycle|team/.test(erF[0].note));
}

// ── derivePriority: a kit with no Liberation energy gate (Hiyuki) ─────────────
{
    const { r, anchor } = anchorFor(1108);
    const { weights, baseline } = computeWeights(anchor, d, r);
    const erMeta = analyzeErMode({ resonator: r, dataset: d, erWeight: weights.energyRegen, baseline });
    assert('Hiyuki libCostKnown is false', erMeta.libCostKnown === false);
    const bal = derivePriority(weights, erMeta, 'balanced', d.statRanges);
    assert('balanced omits the ER prefix when not energy-gated', !bal.some(e => e.key === 'energyRegen'));
}

// ── normalizeWeights: top damage weight = 100 ────────────────────────────────
{
    const { r, anchor } = anchorFor(1107);
    const { weights } = computeWeights(anchor, d, r);
    const norm = normalizeWeights(weights, { excludeKeys: ['energyRegen'] });
    const top = norm.reduce((a, b) => b.normalized > a.normalized ? b : a, norm[0]);
    assert('normalized top weight is 100', Math.abs(top.normalized - 100) < 1e-9);
    assert('all normalized values are within [0,100]', norm.every(e => e.normalized >= 0 && e.normalized <= 100 + 1e-9));
}

console.log(`\noptimize-weights: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
