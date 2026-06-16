/**
 * Surgical per-effect override application (PRE-P12-DATA-QUALITY.md §3).
 *
 * Pure + testable: takes the projected resonators array and an overrides map
 * (`overrides.<resonatorId>.<slotKey>`) and mutates the effects in place —
 * surgical field merge, `suppress` removal, or adding an effect the parser
 * missed. Used by tools/preprocess.mjs after parseEffectsFromDesc; imported by
 * test/effect-overrides.test.mjs to exercise the mechanism on fixtures.
 *
 * slotKey: 'S<level>.<index>' (chain) or 'IH<node>.<index>' (inherent).
 */

/** Resolve a slot key to the owning effects array + index, or null. */
export function effectSlot(resonator, key) {
    let m = /^S(\d+)\.(\d+)$/.exec(key);
    if (m) {
        const node = (resonator.resonanceChain ?? []).find(c => c.level === Number(m[1]));
        return node ? { arr: (node.effects ??= []), idx: Number(m[2]) } : null;
    }
    m = /^IH(\d+)\.(\d+)$/.exec(key);
    if (m) {
        const node = (resonator.inherentSkills ?? [])[Number(m[1])];
        return node ? { arr: (node.effects ??= []), idx: Number(m[2]) } : null;
    }
    return null;
}

/**
 * Apply overrides in place. Returns counts { patched, suppressed, added, bad }.
 * @param {Array<object>} resonators
 * @param {Object<string, Object<string, object>>} overrides
 */
export function applyEffectOverrides(resonators, overrides = {}) {
    const stats = { patched: 0, suppressed: 0, added: 0, bad: 0 };
    for (const [ridStr, byKey] of Object.entries(overrides)) {
        const r = resonators.find(x => String(x.id) === String(ridStr));
        if (!r) { stats.bad++; continue; }
        for (const [key, patch] of Object.entries(byKey)) {
            const slot = effectSlot(r, key);
            if (!slot) { stats.bad++; continue; }
            const existing = slot.arr[slot.idx];
            if (patch.suppress) {
                if (existing) { existing.__suppressed = true; stats.suppressed++; }
                continue;
            }
            const { suppress, ...rest } = patch;
            if (!existing) { slot.arr[slot.idx] = { ...rest }; stats.added++; }   // add a missed effect
            else { Object.assign(existing, rest); stats.patched++; }             // surgical merge
        }
    }
    // Drop suppressed effects (renumbering accepted — slot keys are positional).
    for (const r of resonators) {
        for (const c of r.resonanceChain ?? []) if (c.effects) c.effects = c.effects.filter(e => !e.__suppressed);
        for (const s of r.inherentSkills ?? []) if (s.effects) s.effects = s.effects.filter(e => !e.__suppressed);
    }
    return stats;
}
