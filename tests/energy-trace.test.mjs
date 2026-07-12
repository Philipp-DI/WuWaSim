/**
 * Tests for P11.5 — energy modeling (P12 prerequisite). See
 * docs/P12-PREREQ-ENERGY-CHECK.md and docs/energy-signal-findings.md.
 *
 *   node tests/energy-trace.test.mjs
 *
 * Covers: per-step energy accumulation, Liberation cost subtraction,
 * liberationCastable flagging, ER sensitivity, and the additive guarantee
 * (energyTrace must never change stepDamage/totals.damage).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { simulateRotation } from '../src/core/sim.js';
import { createBuild, appendRotationStep, setEcho } from '../src/core/build.js';
import { PROP } from '../src/core/stats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const target = { level: 90, atkLv: 90, resistances: {} };

// Sanhua (1102): baseStats.energyMax = 100 (Liberation cost). energyGen on
// basic_1..basic_5 (0.87/1.32/0.38/0.71/4.2) and `skill` (10) verified against
// real in-game testing — at 165.6% ER, 17× basic_1 filled ~25% of the gauge
// (predicted 24.5%) and 3/6 casts of `skill` landed at ~50%/just-under-100%
// (predicted 49.7%/99.4%) — see docs/energy-signal-findings.md.
const reso = d.resonators.find(r => r.id === 1102);
const ROTATION = ['basic_1', 'basic_2', 'basic_3', 'basic_4', 'basic_5', 'liberation'];

function buildWith(rotation) {
    let b = createBuild(reso);
    for (const k of rotation) b = appendRotationStep(b, k);
    return b;
}

// ── Basic shape + accumulation ──────────────────────────────────────────────
{
    const sim = simulateRotation({ build: buildWith(ROTATION), dataset: d, target });

    assert('energyTrace is present and 1:1 with steps', Array.isArray(sim.energyTrace) && sim.energyTrace.length === sim.steps.length);
    assert('energy accumulates monotonically across non-liberation steps',
        sim.energyTrace.slice(0, 5).every((e, i) => i === 0 || e.energyBefore === sim.energyTrace[i - 1].energyAfter));
    assert('first step starts from energyBefore 0 (cold-start convention)', sim.energyTrace[0].energyBefore === 0);

    const libEntry = sim.energyTrace[5];
    assert('uncastable liberation (5 basics never reach the 100 cost) still resets to 0 — the rotation is authored as executed regardless',
        libEntry.liberationCastable === false && libEntry.energyAfter === 0);
    assert('liberation step is flagged castable when energyBefore covers the cost',
        libEntry.liberationCastable === (libEntry.energyBefore >= d.baseStats['1102'].energyMax));
    assert('non-liberation steps have liberationCastable === null (not just falsy)',
        sim.energyTrace.slice(0, 5).every(e => e.liberationCastable === null));
}

// ── Insufficient energy is flagged, not fabricated ──────────────────────────
{
    // A bare Liberation with nothing before it: energyBefore = 0 < cost.
    const sim = simulateRotation({ build: buildWith(['liberation']), dataset: d, target });
    const libEntry = sim.energyTrace[0];
    assert('insufficient energy at cast time is flagged castable:false, not true',
        libEntry.liberationCastable === false);
    assert('cost is NOT subtracted when uncastable — energy is never negative, not even as a display',
        libEntry.energyAfter === 0);
}

// ── Unknown Liberation cost never fabricates a verdict ──────────────────────
{
    // Lucilla (1109) has no baseStats entry (confirmed data gap, P11.5 plan).
    const lucilla = d.resonators.find(r => r.id === 1109);
    if (lucilla && d.autoSkillMap['1109']?.liberation) {
        let b = createBuild(lucilla);
        b = appendRotationStep(b, 'liberation');
        const sim = simulateRotation({ build: b, dataset: d, target });
        assert('unknown liberation cost yields liberationCastable:null, never a guess',
            sim.energyTrace[0].liberationCastable === null);
    } else {
        assert('Lucilla data-gap case skipped (resonator/key not present)', true);
    }
}

// ── ER sensitivity: higher ER reaches castable status earlier ──────────────
{
    // `skill` generates 10 base energy/cast. 9 casts × 10 = 90 base — below
    // the 100 cost at 100% ER (not castable; breakeven needs ER ≥ ~111.1%).
    // The +30% ER build below (130% total) comfortably crosses it (117).
    // A deliberately dense rotation that actually straddles the breakpoint,
    // unlike the basic_1..5 display rotation above (whose realistic total,
    // ~7.5, never gets close to a 100-cost gauge in just 5 hits).
    const DENSE_ROTATION = [...Array(9).fill('skill'), 'liberation'];
    const lowErBuild = buildWith(DENSE_ROTATION);
    let highErBuild = buildWith(DENSE_ROTATION);
    // A minimal echo stub carrying one Energy Regen substat raises
    // stats.energyRegen via the same applyEchoStat() path real gear uses —
    // nothing else about the build/rotation/character changes. cost:0 is
    // deliberately not a real echo cost (4/3/1) so subMainStatFor() returns
    // null and skips its auto-derived ATK/HP stat — isolating ER as the only
    // change, so any stepDamage difference can only come from energy logic.
    highErBuild = setEcho(highErBuild, 0, {
        cost: 0, level: 25, sonataId: null, mainStat: null,
        subStats: [{ propId: PROP.ENERGY_REGEN, value: 30, isPercent: true }],
    });

    const lowSim  = simulateRotation({ build: lowErBuild,  dataset: d, target });
    const highSim = simulateRotation({ build: highErBuild, dataset: d, target });

    const liberationEntry = (sim) => sim.energyTrace[sim.energyTrace.length - 1];
    assert('default ER (100%) is below the breakpoint for this dense rotation',
        liberationEntry(lowSim).liberationCastable === false);
    assert('+30% ER crosses the breakpoint for the same rotation',
        liberationEntry(highSim).liberationCastable === true);
    assert('higher ER yields a higher accumulated energy total at the same step',
        liberationEntry(highSim).energyBefore > liberationEntry(lowSim).energyBefore);

    // ── Additive guarantee: ER must never change damage for a non-ER-scaling
    // character (Sanhua is a conventional crit-scaling kit, not ER-scaling).
    assert('energy modeling never changes stepDamage/totals.damage',
        lowSim.totals.damage === highSim.totals.damage &&
        lowSim.steps.every((s, i) => s.stepDamage === highSim.steps[i].stepDamage));
}

// ── Echo step and missing-key steps are inert, not crashing ────────────────
{
    let b = createBuild(reso);
    b = appendRotationStep(b, '__echo__');
    b = appendRotationStep(b, 'not_a_real_skill_key');
    const sim = simulateRotation({ build: b, dataset: d, target });
    assert('echo + missing-key steps produce energyTrace entries without throwing', sim.energyTrace.length === 2);
    assert('echo step with NO echo equipped contributes 0 energy (no cast happens)', sim.energyTrace[0].energyAfter === sim.energyTrace[0].energyBefore);
    assert('missing-key step contributes 0 energy', sim.energyTrace[1].energyAfter === sim.energyTrace[1].energyBefore);
    assert('neither is flagged for liberation castability', sim.energyTrace.every(e => e.liberationCastable === null));
}

// ── Echo Skill Resonance Energy (2026-07-12 — former P11.5 gap, now closed) ──
{
    // Vanguard Junrock: raw energy 180 → 1.8 base per cast (÷100, the same
    // in-game-verified scale as character per-hit energy).
    const junrock = d.echoes.find(e => e.name === 'Vanguard Junrock');
    assert('echo energyGain extracted at ÷100 scale', junrock?.activeSkill?.energyGain === 1.8);

    let b = createBuild(reso);
    b = setEcho(b, 0, { id: junrock.id, cost: 1, level: 25, sonataId: null, mainStat: null, subStats: [] });
    b = appendRotationStep(b, '__echo__');
    const sim = simulateRotation({ build: b, dataset: d, target });
    const e0 = sim.energyTrace[0];
    assert('equipped echo cast reports its base rawGen', e0.rawGen === 1.8);
    assert('echo energy accumulates scaled by the build\'s ER',
        Math.abs(e0.energyAfter - 1.8 * sim.stats.energyRegen) < 1e-9);
    assert('echo cast generates no Concerto (element_power 0 across all echoes)', e0.rawConcertoGen === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
