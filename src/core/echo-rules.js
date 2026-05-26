// src/core/echo-rules.js
/**
 * Echo rules and constraints — central source of truth.
 *
 * In WuWa, an echo's allowable stats follow strict rules based on its
 * cost and enhancement level. This module encodes those rules so that
 * the editor and the damage engine agree on what's valid.
 *
 * Rules implemented:
 *   1. **Main stat pool by cost** — only specific main stats can appear
 *      on each cost tier.
 *   2. **Fixed sub-main stat** — every echo has a deterministic flat
 *      stat (ATK or HP) based purely on its cost. Scales linearly with
 *      level: baseValue at Lv0, baseValue × 5 at Lv25.
 *   3. **Substat slot unlock** — one slot every 5 levels (0..25), so
 *      Lv0 = 0 substats, Lv5 = 1, ..., Lv25 = 5.
 *   4. **No duplicate substats on the same echo.**
 *   5. **Total cost cap of 12** across 5 slots (4+3+3+1+1 or 4+4+1+1+1+1
 *      meta builds). Soft enforcement — surfaced as a warning indicator.
 */

// =============================================================================
// 1. Main stat pool by cost — propIds keyed by addType
// =============================================================================

// Resolve the full stat options allowed for a given cost from the dataset.
// echoMainStats is now a cost-keyed map: { 4: [...], 3: [...], 1: [...] }
// produced by preprocess.mjs with per-cost correct StandardProperty values.
export function mainStatsForCost(cost, dataset) {
    return (dataset.echoMainStats?.[cost]) ?? [];
}

// =============================================================================
// 2. Fixed sub-main stat — auto-derived, uneditable
// =============================================================================

// Per-cost base value at Lv0. At Lv25 the value is exactly baseValue × 5.
// Linear scaling between, so Lv5 = baseValue × 1.8, Lv10 = ×2.6, etc.
//
// 4-cost:  30 ATK @ Lv0  →  150 ATK @ Lv25
// 3-cost:  20 ATK @ Lv0  →  100 ATK @ Lv25
// 1-cost: 456 HP  @ Lv0  → 2280 HP  @ Lv25
const SUB_MAIN_BY_COST = Object.freeze({
    4: { propId: 10007, addType: 1, name: 'ATK', isPercent: false, baseValue: 30 },
    3: { propId: 10007, addType: 1, name: 'ATK', isPercent: false, baseValue: 20 },
    1: { propId: 10002, addType: 1, name: 'HP', isPercent: false, baseValue: 456 },
});

/**
 * Compute the sub-main stat for an echo at a given level.
 * Returns a stat object compatible with the engine, or null if cost
 * isn't recognized.
 *
 * Scaling: linear from baseValue at Lv0 to baseValue × 5 at Lv25.
 * Formula: baseValue × (1 + 4 × level / 25).
 */
export function subMainStatFor(cost, level) {
    const def = SUB_MAIN_BY_COST[cost];
    if (!def) return null;
    const lv = clampLevel(level);
    const mul = 1 + 4 * (lv / 25);
    const value = Math.round(def.baseValue * mul);
    return {
        propId: def.propId,
        addType: def.addType,
        name: def.name,
        isPercent: def.isPercent,
        value,
        // Mark as auto-derived so the editor knows not to expose it as
        // editable and the breakdown can label it distinctly.
        derived: true,
    };
}

// =============================================================================
// 3. Substat slot unlock — one slot per 5 enhancement levels
// =============================================================================

export const MAX_ECHO_LEVEL = 25;
export const ECHO_LEVEL_STEP = 5;

/** Number of unlocked substat rows at the given level (0..5). */
export function unlockedSubStatCount(level) {
    return Math.floor(clampLevel(level) / ECHO_LEVEL_STEP);
}

/** Snap an arbitrary level to the nearest valid step (0/5/10/15/20/25). */
export function snapLevel(level) {
    const lv = clampLevel(level);
    return Math.round(lv / ECHO_LEVEL_STEP) * ECHO_LEVEL_STEP;
}

function clampLevel(level) {
    if (!Number.isFinite(level)) return MAX_ECHO_LEVEL;
    if (level < 0) return 0;
    if (level > MAX_ECHO_LEVEL) return MAX_ECHO_LEVEL;
    return Math.trunc(level);
}

// =============================================================================
// 4. Substat dedupe + curated roll values
// =============================================================================

// Mapping from stat-ranges.json keys (CR%, CD%, BAD%, etc.) to
// {propId, addType} so we can resolve a roll value back to a stat
// dictionary entry. Built lazily.
//
// stat-ranges.json keys → propId/addType:
//   ATK   → 10007/1 (flat)
//   HP    → 10002/1 (flat)
//   DEF   → 10010/1 (flat)
//   ATK%  → 10007/2
//   HP%   → 10002/2
//   DEF%  → 10010/2
//   CR%   →     8/1 (Crit Rate, inherent-percent)
//   CD%   →     9/1 (Crit DMG)
//   ER%   →    11/1 (Energy Regen)
//   BAD%  →    17/1 (Basic Attack DMG Bonus)
//   HAD%  →    18/1 (Heavy Attack DMG Bonus)
//   RSD%  →    14/1 (Resonance Skill DMG Bonus)
//   RLD%  →    19/1 (Resonance Liberation DMG Bonus)
export const SUB_RANGE_KEY_TO_STAT = Object.freeze({
    'ATK': { propId: 10007, addType: 1 },
    'HP': { propId: 10002, addType: 1 },
    'DEF': { propId: 10010, addType: 1 },
    'ATK%': { propId: 10007, addType: 2 },
    'HP%': { propId: 10002, addType: 2 },
    'DEF%': { propId: 10010, addType: 2 },
    'CR%': { propId: 8, addType: 1 },
    'CD%': { propId: 9, addType: 1 },
    'ER%': { propId: 11, addType: 1 },
    'BAD%': { propId: 17, addType: 1 },
    'HAD%': { propId: 18, addType: 1 },
    'RSD%': { propId: 14, addType: 1 },
    'RLD%': { propId: 19, addType: 1 },
});

/**
 * Look up the curated possible_rolls array for a stat option.
 * Returns [] when the stat isn't covered (defensive — every substat in
 * MAIN_POOL_BY_COST is covered by stat-ranges.json).
 */
export function possibleRollsFor(stat, statRanges) {
    if (!stat || !statRanges) return [];
    const key = statRangeKey(stat);
    return statRanges[key]?.possible_rolls ?? [];
}

function statRangeKey(stat) {
    for (const [key, ref] of Object.entries(SUB_RANGE_KEY_TO_STAT)) {
        if (ref.propId === stat.propId && ref.addType === stat.addType) return key;
    }
    return null;
}

// =============================================================================
// 5. Cost budget
// =============================================================================

export const COST_BUDGET = 12;

/** Sum the costs of the equipped echoes. */
export function totalEchoCost(echoes) {
    let total = 0;
    for (const e of echoes || []) {
        if (e && Number.isFinite(e.cost)) total += e.cost;
    }
    return total;
}

/** Returns true when total cost exceeds 12. Used for the cost indicator. */
export function isOverBudget(echoes) {
    return totalEchoCost(echoes) > COST_BUDGET;
}

// =============================================================================
// 6. Auto-derived main stat value
// =============================================================================

/**
 * Compute the display value for a main stat given the echo's cost,
 * star level, and enhancement level. Uses the cost-keyed scaling data
 * projected into the dataset.
 *
 * Returns null when the stat or star level isn't in the dataset.
 *
 * Example: 4-cost 5★ ATK% Lv25 → 33.0
 *          3-cost 5★ ATK% Lv25 → 30.0   (DIFFERENT — same propId, different pool)
 *          1-cost 5★ ATK% Lv25 → 18.0
 *          4-cost 5★ CR   Lv25 → 22.0
 *          4-cost 5★ CR   Lv0  → 4.4
 */
export function mainStatValueFor(statOpt, cost, starLevel, level, dataset) {
    if (!statOpt || !cost || !starLevel || !dataset) return null;
    // Look up in the cost-specific pool (cost-keyed echoMainStats map)
    const pool = dataset.echoMainStats?.[cost] ?? [];
    const entry = pool.find(
        s => s.propId === statOpt.propId && s.addType === statOpt.addType
    );
    if (!entry?.scaling?.[starLevel]) return null;
    const { standardProp } = entry.scaling[starLevel];
    const lv = clampLevel(level ?? MAX_ECHO_LEVEL);
    // Linear growth: 1.0× at Lv0 → 5.0× at Lv25
    const mult = 1 + 4 * (lv / MAX_ECHO_LEVEL);
    const scaled = standardProp * mult;
    const PERCENT_PROPS = new Set([8, 9, 35, 11, 22, 23, 24, 25, 26, 27]);
    if (statOpt.addType === 2 || PERCENT_PROPS.has(statOpt.propId)) {
        return Math.round(scaled / 100 * 10) / 10;
    }
    return Math.round(scaled);
}

// Test hooks
export const __test__ = {
    SUB_MAIN_BY_COST,
};