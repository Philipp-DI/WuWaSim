# Handover — the DPS gap, decomposed

Written 2026-08-13. Picks up after `06fe9a1`. Supersedes the *analysis* half of
`HANDOVER-dps-gap-harness.md`; that document's §3 (the reference), §5 (rotation
translation) and §7 (verification protocol) remain in force and are not repeated
here.

**The harness now exists and runs.** Every number below is reproducible with
`node tools/benchmark-gap.mjs` and `node tools/benchmark-gap.mjs --variants`.
Quote these; do not re-derive by hand.

---

> ## ⚠ SUPERSEDED IN PART — 2026-08-13, later the same day
>
> Steps 1 and 2 were executed and **the baseline moved**. Every gap figure in
> §1 and §2 below was measured against the WRONG ENEMY: the harness ran a
> level-90 target at 10% RES, and the reference's own stated conditions are a
> **level 100 boss at 20% RES**. Both sides now also spend the reference's own
> stat budget rather than the recommender's template.
>
> **The current baseline is `1.497x` team damage / `1.514x` DPS**, not 1.395x —
> and the residual is NOT "on the order of 1.15–1.20x" as §2 argues. See
> `HISTORY.md` 2026-08-13 "The DPS gap: the harness was measuring the wrong
> enemy". Re-run the harness for current numbers; the tables below are kept as
> the record of what was believed, not as figures to quote.
>
> Three specific claims below are **refuted** — each is struck through in place:
> §2's composition to ≈1.18x, Step 2 (Z2, the outros), and Step 4.1 (the 352k
> shift). Steps 3, 5 and 6 stand.

---

## 1. Current measured state (2026-08-13)

```
member     sim damage   reference    gap      absolute miss   share of gap
Chisa         338,270     594,209   1.757x         255,939         13.8%
Denia       1,183,614   1,306,453   1.104x         122,839          6.6%
Aemeath     3,163,278   4,633,096   1.465x       1,469,818         79.5%
TEAM        4,685,162   6,533,757   1.395x       1,848,595
TEAM DPS       61,561      82,874   1.346x   (denominator 76.11s vs 78.84s = 1.036x)
```

Two things follow immediately and both are easy to get backwards:

- **The time denominator is essentially correct** (1.036x). This is a DAMAGE
  gap, not a timing gap. Do not spend effort on the timing model.
- **The ratio and the prize point at different members.** Chisa has the worst
  ratio (1.757x); Aemeath owns **79.5% of the absolute miss**. Optimising
  Chisa's ratio to 1.0 wins 256k; the same on Aemeath wins 1.47M.

### The old lead is dead — read this before re-reading the old handover

`HANDOVER-dps-gap-harness.md` §4 anchor 2 predicted Chisa would be the member
*closest* to reference, which would have localised ~1.5x of the gap in the
team-buff lane. **It does not reproduce.** Chisa is the *furthest* member
(1.757x vs. a 1.284x mean for the two buff-receiving carries — 0.731x the wrong
way). The team-buff-lane hypothesis that the last several sessions were built
on is refuted. Do not resume it without new evidence.

---

## 2. The reframing: most of the gap is not one missing mechanic

`--variants` moves each decision axis independently. Results:

| axis | run A total | team gap | Chisa gap |
| --- | --- | --- | --- |
| (baseline) | 4,685,162 | 1.395x | 1.757x |
| D6 neutral 4-cost mains | 4,762,682 | 1.372x | **1.429x** |
| D7 zero-resistance target | 5,205,735 | **1.255x** | 1.581x |
| D8 derived openers ON | 5,130,858 | 1.273x | **0.764x** |
| D9 tune_rupture modes | 3,490,293 | 1.872x | 1.757x |
| Z1 real echo ids equipped | 4,905,105 | 1.332x | 1.591x |

Three of those axes are **build/target assumptions the harness had to pick**,
not engine defects — D6 (Chisa is healer-tagged, so `templateStats` hands her a
Healing Bonus 4-cost main while the carries get Crit DMG), D7 (team-page 10% RES
vs. optimizer 0%), and Z1 (`templateStats` sets echo `id: null`, so every
`__echo__` step deals 0 damage in 0 time and the echoes contribute no base
stats).

Composed — the axes are roughly multiplicative, per the harness's own note —
those three alone take the team gap from **1.395x to ≈1.18x with no engine
change whatsoever.** That is over half the gap sitting in harness input choices.

~~**So the residual true engine-side gap is on the order of 1.15–1.20x, not
1.40x.**~~ **REFUTED 2026-08-13.** The composition reaches ≈1.18x only by
adopting the **0% RES** axis (D7), which is the one axis Step 1 below says the
evidence contradicts — and the evidence was stronger than Step 1 knew, because
the ANCHOR 1 figures it reasons from were printed from a stale hardcoded string
describing a different code path (`benchmark-gap.mjs:532-536`, now computed).
The reference enemy is **harder** than either default (lv100 / 20% RES), so
settling D7 honestly WIDENS the gap. D6 and Z1 are legitimate and were adopted;
D7-toward-zero was not. **Measured residual after settling all three: 1.497x.**

The sentence that remains true is the last one: the gap does decompose, and
there is no single missing 1.4x mechanic. But it does not decompose to 1.18x.

---

## 3. The work, in order

### Step 1 — Settle the assumption axes and re-baseline (do this first)

Nothing downstream is measurable until the baseline stops moving. This is a set
of **decisions**, not an investigation, and it is cheap.

1. Run `node tools/benchmark-gap.mjs --variants` and confirm the table in §2
   still reproduces (it is the current committed state; if it does not, stop and
   find out what changed).
2. Decide each axis explicitly and **write the ruling into the harness header
   next to the existing D6/D7/Z1 prose**, preserving the old text
   (strikethrough, not deletion — house rule):
   - **D6** — is the healer-tagged Healing Bonus main the intended baseline for
     a benchmark that pins weapon and sonata but not echo mains? The reference
     records a DPS run; a real player on this team almost certainly did not run
     a Healing Bonus main on Chisa. Recommendation: **neutral mains become the
     baseline**, with the role-aware template kept as a variant.
   - **D7** — 10% RES (team page) vs. 0% (optimizer). These disagree inside our
     own codebase, which is its own smell. Note that ANCHOR 1 independently
     lands the reference enemy at *just past 20% RES* (Tune Break reads 64,343
     at 20% against a reference 62,689). That is evidence the reference enemy
     has MORE resistance than either of our defaults, which pushes the gap the
     other way. Settle it against the anchor, not against preference.
   - **Z1** — echo `id: null` is a genuine modelling hole even outside the
     benchmark: it silently zeroes every echo cast and every echo base stat.
     Decide whether `templateStats` should keep returning null ids at all.
3. Re-run and record the new headline number. **That number is the baseline for
   every step below.**

Deliverable: one commit, harness header updated, new baseline in `HISTORY.md`.

### ~~Step 2 — Z2: nine outro segments deal zero damage (real defect, bounded)~~

> **REFUTED 2026-08-13 — DONE, and it was not a defect.** The claim is true; the
> conclusion is wrong. All three Outro Skills are **buff-only in the game's own
> text** — Chisa's *Unraveling - Law Zero* raises negative-status max stacks,
> Denia's *Unfinished Lies* and Aemeath's *Silent Protection* hand mode-gated
> amplification to the incoming resonator. None contains a damage clause, so
> `OUTRO_DMG_RE` ([resonators.mjs:903-905](../tools/preprocess/resonators.mjs#L903-L905))
> correctly matches nothing and `effectiveSkillMap` filters nothing. A zero here
> is the right answer. Roster-wide, 13/56 have an outro damage key and 2 more
> model it as an off-field turret; the other 41 are buff/heal transfers, which is
> ordinary WuWa design — the invariant's fix did not "fail to reach" anyone.
> `simulateOutro`'s off-field refusal is not in play either: all three have no
> `offFieldActions` at all.
>
> The sweep did turn up a **real, narrower defect**: **Lynae (1509)** "Attack the
> target and deal {0} Spectro DMG" and **Iuno (1410)** "Attack the target to deal
> {0} Aero DMG" both state outro damage but omit the "…of X's ATK" tail the regex
> requires, so extraction drops them silently. Neither is on this team.

The original text follows, kept as the record:

The harness header documents this as measured, not assumed: **none of Chisa
(1508), Denia (1211) or Aemeath (1210) has ANY `skillType === 'outro'` key in
`effectiveSkillMap`**, so `simulateOutro` finds nothing to cast — across all
nine outro segments in the 3-pass run. Every reference rotation ends in Outro.

This sits directly against the CLAUDE.md invariant *"An Outro Skill has NO level
curve … the multiplier is read from the sentence that STATES it"* — which was
supposed to have fixed exactly this class. **Whatever that pass fixed, it did
not reach these three.**

Steps:
1. Confirm the zero at source, not through the harness:
   `node -e` over `effectiveSkillMap` for 1508 / 1211 / 1210, listing any
   `skillType === 'outro'` key. Expect none.
2. Determine which side is broken — does `preprocess.mjs` fail to emit an outro
   damage row for these three, or does it emit one that `effectiveSkillMap`
   filters out? These are different fixes; do not guess.
3. Check the roster-wide blast radius: how many of the 56 resonators have a
   damaging outro row today? If the answer is "few", this is not a
   three-character bug and the invariant's fix never landed broadly.
4. Fix the cause. Re-run LOCK A (`npm run data`) — this WILL produce a real
   dataset diff, which is expected and correct here.

Note the interaction: `simulateOutro` deliberately refuses resonators whose
off-field actions carry an `outro` trigger (two paths, one cast). Verify none of
these three is being refused for that reason before treating it as missing data.

### Step 3 — Chisa: the D8 swing says this is rotation, not damage

Turning derived openers ON moves Chisa from **1.757x to 0.764x** — she flips
from the worst member to overshooting. A swing that large from a rotation-shaping
flag means Chisa's gap is dominated by *what she casts*, not by how hard her
casts hit. Chasing her damage modelling would be chasing the wrong thing.

Steps:
1. Diff the step list the harness actually runs for Chisa against the reference
   prose in `data/benchmark-reference.json`. The translation decisions are D3/D4
   in the harness header; re-verify each against her `autoSkillMap` entries.
2. Specifically re-examine D4 — both her "hold" and "spam" prose map to
   `forte_heavy_sawring_blitz_1/2/3`. If Chainsaw Mode gating is not satisfied
   at the moment those steps run, they may be resolving to something weaker or
   being dropped.
3. Check her opener handling against D1: she opens pass 1, so `team-sim.js:685`
   omits her pass-1 intro. Confirm that is happening and is not costing her a
   segment it should not.
4. Do **not** simply switch D8 on to close the number. Openers-ON changes the
   rotation away from the one the reference actually ran; the 0.764x overshoot
   is evidence of that, not a fix.

### Step 4 — Aemeath: 79.5% of the absolute gap

Only after steps 1–3, because her number moves when the baseline moves.

Two concrete threads, both already half-documented:

1. ~~**The unverified 352k shift.**~~ **RESOLVED 2026-08-13 — REFUTED.** It is
   not an engine shift at all. Both figures are reproducible *today* as harness
   **flags** on the unchanged dataset: `--zero-res` gives 3,514,753 and
   `--real-echoes` gives 3,162,652. The clincher is
   `5,143,350 × 0.9 = 4,629,015.00` exactly — the 10% resistance factor — with
   the remaining +62,385 being Denia's Dark Core to the unit. The two
   measurements were taken under **different flags**, and the near-match that
   hid it ("Chisa still matches at 373,548 vs 375,856 under the same flags") is
   a coincidence: she loses 10% to resistance and gains ~10.4% from echo base
   stats. **No Crit-DMG leak, no S6-onto-S0 bug, no dataset change.** A dataset
   that reproduces the *old* number under a flag cannot be the thing that
   changed. Original text follows:

   **The unverified 352k shift.** `HISTORY.md` (2026-08-12) records Aemeath's
   team total moving 3,514,753 → 3,162,652, attributed to "an Aemeath Crit-DMG
   double-count correction reaching the regenerated dataset" and explicitly
   "not chased further". Today's harness reads 3,163,278 — i.e. the
   post-correction value, and the correction *widened* her gap by ~352k.
   **The specific question:** the benchmark is **S0 on both sides**, and the
   CLAUDE.md `afflictionCritRate` invariant is about Aemeath's **S6**. An S6
   chain effect must not move an S0 build at all. If it did, either the fix
   leaked past its chain gate or it also touched a non-chain effect. Resolve
   this — it is the single best-defined open number in the project.
2. **Her negative-status lane is 815,297** of 3,163,278 (25.8%) — by far the
   largest status lane on the team. Status damage is data-driven from
   `status-damage.json`; verify her per-stack values and cap against the game
   tables rather than assuming the lane is right because it is large.

### Step 5 — `memberFires` is not carried across the Intro segment

Independent of the gap; a correctness fix worth doing while the context is warm.

`runIntroSegment` ([team-sim.js:743](../src/core/team-sim.js#L743)) carries
`sim.memberResources` across the auto-injected Intro but **never writes
`sim.memberFires`** — while the rotation segment does exactly that at
[team-sim.js:886](../src/core/team-sim.js#L886), and *reads* that ledger at
[team-sim.js:877](../src/core/team-sim.js#L877). Any `castMatch` trigger keyed
on an Intro cast is therefore invisible one segment later.

This is the same bug class as the gauge-carry fix in `06fe9a1`, which fixed
resources and left the trigger ledger behind. The fix is small but
**bidirectional**: `simulateIntro`
([team-sim.js:1403](../src/core/team-sim.js#L1403)) already returns the full
`simulateRotation` result (so `.fires` is present and merely unused), but it
does not accept a `carryInFires` parameter either — so the Intro neither
receives the prior ledger nor hands its own on. Mirror the rotation segment's
`shiftFiresToLocal` / `shiftFiresToTeam` treatment on both sides.

Add a test: a resonator whose Intro fires a `castMatch` trigger should show that
trigger live in the following rotation segment.

### Step 6 — Housekeeping (low risk, do any time)

- **Working tree**: `data/wuwa-data.json`, `data/data-version.json`,
  `data/wuwa-meta.json` are dirty with **`generatedAt`-only** diffs from audit
  reruns. Verified timestamp-only — `git checkout --` all three per CLAUDE.md's
  LOCK reading guidance. (This also confirms **LOCK A and LOCK B are both
  clean**: a full `npm run data && npm run meta` reproduces the committed
  dataset exactly.)
- **Dead code**: [formula.js:111](../src/core/formula.js#L111) —
  `target.attackerLevel` is a `// legacy alias` with **zero** other occurrences
  anywhere in `src/`, `tools/` or `tests/`. Remove per the no-shim rule.
- **Stale doc**: `docs/OPEN-ITEMS.md` is stamped "Updated 2026-07-30" and
  predates the multiplierUp-scope audit, gauge-income extraction, Denia's Dark
  Core and the harness. A reader landing there first gets a wrong picture.
- **Disk clutter**: gitignored worktree `.claude/worktrees/agent-a4fdaa440f4723d64`
  (pinned at `42e11ba`) doubles hits on recursive scans. Invisible to
  `git status`; remove it.

---

## 4. Verification protocol (unchanged, still mandatory)

`HANDOVER-dps-gap-harness.md` §7 stands: **two independent sub-agents must
verify a claim, with a third doing a text/regex-side check.** Give each the
CLAIM and the METHOD; require CONFIRMED / PARTIALLY CONFIRMED / REFUTED with
`file:line`. Tell them to **DERIVE, not confirm** — an agent asked to "check
this" tends to agree.

It has returned a correction on every run so far. It caught the refutation in §1
of this document.

Token economy: prefer `node -e` queries over reading `data/wuwa-data.json`
(200k+ lines).

---

## 5. What NOT to do

- **Do not resume the team-buff-lane hypothesis.** Refuted in §1.
- **Do not chase the timing model.** The denominator is within 1.036x.
- **Do not look for one 1.4x mechanic.** §2 shows the gap decomposes; ~~over half
  is harness input assumptions.~~ Two of the three assumption axes were real and
  are now settled; the third (D7) pointed the other way. The gap after settling
  them is **1.497x**, so most of it is NOT harness input assumptions.
- **Do not quote §1/§2's tables.** They were measured against a lv90/10%-RES
  target; the reference's enemy is lv100/20% RES. Re-run the harness.
- **Do not "fix" ANCHOR 1's overshoot by softening the target.** It is now an
  exact hit on the unbuffed formula; the residual is that the sim applies the
  team's DEF shred/ignore to the tune bar and the reference does not.
- **Do not quote 2.60x / 2.09x / 1.80x**, and now also do not quote any figure
  from before 2026-08-13 — the axes in §2 mean a gap figure is meaningless
  without its configuration.
- **Do not turn D8 on to close Chisa's number.** See step 3.4.
- **Do not ratchet the harness into a pass/fail test** until steps 1–3 land. It
  is a reportable tool by design; a failing test now is noise.

---

## 6. State of everything else (2026-08-13 audit)

Two independent audits plus direct verification: **the codebase is healthy.**
`npm test` 71/71, `npm run sweep` 67 imported / 0 failed, `npm run lint` 0
errors (3081 style-only warnings, all sanctioned by the S3/S4 ratchet policy),
LOCK A and LOCK B both clean, git tree clean apart from the timestamp churn in
step 6. Every CRITICAL INVARIANT spot-checked across both audits still holds in
code. The open work is the gap analysis above — not the engine's foundations.
