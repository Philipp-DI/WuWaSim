/**
 * Rotation state model — tracks character "states" across a rotation.
 *
 * Many Wuthering Waves skills are gated by a *state* the character is in:
 * Carlotta's Fatal Finale only inside Twilight Tango, Hiyuki's Fore basics only
 * in Foreclaimed Self, Aemeath's bonus only in Resonance Mode - Tune Rupture.
 * Phase 9/10 surfaced these as `inState` structural triggers but couldn't
 * resolve them, because the sim had no notion of *when* a state is active.
 *
 * This module computes a **state timeline**: for each step index in a rotation,
 * the set of states active at that step. It is deliberately position-based
 * (per rotation step), not millisecond-accurate — matching the rest of the
 * simulator, which reasons about ordered steps rather than a continuous clock.
 *
 * A state is defined by:
 *   - enter:    skill keys (or skill types) that ACTIVATE the state
 *   - exit:     how it ends — 'persist' (until rotation end), 'consumedBy'
 *               (a skill key/type that ends it), 'duration' (N rotation
 *               steps, an approximation for states with no stated timer),
 *               'seconds' (a REAL elapsed-time expiry from when the state was
 *               entered — for kits with a stated duration), or
 *               'consumedByThenSeconds' (stays active until a key/type fires,
 *               then for a further grace period of N real seconds)
 *
 * The timeline walk:
 *   For each step, first apply any state *exits* triggered by the previous
 *   step's skill, then apply any *enters* triggered by the current step's skill,
 *   then record the active-state set for this step. This ordering means a skill
 *   that both enters a state and is gated by it (rare) sees the state as active
 *   on its own step.
 *
 * Unblocks: inState structural resolution (chain/inherent effects), and provides
 * the foundation for state-gated off-field (Phrolova Maestro, Ciaccona Recital)
 * and Tune Break (Mistune / Interfered states) in later work.
 */

/**
 * Compute the state timeline for a rotation.
 *
 * @param {string[]} rotation                 — linear rotation (skill keys)
 * @param {Object<string,object>} skillMap    — autoSkillMap for the resonator
 *        (used to resolve a step's skillType for type-based enter/exit triggers)
 * @param {Array<StateDef>} stateDefs         — per-character state definitions
 * @param {{start: number[], end: number[]}} [stepTimes] — per-step start/end
 *        time in seconds from rotation start; required for exit.mode 'seconds'
 *        to actually expire (omit only when timing doesn't matter — see below)
 * @returns {{ activeAt: Array<Set<string>>, states: string[] }}
 *          activeAt[i] = Set of state names active at step i;
 *          states = the list of defined state names (lowercased)
 *
 * StateDef shape:
 *   {
 *     name:   string                 — canonical state name (matched lowercased)
 *     aliases?: string[]             — extra names recorded alongside the
 *                                      canonical one while active (for effect
 *                                      gates whose text names a state GROUP,
 *                                      e.g. Denia's "Entropy Shift states")
 *     initiallyActive?: boolean      — active from step 0 (default stances)
 *     enter:  { keys?: string[], types?: string[] }   — what activates it
 *     exit:   { mode: 'persist'|'consumedBy'|'duration'|'seconds'|'consumedByThenSeconds'|'secondsOrConsumedBy',
 *               keys?: string[], types?: string[], steps?: number, seconds?: number }
 *   }
 *
 * exit.mode 'secondsOrConsumedBy': whichever comes FIRST ends the state — the
 * real-time expiry (like 'seconds') or a listed key/type being cast (like
 * 'consumedBy'). For timed buffs that another cast explicitly removes (e.g.
 * Denia's mutually-exclusive Entropy Shift pair: "Obtaining this effect
 * removes the [other] effect").
 *
 * exit.mode 'consumedByThenSeconds': the state stays active through whatever
 * it was active for, THEN — once a listed key/type fires — stays active for
 * a further `seconds` as a grace period before deactivating. Use when a kit
 * says "X, and for Ns after Y ends" (e.g. Lucilla's Déjà Vu/Clear As Day
 * buff: active through Reminiscence, then 30s after Letting It Go ends it).
 * Re-entering (the `enter` trigger firing again) cancels any grace in
 * progress and restarts the state fresh.
 *
 * exit.mode 'duration' (steps) vs 'seconds' (real time): use 'duration' as a
 * rough approximation when no stated timer exists; use 'seconds' when the kit
 * text gives a real duration (e.g. "lasts for 8s") AND stepTimes is available.
 */
export function computeStateTimeline(rotation, skillMap, stateDefs, stepTimes = null) {
    const rot = Array.isArray(rotation) ? rotation : [];
    const defs = Array.isArray(stateDefs) ? stateDefs : [];
    const activeAt = rot.map(() => new Set());
    if (defs.length === 0) return { activeAt, states: [] };
    // stepTimes (optional): { start: number[], end: number[] }, one entry per
    // rotation step, in seconds from rotation start — needed for exit.mode
    // 'seconds' (a REAL elapsed-time expiry, e.g. Cantarella's Mirage lasting
    // 8s, distinct from 'duration' which counts rotation STEPS, an approximation
    // for states with no stated timer). Callers that don't have timing info
    // (e.g. team-sim's off-field "was this state ever active" check) may omit
    // it — a 'seconds' state then never auto-expires within this call, which
    // degrades to persist-like behavior rather than crashing.
    const startTimes = stepTimes?.start ?? null;
    const endTimes = stepTimes?.end ?? null;

    const typeOf = (key) => {
        const def = skillMap?.[key];
        return def ? (def.skillType ?? def.formulaType) : null;
    };
    // A type trigger can name either the node skillType ('forte_heavy') or the
    // broader formula type ('heavy'); match against both so definitions can use
    // whichever is clearer.
    const formulaTypeOf = (key) => {
        const def = skillMap?.[key];
        return def ? (def.formulaType ?? def.skillType) : null;
    };

    // Per-state runtime: whether active, and (for duration) how many steps left.
    // A state with `initiallyActive` is on from step 0 (default stances like
    // Hiyuki's Present Self) until something consumes/exits it.
    const runtime = new Map();
    for (const d of defs) {
        runtime.set(d.name.toLowerCase(), {
            active: d.initiallyActive === true,
            stepsLeft: 0,
            expiresAt: null,   // for exit.mode === 'seconds' or 'consumedByThenSeconds'
            inGrace: false,    // 'consumedByThenSeconds': the consuming key has fired, counting down
            def: d,
        });
    }

    const matches = (trigger, key, type, formulaType) => {
        if (!trigger) return false;
        if (trigger.keys?.includes(key)) return true;
        if (trigger.types?.includes(type)) return true;
        if (trigger.types?.includes(formulaType)) return true;
        return false;
    };

    for (let i = 0; i < rot.length; i++) {
        const key  = rot[i];
        const type = typeOf(key);
        const formulaType = formulaTypeOf(key);

        // 1. Tick down duration states; expire any that hit zero BEFORE this step.
        for (const st of runtime.values()) {
            if (st.active && st.def.exit?.mode === 'duration') {
                if (st.stepsLeft <= 0) st.active = false;
            }
            const timed = st.def.exit?.mode === 'seconds' || st.def.exit?.mode === 'secondsOrConsumedBy';
            if (st.active && (timed || st.inGrace) && st.expiresAt != null
                && startTimes != null && startTimes[i] >= st.expiresAt) {
                st.active = false;
                st.expiresAt = null;
                st.inGrace = false;
            }
        }

        // 2. Apply exits triggered by THIS step (consumedBy, or the START of a
        // consumedByThenSeconds grace period — the state STAYS active through
        // the grace window, e.g. Lucilla's "Clear As Day Buff" continuing
        // through Reminiscence, then for a further 30s once Letting It Go ends
        // it — modeled as the SAME state remaining on, not a separate state).
        for (const st of runtime.values()) {
            const mode = st.def.exit?.mode;
            if (st.active && (mode === 'consumedBy' || mode === 'secondsOrConsumedBy')
                && matches(st.def.exit, key, type, formulaType)) {
                st.active = false;
                st.expiresAt = null;
            }
            if (st.active && !st.inGrace && mode === 'consumedByThenSeconds'
                && matches(st.def.exit, key, type, formulaType)) {
                st.inGrace = true;
                st.expiresAt = endTimes != null ? endTimes[i] + (st.def.exit.seconds ?? 0) : null;
            }
        }

        // 3. Apply enters triggered by THIS step.
        for (const st of runtime.values()) {
            if (matches(st.def.enter, key, type, formulaType)) {
                st.active = true;
                st.inGrace = false;   // re-entering cancels any grace period in progress
                st.expiresAt = null;
                if (st.def.exit?.mode === 'duration') st.stepsLeft = st.def.exit.steps ?? 1;
                if (st.def.exit?.mode === 'seconds' || st.def.exit?.mode === 'secondsOrConsumedBy') {
                    // Timer starts at the END of the entering step — same
                    // convention as castMatch's seconds(N) buff windows
                    // (P11-ADDENDUM §A3: "window opens at the end time of the
                    // triggering step"), so state expiry and buff expiry agree.
                    st.expiresAt = endTimes != null ? endTimes[i] + (st.def.exit.seconds ?? 0) : null;
                }
            }
        }

        // 4. Record the active set for this step (canonical name + aliases, so
        // effect gates naming a state GROUP match exactly, not fuzzily).
        for (const [name, st] of runtime) {
            if (st.active) {
                activeAt[i].add(name);
                for (const a of st.def.aliases ?? []) activeAt[i].add(String(a).toLowerCase());
            }
        }

        // 5. Decrement duration counters AFTER recording (the entering step counts).
        for (const st of runtime.values()) {
            if (st.active && st.def.exit?.mode === 'duration') st.stepsLeft -= 1;
        }
    }

    return { activeAt, states: defs.map(d => d.name.toLowerCase()) };
}

/**
 * Build a fast lookup: does the state-name (from an effect's structuralTrigger)
 * match any state active at the given step? Matching is fuzzy on purpose — the
 * parsed trigger state text ("twilight tango", "resonance mode - tune rupture")
 * may be a substring of, or contain, the canonical state name.
 *
 * @param {Set<string>} activeStates  — activeAt[i]
 * @param {string} triggerState       — effect.structuralTrigger.state (lowercased)
 * @returns {boolean}
 */
export function stateActive(activeStates, triggerState) {
    if (!activeStates || !triggerState) return false;
    const t = triggerState.toLowerCase().trim();
    for (const s of activeStates) {
        if (s === t || s.includes(t) || t.includes(s)) return true;
    }
    return false;
}
