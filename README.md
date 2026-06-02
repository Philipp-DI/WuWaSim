# WuWa Sim

Damage calculator + rotation simulator for Wuthering Waves. Static HTML/JS site, no build step, deployable to GitHub Pages.

> **Status**: Phase 10 complete — full build editor, damage engine, rotation simulator, team builder with off-field/healing/shielding, Resonance Chain & Inherent Skill effects, mechanics-aware rotation graph, state-tracked off-field contributions (Phrolova/Ciaccona), stackable chain effects, echo substat optimizer, and echo roll-quality grading.

---

## Quick start

```bash
# Serve locally (any static server works)
python3 -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000`. The site has zero JS dependencies and zero build step — `index.html` loads ES modules directly.

The core logic has a small Node-native test suite (no test framework, no install):

```bash
node test/rotation-validation.test.mjs   # rotation prerequisite gating
node test/conditional-effects.test.mjs   # chain/inherent effect resolution
node test/rotation-state.test.mjs        # per-step state timeline
node test/off-field-state.test.mjs       # state-gated off-field contributions
node test/stackable-effects.test.mjs     # stackable chain/inherent effects
```

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

```
index.html               Page shell
styles/
  tokens.css             Design tokens (colors, type, spacing)
  base.css               Reset, chrome, layout
  picker.css             Character picker component
src/
  data/
    loader.js            Fetch + merge baseline & patch
  ui/
    app.js               Boot, mount picker
    dom.js               Tiny template/event utilities
    components/
      character-picker.js  Filter bar + card grid
tools/
  preprocess.mjs         Build-time data extractor (Node)
data/
  wuwa-data.json         Pre-processed baseline (committed)
  patch.json             Runtime overrides (committed, optional)
```

## Aesthetic

Deep void background (`#0a0e14`), cyan hairlines, sharp 90° corners, no rounding. Display type is **Chakra Petch** (geometric cyber); body is **Rajdhani** (condensed technical). Element accents use the in-game attribute colors (Glacio blue, Fusion orange, Electro purple, Aero green, Spectro gold, Havoc pink).

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

- **Mechanics-aware rotation graph** ✓: `src/core/rotation-graph.js` provides the graph model (`fromLinear`/`toLinear`/`buildRuleGraph`) and a non-blocking rotation validator (`validateRotation`). `src/core/rotation-rules.js` holds a curated prerequisite rule table (26 rules across Carlotta, Hiyuki, Jinhsi, Changli, Phoebe, Cantarella). The rotation panel surfaces advisory warnings — amber banner plus per-step markers with hover explanations — when a step is sequenced before the skill that gates it. Warnings inform; they never block. Covered by `test/rotation-validation.test.mjs` (17 assertions).
- **Per-window state model** ✓: `src/core/rotation-state.js` computes a per-step state timeline from a per-character `STATE_DEFS` table in `rotation-rules.js`. States enter on skill key or type; exit by persistence, consuming skill, or duration; default stances (e.g. Hiyuki's Present Self) via `initiallyActive`. The team simulator's structural resolver uses this to evaluate `inState` chain/inherent effects (e.g. Aemeath's Tune Rupture, Denia's Entropy Shift). Covered by `test/rotation-state.test.mjs` (15 assertions).
- **Off-field Phase 2 — state-tracked mechanics** ✓: `OffFieldAction` extended with optional `requiresState` field; `computeOffFieldContribution` skips actions whose required state was not active in that member's rotation. Phrolova (Maestro state → Hecate coordinated attack) and Ciaccona (Recital state → Symphonic Poem Tonic turret) wired in `data/patch.json`; state definitions added to `rotation-rules.js`. Covered by `test/off-field-state.test.mjs` (11 assertions).
- **Conditional effect stacks** ✓: Chain/inherent effects carry `stackable: true`, `perStack: value`, `maxStacks: N` metadata emitted by `tools/preprocess.mjs`. `collectActiveEffects` in `buffs.js` scales effect value by the integer stack count stored in `effectToggles`. `setEffectToggle` accepts integers ≥ 0 as stack counts. The build editor shows a ±1 stack stepper in place of a checkbox for stackable effects (defaults to 0 / off for situational effects). 11 stackable effects across 9 resonators in the compiled dataset. Covered by `test/stackable-effects.test.mjs` (20 assertions).
- **Echo set optimizer** ✓: `src/core/echo-optimizer.js` — greedy marginal-DPS substat selection. Per echo slot, tries all 13 valid substat types at max roll across 5 positions and keeps the sequence that maximises rotation DPS (~325 simulation calls total, < 1 s). `suggestEchoSubstats(build, dataset, target)` returns per-slot suggested main stat and ranked substats. An "Optimize" button in the echoes section header triggers the optimizer and renders results inline.
- **Echo grading & UI/UX polish** ✓: `echo-stat-editor.js` shows per-substat roll-quality grade badges (green ≥ 80 %, amber 60–79 %, red < 60 %) computed against `data/stat-ranges.json` max rolls. An efficiency badge in the sub stats section header displays the average grade across filled substats.

## Phase X — UI/UX polish (ongoing, no fixed slot)

General polish, accessibility improvements, and quality-of-life refinements that accumulate across phases and get batched when the feature backlog is clear.

## Cast times in `data/skill-map.json`

Each curated skill carries a `castTime` (seconds) that approximates the in-game animation length. The simulator falls back to `_defaults.castTimeBySkillType` (also in skill-map.json), then to hardcoded category defaults, then to `1.0` if everything is missing. Editing a cast time is hot — just save the file and reload; no preprocessor re-run needed.

## Importing from Inventory Kamera

1. Run [WuWa Inventory Kamera](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera) and scan your characters and echoes.
2. In WuWa Sim, click **Import…** on the resonator picker page.
3. Drop the resulting `characters_wuwainventorykamera.json` (required) and `echoes_wuwainventorykamera.json` (optional). The `weapons_*` and `achievements_*` files are accepted but currently ignored.
4. Preview shows what will be imported. Click **Import N builds**.
5. Builds appear in **Saved builds** with `(imported)` in the name. Re-importing the same characters updates the existing imported builds instead of creating duplicates.

## Credits

**[nanoka.cc](https://nanoka.cc)** — primary source for all character skill data: damage multipliers, healing/shield values, resonance chains, inherent skills, skill descriptions, and stat node bonuses. The quality and completeness of this project's damage calculations depend entirely on the work put into maintaining nanoka.cc. Thank you.

**[Dimbreath/WutheringData](https://github.com/Dimbreath/WutheringData)** — raw game config tables used for echo damage, weapon growth curves, and base stat curves. The broader WuWa community tooling (wuwatracker, wuwa.gg, Prydwen, and many others) builds on this foundation.

**[WuWa Inventory Kamera](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera)** — the scanner that lets users import their actual in-game builds.

Game assets, character names, and game mechanics © Kuro Games. This project is a fan tool and is not affiliated with or endorsed by Kuro Games.
