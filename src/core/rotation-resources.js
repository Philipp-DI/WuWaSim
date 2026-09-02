/**
 * Resource (gauge) timeline — per-step level of each curated non-energy gauge.
 *
 * Wuthering Waves kits carry named resource gauges that are neither Energy nor
 * Concerto: Changli's Enflamement, Sigrika's Full Stop, Lynae's Lumiflow. A cast
 * adds to the gauge, another cast spends it, and a third thing reads the level —
 * either as a GATE ("if Changli carries 4 stacks") or as a SCALE ("each stack of
 * Enflamement increases Fusion DMG Bonus by 5%").
 *
 * This module owns the arithmetic for the level itself. It was previously a
 * private copy inside rotation-graph.js used only for rotation legality; the sim
 * now reads the same timeline so a gauge-scaled buff and a gauge-gated warning
 * can never disagree about the level at a given step.
 *
 * Income arrives two ways. A CAST grant is a constant attached to a skill key.
 * A TICK is a clock: ~~real-time ticks are out of scope, so a kit whose gauge
 * fills on a timer cannot be modelled here~~ they now are, on the gameTime axis,
 * because that is the axis the rest of the engine already runs its timers on.
 * What stays out of scope is income earned on a HIT — that lives behind
 * DamageTrigger chains in db_PassiveSkill, and this module is per-cast by
 * construction (CLAUDE.md, "Gauge income is readable ON A CAST, and only there").
 *
 * Definitions live in rotation-rules.js RESOURCE_DEFS (curated, hand-editable):
 *   { name, channel?, cap, start?, chainOverrides?, gains: { skillKey: amount },
 *     spend?: { skillKey: amount }, spendAll?: [skillKey],
 *     tick?: { period, refillTo?, amount?, state? } }
 *
 * A gauge does NOT necessarily begin a fight empty. Denia's inherent restores
 * Dark Cores to 2 on entering combat, so `start` is the level the fight opens
 * on — zero for every gauge that says nothing, which is most of them.
 *
 * Consumption comes in both shapes and kits use both. `spendAll` empties the
 * pool (Changli's Flaming Sacrifice consumes ALL Enflamement); `spend` takes a
 * FIXED amount and leaves the rest, which is what most kits actually say —
 * "consume 50 of [Wolflame]", "consume 1 of [Frostharden Iai]", "consume 100 of
 * [Frostheart]". Modelling only spendAll would empty a gauge that the game
 * merely draws down, so a later cast in the same rotation would read 0 where the
 * game still has change to spend.
 *
 * A spend never takes the gauge below zero. Spending more than is held is the
 * caller's business, not this module's: rotation legality (can this cast even
 * happen?) is analyzeRotation's job, via STAGE_GRANTS' `resource.atLeast` gate.
 */

import { stateActive } from './rotation-state.js';

/**
 * Per-step ENTERING level for each curated resource.
 *
 * "Entering" means the level BEFORE the step's own spend and gain resolve, which
 * is the level the step's cast actually reads: Changli's True Sight - Conquest
 * scales on the stacks she already holds, and only then adds its own. Within a
 * step spends apply before gains, so a cast that both consumes and refills
 * (none today, but the ordering must be stated) ends on its own gain.
 *
 * @param {string[]} rotation              — linear rotation (skill keys)
 * @param {Array<object>} resourceDefs     — resourceDefsForResonator(id)
 * @returns {Map<string, number[]>} lowercased resource name → level entering step i
 */
export function computeResourceTimeline(rotation, resourceDefs, startLevels = null, context = null) {
    const timeline = new Map();
    for (const def of resourceDefs ?? []) {
        timeline.set(def.name.toLowerCase(), walkResource(rotation, def, startLevels, context).levels);
    }
    return timeline;
}

/**
 * A gauge that fills on a CLOCK rather than on a cast.
 *
 *   tick: { period, refillTo?, amount?, state? }
 *
 * `period` is seconds of GAME time between firings — the same axis cooldowns,
 * effect windows and status ticks already use, so a gauge tick pauses during a
 * Liberation animation exactly as every other in-game timer does.
 *
 * `refillTo` RAISES the level to a floor and never lowers it, which is what a
 * kit means by "restore Dark Cores to 2 if she has fewer than 2". `amount` is
 * the additive shape ("gain 1 point per second"). A tick states one or the
 * other, never both.
 *
 * `state` gates the EFFECT, not the CLOCK: the timer keeps cycling while the
 * condition is false and simply produces nothing on those firings. That is what
 * "this effect can be triggered once every 12s" describes — a rate limit, not a
 * countdown that starts when the condition becomes true.
 *
 * The first firing is at elapsed 0, deliberately: the kit checks its condition
 * on entering combat and then cycles. `start` states the same opening level for
 * Denia and the two must agree — a refill to a floor is idempotent, so the t=0
 * firing changes nothing when they do, and `tests/rotation-resources.test.mjs`
 * asserts it.
 *
 * Counting FIRINGS rather than tracking the next timestamp is what makes the
 * carry across segments exact: the number of firings owed by elapsed T is
 * always floor(T / period) + 1, so a segment that resumes mid-cycle needs no
 * special case for "already fired at 0".
 */
function tickFiringsBy(elapsedSeconds, period) {
    return Math.floor(elapsedSeconds / period) + 1;
}

/**
 * The tick CLOCK for one gauge, kept separate from the gauge's own arithmetic.
 *
 * Returns a closure because the firing count is state that must survive across
 * every step of one walk — and because the two questions ("what time is it at
 * step i?" and "what has fired since?") only make sense together.
 *
 * A caller with no timing info (rotation-graph's legality check) gets an inert
 * clock rather than a guessed schedule: the gauge then behaves exactly as it
 * did before ticks existed, which is the honest degradation for a question
 * about legality rather than damage.
 */
function gaugeClock(def, cap, name, context) {
    const stepStarts = context?.stepTimes?.gameStart ?? context?.stepTimes?.start ?? null;
    const period = def.tick?.period > 0 ? def.tick.period : 0;
    const phaseIn = Math.max(0, context?.tickPhases?.get(name) ?? 0);
    if (!period || !Array.isArray(stepStarts)) {
        return { phaseIn, elapsedAtStep: () => 0, fireThrough: (level) => level };
    }
    const gate = def.tick.state ?? null;
    let fired = phaseIn > 0 ? tickFiringsBy(phaseIn, period) : 0;
    return {
        phaseIn,
        elapsedAtStep: (i) => phaseIn + (stepStarts[i] ?? 0),
        fireThrough(level, elapsedSeconds, stepIndex) {
            const owed = tickFiringsBy(elapsedSeconds, period);
            while (fired < owed) {
                // The gate withholds the EFFECT, never the CLOCK: `fired` still
                // advances, so a firing missed for want of its state does not
                // push the next one later.
                if (!gate || stateActive(context?.activeStates?.[stepIndex], gate)) {
                    level = def.tick.refillTo != null
                        ? Math.max(level, Math.min(cap, def.tick.refillTo))
                        : Math.min(cap, level + (def.tick.amount ?? 0));
                }
                fired++;
            }
            return level;
        },
    };
}

/**
 * One pass over the rotation for one gauge: the level ENTERING each step, the
 * amount that step CONSUMES, and where the gauge and its ticker END.
 *
 * Both series come from the same walk because they must agree by construction —
 * a consumption the level series did not account for would let a gauge-gated
 * warning and a gauge-scaled buff disagree about the same cast.
 *
 * `startLevels` is what the gauge already held when this rotation began. It
 * exists because a member's turn is simulated as SEVERAL rotations — team-sim
 * runs the auto-injected Intro as its own segment — and a gauge does not reset
 * between them. Denia earns her Dark Core on Intro and spends it in the segment
 * after, so without a carried level the spending cast reads an empty gauge.
 *
 * A carried level OUTRANKS `def.start`, and must: `start` is what entering the
 * FIGHT gives you, not what entering each segment gives you. A gauge that a
 * previous segment legitimately emptied carries 0, and `??` keeps that 0 —
 * re-reading `start` there would refill it once per segment for free.
 *
 * `context.tickPhases` is the same idea for the CLOCK: seconds this gauge's
 * ticker already ran in earlier segments. Without it every segment restarts the
 * cycle and re-fires the t=0 tick, which is one free refill per swap-in.
 *
 * @param {string[]} rotation
 * @param {object} def — one RESOURCE_DEFS entry
 * @param {Map<string, number>|null} startLevels — lowercased name → level held
 * @param {{ stepTimes?: object, activeStates?: Array<Set<string>>,
 *           tickPhases?: Map<string, number> }|null} context
 * @returns {{ levels: number[], consumed: number[], endLevel: number, endTickPhase: number }}
 */
function walkResource(rotation, def, startLevels = null, context = null) {
    const steps = Array.isArray(rotation) ? rotation : [];
    const cap = def.cap ?? Infinity;
    const name = def.name.toLowerCase();
    let level = Math.min(cap, Math.max(0, startLevels?.get(name) ?? def.start ?? 0));
    const levels = [];
    const consumed = [];

    const clock = gaugeClock(def, cap, name, context);
    const stepEnds = context?.stepTimes?.gameEnd ?? context?.stepTimes?.end ?? null;

    for (let i = 0; i < steps.length; i++) {
        // A tick that fell before this step's start belongs to the step already
        // in progress, so the state gate reads the PREVIOUS step. At i === 0 the
        // only such tick is the one at elapsed 0, which is step 0's own instant.
        level = clock.fireThrough(level, clock.elapsedAtStep(i), i === 0 ? 0 : i - 1);
        levels.push(level);
        let spent = 0;
        // Spends resolve before gains (see the "entering level" note above), so
        // a cast that both consumes and refills consumes what it ENTERED with.
        if (def.spendAll?.includes(steps[i])) { spent += level; level = 0; }
        const spend = def.spend?.[steps[i]] ?? 0;
        if (spend) {
            const taken = Math.min(level, spend);   // never below zero
            spent += taken;
            level -= taken;
        }
        consumed.push(spent);
        const gain = def.gains?.[steps[i]] ?? 0;
        if (gain) level = Math.min(cap, level + gain);
    }

    // Ticks between the last step's start and the segment's end still belong to
    // this segment: they move the level the NEXT segment carries in.
    const ranFor = steps.length && Array.isArray(stepEnds) ? (stepEnds[steps.length - 1] ?? 0) : 0;
    level = clock.fireThrough(level, clock.phaseIn + ranFor, Math.max(0, steps.length - 1));
    return { levels, consumed, endLevel: level, endTickPhase: clock.phaseIn + ranFor };
}

/**
 * Per-step CONSUMED amount for each curated resource.
 *
 * The mirror of computeResourceTimeline, and the reason it exists: a kit that
 * scales a value "for each [X] consumed" is talking about ONE cast — the one
 * that spends the gauge — and is worth exactly nothing on every other step.
 * Reading the held LEVEL instead would pay the bonus on every cast in the
 * rotation, which for Denia's +150% per Dark Core would multiply her whole kit.
 *
 * So this series is what makes such an effect SELF-SCOPING: it is 0 wherever
 * nothing was consumed, and no skill-name binding is needed to keep it there.
 *
 * @param {string[]} rotation
 * @param {Array<object>} resourceDefs
 * @returns {Map<string, number[]>} lowercased resource name → amount consumed at step i
 */
export function computeResourceConsumption(rotation, resourceDefs, startLevels = null, context = null) {
    const consumption = new Map();
    for (const def of resourceDefs ?? []) {
        consumption.set(def.name.toLowerCase(), walkResource(rotation, def, startLevels, context).consumed);
    }
    return consumption;
}

/**
 * What each gauge holds when this rotation ENDS.
 *
 * Handed to the next segment of the same member's turn (and to their next pass)
 * as `startLevels`, the same way sim.js hands its trigger-fire ledger back as
 * `carryInFires`. A gauge persists across a swap-out; only the simulation is
 * segmented, not the character.
 *
 * @param {string[]} rotation
 * @param {Array<object>} resourceDefs
 * @param {Map<string, number>|null} [startLevels]
 * @returns {Map<string, number>} lowercased resource name → level held at the end
 */
export function computeResourceEndLevels(rotation, resourceDefs, startLevels = null, context = null) {
    const ending = new Map();
    for (const def of resourceDefs ?? []) {
        ending.set(def.name.toLowerCase(), walkResource(rotation, def, startLevels, context).endLevel);
    }
    return ending;
}

/**
 * How far each gauge's TICK CLOCK has run when this rotation ends.
 *
 * The clock's counterpart to computeResourceEndLevels, and handed forward the
 * same way. A gauge tick belongs to the FIGHT, not to the segment: without this
 * every segment restarts the cycle at elapsed 0 and re-fires the opening tick,
 * which is one free refill per swap-in and per pass.
 *
 * Seconds accumulate on the member's own simulated gameTime, so time while they
 * are off-field is not counted. That UNDERSTATES a tick's income in a team,
 * which is the safe direction and matches how the Denia entry already describes
 * its own limits (CLAUDE.md).
 *
 * @param {string[]} rotation
 * @param {Array<object>} resourceDefs
 * @param {Map<string, number>|null} [startLevels]
 * @param {object|null} [context]
 * @returns {Map<string, number>} lowercased resource name → seconds the clock has run
 */
export function computeResourceTickPhases(rotation, resourceDefs, startLevels = null, context = null) {
    const phases = new Map();
    for (const def of resourceDefs ?? []) {
        phases.set(def.name.toLowerCase(), walkResource(rotation, def, startLevels, context).endTickPhase);
    }
    return phases;
}

/**
 * The level of one named resource entering one step, or null when the resonator
 * has no definition for it. Null is the "no curated gauge" answer and must stay
 * distinguishable from 0 ("the gauge is empty") — the resolver credits nothing
 * for null and a real zero for 0.
 *
 * Name matching is case-insensitive; a curated `stackTrigger.resource` names the
 * gauge exactly as RESOURCE_DEFS spells it.
 *
 * @param {Map<string, number[]>} timeline — from computeResourceTimeline
 * @param {string} name
 * @param {number} stepIndex
 * @returns {number|null}
 */
export function resourceLevelAt(timeline, name, stepIndex) {
    if (!timeline || !name) return null;
    const levels = timeline.get(String(name).toLowerCase());
    if (!levels) return null;
    return levels[stepIndex] ?? null;
}

/**
 * How much of one named resource this step consumes. Zero, never null.
 *
 * Deliberately UNLIKE resourceLevelAt, which returns null for an uncurated gauge
 * so the resolver can tell "no definition" from "empty". A consumption has no
 * such distinction to preserve: a gauge the app does not model is a gauge
 * nothing spends, and both readings are 0. Returning 0 also keeps the failure
 * direction safe — an unmodelled gauge understates a multiplier instead of
 * paying it on every cast in the rotation.
 *
 * @param {Map<string, number[]>} consumption — from computeResourceConsumption
 * @param {string} name
 * @param {number} stepIndex
 * @returns {number}
 */
export function resourceConsumedAt(consumption, name, stepIndex) {
    if (!consumption || !name) return 0;
    return consumption.get(String(name).toLowerCase())?.[stepIndex] ?? 0;
}
