# WuWa Sim

Damage calculator + rotation simulator for Wuthering Waves. Static HTML/JS site, no build step, deployable to GitHub Pages.

> **Status**: Phase 1 of 7 — skeleton, theme, character picker. Damage engine, rotation timeline, and Inventory Kamera import follow in later phases.

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
- **Phase 2** Build editor (stats form, weapon, echoes), localStorage persistence
- **Phase 3** Damage engine + per-skill breakdown view
- **Phase 4** Inventory Kamera JSON import
- **Phase 5** Rotation timeline + drag-drop simulator
- **Phase 6** DPS chart + buff uptime bars
- **Phase 7** URL share, mobile polish

## Credits

Data: [Dimbreath/WutheringData](https://github.com/Dimbreath/WutheringData). Game assets © Kuro Games. Not affiliated.
