# Phase 10 — Engineering Brief

Phase 9 is complete and verified (12/12 regression checks, 16/16 module load).
This brief captures the survey data and architecture decisions Phase 10 starts
from, so the next session works from facts rather than re-discovery.

---

## P9 final state (what's solid)

| System | Module | Status |
|---|---|---|
| HP/DEF/ATK per-row scaling | `tools/preprocess.mjs` (`nodeRelatedPropId`, rate_lv correlation) | ✓ |
| Healing & shielding | `formula.js` (`computeSupport`), `skill.js` (`resolveSupport`) | ✓ |
| Off-field damage | `off-field.js`, `team-sim.js` | ✓ 9 resonators |
| Outro buffs (amplify) | `skill.js` amplifyContext, `team-sim.js` | ✓ |
| Skill descriptions | `preprocess.mjs` (`formatSkillDesc`), `damage-panel.js` | ✓ 996/996 |
| Stat node toggles | `stats.js` (`skillTreeContribution`) | ✓ incl. element DMG nodes |
| Chain / inherent effects | `buffs.js` (`parseEffectsFromDesc`, `collectActiveEffects`, `resolveChainInherentContext`) | ✓ 218 effects, 52/53 chars |

**Verification gate**: always run the runtime module-load sweep (not just
`node --check`) — ES-module strict-mode parse errors (e.g. orphaned `return`
from a bad edit) only surface on actual import. The sweep is in every recent
session's final test block.

---

## P10 work items, in dependency order

### 1. Mechanics-aware rotation graph
- **Stub ready**: `src/core/rotation-graph.js` defines `RotationGraph`,
  `fromLinear`/`toLinear`, `addPrerequisite`, `prerequisitesSatisfied`.
- **Edge kinds**: `sequence` (P9 linear maps 1:1), `prerequisite` (hard gate),
  `optional` (soft ordering).
- **Survey result**: **44 / 53 resonators** have prerequisite/state-gated
  rotation mechanics ("enhanced basics after Liberation", "consume all X",
  "while in Y state"). These become `prerequisite` edges.
- **Approach**: keep `build.rotation` (linear) as the persisted format; build
  the graph at sim time via `fromLinear` + a per-character prerequisite rule
  table. Do NOT migrate storage — graph is a sim-time view.
- **Stub note**: `prerequisitesSatisfied(graph, nodeId)` currently validates by
  *index order* (does the prereq appear earlier in the linear sequence). P10
  will add a runtime variant `prerequisitesSatisfied(graph, nodeId, completedSet)`
  for the state-tracked sim (item 2), where availability depends on what's
  actually been cast, not just position.

### 2. Off-field Phase 2 — state-tracked mechanics
Deferred from P9 because the concurrent-timeline model carries no per-window
state. Exact survey data:

| Resonator | Node | State |
|---|---|---|
| Phrolova | Liberation "Waltz of Forsaken Depths" | Maestro state |
| Phrolova | Forte "Rhapsody of a New World" | stacks, every 30s |
| Phrolova | Outro "Unfinished Piece" | Maestro state |
| Ciaccona | Liberation "Singer's Triple Cadenza" | Recital, periodic, stacks |
| Ciaccona | Forte "Symphony of Wind and Verse" | stacks |

- **Phrolova Hecate**: off-field damage conditional on being in Maestro state.
  Needs a state flag set by the Liberation/Outro and checked during off-field
  contribution windows.
- **Ciaccona Recital**: periodic sound waves during the Liberation Recital
  window — a time-bounded periodic emitter (like a turret, but gated by an
  active state rather than a fixed duration).
- **Design note**: extend `OffFieldAction` with an optional
  `requiresState: string` field; `computeOffFieldContribution` checks the
  member's active states for that window. State activation comes from the
  rotation graph (item 1) — hence the ordering.

### 3. Conditional effect stacks & states
P9 surfaces chain/inherent effects as on/off toggles. P10 models the stack/state
logic behind them:
- Carlotta Deconstruction stacks, Snowforged Blade counts, etc.
- Extend the effect object with `stackable: true`, `maxStacks: N`,
  `perStack: value`; UI shows a stack stepper instead of a checkbox.
- The parser (`parseEffectsFromDesc`) already isolates the condition text —
  extend it to detect "per stack" / "up to N stacks" and emit stack metadata.

### 4. Echo set optimizer
- Combinadic substat enumeration over the legal substat pool.
- `setConstLut` caching: precompute the constant (non-substat) portion of the
  damage once per rotation, then only vary substats — avoids re-resolving the
  full rotation per candidate.
- Target: suggest optimal echo main/sub configuration for a chosen rotation.

### 5. Echo grading & UI/UX polish
- Substat roll-quality grading (vs. theoretical max).
- General polish pass.

---

## Data pipeline reference (unchanged from P9)

- Primary source: `data/extracted-nanoka/characters/*.json` (56 files)
- Compiled output: `data/wuwa-data.json`
- Re-run: `node tools/preprocess.mjs`
- Schema: v8
- Manual overrides: `data/patch.json` (e.g. Jiyan/Rebecca off-field multipliers
  that have no parseable value in nanoka — still TODO if sourced)

## Key invariants to preserve

- `effectToggles` keyed `S{level}.{index}` (chain) / `IH{node}.{index}` (inherent).
- `multiplierUp` matches NODE skillType; dmg bonuses match FORMULA type.
- Stat nodes: per-node `skillTreeBonuses` (col/tier) is authoritative; legacy
  `dataset.skillTree` aggregated table is fallback only.
- Element DMG nodes: propId 22–27 → elementId 1–6.
- Conditional effects default OFF (when/after/while/upon/duration → toggle).
