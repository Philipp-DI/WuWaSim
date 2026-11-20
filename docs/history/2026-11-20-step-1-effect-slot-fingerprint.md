# 2026-11-20 — Roadmap step 1: effect-slot fingerprint test (#99)

## In plain terms

A new test checks that every curated effect patch, and every slot a saved
build can store, still points at the effect it was written for. Before this, a
reordered or changed data pass could silently move a patch onto a different
effect, and no test failed. No sim number changes.

## [Files Changed]

- `tools/effect-slot-pins.mjs` (new) — slot fingerprints, an offline replay of the effect passes, and `--write` to re-pin.
- `tests/effect-slot-fingerprint.test.mjs` (new).
- `tests/fixtures/effect-slot-pins.json` (new) — 43 override-target pins and 462 persisted-slot pins (S, IH, SK).
- `CLAUDE.md` — the slot-freeze invariant names its guard.
- `.claude/rules/invariants-effects.md` — `paths` list gains the tool and the test.
- this file.

## [Logic Altered]

No engine or pipeline code changed. The test has four parts:

1. **Override targets, no regen needed.** The tool replays chain and inherent effects from the committed inputs: the nanoka projection, `applyBuffFacts`, then `bindSkillScopes` with the dataset's own `autoSkillMap`. Each override key's target must match its pin. The fingerprint is `stat|condition`, hashed, plus a readable tail.
2. **Persisted slots.** Every S / IH / SK slot of the committed dataset must match its pin. These are the keys `effectStacks` can hold.
3. **The replay equals the dataset.** The replay runs on through `applyResonanceModesAndOverrides` and `markSupersededInherents`, and the result must equal the dataset field by field (key order ignored). This guards the replay itself, and catches a curated field overwritten in place without moving any slot.
4. **Self-check.** An effect injected at the head of Luuk Herssen's S6 node must change his S6.1 pin.

## [Verification Method]

- First run: 510 checks pass. The replay reproduces all 398 chain/inherent slots of the dataset, 60 of 60 resonators.
- Counterfactual 1, no regen: `bindSkillScopes`' drop was disabled (one line commented out). The test **failed** at check 3, listing Changli, Lupa, Mornye, Denia, Hsin, …. File restored.
- Counterfactual 2, #47's Variant B: overrides were moved ahead of buff facts and scoping in `main()`, then `npm run data`. The first draft (identity check only) **stayed green**: the only change with meaning was Sigrika's S6 skill lists overwritten in place, with no slot moved. Check 3 was strengthened to compare full effect content. It now **fails**, naming "Sigrika resonanceChain". `preprocess.mjs` and `data/` restored; `git status` showed only the three new files.
- Zero-diff proof: LOCK A and LOCK B on the final tree changed `generatedAt` only. Restored.
- `npm run sweep` 0 failed; `npm run lint` 0 errors, warning count unchanged (5970); `npm test` 91/91.

## [Residual Risks]

- **"Even without a data regen" holds only for parser and scoping changes.** The full pipeline downloads BinData from GitHub, so no test can run `main()` offline. The replay mirrors `main()`'s order rather than sharing it, so a pass reordered inside `main()` fails only after `npm run data` (check 3). Step 4 (freeze phase) splits `main()` into phases, and both could then call one function.
- Persisted pins fail on *any* change to a slot's stat or clause text, including a deliberate parser fix. That is intended: each such change needs `--write`, an override-key review and a note on saved-build migration. It adds friction to every effect-touching change until step 4's tombstones.
- `add` overrides: none exist today (0 empty targets). The tool pins an `add` target as `empty`, but no real case exercises that branch.

## [Updated Docs]

- `CLAUDE.md`: invariant "Effect-slot keys are FROZEN before anything reads them" names its guard (a pointer only; the rule text is unchanged).
- `.claude/rules/invariants-effects.md`: `paths`.
