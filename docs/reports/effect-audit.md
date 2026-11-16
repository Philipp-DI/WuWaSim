# Effect Audit Report

Produced by `tools/audit-effects.mjs` per `docs/PRE-P12-DATA-QUALITY.md` §2.
Read top to bottom — ⚠ entries first.

## Summary

- Resonators audited: 53
- Total parsed effects: 212
- Total ⚠ flags (needs a decision): 50
  - UNKNOWN_TRIGGER: 49
  - UNMAPPED_PHRASE: 1
  - MISSING_DURATION: 0
  - MISCLASSIFIED_UNCONDITIONAL: 0
  - MODE_NOT_TAGGED: 0
- Total deferred (explicitly accepted, tracked in data/effect-overrides.json): 6

## P12 seed + Resonance Mode characters — gate status

Per `PRE-P12-DATA-QUALITY.md` §6, P12 may start once the ⚠ column is all
zeros — entries explicitly accepted via `data/effect-overrides.json`'s
`deferred` map count toward the gate as resolved-by-decision, not blocking.

| Resonator | Effects | ⚠ (needs decision) | Deferred (accepted) |
| --- | --- | --- | --- |
| Aemeath | 15 | 0 | 0 |
| Cantarella | 5 | 0 | 0 |
| Carlotta | 4 | 0 | 0 |
| Changli | 4 | 0 | 2 |
| Denia | 4 | 0 | 0 |
| Hiyuki | 7 | 0 | 3 |
| Jinhsi | 4 | 0 | 0 |
| Lucilla | 5 | 0 | 0 |
| Lynae | 6 | 0 | 1 |
| Phoebe | 6 | 0 | 0 |

**Gate: CLEAR** — zero undecided ⚠ across the seed + mode set (6 explicitly deferred and tracked).

## Unresolved entries (all characters, excludes deferred)

- Aalto (1)
- Augusta (6)
- Baizhi (3)
- Brant (1)
- Buling (2)
- Calcharo (1)
- Camellya (1)
- Cartethyia (1)
- Chisa (2)
- Chixia (1)
- Danjin (3)
- Encore (1)
- Galbrena (2)
- Iuno (2)
- Jiyan (2)
- Lingyang (2)
- Lucy (3)
- Lumi (1)
- Luuk Herssen (3)
- Mornye (1)
- Mortefi (1)
- Phrolova (2)
- Rebecca (2)
- Sanhua (1)
- Sigrika (1)
- Yangyang (1)
- Yinlin (1)
- Youhu (1)
- Yuanwu (1)

## Per-character detail

## Aalto

Aalto S2.0  atkRatio +15% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When Aalto attacks targets taunted by the "Mist Avatar(s)", his ATK is increased by 15%."

Aalto S5.0  elementBonus +25% [Aero]
  trigger: castMatch "forte" → forte   window: 6s
  source text: "In the Forte Circuit Mistcloak Dash state, Aalto's Aero DMG Bonus is increased by 25% for 6s."

Aalto S6.0  critRate +8%
  trigger: none (unconditional)   window: always
  source text: "Resonance Liberation Flower in the Mist now additionally increases Crit. Rate by 8%."

## Aemeath

Aemeath S2.0  multiplierUp +100% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Skill Seraphic Duet: Overture is increased by 100%."

Aemeath S2.1  multiplierUp +100% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Skill Seraphic Duet: Encore is increased by 100%."

Aemeath S2.2  multiplierUp +20% [skill]
  trigger: modeMatch "tune_rupture"   window: always
  source text: "While in Resonance Mode - Tune Rupture, when the additional instances Tune Rupture DMG triggered by Resonance Skill Sera"

Aemeath S3.0  multiplierUp +100% [liberation]
  trigger: none (unconditional)   window: always
  source text: "Resonance Liberation Heavenfall Edict: Finale's DMG Multiplier is increased by 100%."

Aemeath S3.1  multiplierUp +40% [liberation]
  trigger: none (unconditional)   window: always
  source text: "Resonance Liberation Heavenfall Edict: Overdrive's DMG Multiplier is increased by 40%."

Aemeath S3.2  critDmg +60%
  trigger: modeMatch "tune_rupture"   window: always
  source text: "Inherent Skill Between the Stars is replaced with the following effects: - In Resonance Mode - Tune Rupture, when Resona"

Aemeath S3.3  amplify +60% [liberation]
  trigger: modeMatch "tune_rupture"   window: always
  source text: "Inherent Skill Between the Stars is replaced with the following effects: - In Resonance Mode - Tune Rupture, when Resona"

Aemeath S3.4  critDmg +60%
  trigger: modeMatch "fusion_burst"   window: always
  source text: "- In Resonance Mode - Fusion Burst, when Resonators in the team inflict Fusion Burst, Aemeath's Crit. DMG is increased b"

Aemeath S3.5  amplify +60% [liberation]
  trigger: modeMatch "fusion_burst"   window: always
  source text: "- In Resonance Mode - Fusion Burst, when Resonators in the team inflict Fusion Burst, Aemeath's Crit. DMG is increased b"

Aemeath S6.0  critRate +80%
  trigger: modeMatch "tune_rupture"   window: always
  source text: "When in Resonance Mode - Tune Rupture, Aemeath's Tune Rupture DMG can critically hit, with a fixed Crit. Rate of 80%, an"

Aemeath S6.1  critDmg +275%
  trigger: modeMatch "tune_rupture"   window: always
  source text: "When in Resonance Mode - Tune Rupture, Aemeath's Tune Rupture DMG can critically hit, with a fixed Crit. Rate of 80%, an"

Aemeath S6.2  critRate +80%
  trigger: modeMatch "fusion_burst"   window: always
  source text: "When in Resonance Mode - Fusion Burst and in combat state, Fusion Burst DMG triggered on targets near the active Resonat"

Aemeath S6.3  critDmg +275%
  trigger: modeMatch "fusion_burst"   window: always
  source text: "When in Resonance Mode - Fusion Burst and in combat state, Fusion Burst DMG triggered on targets near the active Resonat"

Aemeath IH1.0  critDmg +20%
  trigger: modeMatch "tune_rupture"   window: always
  source text: "In Resonance Mode - Tune Rupture, when Resonators in the team inflict Tune Rupture - Shifting or deal Tune Rupture DMG,"

Aemeath IH1.1  critDmg +30%
  trigger: modeMatch "fusion_burst"   window: always
  source text: "In Resonance Mode - Fusion Burst, when Resonators in the team inflict Fusion Burst, Aemeath's Crit. DMG increases by 30%"

## Augusta

Augusta S1.0  critDmg +15% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "- Each stack of Crown of Wills additionally increases Augusta's Crit. DMG by 15%."

Augusta S2.0  critRate +20% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "- Crown of Wills provides additional effects: Each stack increases Augusta's Crit. Rate by 20%."

Augusta S2.1  critRate +100% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "- For every 1% of Crit. Rate over 100%, Augusta gains 2% Crit. DMG increase, up to 100%."

Augusta S2.2  critDmg +100% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "- For every 1% of Crit. Rate over 100%, Augusta gains 2% Crit. DMG increase, up to 100%."

Augusta S3.0  multiplierUp +25% [heavy]
  trigger: none (unconditional)   window: always
  source text: "The following skills have their DMG Multiplier increased by 25%: - Heavy Attack - Thunderoar: Backstep, Dodge Counter -"

Augusta S4.0  atkRatio +20%
  trigger: castMatch "intro" → intro   window: 30s
  source text: "Casting Intro Skill - Stride of Goldenflare increases the ATK of all Resonators in the team by 20% for 30s."

Augusta S6.0  critRate +150% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "- For every 1% of Crit. Rate over 150%, Augusta gains 2% Crit. DMG increase, up to 50%."

Augusta S6.1  critDmg +50% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "- For every 1% of Crit. Rate over 150%, Augusta gains 2% Crit. DMG increase, up to 50%."

## Baizhi

Baizhi S2.0  elementBonus +15% [Glacio] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "Resonance Skill Emergency Plan increases Baizhi's Glacio DMG Bonus by 15% and her Healing by 15% if she has 4 Concentrat"

Baizhi S6.0  elementBonus +12% [Glacio] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: 20s
  source text: "When Euphonia is picked up, increase the Glacio DMG Bonus of all characters nearby by 12% for 20s."

Baizhi IH0.0  atkRatio +15% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: 20s
  source text: "Euphonia ATK of the Resonators who pick up Euphonia is increased by 15% for 20s."

## Brant

Brant S2.0  critRate +30% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "Casting Mid-air Attack and Returned from Ashes increases Brant's Crit. Rate by 30%."

Brant S3.0  multiplierUp +42%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Returned from Ashes is increased by 42%."

Brant S6.0  multiplierUp +30%
  trigger: none (unconditional)   window: always
  source text: "Mid-air Attack's DMG Multiplier is increased by 30%."

## Buling

Buling S1.0  critRate +20% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "The Crit. Rate of Resonance Liberation - Flashing Thunder Spell: Harmony is increased by 20% upon dealing damage."

Buling IH0.0  healingBonus +50% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "Buling gains 25% Healing Bonus when restoring HP for Resonators with less than 50% HP."

## Calcharo

Calcharo S2.0  skillTypeBonus +30% [skill]
  trigger: castMatch "skill" → skill   window: 15s
  source text: "After Calcharo casts Intro Skill Wanted Criminal or Intro Skill "Necessary Means", his Resonance Skill DMG Bonus is incr"

Calcharo S3.0  elementBonus +25% [Electro] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "During the Resonance Liberation Deathblade Gear state, Calcharo's Electro DMG Bonus is increased by 25%."

Calcharo S4.0  elementBonus +20% [Electro]
  trigger: castMatch "outro" → outro   window: 30s
  source text: "After casting Outro Skill Shadowy Raid, Electro DMG Bonus of all team members is increased by 20% for 30s."

## Camellya

Camellya S1.0  critDmg +28%
  trigger: castMatch "intro" → intro   window: 18s
  source text: "Casting Intro Skill Everblooming increases Camellya's Crit. DMG by 28% for 18s."

Camellya S2.0  multiplierUp +120% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Skill Ephemeral is increased by 120%."

Camellya S3.0  multiplierUp +50% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Fervor Efflorescent is increased by 50%."

Camellya S3.1  atkRatio +58% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When in Budding Mode, Camellya's ATK is increased by 58%."

Camellya S5.0  multiplierUp +303% [intro]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multipliers of Intro Skill Everblooming is increased by 303% and Outro Skill Twining is increased by 68%."

Camellya S6.0  multiplierUp +150% [forte]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Forte Circuit's Sweet Dream is additionally increased by 150%."

## Cantarella

Cantarella S1.0  multiplierUp +50% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Skill Graceful Step, Resonance Skill Flickering Reverie, and Forte Circuit Perception Dr"

Cantarella S2.0  multiplierUp +245%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Jolt triggered by Cantarella is increased by 245%."

Cantarella S3.0  multiplierUp +370% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Flowing Suffocation is increased by 370%."

Cantarella S4.0  healingBonus +25%
  trigger: stateEnter "mirage"   window: stateBound "mirage"
  source text: "When in Mirage, Healing Bonus is increased by 25%."

Cantarella IH0.0  healingBonus +20%
  trigger: none (unconditional)   window: always
  source text: "Increase Healing Bonus by 20%."

## Carlotta

Carlotta S1.0  critRate +12.5%
  trigger: castMatch "Resonance Liberation (applies Deconstruction)" → liberation   window: 4s
  source text: "When Carlotta deals DMG to a target inflicted with Deconstruction, the Crit. Rate of this instance of DMG is increased b"

Carlotta S2.0  multiplierUp +126% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Fatal Finale is increased by 126%."

Carlotta S3.0  multiplierUp +93% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Skill Art of Violence and Resonance Skill Chromatic Splendor is increased by 93%."

Carlotta S5.0  multiplierUp +47% [heavy]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Heavy Attack Imminent Oblivion is increased by 47%."

## Cartethyia

Cartethyia S1.0  critDmg +25% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: 15s
  source text: "When Fleurdelys's Conviction hits 30/60/90/120, Fleurdelys's Crit. DMG is increased by 25% for 15s, up to 4 stacks."

Cartethyia S2.0  multiplierUp +50% [basic]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multipliers of Cartethyia's Basic Attack, Heavy Attack, Dodge Counter, and Intro Skill are increased by 50% and"

Cartethyia S3.0  multiplierUp +100% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation - Blade of Howling Squall is increased by 100%."

## Changli

Changli S2.0  critRate +25%
  trigger: castMatch "True Sight Conquest/Charge hit, or Liberation cast (any grants Enflamement)" → ANY [skill_true_sight_conquest, skill_true_sight_charge, liberation]   window: 8s
  source text: "Enflamement increases Changli's Crit. Rate by 25% for 8s."

Changli S4.0  atkRatio +20%
  trigger: castMatch "intro" → intro   window: 30s
  source text: "After Intro Skill is cast, all team members' ATK is increased by 20% for 30s."

Changli IH0.0  elementBonus +5% [Fusion] ⚠→DEFERRED (accepted, tracked)
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When casting Basic Attack: True Sight - Conquest or Basic Attack: True Sight - Charge, each stack of Enflamement will in"
  deferred reason: Fusion DMG Bonus (5%/stack of Enflamement, correctly extracted, but maxStacks not captured — should be 4, matching Enflamement's own cap) only applies to the SAME True Sight Conquest/Charge cast that's currently active, scaled by Enflamement at that moment — not a time-windowed buff. Per maintainer 2026-06-27: 'elementBonus is always global, never skill-specific — for that, skill-type-specific buffs exist', but the current schema has no 'instantaneous, scoped to the exact step that fired it, stack-scaled' bonus kind either (skillTypeBonus is duration/window-based once active, same as everything else). Needs a new resolution kind: apply only to the damage instance of the triggering cast itself. Maintainer flagged the source text as 'a bit murky' on exactly how it composes with simultaneous DMG instances. Deferred 2026-06-27.

Changli IH1.0  elementBonus +15% [Fusion] ⚠→DEFERRED (accepted, tracked)
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "Casting Heavy Attack Flaming Sacrifice or Resonance Liberation Radiance of Fealty gives 20% Fusion DMG Bonus and ignores"
  deferred reason: Same instantaneous/non-windowed gap as IH0.0 (applies only to the same Heavy Attack Flaming Sacrifice / Liberation cast that fires it, not a duration buff). ADDITIONALLY: the extracted value (0.15) is WRONG — pctNear() grabbed the trailing '15%' from '...ignores 15% of the target's DEF' instead of the actual '20% Fusion DMG Bonus' earlier in the same sentence (DMG Bonus keyword match position is between the two numbers; pctNear only scans forward). The DEF-ignore 15% is also an entirely separate, currently unextracted effect (a defShred-type bonus, not elementBonus) bundled in the same source sentence. Do not reuse 0.15 as the Fusion DMG Bonus value when this is eventually built — it should be 0.20, plus a new sibling DEF-ignore effect at 0.15. Deferred 2026-06-27.

## Chisa

Chisa S1.0  atkRatio +30% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: 15s
  source text: "Chisa is immune to interruption during Sawring - Blitz, Sawring - Eradication, and Chainsaw Mode - Dodge Counter Inflict"

Chisa S3.0  multiplierUp +120%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multipliers of Sawring - Blitz, Chainsaw Mode - Dodge Counter and Sawring - Eradication are increased by 120%."

Chisa S3.1  multiplierUp +120% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "The bonus DMG Multiplier for Sawring - Eradication granted by Sawring- Blitz and Chainsaw Mode - Dodge Counter when Ring"

Chisa S6.0  amplify +30%
  trigger: none (unconditional)   window: always
  source text: "- Targets affected by Unseen Snare - Finality takes 30% Amplified DMG from Negative Statuses."

Chisa IH1.0  elementBonus +20% [Havoc]
  trigger: castMatch "liberation" → liberation   window: 12s
  source text: "Casting Intro Skill Reverberance - Return or Resonance Liberation Moment of Nihility grants 20% Havoc DMG Bonus and 20%"

## Chixia

Chixia S5.0  atkRatio +30% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When the Inherent Skill Numbingly Spicy! reaches max stacks, ATK is additionally increased by 30%."

Chixia S6.0  skillTypeBonus +25% [basic]
  trigger: castMatch "basic" → basic   window: 15s
  source text: "Resonance Skill Boom Boom increases the Basic Attack DMG Bonus of all team members by 25% for 15s."

Chixia IH1.0  atkRatio +1%
  trigger: castMatch "skill" → skill   window: 10s
  source text: "Each Thermobaric Bullet that hits a target during Resonance Skill DAKA DAKA! increases ATK by 1% for 10s, stacking up to"

## Ciaccona

Ciaccona S1.0  atkRatio +35%
  trigger: castMatch "basic" → basic   window: 10s
  source text: "Casting Basic Attack increases Ciaccona's ATK by 35% for 10s."

## Danjin

Danjin S1.0  atkRatio +5% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: 6s
  source text: "When Danjin attacks a target with Resonance Skill's Incinerating Will, her ATK is increased by 5% for 6s, stacking up to"

Danjin S3.0  skillTypeBonus +30% [liberation]
  trigger: none (unconditional)   window: always
  source text: "Resonance Liberation DMG Bonus is increased by 30%."

Danjin S4.0  critRate +15% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When Danjin has more than 60 "Ruby Blossom", her Crit. Rate is increased by 15%."

Danjin S5.0  elementBonus +15% [Havoc] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "Danjin's Havoc DMG Bonus is increased by 15%, and further increased by another 15% when her HP is lower than 60%."

Danjin S6.0  atkRatio +20%
  trigger: castMatch "heavy" → heavy   window: 20s
  source text: "Heavy Attack Chaoscleave increases the ATK of all team members by 20% for 20s."

## Denia

Denia S1.0  critDmg +30%
  trigger: none (unconditional)   window: always
  source text: "Crit. DMG is increased by 30%."

Denia S2.0  multiplierUp +40% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Skill Banish - Breakdown Form is increased by 40%."

Denia S3.0  multiplierUp +80% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Final Act - Breakdown Form is increased by 80%."

Denia S6.0  atkRatio +60%
  trigger: stateEnter "entropy shift states"   window: stateBound "entropy shift states"
  source text: "While in Entropy Shift states, gain 60% ATK increase and 60% Fusion DMG Bonus."

## Encore

Encore S1.0  elementBonus +3% [Fusion]
  trigger: castMatch "Basic Attack hits a target (stacking Fusion DMG Bonus)" → basic   window: 6s
  source text: "When Basic Attack hits a target, Encore's Fusion DMG Bonus is increased by 3%, stacking up to 4 time(s) for 6s."

Encore S3.0  multiplierUp +40% [heavy]
  trigger: none (unconditional)   window: always
  source text: "The DMG multiplier of Heavy Attack Cloudy Frenzy and Heavy Attack Cosmos Rupture is increased by 40%."

Encore S4.0  elementBonus +20% [Fusion]
  trigger: castMatch "heavy" → heavy   window: 30s
  source text: "Heavy Attack Cosmos Rupture increases the Fusion DMG Bonus of all team members by 20% for 30s."

Encore S5.0  skillTypeBonus +35% [skill]
  trigger: none (unconditional)   window: always
  source text: "Resonance Skill DMG Bonus is increased by 35%."

Encore S6.0  atkRatio +5% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: 10s
  source text: "During Resonance Liberation Cosmos Rave, Encore gains 1 stack(s) of "Lost Lamb" every time she deals damage, each stack"

Encore IH1.0  elementBonus +10% [Fusion]
  trigger: castMatch "skill" → skill   window: 10s
  source text: "When Resonance Skill Flaming Woolies or Resonance Skill Cosmos - Rampage is cast, Encore's Fusion DMG Bonus is increased"

## Galbrena

Galbrena S1.0  critDmg +80% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When casting Resonance Skill - Ascent of Malice, each point of Afterflame additionally grants 2% Crit. DMG to Basic Atta"

Galbrena S3.0  multiplierUp +130% [liberation]
  trigger: none (unconditional)   window: always
  source text: "Resonance Liberation DMG Multiplier is increased by 130%."

Galbrena S5.0  multiplierUp +150% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multipliers of Resonance Skill - Encroach, Resonance Skill - Ascent of Malice, and Resonance Skill - Ravage are"

Galbrena S6.0  multiplierUp +60% [basic]
  trigger: none (unconditional)   window: always
  source text: "Additionally, Eternal Hypostasis lasts, the DMG Multipliers of Basic Attack - Seraphic Execution, Heavy Attack - Flamewi"

Galbrena IH0.0  amplify +5% [skill] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: 5.5s
  source text: "Each stack Amplifies the DMG directly dealt by Galbrena's Normal Attack, Resonance Skill, Forte Circuit, Resonance Liber"

## Hiyuki

Hiyuki S1.0  multiplierUp +120% [basic]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multipliers of Basic Attack - Foreclaimed Self, Heavy Attack - Foreclaimed Self, Mid-air Attack - Foreclaimed Se"

Hiyuki S2.0  multiplierUp +125% [basic]
  trigger: none (unconditional)   window: always
  source text: "Basic Attack - Iai's DMG Multiplier is increased by 125%."

Hiyuki S3.0  multiplierUp +160% [heavy]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multipliers of Heavy Attack - Frost Splinter: Present Self and Heavy Attack - Bitterfrost: Foreclaimed Self are"

Hiyuki S3.1  multiplierUp +488% ⚠→DEFERRED (accepted, tracked)
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "At 2 stacks of Snow Rust, while Hiyuki is the active Resonator in the team, the DMG Multiplier of the additionally appli"
  deferred reason: Snow Rust tiered unlock (chain modification of IH0's tiered unlock) — chain effects stay display-only per CLAUDE.md (bespoke per character, not mechanically applied), unlike IH0 itself which is now resolved via distinctApplicatorTierContribution (conditional-buffs.js), see overrides.1108.IH0.*. Deferred 2026-06-27; resolution scope narrowed 2026-06-28.

Hiyuki S5.0  multiplierUp +80% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multipliers of Resonance Skill - Present Self, Frostblight: Jade Cleave, and Frostblight: Petalfall are increase"

Hiyuki S6.0  critDmg +40% ⚠→DEFERRED (accepted, tracked)
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "At 2 stacks of Snow Rust, the effect "While Hiyuki is the active Resonator in the team, each time she applies Glacio Cha"
  deferred reason: Same Snow Rust mechanic (chain modification of IH0's tiered unlock). Deferred 2026-06-27, same reason as S3.1.

Hiyuki S6.1  multiplierUp +40% ⚠→DEFERRED (accepted, tracked)
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "At 2 stacks of Snow Rust, the effect "While Hiyuki is the active Resonator in the team, each time she applies Glacio Cha"
  deferred reason: Same Snow Rust mechanic (3-stack tier). Deferred 2026-06-27, same reason as S3.1.

## Iuno

Iuno S1.0  atkRatio +40% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When Iuno is in Lunar Cycle, her ATK is increased by 40%."

Iuno S3.0  amplify +65% [basic] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When Iuno is in Lunar Cycle, DMG dealt by Moonbow - Basic Attack, Resonance Skill - Arc Beyond the Edge, and Moonbow - D"

Iuno S6.0  multiplierUp +1600% [heavy]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Heavy Attack - Absolute Fullness is increased by 1600%."

## Jianxin

_No parsed effects._

## Jinhsi

Jinhsi S3.0  atkRatio +25%
  trigger: castMatch "Intro Skill Loong's Halo (grants Immortal's Descendancy)" → intro   window: 20s
  source text: "Each stack of Immortal's Descendancy increases Jinhsi's ATK by 25%, stacking up to 2 time(s) and lasting for 20s."

Jinhsi S5.0  multiplierUp +120% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Purge of Light is increased by 120%."

Jinhsi S6.0  multiplierUp +45% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Skill Illuminous Epiphany is increased by 45% and the additional DMG Multiplier gained b"

Jinhsi IH1.0  multiplierUp +50% [intro]
  trigger: none (unconditional)   window: always
  source text: "DMG Multiplier of Intro Skill Loong's Halo is increased by 50%."

## Jiyan

Jiyan S2.0  atkRatio +28%
  trigger: castMatch "intro" → intro   window: 15s
  source text: "After casting Intro Skill Tactical Strike, Jiyan gains 30 Resolve and his ATK is increased by 28% for 15s."

Jiyan S3.0  critRate +16%
  trigger: castMatch "skill" → skill   window: 8s
  source text: "When casting Resonance Skill Windqueller, Resonance Liberation Emerald Storm: Prelude, Resonance Skill Emerald Storm: Fi"

Jiyan S3.1  critDmg +32%
  trigger: castMatch "skill" → skill   window: 8s
  source text: "When casting Resonance Skill Windqueller, Resonance Liberation Emerald Storm: Prelude, Resonance Skill Emerald Storm: Fi"

Jiyan S4.0  skillTypeBonus +25% [heavy]
  trigger: castMatch "heavy" → heavy   window: 30s
  source text: "When casting Resonance Liberation Emerald Storm: Prelude or Resonance Liberation Emerald Storm: Finale, the Heavy Attack"

Jiyan S5.0  atkRatio +3% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: 8s
  source text: "When Jiyan's attacks hit a target, his ATK is increased by 3% for 8s, stacking up to 15 times;"

Jiyan IH0.0  atkRatio +10%
  trigger: castMatch "intro" → intro   window: 15s
  source text: "After casting the Intro Skill Tactical Strike, Jiyan's ATK is increased by 10% for 15s."

Jiyan IH1.0  critDmg +12% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: 8s
  source text: "When Jiyan's attacks hit a target, Jiyan's Crit. DMG is increased by 12% for 8s."

## Lingyang

Lingyang S3.0  skillTypeBonus +20% [basic] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "During Resonance Liberation Lion's Vigor, Lingyang's Basic Attack DMG Bonus is increased by 20%, and Resonance Skill DMG"

Lingyang S4.0  elementBonus +20% [Glacio]
  trigger: castMatch "outro" → outro   window: 30s
  source text: "Outro Skill Frosty Marks increases the Glacio DMG Bonus of all team members by 20% for 30s."

Lingyang S6.0  skillTypeBonus +100% [basic] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "In the Forte Circuit Striding Lion state, during the first 3s after every Resonance Skill Mountain Roamer, the Basic Att"

## Lucilla

Lucilla S1.0  critRate +20%
  trigger: castMatch "skill" → skill   window: 10s
  source text: "Releasing the Resonance Skill while the cursor is within Perfect Focus increases Lucilla's Crit. Rate by 20% for 10s."

Lucilla S2.0  amplify +80% [liberation]
  trigger: stateEnter "clear as day buff"   window: stateBound "clear as day buff"
  source text: "While casting Resonance Liberation - Clear As Day, Lucilla grants the following enhancements based on her Resonance Mode"

Lucilla S3.0  multiplierUp +100%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Letting It Go is increased by 100%."

Lucilla S4.0  atkRatio +10%
  trigger: castMatch "Oblivion (forte_heavy_oblivion)" → forte_heavy   window: 6s
  source text: "While casting Oblivion, Lucilla's ATK is increased by 10% for 6s, stacking up 3 times."

Lucilla S5.0  multiplierUp +50%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Oblivion is increased by 50%."

## Lucy

Lucy S1.0  atkRatio +20%
  trigger: castMatch "intro" → intro   window: 14s
  source text: "After casting Intro Skill - Outdated Hallucination, ATK increases by 20% for 14s."

Lucy S3.0  multiplierUp +50% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The Override DMG Multiplier of Resonance Liberation - Netrunner and Resonance Liberation - Old Net Deep Dive is increase"

Lucy S3.1  critRate +100% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When cast, Crit. Rate increases by 100% and Crit. DMG increases by 65%."

Lucy S3.2  critDmg +65% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When cast, Crit. Rate increases by 100% and Crit. DMG increases by 65%."

Lucy S3.3  multiplierUp +65%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Spoofing Program - Cripple Movement is increased by 65%."

Lucy IH1.0  amplify +5% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "At 2 stacks, additionally increases All DMG Amplification by 5% and Hack DMG Multiplier by 5%."

## Lumi

Lumi S5.0  multiplierUp +100% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When Spark is fully recovered, Laser DMG Multiplier is increased by 100%."

Lumi S6.0  atkRatio +20%
  trigger: castMatch "liberation" → liberation   window: 20s
  source text: "Casting Resonance Liberation Squeakie Express increases all team members' ATK by 20% for 20s."

Lumi IH1.0  atkRatio +10%
  trigger: castMatch "Casting Energized Pounce or Energized Rebound" → ANY [forte_heavy_energized_pounce, forte_heavy_energized_rebound]   window: 5s
  source text: "Casting Energized Pounce or Energized Rebound increases ATK by 10% for 5s."

## Lupa

Lupa S1.0  critRate +20%
  trigger: castMatch "liberation" → liberation   window: 10s
  source text: "Performing Resonance Liberation Fire-Kissed Glory recovers 10 Concerto Energy for Lupa and increases Lupa's Crit. Rate b"

## Luuk Herssen

Luuk Herssen S2.0  multiplierUp +60% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Rewritten in Winter's Margins is increased by 60%."

Luuk Herssen S2.1  amplify +10% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "Inherent Skill Uncaused Diagnosis is enhanced: When Luuk Herssen deals damage to targets inflicted with Tune Strain - In"

Luuk Herssen S3.0  multiplierUp +136% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multipliers of all forms of Resonance Skill Aureole of Execution are increased by 136% in the Aureate Judge stat"

Luuk Herssen S5.0  multiplierUp +50% [skill]
  trigger: none (unconditional)   window: always
  source text: "Resonance Skill Golden Reflux has its DMG Multiplier increased by 50% and Cooldown reduced by 2s, and gains 1 more charg"

Luuk Herssen S6.0  skillTypeBonus +120% [liberation] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "Each stack of Endnotes on the Endgame additionally grants Resonance Liberation Rewritten in Winter's Margins 40% DMG Bon"

Luuk Herssen IH1.0  amplify +5% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When Luuk Herssen's skills directly damage targets affected by Tune Strain - Interfered, every 10 points of Tune Break B"

## Lynae

Lynae S1.0  multiplierUp +120% [basic]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Basic Attack - Polychrome Leap is increased by 120%."

Lynae S3.0  multiplierUp +90% [basic]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Basic Attack - Visual Impact and Basic Attack - Iridescent Splash is increased by 90%."

Lynae S3.1  elementBonus +55% [Spectro] ⚠→DEFERRED (accepted, tracked)
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "Each stack of Premixed Hue increases the Spectro DMG Bonus of Additive Color by 55%."
  deferred reason: Premixed Hue stacks are driven by a continuous 'Lumiflow' resource gauge (gain 1 stack/1s in combat or /0.5s out of combat while Lumiflow >= 120, lose stacks below that threshold, reset to 0 when Additive Color ends, max 25) — no time-based threshold-gated resource gauge exists in the engine. Different in kind from a discrete castMatch trigger; needs the same class of new infra as Hiyuki's Snow Rust (a continuous-resource accumulator), not a one-line override. Deferred 2026-06-27.

Lynae S4.0  atkRatio +20%
  trigger: none (unconditional)   window: always
  source text: "ATK is increased by 20%."

Lynae S5.0  multiplierUp +70% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation - Prismatic Overblast is increased by 70%."

Lynae IH1.0  elementBonus +25% [Spectro]
  trigger: castMatch "intro" → intro   window: 9s
  source text: "Casting Intro Skill - Time to Show Some Colors! increases Lynae's Spectro DMG Bonus by 25% for 9s."

## Mornye

Mornye S2.0  critDmg +1% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "All nearby Resonators in the team gain Crit. DMG increase against targets with Interfered Marker: Every 1% of Mornye's E"

Mornye S5.0  multiplierUp +40% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation - Critical Protocol is increased by 40%."

Mornye S5.1  multiplierUp +160%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Tune Rupture Response - Particle Jet is increased by 160%."

## Mortefi

Mortefi S3.0  critDmg +30% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "During Resonance Liberation Burning Rhapsody, the Crit. DMG of Resonance Liberation's Marcato is increased by 30%."

Mortefi S6.0  atkRatio +20%
  trigger: castMatch "liberation" → liberation   window: 20s
  source text: "When Resonance Liberation Violent Finale is cast, ATK of all team members is increased by 20% for 20s."

## Phoebe

Phoebe S2.0  amplify +120% [outro]
  trigger: stateEnter "absolution"   window: stateBound "absolution"
  source text: "When in Absolution, DMG dealt by Outro Skills to targets with Spectro Frazzle is Amplified by 120%."

Phoebe S3.0  multiplierUp +91% [heavy]
  trigger: stateEnter "absolution"   window: stateBound "absolution"
  source text: "When in Absolution, the DMG Multiplier of Heavy Attack Starflash is increased by 91%."

Phoebe S3.1  multiplierUp +249% [heavy]
  trigger: stateEnter "confession"   window: stateBound "confession"
  source text: "When in Confession, the DMG Multiplier of Heavy Attack Starflash is increased by 249%."

Phoebe S5.0  elementBonus +12% [Spectro]
  trigger: castMatch "intro" → intro   window: 15s
  source text: "Casting Intro Skill Golden Grace increases Phoebe's Spectro DMG Bonus by 12% for 15s."

Phoebe S6.0  atkRatio +10%
  trigger: castMatch "heavy" → heavy   window: 20s
  source text: "When in Absolution or Confession, summoning a Ring of Mirrors with Resonance Skill increases Phoebe's ATK by 10% for 20s"

Phoebe IH1.0  elementBonus +12% [Spectro]
  trigger: stateEnter "absolution or confession"   window: stateBound ANY [absolution, confession]
  source text: "When in the Absolution status and Confession status, Spectro DMG Bonus is increased by 12%."

## Phrolova

Phrolova S1.0  multiplierUp +80%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Movement of Fate and Finality is increased by 80%."

Phrolova S1.1  multiplierUp +80%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Murmurs in a Haunting Dream is increased by 80%."

Phrolova S2.0  multiplierUp +75%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Scarlet Coda is increased by 75%."

Phrolova S3.0  amplify +80%
  trigger: none (unconditional)   window: always
  source text: "Echo Skill DMG is Amplified by 80%."

Phrolova S6.0  multiplierUp +24%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Enhanced Attack - Hecate is increased by 24%."

Phrolova IH1.0  critDmg +2.5% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "For every 1 stacks of Aftersound, Crit. DMG is increased by 2.5%."

Phrolova IH1.1  critDmg +1% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When Aftersound reaches the max, each new stack of Aftersound increases Phrolova's Crit. DMG by 1%, up to 100%."

## Qiuyuan

Qiuyuan S3.0  multiplierUp +500% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Sundering Strike is increased by 500%."

Qiuyuan S4.0  atkRatio +20%
  trigger: none (unconditional)   window: always
  source text: "ATK is increased by 20%."

Qiuyuan S6.0  critDmg +100%
  trigger: castMatch "skill" → skill   window: 6s
  source text: "Casting Resonance Skill Straw Cape in Drizzly Rain increases Qiuyuan's Crit. DMG by 100% for 6s."

## Rebecca

Rebecca S1.0  multiplierUp +50% [basic]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier for Rebecca's Basic Attack - Huntress and Basic Attack - Guts is increased by 50%."

Rebecca S6.0  skillTypeBonus +40% [basic] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "Rebecca's Basic Attack DMG Bonus from every source is increased by 40%."

Rebecca IH0.0  atkRatio +10% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "ATK Bonus is increased by 10% for 12 when is triggered or when Resonance Liberation - Party 'til Dawn! is cast, stackabl"

## Roccia

Roccia S3.0  critRate +10%
  trigger: castMatch "intro" → intro   window: 15s
  source text: "Casting Intro Skill Pero, Help increases Roccia's Crit. Rate by 10% and Crit. DMG by 30% for 15s."

Roccia S3.1  critDmg +30%
  trigger: castMatch "intro" → intro   window: 15s
  source text: "Casting Intro Skill Pero, Help increases Roccia's Crit. Rate by 10% and Crit. DMG by 30% for 15s."

Roccia IH0.0  atkRatio +20%
  trigger: castMatch "heavy" → heavy   window: 12s
  source text: "Casting Resonance Skill or Heavy Attack increases Roccia's ATK by 20% for 12s."

## Rover: Aero

Rover: Aero S3.0  elementBonus +15% [Aero]
  trigger: none (unconditional)   window: always
  source text: "Aero DMG Bonus is increased by 15%."

Rover: Aero S4.0  skillTypeBonus +15% [skill]
  trigger: castMatch "skill" → skill   window: 5s
  source text: "Casting Mid-air Attack Cloudburst Dance increases Resonance Skill DMG Bonus by 15% for 5s."

Rover: Aero S5.0  multiplierUp +20% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Omega Storm is increased by 20%."

Rover: Aero S6.0  multiplierUp +30% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Skill Unbound Flow is increased by 30%."

Rover: Aero IH0.0  atkRatio +20%
  trigger: castMatch "intro" → intro   window: 10s
  source text: "Casting Intro Skill Relentless Squall increases ATK by 20% for 10s."

## Rover: Havoc

Rover: Havoc S1.0  skillTypeBonus +30% [skill]
  trigger: none (unconditional)   window: always
  source text: "Resonance Skill DMG Bonus is increased by 30%."

Rover: Havoc S6.0  critRate +25%
  trigger: none (unconditional)   window: always
  source text: "In the Dark Surge state, Rover's Crit. Rate is increased by 25%."

## Rover: Spectro

Rover: Spectro S1.0  critRate +15%
  trigger: castMatch "skill" → skill   window: 7s
  source text: "Rover's Crit. Rate is increased by 15% for 7s when casting Resonance Skill Resonating Slashes or Resonance Skill Resonat"

Rover: Spectro S2.0  elementBonus +20% [Spectro]
  trigger: none (unconditional)   window: always
  source text: "Rover's Spectro DMG Bonus is increased by 20%."

Rover: Spectro S5.0  skillTypeBonus +40% [liberation]
  trigger: none (unconditional)   window: always
  source text: "Rover's Resonance Liberation DMG Bonus is increased by 40%."

## Sanhua

Sanhua S1.0  critRate +15%
  trigger: castMatch "basic" → basic   window: 10s
  source text: "Basic Attack V increases Sanhua's Crit. Rate by 15% for 10s."

Sanhua S5.0  critDmg +100%
  trigger: none (unconditional)   window: always
  source text: "Crit. DMG of Forte Circuit Ice Burst is increased by 100%."

Sanhua S6.0  atkRatio +10% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: 20s
  source text: "After an Ice Prism or a Glacier is detonated, all team members' ATK is increased by 10% for 20s, stacking up to 2 times."

## Shorekeeper

Shorekeeper S2.0  atkRatio +40%
  trigger: none (unconditional)   window: always
  source text: "The Outer Stellarealm now increases the ATK of all nearby party members by 40%."

## Sigrika

Sigrika S1.0  multiplierUp +70% [basic]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multipliers of Basic Attack - Elucidated, Dodge Counter - Decipher, Resonance Skill - BIG BOOMY BOOM!, and Reson"

Sigrika S2.0  multiplierUp +120% [forte]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Forte Circuit - Learn My True Name is increased by 120%."

Sigrika S5.0  multiplierUp +30% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Where Trust Leads Me! is increased by 30%."

Sigrika IH1.0  elementBonus +3% [Aero] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "Blessing of Runes Each stack of Blessing of Runes grants the active Resonator in the team 3% Aero DMG Bonus and 3% Echo"

## Taoqi

Taoqi S2.0  critRate +20%
  trigger: none (unconditional)   window: always
  source text: "The Crit. Rate and Crit. DMG of Resonance Liberation Unmovable is increased by 20% and 20%, respectively."

Taoqi S2.1  critDmg +20%
  trigger: none (unconditional)   window: always
  source text: "The Crit. Rate and Crit. DMG of Resonance Liberation Unmovable is increased by 20% and 20%, respectively."

## Verina

Verina S4.0  elementBonus +15% [Spectro]
  trigger: castMatch "heavy" → heavy   window: 24s
  source text: "Heavy Attack Starflower Blooms, Mid-Air Attack Starflower Blooms, Resonance Liberation Arboreal Flourish and Outro Skill"

Verina IH0.0  atkRatio +20%
  trigger: castMatch "heavy" → heavy   window: 20s
  source text: "When Verina casts Heavy Attack Starflower Blooms, Mid-air Attack Starflower Blooms, Resonance Liberation Arboreal Flouri"

## Xiangli Yao

Xiangli Yao S2.0  critDmg +30%
  trigger: castMatch "skill" → skill   window: 8s
  source text: "Casting Resonance Skill or Resonance Liberation Cogitation Model increases Crit. DMG by 30% for 8s."

Xiangli Yao S5.0  multiplierUp +222% [outro]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Outro Skill Chain Rule is increased by 222%."

Xiangli Yao S5.1  multiplierUp +100% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Cogitation Model is increased by 100%."

## Yangyang

Yangyang S1.0  elementBonus +15% [Aero]
  trigger: castMatch "intro" → intro   window: 8s
  source text: "Intro Skill Cerulean Song increases Yangyang's Aero DMG Bonus by an additional 15% for 8s."

Yangyang S3.0  skillTypeBonus +40% [skill]
  trigger: none (unconditional)   window: always
  source text: "Resonance Skill DMG Bonus is increased by 40%."

Yangyang S6.0  atkRatio +20% ⚠ [UNMAPPED_PHRASE]
  trigger: castMatch (UNRESOLVED phrase: "Mid-air Attack Feather Release")   window: 20s
  source text: "After casting Mid-air Attack Feather Release, the ATK of all team members is increased by 20% for 20s."

Yangyang IH1.0  elementBonus +8% [Aero]
  trigger: castMatch "intro" → intro   window: 8s
  source text: "Yangyang's Aero DMG Bonus is increased by 8% for 8s after casting Intro Skill Cerulean Song."

## Yinlin

Yinlin S3.0  multiplierUp +55% [forte]
  trigger: none (unconditional)   window: always
  source text: "Forte Circuit Judgment Strike's DMG multiplier is increased by 55%."

Yinlin S4.0  atkRatio +20%
  trigger: castMatch "Forte Circuit Judgment Strike hits a target" → ANY [forte_heavy_chameleon_cipher_damage]   window: 12s
  source text: "When Forte Circuit Judgment Strike hits a target, the ATK of all team members is increased by 20% for 12s."

Yinlin IH0.0  critRate +15%
  trigger: castMatch "skill" → skill   window: 5s
  source text: "After using Resonance Skill Magnetic Roar, Yinlin's Crit. Rate is increased by 15% for 5s."

Yinlin IH1.0  atkRatio +10% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: 4s
  source text: "The damage of Resonance Skill Lightning Execution is increased by 10% when hitting targets marked with Sinner's Mark, an"

## Youhu

Youhu S3.0  atkRatio +20%
  trigger: none (unconditional)   window: always
  source text: "Youhu's ATK is increased by 20%."

Youhu S5.0  critRate +15%
  trigger: castMatch "intro" → intro   window: 14s
  source text: "When Intro Skill Scroll of Wonders is cast, Youhu's Crit. Rate is increased by 15% for 14s."

Youhu S6.0  critDmg +15% ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "Each stack increases Youhu's Crit. DMG by 15%."

## Yuanwu

Yuanwu S5.0  skillTypeBonus +50% [skill] ⚠ [UNKNOWN_TRIGGER]
  trigger: UNKNOWN   window: persist (until rotation end)
  source text: "When Resonance Skill Thunder Wedge is on the field, Yuanwu's Resonance Liberation DMG Bonus is increased by 50%."

Yuanwu IH0.0  multiplierUp +40% [skill]
  trigger: none (unconditional)   window: always
  source text: "The DMG multiplier of Resonance Skill Thunder Uprising is increased by 40%, and its reduction efficiency of enemy Vibrat"

## Zani

Zani S2.0  critRate +20%
  trigger: none (unconditional)   window: always
  source text: "Crit. Rate is increased by 20%."

Zani S2.1  multiplierUp +80%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Targeted Action and Forcible Riposte is increased by 80%."

Zani S4.0  atkRatio +20%
  trigger: castMatch "intro" → intro   window: 30s
  source text: "When Intro Skill Immediate Execution is cast, the ATK of all Resonators in the team is increased by 20% for 30s."

Zani S5.0  multiplierUp +120% [liberation]
  trigger: none (unconditional)   window: always
  source text: "The DMG Multiplier of Resonance Liberation Rekindle is increased by 120%."

Zani S6.0  multiplierUp +40%
  trigger: none (unconditional)   window: always
  source text: "The DMG Multipliers of Heavy Slash - Daybreak, Heavy Slash- Dawning, Heavy Slash - Nightfall, and Heavy Slash - Lightsma"

## Zhezhi

Zhezhi S1.0  critRate +10%
  trigger: castMatch "skill" → skill   window: 27s
  source text: "Casting Resonance Skill Creation's Zenith restores 15 Resonance Energy and increases Crit. Rate by 10% for 27s."

Zhezhi S3.0  atkRatio +15%
  trigger: castMatch "skill" → skill   window: 27s
  source text: "Casting Resonance Skill Manifestation, Resonance Skill Stroke of Genius, or Resonance Skill Creation's Zenith increases"

Zhezhi IH0.0  atkRatio +6%
  trigger: castMatch "skill" → skill   window: 27s
  source text: "When casting Resonance Skill Stroke of Genius or Resonance Skill Creation's Zenith, ATK is increased by 6% for 27s."
