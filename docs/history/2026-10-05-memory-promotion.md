# 2026-10-05 — Standing rules promoted from auto memory; "Abilities always hit"

Workflow overhaul, step 1a follow-up. Claude Code's auto memory (`MEMORY.md`,
loaded every session) held the project's standing rules, but auto memory is
machine-local and never reaches subagents or cloud runs, and part of it
contradicted the code and the new instruction layout.

**[Files Changed]**
- `CLAUDE.md` (184 → 193 lines, 9.8 → 12.3 KB): new PRINCIPLES section (data
  first, contradictions are findings, inferred is not verified, no silent zeros,
  verified means independently derived); "Enemy abilities always hit" renamed
  "Abilities always hit" with the enemy-attack toggle policy; NAMING 6 (no
  warning sweeps); file-move path check; browser smoke after UI changes;
  `npm test` runs last; INSTRUCTION FILES intro compacted.
- `.claude/rules/`: new `tests.md` (test-file pattern, moved verbatim);
  full-energy start row in `invariants-resources.md`; live-weights fallback row
  in `invariants-optimizer.md`; buff-path manifest pointer in
  `invariants-team-gear.md`; source-swap checklist in `data-pipeline.md`.
- `docs/PRINCIPLES.md` (new): the seven promoted memory notes, verbatim.

**[Logic Altered]** None; no code file touched. One rule changed by the
maintainer's decision: enemy attacks are explicitly not modelled, and an effect
that needs the wielder to be hit is a user toggle, OFF by default.

**[Verification Method]** Each promoted claim was checked against the code
first: `PINNED_REF` precedence (`tools/preprocess.mjs:152`), measured freeze
before the `HARDCODED_FREEZE_FRACTIONS` fallback (`src/core/sim.js`), all six
buff modules in `ENGINE_FILES`, "STARTS FULL" (`src/core/team-energy.js:117`,
`src/core/team-sim.js:211`), the `kit` fallback (`src/core/live-weights.js:96`),
the buff-path manifest (`src/core/buffs.js:53`), `Def ?? Def_`
(`tools/preprocess/base-stats.mjs:122`), `flattenTextMap`
(`tools/preprocess/download.mjs:75`). Stale claims were dropped, not promoted:
the auto-resolved upstream branch, hardcoded freeze as "the source", "five"
buff modules, the id-length warning locations, summaries appended to
`docs/HISTORY.md`. `npm test` 85/85, `npm run sweep` clean, `npm run lint`
0 errors with an unchanged warning count.

**[Residual Risks]**
- Whether every enemy-hit-gated effect already has a user toggle was not
  audited; the invariant states the policy.
- `docs/PRINCIPLES.md` keeps the memory notes' first-person voice (Claude) and
  their `[[links]]` to retired notes.
- Auto memory keeps learning; rules that belong to the project should keep
  moving into the repo.

**[Updated Docs]** `CLAUDE.md`, five files in `.claude/rules/`,
`docs/PRINCIPLES.md`, this file.
