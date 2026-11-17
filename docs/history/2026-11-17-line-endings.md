# 2026-11-17 — Working tree switched from LF to CRLF

Maintainer decision: CRLF in the working tree, no LF-enforcing hook. The hash
breaking was accepted up front, as long as the reason is recorded.

**Measured first (Node byte counts):**
- Claude Code's Write and Edit tools leave CRLF on Windows. Bash `printf` and
  Node `fs` write LF.
- The CRLF lands after the PostToolUse hook. A logging probe in `post-edit.mjs`
  read the file as LF at 09:28:53.822, and its mtime was 09:28:53.856. A
  VS Code `files.eol` setting did not change it. An LF-normalizing stop-gate
  hook was built and verified, then removed on the maintainer's call.
- Git Bash `grep -c $'\r'` misreports CR counts. Count with Node.

**[Files Changed]** `.gitattributes` (`eol=lf` → `eol=crlf`, comment
rewritten). Working tree: 724 text files rewritten to CRLF; 652 binary icons
untouched. 702 files git flagged only because the attribute changed were
refreshed with `git add --renormalize`; their index content is unchanged and
nothing was staged. `.claude/rules/generated-data-locks.md` (rule rewritten,
old paragraph moved verbatim to `docs/history/rules/generated-data-locks.md`),
`tools/engine-hash.mjs` (comment), `tests/update-game-version.test.mjs`
(README heading check is now line-ending-agnostic), `data/wuwa-meta.json` +
`data/data-version.json` (engineHash).

**[Logic Altered]** No sim logic changed. The index stays LF (`text=auto`), so
commits and diffs are line-ending neutral. Every checkout writes CRLF.

**[Verification Method]** `git diff --cached` was empty after the renormalize.
`npm run meta` refreshed the hash over the CRLF tree, then sweep and `npm test`.

**Follow-up, same session: line-ending-neutral `engineHash`.** Under CRLF the
raw-byte hash broke on every regeneration, not once. Measured: `npm run data`
rewrote `wuwa-data.json` as LF (content identical, `generatedAt` blanked),
`engineHash` went 845f… → 3e62…, and `meta-schema.test.mjs` failed. A meta
generated over an LF working file would also fail on every fresh checkout,
CI included. Maintainer chose to fix it in code: `tools/engine-hash.mjs`
`hashableText` folds CRLF to LF before hashing (a lone CR is kept), beside
the existing `generatedAt` blanking. `tests/engine-hash.test.mjs` pins it,
and its new cases failed before the function existed. The hash moved once
more as a result.

**[Residual Risks]**

- One test assumed `\n` and broke. Other LF assumptions in code that reads
  repo text files at runtime are possible; none was found by the suite.

**[Updated Docs]** `.gitattributes`, `.claude/rules/generated-data-locks.md`,
`docs/history/rules/generated-data-locks.md`.
