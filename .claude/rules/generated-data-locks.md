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

`engineHash` hashes RAW BYTES, so line endings are part of it. `.gitattributes`
pins the whole tree to `* text=auto eol=lf` for exactly that reason — without it
a Windows checkout (`core.autocrlf=true` is the default) writes CRLF into the
working tree while the index holds LF, and the hash then flips on any checkout,
stash or restore with no behaviour having changed. Do not weaken that rule, and
run `npm test` LAST — after any `npm run data` / `npm run meta` and after
anything that rewrites the working tree. The one exception to raw bytes is
`wuwa-data.json`'s `generatedAt` value, blanked before hashing so a LOCK A
rerun does not stale the meta (maintainer, 2026-11-17).
