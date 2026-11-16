# 2026-11-16 — docs/ restructure (grill-with-docs session)

A review of the whole `docs/` folder with the maintainer, run as a grilling
session (decisions Q1–Q16), then executed in one commit.

## Decisions (maintainer, 2026-11-16)

- **Q1/Q8 — living vs archive.** Top-level `docs/` keeps only documents that
  describe how things work NOW or specs not yet fully built. Finished plans,
  phase instruction sets, handovers and investigations move unchanged to
  `docs/history/archive/` (index: its `README.md`). A partly shipped plan is
  archived and its open remainder becomes a GitHub issue.
- **Q2 — one backlog.** GitHub Issues. `OPEN-ITEMS.md` is frozen (archived) like
  `HISTORY.md`; items migrate only when worked on.
- **Q3 — glossary holds meanings only.** Code pointers moved to the new
  `ARCHITECTURE.md` §8; the game-data vocabulary table stays as it was.
- **Q4 —** `effectStacks` is canonical; `effectToggles` is marked retired.
- **Q5 —** "anchor" splits into **team anchor** and **anchor build**.
- **Q6 —** one round through all members is a **team cycle**; "pass" stays a
  generic word and is not defined. (Maintainer's own answer, overriding the
  proposal to reserve "pass" for team cycles.)
- **Q7/Q12 —** generated reports live in `docs/reports/` and are tracked; the
  two `docs/cast-time-*.mjs` scripts (nothing imported them) and the
  local-only `docs/uml/` were deleted.
- **Q9 —** specs are files in `docs/specs/`, each with one tracking issue.
- **Q10 —** `docs/adr/` started with four backfilled ADRs; PRINCIPLES.md unchanged.
- **Q11/Q13 —** prose in ARCHITECTURE and the rules files says "team cycle" now;
  code identifiers follow when each file is next decomposed (naming rule 6),
  tracked in issue #13. `passes` in `wuwa-meta.json` needs its own decision.
- **Q15 —** a citation of a document that no longer exists is removed.
- **Q16 —** new issues are labelled `needs-triage` for the maintainer.

## Measured deviations from what was agreed

- **VERSION-UPDATE-SPEC is NOT built.** Q9 assumed it was; its §10 shows
  phases 2–4 open (`update.mjs` still prints "Not automated until Phase N"). By
  the Q8 rule it went to `docs/specs/`, not the archive, with issue #12.
- **SIMPLIFICATION-PLAN is complete** (S1–S5), not partly done as Q8 said; no
  issue was opened for it.
- **AUTO-OPTIMIZER-ENGINE-PLAN:** phases B and D read as shipped (the gauge
  engine; P13), a hypothesis, unverified, recorded in issue #9; only Phase E is open.
- **Rover ids.** ARCHITECTURE §2 said the dataset keeps the female Rover ids.
  The nanoka sources say 1309/1406/1501 are `sex: Male` and 1604 is `Female`,
  as `.claude/rules/invariant-rover.md` already stated. ARCHITECTURE corrected;
  ADR 0003 records the real decision (one entry per element, gender cosmetic,
  female timings), not the "one female Rover" wording proposed in Q10.
- **Tune Break Boost.** The glossary said base 0 (`WeaknessTotalBonus`);
  `invariants-extraction.md` measures attribute 142 (`WeaknessMastery`), base
  10 on the seven Tune-family responders. Glossary corrected.
- **`teamBuffTimeline`** no longer exists in code; the ledger is `sim.timeline`,
  read by `timelineWindowsFor`. ARCHITECTURE corrected.
- Of the two citations thought broken, `map-timings.mjs` → 
  `TIMING-EXTRACTION-HANDOVER.md` was a line-wrapped valid one; only
  `TIMING-DATA-SOURCING.md` was removed.

## [Files Changed]

- Moved (git mv): 30 docs → `docs/history/archive/`; `ECHO-CAPTURE-SPEC.md`,
  `VERSION-UPDATE-SPEC.md` → `docs/specs/`; `RESONATOR-ROSTER.md`,
  `skill-join-report.md`, `timing-gaps-report.md` → `docs/reports/`.
- Newly tracked in `docs/reports/`: `effect-audit.md`, `effect-reconciliation.md`,
  `meta-validation.md`, `timing-extraction-report.md`.
- Deleted: `docs/cast-time-drilldown.mjs`, `docs/cast-time-sensitivity.mjs`,
  `docs/uml/` (untracked), `docs/plans/`.
- New: `docs/adr/0001…0004`, `docs/history/archive/README.md`, this file.
- Rewritten: `docs/GLOSSARY.md`, `docs/ARCHITECTURE.md` (§2, §3, §4, §5, §7, new §8),
  `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, `README.md` (docs tree).
- Citation paths updated in 53 files across `src/`, `tools/`, `tests/`,
  `.claude/`, `.github/`, `update-game-version/`, `CLAUDE.md`, `eslint.config.js`;
  report writers (`audit-effects.mjs`, `optimize.mjs`, `build-skill-join.mjs`,
  `map-timings.mjs`, `reconcile_effects.py`) now write to `docs/reports/`.
- `.gitignore`: dropped the `docs/uml/` and four report entries.
- `data/wuwa-meta.json`, `data/data-version.json`: regenerated (LOCK B).

## [Logic Altered]

None in the engine. Engine files changed in comments only, which moved
`engineHash`; the meta was regenerated and differs only in `engineHash` and
`generatedAt` (252 scenarios). Report writers changed only their output path.

## [Verification Method]

`npm run sweep`, `npm run lint` (0 errors), `npm test` (88/88), all run after
the last edit; LOCK B diff inspected by hand. GitHub issues #8–#13 created.

## [Residual Risks]

- Archived documents keep their original internal paths (`docs/<NAME>.md`);
  their README says to look for the same name in the archive.
- Bare filename citations in code (e.g. `RESONANCE-MODE-SPEC.md §5`) were
  rewritten to full paths; any citation spelled without `.md` (e.g.
  "OPEN-ITEMS #2") still names the archived file by title only.
- `docs/reports/timing-extraction-report.md` is now tracked in a public repo and
  carries a local FModel export path; the same path was already in three
  tracked files.
- Tracking `meta-validation.md` means every `npm run meta` shows a diff in it.

## [Updated Docs]

See Files Changed. Rules files changed wording only ("pass" → "team cycle",
two stale facts in `data-pipeline.md`), so no `docs/history/rules/` entries.
