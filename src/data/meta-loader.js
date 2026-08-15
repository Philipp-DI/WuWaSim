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
const META_FILE = './data/wuwa-meta.json';
const MANIFEST_URL = './data/data-version.json';

// Cache-buster for the meta file: the `meta` hash from the content manifest
// (preprocess/optimize write it), so a meta regen busts the runtime cache. Falls
// back to the meta version when the manifest is missing. See loader.js for why
// the plain schema/version query is not enough on the GitHub Pages CDN.
async function metaUrl(doFetch) {
    try {
        const res = await doFetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
            const { meta } = await res.json();
            if (meta) return `${META_FILE}?v=${meta}`;
        }
    } catch { /* missing manifest → fall back */ }
    return `${META_FILE}?v=${EXPECTED_META_VERSION}`;
}

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
        const res = await doFetch(await metaUrl(doFetch), { cache: 'no-cache' });
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
    const character = meta?.characters?.[String(resonatorId)];
    if (!character) return null;
    const entry = character.bySequence?.[String(sequenceLevel)]?.bySonata?.[String(sonataId)];
    if (!entry) return null;
    return {
        ...entry,
        name: character.name,
        element: character.element,
        scalingStat: character.scalingStat,
        referenceRotation: character.referenceRotation,
        referenceWeapon: character.referenceWeapon,
        suggested: character.suggested,
        templateStats: character.templateStats,
        anchorStats: character.anchorStats,
    };
}

/**
 * The suggested empty-build default for a resonator (best sonata × weapon +
 * reference rotation), independent of any equipped sonata. Returns null when
 * uncovered. Used to populate a fresh build with a one-click "apply".
 */
export function suggestedBuildFor(meta, resonatorId) {
    const character = meta?.characters?.[String(resonatorId)];
    if (!character?.suggested) return null;
    return { ...character.suggested, referenceRotation: character.referenceRotation, templateStats: character.templateStats };
}

/**
 * The reference rotation for a resonator: prefers the optimizer's synthesized
 * one (meta.characters[id].referenceRotation — populated for optimizer-covered
 * anchors) and falls back to the hand-curated data/reference-rotations.json
 * (covers the rest of the roster). Returns null when neither exists. Pure —
 * takes both data blobs explicitly so callers outside the build-editor's own
 * `api` singleton (e.g. app.js, before a page is even mounted) can use it too.
 */
export function resolveReferenceRotation(meta, referenceRotations, resonatorId) {
    const metaRotation = meta?.characters?.[String(resonatorId)]?.referenceRotation;
    if (metaRotation?.length) return metaRotation;
    return referenceRotations?.[String(resonatorId)]?.rotation ?? null;
}

/**
 * The OPTIONAL curated opening pass, or null. Only the hand-curated file states
 * one — the P12 meta's synthesized rotation is a steady-state loop and has no
 * opener to offer, so unlike resolveReferenceRotation there is no meta branch.
 */
export function resolveOpenerRotation(referenceRotations, resonatorId) {
    const opener = referenceRotations?.[String(resonatorId)]?.openerRotation;
    return Array.isArray(opener) && opener.length ? opener : null;
}

/** The set of sequence levels computed for a resonator (for UI fallbacks). */
export function coveredSequences(meta, resonatorId) {
    const character = meta?.characters?.[String(resonatorId)];
    return character ? Object.keys(character.bySequence ?? {}).map(Number).sort((sequenceA, sequenceB) => sequenceA - sequenceB) : [];
}

/**
 * P13 — the ranked suggested teams for a resonator (curated META teams pinned
 * first, then sim-ranked alternatives). Returns [] when the character has no
 * suggestions (uncovered or no candidates → the UI shows "no suggestion").
 */
export function suggestedTeamsFor(meta, resonatorId) {
    return meta?.teams?.byCharacter?.[String(resonatorId)] ?? [];
}

/**
 * P13 — the suggested teams (anchored elsewhere) that this resonator appears in.
 * The reverse index for "this character is used in suggested teams for: …".
 */
export function appearsInTeams(meta, resonatorId) {
    return meta?.teams?.appearsIn?.[String(resonatorId)] ?? [];
}

/**
 * P13 §7/§8 fidelity fix — the EXACT build recipe (weaponId, sonataId, mode,
 * rotation, full echoes with real ids + mainStat + subStats) the team pass
 * computed for this resonator's representative build. This is the same data
 * `suggestedTeamsFor`'s "INSPECT BUILDS" panel displays (via memberBuilds),
 * so materializing this recipe 1:1 (loadTeamIntoSim) can never drift from
 * what was shown. Returns null when uncovered (no team-pass build exists for
 * this resonator).
 */
export function teamMemberBuildFor(meta, resonatorId) {
    return meta?.teams?.memberBuilds?.[String(resonatorId)]?.recipe ?? null;
}

/** The sonata ids computed for a resonator at a given sequence. */
export function coveredSonatas(meta, resonatorId, sequenceLevel) {
    const character = meta?.characters?.[String(resonatorId)];
    const bySonata = character?.bySequence?.[String(sequenceLevel)]?.bySonata ?? {};
    return Object.keys(bySonata).map(Number);
}
