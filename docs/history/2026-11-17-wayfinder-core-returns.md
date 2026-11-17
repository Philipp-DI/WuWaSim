# 2026-11-17 — Wayfinder: what core returns to the UI

Continued the roadmap map (#43) and resolved one grilling ticket, **Decide what core returns so the UI renders per-ability damage and member timing without computing them** (#59). The full decision is in the ticket's resolution comment.

**[Files Changed]**
- `docs/GLOSSARY.md`: new terms **kit view** and **static hit inputs**, both marked planned.
- GitHub:
  - #59 claimed, resolved and closed.
  - Map #43: a decision pointer added, the #68 note in Not yet specified rewritten, and one Out of scope line (the broad read model).

**[Logic Altered]** None. Planning only.

**[Verification Method]** Grilling with the maintainer: 7 questions, all accepted as recommended. The facts came from reading `live-weights.js`, `strips.js`, `ability-overview.js`, `skill.js`, `sim.js:532-539` and `team-editor-v2.js` `clockFor`, plus the closed tickets #48 and #58. No code was changed, so no test run was needed for logic. The stop hook still runs.

**[Residual Risks]**
- Moving the team clock to core changes the page's timestamps to the engine's per-member freeze model before #62 settles which model matches the game.
- The `kitMeasure` change may re-rank substat weights for rotation-less builds with amplify or target-mod weapons. It is recorded as deliberate, but the size is unmeasured.
- Windowed chain/inherent effects missing from the cards are still unmeasured. The planned equality test is what will surface them.

**[Updated Docs]** The glossary, as above.

Note: `/wayfiner` is not an installed command. The mattpocock `wayfinder` skill is set to `disable-model-invocation`, so its steps were followed by hand from its SKILL.md.
