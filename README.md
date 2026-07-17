# WuWa Sim

Damage calculator + rotation simulator for Wuthering Waves. Static HTML/JS site, no build step, deployable to GitHub Pages.

> **Status**: Phase 13 complete — offline stat-priority optimizer + suggested builds (P12), team suggestions with team-level ER and a 3-way team comparison (P13), plus an ongoing trigger/condition-transparency pass: rotation validation is state- and resource-aware (grant chips explain *why* a step is legal instead of just warning), and chain/inherent effect + character-state windows are computed and rendered on the build page with their consumers named.

---

## Start here (new to the project?)

1. Run the app — see Quick start below (any static server, no build step).
2. Run the tests: `npm test` (plain Node, no framework, no install needed).
3. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how data flows: pipeline, life of a damage number, life of a buff, life of a team sim, module map.
4. Read [docs/GLOSSARY.md](docs/GLOSSARY.md) — game terms and project-invented terms.
5. Read [CLAUDE.md](CLAUDE.md) — the working rules and the critical invariants.

Development history (phase-by-phase) lives in [docs/HISTORY.md](docs/HISTORY.md);
the current cleanup roadmap in [docs/SIMPLIFICATION-PLAN.md](docs/SIMPLIFICATION-PLAN.md).

## Quick start

```bash
# Serve locally (any static server works)
python3 -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000`. The site has zero JS dependencies and zero build step — `index.html` loads ES modules directly.

The core logic has a Node-native test suite (55 files, no test framework):

```bash
npm test         # run every tests/*.test.mjs (no install needed — plain Node)
npm run sweep    # import every src module (catches parse errors / broken imports)
npm run lint     # ESLint (needs `npm install` once; devDependencies only — nothing ships)
```

Individual test files also run directly: `node tests/rotation-validation.test.mjs`.

## How the data works

WuWa's game data (skill multipliers, character stats, weapon stats, every buff) is not exposed by any public API. The project uses two community sources and merges them:

**[nanoka.cc](https://nanoka.cc)** (primary — character data)
A community-maintained skill database for Wuthering Waves. Provides clean, structured per-character data: skill trees with level-scaled multipliers, resonance chains, inherent skills, skill descriptions with param substitution, and stat node bonuses. This is the source for 53 resonators' worth of damage rows, healing rows, chain effects, and inherent skill effects. Files are stored locally at `data/extracted-nanoka/characters/*.json`.

**[Dimbreath/WutheringData](https://github.com/Dimbreath/WutheringData)** (fallback — echoes, weapons, base curves)
A community datamining repo that extracts raw `.uasset` config tables from the game client. Used for echo damage tables, weapon stat growth curves, and base stat growth curves. Every credible WuWa site (wuwatracker, wuwa.gg, Prydwen) ultimately derives from this.

```
  data/extracted-nanoka/          Dimbreath/WutheringData
  characters/*.json               (echo/weapon/curve tables)
  (53 resonators, primary)        (secondary, fetched at preprocess time)
          │                                │
          └──────────┬────────────────────┘
                     ▼
           tools/preprocess.mjs        ──▶  data/wuwa-data.json
           (Node, run locally)               (~5 MB, committed)

                                                    │
                                                    ▼
                       data/patch.json  ──▶  src/data/loader.js  ──▶  UI
                       (hand-edited          (fetch + merge in
                        overrides)            the browser)
```

The pre-processor:
- Reads nanoka character JSON files for all skill/chain/inherent data
- Downloads echo, weapon, and growth-curve tables from Dimbreath as needed
- Resolves localization keys, sanitizes placeholder nicknames
- Merges both sources into a single lean JSON the runtime loads

The runtime loader fetches the baseline + an optional `patch.json` in parallel and deep-merges them by `id`. This lets you ship data corrections between full pre-processor runs without re-running the pipeline.

## Re-running the pre-processor

When a game patch ships and you want the new resonators:

1. Update `data/extracted-nanoka/characters/` with the new character files from nanoka.cc.
2. Run the pre-processor:

```bash
node tools/preprocess.mjs           # English, defaults
node tools/preprocess.mjs --lang zh # other languages from TextMap/<lang>/MultiText.json
```

Commit the regenerated `data/wuwa-data.json`. The pipeline completes in a few seconds.

## Hand-editing `data/patch.json`

The patch file is merged on top of the baseline. Use it for quick fixes:

```jsonc
{
  "schemaVersion": 1,
  "resonators": [
    { "id": 1406, "name": "Rover (Aero, Male)" }   // overrides only the `name` field
  ]
}
```

Entries are joined by `id`. New ids in the patch are appended.

## Project layout

```text
index.html               Page shell
styles/
  tokens.css             Design tokens — single source of truth (colors, type, spacing)
  base.css               Reset, chrome, layout
  build-v2.css           Build editor page (.bv2 system)
  team.css               Team simulator + comparison page
  roster-v2.css          Roster page
  responsive.css         Mobile/viewport breakpoints
src/
  core/                  Pure sim engine (formula, sim, team-sim, buffs, stats, …)
  data/
    loader.js            Fetch + merge baseline & patch
    meta-loader.js        Load/validate the P12/P13 wuwa-meta.json
    storage.js            Saved builds/echo presets (localStorage)
  ui/
    app.js               Boot, hash-based routing
    dom.js               Tiny template/event utilities
    tooltip.js           Shared hover-box component
    components/
      roster-v2.js         Roster page
      build-editor-v2.js   Build editor page
      team-editor-v2.js    Team simulator page
      compare-v2.js        Up to 6-build / 3-team comparison
      echo-picker-v2.js    Echo search/filter overlay
      buff-bar.js          Shared lane-packed buff-window renderer
      suggested-teams.js   P13 suggested-teams panel
      weapon-picker.js     Shared weapon picker (build + team pages)
tools/
  preprocess.mjs         Build-time data extractor (Node)
  optimize.mjs           Offline stat-priority + team-suggestion precompute (P12/P13)
data/
  wuwa-data.json         Pre-processed baseline (committed)
  wuwa-meta.json         P12/P13 precomputed weights + team suggestions (committed)
  patch.json             Runtime overrides (committed, optional)
tests/
  *.test.mjs             Plain-Node test suite (50 files, no framework)
docs/
  ARCHITECTURE.md        How data flows end-to-end (read this first)
  GLOSSARY.md            Game + project vocabulary
  HISTORY.md             Phase-by-phase development chronicle
  SIMPLIFICATION-PLAN.md Cleanup/onboarding roadmap
  *.md                   Phase instruction sets, design docs, investigations
```

## Aesthetic

Deep teal-tinted dark surfaces with a teal accent (`--acc #46d6c6`), soft rounded
corners, and a dark/light theme toggle. Display type is **Chakra Petch** (geometric
cyber); body is **Manrope**. Element accents use the in-game attribute colors (Glacio
blue, Fusion orange, Electro purple, Aero green, Spectro gold, Havoc pink).

**All styling is driven from a single source of truth — [`styles/tokens.css`](styles/tokens.css).**
It holds two layers: theme-invariant `:root` primitives (typography, spacing, radii,
motion, element/damage palettes, semantic colours, and the global-chrome palette used
by the loading screen) and the `.bv2[data-theme="dark"|"light"]` surface tokens that
every page mounts inside. Change a colour or typeface there and it propagates app-wide.

> Previously the UI ran two divergent token systems (a classic `:root` set and a
> separate `.bv2` set); these were unified and the classic pages retired.

## Roadmap

- **Phase 1** ✓ Skeleton, character picker
- **Phase 2** ✓ Build editor (stats, weapon, echoes, skill levels), localStorage persistence, builds drawer, hash-based routing
- **Phase 3** ✓ Damage engine + per-skill breakdown view (full WuWa formula with piecewise resistance, DEF multiplier, crit math; verified against in-game Carlotta values)
- **Phase 4** ✓ Inventory Kamera JSON import (drag-drop multi-file, 3-step flow, re-import replaces duplicates, punctuation-tolerant stat name matching)
- **Phase 5** ✓ Rotation simulator: ordered skill sequences, proportional timeline, drag-and-drop reordering, palette-driven steps, totals (damage / time / DPS / hits), per-skill cast times
- **Phase 6** ✓ Echo main + sub stat editor with cost-restricted main pool, auto-derived sub-main stat (read-only), level dial unlocking substat slots, curated roll dropdowns from `data/stat-ranges.json`, no-duplicate-substat enforcement, soft cost-budget warning indicator; sonata 2pc effects automatically applied to damage via dataset's `AddProp[]`; DPS-over-time SVG area chart in rotation panel
- **Phase 7** ✓ Mobile responsive layout (viewport down to 390px); URL share via `#share/<v1.base64url>` hash routes; sonata conditional buff parsing + uptime bars under the rotation timeline (parses 5pc / 3pc effect text to extract trigger / duration / bonus, currently visual-only — does not yet apply to damage)
- **Phase 8** ✓ Echo rotation step (cast-echo-skill kind, projected from `Damage.json`); sonata buffs applied to damage; skill / forte / liberation keys; inherent skills; stat nodes; auto skill map projected from nanoka source (53 resonators)
- **Phase 9** ✓ Team builder & team simulator (3-slot teams, intro/outro/rotation/off-field segments, per-member + team totals); off-field damage (coordinated / turret / outro-burst, 9 resonators); outro buffs as cross-member amplify context; healing & shielding (HP/ATK/DEF/ER scaling, flat+ratio, colour-coded green/amber output); HP/DEF/ATK per-row scaling fixed via `format` field + `sk.damage` correlation; formatted skill descriptions in the damage panel (996/996 entries, section headers + keyword highlights); Resonance Chain & Inherent Skill effects parsed into the damage calculation (DMG bonus, element/skill-type bonus, ATK%, crit rate/dmg, amplify, multiplier increase); passive stat-node toggles drive the calculation (crit/ATK/HP/DEF + element DMG nodes). Effects are classified by condition — **unconditional** effects are always active once the node is unlocked (no toggle); **conditional** effects (timed / situational) offer an "assume active" toggle on the build page and are auto-resolved structurally by the team simulator

## Phase 10 — complete ✓

- **Mechanics-aware rotation graph** ✓: `src/core/rotation-graph.js` provides the graph model (`fromLinear`/`toLinear`/`buildRuleGraph`) and a non-blocking rotation validator (`validateRotation`). `src/core/rotation-rules.js` holds a curated prerequisite rule table (26 rules across Carlotta, Hiyuki, Jinhsi, Changli, Phoebe, Cantarella). The rotation panel surfaces advisory warnings — amber banner plus per-step markers with hover explanations — when a step is sequenced before the skill that gates it. Warnings inform; they never block. Covered by `tests/rotation-validation.test.mjs` (17 assertions).
- **Per-window state model** ✓: `src/core/rotation-state.js` computes a per-step state timeline from a per-character `STATE_DEFS` table in `rotation-rules.js`. States enter on skill key or type; exit by persistence, consuming skill, or duration; default stances (e.g. Hiyuki's Present Self) via `initiallyActive`. The team simulator's structural resolver uses this to evaluate `inState` chain/inherent effects (e.g. Aemeath's Tune Rupture, Denia's Entropy Shift). Covered by `tests/rotation-state.test.mjs` (15 assertions).
- **Off-field Phase 2 — state-tracked mechanics** ✓: `OffFieldAction` extended with optional `requiresState` field; `computeOffFieldContribution` skips actions whose required state was not active in that member's rotation. Phrolova (Maestro state → Hecate coordinated attack) and Ciaccona (Recital state → Symphonic Poem Tonic turret) wired in `data/patch.json`; state definitions added to `rotation-rules.js`. Covered by `tests/off-field-state.test.mjs` (11 assertions).
- **Conditional effect stacks** ✓: Chain/inherent effects carry `stackable: true`, `perStack: value`, `maxStacks: N` metadata emitted by `tools/preprocess.mjs`. `collectActiveEffects` in `buffs.js` scales effect value by the integer stack count stored in `effectToggles`. `setEffectToggle` accepts integers ≥ 0 as stack counts. The build editor shows a ±1 stack stepper in place of a checkbox for stackable effects (defaults to 0 / off for situational effects). 11 stackable effects across 9 resonators in the compiled dataset. Covered by `tests/stackable-effects.test.mjs` (20 assertions).
- ~~**Echo set optimizer**~~ ✓: ~~`src/core/echo-optimizer.js` — greedy marginal-DPS substat selection. Per echo slot, tries all 13 valid substat types at max roll across 5 positions and keeps the sequence that maximises rotation DPS (~325 simulation calls total, < 1 s). `suggestEchoSubstats(build, dataset, target)` returns per-slot suggested main stat and ranked substats. An "Optimize" button in the echoes section header triggers the optimizer and renders results inline.~~ Removed (P13) — redundant with the live per-roll stat-priority weights (`src/core/live-weights.js`) already shown inline on every substat roll button; superseded by named echo-loadout Save/Load presets (`src/data/storage.js` `listEchoPresets`/`saveEchoPreset`/`deleteEchoPreset`, mirroring rotation presets) so users can switch between saved echo set-ups instead.
- ~~**Echo grading & UI/UX polish**~~ ✓: ~~`echo-stat-editor.js` shows per-substat roll-quality grade badges (green ≥ 80 %, amber 60–79 %, red < 60 %) computed against `data/stat-ranges.json` max rolls. An efficiency badge in the sub stats section header displays the average grade across filled substats.~~ Removed alongside the echo-set optimizer (P13, commit `b5688ea`) — `echo-stat-editor.js` no longer exists; no roll-quality grading currently ships anywhere. Live per-roll stat-priority weights (`src/core/live-weights.js`) partially cover the same need (ranks each equipped roll's marginal value) but do not grade against the theoretical max roll. Rebuilding grading, if wanted, starts from scratch — this was a deletion, not a deferral.

## Phase 11 — complete ✓

- **Conditional-effects model revision** ✓: unified trigger × window resolution (`castMatch`/`stateEnter`/`modeMatch` × `seconds`/`persist`/`stateBound`/`always`) in `src/core/buffs.js`, replacing the old per-effect "assume active" toggle — buffs resolve automatically and identically in both the build-page and team sims, straight from the rotation. Resonance Mode support added.
- **Build Page v2 / Team Sim v2 / Compare v2 / Roster v2** ✓: full visual redesign (`src/ui/components/*-v2.js`, `styles/build-v2.css`, `styles/roster-v2.css`) on one shared `.bv2` design-token system; the classic editor/team/compare pages are retired.
- **Shared buff-bar component** ✓: `src/ui/components/buff-bar.js` — lane-packing, element/damage-type/neutral colour classification (`detectDamageType()` in `sonata-buffs.js`) and generic/defensive icon glyphs, consumed by both the build page's buff-window strip and the team page's per-member buff bar.
- **Rotation auto-triggers** ✓: `src/core/rotation-triggers.js` proposes a forced follow-up step (e.g. Carlotta's Chromatic Splendor) when its trigger skill is added to the rotation, with a dismissible "auto-inserted" notice and a gold-bordered chip.
- **Hover-box descriptions everywhere** ✓: every skill/ability surface (rotation palette, rotation chips, line-chart hit dots, Ability Damage Overview, team-page step bars) shows the move's real description on hover, including correct per-stage text for multi-stage moves like Basic Attack (`extractSkillSection()` in `src/ui/tip-format.js`). The shared hover-box (`src/ui/tooltip.js`) is scrollable and repositions itself to stay fully on-screen near viewport edges.

Full detail: `docs/P11-INSTRUCTION-SET.md`, `docs/P11-ADDENDUM.md`.

## Phase 12 — complete ✓

- **Offline stat-priority optimizer** ✓: `tools/optimize.mjs` precomputes per-roll substat weights, echo-set breakpoints, and a suggested build (sonata × weapon × substat target) for a curated 6-character seed (Carlotta, Hiyuki, Jinhsi, Changli, Phoebe, Cantarella), writing `data/wuwa-meta.json`. Runtime consumers: `src/data/meta-loader.js`, `src/core/stat-ranking.js`, `src/core/stat-priority.js`, and the Stat Priority panel on the build page (live per-roll values computed at the user's actual current stats, plus a one-click "Apply suggested build" on empty builds).
- **Energy Regen is a mode choice, not a fabricated breakpoint** ✓: solo ER has no single honest target (off-field/on-hit/Concerto energy sources are unmodeled for a solo character), so the build page offers `dmgFocus` / `balanced` / `erFocus` instead of a single number — corrected in P13 once team-level energy modeling landed.
- **Buff-timeline engine + substat co-optimization** ✓: sonata stacking buffs ramp per-step instead of applying max stacks flat for the whole window (`src/core/buff-timeline.js`); the suggested-build search co-optimizes each candidate's own substats via a greedy marginal allocator (`src/core/substat-allocate.js`) so set comparisons are fair under the Crit Rate cap.

## Phase 13 — complete ✓ (arc closed; ongoing coverage growth continues)

- **Team suggestions** ✓: a curated synergy-hint table (`tools/optimize/synergy-hints.js`) prunes the ~27,720-team enumeration space to plausible candidates per anchor character, which the sim then ranks (`tools/optimize/team-enum.js`, `team-rank.js`) into `meta.teams` — surfaced on the build page as a "Suggested Teams" panel (curated META comps pinned first, full per-member build transparency via an expandable inspector) and a reverse "appears in teams for…" lookup on supports' pages. Each suggestion has an "Open in Team Sim" action that materializes a real team + builds and jumps to the team simulator.
- **Team-level Energy Regen** ✓: `src/core/team-energy.js` computes each member's own casts plus the off-field 50% energy share in closed form; `src/core/team-er.js` resolves a hybrid ER target (team override when placed in a simulated team, character-level default otherwise, never null when a character-level value exists).
- **Team Effect Model** ✓: shared enemy-status timeline, team-aware status gating, team-wide buff propagation, and cross-member Outro→Intro amplify context in `src/core/team-sim.js`, plus a 3-way team comparison view (`src/ui/components/compare-v2.js`) composing the existing team-sim visualization rather than duplicating it.
- **Concerto gauge** ✓: the swap-in energy resource (`element_power`, confirmed via maintainer in-game testing) is extracted and tracked per member (`concertoGen`, `team-sim.js`'s `concerto.swaps`); the Outro→Intro handoff gate is opt-in, since most curated teams don't reach a full gauge within one rotation.
- **`formulaType` is data-driven, not regex-parsed** ✓: each raw damage instance carries the game's own type tag (basic/heavy/liberation/intro/skill/Echo Skill); `preprocess.mjs` maps every display row to its exact instances and reads the DMG-bonus bucket straight from them, replacing an earlier text-parsing heuristic that had accumulated blind spots.
- **Rotation validation is state- and resource-aware** ✓ (ongoing transparency pass): `src/core/rotation-graph.js`'s `analyzeRotation` consults a per-character state timeline, curated resource thresholds (e.g. Sigrika's Full Stop), and maintainer-verified swap-in combo entry — instead of a single "is Stage N−1 earlier in the rotation" heuristic — and emits a **grant chip** on every step whose gate is satisfied, naming why ("chained from Intro Skill"), not just warning when it isn't. Chain/inherent effect windows and character-state windows (with their consumer named, e.g. "consumed by Final Act — Breakdown Form") are computed by the sim and rendered on the build page's buff-window strip. `docs/COMBO-ENTRY-CURATION.md` tracks per-character curation coverage for the wider roster.

## Phase X — UI/UX polish (ongoing, no fixed slot)

General polish, accessibility improvements, and quality-of-life refinements that accumulate across phases and get batched when the feature backlog is clear.

## Cast times in `data/skill-map.json`

Each curated skill carries a `castTime` (seconds) that approximates the in-game animation length. The simulator falls back to `_defaults.castTimeBySkillType` (also in skill-map.json), then to hardcoded category defaults, then to `1.0` if everything is missing. Editing a cast time is hot — just save the file and reload; no preprocessor re-run needed.

## ~~Importing from Inventory Kamera~~ — removed

The Inventory Kamera JSON import (Phase 4) has been **removed**: [WuWa Inventory
Kamera](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera) is no longer fully
functional after WuWa's UI overhaul, so the importer component, its styles, and its
entry point were deleted. The original flow, for the record:

> ~~1. Run WuWa Inventory Kamera and scan your characters and echoes.~~
> ~~2. Click **Import…** on the resonator picker page, drop the resulting JSON files.~~
> ~~3. Preview, then **Import N builds** — they appear in your saved builds, re-import updates in place.~~

## Credits

**[nanoka.cc](https://nanoka.cc)** — primary source for all character skill data: damage multipliers, healing/shield values, resonance chains, inherent skills, skill descriptions, and stat node bonuses. The quality and completeness of this project's damage calculations depend entirely on the work put into maintaining nanoka.cc. Thank you.

**[Dimbreath/WutheringData](https://github.com/Dimbreath/WutheringData)** — raw game config tables used for echo damage, weapon growth curves, and base stat curves. The broader WuWa community tooling (wuwatracker, wuwa.gg, Prydwen, and many others) builds on this foundation.

~~**[WuWa Inventory Kamera](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera)** — the scanner that lets users import their actual in-game builds.~~ _Deprecated: not fully functional after WuWa's UI overhaul_

Game assets, character names, in-game icon artwork (element, sonata-set, and weapon-type icons committed under `assets/icons/`), and game mechanics © Kuro Games. This project is a fan tool and is not affiliated with or endorsed by Kuro Games.
