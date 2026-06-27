/**
 * Tests for runtime stat ranking (src/core/stat-ranking.js, P12 §10).
 *
 *   node tests/stat-ranking.test.mjs
 *
 * Covers: statPriority sorted desc with normalized bars, the three modes,
 * rankSubstats excludes main-only stats, erStatus below/above target +
 * not-energy-gated, anchorDistance, and graceful degradation when uncovered.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { statPriority, rankSubstats, erStatus, anchorDistance, isFarFromAnchor, SOLO_MODES } = await import('../src/core/stat-ranking.js');
const { metaFor } = await import('../src/data/meta-loader.js');
const { createBuild, setEcho } = await import('../src/core/build.js');
const { referenceBuild, standardSonatasFor, withTotalEr } = await import('../tools/optimize/reference-build.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const meta = JSON.parse(readFileSync(resolve(root, 'data/wuwa-meta.json'), 'utf8'));
const d = JSON.parse(readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const carlotta = d.resonators.find(r => r.id === 1107);          // covered, energy-gated
const hiyuki = d.resonators.find(r => r.id === 1108);            // covered, NOT energy-gated
const entryC = metaFor(meta, 1107, 0, standardSonatasFor(carlotta)[0]);
const entryH = metaFor(meta, 1108, 0, standardSonatasFor(hiyuki)[0]);

// ── statPriority: sorted, labelled, normalized ───────────────────────────────
{
    const pri = statPriority(entryC, 'dmgFocus');
    assert('statPriority returns entries', pri.length > 0);
    assert('entries carry a human label', pri.every(e => typeof e.label === 'string'));
    const damage = pri.filter(e => e.key !== 'energyRegen');
    assert('damage entries sorted by weight descending', damage.every((e, i) => i === 0 || damage[i - 1].weight >= e.weight));
    assert('top damage stat normalizes to 100', Math.abs(damage[0].normalized - 100) < 1e-6);
    assert('dmgFocus excludes energyRegen', !pri.some(e => e.key === 'energyRegen'));
}

// ── three modes behave per design ────────────────────────────────────────────
{
    assert('all three solo modes are enumerated', SOLO_MODES.length === 3);
    const bal = statPriority(entryC, 'balanced');
    assert('balanced (energy-gated) leads with ER target', bal[0].key === 'energyRegen' && /target/.test(bal[0].note));
    const balH = statPriority(entryH, 'balanced');
    assert('balanced (not energy-gated) omits ER', !balH.some(e => e.key === 'energyRegen'));
    const er = statPriority(entryC, 'erFocus');
    assert('erFocus (non-scaling) notes the deferred breakpoint', er.some(e => e.key === 'energyRegen' && /multi-cycle|team/.test(e.note || '')));
}

// ── rankSubstats excludes main-only stats (element DMG bonus) ─────────────────
{
    const subs = rankSubstats(entryC, 'dmgFocus');
    assert('rankSubstats excludes element DMG bonus (main-only)', !subs.some(e => e.key === 'dmgBonus.element'));
    assert('rankSubstats keeps Crit Rate (a real substat)', subs.some(e => e.key === 'critRate'));
}

// ── erStatus: below/above target + not-energy-gated ──────────────────────────
{
    // A bare build (no echoes) → ER ≈ 100% < 125% target → belowTarget.
    const bare = createBuild(carlotta);
    const st = erStatus(bare, entryC, d);
    assert('erStatus.current reflects the build ER', st.current > 0.9 && st.current < 1.1);
    assert('bare build is below the 125% target', st.belowTarget === true && st.target === 1.25);

    // The anchor build sits at the target → not below.
    const anchor = withTotalEr(referenceBuild({ resonator: carlotta, dataset: d, sequenceLevel: 0, sonataId: standardSonatasFor(carlotta)[0] }), d, 1.25);
    assert('anchor build is at/above target', erStatus(anchor, entryC, d).belowTarget === false);

    // Not energy-gated character → never flagged below target.
    assert('Hiyuki (not energy-gated) is never belowTarget', erStatus(createBuild(hiyuki), entryH, d).belowTarget === false);
    assert('Hiyuki erStatus reports libCostKnown false', erStatus(createBuild(hiyuki), entryH, d).libCostKnown === false);
}

// ── anchorDistance: anchor ≈ 0, bare build far ───────────────────────────────
{
    const anchor = withTotalEr(referenceBuild({ resonator: carlotta, dataset: d, sequenceLevel: 0, sonataId: standardSonatasFor(carlotta)[0] }), d, 1.25);
    const dAnchor = anchorDistance(anchor, entryC, d);
    assert('anchorDistance at the anchor is near zero', dAnchor != null && dAnchor < 0.05);
    assert('anchor build is NOT flagged far', isFarFromAnchor(anchor, entryC, d) === false);

    const bare = createBuild(carlotta);                           // no echoes/weapon → low crit/atk
    assert('a bare build is flagged far from the anchor', isFarFromAnchor(bare, entryC, d) === true);
}

// ── graceful degradation: null/empty meta entry ──────────────────────────────
{
    assert('statPriority on null entry → []', statPriority(null, 'balanced').length === 0);
    assert('rankSubstats on null entry → []', rankSubstats(null, 'balanced').length === 0);
    assert('anchorDistance with no anchorStats → null', anchorDistance(createBuild(carlotta), { weights: {} }, d) === null);
}

console.log(`\nstat-ranking: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
