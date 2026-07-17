# SIMPLIFICATION-PLAN — Streamline WuWaSim for junior-dev onboarding

**Status:** APPROVED by maintainer 2026-07-17. **S1 (knowledge rescue) SHIPPED
same day** — docs/ + CLAUDE.md tracked, CLAUDE.md split (lean rules +
`HISTORY.md`), `ARCHITECTURE.md` + `GLOSSARY.md` written, README "Start here"
added, local-only material moved to `docs-local/` (gitignored), generated
`meta-validation.md`/`effect-audit.md` stay gitignored. **S2 (guardrails)
SHIPPED same day** — package.json (`npm test`/`sweep`/`lint`/`data`/`meta`),
ESLint flat config (45 initial errors burned to 0, dead code removed;
2,496 style warnings = measured S3/S4 backlog), src/core/types.js JSDoc
typedefs + jsconfig.json, GitHub Actions CI. **S3 (naming pass) SHIPPED
2026-07-17** in 4 rename-only commits (~1,250 variables via a scope-aware
espree/eslint-scope codemod): the §S3.2 table is eliminated repo-wide;
src/core, tools, and src/data are 100% id-length-clean and RATCHETED to
error; warnings 2,496 → ~1,630, all in test bodies and the three large UI
components — those get renamed during their §S4.2 decomposition rather
than touched twice. Next up: S4 (monolith splits).
**Goal:** A developer new to the project can trace any number on screen back to
its source data within an afternoon, using only files tracked in git.
**Prime directive:** Every phase in this plan is behavior-preserving. No sim
output, no meta ranking, no UI behavior changes anywhere. The full test suite +
module sweep must pass after every single step, and the two generated-data
checks (below) lock the data pipeline byte-for-byte.

---

## 0 · Diagnosis — why the project stopped being followable

These are the five root causes, ranked by how much confusion each one produces.
The plan's phases map to them one-to-one.

### 0.1 The project's knowledge is invisible (worst offender)

`git ls-files` shows **only `README.md` and `tools/optimize/README.md` are
tracked as documentation**. Everything else — all 26 design docs in `docs/`
(phase instruction sets, `TIMING_MODEL.md`, `TEAM-EFFECT-MODEL.md`,
`energy-signal-findings.md`, the investigation docs) **and `CLAUDE.md`
itself** — is gitignored. A fresh clone contains a 5 MB data file, ~24k lines
of source, and essentially no explanation.

Worse, `CLAUDE.md` (1,262 lines) has become a reverse-chronological
**changelog**, not an instruction file. The genuinely load-bearing content
(the CRITICAL INVARIANTS table, the data-pipeline diagram, test commands)
is ~150 lines buried inside ~1,100 lines of "what happened on 2026-07-XX".
Even the maintainer needs archaeology to find the current rules.

### 0.2 Four monolith files hold most of the complexity

| File | Lines | What's crammed in |
| --- | --- | --- |
| `src/ui/components/build-editor-v2.js` | 4,012 | one `mount()` containing ~80 nested render/menu/panel functions |
| `tools/preprocess.mjs` | 3,122 | download, text resolution, character/weapon/echo/sonata projection, energy-rate matching, formula types, cooldowns, forte — 8+ concerns |
| `src/core/sim.js` | 1,056 | solo sim + buff windows + step annotation + display helpers |
| `src/core/team-sim.js` | 1,013 | `simulateTeamRotation` alone spans ~740 lines (L110–849) |

Everything else in `src/core/` is already reasonably sized (69–865 lines) and
has good module-header comments. The problem is concentrated, which is good
news — it can be fixed surgically.

### 0.3 The buff system is one concept spread across seven files

A "buff" can currently enter the damage math through **three disjoint
team-wide paths** plus several solo paths, spread across `buffs.js`,
`buff-timeline.js`, `sonata-buffs.js`, `conditional-buffs.js`,
`weapon-buffs.js`, `sim.js`, and `team-sim.js`. The paths are documented
only in gitignored CLAUDE.md history entries. Nobody new can answer
"where does a +15% ATK team buff actually get applied?" without a guided tour.

### 0.4 Abbreviated names that travel too far

Declaration tally across `src/core/`: `s` ×20, `e` ×14, `t` ×12, `m` ×8,
`v` ×7, `reso` ×7, `st` ×6, `idx` ×6, `lv` ×5, plus `wpass`, `wcond`,
`scond`, `seg`, `cur`, `arr`, `sk`. A single-letter name in a 3-line loop is
fine; `reso` and `wcond` crossing 100+ lines of `resolveTotalStats` is where
reading comprehension dies.

### 0.5 Zero guardrails

No `package.json`, no `npm test`, no linter, no formatter, no CI, no
type-checking. The excellent 50-file test suite exists, but running it
requires copying a shell loop out of a gitignored file. Nothing catches an
undeclared variable, an unused import, or a new 500-line function before a
human does.

---

## 1 · The two pipeline locks (used by every phase)

Because `wuwa-data.json` and `wuwa-meta.json` are generated, refactors of the
tools have a perfect, mechanical correctness check:

```bash
# LOCK A — preprocess refactor is behavior-preserving:
node tools/preprocess.mjs && git diff --stat data/wuwa-data.json data/data-version.json
# must show ZERO diff

# LOCK B — engine/optimizer refactor is behavior-preserving:
node tools/optimize.mjs && git diff --stat data/wuwa-meta.json
# must show ZERO diff (engineHash changes only when ENGINE_FILES content changes —
# a pure file MOVE changes the hash; see §6 risk table)
```

Plus the standing gate after every step:

```bash
npm test          # once S2 lands; until then the tests/*.test.mjs loop
npm run sweep     # module-load sweep
```

---

## 2 · Phase S1 — Knowledge rescue (zero code risk, do first)

**Why first:** it's the highest-leverage step, touches no executable code, and
every later phase wants to link to these docs.

### S1.1 Track the docs

- Remove `docs/` and `CLAUDE.md` from `.gitignore`.
- Move the truly-local/binary material out of `docs/` first so it stays
  untracked: `docs/screenshots/`, `docs/resonator-art/`,
  `docs/design_handoff_wuwa_sim/`, `docs/repomix-state.md` → a new
  `docs-local/` (gitignored). Everything that is *words about the system*
  gets committed.

### S1.2 Split CLAUDE.md into its three real documents

| New file | Content | Size target |
| --- | --- | --- |
| `CLAUDE.md` (tracked) | Identity, CRITICAL INVARIANTS table, data-pipeline diagram, test commands, commit conventions, code-style rules (§S3.1 below), pointers to the docs | ≤ 200 lines |
| `docs/HISTORY.md` | The entire P10→P13 chronicle, moved verbatim (append-only from now on; new entries go here, never back into CLAUDE.md) | unbounded |
| `docs/ARCHITECTURE.md` | New — see S1.3 | ~300 lines |

Rule going forward: **CLAUDE.md states what IS; HISTORY.md records what
HAPPENED.** A CLAUDE.md that only changes when a rule changes stays readable.

### S1.3 Write `docs/ARCHITECTURE.md` — the "life of a number" doc

The single document a new dev reads end-to-end. Contents:

1. **The 60-second summary** — what the app does, the zero-build-step
   constraint, the pure-core/UI split.
2. **Data pipeline** — the existing README diagram, extended with the meta
   pipeline and the manifest/cache-buster.
3. **Life of a damage number** — one worked trace, with file:line anchors:
   nanoka JSON row → `preprocess.mjs` skill-map entry → `loader.js` →
   `build.rotation` step → `sim.js` `simulateRotation` → `skill.js` /
   `formula.js` per-hit math → `applyBuffsToSteps` scaling → UI step bar.
4. **Life of a buff** — the decision tree: where each buff kind
   (chain/inherent effect, weapon passive, weapon/sonata conditional clause,
   sonata window buff, echo aura, outro transfer) is parsed, which of the
   solo/team paths applies it, and where it shows up in the UI. This is the
   §0.3 antidote and mostly exists already inside CLAUDE.md history — it
   needs consolidating, not researching.
5. **Life of a team sim** — segment sequence (intro/rotation/outro ×
   members × passes), the team-time axis, `teamBuffTimeline` accrual,
   openers/cooldowns/energy as overlays, what `enforceConcerto`,
   `deriveOpeners`, `timingMode` actually toggle.
6. **Module map** — every file under `src/` and `tools/` with a one-line
   responsibility (most module headers already contain this line — harvest,
   don't rewrite).
7. **Where numbers are curated by hand** — `patch.json`,
   `reference-rotations.json`, `effect-overrides.json`, `rotation-rules.js`
   tables, `skill-map.json` cast times — the "if the sim disagrees with the
   game, look here first" list.

### S1.4 Write `docs/GLOSSARY.md`

Two tables. Game terms (resonator, forte, concerto, sonata, outro/intro,
resonance energy) and **project-invented terms** (anchor, grant, window vs
flat, `formulaType` vs `skillType`, amplify vs DMG bonus, opener padding,
segment, pass, erOverride). The project-invented half is the one a junior
dev cannot google.

### S1.5 README "Start here" section

Five lines at the top: run it, run the tests, read ARCHITECTURE.md, read
GLOSSARY.md, read CLAUDE.md for the rules.

**Definition of done (S1):** a fresh `git clone` contains everything needed
to answer: "Where does Carlotta's Liberation multiplier come from, which
buffs scale it, and why is it Skill-DMG-bucketed?" — without asking anyone.

---

## 3 · Phase S2 — Guardrails (make quality automatic)

**Why second:** the renames (S3) and splits (S4) become dramatically safer
once a linter catches typos and `npm test` is one command.

### S2.1 `package.json` + cross-platform test runner

The project stays dependency-free at *runtime*; dev-dependencies are fine
(they never ship — GitHub Pages serves static files).

- `tools/run-tests.mjs` — tiny Node script: glob `tests/*.test.mjs`, spawn
  each, collect failures, exit non-zero on any. Replaces the bash/PowerShell
  loop pair (Windows/POSIX divergence disappears).
- `tools/sweep-modules.mjs` — the module-load sweep as a real file (currently
  it lives only as a heredoc inside gitignored CLAUDE.md; move the import
  list into code so adding a module updates one tracked place).
- Scripts: `npm test`, `npm run sweep`, `npm run data` (preprocess),
  `npm run meta` (optimize), `npm run lint`.

### S2.2 ESLint (flat config, `eslint` + `@eslint/js` only)

Start with `recommended` plus exactly the rules that encode this plan's
goals — not a style bikeshed:

```js
// eslint.config.js (excerpt) — the intent, exact limits tunable
'id-length': ['warn', { min: 3, exceptions: ['i', 'j', 'k', 'x', 'y', 'id', 'el', 'db', 'on', 'to'] }],
'max-lines-per-function': ['warn', { max: 80, skipComments: true }],
'no-unused-vars': 'error',
'complexity': ['warn', 12],
```

Introduce as **warnings** first (the codebase will light up), ratchet to
errors per-directory as S3/S4 clean each area. CI treats new *errors* as
failures immediately.

### S2.3 Gradual JSDoc types (no TypeScript migration)

- `src/core/types.js` — central `@typedef` file for the shapes that already
  have prose schemas in comments: `Build`, `TotalStats`, `SimResult`,
  `SimStep`, `BuffWindow`, `TeamSimResult`, `SkillMapEntry`, `OffFieldAction`.
- `jsconfig.json` with `checkJs: false` globally; opt files in with
  `// @ts-check` as they get touched. This gives IDE autocomplete and real
  type errors with zero build step and zero `type: ignore` pressure —
  consistent with the existing "no type ignores" rule.

### S2.4 CI (GitHub Actions)

One workflow, three jobs on push/PR: `npm test`, `npm run sweep`,
`npm run lint`. Optionally a fourth: run LOCK A + LOCK B and fail if the
committed generated files are stale relative to their inputs.

**Definition of done (S2):** a contributor who has never read any doc gets
told by the machine when they break a test, leave dead code, or write a
5-letter-soup variable.

---

## 4 · Phase S3 — Naming pass (mechanical, low risk)

### S3.1 The convention (goes into the slimmed CLAUDE.md)

1. **Write words out.** `resonator`, not `reso`; `weaponConditional`, not
   `wcond`; `segment`, not `seg`; `level`, not `lv`; `index`, not `idx`;
   `current`, not `cur`.
2. **Sanctioned short names** (complete list): `i`/`j`/`k` for loop indices
   in loops ≤ 5 lines; `x`/`y` for coordinates; `id`; `el` for a DOM element
   only in UI code. Everything else: three characters minimum, and a real word.
3. **Scope rule:** the farther a name travels, the more descriptive it must
   be. A destructured one-liner may stay terse; anything crossing ~10 lines
   or a function boundary gets a full name.
4. **Domain vocabulary is fixed by the glossary** — one concept, one name,
   everywhere (never `reso`/`char`/`member` for the same thing in three files).

### S3.2 The rename table (initial sweep targets)

| Current | Rename to | Main habitats |
| --- | --- | --- |
| `reso` | `resonator` | stats.js, build.js, several UI files |
| `wpass` / `wcond` / `scond` | `weaponPassive` / `weaponConditional` / `sonataConditional` | stats.js, sim.js, conditional-buffs.js |
| `sk` | `skill` | preprocess.mjs, skill.js |
| `seg` | `segment` | team-sim.js, team-editor-v2.js |
| `st` | `state` or `stacks` (it means both — split it) | rotation-state.js, buffs.js |
| `lv`, `idx`, `cur`, `arr`, `mult` | `level`, `index`, `current`, list-specific name, `multiplier` | roster-wide |
| single-letter locals outside sanctioned list | word for what they hold | roster-wide |

### S3.3 Execution rules

- One module (or one small cluster) per commit; **rename only, zero logic
  edits** in those commits — reviewable at a glance, `git blame` stays useful.
- Full `npm test` + sweep per commit. LOCK A after any `tools/` rename,
  LOCK B after any `src/core/` rename.
- Public export names that change (e.g. if any exported symbol is abbreviated)
  must have all import sites updated in the same commit — the existing
  "complete migrations" rule.

---

## 5 · Phase S4 — Split the monoliths

Ordered easiest-first; each has an exact verification lock. All splits are
**pure moves** — cut functions into new modules, re-export nothing legacy,
update imports (browser ES modules make this free; no bundler involved).

### S4.1 `tools/preprocess.mjs` → `tools/preprocess/` (LOCK A verifies)

Safest split in the project: it's a batch tool whose entire observable output
is one JSON file.

```text
tools/preprocess.mjs            → thin CLI entry (args, orchestration)
tools/preprocess/
  download.mjs                  fetchJson, downloadAll, nanoka asset URLs
  text.mjs                      text resolver, cleanText, placeholder logic
  resonators.mjs                projectNanokaCharacterFull + helpers (the ~700-line core)
  formula-types.mjs             matchRowHits, resolveInstanceFormula, rate-vector matching
  energy.mjs                    per-hit energy/concerto accounting, rowHitTotals
  cooldowns.mjs                 cooldown-row + echo-CD extraction
  weapons.mjs / echoes.mjs / sonatas.mjs
  forte.mjs                     forteGen stamping (reads data/forte-data.json)
```

### S4.2 `build-editor-v2.js` → `src/ui/components/build-editor/` folder

Split along the section boundaries the file already draws with `// ===`
banners: `header.js`, `resonator-card.js`, `skill-levels.js`, `echoes.js`
(slot card + substats + sonata strip + menus), `rotation.js` (palette +
timeline + presets), `stat-priority.js`, `suggested-teams-panel.js`, with
`index.js` keeping `mount()` as the composition root that owns state and
`commit()`. Verification: the existing `build-editor-v2.test.mjs` +
`echo-picker-v2.test.mjs` + manual smoke of every panel.

The shared-state question (many panels close over `build`/`paint`) is the one
real design decision here: pass an explicit `context` object (`{ build,
dataset, commit, paint }`) to each panel module. No framework, no store —
just arguments instead of closures.

### S4.3 `team-sim.js` — extract stages, keep the file

`simulateTeamRotation`'s ~740 lines are a *pipeline*, so the fix is naming
the stages, not scattering them: extract in-file (or to
`team-sim-stages.js`) functions like `buildSegmentPlan()`,
`runMemberPass()`, `accrueTeamBuffTimeline()`, `applyOffFieldContributions()`,
`summarizeTotals()` — each ≤ 80 lines with a header comment. LOCK B verifies
(team-sim.js is in ENGINE_FILES — see §6).

### S4.4 `sim.js` — same treatment, later

Split display-oriented helpers (`shortBuffLabel`, `fillEchoDesc`,
step-annotation) from the math core once S4.3 has established the pattern.
Lowest urgency of the four: its module header is already excellent.

---

## 6 · Phase S5 — Buff-path consolidation (highest risk, do last, optional)

Not a rewrite — a *legibility* pass on the one genuinely tangled concept:

1. **Name the paths in code.** A short manifest block at the top of
   `buffs.js` (mirroring ARCHITECTURE.md §4) listing the three team-wide
   paths, their entry functions, and their disjointness guarantee — so the
   next reader learns in 20 lines what currently takes an afternoon.
2. **Colocate:** move `buff-timeline.js`, `sonata-buffs.js`,
   `conditional-buffs.js`, `weapon-buffs.js` under `src/core/buffs/`
   (pure move; LOCK B).
3. **Only if the maintainer wants it later:** unify flat-vs-windowed under
   one interface once the remaining flat sources (weapon/sonata conditional
   clauses — the open item in TEAM-BUFF-TIMELINE-PLAN) get window
   derivation. That is feature work, not simplification, and stays out of
   this plan's scope.

---

## 7 · Risks and how each is pinned

| Risk | Mitigation |
| --- | --- |
| `ENGINE_FILES` lists in `tools/optimize.mjs` + `tests/meta-schema.test.mjs` go stale when core files move/rename | Update both in the same commit as any move (they must stay in sync — existing rule). A pure move changes `engineHash` → `wuwa-meta.json` diff will show the hash line; **any other diff line is a real regression** |
| Import-path breakage in the browser (no bundler to catch it) | The module sweep already covers `src/core` + key modules; S2.1 extends the sweep list to every `src/` module so a bad path fails in CI, not in a user's browser |
| Renames silently colliding with dynamic property access (`obj[name]`) | Rename commits are logic-free and reviewed as diffs; the 50-file suite + LOCK A/B are the backstop; grep for the old name after each rename commit (`git grep -n '\breso\b'` must come back empty) |
| Doc split loses history | HISTORY.md is moved *verbatim*, and git history preserves everything from the moment docs are tracked |
| Plan fatigue — refactor stalls halfway | Every phase is independently valuable and independently shippable; there is no state where the repo is worse than today |

---

## 8 · Suggested order & effort

| Phase | Effort (sessions) | Risk | Payoff |
| --- | --- | --- | --- |
| S1 knowledge rescue | 1–2 | none | a new dev can self-serve; the maintainer regains the map |
| S2 guardrails | 1 | none | one-command test/lint/CI; safety net for everything after |
| S3 naming | 1–2 | low | code reads as words; the stated user goal |
| S4.1 preprocess split | 1 | low (LOCK A) | the scariest file becomes 8 explainable ones |
| S4.2 build-editor split | 1–2 | medium (UI, manual smoke) | the biggest file becomes navigable |
| S4.3 team-sim stages | 1 | medium (LOCK B) | the densest logic gets named stages |
| S4.4 sim.js split | 0.5 | low | consistency |
| S5 buff colocation | 0.5–1 | medium | the last conceptual tangle gets a map |

Recommended stopping point if time is short: **S1 + S2 + S3 alone deliver
most of the "junior dev can follow it" goal** — the monolith splits improve
navigation, but the docs + names are what create understanding.

---

## 9 · Explicit non-goals

- **No TypeScript, no bundler, no framework, no test-framework migration.**
  The zero-build-step property is a feature; dev-tooling (ESLint, CI) never
  touches the runtime.
- **No behavior changes, no sim-model changes, no data-shape changes.**
  Feature work (Lane B cast times, weapon/sonata window derivation, Tier-2
  combo curation) continues on its own track, unblocked by this plan.
- **No storage-format changes** — `build.rotation` stays linear, per the
  standing invariant.
