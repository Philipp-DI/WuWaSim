/**
 * Runtime loader for data/wuwa-meta.json (P12 §7).
 *
 * Mirrors src/data/loader.js. Fetches the frozen optimizer output, validates
 * it, and exposes lookups. Stale/incompatible meta is treated as ABSENT (lookups
 * return null) so the build page falls back to the live sim rather than showing
 * silently-wrong advice (§13.6 "wrong advice is worse than no advice").
 *
 * Gating:
 *   - metaVersion must match EXPECTED_META_VERSION (the shipped compatibility
 *     guard — bumped on any breaking schema/engine change).
 *   - engineHash gating is OPT-IN at runtime (the browser can't recompute the
 *     hash). The strong guard against a committed-but-stale meta is the Node
 *     test (tests/meta-schema.test.mjs), which recomputes the engine hash and
 *     asserts it matches the committed meta. Pass `expectedEngineHash` to
 *     enable the check (used by that test).
 */

export const EXPECTED_META_VERSION = 1;
const META_URL = `./data/wuwa-meta.json?v=${EXPECTED_META_VERSION}`;

/**
 * Validate a parsed meta object against the expected version (and optionally
 * engine hash). Returns the meta if compatible, else null.
 */
export function validateMeta(meta, { expectedMetaVersion = EXPECTED_META_VERSION, expectedEngineHash = null } = {}) {
    if (!meta || typeof meta !== 'object') return null;
    if (meta.metaVersion !== expectedMetaVersion) {
        console.warn(`wuwa-meta.json metaVersion=${meta.metaVersion}, expected ${expectedMetaVersion} — ignoring meta (live sim only).`);
        return null;
    }
    if (expectedEngineHash != null && meta.engineHash !== expectedEngineHash) {
        console.warn('wuwa-meta.json engineHash does not match the current engine — ignoring meta (live sim only).');
        return null;
    }
    if (!meta.characters || typeof meta.characters !== 'object') return null;
    return meta;
}

/**
 * Load + validate the meta. Returns the meta object, or null if missing/stale.
 * @param {object} [opts]
 * @param {Function} [opts.fetchImpl] — injectable fetch (defaults to global).
 */
export async function loadMeta({ fetchImpl, expectedEngineHash = null } = {}) {
    const doFetch = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) return null;
    let parsed;
    try {
        const res = await doFetch(META_URL, { cache: 'no-cache' });
        if (!res.ok) return null;                       // 404 → no meta yet → live sim
        parsed = await res.json();
    } catch {
        return null;                                    // network/parse failure → graceful
    }
    return validateMeta(parsed, { expectedEngineHash });
}

/** Is this resonator covered by the meta at all? */
export function isCovered(meta, resonatorId) {
    return !!meta?.characters?.[String(resonatorId)];
}

/**
 * The bySonata entry for (resonator, sequence, sonata), or null if not covered.
 * Carries { erMode, conditionalThresholds, weights } for that scenario, plus
 * the character-level context (name, referenceRotation, …) merged in for the UI.
 */
export function metaFor(meta, resonatorId, sequenceLevel, sonataId) {
    const c = meta?.characters?.[String(resonatorId)];
    if (!c) return null;
    const entry = c.bySequence?.[String(sequenceLevel)]?.bySonata?.[String(sonataId)];
    if (!entry) return null;
    return {
        ...entry,
        name: c.name,
        element: c.element,
        scalingStat: c.scalingStat,
        referenceRotation: c.referenceRotation,
        referenceWeapon: c.referenceWeapon,
        templateStats: c.templateStats,
        anchorStats: c.anchorStats,
    };
}

/** The set of sequence levels computed for a resonator (for UI fallbacks). */
export function coveredSequences(meta, resonatorId) {
    const c = meta?.characters?.[String(resonatorId)];
    return c ? Object.keys(c.bySequence ?? {}).map(Number).sort((a, b) => a - b) : [];
}

/** The sonata ids computed for a resonator at a given sequence. */
export function coveredSonatas(meta, resonatorId, sequenceLevel) {
    const c = meta?.characters?.[String(resonatorId)];
    const bySonata = c?.bySequence?.[String(sequenceLevel)]?.bySonata ?? {};
    return Object.keys(bySonata).map(Number);
}
