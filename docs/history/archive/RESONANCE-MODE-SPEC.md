# Resonance Mode + Tune Break Trigger — Specification

## New build-level mechanic. Amends `P11-ADDENDUM.md §A`, `PHASE0-ARCHITECTURE.md §4`, and `P12-INSTRUCTION-SET.md §2/§4`.

Surfaced by the Aemeath build audit (2026-06): some resonators have **toggleable
Resonance Modes** that gate which effects apply. This is distinct from the P10
state timeline and needs its own model. Rotation is unaffected — modes change
only *which effects resolve*, not which skills are cast.

---

## 1. What a Resonance Mode is (and is not)

A **Resonance Mode** is a **build-level choice** of which combat mode a
mode-having resonator is played in. It gates effect resolution: an effect can
apply only in one mode. It was introduced alongside the Tune Break mechanic.

| | Resonance Mode | State (P10 `STATE_DEFS`) |
|---|---|---|
| Scope | **Build-level** — a committed choice | Rotation-level — entered mid-rotation |
| Set by | A UI toggle on the build page | Casting a skill in the rotation |
| Resolved by | The chosen `build.resonanceMode` | The rotation state timeline |
| Analogy | Like chain level | Like Twilight Tango after Liberation |

**Critical distinction (the Aemeath S6 case):** S6 lists the fixed-80%-Crit /
275%-Crit-DMG effect **twice** — once per mode — because each interacts with
that mode's exclusive mechanic (Tune Rupture normally *cannot* crit; S6 lets it,
but only in the relevant mode). The two copies are **not redundant**; each is
mode-gated, and only the active mode's copy may resolve. A model without modes
would wrongly resolve both (double-counting) or neither.

---

## 2. The verified roster (manually confirmed in-game)

Exactly **two modes each**, no more:

| Resonator | Mode A | Mode B |
| --- | --- | --- |
| Aemeath | Tune Rupture | Fusion Burst |
| Lynae | Tune Rupture | Tune Strain |
| Denia | Fusion Burst | Tune Strain |
| Lucilla | Glacio Chafe | Echo |

All other resonators have **no** Resonance Mode — the mode selector and
mode-gating logic apply only to these four. The mode names are not a fixed
global enum; they are per-character (Tune Rupture/Fusion Burst/Tune Strain/
Glacio Chafe/Echo appear across the four). Store the mode pair per resonator.

**Data sourcing**: confirm whether the dataset carries a structured "Resonance
Mode" field or whether mode names appear only in skill/effect description text.
If structured → project it in `preprocess.mjs`. If text-only → curate a small
table (`tools/resonance-modes.js`) mapping resonatorId → `[modeA, modeB]`,
data-integrity-tested against the dataset (same pattern as `rotation-rules.js`).

---

## 3. Model: the `modeMatch` condition

Extend the unified trigger taxonomy (`P11-ADDENDUM.md §A2`) with one new
condition kind:

| Component | New value | Meaning |
|---|---|---|
| trigger | `modeMatch` | Active only when `build.resonanceMode` equals the effect's `mode` |

An effect carrying `{ trigger: 'modeMatch', mode: 'tune_rupture' }` resolves
active **iff** the build's selected mode is Tune Rupture (and its node is
unlocked, and any *additional* window/state condition it also carries is met —
modeMatch can compose with a window, e.g. "in Tune Rupture, after casting X for
10s").

**Composition rule**: `modeMatch` is a *gate*, not a standalone window. An effect
can be:

- mode-gated only → active whenever in that mode (like unconditional, but
  mode-scoped);
- mode-gated + windowed → active in that mode AND inside the triggered window;
- mode-gated + state-bound → active in that mode AND while the state is active.

Resolution order: check mode gate first (cheap, build-level); if it fails, the
effect is inactive regardless of any other condition. If it passes, evaluate the
remaining window/state condition normally.

### Parser implication

Effects whose condition text references a mode ("In Resonance Mode - Tune
Rupture, …", "While in Fusion Burst, …", "In Tune Strain state, …") must
extract `{ trigger: 'modeMatch', mode: <normalized> }`, composing with any
further condition in the same clause. This is part of the
`PRE-P12-DATA-QUALITY.md` audit — mode-conditional effects are exactly the kind
the Aemeath audit found mishandled, and the override table corrects any the
parser misreads.

---

## 4. Data model

```js
// build.js — createBuild addition (only meaningful for mode-having resonators)
resonanceMode: null,   // null = not applicable / unset; else the chosen mode string

// setter
export function setResonanceMode(build, mode) {
    return touch({ ...build, resonanceMode: mode });
}
```

- For the four mode-having resonators, `resonanceMode` defaults to **mode A**
  (the first in their pair) on build creation, so the sim is meaningful
  immediately rather than requiring a choice.
- For all other resonators, `resonanceMode` stays `null` and is ignored.
- Persisted in the save format (it is a build choice). Migration: existing saved
  builds of mode-having characters load with `resonanceMode = modeA` default.

---

## 5. Resolution (both sims, one path)

The §A resolver gains a mode check at the front of `resolveEffect`:

```
if effect.trigger == 'modeMatch':
    if build.resonanceMode != effect.mode → INACTIVE (stop)
    else → fall through to evaluate any further window/state condition
            (or active-when-unlocked if none)
```

Both the build-page sim and the team sim read `build.resonanceMode` identically
— no mode divergence between sims (consistent with §A collapsing the old
`effectMode` split).

---

## 6. UI — build-page mode selector

- Shown **only** for the four mode-having resonators. Absent for everyone else
  (no empty control cluttering normal build pages).
- A two-option toggle (modes are always a pair — §2), labelled with the
  character's actual mode names. Reuse the `atom/chip` selected/default states
  or the sequence `atom/toggle`; design discretion.
- Placed near the chain/skill controls in the build header (it is a build-level
  choice of the same class as chain level).
- Switching mode re-resolves effects and re-runs the sim immediately. Effects
  gated to the *other* mode flip to Inactive; the active mode's effects resolve.
- The effect badges (§A5) for mode-gated effects should indicate *which* mode
  they belong to on hover ("active in Fusion Burst") so a user understands why a
  line is inactive in their current mode.

---

## 7. Tune Break trigger (scoped, manual)

Tune Break is **player-triggered** in-game (almost like a skill), and its
buildup is **enemy-dependent**. Since enemy type/count is **out of scope**
(`PHASE0-ARCHITECTURE.md` — always a single enemy), we do **not** model the
off-tune buildup per enemy.

**The tractable model**: a **rotation-level "Tune Break fires here" input** — the
player asserts the trigger at a point in the rotation; the sim applies the
consequent state/effects from that point (via the existing state timeline,
`stateEnter`/`stateBound`), without simulating the enemy-dependent buildup that
leads to it.

- Mechanically: a special rotation entry (or a per-step flag) that opens the
  Tune-Break-dependent state, analogous to how casting a skill opens a state in
  P10. The player is asserting "Tune Break happens here"; the sim trusts it.
- This composes with Resonance Mode: Tune-Break-related effects are typically
  *also* mode-gated (Tune Rupture / Tune Strain), so they require both the mode
  and the asserted trigger.
- Explicitly **not** modelled: off-tune accumulation rate, enemy resistance to
  Tune Break, per-enemy buildup thresholds. These are out of scope by the
  single-enemy boundary, and the +5%-style "assert it, don't simulate buildup"
  approach is the deliberate simplification.

This was anticipated in the P10 state work and the energy-check neighbourhood;
this section makes it concrete.

---

## 8. P12 amendment — modes are a new enumeration axis

`PHASE0-ARCHITECTURE.md §4` and `P12-INSTRUCTION-SET.md §2/§4` compute weights per
**sequence × sonata**. For the four mode-having resonators, add **mode** as a
third axis: weights and breakpoints are computed **per (sequence × sonata ×
mode)**, because the two modes play differently and a stat's value can differ
between them (e.g. crit weight is ~zero in a mode that can't crit, but positive
in the mode S6 enables crit for).

- `wuwa-meta.json` schema: for mode-having resonators, nest a `byMode` level
  (or add `mode` to the existing key path) under `bySequence`/`bySonata`. Only
  the four characters get this; others keep the existing shape.
- The validation report (`P12 §6`) lists each mode separately for these four.
- Non-mode characters are unaffected — no `byMode` level, no extra computation.

This is a bounded cost increase: four characters × 2 modes, not a roster-wide
multiplier.

---

## 9. Test coverage

- `test/resonance-mode.test.mjs` (new):
  - The four mode-having resonators resolve their mode pair; all others have
    `resonanceMode: null`.
  - A `modeMatch` effect is active in its mode, inactive in the other.
  - A `modeMatch` + windowed effect requires BOTH (mode AND triggered window).
  - The Aemeath S6 double-listed crit effect: only the active mode's copy
    resolves (no double-count).
  - Switching `build.resonanceMode` flips the resolved effect set and the sim
    total changes accordingly.
- Data-integrity: every entry in the mode table (or projected field) references
  a real resonator + real mode names found in that resonator's data.
- `effect-overrides` test extended: a mode-conditional effect corrected via
  override resolves on the right mode.

---

## 10. Sequencing

- **The unconditional-effects bug** (`PROMPT-fix-unconditional-effects.md`) is
  fixed FIRST and independently — it is not part of this spec and must not wait
  on it.
- **Resonance Mode** (this spec, §3–§6, §9) lands within the P11/§A engine work
  and the `PRE-P12-DATA-QUALITY.md` pass, since it is an effect-resolution model
  extension and the data audit is where mode-conditional effects get classified.
- **Tune Break trigger** (§7) can follow once the mode model and the state
  timeline are both in place; it composes with both.
- **The P12 mode axis** (§8) is consumed when the optimizer runs; spec it now so
  the schema is forward-compatible, implement it in P12.
