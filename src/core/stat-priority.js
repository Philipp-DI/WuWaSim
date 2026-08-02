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

import { SUB_RANGE_KEY_TO_STAT, possibleRollsFor } from './echo-rules.js';

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
    'dmgBonus.skill': 'Res. Skill DMG',
    'dmgBonus.liberation': 'Res. Liberation DMG',
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
// per-1% weight structurally under-values Crit DMG.
//
// The roll magnitude is the AVERAGE of that stat's real discrete roll values
// from data/stat-ranges.json (possibleRollsFor), not a hand-typed guess — a
// hardcoded table here previously diverged from the actual data (its DEF%
// entry silently reused the ATK%/HP% number; the real DEF% average is
// materially higher, since the game rolls DEF% at larger magnitudes).
// Element DMG bonus is the one exception: it's a 3-cost MAIN stat, not a
// rollable substat, so it has no data/stat-ranges.json entry — its unit stays
// a fixed main-stat-magnitude approximation.
const ROLL_KEY_TO_RANGE_KEY = Object.freeze({
    critRate: 'CR%',
    critDmg: 'CD%',
    atkRatio: 'ATK%',
    hpRatio: 'HP%',
    defRatio: 'DEF%',
    energyRegen: 'ER%',
    'dmgBonus.basic': 'BAD%',
    'dmgBonus.heavy': 'HAD%',
    'dmgBonus.skill': 'RSD%',
    'dmgBonus.liberation': 'RLD%',
});

// Main-stat (non-rollable) magnitudes — not in data/stat-ranges.json by nature.
const MAIN_STAT_ROLL_VALUE = Object.freeze({ 'dmgBonus.element': 30.0 });

// Fallback for a key with no range data at all (should not happen for any key
// in ROLL_KEY_TO_RANGE_KEY once statRanges is loaded — a defensive floor only).
const DEFAULT_ROLL_VALUE = 9.0;

/** True average of a stat's real discrete roll values (data/stat-ranges.json). */
export function averageRollValueFor(key, statRanges) {
    if (key in MAIN_STAT_ROLL_VALUE) return MAIN_STAT_ROLL_VALUE[key];
    const rangeKey = ROLL_KEY_TO_RANGE_KEY[key];
    const stat = rangeKey ? SUB_RANGE_KEY_TO_STAT[rangeKey] : null;
    const rolls = stat ? possibleRollsFor(stat, statRanges) : [];
    if (!rolls.length) return DEFAULT_ROLL_VALUE;
    return rolls.reduce((sum, roll) => sum + roll, 0) / rolls.length;
}

export function rollValueOf(key, statRanges) {
    return averageRollValueFor(key, statRanges);
}

// Per-investment value of a stat: marginal per-1% weight × its roll magnitude.
// This is the quantity the priority ranking and the display bars use.
export function perRollValue(key, weight, statRanges) {
    return (weight ?? 0) * rollValueOf(key, statRanges);
}

/** Normalize damage stats by PER-ROLL value so the top stat = 100 (display bars). */
export function normalizePerRoll(weights, statRanges, { excludeKeys = [] } = {}) {
    const entries = Object.entries(weights).filter(([k]) => !excludeKeys.includes(k));
    const valued = entries.map(([key, weight]) => ({ key, weight, rollValue: perRollValue(key, weight, statRanges) }));
    const max = Math.max(0, ...valued.map(entry => entry.rollValue));
    return valued.map(entry => ({ ...entry, normalized: max > 0 ? (entry.rollValue / max) * 100 : 0 }));
}

/** Normalize a weight map so the top (kept) weight = 100; rest are % of it. */
export function normalizeWeights(weights, { excludeKeys = [] } = {}) {
    const entries = Object.entries(weights).filter(([k]) => !excludeKeys.includes(k));
    const max = Math.max(0, ...entries.map(([, value]) => value));
    if (max <= 0) return entries.map(([key, value]) => ({ key, value, normalized: 0 }));
    return entries.map(([key, value]) => ({ key, value, normalized: (value / max) * 100 }));
}

/**
 * Derive the ordered stat-priority list for one solo mode.
 *
 * @param {Object<string,number>} weights
 * @param {object} erMeta  — { scalesWithEr, erWeight, libCostKnown, balancedTarget }
 * @param {'dmgFocus'|'balanced'|'erFocus'} mode
 * @param {object} [statRanges] — dataset.statRanges, for real per-roll magnitudes
 * @returns {Array<{ key:string, weight:number, note?:string, gate?:boolean }>}
 */
export function derivePriority(weights, erMeta, mode, statRanges) {
    // Rank by PER-ROLL value (weight × roll magnitude), not raw per-1% weight, so
    // the order matches what is actually worth investing in (see averageRollValueFor).
    const damageStats = Object.entries(weights)
        .filter(([k, value]) => k !== 'energyRegen' && value > NEAR_ZERO)
        .map(([key, weight]) => ({ key, weight, rollValue: perRollValue(key, weight, statRanges) }))
        .sort((entryA, entryB) => entryB.rollValue - entryA.rollValue);

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
        return [...damageStats, { key: 'energyRegen', weight: weights.energyRegen ?? 0, rollValue: perRollValue('energyRegen', weights.energyRegen, statRanges) }]
            .sort((entryA, entryB) => entryB.rollValue - entryA.rollValue);       // ER ranks by its real (per-roll) weight
    }
    const note = erMeta.libCostKnown
        ? 'Solo ER breakpoint depends on multi-cycle / team energy (not computed solo — see meta)'
        : 'Liberation is not energy-gated for this resonator — ER carries no breakpoint';
    return [{ key: 'energyRegen', weight: 0, note }, ...damageStats];
}
