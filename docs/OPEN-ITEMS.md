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
26. **The game's ConfigDB is readable and largely unused.** ~500 config tables
    ship with the client alongside per-table JS accessors that give exact field
    names/offsets/types; `tools/extract/configdb.py` reads any of them. Our four
    `data/bindata/*.json` dumps are four of those tables. Named leads: chain
    node -> buff -> effect semantics (would retire the kit-text stack-cap and
    gain-trigger regexes), `db_PassiveSkill`'s structured
    TriggerType/SkillAction, and gauge INCOME for named stack gauges. See
    `docs/CONFIGDB-RECON.md`.
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
    → Ciaccona's "Green Tonic" clause attaches to both her Liberation and its
      tonic sub-move; one of the two is one application too many.
    → Luuk's Aureole of Execution is described inside his Basic Attack section
      and so is missed — 3 casts of his reference rotation under-apply.
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

    | 1 pass, their rotation | 2026-08-03 | 2026-08-07 | Arabwuwa | ratio now |
    | --- | --- | --- | --- | --- |
    | Chisa (leads, receives nothing) | — | 127,180 | 174,451 | 1.37x |
    | Denia | — | 223,246 | 389,281 | 1.74x |
    | Aemeath | 588,668 | 821,634 | 1,521,562 | 1.85x |
    | team | 802,196 | 1,157,011 | 2,085,294 | 1.80x |
    | rotation time | 27.9s game | 30.07s | 27.34s | 1.10x |

    An independent, stat-free anchor agrees that solo is close: our Tune Break
    for Aemeath is 62,689, computed from the game's own LevelModifier with no
    ATK, crit or gear input, and Arabwuwa's character page puts Tune Break at
    11.90% of a solo Aemeath rotation → ~527k for their solo, against our 462,901
    on the same rotation (**1.14x**). Their stated build target (ATK 2050–2100,
    CR 73–78%, CD 270–275%) is LOWER than ours, so stats are ruled out from both
    sides.
    **Next:** Chisa's own 1.37x is now the floor, and it is per-character rather
    than global — reconcile one of her casts end to end. Above that, the residual
    team-lane gap is most likely the 9 clauses the coverage guardrail lists as
    deliberately unread (`tests/effect-coverage.test.mjs`) plus the deferred
    entries in `effect-overrides.json`, both of which are now enumerated instead
    of invisible.

    Two of those rows are the finding. **Timing agrees to 2%** and **the damage
    SHARE across three different kits agrees to 0.4%**, while every member is low
    by the same 2.6x. A missing per-kit mechanic — S1, S3's residue, Tune Break —
    would show up as an Aemeath-shaped hole, not as an even scaling of all three.
    So the primary cause is a GLOBAL factor in the damage path, and the per-kit
    items below are second-order until it is found.
    Ruled out already: enemy DEF (our `defMult` at level 100 is 0.497, the
    standard curve, and switching targets cost exactly the 0.81x observed), skill
    levels (default build is level 90 with all skills at 10), and stat-node /
    inherent unlocks (both default to all-true, not off as first suspected).
    Prydwen and Arabwuwa independently agree on ~1.5M for Aemeath's rotation
    (128,145 vs 123,403 DPS), so the reference is not one site's error.
    **Next:** compare ONE cast end to end — pick a single Aemeath step, print our
    base multiplier, hit count, ATK, crit and every bucket, and reconcile it by
    hand against the in-game tooltip. A uniform factor will show up in that one
    number, and per-cast reconciliation is the only way to see which.
    → **Their rotation has not been run.** Arabwuwa ship a step-by-step rotation
      for all three members, but its names ("Tune Break", "Forte Skill", "Hold
      Basic to hit Basic 1, 2, 3") need mapping to our skill keys. Deliberately
      not guessed: a benchmark resting on an invented mapping is worse than no
      benchmark. Mapping it is the highest-value next step, because it removes
      rotation choice as a variable from the 2.36x gap.
    → ~~**19 Echo-only labels** still read "Basic Attack (Echo): …".~~
      **CLOSED 2026-08-03.** Provenance is now a trailing marker in ALL cases,
      not only where the game's own name took the prefix: `categoryPrefix` no
      longer folds anything into the category. "Forte Circuit (Echo)" read as
      "an Echo kind of Forte Circuit", the same backwards qualifier the Forte
      half of this purge removed. 25 labels carry a `· Echo` marker (7 of them
      `· Forte Circuit · Echo`), zero carry a parenthetical, and labels stay
      unique per resonator — which is why the marker cannot simply be dropped.

## Team / meta correctness

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

## Doc hygiene (minor, mostly already fixed)

- README "Project layout" + false "Echo grading ✓" claim — already corrected.
- `MANUAL_NOTES(To-Do).md` still shows a few stale checkmarks.
- Echo Panel footer renders `"SUBSTATS"` vs the handoff's `"TOTAL SUBSTATS"`.
