/**
 * Tune Break as a rotation step (OPEN-ITEMS #7), 2026-08-03.
 *
 * The formula (`computeTuneBreakDamage`) was calibrated and tested long before
 * anything could cast it — see enemy-status.test.mjs for the worked example it
 * reproduces. This file covers the WIRING: that every resonator is offered the
 * step, that it is manual-only, and that it is priced by the tune-bar mechanic
 * rather than by the responder's build.
 *
 * The last point is the one worth guarding. Tune Break runs on the negative-
 * status formula family — no ATK term, no crit term, and no gear stat reaches
 * it — so two builds of the same resonator that differ enormously in every
 * other step must deal IDENTICAL Tune Break damage. A regression that quietly
 * routed it through the normal damage path would still look plausible; only
 * that equality catches it.
 *
 *   node tests/tune-break.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
    simulateRotation, TUNE_BREAK_STEP_KEY, TUNE_BREAK_CAST_TIME, ECHO_STEP_KEY,
} from '../src/core/sim.js';
import { resolveTuneBreakStep, computeTuneBreakDamage } from '../src/core/enemy-status.js';
import { createBuild, setChain, setEcho, appendRotationStep } from '../src/core/build.js';
import { setApi } from '../src/ui/components/build-editor/state.js';
import { renderRotationPalette } from '../src/ui/components/build-editor/rotation.js';
import { STEP_TYPE, TYPE_LABEL, damageFamily } from '../src/ui/components/build-editor/shared.js';
import { effectiveSkillMap } from '../src/core/sim.js';
import { analyzeRotation } from '../src/core/rotation-graph.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const referenceRotations = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const target = { level: 90, resistances: {} };

// ── Every resonator has the node, because every resonator can respond ────────
{
    const without = d.resonators.filter(resonator => !resonator.tuneBreak?.name);
    assert(`every resonator carries a Tune Break node (${d.resonators.length} of them)`,
        without.length === 0);
    assert('...each with the description the game states on it',
        d.resonators.every(resonator => (resonator.tuneBreak.desc ?? '').length > 20));
    assert('...and no leftover markup from the source text',
        d.resonators.every(resonator => !/[<>{}]/.test(resonator.tuneBreak.desc)));

    // The game names most of them by WEAPON TYPE and seven kits by their own
    // name, which is exactly why the name is read rather than synthesised.
    const byWeapon = d.resonators.filter(resonator => /^tune break/i.test(resonator.tuneBreak.name));
    assert('most are named by weapon type', byWeapon.length >= 45);
    assert('...and the rest carry a kit name of their own',
        d.resonators.length - byWeapon.length >= 5);
}

// ── The step is priced by the mechanic, not by the build ─────────────────────
{
    const hiyuki = d.resonators.find(resonator => resonator.name === 'Hiyuki');
    const rotation = [TUNE_BREAK_STEP_KEY];

    const bare = { ...createBuild(hiyuki), level: 90, rotation };
    const loaded = { ...setChain(createBuild(hiyuki), 6), level: 90, rotation };
    const bareSim = simulateRotation({ build: bare, dataset: d, target });
    const loadedSim = simulateRotation({ build: loaded, dataset: d, target });

    const step = bareSim.steps[0];
    assert('the step resolves to real damage', step.stepDamage > 0);
    assert('...at S6 it is the SAME damage — no gear stat and no chain node reaches it',
        loadedSim.steps[0].stepDamage === step.stepDamage);
    assert('...and it cannot crit: both branches are the one value',
        step.stepCrit === step.stepDamage && step.stepNonCrit === step.stepDamage);
    assert('...counted as one hit', step.hitCount === 1);

    // It matches the formula called directly, so the step adds no arithmetic
    // of its own — the wiring is the only thing between them.
    assert('the step is exactly computeTuneBreakDamage',
        step.stepDamage === computeTuneBreakDamage({
            status: 'tune_rupture', atkLv: 90, target,
            element: hiyuki.element, enemyType: 'overlord' }));

    assert('its own category, not folded into an attack bucket', step.skillType === 'tuneBreak');
    assert('...which survives the display-family collapse', damageFamily('tuneBreak') === 'tuneBreak');
    assert('...and has a badge and a label', !!STEP_TYPE.tuneBreak && TYPE_LABEL.tuneBreak === 'Tune Break');

    // Timing is MEASURED, not curated. The row is reached by trigger type
    // (`BreakWeaknessTrigger`) rather than by hit id, because it carries no
    // damage ids at all — which is why it needed its own route into the
    // extraction (map-timings.mjs, route 'breakWeakness').
    assert('it carries the resonator\'s own measured cast time',
        step.stepDuration === hiyuki.tuneBreak.stepDuration && step.stepDuration > 0);
    assert('...declared extracted, not estimated', step.timingSource === 'extracted');
    assert('...and it is NOT the fallback constant',
        Math.abs(step.stepDuration - TUNE_BREAK_CAST_TIME) > 1e-9);
    // It stops the combat clock for its whole animation, so gameTime does not
    // advance across it — measured TimeStopRequest, alongside a general-
    // invincibility tag and interrupt level 11.
    assert('it freezes the clock', step.freezeTime > 0);
    assert('...for the whole step, clamped to it like every other measured freeze',
        step.freezeTime === Math.min(hiyuki.tuneBreak.freezeTime, step.stepDuration));
    // The measured TimeStopRequest runs to the end of the ANIMATION while the
    // step ends at the actionable point, so the raw window can exceed the step
    // by ~15ms — unclamped that drives gameTime negative.
    assert('...which the raw measurement slightly exceeds',
        hiyuki.tuneBreak.freezeTime > step.stepDuration);
    assert('...and it is uninterruptible (level 11, where a Basic is 2)',
        step.interruptLevel === 11);
    assert('it is labelled with the node\'s own name', step.label === hiyuki.tuneBreak.name);
    assert('...and records what priced it', step.tuneBreak?.element === hiyuki.element
        && step.tuneBreak?.enemyType === 'overlord');
}

// ── Element and enemy class are the only two inputs ──────────────────────────
{
    const glacio = d.resonators.find(resonator => resonator.element === 1);
    const fusion = d.resonators.find(resonator => resonator.element === 2);
    const resisted = { level: 90, resistances: { [glacio.element]: 0.5 } };

    assert('the responder\'s OWN element picks the RES bucket',
        resolveTuneBreakStep({ resonator: glacio, level: 90, target: resisted }).damage
        < resolveTuneBreakStep({ resonator: fusion, level: 90, target: resisted }).damage);

    const overlord = resolveTuneBreakStep({ resonator: glacio, level: 90, target }).damage;
    const common = resolveTuneBreakStep({ resonator: glacio, level: 90,
        target: { ...target, enemyType: 'common' } }).damage;
    assert('enemy class scales it, 14x between Common and Overlord',
        Math.abs(overlord / common - 14) < 1e-9);
    assert('...and Overlord is the default the sim target implies',
        resolveTuneBreakStep({ resonator: glacio, level: 90, target }).enemyType === 'overlord');
}

// ── It is MANUAL: nothing puts it in a rotation on its own ───────────────────
{
    const inReferences = Object.entries(referenceRotations)
        .filter(([, entry]) => (entry.rotation ?? []).includes(TUNE_BREAK_STEP_KEY));
    assert('no reference rotation slots one', inReferences.length === 0);

    // It generates nothing, so an opener can never reach for it as filler.
    const carlotta = d.resonators.find(resonator => resonator.name === 'Carlotta');
    const rotation = referenceRotations['1107'].rotation.slice();
    const withBreak = [...rotation, TUNE_BREAK_STEP_KEY];
    const build = { ...setChain(createBuild(carlotta), 0), level: 90, rotation: withBreak };
    const sim = simulateRotation({ build, dataset: d, target, deriveOpeners: true });
    const breaks = sim.steps.filter(step => step.skillKey === TUNE_BREAK_STEP_KEY);
    assert('a slotted Tune Break survives opener derivation exactly once', breaks.length === 1);
    assert('...and spends its cast time on the clock',
        sim.totals.time >= TUNE_BREAK_CAST_TIME);
    assert('...generating no Resonance Energy', sim.energyTrace
        ?.find(entry => entry.stepIndex === breaks[0].index)?.rawGen === 0);
}

// ── Appending it works like any other step ───────────────────────────────────
{
    const verina = d.resonators.find(resonator => resonator.name === 'Verina');
    let build = createBuild(verina);
    build = appendRotationStep(build, TUNE_BREAK_STEP_KEY);
    build = appendRotationStep(build, TUNE_BREAK_STEP_KEY);
    const sim = simulateRotation({ build, dataset: d, target });
    assert('two responses are two steps', sim.steps.length === 2);
    assert('...both dealing damage, with no cooldown between them',
        sim.steps.every(step => step.stepDamage > 0 && !step.cd?.violated));
    assert('...and both counted in the total',
        Math.abs(sim.totals.damage - sim.steps[0].stepDamage * 2) < 1e-6);
}

// ── Game time does not advance across it ────────────────────────────────────
// The whole animation is a TimeStopRequest window, so in the ToA clock a Tune
// Break costs real seconds and zero game seconds. That is also why the team sim
// caps it at one per pass: each extra one would be damage at no cost to the DPS
// denominator.
{
    const hiyuki = d.resonators.find(resonator => resonator.name === 'Hiyuki');
    const base = { ...createBuild(hiyuki), level: 90,
        rotation: referenceRotations['1108'].rotation.slice() };
    const withBreak = { ...base, rotation: [...base.rotation, TUNE_BREAK_STEP_KEY] };
    const a = simulateRotation({ build: base, dataset: d, target });
    const b = simulateRotation({ build: withBreak, dataset: d, target });

    assert('it costs real time', b.totals.time > a.totals.time);
    assert('...and no game time at all',
        Math.abs(b.totals.gameTime - a.totals.gameTime) < 1e-6);
    assert('...so it is pure damage on the ToA clock', b.totals.damage > a.totals.damage);
    assert('game time never runs backwards', b.totals.gameTime >= 0);
}

// ── One per rotation: the team sim caps it, the build page only flags it ─────
{
    const hiyuki = d.resonators.find(resonator => resonator.name === 'Hiyuki');
    const skillMap = effectiveSkillMap(d, hiyuki.id);
    const flagsFor = (rotation) => analyzeRotation(rotation, { skillMap })
        .warnings.filter(warning => warning.gate === 'tuneBreakOncePerRotation');

    assert('one Tune Break is not flagged',
        flagsFor(['basic_present_1', TUNE_BREAK_STEP_KEY]).length === 0);
    const two = flagsFor([TUNE_BREAK_STEP_KEY, 'basic_present_1', TUNE_BREAK_STEP_KEY]);
    assert('a second one IS flagged', two.length === 1);
    assert('...on the SECOND one, not the first', two[0].index === 2);
    assert('...saying why in the note', /Off-Tune bar refills/.test(two[0].note));
    assert('a third adds another flag',
        flagsFor([TUNE_BREAK_STEP_KEY, TUNE_BREAK_STEP_KEY, TUNE_BREAK_STEP_KEY]).length === 2);

    // …but the build page still SIMULATES all of them: the flag is advice, and a
    // longer fight really does offer more than one.
    const build = { ...createBuild(hiyuki), level: 90,
        rotation: [TUNE_BREAK_STEP_KEY, TUNE_BREAK_STEP_KEY] };
    const sim = simulateRotation({ build, dataset: d, target });
    assert('the build page simulates every slotted response',
        sim.steps.filter(step => step.skillKey === TUNE_BREAK_STEP_KEY).length === 2);
}

// ── The team sim caps it at ONE PER PASS, for the whole team ─────────────────
{
    const ids = [1210, 1211, 1509];
    let team = createTeam();
    const builds = new Map();
    ids.forEach((id, index) => {
        const resonator = d.resonators.find(entry => entry.id === id);
        const build = setChain(createBuild(resonator), 0);
        build.level = 90;
        build.rotation = [...(referenceRotations[String(id)]?.rotation ?? ['intro']), TUNE_BREAK_STEP_KEY];
        builds.set(build.id, build);
        team = setTeamSlot(team, index, build.id);
    });
    const resolveBuild = (id) => builds.get(id) ?? null;

    for (const passCount of [1, 2, 3]) {
        const result = simulateTeamRotation({ team, resolveBuild, dataset: d,
            target: { level: 90, atkLv: 90, resistances: {} }, passCount });
        const cast = [...result.memberSteps.values()].flat()
            .filter(step => step.skillKey === TUNE_BREAK_STEP_KEY).length;
        assert(`${passCount} pass(es): exactly ${passCount} Tune Break(s) across three members`,
            cast === passCount);
        assert(`${passCount} pass(es): the surplus is reported, not silently dropped`,
            result.tuneBreaksDropped.reduce((total, row) => total + row.dropped, 0)
                === passCount * (ids.length - 1));
        assert(`${passCount} pass(es): each report names who lost one`,
            result.tuneBreaksDropped.every(row => row.resonatorName && row.dropped > 0));
    }
}

// ── The palette offers it to every resonator, beside the Echo Skill ─────────
{
    const missing = d.resonators.filter(resonator => {
        setApi({ dataset: d, build: createBuild(resonator), sonataOverride: null });
        return !renderRotationPalette().includes(TUNE_BREAK_STEP_KEY);
    });
    assert(`every resonator is offered the step (${missing.length} missing)`, missing.length === 0);

    // …including the ones whose Tune Break node has a kit name of its own, which
    // is where a bare node name would stop reading as a Tune Break.
    const kitNamed = d.resonators.find(resonator => !/^tune break/i.test(resonator.tuneBreak.name));
    setApi({ dataset: d, build: createBuild(kitNamed), sonataOverride: null });
    const kitHtml = renderRotationPalette();
    assert(`${kitNamed.name}'s button still leads with the mechanic`,
        kitHtml.includes(`Tune Break — ${kitNamed.tuneBreak.name}`));

    // Position: the button follows the Echo Skill one, in the same group. Needs
    // an echo that actually HAS an active skill — a fresh build has none, and
    // without one the Echo half of the group is legitimately absent.
    const carlotta = d.resonators.find(resonator => resonator.name === 'Carlotta');
    const activeEcho = d.echoes.find(echo => echo.activeSkill?.rateByLevel?.length);
    const withEcho = setEcho(createBuild(carlotta), 0,
        { id: activeEcho.id, cost: 4, level: 25, mainStat: null, subStats: [], sonataId: 1 });
    setApi({ dataset: d, build: withEcho, sonataOverride: null });
    const html = renderRotationPalette();
    const echoAt = html.indexOf(ECHO_STEP_KEY);
    const breakAt = html.indexOf(TUNE_BREAK_STEP_KEY);
    assert('the Echo Skill button is present to compare against', echoAt > -1);
    assert('...and the Tune Break button sits to the RIGHT of it',
        breakAt > -1 && breakAt > echoAt);
    assert('...under one heading that names both',
        /ECHO\s*(?:&|&amp;)\s*TUNE BREAK/.test(html));
    assert('...carrying its own badge, not an attack input\'s', html.includes('>TB</span>'));
}

console.log(`\ntune-break: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
