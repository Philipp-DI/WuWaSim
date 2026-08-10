# Handover — the DPS gap, and the harness that must come first

Written 2026-08-08. Picks up after `60a7e68`, which committed the external
reference to `data/benchmark-reference.json`.

---

## 1. The task, in order

1. **Build the harness.** Nothing in the repo runs the sim against the
   benchmark; the comparison has been ad-hoc four times and every number it
   produced has evaporated. Build it BEFORE any further gap analysis.
2. **Re-measure.** Produce a current, reproducible gap figure.
3. **Then** investigate, using the anchors in §4.

Do not skip to 3. That is what happened the previous four times.

---

## 2. Every prior gap figure is DEAD

**2.60x, 2.09x, 1.80x — do not quote any of them.** Two reasons:

- Neither the inputs nor the method were written down, so none is reproducible.
- Five damage-affecting changes landed after 1.80x was measured: Qiuyuan's
  scoped +50% (`05c643e`), Hiyuki's 500% Crit. DMG (`7c180e8`), Xiangli Yao's
  chain extra hits (`23b86f1`), the `forte_heavy` → `heavy` matcher which moved
  Changli AND Hiyuki (`7f930fa`), and the multiplierUp scope fix (`42e11ba`).

There is currently NO valid gap number. Producing one is step 2.

---

## 3. The reference

`data/benchmark-reference.json` — hand-editable, records an EXTERNAL
measurement, never read at sim time. Self-consistency verified on commit (every
share, time sum, damage sum, per-pass DPS and cross-pass rollup reconciles).

**Target: 6,533,757 damage over 78.84s = 82,874 DPS**, across three passes —
Aemeath 4,633,096 · Denia 1,306,453 · Chisa 594,209.

**Method, easily lost:** the team DPS denominator is the **SUM of per-member
on-field times**, not wall-clock. Pass 1 = 12.33 + 6.35 + 8.66 = 27.34s.

**Build assumptions (maintainer, 2026-08-08):**

- All three members **S0 on BOTH sides**. Chain-gated effects never unlock, so
  the multiplierUp scope work does not move this benchmark. A caveat about
  Chisa's S3.0 +120% was raised and correctly dismissed on these grounds.
- Use the app's **DEFAULT echo stats** — the same baseline the recommender uses.
  The min/max substat spread is noticeable but far too small to explain the gap,
  so it is deliberately not part of the reference.
- Weapons all R1: Aemeath Everbright Polestar (21020076), Denia Forged Dwarf
  Star (21050076), Chisa Kumokiri (21010056). Sonatas: Trailblazing Star (27),
  Chromatic Foam (28), Rejuvenating Glow (7).

---

## 4. Two gear-independent anchors

A mismatch on either is a pure engine defect and cannot be argued away as a
build difference. Check these FIRST after the harness runs — they localise the
gap far faster than the totals do.

1. **Tune Break = 62,689.** From the game's own LevelModifier. Used 2026-08-07
   to show solo Aemeath was within 1.14x, which is what moved suspicion off
   per-character damage.
2. **Chisa receives NO team buffs from either teammate**, yet measured 1.37x low
   while both teammates were ~2.1x low. That delta is the strongest single lead:
   roughly **1.5x of the gap lives in the team-buff lane**, not in per-character
   damage. If the re-measure reproduces that shape, go straight at the team-buff
   path (`docs/ARCHITECTURE.md`, "Life of a buff" — three disjoint paths; a buff
   flows through exactly one).

---

## 5. Translating the prose rotations

The reference stores the source tool's own prose. It must be mapped to skill
keys. Maintainer clarifications, 2026-08-08:

- **"Hold Basic to hit Basic 1, 2, 3"** (Chisa, pass 1) and **"Spam Basic 1, 2,
  3"** (passes 2–3) are the SAME THING: input mechanics only. Chainsaw Mode
  allows holding or queueing because the attacks come quickly, but mechanically
  it is just her Basic Attack chain in Chainsaw Mode. Do not model hold vs spam
  as different moves.
- **Chisa has no Intro in pass 1 because she OPENS.** That is natural, not a
  data gap — the first character on field cannot intro. It is why her on-field
  time is 8.66s in pass 1 against 7.07s in passes 2–3. Do NOT "fix" it by
  injecting an intro; note that `team-sim.js` auto-injects an intro for swapped-in
  members, so the opener must be excluded from that.
- Named moves in parentheses are the game's names for chain stages: "Rending
  Lunge (Basic Attack 3)" = basic 3, "Death Snip (Basic Attack 4)" = basic 4.
  Pass 1's "Rending Lunge Basic Attack (Cancel)" is a cancelled stage — decide
  explicitly whether the sim models the cancel or treats it as the full stage,
  and write the decision down.

Everything else maps directly: Intro / Echo / Liberation / Skill / Forte Skill /
Heavy Attack / Tune Break / Outro.

Rotation order is significant and passes differ — read each pass's own
`rotations` block rather than assuming pass 1 repeats.

---

## 6. Suggested harness shape

A test or tool that:

1. Loads `data/benchmark-reference.json`.
2. Builds the three members: S0, level 90, the weapons/sonatas above at R1, and
   the app's DEFAULT echo stats (use the same helper the recommender uses, so
   the baseline cannot silently diverge).
3. Runs the 3-pass team sim with each pass's own rotation.
4. Prints, per pass and in total: sim damage, reference damage, ratio — per
   member and for the team — plus the Tune Break anchor.
5. Prints the CHISA SHAPE explicitly: her ratio against the other two, since
   that is the diagnostic, not the total.

Make it a tool (reportable, run on demand) rather than a pass/fail test at
first — the gap is large and a failing test would just be noise. Once the gap is
understood, ratchet it as a test so it cannot regress.

---

## 7. Standing verification protocol (maintainer's rule)

> Two independent sub-agents must verify claims; only when all agree can work be
> marked done. Extended 2026-08-08 with a THIRD doing a text/regex-side check
> "to lean against the numbers".

Give each agent the CLAIM and the METHOD; require CONFIRMED / PARTIALLY
CONFIRMED / REFUTED with `file:line` evidence. Tell them to DERIVE, not confirm —
an agent asked to "check this" tends to agree. Have them compute their own
numerator and denominator so counts triangulate independently. Record
disagreements rather than smoothing them over.

It has returned a correction on every run so far — including three of my own
overreaches in one session, and a root cause two prior passes had missed.

Time is not a constraint; token economy is. Prefer `node -e` queries over
reading `data/wuwa-data.json` (200k+ lines).

---

## 8. Other open work (not part of this task)

From `docs/HANDOVER-multiplierup-scope.md` and `docs/HISTORY.md`:

- 11 chain-extra-hit candidates withheld pending a kit-text read (`KIT_VERIFIED`
  in `tools/preprocess/chain-extra-hits.mjs`). Zhezhi's S6 extra Ivory Herald is
  real but resolves onto the wrong parent.
- Hiyuki's Glacio Bite instance + S6 +25% amplify — the number the code called
  unavailable now exists (`affliction-damage.json` row 1007, buffs 1108501133 /
  1108501511 at a fixed 1.0). Never built.
- Yuanwu S3 `DamageAugment` stat-scaled flat add. Never built.
- One `unknown` formulaType remains (Lynae), pinned by a ratchet.
- Hiyuki S6.2 is a Crit. DMG value mis-parsed as `multiplierUp` — a parse bug,
  not a scope one.
- The pairing-membership discrepancy (two agents agreed on a count of 9 but not
  which 9) is unresolved and recorded.
