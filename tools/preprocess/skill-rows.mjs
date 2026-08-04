// tools/preprocess/skill-rows.mjs — display-row classification, data-driven formula types, skill keys/labels, multiplier parsing.
// Split from the monolithic preprocess.mjs (Simplification Plan S4.1);
// bodies moved verbatim — LOCK A (byte-identical wuwa-data.json) verifies.

// ── Full projection from data/extracted-nanoka/characters/{id}.json ──────────
// This is used when a complete nanoka character file has been fetched.
// It provides: base stats at every level, skill multipliers, skill tree bonuses.
// =============================================================================
// Nanoka character skill data — classification, key generation, META linking
// =============================================================================
//
// Each row in a nanoka skill_tree node falls into one of three categories:
//   damage  — name contains "DMG" (but not a conditional modifier)
//   buff    — conditional DMG modifier ("Increase per", "Boost per", etc.)
//   meta    — resource/timing info (STA Cost, Cooldown, Concerto Regen, etc.)
//
// The category determines where it appears in the UI:
//   damage → rotation palette step + damage panel skill card
//   buff   → toggleable modifier on the skill card (with stack count)
//   meta   → info section below the relevant skill card

// =============================================================================
// Skill row classification
// =============================================================================
//
// Each row in a nanoka skill_tree node falls into one of five categories:
//   damage  — name contains "DMG" or "Damage" (the attack)
//   heal    — name contains "Heal" or "Healing"
//   shield  — name contains "Shield", "Absorb", or "Barrier" (not "Reduction")
//   buff    — conditional DMG modifier ("Increase per", "Boost per", etc.)
//   meta    — resource/timing info (Cooldown, Concerto Regen, etc.)
//
// The category determines how it flows through the pipeline:
//   damage  → rotation palette step + damage panel (red numbers)
//   heal    → support step on rotation + heal panel (green numbers)
//   shield  → support step on rotation + shield value (amber numbers)
//   buff    → toggleable modifier on the skill card
//   meta    → info section below the relevant skill card

export const BUFF_PATTERNS = /\bIncrease per\b|\bBoost per\b|\bper Snowforged\b|\bper Stack\b|\bDMG Increase per\b/i;

export const META_SUFFIXES = [
    ' STA Cost', ' Stamina Cost', ' Cooldown', ' Concerto Regen',
    ' Resonance Cost', ' Cost per second', ' Energy Cost', ' Energy Regen', ' Regen',
    ' Duration', ' Stackmax', ' Range',
];

// Shield "Damage Reduction" rows are percentage modifiers, not HP values — skip.
export const SHIELD_EXCLUSION_RE = /Damage\s+Reduction|DMG\s+Reduction/i;

// A meta row is unprefixed ("Resonance Cost", bare) whenever the node has
// only ONE overall cost/cooldown/regen to report — the game only prefixes
// with a stage name ("Sword of Eternal Oath Resonance Cost") to disambiguate
// a MULTI-stage node. META_SUFFIXES carry a leading space for the prefixed
// form; `name.includes(s)` alone never matches a bare row (there's no
// character before the suffix to include the space), which silently dropped
// it to 'other' and skipped it entirely — roster-wide, since a bare
// "Resonance Cost"/"Cooldown"/"Concerto Regen" is the COMMON case, not an
// edge case (maintainer-confirmed 2026-07-12, found via Carlotta's
// mis-attributed Liberation cost). Trimmed-exact-equality catches the bare
// form; linkMetaToSteps's existing nodeLevel fallback already does the right
// thing once the row reaches it (attaches to the node's first damage row).
export function classifySkillRow(name) {
    if (BUFF_PATTERNS.test(name))                       return 'buff';
    if (META_SUFFIXES.some(suffix => name.includes(suffix) || name.trim() === suffix.trim())) return 'meta';
    if (/\b(?:Heal(?:ing)?)\b/i.test(name))             return 'heal';
    if (/\b(?:Shield|Absorb(?:tion)?|Barrier)\b/i.test(name) &&
        !SHIELD_EXCLUSION_RE.test(name))                return 'shield';
    if (/\bDMG\b|Damage\b/i.test(name))                return 'damage';
    return 'other';
}

// Mechanical skill-type fallback bucket. inferRowTypes derives the node's
// mechanical skillType (basic/heavy/skill/liberation/intro, plus forte/midair
// variants); this maps that to its DMG-bonus bucket fallback, used ONLY when
// no damage instance is matched for a row (see resolveInstanceFormula):
//   midair      → basic  (mid-air attacks receive Basic Attack bonuses)
//   forte_basic → basic  (forte basic-attack variants use Basic Attack level)
//   forte_heavy → heavy  (forte heavy-attack variants use Heavy Attack level)
export const FORMULA_TYPE_MAP = {
    midair:      'basic',
    forte_basic: 'basic',
    forte_heavy: 'heavy',
};

// P13-fix-5 (2026-07-04) — DATA-DRIVEN DMG-type classification.
// Every raw damage instance (nanoka `skill.damage[*].type`) carries the game's
// own damage-type tag. matchRowHits already maps each display row's multiplier
// terms to their exact instances (full rate-vector match), so the correct
// formulaType (DMG-bonus / amplify bucket + skill-level key) is READ off the
// matched instances — no kit-text regex interpretation. This replaces the
// former "considered [as] X DMG" text parser, which mis-scoped compound and
// staged conversions (confirmed wrong in-game on Aemeath, Galbrena — the
// maintainer verified the raw `type` tags match the actual in-game damage
// type perfectly). The mechanical node skillType (energy, cast, gating,
// multiplierUp) is unaffected — only the damage-bonus categorisation is read
// from data; per-display-row matching resolves per-stage conversions
// naturally (each stage is its own paramK → its own instances).
//
//   type 0 → basic   1 → heavy   2 → liberation   3 → intro   4 → skill
//   type 5 → Echo Skill DMG: sets isEchoSkill but does NOT become a
//     formulaType. dmgBonusBySkillType (src/core/stats.js) has no Echo bucket
//     and there is no Echo skill-level table, so an echo hit keeps its
//     mechanical baseFormula for level/scaling and simply receives no
//     type-specific DMG bonus (dmgBonusBySkillType?.[…] ?? 0 → 0). A real
//     Echo DMG Bonus stat is a separate, out-of-scope feature; isEchoSkill
//     stays a dormant flag until then.
export const TYPE_TO_FORMULA = { 0: 'basic', 1: 'heavy', 2: 'liberation', 3: 'intro', 4: 'skill' };

// Resolve one display row's formulaType + isEchoSkill from the raw `type`
// tags of the damage instances matchRowHits matched to it. A single uniform
// non-echo type wins; all-echo keeps the mechanical fallback (isEchoSkill
// set); >1 distinct non-echo type is ambiguous → mechanical fallback (logged,
// not applied). No match at all → mechanical fallback.
export function resolveInstanceFormula(hitTypes, baseFormula) {
    const known = hitTypes.filter(type => Number.isInteger(type) && type >= 0 && type <= 5);
    const isEchoSkill = known.includes(5);
    const nonEcho = [...new Set(known.filter(type => type <= 4))];
    if (nonEcho.length === 1) return { formulaType: TYPE_TO_FORMULA[nonEcho[0]], isEchoSkill, ambiguous: false };
    if (nonEcho.length > 1)   return { formulaType: baseFormula, isEchoSkill, ambiguous: true };
    return { formulaType: baseFormula, isEchoSkill, ambiguous: false };
}

// Derive a row's MECHANICAL skill type (drives energy, cast time, rotation
// gating, multiplierUp) plus its baseFormula — the DMG-bonus bucket fallback
// used when no damage instance is matched. The node-level type is overridden
// when the row name signals a different attack category (heavy, midair, forte
// variant). The final formulaType is read from matched instances, not here
// (see resolveInstanceFormula).
export function inferRowTypes(nodeType, name) {
    let skillType = nodeType;
    if (nodeType === 'forte') {
        if (/\bBasic Attack\b/i.test(name))    skillType = 'forte_basic';
        else                                    skillType = 'forte_heavy';
    } else if (/\bHeavy Attack\b/i.test(name)) skillType = 'heavy';
    else if (/\bMid-air\b/i.test(name))        skillType = 'midair';

    const baseFormula = FORMULA_TYPE_MAP[skillType] ?? skillType;
    return { skillType, baseFormula };
}

// Run-time log of "considered as X DMG" reclassifications, printed at the end of
// preprocessing so the maintainer can eyeball every roster-wide change.
export const FORMULA_RECLASSIFICATIONS = [];

export const FORMULA_RECLASS_AMBIGUOUS = [];

// Dodge Counters live in the damage panel for reference but are excluded
// from the rotation palette — they're reactive, not planned steps.
export function isPaletteIncluded(name) {
    return !/Dodge Counter/i.test(name);
}

// Derive the correct scaling stat for a skill node from its sk.damage entries.
// WuWa skills scale off ATK (default), HP (healers like Baizhi/Shorekeeper),
// or DEF (tank-style chars like Taoqi/Yuanwu).
// We look at the dominant related_property across non-healing damage entries
// (healing entries have element=0 and type=0 — excluded here).
export const RELATED_PROP_ID = { ATK: 7, HP: 2, DEF: 10 };

export function nodeRelatedPropId(skDamage) {
    const counts = {};
    for (const entry of Object.values(skDamage ?? {})) {
        if (entry.element === 0 || entry.type === 0) continue;   // skip healing entries
        const propId = RELATED_PROP_ID[entry.related_property] ?? 7;
        counts[propId] = (counts[propId] ?? 0) + 1;
    }
    const sorted = Object.entries(counts).sort(([, countA], [, countB]) => countB - countA);
    return sorted.length > 0 ? Number(sorted[0][0]) : 7;   // default: ATK
}

// Derive scaling stat from the `format` field on a level param row.
// The format is the authoritative source for per-row scaling in heal/shield rows
// (unlike damage rows where sk.damage.related_property is used).
// Returns: 'hp' | 'atk' | 'def' | 'er' | 'tuneAmp'
export function scalingStatFromFormat(fmt) {
    if (!fmt || fmt === 'null') return 'atk';
    if (/\{0\}%\s*HP/i.test(fmt))            return 'hp';   // Danjin "36" = 36% HP
    if (/\{0\}\s*HP/i.test(fmt))             return 'hp';
    if (/\{0\}\s*DEF/i.test(fmt))            return 'def';
    if (/\{0\}\s*ATK/i.test(fmt))            return 'atk';
    if (/per.*Energy\s*Regen/i.test(fmt))    return 'er';
    if (/Tune\s*AMP/i.test(fmt))             return 'tuneAmp';
    return 'atk';
}

// Parse a heal/shield param string for one level into { flat, ratio, rawCoef }.
// flatsByLevel[i] + ratiosByLevel[i] × stat = support output at level i+1.
//
// Patterns handled:
//   "575+2.90%"  → flat=575,  ratio=0.029              (flat HP + HP%)
//   "2.90%"      → flat=0,    ratio=0.029              (pure HP/ATK/DEF %)
//   "1041+39%"   → flat=1041, ratio=0.39               (flat + ATK%)
//   "36" ({0}% HP)→ flat=0,   ratio=0.36               (integer IS the percent)
//   "500+1.75"   → flat=500,  rawCoef=1.75, ratio=0    (ER-based — Brant)
export function parseHealParam(valStr, fmt) {
    const text = String(valStr ?? '').trim();
    if (!text || text === 'N/A') return { flat: 0, ratio: 0 };

    const isPercentHP = /\{0\}%\s*HP/i.test(fmt ?? '');
    const isER        = /per.*Energy\s*Regen/i.test(fmt ?? '');

    // "flat+ratio%"
    const mixM = text.match(/^([\d.]+)\+([\d.]+)%$/);
    if (mixM) return { flat: parseFloat(mixM[1]), ratio: parseFloat(mixM[2]) / 100 };

    // "flat+rawCoef" (ER-based Brant)
    const erM = text.match(/^([\d.]+)\+([\d.]+)$/);
    if (erM && isER) return { flat: parseFloat(erM[1]), ratio: 0, rawCoef: parseFloat(erM[2]) };

    // Pure percentage
    const pctM = text.match(/^([\d.]+)%$/);
    if (pctM) return { flat: 0, ratio: parseFloat(pctM[1]) / 100 };

    // Pure flat — if format is "{0}% HP", value IS the percentage
    const flatM = text.match(/^([\d.]+)$/);
    if (flatM) {
        if (isPercentHP) return { flat: 0, ratio: parseFloat(flatM[1]) / 100 };
        return { flat: parseFloat(flatM[1]), ratio: 0 };
    }

    return { flat: 0, ratio: 0 };
}

// Key format:  {skillType}_{description}  e.g. basic_present_1, heavy_fore, skill_jade_cleave
export function generateSkillKey(name, skillType, nodeSkillName) {
    let clean = name.replace(/\s+DMG$/i, '').trim();

    // Strip the node skill name prefix ("Frostblight: ", "Foreclaiming: " etc.)
    if (nodeSkillName) {
        const esc = nodeSkillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        clean = clean.replace(new RegExp(`^${esc}:\\s*`, 'i'), '');
    }

    // Strip redundant attack-type prefixes (skillType already captures the type)
    clean = clean
        .replace(/^Basic Attack\s*[-–]\s*/i, '')
        .replace(/^Heavy Attack\s*[-–]\s*/i, '')
        .replace(/^Mid-air Plunging Attack\s*[-–]\s*/i, 'Plunging ')
        .replace(/^Mid-air Attack\s*[-–]\s*/i, '')
        .replace(/^Resonance Skill\s*[-–]\s*/i, '')
        .replace(/^Resonance Liberation\s*[-–]\s*/i, '')
        .replace(/\s+Base\s*$/i, '')
        .trim();

    // Normalise stance names and stage numbers for brevity
    clean = clean
        .replace(/\bPresent Self\b/gi, 'present')
        .replace(/\bForeclaimed Self\b/gi, 'fore')
        .replace(/\bStage\s+(\d)\b/gi, '$1')
        .trim();

    const suffix = (!clean || clean.toLowerCase() === skillType || clean.toLowerCase() === 'skill') ? '' : '_' + clean;
    return (skillType + suffix)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .replace(/_+/g, '_');
}

// Category prefix shown on every skill card and rotation step.
// These are the core WuWa combat mechanics that must always be visible.
export const CATEGORY_PREFIX = {
    'basic':        'Basic Attack',
    'heavy':        'Heavy Attack',
    'midair':       'Basic Attack',           // mid-air = Basic Attack category
    'skill':        'Resonance Skill',
    'liberation':   'Resonance Liberation',
    'intro':        'Intro Skill',
    'outro':        'Outro Skill',
    // Forte Circuit is a resonator's SPECIALTY gauge, not an attack input. It is a
    // passive that interacts with other abilities rather than something cast in
    // its own right, and what it powers is not confined to (or triggered by) a
    // Heavy Attack — so "Heavy Attack (Forte)" titled 187 keys after the wrong
    // thing. The node's mechanical skillType still distinguishes the two
    // variants for multiplierUp matching; only the DISPLAY name is shared.
    'forte_basic':  'Forte Circuit',
    'forte_heavy':  'Forte Circuit',
};

// The display prefix for a node's category. Provenance — how the move is
// REACHED — is never folded in here; see generateSkillLabel's trailing marker.
export function categoryPrefix(skillType) {
    return CATEGORY_PREFIX[skillType] ?? skillType;
}

// Strip the redundant category prefix from the sub-name.
// Handles both "Basic Attack - Stage 1" (with dash) and "Basic Attack Stage 1" (no dash).
// A forte row strips only "Forte Circuit" — its own prefix. A leading "Heavy
// Attack"/"Basic Attack" there is the GAME naming the move, not a repeat of the
// prefix, so it is left for the category-override below to honour.
export const CATEGORY_STRIP_RE = {
    'basic':        /^Basic Attack\s*[-–]?\s+/i,
    'heavy':        /^Heavy Attack\s*[-–]?\s+/i,
    'forte_basic':  /^Forte Circuit\s*[-–]?\s+/i,
    'forte_heavy':  /^Forte Circuit\s*[-–]?\s+/i,
    'skill':        /^Resonance Skill\s*[-–]?\s+/i,
    'liberation':   /^Resonance Liberation\s*[-–]?\s+/i,
};

// The game files a move under the INPUT that casts it, which is not always what
// it calls the move: Aemeath's Mech basic chain lives inside her Resonance Skill
// node, so the node's mechanical skillType is 'skill' while the row's own name is
// "Basic Attack - Mech Stage 4". Prefixing the node's category then produced a
// label that contradicts itself — "Resonance Skill: Basic Attack — Mech Stage 4"
// (18 such labels across 9 resonators). When the row already names a category,
// THAT is what the move is called, so it wins; the node's annotation ((Forte) /
// (Echo) — how the move is reached, not what it is) is kept. The mechanical type
// is unaffected and still shown by the rotation chip's own type badge.
const NAMED_CATEGORIES = Object.freeze([
    'Resonance Liberation', 'Resonance Skill', 'Basic Attack', 'Heavy Attack',
    'Intro Skill', 'Outro Skill',
]);
// The category can be the WHOLE name — Cartethyia's Forte row is just "Heavy
// Attack" — so the tail is optional; otherwise that row keeps the node's prefix
// and reads "Forte Circuit: Heavy Attack".
const categoryLeadRe = (category) => new RegExp(`^${category}(?:\\s*[-–:]?\\s+|$)`, 'i');

export function leadingCategory(sub) {
    // Longest first, so "Resonance Liberation" can never be read as "Resonance".
    return NAMED_CATEGORIES.find(category => categoryLeadRe(category).test(sub)) ?? null;
}

// Generate the human-readable label. Format: "{Category}: {sub-name}"
// The category prefix (Basic Attack, Resonance Skill, etc.) is ALWAYS visible.
export function generateSkillLabel(name, skillType, nodeSkillName, isEchoSkill = false) {
    let prefix = categoryPrefix(skillType);

    // Provenance — how the move is REACHED — is always a TRAILING marker, never
    // a qualifier on the category. "(Echo)" on the prefix reads as "an Echo kind
    // of Forte Circuit", the same backwards reading that "Heavy Attack (Forte)"
    // had: an Echo skill is a normal skill of its category that this resonator
    // happens to reach through an Echo.
    const annotations = [];
    if (isEchoSkill) annotations.push('Echo');

    let sub = name.replace(/\s+DMG$/i, '').trim();

    // Strip the redundant category prefix from the sub-name
    const stripRe = CATEGORY_STRIP_RE[skillType];
    if (stripRe) sub = sub.replace(stripRe, '');

    // The row may still open with a DIFFERENT category than the node's — the
    // game's own name wins. The node's ANNOTATIONS survive it, because they say
    // how the move is REACHED rather than what it is: a Forte-circuit skill the
    // game calls a Resonance Skill is "Resonance Skill (Forte)", not a plain
    // Resonance Skill, and not a Forte Circuit entry.
    // The Forte Circuit is the resonator's specialty gauge; it is not an attack
    // input and it is not correlated to Heavy Attack. It still has to be SAID —
    // Cartethyia has both a normal Basic Stage 1-4 and an enhanced Forte Basic
    // Stage 1-5, and dropping the marker outright collides those four pairs into
    // identical labels — so it joins the trailing marker when the game's own
    // name has taken the prefix away from it.
    const owned = leadingCategory(sub);
    if (owned && !prefix.toLowerCase().startsWith(owned.toLowerCase())) {
        if (String(skillType).startsWith('forte')) annotations.unshift('Forte Circuit');
        prefix = owned;
        sub = sub.replace(categoryLeadRe(owned), '');
    }
    const provenance = annotations.length ? ` · ${annotations.join(' · ')}` : '';

    // Generic residuals ("Skill", "DMG", or identical to prefix) → use node skill name.
    // Exception: basic/heavy/midair nodes have generic node names like "One, Two, Three"
    // (the overall attack sequence name) that add no meaning to individual params.
    // For those, a bare "Heavy Attack" is more informative than "Heavy Attack: One, Two, Three".
    const isNamedSkill = !['basic', 'heavy', 'midair'].includes(skillType);
    if (!sub || /^(Skill|DMG)$/i.test(sub) || sub.toLowerCase() === prefix.toLowerCase()) {
        sub = isNamedSkill ? (nodeSkillName || '') : '';
    }

    // Normalise separators in the sub-name:
    //   colon+space  "Frostblight: Jade Cleave"  → "Frostblight — Jade Cleave"
    //   space-dash-space  "Iai - Stage 1"  → "Iai — Stage 1"
    //   bare hyphen in "Mid-air" intentionally left untouched
    sub = sub.replace(/:\s+/g, ' — ').replace(/\s+-\s+/g, ' — ').trim();

    return (sub ? `${prefix}: ${sub}` : prefix) + provenance;
}

// Link META rows to their parent damage steps by name matching.
// Strategy: strip the known META suffix from the row name to recover the
// "attack base", then match against each damage row's base name.
// Handles "/" in names (e.g. "Jade Cleave/Petalfall Cooldown" → both skills).
// Returns a Map:  damageKey → [ { name, mults } ]
export function linkMetaToSteps(damageRows, metaRows) {
    const links = new Map(damageRows.map(row => [row.key, []]));

    for (const meta of metaRows) {
        let base = meta.name;
        for (const suf of META_SUFFIXES) {
            const suffixRegex = new RegExp(suf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
            base = base.replace(suffixRegex, '');
        }
        base = base.trim();

        // Split on "/" to handle shared-cooldown rows
        const parts = base.split('/').map(part => part.trim()).filter(Boolean);
        let attached = false;

        for (const part of parts) {
            for (const dmg of damageRows) {
                const dmgBase = dmg.name.replace(/\s+DMG$/i, '').trim();
                if (part.length > 3 &&
                    (dmgBase.toLowerCase().includes(part.toLowerCase()) ||
                     part.toLowerCase().includes(dmgBase.toLowerCase()))) {
                    links.get(dmg.key).push({ label: meta.name.trim(), mults: meta.mults });
                    attached = true;
                }
            }
        }

        // Fallback: attach to the first damage row of this node
        if (!attached && damageRows.length > 0) {
            links.get(damageRows[0].key)
                 .push({ label: meta.name.trim(), mults: meta.mults, nodeLevel: true });
        }
    }

    return links;
}

// Parse a nanoka multiplier string to a decimal fraction.
// "72.49%"           → 0.7249
// "33.62%*5+252.11%" → (33.62*5 + 252.11) / 100 = 4.3921
export function parseMult(text) {
    if (typeof text === 'number') return text;
    const terms = String(text).replace(/%/g, '').split('+');
    const total = terms.reduce((sum, term) => {
        const parts = term.split('*');
        return sum + parts.reduce((product, value) => product * parseFloat(value || '0'), 1);
    }, 0);
    return total / 100;
}
