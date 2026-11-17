# 2026-11-17 — Delete team-er.js (#67, map #43)

In plain terms: the code that picked an ER target for a build had no screen
showing its number, and #53 decided not to add one (it would compete with the
live team-page number). It is gone, and the docs that described it as live are
corrected. The real need, a live ER target per team member, is #68.

**[Files Changed]**
- Deleted `src/core/team-er.js`, `tests/team-er.test.mjs` (the test was its only importer).
- `.claude/rules/invariants-resources.md`: `team-er` dropped from both `paths` globs; the old globs moved verbatim to `docs/history/rules/invariants-resources.md`.
- `.claude/skills/rotation-drafter/references/wuwa.md`: no longer cites `team-er.js`.
- `docs/ARCHITECTURE.md`, `README.md`: the `team-er.js` row/sentence struck through with a deletion note.
- `docs/GLOSSARY.md`: `erOverride / minViableEr` described as an optimizer diagnostic, read only by `tools/optimize/validation-report.js`.

**[Logic Altered]** None at runtime: no `src/` module imported `team-er.js`. The optimizer still writes `erOverride` into `meta.teams`. `team-er.js` was not in the derived engine-hash graph (`tools/engine-hash.mjs`), so `engineHash` is unchanged.

**[Verification Method]** `npm run sweep` (71 imported, 0 failed); `npm run lint` (0 errors); LOCK A and LOCK B: the only diff was `generatedAt` (restored afterwards); `npm test` 89/89 run last.

**[Residual Risks]** None. `docs/PRINCIPLES.md` still links `[[p13-team-er-status]]`: that's a memory note name about the P13 ER history, not the module, so it was left as is. `docs-local/` (a local design handoff) still mentions the file.

**[Updated Docs]** As listed under Files Changed.
