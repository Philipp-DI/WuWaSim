// tools/preprocess/effects.mjs — chain/inherent effect parsing (trigger × window), resonance modes, role tags.
// Split from the monolithic preprocess.mjs (Simplification Plan S4.1);
// bodies moved verbatim — LOCK A (byte-identical wuwa-data.json) verifies.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modesForResonator } from '../resonance-modes.js';
import { applyEffectOverrides } from '../effect-overrides.js';
import { STATUS_KEYS, statusSpaceForm } from '../../src/core/enemy-status.js';
import { isTeamWideBuff } from '../../src/core/buffs.js';
import { ELEMENT_NAME_TO_ID } from './constants.mjs';
import { substituteParams } from './text.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SKILL_PHRASE_TO_TYPE = [
    [/basic\s+attack/i,         'basic'],
    [/heavy\s+attack/i,         'heavy'],
    [/resonance\s+skill/i,      'skill'],
    [/resonance\s+liberation/i, 'liberation'],
    [/forte\s+circuit/i,        'forte'],
    [/intro\s+skill/i,          'intro'],
    [/outro\s+skill/i,          'outro'],
];

// Deliberately NOT in the map above: 'tuneBreak'. That map is read by BOTH
// extractStructuralTrigger (which wants the TRIGGER's category) and
// detectSkillType (which wants the effect's SCOPE), and for a Tune Break the
// two are opposites — "After a Resonator in the team deals Tune Break DMG,
// all Resonators in the team deal 20% more DMG" is TRIGGERED by a Tune Break
// and applies to EVERYTHING. Listing it scoped Luuk Herssen's S4 to the one
// step type it is never meant to buff. The trigger reads it from its own
// branch in extractStructuralTrigger instead.

// Detect whether an effect is unconditional (always-on passive) vs conditional.
// Triggers: explicit conditions OR a duration ("for Ns") which implies a
// temporary buff window the user opts into.
export const CONDITION_RE = /\b(?:when|after|while|if|upon|during|every|once)\b|for\s+[\d.]+\s*s\b/i;

// Finer classification of *how* an effect is conditional, used to decide:
//   - whether the build page shows an "assume active" toggle, and its default
//   - whether the team simulator can auto-resolve the condition structurally
//
// conditionKind values:
//   'unconditional' — no trigger; always active once the node is unlocked.
//                     NO toggle on the build page (shown as a static badge).
//   'structural'    — "after casting X" / "while in Y state": resolvable from
//                     rotation order + state windows by the team simulator.
//   'duration'      — "for Ns": a timed buff window. High realistic uptime →
//                     build page toggle defaults ON.
//   'situational'   — depends on un-modeled combat state ("when HP<x", "when
//                     target has Z"). Build page toggle defaults OFF; team sim
//                     leaves OFF unless the user overrides.
//   'other'         — mechanic-specific gating we can't classify further;
//                     treated like 'situational' (default OFF, toggleable).
// `deals Tune Break DMG` is a cast trigger too: the game never says "casting"
// for a Tune Break, so without it the kits that react to one classify as plain
// 'duration' and their trigger resolves to `unknown` — which is where Luuk
// Herssen's S4 team buff was sitting.
export const COND_STRUCTURAL_RE  = /after\s+(?:casting|using)|upon\s+(?:casting|using)|while\s+in\b|deals?\s+tune\s+break\s+dmg/i;

export const COND_DURATION_RE    = /for\s+[\d.]+\s*s\b/i;

export const COND_SITUATIONAL_RE = /when.*(?:HP|health|enemy|target|below|above|exceed|not\s+in)|if.*(?:HP|health|enemy)/i;

// Broader: covers "each stack increases", "per stack", "every N stacks" (P10-3).
export const COND_STACK_RE       = /\beach\s+stack[s]?\b|per\s+stack[s]?\b|for\s+each\s+stack|every\s+\d+\s+stack[s]?/i;

// Captures N in "stacking up to N time(s)" or "up to N stacks".
export const MAX_STACKS_RE       = /(?:stacking\s+)?up\s+to\s+(\d+)\s+(?:time[s]?|stack[s]?)/i;

// Captures N in "The max stack of [Crown of Wills] is increased to N" — a chain
// node RAISING an existing cap rather than declaring one (Augusta S1).
export const MAX_STACKS_ALT_RE   = /max\s+stack[s]?\s+(?:of\s+[^.]{0,40}?\s+)?is\s+increased\s+to\s+(\d+)/i;

// The sentence that GRANTS a stack, as opposed to the one that states its per-
// stack value: "gain 1 stack of Sky Blue", "Jinhsi gains one stack of …",
// "1 stack of Fated End is inflicted on the target". Must name a stack, so a
// generic "gains 20% ATK" clause never qualifies.
export const STACK_GAIN_RE       = /\b(?:gains?|obtains?|grants?|acquires?)\s+(?:\d+|a|one|another)?\s*stack(?:\(s\))?[s]?\s+of\b|\b\d+\s+stack[s]?\s+of\s+[^.]{0,60}?\s+is\s+inflicted\b/i;

// The wielder is not the actor: the stack comes from TEAMMATES acting
// (Sigrika's Blessing of Runes, Hiyuki's Snow Rust). Those are team-composition
// counters, not the wielder's own casts — never resolve them as a self trigger.
export const TEAM_ACTOR_RE       = /\b(?:resonators?|characters?|members?)\s+in\s+the\s+team\b|\bteam\s+members?\b|\bnearby\s+resonators?\b/i;

// Cast/action-gerund triggers ("Casting X …", "Performing X …") that CONDITION_RE
// (after/upon/while/when/…) does not catch on its own.
export const CAST_TRIGGER_RE     = /\b(?:casting|performing|unleashing|releasing)\b/i;

// Resonance-Mode / state gating (resolved per RESONANCE-MODE-SPEC.md, not here).
export const COND_MODE_RE        = /resonance\s+mode|instant\s+response|combat\s+state/i;

// Any mention of stacks marks a stack-gated clause (broader than COND_STACK_RE,
// which is specifically for emitting stackable metadata): "with N stacks", etc.
export const STACK_PRESENCE_RE   = /\bstack[s]?\b/i;

// Classify a clause's condition — PER CLAUSE, on its own text only.
//
// A clause is unconditional unless IT carries a trigger/condition: a
// CONDITION_RE keyword (when/after/while/if/upon/during/every/once/"for Ns"),
// a cast gerund (Casting/Performing X), Resonance-Mode/state gating, or stacks.
// We deliberately do NOT inherit a sibling clause's condition: an independent
// "The DMG Multiplier of X is increased by N%" sentence is unconditional even
// when a neighbouring sentence is gated (the Aemeath S2/S3 bug — P11-ADDENDUM
// §A2/§A3). Genuinely ambiguous cases get an effect-overrides.json entry rather
// than a looser parser that mislabels real conditionals.
export function classifyCondition(clause) {
    const conditional = CONDITION_RE.test(clause)
        || CAST_TRIGGER_RE.test(clause)
        || COND_MODE_RE.test(clause)
        || STACK_PRESENCE_RE.test(clause);
    if (!conditional) return 'unconditional';
    if (COND_STACK_RE.test(clause))       return 'situational';   // per-stack (stackable metadata emitted separately)
    if (COND_STRUCTURAL_RE.test(clause))  return 'structural';    // after casting X / while in Y
    if (COND_MODE_RE.test(clause))        return 'situational';   // Resonance Mode / state — trigger unknown until RESONANCE-MODE-SPEC
    if (COND_SITUATIONAL_RE.test(clause)) return 'situational';
    if (COND_DURATION_RE.test(clause))    return 'duration';
    return 'other';
}

// Extract a structural trigger descriptor from a clause, for the team sim's
// auto-resolver. Returns { type, skillType?|state? } or null.
//   "after casting Resonance Liberation" → { type:'afterCast', skillType:'liberation' }
//   "while in Twilight Tango"            → { type:'inState', state:'twilight tango' }
export function extractStructuralTrigger(clause) {
    // Checked first: the Tune Break form names its own ACTOR ("a Resonator in
    // the team"), which the generic afterCast branch would read as the skill.
    if (/deals?\s+tune\s+break\s+dmg/i.test(clause)) {
        return { type: 'afterCast', skillType: 'tuneBreak' };
    }
    const after = clause.match(/(?:after|upon)\s+(?:casting|using)\s+([^.,;]+)/i);
    if (after) {
        const phrase = after[1];
        for (const [re_, type] of SKILL_PHRASE_TO_TYPE) if (re_.test(phrase)) return { type: 'afterCast', skillType: type };
        return { type: 'afterCast', skillType: null, phrase: phrase.trim().slice(0, 40) };
    }
    const inState = clause.match(/while\s+in\s+(?:the\s+)?([^.,;]+?)(?:\s+state)?[.,;]/i);
    if (inState) return { type: 'inState', state: inState[1].trim().toLowerCase().slice(0, 40) };
    return null;
}

// ── Desc-scoped stack metadata (2026-07-31) ──────────────────────────────────
// The game authors a stack's CAP and its GAIN TRIGGER in the sentence that
// grants the stack, while the per-stack VALUE lives in a later "Each stack …"
// sentence:
//
//   "When casting Resonance Skill Antique Appraisal, gain 1 stack of Sky Blue,
//    stackable up to 4 times, lasting for 7s. Each stack increases Youhu's
//    Crit. DMG by 15%."
//
// Reading either from the value clause alone loses both — which is why 11 of 14
// stackable effects parsed with `maxStacks: null` and 13 with an `unknown`
// stackTrigger. These two helpers look across the WHOLE description; both
// refuse to guess when the description is ambiguous, since a wrong cap silently
// scales a buff (Lynae is 55% per stack).

/**
 * The stack cap stated anywhere in a description, or null.
 * Ambiguity (two different caps in one description) returns null rather than
 * picking one — no description in the current dataset is ambiguous, and a
 * future one that is should surface as unknown, not as a guess.
 *
 * @param {string[]} clauses — the description's clauses, as split by the caller
 * @returns {number|null}
 */
export function descStackCap(clauses) {
    for (const pattern of [MAX_STACKS_RE, MAX_STACKS_ALT_RE]) {
        const found = new Set();
        for (const clause of clauses) {
            const match = clause.match(pattern);
            if (match) found.add(parseInt(match[1], 10));
        }
        if (found.size === 1) return [...found][0];
        if (found.size > 1) return null;      // ambiguous — never pick one
    }
    return null;
}

/**
 * The stack GAIN trigger stated anywhere in a description, as a castMatch
 * skillType, or null. Deliberately strict — it accepts only the case where the
 * wielder's OWN cast of ONE identifiable skill type grants the stack:
 *
 *   - exactly one granting clause (Lynae states two income rates → null)
 *   - it reads as a cast ("when casting X" / "after casting X")
 *   - exactly one skill phrase in it (Galbrena lists eleven → null)
 *   - the actor is not the team (Sigrika's teammates cast it → null)
 *
 * Everything it rejects is a real stack source the sim cannot yet derive; those
 * keep `{ type: 'unknown' }` and surface as stacks-unknown downstream.
 *
 * @param {string[]} clauses
 * @returns {{ skillType: string, seconds: number|null }|null}
 */
export function descStackGain(clauses) {
    const granting = clauses.filter(clause => STACK_GAIN_RE.test(clause) && !COND_STACK_RE.test(clause));
    if (granting.length !== 1) return null;
    const clause = granting[0];
    if (TEAM_ACTOR_RE.test(clause)) return null;
    if (!CAST_TRIGGER_RE.test(clause) && !COND_STRUCTURAL_RE.test(clause)) return null;
    const types = new Set();
    for (const [phrase, type] of SKILL_PHRASE_TO_TYPE) if (phrase.test(clause)) types.add(type);
    if (types.size !== 1) return null;
    return { skillType: [...types][0], seconds: extractDurationSeconds(clause) };
}

// Default "assume active" value for the build page, by condition kind.
//   unconditional → always active (no toggle anyway)
//   duration      → ON  (high realistic uptime in a damage window)
//   structural    → ON  (the rotation typically satisfies it)
//   situational   → OFF (depends on un-modeled state)
//   other         → OFF (unknown gating, conservative)
export function defaultAssumeFor(kind) {
    return kind === 'unconditional' || kind === 'duration' || kind === 'structural';
}

// ── Unified trigger × window taxonomy (P11 §A) ───────────────────────────────
// Every effect reduces to a `trigger` (what turns it on) and a `window` (how
// long it stays on). The step-aware sim resolver (P11 §A4.2) reads these:
//   trigger: { type:'none' }                       — unconditional
//            { type:'castMatch', skillType, phrase} — a skill (type/phrase) is cast
//            { type:'stateEnter', state }           — a character state becomes active
//            { type:'unknown' }                     — unextractable → resolves OFF
//   window:  { type:'always' }                      — always on once unlocked
//            { type:'persist' }                     — until end of rotation, from trigger
//            { type:'seconds', seconds:N }          — N seconds from trigger
//            { type:'stateBound', state }           — while the state is active
// These are ADDITIVE; the legacy conditionKind/structuralTrigger/defaultAssume
// fields are retained during the transition (A4.1).
export function extractDurationSeconds(clause) {
    const match = clause.match(/for\s+([\d.]+)\s*s\b/i);
    return match ? parseFloat(match[1]) : null;
}

export function deriveTriggerWindow(condKind, structuralTrigger, clause, durationSeconds) {
    if (condKind === 'unconditional') {
        return { trigger: { type: 'none' }, window: { type: 'always' } };
    }
    if (condKind === 'structural' && structuralTrigger) {
        if (structuralTrigger.type === 'afterCast') {
            return {
                trigger: { type: 'castMatch', skillType: structuralTrigger.skillType ?? null,
                           phrase: structuralTrigger.phrase ?? null },
                window:  durationSeconds != null ? { type: 'seconds', seconds: durationSeconds }
                                                 : { type: 'persist' },
            };
        }
        if (structuralTrigger.type === 'inState') {
            return {
                trigger: { type: 'stateEnter', state: structuralTrigger.state },
                window:  { type: 'stateBound', state: structuralTrigger.state },
            };
        }
    }
    if (condKind === 'duration') {
        // A timed buff granted by a cast; recover the granting skill phrase.
        const skillType = detectSkillType(clause);
        return {
            trigger: skillType ? { type: 'castMatch', skillType: skillType } : { type: 'unknown' },
            window:  durationSeconds != null ? { type: 'seconds', seconds: durationSeconds }
                                             : { type: 'persist' },
        };
    }
    // situational / other → unknown trigger (conservatively OFF in the sim).
    return {
        trigger: { type: 'unknown' },
        window:  durationSeconds != null ? { type: 'seconds', seconds: durationSeconds } : { type: 'persist' },
    };
}

export function detectSkillType(text) {
    for (const [re_, type] of SKILL_PHRASE_TO_TYPE) if (re_.test(text)) return type;
    return null;
}

export function detectElement(text) {
    const match = text.match(/\b(Glacio|Fusion|Electro|Aero|Spectro|Havoc)\b/i);
    return match ? ELEMENT_NAME_TO_ID[match[1].toLowerCase()] : null;
}

// Parse a clause like "...increases X by 15%..." → numeric fraction.
// Returns the FIRST percentage found near the effect keyword.
export function pctNear(text, keywordRe) {
    // Find keyword position, then look for the nearest % value after it
    const match = text.match(keywordRe);
    if (!match) return null;
    const after = text.slice(match.index);
    const pctM = after.match(/([\d.]+)\s*%/);
    return pctM ? parseFloat(pctM[1]) / 100 : null;
}

/**
 * The game's other word order, where the value PRECEDES its keyword:
 *
 *   "Heavy Attack - Aemeath and Heavy Attack - Mech gain 200% DMG Amplification"
 *   "…gain 300% Crit. DMG increase"
 *
 * `pctNear` only ever looks forward, so both of those read as no value at all
 * and the clause parsed to nothing. Deliberately narrow: only the "<subject>
 * gains N% <stat>" shape, so a clause that merely mentions a percentage earlier
 * in the sentence can never be read as this one. Used strictly as a FALLBACK,
 * so a clause the forward form already reads is untouched.
 */
export function pctGained(text, keywordSource) {
    const match = text.match(new RegExp(String.raw`\bgains?\s+([\d.]+)\s*%\s*${keywordSource}`, 'i'));
    return match ? parseFloat(match[1]) / 100 : null;
}

// A NEGATIVE STATUS's damage does not crit. It runs on its own formula
// (src/core/enemy-status.js) which has no crit term at all, and no amount of
// Crit Rate on the wielder gives it one. A kit may grant it explicitly — and
// when it does, the numbers are FIXED, replacing the wielder's crit rather
// than adding to it:
//
//   "Aemeath's Tune Rupture DMG can critically hit, with a fixed Crit. Rate of
//    80%, and fixed Crit. DMG of 275%."   (S6, once per Resonance Mode)
//
// Read as ordinary critRate/critDmg those put +80%/+275% on every hit she
// landed and pushed the build past the Crit Rate cap, which is exactly
// backwards. Recognised from the shared status vocabulary (STATUS_KEYS) rather
// than a per-character rule, so any kit using the game's standard phrasing
// lands on the affliction lane automatically.
const CRITS_EXPLICITLY_RE = /can\s+critically\s+hit/i;
const STATUS_DMG_RES = STATUS_KEYS.map(key => new RegExp(`${statusSpaceForm(key)}\\s+DMG`, 'i'));

function afflictionCritClause(clause) {
    return CRITS_EXPLICITLY_RE.test(clause) && STATUS_DMG_RES.some(pattern => pattern.test(clause));
}

// "Targets take 40% more Resonance Liberation DMG from Aemeath." — the same
// DMG-amplification bucket as an `amplify` clause, phrased from the TARGET's
// side, which is why a branch keyed on the word "amplif" never saw it. Six such
// clauses exist roster-wide and all six parsed to nothing.
//
// SCOPE comes from the actor named after "from": the clause only covers that
// actor's damage. Emitted when it names the resonator herself, or names nobody
// (then it is her own damage by context). A clause crediting only a summon or an
// alternate form — Cartethyia's "The targets take 40% more DMG from Fleurdelys"
// — is SKIPPED rather than spread across all her damage, which would overstate
// every hit she lands outside that form. Stack-gated variants still resolve OFF
// on their own, via the stack-presence rule in classifyCondition.
const DMG_TAKEN_RE = /\btakes?\s+(?:an\s+additional\s+)?([\d.]+)\s*%\s*more\s+([^.]*?)\bDMG\b/i;
const DMG_TAKEN_ACTOR_RE = /\bDMG\s+from\s+([^.,;]+)/i;

export function dmgTakenEffect(clause, resonatorName) {
    const match = clause.match(DMG_TAKEN_RE);
    if (!match) return null;
    const actor = clause.match(DMG_TAKEN_ACTOR_RE)?.[1] ?? null;
    if (actor && resonatorName && !actor.toLowerCase().includes(resonatorName.toLowerCase())) return null;
    const value = parseFloat(match[1]) / 100;
    if (!(value > 0) || value >= 3) return null;
    const scope = match[2];
    return { stat: 'amplify', value, element: detectElement(scope), skillType: detectSkillType(scope) };
}

/**
 * Parse structured buff effects from a chain/inherent description.
 * @param {string} desc   — param-substituted, tag-stripped description text
 * @param {string} ownerLabel — for the condition string (e.g. "S2", skill name)
 * @returns {Array<object>} effects (may be empty)
 */
export function parseEffectsFromDesc(desc, resonatorName = null) {
    if (!desc) return [];
    const effects = [];

    // Split into sentences/clauses to scope element/skillType detection locally.
    // Protect abbreviation periods ("Crit.", "ResO.", etc.) from being treated
    // as sentence boundaries by temporarily masking them.
    const masked = desc
        .replace(/Crit\./gi, 'Crit\u0001')
        .replace(/Max\./gi, 'Max\u0001')
        .replace(/Res\./gi, 'Res\u0001');
    const clauses = masked.split(/(?<=[.;])\s+|\n+/)
        .map(clause => clause.replace(/\u0001/g, '.').trim())
        .filter(Boolean);

    // Stack cap and gain trigger are description-scoped, not clause-scoped —
    // see descStackCap/descStackGain. A clause that states its own cap still
    // wins; these only fill in what the value clause never carried.
    const descCap  = descStackCap(clauses);
    const descGain = descStackGain(clauses);

    for (const clause of clauses) {
        const elem      = detectElement(clause);
        const skillType = detectSkillType(clause);
        const condKind  = classifyCondition(clause);
        const structuralTrigger = condKind === 'structural' ? extractStructuralTrigger(clause) : null;
        const defaultAssume = defaultAssumeFor(condKind);

        // Helper: attach the full condition metadata to every emitted effect.
        //   conditionKind   — unconditional | structural | duration | situational | other
        //   structuralTrigger — for the team sim auto-resolver (afterCast / inState)
        //   defaultAssume   — build-page "assume active" default (unconditional always true)
        // Detect per-stack patterns (P10-3): emit stackable metadata so the UI
        // can show a stepper instead of a checkbox and the resolver can scale.
        const isPerStack = COND_STACK_RE.test(clause);
        const maxStacksMatch = isPerStack ? clause.match(MAX_STACKS_RE) : null;

        // Unified trigger × window (P11 §A) — additive alongside the legacy fields.
        const durationSeconds = extractDurationSeconds(clause);
        const { trigger, window } = deriveTriggerWindow(condKind, structuralTrigger, clause, durationSeconds);
        // A stackable effect accrues a stack each time its stacking trigger
        // fires. In the common case that is the effect's own trigger; failing
        // that, the description's granting clause (descStackGain); failing both,
        // unknown — the resolver then reports the count as underivable rather
        // than silently picking one.
        const ownStackTrigger = trigger.type === 'castMatch' || trigger.type === 'stateEnter' ? trigger : null;
        const stackTrigger = !isPerStack ? undefined
            : ownStackTrigger ?? (descGain
                ? { type: 'castMatch', skillType: descGain.skillType, phrase: null }
                : { type: 'unknown' });
        // How long ONE stack lives, so the sim can decay a stack count instead
        // of treating every past cast as still standing. Stated on whichever
        // clause carries it — the granting one ("lasting for 7s") or the value
        // one ("stacking up to 2 time(s) and lasting for 20s").
        const stackSeconds = isPerStack ? (durationSeconds ?? descGain?.seconds ?? null) : null;

        // The stored `condition` is truncated for DISPLAY, and the recipient
        // phrase is usually the LAST thing a grant sentence says — so deciding
        // team-wideness from it downstream silently mis-scoped 5 effects to
        // self-only, including two of Verina's. Decide it HERE, where the whole
        // clause is still in hand, and store the answer.
        const push = (effect) => effects.push({
            ...effect,
            teamWide:        isTeamWideBuff(clause),
            condition:       clause.trim().slice(0, 120),
            conditionKind:   condKind,
            structuralTrigger,
            defaultAssume,
            // Back-compat: `defaultActive` retained == "applies with no user action".
            // Unconditional effects are always active; conditional effects follow
            // their assume-default. Consumers that predate conditionKind still work.
            defaultActive:   condKind === 'unconditional' ? true : defaultAssume,
            // P11 §A unified taxonomy (additive; step-aware resolver reads these).
            trigger,
            window,
            ...(durationSeconds != null ? { durationSeconds } : {}),
            // Stackable metadata: only present when per-stack patterns are detected.
            ...(isPerStack ? {
                stackable: true,
                perStack:  effect.value,
                maxStacks: maxStacksMatch ? parseInt(maxStacksMatch[1], 10) : descCap,
                stackTrigger,
                ...(stackSeconds != null ? { stackSeconds } : {}),
            } : {}),
        });

        // Which crit LANE this clause is talking about — the wielder's own
        // stats, or a negative status's separate damage formula (see below).
        const critLane = afflictionCritClause(clause);
        // — Crit Rate —
        if (/Crit\.?\s*Rate/i.test(clause)) {
            const value = pctNear(clause, /Crit\.?\s*Rate/i);
            if (value != null && value > 0 && value < 2) {
                push({ stat: critLane ? 'afflictionCritRate' : 'critRate', value: value, element: null, skillType: null });
            }
        }
        // — Crit DMG —
        if (/Crit\.?\s*DMG/i.test(clause)) {
            const value = pctNear(clause, /Crit\.?\s*DMG/i)
                ?? pctGained(clause, String.raw`Crit\.?\s*DMG`);   // "gain 300% Crit. DMG increase"
            if (value != null && value > 0 && value < 5) {
                push({ stat: critLane ? 'afflictionCritDmg' : 'critDmg', value: value, element: null, skillType: null });
            }
        }
        // — ALL-ATTRIBUTE DMG Bonus (e.g. "gain 20% All-Attribute DMG Bonus for 30s") —
        // The game's phrase for a bonus scoped to NOTHING: every element, every
        // skill type. It has to be tested BEFORE the two scoped branches and to
        // exclude them, because the sentence that grants it usually also names
        // the casts that trigger it ("When casting … Resonance Skill Seraphic
        // Duet, Resonators in the team gain 20% All-Attribute DMG Bonus"), and
        // `detectSkillType` reads 'skill' out of that trigger list — which would
        // shrink a bonus on EVERYTHING down to one category. Aemeath S4, Chisa,
        // Galbrena, Rebecca and Lucy all state it; none of them parsed at all
        // before, because neither scoped branch matches an unscoped bonus.
        const allAttribute = /All[-\s]?Attribute\s+DMG\s*Bonus/i.test(clause);
        if (allAttribute) {
            const value = pctNear(clause, /All[-\s]?Attribute\s+DMG\s*Bonus/i)
                ?? pctNear(clause, /gains?|increased?/i);
            if (value != null && value > 0 && value < 3) push({ stat: 'dmgBonus', value: value, element: null, skillType: null });
        }
        // — Element-specific DMG Bonus (e.g. "Glacio DMG Bonus by 15%") —
        else if (elem != null && /DMG\s*Bonus/i.test(clause)) {
            const value = pctNear(clause, /DMG\s*Bonus/i);
            if (value != null && value > 0 && value < 3) push({ stat: 'elementBonus', value: value, element: elem, skillType: null });
        }
        // — Skill-type DMG Bonus (e.g. "Resonance Skill DMG Bonus is increased by 30%") —
        else if (skillType != null && /DMG\s*Bonus/i.test(clause)) {
            const value = pctNear(clause, /DMG\s*Bonus/i);
            if (value != null && value > 0 && value < 3) push({ stat: 'skillTypeBonus', value: value, element: null, skillType });
        }
        // — DMG Multiplier increase (e.g. "DMG Multiplier of Fatal Finale is increased by 126%") —
        // Must explicitly mention "DMG Multiplier" — excludes "Healing multiplier" etc.
        if (/DMG\s*Multiplier/i.test(clause) && /increased?\s+by\s+[\d.]+\s*%/i.test(clause)) {
            const value = pctNear(clause, /increased?\s+by/i);
            if (value != null && value > 0) push({ stat: 'multiplierUp', value: value, element: null, skillType: detectSkillType(clause) });
        }
        // — ATK% buff (e.g. "ATK is increased by 10%") —
        if (/\bATK\b.*(?:increased?|by)/i.test(clause) && !/DMG/i.test(clause.split(/\bATK\b/)[0] ?? '')) {
            const value = pctNear(clause, /ATK/i);
            if (value != null && value > 0 && value < 2) push({ stat: 'atkRatio', value: value, element: null, skillType: null });
        }
        // — DMG taken (the target's side of the amplify bucket) —
        const taken = dmgTakenEffect(clause, resonatorName);
        if (taken) push(taken);
        // — Amplify / Deepen (DMG taken/dealt amplified) —
        // Read in order of specificity. The bare "by" is a last resort and was
        // reading the WRONG number wherever a clause states two effects at once:
        // Aemeath S3's "Crit. DMG is increased by 60%, and … Finale DMG is now
        // Amplified by 25%" gave the amplify 60% — the crit's value — because
        // "by" matches the earlier phrase first.
        if (/amplif/i.test(clause)) {
            const value = pctNear(clause, /amplif\w*\s+(?:to|by)/i)
                ?? pctGained(clause, String.raw`DMG\s*Amplification`)
                ?? pctNear(clause, /by/i);
            if (value != null && value > 0 && value < 3) push({ stat: 'amplify', value: value, element: elem, skillType });
        }
        // — "X deals N% more DMG" (the DEALER's side of the amplify bucket) —
        // The mirror of dmgTakenEffect's "Targets take N% more DMG from X",
        // which is the same mechanic phrased from the target's side. Eight
        // clauses roster-wide state it and NONE of them parsed at all: no
        // "amplif" for the amplify branch, no "DMG Bonus" for the bonus ones.
        // Six name their own skills and are scoped by skill-scope.mjs; the two
        // that do not are Luuk Herssen's, and his S4 is the only team-wide
        // effect any Tune Break grants.
        const dealsMore = /deals?\s+([\d.]+)%\s+more\s+DMG/i.exec(clause);
        if (dealsMore) {
            const value = parseFloat(dealsMore[1]) / 100;
            // Bounded looser than the other amplify branch on purpose: Mornye's
            // S6 states 400%, and it is stated, not inferred.
            // `needsScope` is stripped by skill-scope.mjs, which DROPS the effect
            // unless the clause either names the skills it applies to or grants to
            // the whole team. Both unscoped survivors would otherwise be
            // catastrophic: this phrasing carries its condition in prose the clause
            // classifier does not read ("to targets whose HP is below 50%"), so
            // Chixia's +40% and Mornye's +400% would land on every hit, always.
            if (value > 0 && value < 5) {
                push({ stat: 'amplify', value, element: elem, skillType, needsScope: true });
            }
        }
        // — Healing Bonus —
        if (/Healing\s*Bonus/i.test(clause)) {
            const value = pctNear(clause, /Healing\s*Bonus/i);
            if (value != null && value > 0 && value < 2) push({ stat: 'healingBonus', value: value, element: null, skillType: null });
        }
    }

    return effects;
}

// =============================================================================
// Resonance Mode tagging + effect-overrides merge (post-pass)
// RESONANCE-MODE-SPEC.md §2/§3 + PRE-P12-DATA-QUALITY.md §3. Runs after every
// resonator is projected.
// =============================================================================

// Tag effects whose condition text names one of this resonator's modes with a
// build-level `mode` gate. A mode-as-state misparse collapses into a clean
// modeMatch (active whenever in that mode); a real timed/cast window is kept so
// the mode composes with it (RESONANCE-MODE-SPEC.md §3).
export function tagModeGatedEffects(resonator, modes) {
    const tag = (effects) => {
        for (const effect of effects ?? []) {
            const cond = (effect.condition ?? '').toLowerCase();
            const hit = modes.find(mode => cond.includes(mode.name.toLowerCase()));
            if (!hit) continue;
            effect.mode = hit.key;
            const windowed = effect.trigger?.type === 'castMatch' && effect.window?.type === 'seconds';
            if (!windowed) {
                effect.trigger = { type: 'modeMatch', mode: hit.key };
                effect.window  = { type: 'always' };
            }
        }
    };
    for (const chainNode of resonator.resonanceChain ?? []) tag(chainNode.effects);
    for (const inherent of resonator.inherentSkills ?? []) tag(inherent.effects);
}

// In-game "Resonance Mode - X" branch description for one mode, read directly
// from the resonator's raw extracted-nanoka character JSON (independent of
// whether that resonator's stats were projected from Dimbreath or nanoka —
// Aemeath/Lynae are Dimbreath-projected but still have a nanoka JSON file on
// disk with this flavor text, so we read it directly rather than threading it
// through whichever projection pipeline happened to run).
export function loadModeBranchDescs(resonatorId) {
    const path = resolve(__dirname, '../../data/extracted-nanoka/characters', `${resonatorId}.json`);
    if (!existsSync(path)) return {};
    let nChar;
    try { nChar = JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
    const descs = {};
    for (const branch of Object.values(nChar.skill_branches ?? {})) {
        if (!/^Resonance Mode - /.test(branch.name ?? '')) continue;
        const rawDesc    = (branch.desc ?? '').replace(/<[^>]+>/g, '').trim();
        const withParams = substituteParams(rawDesc, branch.param ?? []);
        descs[branch.name] = withParams.replace(/\{[A-Za-z][^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    }
    return descs;
}

export function applyResonanceModesAndOverrides(resonators) {
    // 1. Project mode pairs + tag mode-gated effects.
    for (const resonator of resonators) {
        const modes = modesForResonator(resonator.id);
        if (modes.length === 0) continue;
        const branchDescs = loadModeBranchDescs(resonator.id);
        for (const mode of modes) {
            const desc = branchDescs[`Resonance Mode - ${mode.name}`];
            if (desc) mode.desc = desc;
        }
        resonator.resonanceModes = modes;
        tagModeGatedEffects(resonator, modes);
    }

    // 2. Surgical per-effect overrides (data/effect-overrides.json).
    let overrides = {};
    const ovPath = resolve(__dirname, '../../data/effect-overrides.json');
    if (existsSync(ovPath)) {
        try { overrides = JSON.parse(readFileSync(ovPath, 'utf8')).overrides ?? {}; }
        catch (error) { process.stderr.write(`  effect-overrides.json parse error: ${error.message}\n`); }
    }
    const overrideResult = applyEffectOverrides(resonators, overrides);
    const modeCount = resonators.filter(resonator => resonator.resonanceModes).length;
    process.stderr.write(`  resonance modes: ${modeCount} resonators; overrides: ${overrideResult.patched} patched, ${overrideResult.suppressed} suppressed, ${overrideResult.added} added${overrideResult.bad ? `, ${overrideResult.bad} BAD` : ''}\n`);
}

// =============================================================================
// Resonator role tags — the game's own in-game "role label" system, read
// directly from raw nanoka character JSON (`tag`), same discipline as
// loadModeBranchDescs above: no text-parsing, just reading an authoritative
// field. Each resonator carries 1-6 tags; icon paths group them into stable
// game-native buckets (RoleLabelA = core role, B = damage focus, C = utility,
// D = team amplification, E = negative-status specialist, G/H/I = Tune Break
// + misc). `category` below curates that grouping from the tags' own NAME
// text (classification of already-clean in-game labels, not kit prose).
// =============================================================================

export const ROLE_TAG_CATEGORY = {
    1: 'primary', 2: 'primary', 3: 'primary',                          // Support and Healer, Main Damage Dealer, Concerto Efficiency
    4: 'damageFocus', 5: 'damageFocus', 6: 'damageFocus', 7: 'damageFocus', 37: 'damageFocus',
    8: 'utility', 9: 'utility', 10: 'utility', 11: 'utility', 12: 'utility', 30: 'utility',
    13: 'amplify', 14: 'amplify', 15: 'amplify', 16: 'amplify', 17: 'amplify', 18: 'amplify',
    19: 'amplify', 20: 'amplify', 21: 'amplify', 22: 'amplify', 23: 'amplify', 31: 'amplify', 32: 'amplify',
    24: 'negativeStatus', 25: 'negativeStatus', 26: 'negativeStatus', 27: 'negativeStatus', 28: 'negativeStatus', 29: 'negativeStatus',
    33: 'tuneBreak', 34: 'tuneBreak', 35: 'tuneBreak', 36: 'tuneBreak',
    // Tag id 38 intentionally uncategorized: the raw source has no name/desc
    // for it (blank in-game text) on the two resonators that carry it
    // (Rebecca, Lucy) — nothing to show, so applyResonatorRoles drops it.
};

export function loadCharacterTags(resonatorId) {
    const path = resolve(__dirname, '../../data/extracted-nanoka/characters', `${resonatorId}.json`);
    if (!existsSync(path)) return {};
    try { return JSON.parse(readFileSync(path, 'utf8')).tag ?? {}; }
    catch { return {}; }
}

// Projects `resonator.roles` from raw tag data and returns the deduped
// catalogue (one entry per distinct role id across the whole roster) for the
// dataset's top-level `roles` array.
export function applyResonatorRoles(resonators) {
    const catalogue = new Map();
    let uncategorized = 0;
    for (const resonator of resonators) {
        const raw = loadCharacterTags(resonator.id);
        resonator.roles = Object.keys(raw)
            .map(Number)
            .filter(id => {
                if (!raw[id]?.name) return false;
                if (!ROLE_TAG_CATEGORY[id]) { uncategorized++; return false; }
                return true;
            })
            .sort((idA, idB) => idA - idB)
            .map(id => {
                const entry = raw[id];
                const role = { id, name: entry.name, desc: entry.desc ?? '', color: entry.color ?? '', category: ROLE_TAG_CATEGORY[id] };
                if (!catalogue.has(id)) catalogue.set(id, role);
                return role;
            });
    }
    if (uncategorized) process.stderr.write(`  WARNING: ${uncategorized} role-tag instance(s) found with no ROLE_TAG_CATEGORY entry — add them to preprocess.mjs\n`);
    return [...catalogue.values()].sort((entryA, entryB) => entryA.id - entryB.id);
}
