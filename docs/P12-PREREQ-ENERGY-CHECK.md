# P12 Prerequisite — Energy-Signal Go/No-Go Check

**Purpose**: a focused, diagnostic-first investigation Claude Code runs **before**
committing to the full P12 optimizer build. P12's ER-breakpoint detection
(`docs/P12-INSTRUCTION-SET.md §3a`) depends entirely on the engine being able to
answer one question:

> *"At the moment a Resonance Liberation is cast in a rotation, was enough
> energy available to cast it?"*

If the engine cannot answer this cleanly, the ER breakpoint cannot be computed
honestly, and P12 needs a prerequisite sub-phase (call it **P11.5 — Energy
Modeling**) to add the capability first. A wrong breakpoint is worse than "no
suggestion available", so this gate exists to catch the gap before hours of
optimizer work are built on a signal that isn't there.

This document does two things:
1. Defines the **check** (what to verify, how, and the three possible verdicts).
2. Pre-stages the **P11.5 sub-phase spec** that the check will almost certainly
   trigger, based on a preliminary probe of the current engine (§4).

---

## 1. What "a clean signal" means (the bar)

The engine provides a clean energy signal if, given a build + rotation + target,
it can produce a **per-rotation energy trace** answering, at each Liberation
step: *was cumulative available energy ≥ the Liberation's energy cost at the
moment it was cast?* Concretely, the signal is clean enough for P12 if all of:

1. **Per-skill energy generation** is modeled — each action in the rotation
   contributes energy (base generation × the resonator's Energy Regen stat,
   plus Concerto/on-hit/passive sources the kit defines).
2. **Liberation energy cost** is known per resonator (from the dataset).
3. **Accumulation over the rotation** is tracked — energy builds step by step,
   and Liberation consumes it.
4. **The signal moves with ER** — sweeping the Energy Regen stat upward changes
   *when* (or *whether*) a Liberation becomes castable in the rotation. Without
   this monotonic response, there is no breakpoint to detect.

If any of (1)–(4) is missing, the signal is not clean and P12 §3a cannot proceed
as written.

---

## 2. The check procedure

Claude Code runs this as a **read-only investigation** (no feature code yet) and
writes its findings to `docs/energy-signal-findings.md`.

### Step 1 — Inventory what exists
- Grep the engine for energy modeling: `src/core/sim.js`, `stats.js`,
  `formula.js`, `skill.js`, `buffs.js`.
- Determine: Is Energy Regen only a *stat* (computed in `resolveTotalStats`), or
  is it *consumed* by any rotation logic in `sim.js`?
- Check the dataset (`data/wuwa-data.json`) for: per-skill energy generation
  values, Liberation energy cost per resonator, Concerto/energy gauge data.
- Check `tools/preprocess.mjs` for whether energy fields are projected from the
  nanoka/Dimbreath source at all (if the raw source has them but preprocess
  drops them, that's a much smaller fix than if the source lacks them).

### Step 2 — Probe the source data
The raw nanoka character files (`data/extracted-nanoka/characters/*.json`) and
the Dimbreath fallback are the upstream. Determine whether they carry:
- Liberation energy cost (often a fixed number per character).
- Per-skill energy generation (energy gained on cast/hit).
- If the source has these but preprocess drops them → the fix is a preprocess
  projection change (small). If the source lacks them → the data must be sourced
  or curated (larger).

### Step 3 — Test the ER response (only if Steps 1–2 suggest a signal exists)
If energy modeling appears present, write a throwaway probe script:
- Take one ER-gated character, one reference rotation.
- Run the sim at ER = 100%, 120%, 140%.
- Confirm the energy trace at the Liberation step *changes* with ER, and that
  there is a value below which Liberation is not castable and above which it is.
- If the response is flat (ER doesn't move the signal) → not clean.

### Step 4 — Verdict
Write one of three verdicts to `docs/energy-signal-findings.md`:

- **GO** — all four signal criteria (§1) met, ER response confirmed monotonic.
  P12 §3a proceeds as written. (No accessor work needed beyond exposing the
  trace if it's internal.)
- **CONDITIONAL-GO** — the model exists but the signal isn't *exposed* (e.g.
  energy is computed internally but not surfaced per-step). Fix is a read-only
  accessor in `sim.js` exposing the per-step energy trace. Small, scoped; do it,
  then proceed to P12. Specify exactly what accessor to add.
- **NO-GO** — energy accumulation and/or Liberation cost are not modeled at all.
  P12 §3a cannot proceed. Trigger the **P11.5 sub-phase** (§3 below) first.

---

## 3. P11.5 — Energy Modeling sub-phase (triggered on NO-GO)

If the check returns NO-GO, this is the prerequisite to build before P12. It is
scoped tightly: model energy enough to detect the breakpoint, nothing more.

### 3a. Data: source or curate the inputs
- **Liberation energy cost** per resonator. Probe the source first (Step 2). If
  present upstream, project it in `preprocess.mjs` to a `liberationCost` field
  on each resonator. If absent upstream, curate a table
  (`tools/energy-costs.js`) — most WuWa Liberations cost 125 energy as a
  baseline, but verify per character; do not assume a universal constant.
- **Per-skill energy generation**. This is the harder input. Options, in order
  of preference:
  - Project from the source if it carries per-skill energy gen.
  - If absent, use the documented WuWa per-action energy-generation model
    (Basic/Heavy/Skill/Intro each generate characteristic amounts; Concerto and
    on-hit contribute). Encode as a curated, documented model in
    `tools/energy-model.js` with per-skill-type defaults and per-character
    overrides where the kit deviates.
  - This will be approximate. That is acceptable for breakpoint detection
    **as long as the +5% margin** (P12 §3a) absorbs the approximation error.
    Document the approximation clearly.

### 3b. Engine: accumulate energy over the rotation
- Add to `sim.js` a per-step energy accumulator: starting energy (0 or a
  configurable opener value), add each step's generation × `stats.energyRegen`,
  subtract Liberation cost when a Liberation step is reached.
- Expose a **read-only** per-step energy trace on the SimResult:
  `energyTrace: Array<{ stepIndex, energyBefore, energyAfter, liberationCastable }>`.
- This is purely *additive* to the SimResult — it must not change any damage
  number. Damage logic is untouched; energy is a parallel track. (Same
  consume-don't-modify discipline as the optimizer phases.)
- Crucially, do NOT make damage depend on energy (no "Liberation does 0 damage
  if not enough energy" — that would change existing behavior and break P11
  visualizations). The trace is *informational*; it tells the optimizer whether
  the rotation is energy-feasible, it does not gate damage.

### 3c. Tests
- `test/energy-trace.test.mjs`: energy accumulates monotonically across a
  rotation; Liberation cost is subtracted at the Liberation step; higher ER
  reaches Liberation-castable earlier/at-lower-investment; the trace is additive
  (damage totals are byte-identical with and without the trace computed).

### 3d. Scope discipline
P11.5 models energy **only enough to detect feasibility for breakpoint
detection**. It does not model: energy from taking damage, exact Concerto timing,
swap-in energy, or real-time regen. These are out of scope — the breakpoint is
about rotation feasibility, and the +5% margin covers the modeling gap. Do not
gold-plate this; it is a means to P12's end.

---

## 4. Preliminary probe result (already run)

A quick probe of the current engine state (so you start informed):

- **Energy Regen is a STAT only.** It is computed in `resolveTotalStats`
  (`stats.js`) and stored on the stats object, but `sim.js` explicitly states it
  does **"no gauge tracking"** and nothing in the rotation walk consumes or
  accumulates energy.
- **No Liberation energy cost** exists anywhere in `src/core/` or the compiled
  dataset.
- **No per-skill energy generation** in the dataset (zero energy-related keys on
  a sample character).

On this evidence, the check will almost certainly return **NO-GO**, and **P11.5
is required before P12**. Claude Code should still run the full check (§2) to
confirm — in particular Step 2 (does the *source* data carry Liberation cost /
energy gen?), because that determines whether P11.5's §3a data work is a small
preprocess projection or a larger curation effort. That single finding is the
biggest unknown and the most valuable output of running this check.

---

## 5. Sequencing impact

- If **GO / CONDITIONAL-GO**: proceed to P12 as drafted (CONDITIONAL-GO adds a
  small accessor first).
- If **NO-GO** (expected): insert **P11.5 — Energy Modeling** between P11 and
  P12. P12 §3a then has its signal. Nothing else in P12 changes — weights (§4),
  the meta schema, the validation report, and the runtime layer are all
  unaffected; only the breakpoint detection depends on this prerequisite.

The rest of the arc (P13) is unaffected — it consumes P12's breakpoints
regardless of how they were produced.

---

## 6. Why this check exists (the principle)

The entire precompute design rests on the sim being a trustworthy oracle. P12
asks the sim a question it may not be equipped to answer. Discovering that *now*,
with a 30-minute read-only investigation, costs almost nothing. Discovering it
*after* building the breakpoint sweep — when the sweep returns garbage because
there's no energy signal underneath it — costs hours and risks shipping a
confident-but-wrong ER number that sends every user's build in the wrong
direction. The check is cheap insurance on the most load-bearing assumption in
the optimizer.
