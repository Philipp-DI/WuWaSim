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
 *   }
 */
export function simulateRotation({ build, dataset, target, amplifyContext = null, effectMode = 'build', structuralResolver = null }) {
    const stats = resolveTotalStats(build, dataset);

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

    // Build a structural-condition resolver for chain/inherent effects when
    // simulating in teamSim mode. It answers "is this structural effect's
    // trigger satisfied by the rotation?":
    //   afterCast{skillType} → true if any step of that skillType is in the rotation
    //   inState{...}         → unresolved (null) — state windows aren't modelled
    //                          here, so it stays conservative (OFF) unless the
    //                          user overrides via effectToggles.
    // A caller-supplied structuralResolver takes precedence (lets the team sim
    // pass richer, segment-aware logic later).
    let rotationResolver = structuralResolver;
    if (!rotationResolver && effectMode === 'teamSim') {
        // Pre-compute the set of skill types present in the rotation.
        const typesPresent = new Set();
        for (const k of rotation) {
            const def = skillMap[k];
            if (def) typesPresent.add(def.formulaType ?? def.skillType);
        }
        rotationResolver = (effect) => {
            const t = effect.structuralTrigger;
            if (!t) return null;
            if (t.type === 'afterCast') {
                if (t.skillType == null) return null;        // unknown phrase → unresolved
                return typesPresent.has(t.skillType);
            }
            return null;   // inState and others: not resolvable here
        };
    }

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
            continue;
        }

        const castTime = resolveCastTime(skillDef, dataset);
        const resolved = resolveSkill({ skillDef, build, dataset, stats, target, amplifyContext,
                                        effectMode, structuralResolver: rotationResolver });

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
        cursor += castTime;
    }

    const time = cursor;
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

    return {
        steps,
        buffWindows,
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
            // Active if the step starts within the window (small epsilon so a
            // buff that triggers exactly at a step's start counts for the next).
            if (step.startTime + 1e-6 < w.start || step.startTime >= w.end) continue;
            if (w.bonusPct <= 0) continue;

            if (w.bonusKind === 'element' && w.element) {
                // Only the matching element accumulates; mixed-element windows
                // are rare, so last-wins on elementId is acceptable.
                elementBonus += w.bonusPct * (w.stacks ?? 1);
                elementId = w.element;
            } else {
                // atk / unknown → whole-step multiplier
                flatBonus += w.bonusPct * (w.stacks ?? 1);
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

// One window per (sonata × triggerType) combination. Multiple casts of
// the same trigger extend the window's endTime; they don't stack into
// multiple windows. Phase 8 can model stacks separately.
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

    // For each buff, walk steps and emit windows
    const windows = [];
    for (const buff of allBuffs) {
        // 'unknown' trigger = always-on for visualization
        if (buff.trigger === 'unknown') {
            windows.push({
                sonataId: buff.sonataId, sonataName: buff.sonataName, pieces: buff.pieces,
                trigger: buff.trigger, label: shortBuffLabel(buff),
                start: 0, end: steps[steps.length - 1].endTime,
                bonusPct: buff.bonusPct, bonusKind: buff.bonusKind, element: buff.element,
                stacks: buff.stacks, raw: buff.raw,
            });
            continue;
        }
        // Find matching steps and accumulate windows
        let activeWindow = null;
        for (const s of steps) {
            if (s.skillType !== buff.trigger) continue;
            const start = s.endTime;
            const end = start + buff.duration;
            if (activeWindow && start <= activeWindow.end) {
                // Extend the existing window
                activeWindow.end = end;
            } else {
                activeWindow = {
                    sonataId: buff.sonataId, sonataName: buff.sonataName, pieces: buff.pieces,
                    trigger: buff.trigger, label: shortBuffLabel(buff),
                    start, end,
                    bonusPct: buff.bonusPct, bonusKind: buff.bonusKind, element: buff.element,
                    stacks: buff.stacks, raw: buff.raw,
                };
                windows.push(activeWindow);
            }
        }
    }
    return windows;
}

function shortBuffLabel(buff) {
    const pct = buff.bonusPct > 0 ? `+${(buff.bonusPct * 100).toFixed(0)}%` : '';
    if (buff.bonusKind === 'element' && buff.element) {
        const names = ['', 'Glacio', 'Fusion', 'Electro', 'Aero', 'Spectro', 'Havoc'];
        return `${pct} ${names[buff.element]} DMG`.trim();
    }
    if (buff.bonusKind === 'atk') return `${pct} ATK`.trim();
    return pct || 'Buff';
}

export const __test__ = { HARDCODED_CAST_TIMES, resolveCastTime };