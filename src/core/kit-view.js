// src/core/kit-view.js
/**
 * Kit view: every curated ability of a build, priced once each (roadmap step 2,
 * #100). The build page's ability cards and its top strip read it.
 *
 *   kitView({ build, dataset, target }) -> KitAbility[] | null
 *
 *   KitAbility = { key, def, resolved, support }
 *     resolved: ResolvedSkill | null   (null = no damage rows)
 *     support:  support rows | null    (heal / shield)
 *
 * Scope (maintainer, 2026-11-20, #100): a quick check of how gear moves each
 * ability's damage. Each ability is priced SOLO (no team or external buffs) as
 * a COLD standalone cast: the gear's static hit inputs and the kit's
 * unconditional effects apply; no state the cast enters, no window it opens.
 * It is not a one-cast sim and differs from the sim where a cast switches on
 * its own buffs. Returns null when the resonator has no skill map.
 */
import { resolveSkill, resolveSupport } from './skill.js';
import { effectiveSkillMap } from './skill-map.js';
import { resolveTotalStats } from './stats.js';
import { staticHitInputs } from './static-hit-inputs.js';

export function kitView({ build, dataset, target }) {
    const skillMap = effectiveSkillMap(dataset, build?.resonatorId);
    if (!skillMap) return null;
    const stats = resolveTotalStats(build, dataset);
    const gearInputs = staticHitInputs({ build, dataset });
    const abilities = [];
    for (const [key, def] of Object.entries(skillMap)) {
        if (key.startsWith('_')) continue;
        const resolved = resolveSkill({ skillDef: def, build, dataset, stats, target, skillKey: key,
            amplifyContext: gearInputs.amplify, targetContext: gearInputs.targetMods });
        const support = resolved ? resolved.supportOutput : resolveSupport({ skillDef: def, build, dataset, stats });
        abilities.push({ key, def, resolved, support: support ?? null });
    }
    return abilities;
}
