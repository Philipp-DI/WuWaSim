# 2026-11-17 — Wayfinder: preprocessing decision + two research tickets

Continued the roadmap map (#43). Resolved one grilling ticket and two research tickets. Each ticket's resolution comment holds the full detail.

**[Files Changed]**
- `docs/GLOSSARY.md`: new term **tombstone (effect slot)**, marked planned.
- GitHub:
  - Resolved and closed: **Decide preprocessing: a slot-freeze phase or a full effect compiler** (#51), **Research: where do per-hit timings come from?** (#64), **Research: what do Intro and Outro skills do in the game data?** (#65).
  - New ticket: **Decide the per-hit modifier resolver** (#66).
  - Map #43 updated: decision pointers, fog graduated, the bug list extended, and one out-of-scope line.
- Research branches pushed, never merged: `research/per-hit-timings`, `research/intro-outro-kinds`.

**[Logic Altered]** None. Planning only.

**[Verification Method]** Each research ticket ran method 1 (the research skill, on a branch) plus two independent `verifier` subagents, on data versus code/prose. Their agreements and disagreements are recorded on the tickets. `npm test` was run after the edits.

**[Residual Risks]**
- "Tag 7 = Outro" is a structural inference with two independent supports. No game string states it.
- The outro-buff resonator join (`db_buff 20022NN`) is partly value-matched (hypothesis). Runs disagree on the outro SkillType id (7 vs 11).
- The #65 sim-gap list is single-source; each item is verified when its step is planned.
- Per-hit times rest on one source plus one in-game point.
- The automatic worktree isolation refused stale worktrees under `.claude/worktrees/`, which were left in place, so the research runs used `C:/tmp` worktrees, removed afterwards.

**[Updated Docs]**
- The glossary, as above.
- The maintainer retracted the statement "no Outro Skill DMG in the game" (recorded on #65). The invariant added on 2026-11-16 ("a buff naming Intro or Outro Skill DMG does [apply]") already matches that.
