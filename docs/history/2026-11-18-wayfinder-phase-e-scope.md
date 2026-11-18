# 2026-11-18 — Wayfinder: Phase E ruled out of the roadmap (#83, #43)

## In plain terms

The auto-optimizer's last phase (#9) finds the best rotation and gear for a character by itself. It is not a roadmap step: it consumes the engine's numbers, and the roadmap fixes those numbers first.

## [Files Changed]

- `docs/history/2026-11-18-wayfinder-phase-e-scope.md` (this file). No code.

## [Logic Altered]

None. Tracker only:
- #83: resolution comment posted (maintainer, grilling), issue closed.
- #9: comment listing the roadmap steps Phase E waits on (#50, #63, #76, #66, #87–#96, #59). Its B/D completeness check stays its own first step and was not verified.
- Map #43: a Decisions-so-far line, and Phase E added to Out of scope.

## [Verification Method]

The map body was re-read after editing (the #83 decision line and the Out of scope line are present). The cost figures (about 6 % hit-stop, median 25 % for Youhu's Outro) are quoted from closed research tickets #74 and #81, not re-derived.

## [Residual Risks]

- #84 (Place each open issue on a roadmap step) must place #9 under "Not on the roadmap", not on a step.
- Whether Phases B and D shipped is still a hypothesis, unverified.

## [Updated Docs]

None in the repo beyond this file; the decision lives on #83.
