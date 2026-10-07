---
paths:
  - "tools/extract/{map-timings,build-skill-join}.mjs"
  - "src/data/storage.js"
  - "tests/rover-gender.test.mjs"
---

# Invariants — Rover gender identity in the timing and skill joins

Breaking any one silently corrupts sim output. Code comments cite these as
`CLAUDE.md, "<title>"`, so keep the titles stable.

| Invariant | Detail |
| --- | --- |
| Rover: one pinned build per element, gaps filled from the other | Gender is cosmetic in-game (maintainer, 2026-10-07); the client ships each element twice (own rids, assets; Spectro/Havoc DT_SkillInfo rows differ) on shared damage ids. TIMINGS, the one decision: female build (maintainer, 2026-07-29; conservative if male is faster: unverified, OPEN-ITEMS 42). `toFemaleRover` (`map-timings.mjs`) mirrors the path (`MaleM/`->`FemaleM/`, `Nanzhu`->`Nvzhu`), else `femaleRoverByDamageIds` takes the female montage with equal damage ids and normalised name (`_W` infix, `Atatck`, trailing `_1`; not `_Child`/`_Rogue`, which share ids). No unique female match keeps the male asset, listed in `REFUSED` (`tests/rover-gender.test.mjs`). `genderMirroredFrom` marks a female montage whose first candidate came from a male source (`bulletChainEntry` keeps only that one). Row properties: `rowsByAsset` is keyed by raw rid; `ROVER_MIRROR_RID` adds the other gender's. DAMAGE TABLE: where the game filed it (Electro/Aero male id, Spectro/Havoc female), resolved by `hit-map.json`; `rowSourceRidOf` (`build-skill-join.mjs`) reads skill rows there, resolving their gauge rows under the dataset rid. `gauge-income.json` cast rows match across genders. DATASET ID: a key only, the lower id from `preprocess.mjs`'s dedupe (1309/1406/1501 male, 1604 female); presets (`src/data/storage.js`) and curated Rover entries rely on it (no migration; OPEN-ITEMS 43). History: `docs/history/rules/invariant-rover.md` |
