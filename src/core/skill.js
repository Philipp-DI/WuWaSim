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

import { computeDamage, computeSupport } from './formula.js';
import { collectActiveEffects, resolveChainInherentContext } from './buffs.js';

// Map raw `relatedProp` (PropertyIndex id) to the scaling key understood
// by the damage formula. Anything outside this map defaults to ATK.
const SCALING_BY_PROP = {
    2: 'hp',    // HP
    10: 'def',  // DEF
    7: 'atk',   // ATK (explicit; default also)
};

export function resolveSkill({ skillDef, build, dataset, stats, target, amplifyContext = null, activeEffects = null }) {
    if (!skillDef || !build || !dataset || !stats || !target) return null;

    // formulaType → skill level key (matches build.skillLevels keys).
    // basic/heavy/midair all use the Normal Attack level.
    // forte_basic/forte_heavy use the Forte Circuit level.
    const FORMULA_TO_SKILL_KEY = {
        basic: 'normal',
        heavy: 'normal',
        midair: 'normal',
        forte_basic: 'forte',
        forte_heavy: 'forte',
        skill: 'skill',
        liberation: 'liberation',
        intro: 'intro',
        outro: 'intro',   // outro upgrades together with intro
    };
    const formulaType = skillDef.formulaType ?? skillDef.skillType;
    const skillLvKey = FORMULA_TO_SKILL_KEY[formulaType] ?? formulaType;
    const skillLv = build.skillLevels?.[skillLvKey] ?? 10;
    const tableForReso = dataset.damageTable?.[String(build.resonatorId)] || [];

    const rows = (skillDef.damageIds || [])
        .map(id => tableForReso.find(d => d.id === id))
        .filter(Boolean);
    if (rows.length === 0) return null;

    // Resonance Chain + Inherent Skill effects, folded per-hit so element-/
    // skillType-scoped effects apply correctly. The sim resolves these per step
    // (trigger × window) and passes them in via `activeEffects`. Without that
    // context (e.g. a single-skill damage card), only unconditional effects apply.
    const reso = dataset.resonators?.find(r => r.id === build.resonatorId);
    const effects = activeEffects ?? collectActiveEffects(build, reso);

    const hits = rows.map(row => {
        // Apply multiplierUp effects (chain DMG-multiplier increases) to the base mult.
        // multiplierUp matches the NODE skill type (skillDef.skillType), while
        // dmgBonus/amplify match the FORMULA type (how the hit is categorized for
        // damage bonuses). These can differ — e.g. Carlotta's Liberation deals
        // "Resonance Skill DMG" (formulaType=skill) but her S2 boosts the
        // "Resonance Liberation" multiplier (skillType=liberation).
        const ctxFormula = resolveChainInherentContext(effects, { element: row.element, skillType: formulaType });
        const ctxNode = resolveChainInherentContext(effects, { element: row.element, skillType: skillDef.skillType });
        const baseMult = row.mults?.[skillLv - 1] ?? 0;
        const mult = baseMult * (1 + (ctxNode.multiplierUp ?? 0));

        const skill = {
            skillType: formulaType,
            multiplier: mult,
            scaling: SCALING_BY_PROP[row.relatedProp] ?? 'atk',
            element: row.element,
        };

        // Compute amplify from Outro buffs if present.
        // Each buff scope is checked against this hit's element and formulaType.
        // "All DMG" (elementId: null) matches every hit.
        let amplify = ctxFormula.amplify ?? 0;
        if (amplifyContext?.length) {
            for (const { scope, value } of amplifyContext) {
                if (scope.type === 'element') {
                    if (scope.elementId === null || scope.elementId === row.element) amplify += value;
                } else if (scope.type === 'skillType') {
                    if (scope.skillType === formulaType) amplify += value;
                }
            }
        }

        // Merge chain/inherent context with outro amplify.
        const context = {
            amplify,
            deepen: ctxFormula.deepen,
            dmgBonus: ctxFormula.dmgBonus,
            critRateBonus: ctxFormula.critRateBonus,
            critDmgBonus: ctxFormula.critDmgBonus,
            scalingRatio: ctxFormula.atkRatio,   // ATK% buffs scale the attacker stat
        };
        return { id: row.id, skill, result: computeDamage({ stats, skill, target, context }) };
    });

    // Also resolve any support rows (heal/shield) attached to this skillDef.
    const supportOutput = resolveSupport({ skillDef, build, dataset, stats });

    return {
        skillLv,
        hits,
        totalExpected: hits.reduce((s, h) => s + h.result.expected, 0),
        totalCrit: hits.reduce((s, h) => s + h.result.crit, 0),
        totalNonCrit: hits.reduce((s, h) => s + h.result.nonCrit, 0),
        supportOutput,   // null | [{ rowType, value, flat, ratioAmount, scalingStat }]
    };
}

/**
 * Resolve support (heal / shield) rows for a skillDef, without damage.
 * Returns null if the skillDef has no supportIds.
 * Used both as a subroutine of resolveSkill and standalone for pure-heal steps.
 */
export function resolveSupport({ skillDef, build, dataset, stats }) {
    const ids = skillDef?.supportIds;
    if (!ids?.length || !stats) return null;

    const tableForReso = dataset.supportTable?.[String(build.resonatorId)] ?? [];
    const SKILL_TO_KEY = {
        basic: 'normal', heavy: 'normal', midair: 'normal',
        forte_basic: 'forte', forte_heavy: 'forte',
        skill: 'skill', liberation: 'liberation',
        intro: 'intro', outro: 'intro',
    };
    const skillType = skillDef.skillType ?? skillDef.formulaType ?? 'skill';
    const lvKey = SKILL_TO_KEY[skillType] ?? skillType;
    const skillLv = build.skillLevels?.[lvKey] ?? 10;

    const results = [];
    for (const id of ids) {
        const row = tableForReso.find(r => r.id === id);
        if (!row) continue;
        results.push(computeSupport({ stats, row, skillLv }));
    }
    return results.length > 0 ? results : null;
}

// Convenience: enumerate all curated skills for a resonator. Returns
// [{key, def, resolved}], skipping any skill whose damage IDs are
// unknown in the dataset.
export function resolveAllSkills({ build, dataset, stats, target }) {
    // Curated hand-map takes priority; auto-generated nanoka map is fallback.
    const curated = dataset.skillMap?.[String(build.resonatorId)] ?? {};
    const auto = dataset.autoSkillMap?.[String(build.resonatorId)] ?? {};
    const map = Object.keys(curated).some(k => !k.startsWith('_'))
        ? curated : auto;
    const out = [];
    for (const [key, def] of Object.entries(map)) {
        if (key.startsWith('_')) continue;
        const resolved = resolveSkill({ skillDef: def, build, dataset, stats, target });
        if (resolved) out.push({ key, def, resolved });
    }
    return out;
}

// Resolve the damage of an equipped echo's active skill ("cast echo skill").
// Unlike character skills, echo skills scale off a fixed multiplier table
// (activeSkill.rateByLevel) carried on the echo itself — not the character's
// damageTable or skill levels. The multiplier is picked by the echo's level
// tier; for a maxed echo we use the final entry.
//
//   resolveEchoSkill({ echo, dataset, stats, target }) -> ResolvedSkill | null
//
// `echo` is a build echo slot ({ id, level, ... }); the dataset echo entry
// carries activeSkill. Returns null if the echo has no active skill data.
export function resolveEchoSkill({ echo, dataset, stats, target }) {
    if (!echo || !dataset || !stats || !target) return null;

    const echoDef = dataset.echoes?.find(e => e.id === echo.id);
    const active = echoDef?.activeSkill;
    if (!active || !Array.isArray(active.rateByLevel) || active.rateByLevel.length === 0) {
        return null;
    }

    // Echo active skills have one multiplier table; the highest entry is the
    // value at the echo's max skill rank (a maxed echo). Lower-level echoes
    // would index earlier, but the simulator assumes maxed echoes by default.
    const mult = active.rateByLevel[active.rateByLevel.length - 1] ?? 0;

    const skill = {
        // Echo skills get their own DMG bonus bucket; tag as 'echo' so the
        // formula / buff system can target echo-skill bonuses specifically.
        skillType: 'echo',
        multiplier: mult,
        scaling: SCALING_BY_PROP[active.relatedPropId] ?? 'atk',
        element: active.element,
    };
    const result = computeDamage({ stats, skill, target });

    return {
        skillLv: null,
        echoName: echoDef.name,
        hits: [{ id: `echo_${echo.id}`, skill, result }],
        totalExpected: result.expected,
        totalCrit: result.crit,
        totalNonCrit: result.nonCrit,
    };
}

export const __test__ = { SCALING_BY_PROP };