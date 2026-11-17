# 2026-11-17 — One skill-map helper (#55)

Wayfinder ticket **Replace the six effectiveSkillMap copies with one helper**
(map #43). Behaviour-preserving: `data/skill-map.json` has no resonator entries
today, so the four copies that ignored the curated map returned the same thing
(per #49).

**[Files Changed]**
- `src/core/skill-map.js` (new): `effectiveSkillMap`, moved out of `sim.js`.
  It is a leaf module because `sim.js` imports `skill.js` and `triggerability.js`,
  so neither could import the helper from `sim.js` without a cycle.
- Copies replaced: `sim.js` (inline in `simulateRotation`), `skill.js`
  (`resolveAllSkills`), `team-sim.js` (off-field state timeline),
  `triggerability.js` (`resonatorKitText`), `ui/components/suggested-teams.js`
  (`stepLabel`), `tools/optimize/reference-build.js` (`synthesizeReferenceRotation`).
- Imports moved from `sim.js` to `skill-map.js`: `live-weights.js`,
  `build-editor/{ability-overview,rotation,strips}.js`, `team-editor-v2.js`,
  `tools/benchmark-gap.mjs`, `reference-build.js`, and four tests.
- `tests/skill-map.test.mjs` (new), `docs/ARCHITECTURE.md` (glossary row),
  `data/wuwa-meta.json` + `data/data-version.json` (engineHash refresh).

**[Logic Altered]** Every per-resonator skill-map read in `src/` goes through
`effectiveSkillMap` (curated with a non-`_` key wins, else generated, else null).
The four curated-ignoring sites now honour the curated map. The helper is
`dataset?.`-safe, a superset of the old `sim.js` version.

**[Verification Method]** Baseline `npm test` 89/89 and sweep before the change.
After: sweep 72/0 failed, `npm test` 90/90, lint 0 errors. LOCK A changed only
`generatedAt` (reverted). LOCK B changed only `generatedAt`/`engineHash`. The new
test's source guard flags all 9 old read lines at HEAD and none now.

**[Residual Risks]** The UI touched only `suggested-teams.js` `stepLabel` and
imports; no browser smoke test ran. Build-time extractors in `tools/extract*`
and `tools/preprocess*` still read `autoSkillMap` directly by design: they run
on the generated map before curation is injected.
Process note: a `git stash`/`pop` cycle and the Write tool both left CRLF in the
working tree, which contaminated the first LOCK B hash. Files were normalized to
LF and LOCK B was rerun.

**[Updated Docs]** `docs/ARCHITECTURE.md` skill-map row.
