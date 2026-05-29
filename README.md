# WuWa Sim

Damage calculator + rotation simulator for Wuthering Waves. Static HTML/JS site, no build step, deployable to GitHub Pages.

> **Status**: Phase 7 of 8
---

## Quick start

```bash
# Serve locally (any static server works)
python3 -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000`. The site has zero JS dependencies and zero build step — `index.html` loads ES modules directly.

## How the data works

WuWa's actual game data (skill multipliers, character stats, weapon stats, every buff) is not exposed by any public API. The closest available source is [`Dimbreath/WutheringData`](https://github.com/Dimbreath/WutheringData) — a community datamining repo that extracts raw `.uasset` config tables from the game client. Every credible WuWa site (nanoka.cc, wuwatracker, wuwa.gg, Prydwen) ultimately derives from this.

Architecture:

```
  Dimbreath/WutheringData   ──▶  tools/preprocess.mjs   ──▶  data/wuwa-data.json
  (1.4k raw config files,        (Node, run locally)         (~20 KB, committed)
   ~25 MB total)
                                                              │
                                                              ▼
                                  data/patch.json    ──▶  src/data/loader.js   ──▶  UI
                                  (small hand-edited       (fetch + merge in
                                   overrides, committed)    the browser)
```

The pre-processor:
- Downloads 5 critical files from Dimbreath
- Resolves localization keys (`RoleInfo_1402_Name` → `"Yangyang"`)
- Sanitizes placeholder/draft nicknames (game ships unreleased characters with `"An error occurred. Please contact..."` text fallbacks)
- Joins relevant tables, drops asset paths, projects to a lean shape
- Emits a single JSON the runtime loads

The runtime loader fetches the baseline + an optional `patch.json` in parallel and deep-merges them by `id`. This lets you ship data corrections between full pre-processor runs without re-running the pipeline.

## Re-running the pre-processor

When a game patch ships and you want the new resonators:

```bash
node tools/preprocess.mjs           # English, defaults
node tools/preprocess.mjs --lang zh # other languages from TextMap/<lang>/MultiText.json
```

Commit the regenerated `data/wuwa-data.json`. Five-second turnaround.

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
- **Phase 8** Energy / Concerto / Forte gauges; echo active skills (Calamity / Overlord / Elite class skills, projected from `Damage.json`, with new rotation step kind "cast echo skill"); apply conditional sonata buffs to damage
- **Phase 9** Add Team functionality (3 Resonators per Team) for full team rotations with buffs, Intro Skills, Outro Skills, etc.

## Cast times in `data/skill-map.json`

Each curated skill carries a `castTime` (seconds) that approximates the in-game animation length. The simulator falls back to `_defaults.castTimeBySkillType` (also in skill-map.json), then to hardcoded category defaults, then to `1.0` if everything is missing. Editing a cast time is hot — just save the file and reload; no preprocessor re-run needed.

## Importing from Inventory Kamera

1. Run [WuWa Inventory Kamera](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera) and scan your characters and echoes.
2. In WuWa Sim, click **Import…** on the resonator picker page.
3. Drop the resulting `characters_wuwainventorykamera.json` (required) and `echoes_wuwainventorykamera.json` (optional). The `weapons_*` and `achievements_*` files are accepted but currently ignored.
4. Preview shows what will be imported. Click **Import N builds**.
5. Builds appear in **Saved builds** with `(imported)` in the name. Re-importing the same characters updates the existing imported builds instead of creating duplicates.

## Credits

Data: [Dimbreath/WutheringData](https://github.com/Dimbreath/WutheringData) & ww.nanoka.cc (the GOAT). Game assets © Kuro Games. Not affiliated.
