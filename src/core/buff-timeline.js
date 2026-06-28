// src/core/buff-timeline.js
/**
 * Buff stack timeline (Phase A) — per-step active stack count for a stacking
 * conditional buff, replacing the full-stack / full-uptime approximation.
 *
 * A stacking buff (e.g. Freezing Frost's "+10% Glacio DMG, stacking up to 3×")
 * does NOT sit at max stacks for the whole rotation. Each qualifying trigger
 * cast adds one stack with its own lifetime; a stack expires `duration` seconds
 * after it was gained; the concurrently-active count is capped at `maxStacks`.
 * So the buff RAMPS over early casts and DECAYS across gaps.
 *
 * This module walks the rotation's resolved steps and returns the active stack
 * count at each step's START time (a cast buffs LATER steps, not its own — the
 * same documented approximation the §A trigger×window effect path uses). The
 * damage path then credits `bonusPct × activeStacks(step)` instead of a flat
 * `bonusPct × maxStacks`.
 *
 * Stacks expire independently (count of gains within the trailing `duration`
 * window, capped) — the conservative model when refresh semantics are unknown;
 * it never over-credits beyond `maxStacks`, matching the project's
 * conservative-over-aggressive rule.
 */

const EPS = 1e-6;

/**
 * Build a stack-count timeline for one stacking buff over the rotation steps.
 *
 * @param {Array<{index, skillType, startTime, endTime}>} steps
 * @param {object} spec
 * @param {Iterable<string>} spec.triggerTypes — skillTypes that grant a stack
 *        (the UNION across a multi-trigger buff, e.g. ['basic','heavy']).
 * @param {number} [spec.maxStacks=1]
 * @param {number} [spec.duration=15] — seconds each stack lives.
 * @returns {{ byStepIndex: Record<number, number>, start: number, end: number, gains: number[] }}
 *          byStepIndex: active stack count at each step's startTime (0 when none).
 *          start/end: active span (first gain .. last expiry); both 0 when never gained.
 */
export function stackTimeline(steps, { triggerTypes, maxStacks = 1, duration = 15 } = {}) {
    const triggers = triggerTypes instanceof Set ? triggerTypes : new Set(triggerTypes ?? []);
    const dur = duration > 0 ? duration : Infinity;

    // Stacks are gained at the END of a qualifying cast (buffs subsequent steps).
    const gains = [];
    for (const s of steps) {
        if (triggers.has(s.skillType)) gains.push(s.endTime);
    }

    const byStepIndex = {};
    if (gains.length === 0) return { byStepIndex, start: 0, end: 0, gains };

    for (const s of steps) {
        const t = s.startTime;
        let live = 0;
        for (const g of gains) {
            if (g <= t + EPS && g + dur > t + EPS) live++;
        }
        byStepIndex[s.index] = Math.min(maxStacks, live);
    }

    const start = Math.min(...gains);
    const end = Math.max(...gains.map(g => g + dur));
    return { byStepIndex, start, end: Number.isFinite(end) ? end : steps[steps.length - 1]?.endTime ?? start, gains };
}

/**
 * Group parsed sonata buffs that share a source clause (same sonata + raw text)
 * into ONE logical buff carrying the UNION of its trigger types. The parser
 * emits one ParsedBuff per trigger phrase, so a "Basic OR Heavy Attack" clause
 * yields two entries that must be merged — otherwise each would open its own
 * window and the bonus would be double-counted.
 *
 * @param {Array<object>} buffs — ParsedBuffs already carrying sonataId/raw/…
 * @returns {Array<object>} merged buffs: { ...shared, triggerTypes: string[] }
 */
export function groupStackingBuffs(buffs) {
    const groups = new Map();
    for (const b of buffs) {
        const key = `${b.sonataId}::${b.raw}`;
        let g = groups.get(key);
        if (!g) {
            g = { ...b, triggerTypes: [] };
            groups.set(key, g);
        }
        if (b.trigger && !g.triggerTypes.includes(b.trigger)) g.triggerTypes.push(b.trigger);
    }
    return [...groups.values()];
}
