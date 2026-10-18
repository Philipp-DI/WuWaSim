# Game Version Update — Specification

> **STATUS: APPROVED**
> Collects the version-bump procedure, now spread over `.claude/rules/data-pipeline.md`,
> the 3.6 adoption commit (`073b6a2`), `docs/LANE-B-ASSET-EXTRACTION.md` and
> `docs/TIMING_MODEL.md`, into one folder, `update-game-version/`. The folder holds a
> runbook, an orchestrator and a check at every gate. First use: adopting 3.7,
> the prerequisite of `docs/ECHO-CAPTURE-SPEC.md`.

## 1. Why

- **A bump today** touches about ten scripts in `tools/` and `tools/extract/`,
  one GUI export, and lessons kept in prose.
- **The 3.6 bump found its traps by hand.** None of them fails loudly:
  - nanoka's type indexes live at `ww/<version>/<type>.json`, with no `/en/`.
  - The nanoka fetchers key off `manifest.ww.latest`, which runs ahead of
    `live`.
  - The Arikatsu half alone reports "nothing changed" when nanoka changed
    kit text.
  - The base paks are not the live game; hotfixes live in a separate lane.
  - Saving the slim root's FModel settings reset the game's own profile.
  - Zero-byte tables parse as empty.
  - `preprocess.mjs` writes `hit-map.json`, which `extract-forte.mjs` reads,
    whose output `preprocess.mjs` reads again.
- **Goal.**
  - One entry point.
  - Every step marked AUTO, USER or GATE.
  - Nothing installed before its diff is read.
  - Resumable after any stop.

## 2. State on 2026-10-18 (measured)

| Item | Value |
| --- | --- |
| Pinned | `PINNED_REF` 3.6; committed nanoka manifest `live 3.6`, `latest 3.7.0` (fetched 2026-09-08) |
| Game | 3.7 or later: 3.7 sets are visible in the maintainer's screenshots |
| Arikatsu | branch `3.7` exists; `3.8` does not (HTTP 404) |
| nanoka | current state is read by the `status` step; its CDN blocks datacenter IPs, so it runs on the maintainer's machine |

## 3. Folder layout

```text
update-game-version/
  README.md                the runbook (§4) — the human-facing document
  update.mjs               orchestrator (§5)
  steps.json               declarative step list: id, kind, runsOn, command, inputs, outputs
  local.example.json       template for local.json (install path, FModel export root)
  status.mjs               readiness report                         (new)
  fetch-arikatsu.mjs       stage BinData at a version               (new)
  fetch-nanoka.mjs         stage nanoka at a version                (merges the three fetch-nanoka-*.mjs)
  fetch-icons.mjs          resonator/weapon/echo/monster icons      (consolidates the icon tools, §10)
  fetch-sonata-crests.mjs  crests from phantomfettergroup.FetterElementPath (new)
  diff-report.mjs          staging vs committed, both halves        (new)
  plan-export.mjs          moved from tools/
  check-export.mjs         moved from tools/
  local.json               gitignored
  staging/<version>/       gitignored
  reports/<version>/       gitignored; the summary goes to docs/history/
```

**What moves into `update-game-version/`:**
- **Moves:** a script whose only caller is a version update.
- **Stays:** anything also run in daily work: `preprocess.mjs`,
  `optimize.mjs`, `extract-forte.mjs`, and `tools/extract/` (a library with
  its own readers, handover doc and rules-file globs).
- **Migration (CLAUDE.md, "Complete migrations").** References to the moved
  scripts, measured with `git grep`:
  - `data-pipeline.md` and `invariants-extraction.md`
  - `ARCHITECTURE.md`
  - the `_doc` field of `export-manifest.json`
  - a comment in `tools/preprocess/download.mjs`
  - the scripts' own headers

## 4. Steps (`steps.json`, run order)

| # | Step | Kind | Runs on | What it does | Stops when |
| --- | --- | --- | --- | --- | --- |
| 1 | `status` | AUTO | maintainer's machine | Installed version (the install's `BuildInfo.txt` and the newest hotfix lane under `Client/Saved/Resources/`, path from `local.json`); `PINNED_REF`; Arikatsu branch for the target; nanoka `live`/`latest`/`available` | Either half lacks the target version |
| 2 | `stage-arikatsu` | AUTO | any | Every table `tools/preprocess/download.mjs` lists, the committed `data/bindata/*`, at the TARGET ref → `staging/` | A fetch fails |
| 3 | `stage-nanoka` | AUTO | maintainer's machine | Indexes and every detail file, pinned to the TARGET version, never `manifest.latest` → `staging/` | A fetch fails |
| 4 | `diff` | AUTO | any | Per table: added/removed/changed ids, new fields. Per nanoka file: text and param changes. Effect-slot key sets per resonator, before vs after (CLAUDE.md, "Effect-slot keys are FROZEN…"). Shells: a resonator in one half only | Never; writes `reports/<v>/diff.md` |
| 5 | `review` | GATE | maintainer, with Claude Code | Semantic kit-text changes, changed effect-slot keys and shells are each answered | No `reports/<v>/review.md` with `decision: install` exists yet |
| 6 | `install` | AUTO | any | `staging/` → `data/extracted-nanoka/`, `data/bindata/`; bumps `PINNED_REF` and the nanoka version in ONE place | — |
| 7 | `export` | USER | maintainer's machine | Update AES key and mappings if rotated. `plan-export.mjs --profile` (FModel closed), then `--link` (Developer Mode or elevation); in FModel, load the slim root and export the listed folders | Always: waits for the user |
| 8 | `check-export` | AUTO | maintainer's machine | `check-export.mjs <root>` against `export-manifest.json`, file sizes included | Any missing or zero-byte file |
| 9 | `extract` | AUTO | maintainer's machine | `tools/extract/*` in declared input→output order; the timing chain `extract_timings.py` → `scan_bullet_timings.py` → `map-timings.mjs`; `build-skill-join.mjs` | An extractor fails or writes a SMALLER output without explanation |
| 10 | `compile` | AUTO | any | `preprocess` → `extract-forte` → `preprocess` (the `hit-map.json` cycle) → `optimize` | LOCK A/B movement not yet attributed (`generated-data-locks.md`) |
| 11 | `assets` | AUTO | maintainer's machine | `fetch-icons`, `fetch-sonata-crests`; capture templates once `ECHO-CAPTURE` exists | `tests/icons.test.mjs` coverage fails |
| 12 | `verify` | AUTO | any | `npm test`, `npm run sweep`, `npm run lint`; the capture fixture suite | Anything red. An honest red report is the output, never a workaround |
| 13 | `in-game` | USER | the game | A checklist generated from the diff: changed values the stat sheet can confirm (`data-pipeline.md`: the stat sheet is the oracle). New or changed UI screens → new capture fixtures | Waits for the answers |
| 14 | `record` | Claude Code | — | `docs/history/<date>-adopt-<version>.md`; commit per COMMIT CONVENTIONS | — |

**Hotfix path.** A hotfix ships `_P` paks that change ConfigDB without a new
Arikatsu or nanoka branch (3.6.15 re-shipped `db_buff`). `update.mjs hotfix`
runs steps 7–12 only.

## 5. The orchestrator

- **Commands:**
  - `node update-game-version/update.mjs status --version 3.7`
  - `node update-game-version/update.mjs all --version 3.7`, which runs to the next
    USER or GATE step and stops
  - `node update-game-version/update.mjs <step> --version 3.7`
  - `node update-game-version/update.mjs hotfix`
- **Stops.** At a USER step it prints that step's instructions from the
  README and stops. At a GATE it names the report and the decision file it
  waits for.
- **Resumable.** `staging/<v>/state.json` records the finished steps and a
  hash of each step's outputs. Re-running a step invalidates every later one.
- **Never commits or pushes.** Plain Node with no dependencies; Python steps
  use the repo's `.venv` interpreter.
- **Local-only steps** probe the nanoka CDN first, and refuse with the reason
  when it is unreachable.

## 6. Automation boundary

- **Automated:** steps 1–4, 6 and 8–12, given an export root.
- **Stays manual:**
  - the FModel export (a GUI);
  - the AES key and mappings when they rotate;
  - the review gate;
  - in-game checks;
  - fixture captures for changed screens;
  - the commit.
- **Possible later, not in this spec:** a CUE4Parse CLI
  (`LANE-B-ASSET-EXTRACTION.md` §8) would make the export scriptable, at the
  cost of adding .NET to the toolchain.

## 7. Instruction files after the move

- **`data-pipeline.md` keeps the invariants:**
  - the pinned ref;
  - check both halves;
  - verify the export before extracting;
  - base paks are not the live game;
  - the stat sheet is the oracle.
- **The procedural narrative moves** to `update-game-version/README.md`. The
  superseded text goes to `docs/history/rules/data-pipeline.md` under the
  current-truth policy, and the rule's `paths:` gains `update-game-version/**`.
- **Glossary:** version update, staging, review gate.
- **Project skill:** `.claude/skills/update-game-version/`, see §10 Phase 5.

## 8. Privacy

- **Local paths stay local.** The install path and the FModel export root live
  only in the gitignored `update-game-version/local.json`.
- **`.gitignore` gains** `update-game-version/local.json`,
  `update-game-version/staging/` and `update-game-version/reports/`.
- **`tests/privacy.test.mjs`** already blocks user-profile paths in committed
  files.

## 9. Tests (written first)

- **`steps.json` schema:**
  - every step's command exists;
  - every output is a known file;
  - no step reads a later step's output, except the declared preprocess cycle.
- **Moved scripts:** `git grep` finds no old path.
- **`diff-report`** on two tiny fixture trees produces the expected summary,
  including a shell and a changed effect-slot key.
- **`status`** on a fake install tree reads the version and the newest hotfix
  lane.

## 10. Phases

1. **Folder and core steps.** `steps.json` and the orchestrator with
   `status`/`stage`/`diff`/`review`/`install`; move the fetchers. Used at once
   to adopt 3.7 (steps 1–6, 10, 12).
2. **Export and extract (steps 7–9).** First run: bring the id-keyed artifacts
   (`external-buffs`, `gauge-income`, `status-appliers`, `buff-facts`,
   `skill-join`, `actionable-times`) to 3.7.
3. **Assets.**
   - The crest fetcher from `FetterElementPath`. Its source is the FModel
     export; the nanoka CDN mapping is a *hypothesis, unverified*.
   - `SONATA_SLUGS` derived from data.
   - The three overlapping icon tools (`download-icons.mjs` with
     `gen-manifest.mjs` via the Fandom wiki, `extract_icon.py` via nanoka)
     consolidated, after measuring which of them is still live. Dead code is
     removed (CLAUDE.md).
4. **Capture steps,** once `ECHO-CAPTURE-SPEC.md` Phase 1 exists.
5. **Project skill `.claude/skills/update-game-version/`**, written AFTER the
   first real run (3.7) through phases 1–3, from that run's experience, not
   from this spec.
   - **Thin layer.** The skill holds no procedure. Step order, inputs, outputs,
     checks and stop conditions stay in `steps.json` and `update.mjs`, where
     tests cover them. The skill says when to run which command, what to tell
     the maintainer at a USER step, and what to do at a GATE.
   - **Resume from the repo, not the chat.** Every invocation starts with
     `update.mjs status` and continues at the next unfinished step, so a new
     session, a compact or a restart loses nothing.
   - **USER steps.** The skill prints the exact instructions (e.g. the FModel
     selection from `check-export.mjs --list`), stops, and resumes when the
     maintainer confirms. The following AUTO check, not the confirmation,
     decides whether the step succeeded.
   - **Gates stay hard stops.** The skill never answers the review gate or the
     in-game checks itself, and never installs without a recorded
     `decision: install`.
   - **Privacy.** No paths or keys in the skill; those live in `local.json`.

## 11. Decisions

1. Folder name: `update-game-version/` (maintainer, 2026-10-18), kebab-case like the rest of the repo.
