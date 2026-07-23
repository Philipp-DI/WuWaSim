// src/core/sonata-override.js — transient sonata "quick-switch" preview.
//
// A quick-switch lets the user gauge "would a different set yield more damage?"
// WITHOUT editing (or saving) the build. The override is a plain map from an
// ORIGINAL sonataId to a replacement sonataId; `applySonataOverride` returns a
// shallow-cloned build whose equipped echoes are relabeled accordingly, so the
// existing sim (stats.js sonataCounts, buff-windows.js) credits the swapped
// set's bonuses with zero engine changes.
//
// Species identity (`echo.id`) is preserved by the relabel, so the distinct-echo
// 2pc/5pc counting rule (see stats.js echoContribution) still applies to the
// previewed set exactly as it would in-game.
//
// This module NEVER persists anything — callers hold the override in transient
// page state and drop it on save/reload. normalizeBuild (build.js) whitelists
// the saved shape, so even an override that leaked onto a build object would be
// stripped on save; keeping it out of the build entirely is the invariant.

// Drop identity/empty remaps so callers can treat "no real change" as null and
// keep a single "is there an active preview?" test everywhere.
export function normalizeSonataOverride(override) {
    if (!override || typeof override !== 'object') return null;
    const out = {};
    for (const [fromId, toId] of Object.entries(override)) {
        if (toId == null) continue;
        if (Number(fromId) === Number(toId)) continue;   // swapping a set to itself is a no-op
        out[fromId] = toId;
    }
    return Object.keys(out).length ? out : null;
}

// Return a build whose echoes are relabeled per `override` (origId → newId).
// Returns the SAME build reference when the override is empty or changes
// nothing, so callers can apply it unconditionally without churning identity
// (identity stability matters for the editor's build-keyed sim caches).
export function applySonataOverride(build, override) {
    if (!build || !override) return build;
    const keys = Object.keys(override);
    if (keys.length === 0) return build;

    let changed = false;
    const echoes = (build.echoes ?? []).map((echo) => {
        if (!echo || echo.sonataId == null) return echo;
        const toId = override[echo.sonataId];
        if (toId == null || Number(toId) === Number(echo.sonataId)) return echo;
        changed = true;
        return { ...echo, sonataId: Number(toId) };
    });
    return changed ? { ...build, echoes } : build;
}
