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
 *   - Liberation cost is subtracted unconditionally at the cast; the cursor may
 *     go negative — the deficit is the signal (same convention as sim.js).
 *
 * Informational only — never gates damage (the P11.5 invariant carries over).
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
        let liberationCastable = null;
        if (ev.isLiberation) {
            liberationCastable = liberationCost == null ? null : energyBefore >= liberationCost;
            cursor -= liberationCost ?? 0;
        }
        cursor += ev.base * er;
        trace.push({
            t: ev.t, pass: ev.pass, energyBefore, energyAfter: cursor,
            isLiberation: ev.isLiberation, liberationCastable,
        });
    }
    return trace;
}

/**
 * Closed-form minimum ER at which every counted liberation in the member's
 * event stream is castable at cast time.
 *
 * Liberations in passes BEFORE `fromPass` are excluded from the requirement
 * (cold-start convention: the gauge starts at 0, so the first cycle's cast is
 * a player-managed pre-charge concern, not a build requirement) but their cost
 * subtraction still counts — they were cast.
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
    let baseSum = 0;     // S: ER-independent accumulated base
    let k = 0;           // liberation count (all passes — costs always subtract)
    let counted = 0;
    let required = 0;
    for (const ev of events) {
        if (ev.isLiberation) {
            k++;
            if (ev.pass >= fromPass) {
                counted++;
                if (baseSum <= 0) return { minViable: null, achievable: false, liberations: counted };
                required = Math.max(required, (k * liberationCost) / baseSum);
            }
        }
        baseSum += ev.base;
    }
    if (counted === 0) return { minViable: null, achievable: false, liberations: 0 };
    return { minViable: required, achievable: true, liberations: counted };
}

export { OFF_FIELD_SHARE };
