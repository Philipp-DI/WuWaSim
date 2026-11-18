# 2026-11-18 — Wayfinder: every open issue placed on a roadmap step (#84, #43)

## In plain terms

All 38 open bugs and requests now sit under the engine change they wait on, or are marked as fixable right away. Two new candidate steps came out of it: Outro buffs read from the game's buff table, and one gauge walk shared by the sim and the rotation checker. A new rule ("an unresolved scope or recipient is refused, never widened") puts Youhu's Outro bug and Kumokiri first in line.

## [Files Changed]

- `docs/GLOSSARY.md`: new project term **gauge walk** (avoid "resource walk").
- `docs/history/2026-11-18-wayfinder-issue-placement.md` (this file). No code.

## [Logic Altered]

None in code. Tracker only:
- #84: claimed, resolved by grilling with the maintainer, resolution comment with the full placement table posted, closed.
- #97 created (`wayfinder:research`, sub-issue of #43): can the `20022NN` Outro buff family be joined to resonators by structure? Not blocking #85; the candidate step has a regex-patch fallback. Its research agent was not started (one ticket per session).
- Map #43: a Decisions-so-far line for #84.

## [Verification Method]

Code checks for the two facts the decisions rest on: Pattern D's All-DMG fallback (`tools/preprocess/resonators.mjs:404-411`) and the `RESOURCE_DEFS` shape (printed with Node: a list of gauges per resonator, e.g. 1211 has three). The `20022NN` facts are quoted from #65, not re-derived. Issue placements are judgements confirmed by the maintainer, not measurements.

## [Residual Risks]

- #9 (Phase E) was not in #84's list; it stays under "Not on the roadmap" per #83.
- #24 is marked "number change?": the ambiguous-row count is not re-measured.
- The `20022NN` join is a hypothesis until #97 resolves.

## [Updated Docs]

`docs/GLOSSARY.md` (gauge walk). The decisions live on #84.
