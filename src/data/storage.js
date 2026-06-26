/**
 * Build persistence — localStorage-backed.
 *
 * Storage layout:
 *   wuwa-sim:meta             -> { version, currentBuildId | null, currentTeamId | null }
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
import { normalizeTeam } from '../core/team.js';

const NS = 'wuwa-sim:';
const META_KEY = NS + 'meta';
const INDEX_KEY = NS + 'builds';
const BUILD_PFX = NS + 'build:';
const TEAM_INDEX_KEY = NS + 'teams';
const TEAM_PFX = NS + 'team:';
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
    return { version: STORE_VERSION, currentBuildId: null, currentTeamId: null };
}

function writeMeta(meta) {
    return writeJson(META_KEY, { version: STORE_VERSION, ...meta });
}

/** Set/unset which build is currently loaded in the editor. */
export function setCurrentBuildId(id) {
    return writeMeta({ ...readMeta(), currentBuildId: id });
}

/** Set/unset which team was most recently opened on the Teams page. */
export function setCurrentTeamId(id) {
    return writeMeta({ ...readMeta(), currentTeamId: id });
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

/** Read one build by id. Returns null if missing or unparsable.
 *  `onNotice` (optional) is forwarded to normalizeBuild — called once with a
 *  human message if a migration cleared something (e.g. a trimmed weapon). */
export function readBuild(id, { dataset, onNotice } = {}) {
    if (!id) return null;
    const raw = readJson(BUILD_PFX + id, null);
    if (!raw) return null;
    try { return normalizeBuild(raw, { dataset, onNotice }); } catch { return null; }
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

/** Delete every saved build and clear the index. */
export function clearAllBuilds() {
    for (const id of listBuildIds()) safeRemove(BUILD_PFX + id);
    writeJson(INDEX_KEY, []);
    writeMeta({ ...readMeta(), currentBuildId: null });
}

/**
 * Duplicate a saved build under a new id (for comparison/experimentation).
 * The copy gets a fresh id, "(copy)" appended to its name, and is saved +
 * indexed. Returns the new build, or null if the source is missing.
 */
export function duplicateBuild(id, { dataset } = {}) {
    const src = readBuild(id, { dataset });
    if (!src) return null;
    const now = Date.now();
    const copy = normalizeBuild({
        ...src,
        id: undefined,           // force normalizeBuild to mint a new id
        name: `${src.name} (copy)`,
        createdAt: now,
        updatedAt: now,
    }, { dataset });
    return saveBuild(copy, { dataset });
}

// =============================================================================
// Duplicate guardrails — a build's "Create Duplicate" button is one click
// away from quietly tripling someone's saved-build list, so duplication is
// rate-limited (per source build) and capped (per source build). Lineage
// isn't part of the build schema itself (normalizeBuild whitelists fields),
// so it's tracked separately here, keyed by source build id.
//   wuwa-sim:dupeMeta -> { [sourceBuildId]: { count, lastAt } }
// =============================================================================

const DUPE_META_KEY = NS + 'dupeMeta';
const MAX_DUPES_PER_BUILD = 5;
const DUPLICATE_COOLDOWN_MS = 3000;

function readDupeMeta(id) {
    const all = readJson(DUPE_META_KEY, {});
    return (all && typeof all === 'object' && all[id]) || { count: 0, lastAt: 0 };
}

/**
 * Duplicate a build, enforcing a per-source cap (MAX_DUPES_PER_BUILD) and
 * cooldown (DUPLICATE_COOLDOWN_MS) so repeated clicks can't flood the build
 * list. Returns { ok: true, build } on success, or { ok: false, reason }.
 */
export function duplicateBuildWithGuardrails(id, { dataset } = {}) {
    const meta = readDupeMeta(id);
    if (meta.count >= MAX_DUPES_PER_BUILD) {
        return { ok: false, reason: `Limit reached — max ${MAX_DUPES_PER_BUILD} duplicates per build.` };
    }
    const sinceLast = Date.now() - meta.lastAt;
    if (sinceLast < DUPLICATE_COOLDOWN_MS) {
        return { ok: false, reason: `Please wait ${Math.ceil((DUPLICATE_COOLDOWN_MS - sinceLast) / 1000)}s before duplicating again.` };
    }
    const copy = duplicateBuild(id, { dataset });
    if (!copy) return { ok: false, reason: 'Source build not found.' };
    const all = readJson(DUPE_META_KEY, {});
    all[id] = { count: meta.count + 1, lastAt: Date.now() };
    writeJson(DUPE_META_KEY, all);
    return { ok: true, build: copy };
}

// =============================================================================
// Team persistence — mirrors the build API.
//   wuwa-sim:teams         -> string[] (ordered team ids)
//   wuwa-sim:team:<id>     -> Team object (JSON)
// =============================================================================

/** Ordered list of team ids. */
export function listTeamIds() {
    const idx = readJson(TEAM_INDEX_KEY, []);
    return Array.isArray(idx) ? idx.filter(s => typeof s === 'string') : [];
}

/** All teams in stored order. Corrupt rows are skipped. */
export function listTeams() {
    const out = [];
    for (const id of listTeamIds()) {
        const t = readTeam(id);
        if (t) out.push(t);
    }
    return out;
}

/** Read one team by id. Returns null if missing or unparsable. */
export function readTeam(id) {
    if (!id) return null;
    const raw = readJson(TEAM_PFX + id, null);
    if (!raw) return null;
    try { return normalizeTeam(raw); } catch { return null; }
}

/** Persist a team. Adds to the index if new. Returns the saved team. */
export function saveTeam(team) {
    if (!team || !team.id) throw new Error('saveTeam: team.id required');
    const normalized = normalizeTeam(team);
    writeJson(TEAM_PFX + normalized.id, normalized);
    const ids = listTeamIds();
    if (!ids.includes(normalized.id)) {
        ids.push(normalized.id);
        writeJson(TEAM_INDEX_KEY, ids);
    }
    return normalized;
}

/** Delete a team and remove it from the index. */
export function deleteTeam(id) {
    if (!id) return false;
    safeRemove(TEAM_PFX + id);
    writeJson(TEAM_INDEX_KEY, listTeamIds().filter(x => x !== id));
    const meta = readMeta();
    if (meta.currentTeamId === id) writeMeta({ ...meta, currentTeamId: null });
    return true;
}

/** Delete every saved team and clear the index. */
export function clearAllTeams() {
    for (const id of listTeamIds()) safeRemove(TEAM_PFX + id);
    writeJson(TEAM_INDEX_KEY, []);
    writeMeta({ ...readMeta(), currentTeamId: null });
}

// =============================================================================
// Compare page slot state — what's loaded into the comparison slots, so a
// reload doesn't lose the user's picks. Small enough to store as one blob
// rather than per-slot keys (mirrors `meta` above).
// =============================================================================

const COMPARE_KEY = NS + 'compareSlots';

/** Read the Compare page's slot state, initializing it if absent. */
export function readCompareSlots() {
    const saved = readJson(COMPARE_KEY, null);
    const fallback = { mode: 'builds', buildSlots: Array(6).fill(null), teamSlots: Array(3).fill(null) };
    if (!saved || typeof saved !== 'object') return fallback;
    return {
        mode: saved.mode === 'teams' ? 'teams' : 'builds',
        buildSlots: Array.isArray(saved.buildSlots) ? Array.from({ length: 6 }, (_, i) => saved.buildSlots[i] ?? null) : fallback.buildSlots,
        teamSlots: Array.isArray(saved.teamSlots) ? Array.from({ length: 3 }, (_, i) => saved.teamSlots[i] ?? null) : fallback.teamSlots,
    };
}

/** Persist the Compare page's slot state. */
export function writeCompareSlots(state) {
    return writeJson(COMPARE_KEY, {
        mode: state.mode === 'teams' ? 'teams' : 'builds',
        buildSlots: state.buildSlots ?? Array(6).fill(null),
        teamSlots: state.teamSlots ?? Array(3).fill(null),
    });
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