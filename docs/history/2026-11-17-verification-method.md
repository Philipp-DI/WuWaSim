# 2026-11-17 — Verification method: research agent plus verifiers (#57, map #43)

Wayfinder grilling ticket. A read-only agent compared the two methods across
all 10 research tickets of map #43. The maintainer chose to use both, always.

## [Files Changed]

- `CLAUDE.md`: the principle "Verified means independently derived" now
  requires one `research` agent per question (isolated worktree, findings
  posted as a collapsed comment on the ticket, never a `research/*` branch)
  plus two verifiers per claim, all blind to each other. The resolution must
  settle or file every disagreement, name the method behind each finding, and
  open with "In plain terms".
- `docs/PRINCIPLES.md`, "Verification protocol": the old opening is struck
  through; the new protocol and its measurement are recorded above the
  original text.
- `docs/agents/issue-tracker.md`, "Wayfinding operations": new **Research
  tickets** entry overriding the skill's default branch.
- GitHub: #57 resolved and closed; map #43 Notes and Decisions-so-far updated;
  new tickets #69 (settle four open disputes, research) and #70 (move the 10
  research branches into their tickets, then delete them, task).

## [Logic Altered]

No code. Process only.

## [Verification Method]

The comparison numbers (~30 unique catches and ~2 errors for the research
agent; ~20 and ~9 for the verifiers) come from one comparison agent reading
the tickets and branches. That is a single source and was not re-derived.
`npm run lint`, `npm run sweep` and `npm test` were run (they include
`tests/instruction-files.test.mjs`, which checks the CLAUDE.md size limits).

## [Residual Risks]

- The superseded CLAUDE.md wording was **deleted**, not moved to
  `docs/history/rules/CLAUDE.md.md`. This deviates from the SUMMARY STANDARDS
  rule for instruction files, at the maintainer's explicit instruction for
  this change. It is recoverable from git history (parent of this commit).
- The comparison counts are approximate and single-source (see above).
- The `research` skill still defaults to a branch. Only the repo docs override
  it, so a session that skips `docs/agents/issue-tracker.md` and CLAUDE.md
  could still push one.

## [Updated Docs]

`CLAUDE.md`, `docs/PRINCIPLES.md`, `docs/agents/issue-tracker.md`, this file.
