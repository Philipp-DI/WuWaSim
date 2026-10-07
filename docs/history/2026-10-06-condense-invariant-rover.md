# 2026-10-06 — Condense `invariant-rover.md` to current truth

**[Files Changed]**
- `.claude/rules/invariant-rover.md`: the one row, "Rover is FEMALE by IDENTITY, not by path", condensed from 6,604 to 1,497 characters, with a `History:` pointer added.
- `docs/history/rules/invariant-rover.md` (new): the row's original Detail cell, verbatim and in full, under `## Rover is FEMALE by IDENTITY, not by path`.
- `tests/instruction-files.test.mjs`: removed the file from `PENDING_STRIKETHROUGH` and the row from `PENDING_LONG_ROWS`.

**[Logic Altered]**
- No code changed. The row now states only what is in force.
- One wording is corrected against the code. The original said `gauge-income.json`'s gender rows are a "pure mirror". That holds for the CAST rows only: Spectro's `trigger` arrays differ, with 0 under 1501 and 6 under 1502. The row now says "gender cast rows (same mechanics …)".
- One condition was added from the code: `rowSourceRidOf` switches id space only when the prefix has timing rows (`build-skill-join.mjs:131-136`).

**[Verification Method]**
- The history text was checked to be byte-identical to `git show HEAD:` Detail cell.
- Two `verifier` subagents checked the final text:
  - Prose, original row vs condensed row: CONFIRMED. The first pass was PARTIALLY CONFIRMED, with six in-force items dropped; those were restored.
  - Code: CONFIRMED. The first pass was PARTIALLY CONFIRMED, over "pure mirror", a missing prefix condition and the `ROVER_MIRROR_RID` wording; all three were fixed.
- `npm run sweep`, `npm run lint` and `npm test` were run last.

**[Residual Risks]**
- The history section holds the full original cell, which is a superset of the history-only text. In-force sentences that were interleaved with history are therefore duplicated there.
- The "(else strangers' rows join)" guard has no triggering case in today's roster.
- `ROVER_MIRROR_RID[1501]` is inert, because Spectro's raw rid is already 1502.

**[Updated Docs]** The rules file and its history file, as listed above.

## Follow-up 2026-10-07 — Rover invariant rewritten around three gender layers

Source: the maintainer's handover of 2026-10-07. The pilot above stays staged; this work builds on it.

**[Files Changed]**
- `.claude/rules/invariant-rover.md`
  - The row is retitled "Rover: one pinned build per element, gaps filled from the other". It was "Rover is FEMALE by IDENTITY, not by path".
  - Its Detail is rewritten around three layers: the dataset id (a key only), the damage table (wherever the game filed it), and the timings (the female build, the only decision). 1,497 → 1,494 characters.
- `docs/history/rules/invariant-rover.md`
  - The `##` heading now uses the new title.
  - A new 2026-10-07 entry (newest first) holds the rewrite's source, the pilot row verbatim, and the struck comment lines removed from `build-skill-join.mjs` verbatim.
- `tools/extract/build-skill-join.mjs` (comments only)
  - "Pure mirror" is replaced: cast rows match for all four pairs, and only Spectro's trigger rows differ (0 under 1501, 6 under 1502).
  - `rowSourceRidOf`'s timing-rows condition is now stated.
  - The Aero refusal cause is corrected: the substitution runs, but `bulletChainEntry` keeps the raw female copy that is listed first.
  - The pointer now names only OPEN-ITEMS 38.
- `docs/OPEN-ITEMS.md`
  - Item 38's Aero cause is corrected, with the old text struck through.
  - New items:
    - 42: in-game capture of male vs female Rover timing.
    - 43: backlog for an explicit pinned map of Rover dataset ids. Not implemented.
- Aligned wording with no change of meaning:
  - `tests/rover-gender.test.mjs:2`
  - `tools/extract/export-manifest.json`: the notes string, which no test or generator checks.
  - `.claude/skills/resonator-audit/references/wuwa.md`

**[Logic Altered]** None; comments and docs only.

Contradictions found and settled with the maintainer:
- The handover's "matched by damage ids, not path" is wrong: the path mirror runs first.
- The handover's "every fill stamped" is wrong. The one gap fill, Spectro `intro`, is unstamped and recorded in `REFUSED`.
- The interim "every swap stamped" is also wrong. `bulletChainEntry` keeps each montage's first candidate, so the stamp survives only where that first candidate came from a male source (5 Spectro keys).
- The stamp clause is therefore out of the title.

**[Verification Method]** Two `verifier` subagents, three passes each:

| Pass | Prose | Code |
| --- | --- | --- |
| 1 | PARTIALLY CONFIRMED (missing timing-rows condition, dangling pointer, "unmirrored", unsourced "cosmetic") | PARTIALLY CONFIRMED ("bullet blocks", "unmirrored", stamp claim) |
| 2 | PARTIALLY CONFIRMED ("only" vs "first") | REFUTED on the stamp sentence |
| 3 | CONFIRMED | CONFIRMED (stamp predicted 68 of 68 Rover keys; Aero cause holds for all three rows) |

`npm run sweep`, `npm run lint` and `npm test` were run last.

**[Residual Risks]**
- "Gender is cosmetic" rests on the maintainer's statement and is not measured; OPEN-ITEMS 42 covers the timing side.
- "1501 male" holds by majority: its assets are 24 male and 1 female.
- Historical counts in the `rowSourceRidOf` comment and OPEN-ITEMS 38 are stale against current data ("17 hit ids", "29/15/21"). They were left untouched.
- `map-timings.mjs:62`'s "separate bullet id blocks" overstates: only Havoc has distinct blocks. It was left untouched, being out of scope.

**[Updated Docs]** As listed above.

## Follow-up 2026-10-07 — trunk-based commits

**[Files Changed]** `CLAUDE.md` (COMMIT CONVENTIONS): new step 0, trunk-based. Commit on the current branch, `main` included. Branch only when asked, or for a substantial feature, rework or new topic (maintainer, 2026-10-07). This overrides the default "branch first when on the default branch". The trigger was that `41b084e` landed on `main`; the maintainer kept it there.
**[Logic Altered]** None.
**[Verification Method]** `npm test`.
**[Residual Risks]** None.
**[Updated Docs]** As above.
