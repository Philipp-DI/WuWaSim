/**
 * Skill / Echo-Skill cooldown overlay (2026-07-12).
 *
 * tools/preprocess.mjs extracts the game's own "… Cooldown" skill-tree rows
 * onto skill-map entries — `cooldown` (seconds, level-invariant in the data)
 * plus `cooldownGroup` (keys fed by ONE shared row, e.g. Hiyuki's "Jade
 * Cleave/Petalfall Cooldown", belong to ONE activation family) — and each
 * echo's `activeSkill.cooldown` (rank-invariant, read from the CD
 * placeholder in the echo skill's own description).
 *
 * Activation-window model: the first cast of a group arms its window
 * (armTime + cooldown). While armed, casting a DIFFERENT key of the same
 * group is a stage continuation (Jade Cleave → Petalfall is one activation,
 * not a restart — legal, and the CD keeps running from the activation, not
 * from the last stage). Re-casting a key ALREADY used in this activation
 * while the window is still armed is a violation (an early restart). For
 * single-key groups this reduces to the plain "no re-cast before the CD
 * elapses" rule.
 *
 * Convention (mirrors the energy layer, maintainer-directed): the rotation
 * is authored as executed — a violating cast still executes, still deals
 * its damage, and re-arms a fresh window at its own cast time; `violated`
 * is a diagnostic overlay and never changes damage. Enforcement (waiting /
 * filler insertion) belongs to the derived-opener work, not this overlay.
 *
 * Known limitation (documented, not modeled): rows that are in-state combo
 * repeats of a transformation (e.g. Jiyan's Lance of Qingloong stages inside
 * Emerald Storm, Encore's Cosmos Frolicking basics) carry their node's bare
 * Cooldown row via the first-damage-row fallback, so REPEATING them inside
 * one transformation flags as a restart. Distinguishing that needs per-node
 * state modeling (rotation-state.js), not cooldown data.
 */

// Float-time slack: a cast landing 11.9999999s after a 12s CD is legal.
const EPS = 1e-6;

// Mirrors sim.js ECHO_STEP_KEY (kept as a literal here so this module stays
// import-free — sim.js imports us, and a back-import would create a cycle).
const ECHO_KEY = '__echo__';

/**
 * Annotate steps with cooldown state, in place.
 *
 * Each CD-carrying step gains
 *   step.cd = { group, cooldown, nextReadyAt, violated,
 *               continuation?,                 // legal same-activation stage
 *               blockedUntil?, deficit? }      // only if violated
 * Steps whose key has no cooldown in the data are left untouched.
 *
 * @param {Array<object>} steps — objects carrying { index, skillKey, startTime },
 *   ascending in startTime (rotation-relative or team-absolute seconds).
 * @param {object}   opts
 * @param {object}   opts.skillMap       — key → { cooldown?, cooldownGroup? }
 * @param {?number}  [opts.echoCooldown] — equipped slot-0 echo's CD for
 *   '__echo__' steps (null = no echo equipped / no active skill).
 * @param {Map<string,object>} [opts.groupState] — carry-over activation
 *   windows from earlier segments of the same member (team path; mutated).
 *   Omit for a standalone rotation.
 * @param {string} [opts.timeKey='startTime'] — which field on each step to
 *   read as "cast time". Cooldowns tick against gameTime, not realTime (see
 *   docs/TIMING_MODEL.md) — pass 'gameStartTime' once the caller has run
 *   sim.js's deriveGameTimes over the same steps. Defaults to 'startTime' for
 *   callers (tests, ad-hoc step arrays) that never derive gameTime — with no
 *   freeze data the two are numerically identical anyway.
 * @returns {Array<object>} violations — [{ index, skillKey, label, t,
 *   deficit, blockedUntil }] in cast order.
 */
export function annotateStepCooldowns(steps, { skillMap, echoCooldown = null, groupState = new Map(), timeKey = 'startTime' } = {}) {
    const violations = [];
    for (const step of steps) {
        let group = null, cooldown = null;
        if (step.skillKey === ECHO_KEY) {
            if (echoCooldown > 0) { group = ECHO_KEY; cooldown = echoCooldown; }
        } else {
            const def = skillMap?.[step.skillKey];
            if (def?.cooldown > 0) {
                group = def.cooldownGroup ?? step.skillKey;
                cooldown = def.cooldown;
            }
        }
        if (group === null) continue;

        const t = step[timeKey] ?? step.startTime ?? 0;
        const s = groupState.get(group);

        if (!s || t >= s.until - EPS) {
            // Window expired (or never armed) → a fresh activation.
            groupState.set(group, { until: t + cooldown, keys: new Set([step.skillKey]) });
            step.cd = { group, cooldown, nextReadyAt: t + cooldown, violated: false };
        } else if (!s.keys.has(step.skillKey)) {
            // Armed window, new key → stage continuation of this activation.
            // The CD keeps running from the activation; no re-arm.
            s.keys.add(step.skillKey);
            step.cd = { group, cooldown, nextReadyAt: s.until, violated: false, continuation: true };
        } else {
            // Armed window, key already used → early restart. Executes anyway
            // (authored as executed) and arms a fresh window from here.
            const blockedUntil = s.until;
            const deficit = blockedUntil - t;
            groupState.set(group, { until: t + cooldown, keys: new Set([step.skillKey]) });
            step.cd = { group, cooldown, nextReadyAt: t + cooldown, violated: true, blockedUntil, deficit };
            violations.push({
                index: step.index, skillKey: step.skillKey, label: step.label ?? step.skillKey,
                t, deficit, blockedUntil,
            });
        }
    }
    return violations;
}
