# Combat Roles — Reference Sheet
## Source: Wuthering Waves Wiki — Combat Roles glossary (2026-06).
## For Claude Code use in WuWa Sim: P13 synergy hints, role-tag classification,
## and dataset audit.

---

## 1. What combat roles are

The game assigns each resonator one or more **combat role** tags that describe
their function. These are displayed on character profiles in-game and on the wiki.
They are the game's own vocabulary for synergy — a player reads "Fusion Burst +
Fusion Burst Applicator + Tune Break Boost" on a team page and immediately
understands the composition.

For the sim, combat roles serve two purposes:
1. **P13 synergy hints** (`tools/optimize/synergy-hints.js`): the `CHARACTER_ROLES`
   and `ROLE` constants should be seeded from official game roles wherever the
   dataset carries them, so our curated table reflects the game's own intent.
2. **Optimizer categorization**: a character's roles tell the optimizer which stat
   weights are relevant — a Negative Status applicator role implies the
   `affectsNegativeStatus` amplify path matters; a DMG Amplification role implies
   the character's value is in what it gives teammates, not its own damage.

---

## 2. Dataset audit instruction

**Before implementing anything here, Claude Code must check whether combat role
data is present in the extracted dataset.** Run:

```js
// Quick audit — run against data/wuwa-data.json
const d = JSON.parse(fs.readFileSync('data/wuwa-data.json', 'utf8'));
const sample = d.resonators.slice(0, 5);
console.log('Keys on resonator:', Object.keys(sample[0]));
// Look for: roles, combatRoles, role, tags, specialties, or any array of strings
// that could be role tags. Also check the raw nanoka source files:
// data/extracted-nanoka/characters/*.json — same audit there.
```

**If roles ARE in the dataset**: project them in `preprocess.mjs` onto the
`roles` array on each resonator, and use this reference to normalize the naming
(game strings → the `ROLE` constant keys below). The `CHARACTER_ROLES` table in
`synergy-hints.js` should then be populated programmatically from the projected
data rather than hand-curated.

**If roles are NOT in the dataset**: the `CHARACTER_ROLES` table remains
hand-curated (current approach). Flag the absence in the preprocess output for
visibility each patch.

Either way, the canonical role identifiers below are the keys to use in code.

---

## 3. The role catalogue

Grouped by function. The `key` is the constant identifier used in code
(`ROLE.key`). The `wikiName` is the exact string on the wiki/in-game.

### 3a. Primary damage output

| key | wikiName | Sim relevance |
|---|---|---|
| `MAIN_DPS` | Main Damage Dealer | The primary on-field damage source. Highest priority for stat weights. |
| `BASIC_DMG` | Basic Attack Damage | Character's damage centres on Basic Attacks. Prioritize Basic ATK DMG bonus stat. |
| `HEAVY_DMG` | Heavy Attack Damage | Character's damage centres on Heavy Attacks. Prioritize Heavy ATK DMG bonus. |
| `SKILL_DMG` | Resonance Skill Damage | Character's damage centres on Resonance Skill. Prioritize Skill DMG bonus. |
| `LIBERATION_DMG` | Resonance Liberation Damage | Character's damage centres on Liberation. Prioritize Liberation DMG bonus. |
| `ECHO_DMG` | Echo Skill Damage | Character's damage centres on Echo Skill. Relevant to echo selection optimizer. |
| `COORDINATED_ATK` | Coordinated Attack | Character excels at Coordinated (off-field triggered) attacks. |

### 3b. Team amplification (support damage)

These roles indicate the character provides damage amplification to teammates —
the `amplify` bucket in `formula.js` for a specific teammate.

| key | wikiName | Amplifies |
|---|---|---|
| `AMP_DMG` | DMG Amplification | Generic DMG (all types) for one teammate |
| `AMP_BASIC` | Basic Attack DMG Amplification | Basic Attack DMG for one teammate |
| `AMP_HEAVY` | Heavy Attack DMG Amplification | Heavy Attack DMG for one teammate |
| `AMP_SKILL` | Resonance Skill DMG Amplification | Resonance Skill DMG for one teammate |
| `AMP_LIBERATION` | Resonance Liberation DMG Amplification | Liberation DMG for one teammate |
| `AMP_ECHO` | Echo Skill DMG Amplification | Echo Skill DMG for one teammate |
| `AMP_COORDINATED` | Coordinated Attack DMG Amplification | Coordinated Attack DMG for one teammate |
| `AMP_GLACIO` | Glacio DMG Amplification | Glacio element DMG for one teammate |
| `AMP_FUSION` | Fusion DMG Amplification | Fusion element DMG for one teammate |
| `AMP_ELECTRO` | Electro DMG Amplification | Electro element DMG for one teammate |
| `AMP_AERO` | Aero DMG Amplification | Aero element DMG for one teammate |
| `AMP_SPECTRO` | Spectro DMG Amplification | Spectro element DMG for one teammate |
| `AMP_HAVOC` | Havoc DMG Amplification | Havoc element DMG for one teammate |

**Implementation note**: amplification roles are the clearest synergy signal in
the game — a character with `AMP_FUSION` and a Fusion-element main DPS is a
canonical pairing. In `synergy-hints.js`, matching `AMP_[ELEMENT]` to a
`MAIN_DPS` of that element is a high-confidence auto-generated hint.

### 3c. Negative status application

| key | wikiName | Status applied | Source resonators |
|---|---|---|---|
| `NS_FUSION_BURST` | Fusion Burst | Fusion Burst stacks | Aemeath, Denia |
| `NS_GLACIO_CHAFE` | Glacio Chafe | Glacio Chafe stacks | Hiyuki, Lucilla |
| `NS_AERO_EROSION` | Aero Erosion | Aero Erosion stacks | Cartethyia, Ciaccona, Rover: Aero |
| `NS_ELECTRO_FLARE` | Electro Flare | Electro Flare stacks | Buling |
| `NS_SPECTRO_FRAZZLE` | Spectro Frazzle | Spectro Frazzle stacks | Phoebe, Rover: Spectro, Zani |
| `NS_HAVOC_BANE` | Havoc Bane | Havoc Bane (DEF debuff) | Chisa |

These roles cross-reference `NEGATIVE-STATUS-REFERENCE.md`. A character with a
Negative Status role should have `computeNegativeStatusDamage` called for their
contributions, and their teammates' `affectsNegativeStatus`-tagged amplify
effects should be surfaced in the team sim.

### 3d. Tune Break mechanic

See `RESONANCE-MODE-SPEC.md` for the Tune Break model. These roles map directly
to Tune Break synergy hints in P13.

| key | wikiName | Meaning |
|---|---|---|
| `TB_BOOST` | Tune Break Boost | Provides Tune Break Boost to a specific teammate (primary: Mornye) |
| `TB_RUPTURE` | Tune Rupture Response | Deals Tune Rupture DMG (benefits from TB_BOOST) |
| `TB_STRAIN` | Tune Strain Response | Gains total DMG increase from Tune Break Boost |
| `OFF_TUNE` | Off-Tune Buildup Efficiency | Boosts Off-Tune buildup rate for a specific teammate |

`TB_RUPTURE` and `TB_STRAIN` are the two Tune Break response modes. Characters
with these roles benefit directly from a `TB_BOOST` provider on the team —
this is the clearest Tune Break synergy signal for P13's team composition.

### 3e. Sustain and utility

| key | wikiName | Sim relevance |
|---|---|---|
| `SUSTAIN` | Support and Healer | Healing/shielding; team survivability. Relevant to `computeSupport`. |
| `CONCERTO_EFF` | Concerto Efficiency | Fast Concerto energy generation → earlier Outro/Intro rotation. Relevant to energy model (P11.5). |
| `LIB_REGEN` | Resonance Liberation Regeneration | Restores teammate Resonance Energy → affects ER breakpoints (P12). |
| `INTERRUPT_RES` | Interruption Resistance Boost | No damage sim relevance — out of scope. |

### 3f. Enemy control (out of scope for single-enemy sim)

These roles affect enemy behavior (movement, position, CC). **Not modelled** in
the sim (single-enemy, no positional mechanics):

| key | wikiName | Reason for exclusion |
|---|---|---|
| `STAGNATION` | Stagnation | Slows enemies — no movement model |
| `TRACTION` | Traction | Pulls enemies — no positional model |
| `VIBRATION_RED` | Vibration Strength Reduction | Reduces enemy poise — no stagger model |

Include these in the `ROLE` enum for completeness (they may appear in dataset
role tags), but do not build sim logic around them.

---

## 4. Mapping to `synergy-hints.js`

The P13 `ROLE` constant and `CHARACTER_ROLES` table should use the keys from
§3. Simplified mapping example:

```js
// tools/optimize/synergy-hints.js
export const ROLE = Object.freeze({
    MAIN_DPS:        'main_dps',
    BASIC_DMG:       'basic_dmg',
    HEAVY_DMG:       'heavy_dmg',
    SKILL_DMG:       'skill_dmg',
    LIBERATION_DMG:  'liberation_dmg',
    ECHO_DMG:        'echo_dmg',
    COORDINATED_ATK: 'coordinated_atk',
    AMP_DMG:         'amp_dmg',
    AMP_BASIC:       'amp_basic',
    AMP_HEAVY:       'amp_heavy',
    AMP_SKILL:       'amp_skill',
    AMP_LIBERATION:  'amp_liberation',
    AMP_ECHO:        'amp_echo',
    AMP_COORDINATED: 'amp_coordinated',
    AMP_GLACIO:      'amp_glacio',
    AMP_FUSION:      'amp_fusion',
    AMP_ELECTRO:     'amp_electro',
    AMP_AERO:        'amp_aero',
    AMP_SPECTRO:     'amp_spectro',
    AMP_HAVOC:       'amp_havoc',
    NS_FUSION_BURST: 'ns_fusion_burst',
    NS_GLACIO_CHAFE: 'ns_glacio_chafe',
    NS_AERO_EROSION: 'ns_aero_erosion',
    NS_ELECTRO_FLARE:'ns_electro_flare',
    NS_SPECTRO_FRAZZLE: 'ns_spectro_frazzle',
    NS_HAVOC_BANE:   'ns_havoc_bane',
    TB_BOOST:        'tb_boost',
    TB_RUPTURE:      'tb_rupture',
    TB_STRAIN:       'tb_strain',
    OFF_TUNE:        'off_tune',
    SUSTAIN:         'sustain',
    CONCERTO_EFF:    'concerto_eff',
    LIB_REGEN:       'lib_regen',
    INTERRUPT_RES:   'interrupt_res',
    STAGNATION:      'stagnation',
    TRACTION:        'traction',
    VIBRATION_RED:   'vibration_red',
});
```

Auto-generated synergy rules from roles (implement in P13, seeding the hint table
before the sim-ranking pass):

- `AMP_[ELEMENT]` + `MAIN_DPS` of that element → high-affinity pair.
- `TB_BOOST` + `TB_RUPTURE` → high-affinity pair (Mornye + Aemeath/Lynae).
- `TB_BOOST` + `TB_STRAIN` → high-affinity pair (Mornye + Luuk/Denia).
- `NS_[TYPE]` applicator + character with `AMP_[NS_TYPE]` amplify → pair (e.g.
  Phoebe + a character that amplifies Spectro Frazzle).
- `SUSTAIN` is required on every team unless an explicit high-confidence hint
  overrides it (consistent with P13 §4a candidate-generation rules).
- `CONCERTO_EFF` and `LIB_REGEN` are soft synergy signals that inform the
  team-level ER breakpoint calculation (P13 §5, team-level ER override).
