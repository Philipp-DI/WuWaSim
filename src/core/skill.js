// src/core/skill.js
/**
 * Skill resolver — pure, no DOM.
 *
 * Given a curated skill definition (from data/skill-map.json), a build,
 * the dataset, the resolved total stats, and a target, computes the
 * full damage breakdown for the skill cast.
 *
 *   resolveSkill({ skillDef, build, dataset, stats, target }) -> ResolvedSkill | null
 *
 * Returns null when the skill's damage IDs aren't found in the dataset
 * (lets callers gracefully skip unknown skills without exception flow).
 *
 * Shape:
 *   {
 *     skillLv:         number,         // skill level used (from build.skillLevels)
 *     hits:            Hit[],          // per-instance damage rows
 *     totalExpected:   number,         // sum of expected damage across hits
 *     totalCrit:       number,
 *     totalNonCrit:    number,
 *   }
 *
 *   Hit = { id, skill, result }   // result is the formula's full Damage object
 */

import { computeDamage } from './formula.js';

// Map raw `relatedProp` (PropertyIndex id) to the scaling key understood
// by the damage formula. Anything outside this map defaults to ATK.
const SCALING_BY_PROP = {
    2: 'hp',    // HP
    10: 'def',  // DEF
    7: 'atk',   // ATK (explicit; default also)
};

export function resolveSkill({ skillDef, build, dataset, stats, target }) {
    if (!skillDef || !build || !dataset || !stats || !target) return null;

    const skillLv = build.skillLevels?.[skillDef.skillType] ?? 1;
    const tableForReso = dataset.damageTable?.[String(build.resonatorId)] || [];

    const rows = (skillDef.damageIds || [])
        .map(id => tableForReso.find(d => d.id === id))
        .filter(Boolean);
    if (rows.length === 0) return null;

    const hits = rows.map(row => {
        const mult = row.mults?.[skillLv - 1] ?? 0;
        const skill = {
            skillType: skillDef.skillType,
            multiplier: mult,
            scaling: SCALING_BY_PROP[row.relatedProp] ?? 'atk',
            element: row.element,
        };
        return { id: row.id, skill, result: computeDamage({ stats, skill, target }) };
    });

    return {
        skillLv,
        hits,
        totalExpected: hits.reduce((s, h) => s + h.result.expected, 0),
        totalCrit: hits.reduce((s, h) => s + h.result.crit, 0),
        totalNonCrit: hits.reduce((s, h) => s + h.result.nonCrit, 0),
    };
}

// Convenience: enumerate all curated skills for a resonator. Returns
// [{key, def, resolved}], skipping any skill whose damage IDs are
// unknown in the dataset.
export function resolveAllSkills({ build, dataset, stats, target }) {
    const map = dataset.skillMap?.[String(build.resonatorId)] || {};
    const out = [];
    for (const [key, def] of Object.entries(map)) {
        if (key.startsWith('_')) continue;          // skip _note etc.
        const resolved = resolveSkill({ skillDef: def, build, dataset, stats, target });
        if (resolved) out.push({ key, def, resolved });
    }
    return out;
}

export const __test__ = { SCALING_BY_PROP };