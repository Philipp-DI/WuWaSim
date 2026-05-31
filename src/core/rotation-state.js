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
 *               (a skill key/type that ends it), or 'duration' (N steps, an
 *               approximation since we don't track real time per step here)
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
 * @returns {{ activeAt: Array<Set<string>>, states: string[] }}
 *          activeAt[i] = Set of state names active at step i;
 *          states = the list of defined state names (lowercased)
 *
 * StateDef shape:
 *   {
 *     name:   string                 — canonical state name (matched lowercased)
 *     initiallyActive?: boolean      — active from step 0 (default stances)
 *     enter:  { keys?: string[], types?: string[] }   — what activates it
 *     exit:   { mode: 'persist'|'consumedBy'|'duration',
 *               keys?: string[], types?: string[], steps?: number }
 *   }
 */
export function computeStateTimeline(rotation, skillMap, stateDefs) {
    const rot = Array.isArray(rotation) ? rotation : [];
    const defs = Array.isArray(stateDefs) ? stateDefs : [];
    const activeAt = rot.map(() => new Set());
    if (defs.length === 0) return { activeAt, states: [] };

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
        }

        // 2. Apply exits triggered by THIS step (consumedBy).
        for (const st of runtime.values()) {
            if (st.active && st.def.exit?.mode === 'consumedBy' && matches(st.def.exit, key, type, formulaType)) {
                st.active = false;
            }
        }

        // 3. Apply enters triggered by THIS step.
        for (const st of runtime.values()) {
            if (matches(st.def.enter, key, type, formulaType)) {
                st.active = true;
                if (st.def.exit?.mode === 'duration') st.stepsLeft = st.def.exit.steps ?? 1;
            }
        }

        // 4. Record the active set for this step.
        for (const [name, st] of runtime) {
            if (st.active) activeAt[i].add(name);
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
