# Roadmap — Specification

> **STATUS: SETTLED 2026-11-18 (maintainer review).** The ranked, dependency-ordered plan for the
> engine refactors and the open bug clusters. Settled on the wayfinder map
> [Wayfinder: roadmap for the best way forward (architecture + backlog)](https://github.com/Philipp-DI/WuWaSim/issues/43).
> Tracking issue: [Spec: Roadmap (docs/specs/ROADMAP.md)](https://github.com/Philipp-DI/WuWaSim/issues/98).
>
> This file is the plan of record. It changes only when the plan changes, and
> those edits use strikethrough. Progress lives on each step's issue (the Step
> column of the order table links it); what happened lives in `docs/history/`.

## 1. In plain terms

The roadmap is 21 steps plus one fix that goes first. Steps that only
reorganise code must leave every number identical. Steps that change numbers
say beforehand which numbers move and by how much, and record what actually
moved. The steps form a dependency graph: the rank is the recommended order,
but a step whose dependencies are done may start earlier or run in parallel.

Fidelity to the game wins over maintainability. A refactor earns its place by
making specific fixes possible or safe, not by being cleaner (standing goal,
2026-07-31; CLAUDE.md, "Effects exact, timing within budget").

## 2. Proof rules

Every step names one proof kind.

- **Zero-diff.** LOCK A (`npm run data`) and LOCK B (`npm run meta`) are
  byte-identical before and after (`.claude/rules/generated-data-locks.md`).
- **Number change.** Three parts:
  1. the LOCK B diff of `wuwa-meta.json` (every reference rotation and team
     ranking);
  2. a per-resonator before/after DPS table that names the largest movers;
  3. both recorded in that session's `docs/history/` file.

  The step's issue states **in advance** which numbers move and by roughly
  how much. A change outside that expectation stops the step.
- **UI number change.** A test on a named example, the measured size in the
  history file, and a browser smoke test of the build and team pages.

Two ordering rules follow from the proofs:

- **One step per number change**, so each before/after table has exactly one
  cause.
- **A number-changing fix lands between steps, never during a zero-diff
  step**, so it cannot break that step's LOCK comparison. This holds for the
  stand-alone fixes in §5 too.

A placed fix is linked to its step by a native `blocked_by` edge: "after
Step N" makes the fix wait on the step; "before Step N" makes the step wait on
the fix.

## 3. Order

| # | Step | Depends on | Unblocks | Proof kind |
| --- | --- | --- | --- | --- |
| 0 | [Youhu's Outro applied as All DMG](https://github.com/Philipp-DI/WuWaSim/issues/88) (stand-alone, first) | — | 16 | number change |
| 1 | [Effect-slot fingerprint test](https://github.com/Philipp-DI/WuWaSim/issues/99) | — | 4 | zero-diff (test only) |
| 2 | [Kit view and static hit inputs](https://github.com/Philipp-DI/WuWaSim/issues/100) | — | 3 | UI number change |
| 3 | [kitMeasure consumes the kit view](https://github.com/Philipp-DI/WuWaSim/issues/101) | 2 | — | number change |
| 4 | [Freeze phase](https://github.com/Philipp-DI/WuWaSim/issues/102) | 1 | 5 | zero-diff except a one-time key shift |
| 5 | [One appliesToWielder verdict](https://github.com/Philipp-DI/WuWaSim/issues/103) | 4 | — | zero-diff |
| 6 | [Segment seam](https://github.com/Philipp-DI/WuWaSim/issues/104) | — | 7, 8, 9, 12, 21 | zero-diff |
| 7 | [Rotation breakdown and team clock stamps](https://github.com/Philipp-DI/WuWaSim/issues/105) | 6 | — | UI number change |
| 8 | [One enemy timeline](https://github.com/Philipp-DI/WuWaSim/issues/106) | 6 | 10, 12 | zero-diff both ways |
| 9 | [Intro and Outro get Tune Strain](https://github.com/Philipp-DI/WuWaSim/issues/107) | 6 | — | number change |
| 10 | [Intro and Outro get the teammates' DEF target](https://github.com/Philipp-DI/WuWaSim/issues/108) | 8 | — | number change |
| 11 | [Attacker hit-stop extractor](https://github.com/Philipp-DI/WuWaSim/issues/109) | — | 13 | number change |
| 12 | [Per-hit resolver, every hit at step start](https://github.com/Philipp-DI/WuWaSim/issues/110) | 6, 8 | 13, 14, 16 | zero-diff |
| 13 | [Per-hit times fed in](https://github.com/Philipp-DI/WuWaSim/issues/111) | 11, 12 | — | number change |
| 14 | [DMG% window adds into the bucket](https://github.com/Philipp-DI/WuWaSim/issues/112) | 12 | — | number change |
| 15 | [Outro buff extractor](https://github.com/Philipp-DI/WuWaSim/issues/113) | — | 16 | number change |
| 16 | [Intro and Outro team buffs](https://github.com/Philipp-DI/WuWaSim/issues/114) | 0, 12, 15 | — | number change |
| 17 | [Shared gauge walk](https://github.com/Philipp-DI/WuWaSim/issues/115) | — | 18 | zero-diff |
| 18 | [Gauge definitions for all resonators](https://github.com/Philipp-DI/WuWaSim/issues/39) | 17 | 19, 20, 21 | number change |
| 19 | [Gauge income on hit](https://github.com/Philipp-DI/WuWaSim/issues/18) | 18 | — | number change |
| 20 | [Jinhsi's Incandescence](https://github.com/Philipp-DI/WuWaSim/issues/95) | 18 | — | number change |
| 21 | [Team-wide gauge income](https://github.com/Philipp-DI/WuWaSim/issues/19) | 6, 18 | — | number change |

Why this order:

- The freeze track (1, 4, 5) runs first: it guards curated patches that a
  reorder overwrites silently today.
- The kit view (2) comes before the seam because it fixes a live UI error and
  needs no seam.
- Tune Strain (9) and the DEF target (10) land before hit-stop because they
  are live, measured gaps.
- The gauge walk (17) ranks after the timing chain because its legality gap is
  latent (0 of 336 rotation × chain pairs flip). Its edges let it start earlier.

## 4. Steps

### Step 0: Youhu's Outro applied as All DMG

- **In plain terms:** Youhu's Outro boosts Coordinated Attacks by 100 %, but
  the sim gives the whole team +100 % on everything. This is the largest error
  on the map, so it is fixed before any refactor.
- **Goal:** the Outro text parser's Pattern D fallback no longer turns an
  unscoped grant into All DMG. It refuses with a reason code (rule: "an
  unresolved scope or recipient is refused, never widened").
- **Depends on:** nothing.
- **Closes:** this step's own issue, [Youhu's Outro: Coordinated Attack +100 % is applied as All DMG (21–45 % of team damage)](https://github.com/Philipp-DI/WuWaSim/issues/88).
- **Proof:** number change. Teams with Youhu fall, by 21–45 % of team damage
  (median 25 %); no other team moves.
- **Decided in:** [Verify the single-source bug claims (outro-buff cluster, Kumokiri, N hits) and file the confirmed ones](https://github.com/Philipp-DI/WuWaSim/issues/81), [Place each open issue on a roadmap step](https://github.com/Philipp-DI/WuWaSim/issues/84).

### Step 1: Effect-slot fingerprint test

- **In plain terms:** a test that notices when a curated patch would land on
  the wrong effect. Today a reordered pipeline fails no test and silently
  overwrites Sigrika's S6.2 patch.
- **Goal:** every override target and every persisted slot key pins a
  fingerprint of the effect text it addresses, so a shifted slot fails
  `npm test` even without a data regen.
- **Depends on:** nothing.
- **Closes:** nothing.
- **Proof:** zero-diff (test only).
- **Decided in:** [Verify: is the effect-slot freeze enforced only by prose?](https://github.com/Philipp-DI/WuWaSim/issues/47), [Decide preprocessing: a slot-freeze phase or a full effect compiler](https://github.com/Philipp-DI/WuWaSim/issues/51).

### Step 2: Kit view and static hit inputs

- **In plain terms:** the build page's ability cards price each ability
  without the weapon's amplify and target effects, so they disagree with the
  sim (Frostburn Hiyuki's Liberation card: 6,910 vs 9,311). One engine
  function will price the cards with the sim's own inputs.
- **Goal:** the amplify and target-mod assembly (`sim.js:532-539`) moves into
  one core helper, **static hit inputs**, called by both `simulateRotation`
  and the new **kit view**. `strips.js` `abilityAverages` and
  `ability-overview.js` read the kit view. The dead `resolveAllSkills`
  (`skill.js:236`) is deleted.
- **Depends on:** nothing.
- **Closes:** nothing.
- **Proof:** UI number change. A test shows every ability's kit-view price
  equals a one-cast sim step, for an amplify weapon (Frostburn) and a
  target-mod weapon. Named example: Hiyuki's Liberation card 6,910 → 9,311.
  24 of 24 abilities differ for weapons with amplify or target mods.
- **Decided in:** [Verify: do the UI's per-ability numbers differ from the sim's?](https://github.com/Philipp-DI/WuWaSim/issues/48), [Decide what core returns so the UI renders per-ability damage and member timing without computing them](https://github.com/Philipp-DI/WuWaSim/issues/59).

### Step 3: kitMeasure consumes the kit view

- **In plain terms:** the live substat weights use the same card prices, so
  they gain the weapon's amplify and target effects too.
- **Goal:** `live-weights` `kitMeasure` reads the kit view.
- **Depends on:** [Step 2: Kit view and static hit inputs](#step-2-kit-view-and-static-hit-inputs).
- **Closes:** nothing.
- **Proof:** number change. Substat weights may re-rank, only for builds
  without a damaging rotation whose weapon has amplify or target mods. A
  before/after ranking for one amplify-weapon build. Size unmeasured.
- **Decided in:** [Decide what core returns so the UI renders per-ability damage and member timing without computing them](https://github.com/Philipp-DI/WuWaSim/issues/59).

### Step 4: Freeze phase

- **In plain terms:** effect slots get fixed addresses before anything reads
  them, so a curated patch or a saved build can never point at the wrong
  effect again.
- **Goal:** the count-changing passes run, then `freezeEffectSlots()` returns
  a frozen table; overrides accept only that table, and a count change after
  the freeze throws. The freeze covers every namespace saved builds persist:
  `S`, `IH` and `SK`. A removed or suppressed effect keeps its slot as a
  **tombstone**. The doubled generated skill keys (`basic_basic_attack_3`) are
  fixed in the same step, so saved builds migrate once. The CLAUDE.md
  invariant "Effect-slot keys are FROZEN before anything reads them" is
  rewritten when this lands.
- **Depends on:** [Step 1: Effect-slot fingerprint test](#step-1-effect-slot-fingerprint-test).
- **Closes:** [Generated skill keys double the skill type (basic_basic_attack_3)](https://github.com/Philipp-DI/WuWaSim/issues/73).
- **Proof:** LOCK A zero-diff except the one-time key shift (the 4–6 existing
  suppressions becoming tombstones, and the skill-key rename). A migration
  test loads a saved build with the old keys.
- **Decided in:** [Decide preprocessing: a slot-freeze phase or a full effect compiler](https://github.com/Philipp-DI/WuWaSim/issues/51), [Settle the full step order and each step's proof](https://github.com/Philipp-DI/WuWaSim/issues/85).

### Step 5: One appliesToWielder verdict

- **In plain terms:** whether an effect applies to its own wielder is decided
  once, when the data is built, instead of by four markers that two consumers
  ignore.
- **Goal:** preprocessing computes `appliesToWielder` per effect, replacing
  the four runtime skip markers (`buffs.js:313, 322, 447, 455`). All six
  consumers read it, including `teamWideContribution` and
  `afflictionCritMultiplier`.
- **Depends on:** [Step 4: Freeze phase](#step-4-freeze-phase).
- **Closes:** nothing.
- **Proof:** zero-diff (no shipped data hits the gap).
- **Decided in:** [Decide preprocessing: a slot-freeze phase or a full effect compiler](https://github.com/Philipp-DI/WuWaSim/issues/51).

### Step 6: Segment seam

- **In plain terms:** every part of a team run (rotation, off-field, Intro,
  Outro) goes through one door, with the team's inputs passed in and the
  member's running state passed in and back out. Today Intro and Outro miss
  inputs the rotation gets, and errors turn into a silent 0.
- **Goal:** `runSegment(segmentKind, member, teamContext, carry) → { result, carry }`
  for all segment kinds. The team context is built once per team cycle and is
  read-only; the carry replaces the hand write-backs (`team-sim.js:925-927`).
  A segment that produces nothing returns a reason code instead of `null`.
  A test pins "team-sim reads `skillDamage`, never `damage`". The seam
  reproduces today's gaps on purpose; steps 9, 10 and 16 fix them.
- **Depends on:** nothing.
- **Closes:** nothing.
- **Proof:** zero-diff.
- **Decided in:** [Verify: do the four team segment kinds get different team inputs?](https://github.com/Philipp-DI/WuWaSim/issues/44), [Decide the segment seam: read-only context, or continuation in and out](https://github.com/Philipp-DI/WuWaSim/issues/50).

### Step 7: Rotation breakdown and team clock stamps

- **In plain terms:** the team page stops computing its own timeline and
  per-member DPS; the engine stamps them and the page draws them.
- **Goal:** `abilityBreakdown(simResult)`, a pure function over the result.
  Core stamps each step's start and end on the team time axis plus each
  member's game-seconds and DPS; `clockFor` and the page's per-member DPS
  division (`team-editor-v2.js:1123`) are deleted. Until the freeze-model
  question is settled, core stamps the engine's current per-member model.
- **Depends on:** [Step 6: Segment seam](#step-6-segment-seam).
- **Closes:** nothing.
- **Proof:** UI number change; `simulateRotation`'s output stays
  byte-identical (LOCK A / LOCK B zero-diff). Named example: Sanhua's skill
  moves from 13.29 s to 25.79 s on the team page. Team totals are unaffected.
- **Decided in:** [Verify: build-page enemy panel, team-page per-step clock, and the freezeTime comment](https://github.com/Philipp-DI/WuWaSim/issues/58), [Decide what core returns so the UI renders per-ability damage and member timing without computing them](https://github.com/Philipp-DI/WuWaSim/issues/59).

### Step 8: One enemy timeline

- **In plain terms:** all damage from negative statuses is priced in one
  function against one record of the enemy. In a team, the team owns that
  record; a solo build makes its own.
- **Goal:** one function (working name `resolveEnemyStatusDamage`) prices
  per-stack hits, ticks and burst-on-max, and kit-triggered afflictions. In a
  team context, segments price no status damage: they return applications and
  cap raises, and team-sim prices once when the run ends. Solo builds a
  roster-of-one timeline and calls the same function. Today's quirks are kept
  on purpose. The invariant "Status damage: solo builds its OWN enemy, teams
  SHARE one" (`.claude/rules/invariants-status.md`) is rewritten when this
  lands.
- **Depends on:** [Step 6: Segment seam](#step-6-segment-seam).
- **Closes:** nothing.
- **Proof:** zero-diff both ways. The team side passes LOCK A / LOCK B; the
  solo side passes a test that `statusDamage.total` is unchanged across every
  resonator's reference rotation.
- **Decided in:** [Decide one enemy for solo and team](https://github.com/Philipp-DI/WuWaSim/issues/63).

### Step 9: Intro and Outro get Tune Strain

- **In plain terms:** Intro and Outro hits get the Tune Strain amplify the
  rotation already gets.
- **Goal:** the Intro and Outro segments read Tune Strain from the team
  context.
- **Depends on:** [Step 6: Segment seam](#step-6-segment-seam).
- **Closes:** nothing.
- **Proof:** number change. Named example: Luuk Herssen's Outro +54 % at S6.
  Team-DPS size unmeasured.
- **Decided in:** [Verify: do the four team segment kinds get different team inputs?](https://github.com/Philipp-DI/WuWaSim/issues/44), [Decide the segment seam: read-only context, or continuation in and out](https://github.com/Philipp-DI/WuWaSim/issues/50).

### Step 10: Intro and Outro get the teammates' DEF target

- **In plain terms:** Intro and Outro hits see the DEF shred and DEF ignore
  the teammates have put on the enemy.
- **Goal:** the Intro and Outro segments read the team's DEF-shred /
  DEF-ignore target. Status damage changes too, so it lands in the one enemy
  function.
- **Depends on:** [Step 8: One enemy timeline](#step-8-one-enemy-timeline).
- **Closes:** nothing.
- **Proof:** number change. Size unmeasured.
- **Decided in:** [Verify: do the four team segment kinds get different team inputs?](https://github.com/Philipp-DI/WuWaSim/issues/44), [Decide the segment seam: read-only context, or continuation in and out](https://github.com/Philipp-DI/WuWaSim/issues/50), [Decide one enemy for solo and team](https://github.com/Philipp-DI/WuWaSim/issues/63).

### Step 11: Attacker hit-stop extractor

- **In plain terms:** when an attack lands, the game briefly slows the
  attacker's animation. The sim models none of it, so rotations are about
  5.6 % too short. The delay is added to each ability's timing when the data
  is built.
- **Goal:** a step in the timing pipeline (`tools/extract/` →
  `map-timings.mjs`) converts each ability's montage times into world time
  using the bullet table's hit-stop, and records `hitStopSeconds`. It moves
  `stepDuration`, `nextAttAt`, each hit time and `resolvesAt` by one mapping.
  Freeze windows cancel hit-stop; buffs and cooldowns stay in world time.
  Hit-stop that runs past the step end goes onto that step (a recorded
  simplification). An uncomputable step keeps its timing, with
  `hitStopSeconds: null` and a reason code (`noMontage`, `echoSummon`,
  `noHitTimes`, `childBulletUntimed`).
- **Depends on:** nothing.
- **Closes:** nothing.
- **Proof:** number change, DPS about −5.6 %; `engineHash` unchanged (data
  only). Tests: no step gets shorter; the reference-rotation total is
  34.7 s ± 15 %; Cartethyia's Liberation adds 0 s; Xuanling's
  `forte_heavy_azure_sword_stance` adds about 0.54 s; every `null` carries a
  reason code.
- **Decided in:** [Research: does attacker hit-stop delay later bullet spawns?](https://github.com/Philipp-DI/WuWaSim/issues/74), [Research: during attacker hit-stop, do buff timers slow, and which skills cancel it?](https://github.com/Philipp-DI/WuWaSim/issues/75), [Decide how the sim models attacker hit-stop](https://github.com/Philipp-DI/WuWaSim/issues/76), [Decide the fidelity priority: every effect and condition computed correctly, ahead of second-exact timing](https://github.com/Philipp-DI/WuWaSim/issues/79).

### Step 12: Per-hit resolver, every hit at step start

- **In plain terms:** one function decides whether a buff applies to a hit,
  replacing about five matchers that agree today but could drift.
- **Goal:** `isActiveOnHit(modifier, hit, teamContext)` answers scope (skill
  type, attribution, element, target) and time (the window covers
  `hit.time`). The five live matchers and both time gates call it; the dead
  `resolveBuffContext` (`buffs.js:212`) is deleted. In this step every hit
  still sits at its step start.
- **Depends on:** [Step 6: Segment seam](#step-6-segment-seam), [Step 8: One enemy timeline](#step-8-one-enemy-timeline).
- **Closes:** nothing.
- **Proof:** zero-diff.
- **Decided in:** [Verify: is per-hit buff scoping split across the buff lanes?](https://github.com/Philipp-DI/WuWaSim/issues/46), [Decide the per-hit modifier resolver](https://github.com/Philipp-DI/WuWaSim/issues/66).

### Step 13: Per-hit times fed in

- **In plain terms:** buffs are judged at the moment each hit lands, not the
  moment the combo starts. The times come from the game's own bullet data.
- **Goal:** a build-time extractor writes per-hit times
  (`spawn + max(CollisionActiveDelay, 0) + i × Interval`, in world time from
  step 11) for the 397 of 719 multi-hit skills that have them. The other 322,
  and any skill the extractor rejects, keep per-step timing with the reason
  code `noPerHitTime`, and the UI shows "timing per step". Late hits keep
  their real time; step length is unchanged.
- **Depends on:** [Step 11: Attacker hit-stop extractor](#step-11-attacker-hit-stop-extractor), [Step 12: Per-hit resolver, every hit at step start](#step-12-per-hit-resolver-every-hit-at-step-start).
- **Closes:** nothing.
- **Proof:** number change. One step moved −4.8 % to +10 % in the
  measurement; the team-DPS size is unmeasured.
- **Decided in:** [Research: where do per-hit timings come from?](https://github.com/Philipp-DI/WuWaSim/issues/64), [Decide the per-hit modifier resolver](https://github.com/Philipp-DI/WuWaSim/issues/66), [Research: does IntervalScale or hit-stop change the bullet tick schedule?](https://github.com/Philipp-DI/WuWaSim/issues/72).

### Step 14: DMG% window adds into the bucket

- **In plain terms:** a timed DMG% bonus is added to the hit's other DMG
  bonuses, as in the game, instead of multiplying the finished damage.
- **Goal:** the resolver puts a windowed DMG% bonus into the hit's DMG-bonus
  bucket instead of a separate `(1 + b)`.
- **Depends on:** [Step 12: Per-hit resolver, every hit at step start](#step-12-per-hit-resolver-every-hit-at-step-start).
- **Closes:** nothing.
- **Proof:** number change. Named example: Mortefi with +20 % Fusion, −1.82 %.
- **Decided in:** [Verify: is per-hit buff scoping split across the buff lanes?](https://github.com/Philipp-DI/WuWaSim/issues/46), [Decide the per-hit modifier resolver](https://github.com/Philipp-DI/WuWaSim/issues/66).

### Step 15: Outro buff extractor

- **In plain terms:** what each Outro grants (value, scope, duration, who
  receives it) is read from the game's buff table instead of parsed from the
  Outro text.
- **Goal:** a build-time `tools/` extractor follows role → Outro skill row
  (`DT_SkillInfo`) → gameplay ability → buff id, then reads the reached
  `db_buff` rows, for all 60 Outros: 53 in the `20022NN` family and 7 in their
  own id range. It replaces the Outro text regex. Damage tag 7 maps to the
  `outro` skill type, so Lingering Tunes' Outro bonus stops being inert.
  The regex-patch fallback is dropped.
- **Depends on:** nothing.
- **Closes:** [Outro-buff text parser: Brant/Cantarella lose the 25 % Skill grant; Baizhi/Verina/Buling durations misread; Rebecca per-stack value](https://github.com/Philipp-DI/WuWaSim/issues/89).
- **Proof:** number change. Tests pin, against the game text, the grants of
  the seven own-range Outros (Youhu, Jinhsi, Augusta, Ciaccona, Cartethyia,
  Iuno, Phoebe), which rest on one source.
- **Decided in:** [Research: what do Intro and Outro skills do in the game data?](https://github.com/Philipp-DI/WuWaSim/issues/65), [Place each open issue on a roadmap step](https://github.com/Philipp-DI/WuWaSim/issues/84), [Research: can the 20022NN Outro buff family be joined to resonators by structure?](https://github.com/Philipp-DI/WuWaSim/issues/97).

### Step 16: Intro and Outro team buffs

- **In plain terms:** team buffs reach Intro and Outro hits like any other
  hit. Today they don't, so Intro and Outro damage is understated.
- **Goal:** the Intro and Outro segments read the team buff timeline through
  the per-hit resolver. Buffs scoped to another skill type don't apply; buffs
  naming Intro or Outro do (maintainer-confirmed game fact,
  `.claude/rules/invariants-team-gear.md`).
- **Depends on:** [Step 0: Youhu's Outro applied as All DMG](#step-0-youhus-outro-applied-as-all-dmg), [Step 12: Per-hit resolver, every hit at step start](#step-12-per-hit-resolver-every-hit-at-step-start), [Step 15: Outro buff extractor](#step-15-outro-buff-extractor).
- **Closes:** nothing.
- **Proof:** number change. Intro/Outro segments rise 4–100 %; team DPS
  median +0.35 %, max +1.85 % (measured with real gear). The Aemeath
  benchmark gap is re-measured after.
- **Decided in:** [Verify: do the four team segment kinds get different team inputs?](https://github.com/Philipp-DI/WuWaSim/issues/44), [Decide the segment seam: read-only context, or continuation in and out](https://github.com/Philipp-DI/WuWaSim/issues/50), [Reconcile: how much do missing team buffs cost intro/outro damage, and does the game apply them?](https://github.com/Philipp-DI/WuWaSim/issues/60), [Decide the per-hit modifier resolver](https://github.com/Philipp-DI/WuWaSim/issues/66).

### Step 17: Shared gauge walk

- **In plain terms:** the rotation checker and the sim count gauges the same
  way. Today their gauge numbers disagree (Denia S3: Dark Core 2–3 vs 5),
  though no rotation flips between legal and illegal yet.
- **Goal:** the rotation checker calls the sim's gauge walk with the sim's
  inputs (chain level, clock).
- **Depends on:** nothing.
- **Closes:** nothing.
- **Proof:** zero-diff.
- **Decided in:** [Verify: do the rotation validators disagree with the sim?](https://github.com/Philipp-DI/WuWaSim/issues/45), [Place each open issue on a roadmap step](https://github.com/Philipp-DI/WuWaSim/issues/84).

### Step 18: Gauge definitions for all resonators

- **In plain terms:** every resonator's special gauges are defined, not just
  seven of sixty.
- **Goal:** gauge definitions for all resonators, several per resonator as the
  game ships them, produced by an extractor into `data/`.
- **Depends on:** [Step 17: Shared gauge walk](#step-17-shared-gauge-walk).
- **Closes:** this step's own issue, [Per-resonator special resources (RESOURCE_DEFS covers 7 of 60)](https://github.com/Philipp-DI/WuWaSim/issues/39).
- **Proof:** number change. Size unmeasured.
- **Decided in:** [Decide whether curated kit tables leave the engine modules, and what engineHash covers](https://github.com/Philipp-DI/WuWaSim/issues/52), [Place each open issue on a roadmap step](https://github.com/Philipp-DI/WuWaSim/issues/84).

### Step 19: Gauge income on hit

- **In plain terms:** gauges the game fills when a hit lands are filled in the
  sim too.
- **Goal:** wire the extracted `db_PassiveSkill` DamageTrigger gauge income
  into the gauge walk.
- **Depends on:** [Step 18: Gauge definitions for all resonators](#step-18-gauge-definitions-for-all-resonators).
- **Closes:** this step's own issue, [Gauge income earned on a HIT (db_PassiveSkill DamageTrigger) is extracted but not wired](https://github.com/Philipp-DI/WuWaSim/issues/18).
- **Proof:** number change. Size unmeasured.
- **Decided in:** [Place each open issue on a roadmap step](https://github.com/Philipp-DI/WuWaSim/issues/84).

### Step 20: Jinhsi's Incandescence

- **In plain terms:** Jinhsi's Incandescence gauge is modelled.
- **Goal:** Incandescence as a gauge on the shared walk.
- **Depends on:** [Step 18: Gauge definitions for all resonators](#step-18-gauge-definitions-for-all-resonators).
- **Closes:** this step's own issue, [Jinhsi's Incandescence gauge is not modelled](https://github.com/Philipp-DI/WuWaSim/issues/95).
- **Proof:** number change. Size unmeasured.
- **Decided in:** [Place each open issue on a roadmap step](https://github.com/Philipp-DI/WuWaSim/issues/84).

### Step 21: Team-wide gauge income

- **In plain terms:** gauges that fill when any team member casts (Galbrena's
  Afterflame, Sigrika's Soliskin Vitality) fill from teammates' casts too.
- **Goal:** team-wide gauge income flows through the cross-segment carry.
- **Depends on:** [Step 6: Segment seam](#step-6-segment-seam), [Step 18: Gauge definitions for all resonators](#step-18-gauge-definitions-for-all-resonators).
- **Closes:** this step's own issue, [Team-wide gauge income: "any Resonator in the team casts" (Galbrena Afterflame, Sigrika Soliskin Vitality)](https://github.com/Philipp-DI/WuWaSim/issues/19).
- **Proof:** number change. Size unmeasured.
- **Decided in:** [Place each open issue on a roadmap step](https://github.com/Philipp-DI/WuWaSim/issues/84).

## 5. Stand-alone fixes

Open issues that are not steps. Each is its own number change (or zero-diff)
and lands between steps. Placements are from
[Place each open issue on a roadmap step](https://github.com/Philipp-DI/WuWaSim/issues/84).

**Before a step** (the step waits on the fix):

- Before [Step 7](#step-7-rotation-breakdown-and-team-clock-stamps): [Build page: rotation total ignores the enemy panel (hard-coded defaultSimTarget)](https://github.com/Philipp-DI/WuWaSim/issues/61) — UI number change.
- Before [Step 7](#step-7-rotation-breakdown-and-team-clock-stamps): [Build page: "Running total" ignores conditional windows (stale cumulativeDamage)](https://github.com/Philipp-DI/WuWaSim/issues/87) — UI number change.
- Before [Step 8](#step-8-one-enemy-timeline): [Status-apply rules: Ciaccona over-applies Green Tonic, Luuk Herssen misses Aureole](https://github.com/Philipp-DI/WuWaSim/issues/35) — number change.
- Before [Step 11](#step-11-attacker-hit-stop-extractor): [Qiuyuan's Liberation timing is joined to a Resonance Skill row (hypothesis)](https://github.com/Philipp-DI/WuWaSim/issues/78) — verify first; number change.
- Before [Step 12](#step-12-per-hit-resolver-every-hit-at-step-start): [Kumokiri's team grant has no recipient gate (non-inflicting teammates +~10 %)](https://github.com/Philipp-DI/WuWaSim/issues/93) — number change (rule: refused, never widened).
- Before [Step 12](#step-12-per-hit-resolver-every-hit-at-step-start): [Damage-row attribution: 4 ambiguous rows look like matchRowHits over-reach](https://github.com/Philipp-DI/WuWaSim/issues/24) — number change, if confirmed.

**After a step** (the fix waits on the step):

- After [Step 4](#step-4-freeze-phase): ["stacking up to N times" clauses read flat, and skillNodeEffects has no override slot namespace](https://github.com/Philipp-DI/WuWaSim/issues/20) — number change.
- After [Step 4](#step-4-freeze-phase): [Effect-override backlog: 96 of 398 chain/inherent effects have trigger:unknown](https://github.com/Philipp-DI/WuWaSim/issues/31) — number change, ongoing.
- After [Step 6](#step-6-segment-seam): [Intro → attack-chain stage grants: 7 resonators missing, 2 partial, Rebecca stale](https://github.com/Philipp-DI/WuWaSim/issues/77) — number change.
- After [Step 7](#step-7-rotation-breakdown-and-team-clock-stamps): [Show a live minimum/recommended ER target per team member](https://github.com/Philipp-DI/WuWaSim/issues/68) — feature.
- After [Step 7](#step-7-rotation-breakdown-and-team-clock-stamps): [Team timing: page subtracts freezes team-wide, engine per member. Which matches the game?](https://github.com/Philipp-DI/WuWaSim/issues/62) — also needs a game fact; UI number change.
- After [Step 8](#step-8-one-enemy-timeline): [Denia Erosion Field / AFFLICTION_TRIGGERS and Aemeath S2.2 Tune Rupture: statusGrant values paid nowhere](https://github.com/Philipp-DI/WuWaSim/issues/21) — number change.
- After [Step 8](#step-8-one-enemy-timeline): [Lucilla S2.0: the 80% Glacio Chafe amplify has no producer](https://github.com/Philipp-DI/WuWaSim/issues/22) — number change.
- After [Step 8](#step-8-one-enemy-timeline): [Electro Flare half-stack loss and Electro Rage overflow are unmodelled](https://github.com/Philipp-DI/WuWaSim/issues/36) — number change.
- After [Step 8](#step-8-one-enemy-timeline): [Negative-status damage: stack hits see DEF shred/ignore, ticks and afflictions don't](https://github.com/Philipp-DI/WuWaSim/issues/71) — number change.
- After [Step 11](#step-11-attacker-hit-stop-extractor): [Model the 20 buffs whose duration slows during hit-stop (bDurationAffectedByBulletTime)](https://github.com/Philipp-DI/WuWaSim/issues/80) — number change.
- After [Step 12](#step-12-per-hit-resolver-every-hit-at-step-start): [Team-wide lane 2: window weapon/sonata team buffs by team-time overlap](https://github.com/Philipp-DI/WuWaSim/issues/8) — number change.
- After [Step 12](#step-12-per-hit-resolver-every-hit-at-step-start): ["N hits" label counts damage rows, not hits (Sanhua basic 3 shows 1 of 4)](https://github.com/Philipp-DI/WuWaSim/issues/94) — UI number change.
- After [Step 16](#step-16-intro-and-outro-team-buffs): [Outro buffs never expire: duration is never read (up to ~9 % of team damage)](https://github.com/Philipp-DI/WuWaSim/issues/90) — number change.
- After [Step 16](#step-16-intro-and-outro-team-buffs): [Team-wide Outro grants reach only the incoming member; Shorekeeper/Aemeath/Cartethyia reach nobody; conditions ignored](https://github.com/Philipp-DI/WuWaSim/issues/91) — number change.
- After [Step 16](#step-16-intro-and-outro-team-buffs): [Do heal Outros open healing-triggered sonata windows? (disputed, 0 vs +3.7–6.2 % team)](https://github.com/Philipp-DI/WuWaSim/issues/96) — gated on its dispute; number change.
- After [Step 16](#step-16-intro-and-outro-team-buffs): [Aemeath benchmark: Chisa team gap 1.321x (passes 2–3: 1.380x)](https://github.com/Philipp-DI/WuWaSim/issues/37) — measurement.

**Any time** (no step edge):

- [Encore's and Rebecca's Outro damage is missing (Encore ~3–5 % team, size disputed)](https://github.com/Philipp-DI/WuWaSim/issues/92) — number change.
- [Character state remainder: Zhezhi airborne entry, Brant 3rd candidate, Rebecca mode→Intro and Hot Hand](https://github.com/Philipp-DI/WuWaSim/issues/33) — number change.
- [Taoqi S6.0 is dead: needs a shield state and Basic+Heavy scope](https://github.com/Philipp-DI/WuWaSim/issues/23) — number change.
- [multiplierUp scope residue: key-side name-resolution gaps (Suisui S5.0, Luuk S3.1, Galbrena S6.0, Rebecca S3.0)](https://github.com/Philipp-DI/WuWaSim/issues/38) — number change.
- [Rename pass → team cycle in code identifiers](https://github.com/Philipp-DI/WuWaSim/issues/13) — zero-diff; rides along with each decomposition.

## 6. Not on the roadmap

- [Audit tracked data and asset weight: which files are reproducible from pinned upstream?](https://github.com/Philipp-DI/WuWaSim/issues/17), [Full-text / stat / effect search (search is name-only)](https://github.com/Philipp-DI/WuWaSim/issues/27), [Pin Rover dataset ids explicitly (do not implement yet)](https://github.com/Philipp-DI/WuWaSim/issues/41), [Suggested teams: 8 resonators have none](https://github.com/Philipp-DI/WuWaSim/issues/42): they change no sim number.
- [Auto-optimizer Phase E: kit → optimal build](https://github.com/Philipp-DI/WuWaSim/issues/9): it ranks by numbers the roadmap is still correcting, so it starts after the roadmap ([Decide whether Auto-optimizer Phase E (#9) is a roadmap step](https://github.com/Philipp-DI/WuWaSim/issues/83)).
- In-game capture work: [Calibration cases: 13 pending in-game captures (optional where untestable)](https://github.com/Philipp-DI/WuWaSim/issues/32), [In-game capture: do male Rover animations differ in timing from female?](https://github.com/Philipp-DI/WuWaSim/issues/40), [Combo-entry curation Tier 2: in-game verification](https://github.com/Philipp-DI/WuWaSim/issues/10), [Echo animation timing (ECHO_CAST_TIME) blocked on a Monster-asset export](https://github.com/Philipp-DI/WuWaSim/issues/34): they need the game, not a decision.
- In-game verification of per-hit and bullet timings: input and server latency skew sub-second measurements, so per-hit times rest on the client-code trace and the game data (maintainer, 2026-11-17).
- Low-priority UI polish: [Compare page: shield row and layout (compact table vs per-step view)](https://github.com/Philipp-DI/WuWaSim/issues/26), [Enemy level does not carry across independent builds](https://github.com/Philipp-DI/WuWaSim/issues/28), [Popover keyboard navigation (Escape only; no arrows/Enter)](https://github.com/Philipp-DI/WuWaSim/issues/29), [Sonata quick-switch extras: team multi-set, 5pc shortcut, free-form](https://github.com/Philipp-DI/WuWaSim/issues/30).
- Features with their own specs: [Spec: Echo Capture (docs/specs/ECHO-CAPTURE-SPEC.md)](https://github.com/Philipp-DI/WuWaSim/issues/11), [Spec: Game version update phases 2–4 (docs/specs/VERSION-UPDATE-SPEC.md)](https://github.com/Philipp-DI/WuWaSim/issues/12).
- Merging the three effect-parse sites: the fingerprint test and the freeze phase already catch slot shifts, and the merge adds no fidelity ([Decide preprocessing: a slot-freeze phase or a full effect compiler](https://github.com/Philipp-DI/WuWaSim/issues/51)).
- A broad result/kit read model replacing the UI's 15 core imports: organisation only, it fixes no number ([Decide what core returns so the UI renders per-ability damage and member timing without computing them](https://github.com/Philipp-DI/WuWaSim/issues/59)).
