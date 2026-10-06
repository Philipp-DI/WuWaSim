---
name: resonator-audit
description: Deep-audit a single Wuthering Waves resonator in the WuWa Sim repo — verify the sim reproduces the character's in-game behaviour clause by clause against the game's own data tables, then evaluate performance in a real team (priority) and solo. Use whenever the user asks to check, audit, verify, validate, debug, review, or "see if X works properly / matches the game", asks why a character underperforms or overperforms, asks whether a kit is modelled correctly, asks to compare a character against a benchmark, or names a resonator alongside words like broken, wrong, missing, understated, inflated, zero, or gap.
---

# Resonator Audit

Answers two questions about one resonator, in this order:

1. **FIDELITY** — does the sim do what the game does? Every clause of the kit,
   checked against the game's own tables, not against the kit text's English.
2. **PERFORMANCE** — how does the character actually perform? **In a team
   first** (that is how the game is played and how the sim is calibrated), solo
   second as a diagnostic.

Fidelity comes first because a performance number from an unfaithful model is
noise. But do not stop at fidelity: a kit can be clause-perfect and still be
mis-teamed, and the user asked about performance too.

> **Read `references/wuwa.md` before doing anything.** This file is the
> pipeline; that file is the facts — file paths, table schemas, extraction
> recipes, the invariant checklist, the failure-signature table. Never guess a
> fact the module supplies.

---

## Step 0 — Cold start (do not skip)

```bash
npm test        # the whole suite. MUST be green BEFORE you touch anything.
npm run sweep   # every src module imports
```

A red baseline means you are auditing a broken tree, and every finding after
that is suspect. If it is red, say so and fix or report that first.

Then read, in this order:

1. **`CLAUDE.md`** and the invariant files in `.claude/rules/`
   (`invariants-*.md`, one per area). These are the highest-value artifacts in
   the repo: each row is a bug that already happened once, and most audits
   re-check these rows against one character. They load on their own when you
   open matching code, but read the areas this kit touches up front.
2. `docs/ARCHITECTURE.md` — how data flows, and "Life of a buff".
3. `docs/GLOSSARY.md` — one concept, one name.
4. `references/wuwa.md` (this skill) — where everything lives.

Resolve the subject: name → id via `dataset.resonators`. Ids are 4 digits,
`1[1-6]\d{2}`.

---

## Step 1 — INGEST the kit

Build a model of the character from `data/wuwa-data.json` before judging
anything. The module lists the exact fields. You need:

- **Abilities** — `autoSkillMap[id]`: canonical keys, `skillType` (node class),
  `formulaType` (damage class), `damageIds`, `energyGen`, `concertoGen`,
  `cooldown`, `stepDuration`.
- **Effects, from all THREE sources** — chain `S{level}.{index}`, inherent
  `IH{node}.{index}`, skill-node `SK{node}.{index}`. Missing the third source is
  a classic audit gap; it exists because a buff can be stated inside a
  Liberation/Skill/Forte node.
- **Gauges** — `resonator.specialEnergyCaps` (the game's caps) and
  `RESOURCE_DEFS` (curated name↔channel, income, spenders).
- **States / modes / roles** — `STATE_DEFS`, `resonator.resonanceModes`,
  `resonator.roles`.
- **Negative statuses** — what the kit applies, and `statusApplyRules`.
- **Off-field actions**, **outro buffs**, **tune break**.

Write this down as a checklist of *claims the kit makes*. Each claim becomes a
test in Step 2. **A clause you cannot find in the dataset is a finding**, not
something to skip.

If the resonator has **modes** (Aemeath, Lynae, Denia, Lucilla), ask which mode
to audit, or audit the one the team implies. A mode is a build-level toggle
locked for the fight — never a state.

---

## Step 2 — FIDELITY audit

Work the checklist in `references/wuwa.md` §"Fidelity checklist". It is ordered
by how often each item is actually wrong. For every item, record
**PASS / FAIL / NOT-APPLICABLE**, with the evidence.

Three rules govern this whole step:

**Prefer the game's data over the kit's English.** The repo's standing lesson
is that text parsing is the fallback, never the source. Buckets, caps, stack
counts, gauge income, status curves and scope lists are all readable from the
game's own tables — `references/wuwa.md` §"Extraction toolbox" has the recipes.
If you find yourself reasoning about what a sentence "probably means", stop and
go read the table.

**Every number needs a second source.** A value that appears in exactly one
place is a hypothesis. The strongest findings in this repo's history came from
two independent sources agreeing (a cap from `baseproperty`, an amount from
`db_buff`, and the English all matching), or from one disagreeing.

**Silence is a finding.** An effect that resolves OFF, a step that deals zero, a
gauge that reads empty, a stack count that falls back to 1 — each is either
correct-and-explainable or a bug. Never let one pass unexamined, and never
"fix" one by making it non-zero without evidence.

---

## Step 3 — CROSS-CHECK against the game

This is what makes the audit deep rather than a code review. For every claim
that Step 2 could not settle from the dataset alone, go to the game files.
`references/wuwa.md` §"Extraction toolbox" gives working recipes for:

- `db_buff` — a buff's attribute, magnitude, stack limit, duration, and its
  `ExtraEffect*` scope lists.
- `DT_SkillInfo` — which cast applies which buff (the cast→buff link).
- `db_PassiveSkill` — which EVENT applies which buff (hit/timer/tag triggers).
- `damageTable` — the real per-hit rates, including pre-multiplied variants.
- The attribute enum, the `CalculationPolicy` decode, the bullet/damage joins.

**Quote what you find.** A finding that says "the game files it as
`DamageChange` (attr 15, buff `1602201011`)" is actionable; "the bucket looks
wrong" is not.

---

## Step 4 — TEAM performance (the priority)

Run the harness:

```bash
node .claude/skills/resonator-audit/scripts/audit-harness.mjs <id> [--mode <m>] [--team <id,id>] [--passes 3]
```

It builds S0 level-90 builds with template echo stats, uses the reference
rotations, auto-picks the character's best team from `wuwa-meta.json`, and
reports solo, team, per-member shares and per-pass marginals. It mirrors
`tools/benchmark-gap.mjs`, which is the calibrated harness — do not hand-roll a
replacement.

Then interpret it. **Numbers alone are not the deliverable.** Answer:

- **Where does the damage come from?** Per-member share, and per-step within
  the subject. A carry below ~45% of team damage, or a buffer above ~20%,
  wants an explanation.
- **Is the subject a carry, an enabler, or both?** Compare their solo DPS to
  their team share. An enabler whose team total barely moves when you swap
  them out is not enabling anything — test that by re-running with a
  substitute.
- **Does the team actually connect?** Trace at least one buff from provider to
  consumer. Three team-buff paths exist by construction and a buff flows
  through exactly one (`docs/ARCHITECTURE.md`, "Life of a buff"). A team where
  the subject receives nothing is a finding.
- **Is the rotation legal?** The harness reports validator warnings.
- **Does the handoff work?** Outro → Intro carries buffs and transfers; the
  outgoing member's mode selects which outro branch fires.
- **Passes matter.** Pass 1 is the opener; passes 2–3 are steady state. Read
  marginals, not totals, when comparing to per-pass references.

**Team-only failure modes** are listed in `references/wuwa.md` §"Team-only
failure modes" — things that are correct solo and silently wrong in a team
(cross-segment gauge carry, the intro segment, shared enemy state, Tune Break
capping). Check them explicitly; they do not show up solo by construction.

---

## Step 5 — SOLO performance (diagnostic)

Solo is the control, not the goal. Use it to:

- Isolate the subject's own kit from team contributions.
- Find zero-damage or unresolved steps (the harness lists them).
- A/B a single effect by toggling it and re-running — the cleanest way to size
  one clause's contribution.

Note: `__echo__` deals 0 in 0 time unless `--real-echoes`; that is by design,
not a bug.

---

## Step 6 — EXTERNAL validation (when a reference exists)

`data/benchmark-reference.json` holds captured external measurements. If one
covers this character, compare against it — and read
`tools/benchmark-gap.mjs`'s header, which records the decisions (D1–D10) any
honest comparison has to make: slot order, auto-injected intro/outro, the
target, the **`gameTime` denominator**, and resonance modes.

If no reference exists, say so rather than inventing a target. A gap figure
without a recorded method is exactly what that file was created to stop.

---

## Step 7 — FIX (only if asked) and VERIFY

If the user wants fixes, obey the repo's rules — `references/wuwa.md`
§"Rules of engagement". The short version:

- Never hand-edit generated files; change the source and regenerate.
- Never ship an unscoped `multiplierUp`.
- No per-effect overrides when a principled derivation exists.
- Full suite + module sweep + lint, then **LOCK A / LOCK B** compared against a
  pre-run snapshot (only `generatedAt` may differ for a behaviour-preserving
  change).
- Write the session summary to `docs/history/YYYY-MM-DD-<topic>.md`. A new
  invariant goes into the matching `.claude/rules/invariants-*.md` file
  (`CLAUDE.md` only if it is cross-cutting); strike through one you falsified.

---

## Step 8 — REPORT

Use `references/report-template.md`. Non-negotiables:

- **Separate FIDELITY findings from PERFORMANCE observations.** They have
  different burdens of proof.
- **A fidelity finding is CONFIRMED only after two `verifier` subagents
  derived it independently**, from sources that are independent for that
  claim (`CLAUDE.md`, PRINCIPLES: a generated field is not independent of the
  code that generates it). Report their verdicts, including any disagreement.
- **Rank findings by damage impact**, and say the impact in numbers you
  measured, not adjectives.
- **Cite evidence inline** — file:line, buff id, damage id, table row.
- **State what you could NOT check**, and why. An audit that claims full
  coverage it did not achieve is worse than one with honest gaps.
- **Distinguish "wrong" from "unmodelled".** A missing mechanic understates; a
  mis-scoped buff inflates. Inflation is more dangerous because nothing about
  the output looks wrong.
- Correct your own earlier claims explicitly if the audit falsifies them.
