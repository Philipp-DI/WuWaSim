/**
 * Auto-triggered rotation actions (Phase 11 §7).
 *
 * Many WuWa skills force a follow-up: the moment the user adds the trigger
 * skill to their rotation, the standard rotation always continues with a
 * specific next action. This module curates those "always follows" pairs and
 * exposes a pure helper the build editor uses to propose the insertion.
 *
 * Curated + dataset-verified, exactly like rotation-rules.js. Add only clear,
 * unambiguous auto-triggers — "always follows in the standard rotation," not
 * "sometimes follows." Every `after` / `inserts` key is asserted to exist in
 * the resonator's autoSkillMap by tests/rotation-triggers.test.mjs.
 *
 * Rule shape: { after: string, inserts: string, note: string }
 *   after   — the rotation key whose addition triggers the proposal
 *   inserts — the follow-up key to insert immediately after it
 *   note    — one-line user-facing explanation
 *
 * The inserted step is a real, editable rotation step; the build tags it with
 * { autoInserted: true } in rotationMeta (see build.js) so the UI can mark it
 * and the user can remove it like any other step.
 */

export const TRIGGER_RULES = Object.freeze({
    // Carlotta: Chromatic Splendor is the forced follow-up to Art of Violence
    // (Resonance Skill → enhanced Resonance Skill).
    1107: [
        { after: 'skill', inserts: 'skill_chromatic_splendor',
          note: 'Chromatic Splendor automatically follows Art of Violence.' },
    ],
    // Add more characters as verified against the dataset.
});

/**
 * Trigger rules for a resonator (empty array when none).
 * @param {number|string} resonatorId
 * @returns {Array<{after:string, inserts:string, note:string}>}
 */
export function triggersForResonator(resonatorId) {
    return TRIGGER_RULES[Number(resonatorId)] ?? [];
}

/**
 * Given a rotation and the index of the step just added, return the auto-insert
 * proposal for a matching trigger, or null when nothing should be inserted.
 *
 * Returns null (no double-insertion) when the follow-up is already the step
 * immediately after the trigger — important because the build editor may
 * re-evaluate this on every repaint.
 *
 * @param {number|string} resonatorId
 * @param {string[]} rotation        — the rotation AFTER the trigger was added
 * @param {number} addedIndex        — index of the just-added (trigger) step
 * @returns {{ insertAt:number, skillKey:string, note:string } | null}
 */
export function proposeTriggeredInsert(resonatorId, rotation, addedIndex) {
    const rules = triggersForResonator(resonatorId);
    if (!rules.length || !Array.isArray(rotation)) return null;
    if (addedIndex == null || addedIndex < 0 || addedIndex >= rotation.length) return null;

    const addedKey = rotation[addedIndex];
    for (const rule of rules) {
        if (rule.after !== addedKey) continue;
        // Already present in the next slot → don't double-insert.
        if (rotation[addedIndex + 1] === rule.inserts) return null;
        return { insertAt: addedIndex + 1, skillKey: rule.inserts, note: rule.note };
    }
    return null;
}
