# 2026-10-05 — Context diet: CLAUDE.md split into path-scoped rules

Workflow overhaul, step 1a. `CLAUDE.md` had regrown to 107 KB (~27k tokens loaded
into every Claude Code session) after the July split (S1.2). 82% of it was the
invariants table, and almost every row only matters in one area of the code.

**[Files Changed]**
- `CLAUDE.md`: 425 → 184 lines, 107 KB → 9.8 KB (~2.5k tokens per session).
- `.claude/rules/` (new, 11 files): 9 invariant/area files, `data-pipeline.md`,
  `generated-data-locks.md`, `engine-data-shapes.md`. Each carries a `paths:`
  list and loads only when Claude Code reads, edits or writes a matching file.
- `.gitignore`: `.claude` → `.claude/*` with a re-include for `rules/` only (the
  old line kept the rules out of git; local skills and settings stay ignored).
- `tests/instruction-files.test.mjs` (new): the guard below.
- `docs/HISTORY.md`: frozen-archive notice at the top; nothing else touched.
- `docs/history/` (new): per-session summaries start here.

**[Logic Altered]** None; no code file touched (so `engineHash`, LOCK A and LOCK B
are unaffected). 83 of 92 invariant rows moved byte-for-byte into the area files;
9 cross-cutting rows stay in `CLAUDE.md` (slot-key format and freezing,
multiplierUp/DMG-bonus type matching, stat nodes, element node mapping,
conditional effects default OFF, enemy abilities always hit, linear rotation).
The Data pipeline section, KEY DATA SHAPES and the LOCK A/B procedure moved
verbatim. Wording changed in only three places: the reading-order line became
on-demand pointers, session summaries go to `docs/history/`, and an INSTRUCTION
FILES section maps the rules files.

**[Verification Method]** The build script asserted that every original row lands
in exactly one destination, byte-exact, and that each moved block is verbatim.
`npm test` 85/85, `npm run sweep` clean, `npm run lint` 0 errors with the warning
count unchanged (1588). The guard test was mutation-checked: a renamed glob
target, a typo inside a brace group, an unquoted path, an over-budget root, a
duplicated title and a renamed cited title each make it fail.

**[Residual Risks]**
- Path-scoped rules load on Read/Edit/Write, not on grep or Bash. A session that
  plans an area from grep output alone lacks its invariants until it opens a
  file; INSTRUCTION FILES tells Claude to read the rules file first.
- `tools/preprocess.mjs` matches four rules files (~50 KB together), which is
  correct (it touches all those areas) but expensive; a compression pass over
  the longest rows (the Rover row is 6.6 KB of incident history) is optional
  follow-up.
- Code comments still say `CLAUDE.md, "<title>"` for moved titles; left as is
  because editing engine files moves `engineHash`. The guard resolves all 10.

**[Updated Docs]** `CLAUDE.md`, `docs/HISTORY.md` (notice), this file.
