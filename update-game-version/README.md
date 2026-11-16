# Game version update

Adopting a new Wuthering Waves version (or a hotfix) into the dataset. The
procedure lives in [`steps.json`](steps.json) and runs through
[`update.mjs`](update.mjs); this file holds what a person does at each stop.
Spec: [`docs/specs/VERSION-UPDATE-SPEC.md`](../docs/specs/VERSION-UPDATE-SPEC.md).
Invariants: [`.claude/rules/data-pipeline.md`](../.claude/rules/data-pipeline.md).

## Commands

```bash
node update-game-version/update.mjs status --version 3.7   # readiness, and where the run stands
node update-game-version/update.mjs all --version 3.7      # run to the next USER or GATE step
node update-game-version/update.mjs <step> --version 3.7   # one step; for a USER step it means "done"
node update-game-version/update.mjs hotfix                 # export → verify again, at the pinned version
```

Claude Code drives this through the `update-game-version` skill
(`.claude/skills/update-game-version/SKILL.md`). Every invocation can start with `status`: the run state is in
`staging/<version>/state.json`, not in anyone's memory. Re-running a step
forgets every step after it; `status` itself only reports. A step not yet
automated (`extract`, `assets`) is done by hand and recorded by running it by
name. The orchestrator never commits or pushes.

## Setup

Copy `local.example.json` to `local.json` (gitignored) and fill in:

- `installPath`: the game's install root, the folder holding `Client/`.
- `exportRoot`: the FModel export's `Client` folder, the one holding `Content/Aki/`.

Steps marked "runs on local" probe the nanoka CDN first and refuse when it is
unreachable: it blocks datacenter IPs, so those steps need the maintainer's
machine.

## Where things land

| Path | Holds |
| --- | --- |
| `staging/<v>/arikatsu/`, `staging/<v>/baseline/` | every Arikatsu table at the target branch and at the pinned one |
| `staging/<v>/nanoka/` | nanoka at the target version, in `data/extracted-nanoka/`'s layout |
| `reports/<v>/status.md`, `diff.md`, `diff.json`, `review.md` | the reports and the review decision |
| `data/game-version.json` | the adopted version, both halves, in ONE place (`install` writes it) |

`staging/` and `reports/` are gitignored; the summary of a run goes to
`docs/history/<date>-adopt-<version>.md`.

## Steps

### status

Reads the install (newest `Client/Saved/Resources/<version>/Resource/<hotfix>/`
lane), the export's `BuildInfo.txt` (only an export carries it: it ships inside
the paks), the pin, Arikatsu's branch list and nanoka's manifest. Fails when
either half lacks the target version: a resonator in one half only ships as a
shell.

### stage-arikatsu

Every table `tools/preprocess/download.mjs` reads plus the committed
`data/bindata/*`, at the target branch, and again at the pinned branch as the
diff's baseline (only `data/bindata/*` of these is committed). An empty table
is a failed fetch, never an empty table.

### stage-nanoka

The four type indexes (`ww/<v>/<type>.json`, NO `/en/`) and every detail file
(`ww/<v>/en/<type>/<id>.json`), at the nanoka version that stands for the
target: the exact string, else its one `<v>.<n>` build. Never
`manifest.latest`, which runs ahead of `live`. `--nanoka <cdn version>` picks
one by hand when two builds exist.

### diff

Both halves. The Arikatsu half alone reported "3.6 changes nothing" while
nanoka had reworded three kits. Per table: added, removed and changed ids, new
fields, and which fields changed. Rows match by `Id`, or by `ItemId` on
`phantomitem` and `weaponconf`. A table with neither is matched by position and
marked "(by position)": an insertion there shows as a change to every row
after it. Per nanoka file: every changed leaf, as text,
param, asset path or value. Per resonator: effect-slot keys added, removed or
re-pointed, with the ones `data/effect-overrides.json` addresses marked. These
keys are read before `bindSkillScopes`, so compile can drop more; the LOCK A
diff in `compile` shows that. Shells before and after. It also checks that the
committed `data/bindata/*` match the pinned branch, or the baseline would lie.

### review

GATE. Read `reports/<v>/diff.md` with Claude Code and answer, in
`reports/<v>/review.md` (the first run writes a template):

- every semantic kit-text change: what it does to the sim;
- every changed effect-slot key, especially an **overridden** one: a moved key
  silently applies a curated patch to a different effect;
- every shell.

Then set `decision: install`. The gate opens only for the diff the review
names (`diff: <hash>`): re-running `diff` closes it again. Claude Code never
sets the decision itself.

### install

Copies `staging/` into `data/extracted-nanoka/` (detail folders mirrored: a
file nanoka dropped is removed) and `data/bindata/`, then writes both versions
into `data/game-version.json`. Refuses without the review decision.

### export

USER, maintainer's machine. Needed for the id-keyed artifacts (`external-buffs`,
`gauge-income`, `status-appliers`, `buff-facts`, `skill-join`,
`actionable-times`).

1. If FModel cannot mount the paks: update the AES key and the mappings.
2. Load the REAL install in FModel once after a patch, then close it: the
   planner reads FModel's newest log for the pak mount points.
3. With FModel CLOSED: `node tools/plan-export.mjs --profile` and
   `node tools/plan-export.mjs --profile --patch-only` (FModel keys AES keys
   and UE version to the exact game-directory path, and rewrites its settings
   on exit).
4. `node tools/plan-export.mjs --link` and `--link --patch-only`; run the
   printed commands (Developer Mode or an elevated PowerShell). Each first
   removes its previous link set (a patch leaves the old `_P` links dangling,
   and FModel's scan stops at the first one: "Mounted: 1/1"). The FULL root
   gets the base paks and their `_P` patches; the PATCH root only the `_P`.
5. Print the selection once:
   `node tools/check-export.mjs --regex --dir <BodyType>/<Dir> ...`, one
   `--dir` per new or changed resonator. FModel names them by the game's own
   internal names (3.7: `FemaleXL/Xinyuehu`, `FemaleXL/XinyuehuShen`,
   `FemaleS/Suoming`).
6. **Pass 1, full root:** load it in FModel (`Mounted: 8/8`), open Search,
   switch Regex on, paste the line, Enter, click a result, Ctrl+A, right-click >
   Export > Raw Data.
7. **Pass 2, patch root:** the same, on the patch root. It holds the hotfix
   paks alone, so it lists only what the hotfix re-ships, and its copies
   overwrite the base copies from pass 1. Never pick between duplicates by hand.

The next step, not this confirmation, decides whether the export is complete.

### check-export

`tools/check-export.mjs <exportRoot>` against `tools/extract/export-manifest.json`.
A file fails when it is missing, ZERO-BYTE (it parses as an empty table and an
extractor writes a smaller file without failing), STALE (more than 6 h older
than the newest file: left over from an earlier export), or when the export's
`BuildInfo.txt` is not the install's newest hotfix (a base copy won).

### extract

Phase 2: not automated yet. Run `tools/extract/export-manifest.json`'s
`runOrder` by hand with the `.venv` interpreter; stop on any extractor that
fails or writes a SMALLER output without an explanation. The timing chain is
not in `runOrder`; it runs before `extract_buff_facts`, which reads its output:

```bash
python tools/extract/extract_timings.py <exportRoot>/Content/Aki/Character/Role -o data/timing-data.json --report docs/reports/timing-extraction-report.md
python tools/extract/scan_bullet_timings.py <exportRoot>/Content/Aki/Character/Role -o data/bullet-timings.json
node tools/extract/map-timings.mjs
node tools/extract/build-skill-join.mjs
```

The two asset scanners take `Character/Role`, NOT the export root. Over the
root they read monster and summon skill tables too (3.7: 138 entries instead
of 64), and they write paths in a form the curated `timing-overrides.json` pins
do not match, so `map-timings` stops. At 3.7 `extract_extra_effects` wrote an
empty `requirement` map (the minifier renamed the client's variable); a
smaller output there is exactly what the stop rule exists for.

### compile

`preprocess` → `extract-forte` → `preprocess` (the `hit-map.json` cycle) →
`optimize`. Then attribute every LOCK A / LOCK B line
(`.claude/rules/generated-data-locks.md`) to the diff before going on.

### assets

Phase 3: not automated yet. Icons for new resonators, weapons and echoes;
`tests/icons.test.mjs` reports what is missing. At 3.7, by hand: echo icons
from each echo's baked nanoka `iconUrl` into the path `dynamicIconPath` derives;
sonata crests from the nanoka group icon (the Fandom wiki, the 3.5 source,
answered 403), with the slug added to `SONATA_SLUGS` in `src/ui/icons.js`.

### verify

`npm test`, `npm run sweep`, `npm run lint`. An honest red report is the
output, never a workaround.

### in-game

USER, in the game. From `reports/<v>/diff.md`, check every changed value the
character stat sheet can show: the stat sheet is the oracle, not the row or
the tooltip. New or changed screens need new capture fixtures.

### record

Claude Code: write `docs/history/<date>-adopt-<version>.md` and commit per
CLAUDE.md, COMMIT CONVENTIONS.

## Hotfix path

A hotfix ships `_P` paks that change ConfigDB without a new Arikatsu or nanoka
version (3.6.15 re-shipped `db_buff`). `update.mjs hotfix` forgets `export` and
everything after it, then runs steps 7–12 at the pinned version.
