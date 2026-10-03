// src/core/target-stacks.js
/**
 * Per-step stack count for a kit-inflicted stack held on the TARGET, whose
 * applications are rate-limited per SOURCE SKILL (an internal cooldown).
 *
 * Distinct from the three stack sources that already exist, and that is the
 * whole reason it exists:
 *   - `RESOURCE_DEFS` (rotation-resources.js) is the WIELDER'S gauge: per-cast
 *     income, a cap, a spend. No per-source rate limit and no decay — a gauge
 *     holds what it holds until something spends it.
 *   - `stackTimeline` (buffs/buff-timeline.js) decays correctly but grants a
 *     stack on EVERY qualifying cast, and matches on the mechanical `skillType`
 *     category rather than on the skill.
 *   - a `castMatch` stackTrigger counts fires, with neither decay nor a limit.
 *
 * Galbrena's Oathbound Hunt needs all three properties at once: "1 stack of
 * Fated End is inflicted on the target when the following skills hit: <twelve
 * named skills>, up to 4 stacks. Each stack Amplifies … for 5.5s. **The same
 * type of skill can trigger this effect on the same target once every 5s.**
 * Resonance Skill - Encroach and Resonance Skill - Ravage are considered the
 * same type of skill."
 *
 * THE ICD IS PER LISTED SKILL, not per category (maintainer-confirmed
 * 2026-10-03: "each same skill may only apply 1 stack every 5 secs; using
 * different skills in succession builds the stacks much quicker"). The kit's
 * own closing sentence is what settles it: Encroach and Ravage are BOTH
 * mechanically Resonance Skills and both read the Heavy bucket, so under a
 * per-category reading that sentence would say nothing at all. Under a
 * per-skill reading it does real work — two names that would otherwise each
 * carry their own 5s. So a `group` is one entry of the kit's list, and the
 * merge the kit states is one group holding two keys.
 *
 * A def therefore carries GROUPS OF KEYS rather than skill types:
 *
 *   { name, cap, stackSeconds, icdSeconds, groups: [{ name, keys: [...] }] }
 *
 * TIMING. An application belongs to the END of the cast that lands it, so it
 * buffs LATER steps and not its own — the same approximation `stackTimeline`
 * documents, and the same direction `enemy-status.js`'s EVENT_ORDER states for
 * a mark application ("it belongs to the next cast"). Everything runs on
 * **gameTime**, so a Liberation freeze pauses both the ICD and the stack
 * lifetime, like every other in-game timer.
 *
 * "LATER" IS ORDERED BY STEP INDEX, NOT BY TIME, and it has to be. A step's
 * start time IS the previous step's end time, so an application and the next
 * cast share one number and must COUNT — that is how a stack reaches the cast
 * it was inflicted for. But a Liberation freezes gameTime, so its own
 * `gameEnd` equals its `gameStart`, and a purely time-based test then lets that
 * cast credit its own step: measured, Galbrena's Liberation read 4 stacks where
 * 3 were standing, having counted the one it inflicted itself. No epsilon
 * separates the two cases — the same impossibility `enemy-status.js`'s
 * EVENT_ORDER docblock states — so an application carries the index of the step
 * that landed it and a step counts only applications from strictly earlier
 * steps.
 *
 * WITHOUT STEP TIMES THE TIMELINE IS INERT, never guessed. Both the ICD and the
 * decay are clocks; a caller that has no `stepTimes` (rotation-graph legality
 * checks) would otherwise get a schedule invented for it. Zeros understate,
 * which is the safe direction — the same rule `RESOURCE_DEFS.tick` follows.
 */

const EPS = 1e-6;

/**
 * Per-step ENTERING stack count for each curated target stack.
 *
 * @param {string[]} rotation            — linear rotation (skill keys)
 * @param {Array<object>} defs           — targetStackDefsForResonator(id)
 * @param {{gameStart: number[], gameEnd: number[]}|null} [stepTimes]
 * @returns {Map<string, number[]>} lowercased stack name → stacks entering step i
 */
export function computeTargetStackTimeline(rotation, defs, stepTimes = null) {
    const timeline = new Map();
    for (const def of defs ?? []) {
        timeline.set(def.name.toLowerCase(), walkTargetStack(rotation, def, stepTimes));
    }
    return timeline;
}

/**
 * Stacks entering each step for ONE def.
 * @returns {number[]}
 */
function walkTargetStack(rotation, def, stepTimes) {
    const levels = new Array(rotation.length).fill(0);
    // Both the ICD and the lifetime are clocks. With no clock, no schedule.
    if (!stepTimes?.gameStart || !stepTimes?.gameEnd) return levels;

    // Which ICD group each key belongs to. A key in no group never applies.
    const groupByKey = new Map();
    (def.groups ?? []).forEach((group, index) => {
        for (const key of group.keys ?? []) groupByKey.set(key, index);
    });

    const icd = def.icdSeconds ?? 0;
    const applications = [];
    const lastApplied = new Map();
    for (let i = 0; i < rotation.length; i++) {
        const group = groupByKey.get(rotation[i]);
        if (group === undefined) continue;
        const landedAt = stepTimes.gameEnd[i];
        if (landedAt == null) continue;
        const previous = lastApplied.get(group);
        // The group is on cooldown: the cast still happens, it just inflicts
        // nothing. That is the whole mechanic — alternating SKILLS builds stacks
        // faster than repeating one.
        if (previous != null && landedAt - previous < icd - EPS) continue;
        applications.push({ at: landedAt, index: i });
        lastApplied.set(group, landedAt);
    }

    const cap = def.cap ?? Infinity;
    const life = def.stackSeconds > 0 ? def.stackSeconds : Infinity;
    for (let i = 0; i < rotation.length; i++) {
        const time = stepTimes.gameStart[i];
        if (time == null) continue;
        let live = 0;
        for (const applied of applications) {
            if (applied.index >= i) continue;              // never its own cast
            if (applied.at <= time + EPS && applied.at + life > time + EPS) live++;
        }
        levels[i] = Math.min(cap, live);
    }
    return levels;
}

/**
 * Stacks entering step `stepIndex`, or null when this stack is not modelled.
 *
 * null and 0 must stay distinguishable: "no curated definition" falls through
 * to the underivable-stack path (ONE stack, flagged), while 0 is a real,
 * derived empty — the same contract `resourceLevelAt` keeps.
 *
 * @param {Map<string, number[]>|null} timeline
 * @param {string} name
 * @param {number} stepIndex
 * @returns {number|null}
 */
export function targetStackAt(timeline, name, stepIndex) {
    if (!timeline || name == null) return null;
    const levels = timeline.get(String(name).toLowerCase());
    if (!levels) return null;
    return levels[stepIndex] ?? 0;
}
