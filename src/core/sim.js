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
import { parseSonataBuffs, isIncomingResonatorBuff } from './sonata-buffs.js';
import { stackTimeline, groupStackingBuffs } from './buff-timeline.js';
import { canSatisfyCondition } from './triggerability.js';
import { weaponConditionalContribution, sonataConditionalContribution } from './conditional-buffs.js';
import { unlockedEffects, effectsActiveAtStepDetailed } from './buffs.js';

// Weapon conditional amplify → per-hit amplify scopes (the format skill.js
// expects: { scope: {type:'element', elementId} | {type:'skillType', skillType},
// value }). amplifyByElement/Type are matched against each hit's element / type.
function weaponAmplifyScopes(weaponConditional) {
    const out = [];
    for (const [el, v] of Object.entries(weaponConditional?.amplifyByElement ?? {})) out.push({ scope: { type: 'element', elementId: Number(el) }, value: v });
    for (const [t, v] of Object.entries(weaponConditional?.amplifyByType ?? {})) out.push({ scope: { type: 'skillType', skillType: t }, value: v });
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
    const n = skillType || '';
    const out = [];
    if (n.startsWith('basic') || n === 'midair') out.push('basic');
    if (n.includes('heavy')) out.push('heavy');
    if (n === 'skill') out.push('skill');
    if (n === 'liberation') out.push('liberation');
    if (n.startsWith('forte')) out.push('forte');
    if (n === 'intro') out.push('intro');
    if (n === 'outro') out.push('outro');
    return out;
}

// Whether an effect is unconditional (always-on) — always-on effects are baked
// into totals and are not buff-bar / window items.
function isUnconditionalEffect(e) {
    return e.window ? e.window.type === 'always'
        : (e.conditionKind ?? 'unconditional') === 'unconditional';
}

// De-duped display names of the CONDITIONAL effects in an active set (skips
// unconditional always-on effects — they are not buff-bar items).
function conditionalNamesOf(effects) {
    const out = [];
    const seen = new Set();
    for (const e of effects) {
        if (isUnconditionalEffect(e)) continue;
        const name = e.condition || `${e.stat} buff`;
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

// Fallback cast times when neither the skill nor data/_defaults provides one.
// Tuned to roughly match in-game animation lengths. Override per-skill in
// skill-map.json with `castTime`.
const HARDCODED_CAST_TIMES = Object.freeze({
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
 * Resolve a skill's cast time. Lookup order:
 *   1. skillDef.castTime  (per-skill override in skill-map.json)
 *   2. dataset.skillMap._defaults.castTimeBySkillType[<type>]
 *   3. HARDCODED_CAST_TIMES[<type>]
 *   4. 1.0  (generic fallback so the timeline never collapses to zero)
 */
export function resolveCastTime(skillDef, dataset) {
    if (typeof skillDef?.castTime === 'number' && skillDef.castTime > 0) {
        return skillDef.castTime;
    }
    const map = dataset?.skillMap || {};
    const fromDefaults = map._defaults?.castTimeBySkillType?.[skillDef?.skillType];
    if (typeof fromDefaults === 'number' && fromDefaults > 0) return fromDefaults;
    const hard = HARDCODED_CAST_TIMES[skillDef?.skillType];
    if (typeof hard === 'number') return hard;
    return 1.0;
}

// ── Two-clock timing model (docs/TIMING_MODEL.md) ──────────────────────────
// gameTime advances by castTime - freezeTime and is what cooldowns tick
// against; realTime (the existing `cursor`/step.startTime/endTime) advances
// by the full castTime and is what buff/debuff durations always tick against
// (they don't pause just because a benchmark's challenge clock did). Today
// NO ability has measured freezeTime data (source: "estimated" — see
// resolveTimingSource below) so freezeTime resolves to 0 everywhere and
// gameTime is numerically identical to realTime; the split exists so the
// engine is ready the moment real ToA freeze-window data is sourced.

/**
 * Resolve a skill's freeze window (seconds of castTime during which gameTime
 * / cooldowns are frozen — Tower of Adversity's Liberation/Tune-Break
 * mechanic). Lookup order mirrors resolveCastTime:
 *   1. skillDef.freezeTime          (per-skill override, when measured)
 *   2. dataset.skillMap._defaults.freezeTimeBySkillType[<type>]
 *   3. 0  (no measured freeze data yet for any ability)
 */
export function resolveFreezeTime(skillDef, dataset) {
    if (typeof skillDef?.freezeTime === 'number' && skillDef.freezeTime >= 0) {
        return skillDef.freezeTime;
    }
    const map = dataset?.skillMap || {};
    const fromDefaults = map._defaults?.freezeTimeBySkillType?.[skillDef?.skillType];
    if (typeof fromDefaults === 'number' && fromDefaults >= 0) return fromDefaults;
    return 0;
}

const TIMING_SOURCES = new Set(['imported', 'frame-counted', 'estimated']);

/**
 * Resolve the provenance of a skill's timing data (castTime/freezeTime), per
 * docs/TIMING_MODEL.md's required `source` field — so downstream UI/output
 * never presents a fabricated number as if it were measured. Defaults to
 * 'estimated' (today's honest state for the entire roster: every castTime
 * comes from HARDCODED_CAST_TIMES / a per-type default, never a per-ability
 * measurement).
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
 * @returns {number} total freeze consumed (0 in 'open' mode or with no
 *   freeze data — i.e. always 0 today).
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

// Per-step start/end times (seconds from rotation start), computed in a cheap
// upfront pass so computeStateTimeline can resolve exit.mode 'seconds' states
// (a real elapsed-time expiry, e.g. Cantarella's Mirage lasting 8s) BEFORE the
// main walk runs. Mirrors the castTime resolution the main walk applies per
// step kind (echo / missing-key / normal) — kept separate rather than fed back
// into the main loop to avoid touching its established, well-tested branching.
function computeStepTimes(rotation, skillMap, dataset) {
    const start = [], end = [];
    let t = 0;
    for (const key of rotation) {
        const castTime = key === ECHO_STEP_KEY ? ECHO_CAST_TIME
            : skillMap[key] ? resolveCastTime(skillMap[key], dataset) : 0;
        start.push(t);
        t += castTime;
        end.push(t);
    }
    return { start, end };
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
 *       castTime,                 // seconds
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
 *       time,                     // sum of cast times in seconds
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
    const weaponDef = build?.weapon ? dataset?.weapons?.find(w => w.id === build.weapon.id) : null;
    const wResonator = dataset?.resonators?.find(r => r.id === build?.resonatorId);
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
    const resonator = dataset?.resonators?.find(r => r.id === build?.resonatorId) ?? null;
    const stateDefs = stateDefsForResonator(build?.resonatorId);
    const stepTimes = computeStepTimes(rotation, skillMap, dataset);
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
            startTime: cursor,
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
            const echoDef = slot0 ? dataset.echoes?.find(e => e.id === slot0.id) : null;
            const resolved = slot0
                ? resolveEchoSkill({ echo: slot0, dataset, stats, target })
                : null;
            const castTime = ECHO_CAST_TIME;

            if (!resolved) {
                // No echo equipped, or echo has no active skill — show the step
                // at zero so the user can see it's not contributing.
                steps.push({
                    index: i, skillKey, label: 'Echo Skill (no echo equipped)',
                    skillType: 'echo', castTime, startTime: cursor, endTime: cursor + castTime,
                    freezeTime: 0, timingSource: 'estimated',
                    stepDamage: 0, stepCrit: 0, stepNonCrit: 0, hitCount: 0,
                    cumulativeDamage: cumulative, resolved: null, missing: !slot0,
                });
                // No echo equipped / no active skill → no cast, no energy.
                // (Equipped echoes DO generate energy — see the resolved
                // branch below; the former P11.5 gap closed 2026-07-12.)
                energyTrace.push({ stepIndex: i, energyBefore: energyCursor, energyAfter: energyCursor, liberationCastable: null, rawGen: 0, rawConcertoGen: 0, isLiberation: false });
                cursor += castTime;
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
                castTime, startTime: cursor, endTime: cursor + castTime,
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
            cursor += castTime;
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
                castTime: 0, startTime: cursor, endTime: cursor,
                freezeTime: 0, timingSource: 'estimated',
                stepDamage: 0, stepCrit: 0, stepNonCrit: 0, hitCount: 0,
                cumulativeDamage: cumulative,
                resolved: null, missing: true,
            });
            energyTrace.push({ stepIndex: i, energyBefore: energyCursor, energyAfter: energyCursor, liberationCastable: null, rawGen: 0, rawConcertoGen: 0, isLiberation: false });
            continue;
        }

        const castTime = resolveCastTime(skillDef, dataset);
        const freezeTime = resolveFreezeTime(skillDef, dataset);
        const timingSource = resolveTimingSource(skillDef, dataset);
        const resolved = resolveSkill({ skillDef, build, dataset, stats, target, amplifyContext: effectiveAmplify,
                                        activeEffects: stepActiveEffects });

        const stepDamage  = resolved?.totalExpected ?? 0;
        const stepCrit    = resolved?.totalCrit     ?? 0;
        const stepNonCrit = resolved?.totalNonCrit  ?? 0;
        const hitCount    = resolved?.hits.length   ?? 0;

        // Aggregate heal + shield from the skill's support rows (if any).
        const support = resolved?.supportOutput ?? null;
        const stepHeal   = support ? support.filter(s => s.rowType === 'heal')  .reduce((t, s) => t + s.value, 0) : 0;
        const stepShield = support ? support.filter(s => s.rowType === 'shield').reduce((t, s) => t + s.value, 0) : 0;

        // For pure-support steps (no damage rows, only heal/shield), also try
        // resolving support directly when resolveSkill returned null.
        let effectiveSupport = support;
        if (!resolved && skillDef.supportIds?.length) {
            effectiveSupport = resolveSupport({ skillDef, build, dataset, stats });
        }
        const finalHeal   = effectiveSupport ? effectiveSupport.filter(s => s.rowType === 'heal')  .reduce((t, s) => t + s.value, 0) : stepHeal;
        const finalShield = effectiveSupport ? effectiveSupport.filter(s => s.rowType === 'shield').reduce((t, s) => t + s.value, 0) : stepShield;

        cumulative   += stepDamage;
        totalCrit    += stepCrit;
        totalNonCrit += stepNonCrit;
        totalHits    += hitCount;

        steps.push({
            index: i, skillKey,
            label:     skillDef.label || skillKey,
            skillType: skillDef.skillType,
            castTime,
            startTime: cursor,
            endTime:   cursor + castTime,
            freezeTime, timingSource,
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

        // Register this step's trigger fires so LATER steps can see them.
        const endT = cursor + castTime;
        for (const pt of phraseTypesForStep(skillDef.skillType)) {
            firedTypes.add(pt);
            lastFireEndByType.set(pt, endT);
            fireCountByType.set(pt, (fireCountByType.get(pt) ?? 0) + 1);
        }
        firedKeys.add(skillKey);
        lastFireEndByKey.set(skillKey, endT);
        fireCountByKey.set(skillKey, (fireCountByKey.get(skillKey) ?? 0) + 1);
        cursor += castTime;
    }

    const time = cursor;

    // §3a — attach the display damage category to every step.
    for (const step of steps) step.damageCategory = dmgCategoryFor(step.skillType);

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
    for (const s of steps) {
        cumulative += s.stepDamage;
        totalCrit += s.stepCrit;
        totalNonCrit += s.stepNonCrit;
        totalHeal += s.stepHeal ?? 0;
        totalShield += s.stepShield ?? 0;
    }

    // §3b — per-step active conditional buff names: sonata windows covering the
    // step plus the conditional chain/inherent effects resolved for that step
    // (now properly per-step windowed via the §A trigger × window model).
    for (const step of steps) {
        const names = [];
        for (const w of buffWindows) {
            if (w.bonusPct > 0 && windowStacksAtStep(w, step) > 0) {
                names.push(w.label || w.sonataName || 'Buff');
            }
        }
        for (const n of (condNamesByStep[step.index] ?? [])) names.push(n);
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
    // Two-clock model (docs/TIMING_MODEL.md): derive gameTime from realTime +
    // each step's freezeTime BEFORE cooldowns are annotated, so cooldowns tick
    // against gameTime (the ToA-benchmark convention) rather than realTime.
    // Numerically a no-op today (every freezeTime resolves to 0), but the
    // cooldown overlay and the DPS denominator are now reading the correct
    // clock the moment real freeze-window data is sourced.
    const totalFreeze = deriveGameTimes(steps, timingMode);

    const slot0Echo = build.echoes?.[0];
    const slot0EchoDef = slot0Echo ? dataset.echoes?.find(e => e.id === slot0Echo.id) : null;
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

/**
 * Derive contiguous buff windows from per-step `activeBuffNames` (P11 §3c).
 * A window opens when a name first appears and closes when it disappears.
 *
 * @param {Array<object>} steps — steps carrying { index, startTime, endTime, activeBuffNames }
 * @returns {Array<{name, startStep, endStep, startTime, endTime}>}
 */
export function deriveBuffWindows(steps) {
    if (!Array.isArray(steps) || steps.length === 0) return [];
    const open = new Map();   // name → { startStep, startTime }
    const windows = [];
    for (const step of steps) {
        const names = new Set(step.activeBuffNames ?? []);
        // Close windows for buffs that ended at this step.
        for (const [name, w] of open) {
            if (!names.has(name)) {
                windows.push({ name, startStep: w.startStep, endStep: step.index - 1,
                    startTime: w.startTime, endTime: step.startTime });
                open.delete(name);
            }
        }
        // Open windows for buffs that just started.
        for (const name of names) {
            if (!open.has(name)) open.set(name, { startStep: step.index, startTime: step.startTime });
        }
    }
    // Close anything still open at end of rotation.
    const last = steps[steps.length - 1];
    for (const [name, w] of open) {
        windows.push({ name, startStep: w.startStep, endStep: last.index,
            startTime: w.startTime, endTime: last.endTime });
    }
    return windows;
}

/**
 * Contiguous windows for CONDITIONAL chain/inherent effects, one per effect
 * activation span (2026-07-05). `endReason` names why the window closed —
 * derived from the effect's window type ('consumed' for untilConsumed,
 * 'expired' for seconds, 'state ended' for stateBound, 'rotation end' when it
 * was still on at the last step).
 *
 * @returns {Array<{ key, effect, startStep, endStep, start, end, endReason }>}
 */
export function deriveEffectWindows(unlocked, effectKeysByStep, steps) {
    if (!Array.isArray(steps) || steps.length === 0) return [];
    const byKey = new Map(unlocked.map(u => [u.key, u.effect]));
    const mk = (key, s, e, openEnd) => {
        const effect = byKey.get(key) ?? null;
        const wt = effect?.window?.type;
        const endReason = openEnd ? 'rotation end'
            : wt === 'untilConsumed' ? 'consumed'
            : wt === 'seconds' ? 'expired'
            : wt === 'stateBound' ? 'state ended'
            : 'ended';
        return { key, effect, startStep: steps[s].index, endStep: steps[e].index,
                 start: steps[s].startTime, end: steps[e].endTime, endReason };
    };
    const windows = [];
    const open = new Map();   // key → start index into steps
    for (let i = 0; i < steps.length; i++) {
        const on = effectKeysByStep[i] ?? new Set();
        for (const [key, startIdx] of open) {
            if (!on.has(key)) { windows.push(mk(key, startIdx, i - 1, false)); open.delete(key); }
        }
        for (const key of on) if (!open.has(key)) open.set(key, i);
    }
    for (const [key, startIdx] of open) windows.push(mk(key, startIdx, steps.length - 1, true));
    windows.sort((a, b) => a.startStep - b.startStep || String(a.key).localeCompare(String(b.key)));
    return windows;
}

/**
 * Contiguous windows for character STATES (rotation-state.js timeline), with
 * the closer identified (2026-07-05): `endReason` is 'consumed' when the step
 * that ended the span matches the state's exit keys/types (consumedBy /
 * secondsOrConsumedBy), 'expired' for timed/duration exits, 'until rotation
 * end' for persist states still on at the end. `consumedBy` carries the
 * consuming step's skill key when applicable.
 *
 * @returns {Array<{ name, startStep, endStep, start, end, endReason, consumedBy }>}
 */
export function deriveStateWindows(stateTimeline, stateDefs, rotation, skillMap, steps) {
    if (!Array.isArray(steps) || steps.length === 0 || !stateDefs?.length) return [];
    const defByName = new Map(stateDefs.map(d => [d.name.toLowerCase(), d]));
    const windows = [];
    for (const name of stateTimeline.states) {
        const def = defByName.get(name);
        let start = null;
        for (let i = 0; i <= steps.length; i++) {
            const active = i < steps.length && (stateTimeline.activeAt[i]?.has(name) ?? false);
            if (active && start == null) start = i;
            if (!active && start != null) {
                windows.push(mkStateWindow(name, def, start, i - 1, i, rotation, skillMap, steps));
                start = null;
            }
        }
    }
    windows.sort((a, b) => a.startStep - b.startStep || a.name.localeCompare(b.name));
    return windows;
}

function mkStateWindow(name, def, s, e, closerIdx, rotation, skillMap, steps) {
    let endReason = 'until rotation end';
    let consumedBy = null;
    if (closerIdx < steps.length) {
        const key = rotation[closerIdx];
        const exit = def?.exit;
        const t = skillMap?.[key]?.skillType ?? null;
        const ft = skillMap?.[key]?.formulaType ?? null;
        const exitMatches = !!exit && (
            (exit.keys?.includes(key) ?? false)
            || (exit.types?.includes(t) ?? false)
            || (exit.types?.includes(ft) ?? false)
        );
        if (exitMatches) { endReason = 'consumed'; consumedBy = key; }
        else if (exit?.mode === 'seconds' || exit?.mode === 'secondsOrConsumedBy'
            || exit?.mode === 'duration' || exit?.mode === 'consumedByThenSeconds') endReason = 'expired';
        else endReason = 'ended';
    } else if (def?.exit?.mode && def.exit.mode !== 'persist') {
        endReason = 'active at rotation end';
    }
    return { name, startStep: steps[s].index, endStep: steps[e].index,
             start: steps[s].startTime, end: steps[e].endTime, endReason, consumedBy };
}

// Scale each step's damage by any conditional buffs active during it.
// Mutates the steps array in place. A step is affected when its startTime
// is within a window. Element buffs apply only to hits whose element matches
// the buff's element; atk / unknown buffs apply to the whole step.
function applyBuffsToSteps(steps, buffWindows) {
    if (!buffWindows.length) return;

    for (const step of steps) {
        if (!step.resolved || step.stepDamage <= 0) continue;

        // Sum applicable bonus fractions by kind for this step's time.
        // Different sonatas stack additively within the same kind (matches
        // WuWa's additive DMG bonus model).
        let elementBonus = 0;   // applies to hits matching the buff element
        let elementId = null;
        let flatBonus = 0;   // atk / generic — applies to whole step
        let amplify = 0;     // DMG amplification (echo team auras) — its own
                             // MULTIPLICATIVE layer per hit, matching how
                             // amplify composes in the per-hit formula path.
        let dmgTypeBonus = null;   // per-DMG-TYPE bonus ("+25% Basic Attack DMG")
                                   // — matched against each HIT's formula
                                   // skillType (the DMG-bonus bucket invariant),
                                   // NOT applied whole-step (2026-07-15 fix; a
                                   // dmgType window used to fall into flatBonus
                                   // and over-credit non-matching hits).

        for (const w of buffWindows) {
            if (w.bonusPct <= 0) continue;
            // Active stack count at this step (ramp/decay/cap for stacking buffs,
            // flat for always-on). 0 → not active here.
            const stk = windowStacksAtStep(w, step);
            if (stk <= 0) continue;

            if (w.bonusKind === 'element' && w.element) {
                // Only the matching element accumulates; mixed-element windows
                // are rare, so last-wins on elementId is acceptable.
                elementBonus += w.bonusPct * stk;
                elementId = w.element;
            } else if (w.bonusKind === 'amplify') {
                amplify += w.bonusPct * stk;
            } else if (w.dmgType) {
                (dmgTypeBonus ??= {})[w.dmgType] = (dmgTypeBonus[w.dmgType] ?? 0) + w.bonusPct * stk;
            } else {
                // atk / unknown → whole-step multiplier
                flatBonus += w.bonusPct * stk;
            }
        }

        if (elementBonus === 0 && flatBonus === 0 && amplify === 0 && !dmgTypeBonus) continue;

        // Rescale each hit. element bonus only multiplies matching-element hits.
        let newExpected = 0, newCrit = 0, newNonCrit = 0;
        let anyApplied = false;
        for (const hit of step.resolved.hits) {
            const hitElement = hit.skill?.element ?? null;
            let multiplier = 1 + flatBonus;
            if (elementBonus > 0 && hitElement === elementId) { multiplier += elementBonus; }
            if (dmgTypeBonus) { multiplier += dmgTypeBonus[hit.skill?.skillType] ?? 0; }
            multiplier *= 1 + amplify;
            if (multiplier !== 1) anyApplied = true;

            newExpected += hit.result.expected * multiplier;
            newCrit += hit.result.crit * multiplier;
            newNonCrit += hit.result.nonCrit * multiplier;
        }

        if (!anyApplied) continue;   // element-guard zeroed everything out

        step.stepDamage = newExpected;
        step.stepCrit = newCrit;
        step.stepNonCrit = newNonCrit;
        step.buffed = true;
    }
}

// One window per logical sonata buff. A buff with a stack cap ramps over its
// qualifying casts and decays — modeled per-step via buff-timeline.js
// (`stacksByStepIndex`), NOT applied at max stacks for the whole window. A buff
// listing several triggers (e.g. "Basic OR Heavy Attack") is grouped into ONE
// window over the UNION of triggers so its bonus is credited once, not per
// trigger phrase.
function computeBuffWindows(build, dataset, steps, enemyStatuses = null) {
    if (!steps.length) return [];

    // Find active conditional buffs from the resolved sonata metadata.
    // The sonataContribution in stats.js already filters to active tiers
    // (count >= pieces); we just need to know which sonatas are active.
    const echoes = build.echoes ?? [];
    const sonataCounts = {};
    for (const e of echoes) {
        if (e?.sonataId != null) sonataCounts[e.sonataId] = (sonataCounts[e.sonataId] || 0) + 1;
    }

    const allBuffs = [];
    for (const [idStr, count] of Object.entries(sonataCounts)) {
        const sonata = dataset.sonatas.find(s => s.id === Number(idStr));
        if (!sonata) continue;
        for (const tier of sonata.tiers) {
            if (count < tier.pieces) continue;
            const parsed = parseSonataBuffs(tier);
            for (const buff of parsed) {
                allBuffs.push({
                    sonataId: sonata.id,
                    sonataName: sonata.name,
                    pieces: tier.pieces,
                    ...buff,
                });
            }
        }
    }

    // Echo shield/aura team buff (2026-07-15, e.g. Bell-Borne Geochelone "+10%
    // DMG Boost for the current team members", 15s): the wielder's own copy is
    // a normal windowed buff — trigger 'echo' (one gain per __echo__ cast), the
    // shield's real duration, 'amplify' kind (a universal per-hit multiplier,
    // exact under applyBuffsToSteps' multiplicative amplify factor). Teammates
    // receive it via team-sim.js's team-buff timeline, built from this SAME
    // window — one derivation for self, teammates, and display.
    const slot0 = echoes[0];
    const echoDef = slot0?.id != null ? dataset.echoes?.find(e => e.id === slot0.id) : null;
    const echoTb = echoDef?.activeSkill?.teamBuff;
    if (echoTb?.dmgBoost > 0) {
        allBuffs.push({
            sonataId: `echo-${echoDef.id}`, sonataName: `${echoDef.name} (Echo)`, pieces: 0,
            trigger: 'echo', duration: echoTb.duration ?? 15, bonusPct: echoTb.dmgBoost,
            bonusKind: 'amplify', element: null, dmgType: null, stacks: 1,
            raw: `${echoDef.name}: DMG Boost for the current team members`,
            teamWide: true,
        });
    }
    if (allBuffs.length === 0) return [];

    // Resonator (for triggerability gating below).
    const resonator = dataset.resonators?.find(r => r.id === build?.resonatorId);

    // Gate before grouping so a group's surviving triggers are all creditable.
    const gated = allBuffs.filter(buff => {
        // Triggerability gate: a buff whose activation requires a STATUS the kit
        // can't inflict (e.g. a Glacio-Chafe set on a non-Chafe resonator) must
        // NOT be credited on a solo build — regardless of which secondary cast
        // trigger the parser latched onto. canSatisfyCondition passes everything
        // that isn't status-gated, so action-triggered buffs are unaffected.
        if (!canSatisfyCondition(resonator, dataset, buff.raw, enemyStatuses)) return false;
        // Incoming-resonator transfer guard (2026-07-14): a buff scoped to the
        // NEXT/incoming resonator (Moonlit Clouds / Pact of Neonlight Leap "ATK
        // of the next Resonator …") is NOT the wielder's — it's modeled by
        // conditional-buffs.js incomingResonatorContribution at the team level.
        // (Latent until the detectBonusKind broadening classified these ATK
        // transfers as 'atk' instead of the 'unknown' that used to drop them.)
        if (isIncomingResonatorBuff(buff.raw)) return false;
        // Unclassified-buff guard: if the parser learned nothing about WHAT the
        // buff boosts (no element, no damage type, kind 'unknown'), don't credit
        // it — applyBuffsToSteps would otherwise apply it as a flat whole-step
        // multiplier, over-valuing sets whose bonus is a mechanic the sim doesn't
        // model (e.g. Empyrean Anthem's "Coordinated Attack DMG +80%" on a
        // non-coordinated carry). Better to omit than to over-credit.
        // ('amplify' is never parser-derived — only the structured echo team
        // buff above sets it — so allowing it can't leak unknowns through.)
        if (buff.bonusKind !== 'element' && buff.bonusKind !== 'atk' && buff.bonusKind !== 'amplify'
            && !buff.dmgType && buff.element == null) return false;
        return true;
    });

    const lastEnd = steps[steps.length - 1].endTime;
    const windows = [];
    for (const buff of groupStackingBuffs(gated)) {
        const meta = {
            sonataId: buff.sonataId, sonataName: buff.sonataName, pieces: buff.pieces,
            trigger: buff.triggerTypes.join('+') || 'unknown', label: shortBuffLabel(buff),
            bonusPct: buff.bonusPct, bonusKind: buff.bonusKind, element: buff.element, dmgType: buff.dmgType,
            stacks: buff.stacks, raw: buff.raw,
            // Structurally team-wide buffs (the echo team buff) carry the flag
            // explicitly; parsed sonata buffs are classified from raw text
            // downstream (team-sim.js, isTeamWideBuff) as before.
            ...(buff.teamWide ? { teamWide: true } : {}),
        };

        const realTriggers = buff.triggerTypes.filter(t => t !== 'unknown');
        if (realTriggers.length === 0) {
            // No recognised cast trigger → applied always-on at full stacks
            // (best available; nothing to ramp against).
            windows.push({ ...meta, start: 0, end: lastEnd });
            continue;
        }

        // Stack timeline: per-step active stack count (ramp + decay + cap),
        // built over the union of the buff's triggers. A trigger never cast in
        // the rotation contributes nothing (gains.length === 0).
        const tl = stackTimeline(steps, { triggerTypes: realTriggers, maxStacks: buff.stacks ?? 1, duration: buff.duration ?? 15 });
        if (tl.gains.length === 0) continue;
        windows.push({ ...meta, start: tl.start, end: tl.end, stacksByStepIndex: tl.byStepIndex });
    }
    return windows;
}

// Active stack count of a buff window at a given step. Timeline windows carry a
// per-step map (ramp/decay/cap); always-on windows use their flat stack count.
// Exported so team-sim.js can build team-time-shifted per-step stack samples
// from the same rich windows this module already computes (2026-07-14) —
// one source of truth for "how many stacks at step N", never re-derived.
export function windowStacksAtStep(w, step) {
    if (w.stacksByStepIndex) return w.stacksByStepIndex[step.index] ?? 0;
    if (step.startTime + 1e-6 < w.start || step.startTime >= w.end) return 0;
    return w.stacks ?? 1;
}

// One decimal place ONLY when the value isn't already a whole percent — a
// per-stack magnitude like Havoc Eclipse's 7.5% must never round to "8%"
// (2026-07-14 maintainer report), but a plain "20%" shouldn't grow a
// pointless ".0".
function fmtPctTrim(v) {
    const s = v.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
}

// Phrasing matches sonata-buffs.js's DAMAGE_TYPE_PATTERNS exactly (e.g. "Heavy
// Attack DMG", not just "Heavy DMG") so a downstream label-text-only consumer
// (team-editor-v2.js, which never sees the structured ParsedBuff) can still
// re-detect the damage type via detectDamageType(label).
const DMG_TYPE_LABEL = {
    basic: 'Basic Attack', heavy: 'Heavy Attack', skill: 'Resonance Skill',
    liberation: 'Resonance Liberation', echo: 'Echo', intro: 'Intro Skill', outro: 'Outro Skill',
};

// Exported (2026-07-15): team-sim.js reuses this to label chain-effect
// team-buff windows ("+20% ATK") — one label convention for every buff strip.
export function shortBuffLabel(buff) {
    const pct = buff.bonusPct > 0 ? `+${fmtPctTrim(buff.bonusPct * 100)}%` : '';
    if (buff.bonusKind === 'element' && buff.element) {
        const names = ['', 'Glacio', 'Fusion', 'Electro', 'Aero', 'Spectro', 'Havoc'];
        return `${pct} ${names[buff.element]} DMG`.trim();
    }
    if (buff.bonusKind === 'atk') return `${pct} ATK`.trim();
    if (buff.bonusKind === 'amplify') return `${pct} DMG`.trim();
    if (buff.dmgType) return `${pct} ${DMG_TYPE_LABEL[buff.dmgType]} DMG`.trim();
    return pct || 'Buff';
}

export const __test__ = { HARDCODED_CAST_TIMES, resolveCastTime, resolveFreezeTime, resolveTimingSource, deriveGameTimes };