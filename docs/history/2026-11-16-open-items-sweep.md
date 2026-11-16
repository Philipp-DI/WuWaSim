# 2026-11-16 — OPEN-ITEMS sweep into GitHub issues (#15)

Grilling session with the maintainer, then execution. Prerequisite of #14, which
untracks `docs/history/archive/`.

## Decisions

- **Q1–Q7 (process):**
  - One issue per item; group only on a shared root cause.
  - Sub-items fold into their parent.
  - Bodies have a current-state summary, the verbatim text in `<details>`, and
    a permalink pinned to `c5e58cc`.
  - Labels: `needs-triage` plus a type label, and a `Part of #15` line.
  - For a drop, one `file:line` piece of evidence is enough.
  - Clear blocks were approved in bulk.
  - The lazy-migration line in `docs/agents/issue-tracker.md` was reworded.
- **Q8–Q19 (per item):** recorded as the decision table on #15
  (issuecomment-6924608247).
- **Captures are optional** (maintainer): some in-game tests can't be run
  without access to the resonator. No issue is hard-blocked on a capture; an
  untestable case keeps its assumption, labelled "hypothesis, unverified".
- **Q20 (numbering):** item numbers are the raw numbers in the file. A Markdown
  preview renumbers ordered lists (CommonMark), which hid items 36–43 and showed
  item 35 as 27. Issues cite the raw number, the bold heading and the line.

## Outcome

- **25 issues filed (#18–#42):** 24 migrated items, plus #42, which is new (8
  resonators with no suggested teams; surfaced while re-checking item 5).
- **Merged into existing issues:** item 24 → #9; item 17 → #10 (Tier-1
  remainder, swap-in count 5 vs the doc's 8); item 16 → #11.
- **Dropped:** 5, 8, 9, 11, 13, 21, 26, 35 (policy part), 37, doc hygiene.
- **#8 does not cover item 22's remainder.** #8 is weapon/sonata team buffs; 22
  is per-resonator state. Item 22 became #33.
- **New labels:** `priority: low`, `in-game-capture`.

## Not verified

The per-item evidence comes from a single re-check agent with `file:line`
citations. No `verifier` pairs were run (Q5: triage only, and drops can be
undone through the archive). Left open:
- whether item 38's `1406203` fix landed (noted in #39)
- whether Aemeath's S3 is still hot (noted in #37)
- the count of ambiguous attribution rows (noted in #24)
