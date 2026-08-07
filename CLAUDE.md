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
data/buff-facts.json                      ← the game's own bucket per value (extract_buff_facts.py)
data/extra-effects.json                   ← the game's ExtraEffect enum (extract_extra_effects.py)
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
- **KISS:** Adhere to the KISS-principle to keep the codebase simple and easy to understand.
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
| Conditional effects default OFF | Any effect whose condition text contains `when / after / while / upon / duration` needs to be modelled if possible, if not defaults to OFF |
| An underivable stack count is ONE, and says so | `scaleEffect` resolves stacks from the user's count → a curated gauge → a `castMatch` trigger → else **1 stack + `stacksUnknown`**. NEVER fall back to `maxStacks`: a real cap makes that a large silent assertion (Lynae is 55%/stack to a cap of 25) |
| Gauge caps come from the GAME | `SpecialEnergy{N}Max` (BinData `baseproperty.json` → `extract-forte.mjs` → `resonator.specialEnergyCaps`) is authoritative for how many stacks a gauge holds. A curated `RESOURCE_DEFS` entry declares its `channel` and its literal `cap` is test-asserted equal. Gauge INCOME for a named stack gauge is NOT in the dumps (Changli's 40 damage instances all read `SpecialEnergy 0`) and stays curated |
| A stack BAND gates, `maxStacks` caps | A banded effect is one branch of a piecewise per-stack function (Yangyang: Xuanling is 10%/stack at 1-3 Havoc Bane, 12%/stack at 4-6). The band is tested against the RAW count and decides IF the branch applies; `maxStacks` then caps what it is WORTH. Never clamp before testing the band — a raw 4 would become 3 and light the wrong branch |
| Negative-status caps are BASE values | `NEGATIVE_STATUS_DEFS.maxStacks` is the base an enemy holds; kits RAISE it for a window (`STATUS_CAP_RAISES` — Xuanling S3 +3 Havoc Bane/20s). The timeline caps a stack at the limit in force WHEN IT LANDS and clamps the held total to the limit in force NOW, so excess falls away when a raise lapses. Repeats of one source refresh ("does not stack"); distinct sources sum. Do NOT "fix" a base cap to match a kit that raises it |
| Enemy abilities always hit | For anything enemy-related there is no miss, range or accuracy model. "on hit" / "within a certain range" / "nearby" are FIRING conditions that are always satisfied — model the effect, drop the qualifier, and do not hedge it as "the optimistic reading" |
| Stack cap + gain trigger are DESCRIPTION-scoped | The game states them in the sentence that GRANTS the stack, not the "Each stack …" value sentence. `descStackCap`/`descStackGain` read the whole description and return null rather than guess when it is ambiguous |
| Negative-status DMG does NOT crit | Its formula (`enemy-status.js`) has no crit term and no gear stat reaches it. A kit granting it ("can critically hit, with a **fixed** Crit. Rate of 80%") sets FIXED values that REPLACE crit — parsed onto `afflictionCritRate`/`afflictionCritDmg` so they never reach `resolveChainInherentContext`. Read as ordinary `critRate`/`critDmg` they buff every hit the wielder lands and push the build past the Crit Rate cap (Aemeath S6 was inflating her skill damage 4.1×) |
| A Resonance MODE is not a STATE | A mode is a build-level toggle, locked for the fight (`build.resonanceMode` → `effect.mode` → `modeGateOk`). `STATE_DEFS` is for in-combat states a CAST enters. Modelling a mode as a state makes it switch on mid-rotation and ignore the build's own toggle — and the state name can only ever match one mode, so it fires in the other one too. A roster-wide test forbids a state named after a mode |
| Status damage: solo builds its OWN enemy, teams SHARE one | `simulateRotation` resolves its own negative-status lane (`soloStatusDamage` → `totals.statusDamage`), so the build page counts it. `team-sim.js` must read `totals.skillDamage` per segment — a team has ONE enemy where stacks, cap raises and attribution cross members, and its own shared-timeline accrual owns that lane. Reading `totals.damage` there double-counts |
| A skill's LABEL comes from the game's name, its TYPE from the node | The game files a move under the input that casts it, which is not always what it calls the move (Aemeath's Mech basic chain sits in her Resonance Skill node). When a row's own name opens with a category, that category wins the label; the mechanical `skillType` never changes. Prefixing the node's category produced 18 self-contradicting labels like "Resonance Skill: Basic Attack — Mech Stage 4". PROVENANCE — how the move is reached — is always a TRAILING `· Forte Circuit` / `· Echo` marker, never a parenthetical on the category: "Heavy Attack (Forte)" reads as "a Forte kind of Heavy Attack", which is backwards. It must still be SAID (Cartethyia's normal and Forte Basic stages collide into identical labels without it) |
| Negative statuses are DATA, not folklore | Cap, stack lifetime, tick period and the per-stack multiplier all come from the game's own system buffs (`data/status-damage.json` ← `extract_status_damage.py`), one reserved buff id + `ExtraEffectID` per status — distinct from the KIT tables in `affliction-damage.json` (`ExtraEffectID 121`). Glacio Chafe's row reproduces the community-calibrated curve to the digit, which is what validates the rest. Do NOT re-derive these by observation: two of them had been sitting at exactly 0.8× the shipped values, and two dealt nothing at all |
| A status application is a NAMED cast, and its scope is the clause | Not every damaging step inflicts. The kit says which casts do and how many stacks (`tools/preprocess/status-apply.mjs` → `dataset.statusApplyRules`); a kit that says nothing keeps the every-damaging-step fallback. A description section is the whole FAMILY, so a clause must be gated by the **stage** it names (a "Stage 4" clause is otherwise inherited by stages 1–3) and by the **skill** it names, resolved only among the keys whose own section carries that clause. Four clause shapes mention a status without applying one: negations, conversions, cap raises, and a teammate's infliction the kit reacts to. The game's own applier buffs (`data/status-appliers.json` ← `extract_status_appliers.py`) bound the counts, but they cannot supply the skill list — `db_skill` holds 562 exploration rows and a sweep of all 482 `db_*.db` finds each applier referenced only from `db_buff`; the grant lives in the ability blueprints. A SEQUENCE NODE can grant a second applier the Forte's own list never mentions (Aemeath S3's Heavy Attacks, in `Instant Response`), so a curated rule carries the `minChain`/`state` gates its kit states |
| A clause that NAMES its skills is scoped by the NAMES | `tools/preprocess/skill-scope.mjs` binds both shapes the game writes — TARGET ("The DMG Multiplier of X is increased") and SUBJECT ("X and Y gain 300% Crit. DMG") — and the binding covers EVERY stat, not just `multiplierUp`. Once the names match they ARE the scope: the category read off the same clause is the weaker restatement and can contradict it outright (her Heavy Attacks are "considered Resonance Liberation DMG", so the clause parses `skillType: 'heavy'` while their hits carry `'liberation'`, and both gates together match nothing). A name that resolves to nothing leaves the effect exactly as it was, which is what keeps the pass safe — "Resonators in the team" resolves to nothing and stays team-wide |
| Same-instant mark events are ordered EXPLICITLY, not by epsilon | A step's start time IS the previous step's end time, so a consumption and the next cast's application share one number. `EVENT_ORDER` in `enemy-status.js`: a cast's own grant lands BEFORE the consumption it performs (so the cast spends it — measured 24 Trail → 34 → burst → 0), the application lands AFTER (it belongs to the next cast — measured, her Heavy lands 2 Trail right after a Duet emptied the target). A time offset cannot encode this: it must be smaller than any real gap between steps and larger than the sampler's "at this instant" tolerance, and no value is both |
| `build.rotation` is linear | Graph is built at sim time via `fromLinear()` — never persisted |
| Effect-slot keys are FROZEN before anything reads them | `S{level}.{index}` addresses effects from `effect-overrides.json` AND from a saved build's `effectStacks`, so any preprocess pass that changes an effect COUNT must run BEFORE the overrides. `bindSkillScopes` drops what it cannot scope; ordered after the overrides it silently moved Luuk Herssen's curated S6.0 patch onto a different effect |
| Tune Break is ONE per pass, for the whole team | The Off-Tune bar is the TARGET's and refills once per cycle, so three members in one pass share one opportunity (`capTuneBreaksPerPass`). It matters because the animation STOPS THE COMBAT CLOCK (measured `freeze_combat_clock_s` on all 68 rows, plus general invincibility and interrupt level 11) — an uncapped extra is damage at zero cost to the DPS denominator. The surplus is REMOVED, not zeroed, so nothing downstream sees a cast that did not happen. The build page still simulates every slotted response and only flags the extras |
| A trigger's category is not the effect's SCOPE | `SKILL_PHRASE_TO_TYPE` is read by `extractStructuralTrigger` (what fires it) AND `detectSkillType` (what it applies to). For a Tune Break the two are opposites — "After a Resonator deals Tune Break DMG, all Resonators deal 20% more DMG" is TRIGGERED by one and applies to EVERYTHING — so 'tuneBreak' is deliberately absent from that map and the trigger reads it from its own branch |
| The Interfered cap IS the responder count | Four kits state "the max stack limit of Tune Strain - Interfered on a target is increased by 1" and NONE states a base, so the limit is the number of responders on the team (`interferedCap`). The whole chain pays zero unless a responder, a Tune Break AND a Tune Strain - Shifting mark are all present, and a non-responder holding team-wide Tune Break Boost converts none of it — the payout clause lives on the responder's own Tune Break node, not on the stat |
| Team-buff paths are disjoint | Three team-wide application paths exist by construction (see `docs/ARCHITECTURE.md`, "Life of a buff"); a buff flows through exactly ONE — adding a source means picking a path, never duplicating |
| A value may PRECEDE its stat, and the parser fails SILENTLY | The game writes a grant both ways — "Fusion DMG Bonus is increased by 30%" and "gain 30% Fusion DMG Bonus" — and a reader that only looks forward returns nothing at all, with no warning and no diff. 109 of 324 buff clauses were unread that way. `pctFor` reads either direction from a STAT NAME; `pctNear` stays forward-only from a VERB, because what precedes a verb belongs to a different effect in the same sentence. Every buff clause is now either read or listed with its reason in `tests/effect-coverage.test.mjs` — that list is the contract, and it may only shrink |
| A sentence's leading TRIGGER is not the effect's SCOPE | The game names the cast that fires a buff before it names the buff: "After casting Intro Skill Applaud for Me!, Brant's DMG dealt is increased by 20%" is not an Intro-only buff, and "Casting Heavy Attack Mercy gives Calcharo 10% Resonance Liberation DMG Bonus" is not a Heavy one. Scope comes from the segment that OWNS the stat — `ownerSkillType` (last comma-free run before the verb) and `statScopeSkillType` (the words right in front of the stat phrase) — never from `detectSkillType` over the whole clause |
| An Outro Skill has NO level curve | Its `level` map is empty, so the row loop walks zero params and produces nothing — which is why 55 of 56 resonators shipped with no outro damage row and every swap scored 0. The multiplier is read from the sentence that STATES it and repeated across the level band. A resonator whose off-field actions carry an `outro` trigger (Galbrena, Calcharo, Rover: Havoc) must NOT also cast one: two paths, one cast |
| A mode-gated outro is a MENU, not one grant | "When in Resonance Mode - A, …. When in Resonance Mode - B, …" is two grants with their own values AND their own durations, of which exactly one is live. Read flat, Denia's outro took the value from one branch and the duration from the other and handed the mix to every build. Branches carry `outroBuffs[*].mode`, filtered at the hand-off against the OUTGOING member's `build.resonanceMode` |
| The BUCKET comes from the game, not from the sentence | `computeDamage` composes `(1 + dmgBonus) * (1 + amplify) * (1 + deepen)`, and the client's own `CharacterDamageCalculations.js` has the same shape: `t = 1 + Proto_DamageChange + elementBonus + attackTypeBonus` is ONE additive factor, while `Proto_SpecialDamageChange` and the target's `Proto_DamageReduce` are separate multiplicative ones. Which bucket a value lands in is NOT recoverable from kit text, because the game does not decide it from the wording — Sigrika's "targets take 30% more DMG" is SpecialDamageChange (multiplicative) and Cartethyia's "take 30% more DMG" is DamageChange (additive), same words. `data/buff-facts.json` is therefore the PRIMARY source and the text parse the fallback; the extractor drops any value whose bucket differs between two buffs of one owner rather than guessing. `multiplierUp` is never retargeted — it is the skill's own rate, not a bonus bucket |
| An element word before "DMG" may name a STATUS | "Fusion Burst DMG", "Glacio Chafe DMG" and "Aero Erosion DMG" open with an element but mean the negative status's own damage — a separate formula with no crit and no gear stat. The outro scope map matches the element only with "DMG" IMMEDIATELY after it, which is what keeps Denia's, Lucilla's and Ciaccona's outros out of the wielder's amplify bucket |
| `ExtraEffectReqPara` is indexed BY THE REQUIREMENT | The client loops `for ([index, type] of Requirements.entries())` and reads `RequirementPara[index]` (`ExtraEffectLibrary.ResolveRequireAndLimits`), so the para slot belongs to the requirement at the SAME position, not to the buff. Reading `para[0]` unconditionally mis-read 16 buffs whose skill list sits at index 1 behind an element or buff-stack gate (Galbrena's five, Cartethyia's five, Verina's four) — and silently dropped the scope each of them states. `ExtraEffectReqSetting` is the matching `CheckType`: **0 = every requirement must hold** (so two scope lists INTERSECT), **1 = any one does** (they UNION). Under ANY, a requirement that is not a scope at all lets the effect fire outside the list, so the list is not a scope — Ciaccona's `1407000060` fires on four named skills OR on DamageType 2 |
| A scope stated as BULLET ids routes through the bullet chain | `ExtraEffectRequirements` type 1 (SkillIds) and type 5 (BulletIds) both state scope as data, and both are checked by EXACT membership. A skill id is a PREFIX of our damage ids; a bullet id is not — it joins through `data/bullet-timings.json` (`bulletDamageIds`, the montage→bullet→damage chain) to a damage id and from there to a `hit-map.json` key. Type 5 is not a rare shape: 77 valued roster buffs use it against type 1's 106. Hiyuki's +500% Crit. DMG is stated ONLY this way, and the join is self-verifying — the bullets resolve to `liberation_inward_vision` + `liberation_blade_liberation`, which is her clause ("The Crit. DMG of Foreclaiming: Inward Vision and Foreclaiming: Blade Liberation") verbatim |

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

1. Full verification suite first (exception: full verification already ran last prompt) — never commit a broken state.
2. `git add -A`
3. Message structure: `[Phase/scope]: [imperative subject]`, a 2–3 sentence
   summary, then sections: What was implemented / Files changed / Files NOT
   touched (scope boundary) / Verification / References (implements, depends
   on) / Notes (deviations, deferred items). Use `git commit -F <tempfile>`
   for long messages.
