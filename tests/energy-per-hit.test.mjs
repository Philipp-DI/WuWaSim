/**
 * Tests for the P13-fix per-hit energy extraction (tools/preprocess.mjs
 * rowEnergyFromMults): every HIT of a multi-hit row generates its energy —
 * "10.85%*4" is four hits, "19.95%+19.95%" is two — instead of the old
 * single first-term lookup that undercounted 551/996 skill entries (the
 * roster's total base generation was low by ~2×).
 *
 *   node tests/energy-per-hit.test.mjs
 *
 * Anchors on Sanhua (1102), whose SINGLE-hit values are in-game verified
 * (docs/energy-signal-findings.md): those must stay byte-identical while the
 * multi-hit stages carry hit-count × per-hit energy.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
const close = (a, b) => Math.abs(a - b) < 1e-9;

const sm = d.autoSkillMap['1102'];

// ── In-game verified single-hit anchors — must NOT move ─────────────────────
assert('basic_1 (single hit, verified 17×→~25% gauge) stays 0.87', close(sm.basic_1.energyGen, 0.87));
assert('basic_2 (single hit) stays 1.32', close(sm.basic_2.energyGen, 1.32));
assert('basic_5 (single hit) stays 4.2', close(sm.basic_5.energyGen, 4.2));
assert('skill (single hit, verified 3×→~50%) stays 10', close(sm.skill.energyGen, 10));
assert('intro (single hit) stays 10', close(sm.intro.energyGen, 10));
assert('liberation generates 0 (raw energy: 0)', close(sm.liberation.energyGen, 0));

// ── Multi-hit rows: per-hit × hit count ──────────────────────────────────────
// basic_3 = "10.85%*4" — four hits of the rate-1085 entry (energy 38 → 0.38).
assert('basic_3 ("10.85%*4") = 4 × 0.38 = 1.52', close(sm.basic_3.energyGen, 1.52));
// basic_4 = "19.95%+19.95%" — TWO rate-1995 entries, each energy 71 → 0.71.
// The old rate-keyed map collapsed the duplicate; both hits must count.
assert('basic_4 ("19.95%+19.95%") = 2 × 0.71 = 1.42', close(sm.basic_4.energyGen, 1.42));

// ── Roster-wide invariants ───────────────────────────────────────────────────
{
    let bad = 0, entries = 0, total = 0;
    for (const skillMap of Object.values(d.autoSkillMap)) {
        for (const [k, def] of Object.entries(skillMap)) {
            if (k.startsWith('_')) continue;
            entries++;
            const g = def.energyGen;
            if (!Number.isFinite(g) || g < 0) bad++;
            total += g;
        }
    }
    assert('every skill entry has a finite, non-negative energyGen', bad === 0);
    // Guard against a silent regression to the collapsed extraction: the
    // roster total under per-hit accounting is ~3300 base; the old
    // first-term-only extraction produced ~1645. Anything back below 3000
    // means multi-hit accounting broke.
    assert(`roster base-generation total reflects per-hit accounting (${total.toFixed(0)} ≥ 3000)`, total >= 3000);
    assert('probed a real number of skill entries', entries > 900);
}

console.log(`\nenergy-per-hit: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
