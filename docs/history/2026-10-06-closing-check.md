# 2026-10-06 — Closing check for step 1: prompt audit and lint ratchet

Workflow overhaul, step 1d: `/doctor prompt-audit` over every instruction file
(Sonnet 5.5, CLI 2.1.291), `/context` and `/usage`, and the hook test repeated
on the terminal CLI that unattended runs will use.

**[Files Changed]**
- Skills: `resonator-audit` no longer labels generated files "hand-edit OK",
  describes the current targets (`DEFAULT_TARGET` everywhere;
  `benchmark-gap.mjs` defaults to `TARGET_REFERENCE`), asks for sources that
  are independent for the claim, and says "Resonator abilities always hit".
  `rotation-drafter` no longer calls `conditionKind` legacy.
- `.claude/rules/`: the migration notes are gone from all 12 headers.
- `CLAUDE.md`: verifiers are read-only and the main session runs any check
  that changes the tree; the citation lookup names both places; tool names
  are `Grep`, `Glob`, `Read`; the hooks line mentions the warning ratchet.
- `docs/PRINCIPLES.md`: where it and `CLAUDE.md` disagree, `CLAUDE.md` is current.
- Lint ratchet: the stop gate blocks warnings a changed script adds over its
  committed version (a renamed file is compared with its old path, a new file
  starts from zero); CI lints with `--max-warnings 1588`.
- `tests/resonance-mode.test.mjs`: the two `r` parameters behind the +2
  warnings of the reverse-direction test are renamed.

**[Logic Altered]** None in the sim.

**[Verification Method]** Each audit claim was checked against the code before
adoption. Adopted: generated files labelled hand-edit (F1), `conditionKind`
called legacy (F4), migration notes (F6), the verifier tree-change conflict
(F7), "Enemy abilities always hit" in the skill (F8), "grep the title there"
(F9), the tool names. Corrected before adoption: F2's proposed text said
`benchmark-gap.mjs` uses the 0%-RES dummy on purpose; its default is
`TARGET_REFERENCE` and the dummy is an opt-in comparison (`--zero-res`).
Deferred: condensing incident narratives in the rules files (F5, F10, F11,
F13), pending a decision on the strikethrough convention for instruction
files. Not adopted: removing "Think carefully" (F14) and condensing the
cognitive workflow (F15), negligible either way. User-level files were left to
the maintainer. Ratchet: the CI ceiling passes at 1588 and fails at 1587; the
gate flags an added warning, ignores a renamed file's 27 old ones, and blocks
in 1.2 s before the suite. Hook test on CLI 2.1.291: the append went through a
shell command, so the per-edit check did not fire, and the stop gate caught it.
`npm test` 87/87, sweep clean, lint 0 errors and 1588 warnings.

**[Measured]** Instructions loaded at session start (Sonnet 5.5 tokens):
`CLAUDE.md` 5.1k, `MEMORY.md` 0.3k, user `CLAUDE.md` 1.1k, against an estimated
~43k + 3.8k before step 1 (Opus 5 tokens). Skills 9k, of which the project's two
are ~0.44k; the rest is the claude.ai skill sync, a plugin and built-ins. The
prompt audit alone was 77% of the day's usage: run it after large instruction
changes, not routinely.

**[Residual Risks]**
- The ratchet matches warnings by rule and message, so moved code never counts
  as new; when identical warnings exist, the later ones are named.
- The CI ceiling must be lowered by hand when a cleanup removes warnings.

**[Updated Docs]** `CLAUDE.md`, `docs/PRINCIPLES.md`, both skills, the 12 rules
headers, this file.
