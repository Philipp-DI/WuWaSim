# WuWaSim — Status Report (2026-07-10)

**Method:** Full read-only audit against `docs/P13-INSTRUCTION-SET.md` as baseline, cross-checked against `CLAUDE.md`'s claimed-shipped narrative, the maintainer's own open-item docs (`MANUAL_NOTES(To-Do).md`, `COMBO-ENTRY-CURATION.md`, `effect-audit.md`), the planning/architecture docs (`AUTO-OPTIMIZER-ENGINE-PLAN.md`, `PHASE0-ARCHITECTURE.md`, `PHASE10-BRIEF.md`, `TEAM-EFFECT-MODEL.md`), the design-handoff READMEs, and the live code/data/tests. Six audit passes, each independently evidence-gated (file:line or grep/command output required per finding, no speculation). No files were edited — pure audit.

---

## 0. Executive Summary

The project is in a **healthy, green state**: all 50 test files pass (0 failures), the module-load sweep is clean, the data pipeline is fresh (manifest hashes recompute byte-identically, no pending regen), and the git tree is clean on `main`. P13 (team suggestions + team-level ER + 3-way comparison) is **substantially shipped** — the precompute side (synergy hints, team enumeration, team ranking, `meta.teams` schema) matches the spec closely, all P13-relevant tests pass (2,370+ assertions), and the hybrid ER-resolution core (`team-er.js`) is correctly implemented and tested.

The three things most worth the maintainer's attention:

1. **5 of the 6 P12-seeded anchors (Carlotta, Jinhsi, Changli, Phoebe, Cantarella) get zero suggested teams.** Only Hiyuki does. This inverts the spec's coverage intent — the curated `SYNERGY` table only derives from 3 hand-picked `CURATED_TEAMS`, none of which include those five. This is a curation-content gap, not an engine bug.
2. **The team-level ER numbers the engine computes are invisible to users.** `resolveErTarget()` has zero UI consumers anywhere in `src/`. All the work in team-context ER resolution (the P13-fix-2/3/4/5 series, the closed-form sweep, the +5% margin) currently reaches no one. This is explicitly blocked on the §10 team-screen decision — except that decision **was already made and shipped** (see #3).
3. **Several maintainer to-do items are stale, not open.** `MANUAL_NOTES(To-Do).md` still lists "§10 team-sim screen overhaul — blocked on a visual-language decision" and "§G buff-bar icons — needs an asset" as open, but both were fully shipped weeks ago (the classic `.ts-*` team CSS was deleted entirely on 2026-06-25; buff-bar icon assets and wiring exist and render today). `CLAUDE.md` itself repeats the stale "no UI consumer yet — waits on §10" framing. **The actual blocker on item #2 above is not a pending design decision — it's simply that nobody has wired `resolveErTarget` into the now-existing team-sim screen.**

Beyond that, the real remaining work is concentrated in: full-text/stat search (never implemented anywhere), the echo-set optimizer + substat roll-grading (fully **removed** in commit `b5688ea`, not merely deferred — `README.md` still claims it shipped), the non-energy resource-gauge engine feature (Forte/Substance/Concerto-class gauges — blocks Changli IH0/IH1 and Hiyuki Snow Rust), and the Tune Break damage formula (calibrated but not wired into the live sim, pending an "off-tune buildup" gauge model).

---

## 1. P13 Spec Compliance — `docs/P13-INSTRUCTION-SET.md`

### 1a. Shipped & verified (no action needed)

| Area | Status |
|---|---|
| §3 `synergy-hints.js` (ROLE, CHARACTER_ROLES, SYNERGY, pairKey) | ✅ All present, dataset-integrity-tested. SYNERGY is *derived* from a `CURATED_TEAMS` co-membership table rather than hand-authored pairwise entries — a more disciplined, equivalent shape. `tests/synergy-hints.test.mjs`: 105/105 pass. |
| §4 `team-enum.js` (determinism, MAIN_DPS conflict rule, sustain requirement, cap=30) | ✅ Matches spec; adds an undocumented-but-justified play-order rule (supports first, carry last) for the order-dependent team sim. `tests/team-enum.test.mjs`: 166/166 pass. |
| §5/§6 team pass + `meta.teams` schema | ✅ 8 anchors × 8 teams; every team has `members/score/roles/reason/erOverride`; `erOverride` covers all 192 member entries; `appearsIn` 100% consistent with `byCharacter`. `tests/meta-schema.test.mjs`: 1971/1971 pass. |
| §7 `team-er.js` `resolveErTarget()` | ✅ Correctly implements the hybrid contract: no team context → character-level default; matching team → per-member override; unmatched team → character-level fallback; never null when character-level data exists. Pure over the passed meta (core does not import `src/data/`, matching the architecture rule). `tests/team-er.test.mjs`: 20/20 pass. |
| §8a/§8b/§8c build-page surfaces | ✅ `suggested-teams.js` + `build-editor-v2.js` render ranked teams, the exact spec empty-state copy ("No team suggestions available for this character yet."), the "OPEN IN TEAM SIM" action (`loadTeamIntoSim`), and the reverse "appears in teams" lookup. `tests/suggested-teams.test.mjs`: 16/16 pass. |
| §11/hard-req 10 team QA section | ✅ Present in `docs/meta-validation.md` with per-anchor spot-check guidance and an honest ER-caveat paragraph. |
| Hard-req 1 (pruning), 5 (uncovered → no suggestion), 6 (stale meta = absent), 7 (no prescriptive verdict), 8 (single enemy), 9 (determinism) | ✅ All MET, verified with direct evidence. |

### 1b. Open gaps

- **[MEDIUM] 5/6 P12 anchors have no suggested teams.** `meta.teams.byCharacter` anchors are `1108, 1109, 1209, 1210, 1211, 1508, 1509, 1510` — only Hiyuki (1108) from the P12 six. Carlotta/Jinhsi/Changli/Phoebe/Cantarella get zero candidates because `SYNERGY` derives solely from 3 `CURATED_TEAMS` entries, none of which include them, and `generateCandidates` requires the anchor to carry positive affinity to at least one teammate (`team-enum.js:142`). They still show the honest empty-state fallback (never-fabricate is respected) and do appear as *members* of others' `appearsIn`. **Fix path:** author more `CURATED_TEAMS` entries covering these five — pure curation-content work, no engine change needed. `CLAUDE.md`'s "8 anchors" claim is technically true but doesn't flag this inversion.
- **[MEDIUM] `resolveErTarget` has zero UI consumers.** Grep across all of `src/` finds it only at its own definition. The team-sim screen and the 3-way comparison instead show the *current equipped build's* ER (`compare-v2.js:199,524` renders `resolveTotalStats().energyRegen`), not the computed team-context *target*. All 79 real (non-provisional) team-ER numbers in the meta reach no user. `CLAUDE.md` documents this as blocked on "the §10 team-screen overhaul decision" — but see §5 below: that decision was already made and the team screen already shipped on the new system. The actual remaining work is simply: import `team-er.js` into `team-editor-v2.js`/`compare-v2.js` and render the target alongside/instead of the equipped value.
- **[LOW] §9a/§9b: the 3-way comparison does not compose the P11 team-sim component.** Spec requires each compared team to render as a full P11 `team-sim-grid` instance (per-character columns, step breakdown, buff bar) under a shared header; hard-req 4 forbids duplicating that rendering logic. Reality: `compare-v2.js` renders its own compact TEAM TOTALS / PER MEMBER / DAMAGE SHARE table sourced from the maintainer's own "compare page" design handoff, and never mounts the P11 view. This avoids the *letter* of hard-req 4 (nothing is duplicated — it's omitted, not copy-pasted) but the spec's literal requirement (full P11 instance per column) is unimplemented. No explicit maintainer sign-off on this specific deviation was found in `CLAUDE.md`, though the shipped shape (compact comparison table) is documented as intentional.
- **[LOW] §9a comparison header omits "Total heal/shield".** `compare-v2.js`'s TEAM TOTALS renders DPS/DMG/DURATION/HEAL but no shield row, even though `team-rank.js` and the sim both produce `totals.shield`.
- **[LOW] §5a.4 "mechanic interaction fired" score term is absent; §10's "higher-synergy team outranks a lower one" is untested and not actually guaranteed.** The shipped score is pure normalized sim damage (`teamDamage / top`), with curated teams pinned first as a compensating mechanism (documented in-code as a reasoned deviation, since affinity is used only to prune, never to rank). No test asserts synergy-affinity correlates with rank, because under the current design it wouldn't hold.
- **[LOW] §6 team-pass observability is weaker than "ideally resumable, per-anchor".** `optimize.mjs` prints one aggregate summary line after the whole team pass completes, not per-anchor progress, and has no partial-resume capability.
- **[INFO/doc-stale] `CLAUDE.md`'s "78/192 real erOverride entries" is off by one** — the committed meta actually has 79 non-provisional + 113 provisional = 192. Cosmetic only.

### 1c. Documented, maintainer-approved deviations (not bugs)

- The §5a.2 per-member ER *sweep* was replaced by a steady-state **closed-form** minimum-ER calculation (energy is linear in own ER, so no sweep loop is needed) — approved 2026-07-02, and the +5% margin (hard-req 2) is preserved and tested on all 79 computed entries (`ER_MARGIN=1.05`, `tests/team-rank.test.mjs:40`). Real targets land 129–189%, above the spec QA band's "typically 110–130%" — documented as conservative upper bounds because enemy-dependent generation and the Concerto/intro-swap economy remain unmodeled by maintainer direction.
- `meta.teams` carries several fields beyond §5b's schema (`curated`, `archetype`, `modes`, `teamDamage`, `teamTime`, `teamDps`, `perMember`, and a whole extra `teams.memberBuilds` transparency section) — all additive, none conflict with the spec, and they're consumed by the "INSPECT BUILDS" UI affordance.

---

## 2. Test Suite & Data Pipeline Health

**All green — no regressions, no drift.**

- **50/50 test files pass, 0 failures.** Notable counts: `meta-schema` 1971, `stage-grants` 286 (matches `CLAUDE.md`'s claimed growth exactly), `team-enum` 166, `synergy-hints` 105, `energy-per-hit` 26 (10+ named anchors locked, confirmed by direct inspection), `concerto` 24, `enemy-status` 45.
- **Module-load sweep: clean.** The 22-module sweep from `CLAUDE.md` prints OK; all 24 additional `src/` files not in that list also import cleanly in Node except `src/ui/app.js` (expected — it touches `document` at import time as the browser entry point).
- **Git tree clean**, `main` up to date with `origin/main`. Recent history matches the documented P13 arc exactly.
- **Data pipeline verified fresh without regenerating anything:** `data/data-version.json`'s content hashes (`data: c720598b1471`, `meta: 55eb1814b3ad`) recompute **byte-identically** from the committed `wuwa-data.json`/`wuwa-meta.json` using the generators' own hash recipes. mtime ordering is also clean (every generator/curated input is older than its output). **No regen is pending.**
- **`tools/audit-effects.mjs` claims verified without running the file-writing CLI** (it writes `docs/effect-audit.md`, so it was not executed per the read-only audit rule): recomputing via the I/O-free `tools/effect-audit.js` library against the current dataset yields `totalEffects=212, totalWarnings=50, totalDeferred=6, gate=CLEAR` — exactly matching `CLAUDE.md`'s "54 → 50 unresolved" claim.
- **[INFO] `docs/effect-audit.md` is one dataset-regen behind** (written 2026-07-05, but `wuwa-data.json` was regenerated 2026-07-06 by the weapon-picker/nanoka-substat commit). Content is verified identical when recomputed live — harmless, just a stale timestamp on a gitignored local QA artifact. Re-run the CLI next convenient time to refresh it.
- **[LOW/open] 13 calibration cases still pending in-game capture** — `tests/calibration.test.mjs` passes but self-reports this every run (`docs/CALIBRATION.md`, dated 2026-06-13). Standing, not a regression.

---

## 3. Maintainer To-Do List Reality Check — `docs/MANUAL_NOTES(To-Do).md`

### 3a. Items the doc marks open that are actually DONE (doc needs updating)

- **"make resonance chain effects reliable, so no more toggle is needed"** — **DONE.** `effectToggles` is deprecated (`build.js:268-270`); conditional effects now auto-resolve from rotation context (`buffs.js:427` `isEffectOnAtStep`); no toggle checkbox exists in the editor.
- **"weapon pickers are different"** — **DONE** (commit `dcf22b4` "Unify weapon picker"). Both `build-editor-v2.js` and `team-editor-v2.js` import the single shared `openWeaponPicker` from `weapon-picker.js`.
- **§10 "team-sim screen overhaul... blocked on visual-language decision"** — **DONE, and the doc is significantly stale.** The classic `.ts-*` team CSS was **fully deleted** in commit `1784620` ("retire classic UI", 2026-06-25) — `styles/team.css` now has 10 `.bv2-*` selectors and zero `.ts-*` selectors. `team-editor-v2.js` (895 lines) already implements per-step bars, buff-window rendering, damage-share visualization, and drag-and-drop editing, all on the `.bv2` system. **The decision this item describes as pending was resolved and shipped weeks before the doc's current wording was written.** `CLAUDE.md` repeats the same stale framing ("waits on the §10 team-screen overhaul decision") — that line should be corrected: the actual remaining work is narrowly "wire `resolveErTarget` into the already-shipped team screen" (see §1b above), not a design decision.
- **§G "buff-bar icons — needs an asset + a rule from you"** — **DONE.** `assets/icons/misc/{gen-buff-icon,defensive-buff-icon,buff-simple}.png` exist; `buff-bar.js:34-36` (`iconSlugFor`) + line 92 (`iconHtml`) wire them into every rendered buff strip.
- **"most to gain" echo should only consider substats** — **DONE.** `live-weights.js:87-90` (`echoUpgradeRanking`) explicitly zeroes off-priority substats and mainstat is already excluded from the ranking.

### 3b. Items confirmed still genuinely open

- **Full-text / stat / effect search — not implemented anywhere.** `echo-picker-v2.js:56` and `roster-v2.js:47` both filter on `name` only. Directly corroborated by the `CANT-SEARCH-FOR-STAT-FLAG.png` screenshot filename in `docs/screenshots/`.
- **Tune-Break trigger toggle (default OFF)** — not wired. `enemy-status.js` models Tune Break status/damage, but no dedicated "requires extra action" toggle exists in `team-sim.js`/`rotation-triggers.js`; only a forward-looking comment in `rotation-state.js:34`.
- **Echo templates feature** — open. Only a *rotation* template/preset system exists; no echo-build template.
- **Echo dupe verification (no duplicate echo in the same sonata set)** — open. `echo-rules.js:17` only guards duplicate *substats on one echo*, a different check entirely.
- **Echo outro wiring (Lucilla → Hiyuki Glammoth combo)** — open, no related code found in `src/core`.
- **Basic ATK restructuring (description-first layout)** — open, only label maps exist.
- **Enemy-level carryover across independent builds** — open; `enemyLevel` is a per-page UI input only (`build-editor-v2.js:2869,3533`), no shared/persisted state.
- **Popover keyboard navigation** — confirmed still Escape-only (`modal-picker.js:45-47`), matching the doc's own "catalogued residual risk" framing (this one is accurately tracked, not stale).
- **Resonator-themed colouring** — experimental only. `styles/palette_{aemeath,iuno,augusta,lucilla}.css` exist but are gitignored (`palette_*`) and referenced nowhere in `index.html`/`src/` — local scratch work, not a shipped feature.

### 3c. `docs/COMBO-ENTRY-CURATION.md` vs. code

Doc claims the 2026-07-05 Tier-1 desk pass brought coverage from 8 → 20 fully-verified characters, with ~25 Tier-2 characters still needing in-game verification (list enumerated in the doc, matches `CLAUDE.md`'s "~26" figure). Cross-check: `rotation-rules.js`'s `STAGE_GRANTS` + `ROTATION_RULES` tables together key **32 distinct character ids** — higher than "20" because the tables also carry earlier-phase entries predating the Tier-1 pass (Denia's state machine, Sigrika's resource gates, the original Yinlin/Danjin swap-in grants). **Not a contradiction** — different counting basis (raw table coverage vs. "verified per the Tier-1 protocol"). Doc is accurate as written.

---

## 4. Code-Level Findings

- **No genuine TODO/FIXME/HACK/stub-marker debt in `src/` or `tools/`.** A combined-pattern sweep found only false positives (HTML `placeholder` attributes, template-string "`{n}` placeholder" comments) and intentionally-documented `deferred` references to `data/effect-overrides.json`'s tracked deferred-effects map.
- **All 4 "MVP hardening pass" claims in `CLAUDE.md` independently reverified and confirmed:** `kamera-import.js` deleted; `buildSonataLUT`/`clearSonataLUT` removed from `stats.js`; `amplifyContextToEffects`/`sonataParsedBuffToEffects`/`filterActiveBuffs` removed from `buffs.js`; the weapon `dmgBySkillType` merge fix is present at `stats.js:529-530`.
- **`enforceConcerto`** confirmed engine-only (no UI toggle exists, default `false`, matches "opt-in" description). **`isEchoSkill`** confirmed unconsumed outside `tools/preprocess.mjs`, exactly as `CLAUDE.md` states.
- **Echoes panel WIP status:** the *picker overlay* (`echo-picker-v2.js`, implementing `design_handoff_wuwa_sim/echo picker/README_echo_picker.md`) is complete for its own scope — no stubs, fully tested. The **separate, larger** "echoes panel v2" redesign (substat group boxes, connector "neck", sonata quick-switch — `design_handoff_wuwa_sim/echopanel-v2/README.md`) actually landed in `build-editor-v2.js`, not in the picker file, and is **functionally complete except for one cosmetic naming gap**: the spec's "TOTAL SUBSTATS" footer exists as `renderSubstatTally()` but is labeled `"SUBSTATS"` in the rendered UI, not verbatim `"TOTAL SUBSTATS"`.
- **`README.md`'s "Project layout" section (lines 96–117) is stale** — it still lists `styles/picker.css` and `src/ui/components/character-picker.js`, neither of which exists (both Glob-confirmed absent, superseded by `roster-v2.js`/the v2 style set). Should be updated to the current file layout.
- **`README.md:154`** still describes "Echo grading & UI/UX polish ✓" with grade badges as shipped — **this is now false** (see §5 below: the whole feature was deleted).
- `index.html`'s script/link references all resolve to real files; no orphans found.

---

## 5. Planning / Architecture Residuals

- **`AUTO-OPTIMIZER-ENGINE-PLAN.md` Phase B — only half absorbed.** The *energy-as-resource* half was folded into P13 (confirmed done). The **non-energy gauge half is still fully open**: no `src/core/resources.js` exists, and no generalized Forte/Substance/Concerto-class stack-gauge engine exists. What *does* exist (`RESOURCE_DEFS` in `rotation-rules.js`, added 2026-07-05) only gates rotation-graph *validation availability* ("Full Stop ≥50 → Basic starts at Stage 2"); it does not resolve gauge-level-scaled buffs or damage. This is exactly the gap blocking Changli's IH0/IH1 and Hiyuki's Snow Rust family, both explicitly parked in `effect-overrides.json`'s `deferred` section per `CLAUDE.md`.
- **`AUTO-OPTIMIZER-ENGINE-PLAN.md` Phase E (the capstone "kit → optimal build" search) is not started.** The plan doc itself says it "lands after P13 by definition" — no corresponding module exists anywhere in `src/`.
- **P10-4 (echo-set optimizer) and P10-5 (echo grading) are not "deferred" — they were built, then fully deleted, with no replacement.** `PHASE10-BRIEF.md` describes both as shipped (`src/core/echo-optimizer.js`, `substatGrade` grade badges in `echo-stat-editor.js`), but commit `b5688ea` ("remove: redundant echo optimizer") deleted `echo-optimizer.js` outright, and `echo-stat-editor.js` no longer exists at all. Zero grep hits for `substatGrade`/grade-badge logic anywhere in `src/`. **`README.md:154` is directly contradicted by this removal and should be corrected.** If per-roll substat grading and echo-slot optimization are still wanted, they need to be rebuilt from scratch, not resumed.
- **`TEAM-EFFECT-MODEL.md` — no L5+ planned; the one open item beyond L1-L4 is the Tune Break damage formula**, which is implemented and calibration-tested (`computeTuneBreakDamage`) but **not wired into the live sim** — explicitly pushed to a future "bonus phase" pending an "off-tune buildup" gauge model (the same non-energy-resource-gauge gap as above). Also open per the doc's own §9: Spectro Frazzle/Aero Erosion stack-multiplier re-verification against the corrected DefMult/ResMult formula, and uncalibrated Fusion Burst/Electro Flare stack multipliers.
- **`PHASE0-ARCHITECTURE.md`'s "open items to resolve inside each phase spec" (§9) is itself stale** — its two listed P13 opens (team enumeration strategy, synergy-score schema) are both resolved by the shipped P13 team pass. No literal "floating items" section exists in this doc under that name (the term traces to `CLAUDE.md §14`'s own phrasing, not a distinct backlog in the architecture doc); the doc's only genuinely permanent open boundary is "enemy count is always 1" (by design, not a TODO).
- **Meta coverage confirmed stable:** P12 character-level seed is still exactly 6 characters (`1107, 1108, 1205, 1304, 1506, 1607`); P13's 8 team anchors confirmed unchanged (`1108, 1109, 1209, 1210, 1211, 1508, 1509, 1510`).
- **Two permanent, maintainer-directed scope exclusions** (not bugs, not TODOs — restated here for completeness since they recur across `energy-signal-findings.md` and `meta-validation.md`): (1) exact Concerto/swap-in energy timing is out of scope; (2) enemy-dependent energy generation (damage taken, kill orbs) is out of scope. Both are why 113/192 team-ER override entries remain honestly "provisional" rather than computed.

---

## 6. UI vs. Design-Handoff Conformance

- **Buff Windows handoff — implemented and exceeded.** Every described element (source/name/duration row styling, lane-packing, clipped-buff prefix, hover tooltips, section label) is present in `buff-bar.js`/`build-editor-v2.js`. The shipped version additionally renders `effectWindows` (kit-effect windows) and `stateWindows` (stance/license tracking) as extra strip types beyond what this specific handoff asked for.
- **Echo Panel v2 handoff — functionally complete, one naming mismatch.** Substat group boxes, the connector "neck", and the sonata quick-switch dropdown are all implemented. The "TOTAL SUBSTATS" footer exists (`renderSubstatTally`) but is rendered under the label `"SUBSTATS"`, not the handoff's exact wording — cosmetic only.
- **Roster and Compare page handoffs — implemented** (spot-checked, not exhaustively line-diffed). Roster's filter logic and Compare's slot-count limits (6 builds / 3 teams) match their respective READMEs exactly.
- **Stat/effect search — confirmed missing** on both surfaces the `CANT-SEARCH-FOR-STAT-FLAG.png` screenshot implies (`echo-picker-v2.js`, `roster-v2.js` both name-only). Same item as §3b — flagged independently by two audit passes from different angles, reinforcing it as the most concretely "shippable next" open UI item.

---

## 7. Prioritized Recommendations

**Quick wins (small effort, real value):**
1. Update `MANUAL_NOTES(To-Do).md` to check off the 5 items confirmed done in §3a (chain-effect toggle, weapon-picker unification, §10 team screen, §G buff-bar icons, "most to gain" substats-only).
2. Correct `CLAUDE.md`'s "waits on the §10 team-screen overhaul decision" line — the decision is resolved; the real remaining task is wiring `resolveErTarget` into the shipped team screen (§1b).
3. Fix `README.md`: remove the stale "Project layout" file list (§4) and correct the false "Echo grading ✓" claim (§5).
4. Rename the Echo Panel v2 "SUBSTATS" footer label to "TOTAL SUBSTATS" to match the handoff, or update the handoff doc if the shorter label is the intended final call.

**Medium-effort, high-value:**
5. Wire `resolveErTarget()` into `team-editor-v2.js` and/or `compare-v2.js` so the 79 real team-context ER numbers already computed into the meta actually reach a player (§1b, item #2 in the executive summary).
6. Expand `CURATED_TEAMS` in `synergy-hints.js` to cover Carlotta/Jinhsi/Changli/Phoebe/Cantarella so the P12-seeded anchors get real team suggestions (§1b, item #1) — pure curation content, no engine work.
7. Implement stat/effect search on `echo-picker-v2.js` and `roster-v2.js` (§3b/§6) — flagged by two independent audit angles as the most concrete missing UI feature.

**Larger, deliberate scope decisions (worth a conscious go/no-go, not a quick fix):**
8. Decide whether to rebuild the echo-set optimizer + substat grading (P10-4/P10-5), since it was fully removed rather than deferred — resuming it means starting over, not picking up where it left off.
9. Decide whether the non-energy resource-gauge engine (Forte/Substance/Concerto-class stacks) is worth building now — it's the single blocker unlocking Changli IH0/IH1, Hiyuki Snow Rust, and the calibrated-but-unwired Tune Break damage formula all at once.
10. Decide on the 3-way comparison's relationship to the P11 team-sim component (§1b) — either formally accept the compact-table design as final (update the spec/doc), or invest in composing the full per-step view as originally specified.
