# PLAN — OPEN-ITEMS #2: non-energy resource-gauge engine

**Written 2026-07-31** as a handover for a fresh session. Read this instead of
re-deriving the landscape; every number below was measured against the current
`data/wuwa-data.json`, not estimated.

Prerequisite reading: `CLAUDE.md` (rules), `docs/ARCHITECTURE.md` ("Life of a
buff"), `docs/OPEN-ITEMS.md` #2. Skip `docs/HISTORY.md` unless you need the
chronicle.

---

## The one-paragraph version

Gauge-scaled buffs ("each stack of Enflamement increases…") are already parsed
and already flow through the buff pipeline — but nothing tells them how many
stacks they have, so **11 of them are credited exactly ONE stack** and 2 are
credited their ceiling. The engine gap is small and precisely located
(`scaleEffect` in `src/core/buffs.js` has two stack sources and needs a third).
**The real blocker is data**: the gauge definitions those effects would read
don't exist for 3 of the 4 kits the backlog names.

---

## What already exists (do not rebuild)

| Piece | Where | State |
| --- | --- | --- |
| Stack-scaling of a buff | `src/core/buffs.js` `scaleEffect()` | **Done.** `value = perStack × stacks` |
| Stack count from cast counting | same, `stackTrigger.type === 'castMatch'` | **Done.** Reads `ctx.fireCountByType` |
| Per-step gauge accumulation | `src/core/rotation-graph.js` `resourceLevels()` | **Done, but validation-only.** Per-step entering level; spends before gains |
| Curated gauge defs | `src/core/rotation-rules.js` `RESOURCE_DEFS` | **1 resonator** (Sigrika 1412): `{ name, cap, gains, spendAll }` |
| Extracted Forte gauge | `data/forte-data.json` (`tools/extract-forte.mjs`) | **24 of 56 resonators**: `{ channel, cap, gen: { skillKey: amount } }` |
| Forte gauge at sim time | `src/core/opener.js` (`forteCap`) | **Opener feasibility only** — not a general model |
| Boolean state timeline | `src/core/rotation-state.js` `computeStateTimeline()` | **Done.** The pattern to mirror for resources |
| Tune Break damage | `src/core/enemy-status.js` `computeTuneBreakDamage()` | **Calibrated + tested, unwired** (OPEN-ITEMS #7) |

## The measured gap

```
stackable effects in the dataset          14
  ├─ resolvable trigger (castMatch)        1   ← works today
  └─ stackTrigger.type === 'unknown'      13   ← PINNED
       ├─ maxStacks null → credited 1 stack   11
       └─ maxStacks known → credited ceiling   2   (Encore 5, Jinhsi 2)
```

The 13 pinned effects, across 11 resonators:

| Resonator | stat | perStack | maxStacks |
| --- | --- | --- | --- |
| Lynae | elementBonus | **0.55** | null → **1** |
| Luuk Herssen | skillTypeBonus | **1.20** | null → **1** |
| Jinhsi | atkRatio | 0.25 | 2 |
| Augusta | critRate | 0.20 | null → **1** |
| Youhu / Augusta | critDmg | 0.15 | null → **1** |
| Yangyang: Xuanling | amplify | 0.12 + 0.10 | null → **1** |
| Encore | atkRatio | 0.05 | 5 |
| Changli | elementBonus | 0.05 | null → **1** |
| Galbrena | amplify | 0.05 | null → **1** |
| Sigrika | elementBonus | 0.03 | null → **1** |
| Phrolova | critDmg | 0.025 | null → **1** |

`buffs.js:517` calls the fallback "the realistic ceiling" — true only when
`maxStacks` is known. With `maxStacks: null` it silently collapses to `1`, so
Lynae's +55%/stack and Luuk Herssen's +120%/stack are each worth one stack.
**Fixing the stack SOURCE without fixing this default changes nothing for those
11** — both halves are needed.

## The data blocker (check this before writing engine code)

Of the four kits OPEN-ITEMS #2 names:

| Kit | Gauge data |
| --- | --- |
| Hiyuki (Snow Rust) | `forte-data.json` — channel 2, cap 300, 10 gen keys |
| Changli (Enflamement) | **none** |
| Lynae (Lumiflow / Premixed Hue) | **none** |
| Galbrena | **none** |

`forte-data.json` covers 24 of 56 and is keyed by Forte *channel*, which is not
the same thing as a named stack gauge. **Hiyuki is the only named beneficiary
with any extracted gauge, and she is also the multi-source case** (the memory
`forte-extraction-fix` records that her second gauge / Dedication was flagged,
not applied).

This is the decision the next session should make first, because it sets the
whole shape of the work.

---

## Recommended approach — three increments, each independently shippable

### Increment 1 — the engine, proven on the one kit that has data

Smallest change that makes a gauge level reach a buff.

1. **`src/core/rotation-state.js`** (or a sibling `rotation-resources.js`):
   `computeResourceTimeline(rotation, skillMap, resourceDefs)` → per-step
   entering level per gauge. Lift the arithmetic from
   `rotation-graph.js resourceLevels()` and have the graph call the shared
   version — same numbers, one owner (DRY; the graph's copy is currently
   private).
2. **`src/core/sim.js`**: build that timeline once per rotation and put the
   step's levels on the per-step context the buff resolver already receives
   (alongside `fireCountByType`).
3. **`src/core/buffs.js` `scaleEffect()`**: add a third branch —
   `stackTrigger.type === 'resource'` → `stacks = floor(level / perStackCost)`,
   capped at `maxStacks` when known.
4. **Fix the null default.** A `maxStacks: null` effect with no resolvable
   trigger should not silently mean 1. Make the fallback explicit and visible
   (a `stacksUnknown` flag the UI renders, mirroring the `zeroReason` pattern
   from 2026-07-31 — a number the app can't derive must say so, never quietly
   pick one).

Verify on Hiyuki against her reference rotation; `npm run meta` and read LOCK B
— she is a P12 anchor, so her numbers WILL move and that is the point.

**Scope boundary for inc. 1:** off-field and hit-count gauge income stay out
(`rotation-rules.js:840` already declares this). Gauge income is per-CAST only.

### Increment 2 — the data

Extend gauge definitions to the kits that need them. Two sources, in order of
preference (the project's standing rule: authoritative game data over kit-text
parsing — see the `prefer-game-data-over-regex` memory):

1. **BinData**, the way `tools/extract-forte.mjs` already does. Check whether
   named stack gauges (Enflamement, Premixed Hue) live in the same tables as
   the Forte channels; `data/bindata/` dumps are committed.
2. **Curated `RESOURCE_DEFS`** (or a new `data/resource-defs.json` so it is
   hand-editable like `patch.json`) for what BinData won't yield. Sigrika's
   entry is the worked example of the shape.

Also settle `stackTrigger` extraction: all 13 are `{ type: 'unknown' }`, and
`tools/preprocess/effects.mjs:233-258` is where that is emitted.

### Increment 3 — downstream unlocks

Only after 1 + 2. Each is small on its own:

- **Tune Break** (#7): wire `computeTuneBreakDamage` with a rotation-step
  toggle, default OFF.
- **Changli IH0/IH1**, **Hiyuki Snow Rust S3.1/S6.0/S6.1**, **Lynae Lumiflow**.
- **Multi-gauge kits** (Galbrena; Aemeath's stars ≠ SpecialEnergy) — the
  layered-gauge mechanics the maintainer documented in `CLAUDE.md`.

---

## Invariants to respect

- **Team-buff paths are disjoint** (`CLAUDE.md`). A gauge-scaled buff that
  reaches teammates must pick exactly one of the three existing paths — adding
  a source never means duplicating.
- `build.rotation` stays a linear `string[]`; the resource timeline is
  sim-time-only, like the rotation graph.
- **`ENGINE_FILES`**: `buffs.js`, `sim.js` and any new `src/core/` engine module
  must stay in sync across `tools/optimize.mjs` and `tests/meta-schema.test.mjs`
  — a new module means adding it to both, and `engineHash` will move.
- Every new public `src/core/` function gets a test against real
  `wuwa-data.json`, not a fixture.

## Verification checklist

```bash
npm test && npm run sweep && npm run lint     # lint baseline: 1427 warnings, 0 errors
npm run data && git diff --stat data/wuwa-data.json    # LOCK A
npm run meta && git diff --stat data/wuwa-meta.json    # LOCK B — WILL move, by design
```

LOCK B moving is expected here (Hiyuki and Changli are both P12 anchors).
Attribute the movement **by team membership, not array position** — the
optimizer re-ranks, and position N before is not position N after. That mistake
has been made twice on this project.

## Open questions for the maintainer

1. **Scope:** engine-only against Hiyuki (inc. 1, ships in a session), or the
   full data extension too (inc. 1+2, multi-session)?
2. **Gauge income model:** per-cast only, or does hit-count income matter enough
   for the named kits to widen it now?
3. **The 11 `maxStacks: null` effects** are live today at 1 stack. Until a gauge
   feeds them, should they keep showing 1, or surface as "stacks unknown"?
   The second is more honest and matches the 2026-07-31 zero-value precedent,
   but it changes visible numbers on 11 resonators before any gauge exists.
