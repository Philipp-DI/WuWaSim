---
name: update-game-version
description: Adopt a new Wuthering Waves game version or hotfix into the WuWa Sim dataset, or resume one in progress — stage both upstream halves, diff them, stop at the review gate, install, guide the FModel export, run the extractors, compile, verify, and record. Use whenever the user says a new patch, version, hotfix or banner is out, asks to update, bump, adopt or refresh the game data, mentions a new resonator, weapon or echo set that the sim lacks, or asks where a running version update stands.
---

# Update game version

A THIN layer over `update-game-version/`. The procedure lives there and is
tested: `steps.json` (order, inputs, outputs), `update.mjs` (the orchestrator)
and `README.md` (what a person does at each stop). This skill says which
command to run, what to tell the maintainer, and what not to do. Paths and keys
live only in the gitignored `update-game-version/local.json`; never write them
here or into a report.

## Every invocation starts here

```bash
node update-game-version/update.mjs status --version <x.y>
```

It reports readiness (Arikatsu branch, nanoka version, the install's newest
hotfix lane, the export's build) and the run's progress, and changes nothing.
Continue at the step it names as **Next**. A new session, a compact or a crash
loses nothing: the state is in `update-game-version/staging/<v>/state.json`.
For a hotfix without a new version: `update.mjs hotfix` (export → verify again).

## Per step

Run an AUTO step with `update.mjs <step> --version <v>`, or `update.mjs all
--version <v>` to run until the next stop. Re-running a step forgets every
later one, by design.

| Step | What you do |
| --- | --- |
| `status`, `stage-*`, `diff` | Run them. A failed fetch is reported, never retried around. |
| `review` (GATE) | Read `reports/<v>/diff.md`. Draft the answers in `reports/<v>/review.md`: every semantic kit-text change and what it does to the sim, every changed or **overridden** effect-slot key, every shell. Check findings with two `verifier` agents (CLAUDE.md, "Verified means independently derived"). **Never set `decision: install` yourself**: the maintainer does, and the gate opens only for the diff hash the review names. |
| `install` | Runs after the decision. Afterwards `git status data/` must show only the files the diff named. |
| `export` (USER) | Print the steps below, then stop. When the maintainer confirms, run `update.mjs export --version <v>`; `check-export` decides, not the confirmation. |
| `check-export` | Fails on a missing, zero-byte or stale file, or a `BuildInfo` that is not the install's newest hotfix. A failure goes back to the maintainer with the exact file. |
| `extract` | By hand until spec Phase 2 (README, "### extract"). Snapshot every output's size first; a SMALLER output stops the run until explained. Then `update.mjs extract --version <v>` records it. |
| `compile` | Attribute every LOCK A and LOCK B movement before going on: per entity against a snapshot taken before the step, and on `teamDps` (what the card shows and `score` normalises), never `teamDamage`. Movement in a team without new content has a cause in some extractor output; find it. |
| `assets` | By hand until spec Phase 3 (README, "### assets"), then `update.mjs assets --version <v>`. |
| `verify` | Anything red is reported. New content breaks tests that pin roster counts: restate a count only with the new entries named and measured in its comment. Never weaken a test or silence a check. |
| `in-game` (USER) | Generate the checklist: every changed value on EXISTING content the stat sheet can show. The maintainer may defer it; say so in the record. |
| `record` | `docs/history/<date>-adopt-<v>.md`. Commit only when asked (CLAUDE.md, COMMIT CONVENTIONS). |

## The export, as the maintainer does it

Print these with the real version and directory names filled in:

1. Load the REAL install in FModel once, then close it: the planner reads
   FModel's newest log.
2. `node tools/plan-export.mjs --profile`, then `--profile --patch-only`
   (FModel closed).
3. `node tools/plan-export.mjs --link`, then `--link --patch-only`; paste the
   printed commands into PowerShell (Developer Mode or elevated).
4. `node tools/check-export.mjs --regex --dir <BodyType>/<Dir> …`, one `--dir`
   per new or changed resonator.
5. Pass 1 on the full slim root, then pass 2 on the patch root: Search, Regex
   on, paste, Enter, click a result, Ctrl+A, right-click > Export > Raw Data.
   Never pick between duplicates by hand; pass 2 overwrites them.

A new resonator's asset folder carries the game's INTERNAL name, not the
English one. The nanoka portrait name hints at it (`T_IconRole_Pile_<Name>_UI`),
the folder may be longer (3.7: Hsin is `FemaleXL/Xinyuehu` and
`FemaleXL/XinyuehuShen`; Suoming is `FemaleS/Suoming`), and the maintainer
confirms it in FModel. Say "hypothesis" until the animation names match the kit.

## Traps this procedure has already hit

- The Arikatsu half alone once reported "no change" while nanoka reworded kits.
  Check both halves.
- A nanoka fetch keyed on `manifest.latest` reads ahead of `live`.
- Base paks are launch day; hotfixes are `_P` paks under
  `Client/Saved/Resources/<ver>/Resource/<hotfix>/`. A patch leaves the old
  `_P` links dangling, and FModel then mounts only 1 pak.
- A file left over from an earlier export passes an existence check; the
  STALE check exists because of `db_AbnormalDamage.db` at 3.7.
- The asset scanners take `<exportRoot>/Content/Aki/Character/Role`, never the
  export root.
- A minifier rename can empty a parsed enum without an error
  (`extract_extra_effects` at 3.7): the size snapshot is what catches it.
- New kits need onboarding before `verify` goes green: Resonance Modes in
  `tools/resonance-modes.js`, kit phrasings the parser misreads, and effects a
  condition makes inflating. Trace each new effect against its own clause
  (the `resonator-audit` skill), and default anything unmodellable OFF.
- An optimizer pool cut before simulation can drop a team or weapon when new
  content arrives. Check the best team per anchor against the previous version.

## Never

Commit or push unasked; set the review decision; answer the in-game checks;
pick FModel duplicates by hand; edit the hooks to get past them; or write a
path, key or account name into a committed file.
