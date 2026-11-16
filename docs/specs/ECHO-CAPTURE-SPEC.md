# Echo Capture — Specification

> **STATUS: DRAFT 2026-10-18. Maintainer decisions of 2026-10-18 recorded
> (§11).** Echo-first v1 of a screen-reading inventory import. Resonators,
> weapons, the echo grader (tuning popups) and the stat checksum are later
> specs. Tracking issue: #11.
>
> **Prerequisite:** the game-data update to 3.7 runs FIRST, through the
> procedure in `docs/specs/VERSION-UPDATE-SPEC.md`. No capture phase starts on 3.6
> data.

## 1. Goal and boundaries

Build the user's echo inventory from the screens the user already looks at, so
the optimizer runs on echoes the user owns instead of hand-entered ones.

- **Reads pixels only:** a window the user shares with the page, or a pasted
  screenshot. Never memory, packets, or input automation. Kuro's fair-play
  statement names macro scripts and auto-idling as bannable; the user clicks,
  the page watches.
- **Local only.** Nothing leaves the browser; no frame is persisted.
- **CLAUDE.md principles, applied:**
  - *Honesty over results:* an unread field stays unread. A wrong import is a
    defect; an abstention is not.
  - *Data first:* every vocabulary (echo names, sets, stat pools, roll tiers)
    comes from the dataset, never typed by hand.
  - *Contradictions are findings:* a screen that contradicts the dataset (a set
    the echo cannot have) is reported as "dataset behind game", never resolved
    by picking the closest match.

## 2. Recon findings (2026-10-18: 27 screenshots at 2560×1440, repo at `PINNED_REF` 3.6)

| # | Finding | Evidence | Consequence |
| --- | --- | --- | --- |
| F1 | The live game is 3.7+, the repo is pinned to 3.6 | Arikatsu 3.7 `phantomfettergroup` has sets 36–38 (3.6: up to 35); `phantomitem` adds 8 echoes; 12 existing echoes gained a set (all six Kernel Puppets among them). In-game, Kernel Puppet: Worry shows the set "Flash of Electric Reflection", a 3.7 set; 3.7 lists Worry in `[34, 37]`, 3.6 in `[34]` | **Decided:** adopt 3.7 first (`docs/specs/VERSION-UPDATE-SPEC.md`). Capture still abstains on unknown sets and echoes and counts them (§6.4), because the next patch recreates the gap |
| F2 | No sonata crest extractor exists | Crests were hand-fetched from the Fandom wiki (commit `cf81936`, `src/ui/icons.js` comment); mixed 76 px and 128 px sources | The crest path IS in BinData: `phantomfettergroup.FetterElementPath`, unique per set (8 → `T_IconElementAttriCloud`, 37 → `T_IconElementAttriThunderError`; `AimModelElementPath` is the 128 px variant). `phantomfetter.FetterIcon` is a placeholder: one path for all 70 rows. The crest fetcher is a step of the version update (`docs/specs/VERSION-UPDATE-SPEC.md`) |
| F3 | The committed crests work as templates for the sets they cover | Probe, masked RGB distance over a scale range: 38 of 38 known-set crops top-1 correct, 3 of 3 unknown-set crops (3.7 sets) without a confident match. Detail panels and 36 px grid icons: true distance 12–46, margin ≥ 1.6. 22 px equip-grid icons: true 28–49, margin 1.16–2.17 | Read crests from detail panels only. Start thresholds in §6.3. Six panel crops have the set name printed beside the icon; the rest is ground-truthed by eye, so the maintainer re-confirms in Phase 1 |
| F4 | `echo-rules.js` rounds where the game floors the display | Tuning popups, 1-cost 5★ ATK%/HP: +5 shows 6.4% / 820 (true 6.48 / 820.8; `mainStatValueFor` / `subMainStatFor` give 6.5 / 821); +10 shows 9.3% / 1185 (functions: 9.4 / 1186). All agree at +25 | **Decided:** the sim uses true values (§4.1 says where they come from). It is an engine change, Phase 0b. Capture compares displayed values against floor-display(true) (§6.4) |
| F5 | `stat-ranges.json` CD% says `"max": 20.5` | Its own `possible_rolls` ends at 21.0; Tambourinist shows Crit DMG 21.0% | **Fixed** in the working tree (2026-10-18, `max` 21.0, not yet committed). No reader of `.max` found |
| F6 | In-game names include Phantom variants the dataset lacks | "Phantom: Twin Nova - Collapsar Blade" is MonsterId 6010180, `ParentMonsterId` 6000180; 42 such variants in 3.7 | The name vocabulary includes variants, mapped to the parent through `ParentMonsterId` (data, not an alias table) |
| F7 | Some misreads land on another valid value | ATK%, HP% and the four skill-type DMG bonuses share one tier table; flat ATK {30–60} and DEF {40–70} share 40/50/60 | Tier snapping cannot catch these. Confidence margins plus two-frame agreement are required (§6.3, §6.5), and the fixtures must cover these pairs (§9) |
| F8 | The panels differ | Bag panel: stat icon per row, set as icon only, long labels wrap. Equip panel: no row icons, set icon plus set name text, long labels shrink | Rows are segmented dynamically (§6.2). Substat type is read twice on the bag panel (icon + label), set twice on the equip panel (icon + name) |
| F9 | The UID is drawn bottom-right on every screen | `tests/privacy.test.mjs` scans text for paths, not pixels | Mask at capture; fixtures are panel crops only (§7, §9) |

## 3. Scope v1

**In:**
- **Screens:**
  - (A) Echo bag detail panel, tuned (+5…+25) and untuned (+0).
  - (B) Resonator → Echo tab equip panel, single and compare (both columns).
  - (C) Echo Upgrade screen, update-only (it shows no set or cost).
- **Records:** tuned echo, untuned stack.
- **Entry points:** paste or drop a screenshot (Phase 2); ambient capture (Phase 4).

**Out:**
- Resonators, weapons, Forte, chain.
- Tuning popups (reserved for the grader).
- Grid-card reads (F3: margins too thin at 22 px).
- The stat checksum.
- Non-English UI and non-16:9 aspect ratios.
- **Echoes below 5★: dropped** (maintainer, 2026-10-18: irrelevant for
  endgame). No record, no stack. 5★ is recognised from the main-stat value
  (§6.4), not from the card colour.

## 4. Records

```js
TunedEcho = {
  key,                       // fingerprint, §5
  echoId,                    // base monsterId (Phantom variants mapped to the parent)
  sonataId, cost, level,     // cost is implied by echoId; stored for filtering
  mainStat: { propId, addType },
  subStats: [{ propId, addType, tier }],   // in on-screen (unlock) order
  locked, discard,           // discard = the red-heart mark
  equippedBy,                // resonatorId | null — screen B text only
  firstSeen, lastSeen, dataVersion,
}
UntunedStack = { key, echoId, sonataId, mainStat, count, lastSeen }
// key = echoId + sonataId + mainStat — the game's own stacking rule
// (maintainer, 2026-10-18); count = the panel's "Owned: N"
```

- Every record is 5★, so `starLevel` is not stored; the conversion below
  writes `starLevel: 5`.
- No values are stored, only ids and tier indices. Values are derived (§4.1),
  so a correction to a table re-derives every value without re-capturing.
- A record converts losslessly into the existing Build `Echo` shape
  (`src/core/build.js`: `id, cost, level, starLevel, mainStat, subStats,
  sonataId`); conversion function plus test.
- Names follow `docs/GLOSSARY.md` (`starLevel`, not "rarity"; `sonataId`, not
  "set").

### 4.1 Where an echo stat's true value comes from

- **Main stat and the flat sub-main (ATK or HP by cost): from the game's own
  tables, verified on 3.7.**
  - `phantommainpropitem.StandardProperty` × `phantomgrowth.Value / 10000`.
  - `phantomgrowth` has one curve (GrowthId 1): 10000 at +0, plus 1600 per
    level, 50000 at +25. That is exactly the linear ×1.0 → ×5.0 that
    `echo-rules.js` already uses.
  - Example: 1-cost 5★ ATK%, standard 360. At +5: 360 × 1.8 = 648, so the true
    value is 6.48%; the screen shows 6.4%.
  - Percent props carry hundredths of a percent, so divide by 100.
  - The fix is to drop the final `Math.round` and keep the float. Display
    applies floor-display.
- **Substats: NOT in any client table.**
  - The server rolls them. `phantomsubproperty` holds one standard value per
    type, not the roll tiers, and `phantomsubpropaction` only says which levels
    add a substat (5/10/15/20/25).
  - `data/stat-ranges.json` is a curated list of DISPLAYED tiers.
  - Whether a tier hides a second decimal is *unknown*. The even steps of Crit
    Rate (0.6) and Crit DMG (1.2) fit exact values; the alternating 0.7/0.8
    steps of ATK% fit hidden hundredths (e.g. 6.46 shown as 6.4).
  - Because records store the tier INDEX, a later measurement corrects every
    echo by editing one table. Measuring it is optional: a stat-sheet test with
    one echo carrying one substat, the method behind the Novaburst measurement
    in `data-pipeline.md`.

## 5. Identity and merge

- **Same fingerprint, same record.** Fingerprint = `echoId, sonataId,
  mainStat, subStats` (types + tiers, in order). A match updates `lastSeen`,
  `locked`, `discard`, `equippedBy`.
- **Upgrade.** A read whose `subStats` extend exactly ONE stored record's
  `subStats` as a strict prefix (same `echoId`/`sonataId`/`mainStat`) is that
  record, levelled. With more than one candidate, it becomes a new record and
  the candidates are flagged `possiblySuperseded` for the user. Never pick.
- **Known limitation.** Two genuinely identical echoes collapse into one record
  (realistic only at +5/+10). The inventory view says so.
- **No auto-delete.** Capture never sees an echo leave (fed as material, data
  merge, discard). Records show `lastSeen`; the user prunes.

## 6. Decoding

### 6.1 Pipeline

frame → UID mask → screen gate → stability → layout profile → field crops →
classifiers → closed-vocabulary decode → validator → two-frame agreement → merge.

### 6.2 Coordinates

- **Reference frame.** Layout profiles are in 2560×1440 reference pixels,
  scaled by `frameHeight / 1440`. *Hypothesis, unverified:* the 16:9 UI scales
  linearly with height. A 1920×1080 fixture set confirms it before 1080p is
  claimed.
- **Dynamic rows.** Rows are located from the value column and the row
  backgrounds, never at fixed y offsets (F8: labels wrap on A and shrink on B).
- **No top-left anchors.** User overlays (FPS counters) sit there.

### 6.3 Classifiers: one rule, three vocabularies

- **Icons** (crests, stat icons): masked RGB RMS distance over a scale range
  around the profile's expected size. Accept iff `distance ≤ D_max` AND
  `runnerUp / best ≥ R_min`. Start at `D_max = 50`, `R_min = 1.4` (F3) and
  calibrate on the fixtures.
- **Glyphs** (digits, `%`, `+`, `.`, letters): templates cut from the fixtures,
  so they are the game's own font at each profile's size, not a system font.
- **Closed-vocabulary decode.** A glyph string is matched against the field's
  vocabulary:
  - echo names, filtered by the cost read on the same panel;
  - the 13 substat labels;
  - resonator names.

  Acceptance uses the same best-versus-runner-up margin, on edit distance.
- **Values never snap.** A value that is not exactly a tier of its type leaves
  the field unread.
- **Double reads must agree.** Substat type on A (icon + label) and set on B
  (crest + name) must agree, or the field is unread.

### 6.4 Validator: an echo is accepted only if every rule holds

- `level ∈ {0, 5, …, 25}`; substat count = `level / 5` (A, B). On C, locked rows
  are placeholders.
- No duplicate substat type; every value is in its 5★ tier table.
- `mainStat ∈ echoMainStats[cost]`; displayed main value =
  floor-display(true value at `(starLevel 5, level)`, §4.1). A value that fits
  a lower star level instead is dropped (§3); a value that fits none leaves
  the field unread.
- The flat sub-main (ATK/HP by cost) = floor-display(true value).
  **floor-display** = `Math.floor` for flats, floor to one decimal for
  percentages (`AttributeModel.js`, see `.claude/rules/data-pipeline.md`).
- `echoId` exists for the read cost, and `sonataId` is in that echo's set list.
  An unknown echo or set records nothing and increments `datasetBehindGame`
  with the read name and crest distance; the UI shows it.

### 6.5 Stability and agreement

- Decode a frame only when its panel region is unchanged across two samples
  (this skips transition animations).
- Accept a record only after two consecutive field-identical decodes.

## 7. Capture (browser)

- **Source.** `getDisplayMedia`; the user picks the game window (borderless
  windowed: exclusive fullscreen can capture black). Sample at 2–4 fps; the gate
  runs downscaled, and full resolution is used only for gated frames.
- **Worker.** A module worker runs the pure decoder in `src/capture/`, which
  Node tests import directly. `npm run sweep` imports every `src/` module, so
  the worker entry must not touch `self` or the DOM at module top level.
- **Privacy.** The UID region (reference box `x ≥ 2200, y ≥ 1395`) is zeroed
  before any other step. Frames are never stored or sent.
- **UI.**
  - Live counters: accepted, unread, `datasetBehindGame`.
  - The last five accepted echoes.
  - Stop.

## 8. Reference assets and the update loop

- **Sonata crests** are fetched by the version update
  (`docs/specs/VERSION-UPDATE-SPEC.md`, the crest step): from `FetterElementPath`,
  with the slug list derived from data instead of the hand-kept
  `SONATA_SLUGS`. `tests/icons.test.mjs` already asserts coverage.
- **`tools/capture/build_templates.py`.**
  - Python, like `tools/extract/`. Node cannot decode webp without a
    dependency, and the runtime stays dependency-free.
  - Output: crests resampled to 64 px RGBA plus mask, stat icons, and glyph sets
    cut from the fixtures → committed `data/capture-templates.json`. Browser and
    Node read the same file.
- **Vocabulary.** Echo names (Phantom variants via `ParentMonsterId`), set
  names, stat labels and resonator names are projected by `preprocess.mjs` from
  the same TextMap version.
- **Per game update:** the capture steps are part of the version-update
  procedure (`docs/specs/VERSION-UPDATE-SPEC.md`). Build templates, then `npm test`
  runs the fixture suite. If a screen or font changed, the maintainer captures
  new fixtures and the glyphs are re-cut.

## 9. Tests (written first)

- **Fixtures.** `tests/fixtures/capture/<profile>/<id>.png` holds panel crops
  cut by a tool from full screenshots. `ground-truth.json` holds labels the
  maintainer has confirmed. Full screenshots stay in `docs-local/` (gitignored).
- **`tests/capture-decode.test.mjs`.**
  - Any accepted field that differs from truth fails the test.
  - The abstain rate per field type is reported against a committed baseline
    and may not rise.
- **Confusable coverage (F7).**
  - Pairs: ATK% ↔ HP%, the four DMG bonuses, flat ATK ↔ DEF at 40/50/60, DEF
    50 ↔ 60.
  - The test asserts each pair has a fixture and lists the gaps.
- **Unknown set.** The Kernel Puppet: Worry +0 panel against 3.6 data must
  abstain with `datasetBehindGame`.
- **Unit tests.** Merge rules (identical, prefix upgrade, ambiguous prefix) and
  record → Build `Echo` conversion.
- **Privacy.** Every fixture's source box is disjoint from the UID box.
- **PNG in Node.** A minimal non-interlaced 8-bit decoder on `node:zlib` in
  `tests/lib/`, so no dependency is added.

## 10. Phases (each ships with its tests; test, sweep and lint green)

0. **Prerequisites:**
   - (a) Adopt 3.7 through the version-update procedure, which also brings the
     crest fetcher and data-derived slugs (F1, F2).
   - (b) **True values in the sim** (F4, decided; its own commit):
     - `mainStatValueFor` and `subMainStatFor` return the unrounded value
       (§4.1); the UI shows floor-display.
     - `normalizeBuild` re-derives the main and sub-main values from
       `(propId, addType, cost, starLevel, level)` rather than trusting a
       stored value, so saved builds pick up the true value.
     - LOCK A/B: no movement expected for +25 echoes (the ×5.0 growth is exact
       at hundredths); measure, don't assume.
1. **Core:** fixtures plus maintainer-confirmed ground truth; template builder;
   matcher core in `src/capture/`.
2. **Screenshots:** profiles A and B; the validator; the paste/drop entry; a
   "compare to equipped" readout, the seed of targeted evaluation.
3. **Inventory:**
   - Store: `localStorage` key `wuwa-sim:inventory`, using `storage.js`'s safe
     wrappers; around 1,000 records is a few hundred KB.
   - Inventory view: filters by set, cost, main stat and level; stacks;
     `lastSeen`; lock and discard.
   - The optimizer reads owned echoes.
4. **Ambient capture** (§7).
5. **Profile C** (Upgrade screen, update-only).

## 11. Decisions and open questions

**Decided by the maintainer, 2026-10-18:**
1. Update the game data to 3.7 first, as its own procedure
   (`docs/specs/VERSION-UPDATE-SPEC.md`).
2. The sim uses true values, not rounded ones (§4.1, Phase 0b).
3. Echoes below 5★ are dropped.
4. "Owned: N" stacks by echo + set + main stat (§4).

**Open:**
1. A 1920×1080 fixture set, to confirm the scaling hypothesis (§6.2).
2. Optional: measure whether substat tiers hide a second decimal (§4.1).

## 12. Glossary additions (`docs/GLOSSARY.md`)

- **capture** — reading echo data from a shared game window or a pasted screenshot.
- **layout profile** — the reference-pixel description of one screen's fields.
- **untuned stack** — the count of +0 copies sharing echo, set and main stat (the game's own grouping).
- **floor-display** — the game's display rounding (floor for flats, floor to one decimal for %).
- **dataset behind game** — a read the current dataset cannot hold (unknown set or echo); counted, never forced.
