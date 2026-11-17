# 2026-11-17 — Wayfinder: settle the four open disputes

Continued the roadmap map (#43) and resolved one research ticket, **Settle the four open disputes from the research tickets** (#69). The answer, per-run verdicts and the four collapsed findings files are on the ticket.

**[Files Changed]**
- This file.
- GitHub:
  - #69: claimed, findings posted (4 collapsed comments), resolved and closed.
  - #77 filed: Intro → attack-chain stage grants. 7 resonators are missing from `STAGE_GRANTS`, 2 are partial, and Rebecca's grant is stale.
  - #78 filed (hypothesis): Qiuyuan's Liberation timing is joined to a Resonance Skill row.
  - Map #43: decision pointer added; #77 and #78 added to the bug list; Hsin caveat added to the outro cluster.

**[Logic Altered]** None. Planning only.

**[Verification Method]**
- Per dispute: one `research` agent and two blind `verifier` agents (12 in all), each verifier on a different source.
- Two splits were settled by the main session with direct reads:
  - `actionable-times.json` `1411.liberation`: stepDuration 0.1542, freezeTime null, `skillRow` route.
  - The `timing-data.json` genre of the rows verifier A flagged: all `NewEnumerator0` (Normal Attack), not intros.
- Outcomes:
  1. `8241d5e` introduced the chain overrides (3 of 3 runs agree).
  2. 62 freezes resolved at run time over the reference rotations (including estimates) vs 73 stored keys + 60 Tune Break freezes. Both counts are correct.
  3. Outro is SkillType 11 and Intro is 5. SkillType 7 is the cooking life skill.
  4. Intro chain shift: 21 of 60 per game text, 1 per structured data (Xiangli Yao). No chain node changes intro hits.

**[Residual Risks]**
- The harness's agent-worktree isolation is broken on this machine: the `g:\` vs `G:/` drive-letter case mismatch makes it refuse. The research agents ran in hand-made `git worktree`s under `C:/tmp/wf69-q*`, now removed. Two older locked agent worktrees from earlier sessions remain under `.claude/worktrees/` and were not touched.
- The planned damage-tag-7 → `outro` mapping has a known counter-example (Hsin's Intro owns 4 tag-7 ids).
- `docs/TIMING_MODEL.md:5` says "64 carry a measured `freezeTime`". The research reproduced 64 as run-time pairs *before* the once-per-animation rule, and 2 of them are estimates, not measurements. The wording was not changed; the step-based unit was not re-measured.
- The `skill.json` SkillType enum (1–7, 10–12) is research-derived and documented nowhere in `.claude/rules/`. No code reads it.

**[Updated Docs]** None besides this file.
