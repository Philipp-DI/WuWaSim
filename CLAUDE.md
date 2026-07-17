# CLAUDE.md — WuWaSim

Rules and invariants only. **This file states what IS; `docs/HISTORY.md`
records what HAPPENED** (the full P10→P13 chronicle and all session summaries
live there — append new summaries there, never here).

New to the project? Read in this order: `README.md` (run it) →
`docs/ARCHITECTURE.md` (how data flows) → `docs/GLOSSARY.md` (what words
mean) → this file (the rules).

---

## IDENTITY & CONTEXT

You are an expert Software Architect and Systems Engineer working on
**WuWaSim**, a Wuthering Waves damage simulator. Pure JavaScript (ES modules,
Node 18+, no framework, no bundler, browser + Node compatible).

**Goal:** Zero-defect, root-cause-oriented engineering for bugs; test-driven
engineering for new features. Think carefully; no need to rush.

**Code:** Write the SIMPLEST code possible. Keep the codebase minimal,
modular, and descriptive.

**Flow:** Keep it interactive where necessary — don't assume; ask for
confirmation/validation.

**Efficiency:** Be concise in chat output without diminishing product quality.

---

## PROJECT ORIENTATION

Browser-based team DPS simulator: players configure resonator builds, select
rotations, and get damage breakdowns per skill. The engine is pure math — no
network calls at sim time, no server.

- `index.html` — browser UI root; `src/ui/app.js` — UI wiring/routing
- `src/core/` — pure sim engine (import freely in Node tests)
- `data/wuwa-data.json` — compiled dataset (NEVER hand-edit; regenerate)

### Data pipeline

```text
data/extracted-nanoka/characters/*.json   ← source (56 files, schema v9)
data/patch.json                           ← manual overrides (hand-edit OK)
data/reference-rotations.json             ← curated reference rotations (hand-edit OK)
data/effect-overrides.json                ← curated effect triggers/windows (hand-edit OK)
data/forte-data.json                      ← committed Forte extraction (tools/extract-forte.mjs)
          ↓ node tools/preprocess.mjs
data/wuwa-data.json                       ← compiled output used by all sim code
data/data-version.json                    ← content-hash manifest (cache-buster)
          ↓ node tools/optimize.mjs
data/wuwa-meta.json                       ← P12/P13 weights + suggested builds/teams
docs/meta-validation.md                   ← generated QA report (gitignored)
```

Re-run `npm run data` (preprocess) whenever source data or a curated input
changes, then `npm run meta` (optimize) to refresh the meta. Never edit the
generated files directly. When an engine file changes, keep the `ENGINE_FILES`
lists in `tools/optimize.mjs` and `tests/meta-schema.test.mjs` in sync.

---

## ARCHITECTURE PRINCIPLES

- **DRY:** Extract shared logic into neutral `src/core/` modules; never import
  one feature module's internals from another.
- **Encapsulation:** Accessor methods over direct `_attribute` pokes.
- **Dead code:** Remove unused code, legacy systems, hardcoded values.
- **Performance:** List accumulation over `+=` in loops; iterative over
  recursive when stack depth matters.
- **No type ignores:** Fix the underlying issue.
- **Complete migrations:** Update all imports and remove old shims in the same
  change.
- **Maximum test coverage:** Every new public function in `src/core/` gets a
  test; prefer live tests exercising real `wuwa-data.json` over fixtures.
- **Rotation format:** `build.rotation` (linear `string[]`) is the persisted
  format. The rotation graph is sim-time-only (`fromLinear()`); never persist it.

## CODE STYLE — NAMING (Simplification Plan S3.1)

1. **Write words out.** `resonator` not `reso`; `weaponConditional` not
   `wcond`; `segment` not `seg`; `level`/`index`/`current` not `lv`/`idx`/`cur`.
2. **Sanctioned short names** (complete list): `i`/`j`/`k` for loop indices in
   loops ≤ 5 lines; `x`/`y` coordinates; `id`; `el` for a DOM element in UI
   code only. Everything else: ≥ 3 characters and a real word.
3. **Scope rule:** the farther a name travels, the more descriptive it must
   be. Destructured one-liners may stay terse; anything crossing ~10 lines or
   a function boundary gets a full name.
4. **One concept, one name** — fixed by `docs/GLOSSARY.md`; never
   `reso`/`char`/`member` for the same thing in different files.
5. Comments state constraints the code can't show — not what the next line
   does, not why a change is correct.

---

## CRITICAL INVARIANTS — NEVER VIOLATE

Breaking any one silently corrupts sim output.

| Invariant | Detail |
| --- | --- |
| `effectToggles` key format | `S{level}.{index}` for chain effects, `IH{node}.{index}` for inherent effects |
| `multiplierUp` matches NODE skillType | e.g. a `forte_heavy` node uses `'heavy'` for multiplierUp matching |
| DMG bonus matches FORMULA type | `dmgBonusBySkillType` keys match the `skillType` field in formula.js skill objects (fed `formulaType`, NOT the node skillType) |
| DMG-type (`formulaType`) is DATA-DRIVEN | Each raw damage instance carries the game's own type tag (`skill.damage[*].type`: 0 basic, 1 heavy, 2 liberation, 3 intro, 4 skill, 5 Echo Skill). `preprocess.mjs` maps each display row to its exact instances (`matchRowHits`, full rate-vector) and reads `formulaType` from them — NO kit-text parsing. Node `skillType` stays mechanical. Type 5 sets `isEchoSkill` only (keeps the mechanical `baseFormula`) |
| Cast triggers are MECHANICAL | `castMatch` trigger firing reads the node `skillType` only (`phraseTypesForStep` in sim.js), never `formulaType` — a Basic that deals converted Liberation damage is still a Basic CAST |
| Stat nodes authoritative source | Per-node `skillTreeBonuses` (col/tier) is authoritative; `dataset.skillTree` aggregated table is fallback only |
| Element DMG node mapping | `propId 22–27` → `elementId 1–6` (do not offset or reorder) |
| Conditional effects default OFF | Any effect whose condition text contains `when / after / while / upon / duration` is a toggle, defaults to OFF |
| `build.rotation` is linear | Graph is built at sim time via `fromLinear()` — never persisted |
| Team-buff paths are disjoint | Three team-wide application paths exist by construction (see `docs/ARCHITECTURE.md`, "Life of a buff"); a buff flows through exactly ONE — adding a source means picking a path, never duplicating |

---

## TEST COMMANDS

Run EVERY test file + the module-load sweep before and after any change.
A non-zero exit anywhere is a regression — do not proceed.

```bash
npm test        # all tests/*.test.mjs (tools/run-tests.mjs — whole directory, never a hand-picked list)
npm run sweep   # module-load sweep (tools/sweep-modules.mjs — imports EVERY src module; catches parse
                # errors and broken import paths; only src/ui/app.js is skipped, it needs a DOM)
npm run lint    # ESLint — correctness rules are ERRORS (CI-gating); style rules warn until S3/S4 ratchet
```

`npm test` / `npm run sweep` are plain Node (no install needed);
`npm run lint` and CI need `npm install` once (devDependencies only — the
runtime remains dependency-free). CI (`.github/workflows/ci.yml`) runs all
three on every push/PR.

New test files follow the existing pattern: plain Node, no framework,
`assert(name, cond)` helper, `process.exit(failed === 0 ? 0 : 1)`.

Generated-data locks for refactors (must show effectively zero diff when the
change is meant to be behavior-preserving):

```bash
npm run data && git diff --stat data/wuwa-data.json   # LOCK A
npm run meta && git diff --stat data/wuwa-meta.json   # LOCK B
```

Reading the locks: `generatedAt`/manifest-hash lines churn on every rerun —
ignore them (`git checkout --` the files if that's ALL that changed). LOCK B's
`engineHash` moves whenever an ENGINE_FILES member's content changes (even a
comment); any OTHER changed line in either file is a real behavior regression.

---

## KEY DATA SHAPES (quick reference)

```js
// OffFieldAction (src/core/off-field.js)
{ type: 'coordinated'|'turret'|'outroBurst', trigger: 'liberation'|'outro'|'skill'|'forte',
  element: number /* elementId 1–6 */, scaling: 'atk'|'def'|'hp', multiplier: number,
  hitsPerCast: number /* outroBurst only */, cooldown: number|null,
  duration: number|null /* null = whole window */, note: string,
  requiresState?: string /* e.g. 'maestro' */ }

// BuffEffect (src/core/buffs.js) — always use makeBuffEffect() factory
{ owner: 'resonator'|'weapon'|'echo'|'echoSet'|'outro'|'team',
  scope: 'self'|'active'|'teamWide'|'incomingResonator',
  stat: BuffStat, value: number /* fraction for % stats */,
  payload: object /* { elementId } | { skillType } | { duration } */, label: string }

// RotationGraph (src/core/rotation-graph.js)
{ nodes: Map<nodeId, { id, skillKey, index }>,
  edges: [{ from, to, kind: 'sequence'|'prerequisite'|'optional' }] }
// Do not add edge kinds without updating validateRotation + buildRuleGraph.
```

---

## COGNITIVE WORKFLOW

1. **ANALYZE:** Read relevant files. Do not guess.
2. **PLAN:** Map the logic; identify root cause; order changes by dependency.
3. **EXECUTE:** Fix the cause, not the symptom. Failing tests first.
4. **VERIFY:** All tests + module sweep. Confirm via output, not assumption.
5. **SPECIFICITY:** Do exactly as much as asked.
6. **PROPAGATION:** Propagate changes across all affected files.

## SUMMARY STANDARDS

Every session summary includes: **[Files Changed]**, **[Logic Altered]**,
**[Verification Method]**, **[Residual Risks]** ("none" only if truly none),
**[Updated Docs]** — update docs to match reality, preserving history
(strikethrough, not deletion). Append the summary to `docs/HISTORY.md`.

## TOOLS

Prefer built-in tools (grep, read_file, …) over manual workflows.
`wuwa-data.json` is 200k+ lines — grep with specific patterns, never read whole.

## COMMIT CONVENTIONS

When asked to commit (never push automatically; pushing is a separate,
explicit instruction):

1. Full verification suite first — never commit a broken state.
2. `git add -A`
3. Message structure: `[Phase/scope]: [imperative subject]`, a 2–3 sentence
   summary, then sections: What was implemented / Files changed / Files NOT
   touched (scope boundary) / Verification / References (implements, depends
   on) / Notes (deviations, deferred items). Use `git commit -F <tempfile>`
   for long messages.
