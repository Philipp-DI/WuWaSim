---
paths:
  - "tools/preprocess.mjs"
  - "tools/preprocess/**"
  - "tools/extract/**"
  - "tools/extract-forte.mjs"
  - "tools/fetch-nanoka-*.mjs"
  - "tools/gen-manifest.mjs"
  - "data/**"
---

# Data pipeline


```text
data/extracted-nanoka/characters/*.json   ← source (62 files → 58 resonators, schema v9)
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
changes, then `npm run meta` (optimize) to refresh the meta.

**The upstream version is PINNED** (`PINNED_REF` in `tools/preprocess.mjs`,
currently `3.6`, bumped from 3.5 on 2026-09-08). `resolveRef()` asks GitHub for the default branch, which
tracks the LIVE game — so a bare `npm run data` used to be a function of the
calendar, not of the checkout, and it silently rewrote 63,091 lines when
upstream moved to 3.6 during an unrelated engine change. That is
indistinguishable from a regression in the LOCK A diff. `--ref` still overrides,
so probing costs nothing: `node tools/preprocess.mjs --ref 3.6 --out /tmp/x.json`.

**Targeted FModel export.** Three steps, none of which need the whole client:
`node tools/plan-export.mjs --link` reads FModel's own log for each pak's MOUNT
POINT and resolves the smallest set that can hold what we need — **8 paks of
101, 3.35 GB of 89.5 GB**: 4 base plus their 4 hotfix patches — emitting
symlinks for a slim game root (FModel resolves `<GameDirectory>/Client/Content/
Paks`, so the tree must mirror that shape, and each pak's `.sig` travels with
it). It then lists the folders to export. **THE BASE PAKS ARE NOT THE LIVE
GAME.** `Content/Paks` holds the client as INSTALLED (`BuildInfo.txt` said
3.6.0); every hotfix since arrives as `_P` patch paks under
`Client/Saved/Resources/<version>/Resource/<hotfix>/` (46 paks, 9 GB, at 3.6.15)
which the client mounts OVER the base. That is why a full-root FModel load reads
248 paks when `Content/Paks` holds 55. ~~"The log is history, the disk is now":
a `_P` pak the log names but `Content/Paks` lacks was dropped as stale.~~ It was
never stale — it was in the other directory — and the export built without it
was launch day's data. The planner now resolves each chosen base pak's `_P`
sibling in the NEWEST hotfix lane and sources from the REAL install (not
FModel's current Game Directory, which is the slim root itself once in use).
Re-run after every hotfix, not just every patch. Symlinks need Developer Mode OR elevation;
the emitted commands leave errors VISIBLE (`| Out-Null` is what hid the failure
the first time). Re-run after every patch. **FModel keys the AES keys AND the UE
version to the exact GameDirectory path**, so pointing it at the slim root makes
a fresh default profile — one key, stock UE 4.26 — and saving that setting reset
the ORIGINAL profile too (`Mounted: 26/248`, 468 `ArgumentOutOfRangeException`
in `MountTo`: Kuro's pak format parsed as stock 4.26). That looked exactly like
expired keys and was not — the same morning's first load read `AES: 39/39`.
`node tools/plan-export.mjs --profile` (FModel CLOSED, it rewrites the file on
exit) clones the game's profile onto the slim root and restores `UeVersion`
68812811 (`0x041A0000` GAME_UE4_26 + 11 = the Wuthering Waves entry) on both. The paks are AES-encrypted (main key plus ~450
per-chunk dynamic keys) and Oodle-compressed, so reading them directly would mean
reimplementing CUE4Parse — the mount point is the cheap lever instead. Content is
chunked BY FOLDER, so the MOST SPECIFIC mount covering a path is the chunk that
holds it; a plain prefix test is useless because the bulk chunks mount at
`Client/Content/` and match everything (it selects 69 of 81 GB). That is a
heuristic about Kuro's chunking, which is why the flow ends at the verifier.
A full Client export is ~1 GB of ConfigDB alone (486 `db_*.db`); the extractors
read **8 of them plus a handful of small JavaScript files — ~22 MB**.
`tools/extract/export-manifest.json` is the list and
`node tools/check-export.mjs <root>` proves an export satisfies it
(`--list` prints the FModel selection, `--for <id>` adds one resonator's asset
dir, read from `timing-data.json`'s own `source_table`). VERIFY BEFORE
EXTRACTING: a missing table does not fail loudly — the extractor writes a smaller
JSON and a buff quietly stops existing. A ZERO-BYTE file is the nastier form and
the shipped export already carries two, so size is checked, not just existence.
`tests/export-manifest.test.mjs` greps the extractors for `db_*` names and fails
if the manifest omits one — it caught `db_property` and `db_resonate_chain`
missing on the first draft. `data/bindata/*` and `data/extracted-nanoka/**` come
from Arikatsu and nanoka and need NO client export at all, which is why most of a
version bump is cheap.

Adopting a version is gated on MORE than the Arikatsu branch existing. Arikatsu
supplies the BinData half (stats, damage rows, weapon conf, growth curves); the
KIT half — `inherentSkills`, `resonanceChain`, `outroBuffs`, `skillTreeBonuses`,
`statNodeBonuses`, `specialEnergyCaps`, `tuneBreak`, `roles` — comes from the
nanoka export in `data/extracted-nanoka/`, and inclusion is driven by Arikatsu's
`roleinfo` with no completeness filter. A resonator in one and not the other
ships as a **shell**: an id, a name and an element with no kit to cast. ~~Measured
for 3.6 (2026-09-03): existing content is byte-identical … both shells, nanoka is
still on 3.5.~~ nanoka published 3.6 (its manifest reads `live: 3.6`,
`latest: 3.7.0`) and **3.6 was adopted on 2026-09-08**. What the two halves
actually said, measured: the ARIKATSU half is byte-identical for existing content
(0 of 56 resonators, 0 of 89 weapons, 0 of 180 echoes, 0 of 34 sonatas; all 9,697
common `damage` rows differ only by a new `ExecutionTiming` field), but the
NANOKA half is NOT — 8 character files and 28 echo files changed, mostly typos
and icon paths but three of them semantic (Yangyang: Xuanling S6 rewords
"DMG is increased by" to "targets take … more DMG", her Forte gains ", considered
Heavy Attack DMG", and Rover: Electro's Basic drops a param). **Check both
halves; the Arikatsu diff alone will tell you a patch changed nothing.**
The seven id-keyed artifacts that lagged 3.6 (`external-buffs`,
`gauge-income`, `status-appliers`, `buff-facts`, `skill-join`, `timing-data`,
`actionable-times`) were closed on 2026-09-15 by re-running every extractor
against the 3.6 slim-root export — additive for the new content (+2 resonators,
+2 weapons, +1 echo passive, +1 applier) with the only existing-content changes
on the three resonators whose nanoka text had already changed (Rover: Electro's
Basic rework shows in the animation assets too: `sequence_length_s` 1.0s → 11.7s,
`AM_Attack04_Loop` gone), and LOCK B moved ZERO teams because none of those
steps is in a reference rotation. `timing-data.json` and `bullet-timings.json`
are GITIGNORED (11 MB + 5 MB, regenerable); a test that needs coverage reads
the committed `actionable-times.json`, never those. ~~**One data-vs-tooltip contradiction to verify in game:** Thousandfold
Deliverance's Crit DMG row is `[600]` … where the tooltip says "4%, up to 24%"
… Data outranks tooltip and the sim credits 36%.~~ **Resolved, and the lesson
is the one above.** The maintainer measured 24% at 6 stacks in game; the 600
was the launch-day row and the 3.6.15 hotfix re-shipped `db_buff` with
400/500/600/700/800 — tooltip, table and stat sheet all agree. No override was
needed and none was written: a data-vs-behaviour mismatch is the worst case and
this was not one, it was a stale export. The hotfix changed exactly three sim
inputs — that weapon, Phrolova's gauge triggers (deduplicated, same grants) and
Qingxiao's 40% amplify scope (20 keys → 4 named skills). Re-read the client's
own code before believing a mismatch: `ActiveBuff.p__` applies
`GetLevelValue(ModifierMagnitude, level) × StackCount` with no other input, so
when that arithmetic disagrees with the stat sheet, the ROW is wrong — and the
first question is which version of the row you are holding. **The tooltip is a
separately-authored string and can be wrong in EITHER direction.** The client
builds it from `WeaponConf.DescParams[].ArrayString[rank-1]`
(`WeaponModel.GetWeaponConfigDescParams`), literal text substituted into the
sentence; nothing reads `db_buff` to produce it. Thousandfold Deliverance was
the tooltip right and the row stale; **Novaburst is the row right and the
tooltip stale** — `[300]`, policy `[1]`, 3 stacks says 3% of base per stack, the
tooltip says 4%, and the maintainer's stat-sheet measurement (2026-09-16, Aalto
lv1 base 54 and Chixia lv15 base 85, floors at 0–3 stacks) admits ONLY 3%: 4% is
arithmetically impossible on both. So neither the row nor the tooltip is an
oracle; the STAT SHEET is, and a disagreement is a measurement to take, not a
number to pick. Two facts from that measurement, both read back out of the
client: `CalculationPolicy [1]` really does scale BASE ATK (the sim's
`atk = atkBase × (1 + Σ atkRatio) + atkFlat` already does — it reproduced both
characters to the integer), and the stat sheet FLOORS (`AttributeModel.js`,
`Math.floor` for flats, floor-to-one-decimal for percentages) while
`CharacterDamageCalculations.js` keeps every attribute as a FLOAT and applies
`Math.ceil` to the final damage only — so a displayed "+7" is not the number the
formula used. Bump `PINNED_REF` only together with the nanoka refresh (`fetch-nanoka-*.mjs`,
whose index files must be refreshed from `ww/<version>/<type>.json` — note NO
`/en/` in that path, and that the fetchers read `manifest.ww.latest`, which can
run AHEAD of `live`) and the derived tables keyed by id. Those extractors DO live
in this repo (`tools/extract/`); what they need is a client export, per the
targeted-export note above. Never edit the
generated files directly. When an engine file changes, keep the `ENGINE_FILES`
lists in `tools/optimize.mjs` and `tests/meta-schema.test.mjs` in sync.

**Source-swap checklist** (lessons of the 2026-07-23 Dimbreath → Arikatsu
migration; added 2026-10-05):
- After any upstream source or table-shape swap, verify stat-neutrality: ATK, HP,
  DEF, Crit Rate, Crit DMG and ER identical before and after. The migration
  silently zeroed every base DEF (Taoqi, a DEF scaler, went from 1802 to 0
  damage) until `base-stats.mjs` read `property.Def ?? property.Def_ ?? 0`.
- Audit every underscore-renamed field when a table swaps; `Def_` was the only
  one a projection read at the time.
- Arikatsu ships TextMap as a list of `{Id, Content, RedirectDbIndex}`, not a flat
  map; `download.mjs` adapts it with `flattenTextMap()`.
