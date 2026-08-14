# CLAUDE.md — WuWaSim

Rules and invariants only. **This file states what IS; `docs/HISTORY.md`
records what HAPPENED** (the full P10→P13 chronicle and all session summaries
live there — append new summaries there, never here).

New to the project? Read in this order: `README.md` (run it) →
`docs/ARCHITECTURE.md` (how data flows) → `docs/GLOSSARY.md` (what words
mean) → this file (the rules).

---

## IDENTITY & CONTEXT

You are an expert Software Architect and Systems Engineer working on
**WuWaSim**, a Wuthering Waves damage simulator. Pure JavaScript (ES modules,
Node 18+, no framework, no bundler, browser + Node compatible).

**Goal:** Zero-defect, root-cause-oriented engineering for bugs; test-driven
engineering for new features. Think carefully; no need to rush.

**Code:** Write the SIMPLEST code possible. Keep the codebase minimal,
modular, and descriptive.

**Flow:** Keep it interactive where necessary — don't assume; ask for
confirmation/validation.

**Efficiency:** Be concise in chat output without diminishing product quality.

---

## PROJECT ORIENTATION

Browser-based team DPS simulator: players configure resonator builds, select
rotations, and get damage breakdowns per skill. The engine is pure math — no
network calls at sim time, no server.

- `index.html` — browser UI root; `src/ui/app.js` — UI wiring/routing
- `src/core/` — pure sim engine (import freely in Node tests)
- `data/wuwa-data.json` — compiled dataset (NEVER hand-edit; regenerate)

### Data pipeline

```text
data/extracted-nanoka/characters/*.json   ← source (56 files, schema v9)
data/patch.json                           ← manual overrides (hand-edit OK)
data/reference-rotations.json             ← curated reference rotations (hand-edit OK)
data/effect-overrides.json                ← curated effect triggers/windows (hand-edit OK)
data/forte-data.json                      ← committed Forte extraction (tools/extract-forte.mjs)
data/buff-facts.json                      ← the game's own bucket per value (extract_buff_facts.py)
data/extra-effects.json                   ← the game's ExtraEffect enum (extract_extra_effects.py)
          ↓ node tools/preprocess.mjs
data/wuwa-data.json                       ← compiled output used by all sim code
data/data-version.json                    ← content-hash manifest (cache-buster)
          ↓ node tools/optimize.mjs
data/wuwa-meta.json                       ← P12/P13 weights + suggested builds/teams
docs/meta-validation.md                   ← generated QA report (gitignored)
```

Re-run `npm run data` (preprocess) whenever source data or a curated input
changes, then `npm run meta` (optimize) to refresh the meta. Never edit the
generated files directly. When an engine file changes, keep the `ENGINE_FILES`
lists in `tools/optimize.mjs` and `tests/meta-schema.test.mjs` in sync.

---

## ARCHITECTURE PRINCIPLES

- **DRY:** Extract shared logic into neutral `src/core/` modules; never import
  one feature module's internals from another.
- **Encapsulation:** Accessor methods over direct `_attribute` pokes.
- **Dead code:** Remove unused code, legacy systems, hardcoded values.
- **Performance:** List accumulation over `+=` in loops; iterative over
  recursive when stack depth matters.
- **KISS:** Adhere to the KISS-principle to keep the codebase simple and easy to understand.
- **No type ignores:** Fix the underlying issue.
- **Complete migrations:** Update all imports and remove old shims in the same
  change.
- **Maximum test coverage:** Every new public function in `src/core/` gets a
  test; prefer live tests exercising real `wuwa-data.json` over fixtures.
- **Rotation format:** `build.rotation` (linear `string[]`) is the persisted
  format. The rotation graph is sim-time-only (`fromLinear()`); never persist it.

## CODE STYLE — NAMING (Simplification Plan S3.1)

1. **Write words out.** `resonator` not `reso`; `weaponConditional` not
   `wcond`; `segment` not `seg`; `level`/`index`/`current` not `lv`/`idx`/`cur`.
2. **Sanctioned short names** (complete list): `i`/`j`/`k` for loop indices in
   loops ≤ 5 lines; `x`/`y` coordinates; `id`; `el` for a DOM element in UI
   code only. Everything else: ≥ 3 characters and a real word.
3. **Scope rule:** the farther a name travels, the more descriptive it must
   be. Destructured one-liners may stay terse; anything crossing ~10 lines or
   a function boundary gets a full name.
4. **One concept, one name** — fixed by `docs/GLOSSARY.md`; never
   `reso`/`char`/`member` for the same thing in different files.
5. Comments state constraints the code can't show — not what the next line
   does, not why a change is correct.

---

## CRITICAL INVARIANTS — NEVER VIOLATE

Breaking any one silently corrupts sim output.

| Invariant | Detail |
| --- | --- |
| Effect-slot key format | `S{level}.{index}` for chain effects, `IH{node}.{index}` for inherent effects. Used by `effect-overrides.json`, `build.effectStacks`, and every effect-keyed UI strip |
| `multiplierUp` matches NODE skillType | e.g. a `forte_heavy` node uses `'heavy'` for multiplierUp matching |
| DMG bonus matches FORMULA type | `dmgBonusBySkillType` keys match the `skillType` field in formula.js skill objects (fed `formulaType`, NOT the node skillType) |
| DMG-type (`formulaType`) is DATA-DRIVEN | Each raw damage instance carries the game's own type tag (`skill.damage[*].type`: 0 basic, 1 heavy, 2 liberation, 3 intro, 4 skill, 5 Echo Skill). `preprocess.mjs` maps each display row to its exact instances (`matchRowHits`, full rate-vector) and reads `formulaType` from them — NO kit-text parsing. Node `skillType` stays mechanical. Type 5 sets `isEchoSkill` only (keeps the mechanical `baseFormula`) |
| Cast triggers are MECHANICAL | `castMatch` trigger firing reads the node `skillType` only (`phraseTypesForStep` in sim.js), never `formulaType` — a Basic that deals converted Liberation damage is still a Basic CAST |
| Stat nodes authoritative source | Per-node `skillTreeBonuses` (col/tier) is authoritative; `dataset.skillTree` aggregated table is fallback only |
| Element DMG node mapping | `propId 22–27` → `elementId 1–6` (do not offset or reorder) |
| Conditional effects default OFF | Any effect whose condition text contains `when / after / while / upon / duration` needs to be modelled if possible, if not defaults to OFF |
| An underivable stack count is ONE, and says so | `scaleEffect` resolves stacks from the user's count → a curated gauge → a `castMatch` trigger → else **1 stack + `stacksUnknown`**. NEVER fall back to `maxStacks`: a real cap makes that a large silent assertion (Lynae is 55%/stack to a cap of 25) |
| Gauge caps come from the GAME | `SpecialEnergy{N}Max` (BinData `baseproperty.json` → `extract-forte.mjs` → `resonator.specialEnergyCaps`) is authoritative for how many stacks a gauge holds. A curated `RESOURCE_DEFS` entry declares its `channel` and its literal `cap` is test-asserted equal |
| Gauge income is readable ON A CAST, and only there | ~~Gauge INCOME is NOT in the dumps and stays curated~~ — that held only for the four `data/bindata/` tables (Changli's 40 damage instances all read `SpecialEnergy 0`). The grant is not on the damage instance, it is on the CAST: `DT_SkillInfo` row → `SkillBuff`/`SkillStartBuff`/`SkillEndBuff` → `db_buff.GameAttributeID` ∈ `Proto_(Special)Energy*` (`data/gauge-income.json` ← `extract_gauge_income.py`, 50 resonators). Denia's three gauges reproduce her kit to the digit with no text parsing — cap 3/100/100 and +1/+25/+40. What it CANNOT see is income earned on a HIT: that lives in `db_PassiveSkill` (`DamageTrigger`, with its own CD) behind ExtraEffect chains, which is why Changli's Enflamement and Camellya's Crimson Bud show nothing in the cast lane and stay curated. The trigger lane is extracted but NOT wired — `rotation-resources.js` is per-cast by construction. Read the magnitude through `CalculationPolicy` (`ActiveBuff.ModifyStateAttribute`): **0** flat add, **1** scale base (`-10000` ⇒ zeroed), **2/4/9** fraction of `policy[1]`, **3** override (`0` ⇒ zeroed). Draining a gauge by its own full size is a flat `add` of `-cap`, NOT a `spendAll` shape — a reader that looks only for `spendAll` misses half the roster's spends |
| A stack BAND gates, `maxStacks` caps | A banded effect is one branch of a piecewise per-stack function (Yangyang: Xuanling is 10%/stack at 1-3 Havoc Bane, 12%/stack at 4-6). The band is tested against the RAW count and decides IF the branch applies; `maxStacks` then caps what it is WORTH. Never clamp before testing the band — a raw 4 would become 3 and light the wrong branch |
| Negative-status caps are BASE values | `NEGATIVE_STATUS_DEFS.maxStacks` is the base an enemy holds; kits RAISE it for a window (`STATUS_CAP_RAISES` — Xuanling S3 +3 Havoc Bane/20s). The timeline caps a stack at the limit in force WHEN IT LANDS and clamps the held total to the limit in force NOW, so excess falls away when a raise lapses. Repeats of one source refresh ("does not stack"); distinct sources sum. Do NOT "fix" a base cap to match a kit that raises it |
| Enemy abilities always hit | For anything enemy-related there is no miss, range or accuracy model. "on hit" / "within a certain range" / "nearby" are FIRING conditions that are always satisfied — model the effect, drop the qualifier, and do not hedge it as "the optimistic reading" |
| Stack cap + gain trigger are DESCRIPTION-scoped | The game states them in the sentence that GRANTS the stack, not the "Each stack …" value sentence. `descStackCap`/`descStackGain` read the whole description and return null rather than guess when it is ambiguous |
| Negative-status DMG does NOT crit | Its formula (`enemy-status.js`) has no crit term and no gear stat reaches it. A kit granting it ("can critically hit, with a **fixed** Crit. Rate of 80%") sets FIXED values that REPLACE crit — parsed onto `afflictionCritRate`/`afflictionCritDmg` so they never reach `resolveChainInherentContext`. Read as ordinary `critRate`/`critDmg` they buff every hit the wielder lands and push the build past the Crit Rate cap (Aemeath S6 was inflating her skill damage 4.1×) |
| A Resonance MODE is not a STATE | A mode is a build-level toggle, locked for the fight (`build.resonanceMode` → `effect.mode` → `modeGateOk`). `STATE_DEFS` is for in-combat states a CAST enters. Modelling a mode as a state makes it switch on mid-rotation and ignore the build's own toggle — and the state name can only ever match one mode, so it fires in the other one too. A roster-wide test forbids a state named after a mode |
| Status damage: solo builds its OWN enemy, teams SHARE one | `simulateRotation` resolves its own negative-status lane (`soloStatusDamage` → `totals.statusDamage`), so the build page counts it. `team-sim.js` must read `totals.skillDamage` per segment — a team has ONE enemy where stacks, cap raises and attribution cross members, and its own shared-timeline accrual owns that lane. Reading `totals.damage` there double-counts |
| A skill's LABEL comes from the game's name, its TYPE from the node | The game files a move under the input that casts it, which is not always what it calls the move (Aemeath's Mech basic chain sits in her Resonance Skill node). When a row's own name opens with a category, that category wins the label; the mechanical `skillType` never changes. Prefixing the node's category produced 18 self-contradicting labels like "Resonance Skill: Basic Attack — Mech Stage 4". PROVENANCE — how the move is reached — is always a TRAILING `· Forte Circuit` / `· Echo` marker, never a parenthetical on the category: "Heavy Attack (Forte)" reads as "a Forte kind of Heavy Attack", which is backwards. It must still be SAID (Cartethyia's normal and Forte Basic stages collide into identical labels without it) |
| Negative statuses are DATA, not folklore | Cap, stack lifetime, tick period and the per-stack multiplier all come from the game's own system buffs (`data/status-damage.json` ← `extract_status_damage.py`), one reserved buff id + `ExtraEffectID` per status — distinct from the KIT tables in `affliction-damage.json` (`ExtraEffectID 121`). Glacio Chafe's row reproduces the community-calibrated curve to the digit, which is what validates the rest. Do NOT re-derive these by observation: two of them had been sitting at exactly 0.8× the shipped values, and two dealt nothing at all |
| A status application is a NAMED cast, and its scope is the clause | Not every damaging step inflicts. The kit says which casts do and how many stacks (`tools/preprocess/status-apply.mjs` → `dataset.statusApplyRules`); a kit that says nothing keeps the every-damaging-step fallback. A description section is the whole FAMILY, so a clause must be gated by the **stage** it names (a "Stage 4" clause is otherwise inherited by stages 1–3) and by the **skill** it names, resolved only among the keys whose own section carries that clause. Four clause shapes mention a status without applying one: negations, conversions, cap raises, and a teammate's infliction the kit reacts to. The game's own applier buffs (`data/status-appliers.json` ← `extract_status_appliers.py`) bound the counts, but they cannot supply the skill list — `db_skill` holds 562 exploration rows and a sweep of all 482 `db_*.db` finds each applier referenced only from `db_buff`; the grant lives in the ability blueprints. A SEQUENCE NODE can grant a second applier the Forte's own list never mentions (Aemeath S3's Heavy Attacks, in `Instant Response`), so a curated rule carries the `minChain`/`state` gates its kit states |
| A clause that NAMES its skills is scoped by the NAMES | `tools/preprocess/skill-scope.mjs` binds both shapes the game writes — TARGET ("The DMG Multiplier of X is increased") and SUBJECT ("X and Y gain 300% Crit. DMG") — and the binding covers EVERY stat, not just `multiplierUp`. Once the names match they ARE the scope: the category read off the same clause is the weaker restatement and can contradict it outright (her Heavy Attacks are "considered Resonance Liberation DMG", so the clause parses `skillType: 'heavy'` while their hits carry `'liberation'`, and both gates together match nothing). A name that resolves to nothing leaves the effect exactly as it was, which is what keeps the pass safe — "Resonators in the team" resolves to nothing and stays team-wide |
| An UNSCOPED `multiplierUp` multiplies the WHOLE kit | `resolveChainInherentContext` adds it for every hit when the effect names no keys and states no category (`buffs.js`). With `defaultActive` + `window.type: 'always'` that is a permanent, silent multiplier on everything the wielder throws — Cantarella's S2 read 2.45 on `basic_1` from a clause naming only Jolt, inflating every unrelated hit 3.45×. Six shipped that way. This is INFLATION, so it makes a character look BETTER and nothing about the output looks wrong. `tests/multiplier-scope.test.mjs` guard 1 keeps that set at zero |
| A bare CATEGORY is not a skill NAME | Resolution matches a key on all of a name's distinctive tokens, so a name that is only a category resolves on a single blunt word — "Heavy Attack" reaches Cartethyia's `forte_heavy_mid_air_attack_*`, which are not Heavy Attacks. Such names are refused (`isBareCategory`) and the category travels through `skillType`/`nodeTypeMatches` instead, which strips the `forte_` provenance prefix properly. Safe only while `detectSkillType` can answer for the clause: refusing a category it does NOT read leaves the effect scoped to nothing, which is worse than the blunt match. That is why Brant's "Mid-air Attack**'s** DMG Multiplier" was fixed in `SCOPE_ONLY_PHRASE_TO_TYPE` (one possessive cost him his whole scope) and why `CATEGORY_TOKENS` holds no word that is distinctive in a real key |
| The scoping pass reads the FULL clause, not `condition` | `effects.mjs` stores `condition: clause.trim().slice(0, 120)` **for display**. 32 clauses are longer and the cut routinely removes the skill name — Xiangli Yao's "Law of Reigns" survives as the fragment "Resona". `bindSkillScopes` re-splits the node's own `desc` and matches on that 120-char prefix to recover the clause. Any new reader of `condition` that makes a DECISION (not a label) has the same bug: team-recipient detection had it once already |
| A list of casts that FIRE an effect is not its scope | The game writes a bulleted enumeration for both — "The following skills have their DMG Multiplier increased by 25%: - …" (Augusta, a scope) and "1 stack of Fated End is inflicted … when the following skills hit: - …" (Galbrena, a trigger). `BULLET_LIST_FORM` therefore requires the STAT in the preamble. A bulleted list is read ALL-OR-NOTHING, because a partial read drops members silently; and it runs PAST its own clause (the game ends a group with a period and opens the next with a bullet), so the continuation bullets must be gathered before the gate is applied |
| Same-instant mark events are ordered EXPLICITLY, not by epsilon | A step's start time IS the previous step's end time, so a consumption and the next cast's application share one number. `EVENT_ORDER` in `enemy-status.js`: a cast's own grant lands BEFORE the consumption it performs (so the cast spends it — measured 24 Trail → 34 → burst → 0), the application lands AFTER (it belongs to the next cast — measured, her Heavy lands 2 Trail right after a Duet emptied the target). A time offset cannot encode this: it must be smaller than any real gap between steps and larger than the sampler's "at this instant" tolerance, and no value is both |
| `build.rotation` is linear | Graph is built at sim time via `fromLinear()` — never persisted |
| Effect-slot keys are FROZEN before anything reads them | `S{level}.{index}` addresses effects from `effect-overrides.json` AND from a saved build's `effectStacks`, so any preprocess pass that changes an effect COUNT must run BEFORE the overrides. `bindSkillScopes` drops what it cannot scope; ordered after the overrides it silently moved Luuk Herssen's curated S6.0 patch onto a different effect |
| Tune Break is ONE per pass, for the whole team | The Off-Tune bar is the TARGET's and refills once per cycle, so three members in one pass share one opportunity (`capTuneBreaksPerPass`). It matters because the animation STOPS THE COMBAT CLOCK (measured `freeze_combat_clock_s` on all 68 rows, plus general invincibility and interrupt level 11) — an uncapped extra is damage at zero cost to the DPS denominator. The surplus is REMOVED, not zeroed, so nothing downstream sees a cast that did not happen. The build page still simulates every slotted response and only flags the extras |
| A trigger's category is not the effect's SCOPE | `SKILL_PHRASE_TO_TYPE` is read by `extractStructuralTrigger` (what fires it) AND `detectSkillType` (what it applies to). For a Tune Break the two are opposites — "After a Resonator deals Tune Break DMG, all Resonators deal 20% more DMG" is TRIGGERED by one and applies to EVERYTHING — so 'tuneBreak' is deliberately absent from that map and the trigger reads it from its own branch |
| The Interfered cap IS the responder count | Four kits state "the max stack limit of Tune Strain - Interfered on a target is increased by 1" and NONE states a base, so the limit is the number of responders on the team (`interferedCap`). The whole chain pays zero unless a responder, a Tune Break AND a Tune Strain - Shifting mark are all present, and a non-responder holding team-wide Tune Break Boost converts none of it — the payout clause lives on the responder's own Tune Break node, not on the stat |
| Team-buff paths are disjoint | Three team-wide application paths exist by construction (see `docs/ARCHITECTURE.md`, "Life of a buff"); a buff flows through exactly ONE — adding a source means picking a path, never duplicating |
| A value may PRECEDE its stat, and the parser fails SILENTLY | The game writes a grant both ways — "Fusion DMG Bonus is increased by 30%" and "gain 30% Fusion DMG Bonus" — and a reader that only looks forward returns nothing at all, with no warning and no diff. 109 of 324 buff clauses were unread that way. `pctFor` reads either direction from a STAT NAME; `pctNear` stays forward-only from a VERB, because what precedes a verb belongs to a different effect in the same sentence. Every buff clause is now either read or listed with its reason in `tests/effect-coverage.test.mjs` — that list is the contract, and it may only shrink |
| A sentence's leading TRIGGER is not the effect's SCOPE | The game names the cast that fires a buff before it names the buff: "After casting Intro Skill Applaud for Me!, Brant's DMG dealt is increased by 20%" is not an Intro-only buff, and "Casting Heavy Attack Mercy gives Calcharo 10% Resonance Liberation DMG Bonus" is not a Heavy one. Scope comes from the segment that OWNS the stat — `ownerSkillType` (last comma-free run before the verb) and `statScopeSkillType` (the words right in front of the stat phrase) — never from `detectSkillType` over the whole clause |
| An Outro Skill has NO level curve | Its `level` map is empty, so the row loop walks zero params and produces nothing — which is why 55 of 56 resonators shipped with no outro damage row and every swap scored 0. The multiplier is read from the sentence that STATES it and repeated across the level band. A resonator whose off-field actions carry an `outro` trigger (Galbrena, Calcharo, Rover: Havoc) must NOT also cast one: two paths, one cast |
| A mode-gated outro is a MENU, not one grant | "When in Resonance Mode - A, …. When in Resonance Mode - B, …" is two grants with their own values AND their own durations, of which exactly one is live. Read flat, Denia's outro took the value from one branch and the duration from the other and handed the mix to every build. Branches carry `outroBuffs[*].mode`, filtered at the hand-off against the OUTGOING member's `build.resonanceMode` |
| The BUCKET comes from the game, not from the sentence | `computeDamage` composes `(1 + dmgBonus) * (1 + amplify) * (1 + deepen)`, and the client's own `CharacterDamageCalculations.js` has the same shape: `t = 1 + Proto_DamageChange + elementBonus + attackTypeBonus` is ONE additive factor, while `Proto_SpecialDamageChange` and the target's `Proto_DamageReduce` are separate multiplicative ones. Which bucket a value lands in is NOT recoverable from kit text, because the game does not decide it from the wording — Sigrika's "targets take 30% more DMG" is SpecialDamageChange (multiplicative) and Cartethyia's "take 30% more DMG" is DamageChange (additive), same words. `data/buff-facts.json` is therefore the PRIMARY source and the text parse the fallback; the extractor drops any value whose bucket differs between two buffs of one owner rather than guessing. `multiplierUp` is never retargeted — it is the skill's own rate, not a bonus bucket |
| An element word before "DMG" may name a STATUS | "Fusion Burst DMG", "Glacio Chafe DMG" and "Aero Erosion DMG" open with an element but mean the negative status's own damage — a separate formula with no crit and no gear stat. The outro scope map matches the element only with "DMG" IMMEDIATELY after it, which is what keeps Denia's, Lucilla's and Ciaccona's outros out of the wielder's amplify bucket |
| `ExtraEffectReqPara` is indexed BY THE REQUIREMENT | The client loops `for ([index, type] of Requirements.entries())` and reads `RequirementPara[index]` (`ExtraEffectLibrary.ResolveRequireAndLimits`), so the para slot belongs to the requirement at the SAME position, not to the buff. Reading `para[0]` unconditionally mis-read 16 buffs whose skill list sits at index 1 behind an element or buff-stack gate (Galbrena's five, Cartethyia's five, Verina's four) — and silently dropped the scope each of them states. `ExtraEffectReqSetting` is the matching `CheckType`: **0 = every requirement must hold** (so two scope lists INTERSECT), **1 = any one does** (they UNION). Under ANY, a requirement that is not a scope at all lets the effect fire outside the list, so the list is not a scope — Ciaccona's `1407000060` fires on four named skills OR on DamageType 2 |
| A chain's extra hits are DATA; whether they ADD is not | The game ships a Resonance Chain's own damage instances as bullets marked 共鸣N whose rows are already in `damageTable` — `matchRowHits` never attaches them, because the kit's display rows describe an S0 build (111 such rows, 20 resonators). But most chain-marked bullets REPLACE a hit rather than add one (84 of 106 measured), and adding a replacement inflates a character instead of merely understating them. The name test (strip 共鸣N, look for an unmarked sibling) only produces CANDIDATES: spot-checking all 16 against their own chain node found Cantarella's S1 "finisher" and Phoebe's S6 heavies to be upgrades whose base bullet is simply named differently, and Zhezhi's real extra Ivory Herald to resolve onto the wrong parent. So an entry ships only from `KIT_VERIFIED` in `chain-extra-hits.mjs`, with the node text quoted. Within a `family` the highest chain level at or below the build's SUPERSEDES the rest — Xiangli Yao's matrices exist at 共鸣1 and 共鸣6, and an S6 fires six, not twelve |
| The game may ship a per-resource multiplier as PRE-MULTIPLIED rows — read them as the answer key, not as the model | Denia's [Banish - Breakdown Form Stage 2] displays 56.34%, and `damageTable` also holds `12111052110/…120/…130/…140/…150` at exactly 2.5× / 4.0× / 5.5× / 7.0× / 8.5× of it — `base × (1 + 1.5N)` for N = 1..5 Dark Cores (five because S3 states "Denia now holds up to 5"). The skill's own row (`12110002005`) IS present and IS what the sim uses, so those variants are not needed to make the cast deal damage; attaching them as extra hits would double-count. They are the CHECK: `computeDamage` already composes `baseMult × (1 + multiplierUp)`, so a correct per-resource model must reproduce each variant exactly, and `tests/rotation-resources.test.mjs` asserts all five at every level of the curve |
| A "for each [X] CONSUMED" multiplier scopes ITSELF | The clause names no skill ("the DMG Multiplier of the attack"), so there is no name to bind — and none is needed. Its stack count reads what the STEP SPENDS (`computeResourceConsumption`, `stackTrigger.consumed`), which is 0 on every cast that spends nothing, so the effect is scoped by arithmetic and is exempt from the unscoped-`multiplierUp` drop. Two things make that safe and must stay true: the window is `thisCast` (with `persist` the effect is dark on the very cast it is for unless a sibling key fired first, then live on every step after), and an UNCURATED gauge consumes 0 rather than reading as unknown — `resourceConsumedAt` returns 0, never null, so a gauge the app does not model understates instead of paying on every cast. A clause scaling on the gauge merely HELD is NOT this shape and still needs a real scope |
| A gauge belongs to the CHARACTER, not to a segment | A team turn is simulated as several `simulateRotation` calls — the auto-injected Intro is its own segment — so a gauge earned in one and spent in another reads empty unless it is carried. `simulateRotation` takes `carryInResources` and returns `resourceEndLevels`; team-sim threads them through `sim.memberResources`, Intro → rotation → next pass, exactly as `memberFires` carries the trigger ledger. Denia earns her Dark Core on Intro and spends it on Banish Stage 2, so without the carry her multiplier is correct solo and silently zero in every team sim |
| An EXTERNAL buff's routing is DATA | Weapon, sonata and echo grants are stated by the game one row per grant, each with its own attribute id, magnitude, duration, stack limit and scope — `WeaponConf.ResonId` → `WeaponReson(Level).Effect[]` → `db_buff` → (`ExtraEffectID 35 AddPassiveSkill` → `db_PassiveSkill.SkillActionParams`) → leaf, and `PhantomFetter.BuffIds` for sonatas (`data/external-buffs.json` ← `extract_external_buffs.py`). The attribute ids ARE `stats.js` PROP's ids (7 Atk, 8 Crit, 9 CritDamage, 11 EnergyEfficiency, 35 HealChange, 21+element, 28+element resistance, 95 amplify, 99 IgnoreDefRate), which `tests/external-buffs.test.mjs` pins. Reading these from tooltips fails three ways at once and did: a value written BEFORE its stat is unread, a source stating two grants can only carry one, and an unclassifiable stat is applied as a FLAT whole-step multiplier. A grant reached from SEVERAL trigger paths must be emitted ONCE — Everbright Polestar's two grants are each added by two passives (Tune Rupture - Shifting, Fusion Burst) and are the same 8s buff, not two |
| A magnitude is only flat if `CalculationPolicy` says so | `ModifierMagnitude` means nothing on its own — `CalculationPolicy[0]` decides how to read it: **0** flat add, **1** scale base, **2/4/9** a FRACTION OF `policy[1]`, **3** override (the same table the gauge-income invariant uses). A 2/4/9 row is a coefficient in a runtime formula, not a percentage. Halo of Starry Radiance ships "every 1% of Off-Tune Buildup Rate grants a 0.2% ATK increase … up to 25%" as magnitude **200000** under `[2, 141, 1, 1, 0, 0, 100, 2500]` — the 100 is the per-unit divisor and the 2500 the 25% cap. Read as a flat fraction that is **+2000% ATK**, which put a HEALER at 3.6M damage (21× her real output) on the team page. Three sonatas are this shape and no weapon is; they are marked `derived` and carry the policy. The benchmark could not catch it — it pins Chisa to sonata 7 while her META build uses 25, so a bad set can be invisible to the harness and obvious in the app |
| A derived magnitude is a FORMULA, and the client states it | `BaseAttributeComponent.Cbr` (the function that evaluates every modifier) reads a 2/4/9 row as: subtract `Min` (`policy[5]`) and stop if ≤ 0, divide by `Ratio` (`policy[6]`), multiply by the magnitude, cap at `Max` (`policy[7]`) — the slot names being the client's own, from what `ActiveBuff.p__` hands to `AddModifier`. Mode 9 lands in the SAME lane as a plain "scale base" modifier, so its fraction is `source / Ratio × Value1 × 1e-8`. `policy[2]` picks whose attribute set is read: **1** the INSTIGATOR (Halo's healer, Feathered Trace's inflicter), **0** the buff HOLDER (Pact's incoming resonator) — and the tooltips name exactly those people. `Ratio` also says what KIND of quantity the source is: **100** for a percentage read per 1%, **1** for a POINT count. All three shipped sets reproduce their tooltip to the digit, caps included, which is what validates the reading. ONE DEPARTURE: `Cbr` never consults `Max` on the mode-9 branch, but the tooltip and the `Max` field state the same number independently on all three sets, so `derivedGrantValue` applies it — honouring it can only under-credit, ignoring it is how +2000% ATK happened |
| Tune Break Boost is attribute 142, and it HAS a base | `Proto_WeaknessMastery` (142) reads **10** on exactly the seven Tune-family responders and 0 on the other 2,733 `baseproperty` rows; `Proto_BreakWeaknessRatio` (141) is **Off-Tune Buildup Rate**, a percentage reading 10000 (100%) on ALL 2,740 rows. The two were swapped in `tune-break.js`, which read `Proto_WeaknessTotalBonus` (140) — 0 for every resonator, non-zero only on 11 enemy rows — and concluded the stat had no base. It does: `resonator.tuneBreakBoostBase`, added to the kit grants in `boostPointsFor`, which raises the Tune Strain payout (solo Denia S0 1.2% → 2.4%) and is what Pact of Neonlight Leap's per-point half scales off. A base of 10 is also what makes Luuk's "every 10 points" pay one tick with no grants at all |
| `FormationPolicy` is an ENUM, and two values mean team-wide | The client branches on each value in a different component: **1** `RoleBuffComponent.ShareApplyBuffInner` walks `SceneTeamModel.GetTeamEntities()` and copies the buff to every member that is not the holder; **5** `AddBuffInner` routes the add to `GetFormationBuffComp()` (component 216) INSTEAD of the character's own, so the buff is held by the FORMATION. **2/3** are neither — `RoleInheritComponent.StateInherit` re-adds them to the INCOMING role on a swap (3 also removes the outgoing copy), which is the `recipient: 'incoming'` lane. Accepting only 1 read ONE of the sixteen team-wide sonata grants; the other fifteen are policy 5 |
| A weapon's team TRIGGER is not a team GRANT | `TriggerPreset` is handed to the trigger as its own `Preset` (`CharacterPassiveSkillComponent` -> `AddTrigger({Type, Preset, ...})`), so `preset[0]` means something different per TriggerType — it says who may FIRE the passive, never who receives what it grants. The recipient is `InstigatorType`, which the same component resolves the action's target from (`jxm(skillId, r.InstigatorType, ...)`, stored as `TargetKey`): **Owner** the wielder, **Attacker** whoever fired it. Team-wide needs BOTH — a teammate may fire it AND the firer receives it. The game ships each counterexample: preset 1 + Owner (Phasic Homogenizer, Boson Astrolabe — "After a Resonator in the team casts a Tune Break skill, it grants ... TO THE WIELDER") and preset 0 + Attacker (Spectrum Blaster — only the owner fires it, so "whoever fired it" IS the owner). Reading the preset alone handed 40 grants to the whole team. `tests/external-buffs.test.mjs` also requires every team-wide weapon to NAME the team in its own tooltip — the mechanism is data, the tooltip is the independent witness |
| An echo MAIN-SLOT passive is a DIRECT row, a conditional one is a CHAIN | `PhantomSkill.BuffEffects` (joined to our echo by `activeSkill.settleId` in `SettleIds`) holds both. An always-on main-slot buff is a bare `GameAttributeID` + magnitude sitting straight in the list — Lioness of Glory's `290001002` (Fusion 12%) and `290001014` (Liberation 12%), no trigger, no duration; most live in a shared `290001xxx` pool reused across the roster. A CONDITIONAL buff sits behind an `ExtraEffectID 2` chain instead (Glommoth's incoming transfer is three levels deep). Taking only the direct rows separates the two with no text at all. THIRTY echoes state a main-slot passive and the engine credited NONE of them, so every carry on a cost-4 main echo was short ~12% element + ~12% skill-type DMG — the single largest correction of the external-buff lanes (benchmark 1.165x → 1.114x) |
| An echo's main-slot GATE is prose-only, so the values must be CROSS-CHECKED | ConfigDB carries no restriction: Sigillum's 25% Resonance Liberation row is identical in shape to Lioness of Glory's 12%, and only its sentence says "When equipped in the main slot **by Aemeath**". So `preprocess.mjs` owns the gate, and credits a grant set ONLY when its values equal the percentages the main-slot sentence itself states, as a multiset — two independent sources agreeing is the whole warrant. That check refuses exactly the five cases that would otherwise be wrong: Glacio Dreadmane (a 20% Glacio row with NO main-slot sentence — it is the mid-air bonus), Reminiscence: Fleurdelys (three 10% rows for one stated value, the rest being its Rover/Cartethyia branch), Twin Nova: Collapsar Blade (three rows, two stated), Reminiscence - Nightmare: Adam Smasher (gated on Lucy or Rebecca), and Nightmare: Lampylumen Myriad (states a Coordinated Attack bonus that is no attribute row). SLOT 0 only — that is what "main slot" means, and what `resolveEchoSkill` already assumes |
| The sonata piece count is NOT in `PhantomFetter` | Its fields are BuffIds, EffectDescription(Param), FetterIcon, Id, Name, Priority — no tier size anywhere, so the extractor guesses it from the row id (`sonataId*10 + pieces`). That guess is wrong wherever the last digit is a sequence number: Dream of the Lost's row **192** filed its grants under "2 pieces" when the set's only tier is a THREE-piece one, so the tier fell back to the text reader and its 35% Echo Skill DMG Bonus went unread. The join that does not guess is `EffectDescriptionParam`, which IS the dataset tier's own `params`; `preprocess.mjs` re-keys on it, and a fetter matching nothing keeps the extractor's key, so the pass can only correct |
| The two sonata lanes must PARTITION the grants | `sonataWindowGrants` owns element / ATK / skill-type DMG; `sonataConditionalGrants` owns crit / amplify / DEF-ignore. A bucket in neither is dropped, a bucket in both is counted twice — `tests/external-buffs.test.mjs` asserts no grant is claimed by both. The conditional lane was text-only until 2026-08-14 and lost more than half of what it owned: of the 11 tiers stating one, FIVE read as zero (Eternal Radiance, Windward Pilgrimage, Crown of Valor, Song of Feathered Trace, Heart of Evil's Purge) and two more were wrong — Lamp of Nether Road is 5% x 4 stacks and the sentence carries only the 5%; Flamewing's Shadow ships its 20% as two rows. A SCOPED grant still falls back to the text, because a whole-build bucket has no room for "...but only on Heavy Attacks" |
| Unreached sonata buffs are LEGACY, not missed | 29 `31000*` rows carry an attribute and are never reached by the fetter walk, which looks like a large extraction gap and is not: every one hangs off a `...001`-series tree that no `PhantomFetter` references, or off a passive the live root does not add. The reworked sets keep their old config in place (sonata 24 still holds a 25%-ATK-on-outro tree the current 5-piece replaced). Verify a suspected gap by tracing the FETTER ROOT forward, never by assuming an orphan row is live |
| A recipient is per GRANT, so `false` must be SAID | team-sim reads `window.teamWide ?? isTeamWideBuff(window.raw)`, so an ABSENT flag means "ask the text" — and that fallback is per-TIER, because `raw` is the whole tier sentence. Flaming Clawprint's 5-piece grants the team 15% Fusion Bonus **and the caster** 20% Liberation Bonus; both halves read team-wide and the caster's own buff was handed to everyone. A data-derived buff knows the answer per grant and must emit the flag EVEN WHEN FALSE (`buff.fromData \|\| buff.teamWide`), or the `??` throws that knowledge away. Text-parsed buffs have no per-grant answer and keep the fallback |
| The suggested-teams bar and its numbers are ONE measurement | ~~`score` came from an openers-ON 3-pass total while the card showed a no-opener single pass.~~ Both halves were defensible and the pairing was not: the pool shipped a 90% card out-DPSing a 95% one, which is indistinguishable from a broken calculator. Everything now comes from the openers-ON multi-pass run, reported as the AVERAGE of its passes (`passes` carries the three marginals — N-total minus (N−1)-total, so post-hoc lanes like negative-status DoT cannot fall out), and `score` normalizes `teamDps`, the figure the card headlines. `tests/meta-schema.test.mjs` asserts DPS never rises as the bar falls |
| A derived opener can be fiction, and a team of only those is not suggestable | The opener is DERIVED, not curated, and for some kits it derives absurdity — Jiyan needs 189–211s of filler to charge his first Liberation, Encore 114–144s. `gatedLibs` cannot find them (it reads 0 on all 416 shipped teams); `addedTime` is the signal. A credible opener costs no more than ONE ROTATION of the team it opens — relative, so no invented constant — and a team where NO member clears that bar is dropped by `rankTeams`. Measured: 330 of 416 kept, all 52 anchors keep suggestions. CURATED teams are exempt and flagged instead, because silently dropping a maintainer-asserted comp hides the finding |
| A tier's SECOND grant needs its own group key | `groupStackingBuffs` keys a sonata window on `sonataId::raw` to merge the one-entry-per-trigger-phrase the TEXT parser emits. The DATA path reads a tier's grants one row each and they all share that same tier text, so the key kept the FIRST and dropped the rest — Song of Feathered Trace's ATK grant never reached a window while its Heavy Attack DMG did. The bonus itself (kind/element/dmgType/pct/duration) is part of the key; for a text-parsed buff every one of those is identical across its triggers, so the original merge is untouched |
| An external grant's SCOPE is a DamageTypes requirement | `ExtraEffectRequirements` 12 = `DamageTypes`, whose para carries the game's own 0..5 tag (0 basic, 1 heavy, 2 liberation, 3 intro, 4 skill, 5 echo) — the same tag `skill.damage[*].type` uses. Everbright Polestar's "the wielder's **Resonance Liberation DMG** ignores 32% DEF" is `damageTypes:[2]`, so it must be applied PER HIT (`skill.js targetContext`), never target-wide: a Tune Break is not Liberation damage, and widening it would move the one gear-independent anchor. `ExtraEffectReqSetting 1` (ANY) means the list is not a restriction at all and is not a scope |
| "All-Attribute DMG Bonus" is SIX element rows | Kumokiri's team bonus ships as `110036109`–`110036114`, one `Proto_DamageChangeElement1..6` each, NOT as the standalone `Proto_DamageChange` (15) — which also exists and is used elsewhere. Both shapes are real, so which one a source uses is only knowable from the data. This is the concrete reason external-buff routing cannot be inferred from wording |
| DEF-ignore and RES-shred had no consumer | `contribution.defIgnore` existed for as long as the contribution shape has, and was read by NOTHING: `sim.js` consumed only the amplify buckets and `stats.js` mentions it only in empty-shape literals. `formula.js` has always had both hooks (`context.defIgnore`, `context.resReduce`); they simply had no producer. A RES shred is written by the game as a NEGATIVE value on the target's own resistance attribute (attr 30 = −0.10), not as an ignore attribute — so it lands in `resReduce`, not in a new bucket |
| A weapon's UNCONDITIONAL leading stat is not in ConfigDB | "ATK is increased by 12%" / "Increases All-Attribute DMG Bonus by 12%" appears nowhere in the weapon's buff chain, behind the rank tags it grants, or in `WeaponConf.FirstPropId`/`SecondPropId` (those are base ATK and the secondary stat) — and **0 of 127** rank-1 `WeaponReson` rows carry a permanent attribute buff. It most likely lives in the ability blueprints. So `weapon-buffs.js weaponPassiveStats` keeps that clause (reliable: always first, always unconditional) and the data path owns the CONDITIONAL grants, which is where the text reader actually fails |
| A scope stated as BULLET ids routes through the bullet chain | `ExtraEffectRequirements` type 1 (SkillIds) and type 5 (BulletIds) both state scope as data, and both are checked by EXACT membership. A skill id is a PREFIX of our damage ids; a bullet id is not — it joins through `data/bullet-timings.json` (`bulletDamageIds`, the montage→bullet→damage chain) to a damage id and from there to a `hit-map.json` key. Type 5 is not a rare shape: 77 valued roster buffs use it against type 1's 106. Hiyuki's +500% Crit. DMG is stated ONLY this way, and the join is self-verifying — the bullets resolve to `liberation_inward_vision` + `liberation_blade_liberation`, which is her clause ("The Crit. DMG of Foreclaiming: Inward Vision and Foreclaiming: Blade Liberation") verbatim |

---

## TEST COMMANDS

Run EVERY test file + the module-load sweep before and after any change.
A non-zero exit anywhere is a regression — do not proceed.

```bash
npm test        # all tests/*.test.mjs (tools/run-tests.mjs — whole directory, never a hand-picked list)
npm run sweep   # module-load sweep (tools/sweep-modules.mjs — imports EVERY src module; catches parse
                # errors and broken import paths; only src/ui/app.js is skipped, it needs a DOM)
npm run lint    # ESLint — correctness rules are ERRORS (CI-gating); style rules warn until S3/S4 ratchet
```

`npm test` / `npm run sweep` are plain Node (no install needed);
`npm run lint` and CI need `npm install` once (devDependencies only — the
runtime remains dependency-free). CI (`.github/workflows/ci.yml`) runs all
three on every push/PR.

New test files follow the existing pattern: plain Node, no framework,
`assert(name, cond)` helper, `process.exit(failed === 0 ? 0 : 1)`.

Generated-data locks for refactors (must show effectively zero diff when the
change is meant to be behavior-preserving):

```bash
npm run data && git diff --stat data/wuwa-data.json   # LOCK A
npm run meta && git diff --stat data/wuwa-meta.json   # LOCK B
```

Reading the locks: `generatedAt`/manifest-hash lines churn on every rerun —
ignore them (`git checkout --` the files if that's ALL that changed). LOCK B's
`engineHash` moves whenever an ENGINE_FILES member's content changes (even a
comment); any OTHER changed line in either file is a real behavior regression.

---

## KEY DATA SHAPES (quick reference)

```js
// OffFieldAction (src/core/off-field.js)
{ type: 'coordinated'|'turret'|'outroBurst', trigger: 'liberation'|'outro'|'skill'|'forte',
  element: number /* elementId 1–6 */, scaling: 'atk'|'def'|'hp', multiplier: number,
  hitsPerCast: number /* outroBurst only */, cooldown: number|null,
  duration: number|null /* null = whole window */, note: string,
  requiresState?: string /* e.g. 'maestro' */ }

// BuffEffect (src/core/buffs.js) — always use makeBuffEffect() factory
{ owner: 'resonator'|'weapon'|'echo'|'echoSet'|'outro'|'team',
  scope: 'self'|'active'|'teamWide'|'incomingResonator',
  stat: BuffStat, value: number /* fraction for % stats */,
  payload: object /* { elementId } | { skillType } | { duration } */, label: string }

// RotationGraph (src/core/rotation-graph.js)
{ nodes: Map<nodeId, { id, skillKey, index }>,
  edges: [{ from, to, kind: 'sequence'|'prerequisite'|'optional' }] }
// Do not add edge kinds without updating validateRotation + buildRuleGraph.
```

---

## COGNITIVE WORKFLOW

1. **ANALYZE:** Read relevant files. Do not guess.
2. **PLAN:** Map the logic; identify root cause; order changes by dependency.
3. **EXECUTE:** Fix the cause, not the symptom. Failing tests first.
4. **VERIFY:** All tests + module sweep. Confirm via output, not assumption.
5. **SPECIFICITY:** Do exactly as much as asked.
6. **PROPAGATION:** Propagate changes across all affected files.

## SUMMARY STANDARDS

Every session summary includes: **[Files Changed]**, **[Logic Altered]**,
**[Verification Method]**, **[Residual Risks]** ("none" only if truly none),
**[Updated Docs]** — update docs to match reality, preserving history
(strikethrough, not deletion). Append the summary to `docs/HISTORY.md`.

## TOOLS

Prefer built-in tools (grep, read_file, …) over manual workflows.
`wuwa-data.json` is 200k+ lines — grep with specific patterns, never read whole.

## COMMIT CONVENTIONS

When asked to commit (never push automatically; pushing is a separate,
explicit instruction):

1. Full verification suite first (exception: full verification already ran last prompt) — never commit a broken state.
2. `git add -A`
3. Message structure: `[Phase/scope]: [imperative subject]`, a 2–3 sentence
   summary, then sections: What was implemented / Files changed / Files NOT
   touched (scope boundary) / Verification / References (implements, depends
   on) / Notes (deviations, deferred items). Use `git commit -F <tempfile>`
   for long messages.
