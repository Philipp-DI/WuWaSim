/**
 * Sequence Node Evaluation — what a resonator's Resonance Chain is WORTH.
 *
 * Acquiring sequence nodes needs duplicate copies, which costs either extreme
 * luck or real money, so S0 is the honest baseline for ranking and the meta is
 * built there (`team-rank.js` builds every member at chain 0). That leaves a
 * question the app could not answer: for THIS resonator, how much does each
 * copy actually buy?
 *
 * The measurement, per the maintainer's specification (2026-09-02):
 *
 *   - Sim the resonator in their OWN baseline meta team — `byCharacter[id][0]`,
 *     the top-ranked team they anchor.
 *   - Raise ONLY that resonator's sequence level. Teammates stay at S0.
 *     Whale compositions are the user's business, not the meta's.
 *   - Report damage and the percentage over S0, per node.
 *
 * Everything else about the build is held fixed — same weapon, same echoes,
 * same sonata, same rotation — because `scoreTeam` reuses the cached
 * `representativeMemberBuild` and only applies `setChain`. That is what
 * isolates the node's own worth from a gear difference.
 *
 * TWO gains are reported and a support kit needs both. `own` is the
 * resonator's own damage, which is the whole story for a carry and can read
 * ZERO for a buffer whose node grants the team a stat. `team` is the team
 * total, which catches exactly that. A node that moves neither is genuinely
 * dead weight for this comp, and saying so is the point of the table.
 *
 * The S0 row is not recomputed from the ranked team's stored numbers: it is
 * measured in the same loop as the rest, so every ratio here divides two
 * figures produced by one code path. It must nevertheless AGREE with the card
 * (`tests/meta-schema.test.mjs`), because both are `scoreTeam` at chain 0 —
 * one measurement, the rule the suggested-teams card already lives by.
 */

import { scoreTeam } from './team-rank.js';

/** Sequence levels a Resonance Chain offers, in order. S0 is the baseline. */
export const SEQUENCE_LEVELS = Object.freeze([1, 2, 3, 4, 5, 6]);

/** Fraction `value` is above `baseline`, or 0 when there is nothing to divide. */
function gainOver(baseline, value) {
    if (!(baseline > 0)) return 0;
    return Number(((value - baseline) / baseline).toFixed(4));
}

/**
 * Evaluate every sequence node for every resonator that anchors a meta team.
 *
 * @param {Record<string, Array<{members: number[]}>>} byCharacter — ranked teams
 * @param {object} dataset
 * @returns {Record<string, object>} resonatorId → evaluation
 */
export function evaluateSequenceNodes(byCharacter, dataset) {
    const out = {};
    for (const [anchorId, teams] of Object.entries(byCharacter)) {
        const team = teams?.[0];
        if (!team?.members?.length) continue;
        const subject = Number(anchorId);

        const ownDamageOf = (scored) =>
            (scored?.perMember ?? []).find(member => member.id === subject)?.damage ?? 0;

        const baseline = scoreTeam(team.members, dataset);
        if (!baseline) continue;
        const baseTeam = baseline.teamDamage ?? 0;
        const baseOwn = ownDamageOf(baseline);

        const nodes = [];
        for (const chain of SEQUENCE_LEVELS) {
            const scored = scoreTeam(team.members, dataset, undefined, { [anchorId]: chain });
            if (!scored) continue;
            const teamDamage = scored.teamDamage ?? 0;
            const ownDamage = ownDamageOf(scored);
            const teamGain = gainOver(baseTeam, teamDamage);
            const ownGain = gainOver(baseOwn, ownDamage);
            nodes.push({
                chain,
                teamDamage: Math.round(teamDamage),
                ownDamage: Math.round(ownDamage),
                // Over S0, not over the previous node: the player buys the Nth
                // copy from a standing start, so what they want priced is the
                // whole climb, and a per-node step is a subtraction away.
                teamGain,
                ownGain,
                // A sequence node cannot make a team WORSE — it only ever adds
                // to a kit. A negative reading is therefore a modelling defect,
                // and it is flagged rather than clamped or filtered: a row
                // quietly dropped reads as "this node does nothing", which is a
                // different and wrong claim. Verina S4+ is the known case (see
                // docs/OPEN-ITEMS.md) — her team-wide grant costs her carry a
                // stacking buff worth 75%.
                ...(teamGain < 0 || ownGain < 0 ? { suspect: 'negative-gain' } : {}),
            });
        }
        if (!nodes.length) continue;

        out[String(subject)] = {
            team: team.members,
            baseline: { teamDamage: Math.round(baseTeam), ownDamage: Math.round(baseOwn) },
            nodes,
            // The headline a card wants: what the full chain buys, and the node
            // that buys the most on its own.
            fullChain: nodes[nodes.length - 1]?.ownGain ?? 0,
            bestNode: nodes.reduce((best, node, index) => {
                const step = node.ownGain - (index > 0 ? nodes[index - 1].ownGain : 0);
                return step > best.step + 1e-9 ? { chain: node.chain, step: Number(step.toFixed(4)) } : best;
            }, { chain: null, step: 0 }),
        };
    }
    return out;
}
