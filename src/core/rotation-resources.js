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
export function computeResourceTimeline(rotation, resourceDefs) {
    const timeline = new Map();
    const steps = Array.isArray(rotation) ? rotation : [];
    for (const def of resourceDefs ?? []) {
        let level = 0;
        const levels = [];
        for (const skillKey of steps) {
            levels.push(level);
            if (def.spendAll?.includes(skillKey)) level = 0;
            const spend = def.spend?.[skillKey] ?? 0;
            if (spend) level = Math.max(0, level - spend);
            const gain = def.gains?.[skillKey] ?? 0;
            if (gain) level = Math.min(def.cap ?? Infinity, level + gain);
        }
        timeline.set(def.name.toLowerCase(), levels);
    }
    return timeline;
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
