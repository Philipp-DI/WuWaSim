# 2026-11-17 — Wayfinder: decide the fidelity priority

Map: #43. Ticket resolved: #79 (grilling). The decision itself lives in the resolution comment on #79.

## [Files Changed]
- `CLAUDE.md`: new PRINCIPLES bullet **Effects exact, timing within budget**.
- `docs/PRINCIPLES.md`: the maintainer's 2026-11-17 ruling, quoted verbatim, added as a refinement under item 1 of the north star (why / how to apply). The 2026-07-31 text is unchanged.
- `docs/GLOSSARY.md`: new term **simplification**.
- `docs/history/2026-11-17-wayfinder-fidelity-priority.md`: this file.

Separately committed first (`40e8c0b`): the uncommitted outputs of the #76 session (`docs/GLOSSARY.md` hit-stop terms, `docs/history/2026-11-17-wayfinder-hit-stop.md`).

## [Logic Altered]
None in code. Decided:
- Effects, conditions, values and stacks are exact. Only *when* an event lands may be simplified.
- The threshold is ≤ 1 % of DPS on every reference rotation (worst-case member). It acts after the fact: a measured overrun is a bug.
- Record: a tagged code comment only, with cost measured or `unmeasured`. No registry file, because simplifications usually exist before anything can measure them (maintainer).
- Roadmap order: seam (#50), then enemy timeline (#63), then hit-stop (#76), then resolver (#66), then intro/outro buffs.

Tracker: #79 closed with its resolution comment, and the map's Decisions-so-far line appended. No fog graduated.

## [Verification Method]
`tests/instruction-files.test.mjs` (CLAUDE.md is 189 lines and 14.6 KB, under the 200-line and 15 KB limits), plus `npm run sweep`, `npm run lint` and `npm test`.

## [Residual Risks]
- The 1 % threshold has no automated check. An overrun is only caught if someone measures the cost.
- No existing code carries the `Simplification (` tag yet. Existing timing shortcuts, such as the freeze-fraction estimate in `src/core/sim.js`, are not retro-tagged. That happens when each one is next touched.

## [Updated Docs]
The `CLAUDE.md` rule is new, not a rewrite, so it needs no `docs/history/rules/` entry. `docs/PRINCIPLES.md` and `docs/GLOSSARY.md` gain additions only.
