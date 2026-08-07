/**
 * Bind an effect to the SKILLS its clause names, and to the STATE that gates it.
 *
 * Two clause shapes, both written by the game with the full skill name:
 *
 *   TARGET — the skill is the object of the sentence.
 *     "The DMG Multiplier of Resonance Skill Seraphic Duet: Overture is
 *      increased by 100%."                                   (Aemeath S2)
 *     "Resonance Liberation Heavenfall Edict: Finale's DMG Multiplier is
 *      increased by 100%."                                   (Aemeath S3)
 *
 *   SUBJECT — the skills are what GAINS the buff.
 *     "In Instant Response, Heavy Attack - Aemeath and Heavy Attack - Mech
 *      gain 300% Crit. DMG increase…"                        (Aemeath S1)
 *     "In Instant Response, Heavy Attack - Aemeath and Heavy Attack - Mech
 *      gain 200% DMG Amplification."                         (inherent)
 *
 * The parser reduced a TARGET clause to its CATEGORY (`detectSkillType` →
 * 'skill' / 'liberation') and dropped the name, which is wrong twice over:
 * sibling clauses stack onto each other, and they land on every step of that
 * category. Measured on Aemeath before this fix — her S2 gave **+200% to all
 * four Mech skill steps and nothing at all to either Seraphic Duet** (the Duets
 * are `forte_heavy` nodes, so the category never even matched them), and her S3
 * gave **+140% to BOTH liberations** where the kit says Finale +100% and
 * Overdrive +40%. Her S2→S3 jump read 2.36x against a reference of ~1.25x.
 *
 * A SUBJECT clause had no scope at all: read without one, S1's +300% Crit DMG
 * would apply to every hit she lands rather than to her two Heavy Attacks.
 *
 * Resolution is deliberately conservative: the name must match a skill key on
 * ALL of its distinctive tokens (`keyMatchesName`, shared with the status-apply
 * derivation). A name that resolves to nothing leaves the effect exactly as it
 * was — category-scoped, or unscoped — so a kit this cannot read is never made
 * worse. "Resonators in the team gain 20% All-Attribute DMG Bonus" resolves to
 * nothing and stays team-wide, which is the behaviour that keeps this safe.
 */
import { keyMatchesName, nameTokens } from './status-apply.mjs';
import { stateDefsForResonator } from '../../src/core/rotation-rules.js';

// "The DMG Multiplier of <name> is increased by 100%" and the possessive form
// "<name>'s DMG Multiplier is increased by 40%". Both appear in one kit.
const OF_FORM = /DMG\s*Multiplier\s+of\s+(.+?)\s+is\s+increased/i;
const POSSESSIVE_FORM = /([^.;]+?)(?:'s|s')\s+DMG\s*Multiplier\s+is\s+increased/i;

// "<names> gain/deal …" — the subject form. Taken from the segment that
// immediately precedes the verb, never across a comma: the game routinely puts a
// LIST of triggering casts in front of the subject ("When casting Intro Skill A,
// Resonance Skill B and Resonance Skill C, Resonators in the team gain 20% …"),
// and a span that reaches back over those commas would bind a team-wide buff to
// the very skills that merely trigger it.
//
// The LAST match wins, because a leading clause is the TRIGGER and the granting
// clause comes after it — Luuk Herssen S4 is "After a Resonator in the team
// deals Tune Break DMG, all Resonators in the team deal 20% more DMG", where the
// first match is the trigger and only the second is the subject.
const SUBJECT_FORM = /(?:^|[,.;])\s*([^,.;]+?)\s+(?:gains?|deals?)\s/gi;

// A clause's leading "In <X>," qualifier, which the game uses for both a
// Resonance Mode and an in-combat state. Only the latter is a state.
const LEADING_IN = /^in\s+([^,]+),/i;

// In prose the game writes the category WITHOUT a separator ("Resonance Skill
// Seraphic Duet: Overture"), where a bracketed kit name uses one ("[Basic
// Attack - Iai]"). status-apply.mjs's shared stripper only handles the latter,
// and leaving "Resonance" in front makes `keyMatchesName` demand a token no
// skill key carries — which is why every one of these clauses failed to bind on
// the first attempt. Stripped here rather than in the shared helper: widening
// that one would change how bracketed names resolve for status infliction.
const PROSE_CATEGORY_LEAD =
    /^(?:basic attack|heavy attack|mid-?air attack|resonance skill|resonance liberation|resonance mode|intro skill|outro skill|forte circuit|dodge counter)\s*[-:–]?\s*/i;

/**
 * The skill keys a name resolves to, or [].
 *
 * Tried WITH the category first, because for some names the category is part of
 * the key's own identity ("Heavy Attack - Aemeath" → `heavy_aemeath_charged_i`,
 * where dropping it would widen the name to every skill of hers). Stripping is
 * the fallback for names where the category is a FILING label that contradicts
 * the key ("Resonance Skill Seraphic Duet: Overture" lives under a
 * `forte_heavy_` key). Whichever resolves first wins, and the un-stripped form
 * is always the narrower of the two.
 */
export function resolveNameToKeys(name, keys) {
    const attempts = [
        [name, { stripCategory: false }],
        [name.replace(PROSE_CATEGORY_LEAD, '').trim(), {}],
    ];
    for (const [candidate, options] of attempts) {
        if (!candidate || !nameTokens(candidate, options).length) continue;
        const matched = keys.filter(key => keyMatchesName(key, candidate, options));
        if (matched.length) return matched;
    }
    return [];
}

/** The skill name a TARGET clause names, or null when it names none. */
export function targetNameInClause(clause) {
    const named = OF_FORM.exec(clause);
    const possessive = named ? null : POSSESSIVE_FORM.exec(clause);
    const raw = named ? named[1] : possessive?.[1];
    return raw ? raw.trim().replace(PROSE_CATEGORY_LEAD, '').trim() : null;
}

/** The skill names a SUBJECT clause names, as written. */
export function subjectNamesInClause(clause) {
    const matches = [...String(clause ?? '').matchAll(SUBJECT_FORM)];
    if (!matches.length) return [];
    return matches[matches.length - 1][1]
        .split(/\s+and\s+|,\s*/i).map(part => part.trim()).filter(Boolean);
}

/**
 * The state a clause's leading "In <X>," names, matched against the states this
 * resonator actually declares — so a Resonance Mode (which the game writes the
 * same way) can never be read as a state, and an unmodelled phrase like "In
 * combat state" is left alone rather than binding to a state that never lights.
 * See the CLAUDE.md invariant: a MODE is not a STATE.
 */
export function stateInClause(clause, stateNames) {
    const match = LEADING_IN.exec(clause ?? '');
    if (!match) return null;
    const named = match[1].trim().toLowerCase();
    return stateNames.find(name => named === name || named.includes(name)) ?? null;
}

/**
 * Resolve every effect on a resonator to the skill keys its own clause names,
 * and to the state its clause gates it behind. Mutates the effects in place and
 * returns how many were bound, for the preprocess log.
 *
 * @param {object} resonator — projected resonator (resonanceChain + inherentSkills)
 * @param {object} skillMap  — autoSkillMap[resonatorId]
 */
export function bindSkillScopes(resonator, skillMap) {
    const keys = Object.keys(skillMap ?? {});
    if (!keys.length) return 0;
    const stateNames = stateDefsForResonator(resonator.id).map(def => def.name.toLowerCase());
    let bound = 0, dropped = 0;
    const nodes = [...(resonator.resonanceChain ?? []), ...(resonator.inherentSkills ?? [])];
    for (const node of nodes) {
        for (const effect of [...(node.effects ?? [])]) {
            if (!effect.condition) continue;

            // A TARGET clause names one skill; a SUBJECT clause may name several.
            const target = effect.stat === 'multiplierUp' ? targetNameInClause(effect.condition) : null;
            const matched = target
                ? resolveNameToKeys(target, keys)
                : subjectNamesInClause(effect.condition)
                    .flatMap(name => resolveNameToKeys(name, keys));
            if (matched.length) {
                effect.skillKeys = [...new Set(matched)];
                bound++;
            }

            // A "deals N% more DMG" clause is kept ONLY if it landed a scope:
            // the skills it names, or the whole team. Unscoped it is unsafe —
            // the phrasing carries its condition in prose the clause classifier
            // does not read ("to targets whose HP is below 50%"), so an
            // always-on +400% would be the result. Marked at parse time
            // (effects.mjs) because only this pass can tell whether it resolved.
            if (effect.needsScope) {
                delete effect.needsScope;
                if (!effect.skillKeys?.length && !effect.teamWide) {
                    node.effects.splice(node.effects.indexOf(effect), 1);
                    dropped++;
                    continue;
                }
            }

            // The state gate is independent of the scope: a clause can name a
            // state without naming a skill, and vice versa.
            const state = stateInClause(effect.condition, stateNames);
            if (state && effect.trigger?.type !== 'stateEnter') {
                effect.trigger = { type: 'stateEnter', state };
                effect.window = { type: 'stateBound', state };
                effect.structuralTrigger = { type: 'inState', state };
            }
        }
    }
    return { bound, dropped };
}
