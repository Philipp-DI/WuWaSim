# 2026-11-21 — Roadmap step 2: kit view and static hit inputs (#100)

## In plain terms

The build page's ability cards and its top strip now price each ability with
the same gear inputs the sim uses: weapon and sonata amplify, DEF ignore and RES
shred. One core function (`staticHitInputs`) defines those inputs, and both the
sim and the new kit view (`kitView`) call it. Hiyuki's Blade Liberation card on
Frostburn reads 9,310.8 (was 6,910.3), the sim's own price. No sim number
moved. The live substat weights (`kitMeasure`) still use the old card price;
that is step 3.

## [Files Changed]

- `src/core/static-hit-inputs.js` (new): `staticHitInputs`, `amplifyScopesOf` (was the private `sim.js weaponAmplifyScopes`).
- `src/core/kit-view.js` (new): `kitView`.
- `src/core/sim.js`: the gear amplify / target-mod assembly calls `staticHitInputs`; `weaponAmplifyScopes` removed.
- `src/core/skill.js`: dead `resolveAllSkills` deleted, along with its now-unused `effectiveSkillMap` import.
- `src/ui/components/build-editor/strips.js` (`abilityAverages`) and `ability-overview.js` read `kitView`.
- `tests/kit-view.test.mjs` (new).
- `data/wuwa-meta.json`, `data/data-version.json`, `data/wuwa-data.json`: `engineHash` / `generatedAt` / manifest hash only.
- `docs/GLOSSARY.md`, `docs/ARCHITECTURE.md`.

## [Logic Altered]

- **Sim:** none. Amplify order is unchanged: Outro amplify, weapon, sonata, then team-wide. Target mods are unchanged too: weapon, then sonata.
- **Cards and strip:** `resolveSkill` now receives `amplifyContext` and `targetContext` from `staticHitInputs({ build, dataset })` (solo: no enemy statuses, no team buffs). For gear without per-hit inputs, both arrays are empty, which `resolveSkill` treats the same as `null`. The support-only row now guards against a null support result; before, `supportRows.filter` would have thrown on it.
- Effects: unconditional only. This was already true: with no `activeEffects`, `resolveSkill` falls back to `collectActiveEffects`.

## [Verification Method]

- `tests/kit-view.test.mjs` (20 checks):
  - Hiyuki + Frostburn: every ability equals its one-cast sim step, and Blade Liberation is 9,310.8 against the old 6,910.3.
  - Target-mod weapons (Yuanwu + Moongazer's Sigil, Liberation DEF ignore; Hsin + Blooming Jadehaven, Skill RES shred): every ability without its own buff window equals the sim, and at least one card moves.
  - Stonard control: no inputs, no card moves.
  - Roster-wide on blank builds: 1,195 cards; 1,160 equal the sim. The other 35 are all explained: 34 have a buff window of their own active, and 1 is a chain-lock substitution (below). The test asserts 0 unexplained.
  - Denia's Final Act is the named expected deviation.
- **Measured size** (scratch probe, not committed), on the optimizer's `representativeMemberBuild` per resonator: **213 of 1,195 cards move**, on 18 resonators. The largest moves are +56.25%: Iuno ×5 and Xiangli Yao `forte_heavy_revamp`, both on Moongazer's Sigil, and that figure is inflated (see Residual Risks). On blank builds with each resonator's suggested weapon, only Hiyuki moves (24 cards, max +34.74%). The roadmap's "105 of 450" counted cards that now EQUAL the sim on the step-2 finding's probe, which is a different count from cards that move. Both are recorded here; neither is re-derived from the other.
- LOCK A: `generatedAt` only. LOCK B: `engineHash` and `generatedAt` only, so the sim is zero-diff.
- `npm run sweep`, `npm run lint` (no new warnings; the stop hook caught a complexity-15 `staticHitInputs` in the first draft, now split), `npm test`.
- ~~Not verified: the browser smoke test of the build and team pages (no browser tool in this session).~~ Run later the same day with the new `npm run smoke`: PASS on Hiyuki's build and team pages (`2026-11-21-smoke-script.md`).

## [Residual Risks]

- **Moongazer's Sigil pays its DEF ignore twice (pre-existing sim bug, now also on the cards).** `weaponConditionalContribution` returns two identical `{ liberation, defIgnore: 0.36 }` target mods. The weapon text says 7.2 % per stack, up to 5 stacks, so the ceiling is 36 % (either through Shield stacks, or at max immediately on Intro). The data appears to ship the two routes as two grant rows, and `foldExternalGrants` refuses overlapping scopes only for amplify, not for target mods. Result: 72 % DEF ignore, ×1.5625 on Liberation DMG at level 90 vs 90. It is the only weapon with a duplicated target mod. Hypothesis, unverified: the two rows are alternative branches of one buff, like Lux & Umbra's cap branches. Not fixed here; it is a separate number change, filed as #119.
- **Live weights and the strip disagree until step 3.** `kitMeasure` still prices without gear inputs. For a build whose weapon has amplify or target mods, the live-weights kit base no longer equals the strip's OVERALL AVG (`.claude/rules/invariants-optimizer.md`, "Live weights fall back to the KIT"; `docs/PRINCIPLES.md`). `tests/build-editor-v2.test.mjs` asserts this identity only on four blank builds, so it still passes.
- **Chain-locked keys get a card below their chain.** At S0, Lupa's `forte_heavy_dance_with_the_wolf_climax` (S6 only) shows 5,215.7, while the sim casts the base move for that input (3,863.6). This is not from this step; the card did it before too.
- The kit view prices with no enemy statuses, so a weapon or sonata gated on an enemy status counts as unsatisfied on the cards. Solo `simulateRotation` passes the same null.

## [Updated Docs]

- `docs/GLOSSARY.md`: **kit view** and **static hit inputs** now name their modules, and kit view states the cold-cast scope (old text struck through).
- `docs/ARCHITECTURE.md`: conditional-clauses row points to `staticHitInputs` (old name struck through).
