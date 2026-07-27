# OPEN-ITEMS — WuWaSim backlog snapshot

**Compiled 2026-07-23** from a sweep of the tracked `docs/` set, `docs-local/`,
and cross-checked against current code. Supersedes the point-in-time
`Status-Report-07-10.md` audit (which is partly stale — items it flagged as
"doc hygiene" in README were already fixed by the time of this snapshot).

**P1–P13 are all shipped.** The 2026-07-10 → 07-23 window was UI polish + the
Simplification Plan (S1–S5) + the timing-model schema + a dataset refresh.
Everything below is what remains. Ordering within a section is not priority.

---

## Two root-cause engine gaps (each unlocks several downstream items)

1. **Cast-time / timing realism.** Cast times are *fabricated* (per-type
   estimates); measured frame-count timings are not obtainable. Root cause
   behind the Forte payoff being only "opportunistic"
   (`forte-modeling-investigation.md`) and the team-buff timeline honestly
   under-crediting supports whose buffs expire before the opener-inflated burst
   (`TEAM-BUFF-TIMELINE-PLAN.md`).
   → **Increment 1 SHIPPED (2026-07-24):** pivoted from frame extraction to a
   mechanical rule-based model. (a) A Resonance Liberation freezes the in-game
   clock for its whole animation — cooldowns AND buff/effect/state durations
   pause, and the DPS denominator (gameTime) excludes it; **only the cinematic
   cast freezes** (energy ultimate's resource-consuming opener), so multi-step
   liberations (Carlotta's Death Knells) and non-energy liberation-type steps
   (Lucilla/Phrolova, energyMax 0) do NOT freeze; (b) non-transformation echoes
   cast in parallel (zero timeline time). Both driven by confirmed mechanics, no
   fabricated numbers, no-op for freeze-free rotations. See `TIMING_MODEL.md`
   "Confirmed mechanics".
   → **Increment 2 SHIPPED (2026-07-24):** (a) buff-strip display alignment
   across a Liberation freeze (freeze-aware `stackTimeline` end); (b) echo
   lock/parallel split — **Transform**-prefixed echo descs LOCK (occupy
   `ECHO_CAST_TIME`), **Summon** + direct-attack echoes stay parallel
   (maintainer-verified in-game); (c) fact 5 (switch-cancel + outro) confirmed
   already modeled. Recorded: a manual Tune Break activation also freezes the
   clock (for when Tune Break is wired).
   → **Deferred (optional, later):** a curated "is-cinematic" freeze flag so
   cinematic *finales* (Carlotta's Fatal Finale) and non-energy cinematic casts
   freeze too; the real transform lock DURATION + multi-hit sequence
   (`ECHO_CAST_TIME` under-counts it); hold-button-skill locks (no classifier
   yet). All parked in favour of possibly sourcing real animation/timing data
   elsewhere (maintainer still hopeful, 2026-07-24). Also deferred: `opener.js`
   echo-timing to match the sim; any "collapse instants toward zero" rescale.

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
22. **AUTO-OPTIMIZER Phase E** — the capstone "kit → optimal build" search. Not
    started ("lands after P13 by definition").

## Doc hygiene (minor, mostly already fixed)

- README "Project layout" + false "Echo grading ✓" claim — already corrected.
- `MANUAL_NOTES(To-Do).md` still shows a few stale checkmarks.
- Echo Panel footer renders `"SUBSTATS"` vs the handoff's `"TOTAL SUBSTATS"`.