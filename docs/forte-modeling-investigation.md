# Lever 2 — Forte-gauge modeling from BinData (feasibility, 2026-07-11)

**Question (maintainer):** can `docs/damage.json` + `docs/skill.json` (Arikatsu
BinData) give us proper Forte-gauge modeling — the "big gainer once Forte is
full" that our energy model misses (we capture only ~40% of Aero Rover's real
generation)?

**Answer: YES — and now SHIPPED (2026-07-11).** All four pieces were in hand (per-
hit Forte gen/spend, per-character channel, per-character CAP, resonator-id
bridge), and the model is wired end-to-end: `tools/extract-forte.mjs` →
`data/forte-data.json` (16 resonators) → `preprocess.mjs` overlay (`forteGen` per
skill + `dataset.forte` cap/channel) → the CD-aware greedy in `opener.js` (Forte
generators build a tracked gauge; the payoff fires at full cap, ranked by
full-chain throughput so it never regresses). Aero Rover opener 25.1s → 22.9s.

**Honest limitation:** the gain is modest and largely opportunistic because our
cast times are FABRICATED — the "fill gauge → cash payoff" loop only marginally
beats basic-spam at made-up durations (Aero Rover's Cloudburst is 1.6s in our
data). Full value is **coupled to cast-time realism** (the other lever): with
real durations the deliberate fill-and-cash loop wins decisively and the payoff
fires far more. See "Caps found" below for the data foundation.

## What's in the data

`damage.json` (9,697 damage instances) carries, per instance, per-level arrays:

| field | meaning | evidence |
| --- | --- | --- |
| `Energy` | Resonance Energy gen (raw ÷100 = our `energyGen`) | Aero Rover Unbound Flow `Energy=2000` → 20, matches our `forte_heavy_unbound_flow_2`=20 |
| **`SpecialEnergy1`** | **Forte-gauge channel 1** — fills (+) AND spends (−) | range **[−3840, 4200]**; 545 hits use it; **129 negative** (the payoff SPEND) |
| **`SpecialEnergy2`** | **Forte-gauge channel 2** | 229 hits (e.g. chars 1202, 1210) |
| **`SpecialEnergy3`** | **Forte-gauge channel 3** | 80 hits |
| `SpecialEnergy4/5` | reserved | 0 uses roster-wide |
| `ElementPower` | Concerto gen (already modeled) | 1990 hits |

**Character-consistent:** each resonator uses one channel (a few use two — e.g.
char 1211 uses SE1+SE3, char 1306 uses SE1+SE2 — matching known dual-resource
kits like Galbrena's Afterflame/Sinflame). So a resonator → Forte-channel map is
directly derivable.

**Fill + spend both captured:** char 1603's payoff hits carry `SE1 = −615, −457,
−498, −180` (spending the gauge); char 1106 has a `SE1 = +4200` big filler. This
is exactly the mechanic our greedy opener can't currently schedule.

## The bridge to our data (clean)

`skill.json` (562 skills) closes the loop:
- **`SkillGroupId` == our resonator id** (verified: 1102…1406 all present, incl.
  Rover: Aero 1406).
- **`DamageList`** = the exact damage-instance Ids for that skill → look up in
  `damage.json`. This is the authoritative skill→instance mapping (the thing our
  `matchRowHits` currently reconstructs by rate-vector).
- For our per-skill-KEY precision, `damage.json.RateLv` is the same rate vector
  our `matchRowHits` already matches on — so the existing machinery bridges
  BinData instances → our skill keys with no new heuristic.

Our own nanoka source does **not** carry `SpecialEnergy` (checked: false in
`data/extracted-nanoka/characters/1102.json`) — so BinData is the source, folded
in the same way we'd fold `cast-times.json`: a curated/derived overlay keyed by
skill.

## Demonstration — Aero Rover (SkillGroupId 1406)

```text
skill 1003201 (Basic)  Energy [76,92,92,224,374,0,164,78,95,52,39,39]  SE1 [0,0,0,10,10,0,10,0,…]
skill 1003207 (Forte)  Energy [92,101,200,2000,200,2000,…]             SE1 [25,25,0,…]
```
The `Energy=2000` (=20) Unbound Flow payoff is right there — and its Forte
channel (SE1) shows the fill pattern. This is the ~60% of Aero Rover's generation
our model currently drops.

## Caps found — the blocker is gone (`baseproperty.json` + `roleinfo.json`)

1. **The gauge CAP per character — FOUND.** `baseproperty.json` (2740 entries,
   keyed by `Id`) carries `EnergyMax` and **`SpecialEnergy1-5Max`** per entity;
   `roleinfo.json`'s **`PropertyId` == our resonator id** links straight to it
   (verified 1102/1204/1406/1409/1106/1211). Example caps: Aero Rover (1406)
   `SE1Max=120`, Cartethyia (1409) `SE2Max=120`, Youhu (1106) `SE1Max=10000`.
2. **Scale — calibrated AND moot.** `EnergyMax ÷ 100` equals our Lib cost for all
   six spot-checked characters (Sanhua 10000→100, Mortefi 12500→125, Aero Rover
   **15000→150**), confirming `Energy` is ÷100. For Forte it doesn't even matter:
   the model only needs **`per-hit SpecialEnergy ÷ SpecialEnergyMax`** (fraction
   of the gauge filled per hit) — both come from the same channel, so any absolute
   scaling cancels. Aero Rover: Cloudburst `+10` into a `120` cap → ~12 hits to
   full — sane.
3. **Channel selection — derivable.** Each character's Forte channel is the
   `SpecialEnergyN` their abilities actually use (`damage.json` filtered by
   `SkillGroupId`), cross-checked by the non-default `SpecialEnergyNMax`
   (defaults are `SE3=100, SE4=6000, SE5=10000`; a distinctive value — 70, 120,
   10000, 0 — marks the real/unused channel). `roleinfo.SpecialEnergyBarId` is a
   UI-bar config id (not a plain 1/2/3 index), so it's not the selector.
4. **Payoff-availability rule** — kit-specific but readable from the data: the
   payoff instances carry the big `Energy` and/or the negative `SpecialEnergy`
   (spend), and unlock at full gauge. The only genuinely per-kit modeling left.

## Proposed Lever 2 path (plugs straight into Lever 1)

1. Derive the **resonator → Forte-channel** map + per-skill Forte gen/spend from
   `damage.json` via the `skill.json`/RateLv bridge → a new
   `forteGen`/`forteChannel` field on skill-map entries (preprocess overlay).
2. Read the **cap** from `baseproperty.json` (`SpecialEnergy{ch}Max`, keyed by
   `roleinfo.PropertyId` == resonator id) → `forteCap` per resonator.
3. In `opener.js`'s greedy filler, **stop excluding `forte_*`**: track a Forte
   gauge alongside the energy gauge, and when it reaches `forteCap`, schedule the
   payoff ability (its big `Energy`). This closes the ~40% capture gap — the
   greedy would then reach Aero Rover's Ult in ~13–17s (matching the maintainer's
   226%-ER in-game test) instead of over-padding.
4. Longer term the same Forte gauge feeds the real sim (not just the opener),
   gating Forte payoff damage properly.

**Status (2026-07-11):** no blockers remain. Generation/spend, per-character
channel, per-character cap, and the resonator-id bridge are all confirmed. The
build is mechanical extraction on machinery we already have (`matchRowHits`, the
skill-map overlay pattern) plus a Forte-gauge accumulator in the greedy filler.
The one per-kit judgment left is the payoff-availability rule, readable from each
kit's big-`Energy` / negative-`SpecialEnergy` instances.
