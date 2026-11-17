# 2026-11-16 — Wayfinder: Decide the segment seam (#50)

Worked one ticket of the roadmap map (#43): the grilling ticket **Decide the segment seam: read-only context, or continuation in and out** (#50). Full decision is in its resolution comment.

**[Files Changed]**
- `docs/GLOSSARY.md` — new term **team context**; **cross-segment carry** notes it belongs to one member and avoids "continuation".
- `.claude/rules/invariants-team-gear.md` — new invariant "Team buffs reach Intro and Outro hits by the same rules as any hit" (maintainer-confirmed game fact).
- GitHub: #50 resolved and closed; map #43 updated (decision pointer, fog cleared); new child tickets #63 (Decide one enemy for solo and team), #64 (Research: where do per-hit timings come from?), #65 (Research: what do Intro and Outro skills do in the game data?).

**[Logic Altered]** None. Planning only; no code changed.

**[Verification Method]** A data-scout lookup (code paths) confirmed that skill-type buffs are matched per hit on an exact key (`formula.js:92-93`, `buff-windows.js:252-253`), and that intro and outro segments receive no `teamBuffs` and the plain `sim.target` (`team-sim.js:766, 1252`). It also found no `outro` damage-bonus key, by grep only. `npm test`, `npm run sweep` and `npm run lint` were run after the edits.

**[Residual Risks]**
- "No outro-scoped buff key" is a single grep-based finding; #65 re-derives it from data.
- The new invariant rests on maintainer confirmation plus #60's data reading. No in-game capture was made; the maintainer's confirmation replaces it.

**[Updated Docs]** Glossary and team-gear rules as above. The rule is new, so it has no history entry.
