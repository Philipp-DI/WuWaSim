# 2026-11-20 — Roadmap step 2: kit view, blocked on a decision (#100)

## In plain terms

The build page's ability cards disagree with the sim for 450 of 1,198
abilities, not only the weapon-amplify ones. Giving the cards the sim's
weapon and set inputs fixes 105 of them. The other 345 differ because a cast in
the sim switches on its own buffs (a state it enters, a set or weapon window it
opens). The roadmap asks for a kit view that matches a one-cast sim and is not
itself a one-cast sim. Matching would mean copying the sim's step machinery, so
the maintainer decides before any code is written. No code changed.

## [Files Changed]

- this file only.

## [Logic Altered]

None.

## [Verification Method]

A scratch probe (not committed). For every resonator, it takes
`representativeMemberBuild` (the optimizer's build), the `DEFAULT_TARGET`, and
every ability key of `effectiveSkillMap`, and compares three prices:

| Price | Abilities differing from a one-cast `simulateRotation` step (of 1,198) |
| --- | --- |
| (a) the card today: `resolveSkill`, no amplify, target or windowed effects | 450 |
| (b) (a) plus the sim's static hit inputs (weapon and set amplify scopes, weapon and set target mods; `sim.js:524-539`) | 345 |

Examples still off after (b), with what the one-cast step carries (`step.states`, `step.activeBuffNames`):

| Resonator | Ability | (b) | one-cast sim | step carries |
| --- | --- | --- | --- | --- |
| Lingyang | liberation | 27,624 | 33,839 | state `lion's vigor`; +36 % Resonance Skill DMG, +22.5 % Glacio DMG |
| Carlotta | liberation | 26,866 | 42,583 | state `twilight tango`; same two windows |
| Hiyuki | heavy_bitterfrost_fore | 45,095 | 58,624 | state `present self`; +30 % Glacio DMG |
| Suisui | basic_zephyr_stance_1 | 2,424 | 2,667 | +10 % Glacio DMG |

## [Residual Risks]

- The contradiction, for the maintainer. #59 Q2 says "Kit view is a dedicated core function, not a one-cast sim per ability", **and** its proof is "every ability's kit-view price equals a one-cast sim step … windowed chain/inherent effects included". For 345 abilities the one-cast step includes effects the cast itself starts (cast-entered states, `thisCast` windows, set and weapon windows opened by the cast). A dedicated function can match only by reproducing the state timeline, the buff windows and the step-0 effect resolution, which is the sim. Options:
  1. The kit view runs a one-cast sim per ability (the step's `resolved`). Exact by construction; reverses Q2's "not a one-cast sim".
  2. The kit view is static inputs plus unconditional effects only. 345 cards stay below the sim, and the test compares only the static part (a narrower proof than Q2 states).
  3. As option 2, but the card also shows the one-cast sim price as "on cast".
- The probe uses the optimizer's representative builds, not user builds; counts on other builds will differ.

## [Updated Docs]

None.
