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

// Representative per-investment magnitude of each stat, in the same percentage-
// point unit the marginal weights are measured in (weights are per +1%). Used to
// turn a per-1% sensitivity into a per-investment value so the priority reflects
// "what is worth rolling/taking", which is what guide advice ("CR/CD > ATK%")
// actually compares. The decisive asymmetry: a Crit DMG echo SUBSTAT rolls at
// ~2× the magnitude of a Crit Rate / ATK% / DMG-bonus roll, so ranking by raw
// per-1% weight structurally under-values Crit DMG. Element DMG bonus is a
// 3-cost MAIN (not a substat); its unit is the main-stat magnitude so it ranks
// as the main-slot choice it is.
//   Substat mid-roll values (WuWa): CR 8.1 · CD 16.2 · ATK%/HP%/DEF% 9.0 ·
//   ER 9.2 · DMG-type bonus 9.0. Element DMG 3-cost main ≈ 30.
export const STAT_ROLL_VALUE = Object.freeze({
    critRate: 8.1,
    critDmg: 16.2,
    atkRatio: 9.0,
    hpRatio: 9.0,
    defRatio: 9.0,
    energyRegen: 9.2,
    'dmgBonus.basic': 9.0,
    'dmgBonus.heavy': 9.0,
    'dmgBonus.skill': 9.0,
    'dmgBonus.liberation': 9.0,
    'dmgBonus.element': 30.0,
});

// Default roll unit for any key not listed (treated like a standard % substat).
const DEFAULT_ROLL_VALUE = 9.0;

export function rollValueOf(key) {
    return STAT_ROLL_VALUE[key] ?? DEFAULT_ROLL_VALUE;
}

// Per-investment value of a stat: marginal per-1% weight × its roll magnitude.
// This is the quantity the priority ranking and the display bars use.
export function perRollValue(key, weight) {
    return (weight ?? 0) * rollValueOf(key);
}

/** Normalize damage stats by PER-ROLL value so the top stat = 100 (display bars). */
export function normalizePerRoll(weights, { excludeKeys = [] } = {}) {
    const entries = Object.entries(weights).filter(([k]) => !excludeKeys.includes(k));
    const valued = entries.map(([key, weight]) => ({ key, weight, rollValue: perRollValue(key, weight) }));
    const max = Math.max(0, ...valued.map(e => e.rollValue));
    return valued.map(e => ({ ...e, normalized: max > 0 ? (e.rollValue / max) * 100 : 0 }));
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
    // Rank by PER-ROLL value (weight × roll magnitude), not raw per-1% weight, so
    // the order matches what is actually worth investing in (see STAT_ROLL_VALUE).
    const damageStats = Object.entries(weights)
        .filter(([k, v]) => k !== 'energyRegen' && v > NEAR_ZERO)
        .map(([key, weight]) => ({ key, weight, rollValue: perRollValue(key, weight) }))
        .sort((a, b) => b.rollValue - a.rollValue);

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
        return [...damageStats, { key: 'energyRegen', weight: weights.energyRegen ?? 0, rollValue: perRollValue('energyRegen', weights.energyRegen) }]
            .sort((a, b) => b.rollValue - a.rollValue);       // ER ranks by its real (per-roll) weight
    }
    const note = erMeta.libCostKnown
        ? 'Solo ER breakpoint depends on multi-cycle / team energy (not computed solo — see meta)'
        : 'Liberation is not energy-gated for this resonator — ER carries no breakpoint';
    return [{ key: 'energyRegen', weight: 0, note }, ...damageStats];
}
