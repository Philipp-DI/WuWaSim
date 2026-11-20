# 2026-11-20 — Roadmap step 6: segment seam (#104)

## In plain terms

Every part of a team run (Intro, rotation, off-field actions, Outro) now goes
through one function. Two small tables state what each part reads from the team
and what it carries forward, so the known gaps (Intro and Outro miss Tune
Strain, the DEF target and team buffs) are written down instead of hidden in
four hand-written calls. A part that produces nothing now says why. No number
changes.

## [Files Changed]

- `src/core/team-segment.js` (new): `runSegment`, `SEGMENT_KIND`, `SEGMENT_REASON`, `TEAM_INPUTS_READ`, `CARRY_READ`, `CARRY_WRITTEN`, `emptyCarry`. The intro/outro key lookups moved here.
- `src/core/team-sim.js`: the four segment stages call `runSegment`. `sim.memberFires` / `memberResources` / `memberResourceTicks` became one `sim.memberCarry`. Removed: `simulateIntro`, `simulateOutro`, `introKeyFor`, `outroKeyFor`, the local fire-shift helpers, and the now-unused `simulateRotation` import. Intro and Outro segments gain `reason` when they produced nothing.
- `tests/team-segment.test.mjs` (new).
- `data/wuwa-meta.json`, `data/data-version.json`: `engineHash`, `generatedAt` and the manifest hash only.
- `docs/ARCHITECTURE.md`: code-name rows for cross-segment carry and team context.
- this file.

## [Logic Altered]

- **Inputs.** `runSegment(kind, member, teamContext, carry) → { result, carry, reason? }`. Each kind passes `simulateRotation` only the team inputs `TEAM_INPUTS_READ[kind]` names. The tables are exactly what each call passed before:
  - intro: `target`, `amplifyContext`, `externalBuffWindows`
  - outro: `target`, `externalBuffWindows`
  - off-field: everything except `amplifyContext`
- **Carry.** Read and written per `CARRY_READ` / `CARRY_WRITTEN`. Fires are shifted between the team clock and the segment clock inside the seam. A segment with no result returns the carry unchanged; that is the old intro rule. On a real result both gauge fields are always Maps, so "write when produced" equals the rotation's old unconditional write.
- **Failures.** Intro and Outro failures return a reason (`noIntroKey`, `noOutroKey`, `outroPaidOffField`, `missingSteps`, `threw`) instead of a bare `null`. Rotation and off-field exceptions still propagate, as before.
- **Deviation from #50's wording.** "The team context is built once per team cycle." It is built per segment instead, because its contents (the timeline windows at the cursor, the enemy statuses at the cursor, the member's DEF target) change within a team cycle. It is read-only either way: `runSegment` never writes to it.

## [Verification Method]

- **Full-output snapshot, before and after.** Every distinct meta team (345) was simulated twice: 3 team cycles, openers on, `enforceConcerto` false and true. That is 690 runs, and every field of the result was serialised, including each segment's steps and its sim totals. 690 of 690 are byte-identical once the new `reason` field is removed. `reason` appears on 3,066 outro segments as `noOutroKey` (42 of 60 resonators ship no Outro damage row) and on 104 as `outroPaidOffField` (Galbrena, Calcharo, Rover: Havoc). No intro segment carries one.
- **Tests.** `tests/team-segment.test.mjs` passes 20 checks: the input and carry tables, an unread input not reaching the Outro, the reason codes, the carry crossing the clock, and team-sim reading `totals.skillDamage` (never `totals.damage` / `totals.statusDamage`).
- **LOCK A**: `generatedAt` only. **LOCK B**: `generatedAt` and `engineHash` only (`team-sim.js` is in the engine set).
- `npm run sweep` 0 failed; `npm run lint` 0 errors, 5970 warnings (unchanged). The first draft added `reason` with a conditional spread, which pushed `recordOutroSwap` to complexity 13; the stop hook caught it, and a plain `reason` field (undefined when there is a result, so JSON output is unchanged) brought it back. The snapshot was re-run after that edit: 690 of 690 identical. `npm test` 92/92.

## [Residual Risks]

- The snapshot covers the 345 meta teams with the optimizer's representative builds at chain 0. User builds at higher chains exercise the same code paths, but those inputs were not snapshotted.
- `reason` is a new field on intro/outro segments. No UI surface shows it yet; the team page renders segments as before.
- Intro and Outro segments now carry a `reason` key (undefined when they produced a result). Code that enumerates segment keys sees one more; none in the repo does.

## [Updated Docs]

- `docs/ARCHITECTURE.md`: cross-segment carry and team context now name `runSegment` and its tables (old names struck through).
