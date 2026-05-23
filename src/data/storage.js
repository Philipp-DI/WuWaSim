/**
 * Build persistence — localStorage-backed.
 *
 * Storage layout:
 *   wuwa-sim:meta             -> { version, currentBuildId | null }
 *   wuwa-sim:builds           -> string[]  (ordered build ids)
 *   wuwa-sim:build:<id>       -> Build object (JSON)
 *
 * Per-build keys keep the read/write surface small — toggling level
 * doesn't rewrite every saved build. The index `builds` is the source
 * of truth for ordering and listing; orphaned `build:*` keys are
 * tolerated (treated as garbage; reaped on next prune).
 *
 * All operations are best-effort: if localStorage is unavailable (Safari
 * private mode), the API still works but data isn't persisted. Errors
 * during a single read don't poison the whole list.
 */

import { normalizeBuild } from '../core/build.js';

const NS         = 'wuwa-sim:';
const META_KEY   = NS + 'meta';
const INDEX_KEY  = NS + 'builds';
const BUILD_PFX  = NS + 'build:';
const STORE_VERSION = 1;

// =============================================================================
// LocalStorage shim — never throws, always returns sensible defaults.
// =============================================================================

function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function safeRemove(key) {
    try { localStorage.removeItem(key); return true; } catch { return false; }
}
function safeKeys() {
    try { return Object.keys(localStorage); } catch { return []; }
}

function readJson(key, fallback = null) {
    const raw = safeGet(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
}
function writeJson(key, value) {
    try { return safeSet(key, JSON.stringify(value)); } catch { return false; }
}

// =============================================================================
// Public API
// =============================================================================

/** Read the meta blob, initializing it if absent. */
export function readMeta() {
    const meta = readJson(META_KEY, null);
    if (meta && typeof meta === 'object' && meta.version === STORE_VERSION) {
        return meta;
    }
    return { version: STORE_VERSION, currentBuildId: null };
}

function writeMeta(meta) {
    return writeJson(META_KEY, { version: STORE_VERSION, ...meta });
}

/** Set/unset which build is currently loaded in the editor. */
export function setCurrentBuildId(id) {
    return writeMeta({ ...readMeta(), currentBuildId: id });
}

/** Ordered list of build ids. */
export function listBuildIds() {
    const idx = readJson(INDEX_KEY, []);
    return Array.isArray(idx) ? idx.filter(s => typeof s === 'string') : [];
}

/** All builds in stored order. Corrupt rows are silently skipped. */
export function listBuilds({ dataset } = {}) {
    const ids = listBuildIds();
    const out = [];
    for (const id of ids) {
        const b = readBuild(id, { dataset });
        if (b) out.push(b);
    }
    return out;
}

/** Read one build by id. Returns null if missing or unparsable. */
export function readBuild(id, { dataset } = {}) {
    if (!id) return null;
    const raw = readJson(BUILD_PFX + id, null);
    if (!raw) return null;
    try { return normalizeBuild(raw, { dataset }); } catch { return null; }
}

/** Persist a build. Adds to the index if new. Returns the saved build. */
export function saveBuild(build, { dataset } = {}) {
    if (!build || !build.id) throw new Error('saveBuild: build.id required');
    const normalized = normalizeBuild(build, { dataset });
    writeJson(BUILD_PFX + normalized.id, normalized);

    const ids = listBuildIds();
    if (!ids.includes(normalized.id)) {
        ids.push(normalized.id);
        writeJson(INDEX_KEY, ids);
    }
    return normalized;
}

/** Delete a build and remove it from the index. */
export function deleteBuild(id) {
    if (!id) return false;
    safeRemove(BUILD_PFX + id);
    const ids = listBuildIds().filter(x => x !== id);
    writeJson(INDEX_KEY, ids);
    const meta = readMeta();
    if (meta.currentBuildId === id) writeMeta({ ...meta, currentBuildId: null });
    return true;
}

/** Remove orphan `build:*` rows not referenced by the index. */
export function prune() {
    const ids = new Set(listBuildIds());
    for (const key of safeKeys()) {
        if (!key.startsWith(BUILD_PFX)) continue;
        const id = key.slice(BUILD_PFX.length);
        if (!ids.has(id)) safeRemove(key);
    }
}

/** Returns true if localStorage is functional in this environment. */
export function isAvailable() {
    const probe = NS + '__probe__';
    if (!safeSet(probe, '1')) return false;
    safeRemove(probe);
    return true;
}

// Test hooks.
export const __test__ = { NS, INDEX_KEY, BUILD_PFX };
