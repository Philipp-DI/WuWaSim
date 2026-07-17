# Calibration — Verifying the Damage Math Against the Game
## Prerequisite gate, peer to `P12-PREREQ-ENERGY-CHECK.md` and `PRE-P12-DATA-QUALITY.md`.

## 0. Why this exists

The maintainer cannot personally audit the damage math by reasoning, and Claude
can implement the consensus formula but cannot hit a training dummy to check
itself. Neither of us is a trustworthy oracle. **The game is.** This harness
offloads "is the math right?" from *reasoning* (which neither of us can fully
do) onto *arithmetic comparison* (which anyone can): put a build into the game,
read the damage number off the screen, put the identical build into the sim,
and confirm they match.

Once a number is pinned to a real in-game observation and encoded as a test, it
**can never silently drift again** — any future code change that breaks it
fails loudly. That is the whole point: convert a one-time manual check into
permanent regression protection, and make wrong math impossible to perpetuate
silently.

### Current state of the formula (already audited structurally)

`src/core/formula.js` implements the consensus WuWa equation, and its bucket
structure is correct:

```
Final = BaseDmg × BonusMult × DefMult × ResMult × (1 − DmgReduction) × CritMult
  BaseDmg  = (scalingStat × multiplier + flat) × (1 + flatBonus)
  BonusMult = (1 + dmgBonus) × (1 + amplify) × (1 + deepen)
  CritMult  = crit hit → critDmg ;  non-crit → 1 ;  expected → 1 + critRate×(critDmg−1)
  DefMult   = (atkLv+800) / ((atkLv+800) + (defLv+800)×(1−defShred)×(1−defIgnore))
  ResMult   = resTotal<0 → 1−resTotal/2 ; 0..0.8 → 1−resTotal ; ≥0.8 → 1/(1+5×resTotal)
```

What calibration verifies is **not** this structure (it is sound) but:
1. the **exact constants** (is DEF scaling `+800`? is the RES knee exactly 0.8?),
2. that each in-game effect is **classified into the correct bucket**
   (additive DMG bonus vs. amplify vs. deepen vs. flat-bonus), and
3. that the **data inputs** (multipliers, base stats) match the live game.

## 1. The core trick — ratios isolate buckets

You do not need the absolute numbers to match on the first try to learn
something. **Take the ratio of two cases that differ in exactly one input** and
the shared buckets cancel, exposing the single bucket under test:

- Case with +X% DMG bonus ÷ identical case with none = should equal `(1 + X)`.
  Verifies the DMG-bonus bucket *regardless* of whether the DEF constant is
  right (DEF cancels in the ratio).
- Crit hit ÷ non-crit hit of the same skill = should equal `critDmg`. Verifies
  the crit bucket alone.
- Same skill vs. an enemy of a different level = isolates `DefMult`.
- Same skill vs. an enemy with known RES vs. 0 RES = isolates `ResMult`.

This localizes any discrepancy to one bucket instead of leaving you staring at
a single wrong final number with no idea which term caused it. **Design every
capture as part of a ratio pair where possible.**

## 2. Capturing a clean in-game number (the craft)

Garbage in, garbage out — a calibration case is only as good as the inputs you
record. The discipline:

1. **Use the Training Ground / test dummy.** Record the **dummy's level**
   (an input to `DefMult`) and its **resistance** to your element. If the dummy
   has 0 RES and a known level, `ResMult = 1` and `DefMult` is the only enemy
   term — the simplest possible case. Confirm these, don't assume them.
2. **Read stats from a CLEAN build.** Open the character screen and record the
   *static, unbuffed* ATK (or HP/DEF), Crit Rate, Crit DMG, and any DMG bonus
   exactly as shown. Avoid any weapon passive, sonata, or team buff whose value
   you cannot read precisely — those are the silent-error sources. The first
   cases should have **zero conditional buffs active** so every input is
   unambiguous.
3. **Isolate a single hit.** Pick a **single-hit** skill, or one whose per-hit
   multiplier you know exactly. Multi-hit skills sum several multipliers and
   muddy the comparison. A character's basic-attack stage 1, or a single-instance
   skill, is ideal for the first cases.
4. **Separate crit from non-crit.** With any crit rate below 100% you will see
   *two* damage numbers as you repeat the hit: the lower (non-crit) and higher
   (crit). Record **both** — the non-crit number verifies everything except
   crit; the crit/non-crit ratio verifies crit. Do not average them.
5. **Record the skill multiplier you believe applies**, from the dataset, at the
   skill level you have in-game (multipliers scale with skill level — match the
   level you actually capture at).
6. **One element, one skill type.** Keeps `dmgBonusByElement` and
   `dmgBonusBySkillType` lookups unambiguous.

If a captured number and the sim disagree by a *consistent* small percentage
across several cases, that itself is a diagnostic — it usually means one bucket
constant is slightly off or one buff is mis-bucketed, not random noise.

## 3. Designing the case set (cover every bucket + every scaling stat)

Aim for ~12–15 cases that, between them, exercise each term at least once:

| # | Purpose (bucket isolated) | Capture design |
|---|---|---|
| C1 | Base core (multiplier × ATK × DEF), RES=0 | Single-hit ATK skill, no bonuses, clean build, 0-RES dummy. Non-crit number. |
| C2 | Crit bucket | Same as C1, record the crit number. C2/C1 = critDmg. |
| C3 | DMG-bonus bucket | C1 build + a known element/skill DMG bonus. C3/C1 = (1+bonus). |
| C4 | HP scaling | An HP-scaling skill (e.g. a HP-scaler character). Verifies `scaling: 'hp'`. |
| C5 | DEF scaling | A DEF-scaling skill if a character has one. Verifies `scaling: 'def'`. |
| C6 | Amplify bucket | A case with a known amplify effect active. C6/(equivalent no-amplify) = (1+amplify). |
| C7 | Deepen bucket | A case with a known deepen effect (some sonatas). Same ratio logic. |
| C8 | DefMult vs level | Same skill, two different dummy levels. Ratio isolates DefMult constant. |
| C9 | RES band (linear) | Dummy/enemy with known 0<RES<0.8. Verifies linear band. |
| C10 | RES band (negative) | If RES shred drives total RES below 0. Verifies bonus-zone formula. |
| C11 | DEF shred / ignore | A case applying known def shred. Verifies the (1−defShred) term. |
| C12 | Liberation / different skill type | A liberation cast. Verifies type-DMG bucket + multiplier. |

Not every game version exposes every scenario easily — capture what you can,
and mark the rest "pending". Even C1–C3 + C8 catches the majority of errors.

## 4. The record format

Maintain the table below. One row per captured case. Keep the inputs **exact**
(as read off the screen), not rounded for tidiness — rounding hides errors.

### Calibration cases

> Status legend: ✅ sim matches in-game within tolerance · ⚠ mismatch under
> investigation · ⏳ captured, not yet encoded as a test · — pending capture.

| ID | Char / Lv / Seq | Skill (lv) | Scaling stat value | CR / CD | DMG bonus | Enemy Lv / RES / shred | In-game (non-crit) | In-game (crit) | Sim (non-crit) | Sim (crit) | Δ% | Status |
|----|------|------|------|------|------|------|------|------|------|------|------|------|
| C1 | — | — | ATK = | — | 0 | / 0 / 0 | | | | | | — |
| C2 | (=C1) | | | | | | (n/a) | | | | | — |
| C3 | | | | | | | | | | | | — |
| C4 | | | HP = | | | | | | | | | — |
| C5 | | | DEF = | | | | | | | | | — |
| C6 | | | | | | | | | | | | — |
| C7 | | | | | | | | | | | | — |
| C8a | | | | | | Lv ?? | | | | | | — |
| C8b | (=C8a, diff enemy Lv) | | | | | Lv ?? | | | | | | — |
| C9 | | | | | | / 0.?? / | | | | | | — |
| C10 | | | | | | / / shred | | | | | | — |
| C11 | | | | | | / / shred | | | | | | — |
| C12 | | | | | | | | | | | | — |

### Derived ratio checks (fill from the rows above)

| Check | Expected | Observed (in-game) | Observed (sim) | OK? |
|---|---|---|---|---|
| C2 / C1 | critDmg = | | | |
| C3 / C1 | 1 + dmgBonus = | | | |
| C6 / (base) | 1 + amplify = | | | |
| C8a / C8b | DefMult ratio | | | |

## 5. Tolerance and what a mismatch means

- The game displays **rounded integer** damage. The sim emits a float. Compare
  with a small **relative tolerance (≤ ~1%)**, not exact equality — display
  rounding alone can cause sub-percent differences.
- **Random scatter under ~1%** → rounding; fine.
- **Consistent fixed-percentage offset across cases** → a bucket constant is
  off, or a buff is mis-bucketed. Use the ratio checks (§4) to localize which.
- **One case off, rest fine** → likely a wrong *input* for that case (wrong
  multiplier, an unnoticed active buff), not a formula bug. Re-capture before
  blaming the code.
- **Crit ratio wrong but non-crit right** → crit bucket / `critDmg` handling.
- **Everything scales wrong with enemy level** → `DefMult` constant (`+800`?).
- **Only high-RES cases wrong** → the RES knee (is it exactly 0.8?) or the
  diminishing-returns coefficient (is it `5`?).

## 6. The exit criterion (gate for trusting the sim, and for P12)

- At least C1, C2, C3, and one DefMult pair (C8) captured and **✅** within
  tolerance.
- Every captured case encoded as an assertion in
  `test/calibration.test.mjs` (§ companion file) so it becomes permanent
  regression protection.
- Any **⚠** mismatch either resolved (code fixed, or input re-captured) or
  documented here with a hypothesis — never left silent.

Meeting this does not prove every constant for every edge case, but it pins the
core formula and the common buckets to ground truth, which is the failure mode
that actually matters: **silent, systematic wrongness.** Once C1–C3 + C8 are
green, the engine is trustworthy for the common case, and each later capture
tightens the net.

## 7. Cadence

- Re-run `test/calibration.test.mjs` on every engine change (it's part of the
  standing test gate).
- Re-capture a couple of cases after any game patch that touches formula-adjacent
  systems, and whenever a character with an unusual mechanic is added.
- Cross-check (secondary, not a substitute for in-game): feed an identical build
  into a community calculator; divergence flags where to look. The training
  dummy remains the final word.
