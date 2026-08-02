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
| Effect-slot key format | `S{level}.{index}` for chain effects, `IH{node}.{index}` for inherent effects. Used by `effect-overrides.json`, `build.effectStacks`, and every effect-keyed UI strip |
| `multiplierUp` matches NODE skillType | e.g. a `forte_heavy` node uses `'heavy'` for multiplierUp matching |
| DMG bonus matches FORMULA type | `dmgBonusBySkillType` keys match the `skillType` field in formula.js skill objects (fed `formulaType`, NOT the node skillType) |
| DMG-type (`formulaType`) is DATA-DRIVEN | Each raw damage instance carries the game's own type tag (`skill.damage[*].type`: 0 basic, 1 heavy, 2 liberation, 3 intro, 4 skill, 5 Echo Skill). `preprocess.mjs` maps each display row to its exact instances (`matchRowHits`, full rate-vector) and reads `formulaType` from them — NO kit-text parsing. Node `skillType` stays mechanical. Type 5 sets `isEchoSkill` only (keeps the mechanical `baseFormula`) |
| Cast triggers are MECHANICAL | `castMatch` trigger firing reads the node `skillType` only (`phraseTypesForStep` in sim.js), never `formulaType` — a Basic that deals converted Liberation damage is still a Basic CAST |
| Stat nodes authoritative source | Per-node `skillTreeBonuses` (col/tier) is authoritative; `dataset.skillTree` aggregated table is fallback only |
| Element DMG node mapping | `propId 22–27` → `elementId 1–6` (do not offset or reorder) |
| Conditional effects default OFF | Any effect whose condition text contains `when / after / while / upon / duration` is a toggle, defaults to OFF |
| An underivable stack count is ONE, and says so | `scaleEffect` resolves stacks from the user's count → a curated gauge → a `castMatch` trigger → else **1 stack + `stacksUnknown`**. NEVER fall back to `maxStacks`: a real cap makes that a large silent assertion (Lynae is 55%/stack to a cap of 25) |
| Gauge caps come from the GAME | `SpecialEnergy{N}Max` (BinData `baseproperty.json` → `extract-forte.mjs` → `resonator.specialEnergyCaps`) is authoritative for how many stacks a gauge holds. A curated `RESOURCE_DEFS` entry declares its `channel` and its literal `cap` is test-asserted equal. Gauge INCOME for a named stack gauge is NOT in the dumps (Changli's 40 damage instances all read `SpecialEnergy 0`) and stays curated |
| A stack BAND gates, `maxStacks` caps | A banded effect is one branch of a piecewise per-stack function (Yangyang: Xuanling is 10%/stack at 1-3 Havoc Bane, 12%/stack at 4-6). The band is tested against the RAW count and decides IF the branch applies; `maxStacks` then caps what it is WORTH. Never clamp before testing the band — a raw 4 would become 3 and light the wrong branch |
| Negative-status caps are BASE values | `NEGATIVE_STATUS_DEFS.maxStacks` is the base an enemy holds; kits RAISE it for a window (`STATUS_CAP_RAISES` — Xuanling S3 +3 Havoc Bane/20s). The timeline caps a stack at the limit in force WHEN IT LANDS and clamps the held total to the limit in force NOW, so excess falls away when a raise lapses. Repeats of one source refresh ("does not stack"); distinct sources sum. Do NOT "fix" a base cap to match a kit that raises it |
| Enemy abilities always hit | For anything enemy-related there is no miss, range or accuracy model. "on hit" / "within a certain range" / "nearby" are FIRING conditions that are always satisfied — model the effect, drop the qualifier, and do not hedge it as "the optimistic reading" |
| Stack cap + gain trigger are DESCRIPTION-scoped | The game states them in the sentence that GRANTS the stack, not the "Each stack …" value sentence. `descStackCap`/`descStackGain` read the whole description and return null rather than guess when it is ambiguous |
| Negative-status DMG does NOT crit | Its formula (`enemy-status.js`) has no crit term and no gear stat reaches it. A kit granting it ("can critically hit, with a **fixed** Crit. Rate of 80%") sets FIXED values that REPLACE crit — parsed onto `afflictionCritRate`/`afflictionCritDmg` so they never reach `resolveChainInherentContext`. Read as ordinary `critRate`/`critDmg` they buff every hit the wielder lands and push the build past the Crit Rate cap (Aemeath S6 was inflating her skill damage 4.1×) |
| A Resonance MODE is not a STATE | A mode is a build-level toggle, locked for the fight (`build.resonanceMode` → `effect.mode` → `modeGateOk`). `STATE_DEFS` is for in-combat states a CAST enters. Modelling a mode as a state makes it switch on mid-rotation and ignore the build's own toggle — and the state name can only ever match one mode, so it fires in the other one too. A roster-wide test forbids a state named after a mode |
| Status damage: solo builds its OWN enemy, teams SHARE one | `simulateRotation` resolves its own negative-status lane (`soloStatusDamage` → `totals.statusDamage`), so the build page counts it. `team-sim.js` must read `totals.skillDamage` per segment — a team has ONE enemy where stacks, cap raises and attribution cross members, and its own shared-timeline accrual owns that lane. Reading `totals.damage` there double-counts |
| A skill's LABEL comes from the game's name, its TYPE from the node | The game files a move under the input that casts it, which is not always what it calls the move (Aemeath's Mech basic chain sits in her Resonance Skill node). When a row's own name opens with a category, that category wins the label and the node's `(Forte)`/`(Echo)` annotation is kept; the mechanical `skillType` never changes. Prefixing the node's category produced 18 self-contradicting labels like "Resonance Skill: Basic Attack — Mech Stage 4" |
| Negative statuses are DATA, not folklore | Cap, stack lifetime, tick period and the per-stack multiplier all come from the game's own system buffs (`data/status-damage.json` ← `extract_status_damage.py`), one reserved buff id + `ExtraEffectID` per status — distinct from the KIT tables in `affliction-damage.json` (`ExtraEffectID 121`). Glacio Chafe's row reproduces the community-calibrated curve to the digit, which is what validates the rest. Do NOT re-derive these by observation: two of them had been sitting at exactly 0.8× the shipped values, and two dealt nothing at all |
| A status application is a NAMED cast, and its scope is the clause | Not every damaging step inflicts. The kit says which casts do and how many stacks (`tools/preprocess/status-apply.mjs` → `dataset.statusApplyRules`); a kit that says nothing keeps the every-damaging-step fallback. A description section is the whole FAMILY, so a clause must be gated by the **stage** it names (a "Stage 4" clause is otherwise inherited by stages 1–3) and by the **skill** it names, resolved only among the keys whose own section carries that clause. Four clause shapes mention a status without applying one: negations, conversions, cap raises, and a teammate's infliction the kit reacts to. The game's own applier buffs (`data/status-appliers.json` ← `extract_status_appliers.py`) bound the counts, but they cannot supply the skill list — `db_skill` holds 562 exploration rows and a sweep of all 482 `db_*.db` finds each applier referenced only from `db_buff`; the grant lives in the ability blueprints |
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
