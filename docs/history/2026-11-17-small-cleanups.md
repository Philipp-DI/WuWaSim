# 2026-11-17 — Small cleanups: stats.js bucket literal, sim.__test__ (#56, map #43)

Wayfinder task ticket, done under the map's execution override. Both items
were confirmed by **Verify: the small deletion-test findings** (#49).

## [Files Changed]

- `src/core/stats.js`: new module-private `emptySkillTypeBuckets()`; the three
  copies of `{ basic: 0, heavy: 0, skill: 0, liberation: 0, intro: 0 }`
  (`echoContribution`, the add-props accumulator, `makeEmpty`) call it.
- `src/core/sim.js`: `export const __test__` removed. Five of its six members
  were already public exports. The sixth, `HARDCODED_STEP_DURATIONS`, is
  private and no test read it (#49).
- `tests/timing-model.test.mjs`: imports `resolveFreezeTime`,
  `resolveFreezeSchedule`, `resolveTimingSource`, `deriveGameTimes` and
  `resolveStepDuration` directly from `sim.js`.
- `data/wuwa-meta.json`: `engineHash` and `generatedAt` only (regenerated).

## [Logic Altered]

None. The helper returns a fresh object per call, as the literals did, since
callers accumulate into it with `+=`.

## [Verification Method]

- LOCK A: `npm run data` changed only `generatedAt` (file restored).
- LOCK B: `npm run meta` changed only `generatedAt` and `engineHash`. The hash
  moves because `stats.js` and `sim.js` are engine files.
- `npm run sweep`: 72 imported, 0 failed. `npm run lint`: 0 errors.
  `npm test`: 90/90 files passed.

## [Residual Risks]

None. `sed -i` briefly rewrote both `src` files to LF; they were normalized
back to CRLF before the locks ran.

## [Updated Docs]

This file. Map #43 Decisions-so-far gains one line.
