# P12 — Stat-Weight Optimizer: usage guide

A quick orientation for anyone who wants to *use* or *extend* the P12 stat
optimizer. For the full design rationale see `docs/PHASE0-ARCHITECTURE.md §2–§7`
and `docs/P12-INSTRUCTION-SET.md`.

## What it gives you

For each covered resonator × Resonance-Chain level (S0–S6) × sonata set, P12
precomputes **marginal stat weights** — "how much total rotation damage does
+1% of each stat buy, at a realistic anchor build?" — and turns them into a
ranked **stat priority** the build page shows live.

It is split in two, mirroring `preprocess.mjs → wuwa-data.json`:

```
  offline (once per patch, on your machine)
  node tools/optimize.mjs
        ├─ reads data/wuwa-data.json + the real sim engine
        ├─ writes data/wuwa-meta.json        (committed; the runtime reads this)
        └─ writes docs/meta-validation.md     (local QA report; docs/ is gitignored)

  runtime (every page load)
  meta-loader.js → stat-ranking.js → Stat Priority panel on the build page
```

The expensive search is frozen offline; the cheap part (ranking *your* substats
against the frozen weights) stays live, so it personalizes per build.

## ER is a mode, not a single breakpoint

Solo resonators build Resonance Energy over many rotation cycles, and the
dominant energy sources (damage taken, on-hit, off-field 50%, Concerto) aren't
modeled, so there is **no honest single solo ER breakpoint**. Instead the panel
offers three modes (`src/core/stat-priority.js`):

| Mode | Meaning |
| --- | --- |
| `dmgFocus` | pure DPS — Energy Regen ignored entirely |
| `balanced` | reach a target ER (default ~125%), then prioritize damage |
| `erFocus` | ER ranked by its real weight **only** for ER-scaling kits (Mornye-type); otherwise noted as team/multi-cycle-dependent |

A true breakpoint waits on team-level energy modeling (P13).

## Regenerating the meta

```bash
node tools/optimize.mjs        # writes data/wuwa-meta.json + docs/meta-validation.md
```

Run it whenever `data/wuwa-data.json` or the sim engine changes. Output is
deterministic (byte-identical except `generatedAt`). The committed meta carries
an `engineHash`; `tests/meta-schema.test.mjs` fails if the committed meta wasn't
regenerated after an engine change — so re-run this if that test goes red.

Then eyeball `docs/meta-validation.md` (the ⚠ section first) against a guide
site — that's the ~10-minute-per-patch QA loop.

## Using it at runtime (consuming the frozen weights)

```js
import { loadMeta, metaFor, isCovered } from './src/data/meta-loader.js';
import { statPriority, erStatus, isFarFromAnchor } from './src/core/stat-ranking.js';

const meta = await loadMeta();                       // null if missing/stale → fall back to live sim
if (isCovered(meta, build.resonatorId)) {
    const entry = metaFor(meta, build.resonatorId, build.chain, equippedSonataId);
    if (entry) {
        const rows = statPriority(entry, 'balanced'); // [{ key, label, weight, normalized, note?, gate? }]
        const er   = erStatus(build, entry, dataset);  // { current, target, belowTarget, scalesWithEr, libCostKnown }
        const caveat = isFarFromAnchor(build, entry, dataset); // true → "assumes a well-invested build"
    }
}
```

- `metaFor(...)` returns `null` for an uncovered character/sequence/sonata —
  always handle it by falling back to the live sim (never block on missing meta).
- `rankSubstats(entry, mode)` is `statPriority` filtered to substat-rollable
  stats (drops the main-only element DMG bonus).
- Weights are normalized for display so the top damage stat = 100.

## Extending it

**Add a character to coverage:** append its id to `COVERED_IDS` in
`tools/optimize.mjs` and re-run. It needs entries in `data/wuwa-data.json`
(rotation keys, base stats); if it scales off HP/DEF rather than ATK, add it to
`SCALING_OVERRIDES` in `reference-build.js`.

**Module map (offline, `tools/optimize/`):**

| File | Role |
| --- | --- |
| `reference-build.js` | the anchor — synthesized rotation, template echoes, representative weapon, `withTotalEr()` |
| `sim-eval.js` | `totalDamage()` + `injectStat()` (perturbation) over the unmodified sim |
| `weights.js` | `computeWeights()` — central-difference gradient per stat |
| `breakpoints.js` | `analyzeErMode()` + `detectConditionalThresholds()` |
| `validation-report.js` | the `docs/meta-validation.md` emitter |

**Shared, runtime-safe (`src/core/`):** `stat-priority.js`
(`derivePriority` / `normalizeWeights` / `statLabel`) and `stat-ranking.js`
(the runtime application). The optimizer **consumes** the engine and never
modifies damage logic — perturbation is just a normal build mutation re-run
through `simulateRotation`.

## Tests

```bash
node tests/optimize-reference-build.test.mjs
node tests/optimize-weights.test.mjs
node tests/optimize-breakpoints.test.mjs
node tests/meta-schema.test.mjs       # also the engine-hash staleness guard
node tests/meta-loader.test.mjs
node tests/stat-ranking.test.mjs
node tests/build-editor-v2.test.mjs   # includes the Stat Priority panel markup
```
