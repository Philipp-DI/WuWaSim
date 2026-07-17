// tools/preprocess/text.mjs — localization text resolution + skill-description formatting.
// Split from the monolithic preprocess.mjs (Simplification Plan S4.1);
// bodies moved verbatim — LOCK A (byte-identical wuwa-data.json) verifies.

// Resolve a localization key. Returns the key on miss so misses are
// visible in the UI rather than silently empty.
export function makeTextResolver(textMap) {
    return (key) => (key && textMap[key]) || key || '';
}

// =============================================================================
// Sanitization
// =============================================================================

export function isPlaceholder(text) {
    const lower = text.toLowerCase();
    return lower.includes('an error occurred')
        || lower.includes('error detected')
        || lower.includes('customer service');
}

export function isUnresolvedKey(text) {
    return /^[A-Z][A-Za-z]+_\d+_/.test(text);
}

export function cleanText(text) {
    if (!text) return '';
    const trimmed = text.trim();
    if (!trimmed) return '';
    if (isPlaceholder(trimmed)) return '';
    if (isUnresolvedKey(trimmed)) return '';
    return trimmed;
}

// Format a raw nanoka skill description for display in the damage panel.
// Converts the game's HTML/tag markup into a structure the UI can render:
//   - <size=10> spacers  → paragraph break (\n\n)
//   - <color=Title>X</color> inside <size=N> → section header (## X)
//   - <color=Highlight>X</color> → [X] (keyword emphasis)
//   - all other tags stripped
//   - params substituted
// Returns a plain string with \n\n between sections.
export function formatSkillDesc(rawDesc, params) {
    if (!rawDesc) return '';
    let text = rawDesc;
    // Section spacers
    text = text.replace(/<size=10>[^<]*<\/size>/gi, '\n\n');
    // Section headers: <size=N><color=Title>text</color></size>
    text = text.replace(/<size=\d+><color=Title>(.*?)<\/color><\/size>/gis, '\n\n## $1');
    // Keyword highlights
    text = text.replace(/<color=Highlight>(.*?)<\/color>/gis, '[$1]');
    // Strip remaining tags
    text = text.replace(/<[^>]+>/g, '');
    // Substitute params
    text = substituteParams(text, params);
    // Strip leftover engine tags {Cus:...} etc.
    text = text.replace(/\{[A-Za-z][^}]*\}/g, '');
    // Normalise whitespace: collapse multiple spaces/trailing spaces per line
    text = text.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trimEnd()).join('\n');
    // Collapse 3+ consecutive newlines to 2
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return text;
}

// Substitute {0}/{1}/... placeholders with params — solves Phase 7's gap.
export function substituteParams(desc, params) {
    return desc.replace(/\{(\d+)\}/g, (match, i) => params[Number(i)] ?? match);
}
