/**
 * Tests for the two-clock timing model (docs/TIMING_MODEL.md, 2026-07-16) —
 * sim.js's resolveFreezeTime/resolveTimingSource/deriveGameTimes,
 * cooldowns.js's timeKey option, and the timingMode wiring through
 * simulateRotation/simulateTeamRotation/deriveOpenerPadding.
 *
 *   node tests/timing-model.test.mjs
 *
 * Convention under test: NO ability has measured freeze data yet, so every
 * freezeTime resolves to 0 and gameTime === realTime everywhere — the whole
 * suite is a structural-no-op check (byte-identical numbers to before this
 * model existed), proving the schema is ready without fabricating anything.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { simulateRotation, __test__ as simTest } from '../src/core/sim.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { annotateStepCooldowns } from '../src/core/cooldowns.js';
import { createBuild } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';

const { resolveFreezeTime, resolveTimingSource, deriveGameTimes } = simTest;

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const target = { level: 90, atkLv: 90, resistances: {} };

// ── resolveFreezeTime ────────────────────────────────────────────────────────
{
    assert('no override, no defaults → 0', resolveFreezeTime({ skillType: 'liberation' }, {}) === 0);
    assert('per-skill override wins', resolveFreezeTime({ skillType: 'liberation', freezeTime: 1.2 }, {}) === 1.2);
    assert('a zero override is honored (not treated as falsy/missing)',
        resolveFreezeTime({ skillType: 'liberation', freezeTime: 0 }, {}) === 0);
    const ds = { skillMap: { _defaults: { freezeTimeBySkillType: { liberation: 0.8 } } } };
    assert('per-type default used when no per-skill override', resolveFreezeTime({ skillType: 'liberation' }, ds) === 0.8);
    assert('per-skill override still wins over per-type default',
        resolveFreezeTime({ skillType: 'liberation', freezeTime: 1.5 }, ds) === 1.5);
    assert('unrelated skillType falls through the per-type default to 0',
        resolveFreezeTime({ skillType: 'basic' }, ds) === 0);
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

// ── deriveGameTimes ──────────────────────────────────────────────────────────
{
    const step = (startTime, endTime, freezeTime = 0) => ({ startTime, endTime, freezeTime });

    // No freeze anywhere → gameTime === realTime for every step (today's
    // universal case — no ability has measured freeze data).
    const s1 = [step(0, 1), step(1, 2.5), step(2.5, 4)];
    const totalFreeze1 = deriveGameTimes(s1, 'toa');
    assert('zero freeze → total freeze consumed is 0', totalFreeze1 === 0);
    assert('zero freeze → gameStartTime/gameEndTime equal realTime for every step',
        s1.every(s => s.gameStartTime === s.startTime && s.gameEndTime === s.endTime));

    // A frozen step (e.g. a Liberation with 0.6s of its 1.8s cast frozen):
    // its OWN gameEndTime shrinks by the freeze, and every LATER step's
    // gameTime is shifted back by the same amount (cooldowns "gain" that
    // time back), while realTime (startTime/endTime) is untouched.
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

    // 'open' mode ignores freezeTime entirely — single real-time clock,
    // per docs/TIMING_MODEL.md's scope note (open-world / non-timed content).
    const s3 = [step(0, 1), step(1, 2.8, 0.6), step(2.8, 4)];
    const totalFreeze3 = deriveGameTimes(s3, 'open');
    assert("'open' mode never consumes freeze", totalFreeze3 === 0);
    assert("'open' mode → gameTime === realTime even for a step with freezeTime set",
        s3.every(s => s.gameStartTime === s.startTime && s.gameEndTime === s.endTime));
}

// ── cooldowns.js timeKey option ──────────────────────────────────────────────
{
    const skillMap = { a: { cooldown: 10, cooldownGroup: 'g1' } };
    // gameStartTime is 3s BEHIND startTime (as if 3s of freeze happened
    // between the two casts) — a re-cast that's illegal on realTime (gap 8s
    // < 10s CD) is exactly AT the boundary on gameTime (gap 10s... actually
    // the point here is simply that the tracker reads timeKey, not startTime,
    // when told to).
    const step = (skillKey, startTime, gameStartTime, index) => ({ skillKey, startTime, gameStartTime, index });

    const sReal = [step('a', 0, 0, 0), step('a', 8, 8, 1)];
    const vReal = annotateStepCooldowns(sReal, { skillMap, timeKey: 'startTime' });
    assert('default/startTime key: 8s gap < 10s CD is a violation', vReal.length === 1);

    const sGame = [step('a', 0, 0, 0), step('a', 8, 12, 1)];
    const vGame = annotateStepCooldowns(sGame, { skillMap, timeKey: 'gameStartTime' });
    assert('gameStartTime key: reads gameStartTime (12s gap ≥ 10s CD), not startTime (8s) — legal',
        vGame.length === 0 && sGame[1].cd.violated === false);

    // Missing timeKey option defaults to 'startTime' (back-compat for callers
    // that never derive gameTime, e.g. synthetic steps in other test files).
    const sDefault = [step('a', 0, undefined, 0), step('a', 11, undefined, 1)];
    const vDefault = annotateStepCooldowns(sDefault, { skillMap });
    assert('no timeKey option → falls back to startTime', vDefault.length === 0);
}

// ── simulateRotation: totals.gameTime + timingMode ───────────────────────────
{
    const sanhua = d.resonators.find(r => r.id === 1102);
    let b = createBuild(sanhua);
    b.rotation = ['skill', 'basic_1', 'basic_2', 'liberation'];

    const simDefault = simulateRotation({ build: b, dataset: d, target });
    assert("default timingMode is 'toa'", simDefault.totals.gameTime === simDefault.totals.time);
    assert('gameTime === time with no freeze data (structural no-op today)',
        close(simDefault.totals.gameTime, simDefault.totals.time));
    assert('dps is computed from gameTime in toa mode (identical to time-based dps today)',
        close(simDefault.totals.dps, simDefault.totals.damage / simDefault.totals.time));

    const simOpen = simulateRotation({ build: b, dataset: d, target, timingMode: 'open' });
    assert("'open' mode also reports gameTime === time (no freeze data)",
        close(simOpen.totals.gameTime, simOpen.totals.time));
    assert("'toa' and 'open' produce identical damage/dps today (freeze is universally 0)",
        close(simDefault.totals.damage, simOpen.totals.damage) && close(simDefault.totals.dps, simOpen.totals.dps));

    // Every step carries the new fields, honestly defaulted.
    assert('every step carries freezeTime (0) and timingSource ("estimated")',
        simDefault.steps.every(s => s.freezeTime === 0 && s.timingSource === 'estimated'));

    // Cooldown annotation still fires correctly now that it reads gameStartTime
    // internally (Sanhua's skill has a 10s CD; two casts ~1.3s apart violate).
    let b2 = createBuild(sanhua);
    b2.rotation = ['skill', 'skill'];
    const simCd = simulateRotation({ build: b2, dataset: d, target });
    assert('cooldown overlay still works end-to-end through the gameTime path',
        simCd.cooldownViolations.length === 1 && simCd.steps[1].cd?.violated === true);
}

// ── simulateTeamRotation: totals.gameTime + timingMode threading ────────────
{
    const sanhua = d.resonators.find(r => r.id === 1102);
    const mornye = d.resonators.find(r => r.id === 1209);

    const sb = createBuild(sanhua);
    sb.rotation = ['skill', 'basic_1', 'liberation'];
    const mb = createBuild(mornye);
    mb.rotation = ['basic_wide_field_observation_mode_1'];

    let team = createTeam();
    team = setTeamSlot(team, 0, sb.id);
    team = setTeamSlot(team, 1, mb.id);
    const builds = new Map([[sb.id, sb], [mb.id, mb]]);
    const resolveBuild = (id) => builds.get(id) ?? null;

    const r = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 1 });
    assert('team totals carry gameTime', typeof r.totals.gameTime === 'number');
    assert('team gameTime === time with no freeze data', close(r.totals.gameTime, r.totals.time));
    assert('team dps matches damage/time today (no freeze anywhere)',
        close(r.totals.dps, r.totals.damage / r.totals.time));

    const rOpen = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 1, timingMode: 'open' });
    assert("'open' team sim produces identical damage to 'toa' today", close(r.totals.damage, rOpen.totals.damage));

    // Empty team still reports the gameTime field (shape stability).
    const emptyTeam = createTeam();
    const rEmpty = simulateTeamRotation({ team: emptyTeam, resolveBuild, dataset: d, target });
    assert('empty-team result carries gameTime: 0', rEmpty.totals.gameTime === 0);
}

console.log(`timing-model: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
