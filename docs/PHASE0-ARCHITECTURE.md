# Phase 0 — Architecture Spec (Precompute ↔ Runtime)

This document is the foundation for the next arc of work (P11–P13). It defines
the contract between the **offline precompute pipeline** and the **runtime app**,
the **reference-build / breakpoint / weight** model the optimizer rests on, the
`wuwa-meta.json` schema, and the validation-report format. Later phase specs
cite this document rather than re-deriving these decisions.

It is a *specification*, not an implementation. No code is written here.

---

## 1. The core idea

The app must deliver two things that are normally in tension:

- **Optimized defaults & suggestions** tailored per character / team / rotation / echo.
- **Maximum user agency** — the user can change anything and still get correct numbers.

We resolve this with a **precompute pipeline**, mirroring the existing
`preprocess.mjs → wuwa-data.json` flow:

```
  (offline, once per major patch, on the maintainer's machine)
  tools/optimize.mjs  ──reads──▶  wuwa-data.json + the runtime sim engine
        │
        ├─ runs the FULL sim (P8–P10 engine) at defined reference points
        ├─ sweeps stats to find breakpoints + local gradients (weights)
        │
        ├──emits──▶  data/wuwa-meta.json        (committed, read at runtime)
        └──emits──▶  docs/meta-validation.md     (human-readable QA report)

  (runtime, every page load)
  app reads wuwa-meta.json  ──▶  shows breakpoints, stat weights, suggestions
        │
        └─ if the user's character/team/sequence is NOT covered by meta:
             show "no suggestion available" + run the LIVE runtime sim on
             the user's actual slotted data. The runtime sim stays first-class.
```

The expensive search (finding breakpoints and gradients) is frozen offline. The
cheap application (ranking *this user's* substats against frozen weights) stays
live, so personalization survives. Compute budget for a full regeneration:
**hours are acceptable** — correctness and clarity have absolute priority over
pipeline speed.

---

## 2. Why "weights", not "frozen answers"

A marginal weight — "what is +1% Crit Rate worth?" — is only meaningful relative
to a fixed context (current crit, ATK, which buffs are up, ER level). So the
precompute does NOT emit "Carlotta = CR/CD/ATK%" as universal truth. It emits the
**local gradient of total damage with respect to each stat, anchored at a defined
reference scenario**, computed by running the full sim at the anchor and
perturbing one stat at a time to read the slope.

Crucially: **every conditional (Energy Regen, Concerto, Outro/Intro, buffs,
passives, resonance chain) is accounted for automatically**, because the sim
already models them (P8–P10). They are not separately hand-weighted — they fall
out of the simulation at the reference point. This is the payoff of building the
engine before the optimizer.

Linear weights are an excellent approximation **near** the anchor (where
optimized builds live) and drift as the build moves away. The app must present
weights as "accurate for a well-invested build", never as globally exact.

---

## 3. Two kinds of optimizer output

Stat value is not always a smooth gradient. Some stats have a **cliff**. The
optimizer therefore emits two distinct finding types:

### 3a. Breakpoints (gates / thresholds)

A value a stat must **reach** before other stats matter. Detected by sweeping the
stat upward and watching for a change in rotation behavior.

- **Energy Regen breakpoint** — the minimum total ER at which the reference
  rotation's Resonance Liberation is available *when the rotation needs it*.
  Below it, ER is the highest-priority stat (the rotation doesn't function);
  at/above it, ER's marginal value collapses toward zero.
- **Reported value = empirical minimum + ~5% safety margin.** The sim finds the
  bare cliff; the tool reports the cliff **plus padding** so the rotation
  tolerates imperfect human timing (misclicks, non-frame-perfect play). A
  calculator that demands perfect execution gives unusable advice.
- **Edge cases handled for free.** Characters whose kit *scales* with ER
  (e.g. Mornye) show no cliff on the sweep, so ER keeps a positive weight past
  the usual breakpoint — the empirical method needs no special-casing.
- **Character-specific conditional thresholds** — kit-defined gates from Inherent
  Skills / Resonance Chain / Forte (illustrative, not a real game value: "if DEF
  reaches 1000, gain 15% Crit Rate"). Detected the same way: sweep the stat,
  detect where a conditional flips on.

### 3b. Marginal weights (smooth gradients)

Computed **at or above** the breakpoint, for everything else: Crit Rate, Crit
DMG, ATK% (or the character's scaling stat), and the DMG-type bonuses relevant to
the kit (Basic / Heavy / Resonance Skill / Resonance Liberation / Echo / etc.).

### The UI story this produces

> **First** reach ~125% ER (breakpoint). **Then** prioritize
> Crit Rate > Liberation DMG > Crit DMG > ATK% (weights).

This is exactly how good guides phrase advice — which is why it should validate
cleanly against community sites (§7).

---

## 4. The reference scenario (the anchor)

Weights and character-level breakpoints are computed at a defined anchor. The
anchor for each resonator consists of:

- **Reference rotation** — the character's *default rotation* derived from their
  skill set. This is the SAME artifact the build page needs ("a default rotation
  based on the resonator's skill set"), so the two features share it. Defined
  once, reused.
- **Sequence level** — computed **per Resonance Chain level S0–S6, individually**.
  Each Sx gets its own breakpoints + weights. This is invaluable (it shows the
  user what each sequence investment is worth) and honest (a flat-multiplier
  sequence like Carlotta S2 won't move stat weights; a crit-granting sequence
  will).
- **Conditional baseline** — effects resolve via the unified **trigger × window**
  model (`P11-ADDENDUM.md §A`): unconditional effects always on; triggered
  effects open their timed/state-bound window when the reference rotation fires
  the trigger; unresolvable triggers are conservatively OFF (and flagged by the
  pre-P12 data-quality audit). No blanket "assume active" — weights therefore
  reflect *realistic uptime* over the reference rotation, and the anchor is
  consistent with what both sims show users.
- **Fixed template stat-set** — a per-resonator template echo main/sub stat
  spread (or a blank, ER-only spread) **held constant** across iterations. This
  bounds the search space and makes the sweep tractable.
- **Sonata varies** — even with the template fixed, different Sonata sets are
  computed, since set effects interact with the kit.

---

## 5. ER breakpoint is a TEAM property — resolution

The ER breakpoint "differs slightly between combinations" — it depends on how
teammates feed energy and how the rotation interleaves. But stat weights anchor
on a single-character reference build. These are in tension. **Resolution
(agreed): hybrid.**

- **Character-level default ER breakpoint** — computed solo at the reference
  build, shown on the standalone build page. Errs slightly conservative (safe
  for most teams).
- **Team-level ER breakpoint override** — computed per enumerated team
  combination; overrides the character-level value when the character is placed
  in a simulated team.

**Phasing:** ship the character-level breakpoint first (**P12**); add the
team-level override when team simulation/suggestions land (**P13**). Each phase
stays independently shippable; the team-coupling complexity is deferred to the
phase that is already about teams.

---

## 6. `wuwa-meta.json` schema (draft)

Separate file from `wuwa-data.json` — different cadence, different concerns; can
be regenerated without re-pulling raw data. Versioned so the runtime can detect
a stale/incompatible meta file and fall back gracefully.

```jsonc
{
  "metaVersion": 1,
  "gameVersion": "x.y",            // the patch this was computed against
  "generatedAt": "ISO-8601",
  "engineHash": "…",               // identifies the sim engine build used

  "characters": {
    "1107": {                       // resonator id
      "referenceRotation": ["skill", "skill_chromatic_splendor", "..."],
      "templateStats": { /* the fixed echo main/sub set used as anchor */ },

      "bySequence": {
        "0": {                      // S0; keys "0".."6"
          "bySonata": {
            "<sonataSetId>": {
              "erBreakpoint": {
                "minViable": 1.18,  // fraction (118%)
                "recommended": 1.23,// minViable + ~5% margin
                "scalesWithEr": false   // true for Mornye-type kits (no cliff)
              },
              "conditionalThresholds": [
                { "stat": "def", "value": 1000, "unlocks": "critRate +0.15",
                  "source": "inherent" }
              ],
              "weights": {
                // marginal Δdamage per +1 unit of each stat, at the anchor.
                // Unit convention documented in the tool; suggest "per +1%".
                "critRate":      123.4,
                "critDmg":        88.1,
                "atkRatio":       40.2,
                "dmgBonus.liberation": 76.5,
                "dmgBonus.skill":      31.0,
                "energyRegen":          2.1   // ~0 above breakpoint, high below
              },
              "priorityOrder": ["energyRegen(until 1.23)", "critRate",
                                "dmgBonus.liberation", "critDmg", "atkRatio"]
            }
          }
        }
        // … "1" … "6"
      }
    }
    // … other covered resonators
  },

  "teams": {
    // P13: enumerated team combinations with team-level ER overrides + synergy.
    // Shape TBD in the P13 spec; reserved here so the schema is forward-compatible.
  }
}
```

Runtime contract:
- If `characters[id].bySequence[seq].bySonata[set]` exists → show its
  breakpoints, weights, priority order.
- If it does NOT exist (new character, uncomputed sequence/sonata) → show
  **"no suggestion available"** and run the **live runtime sim** on the user's
  actual slotted data. Never block on missing meta.

---

## 7. Validation report (first-class output)

The precompute tool emits `docs/meta-validation.md` alongside the JSON — a
human-readable, per-character summary the maintainer can eyeball against guide
sites (e.g. prydwen.gg) in ~10 minutes per patch, not an afternoon.

Per character, per sequence (at least S0 and S6), it should print:
- the derived **ER breakpoint** (min-viable and recommended),
- the **stat priority order** in plain language,
- the **top 3–4 weights** with their relative magnitudes,
- any **conditional thresholds** detected,
- a **flag** when the derived order diverges from a simple expectation (so the
  maintainer's eye is drawn to the entries most worth checking).

Format: compact tables/prose a human reads top-to-bottom. This is a QA artifact,
not a data file.

---

## 8. Phase breakdown (agreed ordering)

Each phase is independently shippable and cites this document.

### P11 — Visualization + UX
Makes the sim *legible* — prerequisite for trusting optimizer output.
- Team sim: **per-character columns**; per-step damage (collapsible / expandable
  + hover tooltips) replacing the 3-bucket rotation/intro/outro lump; damage
  **color-coded by type** (Basic / Heavy / Resonance Skill / Resonance Liberation
  / Echo / Intro / Outro); **inline rotation editing** on this screen; a separate
  **buff/effect timeline bar**.
- Off-field / coordinated damage **folds into the skill type named in its
  description** (first priority) **or its origin skill type**.
- Build sim: the **buff/effect bar**; **constructive conditional/unlock guidance**
  (flag e.g. Basic Stage 3 before Stage 2, and make the valid next action easy to
  pick — extends P10 `validateRotation` to intra-skill stage ordering);
  **auto-inserted triggered actions** — when an action auto-triggers another, the
  sim inserts it as a **visible, editable** real step (option a), with clear
  undo.
- UX friction: clickable/toggleable controls instead of dropdowns where it
  reduces clicks (e.g. echo stats); minimize click-paths generally.
- Readability fixes (e.g. Sonata display is currently cramped/unreadable).

### P12 — Stat-weight + breakpoint optimizer
- `tools/optimize.mjs` precompute → `data/wuwa-meta.json` (§6) +
  `docs/meta-validation.md` (§7).
- Per resonator × S0–S6 × Sonata: ER breakpoint (min + 5% margin),
  character-specific conditional thresholds, marginal weights, priority order.
- Runtime: build page shows **character-level** breakpoint + stat priority;
  "no suggestion available" + live sim fallback for uncovered cases.

### P13 — Team suggestions + team-level ER
- Enumerated team synergy (Tune Break interactions, buff sharing, etc.) computed
  offline; stored as synergy scores / marginal contributions (so a one-member
  swap still re-ranks sensibly), not frozen team lists.
- **Team-level ER breakpoint override** (§5) replaces the character-level default
  when a character is placed in a simulated team.
- Build page: "suggested teams for this character" + "teams this character
  already appears in"; up to **3 team setups compared side by side**.

### Out of scope (all phases)
- **Enemy count** — simulation is always against a **single enemy**.

### Separate track — UI design workflow
A process for the maintainer to design the UI themselves (e.g. Figma), delivered
as a step-by-step workflow rather than a Claude Code build spec. Produced
independently of P11–P13.

---

## 9. Open items to resolve inside each phase spec

**Status (2026-07-10 audit): superseded — P11, P12, and P13 are all complete,
and each item below was resolved during its phase. Kept for historical
record.**

- ~~P11: exact tooltip contents; how the buff bar represents overlapping windows;
  undo model for auto-inserted steps.~~ Resolved — `src/ui/tooltip.js` +
  `buff-bar.js`'s lane-packing algorithm; auto-inserted steps get a
  dismissible notice (`rotation-triggers.js`).
- ~~P12: weight unit convention ("per +1%" vs normalized); how `templateStats` is
  chosen per resonator; sweep granularity for breakpoint detection.~~ Resolved —
  see `tools/optimize/weights.js`, `tools/optimize/reference-build.js`,
  `tools/optimize/breakpoints.js`.
- ~~P13: team enumeration strategy (all combinations is large — likely seeded by
  curated synergy hints, then sim-validated, matching the original (c)→(a)
  intuition); synergy-score schema under `teams` in §6.~~ Resolved exactly as
  anticipated — see `tools/optimize/synergy-hints.js`, `team-enum.js`,
  `team-rank.js`, and `meta.teams` in `data/wuwa-meta.json`.
