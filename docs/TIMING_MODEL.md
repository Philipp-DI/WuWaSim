# WuWaSim — Timing Model & Ability Data

Read this before touching `stepDuration`, `freezeTime`, `cooldown`, buff duration, or DPS calculation.

**Current state:** timing is data-driven. 1,020 of 1,079 rotation steps carry a real animation-derived `stepDuration`; 64 carry a measured `freezeTime`. This file describes what the fields *are* and how the engine uses them. The chronology — how the extraction was built, every bug fixed along the way — lives in `docs/HISTORY.md`.

## Context

Community references (prydwen, Maygi) report DPS well above a naive real-time sim. That is a different time convention, not an error: Tower of Adversity freezes the challenge timer and cooldowns during Resonance Liberation animations, so those figures divide by a shorter effective time. WuWaSim models the split explicitly.

## What a step costs

`resolveStepDuration(skillDef, dataset)` — **the animation, or the damage,
whichever finishes later**:

```text
stepDuration = max( animation duration , resolvesAt )
```

The animation duration is the marker `stepDurationRule` names, normally
`StateNextAtt` — when the next skill can be *queued*. Taking the max is forced
by how damage is credited: **a key applies its FULL kit multiplier every time it
appears in a rotation.** Camellya's Vining Waltz is the clearest case — 20
damage instants at 0.12 s spacing, `StateNextAtt` open at 0.8 s. Tapping into
Stage 5 at 0.8 s lands **5 of the 20 hits**, so charging the rotation 0.8 s while
paying out all 20 credits damage nobody waited for. Either the damage shrinks or
the clock grows; the clock is the side we can measure.

That makes **"the action fully resolves" the default** — what a player who is not
deliberately cancelling actually does. An *early* cancel is a different action
and belongs in the rotation as its own explicit step; that is where
`DT_SkillInfo.InterruptLevel` earns its place, not here.

**9 keys** roster-wide have damage after their queue point — every one a channel
or multi-hit burst. Largest first: Lumi `forte_heavy_glare` (0.43 → 7.94 s, 21
hits), Camellya `basic_basic_attack_4` (0.8 → 2.28 s, 20), Chisa
`skill_serrated_loop_hold`, Zani `basic_breakthrough`, Chixia `skill`, Encore
`liberation_cosmos_rampage_damage`, Sanhua `forte_heavy_detonate_damage`,
Aemeath `midair_mech`, Augusta `skill`. Every other step is numerically
unchanged, and the rule can only ever *lengthen* a step.

## Two-clock time model

- **`realTime`** — advances by the full `stepDuration` per step. Positions the timeline; the wall-clock rotation length.
- **`gameTime`** — advances by `stepDuration − freezeTime`. Cooldowns **and** buff / effect / state durations tick against this, and it is the DPS denominator in ToA-benchmark mode.

They diverge only during a freeze. Scope: the split applies to timed benchmark content. `timingMode: 'open'` ignores `freezeTime` entirely and the two clocks coincide.

## Rule: the game's own labels are the authority

The client ships every notify class as JavaScript under `Content/Aki/JavaScript/Game/AnimNotify{,State}/`, and each implements `GetNotifyName()` returning the designer-facing label. **`tools/extract/scan_notify_semantics.mjs` → `data/notify-semantics.json`** captures all **202** classes: label, declared properties, and which of those the body actually *reads*.

Inferring semantics from a class name has produced three wrong models, so don't:

| class | sounds like | actually (`GetNotifyName`) |
| --- | --- | --- |
| `StateAbsoluteTimeStop` | the sim's freeze | 动画和子弹冻结 — animation + bullet hold, **stops no clock** |
| `StateSoftLock` | an action/commitment lock | 开启镜头软锁 — **camera** lock-on, gameplay-irrelevant |
| `StateChangeSlot` | a stance/weapon-mode switch | 切换组件到指定插槽 — attaches a sub-mesh to a socket |

The dead-property column matters too: `AbsoluteTimeStop` declares four flags and its body reads **one**. Classifying on the other three matched six in-game observations and was still wrong. *Six confirming cases do not make a rule true — look for the case that would break it.*

ChangeSlot is the nuanced one: the *mechanism* is cosmetic, but *which prop it attaches* is a faithful **signal** of a weapon change — Rebecca's two Intros target `WeaponProp01` (pistol/Huntress) vs `WeaponProp02` (shotgun/Guts), matching the split we had otherwise pinned by bullet label. A cosmetic mechanism can still be the best available marker.

## What each field means

Everything below is real extracted data in `data/actionable-times.json`. Only six fields reach the engine.

### Consumed by the sim

**There is no field called `actionableAt` any more.** It was one name over four
different quantities — a measurement, two weaker stand-ins, and a number that
was never a duration at all — which made the worst rung indistinguishable from
the best. The artifact now publishes the **markers** under the game's own names,
plus the rule that chose between them.

| field | source | meaning |
| --- | --- | --- |
| **`stepDuration`** | the marker named by `stepDurationRule` | **The animation's own duration.** The engine takes `max(stepDuration, resolvesAt)` — see "What a step costs" |
| **`stepDurationRule`** | which marker existed | `nextAtt` (850) → `skillEnd` (130) → `idleReturn` (1) → `sequenceLength` (42). Only the first is a measurement of when input is accepted |
| **`nextAttAt`** / **`nextAttDuration`** | `StateNextAtt` | When the next skill can be **queued**, and how long input keeps being accepted. Was `cancelWindowOpensAt`, which said the opposite of what the notify does |
| **`skillEndAt`**, **`idleReturnAt`**, `sequenceLength` | `EndSkill`, `FightStand`, asset property | The weaker terminals. `sequenceLength` includes the idle-return tail — median **+3.99s** past `skillEndAt` — and is only defensible where no terminal exists at all |
| **`damageAt`** / **`firstDamageAt`** / **`resolvesAt`** | fire times of the bullets carrying **this key's** damage ids, in the chosen montage | When this ability's damage lands, and when it has fully resolved. 883 keys, 377 multi-instant |
| **`freezeTime`** / **`freezeSource`** | `StateTimeStopRequest` window union / chosen montage path | Seconds where gameTime is paused, and the identity of the animation it came from — paid out once per rotation |
| **`timingSource`** | join provenance | `extracted` (1,015) / `curated` (6) / `estimated` (59) |
| **`timingProvisional`** / **`timingIsLoop`** | overrides / loop detection | `state`, `phaseOnly` or `loop`; `timingIsLoop` is separate because 3 of the 4 loop keys carry a stronger caveat that would otherwise hide it |
| **`cooldown`** | `DT_SkillInfo.CooldownConfig.CdTime` | Ticks against gameTime |

### Ability facts — shown in the UI, not consumed by the sim

`preprocess.mjs` stamps these onto each step and `formatTimingFacts()`
(`src/ui/tip-format.js`) renders them at the head of every skill hover box —
the rotation palette, the rotation chips, and the ability overview all share
one formatter. **1,020 of 1,079 steps show a block**; the estimated remainder
stays silent rather than printing rows of blanks.

```text
First DMG at 0.24s
Fully resolves at 2.28s (20 hits)
Next action at 0.80s
⚠ Acting there lands only 5 of 20 hits
Interrupt priority 2
❌ Switching ends it from 1.20s — remaining damage is lost
```

Three deliberate choices in that block:

- **No "lossless cancel" row.** It would be the same number as *Fully resolves*
  — you can act at `nextAttAt`, and it is lossless exactly when nothing is
  still landing. Instead the cancel **cost** is stated only when it is nonzero,
  in hits (9 keys). Total loss is worded apart from partial, because "0 of 21"
  next to a First-DMG time that rounds to the same second reads as a
  contradiction.
- **The switch default must be earned.** No tag means "keeps resolving" *only
  when we actually read the animation's tags*. A key resolved through the
  coarse skill-row route has no montage, so it makes no switch claim at all —
  asserting the default there would be inventing a fact from missing data.
- **The loop note hedges.** `timingIsLoop` is convention-based, and the two
  flagged cases genuinely differ (Camellya's spin repeats from the top; Lumi's
  Glare looks self-contained), so it reports the uncertainty rather than
  picking.

### The underlying fields

| field | source | meaning |
| --- | --- | --- |
| `staminaCost` | `DT_SkillInfo.StrengthCost` | Positive STA (source is negative, ×100). **Null unless every row reaching this animation agrees** — see the Camellya case below. 11 keys conflict |
| `interruptLevel` | `DT_SkillInfo.InterruptLevel` | Authored commitment ranking, same unanimity gate. 958 keys |
| `chainStage` | the game's own `普攻N` tag | Chain position, 167 keys. Reaches the dataset on the **41** whose key name has no stage number — see "Chain slots" below. The tag's optional `空中` prefix is **not** reported; it survives as copy-paste on ground rows |
| `switchBehavior` | montage `gameplay_tags` | `endsOnSwitch` / `cannotSwitch` as **timed windows**, not flags. 72 keys |
| `isLoop`, `tapHoldRole`, `chosenAsHoldLoop` | naming convention / repeat counts | See "Loops and holds" below |
| `hitTimes` / `hitCount` | every `ReSkillEvent` in the montage | **Montage-wide context, NOT this key's damage** — see below |
| `freezeAnimationTime` | `AbsoluteTimeStop` | Correctly excluded from `freezeTime` |
| `variants`, `montageCandidates`, `stepDurationSpread` | candidate ranking | Preserved so a state model can pick later without re-deriving |
| `sourceMontage`, `sourceBulletId`, `route`, `genderMirroredFrom`, `leadInPhase*` | join | Provenance |

**`hitTimes` is wrong in both directions and must not be used to decide when damage lands.** It filters by notify *class*, so it collects every bullet spawn in the montage regardless of owner — Sanhua's `skill` was handed `forte_heavy_ice_prism_burst_damage`'s 0.3003, and Qiuyuan's `basic_1` counted bullet `1411001000` 普攻-目押判定, a just-frame **input detector** with no damage ids at all. It is simultaneously *under*-inclusive: bullets fired via `SkillBehavior`, `StateBulletDuration` or `子弹id数组` are not role `hit`, so channelled and condition-gated damage never appears. `damageAt` is the intersection and is correct in both axes: Qiuyuan `basic_1` = `[0.2333]` (one hit, as the kit's `21.00%` says), Sanhua `basic_1` = `[0.2102]`.

## The pipeline — one source

**There is no second sourcing route, and adding one is a regression.** An earlier ladder (import Maygi's sheets → frame-count footage → estimate) was written when extraction was believed impossible; all three are retired. Each would introduce a number nobody can re-derive, indistinguishable beside values the game itself authored. A hand measurement is *validation*, not a source.

Three tiers. **Only the first produces numbers.**

1. **Extract** — `extract_timings.py` + `scan_bullet_timings.py` + `map-timings.mjs` → `data/actionable-times.json`. `timingSource: extracted`, **1,015 steps**.
2. **Curate a DECISION, never a number** — `data/timing-overrides.json`. `pinnedMontage` says *which candidate wins*, with reasoning inline; `needsStateModel` marks a state-gated key. The timing still comes from the extraction. A pin matching no candidate is a hard error. **6 steps**.
3. **Per-type fallback** — `HARDCODED_ACTIONABLE_TIMES`. Not a sourcing option; a **hole marker** for damage with no player animation (turret / summon / field / DoT). **59 steps**. Do not hand-tune — shrinking this set means finding the missing *link*, not inventing the value.

Regenerating needs the raw export. `data/actionable-times.json` is **committed** so the build never depends on it. Re-run only on a game patch, then `npm run data && npm run meta`.

## The join

Keyed on `hit-map.json` (per `autoSkillMap` key, the game's own BinData damage ids). Two routes:

**Bullet chain (primary, 883 keys)** — follows the link the game stores, exact string identity at every hop:

```text
animation notify --子弹数据名 / bulletRowName / BulletIds / 子弹id数组--> bullet id
bullet row       --伤害ID / 多伤害ID (transitively via 子子弹设置.召唤子弹ID)--> damage id
```

Bullet ids are **not** damage ids (they coincide often enough that a naive scan looks complete). Carrier bullets deal nothing and spawn the one that does, so damage ids are the transitive closure over child configs. `AnimSequence` carries notifies exactly like `AnimMontage` — detect by export class, never by an `AM_*` filename. Non-combat modes (`Rogue`/`Rouge`/photo/event) are excluded; they reuse bullet ids with different tuning.

**DT_SkillInfo row (fallback, 141 keys)** — recovers a row by prefix match. Coarse: 30.6% of its keys share a row with another key, so distinct abilities get one merged number. Its one genuine advantage is as a **disambiguator, never a timing** — when the row names exactly one candidate montage, that candidate wins (114 entries, 26 values corrected).

**Choosing between candidates.** One damage id is often fired by several animations, and taking the earliest was wrong in all three situations behind that: sequential phases (an `X_Start` with no cancel window and no skill end can't be where the action completes — its length is *added* to the chosen `X_End`), mutually-exclusive state variants (ground/air, `_LimitDodge`, `_8M`), and one damage id genuinely shared by different actions. Every multi-candidate key keeps its full `variants` array (215 keys).

**Sections are not variants.** A montage's `CompositeSections` are usually *sequential phases of one action* — Electro Rover's `AM_Skill02_Wind_G_Long` splits wind-up / hold / release with the cancel window in section 1 and `EndSkill` in section 2. Scoping the derivation to the first section was tried and reverted; it discarded real terminals. Section membership is tagged per event as context only.

## Confirmed mechanics

1. **The animation's duration is when the next attack can be queued, not when the player is "free".** `StateNextAtt` is 下一个技能 ("next skill"); `K2_NotifyBegin` calls `SetSkillAcceptInput(true)` **+ `CallAnimBreakPoint()`**, `K2_NotifyEnd` calls `SetSkillAcceptInput(false)`. Input pressed earlier is *buffered* (a macro fires at ~30ms) and executes when the window opens and flushes the cache. Dodges and swaps are **not** gated by it.
2. **A bullet spawn is the damage.** `ReSkillEvent` is 添加子弹 ("add bullet"), and no WuWa ability has meaningful projectile travel, so spawn = impact. Confirmed in-game over 60 macro trials (input → delay → dodge-cancel): Sanhua's `basic_1` resolves reliably at ≥210ms, never at 195ms — against an extracted `damageAt` of **0.2102s**. Once spawned a bullet is autonomous; despawn is a separate authored notify (`DestroySpecBullet`).
3. **A Resonance Liberation freezes the in-game clock** — timer, cooldowns and buff/effect/state durations all pause. See the freeze model below.
4. **Echoes: Transform locks, everything else is parallel.** An active-skill desc starting with "Transform" means you *become* the echo → the step occupies `ECHO_CAST_TIME`; "Summon" and direct-attack echoes cast at **zero** timeline time. ~65 lock / ~115 parallel. `opener.js` uses the same classifier (`echoStepTimeOf`).
5. **Cancel behaviour is authored per move, not by a global rule.** A resonator switch lets a committed animation finish and deal its damage (Lupa's Dance With the Wolf, Phrolova's Scarlet Coda, Carlotta); an own-kit action hard-cancels it and the remaining damage is lost. The exception is authored: the tag `切人结束技能` ("switching ends the skill") appears on Camellya's `AM_Attack04` and `AM_Attack03_Ex_Loop`, and `不能切人` ("cannot switch out") marks 179 windows roster-wide.
6. **Hold-button skills need no classifier** — the game authors a hold as its own montage (`AM_*_Hold*`, `*_Loop`), so the measured value already *is* the hold time. Where a hold reuses the tap's damage id, the **repeat count separates them**: see "Loops and holds".
7. **Multi-hit abilities are pseudo-channelled** — a fixed burst, not a player-held duration — so crediting them as one point event is an acceptable model. Damage totals are unaffected: the game's `"12.42%*20"` per-hit × count term is parsed and summed by `rate-match.mjs`, independent of notify count.
8. **A manual Tune Break activation also freezes the clock.** Not yet a sim step; `*Execute*` montages are Tune Break (100% of `SkillGenre 14`).

## The freeze model

**Two freezes, and only one is ours.** Settled from the shipped JavaScript:

| notify | `GetNotifyName()` | sim freeze? |
| --- | --- | --- |
| `StateTimeStopRequest` | 副本计时和所有战斗单位buff、技能冷却冻结 — "instance timer and **all combat units' buffs and skill cooldowns** freeze" | **yes** |
| `StateAbsoluteTimeStop` | 动画和子弹冻结 — "animation and bullet freeze" | no |

The second holds the owner's animation without stopping any clock, which is why 61 ordinary Intro Skills correctly contribute zero. Never union them.

Three rules govern how a measured freeze is applied:

1. **A measured freeze outranks the cinematic gate.** Where an animation carries its own `TimeStopRequest` there is nothing to guess, so `consumesResource` / `energyMax` no longer veto it. Six real cinematic finales freeze because of this (Carlotta's Fatal Finale 3.178s on its own `AM_Burst02`, Hiyuki, Aemeath, Ciaccona, Zani, Cantarella) — closing the old "curated is-cinematic flag" idea with zero curation.
2. **One animation freezes once per rotation.** `freezeSource` is stamped beside the freeze and `resolveFreezeSchedule` pays it out once. A *repeated key* is a genuine re-cast and freezes again; only different keys sharing a source collapse. Jinhsi's Incandescence fires Solar Flare and Stella Glamor off one `AM_Skill02` and her shipped reference rotation contains both — one 2.2s animation was counting as 4.4s. Deliberately asymmetric: over-counting freeze inflates DPS (deduped), over-counting realTime deflates it (left alone).
3. **A freeze is clamped to its own step.** A `TimeStopRequest` can outlast the cancel point (Carlotta regains control at 3.0335s, frozen to 3.90s), which a per-step model can't represent. Unclamped, 13 reference rotations ran the in-game clock **backwards**.

A freeze read off a **shared `skillRow` row** is dropped — that route recovers a table row, not an animation, so its window describes none of its keys in particular. 5 steps, all Phrolova, whose Hecate keys are on-field attacks inside the summoned form.

**Not modelled: per-bullet time dilation** (`时间膨胀`, 4,375 bullets) — impact hitstop and enemy-only locks like Aemeath's 3.0s victim dilation. It stops no player cooldown.

## Extracted and available, not yet wired

`DT_SkillInfo` has 37 fields; we long read 5. Now captured per skill row:

| field | what it unlocks |
| --- | --- |
| **`StrengthCost`** | **Stamina.** Negative, ×100 (kit text "Heavy Attack STA Cost: 20" ↔ `-2000`). ~~A looping attack pays it per tick, so pool ÷ cost is the hold-length limiter~~ — **struck 2026-07-31.** That was inference, not data: there is **no stamina notify anywhere in the client** (all 202 classes scanned for 体力/耐力/Strength). Cost is charged from the ROW on cast. Roster maximum is **35 STA of 100**, so a "full pool at cast, deplete for this ability" model is provably a no-op and is not built |
| **`InterruptLevel`** | **Commitment.** The authored interrupt ranking (basics 2, dodge 6, charge-state 10 — why a dodge cancels a basic). `ChangeSkillPriority` (修改技能优先级, calls `SetSkillPriority`) mutates it mid-animation; 641 montages carry a curve. Note it ranks *what can override what* — it does **not** say when damage is safe. That question is answered by `resolvesAt` |
| **`SkillTag`** | The game's own classification vocabulary, authoritative where kit prose and our key names disagree |
| `ToughRatio`, `BurstLockTime`, `CooldownConfig.MaxCount` | Poise, burst lock, cooldown **charges** |
| `SkillBuff` / `SkillStartBuff` / `SkillEndBuff` | Buff wiring per cast |

From montages: **`gameplay_tags`** (1,046 timelines — `不能切人`, `切人结束技能`, `霸体` super armour, `无敌` i-frames, `禁止体力恢复` stamina-regen block), **`weapon_slots`** (208), `priority_changes`, `break_points_s`, and `buff_applied_s` for exact buff-application frames.

## Loops and holds

**A hold and its tap share damage ids and differ only in repeat count.** The
bullet chain therefore hands both the same candidates and the ranking gives both
the shorter one — the tap's. Camellya is the readable case: Vining Waltz Stage 3
is `1603103001` + `1603103003`**×5**, Blazing Waltz is the same pair with the
tick **×18**, and the kit says outright that holding at Stage 3 casts Blazing
Waltz. The two ids split cleanly across animations — `…001` fires from
`AM_Attack03_Ex`, `…003` from `AM_Attack03_Ex_Loop` — so the higher-count key is
moved onto the loop (`tapHoldRole: 'hold'`, `chosenAsHoldLoop`). Three collision
groups exist roster-wide; the other two (Rebecca's Huntress pair, Chisa's
chainsaw pair) have **no** montage candidates at all, so the rule is a no-op
there rather than a guess.

**A loop's markers are per-ITERATION, not per-action.** `isLoop` is
convention-based and has to be: the montage carries **no loop signal at all**.
Camellya's `AM_Attack03_Ex_Loop` has one `CompositeSection` whose
`NextSectionName` is `"None"`, and its `PositionBranchTarget` notify is
位移吸附到目标位置 — position snapping, not an animation branch. The repeat is
driven by gameplay code, so the asset name (`_Loop`) and the row label (循环, but
not 循环结束, which is the loop's *exit*) are the only evidence the export offers.

The count is therefore **unresolved**: the kit says 18 ticks, the loop montage
fires 2 per 2.2 s iteration, and 9 iterations would run ~20 s against an
in-game spin measured at a few seconds. The ticks likely come from a
`StateBulletDuration`-style notify that `damageAt` does not see. 4 keys are
affected — all flagged `timingIsLoop`, none silently resolved.

## Chain slots — the stage a key occupies without saying so

Rotation validation reads a stage off the **key name** (`basic_3` → stage 3).
That is blind to any ability which occupies a chain slot under a different
name, and the game tags every one of them: Sanhua's dodge counter is `普攻2`,
Yinlin's is `普攻3`, Carlotta's Heavy Attack is `普攻2`.

`chainStage` reaches the dataset on the **41 keys whose own name carries no
stage number**, and `rotation-graph.js` treats such a key, once cast, as having
filled that slot — so `basic_dodge_counter → basic_3` is legal for Sanhua and
`→ basic_4` for Yinlin, both of which warned before. The legalization emits a
`chainTag` chip naming the contributing step, so it is never silent.

Three limits, all deliberate:

- **The key name wins where both exist.** It is our canonical numbering, and
  the tag can mean something else entirely — Jiyan's three Liberation lances
  are *all* tagged `普攻4`, and Rover: Havoc's `basic_4`/`basic_5` are tagged 2
  and 3. Only the 5 disagreements are affected, and all 5 would be wrong.
- **The tag never fabricates a cast.** `basic_3` alone still warns; the slot
  only counts once the contributing key appears *earlier* in the rotation.
- **It fills exactly one slot.** `basic_dodge_counter → basic_4` still warns.

Shipped reference rotations were already clean under the full context and stay
clean; the value is in user-authored chains that curation never covered.

## Naming a thing the game does not: ground vs air

**Do not classify ground/air from `skill_tags`.** Camellya's *ground* Form B rows
carry `技能标识.空中普攻3循环` — "aerial". It is copy-paste and it is wrong. The
trustworthy discriminators are the row-name suffix `-空中` and the
`禁止体力恢复` stamina-regen-block tag.

This matters because **stamina is a row property and one animation is reached
from several rows.** Every Camellya Form B basic ships as a ground row (0 STA)
and an air row (5 STA) pointing at the *same* montage, so "the waltz costs 5
stamina" is true only in the air. Maintainer-confirmed in-game: the ground spin
is free. `staminaCost` reports null on all 11 such keys rather than picking.

The ability description agrees with the data here — it says "Using Basic Attack
[Vining Waltz] and Basic Attack [Blazing Waltz] **in mid-air** consumes STA".
What it does **not** match is the maintainer's aerial observation: no cost in the
air either, and stamina *regenerating* while suspended, against a description
that says "Consume STA continuously to stay suspended" and an air row carrying
an explicit regen-block tag. That is data **and** description contradicting
observation, which makes one hypothesis worth recording: **the aerial rows may be
dead, with air basics now routed to the ground rows.** It would explain both
halves at once. Blocked on an airborne-state tracker; not chased.

## Still open

1. **Echo animation timing.** `ECHO_CAST_TIME = 1.20` is the engine's last fabricated timing constant. The assets are available (`Content/Aki/Character/Monster/` is in the full client export, and the parser detects by export class, not path) — what is missing is the join: echo → monster skill row → montage has no `hit-map.json` equivalent.
2. **Character state modelling** — 13 keys, 6 resonators (`needsStateModel`). The timing data is complete; the *state* is missing. Open item #22.
3. **Loop iteration count** — 4 keys. See "Loops and holds"; the ticks are not where `damageAt` looks.
4. **Airborne state, and the stamina anomaly downstream of it** — see above.
5. **Per-bullet time dilation** — deliberately out of scope.

Hold-button classification and the "collapse instants toward zero" rescale were closed as **obsolete** — both existed to compensate for not having measured times.

## Precision: the sensitivity pass

`node docs/cast-time-sensitivity.mjs`, re-run on measured data (289 teams):

| model | damage-rank ρ | DPS-rank ρ | median \|Δ DPS\| |
| --- | --- | --- | --- |
| per-type ±20% | 0.991 | 0.964 | 5.14% |
| per-skill ±20% | 0.998 | 0.984 | 2.38% |

**Damage rankings are robust** (ρ ≈ 0.99) — comparative conclusions were never at risk. **DPS is timing-bound**, which is why one measured baseline beats any amount of care on individual estimates. Per-skill error hurts about half as much as per-type, the signature of systematic bias mattering more than noise — so residual accuracy effort belongs on the ~5% still on per-type fallbacks, not on refining measured values.

Caveat: cooldowns are diagnostic-only in the current sim, so this pass cannot see cooldown-gated damage.

## Optional QA: cross-checking an outside measurement

Not a pipeline step and not a gate. Worth running after a patch re-extraction or a freeze-model change:

- Rebuild 2–3 of arabwuwa's disclosed rotations; total duration should land within ~5% of their recorded time.
- Cross-check DPS against a community calculator for the same rotation and assumptions.

**A miss is a lead, not a verdict, and never licenses editing a timing by hand.** Suspect order: the convention (ToA vs open-world), then the freeze model, then the rotation as rebuilt, then buff uptime. If extraction genuinely picked the wrong animation the remedy is a `pinnedMontage` decision with reasoning — tier 2 — never an edited number.

**Status:** unexecuted; no arabwuwa recordings have been available.
