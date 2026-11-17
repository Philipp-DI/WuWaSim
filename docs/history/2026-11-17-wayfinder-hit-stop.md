# 2026-11-17 — Wayfinder: decide how the sim models attacker hit-stop

Map: #43. Ticket resolved: #76 (grilling). The decision itself lives in the resolution comment on #76.

## [Files Changed]
- `docs/GLOSSARY.md`: **hit-stop** is sharpened (attacker hit-stop slows the attacker's whole animation, and buffs and cooldowns keep running at full speed; the old text is struck through). New term: **montage time / world time**.
- `docs/history/2026-11-17-wayfinder-hit-stop.md`: this file.

## [Logic Altered]
None in code. Decided:
- A build-time extractor converts montage times to world time and records `hitStopSeconds`.
- Spill past the step end goes onto that step.
- An uncomputable step gets `null` plus a reason code.
- Co-Op and weak-point hit-stop are out of scope.
- Its own roadmap step, before #66.

Tracker changes:
- #76 closed with its resolution comment.
- Filed #79, a grilling ticket and child of the map: *Decide the fidelity priority: every effect and condition computed correctly, ahead of second-exact timing*. Where the hit-stop step lands waits on it.
- Filed #80, a low-priority bug: the 20 buffs whose duration slows during hit-stop.
- Map: one line added under Decisions so far, and #80 added to the bug list under Not yet specified.

## [Verification Method]
The ticket was resolved by grilling the maintainer on the verified findings of #74 and #75. No code ran, so no tests were needed.

## [Residual Risks]
- The curve depths are heuristic (hypothesis, unverified).
- The ±15 % tolerance on the 34.7 s total is a judgement call.

## [Updated Docs]
`docs/GLOSSARY.md` (see above).
