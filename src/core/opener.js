/**
 * Resonance Energy shortfalls — what a rotation cannot pay for, and the ER that
 * would fix it.
 *
 * ── What this used to be ────────────────────────────────────────────────────
 * ~~Derived opener padding (2026-07-12): when a consuming Liberation arrived
 * with a short projected gauge, splice in k repetitions of the member's own
 * pre-Liberation cycle so the shortfall became real filler TIME rather than
 * fabricated Liberation damage; and when no amount of filler could reach the
 * cost, GATE the cast — drop it from the pass and report it.~~
 *
 * Both halves are retired (2026-08-14, maintainer-directed), for two reasons
 * that only became visible once the reference rotations were aligned to
 * arabwuwa's:
 *
 *   1. THE COLD START WAS MODELLED WRONG. The gauge began EMPTY, so the first
 *      Liberation of a rotation was unpayable and the engine bought it with
 *      filler — 50.4s of it on the benchmark team, against arabwuwa's entire
 *      cold-start cost of 1.59s. In Tower of Adversity, the mode this app
 *      exists to model, every resonator enters with a FULL Resonance Energy
 *      meter. team-sim.js now starts the ledger there, and the first cast is
 *      funded by construction.
 *
 *   2. THE PADDING NEVER STOPPED. Its own docstring claimed "steady-state
 *      passes need no padding by construction", which holds only for a rotation
 *      that pays for its own Liberations. One that does not arrived short on
 *      EVERY pass and was padded on every pass: measured, pass 2 ran 39.64s
 *      against a clean steady state of 29.86s, and passes 2 and 3 did not even
 *      agree with each other. That is not a cold-start model.
 *
 * ── What it is now ──────────────────────────────────────────────────────────
 * A CURATED ROTATION IS PERFORMED AS AUTHORED. It is a statement of what the
 * player does, so the engine may neither rewrite it (splicing filler) nor
 * delete a cast from it (gating). A short gauge is not a rotation defect — it
 * is a BUILD that is under-geared for the rotation, and the honest output is to
 * say so and name the number that fixes it.
 *
 * So this walks the gauge and reports, per underfunded Liberation, how short it
 * was and the Energy Regen at which it would have been funded. Nothing is
 * fabricated, nothing is removed, and the damage is the damage the rotation
 * states. `team-energy.js minViableEr` derives the same requirement
 * independently over the team-time event stream; this is the per-rotation view.
 *
 * OVERCAP IS NOT POSSIBLE (`applyEnergyEvent` clamps to the cost, and the cost
 * IS the meter's size), so a full start means generation before the first
 * Liberation is spilled. That is correct and cheap: a Liberation is placed for
 * its buff window, not its energy efficiency — Chisa's feeds the +120% on
 * Sawring Blitz, a support's is cast late so it spans the next two members'
 * turns — and it is what gives the ER target its meaning.
 */

import { ECHO_STEP_KEY } from './sim.js';

const EPS = 1e-6;

/**
 * Walk a rotation's Resonance Energy and report every Liberation it cannot pay
 * for.
 *
 * The accumulation rule mirrors `team-energy.js applyEnergyEvent` exactly:
 * castability is judged BEFORE the cast's own generation, a consuming cast
 * resets the gauge to 0, and the gain is `base × ER` clamped to the cost.
 *
 * @param {object} args
 * @param {string[]} args.rotation
 * @param {object} args.skillMap        — effectiveSkillMap for the resonator
 * @param {number} [args.echoEnergyGain]— the equipped echo's per-cast energy
 * @param {number} args.er              — the build's Energy Regen (1.0 = 100%)
 * @param {number|null} args.liberationCost — baseStats energyMax; null = not gated
 * @param {number} [args.gaugeStart]    — energy carried in; team-sim starts this
 *        at the FULL meter for a member's first pass
 * @returns {?{shortfalls: Array<{key, deficit, requiredEr:number|null}>}}
 *          null when the rotation pays for everything it casts.
 */
export function deriveEnergyShortfalls({ rotation, skillMap, echoEnergyGain = 0, er,
    liberationCost, gaugeStart = 0 }) {
    if (liberationCost == null || liberationCost <= 0 || !rotation?.length) return null;

    const genOf = (key) => key === ECHO_STEP_KEY ? echoEnergyGain : (skillMap?.[key]?.energyGen ?? 0);
    const shortfalls = [];
    let gauge = gaugeStart;
    // Generation banked since the last reset, at ER 1.0 — the denominator of the
    // required-ER answer. Tracked separately from `gauge` because `gauge` is
    // clamped and reset, and neither is reversible.
    let baseSinceReset = gaugeStart / (er > 0 ? er : 1);

    for (const key of rotation) {
        const skillDef = skillMap?.[key];
        const consuming = skillDef?.skillType === 'liberation' && skillDef.consumesResource !== false;

        if (consuming && gauge + EPS < liberationCost) {
            shortfalls.push({
                key,
                deficit: liberationCost - gauge,
                // The ER at which what this rotation generated since the last
                // reset would have covered the cost. Null when nothing was
                // generated at all — no ER ever covers zero income.
                //
                // CEIL, not round: this is advice, and a value rounded DOWN is
                // advice that does not work. 45 base against a 100 cost needs
                // 2.2222…; rounded that reports 2.222, at which the rotation
                // banks 99.99 and the cast is still short.
                requiredEr: baseSinceReset > EPS
                    ? Math.ceil((liberationCost / baseSinceReset) * 1000) / 1000
                    : null,
            });
        }

        if (consuming) { gauge = 0; baseSinceReset = 0; }
        baseSinceReset += genOf(key);
        gauge = Math.max(0, Math.min(gauge + genOf(key) * er, liberationCost));
    }

    return shortfalls.length ? { shortfalls } : null;
}
