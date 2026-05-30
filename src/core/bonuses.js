/**
 * Utility to parse, resolve, and apply natural-language description buffs from
 * Wuthering Waves' Inherent Skills and Resonance Chain nodes.
 *
 * This design remains completely JSDOM-free, matching your system guidelines.
 */

// Mapping dictionary from common skill description keywords/phrases to internal stat keys.
const STAT_KEYWORD_MAP = [
    { regex: /ATK/i, key: 'atkPercent' },
    { regex: /Crit\.\s*Rate/i, key: 'critRate' },
    { regex: /Crit\.\s*DMG/i, key: 'critDmg' },
    { regex: /Energy\s*Regen/i, key: 'energyRegen' },
    { regex: /DMG\s*Ampl[iy]fied/i, key: 'damageBonus' },
    { regex: /Resonance\s*Liberation\s*(?:DMG|Finisher)/i, key: 'liberationBonus' },
    { regex: /Heavy\s*Attack\s*(?:DMG)?/i, key: 'heavyBonus' },
    { regex: /Basic\s*Attack\s*(?:DMG)?/i, key: 'basicBonus' },
    { regex: /Resonance\s*Skill\s*(?:DMG)?/i, key: 'skillBonus' }
];

/**
 * Extracts a numeric value from a param string (e.g., "200%" -> 2.0, "20%" -> 0.20, "15" -> 15)
 * @param {string} paramStr
 * @returns {number}
 */
export function parseParamValue(paramStr) {
    if (!paramStr) return 0;
    const clean = paramStr.replace(/<[^>]*>/g, '').trim(); // Strip HTML formatting tags if any
    if (clean.endsWith('%')) {
        return parseFloat(clean) / 100;
    }
    return parseFloat(clean) || 0;
}

/**
 * Scans a skill's description and parameters to determine if it grants flat/percentage buffs.
 * It maps descriptions containing statements like "Crit. DMG increases by {0}" directly to stats.
 * * @param {Object} skillData - The skill object (with name, desc, and param array).
 * @returns {Object} A key-value map of parsed stats (e.g. { critDmg: 0.20 })
 */
export function parseSkillBuffs(skillData) {
    const buffs = {};
    if (!skillData || !skillData.desc || !skillData.param) return buffs;

    const desc = skillData.desc.replace(/<[^>]*>/g, ''); // Strip color/link tags
    
    // Look for increase/amplification structures
    // Match patterns like "X increases by {0}" or "X gain {0} DMG Amplification"
    STAT_KEYWORD_MAP.forEach(({ regex, key }) => {
        if (regex.test(desc)) {
            // Find the index variable placeholder {N} inside the description
            const match = desc.match(new RegExp(`${regex.source}.*?\\{(\\d+)\\}`, 'i')) || 
                          desc.match(new RegExp('\\{(\\d+)\\}.*?' + regex.source, 'i'));
            if (match) {
                const paramIndex = parseInt(match[1], 10);
                if (skillData.param[paramIndex] !== undefined) {
                    const value = parseParamValue(skillData.param[paramIndex]);
                    buffs[key] = (buffs[key] || 0) + value;
                }
            } else if (skillData.param.length > 0) {
                // Fallback: If keyword is matched but template placeholders can't be mapped cleanly,
                // grab the first percentage parameter as a sensible default accumulator.
                const firstPercentIdx = skillData.param.findIndex(p => p.includes('%'));
                if (firstPercentIdx !== -1) {
                    buffs[key] = (buffs[key] || 0) + parseParamValue(skillData.param[firstPercentIdx]);
                }
            }
        }
    });

    return buffs;
}

/**
 * Calculates and aggregates all passive buffs unlocked on the current build
 * from Inherent Skills and Resonance Chain Sequences.
 * * @param {Object} build - The user's active build.
 * @param {Object} resonator - The full character data loaded from dataset.
 * @returns {Object} Accumulated stat buffs.
 */
export function resolveBuildBonuses(build, resonator) {
    const totalBuffs = {
        atkPercent: 0,
        critRate: 0,
        critDmg: 0,
        energyRegen: 0,
        damageBonus: 0,
        basicBonus: 0,
        heavyBonus: 0,
        skillBonus: 0,
        liberationBonus: 0
    };

    if (!resonator) return totalBuffs;

    // 1. Process Unlocked Inherent Skills
    if (build.inherentSkills && Array.isArray(build.inherentSkills)) {
        build.inherentSkills.forEach(skillId => {
            // Unlocked inherent skills are represented by nodes in resonator data (e.g. index 4, 5)
            // Or found directly inside the character skill branches or root skills
            const node = resonator.skills?.find(s => s.id === skillId) || 
                         resonator.inherentSkills?.find(s => s.id === skillId) ||
                         (resonator.forteNodes && resonator.forteNodes[skillId]?.skill);

            const skillData = node ? (node.skill || node) : null;
            if (skillData) {
                const buffs = parseSkillBuffs(skillData);
                for (const [key, val] of Object.entries(buffs)) {
                    if (totalBuffs[key] !== undefined) {
                        totalBuffs[key] += val;
                    }
                }
            }
        });
    }

    // 2. Process Unlocked Resonance Chain (Sequences 1 through N)
    const activeChainCount = Number(build.resonanceChain) || 0;
    if (activeChainCount > 0 && resonator.chains && Array.isArray(resonator.chains)) {
        for (let i = 0; i < Math.min(activeChainCount, resonator.chains.length); i++) {
            const chainNode = resonator.chains[i];
            const skillData = chainNode?.skill || chainNode;
            if (skillData) {
                const buffs = parseSkillBuffs(skillData);
                for (const [key, val] of Object.entries(buffs)) {
                    if (totalBuffs[key] !== undefined) {
                        totalBuffs[key] += val;
                    }
                }
            }
        }
    }

    return totalBuffs;
}