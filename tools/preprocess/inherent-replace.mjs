/**
 * Mark what a sequence node SUPERSEDES in an inherent skill.
 *
 * The game states this two ways, and they are not the same edit:
 *
 *   REPLACED  Aemeath S3: "Inherent Skill Between the Stars is replaced with
 *             the following effects: …"
 *   ENHANCED  Luuk Herssen S2: "Inherent Skill Uncaused Diagnosis is enhanced:
 *             … now Amplify this instance of damage by 10%."
 *
 * A REPLACEMENT takes the whole inherent out: the node restates everything it
 * is meant to do. Applying both stacks two readings of ONE effect. Measured in
 * game 2026-08-03: Aemeath's crit multiplier is 3.152x her sheet (2.552 + the
 * replacement's 60%), while the sim applied 3.452x — the replacement's 60% AND
 * the superseded inherent's 30%, inflating every crit she lands by 9.5%.
 *
 * An ENHANCEMENT is PARTIAL and must never be read as a replacement. The node
 * restates some of the inherent and leaves the rest standing — Luuk Herssen S2
 * raises one amplify rate and says nothing about the inherent's second
 * paragraph, which still applies. Suppressing the whole inherent there would
 * DELETE kit the chain node never touched, so an enhancement is resolved per
 * EFFECT: only an inherent effect the node restates is superseded, matched on
 * the (stat, element, skillType) triple so a differently-scoped grant survives.
 *
 * Which node effects count as "the enhancement" is read from the effect's own
 * condition text carrying the enhancement phrase. A restatement the parser did
 * not attach to that clause simply supersedes nothing, leaving today's
 * behaviour — the failure direction is a double-count that already exists, not
 * a silent deletion of kit.
 *
 * The node NAMES the inherent it edits, so the link is read rather than
 * curated. The name is bounded to one SENTENCE (`[^.]`): Lucy S5 mentions
 * "Inherent Skill - Ghost Cyberware" twice, and an unbounded capture ran from
 * the first mention to the second and resolved to nothing at all.
 */

const REPLACES_RE = /Inherent\s+Skill\s*-?\s*([^.]+?)\s+is\s+replaced\s+with/i;
const ENHANCES_RE = /Inherent\s+Skill\s*-?\s*([^.]+?)\s+is\s+(?:now\s+)?enhanced/i;

/** Normalised comparison form for an inherent skill's name. */
const norm = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Two effects hit the same bucket, so the later one restates the earlier. */
const sameTarget = (one, other) => one.stat === other.stat
    && (one.element ?? null) === (other.element ?? null)
    && (one.skillType ?? null) === (other.skillType ?? null);

/** The inherent a node's clause names, or null when nothing resolves. */
function namedInherent(inherents, match) {
    if (!match) return null;
    const wanted = norm(match[1]);
    return inherents.find(inherent => norm(inherent.name) === wanted) ?? null;
}

/**
 * Stamp what a sequence node supersedes: `replacedByChain` on a whole inherent,
 * `supersededByChain` on the individual effects an enhancement restates.
 *
 * Both are "lowest node wins" — once superseded, it stays superseded.
 *
 * @returns {number} how many inherents/effects were marked, for the preprocess log
 */
export function markSupersededInherents(resonator) {
    const inherents = resonator?.inherentSkills ?? [];
    if (!inherents.length) return 0;
    let marked = 0;
    for (const chainNode of resonator.resonanceChain ?? []) {
        const level = chainNode.level ?? Infinity;
        const desc = chainNode.desc ?? '';

        const replaced = namedInherent(inherents, REPLACES_RE.exec(desc));
        if (replaced && level < (replaced.replacedByChain ?? Infinity)) {
            replaced.replacedByChain = level;
            marked++;
        }

        const enhanceMatch = ENHANCES_RE.exec(desc);
        const enhanced = namedInherent(inherents, enhanceMatch);
        if (!enhanced) continue;
        // Only the node effects that belong to the enhancement CLAUSE may
        // supersede anything — a sequence node states several unrelated grants
        // and one of them sharing a stat with the inherent is a coincidence,
        // not a restatement.
        const phrase = enhanceMatch[0].toLowerCase();
        const restating = (chainNode.effects ?? [])
            .filter(effect => String(effect.condition ?? '').toLowerCase().includes(phrase));
        for (const effect of enhanced.effects ?? []) {
            if (!restating.some(node => sameTarget(node, effect))) continue;
            if (level < (effect.supersededByChain ?? Infinity)) {
                effect.supersededByChain = level;
                marked++;
            }
        }
    }
    return marked;
}
