# CLAUDE.md — WuWaSim

Rules and invariants only. **This file states what IS; `docs/history/` records
what HAPPENED** — one summary file per session (`YYYY-MM-DD-<topic>.md`).
`docs/HISTORY.md` (frozen P10→P13 chronicle, ~900 KB) and `docs/OPEN-ITEMS.md`
(~170 KB): grep them, never read them whole.

Background docs — open on demand, not up front: `docs/ARCHITECTURE.md` (how
data flows), `docs/GLOSSARY.md` (what words mean), `README.md` (how to run it).

---

## IDENTITY & CONTEXT

You are an expert Software Architect and Systems Engineer working on
**WuWaSim**, a Wuthering Waves damage simulator. Pure JavaScript (ES modules,
Node 18+, no framework, no bundler, browser + Node compatible).

**Goal:** Zero-defect, root-cause-oriented engineering for bugs; test-driven
engineering for new features. Think carefully; no need to rush.

**Code:** Write the SIMPLEST code possible. Keep the codebase minimal,
modular, and descriptive. Adhere to KISS-principle (Keep It Stupid & Simple).

**Flow:** Keep it interactive where necessary — don't assume; ask for
confirmation/validation.

**Efficiency:** Be concise in chat output without diminishing product quality. Token-efficiency trumps quick results. Delegate verification and data lookups to the project subagents (`verifier`, `data-scout` in `.claude/agents/`); their models are fixed there.

---

## PROJECT ORIENTATION

Browser-based team DPS simulator: players configure resonator builds, select
rotations, and get damage breakdowns per skill. The engine is pure math — no
network calls at sim time, no server.

- `index.html` — browser UI root; `src/ui/app.js` — UI wiring/routing
- `src/core/` — pure sim engine (import freely in Node tests)
- `data/wuwa-data.json` — compiled dataset (NEVER hand-edit; regenerate)

Data pipeline (sources, pinned upstream, FModel export, preprocessing): see
`.claude/rules/data-pipeline.md`. Never edit the generated files directly. When
an engine file changes, keep the `ENGINE_FILES` lists in `tools/optimize.mjs`
and `tests/meta-schema.test.mjs` in sync.

---

## PRINCIPLES

Standing goal (maintainer, 2026-07-31): mirror in-game behaviour (self-consistent is not done), data-driven wherever possible, minimal regex in parsers, app code a junior dev can follow. The reasoning and incidents behind each rule: `docs/PRINCIPLES.md`.

- **Honesty over results.** Reports state what is red, what changed and what was not verified. Never silence a check, weaken a test or soften a failure to reach green; an honest red report beats a workaround (maintainer, 2026-10-06).
- **Data first.** Read the field the game ships (BinData, nanoka per-instance fields) before parsing kit text. A surviving regex is the narrow fallback and refuses to guess: a null the UI can show beats a plausible wrong number. A gap in an old source is a data gap, never a curated exception. Prefer a build-time `tools/` extractor with committed output over runtime parsing in `src/`.
- **Contradictions are findings.** When the data contradicts an instruction, the maintainer's included, report the measurement and ask; never execute it quietly, refuse it, or split the difference. Data plus maintainer confirmation is settled: record it (invariant, test or `source` note) so it is not re-derived. With neither, say the number is unknown.
- **Inferred is not verified.** An undocumented field's meaning is a hypothesis until checked (several examples, structural evidence, in-game test); label it "hypothesis, unverified" in code and docs until then. Asked how something works, trace the running code through a concrete example; don't restate the docstring.
- **No silent zeros.** Show a legitimate zero or "can't compute yet" with its measured reason: core returns a reason code, the UI words it. Never swallow an exception into an empty state; when a value can't be computed, fall back to a measure that always exists and label it.
- **Verified means independently derived.** Before an investigative finding is marked done, at least two independent `verifier` subagents DERIVE it from sources that are independent for that claim (code, data, prose; a generated field is not independent of the code that generates it, while the game's own text and tables usually are). Each gets the claim and the method and answers CONFIRMED / PARTIALLY CONFIRMED / REFUTED / UNDETERMINED with `file:line` evidence. Record disagreements. Verifiers are read-only; a check that needs a modified tree is run by the main session, which lists every working-tree change and confirms the restore.

---

## ARCHITECTURE PRINCIPLES

- **DRY:** Extract shared logic into neutral `src/core/` modules; never import
  one feature module's internals from another.
- **Encapsulation:** Accessor methods over direct `_attribute` pokes.
- **Dead code:** Remove unused code, legacy systems, hardcoded values.
- **Performance:** List accumulation over `+=` in loops; iterative over
  recursive when stack depth matters.
- **KISS:** Adhere to the KISS-principle to keep the codebase simple and easy to understand.
- **No type ignores:** Fix the underlying issue.
- **Complete migrations:** Update all imports and remove old shims in the same
  change. On any file move, re-check `__dirname`/`import.meta.url` relative paths.
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
6. **No warning sweeps.** The remaining id-length warnings (`tests/`, `src/ui/`,
   `docs/*.mjs`) get renamed when a file is next decomposed, never in a standalone pass.

---

## CRITICAL INVARIANTS — NEVER VIOLATE

Breaking any one silently corrupts sim output. The cross-cutting ones live here;
area-specific ones live in `.claude/rules/` (see INSTRUCTION FILES below).

| Invariant | Detail |
| --- | --- |
| Effect-slot key format | `S{level}.{index}` for chain effects, `IH{node}.{index}` for inherent effects. Used by `effect-overrides.json`, `build.effectStacks`, and every effect-keyed UI strip |
| `multiplierUp` matches NODE skillType | e.g. a `forte_heavy` node uses `'heavy'` for multiplierUp matching |
| DMG bonus matches FORMULA type | `dmgBonusBySkillType` keys match the `skillType` field in formula.js skill objects (fed `formulaType`, NOT the node skillType) |
| Stat nodes authoritative source | Per-node `skillTreeBonuses` (col/tier) is authoritative; `dataset.skillTree` aggregated table is fallback only |
| Element DMG node mapping | `propId 22–27` → `elementId 1–6` (do not offset or reorder) |
| Conditional effects default OFF | Any effect whose condition text contains `when / after / while / upon / duration` needs to be modelled if possible, if not defaults to OFF |
| Abilities always hit | Every resonator ability lands on the enemy: there is no miss, range or accuracy model. "on hit" / "within a certain range" / "nearby" are FIRING conditions that are always satisfied — model the effect, drop the qualifier, and do not hedge it as "the optimistic reading". Enemy attacks are not modelled at all: an effect that needs the wielder to be hit or to take damage cannot fire on its own, so it is a user toggle, OFF by default. |
| `build.rotation` is linear | Graph is built at sim time via `fromLinear()` — never persisted |
| Effect-slot keys are FROZEN before anything reads them | `S{level}.{index}` addresses effects from `effect-overrides.json` AND from a saved build's `effectStacks`, so any preprocess pass that changes an effect COUNT must run BEFORE the overrides. `bindSkillScopes` drops what it cannot scope; ordered after the overrides it silently moved Luuk Herssen's curated S6.0 patch onto a different effect |

## INSTRUCTION FILES

Area rules live in `.claude/rules/` and load when you Read, Edit or Write a matching file; when planning an area without opening its files, read its rules file first. Code comments cite invariants as `CLAUDE.md, "<title>"`: grep the title in this file and in `.claude/rules/`. Rules state current truth; a rule's history lives in `docs/history/rules/`, behind its `History:` pointer. New area-specific rules go there too; `tests/instruction-files.test.mjs` keeps this file at or under 200 lines and 15 KB.

| Rules file | Covers |
| --- | --- |
| `data-pipeline.md` | sources, pinned upstream, FModel export, preprocessing |
| `generated-data-locks.md` | LOCK A / LOCK B, `engineHash`, line endings |
| `invariants-effects.md` | effect-text parsing and scoping |
| `invariants-damage.md` | buckets, crit, DEF/RES, attribution, damage rows |
| `invariants-resources.md` | fight start state, gauges, states, modes, chain nodes, rotation |
| `invariants-status.md` | negative statuses, Tune Break, target stacks |
| `invariants-team-gear.md` | team, external, echo, sonata and weapon buffs |
| `invariants-extraction.md` | ConfigDB/BinData enums, policies, id spaces |
| `invariant-rover.md` | Rover gender identity in the timing and skill joins |
| `invariants-optimizer.md` | team ranking, suggestions, live weights |
| `engine-data-shapes.md` | OffFieldAction, BuffEffect, RotationGraph |
| `tests.md` | the plain-Node test-file pattern |

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

After UI-touching changes, also smoke-test the build and team pages in a browser;
without a browser tool, list that under **[Residual Risks]**.

Hooks (`.claude/settings.json`, scripts in `tools/hooks/`) lint every edit (plus the sweep for `src/` and the guard for instruction files) and gate every stop: once files outside `docs/` changed, the sweep, lint (no errors, and no new warnings in changed scripts) and `npm test` must pass before you can finish. Fix what they report; never work around a hook. When the fix needs the user's decision, ask: a final question hands a red tree to them (strict unattended runs excepted).

Generated-data locks (LOCK A `npm run data`, LOCK B `npm run meta`) for
behavior-preserving refactors: see `.claude/rules/generated-data-locks.md`.

---

## COGNITIVE WORKFLOW

1. **ANALYZE:** Read relevant files. Do not guess.
2. **PLAN:** Map the logic; identify root cause; order changes by dependency.
3. **EXECUTE:** Fix the cause, not the symptom. Failing tests first.
4. **VERIFY:** All tests + module sweep. Confirm via output, not assumption. `npm test` runs LAST: verifiers, stashes and `npm run data`/`meta` rewrite engine bytes.
5. **SPECIFICITY:** Do exactly as much as asked.
6. **PROPAGATION:** Propagate changes across all affected files.

## SUMMARY STANDARDS

Every session summary includes: **[Files Changed]**, **[Logic Altered]**, **[Verification Method]**, **[Residual Risks]** ("none" only if truly none), **[Updated Docs]** — update docs to match reality, preserving history. Ordinary docs use strikethrough. Instruction files (`CLAUDE.md`, `.claude/`) state current truth only: rewrite the rule, move the superseded text, measurements and narrative verbatim into `docs/history/rules/<file>.md` (one `## <title>` section per rule), and leave a `History:` pointer in the rule. Write the summary to a new file `docs/history/YYYY-MM-DD-<topic>.md`; never append to `docs/HISTORY.md`.

## TOOLS

Prefer built-in tools (Grep, Glob, Read, …) over manual workflows.
`wuwa-data.json` is 200k+ lines — grep with specific patterns, never read whole.

## COMMIT CONVENTIONS

When asked to commit (never push automatically; pushing is a separate,
explicit instruction):

0. Trunk-based: commit on the current branch, `main` included. Branch only when asked, or for a substantial feature, rework or new topic (maintainer, 2026-10-07).
1. Full verification suite first (exception: full verification already ran last prompt) — never commit a broken state.
2. `git add -A`
3. Message structure: `[Phase/scope]: [imperative subject]`, a 2–3 sentence
   summary, then sections: What was implemented / Files changed / Files NOT
   touched (scope boundary) / Verification / References (implements, depends
   on) / Notes (deviations, deferred items). Use `git commit -F <tempfile>`
   for long messages.
