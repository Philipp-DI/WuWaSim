---
paths:
  - "src/core/**"
  - "src/data/loader.js"
  - "tools/preprocess.mjs"
  - "tools/preprocess/**"
  - "tools/optimize.mjs"
  - "tools/optimize/**"
  - "tools/engine-hash.mjs"
  - "data/{wuwa-data,wuwa-meta}.json"
  - ".gitattributes"
---

# Generated-data locks (LOCK A / LOCK B)

Generated-data locks for refactors (must show effectively zero diff when the
change is meant to be behavior-preserving):

```bash
npm run data && git diff --stat data/wuwa-data.json   # LOCK A
npm run meta && git diff --stat data/wuwa-meta.json   # LOCK B
```

Reading the locks: `generatedAt`/manifest-hash lines churn on every rerun —
ignore them (`git checkout --` the files if that's ALL that changed). LOCK B's
`engineHash` moves whenever a file in `engineFiles()` (`tools/engine-hash.mjs`:
the optimizer's import graph plus the data files it reads) changes, even a
comment; any OTHER changed line in either file is a real behavior regression.
History: `docs/history/rules/generated-data-locks.md`.

`engineHash` is LINE-ENDING NEUTRAL: `hashableText` folds CRLF to LF before
hashing (maintainer, 2026-11-17). `.gitattributes` sets `* text=auto eol=crlf`,
so the index stays LF and every checkout writes CRLF, while Node and Python
writers (`npm run data`, the extractors) write LF; the same content arrives
both ways, and hashing raw bytes moved the hash on every regeneration. The
only other normalization is `wuwa-data.json`'s `generatedAt` value, blanked so
a LOCK A rerun does not stale the meta. Every other byte counts. Count CR bytes
with Node, not `grep $'\r'` (Git Bash's grep misreports them). Run `npm test`
LAST — after any `npm run data` / `npm run meta` and after anything that
rewrites the working tree.
