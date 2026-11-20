# 2026-11-20 — Roadmap step 0: Youhu's Outro no longer applied as All DMG (#88)

## In plain terms

Youhu's Outro should double only Coordinated Attack damage, but the sim doubled
all damage of the next character. The parser now refuses a grant whose scope it
read but cannot place, instead of falling back to "All DMG". Every Youhu team
drops by the predicted amount; no other team moves.

## [Files Changed]

- `tools/preprocess/resonators.mjs` — Outro parser: `outroBuffRefusals`; Pattern D gated on "no scoped match", not "no scoped grant".
- `tools/preprocess.mjs` — copies `outroBuffRefusals` onto the resonator; `skillNodeDesc` keeps a refused Outro out of `skillNodeEffects`.
- `tests/outro-scope-refusal.test.mjs` — new.
- `data/wuwa-data.json`, `data/data-version.json`, `data/wuwa-meta.json` — regenerated.
- `.claude/rules/invariants-effects.md` — new row "An unresolved Outro scope is REFUSED, never widened"; test added to the `paths`.
- this file.

## [Logic Altered]

Root cause: Pattern A matched "Coordinated Attack DMG … Amplified by 100%", but
`labelToScope` maps that label to nothing (Coordinated Attacks are off-field
actions, with no formula skill type), so `addGrant` returned silently. Pattern D
fires when the segment added no grant, so it then read the bare "DMG Amplified
by 100%" as All DMG.

Now `addGrant` records an unmapped label in `outroBuffRefusals`
(`{ label, value, duration, mode?, reason: 'outroScopeUnmapped' }`) and Pattern D
fires only when no pattern matched at all, placed or refused. Without the
`skillNodeDesc` change, an empty `outroBuffs` would have let the Outro text be
read as a self-targeted node effect.

Second refusal, no number change: Aemeath's two mode branches ("All-DMG
Amplification", cleaned to "All- DMG") were already dropped silently before this
change (`outroBuffs` absent before and after). They are now visible as refusals.
Fixing that label is out of this step's scope; it belongs to #91 / step 15 (Outro
buff extractor).

## [Verification Method]

- Test first: `tests/outro-scope-refusal.test.mjs` failed 7 of 8 before the fix and passes 12 of 12 after.
- LOCK A: `wuwa-data.json` changed in exactly two resonators (Youhu: `outroBuffs` → `outroBuffRefusals`; Aemeath: `outroBuffRefusals` added), plus `generatedAt`.
- LOCK B, predicted vs measured. Every distinct Youhu team in the old meta (57) was re-scored with `scoreTeam` against the old and the new dataset, each in its own process (the member-build cache is module-level):

  | | predicted (#88) | measured |
  | --- | --- | --- |
  | teams | 57 | 57 |
  | median | −25.2 % | −25.19 % |
  | range | −3.7 to −45.0 % | −3.71 to −44.97 % |

  Largest movers (team DPS, `scoreTeam`):

  | Team | before | after | Δ |
  | --- | --- | --- | --- |
  | Baizhi>Youhu>Carlotta | 66,848 | 36,787 | −44.97 % |
  | Baizhi>Youhu>Xiangli Yao | 51,659 | 28,735 | −44.38 % |
  | Baizhi>Youhu>Yangyang: Xuanling | 56,033 | 32,187 | −42.56 % |
  | Zhezhi>Youhu>Carlotta | 72,428 | 41,806 | −42.28 % |
  | Baizhi>Youhu>Augusta | 49,139 | 28,466 | −42.07 % |
  | Youhu>Carlotta>Lumi | 63,545 | 37,137 | −41.56 % |
  | Sanhua>Youhu>Camellya | 38,979 | 22,956 | −41.11 % |
  | Smallest: Youhu>Verina>Hiyuki | 58,414 | 56,246 | −3.71 % |

  The small drops are teams where Youhu's Outro hands off to a support.
- Meta diff (old vs new `wuwa-meta.json`): of 416 listed teams, 26 kept their place in a list and changed DPS; all 26 contain Youhu, 0 without. 38 Youhu teams left the top lists and 38 others entered. `characters` and `memberBuilds` are unchanged. `sequenceEval` changed for 11 anchors, and in every one the old top team contained Youhu. Top team changed for 9 anchors (Sanhua, Baizhi, Lingyang, Zhezhi, Youhu, Carlotta, Jinhsi, Jiyan, Lumi).
- `npm run sweep` 0 failed; `npm run lint` 0 errors; `npm test` 90/90.

## [Residual Risks]

- The correct value, +100 % on the incoming member's own Coordinated Attacks (e.g. Cantarella), is not paid: the formula has no coordinated skill type. This understates such a receiver. That is the safe direction, but nothing currently measures it. Hypothesis, unverified (#88).
- `outroBuffRefusals` is data only; no UI surface shows it yet. The build and team pages don't display Outro grants at all today, so no UI change was needed. No browser smoke test was run (no UI file changed).
- Aemeath's Outro is still paid nowhere (#91, step 15).

## [Updated Docs]

- `.claude/rules/invariants-effects.md`: new invariant row (the rule from the #84 placement, now written down).
