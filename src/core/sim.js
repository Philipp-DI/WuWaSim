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
import { resolveSkill } from './skill.js';
import { parseSonataBuffs } from './sonata-buffs.js';

// Fallback cast times when neither the skill nor data/_defaults provides one.
// Tuned to roughly match in-game animation lengths. Override per-skill in
// skill-map.json with `castTime`.
const HARDCODED_CAST_TIMES = Object.freeze({
    basic: 0.55,
    heavy: 1.40,
    skill: 1.30,
    liberation: 1.80,
    intro: 0.80,
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
export function simulateRotation({ build, dataset, target }) {
    const stats = resolveTotalStats(build, dataset);

    const rotation = Array.isArray(build?.rotation) ? build.rotation : [];
    const skillMap = dataset?.skillMap?.[String(build?.resonatorId)] || {};

    const steps = [];
    let cumulative = 0;
    let cursor = 0;
    let totalCrit = 0;
    let totalNonCrit = 0;
    let totalHits = 0;
    let missingSteps = 0;

    for (let i = 0; i < rotation.length; i++) {
        const skillKey = rotation[i];
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
        const resolved = resolveSkill({ skillDef, build, dataset, stats, target });

        const stepDamage = resolved?.totalExpected ?? 0;
        const stepCrit = resolved?.totalCrit ?? 0;
        const stepNonCrit = resolved?.totalNonCrit ?? 0;
        const hitCount = resolved?.hits.length ?? 0;

        cumulative += stepDamage;
        totalCrit += stepCrit;
        totalNonCrit += stepNonCrit;
        totalHits += hitCount;

        steps.push({
            index: i, skillKey,
            label: skillDef.label || skillKey,
            skillType: skillDef.skillType,
            castTime,
            startTime: cursor,
            endTime: cursor + castTime,
            stepDamage, stepCrit, stepNonCrit, hitCount,
            cumulativeDamage: cumulative,
            resolved,
            missing: false,
        });
        cursor += castTime;
    }

    const time = cursor;
    // Compute conditional sonata buff active-windows over the rotation.
    // Heuristic: each parsed buff has a trigger (skill type). Whenever a
    // rotation step matches the trigger, the buff becomes active starting
    // at that step's endTime, lasting `duration` seconds (or extending an
    // existing window if it's still active). Currently visual-only; the
    // damage engine doesn't apply these yet.
    const buffWindows = computeBuffWindows(build, dataset, steps);

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