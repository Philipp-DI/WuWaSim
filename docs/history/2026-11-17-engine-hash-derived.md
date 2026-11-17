# 2026-11-17: the engineHash file set is derived

Wayfinder ticket #54 (map #43), scoped by decisions #49 and #52.

## [Files Changed]

- `tools/engine-hash.mjs` (new): `engineModules()` walks the import graph from `tools/optimize.mjs` (static and dynamic `import()`, relative specifiers). It throws on a missing target or on a non-literal dynamic import. It also exports `ENGINE_DATA_FILES`, `engineFiles()`, `hashedBytes()` and `engineHash()`.
- `tools/optimize.mjs`: the inline `ENGINE_FILES` list and `engineHash()` are removed; the shared module is imported instead.
- `tests/meta-schema.test.mjs`: the second hand copy of the list is removed; the test calls `engineHash()`.
- `tests/engine-hash.test.mjs` (new, 25 asserts): the closure follows the dynamic imports, contains no `src/ui/` module, and every same-line `readFileSync(… 'data/x.json' …)` in an engine module is listed in `ENGINE_DATA_FILES`. It also checks the meta is never hashed, that only `generatedAt` is blanked, and that every other file is hashed as raw bytes.
- `data/wuwa-meta.json`, `data/data-version.json`: regenerated. Only `engineHash`, `generatedAt` and the manifest's meta hash changed.

## [Logic Altered]

The hashed set went from 27 hand-listed `src/` files to 44 modules + 4 data files, 48 in all. The 17 added modules are:

- `src/core/`: `build.js`, `echo-rules.js`, `rotation-graph.js`, `substat-allocate.js` and `team.js`.
- `tools/`: `optimize.mjs`, `engine-hash.mjs` and all ten `tools/optimize/*.js` files.

The 4 data files are `data/wuwa-data.json`, `patch.json`, `stat-ranges.json` and `reference-rotations.json`. No file was dropped. `skill-map.json` and `data-version.json` are left out on purpose: only the browser fetches them, and the optimizer never reads them.

There is one exception to raw-byte hashing. The `generatedAt` value in `wuwa-data.json` is blanked before hashing, so a LOCK A rerun does not make the meta stale. The maintainer chose this on 2026-11-17, when it turned out to conflict with #52's "raw-byte hashing stays". The field name `engineHash` is unchanged.

## [Verification Method]

- LOCK B: `npm run meta` diff limited to `engineHash` / `generatedAt` / manifest meta hash.
- `npm run sweep` passed (71 imported, 0 failed).
- `npm run lint` passed with 0 errors. No new warnings in the new files.
- `npm test` passed 89/89 (run last).

## [Residual Risks]

- The import walker uses a regex. A relative specifier written in a comment in an engine module adds that file to the hash: this errs toward hashing more, never less.
- The data-file guard only detects reads where `readFileSync(` and the `data/*.json` literal are on the same line. A read with the path in a variable would escape it.
- `engine-hash.mjs` is part of its own hash, so editing it makes the meta stale (by design, but easy to forget).

## [Updated Docs]

- `CLAUDE.md`: the "keep ENGINE_FILES in sync" sentence is removed.
- `.claude/rules/data-pipeline.md` and `generated-data-locks.md` (rules rewritten; `tools/engine-hash.mjs` added to the locks rule's paths).
- The history entries in `docs/history/rules/data-pipeline.md` and the new `docs/history/rules/generated-data-locks.md`.
- `.claude/skills/resonator-audit/references/wuwa.md` and the `.gitattributes` comment.
- `docs/ARCHITECTURE.md` §8 (the old text is struck through).
