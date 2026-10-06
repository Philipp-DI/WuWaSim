# 2026-10-06 — Fixed-model subagents, skills in the repo, privacy guard

Workflow overhaul, step 1c. Subagents get fixed models instead of "ask the
user which model"; the two local skills move into git, so subagents and cloud
runs can use them; two guards keep instruction files loadable and personal
paths out of the public repository.

**[Files Changed]**
- `.claude/agents/verifier.md`, `.claude/agents/data-scout.md` (new), both on
  Sonnet. `verifier` (high effort) is the verification protocol as an agent:
  derive from one assigned source; CONFIRMED / PARTIALLY CONFIRMED / REFUTED /
  UNDETERMINED with `file:line` evidence; read-only. `data-scout` (medium
  effort) answers lookups with evidence via `node -e`; read-only.
- `.claude/skills/rotation-drafter/` (now committed): reference files moved
  into `references/`. `SKILL.md` always pointed there, but the local copy kept
  them at the top level, so every reference was dead. The energy section now
  matches the full-energy framework; `CONCERTO_EFF` and
  `tools/rotation-defaults.js` (neither ever existed) became `concertoGen` and
  `data/reference-rotations.json`.
- `.claude/skills/resonator-audit/` (now committed): reads the invariant files
  in `.claude/rules/`, writes summaries to `docs/history/`, records invariants
  in rules files, and requires two `verifier` derivations before a fidelity
  finding counts as CONFIRMED. Harness renames clear its 3 lint warnings.
- `.gitignore`: re-includes `agents/` and `skills/`; packaged `.skill`
  archives stay ignored.
- `CLAUDE.md`: IDENTITY points to the fixed-model agents instead of asking
  which model to use; PRINCIPLES names `verifier`.
- `tests/instruction-files.test.mjs`: agents and skills must parse (name,
  description, known model and effort, unique names, skill name = folder), and
  a skill's references to its own files must resolve.
- `tests/privacy.test.mjs` (new): no user-profile or AppData paths in any file
  `git add -A` would commit.
- `tools/hooks/` + `tests/hooks.test.mjs`: the per-edit guard also covers agent
  and skill definitions.

**[Logic Altered]** None in the sim.

**[Verification Method]** Every path (28) and identifier (83) the skills cite
was checked against the repo; the 2 stale ones are fixed. The localStorage-shim
note was kept: tests still install the shim, and it was not shown to be
unnecessary. Privacy review of the skills: no names or e-mail addresses (the
FModel export root on drive G is the machine path the extraction scripts
already use). The audit harness still runs against the current engine (Chisa:
solo, per-step, team). Guards mutation-checked: the original skill-layout bug,
a model typo, a missing description and a planted profile path each fail; the
same path in an ignored file passes. `npm test` 87/87, sweep clean, lint
0 errors with the warning count unchanged (1588).

**[Residual Risks]**
- The rotation-drafter copy installed as a claude.ai plugin predates the local
  one (it lacks the Opener genre). The repo is now the source; rebuild the
  ignored `.skill` package from it before re-uploading.
- The agents are read-only by tool list (no Edit or Write) and by instruction;
  Bash could still change files if an agent ignored its instructions. Not yet
  observed in a live session.
- The privacy patterns cover profile and AppData paths only: real names,
  e-mail addresses and the git author address are outside their reach.

**[Updated Docs]** `CLAUDE.md`, both skills, this file.
