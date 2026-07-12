/**
 * Team-level Resonance Energy model (P13 — the team-energy half absorbed from
 * the auto-optimizer plan's Phase B; prerequisite for the §5a.2 team-ER sweep).
 *
 * Rules (docs/energy-signal-findings.md, maintainer-confirmed 2026-06-27):
 *   - On-field: a member gains their own step's base generation × their own ER
 *     (identical to the solo P11.5 accumulator in sim.js).
 *   - Off-field: a member gains 50% of whatever the ACTIVE member's step
 *     generates as a base amount, scaled by the OFF-FIELD member's own ER.
 *     Off-field members generate nothing by their own actions.
 *   - A scripted Liberation cast always fully consumes the gauge (resets it
 *     to 0) once its cost is known, regardless of whether the built ER
 *     actually met that cost at that point — the rotation is authored as
 *     something the player DOES execute, so downstream steps assume it
 *     happened. `liberationCastable` (energyBefore >= cost) is the separate
 *     legitimacy flag for that question, never expressed as a negative or
 *     partially-spent energy value (maintainer-directed 2026-07-12,
 *     superseding the narrower 2026-07-10 "only spend when castable" rule).
 *
 * This layer itself never mutates a given rotation's damage (the P11.5
 * invariant). Since 2026-07-12 the derived-opener path (opener.js, opt-in
 * via team-sim's `deriveOpeners`) DOES consult the same accumulation rule
 * (applyEnergyEvent below) to change the ROTATION — filler casts or a gated
 * Liberation — before the sim runs; that is where energy honestly costs
 * damage/time now.
 *
 * The key property this module exploits: a member's accumulated energy is
 * LINEAR in their own ER. Every source (own casts AND the off-field share)
 * scales by the member's own ER, while liberation costs are constants. So the
 * energy before the k-th liberation is  ER × S_k − (k−1) × cost , with
 * S_k = the ER-independent base sum accumulated before that cast. The minimum
 * viable ER is therefore closed-form:  max over k of  k × cost / S_k  — no
 * iterative sweep required.
 */

const OFF_FIELD_SHARE = 0.5;

/**
 * Project a team-sim result's segments into per-member energy event streams.
 *
 * @param {Array} segments — TeamSimResult.segments (needs `pass` + `simResult`)
 * @returns {Map<number, Array>} resonatorId → [{ t, base, isLiberation, pass }]
 *   `base` is the ER-independent energy basis for THAT member at that step:
 *   their own cast's rawGen, or OFF_FIELD_SHARE × the active member's rawGen.
 *   `isLiberation` is only set on the member's OWN liberation casts.
 */
export function collectEnergyEvents(segments) {
    const memberIds = [...new Set(segments.map(s => s.resonatorId))];
    const events = new Map(memberIds.map(id => [id, []]));

    for (const seg of segments) {
        const trace = seg.simResult?.energyTrace;
        if (!trace?.length) continue;               // outro/offField — no casts
        for (let j = 0; j < trace.length; j++) {
            const e = trace[j];
            const t = seg.steps?.[j]?.startTime ?? seg.startTime;
            for (const id of memberIds) {
                const own = id === seg.resonatorId;
                const base = own ? (e.rawGen ?? 0) : OFF_FIELD_SHARE * (e.rawGen ?? 0);
                const isLiberation = own && e.isLiberation === true;
                if (base === 0 && !isLiberation) continue;
                events.get(id).push({ t, base, isLiberation, pass: seg.pass ?? 0 });
            }
        }
    }
    return events;
}

/**
 * Apply ONE energy event to a gauge value — the single shared accumulation
 * rule (2026-07-12; extracted so the derived-opener predictor in team-sim.js
 * uses the SAME arithmetic as the reported trace and can never drift from it):
 *   - own Liberation: castability is judged against the gauge BEFORE the
 *     cast's own generation; the cast always fully consumes the gauge (reset
 *     to 0) once its cost is known — the rotation is authored as something
 *     the player actually executes (maintainer-directed 2026-07-12).
 *   - then the event's base generation × the member's own ER is added,
 *     capped at the Liberation cost (a member can never bank more than one
 *     cast's worth — maintainer-confirmed 2026-07-10) and floored at 0.
 *
 * @param {number} gauge — current energy
 * @param {object} ev    — { base, isLiberation }
 * @param {object} opts  — { er, liberationCost }
 * @returns {{ gauge:number, liberationCastable:?boolean }}
 */
export function applyEnergyEvent(gauge, ev, { er, liberationCost }) {
    let liberationCastable = null;
    if (ev.isLiberation) {
        liberationCastable = liberationCost == null ? null : gauge >= liberationCost;
        if (liberationCost != null) gauge = 0;
    }
    gauge += ev.base * er;
    if (liberationCost != null) gauge = Math.min(gauge, liberationCost);
    gauge = Math.max(gauge, 0);
    return { gauge, liberationCastable };
}

/**
 * Accumulate one member's event stream at a concrete ER value — the
 * informational team-context trace (mirrors sim.js's solo energyTrace shape).
 *
 * @returns {Array} [{ t, pass, energyBefore, energyAfter, isLiberation,
 *                     liberationCastable }]
 */
export function accumulateEnergy(events, { er, liberationCost }) {
    const trace = [];
    let cursor = 0;
    for (const ev of events) {
        const energyBefore = cursor;
        const applied = applyEnergyEvent(cursor, ev, { er, liberationCost });
        cursor = applied.gauge;
        trace.push({
            t: ev.t, pass: ev.pass, energyBefore, energyAfter: cursor,
            isLiberation: ev.isLiberation, liberationCastable: applied.liberationCastable,
        });
    }
    return trace;
}

/**
 * Minimum ER at which every counted liberation in the member's event stream
 * is castable at cast time.
 *
 * Liberations in passes BEFORE `fromPass` are excluded from the requirement
 * (cold-start convention: the gauge starts at 0, so the first cycle's cast is
 * a player-managed pre-charge concern, not a build requirement) but they
 * still reset the gauge afterward — they were cast.
 *
 * Binary search over a per-cycle-independent requirement (2026-07-12):
 * accumulateEnergy resets the gauge to exactly 0 after every Liberation with
 * a known cost, whether or not it was actually castable at that point (the
 * rotation is authored as something the player executes) — so each cycle's
 * requirement depends ONLY on that cycle's own local generation since the
 * previous reset, never on cross-cycle carryover. `energyBefore` at every
 * liberation is still monotonic non-decreasing in ER (raising ER can only
 * raise the local sum accumulated since the last reset), so bisection over
 * ER is valid; it isn't collapsed into a direct `max_k cost/S_k` closed form
 * here only because the per-cycle S_k isn't isolated as its own value in the
 * trace — a possible follow-up simplification, not a correctness gap.
 *
 * @param {Array}  events         — one member's stream from collectEnergyEvents
 * @param {number|null} liberationCost — baseStats energyMax; null = not energy-gated
 * @param {object} [opts]
 * @param {number} [opts.fromPass=0] — only liberations with pass ≥ this bind
 * @returns {{ minViable:number|null, achievable:boolean, liberations:number }}
 *   achievable:false when there is no cost, no counted liberation, or a counted
 *   liberation with zero accumulated base (no modeled income can ever cover it).
 */
export function minViableEr(events, liberationCost, { fromPass = 0 } = {}) {
    if (liberationCost == null || liberationCost <= 0) {
        return { minViable: null, achievable: false, liberations: 0 };
    }
    const counted = events.filter(e => e.isLiberation && e.pass >= fromPass).length;
    if (counted === 0) return { minViable: null, achievable: false, liberations: 0 };

    const feasible = (er) => accumulateEnergy(events, { er, liberationCost })
        .every(t => !t.isLiberation || t.pass < fromPass || t.liberationCastable === true);

    // Generous upper search bound — team-rank.js's own credibility ceiling
    // (MAX_CREDIBLE_ER, 1.8) discards anything remotely close to this anyway;
    // it only needs to be high enough to detect true "zero income ever" cases.
    const HI = 100;
    if (!feasible(HI)) return { minViable: null, achievable: false, liberations: counted };

    let lo = 0, hi = HI;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (feasible(mid)) hi = mid; else lo = mid;
    }
    return { minViable: hi, achievable: true, liberations: counted };
}

export { OFF_FIELD_SHARE };
