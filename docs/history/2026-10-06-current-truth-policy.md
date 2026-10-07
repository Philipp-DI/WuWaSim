# 2026-10-06 — Instruction files state current truth

Maintainer decision: instruction files (`CLAUDE.md`, `.claude/`) hold only
current truth, with a pointer to their history, which lives in
`docs/history/rules/`. Ordinary docs keep the strikethrough convention.

**[Files Changed]**
- `CLAUDE.md`: SUMMARY STANDARDS states the convention (the paragraph is now
  one line); INSTRUCTION FILES names `docs/history/rules/`.
- `tests/instruction-files.test.mjs`: no struck text in instruction files;
  invariant rows at most 1,500 characters; every `History:` pointer resolves to
  a `## <title>` section. Two work queues (5 files with struck text, 13 rows
  over the cap) list what the condensation pass still has to do; a finished
  entry left in a queue fails, so the queues can't go stale.
- `docs/history/rules/README.md` (new): the layout of rule history.

**[Logic Altered]** None.

**[Verification Method]** Guard mutation-checked: struck text in a finished
file, a cleaned file left in its queue, a pointer to a missing file, a pointer
whose section title differs, a condensed row left in its queue, and a finished
row growing past the cap each fail; a valid pointer passes. `npm test` 87/87,
sweep clean, lint 0 errors and 1588 warnings.

**[Residual Risks]**
- The cap and the strikethrough check are proxies: a short row can still carry
  narrative, so the condensation pass reviews every row, not only queued ones.
- Titles stay unchanged even where one reads as history, because code comments
  cite them.

**[Updated Docs]** `CLAUDE.md`, `docs/history/rules/README.md`, this file.
