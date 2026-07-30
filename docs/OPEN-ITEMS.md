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
   `ECHO_CAST_TIME = 1.20`, the engine's last fabricated timing constant, needs
   a **Monster**-tree export the `Role/` extraction never covered (item #23);
   character state modelling (item #22); per-bullet time dilation
   (`时间膨胀`) is deliberately out of scope — it is hitstop and enemy-only
   locks, and stops no player cooldown.

2. **Non-energy resource-gauge engine** (Forte / Substance / Concerto-class
   stack gauges). Forte-gauge modeling for *openers* shipped (2026-07-11), but
   there is no engine that resolves **gauge-level-scaled buffs/damage**. This
   single feature unlocks, together: Changli IH0/IH1 (Enflamement stacks — also
   has a wrong extracted value), Hiyuki Snow Rust (S3.1/S6.0/S6.1, multi-source
   gauge), Lynae Lumiflow, Tune Break wiring (#7), and multi-gauge kits (chars
   using two channels, e.g. Galbrena). Named future work.

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
    imposes, plus its unmodelled multi-hit transformed sequence. Not an
    extension of the roster pipeline — echo animations live in the **Monster**
    asset tree, not the `Role/` tree that was walked, so it needs a second
    export and a second join. Parallel (Summon / direct-attack) echoes are
    unaffected: they cost 0, which is exact.
24. **AUTO-OPTIMIZER Phase E** — the capstone "kit → optimal build" search. Not
    started ("lands after P13 by definition").

## Doc hygiene (minor, mostly already fixed)

- README "Project layout" + false "Echo grading ✓" claim — already corrected.
- `MANUAL_NOTES(To-Do).md` still shows a few stale checkmarks.
- Echo Panel footer renders `"SUBSTATS"` vs the handoff's `"TOTAL SUBSTATS"`.