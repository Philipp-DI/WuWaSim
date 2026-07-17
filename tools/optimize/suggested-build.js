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

import { referenceBuild, candidateSonatasFor, candidateWeaponsFor, scalingStatFor } from './reference-build.js';
import { allocateSubstats, allocationToSubstats } from '../../src/core/substat-allocate.js';
import { totalDamage, TARGET } from './sim-eval.js';

// A template with the mains/cost layout kept but substats stripped — the base
// the allocator co-optimizes from. The fixed package would otherwise pre-load
// the build with the stats the allocator is meant to choose.
const stripSubstats = (template) => template.map(slot => ({ ...slot, subStats: [] }));

/**
 * Pick the best (sonata × weapon × co-optimized substats) for a resonator's
 * reference rotation. Weapon is chosen cheaply at the fixed template (base
 * ATK / crit secondary dominate that choice), then EACH sonata's substats are
 * co-optimized so sets are compared fairly — a Crit-providing set gets a
 * CR-light allocation instead of wasting CR against a maxed template (the CR-cap
 * unfairness that mis-ranked Wishes for Hiyuki).
 *
 * @returns {{ sonataId, weaponId, damage, substatTarget, substatCounts,
 *             candidates:{sonatas:number[], weapons:number[]} } | null}
 */
export function pickBestBuild({ resonator, dataset, rotation, template, sequenceLevel = 0 }) {
    const sonatas = candidateSonatasFor(resonator, dataset);
    const weapons = candidateWeaponsFor(resonator, dataset);
    if (sonatas.length === 0 || weapons.length === 0) return null;

    const scaling = scalingStatFor(resonator);
    const baseTemplate = stripSubstats(template);

    let best = null;
    for (const sonataId of sonatas) {
        // 1) Best weapon for this sonata at the fixed template (cheap pre-rank).
        let weaponId = null, wDmg = -Infinity;
        for (const wid of weapons) {
            const build = referenceBuild({ resonator, dataset, sequenceLevel, sonataId, rotation, template, weaponId: wid });
            const dmg = totalDamage(build, dataset, TARGET);
            if (dmg > wDmg + 1e-6) { wDmg = dmg; weaponId = wid; }
        }
        // 2) Co-optimize substats for (sonata × best weapon) — the fair comparison.
        const baseBuild = referenceBuild({ resonator, dataset, sequenceLevel, sonataId, rotation, template: baseTemplate, weaponId });
        const alloc = allocateSubstats({ baseBuild, dataset, scaling, target: TARGET });
        // Deterministic tie-break: lower sonataId.
        if (!best || alloc.damage > best.damage + 1e-6) {
            best = { sonataId, weaponId, damage: alloc.damage, substatCounts: alloc.counts };
        }
    }

    return {
        sonataId: best.sonataId,
        weaponId: best.weaponId,
        damage: best.damage,
        substatCounts: best.substatCounts,
        substatTarget: allocationToSubstats(best.substatCounts, scaling, dataset.statRanges),
        candidates: { sonatas, weapons },
    };
}
