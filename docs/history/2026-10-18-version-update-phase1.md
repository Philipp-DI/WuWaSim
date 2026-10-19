# 2026-10-18 — Version update, Phase 1; 3.7 staged and diffed, stopped at the review gate

Implements Phase 1 of `docs/VERSION-UPDATE-SPEC.md`: the `update-game-version/`
folder, `steps.json`, the orchestrator and the `status` / `stage-arikatsu` /
`stage-nanoka` / `diff` / `review` / `install` steps. It was then run for 3.7
up to the review gate. Nothing is installed yet: `data/` still holds 3.6.

**[Files Changed]**
- New: `update-game-version/{README.md, steps.json, update.mjs, sources.mjs, status.mjs, fetch-arikatsu.mjs, fetch-nanoka.mjs, diff-report.mjs, install.mjs, local.example.json}`, `data/game-version.json`, `tests/update-game-version.test.mjs`, `docs/history/rules/data-pipeline.md`.
- Removed: `tools/fetch-nanoka-{chars,echoes,weapons}.mjs`. `update-game-version/fetch-nanoka.mjs` replaces them.
- Edited: `tools/preprocess.mjs` (the pin is read from `data/game-version.json`; two comments), `tools/extract-forte.mjs` (comment), `.gitignore`, `eslint.config.js` (id-length ratchet now covers `update-game-version/`), `.claude/rules/data-pipeline.md`, `.claude/rules/invariants-extraction.md` (`paths:`), `docs/ARCHITECTURE.md`, `docs/GLOSSARY.md`, `docs/VERSION-UPDATE-SPEC.md`.

**[Logic Altered]**
- `data/game-version.json` (`arikatsu`, `nanoka`) is now the one place the adopted version lives. `PINNED_REF` in preprocess reads it. Only `install` writes it, after the gate.
- `stage-arikatsu` stages all 17 tables at the target AND at the pinned ref. The pinned copy is the diff's baseline, because only `data/bindata/*` is committed. An empty table counts as a failed fetch.
- `stage-nanoka` picks the CDN version from `manifest.available`: the exact version, else the one `<v>.<n>` build. It never reads `latest`. It stages the indexes (no `/en/`) and every detail file.
- `diff` covers both halves:
  - per table: ids added, removed and changed, plus new and changed fields;
  - per nanoka file: every changed leaf, classed as text, param, asset or value;
  - per resonator: effect-slot keys added, removed or re-pointed, run through the real `projectNanokaCharacterFull`, with keys that `effect-overrides.json` addresses flagged;
  - shells (a resonator in one half only), before and after;
  - a check that the committed `data/bindata/*` equal the pinned branch.
- `review` writes a template that carries the diff's hash. The gate opens only on `decision: install` for that same hash. `install` checks the gate again before it does anything.
- Orchestrator: `state.json` records each finished step with an output hash, and re-running a step forgets every later one. A USER step run by name is the confirmation. Local-only steps probe the nanoka CDN first. Steps 9 and 11 are marked `pendingPhase` and stop with a pointer to the README.

**[Measured: the 3.7 run]**
- status: install `3.7.0`, newest hotfix lane `3.7.15`; export still `PatchVersion 3.6.15`; Arikatsu branch 3.7 exists; nanoka `live 3.7`, `available [3.7]`. nanoka no longer serves 3.6.
- Staged: 17 Arikatsu tables at each of 3.7 and 3.6. nanoka 3.7: 64 characters, 133 weapons, 187 echoes. 0 failures.
- No drift: the committed `data/bindata/*` equal Arikatsu 3.6, apart from the trailing newline the stage step adds.
- Shells: none before, none after.
- Effect-slot keys: only the new resonators gain keys (1311 Hsin, 1312 Suoming). No existing resonator's keys moved.
- nanoka: 20 files changed and 10 added.
  - One wording change in a kit: Sanhua (1102) inherent, "increased by" became "is increased by".
  - The rest is lore (1212), a new tag on 1304, sonata groups 36–38 appended to 13 existing echoes, and new index entries.
- Arikatsu:
  - `damage` +522 rows. All 10,539 existing rows change only by a new `Dying` field.
  - `roleinfo` +5 rows (1311, 1312, and 5051/5063/5065, which are not playable), plus a new `InstantAttributeBlend` field.
  - `phantomitem`: +26 rows and 63 changed. 15 of the changed rows change ItemId, MonsterId, mesh and icon together. That looks like the id-to-row mapping was reshuffled; the reviewer has to check it.
  - New: sonata groups 36–38, 2 weapons (122, 123), 20 skills, 34 skill-tree nodes.

**[Verification Method]**
- Test-first: `tests/update-game-version.test.mjs` was red before the modules existed and now passes, 116 assertions. It covers:
  - the steps.json schema: every command exists, outputs are known files, no step reads a later step's output except the declared hit-map cycle, and the hotfix path is steps 7–12;
  - the old fetchers are gone (`git grep`);
  - nanoka version resolution;
  - `status` on a fake install tree (numeric hotfix sort, `Video` ignored) and on an export BuildInfo;
  - `diff-report` on two fixture trees built from the real Sanhua file: added, changed and new-field rows, a param and a text change, re-pointed `S1.0` (flagged as overridden), added `S4.1`, and shell `1999`;
  - state invalidation and every state of the gate;
  - the gitignore entries.
- LOCK A after the pin refactor: only `generatedAt` moved in `wuwa-data.json`, and both files were restored.
- Full `npm test`, `npm run sweep` and `npm run lint` ran last (see the session summary).

**[Residual Risks]**
- Effect-slot keys are compared at projection level, before `bindSkillScopes`. A key dropped only at compile time shows up in step 10's LOCK A diff, not in `diff.md`.
- Two of the 14 steps are not exercised by any test or run, because the run stopped at the gate: `install.mjs` and the `hotfix` command.
- The committed `data/data-version.json` was already stale at HEAD (its hash is `fbb2a0e9a35c`; HEAD's content hashes to `dcb7186a152f`). This change did not cause it.
- The `phantomitem` remapping above has not been investigated.

**[Updated Docs]** `update-game-version/README.md` (new runbook); `.claude/rules/data-pipeline.md` (the pin sentence and the bump sentence rewritten, with the superseded text moved to `docs/history/rules/data-pipeline.md`); `docs/GLOSSARY.md` (version update, staging, review gate); `docs/ARCHITECTURE.md`; `docs/VERSION-UPDATE-SPEC.md` (Phase 1 marked implemented, with its deviations).
