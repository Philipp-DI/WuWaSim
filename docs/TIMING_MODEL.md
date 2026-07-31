# WuWaSim — Timing Model & Ability Data

Read this before touching `actionableAt`, `freezeTime`, `cooldown`, buff duration, or DPS calculation.

**Current state:** timing is data-driven. 1,020 of 1,079 rotation steps carry a real animation-derived `actionableAt`; 64 carry a measured `freezeTime`. This file describes what the fields *are* and how the engine uses them. The chronology — how the extraction was built, every bug fixed along the way — lives in `docs/HISTORY.md`.

## Context

Community references (prydwen, Maygi) report DPS well above a naive real-time sim. That is a different time convention, not an error: Tower of Adversity freezes the challenge timer and cooldowns during Resonance Liberation animations, so those figures divide by a shorter effective time. WuWaSim models the split explicitly.

## Two-clock time model

- **`realTime`** — advances by the full `actionableAt` per step. Positions the timeline; the wall-clock rotation length.
- **`gameTime`** — advances by `actionableAt − freezeTime`. Cooldowns **and** buff / effect / state durations tick against this, and it is the DPS denominator in ToA-benchmark mode.

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

| field | source | meaning |
| --- | --- | --- |
| **`actionableAt`** | `StateNextAtt` open time (850) → `EndSkill` (129) → `FightStand` (~20) | **Step duration.** See the caveat below — rungs 2–3 are different quantities under one name |
| **`freezeTime`** | `StateTimeStopRequest` window union | Seconds of `actionableAt` where gameTime is paused |
| **`freezeSource`** | chosen montage path / `row:<id>` | Identity of the animation the freeze came from — paid out once per rotation |
| **`timingSource`** | join provenance | `extracted` (1,015) / `curated` (6) / `estimated` (59) |
| **`timingProvisional`** | overrides | `state` or `phaseOnly` when the value is conditional or understated |
| **`cooldown`** | `DT_SkillInfo.CooldownConfig.CdTime` | Ticks against gameTime |

### Extracted, not consumed

| field | source | meaning |
| --- | --- | --- |
| **`damageAt`** / **`resolvesAt`** | fire times of the bullets carrying **this key's** damage ids, in the chosen montage | When this ability's damage actually lands, and when it has fully resolved. 883 keys, 377 multi-instant |
| `hitTimes` / `hitCount` | every `ReSkillEvent` in the montage | **Montage-wide context, NOT this key's damage** — see below |
| `cancelWindowOpensAt` / `Duration` | `StateNextAtt` | Open time *is* `actionableAt` (834 keys); Duration is how long input stays accepted |
| `skillEnd`, `sequenceLength` | `EndSkill`, asset property | `sequenceLength` includes the idle-return tail — median **+3.99s** past `skillEnd`. Never a duration |
| `freezeAnimationTime` | `AbsoluteTimeStop` | Correctly excluded from `freezeTime` |
| `variants`, `montageCandidates`, `actionableAtSpread` | candidate ranking | Preserved so a state model can pick later without re-deriving |
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

1. **`actionableAt` is when the next attack can be queued, not when the player is "free".** `StateNextAtt` is 下一个技能 ("next skill"); `K2_NotifyBegin` calls `SetSkillAcceptInput(true)` **+ `CallAnimBreakPoint()`**, `K2_NotifyEnd` calls `SetSkillAcceptInput(false)`. Input pressed earlier is *buffered* (a macro fires at ~30ms) and executes when the window opens and flushes the cache. Dodges and swaps are **not** gated by it.
2. **A bullet spawn is the damage.** `ReSkillEvent` is 添加子弹 ("add bullet"), and no WuWa ability has meaningful projectile travel, so spawn = impact. Confirmed in-game over 60 macro trials (input → delay → dodge-cancel): Sanhua's `basic_1` resolves reliably at ≥210ms, never at 195ms — against an extracted `damageAt` of **0.2102s**. Once spawned a bullet is autonomous; despawn is a separate authored notify (`DestroySpecBullet`).
3. **A Resonance Liberation freezes the in-game clock** — timer, cooldowns and buff/effect/state durations all pause. See the freeze model below.
4. **Echoes: Transform locks, everything else is parallel.** An active-skill desc starting with "Transform" means you *become* the echo → the step occupies `ECHO_CAST_TIME`; "Summon" and direct-attack echoes cast at **zero** timeline time. ~65 lock / ~115 parallel. `opener.js` uses the same classifier (`echoStepTimeOf`).
5. **Cancel behaviour is authored per move, not by a global rule.** A resonator switch lets a committed animation finish and deal its damage (Lupa's Dance With the Wolf, Phrolova's Scarlet Coda, Carlotta); an own-kit action hard-cancels it and the remaining damage is lost. The exception is authored: the tag `切人结束技能` ("switching ends the skill") appears on Camellya's `AM_Attack04` and `AM_Attack03_Ex_Loop`, and `不能切人` ("cannot switch out") marks 179 windows roster-wide.
6. **Hold-button skills need no classifier** — the game authors a hold as its own montage (`AM_*_Hold*`, `*_Loop`), so the measured value already *is* the hold time. Caveat: where a hold reuses the tap's damage id nothing separates them and it inherits the tap's timing (5 keys — Chisa ×4, Zhezhi ×1). Their *damage* is still distinct (`8.78%*8` tap vs `3.76%*16` hold).
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
| **`StrengthCost`** | **Stamina.** Negative, ×100 (kit text "Heavy Attack STA Cost: 20" ↔ `-2000`). A looping attack pays it per tick, so pool ÷ cost is the hold-length limiter — Camellya's Blossom aerial basics are `-500` each |
| **`InterruptLevel`** | **Commitment.** The authored interrupt ranking (basics 2, dodge 6, charge-state 10 — why a dodge cancels a basic). `ChangeSkillPriority` (修改技能优先级, calls `SetSkillPriority`) mutates it mid-animation; 641 montages carry a curve |
| **`SkillTag`** | The game's own classification vocabulary, authoritative where kit prose and our key names disagree |
| `ToughRatio`, `BurstLockTime`, `CooldownConfig.MaxCount` | Poise, burst lock, cooldown **charges** |
| `SkillBuff` / `SkillStartBuff` / `SkillEndBuff` | Buff wiring per cast |

From montages: **`gameplay_tags`** (1,046 timelines — `不能切人`, `切人结束技能`, `霸体` super armour, `无敌` i-frames, `禁止体力恢复` stamina-regen block), **`weapon_slots`** (208), `priority_changes`, `break_points_s`, and `buff_applied_s` for exact buff-application frames.

## Still open

1. **Echo animation timing.** `ECHO_CAST_TIME = 1.20` is the engine's last fabricated timing constant. The assets are available (`Content/Aki/Character/Monster/` is in the full client export, and the parser detects by export class, not path) — what is missing is the join: echo → monster skill row → montage has no `hit-map.json` equivalent.
2. **Character state modelling** — 13 keys, 6 resonators (`needsStateModel`). The timing data is complete; the *state* is missing. Open item #22.
3. **Per-bullet time dilation** — deliberately out of scope.

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
