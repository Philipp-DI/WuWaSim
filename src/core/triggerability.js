/**
 * Conditional-effect triggerability (P12).
 *
 * Many sonata 5-piece bonuses and weapon passives are gated on an activation
 * condition — most importantly an element/mechanic STATUS the wielder must
 * inflict (e.g. "Inflicting Glacio Chafe", "after Spectro Frazzle"). On a SOLO
 * build such a buff only counts if the resonator's OWN kit can inflict that
 * status; otherwise crediting it (as the sim's old "unknown trigger = always-on"
 * path did) over-values sets/weapons the character can never actually proc
 * (e.g. Carlotta getting a Glacio-Chafe set she can't trigger).
 *
 * This module answers "can this resonator satisfy that condition solo?" by
 * scanning the condition for a known status and, if found, checking the
 * resonator's own skill / inherent / chain text for it. Self-actions (casting a
 * skill, dealing damage, healing) and unrecognised conditions are assumed
 * satisfiable — we gate only when we can clearly identify a status the kit lacks.
 */

// Element-affliction / mechanic statuses that appear as activation conditions in
// sonata 5pc + weapon passive text. Lower-case; matched as substrings.
const STATUS_NAMES = Object.freeze([
    'glacio chafe',
    'fusion burst',
    'aero erosion',
    'spectro frazzle',
    'tune rupture',
    'tune strain',
    'havoc bane',
]);

/** Statuses named in a condition string (the ones a buff is gated on). */
export function statusesInText(text) {
    const t = (text || '').toLowerCase();
    return STATUS_NAMES.filter(s => t.includes(s));
}

// Cache the concatenated kit text per resonator id (descriptions don't change
// within a session).
const _kitTextCache = new Map();

function resonatorKitText(resonator, dataset) {
    const id = resonator?.id;
    if (id != null && _kitTextCache.has(id)) return _kitTextCache.get(id);
    const parts = [];
    const map = dataset?.autoSkillMap?.[String(id)] ?? {};
    for (const k in map) if (map[k]?.desc) parts.push(map[k].desc);
    for (const ih of resonator?.inherentSkills ?? []) parts.push(ih?.desc ?? '');
    for (const ch of resonator?.resonanceChain ?? []) parts.push(ch?.desc ?? '');
    const text = parts.join(' ').toLowerCase();
    if (id != null) _kitTextCache.set(id, text);
    return text;
}

/** Does this resonator's own kit inflict the given status? */
export function inflictsStatus(resonator, dataset, statusName) {
    return resonatorKitText(resonator, dataset).includes(String(statusName).toLowerCase());
}

/**
 * Can this resonator satisfy a conditional buff's activation on a SOLO build?
 * Returns true unless the condition is gated on a status the kit can't inflict.
 *
 * @param {object} resonator
 * @param {object} dataset
 * @param {string} conditionText  — the buff's activation/condition text
 * @returns {boolean}
 */
export function canSatisfyCondition(resonator, dataset, conditionText) {
    const required = statusesInText(conditionText);
    if (required.length === 0) return true;                 // not a status gate → don't restrict
    const kit = resonatorKitText(resonator, dataset);
    return required.some(s => kit.includes(s));             // OR — any required status the kit inflicts
}
