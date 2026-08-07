/**
 * The Tune Strain chain, read off each resonator's own Tune Break node.
 *
 * The game states this mechanic in four kits with near-identical wording, which
 * is what makes it worth deriving rather than curating — the phrasing is a
 * template, and a template that stops matching should FAIL LOUDLY rather than
 * be silently maintained in two places.
 *
 * The chain, in the game's own terms:
 *
 *   1. A cast inflicts **Tune Strain - Shifting** on the target (25s).
 *   2. A **Tune Break** on a Shifting target converts it to **Tune Strain -
 *      Interfered**.
 *   3. A resonator who "can respond to Tune Strain - Interfered" then gets:
 *      *"For each stack of Tune Strain - Interfered on the target, each point
 *      of X's Tune Break Boost increases X's total DMG against the target by
 *      0.12%."*
 *   4. Every responder also carries *"While X is in the team, the max stack
 *      limit of Tune Strain - Interfered on a target is increased by 1."*
 *
 * Point 4 is why the cap needs no curated base: the limit IS the number of
 * responders on the team. No kit states a base, all four state the same +1, and
 * a base of anything else would make the four statements arbitrary.
 *
 * Three facts are derived per resonator, all from the one node:
 *   `respondsToStrain`  — can this resonator respond at all
 *   `interferedCapRaise`— its contribution to the target's stack limit
 *   `boostPerPoint`     — the per-point, per-stack damage rate (0.0012)
 *
 * What is NOT derived here: the Tune Break Boost GRANTS. Those live in scattered
 * chain/inherent/skill nodes with genuinely varied phrasing and there are five
 * of them, so they are curated in `src/core/tune-break.js` with their quotes.
 */

// "X can respond to Tune Strain - Interfered", also as part of a list
// ("... respond to Tune Rupture - Interfered and Tune Strain - Interfered").
const RESPONDS_RE = /can\s+respond\s+to\s+[^.]*?Tune\s+Strain\s*-\s*Interfered/i;

// "the max stack limit of Tune Strain - Interfered on a target is increased by 1"
// and Lynae's inversion, "the target's max stack limit of [Tune Strain -
// Interfered] is increased by 1".
const CAP_RAISE_RE =
    /max\s+stack\s+limit\s+of\s+\[?Tune\s+Strain\s*-\s*Interfered\]?[^.]*?increased\s+by\s+(\d+)|max\s+stack\s+limit\s+of\s+\[?Tune\s+Strain\s*-\s*Interfered\]?\s+is\s+increased\s+by\s+(\d+)/i;

// "each point of X's Tune Break Boost increases … DMG against the target by 0.12%"
const PER_POINT_RE =
    /each\s+point\s+of[^.]*?Tune\s+Break\s+Boost[^.]*?by\s+([\d.]+)\s*%/i;

/**
 * Read the Tune Strain facts off one resonator's Tune Break node.
 * Returns null when the node does not describe the mechanic at all, which is
 * the case for 50 of the 56 — most resonators can Tune Break but not respond.
 */
export function deriveTuneStrain(resonator) {
    const text = resonator?.tuneBreak?.desc ?? '';
    if (!RESPONDS_RE.test(text)) return null;

    const capMatch = CAP_RAISE_RE.exec(text);
    const perPointMatch = PER_POINT_RE.exec(text);
    return {
        respondsToStrain: true,
        // A responder that states no raise contributes none — read, not assumed.
        interferedCapRaise: capMatch ? Number(capMatch[1] ?? capMatch[2]) : 0,
        // Stored as a FRACTION per point per stack (0.12% → 0.0012).
        boostPerPoint: perPointMatch ? parseFloat(perPointMatch[1]) / 100 : null,
    };
}

/**
 * Stamp `resonator.tuneBreak.strain` for every responder, and return the tally
 * for the preprocess log.
 *
 * The uniformity assertion lives in tests/tune-strain.test.mjs rather than here:
 * every responder must agree on `boostPerPoint`, because the game states one
 * rate and four copies of it. A future kit that states a different rate is a
 * real finding, not a parse failure, and the test names it.
 */
export function applyTuneStrain(resonators) {
    let responders = 0;
    for (const resonator of resonators) {
        const strain = deriveTuneStrain(resonator);
        if (!strain || !resonator.tuneBreak) continue;
        resonator.tuneBreak.strain = strain;
        responders++;
    }
    return responders;
}
