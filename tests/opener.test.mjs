/**
 * Tests for derived openers (2026-07-12) — src/core/opener.js
 * (deriveOpenerPadding) + the deriveOpeners wiring in team-sim.js.
 *
 *   node tests/opener.test.mjs
 *
 * Direction under test (maintainer, 2026-07-12, partially revoking "energy
 * never gates damage" for the team path): a consuming Liberation whose gauge
 * can't cover the cost is padded (energy shortfall becomes real filler time),
 * or gated (dropped + reported) when nothing can generate the energy — never
 * kept as free damage.
 *
 * Filler model (2026-07-11): a CD-aware greedy — cast the highest-yield ability
 * that is OFF COOLDOWN (the rotation's Resonance Skills + the equipped Echo
 * Skill) and fill the gaps with the CD-free basic chain; Forte-gated casts are
 * excluded. Replaced the former fixed-cycle-×k loop that spun the pre-Liberation
 * prefix's weakest hits (Aero Rover's ~313s pathology).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { deriveOpenerPadding, MAX_FILLER_TIME } from '../src/core/opener.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createBuild } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const target = { level: 90, atkLv: 90, resistances: {} };

// ── deriveOpenerPadding: synthetic unit tests (CD-aware greedy) ──────────────
{
    const skillMap = {
        basic_1:   { skillType: 'basic', energyGen: 5, actionableAt: 0.5 },
        basic_2:   { skillType: 'basic', energyGen: 5, actionableAt: 0.5 },
        res_skill: { skillType: 'skill', energyGen: 20, actionableAt: 1.0, cooldown: 5 },
        forte_cd:  { skillType: 'forte_heavy', energyGen: 50, actionableAt: 1.0, cooldown: 5 },
        lib:       { skillType: 'liberation', energyGen: 0, actionableAt: 1.5 },
        lib_free:  { skillType: 'liberation', energyGen: 0, actionableAt: 1.0, consumesResource: false },
    };
    const base = { skillMap, dataset: {}, er: 1.0, liberationCost: 100 };
    const seqOf = (p) => p.insertions[0].sequence;

    assert('no liberation cost → null (not evaluable)',
        deriveOpenerPadding({ ...base, rotation: ['basic_1', 'lib'], liberationCost: null }) === null);
    assert('no consuming liberation → null',
        deriveOpenerPadding({ ...base, rotation: ['basic_1', 'lib_free'] }) === null);
    assert('gauge already covers the cost → null',
        deriveOpenerPadding({ ...base, rotation: ['basic_1', 'lib'], gaugeStart: 100 }) === null);

    // Lib is FIRST so the greedy runs from a cold gauge (0). Res Skill (gen 20,
    // cd 5) is cast whenever off cooldown; the 2-basic chain (gen 5) fills the
    // gaps. g:0→100 = res_skill, 8 basics, res_skill (off cd at t=5), 4 basics
    // → 14 steps / 8.0s. This is the whole point: the CD generator is used
    // repeatedly on cooldown, not looped back-to-back or dropped.
    const pad = deriveOpenerPadding({ ...base, rotation: ['lib', 'res_skill', 'basic_1', 'basic_2'] });
    assert('greedy filler reaches the cost (14 steps / 8.0s)',
        pad.insertions.length === 1 && seqOf(pad).length === 14 && close(pad.insertions[0].addedTime, 8.0, 1e-6));
    assert('highest-yield off-cooldown ability is cast first, Res Skill exactly twice (on its 5s cd)',
        seqOf(pad)[0] === 'res_skill' && seqOf(pad).filter(k => k === 'res_skill').length === 2);
    assert('filler is spliced immediately before the Liberation',
        pad.insertions[0].beforeKey === 'lib' && pad.rotation[14] === 'lib' &&
        pad.fillerIndices.length === 14 && pad.fillerIndices.every(i => i < 14));
    assert('nothing gated when the greedy succeeds', pad.gated.length === 0);

    // A Forte-gauge-gated ability is EXCLUDED even with a cooldown + high gen —
    // it can't be scheduled without a Forte model (Lever 2). Falls back to
    // basics only: 100 / (5 × 1.0 ER) = 20 basics × 0.5s = 10.0s.
    const forte = deriveOpenerPadding({ ...base, rotation: ['lib', 'forte_cd', 'basic_1', 'basic_2'] });
    assert('Forte-gated ability is never used as filler', !seqOf(forte).includes('forte_cd'));
    assert('greedy falls back to the basic chain (20 basics / 10.0s)',
        seqOf(forte).length === 20 && close(forte.insertions[0].addedTime, 10.0, 1e-6));

    // The equipped Echo Skill is a cooldown-gated generator: cast once (gen 50),
    // then the basic chain finishes (its 20s cd outlasts the ~6s filler).
    const echo = deriveOpenerPadding({ ...base, rotation: ['lib', '__echo__', 'basic_1'], echoEnergyGain: 50, echoCooldown: 20 });
    assert('echo skill is cast as a generator, once (its cooldown outlasts the filler)',
        seqOf(echo)[0] === '__echo__' && seqOf(echo).filter(k => k === '__echo__').length === 1);
    assert('echo generation counts toward the projection (1 echo + 10 basics / 6.2s)',
        seqOf(echo).length === 11 && close(echo.insertions[0].addedTime, 6.2, 1e-6));

    // Cooldown seed from the authored prefix (2026-07-15): the Echo Skill cast
    // BEFORE a consuming Liberation is still on its 20s cooldown when the filler
    // runs — the greedy must NOT re-cast it immediately (the reported bug: an
    // impossible back-to-back Echo Skill). The prefix echo (gen 50) leaves a 50
    // deficit the CD-free basic chain covers; the echo stays blocked.
    const echoPrefix = deriveOpenerPadding({ ...base, rotation: ['__echo__', 'lib', 'basic_1'], echoEnergyGain: 50, echoCooldown: 20 });
    assert('filler does NOT re-cast the Echo Skill while its authored-prefix cooldown runs',
        echoPrefix.insertions.length === 1 && seqOf(echoPrefix).every(k => k !== '__echo__'));
    // The SAME kit with the echo NOT recently cast (Liberation first, echo after)
    // → the echo is free to use as a generator, exactly as before.
    const echoFresh = deriveOpenerPadding({ ...base, rotation: ['lib', '__echo__', 'basic_1'], echoEnergyGain: 50, echoCooldown: 20 });
    assert('the echo IS used as a generator when it is not on a carried cooldown',
        seqOf(echoFresh).includes('__echo__'));

    // Higher ER and gauge carry-in both shorten the filler.
    const highEr = deriveOpenerPadding({ ...base, rotation: ['lib', 'res_skill', 'basic_1', 'basic_2'], er: 2.0 });
    assert('higher ER shortens the filler', highEr.insertions[0].addedTime < pad.insertions[0].addedTime);
    const carry = deriveOpenerPadding({ ...base, rotation: ['lib', 'res_skill', 'basic_1', 'basic_2'], gaugeStart: 60 });
    assert('gauge carry-in shortens the filler', carry.insertions[0].addedTime < pad.insertions[0].addedTime);

    // Gating: nothing generates energy → the cast and its contiguous cost-free
    // continuations are dropped and reported.
    const noGen = { lib: skillMap.lib, lib_free: skillMap.lib_free };
    const gateNF = deriveOpenerPadding({ ...base, skillMap: noGen, rotation: ['lib', 'lib_free'] });
    assert('no-filler gate drops the cast and its free continuations',
        gateNF.rotation.length === 0 && gateNF.gated.length === 1 &&
        gateNF.gated[0].key === 'lib' && gateNF.gated[0].reason === 'no-filler');

    // Near-zero generation → the farm would exceed MAX_FILLER_TIME → gated.
    const weak = { ...skillMap, basic_1: { skillType: 'basic', energyGen: 0.01, actionableAt: 0.5 }, basic_2: { skillType: 'basic', energyGen: 0.01, actionableAt: 0.5 } };
    const gateUR = deriveOpenerPadding({ ...base, skillMap: weak, rotation: ['lib', 'basic_1', 'basic_2'] });
    assert(`near-zero generation gates as unreachable (farm would exceed ${MAX_FILLER_TIME}s)`,
        gateUR.gated.length === 1 && gateUR.gated[0].reason === 'unreachable');

    // Two consuming Liberations: the reset after the first means the second is
    // padded from its OWN local gauge, independently.
    const two = deriveOpenerPadding({ ...base, rotation: ['lib', 'res_skill', 'basic_1', 'lib'] });
    assert('each consuming Liberation is padded against its own local gauge',
        two.insertions.length === 2 && two.gated.length === 0);
}

// ── Forte layer (Lever 2): gauge fill → payoff, and no-data safety ───────────
{
    const seqOf = (p) => p.insertions[0].sequence;
    const forteMap = {
        basic_1: { skillType: 'basic', energyGen: 2, actionableAt: 0.5 },
        filler:  { skillType: 'forte_heavy', energyGen: 1, actionableAt: 0.5, forteGen: 50 },  // fast Forte generator
        payoff:  { skillType: 'forte_heavy', energyGen: 40, actionableAt: 0.5 },               // big gainer, no forteGen
        lib:     { skillType: 'liberation', energyGen: 0, actionableAt: 1.5 },
    };
    const fbase = { skillMap: forteMap, dataset: {}, er: 1.0, liberationCost: 100 };

    // With a real cap: 2 fillers fill the 100 gauge → the payoff (40 energy)
    // fires, and its high chain-throughput makes the greedy prefer this loop.
    const fp = deriveOpenerPadding({ ...fbase, forteCap: 100, rotation: ['lib', 'filler', 'payoff'] });
    assert('Forte generator is used to build the gauge', seqOf(fp).includes('filler'));
    assert('Forte payoff fires once the gauge is full', seqOf(fp).includes('payoff'));

    // Without Forte data (forteCap 0): the `forte_*` payoff AND generator are
    // both excluded — byte-for-byte the non-Forte greedy (basics only). This is
    // the no-regression guarantee for the ~37 uncovered resonators.
    const noF = deriveOpenerPadding({ ...fbase, forteCap: 0, rotation: ['lib', 'filler', 'payoff'] });
    assert('no Forte data → forte_* payoff/generator excluded (basic-only fallback)',
        !seqOf(noF).includes('payoff') && !seqOf(noF).includes('filler') && seqOf(noF).every(k => k === 'basic_1'));

    // A slow filler that only unlocks a slow payoff must NOT be preferred over a
    // fast basic (chain-throughput fairness → never regress).
    const slowMap = { ...forteMap, filler: { skillType: 'forte_heavy', energyGen: 0.1, actionableAt: 2.0, forteGen: 5 }, payoff: { skillType: 'forte_heavy', energyGen: 3, actionableAt: 2.0 } };
    const slow = deriveOpenerPadding({ skillMap: slowMap, dataset: {}, er: 1.0, liberationCost: 100, forteCap: 100, rotation: ['lib', 'filler', 'payoff'] });
    assert('a low-throughput Forte chain loses to the basic chain', seqOf(slow).every(k => k === 'basic_1'));
}

// ── Team integration: honest cold start, steady-state self-elimination ─────
{
    const refs = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));
    const ids = [1102, 1209];   // Sanhua (lib-first rotation) / Mornye
    const builds = new Map();
    let team = createTeam();
    ids.forEach((id, i) => {
        const b = createBuild(d.resonators.find(r => r.id === id));
        b.rotation = [...refs[String(id)].rotation];
        builds.set(b.id, b);
        team = setTeamSlot(team, i, b.id);
    });
    const resolveBuild = (x) => builds.get(x) ?? null;

    const off = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 2 });
    const on  = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 2, deriveOpeners: true });

    assert('engine default (deriveOpeners off) reports no adjustments', off.openerAdjustments.length === 0);
    assert('legacy view has uncastable cold-start Liberations',
        [...off.memberEnergy.values()].some(me => me.trace.some(e => e.isLiberation && e.liberationCastable === false)));

    assert('openers produce adjustments on the cold start', on.openerAdjustments.length > 0);
    assert('every consuming Liberation is castable once padded (prediction matches the reported trace)',
        [...on.memberEnergy.values()].every(me => me.trace.every(e => !e.isLiberation || e.liberationCastable !== false)));
    assert('padding costs real time', on.totals.time > off.totals.time);
    assert('filler steps are marked on the team-time segments',
        on.segments.some(segment => (segment.steps ?? []).some(step => step.openerFiller === true)));
    assert('padded segments carry their opener summary',
        on.segments.some(s => s.opener && s.opener.insertions.length > 0));

    // Steady state self-eliminates: Sanhua's pass-1 needs less (or no) filler
    // than pass 0 — energy carried over means the cold start was the problem.
    const sanhuaAdj = on.openerAdjustments.filter(a => a.resonatorId === 1102);
    const p0 = sanhuaAdj.find(a => a.pass === 0)?.addedTime ?? 0;
    const p1 = sanhuaAdj.find(a => a.pass === 1)?.addedTime ?? 0;
    assert('cold-start pass needs the padding; later passes need less', p0 > 0 && p1 < p0);

    const again = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 2, deriveOpeners: true });
    assert('openers are deterministic', again.totals.damage === on.totals.damage && again.totals.time === on.totals.time);
}

console.log(`\nopener: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
