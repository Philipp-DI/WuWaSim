/**
 * P12 §8 — runtime application of frozen weights to the user's actual build.
 *
 * Pure arithmetic on the frozen meta numbers — no simulation (the payoff of the
 * precompute design). Given a meta entry (from meta-loader.metaFor) and the
 * user's build, produce: the mode-aware stat priority, the ER status vs the
 * balanced target, and an anchor-distance measure for the "weights assume a
 * well-invested build" caveat.
 */

import { derivePriority, normalizeWeights, statLabel } from './stat-priority.js';
import { resolveTotalStats } from './stats.js';

// Weight keys a player can actually roll as an echo SUBSTAT (element DMG bonus
// is a 3-cost MAIN only, so it's excluded from substat ranking but kept in the
// full priority view).
const SUBSTAT_KEYS = new Set([
    'critRate', 'critDmg', 'atkRatio', 'energyRegen',
    'dmgBonus.basic', 'dmgBonus.heavy', 'dmgBonus.skill', 'dmgBonus.liberation',
]);

export const SOLO_MODES = Object.freeze(['dmgFocus', 'balanced', 'erFocus']);

/**
 * Full stat priority for a mode, with display labels + bars (top weight = 100).
 * @returns {Array<{ key, label, weight, normalized, note?, gate? }>}
 */
export function statPriority(metaEntry, mode = 'balanced') {
    if (!metaEntry?.weights) return [];
    const ordered = derivePriority(metaEntry.weights, metaEntry.erMode, mode);
    const norm = new Map(normalizeWeights(metaEntry.weights, { excludeKeys: ['energyRegen'] }).map(e => [e.key, e.normalized]));
    return ordered.map(e => ({
        ...e,
        label: statLabel(e.key),
        normalized: e.key === 'energyRegen' ? null : (norm.get(e.key) ?? 0),
    }));
}

/** Like statPriority but restricted to substat-rollable stats (echo substats). */
export function rankSubstats(metaEntry, mode = 'balanced') {
    return statPriority(metaEntry, mode).filter(e => SUBSTAT_KEYS.has(e.key));
}

/**
 * ER status vs the balanced target.
 * @returns {{ current:number, target:number, belowTarget:boolean,
 *             scalesWithEr:boolean, libCostKnown:boolean }}
 */
export function erStatus(userBuild, metaEntry, dataset) {
    const er = metaEntry?.erMode ?? {};
    const current = resolveTotalStats(userBuild, dataset).energyRegen;
    const target = er.balancedTarget ?? 1.25;
    return {
        current,
        target,
        belowTarget: er.libCostKnown ? current < target : false,
        scalesWithEr: !!er.scalesWithEr,
        libCostKnown: !!er.libCostKnown,
    };
}

/**
 * A rough scalar measure of how far the user's build is from the anchor (§8/§9).
 * Used to decide whether to show the "weights assume a well-invested build"
 * caveat. 0 = at the anchor; grows as crit / ATK drift below it. Returns null
 * if the meta lacks anchorStats (older meta).
 */
export function anchorDistance(userBuild, metaEntry, dataset) {
    const a = metaEntry?.anchorStats;
    if (!a) return null;
    const s = resolveTotalStats(userBuild, dataset);
    const dCR = s.critRate - a.critRate;
    const dCD = (s.critDmg - a.critDmg) * 0.5;            // CD spans a wider range; down-weight
    const dATK = a.atk > 0 ? (s.atk - a.atk) / a.atk : 0; // relative ATK gap
    return Math.sqrt(dCR * dCR + dCD * dCD + dATK * dATK);
}

// Builds further than this from the anchor get the "your priorities may differ"
// caveat (§9.4). Tuned so a roughly-endgame build clears it, an early build doesn't.
export const ANCHOR_FAR_THRESHOLD = 0.5;

export function isFarFromAnchor(userBuild, metaEntry, dataset) {
    const dist = anchorDistance(userBuild, metaEntry, dataset);
    return dist != null && dist > ANCHOR_FAR_THRESHOLD;
}
