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
   to a later roster-derived pass; Tune Break — Luuk Herssen, blocked on #7; a
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
    → Buling stays on the fallback: her array inflicts "2 stacks … every 2s,
      lasting for 24s", which is a periodic applier (up to 24 stacks from one
      cast) and needs rules with a period. The fallback's 9 is closer than the
      2 a per-cast reading would give. Rover: Electro's Liberation array is the
      same shape. **This is the next piece of work in this lane.**
    → Ciaccona's "Green Tonic" clause attaches to both her Liberation and its
      tonic sub-move; one of the two is one application too many.
    → Luuk's Aureole of Execution is described inside his Basic Attack section
      and so is missed — 3 casts of his reference rotation under-apply.
    → Rover: Aero's "1 stack for each stack removed" is variable; 1 is the floor.
    → Aemeath, Denia, Mornye, Lynae, Phoebe, Zani, Chisa and Yangyang: Xuanling
      derive nothing and are unchanged.
30. **Aemeath's Fusion Burst re-seed, and stack removal generally**
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
7. **Tune Break** — formula calibrated + tested (`computeTuneBreakDamage`) but
   NOT wired into the live sim. Needs the gauge engine (#2) + a manual
   rotation-step toggle, default OFF.
8. **Echo dupe verification** — no guard against duplicate echoes in the same
   sonata set (`echo-rules.js` only checks duplicate substats).
9. **Echo outro wiring** — Lucilla → Hiyuki (Glammoth) combo, no code exists.
10. **"Forte_X" shows as a damage type** in the donut tooltip — it isn't one.
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
19. **Negative-status calibration** (`TEAM-EFFECT-MODEL.md`) — Fusion Burst &
    Electro Flare stack mults uncalibrated; Spectro Frazzle & Aero Erosion need
    re-verification against the corrected DefMult/ResMult formula.
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

## Doc hygiene (minor, mostly already fixed)

- README "Project layout" + false "Echo grading ✓" claim — already corrected.
- `MANUAL_NOTES(To-Do).md` still shows a few stale checkmarks.
- Echo Panel footer renders `"SUBSTATS"` vs the handoff's `"TOTAL SUBSTATS"`.