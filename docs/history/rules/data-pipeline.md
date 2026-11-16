# History — .claude/rules/data-pipeline.md

## The upstream version is PINNED

### 2026-10-19 — 3.7 adopted

The pin sentence before 3.7 was installed, verbatim:

**The upstream version is PINNED** (`data/game-version.json`, read by
`tools/preprocess.mjs` as `PINNED_REF`; currently `3.6`, bumped from 3.5 on 2026-09-08).

### 2026-10-18 — the pin moved to data/game-version.json

The version-update folder (`update-game-version/`) made `data/game-version.json`
the one place both halves' versions live. The sentence before, verbatim:

**The upstream version is PINNED** (`PINNED_REF` in `tools/preprocess.mjs`,
currently `3.6`, bumped from 3.5 on 2026-09-08).

## Bump the version only through update-game-version/

### 2026-10-18 — the three nanoka fetchers merged into update-game-version/fetch-nanoka.mjs

`tools/fetch-nanoka-{chars,echoes,weapons}.mjs` were replaced by the staged
fetcher, which pins the target version and never reads `manifest.ww.latest`.
The sentence before, verbatim:

Bump `PINNED_REF` only together with the nanoka refresh (`fetch-nanoka-*.mjs`,
whose index files must be refreshed from `ww/<version>/<type>.json` — note NO
`/en/` in that path, and that the fetchers read `manifest.ww.latest`, which can
run AHEAD of `live`) and the derived tables keyed by id.

## Pipeline diagram

### 2026-11-16 — docs/reports/ made local only

`docs/reports/` became gitignored (generated, regenerable, not needed for the
repo to work). The diagram line before, verbatim:

    docs/reports/meta-validation.md           ← generated QA report (tracked)
