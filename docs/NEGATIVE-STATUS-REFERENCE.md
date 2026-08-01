# Negative Status Effects — Data Reference Sheet
## Source: Wuthering Waves Wiki + confirmed in-game descriptions (2026-06).
## For Claude Code implementation within WuWa Sim.
## Scope: DoT damage calculation and debuff mechanics for the single-enemy simulation.

---

## Correction log (from initial version)

- **All six effects are now playable** — the wiki note "only Frazzle and Erosion
  are testable" was outdated. Confirmed source resonators added per effect below.
- **Typo fixed**: "Luciall" → **"Lucilla"** throughout.
- **Havoc Bane discrepancy resolved**: the wiki Tutorial text described the
  *enemy-side* version of the effect. The player-side version (DEF reduction,
  max 3 stacks) matches the Effects text and in-game description. UNRESOLVED flag
  removed; explosion behaviour is enemy-only and out of scope.
- **Glacio Chafe**: in-game description adds "The higher the stacks, the more DMG
  dealt" — the effect scales damage per stack count, not just speed-reduction and
  freeze. Updated accordingly; stack multiplier values still unconfirmed (pending
  calibration).
- **In-game descriptions** used as the authoritative source where they differ from
  the wiki (all noted per-effect). The defensive advice ("dodge attacks") in
  in-game descriptions applies to enemy-on-player context; **ignore for the damage
  sim**, which models player-on-enemy only.

---

## 1. What Negative Statuses are

Stackable DoT effects and debuffs applicable to enemies. Six types, each tied
to an element. All six have confirmed resonator sources (see §3). Include all
in the data model; the sim computes their damage contribution for any resonator
whose kit applies them.

**Lucilla note**: Glacio Chafe is also Lucilla's Resonance Mode mechanic
(`RESONANCE-MODE-SPEC.md` §2). The enemy-debuff Glacio Chafe and Lucilla's mode
share the name and mechanic; treat them as the same stack type, sourced from
Lucilla's kit when building for her.

---

## 2. Damage formula

**SUPERSEDED 2026-06-28** for Glacio Chafe: the wiki-sourced `1.25078` constant
below was never independently verified. The maintainer sourced 3 real worked
examples from a community calculator (Hiyuki, lvl 90, Glacio Chafe at stacks
1/7/10, two different DEF-shred values) and the ACTUAL formula decomposes into
separate DEF-mult and RES-mult terms — NOT a single collapsed constant:

```
DMG = LevelModifier × StackMV × DefMult × ResMult × (1 + Amplify%)
DefMult = (8×atkLv + 800) / ((8×atkLv + 800) + (8×defLv + 792) × (1−defShred) × (1−defIgnore))
```

Implemented + calibration-tested in `src/core/enemy-status.js`
(`computeNegativeStatusDamage`, verified to <0.1% error against all 3 examples)
and wired into the live team sim (per-application instance, credited to the
applicator). **Never crits** (confirmed: Glacio Chafe/Tune Break DMG cannot
crit, barring an explicit kit exception — e.g. Aemeath's chain node).

The corrected DEF-mult formula's denominator asymmetry (`+800` vs `+792`) was
independently cross-checked: a 12%-shred example matched exactly 6 Havoc Bane
stacks × 2%/stack, confirming the existing Havoc Bane model is correct.

**NOT re-verified against this corrected formula**: Spectro Frazzle and Aero
Erosion's stack-mult tables below still derive from the OLD `1.25078`-constant
approach (§2a-2c as originally written, wiki-sourced, never independently
calibrated against a real worked example the way Glacio Chafe now is). They
may be subtly wrong in the same way the old Glacio Chafe formula was — flagged
as a residual risk, not silently assumed fine. Re-derive them with the
corrected DefMult/ResMult split if/when real worked examples surface for them.

The original wiki-sourced write-up (uncorrected) is preserved below for
historical reference on Level Multiplier (still correct — 3674 @ lvl 90
matches the maintainer's real examples exactly) and the not-yet-recalibrated
effects.

```
DMG = Base DMG × Resistances × Bonuses
```

### 2a. Base DMG

```
Base DMG = Level Multiplier × 1.25078 × Stack Multiplier
```

The constant **1.25078** is exact (wiki-sourced, uncontested).

### 2b. Level Multiplier

Scales with the **level of the resonator who last applied a stack**. Known values:

| Resonator Level | Multiplier |
|---|---|
| 10 | 16 |
| 50 | 229 |
| 80 | 2005 |
| 90 | 3674 |

Exact interpolation formula is **unknown** — implement as a lookup table with
linear interpolation. At level 90 the value is **3674**; use this for the
reference build anchor. Flag interpolated values as approximate in the validation
report.

```js
const LEVEL_MULT = [[10, 16], [50, 229], [80, 2005], [90, 3674]];

function negStatusLevelMult(level) {
    if (level <= 10) return 16;
    if (level >= 90) return 3674;
    for (let i = 0; i < LEVEL_MULT.length - 1; i++) {
        const [l0, v0] = LEVEL_MULT[i];
        const [l1, v1] = LEVEL_MULT[i + 1];
        if (level <= l1) return v0 + (v1 - v0) * (level - l0) / (l1 - l0);
    }
}
```

### 2c. Stack Multiplier

**WIRED 2026-08-01** — Spectro Frazzle and Aero Erosion were confirmed here on
2026-06-28 but lived only in this doc; the engine carried `glacio_chafe`
alone, so their damage was ABSENT rather than zero. Both now sit in
`STACK_MV_TABLES` (`src/core/enemy-status.js`) alongside glacio, and the
tick/burst triggers that pay them out exist (`resolveStatusOverTimeDamage`).
Fusion Burst and Electro Flare are still pending calibration; a status with
no multiplier is now REPORTED via `statusDamageGaps` rather than silently
contributing nothing.

**FUSION BURST FOUND 2026-08-01 — and it was never a single constant.** The
game's affliction damage lives in `db_damage` as seven `Type 10` /
`FormulaType 9` rows, one per element (`1003` glacio, **`1004` fusion**, `1002`
electro, `1001` aero, `1005` spectro, `1006` havoc, `1007` a glacio variant) —
these are what `AbnormalDamageConfig`'s `Abnormal1001..1006` columns are named
after. Their own FormulaParams are empty: the row says WHAT to deal, not how
much.

The per-stack multiplier is carried by the **BUFF that triggers the damage**
(`ExtraEffectID 121`), as an explicit `stacks#multiplier` table — so it is
**kit-specific, not one global table per status**. That is why observing a
single character never generalised, and why this entry sat "pending calibration"
for so long. Extracted to `data/affliction-damage.json`
(`tools/extract/extract_affliction_damage.py`).

Aemeath's four Fusion Burst tables read straight onto her kit text:

| multiplier | reads as |
| --- | --- |
| 110% + 10%/stack | base |
| 310% + 10%/stack | +200% |
| 115% + 15%/stack | S2 "each stack of Fusion Trail removed provides a 15% DMG Multiplier increase" |
| 515% + 15%/stack | the same, +400% in Stardust Resonance |

all to 60 stacks, matching her S6 "max stack limit … increased to 60". Qiuyuan
carries a flat 300%; Hiyuki two 100% entries against the glacio variant.

**Not yet wired**: applying these needs the TRAIL stack count at the moment
Seraphic Duet consumes it, which the sim does not track. The numbers are now
committed data rather than a missing measurement.

### 2d. Tune Break is NOT a negative status

Confirmed 2026-08-01 from the damage table, and it matches the maintainer's
instinct. Tune Rupture DMG is **damage `Type 12`** — ordinary rate-scaled skill
damage (`RateLv` per level, `FormulaType 0`), delivered as instances on real
skill keys: Mornye's Particle Jet, Aemeath's Starburst and Seraphic Duet bonus,
Lynae's Spectral Analysis. It is not an affliction (`Type 10`) and has no stack
multiplier to find.

So `tune_rupture` / `tune_strain` being `gatingOnly: true` in
`NEGATIVE_STATUS_DEFS` is **correct** — they are enemy-side gating conditions,
and their damage belongs to the normal skill path. `computeTuneBreakDamage` (its
own calibrated formula, §2f) models the separate Tune-Break-bar mechanic, not
these instances.

```js
export const NEGATIVE_STATUS_STACK_MULT = Object.freeze({
    spectro_frazzle: {
        1: 0.240,  2: 0.4355, 3: 0.6298, 4: 0.8251,
        5: 1.020,  6: 1.216,  7: 1.409,  8: 1.605,
        9: 1.800, 10: 1.995,
    },
    aero_erosion: {
        // Stacks 4-6 require specific effects (e.g. Rover: Aero Outro) to reach.
        1: 0.360, 2: 0.899, 3: 1.799,
        4: 2.698, 5: 3.597, 6: 4.497,
    },
    // Pending calibration — add values once sourced in-game:
    fusion_burst:  null,   // source: Aemeath, Denia
    electro_flare: null,   // source: Buling
    havoc_bane:    null,   // source: Chisa — no damage ticks; DEF reduction only (see §3)
});
```

**glacio_chafe RESOLVED 2026-06-28** (moved out of the table above — it now
lives in `GLACIO_CHAFE_STACK_MV` in `src/core/enemy-status.js`, MV/10000 form):
`{1: 0.2450, 2: 0.4442, 3: 0.6434, 4: 0.8426, 5: 1.0418, 6: 1.2409, 7: 1.4401,
8: 1.6393, 9: 1.8385, 10: 2.0377}`. Stacks 1/7/10 are maintainer-verified real
values; 2-6/8-9 are linearly interpolated (the 3 confirmed points fit a line
exactly to within display rounding). `sourceResonators: ['Hiyuki', 'Lucilla']`
— LevelModifier (3674 @ lvl90) confirmed universal across resonators by the
maintainer, so this table applies to either source.

### 2f. Tune Break (Tune Rupture / Tune Strain) — formula confirmed, NOT wired

Same DEF/RES formula family as Glacio Chafe, but with its own constants —
calibration-tested in `computeTuneBreakDamage` (enemy-status.js), verified
against one real worked example to <0.1%:

```
DMG = LevelModifier(716.22) × (1+BonusDmg%) × TuneAmp(16.00) × DefMult × ResMult
      × EnemyTypeMultiplier × (1+TuneBreakBoost%)
```

- `EnemyTypeMultiplier` — maintainer-confirmed fixed per enemy class:
  Common 1, Elite 3, Overlord 14, Calamity 14. Our sim's standard target
  defaults to Overlord (matches the verified example; consistent with the
  "boss-tier training dummy" assumption already implicit elsewhere).
- `TuneAmp` (1600%) — maintainer: "most likely a constant" (same confidence
  tier as LevelModifier), shared by Tune Rupture and Tune Strain since only
  one worked example exists. Kit-specific modifiers (the Tune Break Boost /
  Tune Rupture Response / Tune Strain Response / Off-Tune Buildup Efficiency
  combat-role tags) are assumed to feed the SEPARATE `BonusDmg`/`TuneBreakBoost`
  multiplicative buckets (both 0% in the example), not this base constant.
- RES element: unconfirmed which bucket to read — the one example's 90% RES
  matches the triggering resonator's OWN element (Hiyuki = Glacio), suggesting
  Tune Break damage inherits the triggerer's element rather than having a
  fixed "tune" element of its own. `computeTuneBreakDamage` takes `element` as
  a caller-supplied param rather than guessing internally.

**Deliberately NOT wired into the live team sim** — per maintainer direction
2026-06-28, deferred to its own future "bonus phase". Wiring it in requires an
"off-tune buildup" gauge model (per-skill buildup rate toward filling the
enemy's tune bar, plus who/when actually triggers the break — a player choice
in real gameplay) that doesn't exist anywhere in the engine today, and no data
exists yet to build it without fabricating numbers. Until then: no "Tune
Break" button, no enemy-class switcher in the sim UI.

### 2d. Resistances

Same formula as regular damage (`ResMult` in `formula.js`). Whether Elemental
Reduction applies is **unknown** — treat as **not applying** (conservative)
until confirmed. Document this assumption in the validation report.

### 2e. Bonuses — critical restriction

**Generic Attribute DMG Amplify does NOT affect Negative Status DMG.** Only
effects explicitly targeting the specific Negative Status type apply (e.g.
"Spectro Frazzle DMG Amplification"). Concretely:

- `dmgBonusByElement`, `dmgBonusBySkillType`, and generic `amplify` from
  `formula.js` must **not** flow into `computeNegativeStatusDamage`.
- Only effects tagged `affectsNegativeStatus: true` + matching
  `negativeStatusType` in the data apply.
- Example: Phoebe's Confession-state Outro provides a party-wide Spectro Frazzle
  amplify that DOES apply. Verify her effect tags match this restriction.
- See `COMBAT-ROLES-REFERENCE.md` for the Spectro Frazzle role — this connection
  between roles and status-specific amplify is a useful cross-check.

---

## 3. Per-effect definitions

```js
export const NEGATIVE_STATUS_DEFS = Object.freeze({

    fusion_burst: {
        element:          'fusion',
        sourceResonators: ['Aemeath', 'Denia'],
        maxStacks:        10,
        damageOnTick:     false,
        damageOnMax:      true,            // explosion at max, consuming all stacks
        stackBehavior:    'all_removed_on_max',
        tickIntervalS:    null,
        stackDecayS:      null,
        stackMult:        null,            // pending calibration
        speedReduction:   false,
        defReduction:     false,
        // In-game desc (matches wiki): "When Fusion Burst is stacked to its max,
        // all stacks will be removed to trigger an explosion, dealing Fusion DMG
        // around the target. The higher the stacks, the more DMG dealt."
        note: 'Burst-type: stacks to 10, explosion on max consuming all stacks. '
            + 'DMG scales with stacks at time of explosion.',
    },

    glacio_chafe: {
        element:          'glacio',
        sourceResonators: ['Hiyuki', 'Lucilla'],
        maxStacks:        10,
        damageOnStack:    true,            // deals Glacio DMG when a stack is inflicted
        damageScales:     true,            // higher stacks = more DMG (in-game confirmed)
        freezeOnMax:      true,            // target frozen at max; all stacks removed
        stackBehavior:    'all_removed_on_max',
        tickIntervalS:    null,            // exact tick interval unconfirmed
        stackDecayS:      null,
        stackMult:        null,            // pending calibration
        speedReduction:   true,            // each stack reduces Movement Speed
        defReduction:     false,
        // In-game desc (authoritative, differs slightly from wiki):
        // "When Glacio Chafe is inflicted, the target receives Glacio DMG. Glacio
        // Chafe stacks up to 10 times by default. The higher the stacks, the more
        // DMG dealt. Each stack of Glacio Chafe reduces the target's Movement Speed.
        // When Glacio Chafe reaches max stacks, the target will be frozen, and all
        // stacks of Glacio Chafe will be removed."
        // Key addition vs wiki: "The higher the stacks, the more DMG dealt."
        // Movement speed reduction is out of scope for the single-enemy sim.
        note: 'Deals Glacio DMG on stack application; damage scales with stack count. '
            + 'Each stack reduces Movement Speed (irrelevant for sim). '
            + 'Max stacks → frozen, all stacks removed. '
            + 'Shares mechanic with Lucilla\'s Resonance Mode (RESONANCE-MODE-SPEC.md §2).',
    },

    aero_erosion: {
        element:          'aero',
        sourceResonators: ['Cartethyia', 'Ciaccona', 'Rover: Aero'],
        maxStacks:        3,               // default; can be raised to 6 with specific effects
        damageOnTick:     true,
        tickIntervalS:    3,               // confirmed: ticks every 3s
        stackDecayS:      15,              // stacks reduce every 15s (separate from damage ticks)
        stackBehavior:    'decay_periodic',
        damageOnMax:      false,
        stackMult:        'aero_erosion',
        speedReduction:   false,
        defReduction:     false,
        // In-game desc (minor diffs from wiki, using in-game):
        // "While the 'Aero Erosion Effect' lasts, it deals periodic Aero DMG to
        // the target. The damage of 'Aero Erosion Effect' scales with its stacks."
        note: 'DoT: ticks every 3s. DMG scales with stacks. '
            + 'Stacks decay every 15s (decay interval ≠ damage tick interval). '
            + 'Stack cap can exceed 3 with specific effects (e.g. Rover: Aero Outro).',
    },

    electro_flare: {
        element:          'electro',
        sourceResonators: ['Buling'],
        maxStacks:        10,
        damageOnTick:     true,
        tickIntervalS:    null,            // exact interval unconfirmed
        stackBehavior:    'half_removed_on_tick',
        stackMult:        null,            // pending calibration
        damageOnMax:      false,
        stackOverflow: {
            // At max stacks, new stacks become Electro Rage instead.
            type:      'electro_rage',
            maxStacks: 10,
            effect:    'amplifies next Electro Flare trigger; consumed on trigger',
        },
        speedReduction:   false,
        defReduction:     false,
        // In-game desc (identical to wiki):
        // "While Electro Flare lasts, it deals periodic Electro DMG to the target.
        // The target loses half of the effect stacks with each instance of damage.
        // At maximum stacks, any new stack inflicted becomes stackable Electro Rage.
        // Electro Rage increases the DMG dealt by the next Electro Flare trigger."
        note: 'Loses HALF stacks per tick (not 1). Max stacks → overflow to Electro Rage '
            + '(separate secondary stack, max 10, amplifies next trigger then consumed).',
    },

    spectro_frazzle: {
        element:          'spectro',
        sourceResonators: ['Phoebe', 'Rover: Spectro', 'Zani'],
        maxStacks:        10,
        damageOnTick:     true,
        tickIntervalS:    3,               // confirmed
        stackBehavior:    'one_removed_per_tick',
        stackDecayS:      3,               // decay is the same interval as the damage tick
        stackMult:        'spectro_frazzle',
        damageOnMax:      false,
        speedReduction:   false,
        defReduction:     false,
        // In-game desc (authoritative, differs slightly from wiki):
        // "While 'Spectro Frazzle Effect' lasts, the number of its stacks is
        // periodically reduced by 1 to deal Spectro DMG to the target. The
        // building up of 'Spectro Frazzle Effect' greatly increases the DMG
        // it deals."
        note: 'DoT: loses 1 stack per 3s tick; that tick deals the damage. '
            + 'DMG scales strongly with stacks — building stacks is the primary mechanic.',
    },

    havoc_bane: {
        element:          'havoc',
        sourceResonators: ['Chisa'],
        maxStacks:        3,
        damageOnTick:     false,           // no DoT; pure debuff
        damageOnMax:      false,
        defReductionPerStack: 0.02,        // −2% DEF per stack; −6% total at max 3
        defReduction:     true,
        stackMult:        null,            // no damage → stack mult irrelevant
        speedReduction:   false,
        // Discrepancy resolved: the wiki Tutorial text described the ENEMY-SIDE
        // version of Havoc Bane (which spreads to the team as a debuff on the
        // player). The player-side version (Chisa applying it to enemies) is the
        // Effects text: max 3 stacks, DEF −2%/stack. In-game description matches
        // Effects text. The explosion/spread behaviour is out of scope (enemy-on-
        // player, not player-on-enemy).
        // In-game desc matches wiki Effects text: "While Havoc Bane lasts, the DEF
        // of the inflicted target is reduced. Havoc Bane stacks up to 3 times by
        // default, with each stack reducing the target's DEF by 2%."
        note: 'Pure DEF debuff, no DoT. −2% enemy DEF per stack (−6% at max 3). '
            + 'Feeds into the DefMult bucket of computeDamage for the whole team.',
    },
});
```

---

## 4. DoT tick timing model

Confirmed tick interval for both Frazzle and Erosion: **every 3 seconds** after
the first stack is applied.

- **Spectro Frazzle**: each tick removes 1 stack AND deals damage computed at
  the stack count *before* that tick's decay. Damage and decay are the same event.
- **Aero Erosion**: damage ticks every 3s; stacks decay (separately) every 15s.
  At a given damage tick, use the *current* stack count (which may have changed
  via the 15s decay). These are two independent timers.
- **Electro Flare**: tick removes half the stacks (rounded how — TBD; conservative:
  floor). Exact tick interval unconfirmed — **do not implement timed calculation
  for Electro Flare yet; treat as static average or await calibration**.

The **applicator** (last resonator to apply a stack) determines the Level
Multiplier for that damage tick. For the single-character sim, this is always the
simulated resonator. For the team sim, track `lastApplicator[statusType]`.

---

## 5. Havoc Bane integration with the damage formula

Havoc Bane has no DoT of its own — it reduces enemy DEF. Its contribution feeds
into the **existing** `DefMult` bucket of `computeDamage`, not into
`computeNegativeStatusDamage`. When Chisa is in the team and her Havoc Bane stacks
are tracked, pass the active stack count × 0.02 as `defShred` to the normal sim
for all teammates' damage calculations.

---

## 6. Status-specific amplify tagging

Effects amplifying Negative Status damage must be tagged distinctly:

```js
// Add to the existing effect schema:
// {
//   stat: 'amplify',
//   value: 0.XX,
//   affectsNegativeStatus: true,
//   negativeStatusTypes: ['spectro_frazzle']   // or ['all'] for confirmed-universal
// }
```

`collectActiveEffects` must expose status-specific amplify separately from
generic amplify so `computeNegativeStatusDamage` pulls only applicable entries.

**Live example needing this tag (found 2026-06-27, PRE-P12-DATA-QUALITY.md
audit)**: Lucilla `S2.0` — "When in Resonance Mode - Glacio Chafe, Glacio
Chafe DMG against targets around the active Resonator is Amplified by 80%."
Trigger/window/mode are correctly resolved (`data/effect-overrides.json`
`1109/S2.0`: `mode: 'glacio_chafe'`, state-bound to her "Clear As Day Buff"),
but the effect is still plain `stat: 'amplify'` with no
`affectsNegativeStatus`/`negativeStatusTypes` tag — until this section is
implemented, it incorrectly amplifies ALL of Lucilla's damage, not just her
Glacio Chafe ticks. Fix by tagging it `affectsNegativeStatus: true,
negativeStatusTypes: ['glacio_chafe']` and excluding status-tagged amplify
from `computeDamage`'s generic bucket once that split exists.

Also still missing entirely for Lucilla S2 (same source sentence, the Echo
Resonance Mode branch): "When in Resonance Mode - Echo, grant 40% Echo Skill
DMG Amplification to **Resonators in the team**." Never extracted at all —
the parser's value-regex requires an "amplif... by" or bare "by" match, and
this clause has neither ("Amplification to Resonators", no "by"). Beyond the
missing extraction, this is also a **team-wide** buff (affects every member,
not just Lucilla), which the chain/inherent effect schema has no mechanism
for at all (it only resolves buffs onto the owning resonator's own build).
Needs both a parser fix and a team-wide-buff delivery mechanism (likely the
same cross-member propagation this section's Negative-Status work and
`team-sim.js`'s existing Outro-buff handling would both want) before this can
be added — deferred, not in `data/effect-overrides.json` since adding it with
today's self-only schema would misrepresent its scope.

---

## 7. Calibration cases to add

Extend `docs/CALIBRATION.md` and `test/calibration.test.mjs`:

- **NS-C1** — Spectro Frazzle at max stacks (10), level-90 resonator, 0-RES dummy.
  Pre-resistance expected: `3674 × 1.25078 × 1.995` ≈ **9,176**. Capture
  in-game and pin as assertion.
- **NS-C2** — Spectro Frazzle at 1 stack; verifies the low-end stack multiplier.
- **NS-C3** — Aero Erosion; confirms damage-tick vs decay-tick separation.
- **NS-C4** — Confirm a generic Spectro DMG Bonus does **not** increase Frazzle
  damage. This guards the §2e restriction permanently.
- **NS-C5** (when Chisa is implemented) — confirm Havoc Bane's DEF reduction
  flows through DefMult and increases team damage by the expected amount.

---

## 8. Out of scope

- Negative statuses applied to resonators by enemies.
- Havoc Bane spread/explosion (enemy-on-player mechanic).
- Exact Level Multiplier interpolation formula (use lookup table).
- Enemy-specific stack caps or resistance modifiers (single generic enemy).
- Movement Speed reduction from Glacio Chafe (no speed model in sim).
