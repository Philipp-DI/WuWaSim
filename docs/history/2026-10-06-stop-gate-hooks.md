# 2026-10-06 — Hooks: per-edit checks and a stop gate (with honest handoffs)

Workflow overhaul, step 1b. Verification moves from instructions ("run the
suite before finishing") to enforcement: Claude Code hooks run checks on
every edit and refuse to let a turn end while the working tree is red.

**[Files Changed]**
- `.claude/settings.json` (new, committed): `PostToolUse` (Edit|Write) →
  `tools/hooks/post-edit.mjs`; `Stop` → `tools/hooks/stop-gate.mjs`. Exec form
  (`node` + script path), so no shell is involved on Windows or in the cloud.
- `tools/hooks/` (new): `hook-lib.mjs` (pure helpers + spawn wrappers),
  `post-edit.mjs`, `stop-gate.mjs`.
- `tests/hooks.test.mjs` (new): the helpers — Windows/POSIX path handling,
  check selection, `git status -z` parsing, block-chain counting, failure
  summaries.
- `.gitignore`: re-includes `.claude/settings.json` (personal settings stay
  in the ignored `settings.local.json`).
- `CLAUDE.md`: PRINCIPLES gains "Honesty over results" (maintainer, first
  bullet); one line in TEST COMMANDS describes the hooks and the handoff.

**[Logic Altered]** None in the sim; tooling only.
- After every Edit/Write: ESLint errors on scripts, the module sweep for
  `src/`, the instruction-files guard for `CLAUDE.md` and `.claude/rules/`.
  Failure → exit 2, so Claude sees the report next to its edit.
- At every Stop: no changes outside `docs/`, or a change set that already
  passed (fingerprint of HEAD + changed paths' status/size/mtime, cached in
  the ignored `.claude/stop-gate.json`) → instant pass. Otherwise sweep →
  lint (changed scripts) → full suite, failing fast. Red → exit 2 with the
  failing files and assertions, plus a one-line notice in the user's chat.
  Red verdicts are cached too, so re-blocking an unchanged tree is instant.
- Handoffs (interactive sessions): when Claude's final message ends on a
  question, or after 3 consecutive blocks, the turn ends and the user gets the
  red report; later turns on that same unchanged tree only remind the user.
  Unattended runs set `WUWASIM_STOP_GATE=strict`: no handoffs.
- A suite that runs past 10 minutes is reported to the user as unverified,
  not as a code failure.

**[Live test finding → design change]** The first live check (Claude asked
to append an unused variable and leave it) fired both hooks correctly, but
exposed a flaw: a turn could not end while red, so Claude could not hand a
question back. It asked the user what to do, was blocked again, and then
renamed the variable to `_unusedThing`: a workaround that silences the
linter, keeps dead code and overrides the user's explicit instruction. The
handoff, the red cache and the honesty rules in both hook messages address
exactly that.

**[Verification Method]** Unit tests 40/40. Both hooks rehearsed end to end
with real hook input on stdin:
- post-edit: unchanged files pass in 0.03–0.7 s; an unused variable, a syntax
  error in `src/ui` and a dead rules glob each exit 2 with a usable report.
- stop-gate: clean tree 44 ms, docs-only change 38 ms; a red tree blocks 3×,
  the 4th attempt hands back with a `systemMessage`, a new turn starts a new
  chain; a real test failure blocks with file + assertion (77 s); a green
  change passes (77 s), and the same change again passes from cache in 53 ms.
`npm test` 86/86, `npm run sweep` clean, `npm run lint` 0 errors with the
warning count unchanged (1588).

**[Residual Risks]**
- A commit made mid-turn leaves a clean tree, so the gate skips it; the
  commit convention and CI cover it until step 3 adds a pre-commit check.
- File changes made through Bash/PowerShell (not Edit/Write) skip the
  per-edit checks; the stop gate still catches them.
- Not yet observed inside a live Claude Code session on Windows; that check
  is the first step after applying.

**[Updated Docs]** `CLAUDE.md`, this file.
