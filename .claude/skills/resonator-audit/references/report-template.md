# Resonator Audit — <Name> (<id>)

**Mode audited:** <mode or "none">  **Team:** <A → B → C>  **Target:** <10% RES app | 0% RES optimizer>
**Baseline:** `npm test` <n>/<n> · sweep <n>/0 · lint 0 errors
**Dataset:** `wuwa-data.json` @ <generatedAt> (+ `patch.json` overlay)

---

## Verdict

<Two or three sentences. Does the sim reproduce this character? Where does the
damage come from in a real team? The single most important finding first.>

---

## FIDELITY findings

Ranked by measured damage impact. Each is a defect in how the sim reproduces
the game. Inflation before understatement — inflation hides itself.

| # | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| 1 | inflates / understates / neutral | <one line> | `file:line`, buff `id`, damage id | <measured Δ, or "unmeasured — why"> |

### 1. <Finding title>

**What the game does.** <From the game's own tables. Quote the row/value.>

**What the sim does.** <From the code/dataset. Cite `file:line`.>

**Why they differ.** <Root cause, not symptom.>

**Impact.** <A/B measurement: number before → number after, and how you got it.
If unmeasured, say so and say why.>

---

## Checklist coverage

The `references/wuwa.md` §3 checklist, so gaps are visible rather than implied.

| # | Item | Result | Note |
|---|---|---|---|
| 1 | Every step deals damage | PASS/FAIL/N-A | |
| … | … | | |

**Not checked:** <items and why — no data, out of scope, blocked.>

---

## TEAM performance (priority)

**Team:** <A → B → C>, <n> passes, <target>.
**Why this team:** <meta suggestion / user-specified / benchmark-pinned>

| member | damage | share | on-field | last-pass marginal |
|---|---|---|---|---|
| | | | | |

**Team DPS:** <n> over <gameTime>s (denominator = `gameTime`).

- **Where the damage is.** <Per-member and per-step. Name the top 2–3 casts.>
- **Role in the team.** <Carry / enabler / both. Evidence, e.g. team total with
  vs. without the subject.>
- **Buff connectivity.** <At least one buff traced provider → consumer, naming
  the path. Anything the subject should receive but does not.>
- **Rotation legality.** <Validator warnings, or none.>
- **Handoff.** <Outro → Intro: what carries, mode branch taken.>
- **Team-only failure modes** (`wuwa.md` §5): <each checked, result.>

---

## SOLO performance (diagnostic)

| | value |
|---|---|
| damage | |
| gameTime | |
| DPS | |
| zero-damage steps | |
| unresolved steps | |

<What solo isolates that team obscured, or vice versa.>

---

## External comparison

<If `benchmark-reference.json` covers this character: the gap, the method
(D1–D10 decisions), and what is attributable to modelling vs. build quality.
If not: say plainly that no reference exists and no gap figure is claimed.>

---

## Recommendations

Ordered by impact per unit of work. Each says what to change and what it is
worth.

1. **<Change>** — <where>, <expected Δ>, <risk>.

---

## Residual risks / open questions

- <What could still be wrong, and what would settle it.>
- <Assumptions made and why.>
- <"none" only if truly none.>
