// src/core/sonata-buffs.js
/**
 * Sonata conditional buff parser.
 *
 * Phase 6 extracted sonata tiers with `addProp[]` (always-active) +
 * `buffIds[]` (conditional) + the effect text. This module parses the
 * conditional effects into a structured form so Phase 7's uptime bars
 * can visualize them.
 *
 * Coverage: 5pc effects with the common "X DMG +Y% for Zs after <trigger>"
 * pattern. Phase 8+ work: 3pc effects, healing-on-X effects, party-buff
 * effects, and the full BuffEffect.json table for precise mechanics.
 *
 *   parseSonataBuffs(tier) -> ParsedBuff[]
 *
 * ParsedBuff shape:
 *   {
 *     trigger:  'basic' | 'heavy' | 'skill' | 'liberation' | 'intro' | 'outro' | 'healing' | 'unknown',
 *     duration: number (seconds),
 *     bonusPct: number (0..1 fraction, e.g. 0.10 for +10%),
 *     bonusKind:'element' | 'atk' | 'unknown',
 *     element:  number | null  (1=Glacio, 2=Fusion, ..., 6=Havoc)
 *     dmgType:  'basic'|'heavy'|'skill'|'liberation'|'echo'|'intro'|'outro'|null
 *               — set when the buff targets a specific damage-type's DMG%
 *               (e.g. "Heavy Attack DMG +25%"), independent of `trigger`
 *               (which is the *activation* condition, not the boosted type).
 *     stacks:   number  (default 1)
 *     raw:      string  (original effect text, for tooltip display)
 *   }
 *
 * Returns [] when the tier isn't conditional or the pattern doesn't match.
 */

// =============================================================================
// Lookups
// =============================================================================

const ELEMENT_NAMES = {
    'glacio':   1,
    'fusion':   2,
    'electro':  3,
    'aero':     4,
    'spectro':  5,
    'havoc':    6,
};

const TRIGGER_PATTERNS = [
    // Order matters: longer/specific phrases first
    { trigger: 'intro',      re: /\bintro\s+skill\b/i },
    { trigger: 'outro',      re: /\boutro\s+skill\b/i },
    { trigger: 'liberation', re: /\bresonance\s+liberation\b/i },
    { trigger: 'skill',      re: /\bresonance\s+skill\b/i },
    { trigger: 'heavy',      re: /\bheavy\s+attack\b/i },
    { trigger: 'basic',      re: /\bbasic\s+attack\b/i },
    { trigger: 'healing',    re: /\bhealing\b/i },
];

// =============================================================================
// Public entry
// =============================================================================

/**
 * Parse one sonata tier's conditional buffs. Returns [] when the tier
 * has no conditional component (i.e., it's a 2pc with only AddProp).
 */
export function parseSonataBuffs(tier) {
    if (!tier || !Array.isArray(tier.buffIds) || tier.buffIds.length === 0) return [];
    const text = (tier.effect || '').trim();
    if (!text) return [];

    // Some tiers may have multiple "after X" clauses with different triggers.
    // We handle the common case (one trigger) and emit one ParsedBuff per
    // matching trigger phrase found.
    const triggers = findAllTriggers(text);
    if (triggers.length === 0) {
        return [{
            trigger:   'unknown',
            duration:  parseDurationSeconds(text) ?? 15,
            bonusPct:  parseBonusPct(text) ?? 0,
            bonusKind: detectBonusKind(text),
            element:   detectElement(text),
            dmgType:   detectDamageType(text),
            stacks:    parseStacks(text),
            raw:       text,
        }];
    }

    const duration  = parseDurationSeconds(text) ?? 15;
    const bonusPct  = parseBonusPct(text) ?? 0;
    const bonusKind = detectBonusKind(text);
    const element   = detectElement(text);
    const dmgType   = detectDamageType(text);
    const stacks    = parseStacks(text);

    return triggers.map(trigger => ({
        trigger, duration, bonusPct, bonusKind, element, dmgType, stacks, raw: text,
    }));
}

// =============================================================================
// Sub-parsers
// =============================================================================

// All unique triggers mentioned (in case the effect says "after Basic OR Heavy Attack")
function findAllTriggers(text) {
    const found = new Set();
    for (const { trigger, re } of TRIGGER_PATTERNS) {
        if (re.test(text)) found.add(trigger);
    }
    return [...found];
}

// "for 15s", "lasts 15s", "for 30 seconds" — extract the number.
function parseDurationSeconds(text) {
    const m = text.match(/(?:for|lasts?)\s+(\d+(?:\.\d+)?)\s*s\b/i)
            || text.match(/(\d+(?:\.\d+)?)\s*s\s+after/i);
    return m ? Number(m[1]) : null;
}

// "DMG + 10%", "+ 30%", "by 22.5%" — return the EARLIEST percentage
// mentioned. This favors the headline buff over follow-up numbers like
// healing amounts or party-buff percentages.
function parseBonusPct(text) {
    // Match either "+X%" or "by X%" — capture both patterns
    const matches = [...text.matchAll(/(?:\+\s*|by\s+)(\d+(?:\.\d+)?)\s*%/gi)];
    if (matches.length === 0) return null;
    return Number(matches[0][1]) / 100;
}

// "stacks up to 3 times" -> 3.
function parseStacks(text) {
    const m = text.match(/stacks?\s+up\s+to\s+(\d+)/i);
    return m ? Number(m[1]) : 1;
}

function detectBonusKind(text) {
    // Classify the stat that the FIRST bonus percentage refers to — the SAME
    // one parseBonusPct reads (earliest "+N%"/"by N%") — by looking ONLY at the
    // clause leading up to that number, never the whole text. This is what lets
    // ATK match the team-recipient "ATK ... by N%" phrasing ("increases the ATK
    // of all party members by 15%", previously dropped as 'unknown' and never
    // credited — 2026-07-14) WITHOUT a later unrelated "ATK by N%" clause
    // hijacking the kind of an earlier element/other bonus. Empyrean Anthem is
    // the trap: "Coordinated Attack DMG by 80% … the Resonator's ATK by 20%" —
    // the headline 80% is Coordinated-Attack DMG (an UNMODELED kind → 'unknown',
    // correctly dropped), not the +20% ATK a whole-text scan would latch onto.
    const anchor = text.match(/(?:\+\s*|by\s+)\d+(?:\.\d+)?\s*%/i);
    const scope = anchor ? text.slice(0, anchor.index) : text;
    if (/\b(glacio|fusion|electro|aero|spectro|havoc)\b\s+DMG/i.test(scope)) return 'element';
    if (/\bATK\b/i.test(scope)) return 'atk';
    return 'unknown';
}

function detectElement(text) {
    for (const [name, id] of Object.entries(ELEMENT_NAMES)) {
        if (new RegExp(`\\b${name}\\b`, 'i').test(text)) return id;
    }
    return null;
}

// "Heavy Attack DMG +25%" boosts heavy-attack damage specifically — distinct
// from `trigger` ("after a Heavy Attack"), which is the activation condition.
// Requires "DMG" immediately after the phrase so trigger-only mentions (no
// "DMG" following) don't false-positive.
const DAMAGE_TYPE_PATTERNS = [
    { type: 'liberation', re: /\bresonance\s+liberation\s+DMG\b/i },
    { type: 'skill',      re: /\bresonance\s+skill\s+DMG\b/i },
    { type: 'heavy',      re: /\bheavy\s+attack\s+DMG\b/i },
    { type: 'basic',      re: /\bbasic\s+attack\s+DMG\b/i },
    { type: 'intro',      re: /\bintro\s+skill\s+DMG\b/i },
    { type: 'outro',      re: /\boutro\s+skill\s+DMG\b/i },
    { type: 'echo',       re: /\becho\s+DMG\b/i },
];

// Is the FIRST bonus in this text scoped to the INCOMING / next resonator (an
// Outro→Intro handoff transfer, e.g. Moonlit Clouds "increases the ATK of the
// next Resonator by 22.5%"; Pact of Neonlight Leap), rather than the wielder?
// Those transfers are modeled separately (conditional-buffs.js
// incomingResonatorContribution) and must NOT also be applied to the WIELDER's
// own damage by the sonata window path (computeBuffWindows). Uses the same
// clause-local scope as detectBonusKind so a self/team clause with a SECONDARY
// incoming clause later (Chromatic Foam) isn't wrongly excluded. Introduced
// 2026-07-14 alongside the detectBonusKind broadening, which first exposed
// these ATK-carrying transfer sets (previously masked as 'unknown').
export function isIncomingResonatorBuff(text) {
    const s = String(text ?? '');
    const anchor = s.match(/(?:\+\s*|by\s+)\d+(?:\.\d+)?\s*%/i);
    const scope = anchor ? s.slice(0, anchor.index) : s;
    return /\b(?:incoming|next)\s+resonator\b/i.test(scope);
}

// Exported (not just for parseSonataBuffs) — buff-bar.js reuses this to
// classify buff-window strips whose only available text is the rendered
// label (the team-sim page never sees the structured ParsedBuff).
export function detectDamageType(text) {
    for (const { type, re } of DAMAGE_TYPE_PATTERNS) {
        if (re.test(text)) return type;
    }
    return null;
}

export const __test__ = { TRIGGER_PATTERNS, DAMAGE_TYPE_PATTERNS, parseDurationSeconds, parseBonusPct, parseStacks };
