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

const { resolveFreezeTime, resolveFreezeSchedule, resolveTimingSource, deriveGameTimes,
    resolveStepDuration } = simTest;

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const target = { level: 90, atkLv: 90, resistances: {} };

// ── resolveFreezeTime ────────────────────────────────────────────────────────
// Signature: resolveFreezeTime(skillDef, dataset, stepDuration, liberationCost).
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

    // Fraction-of-stepDuration freeze (freezeFractionBySkillType.liberation = 1),
    // subject to the cinematic gate — so an energy caster's cost is required.
    const dsFrac = { skillMap: { _defaults: { freezeFractionBySkillType: { liberation: 1 } } } };
    assert('fraction × stepDuration for a cinematic cast (whole animation frozen)',
        close(resolveFreezeTime({ skillType: 'liberation' }, dsFrac, 1.8, LIB), 1.8));
    assert('a half fraction freezes half the stepDuration',
        close(resolveFreezeTime({ skillType: 'liberation' }, { skillMap: { _defaults: { freezeFractionBySkillType: { liberation: 0.5 } } } }, 1.8, LIB), 0.9));
    assert('fraction needs a stepDuration (0 stepDuration → 0 freeze)',
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
    // hardcoded liberation fraction. A cinematic cast still freezes whole-stepDuration.
    assert('hardcoded liberation freeze fallback (no dataset _defaults) = whole stepDuration',
        close(resolveFreezeTime({ skillType: 'liberation' }, {}, 1.8, LIB), 1.8));
    assert('hardcoded fallback still 0 for a non-liberation type',
        resolveFreezeTime({ skillType: 'skill' }, {}, 1.3, LIB) === 0);

    // Clamp to stepDuration. A measured TimeStopRequest can outlast the cancel
    // point (Carlotta regains control at 3.03s, stays frozen to 3.90s), i.e. the
    // freeze spills into the NEXT action — which a per-step model cannot hold.
    // Unclamped, the step advances gameTime by a NEGATIVE amount.
    assert('a measured freeze longer than the step is clamped to stepDuration',
        close(resolveFreezeTime({ skillType: 'liberation', freezeTime: 3.9 }, {}, 3.0335, LIB), 3.0335));
    assert('a freeze shorter than the step is left alone',
        close(resolveFreezeTime({ skillType: 'liberation', freezeTime: 1.5 }, {}, 3.0335, LIB), 1.5));
    assert('with no stepDuration supplied the override passes through unclamped',
        resolveFreezeTime({ skillType: 'liberation', freezeTime: 3.9 }, {}) === 3.9);
    assert('the absolute per-type default is clamped too',
        close(resolveFreezeTime({ skillType: 'liberation' }, ds, 0.5, LIB), 0.5));
}

// ── resolveStepDuration: the animation, or the damage, whichever is later ────
// A key credits its FULL kit multiplier every time it appears, so a step that
// ends while its own damage is still landing banks damage nobody waited for.
{
    const emptyDataset = {};
    assert('a step with no damage data is just its animation duration',
        resolveStepDuration({ skillType: 'basic', stepDuration: 0.5 }, emptyDataset) === 0.5);
    assert('damage that resolves BEFORE the queue point changes nothing',
        resolveStepDuration({ skillType: 'basic', stepDuration: 0.5, resolvesAt: 0.21 }, emptyDataset) === 0.5);
    assert('damage that resolves AFTER the queue point extends the step',
        resolveStepDuration({ skillType: 'basic', stepDuration: 0.8, resolvesAt: 2.28 }, emptyDataset) === 2.28);
    assert('resolvesAt alone still respects the per-type fallback when longer',
        resolveStepDuration({ skillType: 'liberation', resolvesAt: 0.4 }, emptyDataset) === 1.8);
    assert('a zero/absent resolvesAt never shortens a step',
        resolveStepDuration({ skillType: 'skill', stepDuration: 1.3, resolvesAt: 0 }, emptyDataset) === 1.3);
    // The lookup ladder below the max() is unchanged.
    assert('per-type dataset default is used when the skill has no measurement',
        resolveStepDuration({ skillType: 'basic' },
            { skillMap: { _defaults: { stepDurationBySkillType: { basic: 0.42 } } } }) === 0.42);
    assert('an unknown skillType falls back to 1.0 rather than collapsing to zero',
        resolveStepDuration({ skillType: 'nonsense' }, emptyDataset) === 1.0);

    // Camellya's Vining Waltz is the case the rule exists for: 20 instants at
    // 0.12s spacing, StateNextAtt open at 0.8s. Tapping through to Stage 5
    // lands 5 of 20 — so 0.8s cannot be the cost of all 20.
    const spin = d.autoSkillMap['1603'].basic_basic_attack_4;
    assert('Camellya\'s 20-hit spin is charged to its last hit, not its queue point',
        close(resolveStepDuration(spin, d), 2.28) && spin.stepDuration === 0.8);

    // Roster-wide: exactly the channels move, and every one of them moves UP.
    let extended = 0, shortened = 0;
    for (const map of Object.values(d.autoSkillMap)) {
        for (const def of Object.values(map)) {
            const animation = def.stepDuration ?? 0;
            const resolved = resolveStepDuration(def, d);
            if (animation > 0 && resolved > animation + 1e-9) extended++;
            if (animation > 0 && resolved < animation - 1e-9) shortened++;
        }
    }
    assert('the damage-aware rule only ever lengthens a step, never shortens one', shortened === 0);
    assert('it moves a small, bounded set of keys (the channels), not the roster',
        extended > 0 && extended < 25);
}

// ── resolveFreezeSchedule: one animation's freeze counts once ────────────────
{
    const LIB = 125;
    const ds = {};
    const map = {
        solar:  { skillType: 'forte_heavy', stepDuration: 3.0, freezeTime: 2.2, freezeSource: 'AM_Skill02' },
        stella: { skillType: 'forte_heavy', stepDuration: 3.0, freezeTime: 2.2, freezeSource: 'AM_Skill02' },
        burst:  { skillType: 'liberation',  stepDuration: 2.0, freezeTime: 1.5, freezeSource: 'AM_Burst01' },
        plain:  { skillType: 'basic',       stepDuration: 0.5 },
        // A measured freeze with no source identity can't be deduped — it stands
        // alone rather than being silently dropped.
        orphan: { skillType: 'liberation',  stepDuration: 2.0, freezeTime: 1.0 },
    };
    const sched = (rotation) => resolveFreezeSchedule(rotation, map, ds, LIB);

    assert('two keys sharing a source: only the first pays',
        JSON.stringify(sched(['solar', 'stella'])) === JSON.stringify([2.2, 0]));
    assert('distinct sources both pay',
        JSON.stringify(sched(['solar', 'burst'])) === JSON.stringify([2.2, 1.5]));
    assert('a repeated key re-casts the animation and freezes again',
        JSON.stringify(sched(['solar', 'solar'])) === JSON.stringify([2.2, 2.2]));
    assert('interleaving does not release the source (still one payout)',
        JSON.stringify(sched(['solar', 'plain', 'stella'])) === JSON.stringify([2.2, 0, 0]));
    assert('unknown + echo steps contribute 0 and do not disturb the credit',
        JSON.stringify(sched(['__echo__', 'nope', 'solar', 'stella'])) === JSON.stringify([0, 0, 2.2, 0]));
    assert('a sourceless measured freeze is kept, not dropped',
        JSON.stringify(sched(['orphan'])) === JSON.stringify([1.0]));
    assert('an empty rotation yields an empty schedule',
        JSON.stringify(sched([])) === JSON.stringify([]));
}

// ── resolveTimingSource ──────────────────────────────────────────────────────
{
    assert('no override, no defaults → "estimated" (the honest default today)',
        resolveTimingSource({ skillType: 'basic' }, {}) === 'estimated');
    // 'extracted'/'curated' are what preprocess.mjs actually stamps — they were
    // missing from the accepted set, so every measured step reported 'estimated'.
    assert('"extracted" (animation-asset measurement) is accepted',
        resolveTimingSource({ timingSource: 'extracted' }, {}) === 'extracted');
    assert('"curated" (timing-overrides.json pin) is accepted',
        resolveTimingSource({ timingSource: 'curated' }, {}) === 'curated');
    assert('invalid override falls back to estimated, never passed through raw',
        resolveTimingSource({ timingSource: 'guessed' }, {}) === 'estimated');
    // The retired sourcing ladder (docs/TIMING_MODEL.md "The pipeline",
    // 2026-07-31): a Maygi import or a frame-counted value is no longer a
    // legitimate provenance, so it must degrade to 'estimated' rather than be
    // accepted as if it were measured.
    assert('"imported" (retired: Maygi sheets) is rejected',
        resolveTimingSource({ timingSource: 'imported' }, {}) === 'estimated');
    assert('"frame-counted" (retired: footage) is rejected',
        resolveTimingSource({ timingSource: 'frame-counted' }, {}) === 'estimated');
    const ds = { skillMap: { _defaults: { timingSourceBySkillType: { liberation: 'curated' } } } };
    assert('per-type default used when no per-skill override',
        resolveTimingSource({ skillType: 'liberation' }, ds) === 'curated');
    assert('per-skill override still wins over per-type default',
        resolveTimingSource({ skillType: 'liberation', timingSource: 'extracted' }, ds) === 'extracted');
    assert('a retired value in a per-type default is rejected too',
        resolveTimingSource({ skillType: 'liberation' },
            { skillMap: { _defaults: { timingSourceBySkillType: { liberation: 'imported' } } } }) === 'estimated');
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
    assert("the frozen step's gameEndTime is shortened by its own freeze (stepDuration - freezeTime)",
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

// ── Multi-step Liberations: a MEASURED cinematic finale freezes too ──────────
{
    // Carlotta (energy ultimate, energyMax 125). Era of New Wave is the cinematic
    // cast; Death Knell is a free continuation (consumesResource:false) with no
    // measured freeze, so the estimate's gate keeps it at 0. Fatal Finale is a
    // continuation TOO, but it is a genuine cinematic finale with its own montage
    // (AM_Burst02) and its own 3.1783s TimeStopRequest — a measurement outranks
    // the gate that stands in for one, which is what closes the old "curated
    // is-cinematic flag" gap without any curation.
    const carlotta = d.resonators.find(r => r.id === 1107);
    let bc = createBuild(carlotta);
    bc.rotation = ['liberation', 'liberation_death_knell', 'liberation_death_knell', 'liberation_fatal_finale'];
    const simC = simulateRotation({ build: bc, dataset: d, target });
    const frozeC = simC.steps.filter(s => s.freezeTime > 0).map(s => s.skillKey);
    assert('Carlotta: the cinematic cast AND the measured Fatal Finale freeze',
        frozeC.length === 2 && frozeC[0] === 'liberation' && frozeC[1] === 'liberation_fatal_finale');
    assert('Carlotta: Death Knell (continuation, no measured freeze) does NOT freeze',
        simC.steps.filter(s => s.skillKey === 'liberation_death_knell').every(s => s.freezeTime === 0));
    assert('Carlotta: each freeze is clamped to its own step (gameTime never runs backwards)',
        simC.steps.every(s => s.gameEndTime >= s.gameStartTime - 1e-9));
    assert('Carlotta: gameTime stays positive (no whole-rotation freeze) and below realTime',
        simC.totals.gameTime > 0 && simC.totals.gameTime < simC.totals.time);

    // Phrolova (non-energy ultimate, energyMax 0): her liberation-tagged steps
    // are enhanced on-field attacks inside the summoned Hecate form, not
    // cinematics. Their 4.0s window comes from the coarse skillRow fallback
    // putting her whole ultimate clip on all five keys, so preprocess.mjs never
    // stamps it — the exclusion is now the data's shape (a shared fallback row),
    // not an energyMax guess.
    const phrolova = d.resonators.find(r => r.id === 1608);
    assert('Phrolova energyMax is 0 (non-energy ultimate — precondition for this test)',
        (d.baseStats?.['1608']?.energyMax ?? null) === 0);
    assert('Phrolova: no Hecate step carries a stamped freeze (shared skillRow row)',
        ['liberation_hecate_1', 'liberation_hecate_2', 'liberation_enhanced_attack_hecate_strings']
            .every(k => d.autoSkillMap['1608'][k].freezeTime === undefined));
    let bp = createBuild(phrolova);
    bp.rotation = ['liberation_hecate_1', 'liberation_hecate_2', 'liberation_curtain_call'];
    const simP = simulateRotation({ build: bp, dataset: d, target });
    assert('Phrolova: NO liberation-type step freezes (conservative, no over-freeze)',
        simP.steps.every(s => s.freezeTime === 0));
    assert('Phrolova: gameTime === realTime (nothing frozen)',
        close(simP.totals.gameTime, simP.totals.time));
}

// ── Freeze belongs to the ANIMATION: one source pays out once per rotation ───
{
    // Jinhsi's Incandescence fires Solar Flare and Stella Glamor off the SAME
    // montage (AM_Skill02) — two named damage rows of one cast. Charging both
    // the 2.2s freeze counted one animation as 4.4s of stopped clock, which
    // INFLATES DPS (freeze shrinks the denominator). Her curated reference
    // rotation contains both keys, so this shipped.
    const jinhsi = d.resonators.find(r => r.id === 1304);
    const solar = d.autoSkillMap['1304'].forte_heavy_illuminous_epiphany_solar_flare;
    const stella = d.autoSkillMap['1304'].forte_heavy_illuminous_epiphany_stella_glamor;
    assert('Jinhsi: both Incandescence rows carry the same measured freeze + freezeSource',
        solar.freezeTime > 0 && close(solar.freezeTime, stella.freezeTime)
        && solar.freezeSource && solar.freezeSource === stella.freezeSource);

    let bj = createBuild(jinhsi);
    bj.rotation = ['forte_heavy_illuminous_epiphany_solar_flare', 'forte_heavy_illuminous_epiphany_stella_glamor'];
    const simJ = simulateRotation({ build: bj, dataset: d, target });
    assert('one animation freezes ONCE — the second key sharing the source pays 0',
        close(simJ.steps[0].freezeTime, solar.freezeTime) && simJ.steps[1].freezeTime === 0);
    assert('total freeze is the animation\'s window, not a multiple of it',
        close(simJ.totals.time - simJ.totals.gameTime, solar.freezeTime));

    // A REPEATED key is a genuine re-cast and freezes every time — the dedup
    // keys on the source's first claimant, not on "seen this source".
    let bj2 = createBuild(jinhsi);
    bj2.rotation = ['forte_heavy_illuminous_epiphany_solar_flare', 'forte_heavy_illuminous_epiphany_solar_flare'];
    const simJ2 = simulateRotation({ build: bj2, dataset: d, target });
    assert('the same key cast twice freezes twice (a re-cast replays the animation)',
        close(simJ2.steps[0].freezeTime, solar.freezeTime) && close(simJ2.steps[1].freezeTime, solar.freezeTime));

    // Order-independence: whichever of the sharing keys comes first pays.
    let bj3 = createBuild(jinhsi);
    bj3.rotation = ['forte_heavy_illuminous_epiphany_stella_glamor', 'forte_heavy_illuminous_epiphany_solar_flare'];
    const simJ3 = simulateRotation({ build: bj3, dataset: d, target });
    assert('the FIRST step of a shared source pays it, whichever key that is',
        close(simJ3.steps[0].freezeTime, solar.freezeTime) && simJ3.steps[1].freezeTime === 0);
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

    // A rotation WITH a Liberation freezes for its MEASURED window. This used to
    // assert freezeTime === stepDuration, from the HARDCODED_FREEZE_FRACTIONS
    // estimate that a Liberation freezes its whole animation. Real extracted data
    // supersedes that: the freeze is the montage's TsAnimNotifyStateTimeStopRequest
    // window, which is close to but not equal to the full animation (Sanhua:
    // 1.5016s of a 1.6202s cast), so a short unfrozen remainder is expected.
    let b = createBuild(sanhua);
    b.rotation = ['skill', 'basic_1', 'basic_2', 'liberation'];
    const sim = simulateRotation({ build: b, dataset: d, target });
    const libStep = sim.steps.find(s => s.skillType === 'liberation');
    assert('the Liberation step freezes a measured window (0 < freezeTime <= stepDuration)',
        libStep && libStep.freezeTime > 0 && libStep.freezeTime <= libStep.stepDuration + 1e-9);
    assert('a frozen Liberation advances gameTime only by its unfrozen remainder',
        close(libStep.gameEndTime - libStep.gameStartTime,
            libStep.stepDuration - libStep.freezeTime));
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

// ── Roster-wide: measured timings reach the sim, and the dataset is coherent ─
// resolveTimingSource's accepted set had never been updated for what
// preprocess.mjs actually stamps, so all ~1,020 measured steps reported
// 'estimated' downstream — a measured number and a per-type guess looked alike.
{
    let extracted = 0, curated = 0, estimated = 0, provisional = 0;
    let freezeStamped = 0, badClamp = 0, sourceless = 0;
    for (const [rid, map] of Object.entries(d.autoSkillMap)) {
        for (const [key, def] of Object.entries(map)) {
            const source = resolveTimingSource(def, d);
            if (source === 'extracted') extracted++;
            else if (source === 'curated') curated++;
            else if (source === 'estimated') estimated++;
            if (def.timingProvisional) provisional++;
            if (!(def.freezeTime > 0)) continue;
            freezeStamped++;
            if (!def.freezeSource) { sourceless++; console.error(`    ${rid}.${key} has a freeze with no freezeSource`); }
            // A stamped freeze must survive resolution without exceeding its step.
            const stepDuration = def.stepDuration ?? 0;
            if (resolveFreezeTime(def, d, stepDuration, 125) > stepDuration + 1e-9) badClamp++;
        }
    }
    assert('most of the roster resolves to a MEASURED provenance, not "estimated"',
        extracted > 900 && extracted > estimated * 10);
    assert('curated pins resolve as "curated"', curated > 0);
    assert('the unreachable remainder still resolves as "estimated" (honest, not zero)', estimated > 0);
    assert('provisional steps are flagged for the UI', provisional > 0);
    assert('every stamped freeze carries the identity of the animation it came from',
        freezeStamped > 0 && sourceless === 0);
    assert('no stamped freeze survives resolution longer than its own step', badClamp === 0);

    // The freeze belongs to an animation, so a resonator can only over-freeze if
    // two of its keys share a source — which resolveFreezeSchedule collapses.
    // Assert the dataset still HAS such pairs, so the dedup is load-bearing.
    let sharedPairs = 0;
    for (const map of Object.values(d.autoSkillMap)) {
        const seen = new Set();
        for (const def of Object.values(map)) {
            if (!(def.freezeTime > 0) || !def.freezeSource) continue;
            if (seen.has(def.freezeSource)) sharedPairs++;
            seen.add(def.freezeSource);
        }
    }
    assert('the roster still contains freeze sources shared by several keys (dedup is load-bearing)',
        sharedPairs > 0);
}

// ---------------------------------------------------------------------------
// The extraction artifact's marker vocabulary (phase 1).
//
// data/actionable-times.json no longer publishes a bare `stepDuration`: it
// publishes the MARKERS under the game's own names plus the rule that picked
// between them, so the weakest rung (the montage's authored length, which
// includes the idle-return tail) can never be mistaken for the strongest
// (StateNextAtt, an actual measurement of when input is accepted).
// ---------------------------------------------------------------------------
{
    const artifact = JSON.parse(readFileSync(resolve(__dirname, '../data/actionable-times.json'), 'utf8'));
    const entries = [];
    for (const [rid, keys] of Object.entries(artifact.actionableTimes)) {
        for (const [key, entry] of Object.entries(keys)) entries.push({ rid, key, entry });
    }

    const RULES = new Set(['nextAtt', 'skillEnd', 'idleReturn', 'sequenceLength']);
    // Spelled as data, not as identifiers, so a future global rename cannot
    // quietly turn this assertion into a tautology — which is exactly what a
    // sed over this file did on first writing.
    const RETIRED_NAMES = ['actionableAt', 'cancelWindowOpensAt', 'cancelWindowDuration', 'skillEnd', 'firesAt'];
    const retired = entries.filter(({ entry }) => RETIRED_NAMES.some(name => name in entry));
    assert('the retired field names are gone from the artifact', retired.length === 0);
    assert('every entry carries a step duration and the rule that produced it',
        entries.every(({ entry }) => typeof entry.stepDuration === 'number' && RULES.has(entry.stepDurationRule)));

    // The rule must AGREE with the markers, or it is decoration.
    const misruled = entries.filter(({ entry }) =>
        (entry.stepDurationRule === 'nextAtt') !== (entry.nextAttAt != null)
        || (entry.stepDurationRule === 'skillEnd' && entry.nextAttAt != null));
    assert('stepDurationRule matches which markers the entry actually has', misruled.length === 0);

    // sequenceLength is only defensible where NO terminal marker exists at all.
    const seqRule = entries.filter(({ entry }) => entry.stepDurationRule === 'sequenceLength');
    assert('the sequenceLength rung is reachable but rare, and only without any terminal marker',
        seqRule.length > 0 && seqRule.length < 60
        && seqRule.every(({ entry }) => entry.nextAttAt == null && entry.skillEndAt == null && entry.idleReturnAt == null));

    // Damage instants are ordered and bracketed by their own ends.
    const badDamage = entries.filter(({ entry }) => entry.damageAt && (
        entry.firstDamageAt !== entry.damageAt[0]
        || entry.resolvesAt !== entry.damageAt[entry.damageAt.length - 1]
        || entry.damageAt.some((instant, i) => i > 0 && instant < entry.damageAt[i - 1])));
    assert('firstDamageAt/resolvesAt bracket a sorted damageAt', badDamage.length === 0);

    // Row-sourced facts are suppressed, never guessed, when the rows disagree.
    const stamina = entries.filter(({ entry }) => entry.staminaCost != null);
    assert('staminaCost is a positive STA figure, not the raw negative x100 source',
        stamina.length > 0 && stamina.every(({ entry }) => entry.staminaCost >= 0 && entry.staminaCost <= 100));
    // Camellya's Form B basics are the case that forced unanimity-gating: a
    // ground row (0 STA) and an air row (5 STA) point at the same montage, and
    // the ground spin is confirmed free in-game.
    assert('a montage reached from rows that disagree on stamina reports null',
        artifact.actionableTimes['1603'].skill_vining_waltz_3.staminaCost === null);
    assert('a montage whose rows agree still reports the cost',
        artifact.actionableTimes['1603'].heavy_heavy_attack.staminaCost === 25);

    // Switch behaviour is a WINDOW, not a flag.
    const switching = entries.filter(({ entry }) => entry.switchBehavior);
    assert('switchBehavior entries carry timed windows, not booleans',
        switching.length > 0 && switching.every(({ entry }) =>
            [...(entry.switchBehavior.endsOnSwitch ?? []), ...(entry.switchBehavior.cannotSwitch ?? [])]
                .every(window => typeof window.from === 'number')));
    const camellyaSpin = artifact.actionableTimes['1603'].basic_basic_attack_4;
    assert('Camellya\'s 20-hit spin ends on switch only from 1.2s, not from its start',
        camellyaSpin.switchBehavior.endsOnSwitch[0].from === 1.2);

    // The tap/hold collision: same damage ids, different repeat counts.
    const blazing = artifact.actionableTimes['1603'].skill_blazing_waltz;
    assert('the hold half of a tap/hold pair is moved onto the loop animation',
        blazing.tapHoldRole === 'hold' && blazing.chosenAsHoldLoop === true
        && /_Loop\.uasset$/.test(blazing.sourceMontage) && blazing.isLoop === true);
    assert('the tap half stays on the entry animation',
        artifact.actionableTimes['1603'].skill_vining_waltz_3.sourceMontage.endsWith('AM_Attack03_Ex.uasset'));

    // A loop's markers are per-iteration, so every loop key must reach the
    // dataset flagged — silently passing one iteration off as the whole held
    // action is the failure this flag exists to prevent.
    const loopKeys = entries.filter(({ entry }) => entry.isLoop);
    const unflagged = loopKeys.filter(({ rid, key, entry }) => {
        const def = d.autoSkillMap[rid]?.[key];
        // A loop with no usable duration never reaches the dataset at all.
        return entry.stepDuration > 0 && def && !def.timingIsLoop;
    });
    assert('every loop key that reaches the dataset is flagged as per-iteration',
        loopKeys.length > 0 && unflagged.length === 0);
}

console.log(`timing-model: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
