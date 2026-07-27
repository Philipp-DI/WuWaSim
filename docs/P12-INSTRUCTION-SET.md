# Phase 12 — Claude Code Instruction Set
## Stat-Weight + Breakpoint Optimizer (Offline Precompute)

**Reads**: `docs/PHASE0-ARCHITECTURE.md` (§2–§7 are the spec this phase
implements), `docs/P11-INSTRUCTION-SET.md` (the visualization layer this builds
on). **Produces**: `tools/optimize.mjs` (offline pipeline), `data/wuwa-meta.json`
(committed results), `docs/meta-validation.md` (QA report), and a thin runtime
display layer that reads the meta file on the build page.

This phase is mostly an **offline tool**, not runtime UI. The heavy work runs
once per patch on the maintainer's machine. The runtime addition is small: read
the frozen results, rank the user's actual substats, show breakpoints. The
runtime sim remains first-class for any character the meta doesn't cover.

---

## 0. Pre-flight checklist

1. Confirm P10 + P11 are merged and all test suites pass (run them).
2. Read `PHASE0-ARCHITECTURE.md` §2–§7 in full. This instruction set implements
   exactly those sections; if anything here seems to contradict that document,
   the architecture doc wins — stop and flag it.
3. Confirm the sim engine is callable headlessly from a Node script (it already
   is — `tools/preprocess.mjs` and the test suites import core modules directly
   with a `localStorage` shim). The optimizer will import `simulateRotation`,
   `resolveTotalStats`, `createBuild`, etc. the same way.
4. **Determinism check**: confirm the sim is deterministic — the same build +
   rotation + target produces identical damage every run. The entire precompute
   depends on this. If any randomness exists (it should not), it must be seeded
   or removed before P12 proceeds.

---

## 1. Scope boundary

### P12 DOES create / change
- New: `tools/optimize.mjs` — the offline precompute pipeline.
- New: `tools/optimize/` — supporting modules for the pipeline (keep
  `optimize.mjs` a thin orchestrator; put the real logic in submodules):
  - `reference-build.js` — constructs the per-resonator anchor build.
  - `breakpoints.js` — ER + conditional-threshold detection by sweeping.
  - `weights.js` — marginal gradient computation by perturbation.
  - `validation-report.js` — emits the human-readable QA markdown.
- New: `data/wuwa-meta.json` — committed precompute output.
- New: `docs/meta-validation.md` — committed QA report (regenerated each run).
- New: `src/data/meta-loader.js` — runtime loader for `wuwa-meta.json`.
- New: `src/core/stat-ranking.js` — runtime: rank a user's substats against
  frozen weights; compute distance-from-anchor for the staleness check.
- `src/ui/components/build-editor.js` — display stat priority + ER breakpoint
  on the build page (a new panel/section).
- `styles/editor.css` — styles for the stat-priority panel.
- `test/` — tests for breakpoint detection, weight monotonicity, meta schema,
  and runtime ranking.

### P12 does NOT change
- The sim engine (`formula.js`, `stats.js`, `skill.js`, `buffs.js`, `sim.js`,
  `team-sim.js`, etc.). The optimizer **consumes** the engine; it must not
  modify it. If the optimizer needs something the engine doesn't expose, add a
  read-only accessor — do not change damage logic.
- `tools/preprocess.mjs` / `data/wuwa-data.json` — separate pipeline, untouched.
- Team-level logic — team ER override and team suggestions are **P13**. P12 is
  character-level only.

---

## 2. The reference build (anchor) — `tools/optimize/reference-build.js`

Per `PHASE0-ARCHITECTURE.md §4`, every weight and character-level breakpoint is
computed at a defined anchor. This module constructs it deterministically.

### 2a. Components of the anchor

For a given `(resonatorId, sequenceLevel, sonataSetId)`:

1. **Reference rotation** — the character's default rotation. **This artifact
   must already exist or be created here.** Source priority:
   - If a curated default rotation exists for the resonator (check for a
     `defaultRotation` field in the dataset or a `rotation-defaults.js` table),
     use it.
   - Otherwise, synthesize one: a sensible standard rotation from the
     character's skill set — Intro → Skill(s) → Forte → Liberation → Basic
     filler, using the `autoSkillMap` and respecting P10 prerequisite rules
     (`validateRotation` must return zero warnings for the synthesized rotation).
   - **Emit the synthesized rotation into the meta file** (`referenceRotation`)
     so it is transparent and reusable as the build-page default.

2. **Sequence level** — set `build.chain = sequenceLevel` (0–6).

3. **Conditional baseline** — the unified **trigger × window** resolution from
   `P11-ADDENDUM.md §A` (which deprecated `effectMode`/`effectToggles`): run
   the reference rotation and let effects resolve from their triggers — timed
   windows open when fired, state-bound effects follow the state timeline,
   unresolvable triggers stay conservatively OFF. Prerequisite:
   `PRE-P12-DATA-QUALITY.md` exit criteria met (zero unresolved triggers on
   the seed characters), or the anchor is computed on poisoned data.

4. **Template stat-set** — a fixed per-resonator echo main/sub spread held
   constant across all iterations (§2b).

5. **Sonata** — set the build's echo sonata to `sonataSetId`. Vary this across
   the enumeration (each character gets computed for each relevant sonata).

### 2b. Choosing the template stat-set

The template must be *realistic* (a plausible endgame build) but *fixed* so
sweeps are comparable. Define it deterministically:

- **Main stats**: by echo cost slot, use the standard endgame main for the
  character's primary damage type:
  - 4-cost: the character's element DMG bonus (Glacio for Carlotta, etc.) — or
    Crit Rate / Crit DMG if the character is conventionally built crit-main.
  - 3-cost: ATK% (or the character's scaling stat — HP% for HP-scalers, etc.).
  - 1-cost: ATK% (or scaling stat).
- **Substats**: a balanced, neutral spread (e.g. distribute rolls across CR, CD,
  ATK%, ER, and the relevant DMG bonus). **The exact spread does not need to be
  optimal** — it is the anchor, not the answer. What matters is that it is
  fixed and documented.
- Emit the chosen template into the meta file (`templateStats`) for transparency.

**Important nuance**: the template stat-set is held constant *except for the one
stat being swept/perturbed* at any given moment. Breakpoint sweeps vary ER (or
the threshold stat); weight perturbations vary one stat at a time. Everything
else stays at the template value.

---

## 3. Breakpoint detection — `tools/optimize/breakpoints.js`

Per `PHASE0-ARCHITECTURE.md §3a`. Two kinds: ER breakpoint and character-specific
conditional thresholds. Both detected by **sweeping** a stat and watching for a
behavioral change.

### 3a. ER breakpoint — the objective signal

The breakpoint is "the minimum total ER at which the reference rotation's
Resonance Liberation is available when the rotation needs it." This needs a
concrete, measurable signal. Use **energy accounting over the rotation**:

1. The sim already models energy generation per skill and Liberation energy
   cost (P8 "Energy / Concerto / Forte gauges"). Expose, if not already present,
   a read-only per-rotation energy trace: at each Liberation step, was enough
   energy available to cast it?
2. **Sweep ER** from a low floor (e.g. 100%) upward in fine increments (§3c).
   At each ER value, run the reference rotation and check: did every Liberation
   step in the rotation have sufficient energy at the moment it was cast?
3. The **minimum viable ER** (`minViable`) is the lowest swept value at which
   all Liberation casts in the rotation succeed.
4. **Reported value** (`recommended`) = `minViable × 1.05` (the ~5% safety
   margin from `PHASE0-ARCHITECTURE.md §3a` — accounts for imperfect human
   timing). Round to a sensible display precision (e.g. nearest 1%).

If the sim does not yet model energy sufficiency at the Liberation cast moment
precisely enough to give a clean signal, **flag this as a prerequisite gap** and
stop — do not fabricate a breakpoint from a weaker proxy. A wrong breakpoint is
worse than "no suggestion available."

### 3b. ER-scaling edge case (Mornye type)

Some kits *scale damage* with ER (Mornye). For these, the ER sweep shows no
cliff — Liberation is always castable, and more ER keeps adding damage. Detect
this: if `minViable` is at or below the floor AND the marginal weight of ER
(§4, computed at the template) is materially positive, set
`erBreakpoint.scalesWithEr = true` and do not present ER as a "reach then stop"
gate. Instead ER carries a normal positive weight in the priority order.

### 3c. Sweep granularity

- ER sweep increment: fine enough to locate the cliff within ~1% (e.g. 1%
  steps). Coarse-to-fine is acceptable: scan in 5% steps to bracket the cliff,
  then 1% steps within the bracket. Document the chosen method in code comments.
- The sweep range: floor = 100% ER (base), ceiling = a high value (e.g. 250%)
  beyond which no realistic build goes. If `minViable` is not found below the
  ceiling, emit a diagnostic and mark the entry unresolved (the validation
  report must surface this).

### 3d. Character-specific conditional thresholds

Per `PHASE0-ARCHITECTURE.md §3a`, kits can gate a conditional on a stat reaching
a value (illustrative: "DEF ≥ 1000 → +15% Crit Rate"). These are encoded in
chain/inherent/forte effect data. Detection approach:

- The P10 effect parser classified conditions. Extend detection to recognize
  *numeric stat thresholds* in effect conditions ("when X reaches N", "if X is
  above N"). If the P10 parser does not already capture the numeric threshold
  and the stat it applies to, **add that extraction to the analysis here**
  (read-only — do not change the runtime parser output schema without care; if
  you must, treat it as a P12 data addition and re-run preprocess).
- For each detected threshold, sweep the relevant stat to confirm where the
  conditional flips on, and record `{ stat, value, unlocks, source }` in the
  meta file.
- If no numeric thresholds are reliably extractable for a character, emit an
  empty `conditionalThresholds: []` — this is fine, most characters have none.

---

## 4. Marginal weights — `tools/optimize/weights.js`

Per `PHASE0-ARCHITECTURE.md §2, §3b`. Computed at or above the ER breakpoint, by
**single-stat perturbation**.

### 4a. The perturbation method

For each stat in the weight set (Crit Rate, Crit DMG, ATK% / scaling stat, and
each relevant DMG-type bonus — Basic / Heavy / Skill / Liberation / Echo):

1. Start from the anchor build (template stats, at the ER breakpoint level for
   ER-gated characters).
2. Compute baseline total rotation damage `D0 = simulateRotation(anchor)`.
3. Perturb the single stat by a small, fixed delta `δ` (e.g. +1% for percentage
   stats; document the unit). All other stats stay at template values.
4. Compute perturbed damage `D1 = simulateRotation(anchor with stat += δ)`.
5. Weight = `(D1 − D0) / δ` — the marginal damage per unit of that stat,
   normalized so weights are comparable across stats.

### 4b. The diminishing-returns trap — must handle correctly

Crit Rate's marginal value collapses near/above 100% effective crit. ER's
collapses past the breakpoint. The perturbation must be evaluated **at the
anchor's actual stat level**, not in a vacuum, so these non-linearities are
captured:

- Because the perturbation is local (small δ at the realistic template level),
  it naturally reflects diminishing returns *at that level*. This is correct
  and desirable.
- **Guard against crit overflow**: if the template already has effective Crit
  Rate near 100%, the CR weight will (correctly) be near zero. Do not "fix" this
  — it is the true marginal value. But the validation report (§6) must surface
  it so the maintainer can sanity-check that the template isn't pathological.
- **Symmetric check**: optionally compute both `+δ` and `−δ` and average the
  slopes (central difference) for a more stable gradient. Recommended.

### 4c. Per-sequence computation

Repeat §2–§4 for **each sequence level S0–S6** (`PHASE0-ARCHITECTURE.md §4`).
Each level gets its own breakpoints + weights. A flat-multiplier sequence (e.g.
Carlotta S2) will show nearly identical weights to the level below it; a
crit-granting sequence will shift them. This per-sequence output is the
"invaluable insight into how valuable each investment level is."

### 4d. Priority order derivation

From the weights, derive a human-readable `priorityOrder`:
- If the character is ER-gated and below-breakpoint ER would block the rotation:
  prepend `"energyRegen (until [recommended]%)"` as the first priority.
- Then list remaining stats sorted by weight, descending.
- ER-scaling characters (§3b): ER appears in the sorted list by its weight, not
  as a gate prefix.

---

## 5. Pipeline orchestration — `tools/optimize.mjs`

Thin orchestrator. Iterates the enumeration and writes outputs.

```
for each covered resonator:
  determine relevant sonata sets to compute (the character's standard sets)
  build the template stat-set (reference-build.js)
  for each sequence level 0..6:
    for each sonata set:
      anchor = referenceBuild(resonatorId, seq, sonata)
      erBreakpoint        = detectErBreakpoint(anchor)        // breakpoints.js
      conditionalThresholds = detectThresholds(anchor)        // breakpoints.js
      weights             = computeWeights(anchor, erBreakpoint)  // weights.js
      priorityOrder       = derivePriority(weights, erBreakpoint)
      record into meta.characters[id].bySequence[seq].bySonata[sonata]
write data/wuwa-meta.json
write docs/meta-validation.md   // validation-report.js
print a run summary (characters covered, total scenarios, elapsed time, any unresolved entries)
```

### 5a. Determinism + provenance

- The output must be **deterministic**: same `wuwa-data.json` + same engine →
  byte-identical `wuwa-meta.json` (modulo the `generatedAt` timestamp). This
  makes diffs meaningful and the validation report trustworthy.
- Stamp the meta file with `metaVersion`, `gameVersion`, `generatedAt`, and an
  `engineHash` (a hash of the core engine files, so the runtime can detect when
  the meta was built against a different engine).

### 5b. Coverage scope

Start with a **curated subset** of well-understood characters (the same six P10
has rules for is a reasonable seed: Carlotta, Hiyuki, Jinhsi, Changli, Phoebe,
Cantarella), then expand. Characters not yet covered simply have no meta entry —
the runtime shows "no suggestion available" and falls back to live sim. Do NOT
attempt all ~56 characters in the first pass; correctness on a few beats
breadth with errors.

### 5c. Compute budget

Hours are acceptable (`PHASE0-ARCHITECTURE.md §1`). Favor clarity over speed.
But: print progress (per-character, per-sequence) so a long run is observable,
and make the pipeline **resumable** if feasible (write per-character partial
results so a crash mid-run doesn't lose hours). Resumability is a nice-to-have,
not a blocker.

---

## 6. Validation report — `tools/optimize/validation-report.js`

Per `PHASE0-ARCHITECTURE.md §7`. Emits `docs/meta-validation.md`, a human-readable
artifact the maintainer eyeballs against guide sites (~10 min/patch).

Per character, for at least S0 and S6 (and ideally each sequence):
- ER breakpoint: `minViable` and `recommended`, or `scalesWithEr`.
- Stat priority order in plain language.
- Top 3–4 weights with relative magnitudes (normalize so the top weight = 100,
  others as % of it — easier to eyeball than raw damage numbers).
- Any conditional thresholds detected.
- **Divergence flags**: when the derived order differs from a simple baseline
  expectation (e.g. "weights put ATK% above Crit DMG — unusual, verify"), flag
  it so the maintainer's attention goes to the entries most worth checking.
- **Unresolved entries**: any scenario where the ER breakpoint wasn't found or a
  computation failed — listed prominently at the top so they're not missed.

Format: compact markdown tables + prose. A human reads it top to bottom.

---

## 7. Runtime: meta loader — `src/data/meta-loader.js`

Mirror the existing data loader pattern. Fetch `wuwa-meta.json` (in parallel
with the main data load), validate `metaVersion`, and expose lookups:

```js
// loadMeta() → the parsed meta object (or null if missing/incompatible)
// metaFor(resonatorId, sequenceLevel, sonataSetId)
//   → the bySonata entry, or null if not covered
// isCovered(resonatorId) → boolean
```

If `metaVersion` doesn't match the runtime's expected version, OR the
`engineHash` doesn't match the current engine, treat the meta as **absent** (log
a console warning, return null from lookups). Stale meta must never produce
silently-wrong advice — better to fall back to live sim.

---

## 8. Runtime: stat ranking — `src/core/stat-ranking.js`

This is the live application of frozen weights to the user's actual build.

```js
// rankSubstats(userBuild, metaEntry) → ranked array
//   For each substat the user could roll, multiply its per-unit weight (from
//   metaEntry.weights) by 1 → a ranked list of "value per roll" for THIS
//   character/sequence/sonata. Returns stats sorted by weight desc, annotated
//   with whether the user is below the ER breakpoint.
//
// erStatus(userBuild, metaEntry) →
//   { current, recommended, belowBreakpoint: bool, scalesWithEr: bool }
//   Compares the user's actual total ER against the recommended breakpoint.
//
// anchorDistance(userBuild, metaEntry) → number
//   A rough measure of how far the user's build is from the anchor (template
//   stats + sequence). Used to decide whether to show a "weights assume a
//   well-invested build" caveat or fall back to live sim. (See §9.)
```

The ranking is cheap — it's arithmetic on frozen numbers, no simulation. This is
the payoff of the precompute design.

---

## 9. Runtime: build-page display — `src/ui/components/build-editor.js`

Add a **Stat Priority** panel to the build page. It shows:

1. **ER breakpoint status** (top, most actionable):
   - If `belowBreakpoint`: a prominent callout — "Energy Regen: [current]% →
     aim for [recommended]%. Below this, your Liberation may not be ready in
     time." This is the highest-priority advice and should read as a gate.
   - If at/above: a quiet confirmation — "Energy Regen: [current]% ✓
     (target [recommended]%)."
   - If `scalesWithEr`: "Energy Regen scales this character's damage — more is
     better" (no gate framing).

2. **Stat priority order** (from `priorityOrder`): a ranked list, with relative
   weight bars (top stat = full bar, others proportional). Reads as
   "CR > Liberation DMG > CD > ATK%".

3. **Sequence + sonata context**: show which `(sequence, sonata)` the displayed
   advice corresponds to (the user's current build's chain level and equipped
   sonata). If the user changes sequence/sonata, re-look-up the meta entry.

4. **Coverage / staleness handling**:
   - If `metaFor(...)` returns null (uncovered character/sequence/sonata): show
     **"No precomputed suggestion available for this configuration."** plus an
     option to run the live sim-based analysis on the current build. The runtime
     sim stays first-class — never leave the user with nothing.
   - If covered but `anchorDistance` is large: show the priority order with a
     quiet caveat — "Assumes a well-invested build; your priorities may differ."
     (This is the §2 honesty requirement from the architecture doc surfaced in
     UI copy.)

The visual design of this panel is left to the Figma handoff
(`docs-local/UI-DESIGN-WORKFLOW.md`). This spec defines the data and behavior;
the design doc defines the look.

---

## 10. Test coverage requirements

**`test/optimize-breakpoints.test.mjs`** (new):
- For an ER-gated character, `minViable` is found within the sweep range and
  `recommended ≈ minViable × 1.05`.
- For a known ER-scaling character (Mornye, if covered), `scalesWithEr === true`.
- Sweeping below `minViable` shows Liberation failing; at/above, it succeeds.

**`test/optimize-weights.test.mjs`** (new):
- Weights are finite numbers, no NaN/Infinity.
- A stat the character scales with has a positive weight.
- A clearly-irrelevant stat has a near-zero weight (e.g. Healing Bonus for a
  pure DPS with no healing).
- Central-difference and forward-difference gradients agree within tolerance
  (sanity check on the perturbation method).

**`test/meta-schema.test.mjs`** (new):
- `wuwa-meta.json` parses and conforms to the §6 schema of the architecture doc.
- Every covered character has `referenceRotation`, `templateStats`, and at least
  S0 in `bySequence`.
- `referenceRotation` for each covered character passes `validateRotation` with
  zero prerequisite warnings (the synthesized default must be legal).

**`test/stat-ranking.test.mjs`** (new):
- `rankSubstats` returns stats sorted by weight descending.
- `erStatus` correctly flags below-breakpoint vs above.
- Uncovered character → `metaFor` returns null and ranking degrades gracefully.

**`test/meta-loader.test.mjs`** (new):
- Version mismatch → loader returns null (treats meta as absent).
- Engine-hash mismatch → loader returns null.

All P10 + P11 tests must still pass.

---

## 11. Verification method

```bash
# 1. Run the precompute end to end (this is the long step — minutes to hours)
node tools/optimize.mjs

# 2. Confirm outputs exist and parse
node -e "const m=require('./data/wuwa-meta.json'); console.log('chars:', Object.keys(m.characters).length, '| version:', m.metaVersion)"
test -f docs/meta-validation.md && echo "validation report present"

# 3. Syntax + runtime load sweep of all new + changed modules
#    (include the tools/optimize/* modules and the new runtime modules)

# 4. All test suites (P10, P11, P12)
for t in test/*.test.mjs; do node "$t" || echo "FAILED: $t"; done

# 5. Manual QA gate (maintainer, not automated):
#    Open docs/meta-validation.md and spot-check 2-3 characters against
#    prydwen.gg or another guide. Confirm the stat priority order and ER
#    breakpoint are sane. This is the human validation loop the report enables.
```

The precompute is correct when: all tests pass, the meta file conforms to
schema, and the maintainer's spot-check against guide sites agrees with the
derived priorities for the covered characters.

---

## 12. Files summary (expected)

| File | Type |
|---|---|
| `tools/optimize.mjs` | New — orchestrator |
| `tools/optimize/reference-build.js` | New — anchor construction |
| `tools/optimize/breakpoints.js` | New — ER + threshold sweeps |
| `tools/optimize/weights.js` | New — gradient perturbation |
| `tools/optimize/validation-report.js` | New — QA markdown emitter |
| `data/wuwa-meta.json` | New — committed precompute output |
| `docs/meta-validation.md` | New — committed QA report |
| `src/data/meta-loader.js` | New — runtime meta loader |
| `src/core/stat-ranking.js` | New — runtime weight application |
| `src/ui/components/build-editor.js` | Add Stat Priority panel |
| `styles/editor.css` | Stat priority panel styles |
| `test/optimize-breakpoints.test.mjs` | New |
| `test/optimize-weights.test.mjs` | New |
| `test/meta-schema.test.mjs` | New |
| `test/stat-ranking.test.mjs` | New |
| `test/meta-loader.test.mjs` | New |

---

## 13. Hard requirements (do not compromise)

1. **The optimizer consumes the engine; it never modifies damage logic.** If a
   needed signal isn't exposed, add a read-only accessor.
2. **Breakpoints are reported with the +5% margin**, never the bare minimum.
3. **Weights are per-sequence (S0–S6)**, never a single global vector.
4. **Determinism**: same inputs → same `wuwa-meta.json` (except timestamp).
5. **Uncovered → "no suggestion available" + live sim.** Never block, never
   show a fabricated number.
6. **Stale meta (version/engine mismatch) is treated as absent.** Wrong advice
   is worse than no advice.
7. **The validation report is a required output, not optional.** It is the
   maintainer's only practical QA loop.

---

## 14. Deferred to P13

- **Team-level ER breakpoint override** (`PHASE0-ARCHITECTURE.md §5`): the
  character-level breakpoint shipped here is the default; the team-level value
  overrides it when the character is in a simulated team. P13 adds the `teams`
  section to `wuwa-meta.json` and the override logic.
- **Team synergy scores / suggested teams.**
- **"Appears in teams" indicator.**
