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
import { splitClauses } from './effects.mjs';
import { stateDefsForResonator } from '../../src/core/rotation-rules.js';

// "The <stat> of <name> is increased by 100%" and the possessive form
// "<name>'s <stat> is increased by 40%". Both appear in one kit.
//
// <stat> is not only "DMG Multiplier": the game writes the same TARGET sentence
// about a skill's plain DMG ("The DMG of Resonance Liberation Final Act -
// Stagecraft Form is increased by 100%") and about its Crit. DMG ("The Crit. DMG
// of Foreclaiming: Inward Vision and Foreclaiming: Blade Liberation is increased
// by 500%"). Reading those without the name is how a 500% Crit. DMG meant for
// two skills lands on every hit its wielder throws — which is exactly the defect
// the multiplier half of this file was written to stop.
//
// The stat is PLURALISED whenever the sentence lists skills, and the verb turns
// with it: "The DMG Multipliers of Sawring - Blitz, Chainsaw Mode - Dodge
// Counter and Sawring - Eradication are increased by 120%." Without the `s?`
// and the `are`, every list-shaped clause read as naming nothing — 14 of them,
// including four of the six that shipped scoped to nothing at all.
//
// Ordered longest-first so "DMG Multiplier" is never matched as bare "DMG".
const TARGET_STAT = String.raw`(?:DMG\s*Multipliers?|Crit\.?\s*(?:DMG|Rate)|DMG|[Dd]amage)`;
const INCREASED = String.raw`(?:(?:is|are)\s+)?increas`;
const OF_FORM = new RegExp(String.raw`${TARGET_STAT}\s+of\s+(.+?)\s+${INCREASED}`, 'i');
// Comma-free, for the same reason SUBJECT_FORM is: the name PRECEDES the stat
// here, so a span that reaches back over a comma swallows the leading trigger
// clause whole. Aemeath's "In Resonance Mode - Tune Rupture, when Resonators in
// the team … , Aemeath's Crit. DMG increases by 20%" captured all of it, and the
// mode's own name then resolved to a skill key — scoping a global Crit. DMG
// buff to one Tune Rupture row.
const POSSESSIVE_FORM = new RegExp(String.raw`([^.;,]+?)(?:'s|s')\s+${TARGET_STAT}\s+${INCREASED}`, 'i');
// "Damage dealt by <name> is increased by 20%" — the same TARGET sentence with
// the skill behind "dealt by" instead of "of" (Sanhua's two inherents).
const DEALT_BY_FORM = new RegExp(String.raw`(?:DMG|[Dd]amage)\s+dealt\s+by\s+(.+?)\s+${INCREASED}`, 'i');
// The same "of <name>" with the increase stated BEFORE it, so no verb follows
// the name: "…representing a total increase of 186.6% in the DMG Multiplier of
// Resonance Liberation Death Knell." Tried after the verb forms, because with
// no verb to stop at it runs to the end of the clause and needs `trimNameTail`
// to find the name's own edge.
const OF_TAIL_FORM = new RegExp(String.raw`${TARGET_STAT}\s+of\s+([^.;]+?)\s*[.;]?$`, 'i');
// Two prepositions the game uses in place of "of", each kept to the explicit
// "DMG Multiplier" because a bare "DMG"/"damage" in front of "for" is usually a
// duration ("DMG is increased by 30% for 5s"), not a skill:
//   "The bonus DMG Multiplier FOR Sawring - Eradication …"        (Chisa S3.1)
//   "Resonance Skill Golden Reflux HAS ITS DMG Multiplier …"      (Luuk S5.1)
const FOR_FORM = new RegExp(String.raw`DMG\s*Multipliers?\s+for\s+(.+?)\s+${INCREASED}`, 'i');
const HAS_ITS_FORM = new RegExp(String.raw`([^.;,]+?)\s+ha(?:s|ve)\s+(?:its|their)\s+${TARGET_STAT}\s+${INCREASED}`, 'i');
// "The following skills have their DMG Multiplier increased by 25%: - Heavy
// Attack - Thunderoar: Backstep, Dodge Counter - Thunderoar: Backstep, …" — the
// names sit after the colon, so every form above reads only "The following
// skills". Read as ALL-OR-NOTHING (see `bulletNamesInClause`): a bulleted list
// is an enumeration, and a partial read of one silently drops the members it
// could not parse rather than falling back to anything.
//
// The STAT has to be named ahead of the colon, because the game writes the very
// same list as a TRIGGER: Galbrena's inherent is "1 stack of Fated End is
// inflicted on the target when the following skills hit: Intro Skill, Basic
// Attack, …", where 11 of the 13 members resolve and only the all-or-nothing
// guard stood between an infliction list and a buff scope. A list of casts that
// FIRE an effect is not the list of skills it applies to (CLAUDE.md — a
// sentence's leading TRIGGER is not the effect's SCOPE).
// Matched in two parts because the game puts the stat on either side of
// "following skills" — "The following skills have their DMG Multiplier
// increased by 25%:" (Augusta) and "The DMG Multipliers of the following skills
// are increased by 50%:" (Rebecca).
const BULLET_LIST_FORM = /^([^:]*\bfollowing\s+skills?\b[^:]*):\s*(.+)$/i;
const BULLET_LIST_STAT = new RegExp(TARGET_STAT, 'i');
// The name in front of the stat, with no "of" and no possessive to hang it on:
// "10% additional Hack DMG Multiplier" (Lucy), "Laser DMG Multiplier is
// increased by 100%" (Lumi). Deliberately narrowed to "DMG Multiplier" — the
// same run in front of a bare "DMG" is usually a category or a trigger, and the
// four forms above already read every sentence that states one properly.
const STAT_PREFIX_FORM = /([A-Za-z][\w'’:!-]*(?:\s+[A-Za-z][\w'’:!-]*){0,2})\s+DMG\s*Multipliers?/i;

// A leading owner ("Rover's Basic Attack Resonating Echoes") — the possessive is
// noise the skill KEY never carries, and `keyMatchesName` needs every
// distinctive token to match, so leaving it in fails every such name.
const POSSESSIVE_OWNER = /^\s*[A-Z][\w:.-]*(?:\s+[A-Z][\w:.-]*)?(?:'s|s')\s+/;

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
//
// "Resonance Mode" is deliberately NOT in this list, where it used to be: a mode
// is not a category a skill is filed under, so stripping it does not expose a
// skill name — it exposes the MODE's name, and "Resonance Mode - Tune Rupture"
// then resolves to `forte_heavy_tune_rupture_response_starburst`.
const PROSE_CATEGORY =
    /(?:basic attack|heavy attack|mid-?air attack|resonance skill|resonance liberation|intro skill|outro skill|forte circuit|dodge counter)\s*[-:–]?\s*/gi;
const PROSE_CATEGORY_LEAD = new RegExp(`^${PROSE_CATEGORY.source}`, 'i');

// Words the game glues onto a skill name that no skill KEY ever carries — the
// determiners and the connective in "the next Heavy Attack Detonate" and
// "Override from Resonance Liberation - Netrunner". Stripped only in the last
// resolution attempt, so a name that already resolves is never widened by it.
const NAME_NOISE =
    /\b(?:the|its|his|her|their|this|that|next|subsequent|additional|additionally|following|bonus|all|forms|from)\b/gi;

// A name made of nothing but category words is not a name — it is the weaker
// restatement of the clause's own category, which `nodeTypeMatches` already
// answers (and answers better: it strips the `forte_` provenance prefix rather
// than matching the bare word). Resolved by token, "Heavy Attack" would reach
// every key that merely contains "heavy", including Cartethyia's
// `forte_heavy_mid_air_attack_*`, which are not Heavy Attacks at all.
// `attack` and `skill` are NAME_STOPWORDS already, so they never appear here.
//
// Held to the words the game actually writes a bare category with. `plunging`,
// `echo` and `circuit` were in this list and are gone: none of them is needed
// to refuse anything on the roster, and each is a DISTINCTIVE token of real
// keys (`basic_plunging_attack`, `forte_heavy_resonating_echoes_1`,
// `forte_heavy_forte_circuit_learn_my_true_name`). Refusing a name is only safe
// while the category fallback can answer for it — a clause naming just
// "Plunging Attack" has no `detectSkillType` phrase, so refusing it would leave
// the effect scoped to nothing at all, which is worse than the blunt match.
const CATEGORY_TOKENS = new Set(['basic', 'heavy', 'mid', 'air', 'midair',
    'dodge', 'counter', 'intro', 'outro', 'resonance', 'liberation', 'forte']);

// Tested with the wielder's possessive gone as well, because that is how
// `resolveNameToKeys` will read it: "Cartethyia's Basic Attack" is still a bare
// category once "Cartethyia's" is stripped, and left in it survived the guard
// and then resolved on the single token "basic".
const isBareCategory = (name) => {
    const tokens = nameTokens(String(name).replace(POSSESSIVE_OWNER, ''), { stripCategory: false });
    return tokens.length > 0 && tokens.every(token => CATEGORY_TOKENS.has(token));
};

// Where the name ends and the sentence resumes. The game continues talking
// straight past the skill it named — "of Jolt triggered by Cantarella", "of
// Scarlet Coda by 75%", "of Forte Circuit's Sweet Dream is additionally",
// "Heavy Attack Detonate within 5s" — and `keyMatchesName` needs EVERY token to
// appear in the key, so one word of tail is enough to resolve the name to
// nothing. Anchored on `\s+` so a name's own words are never cut.
const NAME_TAIL =
    /\s+(?:by\s+[\d.]+\s*%|(?:is|are)\s|triggered\s+by\s|granted\s+by\s|within\s+[\d.]|for\s+[\d.]+s\b)[\s\S]*$/i;

const trimNameTail = (name) => String(name ?? '').replace(NAME_TAIL, '').trim();

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
 *
 * The last attempt is the loosest: every noise word and every category gone,
 * wherever they sit. It is what reads "Override from Resonance Liberation -
 * Netrunner" as `liberation_netrunner_override`, and being last it can only
 * ever resolve a name the four narrower forms already gave up on.
 */
export function resolveNameToKeys(name, keys) {
    const owned = name.replace(POSSESSIVE_OWNER, '').trim();
    const bare = owned.replace(NAME_NOISE, ' ').replace(PROSE_CATEGORY, ' ').trim();
    const attempts = [
        [name, { stripCategory: false }],
        [name.replace(PROSE_CATEGORY_LEAD, '').trim(), {}],
        [owned, { stripCategory: false }],
        [owned.replace(PROSE_CATEGORY_LEAD, '').trim(), {}],
        [bare, { stripCategory: false }],
    ];
    for (const [candidate, options] of attempts) {
        if (!candidate || !nameTokens(candidate, options).length) continue;
        const matched = keys.filter(key => keyMatchesName(key, candidate, options));
        if (matched.length) return matched;
    }
    return [];
}

/** Split a "<name> and <name>" / "<name>, <name>" run into its names. */
function splitNames(raw) {
    return String(raw ?? '').split(/\s+and\s+|,\s*/i).map(part => part.trim()).filter(Boolean);
}

/**
 * The skill names a TARGET clause names, or []. Plural because the game lists
 * them — "The Crit. DMG of Foreclaiming: Inward Vision and Foreclaiming: Blade
 * Liberation is increased by 500%" is two skills, and reading it as one long
 * name resolves to nothing and leaves a 500% buff unscoped.
 */
export function targetNamesInClause(clause, stat = null) {
    const raw = OF_FORM.exec(clause)?.[1]
        ?? FOR_FORM.exec(clause)?.[1]
        ?? DEALT_BY_FORM.exec(clause)?.[1]
        ?? POSSESSIVE_FORM.exec(clause)?.[1]
        ?? HAS_ITS_FORM.exec(clause)?.[1]
        ?? OF_TAIL_FORM.exec(clause)?.[1]
        // Read off "DMG Multiplier" itself, so it can only ever scope the
        // multiplier — never a sibling effect from the same sentence. Lucy's
        // inherent states both at once: "Grants 10% All DMG Amplification and
        // 10% additional Hack DMG Multiplier", where the amplify half is
        // genuinely global and only the multiplier belongs to Hack.
        //
        // The capture keeps whatever words precede the stat, so the noise words
        // are dropped here rather than left to the loosest resolution attempt:
        // "The bonus DMG Multiplier for Sawring - Eradication …" names nothing
        // at all, and reading "bonus" as a name lands it on whichever row of the
        // kit happens to carry that word.
        ?? (stat === 'multiplierUp'
            ? STAT_PREFIX_FORM.exec(clause)?.[1]?.replace(NAME_NOISE, ' ').trim() || undefined
            : undefined);
    // The category is NOT stripped here: `resolveNameToKeys` tries the name with
    // it first on purpose, because for some families the category IS the key's
    // identity ("Heavy Attack - Aemeath" → `heavy_aemeath_charged_i`). Stripping
    // it up front threw that attempt away, and for a bare category it left an
    // empty string that was then dropped as if the clause had named nothing.
    return splitNames(raw).map(trimNameTail).filter(name => name && !isBareCategory(name));
}

/** A clause that is nothing but a continuation bullet of the list above it. */
const BULLET_CONTINUATION = /^\s*[-–]\s*\S/;

/**
 * The names of a "the following skills … : - X, Y, Z" list, or [].
 *
 * The game separates the list's members with commas but also writes " - " INSIDE
 * a member ("Basic Attack - Huntress"), and it reuses " - " to separate two
 * groups ("… Dodge Counter - Huntress - Basic Attack - Guts"). Nothing in the
 * text distinguishes the two, so the list is taken only when every member of it
 * resolves: an enumeration read in part is an enumeration with members silently
 * missing, where an enumeration not read at all leaves the clause's category
 * fallback in place. Rebecca's seven names collapse to six and are left alone.
 *
 * The list also runs PAST its own clause. The game ends a group with a period
 * and opens the next with a bullet, so `splitClauses` cuts Augusta's seven names
 * into three clauses of which only the first carries the effect — and the
 * all-or-nothing gate cannot weigh members it was never handed. The following
 * clauses are taken while they are bare continuation bullets.
 */
export function bulletNamesInClause(clause, continuations, keys) {
    const match = BULLET_LIST_FORM.exec(clause ?? '');
    if (!match || !BULLET_LIST_STAT.test(match[1])) return [];
    const parts = [match[2]];
    for (const next of continuations ?? []) {
        if (!BULLET_CONTINUATION.test(next)) break;
        parts.push(next);
    }
    const names = parts.flatMap(part => splitNames(part))
        .map(name => name.replace(/^[-–\s]+/, '').replace(/[.\s]+$/, '').trim())
        .filter(Boolean);
    return names.length && names.every(name => resolveNameToKeys(name, keys).length) ? names : [];
}

/**
 * The SUBJECT segments of a clause, the one adjacent to the verb first and each
 * earlier comma-separated segment after it.
 *
 * The subject is itself a LIST often enough to matter — "all forms of Resonance
 * Skill Aureole of Execution, Ichor Deposit, and Mid-air Attack - Gavel of
 * Earthshaker deal 30% more DMG" is three skills, of which the segment beside
 * the verb is one. The caller walks backwards and stops at the first segment
 * that names no skill, which is what still keeps a leading TRIGGER list out:
 * reaching it means walking through the subject, and a team-wide subject
 * ("Resonators in the team gain …") resolves to nothing and ends the walk on
 * its own.
 */
export function subjectNameRunsInClause(clause) {
    const matches = [...String(clause ?? '').matchAll(SUBJECT_FORM)];
    if (!matches.length) return [];
    const last = matches[matches.length - 1];
    const earlier = String(clause).slice(0, last.index).split(/[,.;]/);
    return [last[1], ...earlier.reverse()]
        .map(run => splitNames(run).filter(name => !isBareCategory(name)));
}

/** The skill names in the segment adjacent to the verb. */
export function subjectNamesInClause(clause) {
    return subjectNameRunsInClause(clause)[0] ?? [];
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
 * The skill keys one clause names, for one stat, or [].
 *
 * Takes the clause and everything after it in the same node, because a bulleted
 * list runs past its own clause (see `bulletNamesInClause`); every other form
 * reads `clauseRun[0]` alone.
 *
 * A TARGET clause names the skills the stat belongs to; a SUBJECT clause names
 * the skills that GAIN it. A target that resolves to NOTHING falls through to
 * the subject form rather than ending the search: "Outro Skill Discipline gains
 * an additional DMG Multiplier of 120%" is a subject sentence whose tail form
 * still captures something ("120%"), and letting that stand cost Jiyan the one
 * binding his clause states outright.
 *
 * Read for EVERY stat, not just `multiplierUp`: the TARGET sentence is how the
 * game scopes a Crit. DMG or plain-DMG grant too, and restricting the form to
 * one stat left those unscoped.
 */
function namesInClause(clauseRun, stat, keys, isOwnerName) {
    const [clause, ...continuations] = clauseRun;
    const resolveNames = (names) => names
        .filter(name => !isOwnerName(name))
        .flatMap(name => resolveNameToKeys(name, keys));

    const fromBullets = resolveNames(bulletNamesInClause(clause, continuations, keys));
    if (fromBullets.length) return fromBullets;

    const fromTarget = resolveNames(targetNamesInClause(clause, stat));
    if (fromTarget.length) return fromTarget;

    const fromSubject = [];
    for (const run of subjectNameRunsInClause(clause)) {
        const resolved = resolveNames(run);
        if (!resolved.length) break;
        fromSubject.push(...resolved);
    }
    return fromSubject;
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
    if (!keys.length) return { bound: 0, dropped: 0 };
    const stateNames = stateDefsForResonator(resonator.id).map(def => def.name.toLowerCase());
    // "Aemeath's Crit. DMG is increased by 30%" names the WIELDER, not a skill —
    // her whole output, every hit. Resolved as a name it matches every key with
    // "aemeath" in it (the eight human-form ones) and silently turns a global
    // self-buff into a partial one, which is the opposite of what scoping is for.
    const ownName = String(resonator.name ?? '').trim().toLowerCase();
    const isOwnerName = (name) =>
        String(name).replace(/(?:'s|s')$/i, '').trim().toLowerCase() === ownName;
    let bound = 0, dropped = 0;
    const nodes = [...(resonator.resonanceChain ?? []), ...(resonator.inherentSkills ?? [])];
    for (const node of nodes) {
        // `effect.condition` is the clause TRUNCATED to 120 characters for
        // display (effects.mjs), and a skill name is routinely the thing the cut
        // removes: Carlotta's whole "…in the DMG Multiplier of Resonance
        // Liberation Death Knell" sits past the 120th character, and Xiangli
        // Yao's "Law of Reigns" survives as the fragment "Resona". Recover the
        // clause it was cut from — the node's own description is right here, and
        // the truncation is a prefix, so the match is exact.
        const clauses = splitClauses(node.desc ?? '');
        // The clause and everything the node says after it — a bulleted list is
        // the one form that runs past its own clause.
        const clauseRunFor = (effect) => {
            const index = clauses.findIndex(clause => clause.trim().slice(0, 120) === effect.condition);
            return index < 0 ? [effect.condition] : clauses.slice(index);
        };

        for (const effect of [...(node.effects ?? [])]) {
            if (!effect.condition) continue;
            const clauseRun = clauseRunFor(effect);
            const clause = clauseRun[0];

            const matched = namesInClause(clauseRun, effect.stat, keys, isOwnerName);
            // A scope the GAME stated (buff-facts.mjs, ExtraEffectRequirements
            // type 1) is never overwritten by a name match: it is an explicit
            // skill-id list, where this is inference, and it is routinely more
            // complete — Suisui's clause names two skills and the name matcher
            // reaches only one of them.
            if (matched.length && effect.scopeSource !== 'configdb') {
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
            const state = stateInClause(clause, stateNames);
            if (state && effect.trigger?.type !== 'stateEnter') {
                effect.trigger = { type: 'stateEnter', state };
                effect.window = { type: 'stateBound', state };
                effect.structuralTrigger = { type: 'inState', state };
            }
        }
    }
    return { bound, dropped };
}
