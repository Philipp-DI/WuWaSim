# `multiplierUp` scope audit — a text-first read of the 74 unbound effects

Third, independent check. Every judgement below starts from the **English of
the kit clause**, then is tested against `data/wuwa-data.json`
(`autoSkillMap`) and `tools/preprocess/skill-scope.mjs`. Counts confirmed:
126 `multiplierUp` effects, 52 with `skillKeys`, **74 unbound**.

---

## Verdict

**On the six actively-inflating effects: I agree exactly.** Filtering
bucket A ∩ `defaultActive` ∩ `window.type === 'always'` ∩ *no category
fallback* (`skillType === null`, so the value reaches every hit) returns
precisely Cantarella S2.0 +245%, Chisa S3.0 +120%, Phrolova S2.1 +75%,
Zani S6.0 +40%, Brant S6.0 +30%, Lucy IH1.0 +10%. No seventh, no false
member. All six also **resolve cleanly** to skill keys today
(`Jolt → skill_jolt`, `Scarlet Coda → basic_scarlet_coda`, the four
`Heavy Slash -` keys, three Sawring/Chainsaw keys, ten Brant `midair_*`
keys, `Hack → forte_heavy_hack_response_data_crash`) — the scope is
reachable, it is only never asked for.

**Where I disagree: "6 inflating" understates it.** On the criterion as
literally stated — bucket A ∩ `defaultActive` ∩ `always` — the set is **49**,
not 6. The other 43 are not harmless; they are *category*-scoped, which is
wrong in both directions:

| | effect | now hits | clause names | verdict |
| --- | --- | --- | --- | --- |
| over-broad | Carlotta S6.0 +187% | 3 liberation rows | Death Knell only | Fatal Finale gets +187% it was never granted |
| over-broad | Lucy S3.1 +50% | 5 liberation rows | Old Net Deep Dive | 4 spurious |
| over-broad | Luuk S5.1 +50% | 6 skill rows | Golden Reflux | 5 spurious |
| mis-targeted | Xiangli Yao S6.0 +76% | `skill` | `forte_heavy_law_of_reigns` | lands on the wrong skill entirely |
| mis-targeted | Cantarella S6.0 +80% | 5 basic rows | 3 `forte_heavy_phantom_sting_*` | disjoint from the intent |
| mis-targeted | Roccia S5.0 +20% | Heavy Attack | Resonance Liberation | `detectSkillType` read the sentence's *second* half |
| **silent zero** | Changli S5.0 +50% | 0 rows (`heavy`, she has none) | `forte_heavy_flaming_sacrifice` | the buff does nothing at all |
| under-scoped | Cartethyia S2.0 +50% | 5 basic rows | 22 rows (4 categories) | 17 rows miss the grant |
| under-scoped | Galbrena S6.0 +60% | 5 basic rows | 10 named rows | 5 spurious **and** 10 missed |

One more active+always defect sits outside bucket A: **Aemeath S2.2 +20%**
is bucket C (Tune Rupture status damage) yet carries `skillType: 'skill'`,
so it currently inflates all four of her Resonance Skill steps.

### Bucket totals (74)

| bucket | n | note |
| --- | --- | --- |
| **A1** — names a proper-noun skill | 59 | should be `skillKeys`-scoped |
| **A2** — names a category only | 7 | 4 already adequate via `skillType`, 3 not |
| **B** — genuinely global | 4 | Sanhua S3.0, Encore IH0.0, Brant S1.0, Danjin S2.0 — all four are leading-trigger/leading-condition sentences ending in "her damage dealt is increased by N%". Correctly unscoped. |
| **C** — another lane | 4 | Hiyuki S3.1 & S6.2 (Glacio Bite), Aemeath S2.2 (Tune Rupture), Denia S6.2 (Fusion Burst) — every one is the "element word before DMG names a STATUS" trap. Hiyuki S6.2's 40% is in fact a **Crit. DMG** value mis-read as `multiplierUp`. |
| **A total** | **66** | of which 49 are `defaultActive` + `always` |

---

## Bucket-A cases

Shape column keys the grouping in the next section.

| Resonator | Slot | Value | Skills the clause names | Resolves to keys? | Always-on? | Shape |
| --- | --- | --- | --- | --- | --- | --- |
| Sanhua | S4.0 | +120% | Heavy Attack Detonate | yes | **yes** | 1 |
| Sanhua | IH0.0 | +20% | Sanhua's Resonance Skill (category) | no | no | DB |
| Lingyang | IH0.0 | +50% | Intro Skill Lion Awakens | no | **yes** | 1 |
| Carlotta | S6.0 | +187% | RL Death Knell | yes | **yes** | TL |
| Hiyuki | S1.0 | +120% | Basic/Heavy/Mid-air/Dodge Counter - Foreclaimed Self | no | **yes** | 2 |
| Hiyuki | S3.0 | +160% | Heavy Atk Frost Splinter: Present Self; Bitterfrost: Foreclaimed Self | no | **yes** | 2 |
| Hiyuki | S5.0 | +80% | RS - Present Self; Frostblight: Jade Cleave; Frostblight: Petalfall | no | **yes** | 2 |
| Suisui | S5.0 | +100% | Basic/Heavy Attack - Drizzle Stance | yes | **yes** | 2 |
| Changli | S3.0 | +80% | RL Radiance of Fealty | no | **yes** | 5 |
| Changli | S5.0 | +50% | Heavy Attack Flaming Sacrifice | yes | **yes** | 6 |
| Brant | S6.0 | +30% | Mid-air Attack (category) | yes | **yes** | 6 |
| Galbrena | S3.0 | +130% | Resonance Liberation (category) | no | **yes** | 5 |
| Galbrena | S5.0 | +150% | RS Encroach / Ascent of Malice / Ravage | yes | **yes** | 2 |
| Galbrena | S6.0 | +60% | Seraphic Execution; Flamewing Verdict; Hellsent Barrage; Purgatory Scourge | 3 of 4 | **yes** | 2 |
| Mornye | S5.0 | +40% | RL - Critical Protocol | no | **yes** | 1 |
| Denia | S3.1 | +1200% | Basic Atk Stagecraft Form Stage 4; RS Phantom Bubble - Stagecraft Form | yes | no | 3 |
| Jinhsi | S5.0 | +120% | RL Purge of Light | no | **yes** | 1 |
| Jinhsi | IH1.0 | +50% | Intro Skill Loong’s Halo | no | **yes** | 1 |
| Xiangli Yao | S6.0 | +76% | RS Law of Reigns | yes | **yes** | 3 |
| Augusta | S3.0 | +25% | Thunderoar Backstep/Spinslash/Uppercut; Dodge Counter Backstep (+2 more bullets) | yes | **yes** | 4 |
| Rebecca | S1.0 | +50% | Basic/Heavy/Tactical Dodge/Dodge Counter - Huntress & - Guts | yes | **yes** | 4 |
| Rebecca | S3.0 | +60% | RL Party 'til Dawn!; RL BOOM! Fireworks! | 1 of 2 | **yes** | 7 |
| Rover: Electro | S4.0 | +20% | RL Ultimate Tactics | no | **yes** | 1 |
| Yangyang | S5.0 | +85% | RL Wind Spirals | no | **yes** | 6 |
| Aalto | S4.0 | +30% | RS Mist Bullets | no | **yes** | 1 |
| Aalto | S6.1 | +50% | Aalto's Heavy Attack (category) | no | no | 8 |
| Jiyan | S5.0 | +120% | Outro Skill Discipline | yes | **yes** | 7 |
| Jiyan | S6.0 | +120% | RL Emerald Storm: Finale | no | no | 3 |
| Jianxin | S4.0 | +80% | RL Purification Force Field | no | no | 5 |
| Jianxin | IH0.0 | +20% | RL Purification Force Field | no | **yes** | 1 |
| Rover: Aero | S5.0 | +20% | RL Omega Storm | no | **yes** | 1 |
| Cartethyia | S2.0 | +50% | Basic, Heavy, Dodge Counter, Intro (categories) | yes | **yes** | 2 |
| Qiuyuan | S3.0 | +500% | RL Sundering Strike | no | **yes** | 1 |
| Sigrika | S1.0 | +70% | Basic Atk Elucidated; Dodge Counter Decipher; RS BIG BOOMY BOOM!; RS Soliskin to the Aid | yes | **yes** | 2 |
| Sigrika | S5.0 | +30% | RL Where Trust Leads Me! | no | **yes** | 1 |
| Lumi | S3.0 | +30% | RL Squeakie Express | no | **yes** | 1 |
| Lumi | S5.0 | +100% | Laser | yes | no | 5 |
| Shorekeeper | S6.0 | +42% | Intro Skill Discernment | yes | **yes** | 3 |
| Phoebe | S1.0 | +480% | RL Dawn of Enlightenment | no | no | 7b |
| Phoebe | S1.1 | +90% | RL Dawn of Enlightenment | no | no | 7b |
| Zani | S3.0 | +8% | RL The Last Stand (last stage) | no | no | 3 |
| Zani | S6.0 | +40% | Heavy Slash Daybreak/Dawning/Nightfall/Lightsmash | yes | **yes** | 2 |
| Zani | S6.1 | +40% | Heavy Slash - Nightfall | yes | no | 3 |
| Chisa | S3.0 | +120% | Sawring - Blitz; Chainsaw Mode - Dodge Counter; Sawring - Eradication | yes | **yes** | 2 |
| Chisa | S3.1 | +120% | Sawring - Eradication | yes | no | 9 |
| Lynae | S1.0 | +120% | Basic Attack - Polychrome Leap | no | **yes** | 1 |
| Luuk Herssen | S2.0 | +60% | RL Rewritten in Winter's Margins | no | **yes** | 1 |
| Luuk Herssen | S3.0 | +136% | RS Aureole of Execution (all forms) | yes | **yes** | 2 |
| Luuk Herssen | S3.1 | +136% | Mid-Attack - Gavel of Earthshaker; Ichor Deposit | 1 of 2 | no | 2 |
| Luuk Herssen | S5.1 | +50% | RS Golden Reflux | yes | **yes** | 10 |
| Lucy | S2.0 | +270% | Heavy Attack - Multi-threading | yes | no | 8 |
| Lucy | S3.1 | +50% | Override from RL Netrunner; RL Old Net Deep Dive | 1 of 2 | **yes** | 1 |
| Lucy | IH1.0 | +10% | Hack | yes | **yes** | 5 |
| Lucy | IH1.2 | +5% | Hack | yes | no | 5 |
| Taoqi | S5.0 | +50% | Forte Circuit Power Shift | no | **yes** | 1 |
| Danjin | IH0.0 | +20% | RS Crimson Erosion | yes | **yes** | 1 |
| Danjin | IH1.0 | +30% | Danjin's Heavy Attack (category) | no | no | 5 |
| Camellya | S3.0 | +50% | RL Fervor Efflorescent | no | **yes** | 1 |
| Camellya | S5.0 | +303% | Intro Skill Everblooming | no | **yes** | 2 |
| Camellya | S6.0 | +150% | Forte Circuit's Sweet Dream | no | **yes** | 1 |
| Roccia | S4.0 | +60% | Basic Attack Real Fantasy | no | no | 3 |
| Roccia | S5.0 | +20% | RL Commedia Improvviso! | no | **yes** | 3 |
| Cantarella | S2.0 | +245% | Jolt | yes | **yes** | 1 |
| Cantarella | S6.0 | +80% | Basic Attack Phantom Sting | yes | **yes** | 3 |
| Phrolova | S2.1 | +75% | Scarlet Coda | yes | **yes** | 3 |
| Yangyang: Xuanling | S6.0 | +40% | Yangyang: Xuanling's Heavy Attack (category) | no | no | 5 |

---

## Sentence shapes, by how many bucket-A effects each unblocks

Each case is assigned to the **outermost** blocker — the first thing that
stops `skill-scope.mjs` from seeing the name.

| # | Shape | n | Status |
| --- | --- | --- | --- |
| **2** | `The DMG **Multipliers** of X, Y and Z are increased by N%` | **13** | **Not matched at all.** `TARGET_STAT` is `DMG\s*Multiplier` followed by `\s+of` — the plural "s" breaks it. One character. |
| **3** | `[Casting X] increase(s)/increasing the DMG Multiplier of Y **by N%**` | **10** | Verb precedes the name, so `OF_FORM` (needs `increas` *after*) fails and `OF_TAIL_FORM` captures `"Law of Reigns by 76%"` / `"Scarlet Coda by 75%"` → resolves to nothing. Fix = strip a trailing `by <N>%…`. Includes the possessive variant `increases X's DMG Multiplier by N%` (Roccia ×2). |
| **5** | `<Name> DMG [Multiplier] is increased by N%` (bare juxtaposition, no "of", no apostrophe); also `grants N% additional Hack DMG Multiplier` | **8** | No form covers a name that sits directly in front of the stat. |
| **6** | `<Name>'s DMG Multiplier is increased by N%` | **3** | `POSSESSIVE_FORM` **does** capture the name — verified: it returns `"Mid-air Attack"` for Brant S6.0. `targetNamesInClause` then runs `PROSE_CATEGORY_LEAD` over every name unconditionally and erases it to `""`. Category-only names are destroyed by their own normaliser. (Changli S5.0 additionally writes bare `Multiplier`, not `DMG Multiplier`.) |
| **4** | `The following skills have their DMG Multiplier increased by N%: - X, Y, Z` | 2 | Names live after a colon in a bulleted run; no form reaches them. Augusta, Rebecca. |
| **7** | `X and Y gain N% DMG Multiplier increase` / `gains an additional DMG Multiplier of N%` | 2 | `SUBJECT_FORM` fires but `splitNames` leaves a leading `"and "` on the second name (`"and Resonance Liberation - BOOM! Fireworks!"`). |
| **7b** | `X now increases DMG Multiplier by N% instead of M%` | 2 | The skill is the subject of *increases*; `SUBJECT_FORM` only knows `gain`/`deal`. Phoebe S1.0/S1.1. |
| **8** | scope stated only in a leading subordinate clause (`When casting Heavy Attack - Multi-threading, …, the DMG Multiplier increase is raised from 270% to 560%`) | 2 | Needs the trigger-vs-scope judgement; genuinely hard. Aalto S6.1, Lucy S2.0. |
| **9** | `The bonus DMG Multiplier **for** X … is increased by N%` | 1 | preposition `for`, not `of`. Chisa S3.1. |
| **10** | `X **has its** DMG Multiplier increased by N%` | 1 | Luuk S5.1. |
| **DB** | `Damage dealt by X is increased…` | 1 | Already implemented (`DEALT_BY_FORM`); the name is a bare category. |
| **TL** | `…a total increase of N% **in the** DMG Multiplier of X` | 1 | `OF_TAIL_FORM` handles it — but only on the untruncated clause (see below). Carlotta S6.0. |
| **1** | `The DMG Multiplier of X is increased by N%` — **the shape already works** | **20** | These fail *downstream*: 15 because the name has no key to land on (`Purge of Light`, `Omega Storm`, `Wind Spirals`… all live under a generic `liberation` / `intro` / `basic_N` key), 4 because the capture keeps trailing prose (`"Jolt triggered by Cantarella"`, `"the next Heavy Attack Detonate within 5s"`, `"'s Sweet Dream is additionally"`), 1 (Lucy S3.1) because of truncation. |

### The 120-character truncation is a separate, cross-cutting cause

`tools/preprocess/effects.mjs:547` stores `condition: clause.trim().slice(0, 120)`
"for DISPLAY", but `bindSkillScopes` reads **that same truncated string**.
32 of the 74 clauses are longer than 120 characters. Measured directly:

- Carlotta S6.0 — truncated → `SUBJECT "Shots of Resonance Liberation Death Knell"`, 0 keys. Full clause → `TARGET "Death Knell"` → `liberation_death_knell`. **One key lost purely to truncation.**
- Lucy S3.1 — truncated → `"Old Net Deep Dive is inc"`, 0 keys. Full → `liberation_old_net_deep_dive_override`.
- Galbrena S5.0, Hiyuki S3.0, Jianxin S4.0, Xiangli Yao S6.0 — the truncation cuts the clause *before* the word `increased`, so no TARGET form can fire regardless of any regex fix.

Any shape work done against the truncated field will under-deliver.

---

## What to fix first (ordered by effects unblocked)

1. **Feed `bindSkillScopes` the full clause, not the 120-char display copy.**
   Prerequisite for everything else; on its own it already recovers Carlotta
   S6.0 (+187% currently leaking onto Fatal Finale) and Lucy S3.1. Keep the
   truncation for `condition`; pass the untruncated text alongside.
2. **Make `TARGET_STAT` plural-tolerant (`Multipliers?`).** 13 effects, one
   character, and it is the single largest group — Hiyuki ×3, Galbrena ×2,
   Zani S6.0, Chisa S3.0 and Cartethyia S2.0 are all in it. Two of the six
   inflating effects are here.
3. **Strip a trailing `by <N>%` (and `on hit`, `for Ns`, `maxed at …`) from a
   captured name, and let the increase verb PRECEDE the name.** 10 effects,
   including Phrolova S2.1 and Cantarella S6.0.
4. **Stop `targetNamesInClause` from applying `PROSE_CATEGORY_LEAD` to the
   whole name.** `resolveNameToKeys` already tries stripped and unstripped;
   the outer strip only destroys category-only names. 3 effects, one of them
   Brant S6.0 (inflating). Zero-risk: it removes a normalisation that is
   duplicated one call deeper.
5. **Add the bare-juxtaposition form `<Name> DMG [Multiplier] is increased`.**
   8 effects, including Lucy IH1.0 (inflating).
6. Then the long tail: the bulleted `following skills:` list (2), the
   `and `-prefix bug in `splitNames` (2), `increases` as a subject verb (2),
   `for`/`has its` (2).
7. **Do not chase shape 1's 15 unresolvable names with regex.** Their skill
   simply has no named key — `Purge of Light` is filed as `liberation`. The
   `skillType` fallback is already equivalent wherever the resonator has a
   single row of that category; where it is not (Lynae S1.0 `basic`,
   Camellya S5.0 `intro`, Shorekeeper S6.0 `intro`), the fix belongs in the
   skill-key naming, not in `skill-scope.mjs`.

Two items outside the scope pass, found while reading:

- **Aemeath S2.2** (+20%, active, always) applies Tune Rupture *status*
  damage to her Resonance Skill rows. Wrong lane, not a scope miss.
- **Hiyuki S6.2** parses a **Crit. DMG** 40% as `multiplierUp`. Wrong stat.
