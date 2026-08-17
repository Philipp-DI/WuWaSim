# GLOSSARY — what the words mean

Two vocabularies collide in this codebase: Wuthering Waves game terms and
project-invented terms. The second table is the one you cannot google.
Naming rule (CLAUDE.md, Code Style): one concept, one name — the names below
are the canonical ones; code should not introduce synonyms or abbreviations
for them.

---

## Game terms (Wuthering Waves)

| Term | Meaning |
| --- | --- |
| **Resonator** | A playable character. The roster has ~56; a build configures exactly one. |
| **Element** | One of six damage elements: Glacio (1), Fusion (2), Electro (3), Aero (4), Spectro (5), Havoc (6). The `elementId` numbering is load-bearing (invariant). |
| **Basic / Heavy Attack** | Normal attack string (staged: Basic 1→2→3…) / charged attack. |
| **Resonance Skill** | The "E" ability. |
| **Resonance Liberation** | The ultimate. Costs **Resonance Energy**. |
| **Intro / Outro Skill** | Cast automatically when a resonator swaps IN (Intro, requires full Concerto) / swaps OUT (Outro). Outros often buff the incoming resonator, and 13 also deal damage — up to 795% of ATK. An Outro has NO level curve (its `level` map is empty), so its multiplier comes from the description text. |
| **outro mode branch** | An Outro whose description is a MENU keyed by Resonance Mode ("When in Resonance Mode - A, … When in Resonance Mode - B, …"). Each branch has its own value and duration; `outroBuffs[*].mode` carries the key and only the outgoing member's own mode is live. |
| **Forte Circuit** | A resonator's unique gauge mechanic; "forte" skills consume/build the **Forte gauge**. |
| **Resonance Energy / ER** | The Liberation resource; **Energy Regen** (ER) scales how fast every gain fills it. |
| **Concerto Energy** | The swap resource (gauge cap 100). Full gauge → Outro→Intro handoff fires on swap. |
| **Resonance Chain (S1–S6)** | Duplicate-unlocked upgrade nodes ("constellations"). Each level can carry passive effects. |
| **Inherent Skill** | A resonator's unlockable passive talents (IH nodes). |
| **Echo** | Equippable gear (5 slots) with a main stat, substats, and — for the slot-0 echo — a castable **Echo Skill**. The game's own files call these **Phantoms** — see the data-vocabulary table below. |
| **Sonata (set)** | Echo set bonus family (2pc/3pc/5pc tiers). "Set" and "sonata" are the same thing. |
| **Negative Status / Bane** | Debuffs living on the ENEMY (e.g. Havoc Bane) — shared by the whole team; many kit effects gate on them. |
| **Off-Tune bar / Tune Break** | A bar on the ENEMY that any resonator can break once it is full. The **response** is a cast every resonator has (`resonator.tuneBreak`, named by weapon type), priced by the tune-bar formula rather than by a character multiplier — no ATK scaling, no crit, no gear stat. |
| **Shifting / Interfered** | The two halves of a tune status. A cast inflicts **Shifting** (25s); a Tune Break on a Shifting target converts it to **Interfered**. Three families share the shape — Tune Rupture, Tune Strain, Hack. |
| **Tune Break Boost** | A points stat, base 0 (`WeaknessTotalBonus`), granted by kits. A Tune Strain RESPONDER converts it: +0.12% of their total DMG per point per Interfered stack (`src/core/tune-break.js`). |
| **Coordinated Attack** | Damage a benched (off-field) resonator contributes while someone else is active. |
| **Amplify / Deepen** | Separate multiplicative damage buckets on top of the additive DMG-bonus bucket (see formula.js header). |
| **STA** | Stamina — cost rows in the data that look numeric but are NOT damage (a known matching trap). |

---

## Game-data vocabulary (what the game's own files call things)

The shipped client and its config tables use a different vocabulary from the
English UI. These are the names you meet when reading the game's data, and the
mapping is not guessable — look it up here rather than inferring it.

| Data name | Is actually |
| --- | --- |
| **Phantom** | **Echo.** `db_phantom.db`, `db_PhantomBattle.db`, `ExhibitPhantom.js` — there is no `db_echo` anywhere in the ConfigDB. |
| **QTE** | **Intro Skill.** `DT_SkillInfo` names the rows `…QTE入场` ("QTE entry"); Denia has two because she has two forms. |
| **codename** (`RoleBody/Name`) | A resonator's internal Role folder — westernised-from-Chinese and matching NO display name (Denia → `FemaleMS/Daniya`, Camellya → `FemaleM/Chun`, Chisa → `FemaleM/Qianxia`). **Never parse or trust these.** Identity comes from DATA: a `DT_SkillInfo` row id's leading 4 digits are the resonator id. Full map: `docs/RESONATOR-ROSTER.md`. |
| **`SpecialEnergy{N}`** | A named stack gauge (Denia's Dark Core, Changli's Enflamement). `SpecialEnergy{N}Max` is its cap and is authoritative. Channels 1–4; `Energy` (59/60) is the separate Liberation resource. |
| **`GameAttributeID`** | A stat id from the client's own `EAttributeId` enum, `Aki.Protocol.Vks` in `Core/Define/Net/Protocol.js` (144 entries) — the ONLY authority. Do not derive it from `BaseProperty.js` getter order. Landmarks: `15` DamageChange, `59–68` energy channels, `99` IgnoreDefRate. |
| **`CalculationPolicy`** | How a buff's `ModifierMagnitude` is applied, per `ActiveBuff.ModifyStateAttribute`: **0** flat add · **1** scale the base (`-10000` ⇒ zeroed) · **2/4/9** a fraction of the attribute named in `policy[1]` · **3** override (`0` ⇒ zeroed) · **5/6** per-duration. `10000` = 100.00%. |
| **`ExtraEffect*`** | A buff's conditional payload. `ExtraEffectRequirements` type 1 = SkillIds, type 5 = BulletIds. `ExtraEffectReqPara` is indexed **by the requirement**, not by the buff. `ExtraEffectReqSetting`: **0 = ALL** (scope lists INTERSECT), **1 = ANY** (they UNION — and a non-scope requirement then lets the effect fire outside the list). |
| **`DT_SkillInfo`** | The per-character DataTable whose ROWS ARE THE CASTS. `SkillBuff` / `SkillStartBuff` / `SkillEndBuff` hold buff ids: the **cast → buff** link. Read with `ue_tagged.parse_datatable` (not `ue_asset.read_export`, which returns only an export's tagged properties). |
| **`db_PassiveSkill`** | The **event → buff** link: `TriggerType` (`DamageTrigger`, `TagTrigger`, `KillTrigger`, …) + `SkillAction: AddBuff` + `SkillActionParams`, each with its own `CDTime`. |
| **ConfigDB** | The ~500 `db_*.db` SQLite files of `(Id, BinData)` FlatBuffers rows, plus the client's own JS accessors that spell out every field's offset and type — so the schema is READ, never guessed (`tools/extract/configdb.py`). |
| **name-map skew** | A package whose `.uexp` addresses one MORE name-table entry than its `.uasset` declares, desynchronising the property walk. Confirmed on Lucilla (`FemaleXL/Luosela`); `parse_datatable`'s `repair_vocabulary` recovers it. |
| **bullet chain** | montage notify → bullet → damage id, the exact-identity join from an animation to the hits it produces (`data/bullet-timings.json`). The alternative — prefix-matching a damage id against `DT_SkillInfo` row ids — is coarser because rows are shared. **The two id spaces differ** for E/Q/Intro: a DT row id is not a prefix of those damage ids. |
| **folder suffixes** | `_GD` = an alternate combat form worth indexing (Aemeath's mech). `_FP`, `_Rogue`/`_Rouge`, `_photos`, `_story`, `_MainLine`, `_TowerDefense` = non-combat or mode-specific variants that REUSE the combat id space with different numbers — never merge them. |

---

## Project terms (invented here — the canonical names)

### Data & pipeline

| Term | Meaning |
| --- | --- |
| **dataset** | The parsed `wuwa-data.json` object every sim function receives. Generated — never hand-edited. |
| **nanoka source** | Raw per-character JSON dumps from nanoka.cc under `data/extracted-nanoka/`. |
| **curated data** | Human-authored inputs the pipeline folds in (`patch.json`, `skill-map.json`, `reference-rotations.json`, `effect-overrides.json`, the `rotation-rules.js` tables). See ARCHITECTURE.md §7. |
| **the meta** | `wuwa-meta.json` — frozen optimizer output: substat weights, suggested builds, ranked teams. "Covered" characters have meta entries; others fall back to live sim. |
| **anchor** | The character a suggested team is built around; also the reference build a character's weights were derived at. |
| **engineHash / ENGINE_FILES** | The meta records a hash of the engine files it was computed with; the two ENGINE_FILES lists (optimize.mjs, meta-schema test) must stay in sync. |
| **LOCK A / LOCK B** | Refactor checks: regenerate `wuwa-data.json` / `wuwa-meta.json` and require a zero diff (CLAUDE.md, Test commands). |
| **display row vs damage instance** | One skill-panel line in the game (row) may bundle several raw hits (instances). `matchRowHits` maps rows to instances by full 20-level multiplier vectors. |
| **rate vector** | That 20-level multiplier array — the fingerprint used for row↔instance matching. |

### Build & rotation

| Term | Meaning |
| --- | --- |
| **build** | One resonator's full user configuration (level, weapon, echoes, skill levels, rotation, toggles). |
| **skill key** | The string identifying one castable ability (`'liberation'`, `'basic_3'`, `'forte_heavy'`). Rotation steps are skill keys. |
| **special step key** | A rotation step that belongs to no skill map: `'__echo__'` (the slot-0 echo's active skill) and `'__tunebreak__'` (the Tune Break response, offered to every resonator). Both are slotted by hand. |
| **skill map** | Per-resonator `skillKey → skill definition` table (curated `skillMap` first, auto-generated fallback; resolved by `effectiveSkillMap`). |
| **rotation** | Ordered list of skill keys. Persisted ONLY as this linear array; the graph view is sim-time-only (invariant). |
| **step** | One executed cast in a sim result: damage, timing, energy, active buffs. |
| **`skillType` (node)** | MECHANICAL kind of cast (what you pressed): basic/heavy/skill/liberation/intro/outro/forte_*. Drives cast triggers, multiplierUp matching, stage logic. |
| **`formulaType`** | DATA-DRIVEN damage categorization, read from the game's per-instance type tag. ONE value, because it is also the skill-LEVEL key — there is exactly one level table per hit. Carlotta's Liberation: `skillType 'liberation'`, `formulaType 'skill'`. Never conflate the two. |
| **attribution** (`dmgTypes` on a row) | WHICH DMG-type bucket a hit reads — exactly ONE, since the client's `GetAttackTypeDamageBonus` is a switch on the instance's `Type` (`core/dmg-attribution.js`). `dmgTypes` records what the tags said: one member normally, TWO when the game ships a per-Resonance-Mode branch (Lucilla's [Letting It Go]), which `build.resonanceMode` resolves. 24 roster rows are attributed to echo ALONE, their `formulaType` being only a mechanical stand-in. Absent ⇒ read `formulaType`. Lives on the row, not the skill key: one key can gather rows that disagree. |
| **grant** | A curated reason a rotation step is legal despite the generic stage heuristic ("chained from Intro Skill"); rendered as a ⤷ chip. Tables: `STAGE_GRANTS`, `SWAP_IN_ENTRY`, `RESOURCE_DEFS`. |
| **state** | A named character stance/mode tracked per step (`STATE_DEFS`, e.g. Denia's Stagecraft) — enters on a cast, exits by duration or a consuming cast; gates effects and off-field actions. |
| **`actionableAt`** | ~~Seconds until the player regains control.~~ **Retired 2026-07-31.** One name over four different quantities. Replaced by `stepDuration` (the animation) + `resolvesAt` (the damage), combined by `resolveStepDuration`. |
| **`stepDuration` / `stepDurationRule`** | The step's length and the marker it came from: `nextAtt` → `skillEnd` → `idleReturn` → `sequenceLength`, strongest first. The rule ships with the number because only the first rung is a measurement of when input is accepted, and the last is not a duration at all. |
| **`nextAttAt`** | When the next skill can be **queued** (`StateNextAtt`, 下一个技能, `SetSkillAcceptInput(true)`). Not "the player is free" — dodges and swaps are not gated by it. Was called `cancelWindowOpensAt`. |
| **`damageAt` / `firstDamageAt` / `resolvesAt`** | The instants an ability's damage lands, and its two ends. Derived from the bullets carrying *that key's* damage ids — distinct from `hitTimes`, which is every bullet spawn in the montage and includes other abilities' hits and non-damaging probes. Absent a cancel, `resolvesAt` is the earliest a step can end without losing damage. |
| **`timingIsLoop`** | The animation repeats while held, so its measured times describe ONE iteration rather than the whole action. Separate from `timingProvisional`, which reports only the strongest caveat. |
| **`freezeTime`** | Seconds of a `stepDuration` during which the in-game clock stops — cooldowns, buff/effect durations and the DPS denominator all pause. Measured from the animation's `TimeStopRequest` notify. Counted once per animation per rotation (`resolveFreezeSchedule`). |
| **effectToggles** | Build map of manually-assumed conditional effects; keys `S{level}.{index}` / `IH{node}.{index}` (invariant). Stackable effects store an integer stack count. |
| **resource / gauge** | A curated named stack gauge (`RESOURCE_DEFS`): `{ name, channel, cap, gains, spend/spendAll }`. `channel` binds it to the game's `SpecialEnergy{N}`, which supplies the cap. Distinct from a **state** (a stance) and from a **mode** (a build-level toggle). |
| **cast lane / trigger lane** | The two ways a gauge earns. The **cast** lane is the gauge moving because a skill was cast — readable from `DT_SkillInfo` (`data/gauge-income.json`) and the lane `RESOURCE_DEFS` models. The **trigger** lane is it moving because something HAPPENED (a hit landed, a timer elapsed) — `db_PassiveSkill`, extracted but deliberately NOT wired, since the resource model is per-cast by construction. |

### Buffs & effects

| Term | Meaning |
| --- | --- |
| **effect** | A chain/inherent/skill-node passive parsed into structured form (stat, value, condition, trigger, window). |
| **effect source / slot key** | The THREE namespaces effects arrive in: `S{level}.{index}` (Resonance Chain), `IH{node}.{index}` (Inherent Skill), `SK{node}.{index}` (**skill-node effect** — a buff the game states inside a Liberation / Skill / Forte node). The first two are FROZEN: overrides and saved builds address them, so any pass that changes an effect COUNT must run before the overrides. |
| **trigger × window** | The activation model: a trigger fires (castMatch / stateEnter / modeMatch / healing), a window keeps it live (seconds / persist / stateBound / untilConsumed / **thisCast** / always). |
| **`thisCast`** | The window for a buff that applies to the TRIGGERING cast itself. `persist` cannot express this — its castMatch check reads strictly EARLIER steps, so it misses the very cast the buff is for and then applies to every step after it. |
| **consumption-scoped effect** | An effect scoped by ARITHMETIC rather than by a skill name: `stackTrigger: { type: 'resource', consumed: true }` counts what the step SPENDS, which is 0 on every cast that spends nothing. This is what lets Denia's "+150% per [Dark Core] consumed" ship unscoped without multiplying her whole kit — the one exemption to the unscoped-`multiplierUp` drop. |
| **`stacksUnknown`** | The honest answer when a stack count is underivable: ONE stack, flagged. Never `maxStacks` — a real cap makes that a large silent assertion. |
| **(buff) window** | A time interval during which a buff is live, with per-step stack samples. "Windowed" = applied by literal step overlap. |
| **flat (approximation)** | The opposite: a buff credited at full value across a whole rotation/segment because its timing isn't derivable. Being progressively replaced by windows (TEAM-BUFF-TIMELINE-PLAN). |
| **stack ramp** | Stacking buffs climb 0→cap per qualifying step and decay — never applied at max flat (`buffs/buff-timeline.js`). |
| **team-wide** | A buff whose recipient is the whole team. Three disjoint application lanes — see ARCHITECTURE.md §4; picking the right lane is an invariant. |
| **incoming-resonator transfer** | Outro-granted buff targeting the NEXT resonator specifically (not team-wide); applied flat to the receiving segment. |
| **DMG-bonus bucket** | The additive `(1 + Σ bonuses)` term: element bonus + the ONE skill-type bonus the hit's attribution names (falling back to `formulaType`). Distinct from amplify/deepen (each multiplicative). |

### Team sim

| Term | Meaning |
| --- | --- |
| **segment** | One contiguous block of one member's casts on the team timeline (auto-Intro, authored rotation, auto-Outro). |
| **pass** | One full cycle through all members. Ranking sims use 3 passes. |
| **team time** | The absolute time axis across all segments; buffs, cooldowns, and statuses live on it. |
| **teamBuffTimeline** | The chronological ledger of team-wide buff windows accrued while segments simulate; later segments receive overlapping windows (`externalBuffWindows`). |
| **opener / filler / gated** | Cold-start handling when `deriveOpeners` is on: filler = greedy energy-generating casts spliced before a Liberation that can't be paid; gated = the cast is dropped and reported when no filler can pay it. |
| **off-field share** | Benched members receive 50% of energy generated by others' casts (× their own ER). |
| **erOverride / minViableEr** | Per-team meta values: the ER at which the authored rotation loops clean (computed openers-OFF, deliberately). |
| **Concerto handoff** | The Outro→Intro exchange at a swap; modeled always, damage-gating opt-in (`enforceConcerto`). |
| **covered** | A character/config with real meta entries (weights, suggested build/teams); everything else falls back honestly to live sim or "no suggestion available". |
| **`gameTime` / `realTime`** | The two clocks. `gameTime = totalTime − totalFreeze` and is **the DPS denominator** (`timingMode: 'toa'`); `realTime` is wall clock. Using the wrong one once reported a 3.09x gap against a 1.8x damage gap. |
| **marginal (per-pass)** | A member's damage in pass N, computed as the N-pass total minus the (N−1)-pass total. Necessary because the negative-status lane accrues post-hoc on the shared timeline: reading segments alone drops it. Team totals come from `memberTotals`, never from summing segments. |
| **cross-segment carry** | State handed from one segment of a member's turn to the next, and to their next pass — because a turn is SEVERAL `simulateRotation` calls (the auto-injected Intro is its own segment). `carryInFires` / `sim.memberFires` carries the trigger ledger; `carryInResources` / `resourceEndLevels` / `sim.memberResources` carries gauge levels. A mechanic that is correct solo and silently zero in a team is usually a missing carry. |
