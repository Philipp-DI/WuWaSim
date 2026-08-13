/**
 * Runtime data loader.
 *
 * Loads the pre-processed baseline + the optional runtime patch and
 * merges them into a single in-memory dataset. The patch lets us ship
 * data corrections between full pre-processor re-runs without touching
 * the baseline.
 *
 * Merge semantics:
 *   - For each array key both files declare (e.g. `resonators`), entries
 *     are joined by `id`. Patch entries overwrite baseline fields one
 *     level deep. New ids in the patch are appended.
 *   - Scalar/object keys at the top level: patch wins if non-null.
 *
 * The loader is the single source of truth for "what's in the dataset".
 * UI never reaches around it.
 */

const EXPECTED_SCHEMA_VERSION = 9;

// Cache-busting. GitHub Pages' CDN (and browsers) ignore fetch({cache:'no-cache'})
// and serve stale files, so the data URLs carry a `?v=` query that must change
// whenever the CONTENT changes — not just the schema. preprocess.mjs writes a
// content-hash manifest (data/data-version.json); we fetch that tiny file fresh
// on every load and use its hash as the buster. Falls back to the schema version
// if the manifest is missing (older deploys). Without this, a content-only regen
// (e.g. effect reclassification) keeps the same URL and serves a stale dataset.
const MANIFEST_URL = './data/data-version.json';
const SCHEMA_BUSTER = `?v=${EXPECTED_SCHEMA_VERSION}`;

// Fetch the content-hash manifest with no caching at all (it's tiny). Returns
// the cache-buster query for the data files, or the schema fallback on any miss.
async function dataBuster() {
    try {
        const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
            const { data } = await res.json();
            if (data) return `?v=${data}`;
        }
    } catch { /* offline / missing manifest → fall back */ }
    return SCHEMA_BUSTER;
}

// Keys that are arrays-of-objects merged by `id`.
const MERGEABLE_ARRAYS = [
    'resonators', 'elements', 'weaponTypes',
    'weapons', 'echoes', 'sonatas',
];

async function fetchJson(url, { optional = false } = {}) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
        if (optional && res.status === 404) return null;
        throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

// Index an array of {id, ...} objects by id, preserving insertion order.
function indexById(list) {
    const map = new Map();
    for (const item of list || []) {
        if (item && item.id != null) map.set(item.id, item);
    }
    return map;
}

// Merge two arrays-of-objects by id. Patch entries overwrite baseline
// fields one level deep; new ids append to the end.
function mergeArrayById(baseline, patch) {
    const result = indexById(baseline);
    for (const entry of patch || []) {
        if (entry == null || entry.id == null) continue;
        const existing = result.get(entry.id);
        result.set(entry.id, existing ? { ...existing, ...entry } : { ...entry });
    }
    return [...result.values()];
}

/**
 * Apply data/patch.json's id-keyed overrides onto a baseline dataset. Pure, and
 * the SAME merge loadDataset() performs — exported because patch.json is a
 * RUNTIME overlay (`preprocess.mjs` never bakes it into wuwa-data.json), so any
 * Node-side consumer that reads the compiled file directly sees an UNPATCHED
 * dataset unless it calls this. That split is not theoretical: Phrolova's and
 * Ciaccona's curated `offFieldActions` live only in patch.json, so the offline
 * optimizer and every test reading wuwa-data.json straight off disk were
 * scoring both characters with no off-field damage at all while the browser
 * app gave them theirs.
 *
 * @param {object} baseline — parsed data/wuwa-data.json
 * @param {object|null} patch — parsed data/patch.json
 * @returns {object} a new merged dataset; `baseline` is never mutated
 */
export function applyPatch(baseline, patch) {
    // Always a fresh object, even with no patch — callers assign onto the result
    // (loadDataset stamps patchedAt), and handing back `baseline` itself would
    // make that a mutation of the caller's input.
    if (!patch) return { ...baseline, patchedAt: null };
    const merged = { ...baseline };
    for (const key of MERGEABLE_ARRAYS) {
        merged[key] = mergeArrayById(baseline[key], patch[key]);
    }
    merged.patchedAt = patch.generatedAt ?? null;
    return merged;
}

function validateSchema(data, label) {
    if (!data || typeof data !== 'object') throw new Error(`${label} is not a JSON object`);
    if (data.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
        throw new Error(
            `${label} schemaVersion=${data.schemaVersion}, expected ${EXPECTED_SCHEMA_VERSION}. ` +
            `Re-run: node tools/preprocess.mjs`,
        );
    }
    // Structural sanity: echoMainStats must be a cost-keyed object { 4:[...], 3:[...], 1:[...] }
    // not the old flat array. A flat array causes silent wrong values without this check.
    if (label === 'baseline' && data.echoMainStats != null) {
        if (Array.isArray(data.echoMainStats)) {
            throw new Error(
                `${label}.echoMainStats is a flat array — re-run: node tools/preprocess.mjs`
            );
        }
        const keys = Object.keys(data.echoMainStats);
        if (!keys.includes('4') || !keys.includes('3') || !keys.includes('1')) {
            throw new Error(
                `${label}.echoMainStats missing cost keys (got ${keys.join(',')}) — re-run: node tools/preprocess.mjs`
            );
        }
    }
}

/**
 * Public API: load the merged dataset.
 * Throws on baseline failure; missing patch is fine (treated as no overrides).
 */
export async function loadDataset() {
    const buster = await dataBuster();
    const [baseline, patch, skillMap, statRanges] = await Promise.all([
        fetchJson(`./data/wuwa-data.json${buster}`),
        fetchJson(`./data/patch.json${buster}`, { optional: true }),
        fetchJson(`./data/skill-map.json${buster}`, { optional: true }),
        fetchJson(`./data/stat-ranges.json${buster}`, { optional: true }),
    ]);

    validateSchema(baseline, 'baseline');
    if (patch) validateSchema(patch, 'patch');

    const merged = applyPatch(baseline, patch);
    // Pass through stat dictionaries + damage engine inputs unchanged
    // (not id-keyed; baseline is the source of truth).
    // echoMainStats is now a cost-keyed map { 4:[...], 3:[...], 1:[...] }
    merged.echoMainStats = baseline.echoMainStats ?? {};
    merged.echoSubStats = baseline.echoSubStats ?? [];
    merged.growthCurve = baseline.growthCurve ?? [];
    merged.baseStats = baseline.baseStats ?? {};
    merged.skillTree = baseline.skillTree ?? {};
    merged.weaponGrowthCurves = baseline.weaponGrowthCurves ?? {};
    merged.damageTable = baseline.damageTable ?? {};
    merged.skillMap = skillMap ?? {};
    // Curated substat roll table (data/stat-ranges.json). Unwrap the
    // outer "stat_ranges" key so consumers can do statRanges["CR%"]
    // directly. Empty object if not present so callers never crash.
    merged.statRanges = statRanges?.stat_ranges ?? {};

    merged.counts = {
        resonators: merged.resonators?.length ?? 0,
        weapons: merged.weapons?.length ?? 0,
        echoes: merged.echoes?.length ?? 0,
        sonatas: merged.sonatas?.length ?? 0,
        elements: merged.elements?.length ?? 0,
        echoMainStats: Object.values(merged.echoMainStats).flat().length,
        echoSubStats: merged.echoSubStats.length,
    };
    merged.patchedAt = patch?.generatedAt ?? null;

    return merged;
}

// Test hooks — exported for the in-browser test runner. Not for UI use.
export const __test__ = { mergeArrayById, indexById };