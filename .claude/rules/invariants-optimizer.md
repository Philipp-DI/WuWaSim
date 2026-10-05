---
paths:
  - "tools/optimize.mjs"
  - "tools/optimize/**"
  - "src/core/{live-weights,stat-ranking,stat-priority,substat-allocate}.js"
  - "src/data/meta-loader.js"
  - "src/ui/components/suggested-teams.js"
  - "src/ui/components/build-editor/suggested-teams-panel.js"
  - "data/{wuwa-meta,reference-rotations,benchmark-reference}.json"
  - "tests/optimize-*.test.mjs"
  - "tests/{team-rank,team-enum,suggested-teams,suggested-team-slots,meta-loader,meta-schema,live-weights,stat-ranking,synergy-hints}.test.mjs"
---

# Invariants — Team ranking and suggestions

Moved verbatim from `CLAUDE.md` on 2026-10-05 (see its INSTRUCTION FILES section).
Breaking any one silently corrupts sim output. Code comments cite these as
`CLAUDE.md, "<title>"`; the titles are unchanged.

| Invariant | Detail |
| --- | --- |
| The suggested-teams bar and its numbers are ONE measurement | ~~`score` came from an openers-ON 3-pass total while the card showed a no-opener single pass.~~ Both halves were defensible and the pairing was not: the pool shipped a 90% card out-DPSing a 95% one, which is indistinguishable from a broken calculator. Everything now comes from the openers-ON multi-pass run, reported as the AVERAGE of its passes (`passes` carries the three marginals — N-total minus (N−1)-total, so post-hoc lanes like negative-status DoT cannot fall out), and `score` normalizes `teamDps`, the figure the card headlines. `tests/meta-schema.test.mjs` asserts DPS never rises as the bar falls |
| S0 is the ranking BASELINE, and what a chain costs is a SEPARATE table | Sequence nodes need duplicate copies, which cost either extreme luck or real money, so the realistic build is S0 with a signature weapon and `team-rank.js` builds every member at chain 0 deliberately — refinement past that is user-driven, which is what the app is for. The question that leaves unanswered is what a copy BUYS, and `tools/optimize/sequence-eval.js` answers it: the resonator simmed in their OWN baseline meta team (`byCharacter[id][0]`) with ONLY their sequence level raised, teammates held at S0, reported as damage and percentage over S0. Gear is held fixed — the cached `representativeMemberBuild` is reused and only `setChain` applied — which is what isolates the node from a gear difference. TWO gains are reported because a support kit needs both: `own` is the whole story for a carry and reads ZERO for a buffer, `team` catches exactly that. The S0 row IS the suggested-team card's own `teamDamage` and a test asserts they are equal, because both are `scoreTeam` at chain 0 — the same one-measurement rule the card already lives by. A node can never make a team WORSE, so a negative gain is a modelling defect and is FLAGGED (`suspect`), never clamped or dropped: a missing row reads as "this node does nothing", which is a different and wrong claim |
| A derived opener can be fiction, and a team of only those is not suggestable | The opener is DERIVED, not curated, and for some kits it derives absurdity — Jiyan needs 189–211s of filler to charge his first Liberation, Encore 114–144s. `gatedLibs` cannot find them (it reads 0 on all 416 shipped teams); `addedTime` is the signal. A credible opener costs no more than ONE ROTATION of the team it opens — relative, so no invented constant — and a team where NO member clears that bar is dropped by `rankTeams`. Measured: 330 of 416 kept, all 52 anchors keep suggestions. CURATED teams are exempt and flagged instead, because silently dropping a maintainer-asserted comp hides the finding |
| Live weights fall back to the KIT, and a stand-in must be INERT | With an empty or flawed rotation, `live-weights.js` measures the resonator's basic kit — mean expected damage per hit across every curated ability, the OVERALL AVG reading of `strips.js abilityAverages()` — not a curated reference rotation (those covered only 53/56 resonators when this was decided). Prefer a measure already on screen over one that describes someone's plan. Check every synthetic stand-in for inertness: a seeded `cost: 1` echo silently added 456 flat HP through `echo-rules` sub-mains and threw four HP scalers off the identity until it became `cost: 0`. |
