/**
 * Mark an inherent skill that a sequence node REPLACES.
 *
 * A chain node can supersede an inherent outright:
 *
 *   Aemeath S3: "Inherent Skill Between the Stars is replaced with the
 *                following effects: …"
 *
 * and the replacement restates the same buff at a higher value. Applying both
 * stacks two readings of ONE effect. Measured in game 2026-08-03: her crit
 * multiplier is 3.152x her sheet (2.552 + the replacement's 60%), while the sim
 * applied 3.452x — the replacement's 60% AND the superseded inherent's 30%,
 * inflating every crit she lands by 9.5%.
 *
 * The node names the inherent it replaces, so the link is read rather than
 * curated. Exactly one node in the roster does this today; a resonator with no
 * such clause is untouched, and a name that matches no inherent is left alone
 * rather than guessed at.
 */

const REPLACES_RE = /Inherent\s+Skill\s+(.+?)\s+is\s+replaced\s+with/i;

/** Normalised comparison form for an inherent skill's name. */
const norm = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Stamp `replacedByChain` on any inherent a sequence node supersedes.
 * @returns {number} how many inherents were marked, for the preprocess log
 */
export function markReplacedInherents(resonator) {
    const inherents = resonator?.inherentSkills ?? [];
    if (!inherents.length) return 0;
    let marked = 0;
    for (const chainNode of resonator.resonanceChain ?? []) {
        const match = REPLACES_RE.exec(chainNode.desc ?? '');
        if (!match) continue;
        const wanted = norm(match[1]);
        for (const inherent of inherents) {
            if (norm(inherent.name) !== wanted) continue;
            // Lowest replacing node wins — once superseded, it stays superseded.
            const level = chainNode.level ?? Infinity;
            if (level < (inherent.replacedByChain ?? Infinity)) {
                inherent.replacedByChain = level;
                marked++;
            }
        }
    }
    return marked;
}
