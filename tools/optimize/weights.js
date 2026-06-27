/**
 * P12 §4 — marginal stat weights by single-stat perturbation.
 *
 * For each stat in the weight set, perturb it by ±δ at the anchor and read the
 * damage slope (central difference, §4b — more stable than forward difference,
 * and naturally captures diminishing returns at the anchor's actual stat level,
 * e.g. Crit Rate near 100%). The weight is Δdamage per +1% of the stat (the
 * "per +1%" unit convention, PHASE0 §9). The optimizer never modifies the
 * engine — it perturbs a build and re-runs the unchanged sim (§13.1).
 *
 * Also derives the human-readable priority order, in the three solo modes the
 * maintainer specified (2026-06-27):
 *   - dmgFocus : pure DPS — Energy Regen excluded entirely.
 *   - balanced : weights + a soft Energy-Regen TARGET (default 125%, not a
 *                fabricated breakpoint).
 *   - erFocus  : Energy Regen ranked by its real weight for ER-SCALING kits
 *                (Mornye-type); for others, a note that the solo ER breakpoint
 *                depends on multi-cycle / team energy (deferred, never faked).
 */

import { totalDamage, injectStat, weightStatSet } from './sim-eval.js';
import { NEAR_ZERO } from '../../src/core/stat-priority.js';

// Re-export the shared priority/normalization helpers so the offline pipeline
// (orchestrator, validation report) and the test can import everything weight-
// related from here, while the single definition lives in src/core (DRY,
// runtime-importable). See src/core/stat-priority.js.
export { derivePriority, normalizeWeights, NEAR_ZERO } from '../../src/core/stat-priority.js';

export const DEFAULT_DELTA = 1;          // +1% perturbation (the weight unit)

/**
 * Central-difference slope of total damage w.r.t. one stat at the anchor.
 * @returns {{ central:number, forward:number }} both per +1% (forward for the
 *   §10 sanity check that the two gradients agree within tolerance).
 */
export function gradientOneStat(anchor, dataset, statDef, delta = DEFAULT_DELTA) {
    const d0 = totalDamage(anchor, dataset);
    const dPlus = totalDamage(injectStat(anchor, statDef, delta), dataset);
    const dMinus = totalDamage(injectStat(anchor, statDef, -delta), dataset);
    return {
        central: (dPlus - dMinus) / (2 * delta),
        forward: (dPlus - d0) / delta,
    };
}

/**
 * Compute the full marginal-weight vector at the anchor.
 * @param {object} anchor    — a referenceBuild() (already at the desired ER)
 * @param {object} dataset
 * @param {object} resonator — for the element DMG-bonus entry
 * @returns {{ weights: Object<string,number>, baseline: number }}
 */
export function computeWeights(anchor, dataset, resonator, delta = DEFAULT_DELTA) {
    const baseline = totalDamage(anchor, dataset);
    const weights = {};
    for (const statDef of weightStatSet(resonator.element)) {
        const g = gradientOneStat(anchor, dataset, statDef, delta);
        weights[statDef.key] = Math.abs(g.central) < NEAR_ZERO ? 0 : g.central;
    }
    return { weights, baseline };
}

