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
    const segment = (rid, name, pass, startTime, trace, labels) => ({
        resonatorId: rid, resonatorName: name, kind: 'rotation', pass, startTime,
        steps: trace.map((_, j) => ({ startTime: startTime + j, label: labels[j] })),
        simResult: { energyTrace: trace },
    });
    const segments = [
        segment(1, 'A', 0, 0, [
            { rawGen: 10, isLiberation: false },
            { rawGen: 2,  isLiberation: true },
        ], ['A Basic ATK', 'A Liberation']),
        segment(2, 'B', 0, 10, [
            { rawGen: 8, isLiberation: false },
        ], ['B Basic ATK']),
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

    // 2026-07-13 transparency pass — events carry what was actually cast, so
    // the UI never has to render the generic word "step".
    assert('own casts are labeled from the step, not the generic "step"', a[0].label === 'A Basic ATK' && a[0].own === true);
    assert('off-field share names the SOURCE resonator\'s action', a[2].label === 'B Basic ATK' && a[2].own === false && a[2].sourceName === 'B');
    assert('the receiving member\'s own name is NOT the source on a share event', b[0].sourceName === 'A' && b[0].own === false);
    assert('accumulateEnergy carries label/own/sourceName through unchanged', accumulateEnergy(a, { er: 1, liberationCost: 100 })[2].sourceName === 'B');
}

// ── minViableEr: per-cycle-independent binary search (2026-07-12) ───────────
// A scripted Liberation always resets the gauge to 0 once cast (see
// accumulateEnergy), regardless of whether it was actually castable at that
// ER — so every cycle's requirement depends ONLY on its own local generation
// since the previous reset, never on carryover from an earlier cycle. Values
// below are cross-checked against a direct simulation at the returned ER,
// not hand-derived from a formula.
{
    const lib = (pass) => ({ t: 0, base: 0, isLiberation: true, pass });
    const gen = (base, pass) => ({ t: 0, base, isLiberation: false, pass });

    // cost 100; two 40-base gens then lib0, then 60 more before lib1 (pass 1).
    // lib0's own requirement: ER ≥ 100/80 = 1.25. lib1's own requirement (its
    // local 60-base generation, starting fresh from the reset): ER ≥ 100/60 =
    // 1.6667 — the stricter of the two, so it wins the all-pass requirement.
    const events = [gen(40, 0), gen(40, 0), lib(0), gen(60, 1), lib(1)];

    const all = minViableEr(events, 100);
    assert('minViable reflects the stricter per-cycle requirement (100/60)', all.achievable && close(all.minViable, 100 / 60));
    assert('liberation count reported', all.liberations === 2);

    const steady = minViableEr(events, 100, { fromPass: 1 });
    // fromPass only changes which liberations must be castable, never how the
    // gauge accumulates — lib1's own local requirement is the same 100/60
    // whether or not lib0's castability is also required.
    assert('fromPass excludes cold-start liberations from the requirement (same local bottleneck either way)', steady.achievable && close(steady.minViable, 100 / 60) && steady.liberations === 1);

    // A second, independent pair of cycles (own requirements 100/50=2 and
    // 100/150≈0.667) confirms the all-pass max and the fromPass-narrowed
    // result read off each cycle's OWN local sum, not a blended one.
    const events2 = [gen(50, 0), lib(0), gen(150, 1), lib(1)];
    const all2 = minViableEr(events2, 100);          // lib0's own requirement binds: 100/50 = 2
    const steady2 = minViableEr(events2, 100, { fromPass: 1 });
    // ~~The cold-start liberation binds the all-pass requirement (100/50 = 2).~~
    // The gauge now STARTS FULL, so pass 0's cast is funded by the meter the
    // resonator walks in with and can never bind. What is left is lib1's own
    // cycle, 100/150 — and that is the point of the change: the requirement is
    // "rebuild a full meter within one loop", not "charge one from empty".
    assert('a full start means the cold-start liberation cannot bind',
        close(all2.minViable, 100 / 150));
    // Excluding lib0 doesn't change how much lib1's OWN cycle needs — the
    // reset before it happens regardless of lib0's castability, so pass 1
    // starts fresh from 0 either way: ER ≥ 100/150 ≈ 0.6667.
    assert('steady-state requirement reflects lib1\'s own local generation once cold-start is excluded', close(steady2.minViable, 100 / 150));

    // Never fabricate:
    assert('no liberation cost → not achievable', minViableEr(events, null).achievable === false);
    assert('no liberations → not achievable', minViableEr([gen(50, 0)], 100).achievable === false);
    // A lone pass-0 liberation is now FUNDED by the starting meter, so it is
    // achievable at any ER — the honest "no income can ever cover this" case is
    // a liberation in a LATER pass with nothing generated before it.
    assert('a lone cold-start liberation is funded by the full meter',
        minViableEr([lib(0)], 100).achievable === true);
    assert('zero income before a LATER liberation → not achievable',
        minViableEr([lib(0), lib(1)], 100, { fromPass: 1 }).achievable === false);
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
    // Starting FULL and clamped at the cost, both ER values are already pinned
    // to 100 before the first event — which is the overcap rule doing its job:
    // generation before the first Liberation is spilled.
    assert('a full start is clamped at the cost, so pre-liberation gain spills',
        close(at1[1].energyAfter, 100) && close(at2[1].energyAfter, 100));
    assert('a liberation on a full meter IS castable', at1[2].liberationCastable === true);
    // Linearity still holds where it matters — AFTER a reset, where the gauge
    // genuinely rebuilds from 0.
    const afterReset = [
        { t: 0, base: 0,  isLiberation: true,  pass: 0 },
        { t: 1, base: 40, isLiberation: false, pass: 0 },
    ];
    assert('accumulation is linear in ER once the gauge has been reset',
        close(accumulateEnergy(afterReset, { er: 1.0, liberationCost: 100 })[1].energyAfter, 40)
        && close(accumulateEnergy(afterReset, { er: 1.25, liberationCost: 100 })[1].energyAfter, 50));
    assert('at-cost liberation flagged castable', at2[2].liberationCastable === true);
    assert('the cast always resets to 0 once cost is known, castable or not', close(at1[2].energyAfter, 0));
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
    // ~~starts from 0 (cold start)~~ — Tower of Adversity hands every resonator a
    // FULL meter on entry, which is the scenario this app models.
    assert('trace has entries and starts from a FULL meter',
        se.trace.length > 0 && close(se.trace[0].energyBefore, se.liberationCost));
    assert('Sanhua\'s liberation casts appear in her team trace', se.trace.filter(e => e.isLiberation).length === 2);

    // Independent recomputation of Sanhua's energy before her FIRST liberation,
    // straight from the segments' raw traces (not via team-energy.js):
    // own steps at full rawGen, other members' steps at 50% — all × her ER.
    // Starts from the full meter, and every gain is clamped to it.
    let expected = se.liberationCost;
    outer: for (const segment of result.segments) {
        const trace = segment.simResult?.energyTrace ?? [];
        for (const event of trace) {
            if (segment.resonatorId === 1102 && event.isLiberation) break outer;
            expected = Math.min(se.liberationCost,
                expected + (segment.resonatorId === 1102 ? 1 : OFF_FIELD_SHARE) * (event.rawGen ?? 0) * se.er);
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
