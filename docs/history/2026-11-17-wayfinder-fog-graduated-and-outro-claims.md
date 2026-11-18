# 2026-11-17 — Wayfinder: fog graduated, single-source claims verified

Continued the roadmap map (#43).

The frontier was empty (all 28 tickets closed), so the four **Not yet specified** patches were graduated into six tickets, with the maintainer's approval:
- #81 Verify the single-source bug claims (research)
- #82 Decide the ROADMAP.md format (grilling)
- #83 Decide whether Phase E (#9) is a roadmap step (grilling)
- #84 Place each open issue on a roadmap step (grilling, blocked by #81)
- #85 Settle the full step order and each step's proof (grilling, blocked by #82, #83 and #84)
- #86 Write `docs/specs/ROADMAP.md` (task, blocked by #85)

#81 was resolved this session. The answer, the per-run verdicts and the collapsed findings file are on the ticket.

**[Files Changed]**
- This file.
- GitHub:
  - #81–#86 created as sub-issues of #43, with blocking wired natively.
  - #81 claimed, findings and resolution posted, and closed.
  - Filed:
    - #87 stale "Running total" (already verified on #46)
    - #88 Youhu's Outro is applied as All DMG
    - #89 Outro-buff text parser (Brant/Cantarella 25 %, Baizhi/Verina/Buling durations, Rebecca per-stack)
    - #90 Outro buffs never expire
    - #91 team-wide Outro grants reach only the incoming member
    - #92 Encore's and Rebecca's Outro damage is missing
    - #93 Kumokiri has no recipient gate
    - #94 the "N hits" label counts damage rows
    - #95 Jinhsi's Incandescence is not modelled
    - #96 heal Outros and healing-triggered sonata windows (disputed)
  - Map #43: **Not yet specified** emptied, and the decision pointer for #81 added.
  - #84: the issue list now includes #87–#96.

**[Logic Altered]** None. Planning only.

**[Verification Method]**
- #81 used one `research` agent (a hand-made worktree, see Residual Risks) and four blind `verifier` agents. Claims 1–7 had a structured-data verifier and a prose verifier; claims 8–9 had their own pair.
- Verdicts agree on all nine claims across the three runs. Sizes come from different team sets: top-3 per anchor, slot-order variants, and all 341 meta teams.
- Headline: Youhu's Outro supplies a median 25 % (up to 45 %) of team damage over the 57 meta teams that contain Youhu, all over-credit.
- Open disputes were filed, not split: Encore's size (+4.61 % as an off-field turret vs +2.77 % as an outro key on Mornye>Encore>Lucy, in #92) and the heal-Outro sonata interaction (#96).

**[Residual Risks]**
- All damage sizes use template builds and curated rotations, not in-game measurement.
- The Kumokiri trigger "inflicts a Negative Status" and every Outro `{n}`-to-meaning mapping rest on game text. No raw ConfigDB buff table is in the repo.
- Single-witness side findings sit in the issues labelled "hypothesis, unverified":
  - Jiyan's and Xiangli Yao's Outro damage
  - Rover: Electro's duration
  - Hsin's and Xuanling's conditions
  - the `kitMeasure` row divisor
  - the cancel-warning unit
- The harness's agent-worktree isolation still refuses on this machine (the `g:\` vs `G:/` case mismatch). The research agent ran in a hand-made worktree at `C:/tmp/wuwasim-research-81`, now removed together with its local branch. The fresh worktree the harness created and then refused was removed too. Three older locked agent worktrees remain under `.claude/worktrees/` and were not touched.

**[Updated Docs]** None besides this file.
