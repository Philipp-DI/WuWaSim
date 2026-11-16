# 2026-11-16 — Archive untracked; CALIBRATION.md promoted to docs/

Executes #16 (prerequisite) and #14, both decided in the 2026-11-16 triage.

## #16 — CALIBRATION.md (commit f800602, pushed)

`CALIBRATION.md` is a living runbook: `tests/calibration.test.mjs` sends
contributors to its §2, §4 and §5. Moved with `git mv` to `docs/CALIBRATION.md`,
content byte-identical (rename, 0 lines changed).

## #14 — `docs/history/archive/` local-only

- Lightweight tag `archive-2026-11` on f800602, the last commit that tracks the
  archive. Pushed to origin with the commit (1619905).
- `docs/history/archive/` added to `.gitignore`, removed from the index with
  `git rm -r --cached` (30 files). All 30 stay on disk.
- CLAUDE.md and README each say how a clone reads it:
  `git show archive-2026-11:docs/history/archive/<file>`.
- The ~40 citations of archive paths in `src/`, `tools/`, `tests/`, CI and lint
  config are left as they are (triage decision 3).

## [Files Changed]

- `docs/history/archive/CALIBRATION.md` → `docs/CALIBRATION.md` (#16).
- `tests/calibration.test.mjs`: four comment citations repointed (#16).
- `docs/NEGATIVE-STATUS-REFERENCE.md` §7: new path; test dir named `tests/` (was `test/`) (#16).
- `docs/history/archive/README.md`: the CALIBRATION row struck through with a "moved to" note (#16; in the tag, now untracked).
- `.gitignore`: `docs/history/archive/` entry (#14).
- `CLAUDE.md`, `README.md`: one sentence each on the local-only archive (#14).
- `docs/history/archive/` (30 files): removed from the index only (#14).

## [Logic Altered]

None. Docs, comments and repository tracking only; no code reads the archive.

## [Verification Method]

- `git grep "archive/CALIBRATION.md"` outside `docs/history/`: empty.
- `git ls-files docs/history/archive`: empty; `ls docs/history/archive`: 30 files.
- `git show archive-2026-11:docs/history/archive/HISTORY.md`: succeeds.
- `git status` clean after the commit (the gitignore covers the folder).
- CLAUDE.md: 189 lines, 13.7 KB (limits 200 lines, 15 KB).
- `npm run sweep`, `npm run lint` (0 errors), `npm test`: green.

## [Residual Risks]

- A fresh clone has no archive on disk; the citations resolve only through the
  tag (pushed); deleting or moving that tag would orphan them.
- The maintainer's on-disk archive is now the only working copy; edits to it are
  no longer versioned.

## [Updated Docs]

CLAUDE.md, README.md, `docs/NEGATIVE-STATUS-REFERENCE.md`, this summary.
