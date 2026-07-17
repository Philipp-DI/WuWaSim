/**
 * Tests for the P13-fix per-hit energy extraction (tools/preprocess.mjs
 * rowHitTotals): every HIT of a multi-hit row generates its energy —
 * "10.85%*4" is four hits, "19.95%+19.95%" is two — instead of the old
 * single first-term lookup that undercounted 551/996 skill entries (the
 * roster's total base generation was low by ~2×).
 *
 *   node tests/energy-per-hit.test.mjs
 *
 * Anchors on Sanhua (1102), whose SINGLE-hit values are in-game verified
 * (docs/energy-signal-findings.md): those must stay byte-identical while the
 * multi-hit stages carry hit-count × per-hit energy.
 *
 * Also covers the P13-fix-2 cross-row disambiguation: TWO DIFFERENT ROWS in
 * one skill node can coincidentally share a rate (not just multiple hits
 * within one row's own term). The per-row-reset consumption counter this
 * project shipped first got that wrong — every colliding row re-read the
 * SAME first entry, silently discarding the rest. Fixed by sharing the
 * consumption counter across all rows of a node.
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

// ── P13-fix-2: cross-row rate collision, two DIFFERENT rows sharing a rate ──
// Rover: Spectro (1501) "Vibration Manifestation": "Stage 2 DMG" and "Heavy
// Attack - Resonance DMG" both read "38.25%" as their sole term, but from two
// DISTINCT raw entries (energy 100/112, element_power 400/360). A per-row-
// reset consumption counter makes BOTH rows read the first entry (both would
// show energyGen 1.0, concertoGen 4.0) and never touch the second at all.
{
    const rsm = d.autoSkillMap['1501'];
    assert('Stage 2 DMG reads the first colliding entry (energy 1.00)', close(rsm.basic_2.energyGen, 1.00));
    assert('Stage 2 DMG reads the first colliding entry (concerto 4.00)', close(rsm.basic_2.concertoGen, 4.00));
    assert('Heavy Attack - Resonance DMG reads the SECOND colliding entry, not a duplicate (energy 1.12)',
        close(rsm.heavy_resonance.energyGen, 1.12));
    assert('Heavy Attack - Resonance DMG reads the SECOND colliding entry, not a duplicate (concerto 3.60)',
        close(rsm.heavy_resonance.concertoGen, 3.60));
    assert('the two rows do NOT read identical values (the bug this locks against)',
        rsm.basic_2.energyGen !== rsm.heavy_resonance.energyGen);
    // Stage 3 DMG ("7.65%*5") is an unrelated red herring — its raw per-hit
    // rate is 765, not 3825, even though its aggregate display value (0.3825)
    // coincidentally matches; must be untouched by the disambiguation.
    assert('Stage 3 DMG (unrelated rate, coincidental aggregate match) unaffected', close(rsm.basic_3.energyGen, 1.5));
}

// ── P13-fix-3: full rate-VECTOR matching + ID-adjacency clustering ──────────
// (tools/preprocess.mjs matchRowHits; docs/energy-signal-findings.md.)
// Values below were each hand-verified against the raw skill.damage entries.
{
    // Mornye (1209): the user's own worked example — Basic Attack Stage 3
    // "20.8%+5.2%*6" = 0.65 + 6×0.17 energy / 2.08 + 6×0.52 Concerto.
    const mo = d.autoSkillMap['1209'];
    assert('Mornye BA3 (maintainer worked example) energy 1.67', close(mo.basic_basic_attack_3.energyGen, 1.67));
    assert('Mornye BA3 (maintainer worked example) concerto 5.20', close(mo.basic_basic_attack_3.concertoGen, 5.20));
    // Same-vector, IDENTICAL-value cross-row pair (WFO Stage 2 vs Dodge-WFO,
    // both "13%*4" from two far-apart ID blocks 008/015): each row must get
    // its own entry — clustering, not starvation.
    assert('Mornye WFO Stage 2 gets its own entry', close(mo.basic_wide_field_observation_mode_2.energyGen, 1.64));
    assert('Mornye Dodge-WFO gets its own entry (not starved to 0)', close(mo.basic_dodge_counter_wide_field_observation_mode.energyGen, 1.64));

    // Cartethyia (1409) "Tempest": rows 28/29 both contain 0.94% terms backed
    // by DIFFERENT ID blocks (2510x: e18 / 2520x: e66). Interleaved rate-order
    // consumption gave 3.77; block-clustered attribution gives 4×0.18+1.61.
    assert('Cartethyia Waves\' Call = 2.33 (own ID block, not interleaved)',
        close(d.autoSkillMap['1409'].forte_heavy_sword_to_answer_waves_call.energyGen, 2.33));

    // Aemeath (1210): hidden "2× shadow" duplicates (…012 = …010's vector ×2,
    // unchanged e/ep) must lose the cluster tie-break: Encore = 9%*4(e25) +
    // 18%*3(e50, NOT the shadow's e25) + 90%(e250) = 5.00 / 10.00.
    const ae = d.autoSkillMap['1210'];
    assert('Aemeath Encore energy 5.00 (shadow loses the tie-break)', close(ae.forte_heavy_seraphic_duet_encore.energyGen, 5.00));
    assert('Aemeath Encore concerto 10.00', close(ae.forte_heavy_seraphic_duet_encore.concertoGen, 10.00));

    // Recovered from cross-row starvation under rate-keyed consumption:
    assert('Rebecca Dodge Counter - Huntress recovered (1.52)', close(d.autoSkillMap['1308'].basic_dodge_counter_huntress.energyGen, 1.52));
    assert('Rover: Havoc Thwackblade recovered (5.24)', close(d.autoSkillMap['1604'].forte_heavy_umbra_thwackblade_damage.energyGen, 5.24));
}

console.log(`\nenergy-per-hit: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
