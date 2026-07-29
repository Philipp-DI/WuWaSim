# WuWaSim — Timing Model & Ability Data Sourcing

Read this before writing or modifying anything related to `actionableAt`, `freezeTime`, `cooldown`, buff duration, or DPS calculation.

## Context

Community references (prydwen.gg, Maygi's calculator) report DPS numbers well above what a naive real-time simulation produces. This isn't an error in either direction — they're using a different time convention. Tower of Adversity (the benchmark content) freezes the challenge timer and ability cooldowns during Resonance Liberation (and Tune Break) animations, so community DPS figures divide by a shorter "effective" time than a wall-clock sim would use. WuWaSim should model this explicitly rather than picking one convention and hoping it matches.

## Two-clock time model

Track two time axes per rotation, not one:

- **`gameTime`** — advances by `actionableAt - freezeTime` per action. Cooldowns **and** buff / effect / character-state durations tick against this, and it is the DPS denominator in ToA-benchmark mode. Everything the game's own clock drives lives here.
- **`realTime`** — advances by full `actionableAt` per action. It positions the timeline for display and is the wall-clock rotation length.

This split matters because the two don't move together: during a Resonance Liberation animation the in-game clock freezes — cooldowns stop, active buffs keep their remaining duration, and the challenge timer pauses — while realTime keeps advancing through the animation. A single-clock model gets one of the two wrong.

> **Correction (2026-07-23).** Earlier drafts had buff/debuff durations ticking against realTime ("buffs do not pause just because the challenge clock did"). That was wrong: the maintainer confirmed a Liberation animation freezes buffs, cooldowns, and the timer alike. Duration decay now measures `gameTime`. See **Confirmed mechanics** below.

**Scope:** this split only applies to timed benchmark content (ToA, boss trials). Open-world and non-timed combat should run a single real-time clock — implement this as a mode flag, not a hardcoded assumption, so `freezeTime` can be zeroed out / ignored outside ToA-style content.

**Practical note:** `freezeTime > 0` mainly applies to Resonance Liberation and Tune Break animations. Basic/Heavy/Skill attacks are `freezeTime = 0` in almost all cases — don't go looking for freeze windows outside those two ability types unless a specific character's kit says otherwise.

## Confirmed mechanics (maintainer, 2026-07-23)

We cannot obtain measured frame-count timings (see the reframed Sourcing note below). What we *can* encode are the timing mechanics the maintainer has confirmed in-game. These are modeled structurally — no fabricated numbers — and are the source of truth over any estimate:

1. **A Resonance Liberation animation freezes the in-game clock** — challenge timer, cooldowns, **and** buff/effect/state durations all pause for the whole (non-interruptible) animation. Modeled as `HARDCODED_FREEZE_FRACTIONS.liberation = 1` in `sim.js` (freeze = the entire `actionableAt`; a dataset may override via `_defaults.freezeFractionBySkillType`), honored in `'toa'` mode and ignored in `'open'`. Implemented in `sim.js` (`resolveFreezeTime`, `computeStepTimes`, `deriveGameTimes`), with duration decay reading `gameTime` in `buff-timeline.js` (sonata stacks), `rotation-state.js` (state `seconds` exits), and the effect-`seconds` window in `buffs.js` (`sim.js` feeds it `gameStart`/`gameEnd`).

   **Only the CINEMATIC cast freezes** — a multi-step Liberation freezes just its opening cinematic, not the enhanced-state follow-ups. The gate (in `resolveFreezeTime`) is `skillType === 'liberation'` AND `consumesResource !== false` AND `liberationCost > 0` (the caster's `energyMax`):
   - **Energy ultimates** (Carlotta, Augusta — `energyMax > 0`): the opener consumes the bar (`consumesResource` undefined) → freezes; continuations are stamped `consumesResource: false` (Carlotta's Death Knell / Fatal Finale, Augusta's Sublime is the Sun) → do NOT freeze. Without this, the whole enhanced-state sequence freezes and `gameTime` collapses toward 0.
   - **Non-energy "ultimates"** (Lucilla, Phrolova — `energyMax 0`): their liberation-tagged steps are enhanced on-field attacks, not cinematics, and none is stamped `consumesResource: false`, so the `liberationCost > 0` guard is what stops them all freezing.
   - **Conservative residual:** a genuine cinematic *finale* (Carlotta's Fatal Finale) or a non-energy character's real cinematic cast is under-frozen — the data carries no "cinematic" flag to distinguish it, and under-freezing is the safe (never-inflate) direction. A curated key list could add such casts later.
2. **Almost every skill and attack is instant and interruptible.** Timings are animation-based and any animation (except a Liberation) can be cut by the next input. We have no measured cast lengths, so the per-type `actionableAtBySkillType` estimates stand in as the "committed time until next input" proxy — a best-effort realTime scale, not a claim of accuracy.
3. **Parallel vs transformation echoes** (maintainer-verified in-game 2026-07-24 via the desc prefix — the clean classifier we thought didn't exist). A **transformation** echo — active-skill desc starts with **"Transform"** (you BECOME and control the echo) — LOCKS the resonator, so its step occupies `ECHO_CAST_TIME`. Every other echo — **"Summon"** (a helper that fights alongside while you keep acting) and direct-attack echoes — casts in **parallel**: full damage + energy at **zero** timeline time. Classified by `resolveEchoStepTime` (`ECHO_TRANSFORM_DESC = /^\s*transform/i`), computed once and threaded through `computeStepTimes` + the walk. ~65 Transform (lock) / ~115 parallel across the roster. (`opener.js`'s separate `ECHO_CAST_TIME` heuristic is unchanged — a follow-up if opener↔sim echo timing should match.)

4. **A manual Tune Break activation freezes the in-game clock** too (maintainer-confirmed in-game 2026-07-24), like a Liberation. Tune Break is not yet a sim step (its "off-tune buildup" gauge + trigger are unmodelled — see `NEGATIVE-STATUS-REFERENCE.md`), so there is nothing to freeze today; recorded here so that when a manual Tune-Break rotation step is wired it gets the same whole-animation freeze (add its skillType to `HARDCODED_FREEZE_FRACTIONS`).

**Status of the remaining facts (assessed 2026-07-24):**

- **Transformation-echo classification — SOLVED** (point 3 above): the desc-prefix regex is the maintainer-verified flag we'd earlier concluded was missing. Transformation echoes now lock for `ECHO_CAST_TIME` — an **estimate**: the real transform sequence is longer (and the sim still models it as a single damage instance), so this **under-counts** the lock, conservatively. The real lock duration + the multi-hit transformed sequence still want real animation data. **Hold-button skills** (the other half of fact 4) remain unaddressed — no classifier for them yet.
- **Fact 5 — resonator-switch cancels the previous animation, outro fires if the Concerto bar was full:** already modeled. Intro/outro auto-cast (`AUTO_CAST_SKILL_TYPES`), the Outro→Intro handoff gates on `enforceConcerto`, and the instant-cast + parallel-echo model leaves no lingering animation to cancel at a switch. No actionable gap.
- **"Collapse instant skills toward zero realTime" rescale:** deferred — no measured base to justify a new time scale.

## Ability data schema

**Renamed `castTime` → `actionableAt` (maintainer, 2026-07-28).** WuWa abilities
activate on button press, not on a spell-cast delay, so "cast time" implied the
wrong mechanic. The field was never hit-registration time either — a hit can
land before *or* after it (see `hitTimes`); it's specifically when the player
regains control (`resolveActionableAt` in `sim.js`, mirroring the raw
extraction's own `actionable_at_s`). Renamed everywhere: `sim.js`
(`HARDCODED_ACTIONABLE_TIMES`, `resolveActionableAt`), `preprocess.mjs`
(`ACTIONABLE_TIMES`), `skill-map.json` (`_defaults.actionableAtBySkillType`),
`data/actionable-times.json` (formerly `cast-times.json`), tests, this doc. The
visible UI label ("Cast 0.55s" in the rotation palette/steps) was deliberately
left as-is — a copy decision, separate from the internal field name.

```js
{
  actionableAt: number,   // seconds until the player regains control (NOT the full animation length — see sequenceLength)
  freezeTime:   number,   // seconds of actionableAt where gameTime/cooldowns are frozen (0 for most non-Liberation/Tune-Break abilities)
  hits:         number,   // damage instances; distribute evenly across actionableAt for v1 (see Precision below)
  cooldown:     number,   // seconds, ticks against gameTime
  energyValues: {...},    // concerto / resonance energy generated
  cancelPoint?: number,   // optional: earliest time a swap-cancel can occur, if known
  source: "imported" | "frame-counted" | "extracted" | "estimated"   // REQUIRED — see Sourcing below
}
```

`source` is a required field, not metadata to skip. Do not merge ability data into the project without it — it's what lets users (and future us) tell a solid number from a guess. Don't let an estimated value look as solid as a measured one in any downstream UI/output.

## Sourcing ability data — priority order

> **Superseded (2026-07-28):** extraction from the game's own animation assets is now the primary source — see **Extraction results** below. The "not currently obtainable" framing (2026-07-23) held while the only known route was Maygi/frame-counting; it no longer does. Items 2–3 remain the fallback ladder for anything extraction doesn't cover.

0. **Extract from the game's animation assets** (`tools/extract/extract_timings.py`, `tools/extract/map-timings.mjs`) — read the montage's own cancel/actionable notify (not `SequenceLength`) directly from an FModel-exported asset tree, joined onto the sim's skillMap keys via the existing `data/hit-map.json` id space. Roster-wide, no footage needed, no permission/attribution concern (derived numbers only, no redistributed assets — see `docs/LANE-B-ASSET-EXTRACTION.md` §9). Tag `source: "extracted"`.
1. **Import Maygi's calculator data** for anything extraction doesn't cover. Her sheets have measured `actionableAt` / `freezeTime` / `hits` / `cooldown` for most of the roster (through roughly patch 2.6). Get permission and credit her in the project's attribution before shipping this. Tag `source: "imported"`.
2. **Frame-count from public 60fps footage** for anything still missing. Doesn't require owning the character. Pipeline: `yt-dlp` for footage (official kit showcases, rotation-guide channels, arabwuwa's recorded rotations) → `ffmpeg` frame extraction → count input-frame to next-action-available-frame for `actionableAt`, hit-flash frames for `hits`, frozen-HUD frames for `freezeTime`. Tag `source: "frame-counted"`.
3. **Estimate only as a last resort** (e.g., a character with no footage available yet). Tag `source: "estimated"` and surface this as provisional in output.

## Extraction results (2026-07-28)

Ran the full pipeline against a user-provided FModel raw-asset export of the entire `Role/` tree (`docs-local/Role`, gitignored — 35,805 `.uasset` files, 72 `DT_SkillInfo` tables). Two bugs were found and fixed in the pipeline itself while landing this (both were silent — they degraded coverage rather than erroring):

- `resolve_game_path`'s suffix match assumed the export root sits at or above `Aki/`; this export starts one level deeper, at `Role/`, so the primary match never fired and everything fell through to an ambiguous basename-only fallback that fails on generic montage names (`AM_Skill02`, `AM_Burst01`, reused across many characters). Fixed to walk trailing path segments from most to least specific instead of assuming a fixed root depth. Montages parsed jumped **489 → 1,344** on the same export.
- The "unreferenced montages" report used `str.lstrip('/game/')` (character-class strip, not a prefix strip) to normalize paths — cosmetic-only (report accuracy, not the join), fixed alongside.

Re-validated against the handover doc's byte-exact Rebecca (1308) fixture after the fix — all four rows match exactly (hits, `actionable_at_s`, `skill_end_s`, and the 3.0s Liberation `freeze_total_s`).

**The join** (`tools/extract/map-timings.mjs`, `data/actionable-times.json`): rather than inferring which DT_SkillInfo row is "the skill entry" from `SkillGenre` ordinals or kit text, it reuses `data/hit-map.json` — preprocess.mjs already records, per `autoSkillMap` key, the game's own per-hit BinData damage ids it matched (same id space DT_SkillInfo uses, verified identical roster-wide — see the Forte-extraction history entry). Two independent routes turn such a damage id into a real animation; see **The bullet chain** below for the primary one. Every run also regenerates `docs/timing-gaps-report.md` — every unresolved skillMap key, grouped by resonator, each failed damage id annotated with the bullet that applies it *under the designer's own label*, so a gap can be triaged as "animation exists, link missing" vs "summon/DoT/field tick, no animation to find".

**Coverage: 1,023/1,061 autoSkillMap keys (96.4%) get a real extracted `actionableAt`** (and, where the animation froze, a real `freezeTime` — no longer the `HARDCODED_FREEZE_FRACTIONS` estimate). Each entry also carries `cancelWindowOpensAt`/`cancelWindowDuration` (the `TsAnimNotifyStateNextAtt` input-buffer window — a separate quantity from `actionableAt`, not currently consumed by anything but kept since it's real data), `hitTimes` (the raw per-hit instants — a hit can land before *or* after the player regains control), and `skillEnd`.

### The bullet chain — the primary route (2026-07-28, supersedes prefix matching)

The DT_SkillInfo route below joins by **structure**: recover a skill row from the damage id by longest exact prefix match, then read the montages that row references. That is both lossy and coarse, and it capped coverage at 81.2%. It is now the *fallback*. The primary route joins by **identity**, following the link the game itself stores (`tools/extract/scan_bullet_timings.py`, `data/bullet-timings.json`):

```text
animation notify  --子弹数据名 / bulletRowName / BulletIds / 子弹id数组-->  bullet id
bullet table row  --伤害ID / 多伤害ID (transitively via 子子弹设置.召唤子弹ID)-->  damage id
```

Every `TsAnimNotify*` object inside an animation names the bullet it fires, and each bullet's `DT_ReBulletDataMain` row names the damage ids it applies — the same ids `hit-map.json` records. Exact string identity at every hop: nothing is decomposed, padded, or guessed, and the result is the *one* animation producing that exact damage instance.

Why it takes precedence over the row route, beyond coverage: distinct abilities frequently share one DT_SkillInfo row (**30.6%** of row-route keys share their row with another key), so the row route hands them all one merged number — it gave Camellya the same `actionableAt` for `heavy_heavy_attack` and `liberation`, and Baizhi one number for all four basics. The bullet chain separates them per animation (Baizhi's basics resolve to `AM_Attack01`–`04` at 0.5/0.6/0.7/0.6s). Final split: **883 keys via the bullet chain, 141 via the row fallback.**

Four things had to be right, each found by following evidence rather than assuming the first working case generalised:

- **Bullet ids are not damage ids.** They coincide for most of the roster, which is why a naive scan looked ~complete. Baizhi's intro damage `1103160001` is applied by bullet `11030160002` — a *different number*, so no prefix or padding rule could ever have found it. Only the bullet table's own `伤害ID` field links them.
- **Four notify spellings, not one.** `TsAnimNotifyReSkillEvent.子弹数据名` (a plain hit), `TsAnimNotifySkillBehavior…Bullets[].bulletRowName` (a **condition-gated** hit — how alternate-form movesets are authored, and why the stance-switch kits looked unreachable), `TsAnimNotifyStateBulletDuration.BulletIds[]` (a sustained/channelled hit, e.g. Baizhi's charged shot), and `TsAnimNotifyReSkillEvent.子弹id数组[]` (a multi-bullet hit, e.g. Calcharo's Extermination Order). The scanner reports any *unread* bullet-ish field name it encounters (`unreadBulletLikeFields`), so a fifth spelling surfaces in the report instead of silently becoming a coverage gap. `bulletName` is deliberately **not** read — it belongs to `TsAnimNotifyDestroySpecBullet`, and reading it would stamp a hit time on a despawn.
- **Carrier bullets.** A montage often fires a bullet that deals no damage and spawns the one that does: Encore's `AM_Attack01` fires `1203600101` ("basic attack 1 — ground-detection bullet"), whose child `1203600001` ("basic attack 1") is the hit-map id. Damage ids are therefore the transitive closure over `子子弹设置.召唤子弹ID` (iterative with a visited set — child configs can point back at an ancestor).
- **`AnimSequence`, not just `AnimMontage`.** Mortefi's mid-air attacks live in `AirAttack/AirAttack01_FR`, a bare sequence. Both classes expose `Notifies` + `SequenceLength`, so the same reader handles either. Detection is by export class, never by an `AM_*` filename — the same assumption that once hid Chixia.

Non-combat-mode animations (`Rogue`/`Rouge`/`photos`/`MainLine`/`TowerDefense`/…) are excluded from candidate montages: their rows reuse the same bullet ids with mode-specific tuning.

### Choosing between candidate animations

One damage id is often fired by several combat animations. They are **not** interchangeable, and three distinct situations hide behind that, each needing a different answer. Taking the earliest time in all three (the original rule, inherited from the row route's `min()`) was wrong in all three.

**1. Sequential phases of one action.** An animation with **neither a cancel window nor a skill-end notify** never gives the player control back, so it cannot be where the action completes — it is an uncancellable wind-up that chains into a follow-up (`X_Start` → `X_End`). `derive()` marks these `is_phase`. A phase is never chosen as the answer, and where the chosen `X_End` has a matching `X_Start` among the candidates, the phase's full length is *added* (`leadInPhaseMontage`/`leadInPhaseLength` record it). 17 entries compose this way, and the correction is large — Changli's Skill went 0.31s → 1.48s, Cantarella's mid-air 0.20s → 1.00s: the old value described only the tail of the move.

  The export offers exactly one control for the arithmetic, and it holds: Camellya ships **both** a split pair and a monolithic `AM_Attack05` of the same attack. `_Start` length 0.6167 + `_End` cancel 0.69 = **1.307** against the monolithic's own **1.34** (Δ 0.033s ≈ two frames of blend), and the monolithic's hit instants line up with the two phases' hits offset the same way. One control is thin evidence for the exact sum, but the *direction* needs no control: a phase has no cancel window, so the player demonstrably cannot act during it, and any value below the phase's length is impossible.

**2. Mutually-exclusive state variants.** Ground vs air, base vs enhanced, `_LimitDodge`, `_8M` range variants, alternate-model `_20011` copies. Here `min()` systematically picks the *fastest* variant, which is usually the air or shortcut version — an optimistic bias.

**3. One damage id genuinely shared by different actions.** Sanhua's skill damage is also dealt by her enhanced basics, so her `skill` key had five candidates spanning 0.33s–1.00s and `min()` answered with a **basic attack** montage.

Cases 2 and 3 are resolved by bringing the row route back in as a *disambiguator only, never as a timing*: the DT_SkillInfo row names which animation belongs to the ability. When the row singles out exactly one candidate, that candidate wins (`disambiguatedBySkillRow`). Zero matches is not evidence against the ranked pick — the row often names the `_Start` phase that was deliberately filtered out — so only a unique match is trusted. This applies to 114 entries and corrects 26 values, every one moving from a variant to the canonical montage: Jianxin's `basic_2` off `AM_Switch_Skill` onto `AM_Attack02`, Yinlin's basics off the `_8M` range variants, Chisa's dodge counter 0.13s → 0.80s. It is the row route's one genuine advantage over the chain, so the two are combined rather than ranked.

Where nothing disambiguates, the earliest terminal candidate is still taken. **Every multi-candidate key keeps its full `variants` array** (215 keys) — each alternative's montage, actionable time, cancel window, hit instants and bullet label — so nothing is discarded by the pick and a state model can select between them later without re-deriving anything.

### Curated decisions (`data/timing-overrides.json`)

Hand-edited, same role as `patch.json` / `effect-overrides.json`. Two sections:

- **`pinnedMontage`** forces which candidate a key resolves to, with the reasoning recorded inline. A pin that matches no candidate is a hard error, not a silent fallback, so a stale entry surfaces on the next run.
- **`needsStateModel`** marks keys whose correct timing depends on a character state the sim does not model yet. The extracted value stays as provisional and the alternatives sit in `variants`.

The 13 genuinely-undecidable entries were walked through with the maintainer (2026-07-29). What the walkthrough actually established is that **they were mostly not data problems — they are missing state modelling**: 13 keys across 6 resonators are gated on Zhezhi's ground-vs-air Conjuration, Brant's airborne mid-air rotation, Rebecca's Huntress/Guts weapon mode (default Huntress/pistol), Lucy's [Algorithm Compaction], Camellya's [Blossom Mode], and Roccia's [Beyond Imagination]. Six were decided outright from the game's own labels:

| key | resolved to | why |
| --- | --- | --- |
| Zhezhi `forte_heavy_ha_conjuration` | `AM_Attack05` 1.180s | Ground authoring has no cancel window at all; the air variant's 0.567s cancel is unavailable to a ground rotation |
| Rebecca `intro_yo_it_s_big_boomin_time` | `AM_QTE_S` 1.533s | `手枪切霰弹` = pistol→shotgun, matching "when in [Huntress] … switches to [Guts]". Freeze 1.600s, not 1.051s |
| Rebecca `intro_hey_leadhead…` | `AM_QTE_M_Start01` 1.158s | `霰弹切手枪` = shotgun→pistol |
| Yangyang `liberation` | `AM_Burst01` 2.209s | The only candidate with a Liberation freeze (2.212s). Previously extracted **no** freeze and fell back to `HARDCODED_FREEZE_FRACTIONS` |
| Rover: Havoc `…lifetaker_damage` | `AM_Ex_Skill02` 1.117s | Lifetaker replaces the Resonance **Skill**; this fires `强化技能` (enhanced skill). It had been on `强化重击` (enhanced heavy) — that is Thwackblade |
| Rover: Havoc `…thwackblade_damage` | `AM_Ex_Skill01_02` 0.614s | The enhanced-heavy follow-up, pinned now that Lifetaker moved off it |

### Rover is always the female build

Rover ships male (`MaleM/*Nanzhu`) and female (`FemaleM/*Nvzhu`) builds per element, with separate bullet id blocks applying the **same** damage ids — so both became candidates for one dataset key and the pick was effectively arbitrary. **40 keys across all four elements had landed on the male build.** The two are meant to mirror each other and the dataset models one Rover per element, so the female build is used throughout (maintainer call). Timings are close but not identical — `AM_Attack04` is male 0.800 / female 0.770 — so this is a *substitution* onto the female asset at the mirrored path rather than a filter, which also rescues the 5 Rover: Spectro keys whose damage ids reach only male bullets. 4 keys stay male because the female asset genuinely does not exist in the export (`WindNvzhu/AM_Attack10`, `AM_Attack11`, `AM_W_Attack05_1`, `Nvzhu/AM_SkillQte_Child`).

### Asset naming decoded

- **`*Execute*` montages are Tune Break.** Confirmed at 100%: all 75 `SkillGenre 14` rows use one, and their skill names are all `破弱` ("break weakness") split by weapon — `迅刃破弱` ×17, `音感仪破弱` ×12, `臂铠破弱` ×9, `手枪破弱` ×9, `大剑破弱` ×9. This is the timing data Open Items #7 will need when Tune Break becomes a sim step.
- **`Rogue`/`Rouge`** (both spellings ship): 1,212 assets forming a complete parallel re-tuning of every kit, with their own `DT_SkillInfo_Rogue` and `DT_ReBulletDataMain_Rogue` tables — a separate game mode, hence excluded from combat timings.
- **`QTE`** ≈ Intro Skill, inherited from Kuro's *Punishing: Gray Raven* where QTE is the swap-in ultimate. It has since drifted toward "scripted triggered animation" generally, which is why it reads inconsistently across the tree.

Investigating the coverage gaps of the **row route** found five confirmed, fixed root causes (not "roster gaps" — all five now resolve correctly):

- **Xuanling (1610) parse failure — FIXED.** Her `DT_SkillInfo` table's declared `serial_size` under-reports by exactly 112 bytes (a `ue_header.py` export-table quirk on that one asset — replaying the row walk by hand showed every property on every row decoding to a legible, sensible field name with zero errors, so the row content was never the problem). Every other asset checked lands its walk exactly 4 bytes before the `.uexp` buffer's true end; `parse_datatable` now falls back to that cross-validated target when the declared `serial_size` doesn't land exactly. 29/31 of her rows now have real timing.
- **Lucilla (1109) name-map skew — FIXED.** Her `.uexp` addresses a name map with **526** entries while the `.uasset` beside it ships **525**. Her name table is provably intact (525 well-formed entries, alphabetically sorted, every null terminator valid, consuming the span to `import_offset` exactly) and her import map resolves perfectly at face value, so nothing is corrupt — the two halves of the package simply disagree. The extra entry sits in the enum block between `ESkillBehaviorActionType` (226) and `ExtraDetectSphereRadius` (275), so indices below that read correctly and everything above is one too high: her row ids (`1109001`, index 93) were fine while `RowStruct` (394→393), `ObjectProperty` (363→362) and the `None` terminator (362→361) each resolved to their alphabetical neighbour, desynchronising the walk at the first `StructProperty` as `bad size -1728053248`. `parse_datatable` now finds the insertion point, gated on two oracles that must both agree: (1) exact landing **and** every top-level property type being a real UE type — necessary but not sufficient, since a wrong property *name* doesn't change byte consumption, leaving any boundary in 164–362 viable; (2) agreement with the field-name vocabulary of the sibling tables that parsed cleanly (every `DT_SkillInfo` shares the `SSkillInfo` struct), which narrows it to 226–275. The repair runs only after a normal parse fails and is reported in `_meta.name_map_repairs`, never silently. Note this is **behaviour-preserving, not coverage-improving**: zero `actionable-times.json` entries changed, because her 16 resolved keys always came from the bullet chain and her 3 unresolved ones have no bullet row anywhere. What it buys is a clean parse, a correct folder label in the gaps report, and the skill-row disambiguator becoming available to her. The earlier note that "her asset differs from the copy we had" was an unverified guess and is withdrawn — no second copy was ever involved.
- **Rover dataset-id mismatch — FIXED, and it explains an entire character class, not just Rover.** The raw client keeps a *separate* resonator-id block per gender (confirmed: raw **1501 = male "Nanzhu"**, raw **1502 = female "Nvzhu"**), while the dataset merges each element into one display id backed by a specific gender's content — `data/hit-map.json` already encoded which one (its `1501` hit ids are prefixed `1502...`). The join was assuming the outer dataset id always equals the raw table's own id; fixed to derive the raw id from each hit id's own leading 4 digits instead (`tools/extract/TIMING-EXTRACTION-HANDOVER.md` §4), which resolved Rover with no hardcoded remap table needed.
- **Aemeath's Mech-form gap — FIXED.** Her alternate combat moveset lives in a *separate* table, `DT_SkillInfo_GD.uasset` (`FemeleZ2/AimisiGD/Data/`), which the indexer only recognized by the exact filename `DT_SkillInfo.uasset` and silently skipped. Added `DT_SkillInfo_GD` to an explicit allowlist (`COMBAT_FORM_TABLE_NAMES`) — deliberately *not* a wildcard match on `DT_SkillInfo_*`, since a full-roster export carries ~70 same-shaped variant tables for non-combat modes (`_Rogue`/`_Rouge` roguelike mode, `_Performance`/`_Quest`/`_Juqing` cutscenes, `_Child_photos`/`_2_7photos` photo minigames, `_MainLine`/`_MainTask`/`_TowerDefense`/`_XCZ` one-off events) whose rows can reuse the same id space with different, mode-specific numbers — blindly merging those risks silently overwriting real combat timing.
- **Cartethyia's Fleurdelys form — confirmed already captured, no fix needed.** Her special-form table (`FemaleZ/Fuludelisi/Data/DT_SkillInfo.uasset`) uses standard 7-digit row ids under her normal resonator id (1409), so it was folded into her existing entry from the very first extraction run without any special handling.
- **Chixia (1202) — FIXED, and the earlier "genuine gap" conclusion was wrong.** She was never missing from the export; her folder is internal-codenamed `FemaleM/Maxiaofang` (confirmable via her nanoka JSON's `background` image path, `T_IconRole_Pile_maxiaofang_UI`) — completely unrelated to "Chixia", the same kind of codename mismatch as Rover's Nvzhu/Nanzhu, and the reason a name-based search turned up nothing. Once pointed at the right folder, a second real bug surfaced: her raw row ids use a *shorter* format than the rest of the roster — `120201` (4-digit resonator id + a bare, unpadded 1-2 digit skill index) instead of the usual `1102001`-style 7-digit form (4 + zero-padded 3). The extractor's `SKILL_ID_RE` required a 3+ digit suffix, so her rows never matched at all. Fixed with a second regex (`SHORT_SKILL_ID_RE`, validated against the roster's consistent `1[1-6]XX` id-tier structure, which cleanly separates real short ids like `1202`/`1302` from shared/common short ids like `1000`/`2000`/`2100` that appear identically across many unrelated characters' tables — confirmed by scanning every already-indexed table for collisions before trusting the distinction). A related mismatch then surfaced in the *join*: `hit-map.json`'s ids zero-pad her skill index to nanoka's standard 3 digits (`1202001001`), which doesn't length-prefix-match her actual unpadded row (`120201`) — added a de-zero-pad fallback to `resolveSkillId` for exactly this case. Result: 10/13 of her skillMap keys now resolve.
- **The other stance-switch kits (Denia/1211, Lumi/1504, Buling/1307, Lucy/1511) — ~~a different, deeper problem, left as a documented limitation~~ SOLVED by the bullet chain (2026-07-28).** The investigation below was correct that no hidden table and no padding rule explained them, and correct that their `hit-map.json` ids do not decompose to `DT_SkillInfo` row ids. It was **wrong** to frame that as the problem: the ids were never supposed to decompose. Their alternate-form damage is fired by *condition-gated* `TsAnimNotifySkillBehavior` bullets — real animations all along, reachable the moment the join stopped going through row ids at all. Buling and Lumi are now fully resolved; Denia 24/26, Lucy 22/28, with the remainder being genuine summon/DoT damage. The lesson generalises past these four: "the ids don't decompose" is evidence that prefix decomposition is the wrong join, not that the data is missing. Original finding kept below for the record. Confirmed via the same exhaustive-scan method that found Chixia's fix: every unindexed `DT_SkillInfo_*` variant table roster-wide was parsed and checked for these four resonator ids — no hidden table, and (unlike Chixia) their row-id widths are the standard 7-digit form, so the short-id fix doesn't apply either. Dumping Lucy's (1511) full raw row set directly showed her real kit (E1/E2/E4 skills, enhanced-state moves, Liberation, intro, outro, Tune Break) genuinely present and byte-exact-parsed — but several `autoSkillMap` keys' `hit-map.json` ids (e.g. `liberation_netrunner_override` → `151104101`) don't share a prefix with ANY of her actual row ids even accounting for zero-padding, and the rows that DO exist have empty `SkillTriggers`/`SkillBehaviorGroup` fields, ruling out an indirect-reference explanation too. Denia's case looks different again — her whole "breakdown_form" id range (`1211100`+) is simply absent from her table's actual row set. Net: for these four, `hit-map.json`'s ids don't reliably decompose to `DT_SkillInfo` row ids the way they do for the rest of the roster (now 56/60 characters) — a different, deeper problem than a missing table or a padding mismatch, not solved by extending `COMBAT_FORM_TABLE_NAMES` or `resolveSkillId`'s fallbacks. Left as a documented limitation (falls back to the existing estimate, no incorrect data) rather than guessed at further.

A `SkillGenre` ordinal → mechanical-category table was derived as a byproduct (basic=0, heavy/charged=1, skill=2, liberation=3, intro="QTE"=4, dodge-counter=5, dodge=6, air-dodge=11, outro="延奏技能"=13, **Tune Break="[weapon]破弱"=14**) — not needed for the id-join above, but useful context, and genre 14 is the first real per-character Tune Break timing data seen (Tune Break itself still isn't a modeled sim step — Open Items #7).

**On `sequenceLength` never being a duration** (maintainer, 2026-07-28): the gap between it and the real skill duration isn't a measurement artifact — WuWa's animation polish means an action that has no follow-up doesn't cut off abruptly, it settles back through an idle-return tail (the `TsAnimNotifyFightStand` notify marks where that tail starts). `sequenceLength` measures the *whole* authored clip including that tail; `actionableAt`/`skillEnd` measure the combat-relevant part before it. This is why the rule has always been "never use `sequenceLength` as a duration" (`TIMING-EXTRACTION-HANDOVER.md` §3) rather than "it's sometimes wrong" — it's measuring a real but different thing on purpose.

**The residual 37 keys (3.5%) are mostly not gaps.** `docs/timing-gaps-report.md` annotates each with the bullet's own designer label, and the labels are decisive: Yinlin's Thunder Wedge (`雷柱闪电子弹-协同攻击`, "thunder pillar coordinated attack"), Baizhi's orbiting remnants (`环绕-顺时针`, "orbit clockwise"), Lucy's hacker DoT (`Lucy-黑客效果DOT伤害`), Phoebe's mirror field, Shorekeeper's butterflies, Mortefi's Marcato follow-ups. These are turret/summon/field/DoT damage with **no player animation to extract** — the fabricated default is the honest answer, not a hole. Genuinely unreachable-from-this-export ids (Lucilla's, Rebecca's, Galbrena's, Hiyuki's, some of Aemeath's and Denia's) have no bullet row anywhere under `Role/` and are listed as such; Ciaccona's two aimed shots are the only remaining "real move, link still missing" cases.

### Wired into the engine (2026-07-29)

`tools/preprocess.mjs` now stamps the measured `actionableAt` onto every matching `autoSkillMap` step, replacing the per-type `ACTIONABLE_TIMES` guess. **1,020 of 1,079 steps carry a real animation-derived time**; the remaining 59 keep the fabricated default. `sim.js`'s `resolveActionableAt` already preferred `skillDef.actionableAt`, so no engine change was needed. Each stamped step also carries:

- `timingSource: 'extracted' | 'curated'` — 1,015 extracted, 6 curated pins.
- `timingProvisional: 'state' | 'phaseOnly'` — 13 + 25 steps whose value is known to be conditional or understated (see the gaps report).

`data/actionable-times.json` is **committed** so the build never depends on the raw asset export, exactly as `data/forte-data.json` is; the multi-MB intermediates (`timing-data.json`, `bullet-timings.json`) are gitignored since they are regenerable only from that export.

### Two freezes, and which one the sim models (2026-07-29)

Maintainer verified in-game that WuWa has **two** distinct freezes:

- **MAJOR** — a complete stop: timers, buffs, cooldowns, enemy actions. Used by Liberations and the Tune Break trigger (`Execute`) animations.
- **minor** — enemy actions/movement only, and very brief; the player's own clock keeps running. Used by Intro Skills.

Only MAJOR matches the sim's freeze semantics (gameTime pauses → cooldowns *and* buff durations stop, DPS denominator excludes the window). A minor freeze must contribute **zero** freeze, or 60 intro steps would wrongly pause the world and inflate DPS.

**The two notifies say outright which is which** — settled from the game's own shipped JavaScript, `Content/Aki/JavaScript/Game/AnimNotifyState/*.js` in a full client export. Each class's `GetNotifyName()` states its effect:

| notify | `GetNotifyName()` | meaning | sim freeze? |
| --- | --- | --- | --- |
| `TsAnimNotifyStateTimeStopRequest` | 副本计时和所有战斗单位buff、技能冷却冻结 | "instance timer and **all combat units' buffs and skill cooldowns** freeze" | **yes** |
| `TsAnimNotifyStateAbsoluteTimeStop` | 动画和子弹冻结 | "**animation and bullet** freeze" | no |

The first is precisely the sim's gameTime pause. The second holds the owner's animation and its bullets without stopping any clock, so it contributes **zero** — which is what makes 61 ordinary Intro Skills correctly free of freeze.

This also closes a false lead worth recording. `AbsoluteTimeStop` declares `角色战斗机制停止` / `怪物战斗机制停止` / `副本计时停止` (defaulting true/true/false), and classifying on those matched six in-game observations before failing on Aemeath. The source shows why: its `K2_NotifyBegin` passes **only** `是否冻结移动效果` to `SkillUtils.BeginAbsoluteTimeStop` — the other three are never read. They are dead properties. Six confirming cases did not make the rule true.

`derive()` therefore reports `freeze_combat_clock_s` (the TimeStopRequest union) as the freeze, and `freeze_total_s` separately as `freezeAnimationTime` for provenance. Never union the two. Split: **69 clock freezes** (57 liberation, 8 forte-heavy, 2 intro, 1 heavy, 1 skill) against **67 animation-only** (61 intro, 4 forte-heavy, 1 midair, 1 liberation).

Aemeath was never a counterexample. Her Seraphic Duet *does* carry a 1.08s clock freeze; the "only enemies freeze" reading came from a **separate per-bullet system**: bullet `1210110505`, named `合击·登台--时停` ("time stop"), sets `时间膨胀.受击顿帧` (victim time-dilation) to **3.0s at dilation 0.0** with no attacker counterpart. Enemies stay locked ~1.9s after the player's clock restarts. Maintainer measurements against the cinematic-camera window confirm the clock freeze is real: mech form ticked 1.7–1.9s of cooldown across a 3.00s hidden window, where no freeze predicts 3.00s.

**Per-bullet time dilation** (`时间膨胀`) is a real second system, distinct from the montage freeze: 4,375 bullets carry it, 2,268 reference a dilation curve, with separate `攻击顿帧` (attacker) and `受击顿帧` (victim) blocks each holding duration, dilation value, priority and curve. Durations run 0.01–3.0s. It is **not modelled** — it is impact hitstop plus effects like Aemeath's enemy-only lock, and it does not stop the player's cooldowns.

**`freezeTime` is now stamped** — `preprocess.mjs` writes the measured clock freeze onto **56 steps** (44 liberation, 8 forte-heavy, 2 intro, 1 heavy, 1 skill), replacing the `HARDCODED_FREEZE_FRACTIONS` "whole animation" estimate with real data (Sanhua's Liberation: 1.5016s of a 1.6202s cast, not 100%).

Two guards keep it additive, because a stamped `skillDef.freezeTime` is returned by `resolveFreezeTime` *before* its cinematic gate and would otherwise bypass it:

- **cost-free continuations** (`consumesResource === false`) are skipped — a continuation must not re-freeze;
- **liberation steps of a non-energy "ultimate"** (`energyMax === 0`) are skipped. Phrolova shows why: five of her liberation-tagged steps share one summon animation and each reports the same 4.0s window, so stamping would freeze 20s for a single cast. Her steps are enhanced on-field attacks, not cinematics.

13 steps are skipped by those guards. A Liberation with no measured freeze keeps the existing fraction estimate rather than losing its freeze.

~~**Not yet done — deliberately left for a follow-up, not part of extraction**~~ (per `docs/LANE-B-ASSET-EXTRACTION.md` §6): `data/actionable-times.json` is a curated, provenance-tagged, ready-to-consume artifact. Wiring it in — `preprocess.mjs` stamping `actionableAt`/`freezeTime` onto the matching `autoSkillMap`/formula skill objects, so `resolveActionableAt`/`resolveFreezeTime` in `sim.js` pick the measured value up automatically — has not happened yet; `data/wuwa-data.json` is untouched by this session.

## ~~Explicitly out of scope: don't extract from game assets~~ SUPERSEDED (2026-07-28)

~~The pipeline to pull `AnimMontage` data from game files exists (FModel + AES key endpoint + CUE4Parse) and was evaluated. **Don't use it.** Raw montage / `SequenceLength` doesn't equal effective cast time — input buffering, hitstop, and swap-cancel windows all shift the number gameplay actually produces, which is exactly why community sources (Maygi, arabwuwa) measure from live gameplay instead of asset data. Don't resurrect this route without a concrete new reason it'd solve something the video-based approach can't.~~

This objection assumed the only readable field was `SequenceLength` (the full idle-return animation length). It doesn't hold: `tools/extract/extract_timings.py` reads the montage's own **notify timeline** (`TsAnimNotifyStateNextAtt` — the cancel/next-input window; `TsAnimNotifyEndSkill`; `TsAnimNotifyStateAbsoluteTimeStop` for Liberation freeze), which is exactly "when can the player act again" — the same quantity community frame-counters measure by eye, read directly from the game's own authored data instead. `SequenceLength` is still extracted but only kept for provenance, never used as a duration (`tools/extract/TIMING-EXTRACTION-HANDOVER.md` §3). See **Extraction results (2026-07-28)** below.

## Precision: run the sensitivity pass before chasing exact numbers

Before spending time tightening any individual ability's timing: perturb all `actionableAt` values ±15% and check which ones actually move total DPS or break a rotation's cooldown/energy timing. Expect only the current on-field DPS's core combo and a few long-animation abilities to matter — support/filler precision is usually noise. Let this pass decide where accuracy effort goes; don't spend it uniformly across the roster.

## Validation

Before trusting a character's timing data:

- Rebuild 2–3 of arabwuwa's disclosed rotations (arabwuwa.com/team-dps — explicitly measured in-game, not paper frame-counted) in WuWaSim. Total rotation duration should land within ~5% of their recorded time.
- Cross-check resulting DPS against Maygi's numbers for the same rotation and assumptions (enemy level, buff uptime).
- If either check misses by more than that, re-check the timing data before touching the damage formula — timing is the more likely source of drift.
