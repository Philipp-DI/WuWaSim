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

const BASELINE_URL = './data/wuwa-data.json';
const PATCH_URL    = './data/patch.json';
const EXPECTED_SCHEMA_VERSION = 2;

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
function indexById(arr) {
    const map = new Map();
    for (const item of arr || []) {
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

function validateSchema(data, label) {
    if (!data || typeof data !== 'object') throw new Error(`${label} is not a JSON object`);
    if (data.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
        throw new Error(
            `${label} schemaVersion=${data.schemaVersion}, expected ${EXPECTED_SCHEMA_VERSION}. ` +
            `Re-run the pre-processor or update the loader.`,
        );
    }
}

/**
 * Public API: load the merged dataset.
 * Throws on baseline failure; missing patch is fine (treated as no overrides).
 */
export async function loadDataset() {
    const [baseline, patch] = await Promise.all([
        fetchJson(BASELINE_URL),
        fetchJson(PATCH_URL, { optional: true }),
    ]);

    validateSchema(baseline, 'baseline');
    if (patch) validateSchema(patch, 'patch');

    const merged = { ...baseline };
    for (const key of MERGEABLE_ARRAYS) {
        merged[key] = mergeArrayById(baseline[key], patch?.[key]);
    }
    // Pass through stat dictionaries unchanged (small, not id-keyed).
    merged.echoMainStats = baseline.echoMainStats ?? [];
    merged.echoSubStats  = baseline.echoSubStats  ?? [];

    merged.counts = {
        resonators:    merged.resonators?.length    ?? 0,
        weapons:       merged.weapons?.length       ?? 0,
        echoes:        merged.echoes?.length        ?? 0,
        sonatas:       merged.sonatas?.length       ?? 0,
        elements:      merged.elements?.length      ?? 0,
        echoMainStats: merged.echoMainStats.length,
        echoSubStats:  merged.echoSubStats.length,
    };
    merged.patchedAt = patch?.generatedAt ?? null;

    return merged;
}

// Test hooks — exported for the in-browser test runner. Not for UI use.
export const __test__ = { mergeArrayById, indexById };
