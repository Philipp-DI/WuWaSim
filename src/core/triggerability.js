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
    const lowered = (text || '').toLowerCase();
    return STATUS_NAMES.filter(statusName => lowered.includes(statusName));
}

/**
 * How a status gate is satisfied — the load-bearing self-vs-enemy distinction
 * (P13 Team Effect Model). A status named in a buff condition is one of:
 *
 *   'self'   — the WIELDER must inflict/apply it ("Inflicting Glacio Chafe",
 *              "the wielder applies X", "when the Resonator inflicts X"). PERSONAL:
 *              a teammate putting the status on the enemy does NOT satisfy it
 *              (e.g. Wishes' Snowfall requires Carlotta herself to inflict Chafe).
 *   'team'   — explicitly the team inflicts it ("Resonators in the team inflict X").
 *   'enemy'  — the buff rewards interacting with an enemy that ALREADY HAS the
 *              status, from any source ("targets under Tune Strain", "hitting a
 *              target with Aero Erosion", "targets inflicted with X"). SHARED.
 *   'ambiguous' — no clear verb; treated conservatively (not team-satisfiable).
 *
 * Only 'enemy' and 'team' are satisfiable by a teammate. Order matters: an
 * explicit team subject wins; then an active inflict/apply verb (self); then a
 * passive "target has X" possession (enemy). "inflicted with" is possession, not
 * the active "inflict" verb — the \b boundary keeps them distinct.
 */
export function statusGateScope(conditionText) {
    const text = (conditionText || '').toLowerCase();
    if (/\b(resonators?\s+in\s+the\s+team|team\s+members?|the\s+team|all\s+resonators?|teammates?|other\s+resonators?)\b[^.]*\binflict/.test(text)) return 'team';
    if (/\binflict(s|ing)?\b/.test(text) || /\bappl(y|ies|ying)\b/.test(text)) return 'self';
    if (/\b(inflicted\s+with|affected\s+by|under|bearing|marked\s+with)\b/.test(text) || /\btargets?\s+(with|having|under)\b/.test(text)) return 'enemy';
    return 'ambiguous';
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
    for (const inherent of resonator?.inherentSkills ?? []) parts.push(inherent?.desc ?? '');
    for (const chainNode of resonator?.resonanceChain ?? []) parts.push(chainNode?.desc ?? '');
    const text = parts.join(' ').toLowerCase();
    if (id != null) _kitTextCache.set(id, text);
    return text;
}

/** Does this resonator's own kit inflict the given status? */
export function inflictsStatus(resonator, dataset, statusName) {
    return resonatorKitText(resonator, dataset).includes(String(statusName).toLowerCase());
}

/**
 * Can this resonator satisfy a conditional buff's activation?
 * Returns true unless the condition is gated on a status that NEITHER the
 * resonator's own kit NOR the team (when provided) can inflict.
 *
 * @param {object} resonator
 * @param {object} dataset
 * @param {string} conditionText  — the buff's activation/condition text
 * @param {Set<string>} [teamStatuses] — status keys (underscore form) the TEAM
 *        inflicts in this window (P13 Team Effect Model L2). Omitted/null → SOLO
 *        gating (own kit only), the unchanged single-resonator behaviour.
 * @returns {boolean}
 */
export function canSatisfyCondition(resonator, dataset, conditionText, teamStatuses = null) {
    const required = statusesInText(conditionText);
    if (required.length === 0) return true;                 // not a status gate → don't restrict
    const kit = resonatorKitText(resonator, dataset);
    // A teammate can satisfy the gate ONLY for enemy-state / team-inflict
    // phrasing — never a SELF-inflict clause (the wielder must inflict it). Status
    // text is space form ("glacio chafe"); team keys are underscore form.
    const scope = statusGateScope(conditionText);
    const teamSatisfiable = scope === 'enemy' || scope === 'team';
    return required.some(statusName => kit.includes(statusName) || (teamSatisfiable && teamStatuses?.has(statusName.replace(/\s+/g, '_'))));
}
