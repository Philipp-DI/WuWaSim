# Cast-time sensitivity analysis — findings (2026-07-11)

**Question that prompted it:** our per-skill-type cast-time constants are
*fabricated* (sim.js `HARDCODED_CAST_TIMES` / preprocess `CAST_TIMES`; the raw
game data carries **zero** timing fields — see `docs/LANE-B-ASSET-EXTRACTION.md`).
Before investing in extracting real animation times from the paks, measure how
much cast-time error actually changes the conclusions we publish.

**Re-run:** `node docs/cast-time-sensitivity.mjs` (main) and
`node docs/cast-time-drilldown.mjs` (tail characterization). Both self-locate the
repo root, hold member builds fixed, and drive the **real** ranking path
(`representativeMemberBuild` + `simulateTeamRotation`, 3-pass, openers ON).

---

## TL;DR — the verdict is CONDITIONAL, not "extraction is useless"

Under the **current sim**, team rankings (by `teamDamage`) are near-perfectly
stable to ±20% cast-time error (Spearman ρ ≈ 0.999; #1 team never changed in 48
trials). **But the analysis can only see what the current model exposes**, and
two model limitations — both flagged by the maintainer (2026-07-11) and now
first-class caveats below — are exactly where real times *would* become
load-bearing:

1. The **energy/opener model excludes the dominant real energy sources**, which
   produces physically absurd openers (300 s+ of filler to reach a *first*
   Liberation). Those cases are mis-modeled, not "correctly ranked low."
2. **Cooldowns are diagnostic-only** (they never gate damage), so this analysis
   is *structurally blind* to cooldown-driven damage sensitivity — and skill
   recast cadence (high damage **and** large energy refund) is precisely where
   accurate times matter.

So: extraction does **not** improve the *current* damage-ranking. It becomes
load-bearing the moment we (a) model the real energy economy and (b) let
cooldowns gate damage. See "Reframed recommendation."

---

## Method

- **Teams:** all 297 unique member-sets in `meta.teams.byCharacter`.
- **Ranking metric:** `teamDamage` (what `team-rank.js` actually sorts on) — plus
  DPS tracked alongside, since it's the more cast-time-sensitive, user-facing number.
- **Perturbed:** the sole cast-time source, `autoSkillMap[*][*].castTime` (996
  entries — curated `skillMap` is empty, no `_defaults` table).
- **Held fixed (documented):** `ECHO_CAST_TIME` (1.20 s const, ~1 step/rotation);
  member builds (warmed once at baseline, so we isolate the team-sim effect from
  build re-selection); all game-data windows (buff/off-field durations, state
  seconds — these are *not* cast times).
- **Error models (±20%):**
  - **U — uniform:** all times × one factor (control).
  - **T — per-type:** each skill *type* × an independent U[0.8, 1.2] (a whole-type
    constant being systematically wrong).
  - **S — per-skill:** each of 996 entries × independent U[0.8, 1.2] — the
    realistic model of what extraction reveals (per-skill scatter around our guess).
- 24 Monte-Carlo trials each for T and S (seeded, reproducible).

---

## Results

### Ranking stability (metric = `teamDamage`, the published sort key)

| Model (±20%) | Spearman ρ | Top-5 stability | #1 unchanged | Median team Δdamage |
|---|---|---|---|---|
| U (uniform) | 0.986 – 0.999 | 80–100% | yes | ~0.0% |
| T (per-type) | mean **0.9985**, min 0.987 | 88% (worst 80%) | **100%** of trials | 0.00% |
| S (per-skill) | mean **0.9993**, min 0.998 | 93% (worst 80%) | **100%** of trials | 0.00% |

The large *max rank displacement* (up to 166/297) alongside ρ ≈ 0.999 is the
signature of a **dense mid/low-rank pack** of near-tied teams trading places — not
top-order instability. No recommendation (top-of-list) is affected.

### The Δdamage tail (only 19/297 teams move >5%) — two mechanisms

Under uniform ×1.2 (longer casts):

- **① Opener gate-flip cliffs — 11 teams, −25% to −38%** (e.g.
  *Mortefi + Rover:Aero + Cartethyia/Ciaccona/Augusta*). Baseline carries a
  **300 s+ cold-start filler**; +20% pushes the filler cycle past
  `MAX_FILLER_TIME = 120 s`, so the Liberation **gates** (`gated 0→1`,
  added-time collapses ~335 s→~125 s). **This is a discrete artifact of the
  opener model + the unmodeled energy economy — not timing physics.** (Retraction:
  an earlier note called these "correctly not winning." That was wrong — a
  minutes-long filler to reach a first Liberation is a modeling failure; see
  Caveat 1.)
- **② Off-field-emitter teams — ~8 teams, smooth +7–10%** (all **Mortefi**-heavy;
  his coordinated-attack turret). No gate flip; a longer rotation simply fits
  **more ticks** into the duration-bounded emitter window. This is the *genuine*,
  bounded cast-time effect.

Median |Δdamage| across all 297 teams: **0.05%**.

### DPS — the sensitive number (not the ranking key)

DPS = damage/time, and time is ~linear in cast times, so DPS moves far more:
**median 2–4%** (per-skill), p90 5–10%, tail to +45% (the gate-flip teams, where
dropping a gated Lib slashes time even as damage falls). If DPS is presented as an
authoritative headline, extraction *would* shift it ~2–5% typically.

---

## First-class caveats (maintainer, 2026-07-11) — why the verdict is conditional

**Caveat 1 — the energy/opener model is premature (root cause investigated
2026-07-11 → `docs/opener-pathology-investigation.md`).** There is no realistic
in-game scenario where a resonator takes *minutes* to reach its first Liberation.
*Correction to an earlier draft of this caveat:* Resonance Energy and Concerto
Energy are **separate gauges** — there is no "Concerto→energy conversion"; the
only real hand-off is the **Intro skill's grant on swap-in** (which the model
*does* credit). **Damage taken is not an energy source; "on-hit orbs" don't
exist; kill-orbs** (post-defeat) are the one real world source, deliberately
unmodeled by direction. Modeled income = own per-hit gen × ER + off-field 50%
share × ER + intro grant + echo gain. The 300 s+ pathology is **not** a missing
source: it traces almost entirely to ONE archetype (**Rover: Aero — 313 of a
team's 335 s**) and is a **rotation/opener-pool defect** — its Liberation is
authored at rotation position 3, *before* its high-generation Forte hits
(Unbound Flow, 10/20 energy), so `opener.js`'s filler pool (the pre-Liberation
prefix only) loops its weakest hits (Cloudburst Dance, 0.92/1.01); whole-rotation
own-gen (31.9) is 21% of the 150 cost, so it pads ~100 s **every** pass with no
self-elimination. Fixable in `opener.js` (draw filler from the whole rotation's
generators, not just the pre-Lib prefix). Until fixed, opener filler magnitudes
— and any conclusion leaning on them — are unreliable for front-loaded-Lib kits.

**Caveat 2 — cooldowns are diagnostic-only, so this analysis is blind to their
damage effect.** `annotateStepCooldowns` reports violations but never changes
damage (authored-as-executed). Whether a skill is off-cooldown at a given point
depends on **elapsed real time** = the sum of real cast times, so cast-time
accuracy directly controls skill recast cadence. Because Resonance **Skill**
casts tend to deal high damage *and* refund significant energy, their cadence
feeds straight back into the energy economy (Caveat 1). A sensitivity analysis
that holds cooldowns non-binding cannot measure this — so the "rankings are
robust" result says nothing about the world where cooldowns gate damage. In that
world, real times are expected to matter materially.

**Method caveats (analysis-internal):** builds held fixed (build re-selection is a
gear/sonata-dominated comparison — second-order); `ECHO_CAST_TIME` not perturbed;
ranking measured on damage, not DPS (both reported).

---

## Reframed recommendation

The analysis does **not** say "don't extract times." It says: extraction gives
**~0 benefit to the *current* damage-ranking**, but is the **required input** to
fixing the two gaps that actually matter —

1. **Make cooldowns damage-affecting** (a skill still on CD can't be recast →
   substitute/filler, changing damage *and* the energy it would have refunded).
   The moment this lands, cast-time precision stops being polish. **This is the
   strongest justification for Lane B extraction** and matches the maintainer's
   read.
2. **Model the real energy economy** (at minimum the on-hit/orb and
   Concerto→energy sources) so openers reflect reachable-in-seconds Liberations,
   not minutes of filler. This removes the 11 gate-flip cliff artifacts and is
   the prerequisite for the opener/`MAX_FILLER_TIME` gate to mean anything.
3. Independently of timing, the `MAX_FILLER_TIME = 120 s` gate is a hard
   discontinuity 11 teams straddle — soften it or flag cliff-dependent scores.

**Sequence:** extraction (real times) → cooldown-gating (times become
load-bearing) → energy-economy realism (openers become sane). Re-run this harness
after each to re-measure; the expectation is that ρ drops meaningfully once
cooldowns gate damage, quantifying how much precision the rotations then need.

---

## Raw numbers (for reference)

```text
unique teams: 297 | cast-time slots: 996 | types: basic,forte_basic,forte_heavy,
heavy,intro,liberation,midair,outro,skill,unknown | baseline #1 by damage:
1106+1404+1608 = Youhu + Jiyan + Phrolova

Model U:  ×0.8 ρdmg .994 ρdps .996 | ×0.9 .998/.998 | ×1.1 .999/.996 | ×1.2 .986/.986
Model T:  ρdmg mean .9985 min .987 | top5 88%/80% | #1 100% | Δdmg p90 1.0% max 39.9%
                                     | Δdps med 4.3% p90 9.7% max 72.4%
Model S:  ρdmg mean .9993 min .998 | top5 93%/80% | #1 100% | Δdmg p90 0.66% max 24.2%
                                     | Δdps med 2.1% p90 5.4% max 64.5%
Drill-down (×1.2): gate-flips 11/297 | |Δdmg|>5%: 19/297 (7 of them gate-flips)
                   | median |Δdmg| 0.05%
```
