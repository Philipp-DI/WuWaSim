# Phase 10 — Engineering Brief (COMPLETE)

Phase 10 is complete and verified (72/72 tests passing, 11/11 module loads).
All five work items shipped.

**Final verification:**

```text
rotation-validation:  17 passed, 0 failed
rotation-state:       15 passed, 0 failed
conditional-effects:   9 passed, 0 failed
off-field-state:      11 passed, 0 failed
stackable-effects:    20 passed, 0 failed
module-load sweep:    OK (11/11)
```

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

---

## P10 final state

### 1. Mechanics-aware rotation graph ✓

- `src/core/rotation-graph.js`: `RotationGraph`, `fromLinear`/`toLinear`, `buildRuleGraph`, `validateRotation`.
- `src/core/rotation-rules.js`: 26 prerequisite rules across Carlotta, Hiyuki, Jinhsi, Changli, Phoebe, Cantarella.
- Rotation panel shows advisory warnings (amber banner + per-step hover explanations). Never blocks.
- `build.rotation` (linear `string[]`) is the persisted format. Graph is sim-time only.
- Test: `test/rotation-validation.test.mjs` (17 assertions).

### 2. Off-field Phase 2 — state-tracked mechanics ✓

- `OffFieldAction.requiresState?: string` — optional field; skips contribution when state not active.
- `computeOffFieldContribution` takes `memberStates` param; skips if `stateActive(memberStates, action.requiresState)` is false.
- `stateActive`: fuzzy substring match between active state names and trigger string.
- `team-sim.js` computes `offMemberStates` per off-field member via `computeStateTimeline` + `stateDefsForResonator`.
- **Phrolova (1608)**: STATE_DEF — Maestro, enter on `types: ['liberation']`, persist. `patch.json` offFieldAction with `requiresState: 'maestro'`.
- **Ciaccona (1407)**: STATE_DEF — Recital, enter on key `liberation_improvised_symphonic_poem_skill`, persist. `patch.json` offFieldAction with `requiresState: 'recital'`.
- Test: `test/off-field-state.test.mjs` (11 assertions). Note: tests manually apply `patch.json` to dataset because `patch.json` is merged at runtime by `loader.js`, not by `preprocess.mjs`.

### 3. Conditional effect stacks ✓

- `tools/preprocess.mjs`: `COND_STACK_RE` detects per-stack clauses; `MAX_STACKS_RE` extracts max stacks. Effects with per-stack clauses emit `stackable: true`, `perStack`, `maxStacks`. 11 stackable effects across 9 resonators.
- `src/core/buffs.js`: `scaledEffect(e, key, toggles)` multiplies `perStack × stackCount`. `collectActiveEffects` calls it before pushing.
- `src/core/build.js`: `setEffectToggle` stores integers ≥ 0 as stack counts (not booleans).
- `src/ui/components/build-editor.js`: `renderEffectChip` shows `±1` stack stepper for stackable effects. Default count = 0 for situational effects (not `maxStacks`).
- Test: `test/stackable-effects.test.mjs` (20 assertions).

### 4. Echo set optimizer ✓

- `src/core/echo-optimizer.js`: `suggestEchoSubstats(build, dataset, target) → { slots: SuggestedSlot[] }`.
- `SUBSTAT_CATALOGUE`: 13 entries at max roll values.
- Algorithm: per echo slot, greedy 5-round selection (try all remaining candidates, pick highest-DPS delta). ~325 `simulateRotation` calls total.
- Also suggests best main stat by trying all valid options for that cost tier.
- UI: "Optimize" button in echoes section header; `renderOptimizerResults` displays per-slot suggestions inline.

### 5. Echo grading & UI/UX polish ✓

- `src/ui/components/echo-stat-editor.js`: `substatGrade(s, statRanges)` → `round(actual / maxRoll × 100)`.
- Grade badges per substat row: `grade--high` (≥ 80 %), `grade--mid` (60–79 %), `grade--low` (< 60 %).
- `renderEchoEfficiencyBadge` — average grade across filled substats, shown in sub stats section header.

---

## Key invariants preserved

- `effectToggles` keyed `S{level}.{index}` (chain) / `IH{node}.{index}` (inherent).
- `multiplierUp` matches NODE skillType; dmg bonuses match FORMULA type.
- Stat nodes: per-node `skillTreeBonuses` (col/tier) authoritative; `dataset.skillTree` fallback only.
- Element DMG nodes: propId 22–27 → elementId 1–6.
- Conditional effects default OFF (when/after/while/upon/duration → toggle).
- `build.rotation` is linear; graph is a sim-time view only.

## Data pipeline reference

- Primary source: `data/extracted-nanoka/characters/*.json` (56 files)
- Compiled output: `data/wuwa-data.json`
- Re-run: `node tools/preprocess.mjs`
- Schema: v8
- Runtime overrides: `data/patch.json` (merged by `src/data/loader.js`, NOT by `preprocess.mjs`)
