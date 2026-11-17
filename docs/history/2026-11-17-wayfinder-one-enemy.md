# 2026-11-17 — Wayfinder: one enemy for solo and team

Continued the roadmap map (#43) and resolved one grilling ticket, **Decide one enemy for solo and team** (#63). The full decision is in the ticket's resolution comment.

**[Files Changed]**
- `docs/GLOSSARY.md`: new terms **enemy timeline** (marked planned) and **target**.
- GitHub:
  - #63 claimed, resolved and closed.
  - #71 filed: within one team run, negative-status stack hits are priced with DEF shred and DEF ignore, while ticks and afflictions are priced without them.
  - Map #43: a decision pointer added, and #71 added to the bug list in Not yet specified.

**[Logic Altered]** None. Planning only.

**[Verification Method]** Grilling with the maintainer: 5 questions, all accepted as recommended. The facts came from reading `enemy-status.js:1497-1560` (`soloStatusDamage`) and `:984-994` (`computeNegativeStatusDamage` reads DEF via `nsDefMult`), `sim.js:1063-1110`, and `team-sim.js:318-350, 885, 925-961, 1009-1040`. No code changed and nothing was measured.

**[Residual Risks]**
- The zero-diff claim for the merge step is a plan. It is proven only when the step lands (LOCK A / LOCK B plus the solo `statusDamage.total` test).
- #71 needs a game fact (do DEF shred and DEF ignore reach negative-status damage?). Until that is settled, team status totals carry an inconsistency of unmeasured size.
- In the ticket, Q1's wording had segments "record" their applications onto the team context. That conflicts with the glossary, which defines the team context as read-only to segments. The resolution keeps the context read-only: a segment returns its applications and team-sim appends them.

**[Updated Docs]** The glossary, as above. `.claude/rules/invariants-status.md` "Status damage: solo builds its OWN enemy, teams SHARE one" still describes today's code and is left unchanged until the merge step lands.
