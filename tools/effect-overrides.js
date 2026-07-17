/**
 * Surgical per-effect override application (PRE-P12-DATA-QUALITY.md §3).
 *
 * Pure + testable: takes the projected resonators array and an overrides map
 * (`overrides.<resonatorId>.<slotKey>`) and mutates the effects in place —
 * surgical field merge, `suppress` removal, or adding an effect the parser
 * missed. Used by tools/preprocess.mjs after parseEffectsFromDesc; imported by
 * tests/effect-overrides.test.mjs to exercise the mechanism on fixtures.
 *
 * slotKey: 'S<level>.<index>' (chain) or 'IH<node>.<index>' (inherent).
 */

/** Resolve a slot key to { effects, index } — the owning effects array + position — or null. */
export function effectSlot(resonator, key) {
    let match = /^S(\d+)\.(\d+)$/.exec(key);
    if (match) {
        const node = (resonator.resonanceChain ?? []).find(chainNode => chainNode.level === Number(match[1]));
        return node ? { effects: (node.effects ??= []), index: Number(match[2]) } : null;
    }
    match = /^IH(\d+)\.(\d+)$/.exec(key);
    if (match) {
        const node = (resonator.inherentSkills ?? [])[Number(match[1])];
        return node ? { effects: (node.effects ??= []), index: Number(match[2]) } : null;
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
        const resonator = resonators.find(x => String(x.id) === String(ridStr));
        if (!resonator) { stats.bad++; continue; }
        for (const [key, patch] of Object.entries(byKey)) {
            const slot = effectSlot(resonator, key);
            if (!slot) { stats.bad++; continue; }
            const existing = slot.effects[slot.index];
            if (patch.suppress) {
                if (existing) { existing.__suppressed = true; stats.suppressed++; }
                continue;
            }
            const { suppress, ...rest } = patch;
            if (!existing) { slot.effects[slot.index] = { ...rest }; stats.added++; }   // add a missed effect
            else { Object.assign(existing, rest); stats.patched++; }             // surgical merge
        }
    }
    // Drop suppressed effects (renumbering accepted — slot keys are positional).
    for (const resonator of resonators) {
        for (const chainNode of resonator.resonanceChain ?? []) if (chainNode.effects) chainNode.effects = chainNode.effects.filter(effect => !effect.__suppressed);
        for (const inherent of resonator.inherentSkills ?? []) if (inherent.effects) inherent.effects = inherent.effects.filter(effect => !effect.__suppressed);
    }
    return stats;
}
