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
 * @param {Array<{index, skillType, startTime, endTime, stepHeal}>} steps
 * @param {object} spec
 * @param {Iterable<string>} spec.triggerTypes — skillTypes that grant a stack
 *        (the UNION across a multi-trigger buff, e.g. ['basic','heavy']).
 *        'healing' is special: sonata-buffs.js parses it as a trigger (e.g.
 *        "upon healing allies"), but it isn't a mechanical skillType — it's a
 *        property of a cast's OUTCOME (any step that produced real heal
 *        output), so it's matched against `step.stepHeal > 0` instead of
 *        `step.skillType` (2026-07-14 — until this fix, a 'healing' trigger
 *        could never match ANY step's skillType, so the buff silently never
 *        gained a single stack — self included — regardless of whether the
 *        resonator's rotation actually healed).
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
    // gameGains drive the per-step stack COUNT — stack durations decay against
    // the in-game clock, so a Liberation freeze pauses expiry (buffs survive a
    // Liberation, maintainer-confirmed 2026-07-23). realGains give the window's
    // realTime display/propagation bounds (team-sim.js overlaps buffs in real
    // segment time). The two coincide unless a Liberation freezes the clock
    // inside this buff's span — so this is a no-op for freeze-free rotations.
    const gameGains = [], realGains = [];
    for (const step of steps) {
        const qualifies = triggers.has(step.skillType) || (triggers.has('healing') && (step.stepHeal ?? 0) > 0);
        if (qualifies) {
            gameGains.push(step.gameEndTime ?? step.endTime);
            realGains.push(step.endTime);
        }
    }

    const byStepIndex = {};
    if (gameGains.length === 0) return { byStepIndex, start: 0, end: 0, gains: gameGains };

    for (const step of steps) {
        const time = step.gameStartTime ?? step.startTime;
        let live = 0;
        for (const gainTime of gameGains) {
            if (gainTime <= time + EPS && gainTime + dur > time + EPS) live++;
        }
        byStepIndex[step.index] = Math.min(maxStacks, live);
    }

    const start = Math.min(...realGains);
    // Freeze-aware realTime end: map the last stack's gameTime expiry back to
    // realTime (realTime = gameTime + freeze accrued by then), so a buff whose
    // life spans a Liberation is drawn — and propagated to teammates — across
    // the frozen animation instead of being cut short at the naive
    // realGain+duration projection (which would treat the buff's game-duration
    // as realTime and end while it's still, correctly, buffing later steps).
    // No-op when no freeze occurs: offset stays 0 → end === realGain + dur.
    const gameExpiry = Math.max(...gameGains) + dur;
    let freezeOffset = 0;
    for (const step of steps) {
        const gameEnd = step.gameEndTime ?? step.endTime;
        if (gameEnd <= gameExpiry + EPS) freezeOffset = step.endTime - gameEnd;
    }
    const end = gameExpiry + freezeOffset;
    return { byStepIndex, start, end: Number.isFinite(end) ? end : steps[steps.length - 1]?.endTime ?? start, gains: gameGains };
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
    for (const buff of buffs) {
        const key = `${buff.sonataId}::${buff.raw}`;
        let group = groups.get(key);
        if (!group) {
            group = { ...buff, triggerTypes: [] };
            groups.set(key, group);
        }
        if (buff.trigger && !group.triggerTypes.includes(buff.trigger)) group.triggerTypes.push(buff.trigger);
    }
    return [...groups.values()];
}
