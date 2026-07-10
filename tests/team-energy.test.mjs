/**
 * Tests for P13 team energy — src/core/team-energy.js + the memberEnergy
 * wiring in team-sim.js. See docs/energy-signal-findings.md (off-field 50%
 * rule, maintainer-confirmed 2026-06-27).
 *
 *   node tests/team-energy.test.mjs
 *
 * Covers: event projection (own vs 0.5× off-field share), the closed-form
 * minimum-ER solver, ER linearity of accumulation, cold-start pass exclusion,
 * never-fabricate cases (no cost / no liberation / zero income), and the
 * integration path through simulateTeamRotation.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { collectEnergyEvents, accumulateEnergy, minViableEr, OFF_FIELD_SHARE } from '../src/core/team-energy.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createBuild } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const target = { level: 90, atkLv: 90, resistances: {} };

// ── collectEnergyEvents: own vs off-field share ─────────────────────────────
{
    // Two synthetic rotation segments: member A casts (rawGen 10, then a
    // liberation with rawGen 2), then member B casts (rawGen 8).
    const seg = (rid, pass, startTime, trace) => ({
        resonatorId: rid, kind: 'rotation', pass, startTime,
        steps: trace.map((_, j) => ({ startTime: startTime + j })),
        simResult: { energyTrace: trace },
    });
    const segments = [
        seg(1, 0, 0, [
            { rawGen: 10, isLiberation: false },
            { rawGen: 2,  isLiberation: true },
        ]),
        seg(2, 0, 10, [
            { rawGen: 8, isLiberation: false },
        ]),
    ];
    const ev = collectEnergyEvents(segments);

    const a = ev.get(1), b = ev.get(2);
    assert('member A gets own casts at full base', a[0].base === 10 && a[1].base === 2);
    assert('member A own liberation is marked', a[1].isLiberation === true && a[0].isLiberation === false);
    assert('member A gets 50% of B\'s generation while off-field', close(a[2].base, OFF_FIELD_SHARE * 8));
    assert('member B gets 50% of A\'s generation while off-field', close(b[0].base, OFF_FIELD_SHARE * 10) && close(b[1].base, OFF_FIELD_SHARE * 2));
    assert('another member\'s liberation is NOT marked for the off-field member', b[1].isLiberation === false);
    assert('member B\'s own cast at full base', b[2].base === 8);
    assert('events preserve team-time order', a.every((e, i) => i === 0 || e.t >= a[i - 1].t));
}

// ── minViableEr: capped binary search (P13-fix, 2026-07-10) ─────────────────
// Resonance Energy is capped at `liberationCost` (can't bank more than one
// cast's worth), so this is NOT the naive cumulative closed form — a surplus
// in an early cycle gets wasted at the cap instead of subsidizing a later,
// tighter one. Values below are cross-checked against a direct simulation at
// the returned ER, not hand-derived from a formula.
{
    const lib = (pass) => ({ t: 0, base: 0, isLiberation: true, pass });
    const gen = (base, pass) => ({ t: 0, base, isLiberation: false, pass });

    // cost 100; two 40-base gens then lib0, then 60 more before lib1 (pass 1).
    // At ER ≥ 1.25 the first two gens alone already saturate the 100 cap, so
    // ALL surplus feeding lib0 is wasted — lib1 depends entirely on its own
    // local 60-base generation: ER ≥ 100/60 = 1.6667. (The naive uncapped
    // closed form would have said 200/140 ≈ 1.42857 — lower, because it let
    // lib0's surplus carry forward, which the cap forbids.)
    const events = [gen(40, 0), gen(40, 0), lib(0), gen(60, 1), lib(1)];

    const all = minViableEr(events, 100);
    assert('minViable reflects the capped local requirement (100/60)', all.achievable && close(all.minViable, 100 / 60));
    assert('liberation count reported', all.liberations === 2);

    const steady = minViableEr(events, 100, { fromPass: 1 });
    assert('fromPass excludes cold-start liberations from the requirement (same bottleneck here)', steady.achievable && close(steady.minViable, 100 / 60) && steady.liberations === 1);

    // A case where the cap never actually binds (lib0's own local requirement,
    // 100/50=2, already covers lib1 once ER is ≥2 — no surplus wasted here) —
    // capped and uncapped models agree, so this stays a good regression guard
    // that the rewrite didn't change behavior when the cap isn't the story.
    const events2 = [gen(50, 0), lib(0), gen(150, 1), lib(1)];
    const all2 = minViableEr(events2, 100);          // lib0's own requirement binds: 100/50 = 2
    const steady2 = minViableEr(events2, 100, { fromPass: 1 });
    assert('cold-start liberation binds the all-pass requirement', close(all2.minViable, 2));
    assert('steady-state requirement drops when cold-start is excluded', close(steady2.minViable, 1));

    // Never fabricate:
    assert('no liberation cost → not achievable', minViableEr(events, null).achievable === false);
    assert('no liberations → not achievable', minViableEr([gen(50, 0)], 100).achievable === false);
    assert('zero income before a counted liberation → not achievable', minViableEr([lib(0)], 100).achievable === false);
}

// ── accumulateEnergy: linear in ER, cost constant ───────────────────────────
{
    const events = [
        { t: 0, base: 40, isLiberation: false, pass: 0 },
        { t: 1, base: 40, isLiberation: false, pass: 0 },
        { t: 2, base: 0,  isLiberation: true,  pass: 0 },
    ];
    const at1 = accumulateEnergy(events, { er: 1.0, liberationCost: 100 });
    const at2 = accumulateEnergy(events, { er: 1.25, liberationCost: 100 });
    assert('accumulation is linear in ER', close(at1[1].energyAfter, 80) && close(at2[1].energyAfter, 100));
    assert('below-cost liberation flagged not castable', at1[2].liberationCastable === false);
    assert('at-cost liberation flagged castable', at2[2].liberationCastable === true);
    assert('cost subtraction can go negative (deficit is the signal)', close(at1[2].energyAfter, 80 - 100));
    const noCost = accumulateEnergy(events, { er: 1.0, liberationCost: null });
    assert('unknown cost → castable null, nothing subtracted', noCost[2].liberationCastable === null && close(noCost[2].energyAfter, 80));
}

// ── Integration: simulateTeamRotation carries memberEnergy ──────────────────
{
    // Sanhua (1102): skill = 10 base, liberation cost 100 (in-game verified,
    // docs/energy-signal-findings.md). Mornye (1209) fills slot 0.
    const sanhua = d.resonators.find(r => r.id === 1102);
    const mornye = d.resonators.find(r => r.id === 1209);

    const fillerBuild = createBuild(mornye);
    fillerBuild.rotation = ['basic_basic_attack_1'];
    const sanhuaBuild = createBuild(sanhua);
    sanhuaBuild.rotation = ['skill', 'skill', 'liberation'];

    let team = createTeam();
    team = setTeamSlot(team, 0, fillerBuild.id);
    team = setTeamSlot(team, 1, sanhuaBuild.id);
    const builds = new Map([[fillerBuild.id, fillerBuild], [sanhuaBuild.id, sanhuaBuild]]);
    const resolveBuild = (id) => builds.get(id) ?? null;

    const result = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 2 });

    assert('memberEnergy present for every member', result.memberEnergy.has(1102) && result.memberEnergy.has(1209));
    assert('segments carry their pass index', result.segments.some(s => s.pass === 0) && result.segments.some(s => s.pass === 1));

    const se = result.memberEnergy.get(1102);
    assert('liberation cost read from baseStats', se.liberationCost === d.baseStats['1102'].energyMax);
    assert('trace has entries and starts from 0 (cold start)', se.trace.length > 0 && se.trace[0].energyBefore === 0);
    assert('Sanhua\'s liberation casts appear in her team trace', se.trace.filter(e => e.isLiberation).length === 2);

    // Independent recomputation of Sanhua's energy before her FIRST liberation,
    // straight from the segments' raw traces (not via team-energy.js):
    // own steps at full rawGen, other members' steps at 50% — all × her ER.
    let expected = 0;
    outer: for (const seg of result.segments) {
        const trace = seg.simResult?.energyTrace ?? [];
        for (const e of trace) {
            if (seg.resonatorId === 1102 && e.isLiberation) break outer;
            expected += (seg.resonatorId === 1102 ? 1 : OFF_FIELD_SHARE) * (e.rawGen ?? 0) * se.er;
        }
    }
    const firstLib = se.trace.find(e => e.isLiberation);
    assert('team trace matches independent recomputation at the first liberation', close(firstLib.energyBefore, expected, 1e-6));
    assert('off-field share contributes (energy exceeds own-casts-only total)', firstLib.energyBefore > (10 + 10) * se.er);

    // The energy layer must never change damage (P11.5 invariant, team level).
    const again = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 2 });
    assert('team totals deterministic with energy layer attached', again.totals.damage === result.totals.damage);
}

console.log(`\nteam-energy: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
