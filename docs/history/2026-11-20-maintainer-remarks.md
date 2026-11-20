# 2026-11-20 — Maintainer remarks after roadmap steps 0, 1, 2 and 6

## In plain terms

The maintainer reviewed the session's results and gave four remarks. No code
changed. Each remark is now recorded in the roadmap, in an issue, or both.

1. **Kit view (step 2, #100).** #59 was too ambitious. The build page's ability
   cards are a simplified quick check of how gear (weapon, echoes, sonatas)
   moves damage: solo, no external buffs, each ability a cold standalone cast.
   Deviation from the sim is expected. The step is unblocked, with a narrowed
   proof.
2. **Coordinated Attack DMG (#116).** Step 0 showed the pipeline lacks a
   category the game has: Coordinated Attack DMG most likely carries its own
   damage-type id and must be read as one.
3. **Unison (#117) and new-id robustness (#118).** The 3.7 mechanic "Unison"
   (Hsin, Suoming; Jinhsi already had it) is only partly wired. More
   generally, the codebase must notice and absorb newly added effect and
   mechanic ids quickly on every game update.
4. **Segment order.** The in-game order is Intro → rotation → Outro →
   off-field. Off-field actions start when the resonator is switched out
   (normally its Outro; a swap without enough Concerto Energy switches out
   without one). The session report and the step-6 history file listed
   off-field before Outro.

## [Files Changed]

- `docs/specs/ROADMAP.md`: step 2 gains a **Scope** line; its **Proof** is narrowed (the old sentence is struck through); **Decided in** names #100.
- `docs/history/2026-11-20-step-2-kit-view-finding.md`: a **Resolution** section.
- `docs/history/2026-11-20-step-6-segment-seam.md`: the order in "In plain terms" is corrected (the old text is struck through).
- this file.

## [Logic Altered]

None.

## [Verification Method]

The order remark was checked against the code before it was recorded:
- `team-sim.js:303-308` runs each turn as `runIntroSegment` → `runRotationSegment` → off-field pricing → `recordOutroSwap`. Off-field pricing is placed inside that turn, but it prices the OTHER members' actions inside this member's window (`windowStart = sim.cursor - rotTime`, `team-sim.js:1153`). For any one member, its off-field damage therefore always falls after its own switch-out.
- Every shipped off-field action has a trigger, and is skipped until that trigger has fired (`off-field.js:189`, `sim.firedTriggers`):
  - liberation: Zhezhi, Mortefi, Verina, Cantarella
  - outro: Galbrena, Calcharo, Rover: Havoc
  - forte: Yinlin
  - skill: Yuanwu

  So a member who has not played yet contributes nothing.
- The code order matches the in-game order. The mismatch was in wording and in the declaration order of `SEGMENT_KIND` and the tables in `src/core/team-segment.js` (INTRO, ROTATION, OFF_FIELD, OUTRO). Those are to be reordered when the file is next touched (recorded on #104, no code edit now).

Measurements behind the new issues (2026-11-20):
- `damage.json` `Type` takes the values 0–7 and 9–12. 0–5 are mapped, and step 15 maps 7. The unmapped values have these row counts: 6 (107), 9 (19), 10 (20), 11 (9), 12 (26).
- Unison: role tag 39 (`effects.mjs:1074`) and the Boon recipient gate (`resonators.mjs:119-127`, hypothesis) exist. No code models [Unison] standing in for Concerto Energy on a swap.

GitHub:
- New issues, all `needs-triage` and cross-linked: #116 (Coordinated Attack), #117 (Unison), #118 (robustness).
- #100: a comment records the decision; the body now mirrors the roadmap.
- #104: a comment records the order correction.
- #88, #113, #12: comments link the new issues.

## [Residual Risks]

- The kit-view scope is stated in the maintainer's words. Which effects count as "unconditional" is decided when step 2 is built. The reading recorded here: the static hit inputs (weapon and set amplify scopes and target mods) are gear and count; cast-entered states and windows do not.
- #116's link between Coordinated Attack and one of the unmapped damage tags is a hypothesis, unverified.
- The new issues are not placed on a roadmap step; that is the maintainer's call.
- Off-field actions are priced only during other members' rotation segments, not during their Intro or Outro casts. This was noted on #104 and is unmeasured.

## [Updated Docs]

- `docs/specs/ROADMAP.md` (step 2), the two history files above, and this file.
