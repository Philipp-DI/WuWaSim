/**
 * Shared stat-priority derivation (P12).
 *
 * Pure functions that turn a computed marginal-weight vector into a ranked,
 * human-presentable priority order — used by BOTH the offline pipeline
 * (validation report) and the runtime app (build-page panel + stat ranking),
 * so it lives in src/core/ rather than tools/ (DRY; no sim/engine dependency).
 *
 * The three solo modes (maintainer direction, 2026-06-27): see
 * tools/optimize/breakpoints.js header for why ER is a mode choice rather than
 * a single fabricated breakpoint.
 */

export const NEAR_ZERO = 1e-6;     // weights below this are treated as 0

// Human labels for weight/priority stat keys (report + build-page panel).
export const STAT_LABELS = Object.freeze({
    critRate: 'Crit Rate',
    critDmg: 'Crit DMG',
    atkRatio: 'ATK%',
    hpRatio: 'HP%',
    defRatio: 'DEF%',
    energyRegen: 'Energy Regen',
    'dmgBonus.basic': 'Basic Attack DMG',
    'dmgBonus.heavy': 'Heavy Attack DMG',
    'dmgBonus.skill': 'Resonance Skill DMG',
    'dmgBonus.liberation': 'Resonance Liberation DMG',
    'dmgBonus.element': 'Element DMG Bonus',
});

export function statLabel(key) {
    return STAT_LABELS[key] ?? key;
}

/** Normalize a weight map so the top (kept) weight = 100; rest are % of it. */
export function normalizeWeights(weights, { excludeKeys = [] } = {}) {
    const entries = Object.entries(weights).filter(([k]) => !excludeKeys.includes(k));
    const max = Math.max(0, ...entries.map(([, v]) => v));
    if (max <= 0) return entries.map(([key, value]) => ({ key, value, normalized: 0 }));
    return entries.map(([key, value]) => ({ key, value, normalized: (value / max) * 100 }));
}

/**
 * Derive the ordered stat-priority list for one solo mode.
 *
 * @param {Object<string,number>} weights
 * @param {object} erMeta  — { scalesWithEr, erWeight, libCostKnown, balancedTarget }
 * @param {'dmgFocus'|'balanced'|'erFocus'} mode
 * @returns {Array<{ key:string, weight:number, note?:string, gate?:boolean }>}
 */
export function derivePriority(weights, erMeta, mode) {
    const damageStats = Object.entries(weights)
        .filter(([k, v]) => k !== 'energyRegen' && v > NEAR_ZERO)
        .sort((a, b) => b[1] - a[1])
        .map(([key, weight]) => ({ key, weight }));

    if (mode === 'dmgFocus') {
        return damageStats;                                   // ER excluded entirely
    }

    if (mode === 'balanced') {
        if (!erMeta.libCostKnown) return [...damageStats];    // not energy-gated → no ER prefix
        const targetPct = Math.round((erMeta.balancedTarget ?? 1.25) * 100);
        const erEntry = {
            key: 'energyRegen', weight: weights.energyRegen ?? 0, gate: true,
            note: `target ~${targetPct}% (then prioritize damage)`,
        };
        return [erEntry, ...damageStats];                     // soft target, not a breakpoint
    }

    // erFocus
    if (erMeta.scalesWithEr) {
        return [...damageStats, { key: 'energyRegen', weight: weights.energyRegen ?? 0 }]
            .sort((a, b) => b.weight - a.weight);             // ER ranks by its real weight
    }
    const note = erMeta.libCostKnown
        ? 'Solo ER breakpoint depends on multi-cycle / team energy (not computed solo — see meta)'
        : 'Liberation is not energy-gated for this resonator — ER carries no breakpoint';
    return [{ key: 'energyRegen', weight: 0, note }, ...damageStats];
}
