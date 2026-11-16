# The 300s+ opener pathology — root-cause report (2026-07-11)

> **RESOLVED (2026-07-11, "Lever 1").** `opener.js`'s filler is now a **CD-aware
> greedy** (cast the highest-yield off-cooldown Resonance Skill / Echo Skill,
> basics in the gaps; Forte-gated casts excluded). Rover: Aero's opener dropped
> **313.6s → 68.1s**; the team's total added-time **335s → 89.5s**; and roster-
> wide the **11 opener gate-flip cliffs → 0** (the one real ranking fragility the
> cast-time sensitivity analysis found). Residual: Rover still pads ~22s/pass
> (can't bank a 150 Ult on modeled generation) — that residual is the un-modeled
> Forte-gauge "big gainer" quantified below, now tracked as **Lever 2**. The
> maintainer's in-game test (226% ER → opener reaches only ~75% of the Ult)
> confirms padding is still *needed*; we capture ~40% of real generation. The
> root-cause analysis below is preserved as written.

Investigating the teams whose derived cold-start opener adds *minutes* of filler
(surfaced by the cast-time sensitivity analysis; `docs/cast-time-drilldown.mjs`).
Reproduce: `node` the scratchpad `opener-investigation.mjs` (traces the exact
per-member, per-pass energy arithmetic).

## Corrected energy-mechanics primer (supersedes an earlier sloppy claim)

An earlier draft blamed "damage taken, on-hit orbs, and a Concerto→energy
pipeline." **That was wrong.** The accurate picture:

- **Resonance Energy** (fills the Liberation) and **Concerto Energy** (fills the
  Outro / swap gauge) are **separate resources**. There is **no Concerto→Resonance
  conversion**. The only real cross-over is the **Intro skill granting Resonance
  Energy on swap-in** (modeled — see below).
- **Damage taken is NOT an energy source.** **"On-hit orbs" do not exist.**
- **Kill-orbs** (energy dropped when an enemy is defeated) are the one real *world*
  source — **deliberately unmodeled** by maintainer direction (enemy-dependent).
- **What the model DOES count:** own per-hit generation (`energyGen`) × own ER,
  the **off-field 50% share** × own ER, the **Intro grant** (the swap-in segment's
  energy is credited via `creditTraceToLedger`), and echo `energyGain`.

**The pathology is not a missing energy source. It is a rotation/opener-pool
defect** — detailed below.

## Where the 335s actually goes

Team *Mortefi + Rover: Aero + Cartethyia*, 3-pass openers-ON run:

| Member | Lib cost | whole-rotation own-gen | % of cost | opener filler (pass0 / 1 / 2) |
|---|---|---|---|---|
| Mortefi (1204) | 125 | 51.8 | 41% | **+21.6s** / 0 / 0  (self-eliminates) |
| **Rover: Aero (1406)** | **150** | **31.9** | **21%** | **+102.4s / +105.6s / +105.6s = 313.6s** |
| Cartethyia (1409) | 125 | 58.1 | 46% | **0 / 0 / 0**  (banks fine) |

**Rover: Aero is 313.6 of the 335.2s.** The other two are healthy: they self-
eliminate or never need padding, because their pre-Liberation generation is a
solid fraction of their cost.

## Why Rover: Aero breaks — the smoking gun

Its authored rotation (Lib at **position 3**):

```text
intro  cloudburst_dance_1  cloudburst_dance_2  ►LIBERATION◄  awakening_gale
       cloudburst_dance_1  cloudburst_dance_2  skyfall_severance  midair  unbound_flow_1
```

Per-hit Resonance Energy in Rover: Aero's kit (from the data):

| key | energyGen | in rotation? |
|---|---|---|
| intro | 10 | yes (pos 0) |
| forte_heavy **cloudburst_dance_1** | **0.92** | pre-Lib prefix (weak) |
| forte_heavy **cloudburst_dance_2** | **1.01** | pre-Lib prefix (weak) |
| skill awakening_gale | 5 | **after** the Lib |
| skill skyfall_severance | 2.52 | after the Lib |
| forte_heavy **unbound_flow_1** | **10** | **after** the Lib (last step) |
| forte_heavy **unbound_flow_2** | **20** | **not used at all** |

Three compounding causes, in order of impact:

1. **opener.js filler-pool defect (code-level, fixable).** `fillerCycleFor` builds
   the cold-start loop from `rotation.slice(0, i)` — **only the steps BEFORE the
   Liberation.** For a rotation that front-loads the Lib, that prefix is
   `[cloudburst_dance_1, cloudburst_dance_2]` = **1.93 energy / 3.2s cycle**. The
   unit's *actual* energy engine — `unbound_flow` (10/20) and `awakening_gale` (5)
   — sits *after* the Lib and is **excluded from the filler pool**. So the model
   loops the single weakest thing the kit has ~32–33× per pass. If the pool were
   the whole rotation's non-Lib generators, cycleGen jumps ~8× and the filler
   collapses to a few seconds.

2. **Rotation is energy-incoherent for a cold start (authoring).** The curated
   reference rotation is a *steady-state* optimal sequence (Lib early, assuming
   energy is already up), not a cold-start script. `unbound_flow_2` (the 20-energy
   hit) isn't even in it. A support like Aero Rover realistically funds its Lib via
   the Forte payoff + off-field time + intro, then casts — the authored order can't
   reach its own position-3 Lib from zero without help.

3. **21% own-gen vs cost → no self-elimination.** Because the whole rotation
   generates 31.9 and the Lib costs 150, the gauge resets to 0 on every cast and
   **never banks a surplus** — so unlike Mortefi/Cartethyia, the filler does NOT
   shrink across passes (102 → 106 → 106). Steady state stays broken.

## What is NOT the cause

- **Not kill-orbs / damage-taken / any missing world source.** Even crediting
  kill-orbs wouldn't fix a rotation that puts its energy payoff after the Lib.
- **Not cast times.** The opener arithmetic is *correct* given its inputs
  (verified: `count = ceil(deficit / (cycleGen × ER))`, `addedTime =
  count × cycleTime`). Cast-time error only nudges which side of the
  `MAX_FILLER_TIME = 120s` cliff a pass lands on — it doesn't create the deficit.
- **Not the anchor-can't-intro rule.** Rover: Aero is slot 1 here (it *can* intro);
  the intro's 10 energy is already credited.

## Fix options (for maintainer adjudication)

1. **Filler pool = best available energy loop, not just the pre-Lib prefix**
   (opener.js). Draw the cold-start cycle from the whole rotation's loopable
   non-Lib generators (respecting cooldowns), so Aero Rover loops `unbound_flow`
   (10) + `awakening_gale` (5), not `cloudburst_dance` (0.9). Biggest, most
   principled lever; pure code fix. **Recommended first.**
2. **Cold-start-aware rotation variants** for front-loaded-Lib supports — but this
   risks the P12 kit-blind-synthesizer trap; prefer (1).
3. **Model per-rotation Lib cadence** — if Aero Rover realistically casts its Lib
   every *other* rotation in-game (needs your confirmation), the model over-demands
   energy every pass by ~2×.
4. **Reconsider the kill-orb exclusion** — real, but the smallest lever here and
   explicitly out of scope by prior direction; noted for completeness only.

## Cross-check (why the model is fine for the others)

Mortefi's pre-Lib prefix includes `forte_heavy_fury_fugue` (10 each) → filler
cycle 28/cycle → 3 cold-start cycles, then banks enough to self-eliminate.
Cartethyia's includes `skill` (16.3) → 48/cycle, banks to 125 by steady state →
zero filler. The opener model works exactly as intended when a unit's energy
generators precede its Liberation; Rover: Aero is the archetype where they don't.
