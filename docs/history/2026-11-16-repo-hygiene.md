# 2026-11-16 — Repo hygiene: docs/reports local only, machine paths stripped

Grilling session with the maintainer, then execution.

## Decisions

- **Q1 — motive:** mostly noise. "Files that aren't really necessary for the repo
  to work or its integrity are just bloat."
- **Q2/Q3 — `docs/reports/`:** all 7 reports go local. Same path, gitignored, so
  the five writers (`audit-effects.mjs`, `build-skill-join.mjs`,
  `map-timings.mjs`, `reconcile_effects.py`, `optimize.mjs`) are unchanged.
- **Q4 — PII scan:** full history (313 commits, all branches), report only.
- **Q5 — history rewrite:** declined. 296 commits (2026-05-22 → 2026-10-05) carry
  an institutional author email; a rewrite would change every SHA, and the
  maintainer is retiring that address. Since 2026-10-19 commits use the GitHub
  noreply address.
- **Q6 — machine paths:** stripped from the live tree. Generated files are fixed
  at their extractor and regenerated, never hand-edited.
- **Q7/Q12 — wider bloat audit:** out of scope, tracked as issue #14.
- **Q10 — `docs/history/`:** keeps its paths (it records what happened).
- **Q11 — guard:** a `machine drive` rule in the existing `tests/privacy.test.mjs`
  (which already refused user-profile, home and AppData paths).

## Scan results

| Finding | Where | Action |
| --- | --- | --- |
| Institutional author email on 296/313 commits | commit metadata | none (Q5) |
| `G:/…` export, install and slim-root paths | 8 tracked files + history | live tree fixed |
| Emails in file contents, Windows username, tokens, keys | — | none found |
| `Mainstats.md`, `repomix-state.md` once committed | history only | no PII; left |

## [Files Changed]

- `.gitignore`: `docs/reports/` added; the 7 reports removed from the index (kept on disk).
- `tools/extract/extract_gauge_income.py`: `export_relative()` helper; the `failed`
  list now writes export-root-relative paths, as the cast lane already did.
- `data/gauge-income.json`: regenerated; only the 7 `failed[].table` strings and `generatedAt` changed.
- `tools/extract/scan_notify_semantics.mjs`: `_meta.source` is the export-relative `SOURCE_DIR`.
- `data/notify-semantics.json`: regenerated; only `_meta.source` and `generatedAt` changed.
- `tools/plan-export.mjs`: the `'G:\\WuWaSlim'` fallback is gone; `slimRoot` is
  required from `update-game-version/local.json` (exit 2 with a message otherwise).
- `update-game-version/README.md`, `local.example.json`: document `slimRoot` as required.
- `update-game-version/local.json` (gitignored, machine-local): `slimRoot` added
  with the previous default value, so behaviour on this machine is unchanged.
- `tools/extract/configdb.py`, `tools/extract/export-manifest.json`,
  `.claude/skills/resonator-audit/references/wuwa.md`: `<exportRoot>` placeholders.
- `tests/hooks.test.mjs`: the fixture uses a generic `C:\repo` root.
- `tests/privacy.test.mjs`: new `machine drive` rule with self-tests; exempts
  `docs/history/` and the generic `C:\repo` fixtures in `tests/hooks.test.mjs`.
- `.claude/rules/data-pipeline.md`, `docs/ARCHITECTURE.md`, `tools/optimize/README.md`,
  `tools/extract/reconcile_effects.py`: "(tracked)" → "(local, gitignored)".
- `docs/history/rules/data-pipeline.md`: the superseded diagram line, verbatim.

## [Logic Altered]

No sim code changed. Extractors emit relative paths; `plan-export.mjs` fails loudly
instead of assuming one machine's slim root.

## [Verification Method]

- Baseline `npm test` 88/88 before any change.
- The drive-path pattern is self-tested, and against `HEAD` it flags all 7
  previously leaking files.
- Final sweep, lint and `npm test` before the commit (see the commit message).

## [Residual Risks]

- The author email stays in public history, and in any fork or clone.
- Machine paths remain in git history and in `docs/history/` (exempt by decision).
- The guard catches drive and home paths only; it cannot recognise other
  personal data (names, emails in prose).
- `docs/reports/` content now exists only on this machine; a fresh clone must
  rerun the writers to see the reports.

## [Updated Docs]

See Files Changed; issue #14 tracks the wider audit.
