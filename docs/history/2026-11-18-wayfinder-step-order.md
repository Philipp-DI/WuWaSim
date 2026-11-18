# 2026-11-18 — Wayfinder: roadmap step order and proofs settled (#85, #43)

## In plain terms

The roadmap is 21 steps plus one fix that goes first (Youhu's Outro, #88). Code-only steps must leave every number identical. Number-changing steps say up front what will move and by how much, then record what actually moved. The full table is on #85.

## [Files Changed]

- `docs/history/2026-11-18-wayfinder-step-order.md` (this file). No code.

## [Logic Altered]

None. Tracker only:

- #85: resolution comment posted (maintainer, grilling, 13 questions accepted as recommended), issue closed.
- #86 (Write docs/specs/ROADMAP.md): now unblocked. A comment adds the stand-alone fixes as sub-issues of the tracking issue.
- Map #43: a Decisions-so-far line.
- #97 (Outro buff join research): resolved and closed. Findings are in a collapsed comment, followed by the resolution. Verdict: structural join for 60 of 60 Outros (53 in the `20022NN` family, 7 in their own id range), so step 15 becomes the extractor. Map line added; #86 notes step 15 and its extra proof.

## [Verification Method]

The map body was re-read after editing (the #85 line is present). Cited sizes (Hiyuki card 6,910 vs 9,311; Sanhua 13.29 s → 25.79 s; hit-stop about 5.6 %) are quoted from closed tickets #48, #59 and #75, not re-derived.

## [Residual Risks]

- #97: the grants of the 7 own-range Outros rest on one source (the research agent). Step 15's tests must pin them against the game text. The FormationPolicy 0 recipient ("incoming member") and Youhu's Coordinated Attack enum (req 17, SubType 0) remain hypotheses. NN51 rows 5102–5106 have no resolved owner and are not credited.
- #97 independence: verifier A's answers on Zani, Sigrika and the own-range 7 came after a main-session follow-up that named Youhu's seed id. Its main verdict was formed without it.
- The research agent couldn't use an isolated worktree: git rejected it over a drive-letter case mismatch (`g:` vs `G:`). It runs read-only in the main tree and writes to the scratchpad.

## [Updated Docs]

None in the repo beyond this file; the decision lives on #85.
