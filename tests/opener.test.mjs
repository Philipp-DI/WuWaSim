/**
 * Resonance Energy shortfalls — src/core/opener.js (deriveEnergyShortfalls)
 * plus the `deriveOpeners` wiring in team-sim.js.
 *
 *   node tests/opener.test.mjs
 *
 * ~~Direction under test (2026-07-12): a consuming Liberation whose gauge can't
 * cover the cost is PADDED (the shortfall becomes real filler time), or GATED
 * (dropped + reported) when nothing can generate the energy — never kept as free
 * damage.~~
 *
 * Superseded 2026-08-14 (maintainer-directed). Two things changed together:
 *
 *   1. THE METER STARTS FULL. Tower of Adversity — the mode this app exists to
 *      model — gives every resonator a full Resonance Energy meter on entry.
 *      Starting empty made the first Liberation unpayable and the engine bought
 *      it with 50.4s of filler on the benchmark team, against arabwuwa's entire
 *      cold-start cost of 1.59s.
 *   2. A CURATED ROTATION IS PERFORMED AS AUTHORED. It states what the player
 *      does, so the engine may neither splice steps into it nor delete a cast
 *      from it. A short gauge is a BUILD problem, and the honest output is to
 *      name it and name the ER that fixes it.
 *
 * So what is under test now is that the report is right and that it changes
 * NOTHING about what runs.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { deriveEnergyShortfalls } from '../src/core/opener.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createBuild } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const target = { level: 90, atkLv: 90, resistances: {} };

// ── deriveEnergyShortfalls: synthetic unit tests ─────────────────────────────
{
    const skillMap = {
        basic_1:   { skillType: 'basic', energyGen: 5, stepDuration: 0.5 },
        basic_2:   { skillType: 'basic', energyGen: 5, stepDuration: 0.5 },
        res_skill: { skillType: 'skill', energyGen: 20, stepDuration: 1.0, cooldown: 5 },
        lib:       { skillType: 'liberation', energyGen: 0, stepDuration: 1.5 },
        lib_free:  { skillType: 'liberation', energyGen: 0, stepDuration: 1.0, consumesResource: false },
    };
    const base = { skillMap, er: 1.0, liberationCost: 100 };

    // Nothing to report when there is nothing to pay for.
    assert('no liberation cost → nothing to report',
        deriveEnergyShortfalls({ ...base, rotation: ['basic_1', 'lib'], liberationCost: null }) === null);
    assert('a non-consuming liberation is never a shortfall',
        deriveEnergyShortfalls({ ...base, rotation: ['basic_1', 'lib_free'] }) === null);

    // THE HEADLINE: a full starting meter funds the first cast.
    assert('a FULL meter funds the first liberation — no shortfall',
        deriveEnergyShortfalls({ ...base, rotation: ['basic_1', 'lib'], gaugeStart: 100 }) === null);
    // …and an empty one does not, which is what the old model padded away.
    const empty = deriveEnergyShortfalls({ ...base, rotation: ['basic_1', 'lib'], gaugeStart: 0 });
    assert('an EMPTY meter reports the first liberation as short',
        empty?.shortfalls.length === 1 && close(empty.shortfalls[0].deficit, 95));

    // The SECOND cast is where a real rotation binds: the meter resets, so the
    // rotation has to rebuild it out of its own generation.
    const twoLibs = deriveEnergyShortfalls({
        ...base, rotation: ['lib', 'basic_1', 'basic_2', 'lib'], gaugeStart: 100 });
    assert('the first cast is funded but the second is short',
        twoLibs?.shortfalls.length === 1 && twoLibs.shortfalls[0].key === 'lib');
    // 10 base generated since the reset; 100 needed ⇒ ER 10.0 would fund it.
    assert('…and it reports the ER that would have funded it',
        close(twoLibs.shortfalls[0].requiredEr, 10));
    // requiredEr scales with what the rotation actually generates: swap the two
    // basics for a Resonance Skill run and the requirement drops.
    const richer = deriveEnergyShortfalls({
        ...base, rotation: ['lib', 'res_skill', 'res_skill', 'basic_1', 'lib'], gaugeStart: 100 });
    const richerNeeds = richer.shortfalls[0].requiredEr;
    assert('a rotation that generates more needs less ER',
        richerNeeds < twoLibs.shortfalls[0].requiredEr);
    // The reported ER is CEILED to 3 decimals, never rounded: advice that is
    // rounded down does not fund the cast it is advice about.
    assert('requiredEr is ceiled, so it is always sufficient',
        richerNeeds >= 100 / 45 && richerNeeds - 100 / 45 < 1e-3);

    // Raising ER to the reported number funds the cast — the report is
    // actionable, not decorative.
    assert('at the reported ER the shortfall disappears',
        deriveEnergyShortfalls({ ...base, er: richerNeeds,
            rotation: ['lib', 'res_skill', 'res_skill', 'basic_1', 'lib'], gaugeStart: 100 }) === null);

    // Zero income can never be covered, and says so rather than inventing a
    // number.
    const noIncome = deriveEnergyShortfalls({ ...base, rotation: ['lib', 'lib'], gaugeStart: 100 });
    assert('zero income between casts → requiredEr is null, not a fabricated value',
        noIncome?.shortfalls.length === 1 && noIncome.shortfalls[0].requiredEr === null);
}

// ── The wiring: reporting must not change what runs ──────────────────────────
{
    const ids = [1108, 1109, 1508];
    let team = createTeam();
    const builds = new Map();
    ids.forEach((id, index) => {
        const resonator = d.resonators.find(entry => entry.id === id);
        const build = { ...createBuild(resonator), level: 90 };
        const reference = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));
        build.rotation = [...(reference[String(id)]?.rotation ?? [])];
        build.rotationMeta = build.rotation.map(() => ({}));
        builds.set(build.id, build);
        team = setTeamSlot(team, index, build.id);
    });
    const resolveBuild = (id) => builds.get(id) ?? null;
    const run = (deriveOpeners) => simulateTeamRotation({
        team, resolveBuild, dataset: d, target, passCount: 3, deriveOpeners });

    const on = run(true), off = run(false);
    // THE CONTRACT. The flag is a REPORT. Turning it on may not move a single
    // number — no step spliced, no cast dropped, no time added. Under the old
    // padding model these differed by 50.4s on the benchmark team.
    assert('deriveOpeners changes no damage', close(on.totals.damage, off.totals.damage, 1e-6));
    assert('deriveOpeners changes no time', close(on.totals.gameTime, off.totals.gameTime, 1e-6));
    assert('deriveOpeners changes no step count',
        [...on.memberSteps.values()].flat().length === [...off.memberSteps.values()].flat().length);

    // No step is ever marked as spliced filler any more.
    assert('no step is flagged as opener filler',
        [...on.memberSteps.values()].flat().every(step => !step.openerFiller));

    // The report itself is shaped as the UI reads it.
    for (const adjustment of on.openerAdjustments ?? []) {
        assert('every reported adjustment carries shortfalls',
            Array.isArray(adjustment.shortfalls) && adjustment.shortfalls.length > 0);
        assert('…and never an addedTime (padding is retired)', !('addedTime' in adjustment));
        assert('…and never a gated cast (a curated rotation keeps every cast)',
            !('gated' in adjustment));
    }

    // Pass 1 is no longer the long one: the cold start costs nothing now.
    const passTime = (result, pass) => result.segments
        .filter(segment => segment.pass === pass)
        .reduce((sum, segment) => sum + (segment.endTime - segment.startTime), 0);
    assert('pass 1 costs no more time than pass 2', passTime(on, 0) <= passTime(on, 1) + 1e-6);
}

console.log(`opener: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
