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
 * Deliberately per-CAST only: gains are constants attached to skill keys. Gauge
 * income from hit counts, off-field actions and real-time ticks is out of scope
 * (rotation-rules.js RESOURCE_DEFS states the same boundary) — a kit whose gauge
 * fills on a timer, like Lynae's Premixed Hue at 1 stack/s, cannot be modelled
 * here and stays underivable rather than being approximated.
 *
 * Definitions live in rotation-rules.js RESOURCE_DEFS (curated, hand-editable):
 *   { name, channel?, cap, gains: { skillKey: amount },
 *     spend?: { skillKey: amount }, spendAll?: [skillKey] }
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
export function computeResourceTimeline(rotation, resourceDefs, startLevels = null) {
    const timeline = new Map();
    for (const def of resourceDefs ?? []) {
        timeline.set(def.name.toLowerCase(), walkResource(rotation, def, startLevels).levels);
    }
    return timeline;
}

/**
 * One pass over the rotation for one gauge: the level ENTERING each step, and
 * the amount that step CONSUMES.
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
 * @param {string[]} rotation
 * @param {object} def — one RESOURCE_DEFS entry
 * @param {Map<string, number>|null} startLevels — lowercased name → level held
 * @returns {{ levels: number[], consumed: number[], endLevel: number }}
 */
function walkResource(rotation, def, startLevels = null) {
    const steps = Array.isArray(rotation) ? rotation : [];
    let level = Math.min(def.cap ?? Infinity,
        Math.max(0, startLevels?.get(def.name.toLowerCase()) ?? 0));
    const levels = [];
    const consumed = [];
    for (const skillKey of steps) {
        levels.push(level);
        let spent = 0;
        // Spends resolve before gains (see the "entering level" note above), so
        // a cast that both consumes and refills consumes what it ENTERED with.
        if (def.spendAll?.includes(skillKey)) { spent += level; level = 0; }
        const spend = def.spend?.[skillKey] ?? 0;
        if (spend) {
            const taken = Math.min(level, spend);   // never below zero
            spent += taken;
            level -= taken;
        }
        consumed.push(spent);
        const gain = def.gains?.[skillKey] ?? 0;
        if (gain) level = Math.min(def.cap ?? Infinity, level + gain);
    }
    return { levels, consumed, endLevel: level };
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
export function computeResourceConsumption(rotation, resourceDefs, startLevels = null) {
    const consumption = new Map();
    for (const def of resourceDefs ?? []) {
        consumption.set(def.name.toLowerCase(), walkResource(rotation, def, startLevels).consumed);
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
export function computeResourceEndLevels(rotation, resourceDefs, startLevels = null) {
    const ending = new Map();
    for (const def of resourceDefs ?? []) {
        ending.set(def.name.toLowerCase(), walkResource(rotation, def, startLevels).endLevel);
    }
    return ending;
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
