# WuWa Sim

Damage calculator + rotation simulator for Wuthering Waves. Static HTML/JS site, no build step, deployable to GitHub Pages.

> **Status**: Phase 8 (in progress)

---

## Quick start

- Integrated Browser in VSCode

## How the data works

WuWa's actual game data (skill multipliers, character stats, weapon stats, every buff) is not exposed by any public API. The primary source for this project is [ww.nanoka.cc](https://ww.nanoka.cc) — a community game-data service that provides structured, current-patch data including full character skill trees, weapon stats per level, and echo active skills. A secondary source is [`Dimbreath/WutheringData`](https://github.com/Dimbreath/WutheringData) for global tables (echo main/sub stat scaling, element info, growth curves) that nanoka does not expose per-item.

Architecture:

```
  nanoka.cc (primary)         ──▶  tools/preprocess.mjs   ──▶  data/wuwa-data.json
    character/{id}.json            (Node, run locally)         (~3 MB, committed)
    weapon/{id}.json
    echo/{id}.json
  Dimbreath/WutheringData     ──▶       │
    (global tables only)               │
                                       │
  data/extracted-nanoka/     ──▶       │
    characters/  weapons/              │
    echoes/      *.json                │
                                                              │
                                                              ▼
                                  data/patch.json    ──▶  src/data/loader.js   ──▶  UI
                                  (small hand-edited       (fetch + merge in
                                   overrides, committed)    the browser)
```

The pre-processor:

- Fetches 5 global config files from Dimbreath (element info, growth curves, echo main/sub stat pools, damage table)
- Reads locally cached nanoka JSON files for full per-character, per-weapon, and per-echo detail
- Projects character skill trees: classifies every param row as `damage | buff | meta`, generates granular rotation keys with category-prefixed labels (`"Resonance Skill: Art of Violence"`), infers `skillType`/`formulaType` including Forte subtypes and Echo Skill annotations
- Resolves weapon stats per level (nanoka pre-computes all breakpoints — no growth-curve math)
- Resolves echo active skills, sonata group data with descParams pre-substituted
- Emits a single JSON the runtime loads

The runtime loader fetches the baseline + an optional `patch.json` in parallel and deep-merges them by `id`.

## Updating data after a patch

```bash
# 1. Fetch new character JSONs (run on your local machine — nanoka CDN blocks datacenter IPs)
node tools/fetch-nanoka-chars.mjs          # new/missing chars only
node tools/fetch-nanoka-chars.mjs --all    # re-fetch all

# 2. Fetch new weapon + echo JSONs
node tools/fetch-nanoka-weapons.mjs --all
node tools/fetch-nanoka-echoes.mjs --all

# 3. Regenerate
node tools/preprocess.mjs

# 4. Commit
git add data/ && git commit -m "patch X.Y: new chars/weapons/echoes"
```

## Hand-editing `data/patch.json`

```jsonc
{
  "schemaVersion": 8,
  "resonators": [
    { "id": 1406, "name": "Rover (Aero, Male)" }
  ]
}
```

Entries are joined by `id`. New ids in the patch are appended.

## Project layout

```
├── 📁 assets
│   └── 📁 icons
│       ├── 📁 resonators      ← head portrait webps (from nanoka CDN or local)
│       ├── 📁 weapons
│       ├── 📁 echoes
│       └── 📁 monsters
├── 📁 data
│   ├── 🗂️ wuwa-data.json      ← compiled dataset (schema v8)
│   ├── 🗂️ patch.json          ← hand-edited overrides
│   ├── 🗂️ skill-map.json      ← curated skill definitions (Carlotta only; others use autoSkillMap)
│   ├── 🗂️ stat-ranges.json    ← echo substat roll table
│   └── 📁 extracted-nanoka
│       ├── 🗂️ character.json  ← index (id → name, element, weapon, icon path)
│       ├── 🗂️ weapon.json
│       ├── 🗂️ echo.json
│       ├── 🗂️ monster.json
│       ├── 📁 characters      ← full per-char JSONs (skill trees, stats, chains)
│       ├── 📁 weapons         ← full per-weapon JSONs (stats per level)
│       └── 📁 echoes          ← full per-echo JSONs (active skill, sonata groups)
├── 📄 index.html
├── 📁 src
│   ├── 📁 core
│   │   ├── 🟨 build.js        ← build schema, setters, SKILL_KEYS
│   │   ├── 🟨 echo-rules.js
│   │   ├── 🟨 formula.js
│   │   ├── 🟨 sim.js          ← rotation simulator, cast time resolution
│   │   ├── 🟨 skill.js        ← per-skill damage resolver
│   │   ├── 🟨 sonata-buffs.js
│   │   └── 🟨 stats.js        ← total stat resolver (resonator + weapon + tree + echoes)
│   ├── 📁 data
│   │   ├── 🟨 build-codec.js
│   │   ├── 🟨 kamera-import.js
│   │   ├── 🟨 loader.js
│   │   └── 🟨 storage.js
│   └── 📁 ui
│       ├── 🟨 app.js
│       └── 📁 components
│           ├── 🟨 build-editor.js     ← skill levels, inherent skills, stat node toggles
│           ├── 🟨 character-picker.js
│           ├── 🟨 damage-panel.js     ← per-skill cards with META info + buff toggles
│           ├── 🟨 echo-stat-editor.js
│           ├── 🟨 kamera-importer.js
│           ├── 🟨 modal-picker.js
│           ├── 🟨 rotation-panel.js   ← palette + timeline
│           └── 🟨 stats-panel.js
├── 📁 styles
└── 📁 tools
    ├── 📄 fetch-nanoka-chars.mjs
    ├── 📄 fetch-nanoka-weapons.mjs
    ├── 📄 fetch-nanoka-echoes.mjs
    ├── 📄 download-icons.mjs
    ├── 📄 gen-manifest.mjs
    └── 📄 preprocess.mjs
```

## Skill system (Phase 8)

Each resonator's skill tree is projected into `autoSkillMap[resonatorId]`, which the damage panel and rotation palette consume. The curated `skill-map.json` takes priority where it exists (currently only Carlotta).

**Label format**: always `"{Category}: {Sub-name}"`. Categories:

| skillType | Category prefix |
|---|---|
| `basic` / `midair` | Basic Attack |
| `heavy` | Heavy Attack |
| `forte_basic` | Basic Attack (Forte) |
| `forte_heavy` | Heavy Attack (Forte) |
| `skill` | Resonance Skill |
| `liberation` | Resonance Liberation |
| `intro` | Intro Skill |
| `outro` | Outro Skill |

Additional annotations: `(Echo)` for skills dual-typed as Echo Skill DMG (e.g. Phrolova's Scarlet Coda, Qiuyan's abilities). `formulaType` governs which bonus bucket and skill level the damage formula uses — midair → basic, forte_basic/heavy → respective forte level.

## Skill levels

`build.skillLevels` uses 5 keys matching the in-game skill tree: `normal`, `skill`, `forte`, `liberation`, `intro`. All default to 10. The editor also exposes:

- **Inherent Skill toggles** (passive ability nodes, attached to the Forte Circuit column)
- **Stat node toggles** (ATK+, Crit Rate+, Healing Bonus+ etc., 2 tiers per column — default active)

## Aesthetic

Deep void background (`#0a0e14`), cyan hairlines, sharp 90° corners, no rounding. Display type is **Chakra Petch** (geometric cyber); body is **Rajdhani** (condensed technical). Element accents use the in-game attribute colors.

## Roadmap

- **Phase 1** ✓ Skeleton, character picker
- **Phase 2** ✓ Build editor (stats, weapon, echoes, skill levels), localStorage persistence, builds drawer, hash-based routing
- **Phase 3** ✓ Damage engine + per-skill breakdown view
- **Phase 4** ✓ Inventory Kamera JSON import
- **Phase 5** ✓ Rotation simulator: ordered skill sequences, timeline, drag-and-drop, palette, DPS totals
- **Phase 6** ✓ Echo stat editor; sonata 2pc effects applied to damage; DPS area chart
- **Phase 7** ✓ Mobile responsive; URL share; sonata conditional buff UI (visual only)
- **Phase 8** 🔄 _In progress_
  - ✅ Full nanoka migration (characters, weapons, echoes — current-patch data, no Dimbreath lag)
  - ✅ Auto-generated skill maps for all 53 resonators (granular per-stage, per-variant steps)
  - ✅ Correct skill level keys (`normal / skill / forte / liberation / intro`), default 10
  - ✅ Inherent Skill + stat node toggles in build editor (wired to damage calculation)
  - ✅ Echo active skill data in dataset (`activeSkill.rateByLevel`, element, relatedProperty)
  - ⬜ Echo active skill as a rotation step ("cast echo skill" step type, uses slot-0 echo's `activeSkill`)
  - ⬜ Conditional sonata buffs applied to damage (uptime bars exist; math not yet wired)
- **Phase 9** Team functionality (3 resonators, full team rotations with Intro/Outro handoffs, team buffs) & Resonance Chain integration
- **Phase 10** Mechanics-aware rotation builder (skill availability gating: stage sequencing, liberation prerequisites, Forte gauge thresholds)
- **Polish Phase** UX/UI refinement, shorthand labels, element colour coding on skill cards

## Cast times

Each skill in `autoSkillMap` carries a `castTime` (seconds). The simulator falls back to `_defaults.castTimeBySkillType` in `skill-map.json`, then to hardcoded category defaults, then `1.0`. Cast times can be tuned in `skill-map.json` without re-running the preprocessor.

## Importing from Inventory Kamera

1. Run [WuWa Inventory Kamera](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera).
2. Click **Import…** on the resonator picker page.
3. Drop `characters_wuwainventorykamera.json` (required) and `echoes_wuwainventorykamera.json` (optional).
4. Preview → **Import N builds**.

## Credits

Data: [Dimbreath/WutheringData](https://github.com/Dimbreath/WutheringData) (global tables) & [ww.nanoka.cc](https://ww.nanoka.cc) (the GOAT — primary data source). Game assets © Kuro Games. Not affiliated.
