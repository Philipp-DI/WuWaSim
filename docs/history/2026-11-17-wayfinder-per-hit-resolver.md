# 2026-11-17 — Wayfinder: Decide the per-hit modifier resolver (#66, #72)

Worked one grilling ticket of the roadmap map (#43), **Decide the per-hit modifier resolver** (#66), plus the research ticket it opened, **Research: does IntervalScale or hit-stop change the bullet tick schedule?** (#72). The full decisions are in the two resolution comments.

**[Files Changed]**
- `docs/GLOSSARY.md`: corrected `damageAt` (spawn instants, not hit instants; struck through the old wording); new terms **hit time** and **hit-stop**.
- `docs/history/2026-11-17-wayfinder-per-hit-resolver.md`: this file.
- GitHub:
  - #66 resolved and closed (its Youhu/Baizhi slip was corrected after #72).
  - #72 created, researched, resolved and closed. The method-1 findings are posted as a collapsed comment.
  - New child tickets: #74 (Research: does attacker hit-stop delay later bullet spawns?), not yet worked.
  - New plain issue #73 (generated skill keys double the skill type, `basic_basic_attack_3`), `needs-triage`.
  - Map #43: two decision lines added. In the bug-cluster fog, the DMG% window bug moved into the resolver step and #73 was added.

**[Logic Altered]** None. Planning only; no code changed.

**[Verification Method]**
- #66 was decided by grilling with the maintainer, on the measurements from #64 and #46.
- #72 ran the "Verified means independently derived" procedure:
  - one research agent (client JS plus a ConfigDB census);
  - verifier A (client JS only);
  - verifier B (bullet tables and recorded in-game captures only).
- All three agree on the schedule and on IntervalScale. The hit-stop claim was refuted in general and holds for 509 of 543 multi-hit rows.
- The research agent could not get an isolated worktree, because the harness refused it over a path-case mismatch. It ran in the main checkout with writes confined to the scratchpad, and `git status` stayed clean.

**[Residual Risks]**
- Nothing about per-hit timing has been measured in game. The only capture is Sanhua basic 1 (210 ms), which cannot test later hits. **Out of scope by maintainer decision (2026-11-17):** input and server latency skew in-game measurements of sub-second hit timings, so per-hit times rest on the code trace and the game data, and no in-game check is planned.
- Untraced and taken as 1 in normal combat: whether the bullet delta already includes global time dilation, and the attacker's forever time-scale.
- #74 may show that attacker hit-stop shifts spawn times themselves. That would move every extracted spawn, not just per-hit offsets.
- Run counts differ between agents because their filters differ (543 vs 455 multi-hit rows). Not reconciled, and no decision depends on it.
- A leftover harness worktree, `.claude/worktrees/agent-a83600d4e2e0b69fa`, is clean and was left in place.

**[Updated Docs]** Glossary as above. No instruction files changed.
