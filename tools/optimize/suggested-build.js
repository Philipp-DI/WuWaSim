/**
 * P12 — suggested-build search.
 *
 * Picks the best (sonata set × weapon) pairing for a resonator's reference
 * rotation by simming every candidate combination and keeping the highest total
 * damage. Candidates are pruned by element + role (candidateSonatasFor) and by
 * weapon type + base ATK (candidateWeaponsFor), so the search is a small grid —
 * a few sets × a few weapons — not a full enumeration.
 *
 * The winner is surfaced on an empty build as a one-click default suggestion,
 * and is also the anchor the per-sequence weights are computed at (a realistic,
 * best-in-slot-ish build, per §2 "accurate for a well-invested build").
 *
 * Pure + headless: consumes the same sim the runtime uses (sim-eval.totalDamage).
 */

import { referenceBuild, candidateSonatasFor, candidateWeaponsFor } from './reference-build.js';
import { totalDamage, TARGET } from './sim-eval.js';

/**
 * @returns {{ sonataId:number, weaponId:number, candidates:{sonatas:number[], weapons:number[]}, damage:number }}
 *          or null when no candidate is available.
 */
export function pickBestBuild({ resonator, dataset, rotation, template, sequenceLevel = 0 }) {
    const sonatas = candidateSonatasFor(resonator, dataset);
    const weapons = candidateWeaponsFor(resonator, dataset);
    if (sonatas.length === 0 || weapons.length === 0) return null;

    let best = null;
    for (const sonataId of sonatas) {
        for (const weaponId of weapons) {
            const build = referenceBuild({ resonator, dataset, sequenceLevel, sonataId, rotation, template, weaponId });
            const damage = totalDamage(build, dataset, TARGET);
            // Deterministic tie-break: lower sonataId, then lower weaponId.
            if (!best || damage > best.damage + 1e-6) best = { sonataId, weaponId, damage };
        }
    }
    return { ...best, candidates: { sonatas, weapons } };
}
