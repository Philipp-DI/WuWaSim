# generated-data-locks.md — rule history

## Generated-data locks (LOCK A / LOCK B)

2026-11-17: the hashed file set became derived (`tools/engine-hash.mjs`; see
`data-pipeline.md` here, "The engine-hash file list is derived"). The sentence
before, verbatim:

    `engineHash` moves whenever an ENGINE_FILES member's content changes (even a
    comment); any OTHER changed line in either file is a real behavior regression.

The same day, hashing `data/wuwa-data.json` raised the question of its
`generatedAt` churn; the maintainer chose to blank that value before hashing.
The sentence before, verbatim:

    `engineHash` hashes RAW BYTES, so line endings are part of it. `.gitattributes`

2026-11-17 (later): the maintainer switched the working tree from LF to CRLF
after Claude Code's Write and Edit tools were measured to leave CRLF on every
edit (docs/history/2026-11-17-line-endings.md). The paragraph before, verbatim:

    `engineHash` hashes RAW BYTES, so line endings are part of it. `.gitattributes`
    pins the whole tree to `* text=auto eol=lf` for exactly that reason — without it
    a Windows checkout (`core.autocrlf=true` is the default) writes CRLF into the
    working tree while the index holds LF, and the hash then flips on any checkout,
    stash or restore with no behaviour having changed. Do not weaken that rule, and
    run `npm test` LAST — after any `npm run data` / `npm run meta` and after
    anything that rewrites the working tree.

The same session, the raw-byte hash proved to move on every `npm run data`
(LF writers vs CRLF checkout; measured 845f… → 3e62… with identical content).
An interim manual rule (restore or convert to CRLF before `npm run meta`) was
never committed; the maintainer chose to fold CRLF to LF before hashing
(`hashableText`) instead.
