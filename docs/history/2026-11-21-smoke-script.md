# 2026-11-21 — Browser smoke script; step 2 smoke-tested

## In plain terms

Earlier sessions checked the UI in a real browser (Playwright) through
throwaway scripts in `C:\tmp`. Nothing was committed, so this session did not
know a browser check was available and left step 2's check undone. The check
is now a committed script, `npm run smoke`. Its first run covers step 2 (#100):
the build and team pages render, every number is present, and there are no
console errors.

## [Files Changed]

- `tools/smoke-browser.mjs` (new).
- `package.json`: `"smoke"` script; `playwright` pinned to `1.62.1` as a devDependency. That is the version whose Chromium build (revision 1234) was already installed on this machine. `package-lock.json` follows.
- `CLAUDE.md`: the test-commands paragraph names `npm run smoke`, with a `History:` pointer.
- `docs/history/rules/CLAUDE.md.md` (new): the superseded paragraph, verbatim.
- `README.md`: `npm run smoke` added to the test commands.
- this file.

## [Logic Altered]

No app code. The script:
1. Serves the repo root with Node's `http` on a free local port (no server dependency).
2. Opens `#new/<id>`: a fresh build, pre-filled with template echoes and the signature weapon. The default is Hiyuki (1108); `npm run smoke -- <id>` picks another resonator.
3. Requires the Ability Damage Overview to have at least one damage row, and the top strip's BASIC / SKILL / LIB / OVERALL AVG cells to show numbers.
4. Clicks the build page's first "OPEN IN TEAM SIM" button and requires the team page's TEAM DPS chip to show a number.
5. Fails on any console error, uncaught page error, failed request or HTTP ≥ 400.
6. Saves full-page screenshots to `%TEMP%\wuwasim-smoke`.

It is not part of `npm test`, CI or the stop hook, because it needs the Playwright browser download.

## [Verification Method]

`npm run smoke` on Hiyuki: PASS.
- Build page: 24 ability rows. Strip: BASIC AVG 8,385, SKILL AVG 14,839, LIB AVG 54,633, OVERALL AVG 16,690.
- Team page (Chisa · Lucilla · Hiyuki): TEAM DPS 78K/s, 7.03M over 90.1 s.
- Both screenshots were read: every card is populated, nothing is blank or broken.
- `instruction-files` test passes; ESLint is clean on the new script.

## [Residual Risks]

- The smoke test checks that the pages render and show numbers. It does not check that a card's number is correct; `tests/kit-view.test.mjs` does that in Node.
- If Playwright is upgraded, the matching browser must be installed again (`npx playwright install chromium`).
- `npm install` reports existing audit findings in the dev tree; they were not looked into.

## [Updated Docs]

`CLAUDE.md` (with its history entry), `README.md`, this file.
