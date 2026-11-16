# 2026-11-16 — Agent skills setup (mattpocock engineering skills)

Ran `/setup-matt-pocock-skills`. Maintainer choices: GitHub Issues tracker, default triage labels, compact `CLAUDE.md` block (the 200-line budget in `tests/instruction-files.test.mjs` rules out the 12-line template block).

**[Files Changed]**

- `CLAUDE.md`: new `## Agent skills` section (4 lines, before TEST COMMANDS); now 198 lines, 14 264 bytes.
- `docs/agents/issue-tracker.md`: GitHub template verbatim; "PRs as a request surface" left at `no`.
- `docs/agents/triage-labels.md`: default five-role mapping.
- `docs/agents/domain.md`: single-context; points at `docs/GLOSSARY.md` (not root), `docs/adr/` (none yet), and the `CLAUDE.md` / `.claude/rules/` invariants.
- GitHub: created labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` (`wontfix` already existed).

- `CLAUDE.md` (maintainer's manual edits, same commit): dropped the IDENTITY role paragraph and the KISS, Maximum test coverage and Rotation format bullets (the linear-rotation rule stays in CRITICAL INVARIANTS); "SIMPLEST code" → "'easy-to-read' code"; tests before/after "any major/functional change"; condensed the data-pipeline paragraph.

**[Logic Altered]** None (no code change).

**[Verification Method]** `npm run sweep` (71 imported, 0 failed); `npm run lint` (0 errors); `npm test` (88/88 passed, including the instruction-file budget).

**[Residual Risks]** Work is still tracked in `docs/OPEN-ITEMS.md`; GitHub Issues is now a second tracker for skill-created tickets, and nothing migrates between them.

**[Updated Docs]** This file; `docs/agents/*` (new).
