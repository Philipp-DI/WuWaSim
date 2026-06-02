/**
 * Echo substat optimizer — Phase 10.
 *
 * Greedy marginal-DPS selection for echo main stats and substats.
 * For each echo slot, it tries all valid substat types at max roll and
 * greedily picks the five that most increase rotation DPS.
 *
 * Algorithm (per echo slot):
 *   1. Clone the build with that echo's substats cleared.
 *   2. Compute baseline DPS (no substats in this slot).
 *   3. For each of 5 substat positions:
 *        - Try each remaining candidate substat at its max roll.
 *        - Score = total rotation DPS with that substat added.
 *        - Select the candidate with the highest DPS; record it.
 *   4. Repeat for main stats: try all valid options, keep the best.
 *
 * Complexity: O(echoes × 5 × 13) ≈ 325 simulateRotation calls, each
 * being a few hundred µs → well under 1 second in practice.
 *
 * The `setConstLut` (buildSonataLUT in stats.js) is already called
 * inside resolveTotalStats and caches the sonata-set constant portion,
 * so repeated calls with the same set configuration re-use the cache.
 */

import { simulateRotation } from './sim.js';

// =============================================================================
// Substat catalogue — all 13 valid substat entries at max-roll value.
// `value` is the max standardValue divided by 10000 for percent stats, or
// the raw max for flat stats (matching how applyEchoStat in stats.js reads them).
// =============================================================================

export const SUBSTAT_CATALOGUE = [
    { propId: 10002, addType: 1, name: 'HP',            isPercent: false, key: 'GreenLifeMax', value: 375    },
    { propId: 10007, addType: 1, name: 'ATK',           isPercent: false, key: 'GreenAtk',     value: 37     },
    { propId: 10010, addType: 1, name: 'DEF',           isPercent: false, key: 'GreenDef',      value: 45     },
    { propId: 10002, addType: 2, name: 'HP%',           isPercent: true,  key: 'GreenLifeMax',  value: 7.5    },
    { propId: 10007, addType: 2, name: 'ATK%',          isPercent: true,  key: 'GreenAtk',      value: 7.5    },
    { propId: 10010, addType: 2, name: 'DEF%',          isPercent: true,  key: 'GreenDef',      value: 9.5    },
    { propId: 14,    addType: 2, name: 'Skill DMG%',    isPercent: true,  key: 'skillDmgBonus', value: 7.5    },
    { propId: 17,    addType: 2, name: 'Basic DMG%',    isPercent: true,  key: 'basicDmgBonus', value: 7.5    },
    { propId: 18,    addType: 2, name: 'Heavy DMG%',    isPercent: true,  key: 'heavyDmgBonus', value: 7.5    },
    { propId: 19,    addType: 2, name: 'Lib DMG%',      isPercent: true,  key: 'libDmgBonus',   value: 7.5    },
    { propId: 8,     addType: 2, name: 'Crit Rate',     isPercent: true,  key: 'Crit',          value: 5      },
    { propId: 9,     addType: 2, name: 'Crit DMG',      isPercent: true,  key: 'CritDamage',    value: 10     },
    { propId: 11,    addType: 2, name: 'Energy Regen',  isPercent: true,  key: 'EnergyRegen',   value: 8      },
];

// Substat prop-IDs that are typically excluded for pure DPS characters.
// (DEF-based, HP-based, Energy Regen). Included in the catalogue so
// support/HP characters can still benefit; the scorer will naturally rank
// them low for pure ATK-scaling DPS characters.
const SUBSTAT_NAMES = SUBSTAT_CATALOGUE.map(s => s.name);

// =============================================================================
// Public API
// =============================================================================

/**
 * Suggest optimal main stats and substats for every occupied echo slot.
 *
 * @param {object} build       — current build
 * @param {object} dataset     — loaded dataset
 * @param {object} target      — enemy params { level, atkLv, resistances }
 * @returns {SuggestionResult}
 *
 * SuggestionResult {
 *   slots: SuggestedSlot[]
 * }
 *
 * SuggestedSlot {
 *   slotIndex:      number
 *   suggestedMain:  { propId, name, value } | null   (null for 1-cost echoes)
 *   suggestedSubs:  SubstatEntry[]                   (up to 5, best-first)
 *   dpsBaseline:    number
 *   dpsOptimized:   number
 * }
 */
export function suggestEchoSubstats(build, dataset, target) {
    const slots = [];
    const echoes = build.echoes ?? [];

    for (let i = 0; i < echoes.length; i++) {
        const echo = echoes[i];
        if (!echo) continue;

        const cost = echo.cost ?? 1;

        // ── 1. Find best main stat for this cost tier ─────────────────────────
        const mainOptions = dataset.echoMainStats?.[String(cost)] ?? [];
        let bestMain = null;
        let bestMainDps = -Infinity;

        if (mainOptions.length > 0) {
            for (const ms of mainOptions) {
                const starLevel = Math.min(echo.level ?? 25, 25) >= 25 ? 5 :
                    Math.min(echo.level ?? 0, 25) >= 20 ? 4 :
                    Math.min(echo.level ?? 0, 20) >= 15 ? 3 : 2;
                const rawVal = ms.scaling?.[String(starLevel)]?.lv25 ?? ms.scaling?.['5']?.lv25 ?? 0;
                const mainStat = { propId: ms.propId, name: ms.name, isPercent: ms.isPercent,
                                   addType: ms.addType ?? 2, value: rawVal, key: ms.key ?? '' };
                const testBuild = replaceEchoMainStat(build, i, mainStat);
                const dps = dpsOf(testBuild, dataset, target);
                if (dps > bestMainDps) { bestMainDps = dps; bestMain = mainStat; }
            }
        }

        // ── 2. Greedy substat selection ───────────────────────────────────────
        const baseEcho = { ...echo, mainStat: bestMain ?? echo.mainStat, subStats: [] };
        const baseBuild = { ...build, echoes: build.echoes.map((e, j) => j === i ? baseEcho : e) };
        const dpsBaseline = dpsOf(baseBuild, dataset, target);

        const selected = [];
        let currentBuild = baseBuild;

        for (let slot = 0; slot < 5; slot++) {
            // Available = all substats not yet selected (matched by propId + addType)
            const used = new Set(selected.map(s => `${s.propId}:${s.addType}`));
            const candidates = SUBSTAT_CATALOGUE.filter(s => !used.has(`${s.propId}:${s.addType}`));

            let bestCand = null;
            let bestDps = dpsOf(currentBuild, dataset, target);   // baseline with current subs

            for (const cand of candidates) {
                const testBuild = addSubstatToEcho(currentBuild, i, cand);
                const dps = dpsOf(testBuild, dataset, target);
                if (dps > bestDps) { bestDps = dps; bestCand = cand; }
            }

            if (!bestCand) break;  // no candidate improves DPS → stop early
            selected.push(bestCand);
            currentBuild = addSubstatToEcho(currentBuild, i, bestCand);
        }

        const dpsOptimized = dpsOf(currentBuild, dataset, target);

        slots.push({
            slotIndex:     i,
            suggestedMain: bestMain,
            suggestedSubs: selected,
            dpsBaseline,
            dpsOptimized,
        });
    }

    return { slots };
}

// =============================================================================
// Helpers
// =============================================================================

function dpsOf(build, dataset, target) {
    return simulateRotation({ build, dataset, target }).totals.dps;
}

function replaceEchoMainStat(build, slotIndex, mainStat) {
    const echoes = build.echoes.map((e, i) =>
        i === slotIndex && e ? { ...e, mainStat } : e
    );
    return { ...build, echoes };
}

function addSubstatToEcho(build, slotIndex, substat) {
    const echoes = build.echoes.map((e, i) => {
        if (i !== slotIndex || !e) return e;
        return { ...e, subStats: [...(e.subStats ?? []), substat] };
    });
    return { ...build, echoes };
}
