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
