// src/ui/components/build-editor/state.js — the page's one shared mutable
// holder (api) — set once per mount.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
//
// Every panel module imports the live `api` binding read-only; only mount()
// replaces the whole object (via setApi — ESM importers cannot reassign an
// imported binding). Property mutation (api.build = …) stays free for the
// modules that own those flows.

export let api = null; // { root, dataset, build, onChange, theme, … } — see mount()

export function setApi(value) {
    api = value;
}
