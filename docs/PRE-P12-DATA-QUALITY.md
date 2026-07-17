# Pre-P12 Data Quality — Effect Classification & Trigger Audit
## Required before P12. Companion to `P11-ADDENDUM.md §A`.

## 1. Why this is now load-bearing

Two decisions converged on this work:

1. **No effect-level toggles** (`P11-ADDENDUM.md §A`). Users can no longer
   correct a misclassified effect by flipping a switch. The maintainer-side
   override table is the *only* correction mechanism. A misparsed effect is now
   silently wrong for every user until fixed here.
2. **P12 anchors on automatic resolution.** The optimizer's weights are
   computed by running the sim over the reference rotation with effects
   resolving via trigger × window. Wrong triggers/durations/classifications
   poison the weight baseline invisibly — the worst kind of optimizer error.

### Known misclassification patterns (from the Aemeath 2026-06 audit)

A manual audit of Aemeath (the most mechanically complex resonator) exposed two
recurring parser failures the audit tool must catch. Treat these as the canonical
test cases:

- **Unconditional multipliers tagged conditional.** "The DMG Multiplier of X is
  increased by N%" / "X DMG is increased by N%" with **no** conditional clause
  is unconditional (`trigger: none`, `window: always`). The parser was tagging
  several of Aemeath's S2/S3/S6 multipliers as conditional, so they rendered
  Inactive. The audit report must flag any unconditional-phrased multiplier that
  ended up with a non-`none` trigger. (The standalone fix is
  `PROMPT-fix-unconditional-effects.md`; this audit is the systemic guard.)
- **Mode-conditional effects (the `modeMatch` case).** Effects whose condition is
  "In Resonance Mode - Tune Rupture/Fusion Burst/Tune Strain, …" must classify
  as `trigger: modeMatch` (see `RESONANCE-MODE-SPEC.md §3`), composing with any
  further window/state clause. Aemeath S6 lists a fixed-crit effect **twice**,
  once per mode — both must carry the correct `mode`, and only the active mode's
  copy resolves. The audit must flag mode-referencing condition text that did
  not produce a `modeMatch` trigger. The four mode-having resonators (Aemeath,
  Lynae, Denia, Luciall) are mandatory deep-audit targets alongside the P12 seed
  set.

The original P9 parser extracts ~218 effects across 52/53 characters with
high-confidence regexes. That was acceptable when toggles existed as an escape
hatch. It no longer is.

## 2. Deliverable 1 — the effect audit report

Extend the preprocess pipeline (or a sibling tool, `tools/audit-effects.mjs`)
to emit `docs/effect-audit.md`: a per-character listing of every parsed
effect with its full resolution chain:

```
Carlotta S2.0  multiplierUp +126%  [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Fatal Finale…"

Sanhua S1.0   critRate +15%
  trigger: castMatch "Basic Attack V" → key basic_5   window: 10s
  source text: "Basic Attack V increases Sanhua's Crit. Rate by 15% for 10s."

Aemeath S2.0  multiplierUp …
  trigger: UNKNOWN ⚠            window: —
  source text: "…"
```

Every `UNKNOWN` trigger, unmapped trigger phrase (text extracted but not
resolved to a skill key/type), or missing duration on a `for Ns` effect is
flagged with ⚠ and summarized in a count at the top. The maintainer reads this
the way they read `meta-validation.md` — top to bottom, ⚠ first.

## 3. Deliverable 2 — the override table

`data/effect-overrides.json` (committed, hand-edited), merged by the
preprocess pipeline **after** `parseEffectsFromDesc`, keyed by resonator id +
effect key:

```jsonc
{
  "1210": {
    "S2.0": {
      // any subset of fields may be overridden:
      "trigger":  { "type": "stateEnter", "state": "resonance mode - tune rupture" },
      "window":   "stateBound",
      "value":    0.30,            // correct a misparsed magnitude
      "suppress": false            // true = drop a false-positive effect entirely
    }
  }
}
```

Rules:
- Overrides are **surgical** — only the listed fields change; the parser's
  output remains the base.
- `suppress: true` removes a false-positive effect from the projection.
- An override may also **add** an effect the parser missed entirely (full
  effect object under a new index key) — rare, but the mechanism must exist.
- Every override key must reference a real chain/inherent slot for that
  resonator (data-integrity test, same pattern as `rotation-rules`).

## 4. Process

1. Run the audit tool; read `effect-audit.md`.
2. For each ⚠: check the source text, write the minimal override.
3. For a sample of non-flagged effects (suggest: every effect on the P12
   seed characters — Carlotta, Hiyuki, Jinhsi, Changli, Phoebe, Cantarella,
   plus the five Tune Break characters), verify trigger/window/value against
   the in-game description. The seed set must be **fully verified**, not just
   un-flagged — P12's first weights are computed on these.
4. Re-run preprocess; confirm the audit report's ⚠ count for seed characters
   is zero.
5. Repeat per patch when new characters land (the audit report makes this a
   ten-minute pass, mirroring the `meta-validation.md` discipline).

## 5. Tests

- `test/effect-overrides.test.mjs`: every override key references a real slot;
  merged output conforms to the trigger × window schema; `suppress` removes;
  added effects appear; a known corrected effect (pick one real case once it
  exists) resolves with the overridden values end-to-end through the sim.
- **Multi-effect-per-node independence** (`P11-ADDENDUM.md §A3` invariant): a
  node carrying multiple effects resolves each independently and sums the active
  ones; specifically, the Aemeath S6 case where the same buff is listed twice
  under different mode gates — assert **both** effects are parsed, each carries
  its own `mode`, and exactly the active mode's copy resolves (no collapse, no
  dedupe, no double-count). This is the regression guard for the
  first-match-and-stop / dedupe failure mode.
- Audit tool determinism: same inputs → identical report (diffable per patch).

## 6. Exit criteria (gate for starting P12)

- Audit report exists and is regenerated by the pipeline.
- Zero ⚠ entries for the P12 seed characters.
- Override table mechanism tested and documented.
- `P11-ADDENDUM.md §A` engine work merged (the audit verifies the *same*
  resolution path the sim uses — auditing a different code path proves nothing).
