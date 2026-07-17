# Auto-Optimizer Engine — Plan (P13+)

**Status:** Phase A + C **SHIPPED** (2026-06-28). B/D/E remain planned; Phase D is
folded into the P13 arc (see §6). Supersedes the ad-hoc conditional-buff work
landed in P12-fix.

## This-round result (A + C shipped)

- **Stack ramp/uptime (A):** sonata stacking buffs now ramp per-step (0→1→…→cap)
  and decay via `src/core/buff-timeline.js`; a multi-trigger buff (e.g. Freezing
  Frost "Basic OR Heavy") is grouped into ONE window over the union of triggers,
  fixing a latent **double-count** (two windows each crediting full stacks). On
  Hiyuki, Freezing Frost dropped from an inflated flat ≈+60% to a correct ramped
  +10→30%.
- **Substat co-optimization (C):** `src/core/substat-allocate.js` greedily
  allocates each candidate's roll budget by live marginal value, so a set is
  compared at ITS optimized substats. Wishes correctly receives a **CR-light**
  allocation (4 CR rolls vs Freezing Frost's 8) because it provides +25% CR.
- **Honest outcome (not forced):** fair solo numbers (Hiyuki) — Freezing Frost
  940.7k vs **Wishes 897.0k** (~4.6% gap), Frosty Resolve 887.8k. Wishes still
  loses *solo*; its real edge is off-field/outro **team** synergy, which is
  **P13 (Phase D)** and deliberately unmodeled here. Forcing Wishes to win solo
  would require fabricating team mechanics — rejected per the conservative rule.

The original roadmap follows.

---

## 0. The end goal

> Paste a resonator's (essay-long) kit and get an **optimal, fully-wired setup**:
> rotation · team comp · weapon · main echo · sonata · substat targets — with
> every trigger, conditional, stack, resource, and uptime modeled correctly.

Everything below is in service of that. We get there by replacing today's
shortcuts (full-uptime / full-stacks / fixed-template / always-on conditionals)
with a single timeline-driven buff engine, then layering resources, substat
co-optimization, and team modeling on top, and finally a search that consumes all
of it.

---

## 1. Why now — the motivating bug

Suggested sonata for Hiyuki came out **Freezing Frost** over **Wishes of Quiet
Snowfall**, which is wrong for her in practice. Dissecting it surfaced TWO real
modeling errors, both of which this plan fixes:

| symptom | cause |
| --- | --- |
| Wishes' +25% Crit Rate barely helps | **CR cap.** The fixed anchor template already builds CR to ~93–100%; a set that *provides* CR has nothing to give it. Fair comparison needs the build **tuned per set** (§4 co-optimization). |
| Freezing Frost's "+10% Glacio ×3 stacks" credited as a flat +30% for the whole rotation | **Full-stack, full-uptime.** It actually ramps (1→2→3 over Basic/Heavy casts) and decays after each stack's duration. Needs a **timeline** (§3). |

Confirmed numbers (Hiyuki, Frostburn, template anchor): Freezing Frost 807k vs
Wishes 588k; with a CR-light build Wishes rises to 1108k but Freezing Frost (fair
CR) is still 1418k — i.e. **both** the cap and the stack over-credit must be
fixed, neither alone is enough.

---

## 2. Where we are today (post P12-fix)

Already modeled (keep): unified trigger × window effect resolution; "considered
as X DMG" reclassification; curated kit-faithful rotations; per-roll stat
priority; **live** per-build perturbation (live-weights.js); suggested-build
search (sonata × weapon); triggerability gating (status conditions);
conditional weapon + sonata buffs (conditional-buffs.js); unclassified-buff
guard; energy trace (P11.5).

Known shortcuts this plan removes:

- **S1 — full uptime / full stacks.** Sonata DMG buffs apply at max stacks for
  the whole trigger window; conditional weapon/sonata buffs (ATK/crit/amplify)
  apply always-on via resolveTotalStats. No ramp, no decay, no real uptime.
- **S2 — fixed template.** Every sonata/weapon is compared at ONE substat spread,
  so sets are penalised for providing stats the template already maxed (CR cap).
- **S3 — no resources.** Substance / Forte gauge / Concerto / stack gauges
  (Enflamement, Incandescence) don't gate skills or buffs; resource-scaled nukes
  (Jinhsi Incandescence, Changli Enflamement) are under/mis-modeled.
- **S4 — no team.** Off-field energy (the 50% rule), outro→incoming buffs,
  team-wide buffs, coordinated attacks, quickswap — none modeled. (Wishes' real
  edge for Hiyuki is largely team/outro synergy.)

---

## 3. Phase A — Unified buff-timeline engine (the foundation)

Replace the split model (computeBuffWindows for sonata DMG + resolveTotalStats
always-on for conditional stat) with ONE per-step buff-state simulation.

### A.1 BuffSpec — one normalized shape for every buff source

```js
// Produced by parsers for sonata tiers, weapon effects, chain/inherent effects,
// outro buffs. The timeline engine consumes ONLY this.
{
  id,                    // stable key (source + clause index) for stack grouping
  source,                // 'sonata' | 'weapon' | 'chain' | 'inherent' | 'outro'
  trigger: {             // when a stack is gained
    kind,                // 'castType'(basic/heavy/skill/lib/intro) | 'status' | 'always' | 'onHit' | 'resource'
    castType?, status?,  // payload by kind
  },
  gate?: { status },     // triggerability precondition (Glacio Chafe, …) — §A.5
  effect: {
    bucket,              // 'atkRatio'|'critRate'|'critDmg'|'dmgElement'|'dmgType'|'amplifyElement'|'amplifyType'|'defIgnore'|...
    key?,                // elementId or skillType for the *-Element / *-Type buckets
    perStack,            // value added per active stack (fraction)
  },
  maxStacks,             // cap (default 1)
  stackPerTrigger,       // default 1
  duration,              // seconds a stack lives; null = whole window / refreshed
}
```

The existing parsers (sonata-buffs.js, conditional-buffs.js, buffs.js) are
refactored to **emit BuffSpecs** instead of their bespoke shapes. This unifies
weapon + sonata + chain/inherent + outro into one path (kills S1's split).

### A.2 Stack timeline

For each BuffSpec, walk the rotation's step times (already available via
computeStepTimes):

- On a step whose action matches `trigger` (and `gate` is satisfiable, §A.5),
  push a stack timestamp; cap concurrent stacks at `maxStacks`.
- A stack is **active** at time `t` if `t ∈ (gained, gained + duration]`.
- `status`/`always` triggers with no duration → active for the whole window once
  first reachable.

`activeStacks(spec, t)` = min(maxStacks, count of live stacks at `t`). This gives
ramp (early steps see fewer stacks) and decay (stacks expire) for free.

### A.3 Per-step stat resolution

Split resolveTotalStats into:

- `staticStats(build, dataset)` — resonator base, weapon base/sub, echo mains +
  substats, skill-tree, sonata 2pc AddProp, weapon **unconditional** leading
  stat. Computed once.
- `stepStats(staticStats, activeBuffsAtStep)` — folds the conditional buffs
  active at this step (ATK%, Crit, DMG-bonus, amplify, DEF-ignore) onto the
  static base. Crit is **clamped at the stat level** so CR cap is respected
  per step.

The damage of a step uses `stepStats` + the step's amplify scopes. This is the
one genuinely invasive change: damage becomes a function of per-step stats, not a
single resolved stat block. (Live-weights perturbation re-runs the sim, so it
automatically picks this up.)

### A.4 Uptime-weighted credit

A buff's contribution to a step is `perStack × activeStacks(spec, step.start)`.
No separate "uptime fraction" needed — it falls out of the timeline. The flat
+30% Freezing Frost over-credit disappears: early steps get +10/+20%, and any
gap beyond a stack's duration gets 0.

### A.5 Gating stays

Triggerability (triggerability.js) is reused as the `gate` check. A status-gated
spec on a non-inflicting resonator never gains a stack. (Carlotta's Glacio-Chafe
sets stay correctly worth 0.)

### A.6 Compatibility / risk

- `sim.buffWindows` is consumed by the buff-bar UI + tests. Keep emitting a
  windows view DERIVED from the timeline (start/end/stacks per active span) so
  the UI/tests don't break; the damage path uses the timeline directly.
- Validate against calibration + the existing buff/rotation tests; expect damage
  numbers to DROP for stacking/low-uptime buffs (correct), so re-baseline any
  exact-value assertions deliberately.

**Deliverable:** `src/core/buff-timeline.js` + refactors to stats.js/sim.js;
tests for ramp/decay/cap/gating; calibration re-baselined.

---

## 4. Phase C — Substat co-optimization (fair set comparison)

> Chosen as part of the first build (with §3). This is what actually flips
> Wishes → best for Hiyuki.

Stop comparing every sonata/weapon at one fixed template. For each candidate
(sonata × weapon × rotation × main-stat layout):

1. Start from the fixed **main** stats (4/3/3/1/1) + the set/weapon's provided
   stats (incl. conditional, at modeled uptime).
2. **Allocate the substat-roll budget** (e.g. 25 rolls) greedily by **live
   marginal value** (reuse live-weights.js `liveSubstatValues`): repeatedly add
   the roll with the highest current marginal damage, re-evaluating after each
   (so CR stops being added once it nears the cap, ER stops at its target, etc.).
   Respect per-substat roll caps + the cost layout.
3. Compare candidates at THEIR optimized substats.

This makes a CR-providing set (Wishes) get a CR-light roll allocation, so its CR
isn't wasted — the comparison becomes apples-to-apples. The optimized substat
target also becomes the **suggested substat goal** shown in the echo editor.

**Deliverable:** `tools/optimize/substat-allocate.js` (greedy marginal
allocator, shared core in src/core/ for runtime "suggested substats");
suggested-build search uses it; meta stores per-candidate optimized substat
targets. Re-validate the seed picks (expect Hiyuki → Wishes).

Open question: greedy marginal vs small combinatorial search — start greedy
(fast, good enough), measure against a brute-force spot-check.

---

## 5. Phase B — Resources & gauges (after A/C)

Model the gauges that gate skills and buffs, accumulated/consumed per step along
the rotation:

- Energy (have the trace already) → Liberation availability.
- Forte / Substance / Concerto / kit-specific stacks (Enflamement, Incandescence,
  Moldable Crystals, Trance/Shiver…).
- Skills that require a resource become castable only when the timeline has
  accumulated it; resource-scaled effects (Incandescence-empowered Forte nuke)
  read the gauge level.

Ties Phase A triggers of `kind:'resource'` to real gauge state. Makes Jinhsi /
Changli / Carlotta rotations mechanically honest. Needs per-resonator gauge
definitions (curated, like ROTATION_RULES / reference-rotations).

**Deliverable:** `src/core/resources.js` + per-resonator gauge specs; rotation
validation + buff triggers consult gauges.

---

## 6. Phase D — Team modeling (= P13)

> **Boundary call (2026-06-28, maintainer-directed "combine & defer"):** Phase D
> *is* the P13-Set arc CLAUDE.md already names (team suggestions + team-level ER
> override). It is **deferred to P13 in full** — not built this round. The
> energy-as-resource half of Phase B (off-field generation, swap-in energy) also
> belongs here and is deferred with it; only self-contained single-resonator gauge
> gating stays in Phase B. Phase E (capstone) lands after P13 by definition.

- Off-field energy: the documented 50%-of-active rule, scaled by the off-field
  unit's own ER (docs/energy-signal-findings.md).
- Outro → incoming buffs (already parsed as outro buffs) applied to the next unit.
- Team-wide buffs, coordinated attacks, quickswap timing.
- Enables: team-comp suggestions, a true ER breakpoint (P12's deferred item),
  and the team-dependent set value (Wishes' outro synergy → its real edge).

**Deliverable:** team-timeline that sequences members' rotations; team-sim.js
consumes it.

---

## 7. Phase E — Kit → optimal build (the capstone)

Search/compose over rotation × sonata × weapon × echo mains × substat targets ×
team, scored by the Phase A–D engine, to present the optimal setup for a pasted
kit. Largely an orchestration + search layer once A–D exist; pruning by
role/element/triggerability keeps the search space small (as the current
suggested-build search already does).

---

## 8. Build order & this-round scope

```
[A] buff-timeline engine (stacks/uptime, conditional stat buffs on timeline)
        └─ [C] substat co-optimization   ← THIS ROUND = A + C
[B] resources/gauges (self-contained gauge gating only; energy-half → P13)
[D] team modeling                        = P13 (deferred in full)
[E] kit → optimal build (capstone)       after P13
```

**This round delivers A + C**, validated by: Freezing Frost's flat +30% becomes
ramped; Wishes (with a CR-light optimized build) becomes Hiyuki's suggested set;
calibration re-baselined; live echo-editor "suggested substats" now reflect the
co-optimized target. B, D, E follow in sequence.

---

## 9. Invariants to preserve (do not regress)

- `build.rotation` stays linear; the timeline is a sim-time-only view.
- "Considered as X DMG" formulaType reclassification (the bonus bucket).
- Triggerability gating semantics (status conditions).
- Live-weights stays a re-run of the real sim (no parallel damage math).
- `sim.buffWindows` keeps a UI-compatible shape (derive from the timeline).
- Conservative-over-aggressive: an unclassifiable/unmodelable clause contributes
  0, never a flat global multiplier.

## 10. Test strategy

- Unit: timeline ramp/decay/cap/gate; per-step stat resolution; greedy substat
  allocator (incl. CR-cap stop, ER-target stop).
- Real-data: the seed six end-to-end; assert the corrected Hiyuki sonata + the
  Freezing-Frost ramp; re-baseline calibration deliberately with documented
  expected shifts.
- Regression: full 34-file suite + module sweep green before/after each phase.
