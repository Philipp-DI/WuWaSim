/**
 * Shared hover-box description formatter (P11 §I).
 *
 * Highlights element names (each in its canonical element colour) and
 * multiplier/percent values inside a hover-box description, and renders
 * `## Heading` markdown-style lines (see extractSkillSection below) as
 * styled section headers. Used by every v2 hover-box — the build page
 * (`build-editor-v2.js`), the team-sim page (`team-editor-v2.js`), and the
 * echo picker (`echo-picker-v2.js`) — so the "pretty formatting" is
 * identical everywhere.
 *
 * IMPORTANT: operates on ALREADY-ESCAPED text (escape first, then format).
 * Element names, "12.5%" values, and "## " markers contain no HTML
 * metacharacters, so matching the escaped string and injecting the only
 * <span>/<div> tags here is XSS-safe.
 *
 * Pair with the `.bv2-tip-num` / `.bv2-tip-el` / `.bv2-tip-heading` rules in
 * styles/build-v2.css.
 */

// Canonical element-name → highlight colour token. Single source:
// styles/tokens.css --el-* (those are :root tokens, so they resolve even inside
// the body-appended hover-box, which is outside the themed .bv2 scope).
const ELEMENT_TIP_COLORS = Object.freeze({
    Glacio: 'var(--el-glacio)', Fusion: 'var(--el-fusion)', Electro: 'var(--el-electro)',
    Aero: 'var(--el-aero)', Spectro: 'var(--el-spectro)', Havoc: 'var(--el-havoc)',
});
const EL_RE = new RegExp(`\\b(${Object.keys(ELEMENT_TIP_COLORS).join('|')})\\b`, 'g');
const NUM_RE = /(\d+(?:\.\d+)?%)/g;
const HEADING_RE = /^## (.+)$/gm;

export function formatTipDesc(escapedDesc) {
    return String(escapedDesc ?? '')
        // Headings first so they don't fight the inline passes below — a
        // heading title never legitimately contains a "##" sequence itself.
        .replace(HEADING_RE, '<div class="bv2-tip-heading">$1</div>')
        // Numbers next so the element pass never re-scans a number span's markup.
        .replace(NUM_RE, '<span class="bv2-tip-num">$1</span>')
        .replace(EL_RE, (m) => `<span class="bv2-tip-el" style="color:${ELEMENT_TIP_COLORS[m]}">${m}</span>`);
}

// =============================================================================
// extractSkillSection — picks the part of a combined move-family description
// that actually applies to one skill key, for the hover-box "detailed
// description" feature.
//
// Dataset reality (verified against data/wuwa-data.json's autoSkillMap):
// every skill key has a `desc` string, but it's not per-stage — it's one
// block shared by every key in the same move family, with "## Heading"
// markers separating sub-moves (e.g. Sanhua's basic_1/basic_2/basic_3, her
// Heavy Attack, Mid-air Attack, and Dodge Counter all share one identical
// desc with 4 headings). Picking the wrong heading would show actively
// misleading text, so this only ever commits to a single section when it
// has real signal; otherwise it widens to a safe superset rather than guess.
// =============================================================================

// Only basic/heavy/midair (and dodge-counter, detected via the key) have a
// truly generic, game-wide heading vocabulary — every other move type
// (skill/liberation/forte/intro/outro) is bespoke-named per character, so
// they skip straight to the distinctive-word tier below.
const MOVE_BUCKET_BY_SKILL_TYPE = { basic: 'basic attack', heavy: 'heavy attack', midair: 'mid-air attack' };

// Generic vocabulary stripped from both the skill key and each heading
// before scoring distinctive-word overlap — what's left is what actually
// distinguishes one sub-move from another (e.g. "wooly"/"strike",
// "death"/"knell", "glacier"/"burst").
const GENERIC_WORDS = new Set([
    'basic', 'heavy', 'mid', 'air', 'midair', 'attack', 'dodge', 'counter',
    'resonance', 'skill', 'liberation', 'intro', 'outro', 'forte', 'damage', 'stage',
]);

function tokenize(s) {
    return String(s ?? '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(t => t && !/^\d+$/.test(t));
}
function distinctiveTokens(s) {
    return tokenize(s).filter(t => !GENERIC_WORDS.has(t));
}
// Exact match, or a shared 4+ char prefix (tolerates "wooly" vs "woolies").
function tokensMatch(a, b) {
    if (a === b) return true;
    return a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4);
}
function overlapScore(tokensA, tokensB) {
    let score = 0;
    for (const a of tokensA) if (tokensB.some(b => tokensMatch(a, b))) score++;
    return score;
}

/** Split "## Heading\nbody\n\n## Heading2\nbody2" into [{heading, full}]. */
function splitSections(desc) {
    const text = String(desc ?? '');
    const matches = [...text.matchAll(/^## (.+)$/gm)];
    if (matches.length === 0) return [{ heading: null, full: text }];
    const sections = [];
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
        sections.push({ heading: matches[i][1], full: text.slice(start, end).trimEnd() });
    }
    return sections;
}

// Among `candidates`, find the one whose heading's distinctive words best
// overlap with the skill key's distinctive words. Returns null (no
// confident pick) when nothing scores, or when the top score is tied.
function pickByDistinctiveOverlap(candidates, skillKey) {
    const keyTokens = distinctiveTokens(skillKey.replace(/_/g, ' '));
    if (keyTokens.length === 0) return null;
    let best = null, bestScore = 0, tie = false;
    for (const c of candidates) {
        const score = overlapScore(keyTokens, distinctiveTokens(c.heading));
        if (score > bestScore) { best = c; bestScore = score; tie = false; }
        else if (score === bestScore && score > 0) tie = true;
    }
    return (best && !tie) ? best : null;
}

/**
 * Resolve the section of `desc` relevant to `skillKey`/`skillType`. See the
 * module-level comment above for the full tiered rationale.
 *
 * @param {string} desc       raw (unescaped) desc text from the skill map
 * @param {string} skillKey   e.g. "basic_1", "liberation_death_knell"
 * @param {string} skillType  e.g. "basic", "heavy", "midair", "liberation"
 * @returns {string} the resolved description (still raw/unescaped)
 */
export function extractSkillSection(desc, skillKey, skillType) {
    const sections = splitSections(desc);
    if (sections.length <= 1) return String(desc ?? '');

    const bucket = skillKey.includes('dodge') ? 'dodge counter' : MOVE_BUCKET_BY_SKILL_TYPE[skillType];
    if (bucket) {
        const candidates = sections.filter(s => s.heading.toLowerCase().includes(bucket));
        if (candidates.length === 1) return candidates[0].full;
        if (candidates.length > 1) {
            const picked = pickByDistinctiveOverlap(candidates, skillKey);
            return picked ? picked.full : candidates.map(c => c.full).join('\n\n');
        }
        // Zero bucket candidates is unexpected for these skillTypes, but
        // stay safe and fall through to the distinctive-word tier below.
    }

    const picked = pickByDistinctiveOverlap(sections, skillKey);
    return picked ? picked.full : String(desc ?? '');
}

export const __test__ = { ELEMENT_TIP_COLORS, splitSections, pickByDistinctiveOverlap, distinctiveTokens };
