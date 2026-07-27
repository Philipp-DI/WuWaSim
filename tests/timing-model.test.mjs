/**
 * Tests for the two-clock timing model (docs/TIMING_MODEL.md) —
 * sim.js's resolveFreezeTime/resolveTimingSource/deriveGameTimes, the
 * freeze-fraction default (Liberation freezes its whole animation),
 * gameTime-based buff decay (buff-timeline.js), parallel zero-time echoes,
 * cooldowns.js's timeKey option, and the timingMode wiring through
 * simulateRotation/simulateTeamRotation.
 *
 *   node tests/timing-model.test.mjs
 *
 * Maintainer-confirmed mechanics (2026-07-23): a Resonance Liberation animation
 * freezes the in-game clock — cooldowns AND buff/effect/state durations pause,
 * and the DPS denominator (gameTime) excludes it. Non-transformation echoes cast
 * in parallel (zero timeline time). Outside a Liberation, freezeTime is 0 and
 * gameTime === realTime, so every other rotation is numerically unchanged.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { simulateRotation, __test__ as simTest } from '../src/core/sim.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { annotateStepCooldowns } from '../src/core/cooldowns.js';
import { stackTimeline } from '../src/core/buffs/buff-timeline.js';
import { createBuild, setEcho } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';

const { resolveFreezeTime, resolveTimingSource, deriveGameTimes } = simTest;

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const target = { level: 90, atkLv: 90, resistances: {} };

// ── resolveFreezeTime ────────────────────────────────────────────────────────
// Signature: resolveFreezeTime(skillDef, dataset, castTime, liberationCost).
// A Liberation only freezes on its CINEMATIC cast — an energy ultimate's
// resource-consuming initial cast: consumesResource !== false AND
// liberationCost (energyMax) > 0. LIB = an energy caster's cost for brevity.
{
    const LIB = 125;
    assert('no override, no defaults → 0', resolveFreezeTime({ skillType: 'liberation' }, {}, 0, LIB) === 0);
    assert('per-skill override wins (bypasses the cinematic gate)', resolveFreezeTime({ skillType: 'liberation', freezeTime: 1.2 }, {}) === 1.2);
    assert('a zero override is honored (not treated as falsy/missing)',
        resolveFreezeTime({ skillType: 'liberation', freezeTime: 0 }, {}) === 0);
    const ds = { skillMap: { _defaults: { freezeTimeBySkillType: { liberation: 0.8 } } } };
    assert('absolute per-type default used when no per-skill override (bypasses the gate)', resolveFreezeTime({ skillType: 'liberation' }, ds) === 0.8);
    assert('per-skill override still wins over per-type default',
        resolveFreezeTime({ skillType: 'liberation', freezeTime: 1.5 }, ds) === 1.5);
    assert('unrelated skillType falls through the per-type default to 0',
        resolveFreezeTime({ skillType: 'basic' }, ds) === 0);

    // Fraction-of-castTime freeze (freezeFractionBySkillType.liberation = 1),
    // subject to the cinematic gate — so an energy caster's cost is required.
    const dsFrac = { skillMap: { _defaults: { freezeFractionBySkillType: { liberation: 1 } } } };
    assert('fraction × castTime for a cinematic cast (whole animation frozen)',
        close(resolveFreezeTime({ skillType: 'liberation' }, dsFrac, 1.8, LIB), 1.8));
    assert('a half fraction freezes half the castTime',
        close(resolveFreezeTime({ skillType: 'liberation' }, { skillMap: { _defaults: { freezeFractionBySkillType: { liberation: 0.5 } } } }, 1.8, LIB), 0.9));
    assert('fraction needs a castTime (0 castTime → 0 freeze)',
        resolveFreezeTime({ skillType: 'liberation' }, dsFrac, 0, LIB) === 0);
    assert('absolute per-type default beats a fraction',
        resolveFreezeTime({ skillType: 'liberation' }, { skillMap: { _defaults: { freezeTimeBySkillType: { liberation: 0.8 }, freezeFractionBySkillType: { liberation: 1 } } } }, 1.8, LIB) === 0.8);
    assert('per-skill override beats a fraction',
        resolveFreezeTime({ skillType: 'liberation', freezeTime: 0.5 }, dsFrac, 1.8, LIB) === 0.5);
    assert('a non-liberation type gets no fraction freeze',
        resolveFreezeTime({ skillType: 'basic' }, dsFrac, 0.55, LIB) === 0);

    // Cinematic-Liberation gate (the multi-step + non-energy fixes).
    assert('a multi-stage continuation (consumesResource: false) does NOT freeze — e.g. Carlotta Death Knell/Fatal Finale',
        resolveFreezeTime({ skillType: 'liberation', consumesResource: false }, dsFrac, 1.8, LIB) === 0);
    assert('a NON-energy liberation-type step (energyMax 0) does NOT freeze — e.g. Lucilla/Phrolova enhanced attacks',
        resolveFreezeTime({ skillType: 'liberation' }, dsFrac, 1.8, 0) === 0);
    assert('an unknown liberationCost (null) does NOT freeze (never fabricate)',
        resolveFreezeTime({ skillType: 'liberation' }, dsFrac, 1.8, null) === 0);
    assert('the cinematic cast (consumesResource undefined, energyMax > 0) DOES freeze',
        close(resolveFreezeTime({ skillType: 'liberation' }, dsFrac, 1.8, LIB), 1.8));

    // Node-side fallback: wuwa-data.json has no injected skillMap (only the
    // browser loader merges skill-map.json), so tests + optimize.mjs rely on the
    // hardcoded liberation fraction. A cinematic cast still freezes whole-castTime.
    assert('hardcoded liberation freeze fallback (no dataset _defaults) = whole castTime',
        close(resolveFreezeTime({ skillType: 'liberation' }, {}, 1.8, LIB), 1.8));
    assert('hardcoded fallback still 0 for a non-liberation type',
        resolveFreezeTime({ skillType: 'skill' }, {}, 1.3, LIB) === 0);
}

// ── resolveTimingSource ──────────────────────────────────────────────────────
{
    assert('no override, no defaults → "estimated" (the honest default today)',
        resolveTimingSource({ skillType: 'basic' }, {}) === 'estimated');
    assert('valid per-skill override wins', resolveTimingSource({ timingSource: 'imported' }, {}) === 'imported');
    assert('invalid override falls back to estimated, never passed through raw',
        resolveTimingSource({ timingSource: 'guessed' }, {}) === 'estimated');
    const ds = { skillMap: { _defaults: { timingSourceBySkillType: { liberation: 'frame-counted' } } } };
    assert('per-type default used when no per-skill override',
        resolveTimingSource({ skillType: 'liberation' }, ds) === 'frame-counted');
    assert('per-skill override still wins over per-type default',
        resolveTimingSource({ skillType: 'liberation', timingSource: 'imported' }, ds) === 'imported');
}

// ── deriveGameTimes (synthetic freeze) ───────────────────────────────────────
{
    const step = (startTime, endTime, freezeTime = 0) => ({ startTime, endTime, freezeTime });

    // No freeze anywhere → gameTime === realTime for every step.
    const s1 = [step(0, 1), step(1, 2.5), step(2.5, 4)];
    const totalFreeze1 = deriveGameTimes(s1, 'toa');
    assert('zero freeze → total freeze consumed is 0', totalFreeze1 === 0);
    assert('zero freeze → gameStartTime/gameEndTime equal realTime for every step',
        s1.every(s => s.gameStartTime === s.startTime && s.gameEndTime === s.endTime));

    // A frozen step (e.g. a Liberation with 0.6s of its 1.8s cast frozen):
    // its OWN gameEndTime shrinks by the freeze, and every LATER step's
    // gameTime is shifted back by the same amount, while realTime is untouched.
    const s2 = [step(0, 1), step(1, 2.8, 0.6), step(2.8, 4)];
    const totalFreeze2 = deriveGameTimes(s2, 'toa');
    assert('freeze sum reported correctly', close(totalFreeze2, 0.6));
    assert('a step before the freeze is unaffected', s2[0].gameStartTime === 0 && s2[0].gameEndTime === 1);
    assert("the frozen step's own gameStartTime is still realTime (freeze applies to what happens AFTER it)",
        s2[1].gameStartTime === 1);
    assert("the frozen step's gameEndTime is shortened by its own freeze (castTime - freezeTime)",
        close(s2[1].gameEndTime, 2.8 - 0.6));
    assert('a later step is shifted back by the cumulative freeze on BOTH ends',
        close(s2[2].gameStartTime, 2.8 - 0.6) && close(s2[2].gameEndTime, 4 - 0.6));

    // 'open' mode ignores freezeTime entirely — single real-time clock.
    const s3 = [step(0, 1), step(1, 2.8, 0.6), step(2.8, 4)];
    const totalFreeze3 = deriveGameTimes(s3, 'open');
    assert("'open' mode never consumes freeze", totalFreeze3 === 0);
    assert("'open' mode → gameTime === realTime even for a step with freezeTime set",
        s3.every(s => s.gameStartTime === s.startTime && s.gameEndTime === s.endTime));
}

// ── stackTimeline: buffs freeze during a Liberation (gameTime decay) ─────────
{
    // basic gains a 5s stack, then a 6s-realTime Liberation that's FULLY frozen
    // (gameTime does not advance), then another basic. Under gameTime the first
    // stack is still alive at the post-Liberation step; under realTime it would
    // have expired during the (long) animation.
    const mk = (index, skillType, startTime, endTime, gameStartTime, gameEndTime) =>
        ({ index, skillType, startTime, endTime, gameStartTime, gameEndTime });
    const steps = [
        mk(0, 'basic', 0, 1, 0, 1),        // gain at gameEnd 1
        mk(1, 'liberation', 1, 7, 1, 1),   // 6s real animation, 0s game (frozen)
        mk(2, 'basic', 7, 8, 1, 2),        // realTime 7–8, gameTime 1–2
    ];
    const tl = stackTimeline(steps, { triggerTypes: ['basic'], maxStacks: 2, duration: 5 });
    assert('a stack survives a Liberation freeze (decays against gameTime)', (tl.byStepIndex[2] ?? 0) >= 1);
    assert('window start stays in realTime (the first gain)', tl.start === 1);
    assert('window end maps gameTime expiry back to realTime (gameExpiry 7 + 6s freeze offset = 13)',
        tl.end === 13);

    // Control: identical steps but gameTime === realTime (no freeze) — the first
    // stack expires exactly as it did before this model, proving the freeze is
    // what preserved it above.
    const noFreeze = steps.map(s => ({ ...s, gameStartTime: s.startTime, gameEndTime: s.endTime }));
    const tl2 = stackTimeline(noFreeze, { triggerTypes: ['basic'], maxStacks: 2, duration: 5 });
    assert('control: with no freeze the pre-Liberation stack expires (realTime decay)',
        (tl2.byStepIndex[2] ?? 0) === 0);

    // Alignment fix: a buff gained BEFORE a Liberation, active on steps AFTER it,
    // whose naive realGain+duration end (3.5) falls short of those steps' realTime
    // (4–6) — the strip used to be drawn too short / mispositioned. The freeze-
    // aware end must reach the last active step.
    const align = [
        mk(0, 'basic', 0, 1, 0, 1),        // gain at gameEnd 1
        mk(1, 'liberation', 1, 4, 1, 1),   // 3s real animation, 0s game (frozen)
        mk(2, 'basic', 4, 5, 1, 2),        // active via freeze
        mk(3, 'skill', 5, 6, 2, 3),        // active via freeze (skill ≠ trigger, no new gain)
    ];
    const tlA = stackTimeline(align, { triggerTypes: ['basic'], maxStacks: 1, duration: 2.5 });
    assert('alignment: buff is active on post-Liberation steps (gameTime decay)',
        (tlA.byStepIndex[2] ?? 0) >= 1 && (tlA.byStepIndex[3] ?? 0) >= 1);
    assert('alignment: window end covers those steps (naive realGain+dur = 3.5 would cut them off)',
        tlA.end >= 6 && tlA.end > 1 + 2.5);
}

// ── cooldowns.js timeKey option ──────────────────────────────────────────────
{
    const skillMap = { a: { cooldown: 10, cooldownGroup: 'g1' } };
    const step = (skillKey, startTime, gameStartTime, index) => ({ skillKey, startTime, gameStartTime, index });

    const sReal = [step('a', 0, 0, 0), step('a', 8, 8, 1)];
    const vReal = annotateStepCooldowns(sReal, { skillMap, timeKey: 'startTime' });
    assert('default/startTime key: 8s gap < 10s CD is a violation', vReal.length === 1);

    const sGame = [step('a', 0, 0, 0), step('a', 8, 12, 1)];
    const vGame = annotateStepCooldowns(sGame, { skillMap, timeKey: 'gameStartTime' });
    assert('gameStartTime key: reads gameStartTime (12s gap ≥ 10s CD), not startTime (8s) — legal',
        vGame.length === 0 && sGame[1].cd.violated === false);

    const sDefault = [step('a', 0, undefined, 0), step('a', 11, undefined, 1)];
    const vDefault = annotateStepCooldowns(sDefault, { skillMap });
    assert('no timeKey option → falls back to startTime', vDefault.length === 0);
}

// ── Multi-step + non-energy Liberations: only the cinematic cast freezes ─────
{
    // Carlotta (energy ultimate, energyMax 125): Era of New Wave is cinematic;
    // Death Knell / Fatal Finale are free continuations (consumesResource:false)
    // that must NOT freeze — else the whole enhanced-state sequence freezes and
    // gameTime collapses toward 0 (the bug this gate fixes).
    const carlotta = d.resonators.find(r => r.id === 1107);
    let bc = createBuild(carlotta);
    bc.rotation = ['liberation', 'liberation_death_knell', 'liberation_death_knell', 'liberation_fatal_finale'];
    const simC = simulateRotation({ build: bc, dataset: d, target });
    const froze = simC.steps.filter(s => s.freezeTime > 0);
    assert('Carlotta: exactly ONE step freezes (Era of New Wave, the cinematic cast)',
        froze.length === 1 && froze[0].skillKey === 'liberation');
    assert('Carlotta: Death Knell / Fatal Finale continuations do NOT freeze',
        simC.steps.filter(s => s.skillKey !== 'liberation').every(s => s.freezeTime === 0));
    assert('Carlotta: gameTime stays positive (no whole-rotation freeze) and below realTime',
        simC.totals.gameTime > 0 && simC.totals.gameTime < simC.totals.time);

    // Phrolova (non-energy ultimate, energyMax 0): her liberation-tagged steps
    // are enhanced on-field attacks, not cinematics — none should freeze.
    const phrolova = d.resonators.find(r => r.id === 1608);
    assert('Phrolova energyMax is 0 (non-energy ultimate — precondition for this test)',
        (d.baseStats?.['1608']?.energyMax ?? null) === 0);
    let bp = createBuild(phrolova);
    bp.rotation = ['liberation_hecate_1', 'liberation_hecate_2', 'liberation_curtain_call'];
    const simP = simulateRotation({ build: bp, dataset: d, target });
    assert('Phrolova: NO liberation-type step freezes (energyMax 0 → conservative, no over-freeze)',
        simP.steps.every(s => s.freezeTime === 0));
    assert('Phrolova: gameTime === realTime (nothing frozen)',
        close(simP.totals.gameTime, simP.totals.time));
}

// ── simulateRotation: Liberation freeze end-to-end ───────────────────────────
{
    const sanhua = d.resonators.find(r => r.id === 1102);

    // A rotation WITHOUT a Liberation is a pure no-op: gameTime === realTime.
    let bNoLib = createBuild(sanhua);
    bNoLib.rotation = ['skill', 'basic_1', 'basic_2'];
    const simNoLib = simulateRotation({ build: bNoLib, dataset: d, target });
    assert('no Liberation → gameTime === time (freeze-free rotation unchanged)',
        close(simNoLib.totals.gameTime, simNoLib.totals.time));
    assert('no Liberation → dps === damage/time',
        close(simNoLib.totals.dps, simNoLib.totals.damage / simNoLib.totals.time));

    // A rotation WITH a Liberation: its whole animation is frozen.
    let b = createBuild(sanhua);
    b.rotation = ['skill', 'basic_1', 'basic_2', 'liberation'];
    const sim = simulateRotation({ build: b, dataset: d, target });
    const libStep = sim.steps.find(s => s.skillType === 'liberation');
    assert('the Liberation step freezes its WHOLE animation (freezeTime === castTime)',
        libStep && libStep.freezeTime > 0 && close(libStep.freezeTime, libStep.castTime));
    assert('a frozen Liberation advances gameTime by 0 (gameEndTime === gameStartTime)',
        close(libStep.gameEndTime, libStep.gameStartTime));
    assert('every non-Liberation step still has freezeTime 0',
        sim.steps.filter(s => s.skillType !== 'liberation').every(s => s.freezeTime === 0));
    assert('gameTime excludes the Liberation freeze from the DPS denominator',
        close(sim.totals.gameTime, sim.totals.time - libStep.freezeTime) && sim.totals.gameTime < sim.totals.time);
    assert('dps is computed from gameTime (higher than the wall-clock time-based dps)',
        close(sim.totals.dps, sim.totals.damage / sim.totals.gameTime) && sim.totals.dps > sim.totals.damage / sim.totals.time);

    // 'open' mode ignores the freeze — single real-time clock.
    const simOpen = simulateRotation({ build: b, dataset: d, target, timingMode: 'open' });
    assert("'open' mode ignores the freeze → gameTime === time", close(simOpen.totals.gameTime, simOpen.totals.time));
    assert("'toa' and 'open' deal identical damage here (the Liberation is last, so no buff-window overlap shifts)",
        close(sim.totals.damage, simOpen.totals.damage));
    assert("'toa' dps exceeds 'open' dps (smaller gameTime denominator)", sim.totals.dps > simOpen.totals.dps);

    // Cooldown overlay still fires correctly through the gameTime path.
    let b2 = createBuild(sanhua);
    b2.rotation = ['skill', 'skill'];
    const simCd = simulateRotation({ build: b2, dataset: d, target });
    assert('cooldown overlay still works end-to-end through the gameTime path',
        simCd.cooldownViolations.length === 1 && simCd.steps[1].cd?.violated === true);
}

// ── simulateRotation: parallel (Summon) vs locking (Transform) echoes ────────
{
    const sanhua = d.resonators.find(r => r.id === 1102);
    // Fallacy of No Return — a damage echo whose desc does NOT start with
    // "Transform" (Summon/direct attack), so it casts in PARALLEL (fact 3).
    const parallel = d.echoes.find(e => e.name === 'Fallacy of No Return');
    // Dreamless — "Transform into Dreamless…": a transformation echo that LOCKS
    // the resonator (fact 4), so its step occupies ECHO_CAST_TIME.
    const transform = d.echoes.find(e => e.name === 'Dreamless');
    assert('classification precondition: Fallacy is parallel, Dreamless transforms',
        !/^\s*transform/i.test(parallel.activeSkill?.desc ?? '') && /^\s*transform/i.test(transform.activeSkill?.desc ?? ''));

    const equip = (echo) => setEcho(createBuild(sanhua), 0, { id: echo.id, cost: echo.cost ?? 4, level: 25, sonataId: null, mainStat: null, subStats: [] });

    // Parallel echo: same build, with vs without the echo step — isolates its cost.
    const bp = equip(parallel);
    const noEcho = simulateRotation({ build: { ...bp, rotation: ['basic_1'] }, dataset: d, target });
    const withEcho = simulateRotation({ build: { ...bp, rotation: ['basic_1', '__echo__'] }, dataset: d, target });
    assert('a parallel (Summon) echo step adds ZERO timeline time', close(noEcho.totals.time, withEcho.totals.time));
    assert('a parallel echo step still adds damage', withEcho.totals.damage > noEcho.totals.damage);
    const pStep = withEcho.steps.find(s => s.skillType === 'echo');
    assert('the parallel echo step is zero-width (startTime === endTime)', pStep && pStep.startTime === pStep.endTime);
    assert('the parallel echo step deals damage despite occupying no time', pStep.stepDamage > 0);
    assert('the parallel echo step carries freezeTime 0', pStep.freezeTime === 0);

    // Transformation echo: the step LOCKS → occupies ECHO_CAST_TIME (~1.2s).
    const bt = equip(transform);
    const noT = simulateRotation({ build: { ...bt, rotation: ['basic_1'] }, dataset: d, target });
    const withT = simulateRotation({ build: { ...bt, rotation: ['basic_1', '__echo__'] }, dataset: d, target });
    assert('a transformation echo step occupies timeline time (locks the resonator)',
        withT.totals.time > noT.totals.time);
    const tStep = withT.steps.find(s => s.skillType === 'echo');
    assert('the transformation echo step is non-zero-width and freezes nothing',
        tStep && tStep.endTime > tStep.startTime && tStep.freezeTime === 0);
    assert('the transformation echo lock uses ECHO_CAST_TIME', close(tStep.endTime - tStep.startTime, 1.2));
}

// ── simulateTeamRotation: gameTime + timingMode threading ────────────────────
{
    const sanhua = d.resonators.find(r => r.id === 1102);
    const mornye = d.resonators.find(r => r.id === 1209);

    const sb = createBuild(sanhua);
    sb.rotation = ['skill', 'basic_1', 'liberation'];   // has a Liberation → freeze applies
    const mb = createBuild(mornye);
    mb.rotation = ['basic_wide_field_observation_mode_1'];

    let team = createTeam();
    team = setTeamSlot(team, 0, sb.id);
    team = setTeamSlot(team, 1, mb.id);
    const builds = new Map([[sb.id, sb], [mb.id, mb]]);
    const resolveBuild = (id) => builds.get(id) ?? null;

    const r = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 1 });
    assert('team totals carry gameTime', typeof r.totals.gameTime === 'number');
    assert('team gameTime is below realTime once a member casts a Liberation',
        r.totals.gameTime < r.totals.time);
    assert('team dps is computed from gameTime', close(r.totals.dps, r.totals.damage / r.totals.gameTime));

    const rOpen = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 1, timingMode: 'open' });
    assert("'open' team sim reports gameTime === time (freeze ignored)", close(rOpen.totals.gameTime, rOpen.totals.time));
    assert("'open' team dps is below 'toa' team dps (larger denominator)", rOpen.totals.dps < r.totals.dps);

    // Empty team still reports the gameTime field (shape stability).
    const emptyTeam = createTeam();
    const rEmpty = simulateTeamRotation({ team: emptyTeam, resolveBuild, dataset: d, target });
    assert('empty-team result carries gameTime: 0', rEmpty.totals.gameTime === 0);
}

console.log(`timing-model: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
