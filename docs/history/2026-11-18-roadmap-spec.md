# 2026-11-18 — Roadmap spec written; wayfinder map complete (#86, #43)

## In plain terms

The roadmap is now a file, `docs/specs/ROADMAP.md`: 21 steps plus Youhu's Outro fix first, then the stand-alone fixes and what is not on the roadmap. Every step and every placed fix is a GitHub issue under one tracking issue, and GitHub's "blocked by" marks show what can start next. The wayfinder map has no open tickets left. From here the work is ordinary issues.

## [Files Changed]

- `docs/specs/ROADMAP.md` (new): the spec, in the format decided on #82, with the order and proofs from #85, placements from #84 and Step 15 from #97.
- `docs/history/2026-11-18-roadmap-spec.md` (this file).

No code.

## [Logic Altered]

None in the repo. Tracker:

- **Tracking issue** #98 "Spec: Roadmap (docs/specs/ROADMAP.md)".
- **Step issues:** 17 new (#99–#115, Steps 1–17). Maintainer decision: steps that are exactly one existing issue reuse it, so Step 0 = #88, 18 = #39, 19 = #18, 20 = #95, 21 = #19 (each got a comment naming its step).
- **Sub-issues of #98:** the 22 step issues and the 27 stand-alone fixes (49).
- **`blocked_by` edges:** 20 between steps (mirroring "Depends on"), 6 "before Step N" (maintainer decision: the step waits on the fix), 16 "after Step N" (the fix waits on the step).
- #86 resolved and closed; map #43 got its last Decisions-so-far line. The map is left open for the maintainer to close.

Deviation from the #85 table, consistent with #84: Step 16 depends on Step 0 (#88), because #84 places the Youhu fix before the intro/outro team buffs.

## [Verification Method]

- Every in-page anchor in the spec was checked against the generated heading anchors (no misses).
- Every issue title in the spec was taken from `gh issue list`; two curly-quote mismatches were fixed.
- The sub-issue and edge API calls each reported success; the tracking issue's sub-issue list was re-read afterwards.
- Sizes in the spec are quoted from closed tickets (#44, #46, #48, #59, #60, #66, #76, #81), not re-derived.

## [Residual Risks]

- The spec links from step-issue bodies (`blob/main/docs/specs/ROADMAP.md#…`) 404 until the commit is pushed.
- Step issues carry no triage label; they were triaged by the map.
- Steps 3, 10, 13 (team-DPS), 15, 18–21 have no measured size in advance; their issues must add one before work starts (§2's rule).

## [Updated Docs]

`docs/specs/ROADMAP.md` (new). The map's decisions stay on their tickets.
