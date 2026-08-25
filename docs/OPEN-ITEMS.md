# OPEN-ITEMS — WuWaSim backlog snapshot

**Compiled 2026-07-23** from a sweep of the tracked `docs/` set, `docs-local/`,
and cross-checked against current code. Supersedes the point-in-time
`Status-Report-07-10.md` audit (which is partly stale — items it flagged as
"doc hygiene" in README were already fixed by the time of this snapshot).

**P1–P13 are all shipped.** The 2026-07-10 → 07-23 window was UI polish + the
Simplification Plan (S1–S5) + the timing-model schema + a dataset refresh;
07-24 → 07-30 closed the timing lane (item 1) end to end.
Everything below is what remains. Ordering within a section is not priority.

**Updated 2026-07-30:** item 1 closed; its two genuinely-remaining pieces
promoted to items 22 (character state modelling) and 23 (echo animation
timing). Section title below kept for the surviving root-cause gap.

**Updated 2026-08-17 — reconciliation pass over items 1 → 2b.** Every claim in
that range was re-checked against the code and the data rather than inherited.
What it changed: **2b is closed** (per-type crit shipped); **26** narrowed to
what ConfigDB genuinely does not yet answer, the rest of it having become the
primary source for five lanes; **32**'s stale "uniform 2.6x" framing and its
"their rotation has not been run" bullet struck, and its table replaced with
what `tools/benchmark-gap.mjs` prints today; **2** told that gauge income is no
longer curated-only; **2e** given the sweep it asked for. Residuals in **29**
and **30** were re-verified as still live and still accurately described — they
are tracked work, not loose ends. One new item (**2f**) came out of closing 2b.
Items 1, 25, 27, 28, 31, 2c and 2d were checked and needed nothing.

---

## Root-cause engine gaps (each unlocks several downstream items)

1. ~~**Cast-time / timing realism.**~~ **CLOSED 2026-07-30.** Cast times are no
   longer fabricated: **1,020 of 1,079 rotation steps carry a real
   animation-derived `actionableAt`**, and 64 carry a real `freezeTime`, both
   read from the game's own assets and both wired through `preprocess.mjs` into
   the sim. The five increments are chronicled in `docs/TIMING_MODEL.md` and
   `docs/HISTORY.md`; the short version:
   → **Inc. 1–2 (2026-07-24):** mechanical rule-based model — Liberation clock
   freeze with a cinematic gate, parallel-vs-Transform echo split, freeze-aware
   buff/state decay.
   → **Inc. 3 (2026-07-28):** real extraction landed (`tools/extract/`) —
   96.5% coverage via the game's own **bullet chain** (notify → bullet →
   damage id) after the prefix-decomposition join was replaced wholesale.
   → **Inc. 4 (2026-07-29):** wired in — `actionableAt` + `freezeTime` stamped
   onto `autoSkillMap`; the two freezes (`TimeStopRequest` vs
   `AbsoluteTimeStop`) settled from the client's own shipped JavaScript.
   → **Inc. 5 (2026-07-30) — the finalize pass.** Replaced the last structural
   stand-ins with data rules and fixed what wiring the data exposed:
   **(a)** a measured freeze now outranks the cinematic gate, so **six real
   cinematic finales** freeze (Carlotta's Fatal Finale, Hiyuki, Aemeath,
   Ciaccona, Zani, Cantarella) — this **closes the deferred "curated
   is-cinematic flag" with zero curation**;
   **(b)** freeze is credited per **animation**, not per key (`freezeSource` +
   `resolveFreezeSchedule`) — Jinhsi's Incandescence was counting one 2.2s
   animation as 4.4s of stopped clock *in her shipped reference rotation*, which
   inflated her DPS;
   **(c)** freeze is clamped to its step — **13 reference rotations were running
   the in-game clock backwards** (Xiangli Yao −1.33s, Carlotta −0.87s);
   **(d)** `resolveTimingSource` never accepted `'extracted'`/`'curated'`, so
   all 1,020 measured steps reported `'estimated'` downstream — fixed, and
   provenance + `timingProvisional` now surface in the rotation UI;
   **(e)** `opener.js` echo timing matches the sim (parallel echoes cost 0
   instead of a flat 1.2s) and its freeze axis was silently zeroed by a
   `resolveFreezeTime` call missing two arguments.
   Meta impact: 18 of 50 anchors reorder their suggested teams; median team-DPS
   move 1.35%, p90 9%.
   → **Deferred items closed as OBSOLETE, not done:** *hold-button-skill locks*
   (the game authors a hold as its own montage, so the measured `actionableAt`
   already is the hold time — 20 keys resolve to `AM_*_Hold*`/`*_Loop`; a
   classifier would re-derive the measurement) and the *"collapse instants
   toward zero" rescale* (it compensated for per-type estimates overstating
   short abilities; there is now a measured base).
   → **What is left is tracked elsewhere:** echo animation timing —
   `ECHO_CAST_TIME = 1.20`, the engine's last fabricated timing constant —
   assets now in hand, the echo→montage join is what's missing (item #23);
   character state modelling (item #22); per-bullet time dilation
   (`时间膨胀`) is deliberately out of scope — it is hitstop and enemy-only
   locks, and stops no player cooldown.

2. ~~**Non-energy resource-gauge engine**~~ **LARGELY CLOSED 2026-07-31**
   (three increments; `docs/plans/GAUGE-ENGINE-PLAN.md` carries the corrected
   landscape). The plan located the gap in `buffs.js scaleEffect`; the measured
   root cause was one step upstream — the effect parser scoped a stack's CAP and
   GAIN TRIGGER to the "Each stack …" value clause, while the game states both
   in the sentence that GRANTS the stack. Reading the whole description took
   real caps from **3 to 13 of 14** and resolvable triggers from **1 to 3**.
   → **Inc. 1** — `descStackCap` / `descStackGain`, both refusing to guess when
   a description is ambiguous. Three curated overrides for what text alone
   settles (Augusta's cap on a sibling node; Luuk Herssen's `perStack` 1.20 →
   0.40, where `pctNear` had captured the "up to 120%" ceiling as the per-stack
   value; Yangyang: Xuanling's two caps).
   → **Inc. 2** — the ceiling fallback is **gone**. `scaleEffect` resolves the
   user's count → a curated gauge → a `castMatch` trigger → else ONE stack
   flagged `stacksUnknown`. Once caps became real, `maxStacks ?? 1` stopped
   being conservative and became a large silent assertion (Lynae: +55% vs
   +1375% Spectro DMG). New `build.effectStacks` + a build-editor stack stepper
   so an underivable count is visible and correctable.
   → **Inc. 3** — `src/core/rotation-resources.js`: a per-step gauge timeline,
   shared with `rotation-graph.js` (whose private copy is deleted), read by a
   `resource` stack trigger. **Changli's Enflamement is live end to end** — her
   Secret Strategist was entirely OFF (trigger `unknown`) and now scales her
   True Sight casts by the stacks she actually holds (+0/+5/+10% across her
   reference rotation). Needed a new `thisCast` window, since `persist` reads
   strictly EARLIER steps and so misses the very cast the buff is for.
   → **Corrections to the backlog's own framing:** Hiyuki's S3.1/S6.0/S6.1 are
   NOT stackable effects — they are threshold gates ("At 2 stacks of Snow
   Rust"), and Snow Rust is a team-composition counter, unrelated to the Forte
   channel in `forte-data.json`. Only Changli of the four named kits was ever
   gauge-driven.
   → **Income is no longer curated-only (2026-08-12).** This item shipped under
   "gauge INCOME is not in the dumps and stays curated", which held only while
   the Buff table was undumped. `data/gauge-income.json`
   (`tools/extract/extract_gauge_income.py`) now reads the per-CAST delta from
   the game: `DT_SkillInfo` → `SkillBuff`/`SkillStartBuff`/`SkillEndBuff` →
   `db_buff.GameAttributeID` ∈ `Proto_(Special)Energy*`, 59 resonator entries.
   Denia's three gauges reproduce her kit to the digit with no text parsing
   (cap 3/100/100, +1/+25/+40) and her `RESOURCE_DEFS` entry is filled from it.
   What the cast lane CANNOT see is income earned on a HIT — that lives in
   `db_PassiveSkill` (`DamageTrigger`, with its own CD) behind ExtraEffect
   chains, which is why Changli's Enflamement and Camellya's Crimson Bud are
   still hand-written. That lane is extracted but NOT wired, and
   `rotation-resources.js` is per-cast by construction, so wiring it is a real
   change rather than a data swap.
   → **What remains, by cause** (all served by the stepper meanwhile): enemy
   status counts — Yangyang: Xuanling ×2, whose two branches are now correctly
   exclusive (`stackBand`, 2026-08-01) and whose 4-6 band is reachable via her
   own cap raise (#25), but whose live count still comes from the stepper rather
   than the enemy timeline; team-composition counters — Sigrika, Hiyuki, deferred by maintainer decision
   to a later roster-derived pass; Tune Break — Luuk Herssen, no longer blocked
   (#7 shipped 2026-08-03), and now a matter of counting the slotted responses; a
   battle-entry grant (Phrolova); hit-count inside a state (Encore S6); an
   ICD-gated enemy debuff (Galbrena); a real-time tick (Lynae's Premixed Hue,
   1/s while Lumiflow ≥ 120 — out of the per-cast income model by design).

25. ~~**Negative-status stack-limit RAISES are unmodelled.**~~ **CLOSED
    2026-08-01.** `STATUS_CAP_RAISES` models a kit lifting a status's base
    cap; the shared enemy timeline caps a stack at the limit in force when it
    lands and drops the excess when the raise lapses. Two trigger shapes, both
    live: a CAST arms it (Xuanling S3 +3 Havoc Bane/20s; Cartethyia S2 +3 Aero
    Erosion, no stated duration so it holds to the end), or INFLICTING arms it
    (Suisui's Ceaseless Landscape — while her 30s Liberation window is open,
    any teammate inflicting one of five statuses raises THAT status's cap by 3
    for 15s). The base caps were correct all along.
    **Deliberately NOT curated:** Aemeath S6 raises Rupturous Trail / Fusion
    Trail "to 60" — a separate Aemeath mechanic, not `tune_rupture` /
    `fusion_burst` (her kit names all four distinctly), and we model no Trail
    stacks at all. It is also a SET, not an ADD. Mapping it onto a status we do
    model would invent a mechanic.
26. ~~**The game's ConfigDB is readable and largely unused.**~~ **LARGELY
    CONSUMED — re-scoped 2026-08-17.** ~500 config tables ship with the client
    alongside per-table JS accessors that give exact field names/offsets/types;
    `tools/extract/configdb.py` reads any of them. Our four `data/bindata/*.json`
    dumps are four of those tables. See `docs/CONFIGDB-RECON.md`.
    Since this was written it has become the PRIMARY source for five lanes, each
    with its own committed extract: the affliction LevelModifier curve
    (`abnormal-damage.json`), a buff value's BUCKET (`buff-facts.json` — the text
    parse is now the fallback), negative-status damage tables
    (`status-damage.json`), status appliers (`status-appliers.json`), per-cast
    gauge income (`gauge-income.json`), and the whole external-buff lane —
    weapons, sonatas and echoes (`external-buffs.json`), which is where
    `db_PassiveSkill`'s structured `TriggerType`/`SkillAction`/`InstigatorType`
    got read.
    **The three original leads, by status:**
    → `db_PassiveSkill`'s structured trigger fields — **used** (external buffs
      lane 1: `ExtraEffectID 35 AddPassiveSkill` → `SkillActionParams`, and the
      weapon trigger/recipient routing). Not yet used for the kit-text stack
      GAIN trigger `descStackGain` recovers from prose.
    → Gauge income — **done for the CAST lane** (see #2), not wired for the HIT
      lane.
    → Chain node → buff → effect semantics — **still a validation layer, not a
      parser replacement**, and this is what is genuinely left of this item.
      `docs/CONFIGDB-RECON.md` measured it: 4 of 8 stackable chain effects
      resolve exactly (agreeing with the parser on every field), and 92 of 330
      roster chain nodes reach at least one stat-modifying buff. The rest express
      themselves as DMG-multiplier changes or `SkillAction` scripts, so the
      kit-text stack-cap and gain-trigger regexes stay. Also open: tag hashing —
      older content carries readable Chinese tags, newer content is hashed, so
      name-matching alone will not cover the roster (the id-prefix convention
      does).
27. ~~**Negative-status damage is TEAM-SIM ONLY.**~~ **CLOSED 2026-08-01.**
    `soloStatusDamage` (enemy-status.js) resolves the whole lane for one
    rotation — per-application, ticks/burst-on-max, and kit-triggered
    afflictions — and `simulateRotation` reports it as `totals.statusDamage`
    alongside a new `totals.skillDamage`, with `totals.damage` and DPS counting
    both. **Nine resonators** now show damage the build page used to omit
    entirely, and for most of them it is the majority of their output: Ciaccona
    80%, Hiyuki 68%, Aemeath 59%, Phoebe 58%, Rover: Aero 57%,
    Rover: Spectro 53%, Lucilla 33%, Cartethyia 29%, Zani 28%. The donut gives
    each status its own element-coloured slice, the timeline gets a strip per
    status, and the total spells out the skill/status split.
    **Gear weights are provably unmoved**: status damage has no ATK/crit
    scaling, so it adds a CONSTANT to every candidate build and cancels out of
    the marginal-value differences the optimizer ranks on — all six anchors
    keep byte-identical suggested builds and all 400 team entries hold their
    DPS. `team-sim.js` reads `totals.skillDamage` for its segments, because in a
    team there is ONE enemy and its own shared-timeline accrual owns that lane;
    taking `totals.damage` there would double-count.
28. ~~**Fusion Burst / Electro Flare "pending calibration".**~~ **CLOSED
    2026-08-01.** Never a calibration problem — the numbers ship with the game,
    on six SYSTEM buffs (one reserved id + `ExtraEffectID` per status) that the
    kit-table sweep had missed because kit tables use `ExtraEffectID 121`.
    `tools/extract/extract_status_damage.py` reads all six. Fusion Burst
    (0.84 → 6.9863 across its cap) and Electro Flare (0.50 → 4.1585, ticking
    every 5s — it had declared `damageOnTick` with NO interval) were dealing
    ZERO; Spectro Frazzle and Aero Erosion were at exactly 0.8× the shipped
    values; Glacio Chafe, Fusion Burst and Electro Flare had no stack lifetime
    at all. Glacio Chafe's shipped row reproduces this project's
    reverse-engineered curve to the digit, which is what validates the reading.
    Two resonators gained a damage lane they never had (Buling, 88% of her
    output; Denia), and `statusDamageGaps` is now empty roster-wide.
29. ~~**WHICH casts inflict a status is curated for one kit, approximated for the
    rest.**~~ **DERIVED AND SHIPPED 2026-08-02** — see the closing note at the
    end of this item; the history below is kept for the reasoning.
    (2026-08-01). `applicationsFromSteps` treats every damaging step as an
    application — a deliberate v1 approximation, and for most kits still the only
    model. But the kits STATE the rule, naming the skills, the stack COUNT and
    often an ICD: Cartethyia "inflict 2 of Aero Erosion" on four named skills,
    Ciaccona a stack on Basic Stage 4 / Tonic / Downbeat Notes, Buling "another 6
    stacks of Electro Flare" on array generation, Rover: Electro "5 of Electro
    Flare" after his Liberation, Suisui / Hiyuki / Lucilla / Chisa each with
    their own. Only Aemeath is curated so far (`STATUS_APPLY_RULES`: her eight
    named skills + the 3s per-skill ICD her Forte states), and doing so cut her
    Fusion Burst applications from 15 to 7 — every other inflicter is still
    over-applying by roughly the ratio of its damaging steps to its real
    inflicting ones. This is the largest remaining source of status-damage error.
    **Unverified against the game (2026-08-01):** the maintainer tested in
    combat and could not tell the abilities apart — neither the in-game
    description nor the resource pages state the rule — so Aemeath's eight
    skills + 3s ICD come from her Forte's text alone. Her observed Fusion Trail
    climbs faster than the sim did, which the S6 mark modifiers now explain; if
    a gap remains, the #30 re-seed is the next suspect (each re-seed is itself a
    Fusion Burst infliction, so it feeds the Trail).
    **Derivation prototyped 2026-08-01, NOT shipped.** The rules are mechanically
    derivable rather than hand-curatable: scan each skill key's OWN section
    (`extractSkillSection`, the same scoping the tooltips use) for the three
    shapes the game uses — "inflict N (stacks) of [X]", "inflict [X] N times",
    "inflict [X] on the target" — and read the count off the match. A probe over
    the roster produced plausible rules for **8 resonators** (Hiyuki, Lucilla,
    Suisui, Buling, Rover: Aero, Ciaccona, Cartethyia, plus Aemeath's re-seed).
    **The crux is stage scoping**, and it is where the prototype stopped: a
    section is the whole FAMILY ("## Basic Attack"), so a clause reading "Basic
    Attack Stage 4 inflicts 1 stack" is inherited by stages 1-3 — Ciaccona,
    Cartethyia and Suisui all over-applied 3-4x. Gating on a "Stage N" mention
    near the match is the fix; the prototype's attempt read the WRONG capture
    group (the amount, not the stage) and so kept stage 1 instead of stage 4.
    Finish that, then verify each of the 8 against its kit before wiring, because
    a wrong count here now moves a visible damage lane. Aemeath stays curated
    (`STATUS_APPLY_RULES`): her rule is an eight-skill list with an ICD, which no
    per-skill section states.
    **CLOSED 2026-08-02.** `tools/preprocess/status-apply.mjs` derives the rules
    into `dataset.statusApplyRules`: **19 rules covering 7 resonators** (Hiyuki,
    Lucilla, Suisui, Rover: Aero, Ciaccona, Cartethyia, Luuk Herssen), every one
    checked against its own kit clause, which the rule carries verbatim in
    `derivedFrom`. Cartethyia drops from 16 applications to 5, Ciaccona 9 → 6,
    Hiyuki 20 → 3 casts (9 stacks), Rover: Aero 10 → 1. Impact on the meta:
    **87 teams move, ALL of them down, median 2.40%, max 4.79%**, and 14 anchors
    reorder their suggested teams — the direction #29 predicted.
    The stage-scoping crux was fixed as described, plus a second gate the
    prototype had not found: a clause naming a skill must resolve that name only
    among keys whose OWN section carries the clause. Without it Lucilla's
    "While casting [Spotlight]" leaked onto Phantom Frame, and Luuk's intro lost
    itself to the [Ichor Blade] it throws. `data/status-appliers.json` (73 buffs
    from the ConfigDB, `extract_status_appliers.py`) bounds every derived count.
    **The ConfigDB cannot supply the skill list** — proven, not assumed:
    `db_skill` holds 562 exploration rows, and an ASCII sweep of all 482
    `db_*.db` files finds each applier buff referenced only from `db_buff`
    itself. The grant lives in the ability blueprints.
    **Residuals**, all deliberate and all conservative:
    → ~~Buling stays on the fallback: her array inflicts "2 stacks … every 2s,
      lasting for 24s", which is a periodic applier (up to 24 stacks from one
      cast) and needs rules with a period. The fallback's 9 is closer than the
      2 a per-cast reading would give. Rover: Electro's Liberation array is the
      same shape. **This is the next piece of work in this lane.**~~
      **DONE 2026-08-02.** `applicationsFromSteps` now understands
      `everySeconds` + `durationS`, clamped to the rotation the same way an
      off-field turret is (`off-field.js`: the shorter of the action's duration
      and the window) — Buling's array lasts 24s but is cast at 6.2s of a 10.3s
      rotation, so counting all 12 ticks would credit damage past the clock the
      DPS denominator measures. She applies 6 stacks over 3 ticks.
      Her rule is CURATED, not derived, and the reason is structural: the
      sentence that applies the status has **"The array"** as its subject, and
      the cast that creates the array is named only in the sentence BEFORE it,
      so section scoping hands the clause to both her Forte keys — and the wrong
      one of the two is the array's own per-tick DAMAGE row. The derivation
      keeps rejecting periodic clauses rather than guessing. Roster sweep: hers
      is the only periodic infliction clause that exists.
      Meta impact: 19 team entries move, every one of them containing Buling,
      all down 1.6-3.1%.
    **Residuals re-verified 2026-08-17** against `dataset.statusApplyRules` (19
    rules, 7 resonators, unchanged): all four below are still live and still
    accurately described. Two are correctable by curation and would each move a
    visible damage lane, in opposite directions — which is the reason to fix them
    together rather than one at a time.
    → Ciaccona's "Green Tonic" clause attaches to both her Liberation and its
      tonic sub-move; one of the two is one application too many. (Confirmed: her
      third rule carries `keys: [liberation_improvised_symphonic_poem_skill,
      liberation_symphonic_poem_tonic]`.) OVER-applies.
    → Luuk's Aureole of Execution is described inside his Basic Attack section
      and so is missed — 3 casts of his reference rotation under-apply.
      (Confirmed: his three rules cover mid-air, `skill_golden_reflux` and the
      intro, and nothing else.) UNDER-applies.
    → Rover: Aero's "1 stack for each stack removed" is variable; 1 is the floor.
    → Aemeath, Denia, Mornye, Lynae, Phoebe, Zani, Chisa and Yangyang: Xuanling
      derive nothing and are unchanged.
30. ~~**Aemeath's Fusion Burst re-seed, and stack removal generally**~~ **RE-SEED CONFIRMED AND MODELLED 2026-08-03** — an in-game capture showed the counter detonating at 6 and leaving ONE stack, not zero, which is the re-seed firing; it is now `reseed: 1` on her burst rule (HISTORY addendum 9). Electro Flare's half-stack loss and Electro Rage overflow remain unmodelled. Original note follows.
    **Aemeath's Fusion Burst re-seed, and stack removal generally**
    (2026-08-01). Her Forte: *"when the [Fusion Burst] on targets near the active
    Resonator reaches 0 stacks, inflict 1 stack of [Fusion Burst]."* Not
    modelled — the re-seed needs a live stack count that clears on detonation,
    and `buildEnemyStatusTimeline` deliberately does not model `resetOnMax`
    removal (model §2a), so the PRESENCE curve keeps climbing while the burst
    path tracks its own count locally. The two therefore disagree after a
    detonation: the strip shows stacks still held, the detonation shows them
    cleared. Her lowered threshold (>5, `STATUS_BURST_RULES`) IS modelled; the
    re-seed on top of it would only add detonations, so her rate is if anything
    understated. Electro Flare's "the target loses HALF of the effect stacks with
    each instance of damage" and its Electro Rage overflow are unmodelled for the
    same reason.
    **Confirmed in the game's data 2026-08-02** while closing #29: the re-seed is
    buff **`1210072004`** — `ExtraEffectID 5` applying `10021000` (Fusion Burst),
    permanent, `Period 0.2s`, with `ExtraEffectReqPara` `0#0#…聚爆效应`, i.e.
    "fires while the target holds 0 stacks of Fusion Burst". That is the kit text
    exactly, and it is the only kit-owned applier of hers besides `1210063003`
    (the plain 1-stack apply her eight named skills use). So the mechanic is
    real and 1 stack per re-seed is right; what is still missing is only the
    stack-removal model it depends on.
    **Re-verified 2026-08-17:** unchanged and correctly stated.
    `buildEnemyStatusTimeline`'s own docstring still records the deliberate
    choice — "resetOnMax is NOT applied to the presence timeline (the
    explosion/consume is a Layer-4 DAMAGE event; for stack PRESENCE the team
    keeps the status applied)" — so the presence curve and the detonation path
    still disagree after a detonation, and Electro Flare's half-stack loss and
    Electro Rage overflow are still unmodelled. Both directions are
    understatements of a detonation rate, not overstatements.
31. ~~**A rotation shorter than a status's tick period strands its DoT**~~ **RESOLVED 2026-08-02**
    (2026-08-02, found while closing #29's periodic residual). Status DoT damage
    is credited only for ticks that land INSIDE the rotation window, which is the
    same rule off-field turrets follow — but a status applied late in a short
    rotation then deals literally nothing: Buling's array lands Electro Flare at
    6.2s of a 10.3s rotation and Electro Flare ticks every 5s, so the first tick
    falls 0.9s outside. Rover: Aero is the same (Aero Erosion at 7.4s, 3s tick,
    9.2s rotation). Both zeros are arithmetically correct for a fight that ENDS
    at the last cast, and wrong for the repeating cycle a reference rotation
    actually represents.
    **Mitigated:** the zero is no longer silent — it carries a measured reason
    naming both instants ("applied at 6.2s, but it ticks every 5s — the rotation
    ends at 10.3s, before the first tick"), per the 2026-07-31 zero-value rule,
    and the build page already renders `gap.reason`.
    **RESOLVED BY MAINTAINER DIRECTION 2026-08-02.** The question "what is a
    rotation" is answered per surface, and both halves are now verified:
    → **A single rotation attributes only what falls inside its own window.**
      This is the existing behaviour and it is CORRECT, not a gap. Buling's and
      Rover: Aero's zeros stand, explained rather than hidden. Crediting ticks
      past the window would inflate DPS against a denominator that stops at the
      last cast, so this is also the conservative direction.
    → **The team sim's passes are the loop**, and effects, buffs and debuffs
      must carry from one pass into the next. Three lanes, each with a different
      owner, all now pinned by tests in `team-sim.test.mjs`:
      1. *Debuffs* — already correct: `buildEnemyStatusTimeline` is built once
         from every pass's applications, so stacks left standing survive the
         pass boundary. Measured: status share of team damage rises 77% → 81%
         → 83% over three passes as stacks compound.
      2. *Team-wide buffs* — already correct: they live on the shared timeline
         with their TRUE end (`accrueChainEffectWindowsToTimeline` opens
         `[fireEnd, fireEnd + seconds]`, unclipped) and reach later members and
         later passes via `timelineWindowsFor`. Measured: pass 1 starts cold and
         passes 2+ are identical steady state (Zhezhi +20% on pass 2).
      3. *A member's OWN timed effects* — **this was the real gap, now fixed.**
         Each segment is an isolated `simulateRotation`, so a 30s self-buff
         opened late in pass 1 was truncated at the segment boundary
         (`endReason: 'rotation end'`) and silently restarted from nothing when
         the member swapped back in. Fixed by carrying the TRIGGER-FIRE LEDGER
         rather than the windows: `simulateRotation` accepts `carryInFires` and
         returns the ledger it ends with, and team-sim hands each member their
         own ledger shifted into the next segment's frame (fires from an earlier
         pass land at NEGATIVE local times). A `seconds` window is evaluated
         from when its trigger last fired, so nothing has to be forced open and
         the freeze-aware gameTime semantics keep working untouched. Fire
         COUNTS deliberately do not carry — "the Nth cast" triggers would read a
         different number every pass.
         Impact: 4 of 22 reference teams gain up to **+1.71%** (Encore's 30s
         Fusion DMG Bonus surviving his swap-out), all moves positive, which is
         the direction a recovered buff must have. Solo is untouched by
         construction (`carryInFires` defaults null) and the meta does not move.

32. **Aemeath benchmark gaps, and the team-DPS shortfall** (2026-08-03, from the
    maintainer's Prydwen + Arabwuwa references — directional benchmarks, not
    sources of truth). Four defects found this way are FIXED (HISTORY addendum 8:
    the build page's wrong clock, category-scoped DMG-multiplier clauses,
    unparsed "All-Attribute DMG Bonus", and team-recipient detection reading a
    truncated condition — that last one had silently scoped BOTH of Verina's
    team buffs to self). What remains:
    → ~~**S1 is unmodelled.**~~ **CLOSED 2026-08-03.** *"In Instant Response,
      Heavy Attack - Aemeath and Heavy Attack - Mech gain 300% Crit. DMG
      increase."* — and its inherent twin, *"…gain 200% DMG Amplification"*.
      Both parsed to zero effects, for the same reason: the value PRECEDES its
      keyword and the reader only ever looked forward (`pctGained`). Both are now
      read, scoped to exactly her four Heavy Attack keys, and gated on a real
      `Instant Response` entry in `STATE_DEFS[1210]` — entered by the Overdrive,
      ended by a Charged II or the Finale, both stated by the kit. Measured on
      one Heavy: 606 → 1,819 at S0 (the inherent's ×3 alone) → 2,461 at S1, with
      every other step unchanged.
      The scoping generalises `multiplier-scope.mjs` into `skill-scope.mjs`: it
      now reads the SUBJECT form ("X and Y gain …") as well as the TARGET form,
      and `resolveChainInherentContext` honours `skillKeys` for every stat, not
      just `multiplierUp`. Two effects roster-wide bind by subject, both hers —
      the resolver returns nothing for "Resonators in the team", which is what
      keeps it safe.
    → ~~**S3 is still ~1.6x hot**~~ **PART OF IT FOUND 2026-08-03.** That node's
      `amplify` was reading **60%** where the kit says 25%: it states two effects
      in one sentence (*"Aemeath's Crit. DMG is increased by 60%, and …
      Heavenfall Edict: Finale DMG is now Amplified by 25%"*) and the amplify
      branch's last-resort bare `by` matched the earlier phrase first. Now read
      in order of specificity. Whether the node is still hot needs a re-measure
      against the reference.
    ~~**The gap is UNIFORM, which rules out the per-kit suspects**~~ **LOCALISED
    2026-08-07, and most of it closed.** Running Arabwuwa's OWN rotation (they
    publish it per member; it maps cleanly onto our keys) with a real Echo
    equipped moved the gap 2.60x → 2.09x, and it stopped being uniform. Chisa
    leads the pass and receives nothing from anyone, and she was only 1.37x low,
    while the two members who DO receive team buffs were 2.1x low. That split is
    the finding: ~1.37x is per-character modelling and ~1.5x on top of it lived
    entirely in the team-buff lane. Five defects came out of it (HISTORY addendum
    14) and the gap is now **1.80x**:

    ~~| 1 pass, their rotation | 2026-08-03 | 2026-08-07 | Arabwuwa | ratio now |~~
    ~~Chisa 1.37x · Denia 1.74x · Aemeath 1.85x · team 1.80x · time 1.10x~~
    **THOSE FIGURES ARE DEAD (2026-08-17).** Every one of them predates the
    benchmark becoming reproducible, and none can be re-derived: the reference was
    chat scrollback until `data/benchmark-reference.json` captured it, the harness
    was measuring a different enemy than the reference until 2026-08-13, and the
    opener framework was replaced on 2026-08-14. Quoting them invites a comparison
    against numbers no run produces.
    **The harness is the live figure.** `node tools/benchmark-gap.mjs` prints it
    against `data/benchmark-reference.json`, at the REFERENCE's own conditions
    (level 100, 20% RES), and it is what any future claim about the gap must
    reproduce. As of 2026-08-17:

    | 3 passes, steady rotations | sim | reference | gap (ref/sim) |
    | --- | --- | --- | --- |
    | Chisa (leads, receives nothing) | 449,868 | 594,209 | 1.321x |
    | Denia | 1,238,793 | 1,306,453 | 1.055x |
    | Aemeath | 4,176,300 | 4,633,096 | 1.109x |
    | team damage | 5,864,960 | 6,533,757 | **1.114x** |
    | team gameTime | 79.71s | 78.84s | 0.989x |
    | team DPS | 73,582 | 82,874 | **1.126x** |

    The SHAPE inverted, and that is the current finding: Chisa was the closest
    member when the gap was diagnosed and is now the FURTHEST (1.321x against a
    1.082x mean for the two who receive team buffs), which the harness reports as
    "SHAPE DOES NOT REPRODUCE". So the remaining gap is no longer in the team-buff
    lane — it is Chisa's own kit, on a member who receives nothing from anyone.
    Her single-pass number is much closer (RUN B: 1.018x), so what diverges is
    what she does across passes, not what one cast of hers is worth.

    An independent, stat-free anchor agrees that solo is close: our Tune Break
    for Aemeath is 62,689, computed from the game's own LevelModifier with no
    ATK, crit or gear input, and Arabwuwa's character page puts Tune Break at
    11.90% of a solo Aemeath rotation → ~527k for their solo, against our 462,901
    on the same rotation (**1.14x**). Their stated build target (ATK 2050–2100,
    CR 73–78%, CD 270–275%) is LOWER than ours, so stats are ruled out from both
    sides.
    **Next (restated 2026-08-17):** reconcile CHISA across three passes. She
    receives nothing from anyone, so nothing team-lane can explain her, and her
    one-pass gap (1.018x) against her three-pass gap (1.321x) localises it to what
    repeats — her Concerto/Forte ramp, her chain grants, or how much of her second
    and third pass her rotation actually authors. Above that, the residual is
    still most likely the 9 clauses the coverage guardrail lists as deliberately
    unread (`tests/effect-coverage.test.mjs`) plus the deferred entries in
    `effect-overrides.json`, both of which are enumerated rather than invisible.
    Also still open from the earlier passes: whether Aemeath's S3 node is hot,
    which needs a re-measure and not a re-read.

    ~~**Two of those rows are the finding. Timing agrees to 2% and the damage
    SHARE across three different kits agrees to 0.4%, while every member is low by
    the same 2.6x, so the primary cause is a GLOBAL factor in the damage path and
    the per-kit items are second-order until it is found. Next: compare ONE cast
    end to end.**~~ **RETRACTED 2026-08-17 — this paragraph contradicted the
    LOCALISED note directly above it and had been left standing beneath it.** The
    uniform-2.6x reading died on 2026-08-07 when the gap stopped being uniform,
    and its "one global factor" conclusion is now false twice over: the gap is
    1.114x, and it is concentrated in ONE member. Kept struck rather than deleted
    because the ruled-out list below it is still load-bearing.
    Ruled out already, and still ruled out: enemy DEF (our `defMult` at level 100
    is 0.497, the standard curve, and switching targets cost exactly the 0.81x
    observed), skill levels (default build is level 90 with all skills at 10), and
    stat-node / inherent unlocks (both default to all-true, not off as first
    suspected). Prydwen and Arabwuwa independently agree on ~1.5M for Aemeath's
    rotation (128,145 vs 123,403 DPS), so the reference is not one site's error.
    → ~~**Their rotation has not been run.** Arabwuwa ship a step-by-step rotation
      for all three members, but its names ("Tune Break", "Forte Skill", "Hold
      Basic to hit Basic 1, 2, 3") need mapping to our skill keys.~~
      **CLOSED 2026-08-14** — mapped from the maintainer's transcription and
      adopted as the three reference rotations (`data/reference-rotations.json`,
      each entry carrying its own `source`); the prose→key map is recorded in
      HISTORY and in memory. Chisa's Rotation 1 became her `openerRotation` on
      2026-08-15 (item 2d). Two deliberate deviations are stated in the entries
      themselves: their Aemeath rotation slots a Tune Break, which
      `tests/tune-break.test.mjs` forbids a template from doing, and their Echo
      moves one step later so `grant.after` sees its chain source.
    → ~~**19 Echo-only labels** still read "Basic Attack (Echo): …".~~
      **CLOSED 2026-08-03.** Provenance is now a trailing marker in ALL cases,
      not only where the game's own name took the prefix: `categoryPrefix` no
      longer folds anything into the category. "Forte Circuit (Echo)" read as
      "an Echo kind of Forte Circuit", the same backwards qualifier the Forte
      half of this purge removed. 25 labels carry a `· Echo` marker (7 of them
      `· Forte Circuit · Echo`), zero carry a parenthetical, and labels stay
      unique per resonator — which is why the marker cannot simply be dropped.

## Team / meta correctness

2c. ~~**The derived "opener" pads every pass, not just the cold start.**~~
   **CLOSED 2026-08-14** — the framework was replaced rather than the padding
   tuned (maintainer-directed).

   THE MODEL NOW: every resonator starts on a FULL Resonance Energy meter, which
   is what Tower of Adversity actually gives you and the scenario this app exists
   to model. Overcap is impossible, so generation before the first Liberation is
   spilled — correct and cheap, because a Liberation is placed for its buff
   window (Chisa's feeds the +120% on Sawring Blitz; a support's is cast late so
   it spans the next two members' turns), not for energy efficiency. Concerto and
   the Forte gauges still start EMPTY, which is why pass 1 remains the weakest
   pass: nothing has built up yet.

   A CURATED ROTATION IS PERFORMED AS AUTHORED. No filler is spliced and no cast
   is ever dropped — it states what the player does. A gauge that comes up short
   is a BUILD that has not been geared for ER, so the engine reports the
   shortfall and the ER that fixes it (`opener.js deriveEnergyShortfalls`, and
   `team-energy.js minViableEr` derives the same quantity independently — on the
   benchmark team the two agree to 0.002).

   Measured, on the arabwuwa Chisa/Denia/Aemeath team:

   | | damage | time | DPS |
   | --- | --- | --- | --- |
   | before (padding) | 1.274x | 1.765x | 0.722x |
   | after | 1.109x | **0.989x** | 1.122x |

   `deriveOpeners` is now a pure REPORT: on and off produce byte-identical
   damage, time and step counts, which `tests/opener.test.mjs` pins.

2d. ~~**A rotation cannot state a different FIRST pass.**~~ **CLOSED 2026-08-15**
   (opened and closed the same day). `build.openerRotation` is an OPTIONAL
   curated opening pass, run on pass 0 only (`team-sim.js withOpeningRotation`)
   and threaded through the reference file, the optimizer recipe and the UI
   materialization. Chisa ships arabwuwa's Rotation 1; the other 55 resonators
   have none, and `tests/team-sim.test.mjs` pins that an absent opener leaves
   the damage bit-identical. Two grants her kit states were missing and are now
   curated from its own node text (Liberation → Basic 2, Eye of Unraveling →
   Rending Lunge), so the opener validates clean.

   Kept because the reasoning is the spec for the next one:

   `build.rotation` is one sequence, replayed every pass — so
   a kit whose opening pass genuinely differs has nowhere to say so.

   The concrete case: the very first member on field never gets an Intro (nobody
   swapped out to bring them in), and all three reference rotations open on a
   mid-chain stage that their own leading Intro unlocks — Chisa `basic_2`, Denia
   `basic_stagecraft_form_4`, Aemeath `skill_mech_3`. For members 2 and 3 that
   is legal, because the swap fires the Intro. For whoever starts the fight it
   is not, and `analyzeRotation` says so on the stripped sequence. arabwuwa's
   own capture has this shape: their Rotation 1 differs from R2/R3 **only for
   Chisa**, who is the member they lead with — she opens on a Resonance Skill
   there, and we store R2.

   The team page SURFACES the warning per member (`firstPassWarnings` in
   `team-editor-v2.js`) rather than rendering a sequence its own validator
   rejects in silence — and still does, for any resonator without an opener.
   What it could not do was fix it, and the fix had to come from the maintainer
   rather than be invented: writing a plausible pass-1 opener for Chisa would
   have been fabricating a reference. They supplied arabwuwa's Rotation 1 on
   2026-08-15 and it is now hers.

   The shape as built: an optional `openerRotation` on a reference entry
   (and on a build), used for a member's first turn only. Distinct from the
   retired padding — this is CURATION, not derivation.

2e. **The team sim casts the Intro the rotation names** (fixed 2026-08-15, noted
   here because the class of bug outlives the instance). An Intro NODE can ship
   several damage rows, so `skillType === 'intro'` does not identify one key:
   Aemeath has `intro_songs_across_the_universe` and
   `intro_debut_of_meteoric_radiance`, Denia `intro_it_s_been_a_while` and
   `intro_knock_knock`. `introKeyFor` took whichever the skill map listed first,
   which for Aemeath cast an Intro her build never asked for and did not unlock
   the Mech chain her next step needs. Invisible from inside the engine, because
   `withoutAutoCastSteps` removes the authored step before anything can compare
   the two. Any other "find the entry with skillType X" lookup has the same
   exposure wherever a node ships more than one row.

   **SWEPT 2026-08-17.** One other lookup of that shape exists — `outroKeyFor`
   (`team-sim.js`), which takes the first `skillType === 'outro'` entry — and it
   cannot misfire: **no resonator on the roster ships more than one outro row**.
   The `skillType === 'liberation'` reads in `sim.js` and `opener.js` are
   predicates over a step the rotation already named, not lookups, so they are
   not exposed at all.
   What the sweep DID find is that `introKeyFor`'s fallback is still live for one
   resonator. Nine resonators ship two Intro rows, and eight of them name the one
   they want in their reference rotation (Lupa, Aemeath, Denia, Rebecca,
   Cartethyia, Shorekeeper, Cantarella, Phrolova). **Lucilla names neither**, so
   her auto-injected Intro is decided by skill-map order — `intro_clip_it` over
   `intro_hard_cut`. Deliberately not "fixed" here: which of the two she should
   open with is a CURATION call on her reference rotation, and picking one to
   silence a fallback would be inventing a reference. It is a one-line edit to
   `data/reference-rotations.json` once the answer is known.

2b. ~~**Per-TYPE crit scoping**~~ **CLOSED 2026-08-17.** Built exactly as the
   framing below specifies: `stats.critRateBySkillType` /
   `critDmgBySkillType`, filled by `sonataConditionalGrants` from the game's own
   `DamageTypes` requirement and spent in `formula.js` beside the existing
   `typeDmg` lookup — one bucket read per hit, no new pipeline.

   **Both over-credits are gone, and they were larger than the item suggested.**
   Flamewing's Shadow now pays 20% Crit Rate on Heavy hits and 20% on Echo Skill
   hits instead of 20% on everything; **Sound of True Name**'s 5-piece turned out
   to be the same shape and the bigger offender — its only crit grant is
   `damageTypes:[5]`, so the whole 20% was reaching every hit. Measured on
   Aemeath: build-wide Crit Rate 0.33 → 0.13 (her bare value) with the 20% moved
   into the Heavy and Echo buckets.

   **Refusal is part of the fix.** A scope this engine cannot honour exactly is
   left unclaimed so the tier keeps its text, rather than being widened: an
   ELEMENT-scoped crit grant (no per-element crit bucket), a TEAM-WIDE scoped one
   (the team lane carries whole-build numbers), and a damage tag we do not map.
   `critScopeTypes` refuses the WHOLE grant when any tag is unmapped, and
   refusing rather than FILTERING is the point — `scopeOf` in the same file builds
   its `skillTypes` with `.filter(Boolean)`, and `targetModApplies` reads an empty
   `skillTypes` as "applies to every hit", so a silently dropped tag widens a
   scope instead of narrowing it. All three refusals are pinned on synthetic
   grants in `tests/external-buffs.test.mjs`, plus a roster count so a future
   scoped crit grant fails the test instead of falling back to prose.
   **Both guards are prospective, corrected 2026-08-17 after verification.** The
   only unmapped tag in the data is sonata 9's `damageTypes: [7]`, and it carries
   attribute 15 (`dmgAll`) — so it reaches neither the crit lane (excluded by the
   pre-existing `route.bucket in out` check) nor `targetModApplies`. The earlier
   wording here cited it as the live instance of the filtering hazard; it is not
   one. The hazard in `scopeOf` is real and currently latent.

   **The routing is asymmetric, and only one lane got it** (found by verification,
   2026-08-17). `sonataConditionalGrants` routes a scoped crit grant; the three
   lanes fed by `foldExternalGrants` — weapon conditionals, echo main-slot
   passives, and the incoming-resonator transfer — still send ANY scoped grant to
   `unplaced` whatever its attribute. That is inert today, verified by scanning
   every weapon rank, every echo main-slot grant and every `recipient: 'incoming'`
   sonata grant for attribute 8/9 with a scope: **zero**. It is also visible
   rather than silent (`unplaced` exists to be counted, and the weapon lane then
   falls back to its text), so the failure mode is an under-credit that shows up
   in a list. Left unbuilt deliberately — there is nothing to route — but the next
   scoped crit grant to ship on a weapon or echo needs this second call site.

   **Meta impact: 66 of 416 team slots move, every one of them DOWN**, median
   −3.85%, max −11.87%; 10 of 52 anchors reorder their suggested teams. All six
   suggested builds and all six weight sets are byte-identical, and the benchmark
   harness does not move (it pins sonatas 7/28/27). The largest movers are
   Qiuyuan and Sigrika, whose meta builds wear Sound of True Name — which is the
   direction removing an over-credit must have.

   Kept because the reasoning is the spec, and because the last paragraph is now
   the sibling item 2f:

   `ExtraEffectRequirements` type 12 `DamageTypes` scopes a grant to the game's
   own 0..5 damage-type tag, and the engine honours that for DEF-ignore and
   RES-shred (per-hit, via `skill.js targetContext`) but has **nowhere to put a
   scoped CRIT value**: `critRate`/`critDmg` are whole-build stats resolved once,
   before any hit exists. So `sonataConditionalGrants` refuses a scoped crit
   grant and the tier falls back to its tooltip, which states the value flatly.

   Concretely, **Flamewing's Shadow** ships its 3-piece as two rows —
   `damageTypes:[1]` (Heavy) and `damageTypes:[5]` (Echo), 20% Crit Rate each —
   and the sentence says "20%" with no scope. The sim therefore credits a flat
   20% Crit Rate on *every* hit the wielder lands. That is an **over-credit**
   the data can already see and the engine cannot express.

   NOT "per-hit crit" (the first framing, and wrong): nothing here varies per
   hit. It varies per damage TYPE, which every hit already carries as
   `formulaType`. So the shape is a per-type crit bucket — `critRateBySkillType`
   / `critDmgBySkillType`, resolved at `resolveSkill` alongside the existing
   `dmgBonusBySkillType` — not a new per-hit pipeline.

   Blocked on nothing; it is a real (small) engine feature rather than a routing
   fix, which is why lane 4 left it. Do it with the damage work.

2f. ~~**An "Echo Skill DMG" bonus reaches the equipped echo's cast and nothing
   else**~~ **CLOSED 2026-08-17** (opened and closed the same day; maintainer
   directed, with the framing that a type can be mechanical, an attribution, or
   both, and that the data already knows which).

   **The model now says which.** `src/core/dmg-attribution.js` holds the third
   question the engine had been answering with the second: `skillType` is
   MECHANICAL, `formulaType` is ONE value because it is also the skill-LEVEL key,
   and the ATTRIBUTION is which DMG-type bucket the hit reads.

   **It is exactly ONE bucket, and the client says so** (checked after the first
   attempt modelled it as a summed set). `CharacterDamageCalculations.js`:

   ```js
   static GetAttackTypeDamageBonus(snapshot, type) {
     switch (type) {
       case 0: return Proto_DamageChangeAuto        // basic
       case 1: return Proto_DamageChangeCast        // heavy
       case 2: return Proto_DamageChangeUltra       // liberation
       case 3: return Proto_DamageChangeQte         // intro
       case 4: return Proto_DamageChangeNormalSkill // skill
       case 5: return Proto_DamageChangePhantom     // echo
     }
     return 0;
   }
   ```

   fed the instance's own `Type` and folded in as
   `1 + Proto_DamageChange + elementBonus + attackTypeBonus`. A switch with a
   single return: a type-5 instance reads Phantom and NOTHING else, even when the
   move that fired it is mechanically a Heavy Attack. **There is no overlap
   between the six buckets, so nothing may ever sum two of them.** `SubType` was
   checked as a possible second tag and is empty on every echo instance.

   **Measured off the game's tables** (`hit-map.json` hit ids joined to
   `bindata/damage.json` `Type`), the roster splits three ways:
   → **24 rows are attributed to echo ALONE** (Sigrika 10, Galbrena 6,
     Phrolova 5, Qiuyuan 3). Their `formulaType` is a mechanical stand-in and not
     an attribution, so they were wrong TWICE: measured, +50% in their mechanical
     bucket moved every one of them **+50.0%** — a Basic/Heavy/Skill/Liberation
     DMG Bonus the game does not give them — while every Echo Skill DMG grant
     missed them. `skill-rows.mjs` had documented the intended behaviour ("simply
     receives no type-specific DMG bonus") and the code never did it.
   → **1 row BRANCHES** — Lucilla's [Letting It Go]. Not a mixture: it ships
     `1109014011` (Type 0) and `1109014012` (Type 5) with **identical RateLv,
     element and energy**, one per Resonance Mode. The skill computes as Basic
     Attack DMG in Resonance Mode - Glacio Chafe and as Echo Skill DMG in
     Resonance Mode - Echo (maintainer-reported, and the data agrees). A mode is
     a build-level toggle locked for the fight, so `build.resonanceMode` picks
     one — never both. A branch that cannot be resolved falls back to
     `formulaType` rather than guessing a half.
   → **7 rows are ambiguous** (>1 distinct non-echo type) and **fall back
     unchanged**. Stating their set would start applying two buckets to hits whose
     split this pass cannot see, which is a separate correction; preprocess still
     logs them and applies nothing.

   **All five comparison sites go through the set**, so they cannot drift apart:
   the gear buckets (`formula.js` — DMG bonus and the 2b crit buckets), the
   chain/inherent/node lane (`buffs.js resolveChainInherentContext`), a window's
   `dmgType` (`buff-windows.js`), outro amplify scopes and per-hit target mods
   (`skill.js`). The kit lane matters as much as the gear one: **Qiuyuan's own
   node grants Echo Skill DMG Bonus and paid him nothing on his own three echo
   rows**, and Lucilla's 30% likewise.

   **The set lives on the damageTable ROW, not on the skill entry**, because a key
   can gather several rows and they need not agree — Calcharo's Heavy Attack
   ships one heavy-tagged row and one liberation-tagged row. A key-level field
   would have to pick one and be wrong for the other hit.

   **Meta impact: 38 of 416 team slots move, 27 UP and 11 DOWN**, median +0.03%,
   range −9.54% to +29.66%; 7 anchors reorder (Lupa, Galbrena, Rebecca, Aalto,
   Qiuyuan, Sigrika, Verina). Both directions is the correct shape — the two
   errors had been cancelling. The biggest gains are Qiuyuan/Sigrika comps, whose
   echo grants finally land; the biggest losses are Sigrika and Galbrena comps
   losing the mechanical bucket they were never owed. Suggested builds, weights
   and `erModel` are byte-identical, and the benchmark is unmoved at 1.114x
   (its three members ship no echo-tagged row).

   **The 7 ambiguous rows, named** (they state no attribution and are unchanged).
   Two shapes, and neither is a hit that reads two buckets:
   → *Branch-shaped*, like Lucilla's — **Aemeath** `skill_sync_strike_armament_merge`
     and `skill_mech_4` (paired ids `12102104xx` / `12102004xx`, skill vs basic),
     **Denia** `heavy_mid_air_heavy_attack_breakdown_form` (`…081` heavy /
     `…082` liberation). Both resonators have Resonance Modes, but neither mode
     is NAMED after a damage type, so the branch is not resolvable the way
     Lucilla's is and they stay on the fallback.
   → *Matcher over-reach* — **Carlotta** `heavy_heavy_attack` (4 heavy instances
     at rate 2282 plus one foreign basic at 6084/Energy 90), **Yuanwu**
     `forte_heavy_thunderweaver_damage` (1 heavy at 3102 + 2 basic at 2068),
     **Rover: Havoc** `forte_heavy_umbra_thwackblade_damage` (1 heavy at 12665 +
     the same skill instance matched 4× at 995) and
     `forte_heavy_umbra_lifetaker_damage` (2 skill at 27635 + 4 heavy at 995).
     These look like `matchRowHits` pulling in an instance that belongs to
     another row, not like a genuine mixed attribution — worth its own pass.

   Kept because the reasoning is the spec:

   The game tags a damage instance `type 5` for Echo Skill DMG, and
   `preprocess.mjs` records that as `isEchoSkill` while keeping the row's
   mechanical `formulaType` — a deliberate boundary, stated in CLAUDE.md and in
   `skill-rows.mjs` ("the Echo DMG Bonus stat is a separate, out-of-scope
   feature"). The consequence has never been written down: **`isEchoSkill` is
   read by no module in `src/`**, so the only hit that ever presents as `'echo'`
   is the equipped echo's own cast, which `resolveEchoSkill` tags directly.

   So an "Echo Skill DMG Bonus" grant is credited on one cast per rotation and on
   none of the resonator's own rows that deal Echo Skill DMG. **25 such rows exist
   across 5 resonators** — Sigrika 10, Galbrena 6, Phrolova 5, Qiuyuan 3,
   Lucilla 1 — and **10 external grants** route to that bucket today (attribute
   114: one weapon across its five ranks, Dream of the Lost 2pc at 35%, sonata 21
   3pc, three echoes), plus the three scoped crit grants 2b just wired.

   That Sigrika and Qiuyuan are exactly the two anchors 2b moved most is not a
   coincidence: their meta builds wear an Echo-Skill-scoped set, and they are two
   of the five resonators whose kits deal Echo Skill DMG. Removing the blanket
   credit was right, and it leaves them under-credited on the rows the flag
   marks. Both errors are real; they had been cancelling.

   The fix is small and the decision is not: matching a hit on `isEchoSkill` as
   well as `formulaType` is a two-line change in `skill.js` + `formula.js`, but it
   changes what `dmgBonusBySkillType.echo` pays as well, so it re-prices an
   existing lane on a boundary the project drew deliberately. Wants a maintainer
   call, not a parser one. Until then this is an UNDER-credit, which is the safe
   direction.

2g. ~~**A suffixed level-param key makes a damage row's id NaN, and seven of
   Chisa's keys then resolve to the same row**~~ **CLOSED 2026-08-17**, opened
   and closed the same day, on its own commit as the maintainer directed.

   **The fix moves no existing id.** `paramIdOf` (skill-rows.mjs) folds the
   suffix into the PARAM NUMBER rather than into the id formula, so a plain row
   keeps the id it already has — which is the whole constraint, since a damage
   row's id is a join key. The stride (150) sits above the largest plain param
   the roster ships (127) so an encoded value can never equal a real one, and low
   enough that the largest possible result (5x150+127 = 877) stays inside the
   1000-wide band `nodeId * 1000` reserves per node. `paramId` feeds nothing else:
   the two `synId` expressions in preprocess.mjs are its only consumers.

   **Measured, on the whole roster: 4,091 ids unchanged, 9 changed, and all 9
   were `null`.** Zero row-count drift, zero name drift, zero multiplier changes
   in the table — the rows always held the right numbers, it was the LOOKUP that
   was broken. `tests/dmg-attribution.test.mjs` now pins the invariants rather
   than the encoding: every row has an id, and no two rows of one resonator share
   one (the only scope that matters, since a row is only looked up inside
   `damageTable[resonatorId]`).

   **Chisa's seven now read the game's own numbers**, checked against her node
   text at node level 1: Serrated Loop Hold 60.16% (`3.76%x16`), Blitz Stage 2
   Hold 53.50% (`5.35%x10`), Stage 2: Discordance 5.40% (`1.80%x3`), Stage 3 Hold
   48.24% (`8.04%x6`), Stage 3: Falltone 5.40%, Chainsaw Dodge Counter 42.80%
   (`5.35%x8`) and its Hold 53.50%. The ATTRIBUTION was wrong alongside the
   number and is fixed with it: the six Forte rows had inherited `skill` from
   Serrated Loop Hold while they shared its id, and now read `liberation` — which
   is what her Forte states, *"Sawring - Blitz DMG is considered Resonance
   Liberation DMG"*.

   **LOCK B is byte-identical** (erModel, characters and teams all unchanged):
   none of the nine corrected keys appears in any reference rotation, which is
   the same reason nothing shipped was wrong before. This was a build-page
   hazard, and it inflated.

   The original report follows, because the numbers in it are the measurement:

   `synId = rid*1e7 + nodeId*1000 + Number(paramK)` in `preprocess.mjs`. Eight of
   Chisa's source level-param keys are SUFFIXED — `15_2`, `18_2`, `28_2`, `28_3`,
   `29_2`…`29_5` — and `Number('15_2')` is NaN, which JSON serialises to **null**.
   `resolveSkill` resolves a row with `find(row => row.id === id)`, so every key
   carrying a null id lands on the FIRST null-id row of that resonator.

   Roster-wide: **9 rows, 9 keys, 3 resonators.** Rover: Electro and Rover: Aero
   have one row and one key each, so they resolve correctly by having no rival.
   **Chisa has seven of each, so six of her keys read the wrong multiplier:**

   | key | own multiplier | reads |
   | --- | --- | --- |
   | `skill_serrated_loop_hold` | 1.1936 | 1.1936 (correct — it is first) |
   | `forte_heavy_sawring_blitz_2_hold` | 1.0640 | 1.1936 |
   | `forte_heavy_sawring_blitz_2_discordance` | 0.1074 | 1.1936 (**11x**) |
   | `forte_heavy_sawring_blitz_3_hold` | 0.9588 | 1.1936 |
   | `forte_heavy_sawring_blitz_3_falltone` | 0.1074 | 1.1936 (**11x**) |
   | `forte_heavy_chainsaw_mode_dodge_counter` | 0.8512 | 1.1936 |
   | `forte_heavy_chainsaw_mode_dodge_counter_hold` | 1.0640 | 1.1936 |

   **Nothing shipped moves today**: none of the seven appears in Chisa's
   `rotation` or her `openerRotation`, so the benchmark, the meta and every
   reference number are untouched. It is a BUILD-PAGE hazard — the page lets a
   user slot any key — and it inflates, which is the direction that looks fine.

   ~~Not fixed here for a reason: the repair is to make the id unique for a
   suffixed param, and a damage row's id is a JOIN KEY.~~ Done as its own change,
   as described above — and the constraint held: no existing id moved.

   **What the suffixed rows ARE, which is what made the fix safe to shape.** They
   are VARIANT rows: a Hold version of a stage, or a release-branch sub-move. In
   Chisa's Forte Circuit, holding Normal Attack through Sawring - Blitz Stage 2
   casts the Hold variant and auto-continues to Stage 3, while releasing casts
   [Stage 2: Discordance] instead — so a Hold row is an ALTERNATIVE to its tap
   row, never an extra cast, and Discordance/Falltone REPLACE the auto-continue
   rather than adding to it. 22 suffixed keys ship across 12 resonators.

   **Still open, separately:** Chisa's `forte_heavy_bonus_dmg_multiplier_per_ring_of_chainsaw`
   is `paletteInclude: true` and therefore slottable as a rotation step, but it is
   not a cast — it is the +1.30% per Ring of Chainsaw modifier on Sawring -
   Eradication, structurally the same shape as Denia's Dark Core ladder. Ring of
   Chainsaw itself is not modelled (no `RESOURCE_DEFS` entry for 1508).

   ~~Her `openerRotation` ends on `forte_heavy_sawring_blitz_3` and never casts
   Sawring - Eradication.~~ **CLOSED 2026-08-18** — the OPENER now ends on it,
   with the pre-steps the kit itself states. Her Forte names exactly two routes
   into Eradication, *"after casting Sawring - Blitz Stage 3: Falltone"* and
   *"after consuming all Ring of Chainsaw"*, and the gauge settles which: the tap
   chain spends 18 + 23 + 24 of 100 and leaves 35, so the second route is never
   reached and `forte_heavy_sawring_blitz_3_falltone` is a requirement, not
   decoration. arabwuwa's R1 prose agrees — *"Hold Basic to hit Basic 1, 2, 3"*
   is the hold path, and the Forte's own instruction row reads *"Sawring -
   Eradication: In Chainsaw Mode, hold [NA] or [NA]+[NA]+[NA]+[NA]"*.

   **Her STEADY loop deliberately does NOT**, and that was worth establishing
   rather than assuming. The maintainer initially ruled that both rotations end
   on Eradication, then verified in game and reversed it: the loop reaches only
   **56.3 of 100 Concerto** and fires **no Outro** — arabwuwa's trailing "Outro"
   is a swap marker, not a cast. The three trailing basics that look like filler
   are a Concerto top-up worth 11.8, and that is exactly what puts two passes
   over the gauge (112.6) instead of under it (89.2), so the Outro lands every
   SECOND swap. Dropping them reads 44.6/pass, which misses at 89.2. The loop is
   short on purpose: team DPS divides by the SUM of on-field times and Chisa
   contributes ~8–15% of team damage, so every second she spends is one her main
   DPS does not.

   `tools/benchmark-gap.mjs` D4 reads the same *"Spam Basic 1, 2, 3"* as the
   CHAINSAW chain and is therefore wrong — left alone deliberately, because its
   arrays exist to reproduce the external capture, not our reference rotation.

3. **`resolveErTarget` has zero UI consumers** (re-verified 2026-07-23 — only
   `src/core/team-er.js` references it). All 79 real team-context ER numbers
   reach no user. NOT blocked on a design decision — just needs wiring into
   `team-editor-v2.js` / `compare-v2.js`.
4. **3-way comparison** (`compare-v2.js`) doesn't compose the P11 team-sim
   component (spec §9a hard-req 4) and omits a heal/**shield** total row.
   Go/no-go needed: accept the compact table as final, or build the full
   per-step view.
5. **Suggested-teams coverage** — largely *addressed*: the SYNERGY table was
   rewritten to auto-derive roster-wide from official role tags, so the old
   "5/6 P12 anchors get zero teams" gap should be gone. Worth a spot-check that
   Carlotta/Jinhsi/Changli/Phoebe/Cantarella now surface teams.

## Feature backlog (UI)

6. **Full-text / stat / effect search** — still name-only in
   `echo-picker-v2.js:57` and roster. Flagged by two audit angles as the most
   concrete shippable UI item.
7. ~~**Tune Break** — formula calibrated + tested (`computeTuneBreakDamage`) but
   NOT wired into the live sim. Needs the gauge engine (#2) + a manual
   rotation-step toggle, default OFF.~~
   **SHIPPED 2026-08-03**, and it needed neither the gauge engine nor a toggle.
   Tune Break is a RESPONSE to the target's Off-Tune bar, not something cast off
   a gauge of ours, so there is nothing to model on our side: the step is
   slotted by hand (`TUNE_BREAK_STEP_KEY`), and slotting it IS the assertion
   that the bar was full. It carries no conditionals of any kind.
   Every resonator is offered it, because the game gives every resonator the
   node — `skill_trees[*]` with `skill.type === 'Tune Break'`, projected to
   `resonator.tuneBreak` (56/56). The game names it by WEAPON TYPE for 49 of
   them ("Tune Break: Sword") and gives seven kits a name of their own
   ("Unlanded Melody", "Data Crash"), which is why the name is read rather than
   synthesised — but the button leads with the mechanic either way.
   The node ships **no damage table and no level curve** (`damage: {}`,
   `level: {}`), which is consistent: its damage is the tune-bar mechanic's own
   formula, not a character multiplier. So the step reads nothing from `stats`
   and nothing from the effect pipeline — no ATK scaling, no crit, no gear stat.
   Two builds of one resonator that differ enormously everywhere else deal
   IDENTICAL Tune Break damage, which is what `tests/tune-break.test.mjs`
   guards: a regression routing it through the normal damage path would still
   look plausible, and only that equality catches it.

   **TIMING IS MEASURED (2026-08-03)** — the first pass had guessed 1.50s.
   The animation was findable after all, just not by the route everything else
   uses: with no damage ids there is no bullet chain and no hit id to resolve a
   row from, so it is reached by TRIGGER TYPE instead. 68 rows declare
   `BreakWeaknessTrigger` (internal name 破弱, "break weakness"), covering all 60
   resonators, every one `provenance: extracted` with a resolved montage.
   `map-timings.mjs` gained a `breakWeakness` route that emits a `__tunebreak__`
   entry per resonator into `data/actionable-times.json` — regenerating that
   file changed **zero existing entries** and added exactly 56.
   → `stepDuration` is per resonator, 1.4857–1.6086s, clustered by weapon type
     (Sword ~1.49, Rectifier ~1.50, Gauntlets ~1.55, Broadblade ~1.57, Pistols
     ~1.60). The 8 resonators shipping two rows ship FORM variants (Aemeath's
     Mech, Cartethyia's Fleurdelys, Camellya's 魔人化); the base form is picked
     by matching the animation name against the resonator's own weapon type,
     which is also how the game names the node — 56/56 resolve, asserted.
   → **It STOPS THE COMBAT CLOCK for its whole animation.** Every row carries a
     TimeStopRequest window (`freeze_combat_clock_s`), a general-invincibility
     tag over the same span, `interrupt_level: 11` (a Basic is 2) and a
     `cannotSwitch` window. So in the ToA clock a Tune Break costs real seconds
     and ZERO game seconds. Clamped to the step like every other measured
     freeze — the raw window runs ~15ms past the actionable point and unclamped
     drives gameTime negative.

   **ONE PER PASS in the team sim** (maintainer ruling 2026-08-03). The bar is
   the TARGET's and refills once per cycle, so three members moving through one
   pass share a single opportunity — not one each. `capTuneBreaksPerPass`
   removes the surplus (rather than zeroing it, so nothing downstream sees a
   cast that did not happen) and reports it as `tuneBreaksDropped`. This matters
   precisely BECAUSE the animation stops the clock: each uncapped extra would be
   damage at no cost to the DPS denominator. The build page still simulates
   every slotted response — a rotation there is a scratchpad — but flags the
   second and later ones, with no FIX button, since resolving means removing a
   step.

   **Tune Break Boost: SHIPPED 2026-08-03**, via the Tune Strain chain below.
   `BonusDmg%` stays 0 — no identified source anywhere in the data — and
   `BreakWeaknessRatio` needs none: it is the game's own Tune Break ratio and
   reads **10000 (= 100%) on every one of the 2,740 `baseproperty.json` rows**,
   so it is already inside the calibrated constant, which is why the worked
   example reproduces to 0.001% without it.
   The kit stat does NOT increase a Tune Break's own damage in any kit text —
   what it increases is the RESPONDER's damage while the target is Interfered,
   which is why it needed the chain first.

   **The Tune Strain chain (2026-08-03).** *Shifting → Tune Break → Interfered
   → damage.* A cast inflicts **Tune Strain - Shifting** (25s); a Tune Break on
   a Shifting target converts it to **Tune Strain - Interfered**; a responder's
   Tune Break Boost then pays *"0.12% of their total DMG per point per stack"*.
   → **Derived**, because it is a template: four kits (Mornye, Denia, Lynae,
     Luuk Herssen) state the payout AND *"the max stack limit of Tune Strain -
     Interfered on a target is increased by 1"* in near-identical words.
     `tools/preprocess/tune-strain.mjs` reads who responds, the +1 and the 0.12%
     off each Tune Break node; `tests/tune-strain.test.mjs` asserts all four
     AGREE, so a future kit stating a different rate is a finding rather than a
     silent average.
   → **The cap needs no curated base**: nobody states one, four state the same
     +1, so the limit IS the responder count. A solo responder caps at 1 — which
     is why Denia's S6 extra stack changes nothing solo and +50% of the stacks
     in a trio.
   → **Curated**, because it is not a template: the five Tune Break Boost
     GRANTS (`TUNE_BREAK_BOOST_GRANTS`, each with its quote). The stat's base is
     0 — `WeaknessTotalBonus` reads 0 on 2,729 of 2,740 rows, the exceptions
     being enemies — so a team's total is exactly what its kits grant.
   → Measured: solo Denia **+1.20% at S0, +3.60% at S2**; a Denia/Luuk/Lynae
     team **+3.04% at S0 and +18.12% at S6** on their non-Tune-Break damage.
     Luuk gains most, carrying a second clause the others lack (flat, per 10
     points, capped at 30%, and his S2 REPLACES the rate rather than adding).
   → Deliberately unmodelled: Denia's *"every 10% of Off-Tune Buildup Rate over
     100% …"* grant. `WeaknessMastery` is a real property but reads 0 for every
     resonator row, so it evaluates to zero and guessing it would invent a stat
     the game does not give them.
   The Tune Rupture and Hack families share the SHAPE but not the payout —
   their responders cast a real RESPONSE SKILL (Mornye's Particle Jet, Lynae's
   Spectral Analysis, Rebecca's Meltdown, Lucy's Data Crash), and those are
   ordinary damage rows already in the skill map, slottable today.

   **What a Tune Break now triggers.** It registers as a CAST, so kits reacting
   to one fire: Luuk Herssen S4 (*"After a Resonator in the team deals Tune
   Break DMG, all Resonators in the team deal 20% more DMG for 20s"*) was
   parsing to **zero effects** and is now a real team-wide 20s window — measured
   +10.5% on his own reference rotation, the shortfall from 20% being the window
   expiring partway through. Three parser gaps had to close for it: a "deals N%
   more DMG" branch (the dealer's side of the amplify bucket, which nothing
   read), `deals Tune Break DMG` as a structural cast trigger, and the
   team-recipient phrasing "all Resonators in the team deal N%".
   Deliberately NOT added to `SKILL_PHRASE_TO_TYPE`: that map is read for both
   the TRIGGER's category and the effect's SCOPE, and for a Tune Break the two
   are opposites — listing it scoped Luuk's S4 to the one step type it must
   never buff.

   Still unmodelled, deliberately: the Off-Tune bar itself (nothing validates
   that a slotted response is legal — the same contract every manual step has),
   and Luuk S6's *"…Aureole of Execution, Ichor Deposit, and Mid-air Attack -
   Gavel of Earthshaker deal 30% more DMG"*, whose subject is a COMMA-SEPARATED
   skill list — the subject binder deliberately never reads across a comma,
   because that is how it avoids binding a team buff to the trigger list in
   front of it. It parses to nothing today, exactly as before.
8. **Echo dupe verification** — no guard against duplicate echoes in the same
   sonata set (`echo-rules.js` only checks duplicate substats).
9. **Echo outro wiring** — Lucilla → Hiyuki (Glammoth) combo, no code exists.
10. ~~**"Forte_X" shows as a damage type** in the donut tooltip — it isn't one.~~
    **CLOSED 2026-08-02.** The raw `forte_basic` / `forte_heavy` string stopped
    reaching the tooltip with the "Heavy Attack (Forte)" purge, which gave both
    node types the label "Forte Circuit". That exposed the other half of the
    same bug: the donut accumulated on the RAW node type, so the five resonators
    whose reference rotation uses both drew **two identical "Forte Circuit"
    slices** — Iuno's Forte is 68% of her damage and was shown as a 26% arc
    beside a 43% one (also Jinhsi, Cartethyia, Lumi, Rover: Havoc). Fixed with
    `damageFamily()` in `build-editor/shared.js`, which collapses the mechanical
    basic/heavy split into one display family before aggregating. The split also
    risked binning each half under the 4% "Other" threshold that the combined
    slice clears — latent in the current rotations, not observed. Guarded by a
    live test that fails by NAME for any rotation drawing two same-label slices.
11. **Basic ATK restructuring** — description-first layout (mirror extracted-
    data shape).
12. **Enemy-level carryover** across independent builds (currently a per-page
    UI input only).
13. **Resonator-themed coloring/theme** — experimental palette CSS exists but is
    gitignored / unwired.
14. **Popover keyboard nav** — Escape-only; no arrows/Enter.
15. **Sonata quick-switch** shipped (2026-07-23) but deferred: team multi-set,
    5pc shortcut, free-form combos.
16. **Echo templates / "My Inventory"** — named/global echo templates and an
    inventory page scoped out (2026-07-19) as design-first features.

## Curation & calibration (ongoing data work)

17. **Combo-entry curation** (`COMBO-ENTRY-CURATION.md`): 13 Tier-1 families
    still uncurated despite kit text; ~26 Tier-2 characters need in-game
    verification; swap-in entry stage answered for only 8 of the roster.
18. **Effect-override backlog** — 50 unresolved effect triggers; ~55 investigated
    as "not simple overrides." Parked candidates listed in the doc.
19. ~~**Negative-status calibration** (`TEAM-EFFECT-MODEL.md`) — Fusion Burst &
    Electro Flare stack mults uncalibrated; Spectro Frazzle & Aero Erosion need
    re-verification against the corrected DefMult/ResMult formula.~~
    **CLOSED 2026-08-01 as a DUPLICATE of #28** — and closed by extraction, not
    calibration. All six per-stack tables, caps, stack lifetimes and tick periods
    now come from the game's own system buffs (`data/status-damage.json`). No
    in-game capture was needed for any of them; see #28 and the
    `TEAM-EFFECT-MODEL.md` §"deferred" entry for the numbers that moved.
20. **Calibration cases** — 13 still pending in-game capture (`CALIBRATION.md`).

## Deliberate go/no-go decisions

21. **Echo-set optimizer + substat roll-grading** (P10-4/P10-5) — fully
    *deleted*, not deferred. Rebuilding = from scratch.
22. **Character state modelling** (promoted out of #1, 2026-07-30). 13 keys
    across 6 resonators hold a timing correct for only one branch, because the
    sim tracks no such state: Zhezhi ground-vs-air Conjuration, Brant's airborne
    rotation, Rebecca's Huntress/Guts weapon mode, Lucy's [Algorithm
    Compaction], Camellya's [Blossom Mode], Roccia's [Beyond Imagination]
    (`needsStateModel` in `data/timing-overrides.json`; flagged
    `timingProvisional: 'state'` and visible in the rotation UI). **The timing
    data is already complete** — every multi-candidate key keeps its `variants`
    array, so a state model selects an alternative without re-deriving anything.
    What's needed is the state itself: an airborne check, a weapon-mode flag,
    and — for the three gauge-gated kits — the engine from #2. Related but
    larger: splitting a state-gated variant into its own selectable rotation
    step.
23. **Echo animation timing.** `ECHO_CAST_TIME = 1.20` (sim.js) is the last
    fabricated timing constant in the engine: the lock a **Transform** echo
    imposes, plus its unmodelled multi-hit transformed sequence. ~~Needs a
    second export.~~ **Unblocked 2026-07-31** — the live export is a full
    client, and `Content/Aki/Character/Monster/` is present, so the assets are
    in hand. What is missing is the *join*: echo → monster skill row → montage
    has no equivalent of `hit-map.json`, so it needs its own id bridge. The
    parser itself already handles these assets (detection is by export class,
    not path). Parallel (Summon / direct-attack) echoes are unaffected: they
    cost 0, which is exact.
24. **AUTO-OPTIMIZER Phase E** — the capstone "kit → optimal build" search. Not
    started ("lands after P13 by definition").
33. **`multiplierUp` scope — the residue** (2026-08-08). The lane itself is
    closed: `docs/HANDOVER-multiplierup-scope.md` steps 1, 1b and 2 all shipped,
    bindings went 52 → 87, and no `multiplierUp` effect is always-on with no
    scope (guarded by `tests/multiplier-scope.test.mjs`). What the two
    verification agents left on the table:
    → **Suisui S5.0 over-binds `skill_drizzle_stance`** — the only live
      over-bind on the roster. "Heavy Attack - Drizzle Stance" has no key, so the
      category-stripped attempt resolves the bare "Drizzle Stance" onto the
      Resonance Skill row. No principled fix exists inside `skill-scope.mjs`:
      filtering that attempt by the name's own category is exactly what the
      CLAUDE.md invariant forbids. Wants a key-side answer, not a parser one.
    → **Taoqi S5.0 (+50%) and Camellya S6.0 (+150%) are DEAD BUFFS** and always
      have been — they carry `skillType: 'forte'`, and `nodeTypeMatches` strips
      `forte_heavy` to `heavy`, which never equals `forte`. Neither name exists
      as a key either (`forte_heavy_timed_counters_*`,
      `forte_heavy_ephemeral`), so no amount of parser work reaches them. They
      are the two survivors pinned by `tests/node-type-match.test.mjs`.
    → **Partial name resolution narrows a scope.** Rebecca S3.0 ("Party 'til
      Dawn!"), Galbrena S6.0 ("Dodge Counter - Purgatory Scourge") and Luuk S3.1
      ("Mid-**Attack** - Gavel of Earthshaker", the game's own typo) each name a
      skill that has no key, so the effect binds to the siblings that do and the
      named-but-unreachable one loses the grant. Also a key-side gap.
    → **Rebecca S1.0's bulleted list** is read 6 of 7 — the game reuses " - " as
      both an in-name and a between-name separator — so the all-or-nothing gate
      correctly refuses the whole list and leaves her on `skillType`.
    → **Two clauses want a different lane, not a scope:** Aemeath S2.2 applies
      Tune Rupture STATUS damage to her Resonance Skill rows, and Hiyuki S6.2
      parses a **Crit. DMG** 40% as `multiplierUp`.
    → **Phrolova S2.0 + S2.1 both pay `basic_scarlet_coda` unconditionally**
      (+150%): the kit gates the second on Aftersound and the clause classifier
      does not read it. Pre-existing; visible only now that both are scoped to
      one key.
    → **No saved-build migration** for Luuk Herssen's slot shift (S6.0 → S6.1).
      A stale `effectStacks` entry addresses a non-stackable effect and is
      ignored; nothing is corrupted.

34. **`npm run data` is not a pure function of the repo** (found 2026-08-18).
    `tools/preprocess.mjs` opens with `await downloadAll(args.lang)`, so LOCK A
    re-fetches the LIVE upstream every run. Regenerating on a clean tree that day
    pulled in two resonators the dataset had never seen (Jingran 1212, Qingxiao
    1413), two weapons and 166 damage rows — 63,001 changed lines with no source
    file modified locally. So LOCK A cannot tell "my change moved the dataset"
    from "upstream shipped a patch", and a reviewer running it during an
    unrelated fix will silently stage a roster expansion. It was caught here only
    because the change had no business touching the dataset at all. Wants either
    a pinned ref or a separate, deliberate "sync upstream" step that is never
    part of a verification lock.

    **Partly addressed 2026-08-18:** `--ref` pins the upstream branch
    (`node tools/preprocess.mjs --ref 3.5`), so LOCK A can be made to mean "my
    change moved the data" again. That is the verification half. It does NOT
    decide when to adopt a new version — the live default branch is now **3.6**
    while the committed dataset is **3.5**, and that gap is real content
    (Jingran 1212, Qingxiao 1413, two weapons, 166 damage rows) that deserves
    its own deliberate pass rather than arriving as a side effect. The dataset
    also records no ref of its own: `source` still reads
    "Dimbreath/WutheringData + nanoka.cc", stale since the Arikatsu migration,
    and `gameVersion` is null.

35. **Concerto enforcement is now a POLICY call, not a data excuse**
    (2026-08-18). The flat "<name> Concerto Regen" fold was Intro-only and read
    65 of 261 grants; widening it to Skill/Liberation/Forte/Normal Attack added
    2,884 points and moved the swap economy from fiction to something
    measurable — **0 of 55 curated rotations could fill the 100 gauge in one
    pass, 25 now do**, median 38.8 → 94.0, and across 44 meta teams the fill
    rate went ~5% → **61%**.

    **MAINTAINER RULING 2026-08-18: enforcement stays OFF, and a note/flag is
    sufficient.** *"Only if we're 100% certain to track ALL concerto gains
    CORRECTLY, we can move towards making an Outro Skill illegal."* So the bar
    for flipping it is completeness, not the DPS cost — which is measured at
    **8.2% mean team DPS** across those 44 teams, and is not the blocker. What
    is: 39% of swaps are still short, and only some of that is real. Chisa's is
    verified in game; Youhu (26 shortfalls) and Iuno (22) top the list and are
    unexamined. Until each shortfall traces to a mechanic rather than to a hole,
    gating would trade one fiction for another.

    Also unresolved, and smaller: **27 flat grants attach by POSITION.** The
    game writes a BARE row when a node has one grant and prefixes it only to
    disambiguate a multi-stage node, so a bare row on a multi-row node has no
    name to match and lands on the node's first damage row — the same rail the
    Cost/Cooldown folds already use. 23 of the 27 land on a key the resonator's
    own curated rotation actually casts; **4 do not** and silently under-credit:
    Lucilla `liberation_clear_as_day` +20 (she casts `liberation`), Brant
    `skill` +10 (casts `skill_plunging_attack`), Verina
    `forte_heavy_heavy_attack_starflower_blooms_damage` +12 (casts the mid-air
    variants), Lucy `basic_basic_attack_1` +8 (casts stages 2–4). No single
    heuristic fixes all four — Brant's grant is already on the node's base key
    and his rotation uses a variant, Lucilla's is the reverse.

    **Leading hypothesis (maintainer, 2026-08-18): these are STATE edge cases**,
    not parser noise — the same shape as the mode/stance splits elsewhere in the
    roster. All four resonators have a state or form that changes which key a
    node actually casts (Lucilla's two Resonance Modes, Brant's plunging branch,
    Verina's ground-vs-mid-air Starflower, Lucy's chain entry), so a bare row may
    well be correct for ONE state and wrong for the one the curated rotation
    happens to use. That makes it a state-modelling question (item 22), not a
    linking question, and it wants a per-resonator check before any rule moves.

36. **Per-resonator SPECIAL RESOURCES are the real remaining gauge gap**
    (maintainer, 2026-08-18 — *"where's probably more room for improvement is
    each resonator's special resource management, some even have multiple
    ones"*). Counted: `RESOURCE_DEFS` curates **3 of 56** resonators (Changli,
    Denia, Sigrika), while the game ships `specialEnergyCaps` for **all 56**,
    every one of them with several channels. That is the lane behind the
    concrete misses already logged elsewhere in this file — Chisa's Ring of
    Chainsaw driving Sawring - Eradication's +1.30%-per-point multiplier (2g),
    and Denia's Dark Core ladder, which only works because she IS one of the
    three.

    NOT the same thing as Resonance energy, which is fine: the per-hit
    `damage[*].energy` vector is read on every node type (3,557 points
    roster-wide), and no `"<name> Energy Regen"` meta-row exists anywhere on the
    roster — the energy meta-rows the game writes are Costs, already read. An
    earlier draft of this item claimed energy had the same Intro-shaped hole as
    Concerto; it does not (maintainer-corrected, then counted).

## Doc hygiene (minor, mostly already fixed)

- README "Project layout" + false "Echo grading ✓" claim — already corrected.
- `MANUAL_NOTES(To-Do).md` still shows a few stale checkmarks.
- Echo Panel footer renders `"SUBSTATS"` vs the handoff's `"TOTAL SUBSTATS"`.
