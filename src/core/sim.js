// src/core/sim.js
/**
 * Rotation simulator — pure, no DOM.
 *
 * Given a build (with its rotation array) + dataset + target, walks the
 * rotation in order and produces:
 *
 *   - per-step damage + cast duration
 *   - cumulative running totals
 *   - aggregate totals (damage, time, DPS, hit count)
 *
 * Linear cast sequence with per-skill cast times. Cooldowns are tracked as a
 * diagnostic overlay (annotateStepCooldowns — flags too-early re-casts, never
 * changes damage/time); no swap windows.
 *
 *   simulateRotation({ build, dataset, target }) -> SimResult
 *
 * Returns a SimResult even on empty input — callers always get a
 * stable shape and can render zeroed UI without branching.
 */

import { resolveTotalStats } from './stats.js';
import { annotateStepCooldowns } from './cooldowns.js';
import { resolveSkill, resolveEchoSkill, resolveSupport } from './skill.js';
import { weaponConditionalContribution, sonataConditionalContribution } from './buffs/conditional-buffs.js';
import { unlockedEffects, effectsActiveAtStepDetailed } from './buffs.js';

import {
    computeBuffWindows, applyBuffsToSteps, windowStacksAtStep,
    deriveBuffWindows, deriveEffectWindows, deriveStateWindows,
} from './buffs/buff-windows.js';

// Weapon conditional amplify → per-hit amplify scopes (the format skill.js
// expects: { scope: {type:'element', elementId} | {type:'skillType', skillType},
// value }). amplifyByElement/Type are matched against each hit's element / type.
function weaponAmplifyScopes(weaponConditional) {
    const out = [];
    for (const [el, value] of Object.entries(weaponConditional?.amplifyByElement ?? {})) out.push({ scope: { type: 'element', elementId: Number(el) }, value: value });
    for (const [type, value] of Object.entries(weaponConditional?.amplifyByType ?? {})) out.push({ scope: { type: 'skillType', skillType: type }, value: value });
    if ((weaponConditional?.amplifyAll ?? 0) > 0) out.push({ scope: { type: 'element', elementId: null }, value: weaponConditional.amplifyAll });
    return out;
}
import { computeStateTimeline } from './rotation-state.js';
import { stateDefsForResonator } from './rotation-rules.js';

// P11 §3a — map a step's skillType to one of the seven display categories used
// by step bars, tooltips, legends, and the totals donut.
const SKILL_TYPE_TO_DMG_CATEGORY = Object.freeze({
    basic: 'basic', midair: 'basic', heavy: 'heavy',
    skill: 'skill', liberation: 'liberation',
    forte_basic: 'basic', forte_heavy: 'heavy', forte: 'skill',
    echo: 'echo', intro: 'intro', outro: 'outro',
});

const dmgCategoryFor = (skillType) => SKILL_TYPE_TO_DMG_CATEGORY[skillType] ?? 'skill';

// Phrase-types a cast step satisfies, for matching castMatch triggers
// ("after casting Resonance Skill" → 'skill'). A step may satisfy several
// (e.g. a forte step counts as both its node type and 'forte').
// The mechanical CAST phrase-types a step satisfies — the categories a
// `castMatch` trigger ("after casting a Resonance Liberation") can fire on.
// Deliberately MECHANICAL-only (reads the node skillType, NOT the damage
// formulaType): "casting X" is a mechanical cast event, distinct from the
// damage-bonus BUCKET a hit lands in. Folding formulaType in here (as this did
// before 2026-07-15) made a Basic Attack that deals a CONVERTED damage type
// falsely satisfy a cast-trigger for that type — e.g. Chisa's Basic "Death
// Snip" (skillType basic, formulaType liberation) wrongly fired the
// liberation cast-trigger of her inherent "All Ends Here", turning its Havoc
// buff on two steps before she actually cast her Liberation. formulaType stays
// authoritative for DMG-bonus matching (a per-hit mechanism), never for cast
// triggers.
// Exported (2026-07-15): team-sim.js reuses this to match a team-wide chain
// effect's castMatch trigger against team-time steps (chain-effect window
// derivation) — one mechanical-cast matcher, never re-derived.
export function phraseTypesForStep(skillType) {
    const type = skillType || '';
    const out = [];
    if (type.startsWith('basic') || type === 'midair') out.push('basic');
    if (type.includes('heavy')) out.push('heavy');
    if (type === 'skill') out.push('skill');
    if (type === 'liberation') out.push('liberation');
    if (type.startsWith('forte')) out.push('forte');
    if (type === 'intro') out.push('intro');
    if (type === 'outro') out.push('outro');
    return out;
}

// Whether an effect is unconditional (always-on) — always-on effects are baked
// into totals and are not buff-bar / window items.
function isUnconditionalEffect(effect) {
    return effect.window ? effect.window.type === 'always'
        : (effect.conditionKind ?? 'unconditional') === 'unconditional';
}

// De-duped display names of the CONDITIONAL effects in an active set (skips
// unconditional always-on effects — they are not buff-bar items).
function conditionalNamesOf(effects) {
    const out = [];
    const seen = new Set();
    for (const effect of effects) {
        if (isUnconditionalEffect(effect)) continue;
        const name = effect.condition || `${effect.stat} buff`;
        if (!seen.has(name)) { seen.add(name); out.push(name); }
    }
    return out;
}

// Special rotation step key for "cast equipped echo's active skill".
// Distinct from character skill keys so it can never collide.
export const ECHO_STEP_KEY = '__echo__';

export const ECHO_CAST_TIME = 1.20;   // typical echo-skill animation length

// Fill an echo active-skill desc's {i} placeholders with its parameter values
// (max rank — builds equip max-rank echoes) for display, e.g. Bell-Borne
// Geochelone's full "…{3} DMG Boost for the current team members…" text. Kept
// on the echo step (step.echoDesc) so the rotation/step tooltip can show the
// real skill description (skillMap has no '__echo__' entry) — 2026-07-15.
export function fillEchoDesc(activeSkill) {
    if (!activeSkill?.desc) return null;
    const params = activeSkill.params?.[activeSkill.params.length - 1] ?? activeSkill.params?.[0];
    if (!Array.isArray(params)) return activeSkill.desc;
    return activeSkill.desc.replace(/\{(\d+)\}/g, (_, i) => params[Number(i)] ?? `{${i}}`);
}

// Fallback step durations when neither the skill nor data/_defaults provides
// one. Tuned to roughly match in-game animation lengths. Override per-skill in
// skill-map.json with `stepDuration`.
const HARDCODED_STEP_DURATIONS = Object.freeze({
    basic: 0.55,
    heavy: 1.40,
    skill: 1.30,
    liberation: 1.80,
    intro: 0.80,
    outro: 1.00,
    midair: 0.60,
    forte_basic: 0.80,
    forte_heavy: 1.60,
    echo: 1.20,
});

// Freeze fractions (× stepDuration) — the ESTIMATE used where no measured
// freeze exists, and the source of truth for which skill types can freeze the
// in-game clock at all. A Liberation freezes its whole animation (fraction 1) —
// maintainer-confirmed 2026-07-23 (docs/TIMING_MODEL.md). Most Liberations now
// carry a real measured window instead (preprocess.mjs stamps skillDef
// .freezeTime), so this covers the ones extraction could not reach. Lives in
// code (not skill-map.json) because the Node consumers (tests, optimize.mjs)
// load wuwa-data.json directly, which has no injected skillMap. A dataset can
// still override per-type via _defaults.freezeFractionBySkillType (see
// resolveFreezeTime) if a curated value is ever wanted.
const HARDCODED_FREEZE_FRACTIONS = Object.freeze({
    liberation: 1,
});

// Returns the best available skill map for a resonator. Curated
// (skill-map.json) takes priority; auto-generated (nanoka) is fallback.
// Shared by every rotation-editing UI (classic + v2 build pages).
export function effectiveSkillMap(dataset, resonatorId) {
    const curated = dataset.skillMap?.[String(resonatorId)];
    if (curated && Object.keys(curated).some(k => !k.startsWith('_'))) return curated;
    const auto = dataset.autoSkillMap?.[String(resonatorId)];
    if (auto && Object.keys(auto).length > 0) return auto;
    return null;
}

/**
 * How many seconds of the timeline one rotation step occupies
 * (docs/TIMING_MODEL.md).
 *
 * Two quantities, and the LATER one wins:
 *
 *   1. The animation's own duration — the marker `stepDurationRule` names,
 *      normally `StateNextAtt`, which is when the next skill can be QUEUED.
 *      Lookup order: skillDef.stepDuration (measured, or a skill-map override)
 *      -> dataset.skillMap._defaults.stepDurationBySkillType[<type>]
 *      -> HARDCODED_STEP_DURATIONS[<type>] -> 1.0.
 *   2. `resolvesAt` — when this key's damage has finished landing.
 *
 * Taking the max is forced by how damage is credited: a key applies its FULL
 * kit multiplier every time it appears in a rotation. Camellya's Vining Waltz
 * is the clearest case — 20 damage instants at 0.12s spacing, `StateNextAtt`
 * open at 0.8s. Cancelling into Stage 5 at 0.8s lands 5 of the 20 hits, so
 * charging the rotation 0.8s while paying out all 20 credits damage nobody
 * waited for. Either the damage shrinks or the clock grows; the clock is the
 * side we can measure, so it grows.
 *
 * That makes "the action fully resolves" the default, which is what a player
 * who is not deliberately cancelling actually does. An EARLY cancel is a
 * different action and belongs in the rotation as its own explicit step —
 * that is where DT_SkillInfo.InterruptLevel earns its place, not here.
 *
 * 9 keys roster-wide have damage after their queue point; every other step is
 * numerically unchanged.
 */
export function resolveStepDuration(skillDef, dataset) {
    return Math.max(animationDurationOf(skillDef, dataset), skillDef?.resolvesAt ?? 0);
}

function animationDurationOf(skillDef, dataset) {
    if (typeof skillDef?.stepDuration === 'number' && skillDef.stepDuration > 0) {
        return skillDef.stepDuration;
    }
    const map = dataset?.skillMap || {};
    const fromDefaults = map._defaults?.stepDurationBySkillType?.[skillDef?.skillType];
    if (typeof fromDefaults === 'number' && fromDefaults > 0) return fromDefaults;
    const hard = HARDCODED_STEP_DURATIONS[skillDef?.skillType];
    if (typeof hard === 'number') return hard;
    return 1.0;
}

// ── Two-clock timing model (docs/TIMING_MODEL.md) ──────────────────────────
// gameTime advances by stepDuration - freezeTime; realTime (the `cursor` /
// step.startTime/endTime) advances by the full stepDuration. During a freeze
// window the in-game clock is paused: cooldowns AND buff/effect/state
// durations all stop, and the DPS denominator excludes it (the ToA-benchmark
// convention community DPS figures use). A Resonance Liberation freezes for
// its WHOLE animation (freezeFractionBySkillType.liberation = 1) —
// maintainer-confirmed 2026-07-23. Outside a Liberation freezeTime is 0, so
// gameTime === realTime and every clock below is numerically unchanged.

/**
 * Resolve a skill's freeze window (seconds of stepDuration during which the
 * in-game clock — cooldowns + buff/effect/state durations — is paused).
 * Lookup order mirrors resolveStepDuration:
 *   1. skillDef.freezeTime                                        (per-skill absolute override)
 *   2. dataset.skillMap._defaults.freezeTimeBySkillType[<type>]         (absolute)
 *   3. (dataset.skillMap._defaults.freezeFractionBySkillType[<type>]
 *       ?? HARDCODED_FREEZE_FRACTIONS[<type>]) × stepDuration  — subject to the
 *       cinematic-Liberation gate below
 *   4. 0
 *
 * Path 1 is a MEASURED window (preprocess.mjs stamps the animation's own
 * TsAnimNotifyStateTimeStopRequest) and deliberately outranks the gate: real
 * data beats the heuristic that stands in for it, which is how a genuine
 * cinematic FINALE (Carlotta's Fatal Finale) freezes despite being a cost-free
 * continuation. Paths 2–3 are estimates and stay gated: only the resource-
 * consuming initial cast of an ENERGY ultimate freezes, so a continuation
 * (`consumesResource === false`) and any liberation-type step of a NON-energy
 * "ultimate" (`liberationCost` ≤ 0 / energyMax 0 — Lucilla, Phrolova, whose
 * liberation-tagged steps are enhanced on-field attacks) get 0 rather than
 * freezing once per step and collapsing gameTime toward 0. `liberationCost` is
 * the caster's energyMax (baseStats), passed by the sim.
 *
 * The result is CLAMPED to `stepDuration` when one is supplied: a measured
 * TimeStopRequest can outlast the cancel point (Carlotta's Liberation regains
 * control at 3.03s but stays frozen to 3.90s), i.e. the freeze spills into the
 * NEXT action — which a per-step model cannot represent. Left unclamped the
 * step advances gameTime by a negative amount and the clock runs backwards.
 * Clamping is also the conservative direction (never inflates DPS).
 *
 * Freeze is resolved per SKILL here; counting it once per ANIMATION across a
 * rotation is resolveFreezeSchedule's job (see there).
 */
export function resolveFreezeTime(skillDef, dataset, stepDuration = 0, liberationCost = null) {
    const clamp = (freeze) => stepDuration > 0 ? Math.min(freeze, stepDuration) : freeze;
    if (typeof skillDef?.freezeTime === 'number' && skillDef.freezeTime >= 0) {
        return clamp(skillDef.freezeTime);
    }
    const map = dataset?.skillMap || {};
    const fromDefaults = map._defaults?.freezeTimeBySkillType?.[skillDef?.skillType];
    if (typeof fromDefaults === 'number' && fromDefaults >= 0) return clamp(fromDefaults);
    const fraction = map._defaults?.freezeFractionBySkillType?.[skillDef?.skillType]
        ?? HARDCODED_FREEZE_FRACTIONS[skillDef?.skillType];
    if (typeof fraction !== 'number' || fraction < 0 || stepDuration <= 0) return 0;
    // Cinematic-Liberation gate (non-liberation freeze types, none today, skip it).
    if (skillDef?.skillType === 'liberation'
        && (skillDef.consumesResource === false || !(liberationCost > 0))) return 0;
    return stepDuration * fraction;
}

/**
 * Per-rotation-index freeze windows, with ONE ANIMATION'S FREEZE COUNTED ONCE.
 *
 * A measured freeze belongs to the animation that carries the notify, not to
 * the dataset key — and several keys routinely resolve to one animation, either
 * because one cast deals several named damage rows (Jinhsi's Incandescence
 * fires both Solar Flare and Stella Glamor off `AM_Skill02`) or because the
 * extraction's join is coarser than the kit. Charging each such step the full
 * freeze counts a single 2.2s animation as 4.4s of stopped clock, which
 * inflates DPS — the unsafe direction, since freeze SHRINKS the denominator.
 *
 * So a `freezeSource` (preprocess.mjs stamps the montage path / row id beside
 * the freeze) pays out once per rotation. A repeated key is a genuine RE-cast
 * and keeps freezing every time; it is only DIFFERENT keys sharing one source
 * that collapse. Over-counting realTime is left alone by contrast — it deflates
 * DPS, the safe direction.
 *
 * @returns {number[]} freeze seconds per rotation index (0 for echo/unknown steps)
 */
export function resolveFreezeSchedule(rotation, skillMap, dataset, liberationCost = null) {
    const creditedTo = new Map();   // freezeSource → the key that already paid it
    return (rotation ?? []).map(key => {
        const skillDef = skillMap?.[key];
        if (!skillDef) return 0;
        const freeze = resolveFreezeTime(skillDef, dataset, resolveStepDuration(skillDef, dataset), liberationCost);
        if (!(freeze > 0) || !skillDef.freezeSource) return freeze > 0 ? freeze : 0;
        if (!creditedTo.has(skillDef.freezeSource)) creditedTo.set(skillDef.freezeSource, key);
        return creditedTo.get(skillDef.freezeSource) === key ? freeze : 0;
    });
}

// Regex classifying an echo's active-skill by its description prefix
// (maintainer-verified in-game 2026-07-24): a "Transform" echo makes you BECOME
// and control the echo → it LOCKS the resonator for its animation, so its step
// occupies timeline time. Everything else — "Summon" (a helper that fights
// alongside while you keep acting) and direct-attack echoes — casts in PARALLEL
// (fact 3), contributing damage + energy at ZERO timeline time.
const ECHO_TRANSFORM_DESC = /^\s*transform/i;

/**
 * Timeline time an echo's `__echo__` step occupies. Transformation echoes (desc
 * starts with "Transform") LOCK the resonator → ECHO_CAST_TIME (the last
 * fabricated timing constant in the engine: echo animations live in the Monster
 * asset tree, which the resonator-timing extraction never covered, and the real
 * transform sequence is longer — so this under-counts, conservatively). All
 * other echoes are parallel → 0.
 *
 * Takes an echo DEFINITION so the sim and the opener classify identically —
 * they disagreed until 2026-07-30, the opener charging every echo the full
 * ECHO_CAST_TIME including the ~115 parallel ones.
 */
export function echoStepTimeOf(echoDef) {
    return ECHO_TRANSFORM_DESC.test(echoDef?.activeSkill?.desc ?? '') ? ECHO_CAST_TIME : 0;
}

/** echoStepTimeOf for the build's slot-0 echo. */
export function resolveEchoStepTime(build, dataset) {
    const slot0 = build?.echoes?.[0];
    return echoStepTimeOf(slot0 ? dataset?.echoes?.find(echo => echo.id === slot0.id) : null);
}

// The complete provenance vocabulary — one per pipeline tier
// (docs/TIMING_MODEL.md "The pipeline"). 'imported' (Maygi's sheets) and
// 'frame-counted' (yt-dlp/ffmpeg footage) were removed 2026-07-31 along with
// the sourcing ladder they belonged to: both would introduce a number nobody
// can re-derive, sitting indistinguishable beside extracted ones. Anything
// outside this set is rejected, not passed through.
const TIMING_SOURCES = new Set(['extracted', 'curated', 'estimated']);

/**
 * Resolve the provenance of a skill's timing data (stepDuration/freezeTime), per
 * docs/TIMING_MODEL.md's required `timingSource` field — so downstream UI/output
 * never presents a fabricated number as if it were measured. 'extracted' (read
 * from the game's own animation assets) covers most of the roster; 'curated' is
 * a maintainer pin in data/timing-overrides.json — a decision about WHICH
 * animation a key resolves to, never a hand-written time. Defaults to
 * 'estimated' — the per-type HARDCODED_STEP_DURATIONS fallback, still the
 * honest answer for the steps extraction could not reach (summon / DoT / field
 * damage with no player animation to measure).
 */
export function resolveTimingSource(skillDef, dataset) {
    if (TIMING_SOURCES.has(skillDef?.timingSource)) return skillDef.timingSource;
    const map = dataset?.skillMap || {};
    const fromDefaults = map._defaults?.timingSourceBySkillType?.[skillDef?.skillType];
    if (TIMING_SOURCES.has(fromDefaults)) return fromDefaults;
    return 'estimated';
}

/**
 * Stamp step.gameStartTime/step.gameEndTime from each step's realTime
 * (startTime/endTime) and freezeTime, in place. Must be called on steps in
 * ascending realTime order (the natural order they're simulated in).
 *
 * timingMode:
 *   'toa'  — ToA-benchmark convention (default): freezeTime is honored,
 *            gameTime pauses during a frozen animation.
 *   'open' — open-world / non-timed convention: freezeTime is ignored
 *            (per docs/TIMING_MODEL.md's scope note), gameTime === realTime.
 *
 * @returns {number} total freeze consumed (0 in 'open' mode; in 'toa' mode
 *   the summed Liberation-animation freeze).
 */
export function deriveGameTimes(steps, timingMode = 'toa') {
    let freezeSum = 0;
    for (const step of steps) {
        step.gameStartTime = step.startTime - freezeSum;
        if (timingMode === 'toa') freezeSum += step.freezeTime ?? 0;
        step.gameEndTime = step.endTime - freezeSum;
    }
    return freezeSum;
}

// Per-step real + game start/end times (seconds from rotation start), computed
// in a cheap upfront pass so computeStateTimeline can resolve exit.mode
// 'seconds' states (a real elapsed-time expiry, e.g. Cantarella's Mirage
// lasting 8s) BEFORE the main walk runs, and so the walk can decay effect
// 'seconds' windows against gameTime. Mirrors the stepDuration/freezeTime
// resolution the main walk applies per step kind — kept separate rather than
// fed back into the main loop to avoid touching its established branching.
// gameStart/gameEnd mirror deriveGameTimes exactly (a step's own freeze counts
// against its gameEnd, not its gameStart), so the two clocks agree per step.
// The returned `freeze` array is the once-per-animation schedule (see
// resolveFreezeSchedule) and is what the main walk stamps on each step, so the
// pre-pass and the walk can never disagree about a step's freeze.
function computeStepTimes(rotation, skillMap, dataset, timingMode = 'toa', liberationCost = null, echoStepDuration = 0) {
    const start = [], end = [], gameStart = [], gameEnd = [];
    const freeze = resolveFreezeSchedule(rotation, skillMap, dataset, liberationCost);
    let time = 0, freezeSum = 0;
    for (let i = 0; i < rotation.length; i++) {
        const key = rotation[i];
        // Echo step time: 0 for parallel echoes, ECHO_CAST_TIME for a
        // transformation echo that locks the resonator (resolveEchoStepTime).
        const stepDuration = key === ECHO_STEP_KEY ? echoStepDuration
            : skillMap[key] ? resolveStepDuration(skillMap[key], dataset) : 0;
        start.push(time);
        gameStart.push(time - freezeSum);
        if (timingMode === 'toa') freezeSum += freeze[i];
        time += stepDuration;
        end.push(time);
        gameEnd.push(time - freezeSum);
    }
    return { start, end, gameStart, gameEnd, freeze };
}

/**
 * Walk the build's rotation and produce a step-by-step damage breakdown.
 *
 * @param {object} args
 * @param {object} args.build
 * @param {object} args.dataset    - loaded dataset (includes skillMap)
 * @param {object} args.target     - { level, atkLv, resistances }
 * @returns {SimResult}
 *
 * SimResult shape:
 *   {
 *     steps: [{
 *       index, skillKey, label, skillType,
 *       stepDuration,                 // seconds
 *       startTime, endTime,       // seconds from rotation start
 *       stepDamage,               // expected damage for this step
 *       stepCrit, stepNonCrit,
 *       hitCount,                 // number of damage instances rolled
 *       cumulativeDamage,         // running total after this step
 *       resolved,                 // full ResolvedSkill from skill.js
 *       missing,                  // true if the skill key isn't in skillMap
 *     }],
 *     totals: {
 *       damage, crit, nonCrit,
 *       time,                     // sum of actionable-at times in seconds
 *       dps,                      // damage / time (0 when time is 0)
 *       hits,                     // total damage instances across all steps
 *       stepCount,                // number of rotation steps simulated
 *       missingSteps,             // count of rotation steps with no skill data
 *     },
 *     stats,                       // resolveTotalStats(build, dataset) snapshot
 *     energyTrace: [{              // P11.5 — informational only, never gates stepDamage
 *       stepIndex, energyBefore, energyAfter,
 *       liberationCastable,        // bool at a liberation step, else null (n/a)
 *       rawGen,                    // base (pre-ER) energy generated by this step
 *       rawConcertoGen,            // base Concerto (swap gauge) generated by this step
 *       isLiberation,              // true at a liberation cast (even if cost unknown)
 *     }],
 *   }
 */
export function simulateRotation({ build, dataset, target, amplifyContext = null, enemyStatuses = null, teamBuffs = null, externalBuffWindows = null, timingMode = 'toa' }) {
    const stats = resolveTotalStats(build, dataset, enemyStatuses, teamBuffs);

    // Weapon conditional AMPLIFY (e.g. Frostburn's "Glacio DMG Amplified by 28%",
    // gated by Glacio-Chafe triggerability) folds into the per-hit amplify bucket
    // alongside any outro amplify. Stat / DMG-bonus parts already applied in
    // resolveTotalStats; the multiplicative amplify must be applied per hit so it
    // only multiplies the matching element / skill type.
    const weaponDef = build?.weapon ? dataset?.weapons?.find(weapon => weapon.id === build.weapon.id) : null;
    const wResonator = dataset?.resonators?.find(resonator => resonator.id === build?.resonatorId);
    const weaponConditional = weaponConditionalContribution(weaponDef, build?.weapon?.rank ?? 1, wResonator, dataset, enemyStatuses);
    const sonataConditional = sonataConditionalContribution(build, dataset, wResonator, enemyStatuses);
    // Team-wide amplify (L3) folds in via the same per-hit amplify path as the
    // weapon/sonata conditional amplify.
    const effectiveAmplify = [...(amplifyContext ?? []), ...weaponAmplifyScopes(weaponConditional), ...weaponAmplifyScopes(sonataConditional), ...weaponAmplifyScopes(teamBuffs ?? {})];

    const rotation = Array.isArray(build?.rotation) ? build.rotation : [];
    // Use curated skill-map.json first, then auto-generated nanoka map as fallback
    const rid = String(build?.resonatorId);
    const curated = dataset?.skillMap?.[rid];
    const hasCurated = curated && Object.keys(curated).some(k => !k.startsWith('_'));
    const skillMap = hasCurated ? curated : (dataset?.autoSkillMap?.[rid] ?? {});

    const steps = [];
    let cumulative = 0;
    let cursor = 0;
    let totalCrit = 0;
    let totalNonCrit = 0;
    let totalHits = 0;
    let missingSteps = 0;

    // ── P11.5 — energy trace (P12 prerequisite) ────────────────────────────────
    // Purely informational: tracks whether the rotation, as authored, had
    // enough energy for each Liberation cast. Never gates stepDamage — see
    // docs/P12-PREREQ-ENERGY-CHECK.md §3b. Starting energy is 0 (documented
    // cold-start convention). Liberation cost comes from the legacy
    // RoleInfo-sourced baseStats table (already in the dataset, unrelated to
    // the nanoka skill pipeline) — `null` when unknown for this resonator
    // (e.g. a data gap), never fabricated as castable/not-castable.
    const liberationCost = dataset?.baseStats?.[String(build?.resonatorId)]?.energyMax ?? null;
    let energyCursor = 0;
    const energyTrace = [];

    // ── Per-step chain/inherent effect resolution (P11 §A) ────────────────────
    // Effects resolve from the rotation via trigger × window — one path for the
    // build and team sims. Precompute the state timeline (for stateBound windows)
    // and the unlocked effect pool, then track trigger fires AS WE WALK so each
    // step sees only buffs granted by EARLIER casts (a cast never buffs its own
    // step — the documented approximation).
    const resonator = dataset?.resonators?.find(resonator => resonator.id === build?.resonatorId) ?? null;
    const stateDefs = stateDefsForResonator(build?.resonatorId);
    const echoStepDuration = resolveEchoStepTime(build, dataset);
    const stepTimes = computeStepTimes(rotation, skillMap, dataset, timingMode, liberationCost, echoStepDuration);
    const stateTimeline = computeStateTimeline(rotation, skillMap, stateDefs, stepTimes);
    const unlocked = unlockedEffects(build, resonator);

    // Trigger-fire tracking, keyed by phrase-type. Updated after each step.
    const firedTypes = new Set();
    const lastFireEndByType = new Map();
    const fireCountByType = new Map();
    // Same tracking, keyed by the EXACT rotation step key (not the broad
    // skillType category) — for triggers that must distinguish between sibling
    // moves sharing a category (e.g. Changli's True Sight Conquest/Charge vs.
    // her base True Sight Capture, all skillType:'skill'). See trigger.skillKeys
    // in buffs.js's castMatch resolution.
    const firedKeys = new Set();
    const lastFireEndByKey = new Map();
    const fireCountByKey = new Map();
    const condNamesByStep = [];   // conditional buff names active at each step index
    const effectKeysByStep = [];  // per step: Set of ACTIVE conditional effect slot keys (for effect windows)

    for (let i = 0; i < rotation.length; i++) {
        const skillKey = rotation[i];

        // Resolve which chain/inherent effects are active at THIS step (trigger ×
        // window, from earlier casts + the state timeline), scaled by stacks.
        // Evaluated for EVERY step — echo/missing steps too — so effect windows
        // and the buff timeline don't artificially break across steps that skip
        // damage resolution (a timed buff is still ticking during an Echo cast).
        const stepDetailed = effectsActiveAtStepDetailed(unlocked, {
            // gameTime (freeze-aware): effect 'seconds' windows pause during a
            // Liberation, like every other in-game timer. Equals cursor when no
            // earlier Liberation froze the clock.
            startTime: stepTimes.gameStart[i],
            activeStates: stateTimeline.activeAt[i] ?? new Set(),
            resonanceMode: build?.resonanceMode ?? null,
            firedTypes, lastFireEndByType, fireCountByType,
            firedKeys, lastFireEndByKey, fireCountByKey,
        });
        const stepActiveEffects = stepDetailed.map(x => x.effect);
        for (const { effect, key } of stepDetailed) {
            if (!isUnconditionalEffect(effect)) (effectKeysByStep[i] ??= new Set()).add(key);
        }
        condNamesByStep[i] = conditionalNamesOf(stepActiveEffects);

        // Special step: cast the equipped slot-0 echo's active skill.
        // Resolved against the echo's own multiplier table, not the
        // character damageTable.
        if (skillKey === ECHO_STEP_KEY) {
            const slot0 = build.echoes?.[0];
            const echoDef = slot0 ? dataset.echoes?.find(echo => echo.id === slot0.id) : null;
            const resolved = slot0
                ? resolveEchoSkill({ echo: slot0, dataset, stats, target })
                : null;
            // Echo step time (resolveEchoStepTime, computed once above): 0 for a
            // parallel echo (Summon / direct attack — fact 3), ECHO_CAST_TIME for
            // a transformation echo that LOCKS the resonator (fact 4). (The
            // opener's own ECHO_CAST_TIME scheduling heuristic is unchanged.)
            const stepDuration = echoStepDuration;

            if (!resolved) {
                // No echo equipped, or echo has no active skill — show the step
                // at zero so the user can see it's not contributing.
                steps.push({
                    index: i, skillKey, label: 'Echo Skill (no echo equipped)',
                    skillType: 'echo', stepDuration, startTime: cursor, endTime: cursor + stepDuration,
                    freezeTime: 0, timingSource: 'estimated',
                    stepDamage: 0, stepCrit: 0, stepNonCrit: 0, hitCount: 0,
                    cumulativeDamage: cumulative, resolved: null, missing: !slot0,
                });
                // No echo equipped / no active skill → no cast, no energy.
                // (Equipped echoes DO generate energy — see the resolved
                // branch below; the former P11.5 gap closed 2026-07-12.)
                energyTrace.push({ stepIndex: i, energyBefore: energyCursor, energyAfter: energyCursor, liberationCastable: null, rawGen: 0, rawConcertoGen: 0, isLiberation: false });
                cursor += stepDuration;
                continue;
            }

            const stepDamage = resolved.totalExpected ?? 0;
            cumulative += stepDamage;
            totalCrit += resolved.totalCrit ?? 0;
            totalNonCrit += resolved.totalNonCrit ?? 0;
            totalHits += resolved.hits.length ?? 0;

            steps.push({
                index: i, skillKey,
                label: `Echo Skill: ${resolved.echoName}`,
                skillType: 'echo',
                stepDuration, startTime: cursor, endTime: cursor + stepDuration,
                freezeTime: 0, timingSource: 'estimated',
                stepDamage,
                stepCrit: resolved.totalCrit ?? 0,
                stepNonCrit: resolved.totalNonCrit ?? 0,
                hitCount: resolved.hits.length ?? 0,
                cumulativeDamage: cumulative,
                echoDesc: fillEchoDesc(echoDef?.activeSkill),
                resolved, missing: false,
            });
            // Echo Skill Resonance Energy (2026-07-12, closing the P11.5 gap):
            // the echo's own damage instance carries a base `energy` value
            // (extracted ÷100 as activeSkill.energyGain), accumulated exactly
            // like a character cast. Concerto stays 0 — echo element_power is
            // zero across all 163 echoes (data-verified).
            {
                const energyBefore = energyCursor;
                const rawGen = echoDef?.activeSkill?.energyGain ?? 0;
                energyCursor += rawGen * stats.energyRegen;
                if (liberationCost != null) energyCursor = Math.min(energyCursor, liberationCost);
                energyTrace.push({ stepIndex: i, energyBefore, energyAfter: energyCursor, liberationCastable: null, rawGen, rawConcertoGen: 0, isLiberation: false });
            }
            cursor += stepDuration;
            continue;
        }

        const skillDef = skillMap[skillKey];

        if (!skillDef) {
            // Unknown skill key — keep the step visible at zero damage so
            // the user can spot and remove it instead of it silently
            // vanishing on load.
            missingSteps++;
            steps.push({
                index: i, skillKey, label: skillKey, skillType: 'unknown',
                stepDuration: 0, startTime: cursor, endTime: cursor,
                freezeTime: 0, timingSource: 'estimated',
                stepDamage: 0, stepCrit: 0, stepNonCrit: 0, hitCount: 0,
                cumulativeDamage: cumulative,
                resolved: null, missing: true,
            });
            energyTrace.push({ stepIndex: i, energyBefore: energyCursor, energyAfter: energyCursor, liberationCastable: null, rawGen: 0, rawConcertoGen: 0, isLiberation: false });
            continue;
        }

        const stepDuration = resolveStepDuration(skillDef, dataset);
        // Once-per-animation freeze, precomputed for the whole rotation so this
        // step and the computeStepTimes pre-pass agree (resolveFreezeSchedule).
        const freezeTime = stepTimes.freeze[i];
        const timingSource = resolveTimingSource(skillDef, dataset);
        const resolved = resolveSkill({ skillDef, build, dataset, stats, target, amplifyContext: effectiveAmplify,
                                        activeEffects: stepActiveEffects });

        const stepDamage  = resolved?.totalExpected ?? 0;
        const stepCrit    = resolved?.totalCrit     ?? 0;
        const stepNonCrit = resolved?.totalNonCrit  ?? 0;
        const hitCount    = resolved?.hits.length   ?? 0;

        // Aggregate heal + shield from the skill's support rows (if any).
        const support = resolved?.supportOutput ?? null;
        const stepHeal   = support ? support.filter(row => row.rowType === 'heal')  .reduce((total, row) => total + row.value, 0) : 0;
        const stepShield = support ? support.filter(row => row.rowType === 'shield').reduce((total, row) => total + row.value, 0) : 0;

        // For pure-support steps (no damage rows, only heal/shield), also try
        // resolving support directly when resolveSkill returned null.
        let effectiveSupport = support;
        if (!resolved && skillDef.supportIds?.length) {
            effectiveSupport = resolveSupport({ skillDef, build, dataset, stats });
        }
        const finalHeal   = effectiveSupport ? effectiveSupport.filter(row => row.rowType === 'heal')  .reduce((total, row) => total + row.value, 0) : stepHeal;
        const finalShield = effectiveSupport ? effectiveSupport.filter(row => row.rowType === 'shield').reduce((total, row) => total + row.value, 0) : stepShield;

        cumulative   += stepDamage;
        totalCrit    += stepCrit;
        totalNonCrit += stepNonCrit;
        totalHits    += hitCount;

        steps.push({
            index: i, skillKey,
            label:     skillDef.label || skillKey,
            skillType: skillDef.skillType,
            stepDuration,
            startTime: cursor,
            endTime:   cursor + stepDuration,
            freezeTime, timingSource,
            // 'state' | 'phaseOnly' — set by preprocess.mjs on a measured time
            // known to be conditional or understated; absent when it isn't.
            timingProvisional: skillDef.timingProvisional ?? null,
            stepDamage, stepCrit, stepNonCrit, hitCount,
            stepHeal:   finalHeal,
            stepShield: finalShield,
            supportOutput: effectiveSupport,
            cumulativeDamage: cumulative,
            resolved,
            missing: false,
        });

        // P11.5 — energy accumulator. Castability is checked against
        // energyBefore (energy available BEFORE this step's own generation,
        // matching "was enough energy available at the moment it was cast").
        // A scripted Liberation cast always fully consumes the gauge (resets
        // to 0) once its cost is known — the rotation is authored as
        // something the player actually executes, so downstream steps assume
        // it happened, regardless of whether the built ER met the cost at
        // that point. `liberationCastable` is the separate legitimacy flag
        // for that question (maintainer-directed 2026-07-12, superseding the
        // narrower 2026-07-10 "only spend when castable" rule).
        // `consumesResource === false` marks a multi-stage Liberation's free
        // continuation/alt-resource stage (e.g. Augusta's "Sublime is the
        // Sun" follow-up, which costs Majesty stacks, not Resonance Energy)
        // — mechanically still a Liberation-category cast, but not a
        // gauge-consuming one.
        const isCostConsuming = skillDef.skillType === 'liberation' && skillDef.consumesResource !== false;
        const energyBefore = energyCursor;
        let liberationCastable = null;
        if (isCostConsuming) {
            liberationCastable = liberationCost == null ? null : energyBefore >= liberationCost;
            if (liberationCost != null) energyCursor = 0;
        }
        const rawGen = skillDef.energyGen ?? 0;
        energyCursor += rawGen * stats.energyRegen;
        // Resonance Energy is a real, non-negative quantity capped at the
        // Liberation cost (a resonator can never bank more than one cast's
        // worth) — same invariant as team-energy.js's accumulateEnergy.
        if (liberationCost != null) energyCursor = Math.min(energyCursor, liberationCost);
        energyCursor = Math.max(energyCursor, 0);
        energyTrace.push({
            stepIndex: i, energyBefore, energyAfter: energyCursor, liberationCastable,
            // Base (pre-ER) generation + liberation marker — the team-energy
            // layer (P13) re-accumulates these under other members' ER values
            // (off-field 50% rule) without re-running the sim.
            // rawConcertoGen: per-cast Concerto (swap gauge, max 100) — the
            // team sim owns the gauge; solo rotations never swap.
            rawGen, rawConcertoGen: skillDef.concertoGen ?? 0,
            isLiberation: isCostConsuming,
        });

        // Register this step's trigger fires so LATER steps can see them. Uses
        // gameEnd (freeze-aware) so a cast's 'seconds' window decays against the
        // in-game clock — matching the gameTime ctx.startTime above.
        const endT = stepTimes.gameEnd[i];
        for (const phraseType of phraseTypesForStep(skillDef.skillType)) {
            firedTypes.add(phraseType);
            lastFireEndByType.set(phraseType, endT);
            fireCountByType.set(phraseType, (fireCountByType.get(phraseType) ?? 0) + 1);
        }
        firedKeys.add(skillKey);
        lastFireEndByKey.set(skillKey, endT);
        fireCountByKey.set(skillKey, (fireCountByKey.get(skillKey) ?? 0) + 1);
        cursor += stepDuration;
    }

    const time = cursor;

    // §3a — attach the display damage category to every step.
    for (const step of steps) step.damageCategory = dmgCategoryFor(step.skillType);

    // Two-clock model (docs/TIMING_MODEL.md): stamp step.gameStartTime/
    // gameEndTime NOW, before buff windows + cooldowns are computed, so sonata
    // stack timelines, effect/state windows, and cooldowns all decay against
    // gameTime — durations freeze during a Liberation animation. A no-op
    // (gameTime === realTime) for any rotation without a Liberation.
    const totalFreeze = deriveGameTimes(steps, timingMode);

    // Compute conditional sonata buff active-windows over the rotation.
    // Own conditional-buff windows PLUS any received team-wide buff windows
    // (team-sim.js's team-buff timeline, already shifted to this rotation's
    // local time and marked `external: true`). Externals participate in
    // damage scaling (applyBuffsToSteps) and per-step buff names EXACTLY like
    // own windows — literal team-time overlap, maintainer-directed 2026-07-15 —
    // but are skipped by team-sim's display extraction (the granting member's
    // segment already renders them in the team-wide lane).
    const buffWindows = [
        ...computeBuffWindows(build, dataset, steps, enemyStatuses),
        ...(externalBuffWindows ?? []),
    ];

    // Apply conditional buffs to step damage. A buff window affects a step if
    // the step's start time falls within [window.start, window.end). The buff
    // scales matching damage: element buffs only boost matching-element hits,
    // atk buffs boost all hits (approximated as a flat damage multiplier since
    // ATK feeds linearly into the pre-crit damage).
    applyBuffsToSteps(steps, buffWindows);

    // Recompute totals from the (possibly buffed) per-step values.
    cumulative = 0; totalCrit = 0; totalNonCrit = 0;
    let totalHeal = 0, totalShield = 0;
    for (const step of steps) {
        cumulative += step.stepDamage;
        totalCrit += step.stepCrit;
        totalNonCrit += step.stepNonCrit;
        totalHeal += step.stepHeal ?? 0;
        totalShield += step.stepShield ?? 0;
    }

    // §3b — per-step active conditional buff names: sonata windows covering the
    // step plus the conditional chain/inherent effects resolved for that step
    // (now properly per-step windowed via the §A trigger × window model).
    for (const step of steps) {
        const names = [];
        for (const window of buffWindows) {
            if (window.bonusPct > 0 && windowStacksAtStep(window, step) > 0) {
                names.push(window.label || window.sonataName || 'Buff');
            }
        }
        for (const name of (condNamesByStep[step.index] ?? [])) names.push(name);
        step.activeBuffNames = names;
    }

    // §3c — contiguous display windows derived from the per-step buff names.
    const buffTimeline = deriveBuffWindows(steps);

    // Transparency windows (2026-07-05): per-effect windows for conditional
    // chain/inherent effects, and state windows with their closers, so the
    // build page can SHOW every condition/state and what consumed/ended it.
    const effectWindows = deriveEffectWindows(unlocked, effectKeysByStep, steps);
    const stateWindows = deriveStateWindows(stateTimeline, stateDefs, rotation, skillMap, steps);

    // Cooldown overlay (2026-07-12): flags re-casts of a skill/echo group
    // before its data-reported cooldown is ready. Purely diagnostic — the
    // rotation is authored as executed; damage/time never change. The team
    // sim RE-annotates its step copies in team time so timers persist across
    // passes/segments (this single-rotation pass can't see those gaps).
    // Cooldowns tick against gameStartTime (stamped above) — the ToA-benchmark
    // convention where a Liberation animation freezes cooldown progress.
    const slot0Echo = build.echoes?.[0];
    const slot0EchoDef = slot0Echo ? dataset.echoes?.find(echo => echo.id === slot0Echo.id) : null;
    const cooldownViolations = annotateStepCooldowns(steps, {
        skillMap,
        echoCooldown: slot0EchoDef?.activeSkill?.cooldown ?? null,
        timeKey: 'gameStartTime',
    });

    const gameTime = time - totalFreeze;
    const dpsTime = timingMode === 'toa' ? gameTime : time;

    return {
        steps,
        buffWindows,
        buffTimeline,
        effectWindows,
        stateWindows,
        energyTrace,
        cooldownViolations,
        totals: {
            damage: cumulative,
            crit: totalCrit,
            nonCrit: totalNonCrit,
            heal: totalHeal,
            shield: totalShield,
            time,
            gameTime,
            dps: dpsTime > 0 ? cumulative / dpsTime : 0,
            hits: totalHits,
            stepCount: rotation.length,
            missingSteps,
        },
        stats,
    };
}

export const __test__ = { HARDCODED_STEP_DURATIONS, resolveStepDuration, resolveFreezeTime, resolveFreezeSchedule, resolveTimingSource, deriveGameTimes };
