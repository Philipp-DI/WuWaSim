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
 * Phase 5 scope: linear cast sequence with per-skill cast times. No
 * cooldowns, no gauge tracking, no swap windows, no buff durations.
 * Those land in Phase 6.
 *
 *   simulateRotation({ build, dataset, target }) -> SimResult
 *
 * Returns a SimResult even on empty input — callers always get a
 * stable shape and can render zeroed UI without branching.
 */

import { resolveTotalStats } from './stats.js';
import { resolveSkill, resolveEchoSkill, resolveSupport } from './skill.js';
import { parseSonataBuffs } from './sonata-buffs.js';
import { stackTimeline, groupStackingBuffs } from './buff-timeline.js';
import { canSatisfyCondition } from './triggerability.js';
import { weaponConditionalContribution, sonataConditionalContribution } from './conditional-buffs.js';
import { unlockedEffects, effectsActiveAtStep } from './buffs.js';

// Weapon conditional amplify → per-hit amplify scopes (the format skill.js
// expects: { scope: {type:'element', elementId} | {type:'skillType', skillType},
// value }). amplifyByElement/Type are matched against each hit's element / type.
function weaponAmplifyScopes(wcond) {
    const out = [];
    for (const [el, v] of Object.entries(wcond?.amplifyByElement ?? {})) out.push({ scope: { type: 'element', elementId: Number(el) }, value: v });
    for (const [t, v] of Object.entries(wcond?.amplifyByType ?? {})) out.push({ scope: { type: 'skillType', skillType: t }, value: v });
    if ((wcond?.amplifyAll ?? 0) > 0) out.push({ scope: { type: 'element', elementId: null }, value: wcond.amplifyAll });
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
function phraseTypesForStep(skillType, formulaType) {
    const n = skillType || '';
    const f = formulaType || skillType || '';
    const out = [];
    if (f === 'basic' || f === 'midair' || n.startsWith('basic')) out.push('basic');
    if (f === 'heavy' || n.includes('heavy')) out.push('heavy');
    if (f === 'skill' || n === 'skill') out.push('skill');
    if (f === 'liberation' || n === 'liberation') out.push('liberation');
    if (n.startsWith('forte') || f === 'forte_basic' || f === 'forte_heavy' || f === 'forte') out.push('forte');
    if (f === 'intro' || n === 'intro') out.push('intro');
    if (f === 'outro' || n === 'outro') out.push('outro');
    return out;
}

// De-duped display names of the CONDITIONAL effects in an active set (skips
// unconditional always-on effects — they are not buff-bar items).
function conditionalNamesOf(effects) {
    const out = [];
    const seen = new Set();
    for (const e of effects) {
        const unconditional = e.window ? e.window.type === 'always'
            : (e.conditionKind ?? 'unconditional') === 'unconditional';
        if (unconditional) continue;
        const name = e.condition || `${e.stat} buff`;
        if (!seen.has(name)) { seen.add(name); out.push(name); }
    }
    return out;
}

// Special rotation step key for "cast equipped echo's active skill".
// Distinct from character skill keys so it can never collide.
export const ECHO_STEP_KEY = '__echo__';
const ECHO_CAST_TIME = 1.20;   // typical echo-skill animation length

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
 *     }],
 *   }
 */
export function simulateRotation({ build, dataset, target, amplifyContext = null }) {
    const stats = resolveTotalStats(build, dataset);

    // Weapon conditional AMPLIFY (e.g. Frostburn's "Glacio DMG Amplified by 28%",
    // gated by Glacio-Chafe triggerability) folds into the per-hit amplify bucket
    // alongside any outro amplify. Stat / DMG-bonus parts already applied in
    // resolveTotalStats; the multiplicative amplify must be applied per hit so it
    // only multiplies the matching element / skill type.
    const weaponDef = build?.weapon ? dataset?.weapons?.find(w => w.id === build.weapon.id) : null;
    const wResonator = dataset?.resonators?.find(r => r.id === build?.resonatorId);
    const wcond = weaponConditionalContribution(weaponDef, build?.weapon?.rank ?? 1, wResonator, dataset);
    const scond = sonataConditionalContribution(build, dataset, wResonator);
    const effectiveAmplify = [...(amplifyContext ?? []), ...weaponAmplifyScopes(wcond), ...weaponAmplifyScopes(scond)];

    const rotation = Array.isArray(build?.rotation) ? build.rotation : [];
    // Use curated skill-map.json first, then auto-generated nanoka map as fallback
    const rid = String(build?.resonatorId);
    const curated = dataset?.skillMap?.[rid];
    const hasCurated = curated && Object.keys(curated).some(k => !k.startsWith('_'));
    const skillMap = hasCurated ? curated : (dataset?.autoSkillMap?.[rid] ?? {});

    // Map formulaType → skill level key (same mapping as skill.js)
    const FORMULA_TO_SKILL_KEY = {
        basic: 'normal', heavy: 'normal', midair: 'normal',
        forte_basic: 'forte', forte_heavy: 'forte',
        skill: 'skill', liberation: 'liberation',
        intro: 'intro', outro: 'intro',
    };
    function skillLevelFor(def) {
        const fType = def.formulaType ?? def.skillType;
        const lvKey = FORMULA_TO_SKILL_KEY[fType] ?? fType;
        return build.skillLevels?.[lvKey] ?? 10;
    }

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
    const reso = dataset?.resonators?.find(r => r.id === build?.resonatorId) ?? null;
    const stateDefs = stateDefsForResonator(build?.resonatorId);
    const stepTimes = computeStepTimes(rotation, skillMap, dataset);
    const stateTimeline = computeStateTimeline(rotation, skillMap, stateDefs, stepTimes);
    const unlocked = unlockedEffects(build, reso);

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

    for (let i = 0; i < rotation.length; i++) {
        const skillKey = rotation[i];

        // Special step: cast the equipped slot-0 echo's active skill.
        // Resolved against the echo's own multiplier table, not the
        // character damageTable.
        if (skillKey === ECHO_STEP_KEY) {
            const slot0 = build.echoes?.[0];
            const echoDef = slot0 ? dataset.echoes?.find(e => e.id === slot0.id) : null;
            const resolved = slot0
                ? resolveEchoSkill({ echo: slot0, build, dataset, stats, target })
                : null;
            const castTime = ECHO_CAST_TIME;

            if (!resolved) {
                // No echo equipped, or echo has no active skill — show the step
                // at zero so the user can see it's not contributing.
                steps.push({
                    index: i, skillKey, label: 'Echo Skill (no echo equipped)',
                    skillType: 'echo', castTime, startTime: cursor, endTime: cursor + castTime,
                    stepDamage: 0, stepCrit: 0, stepNonCrit: 0, hitCount: 0,
                    cumulativeDamage: cumulative, resolved: null, missing: !slot0,
                });
                // Echo Skill energy generation has no source field (P11.5 scope
                // discipline — documented gap, not modeled); contributes 0.
                energyTrace.push({ stepIndex: i, energyBefore: energyCursor, energyAfter: energyCursor, liberationCastable: null });
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
                stepDamage,
                stepCrit: resolved.totalCrit ?? 0,
                stepNonCrit: resolved.totalNonCrit ?? 0,
                hitCount: resolved.hits.length ?? 0,
                cumulativeDamage: cumulative,
                resolved, missing: false,
            });
            // See the no-echo branch above — Echo Skill energy gen is unmodeled.
            energyTrace.push({ stepIndex: i, energyBefore: energyCursor, energyAfter: energyCursor, liberationCastable: null });
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
                stepDamage: 0, stepCrit: 0, stepNonCrit: 0, hitCount: 0,
                cumulativeDamage: cumulative,
                resolved: null, missing: true,
            });
            energyTrace.push({ stepIndex: i, energyBefore: energyCursor, energyAfter: energyCursor, liberationCastable: null });
            continue;
        }

        const castTime = resolveCastTime(skillDef, dataset);
        // Resolve which chain/inherent effects are active at THIS step (trigger ×
        // window, from earlier casts + the state timeline), scaled by stacks.
        const stepActiveEffects = effectsActiveAtStep(unlocked, {
            startTime: cursor,
            activeStates: stateTimeline.activeAt[i] ?? new Set(),
            resonanceMode: build?.resonanceMode ?? null,
            firedTypes, lastFireEndByType, fireCountByType,
            firedKeys, lastFireEndByKey, fireCountByKey,
        });
        condNamesByStep[i] = conditionalNamesOf(stepActiveEffects);
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
        // Cost is subtracted unconditionally when the step is a Liberation —
        // the cursor can go negative; that deficit IS the signal P12's
        // breakpoint sweep needs, not something to clamp away.
        const energyBefore = energyCursor;
        let liberationCastable = null;
        if (skillDef.skillType === 'liberation') {
            liberationCastable = liberationCost == null ? null : energyBefore >= liberationCost;
            energyCursor -= liberationCost ?? 0;
        }
        energyCursor += (skillDef.energyGen ?? 0) * stats.energyRegen;
        energyTrace.push({ stepIndex: i, energyBefore, energyAfter: energyCursor, liberationCastable });

        // Register this step's trigger fires so LATER steps can see them.
        const endT = cursor + castTime;
        for (const pt of phraseTypesForStep(skillDef.skillType, skillDef.formulaType)) {
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
    const buffWindows = computeBuffWindows(build, dataset, steps);

    // Apply conditional buffs to step damage. A buff window affects a step if
    // the step's start time falls within [window.start, window.end). The buff
    // scales matching damage: element buffs only boost matching-element hits,
    // atk buffs boost all hits (approximated as a flat damage multiplier since
    // ATK feeds linearly into the pre-crit damage).
    applyBuffsToSteps(steps, buffWindows);

    // Recompute totals from the (possibly buffed) per-step values.
    cumulative = 0; totalCrit = 0; totalNonCrit = 0;
    for (const s of steps) {
        cumulative += s.stepDamage;
        totalCrit += s.stepCrit;
        totalNonCrit += s.stepNonCrit;
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

    return {
        steps,
        buffWindows,
        buffTimeline,
        energyTrace,
        totals: {
            damage: cumulative,
            crit: totalCrit,
            nonCrit: totalNonCrit,
            time,
            dps: time > 0 ? cumulative / time : 0,
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
            } else {
                // atk / unknown → whole-step multiplier
                flatBonus += w.bonusPct * stk;
            }
        }

        if (elementBonus === 0 && flatBonus === 0) continue;

        // Rescale each hit. element bonus only multiplies matching-element hits.
        let newExpected = 0, newCrit = 0, newNonCrit = 0;
        let anyApplied = false;
        for (const hit of step.resolved.hits) {
            const hitElement = hit.skill?.element ?? null;
            let mult = 1 + flatBonus;
            if (elementBonus > 0 && hitElement === elementId) { mult += elementBonus; }
            if (mult !== 1) anyApplied = true;

            newExpected += hit.result.expected * mult;
            newCrit += hit.result.crit * mult;
            newNonCrit += hit.result.nonCrit * mult;
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
function computeBuffWindows(build, dataset, steps) {
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
        if (!canSatisfyCondition(resonator, dataset, buff.raw)) return false;
        // Unclassified-buff guard: if the parser learned nothing about WHAT the
        // buff boosts (no element, no damage type, kind 'unknown'), don't credit
        // it — applyBuffsToSteps would otherwise apply it as a flat whole-step
        // multiplier, over-valuing sets whose bonus is a mechanic the sim doesn't
        // model (e.g. Empyrean Anthem's "Coordinated Attack DMG +80%" on a
        // non-coordinated carry). Better to omit than to over-credit.
        if (buff.bonusKind !== 'element' && buff.bonusKind !== 'atk' && !buff.dmgType && buff.element == null) return false;
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
function windowStacksAtStep(w, step) {
    if (w.stacksByStepIndex) return w.stacksByStepIndex[step.index] ?? 0;
    if (step.startTime + 1e-6 < w.start || step.startTime >= w.end) return 0;
    return w.stacks ?? 1;
}

// Phrasing matches sonata-buffs.js's DAMAGE_TYPE_PATTERNS exactly (e.g. "Heavy
// Attack DMG", not just "Heavy DMG") so a downstream label-text-only consumer
// (team-editor-v2.js, which never sees the structured ParsedBuff) can still
// re-detect the damage type via detectDamageType(label).
const DMG_TYPE_LABEL = {
    basic: 'Basic Attack', heavy: 'Heavy Attack', skill: 'Resonance Skill',
    liberation: 'Resonance Liberation', echo: 'Echo', intro: 'Intro Skill', outro: 'Outro Skill',
};

function shortBuffLabel(buff) {
    const pct = buff.bonusPct > 0 ? `+${(buff.bonusPct * 100).toFixed(0)}%` : '';
    if (buff.bonusKind === 'element' && buff.element) {
        const names = ['', 'Glacio', 'Fusion', 'Electro', 'Aero', 'Spectro', 'Havoc'];
        return `${pct} ${names[buff.element]} DMG`.trim();
    }
    if (buff.bonusKind === 'atk') return `${pct} ATK`.trim();
    if (buff.dmgType) return `${pct} ${DMG_TYPE_LABEL[buff.dmgType]} DMG`.trim();
    return pct || 'Buff';
}

export const __test__ = { HARDCODED_CAST_TIMES, resolveCastTime };