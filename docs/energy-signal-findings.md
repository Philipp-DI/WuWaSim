# Energy-Signal Findings — P12 Prerequisite Check

Produced per `docs/P12-PREREQ-ENERGY-CHECK.md`. Read-only investigation,
no feature code written.

## Verdict: **NO-GO** (engine) — with a favorable data finding

The engine cannot currently answer "was enough energy available when this
Liberation was cast?" None of the four signal criteria in
`P12-PREREQ-ENERGY-CHECK.md §1` are met. **P11.5 — Energy Modeling is
required before P12 §3a can proceed**, exactly as the check document
predicted. However, Step 2 (the step the check doc itself flagged as "the
biggest unknown and the most valuable output of running this check")
resolves favorably: the raw source data already carries both inputs P11.5
needs, cleanly structured. P11.5's data-sourcing half is therefore a small
preprocess projection, not a curation effort from scratch. Only the engine
half (accumulation in `sim.js`) is greenfield work.

---

## Step 1 — Engine inventory

Grepped `src/core/sim.js`, `stats.js`, `formula.js`, `skill.js`, `buffs.js`
for energy-related code:

- **`sim.js`**: zero matches. No gauge tracking, no accumulation, no
  Liberation-cost consumption anywhere in the rotation walk.
- **`stats.js`**: `energyRegen` is computed in `resolveTotalStats` as a
  plain stat (base × gear/buff modifiers, default 1.0 = 100%) and stored on
  the stats object. Never read back by any rotation logic — it's a leaf
  value.
- **`formula.js`**: one read of `stats.energyRegen` — the `'er'` `rawCoef`
  damage-scaling path (line ~207), used only by ER-scaling kits (the
  Mornye-type edge case P12-INSTRUCTION-SET §3b already anticipates). This
  is a damage-multiplier read, not gauge tracking — confirms ER is
  stat-only, never consumed as a resource.
- **`buffs.js`**: `ENERGY_REGEN` is a `BuffStat` constant (for buffs like
  "+20% Energy Regen") — again a stat modifier, not a gauge.
- **`skill.js`**: zero matches.

**Conclusion**: criteria 1, 2, and 3 in §1 (per-skill generation, known
Liberation cost, rotation-level accumulation) are all unmet. Criterion 4
(monotonic ER response) cannot be evaluated because there is no signal to
sweep yet — confirmed in Step 3 below.

## Step 2 — Source data probe (the key finding)

Checked `data/wuwa-data.json` (compiled) and
`data/extracted-nanoka/characters/*.json` (raw upstream source).

### Compiled dataset — correction after a deeper look

My first pass only searched each `resonators[i]` object's own keys and
found nothing. **That was incomplete.** `data/wuwa-data.json` has a
separate top-level `baseStats` dict (keyed by `propertyId`, populated by
the legacy `projectBaseStats()` off `RoleInfo`/`BaseProperty` — a wholly
different pipeline path than the nanoka per-character files), and it
already carries `energyMax`. Cross-checked 15 resonators' raw "Resonance
Cost" value against `baseStats[id].energyMax`: **13/15 match exactly**
(Sanhua 100/100, Baizhi 175/175, Lingyang 125/125, Carlotta 125/125, Brant
175/175, etc.). The two non-matches are gaps in *my probe script's* raw
traversal (Hiyuki/Galbrena have nonstandard skill_tree shapes my ad-hoc
lookup didn't handle), not gaps in `baseStats` itself — Galbrena's
`energyMax` (125) is present and presumably correct even though my script
failed to find the raw value to compare it against. One real gap:
Lucilla (1109) has no `baseStats` entry at all (likely missing/different
`propertyId` linkage) — worth a one-off check during implementation, not a
sign the field is broadly unreliable.

**Conclusion: Liberation cost needs zero new preprocess work.** It's
already `baseStats[resonatorId].energyMax`, sitting unused. The earlier
draft of this section called this out as something to project — it isn't;
`sim.js` just needs to read it under its existing name.

### Raw nanoka source — only per-skill energy generation is actually missing

Probed `1102.json` (Sanhua) directly:

- **Per-skill/per-hit energy generation**: present at
  `skill_trees[<i>].skill.damage[<damageId>].energy` — e.g. Sanhua's Basic
  Attack hits 87/132/38/71, Liberation-tagged entries 420/1000/700. This
  *is* genuinely new — confirmed nowhere in the compiled dataset, and
  confirmed unread by `preprocess.mjs`'s existing per-node loop (the loop at
  `projectNanokaCharacterFull`, ~line 1182, already iterates
  `Object.values(sk.damage ?? {})` for a different purpose — matching each
  level-row's first multiplier back to a `related_property` via a
  value-keyed lookup table, `dmgPropByRate`. It reads `e.element`,
  `e.type`, `e.rate_lv`, `e.related_property` from those same objects, but
  never `e.energy`.) Extracting it means extending that same per-hit
  lookup, not adding a new traversal.
- A separate finding from the *level*-row classifier (`classifySkillRow`,
  ~line 423): the `META_SUFFIXES` list already contains `' Resonance
  Cost'`/`' Energy Cost'`/`' Energy Regen'` — these rows are already
  recognized and routed to `metaByNode` as descriptive text. They were
  never meant to feed a numeric field; that's consistent with why
  Liberation cost is sourced from `baseStats` instead, not from this path.

**This means**: of the two inputs P11.5 needs, one (Liberation cost) is a
zero-cost read of data already in the dataset; the other (per-hit energy
generation) is a real but narrowly-scoped extraction, piggybacking on a
lookup table the pipeline already builds for an unrelated purpose.

## Step 3 — ER response test

**Not run.** Per the check doc, this step only applies "if Steps 1–2
suggest a signal exists" in the engine. Steps 1–2 confirm the engine has no
energy model at all to sweep — there is nothing to test a response against
yet. This step becomes applicable once P11.5's accumulator lands; it should
be the first thing P11.5's own test file (`test/energy-trace.test.mjs`)
exercises.

## Step 4 — Verdict (formal)

**NO-GO**, engine side. Trigger **P11.5 — Energy Modeling**
(`P12-PREREQ-ENERGY-CHECK.md §3`) before P12 §3a.

P11.5 scope, informed by the above (narrower than the doc's worst-case
framing, since data sourcing is mostly solved):

- `tools/preprocess.mjs`: project per-skill `energyGen` from each damage
  instance's `energy` field onto the compiled dataset (the one genuinely
  missing input). Liberation cost needs no projection — it's already
  `baseStats[resonatorId].energyMax`.
- `sim.js`: add the per-step accumulator + read-only `energyTrace` on
  `SimResult`, per §3b of the check doc. Purely additive — must not change
  any existing damage number (verify via the byte-identical-totals test the
  doc specifies).
- `test/energy-trace.test.mjs`: monotonic accumulation, cost subtraction at
  the Liberation step, higher ER reaching castable status
  earlier/at-lower-investment, and the additive-doesn't-change-damage
  guarantee. This is also where Step 3's ER-response check (deferred above)
  belongs — confirm the signal actually moves with ER once it exists.

Nothing else in P12 changes as a result of this verdict — per
`P12-PREREQ-ENERGY-CHECK.md §5`, only breakpoint detection (§3a) depended on
this signal; weights, the meta schema, the validation report, and the
runtime layer are unaffected and can be scoped/built independently of
P11.5's completion.

## Open question — resolved

**Confirmed by the maintainer**: the per-skill `energy` values found in the
raw source are base generation, scaled by the resonator's `energyRegen`
stat at runtime (consistent with guide-site convention recommending ~125%
total ER on most resonators — i.e. base generation alone is calibrated
under the assumption of moderate ER investment, not 100%). The projection
in P11.5 should emit the *base* per-hit values unscaled; `sim.js`'s
accumulator multiplies by `stats.energyRegen` at accumulation time, the
same pattern `formula.js`'s existing `'er'` rawCoef path already uses for
reading the stat.

**P11.5 approved to start (2026-06-26).**

## Post-implementation correction — raw `energy` is ×100-scaled

After P11.5 shipped, the maintainer caught a real problem by hand-checking
the first computed trace against actual gameplay: Sanhua's projected
`basic_1` energyGen (87) implied a single hit generates ~87% of a 100-cost
Liberation gauge — implausible on its face, and the projected `liberation`
trace (`0→87→219→257→328→748→100→648`) claimed *full* castability after
two basic-attack stages, which no resonator does without extraordinary ER.

**In-game verification (Sanhua, 165.6% ER, no skill/sequence investment):**

| Test | Observed | Predicted from raw values | Predicted ÷100 |
| --- | --- | --- | --- |
| 17× Stage 1 Basic Attack | gauge ~25% full | 87 × 1.656 × 17 = **2451%** (impossible) | 0.87 × 1.656 × 17 = **24.5%** ✓ |
| 3× `skill` cast | gauge ~50% full | 1000 × 1.656 × 3 = **8246%** (impossible) | 10 × 1.656 × 3 = **49.7%** ✓ |
| 6× `skill` cast | just short of castable | (impossible, far over 100% already at 3 casts) | 10 × 1.656 × 6 = **99.4%** ✓ |

Three independent in-game data points all landed within ~1% of the ÷100
prediction. **Fix applied**: `tools/preprocess.mjs`'s `energyByRate` lookup
now divides `e.energy` by 100 at the point of extraction (one line), same
convention several other raw nanoka fields in this pipeline already use
(e.g. crit values stored as hundredths-of-percent). Liberation cost
(`baseStats[id].energyMax`) is unaffected — it comes from a wholly separate
upstream table and already matched the in-game "Resonance Cost" tooltip
exactly, unscaled.

Corrected Sanhua values: `basic_1: 0.87`, `basic_2: 1.32`, `basic_3: 0.38`,
`basic_4: 0.71`, `basic_5: 4.2`, `skill: 10`, `intro: 10`. Dataset
regenerated; `tests/energy-trace.test.mjs` updated (its ER-sensitivity case
now uses a 9×`skill` rotation, dense enough to actually straddle a
100-cost gauge — the realistic basic_1..5 total, ~7.5, no longer comes
close in just 5 hits, which is itself a sanity check that the fix worked).

**Residual unknowns at this point, unchanged in nature but now scaled
correctly**: the large Skill/Forte/Intro entries noted in Step 2 (1000→10,
700→7, etc.) had only been verified in-game for Sanhua's `skill`/`intro` —
see below for the additional checks that closed this out.

## Group A resolved — universal `intro:10`/`skill:10` is real, not a bug

The maintainer's earlier in-game test list surfaced a cluster of resonators
(Sanhua, Hiyuki, Encore, Mornye, Jinhsi, Ciaccona, Mortefi, Rover: Spectro,
Taoqi) all sharing an identical raw energy value on their Intro Skill or
Resonance Skill, despite completely different kits/elements — flagged as
suspicious (a shared raw value usually means a copy-paste default, not a
real per-character number).

**In-game verification (Jinhsi, 250% total ER, Intro Skill cast on full
Concerto — see Concerto note below):**

| Predicted (energyGen 10 × 2.5 ER ÷ cost 150) | Observed |
| --- | --- |
| **16.67%** | "optically in the 16-17% range" |

This is the third independent confirmation of the flat `10` baseline (after
Sanhua's `skill`/`intro`, both also 10), now across a different character,
element, and skill slot. **Group A is resolved**: the shared `10` is a real,
intentional game-design constant (Intro Skills / many Resonance Skills
generate a flat base 10 energy), not a data bug. No fix needed.

## Lupa's `skill_feral_fang` (13.67) — qualitatively corroborated

Lupa carries two Resonance-Skill-tagged entries: `skill_skill_damage: 2.09`
and `skill_feral_fang: 13.67` (the latter only available after the 2nd
Resonance Skill cast in a row — gated by a state, not always-on). The
maintainer couldn't get a precise in-game reading but confirmed the
qualitative direction: the feral-fang variant "fills considerably more of
the res lib bar" than the plain skill cast. That's consistent with our
extracted values (13.67 is ~6.5× larger than 2.09) — not a contradiction,
no fix needed. Liberation cost: 125.

## Yuanwu's `skill_rumbling_spark_damage` (15) — closed, no further verification

Yuanwu's Resonance Skill carries four energy-tagged sub-entries: `skill:
3`, `skill_thunder_wedge_coordinated_attack: 0`,
`skill_thunder_wedge_detonation_damage: 1`, `skill_rumbling_spark_damage:
15` (Liberation cost 125). Flagged as an individually-large outlier, but
the maintainer has decided **not** to pursue in-game verification —
extracted-data values are trusted over manual in-game sampling for
Resonance Energy going forward (manual sampling is imprecise — "optically"
reading a gauge fill — versus the source data, which has now cleared three
independent spot-checks with no contradictions). Not revisited unless a
future symptom (e.g. a P12 breakpoint sweep result that looks wrong for
Yuanwu specifically) gives a concrete reason to.

## Mechanic discovery — Concerto Energy substitutes Basic Attack Stage 1 for Intro Skill

The maintainer discovered: swapping in a resonator **without full Concerto
Energy** makes them cast a substitute "Basic Attack Stage 1" instead of
their real Intro Skill; the actual Intro Skill only plays once Concerto is
full. Concerto Energy is a separate swap-in gauge, distinct from the
Resonance Energy this sub-phase models (per the maintainer's earlier
three-way breakdown — Resonance/Concerto/Stamina).

[Reference: WuWa Wiki — Energy Regen](https://wutheringwaves.fandom.com/wiki/Energy_Regen)

This doesn't invalidate any projected `energyGen` value (the Jinhsi sample
above was explicitly cast on full Concerto, i.e. the real Intro Skill). It
**is** a real gap in `sim.js`'s current model: every `intro`-keyed rotation
step is treated as the actual Intro Skill's energy/damage unconditionally,
with no check for whether Concerto was full at that point in the rotation.
This is consistent with P11.5's already-declared scope boundary ("exact
Concerto timing, swap-in energy" — out of scope, see plan), so no code
change here — but it's worth flagging explicitly as a named limitation for
whoever next touches Intro-Skill modeling (likely a P13+ concern, since it
requires its own Concerto-gauge accumulator, mirroring this phase's
Resonance Energy one).

## Mechanic discovery — off-field Resonance Energy generation (not modeled)

The maintainer confirmed (2026-06-27): characters cannot generate Resonance
Energy off-field by their own actions. Instead, an off-field character
generates **50% of whatever Resonance Energy the currently active character
generates**, scaled by the **off-field character's own ER%** (not the active
character's element or ER% — only the active character's raw generation
amount matters as the base).

`energyTrace` (P11.5) is single-character only — it tracks one resonator's
own rotation in isolation. There is no cross-member energy propagation
anywhere in `team-sim.js` or `off-field.js` (confirmed: zero `energy`
references in `off-field.js`). This is consistent with P11.5's declared
scope (single-character signal for the build-page breakpoint sweep) and with
`P12-INSTRUCTION-SET.md §14`/`COMBAT-ROLES-REFERENCE.md`'s `LIB_REGEN`/
`CONCERTO_EFF` roles, which already flag team-level energy as a deferred,
P13-class concern ("team-level ER breakpoint override"). No code change
here — this is a named requirement for whoever builds that override: for
each off-field member, accumulate `0.5 × activeCharacterEnergyGenThisStep ×
offFieldCharacter.stats.energyRegen` alongside their own (zero, today)
on-field generation.

## P13 team-level measurement (2026-07-02) — off-field share modeled; breakpoints still not honest

The rule above is now implemented: `src/core/team-energy.js` projects a team
sim's segments into per-member energy event streams (own casts at full base,
every other member's casts at the 50% share, each scaled by the receiving
member's own ER at accumulation time), and `team-sim.js` attaches the
resulting per-member `memberEnergy` trace to every team result
(informational — never gates damage, same P11.5 invariant). Because every
income source scales linearly by the member's own ER while Liberation costs
are constants, the minimum viable ER is **closed-form**
(`max over k of k×cost / S_k`), no iterative sweep.

**Measured result** (steady state — liberations in the last of 3 passes, so
cold-start charging is excluded): even WITH the off-field 50% share, modeled
income covers Liberation costs only at implausible ER. Example, the curated
Glacio Chafe team (Lucilla + Hiyuki + Chisa): Chisa needs **ER ≈ 4.83**;
roster-wide the requirement lands at **≈ 3.5–5** wherever a cost is known at
all (Hiyuki's and Lucilla's Liberations are not energy-gated —
`libCostKnown:false` / missing `baseStats`) **[superseded 2026-07-23 — they ARE
energy-gated; the missing `baseStats` was a Dimbreath data gap, see end]**. No guide recommends anything
near these numbers, which confirms — now at team level, quantitatively —
the P12 conclusion: the unmodeled sources (damage taken, sustained on-hit,
Concerto/intro economy, sequence refunds) dominate the real energy economy.

**Decision encoded in `tools/optimize/team-rank.js`**: the sweep runs for
real, but a credibility gate (`MAX_CREDIBLE_ER = 1.8`) sends every
non-credible or non-energy-gated member to the provisional balanced target
(125%) — honest fallback over fabricated advice (never-fabricate, hard-req 3).
The meta's `erOverride` entries therefore remain `provisional: true`
across all 8 anchors — but this is now a **measured** outcome, not a
deferral. The infrastructure (events, closed form, runtime resolution via
`src/core/team-er.js`) is in place; if damage-taken/on-hit generation is
ever modeled, honest team breakpoints light up with no structural change.

**Possible follow-up (maintainer decision, not implemented):** use the model
*comparatively* instead of absolutely — the ratio of team-context to solo
requirement under the same partial model (always ≤ 1, since the off-field
share is strictly additional income) could scale the 125% balanced target
per team, e.g. "this team is energy-richer for Hiyuki by ×0.8 → ~100%".
Methodologically defensible (the unmodeled bias partially cancels in the
ratio) but it is still a heuristic; per the project's never-fabricate
posture it needs explicit maintainer sign-off before shipping.

## Correction (2026-07-02, same day) — the "unmodeled on-hit" was largely an extraction bug

The maintainer challenged the §above framing ("damage-taken/on-hit/Concerto
unmodeled"): enemy-dependent generation (damage taken, kill orbs) is out of
scope by direction — but on-hit generation IS in the source data, per damage
instance. Investigation confirmed the challenge and found a real bug:

- `tools/preprocess.mjs` keyed per-hit energy by `rate_lv[0]` in a
  single-value map and looked up only the FIRST term of each row's
  multiplier string. Multi-hit rows were systematically undercounted:
  duplicate-rate entries (separate hits of one stage — e.g. Sanhua stage 4,
  `19.95%+19.95%`, two entries × 0.71) collapsed by overwrite, and `"X%*N"`
  rows (e.g. Sanhua stage 3, `10.85%*4` → 4 × 0.38) counted one hit.
  **120/504 skill nodes across 54 characters were affected; 551/996 compiled
  skill entries changed; roster-wide base generation roughly DOUBLED
  (+101.9%).** The in-game verification had only exercised single-hit rows
  (stage 1, `skill`), which is why it passed. Fix: `rowEnergyFromMults` —
  per-hit × hit-count over every term, duplicate entries consumed in order
  (`tests/energy-per-hit.test.mjs` locks the anchors).
- **Team-ER outcome revised**: with corrected income, the steady-state sweep
  now produces credible team-context targets for **78 of 192** override
  entries (band ≈ 1.3–1.8, conservative upper bounds); the rest stay
  provisional honestly — kits that aren't energy-gated (Hiyuki, Lucilla)
  **[superseded 2026-07-23 — they ARE energy-gated; see end]** and
  requirements still beyond the credibility gate. The "ER ≈ 3.5–5
  roster-wide" measurement above described the UNDERCOUNTED dataset; kept
  for history.
- **Concerto is extractable**: every damage entry also carries
  `element_power` (e.g. 200 on Sanhua's stage 1 → 2.0 at the ÷100
  convention) — per-hit **Concerto Energy** generation, currently unread by
  the pipeline. Modeling the Concerto gauge (intro-substitution gating,
  outro availability) is feasible from existing data — a scoped follow-up,
  not enemy-dependent.
- Known residual: in the 18 nodes where same-rate entries carry different
  energy values, per-row in-order consumption is an approximation when two
  DIFFERENT rows share one rate (Rover 1501: two rows now read 1.0 where one
  of them should read 1.12 — ±0.12, not resolvable from the data shape).

## Concerto gauge implemented (2026-07-02, same day)

Follow-up from the correction above: `element_power` is extracted alongside
Resonance energy, using the identical per-hit accounting
(`rowEnergyFromMults`, same duplicate-rate/multi-hit handling) — a second
pass over the same `sk.damage` entries in `tools/preprocess.mjs`, projected
onto the dataset as `concertoGen` on every `damageTable`/`autoSkillMap` entry.
Sanhua: `basic_1: 2`, `basic_2: 4`, `basic_3: 8` (4 hits × 2), `basic_4: 8`
(2 hits × 4), `basic_5: 10`; `skill`/`intro`/`liberation`: 0 (raw
`element_power` 0 on those entries — Concerto is a Basic-Attack-driven
resource in the extracted data, consistent with the "auto-attack to ready a
swap" mental model most guides describe).

`sim.js`'s solo `energyTrace` carries `rawConcertoGen` per step (mirrors
`rawGen`, additive — never changes `stepDamage`/`totals.damage`). Team-level
accumulation lives in `team-sim.js` (Concerto is inherently a team/swap
mechanic — no gauge to track in a solo build): a per-member gauge
(`concertoGauge`, cap 100) fed only by the **active** member's casts (per the
mechanic discovery above — off-field members don't build their own Concerto);
every swap boundary records `{ outgoingId, incomingId, gauge, ready }` in the
result's `concerto.swaps` array, and a full gauge is consumed on the handoff.

**Enforcement is opt-in** (`enforceConcerto: false` by default). Measured
across all 190 swap boundaries in the curated meta teams (2-pass sims): only
**9 (~5%)** reach a full 100-gauge within one highlight-cycle rotation —
typical per-swap gauges land in the 25–90 range. Gating the Outro→Intro
handoff (outro buffs, incoming-resonator transfer, the real Intro Skill vs.
the substitute Basic Attack) on this by default would mean the vast majority
of team-sim rotations lose their handoff damage/buffs entirely — not a
believable simulation of real play, where players sequence swaps around
Concerto deliberately (holding a rotation an extra beat, using off-field
time productively) rather than always swapping the instant a scripted
rotation says to. The gauge and per-swap readiness are always computed and
reported (`result.concerto`) regardless of the flag, so the UI can surface
"Concerto not yet full at this swap" as information without silently
dropping content. `enforceConcerto: true` is available for anyone who wants
strict gating (and `initialConcerto` pre-charges every gauge, e.g. to model
a player who banked Concerto before executing the rotation).

Not addressed here (future scope, not blocking): the intro-substitution
half of the mechanic (an incomplete-gauge swap casts a substitute Basic
Attack Stage 1 instead of the real Intro Skill) — currently, an unready
swap under enforcement simply skips the handoff segment rather than
inserting the substitute cast. Modeling the substitute accurately needs its
own damage source (which basic-attack stage, at what state) per resonator,
not yet curated.

## `element_power` = Concerto Energy — CONFIRMED (2026-07-02, later same day)

The maintainer challenged the "Basic-Attack-driven" framing above (correctly
— see the retraction below) and then, after a separate manual in-game
verification pass, confirmed `element_power` **is** the Concerto Energy
driver with ~99% confidence, and reverse-engineered the exact per-term
accounting rule from the raw key structure.

### The retraction that preceded it

Before this confirmation, three hypotheses were tested and ruled out from
the data alone:

1. **Concerto (naive)** — ruled out on the maintainer's own correction:
   `element_power` is zero on ~40% of real damage hits (not just heals),
   which looked inconsistent with a resource generated by "any attack."
   (Turned out this reservation was itself wrong — see below.)
2. **Off-Tune (Tune Break) buildup** — ruled out: the maintainer confirmed
   ANY damage contributes to Off-Tune buildup in-game, but `element_power`
   is absent on a large fraction of real damage hits; a universal-buildup
   value can't legitimately be zero that often.
3. **Negative-status application value** (Glacio Chafe/Havoc Bane/etc.) —
   ruled out: even after fixing a real, independently-confirmed bug in
   `statusesInflictedBy` (element-mismatched kit-text false positives — see
   the dedicated section below), coverage/magnitude were statistically flat
   between confirmed appliers and the rest of the roster.

Hypothesis (1)'s zero-rate objection is resolved by the accounting rule
below: `energyGen`/`skill`/`liberation`-type entries commonly show
`element_power: 0` not because Concerto isn't generated there, but because —
per the maintainer — **Skill/Liberation casts carry their own EXPLICIT,
already-modeled Concerto contribution logically separate from the per-hit
`element_power` mechanism**, which is specifically the BASIC-ATTACK-STRING
per-hit accounting described next. The "~40% zero" rate is real but not
disqualifying once the mechanism is understood at the right granularity.

### The accounting rule (maintainer, reverse-engineered from manual testing)

`sk.damage`'s raw keys are not one-per-row — a row with an additive/multi-hit
mult string like `"20.8%+5.2%*6"` (Mornye's Basic Attack Stage 3) has ONE
raw entry per TERM of that string, keyed by a numeric ID whose structure
encodes (character id, row, term-within-row) — e.g. `120900301` /
`120900302` for the two terms above. **`element_power / 100` is the
Concerto gained per HIT of that specific term** — so a term written
`"X%*N"` contributes `N × (that entry's element_power / 100)`, exactly
mirroring how Resonance Energy is already accounted per-hit
(`rowEnergyFromMults`, P13-fix above). Worked example (Mornye BA3):
term 1 (`20.8%`, single hit, id …301, `element_power: 208`) → 2.08 Concerto;
term 2 (`5.2%*6`, six hits, id …302, `element_power: 52`) → 6 × 0.52 = 3.12
Concerto; total 5.20.

**This is exactly what the existing `rowEnergyFromMults`-based extraction
already computes** — it was built for Resonance Energy but reused verbatim
for `concertoGen`, and matches rate (not raw key) to correlate a mult-string
term with its `sk.damage` entry. Verified against three independent worked
examples after the fact (Mornye BA3: 5.20; Lucilla `basic_basic_attack_2`:
0.78+1.16=1.94; Lucilla `basic_dodge_counter`: 2.88+3.52=6.40) — the
compiled `concertoGen` matches the maintainer's hand-calculation exactly in
every case checked. **No code change was needed**; the confirmation
upgrades `concertoGen`'s status from "plausible hypothesis" to "verified
against ground truth," and the whole Concerto feature shipped 2026-07-02
(gauge, swap readiness, `enforceConcerto`) stands as originally implemented.

### Why the raw-key-ID row grouping was NOT adopted as the primary mechanism

The maintainer's insight also suggested a more precise alternative to
rate-based term matching: group `sk.damage` entries by the ID's structural
row-prefix (stripping the term-suffix) instead of by rate value, which would
be immune to the one remaining known gap — **when two DIFFERENT rows in the
same node happen to share a rate**, rate-based matching can misattribute an
entry to the wrong row (18 nodes roster-wide were found this way, ±0.12
worst-case on Resonance Energy; `docs/energy-signal-findings.md`'s earlier
correction section).

Investigated and NOT adopted as the primary extraction mechanism: the
row/term digit-width split is **not consistent across the roster** —
Mornye's IDs split as character-id(4) + row(3) + term(2), Sanhua's as
character-id(4) + row(3) + term(3), Baizhi's as character-id(4) + row(4) +
term(2). A fixed-width decomposition anchored on Mornye's pattern correctly
resolved 17 of the 18 known-ambiguous nodes where it successfully applied,
but failed to decompose roughly half the roster's nodes outright (wrong
assumed width), and a general "last 2 digits = term" fallback did WORSE
(nonsensical term sequences like `02, 12` within one row) than doing
nothing. Auto-detecting the width per node scored 14/18. None of the three
approaches tried reached full, reliable roster-wide coverage, and getting
the width wrong silently misattributes a term to the wrong row — a WORSE,
harder-to-detect failure mode than the current narrow, already-disclosed
rate-collision ambiguity. Per the project's root-cause discipline ("do not
guess"), the existing rate-based method — now independently verified
correct wherever rates don't collide — was kept as-is rather than replaced
with an unreliable generalization. The 18-node/±0.12 residual stands,
unchanged in scope, now known to affect `concertoGen` the same way it
affects `energyGen` (same mechanism, same narrow blast radius).

### Correction (2026-07-03) — the cross-row collision itself WAS fixable, without ID decomposition

The maintainer asked directly how the code disambiguates a shared rate given
neither of us trusts the ID structure — a sharper framing than "is this
residual acceptable," and tracing the actual code (not just its comments)
found a real, more precise bug than "±0.12 worst case" implied.

`rowEnergyFromMults`'s `taken` counter (which rate-entry index a row has
already consumed) was declared **inside** the function, so it reset on
every call. Since the function runs once per row, this correctly handles
multiple HITS within one row's own multi-hit term (walks the shared-rate
list forward: index 0, 1, 2…) — but when a rate is shared by TWO DIFFERENT
ROWS instead, each row's call starts back at index 0 independently. Neither
row ever "sees" the other's consumption — **every colliding row reads the
exact same first entry, and any entries beyond the first are never consumed
by anyone at all.** Confirmed concretely: Rover: Spectro's "Stage 2 DMG" and
"Heavy Attack - Resonance DMG" both read `"38.25%"` as their sole term, from
two distinct raw entries (energy 100/112, Concerto 400/360) — the old code
gave both rows `energyGen: 1.00`/`concertoGen: 4.00`, and the second entry
(112/360) was silently discarded entirely, not just misattributed.

**Fix**: moved `taken` out of the per-row function into per-NODE state,
shared across all of a node's rows, which are processed in the source
data's own `sk.level` key order. This makes consumption walk the shared-rate
entry list exactly once, top to bottom, in the same order a manual
reconciliation of the raw table would — matching the maintainer's own method,
without needing to decode the unreliable ID width. Energy and Concerto now
read from a single paired `hitEntriesByRate` structure (one list of
`{energy, concerto}` per rate) so both resources are guaranteed to attribute
to the same physical hit — they can no longer desync onto different entries.
Verified: Rover: Spectro now splits correctly (`basic_2`: 1.00/4.00,
`heavy_resonance`: 1.12/3.60, matching both raw entries exactly). Roster-wide
impact was narrow as expected — 8 skill entries across 8 characters (Encore,
Lupa, Denia, Rebecca, Cartethyia ×2, Rover: Spectro, Danjin, Rover: Havoc)
changed; the previously-confirmed worked examples (Sanhua, Mornye, Lucilla)
are unchanged since none of them involve cross-row collisions.
`tests/energy-per-hit.test.mjs` locks the Rover: Spectro case explicitly.

This does NOT fully close the residual — it resolves cross-row collisions
(17 of the 18 originally-flagged nodes), which is exactly the class of
ambiguity the fix targets. One irreducible case remains where the SAME row
has two entries at the same rate with different values (Cartethyia's "Sword
to Carve My Forms") — no consumption-order fix can disambiguate that; the
existing `Math.min(taken[rate], list.length - 1)` fallback (repeat the last
entry once exhausted) still applies there, same as before.

### The independently-found, independently-fixed bug along the way

While testing the negative-status hypothesis (ruled out above), the
maintainer caught a real, separate production bug in `statusesInflictedBy`
(`src/core/enemy-status.js`): its kit-text substring scan for a status name
couldn't distinguish "this resonator inflicts X" from "this resonator's
kit text merely NAMES X" (e.g. Rover: Aero's Resonance Skill "removes...
Havoc Bane... and inflicts 1 stack of Aero Erosion" false-matched all 5
named-but-removed statuses; Cartethyia's and Hiyuki's reactive team/ally
buffs — "after a Resonator in the team applies X" — false-matched the same
way). Fixed by element-gating: a status with a fixed required element
(`NEGATIVE_STATUS_DEFS[key].element`) can only be inflicted by a resonator
of that same element. Confirmed to remove exactly the 12 false positives
found, with zero collateral loss on genuine appliers. This bug was LIVE in
`team-sim.js`'s team-wide status gating (any user-built team containing
Rover: Aero or Cartethyia), independent of the element_power investigation
that surfaced it. `tests/enemy-status.test.mjs` carries the regression
coverage.

## P13-fix-3 (2026-07-03) — full-vector row↔entry matching; the ID structure, systematized

The maintainer pushed to crack the raw `sk.damage` key structure properly
("there has to be a method to the madness"), starting from their own manual
Mornye analysis (char-id `1209` + row `003` + term `01`/`02`). The
investigation used a tool manual reconciliation doesn't have: every entry
carries a FULL 20-level `rate_lv` vector, and every row's mult strings exist
at all levels — matching whole vectors gives near-unique ground truth, from
which the ID structure could be *learned* instead of guessed.

### What the ID structure actually is (and isn't)

- The row-code digits are a game-internal SEMANTIC slot numbering, not the
  `sk.level` display key: Mornye's Normal Attack codes run 001–004 (basic
  stages), 007–009 (Wide Field Observation stages), 014/015 (dodge
  counters), 024/025 (heavy/mid-air) — while her `sk.level` keys run 1–13 in
  a different order (heavy=key 8 comes BEFORE dodge=key 10, but AFTER it in
  code order). ID order ≠ display order.
- The digit split is NOT consistent across the roster: Mornye splits as
  char(4)+row(3)+term(2), Sanhua as char(4)+row(3)+term(3), Baizhi uses a
  block scheme (blocks 10/11/12 for basic/heavy/midair), Rover's file uses
  variant ids (1502 keys inside 1501's file), and ID string lengths vary
  9–11 digits even within one node. Term suffixes can skip values (Mornye
  WFO St3 has terms 01 and 03) and don't always start at 01 (her BA4's only
  entry is …402). **Absolute decoding is a dead end.**
- TWO properties hold universally and are all the extraction needs:
  (a) entries of the same row-term are ID-ADJACENT (numeric diff ≈ 1);
  (b) same-vector entries of DIFFERENT rows are far apart (diff ≥ 100).

### The new matcher (`matchRowHits` in preprocess.mjs, replacing the rate-keyed lookup)

Per node: each row's terms become ×100 value vectors over the row's usable
levels; entries match by whole-vector comparison (level-1 exact; later
levels tolerate display-rounding drift — Taoqi's "52.78%" is stored as raw
5277, drifting to ±3 by lv20). Same-vector candidates cluster by ID
adjacency; rows (in `sk.level` order) consume the lowest-ID non-shadow
cluster; if nothing unconsumed matches, a consumed entry is RE-read (display
rows can legitimately share one instance — Denia's basic vs mid-air
Breakdown rows). "2× shadow" hidden duplicates (double vector, unchanged
energy/ep — Aemeath) lose cluster tie-breaks, but only as a tie-break,
because a kit can also have a legitimate real 2× row (Augusta's 120%
Protector vs her 60% Sunborne — a hard exclusion got her wrong; the
tie-break version gets both right).

Validated against 10 hand-verified anchors (Sanhua, Mornye — including the
maintainer's own BA3 worked example — Lucilla, Rover: Spectro) plus a
roster-wide old-vs-new diff in which every difference was individually
explained before shipping:

- **Scalar rows phantom-matched under rate-keying** (a real latent bug in
  P13-fix-2's shared counter): "STA Cost 25", "Cooldown 16", "Concerto
  Regen 10" parse as rates 2500/1600/1000 and stole real entries, silently
  corrupting the consumption order for later rows (Lingyang/Augusta/
  Yangyang/Chixia/Yinlin/Yuanwu/Jinhsi/Sigrika/Zani/Chisa/Lucy). Constant
  scalar "vectors" can't match scaling rate_lv arrays, so this entire class
  is now structurally impossible.
- **Dataset-level effect: exactly 4 entries changed**, each hand-verified:
  Aemeath `forte_heavy_seraphic_duet_encore` 4.75→5.00 (shadow tie-break —
  matches the theoretical per-hit sum), Rebecca `basic_dodge_counter_huntress`
  1.13→1.52 and Rover: Havoc `forte_heavy_umbra_thwackblade_damage`
  2.24→5.24 (both recovered from cross-row starvation), Cartethyia
  `forte_heavy_sword_to_answer_waves_call` 3.77→2.33 (rows 28/29 both carry
  0.94% terms from different ID blocks — e18 vs e66 — that rate-order
  consumption interleaved).
- The "7-vs-6 entries" observation (Mornye's Resonance Skill): the two
  extra entries are the HEALING rows' scaling parts (energy/ep 0) — heal
  rows now consume their own entries so they can't collide with damage rows.
- ~500 entries roster-wide match no display row at all: hidden/empowered
  instances (Denia's `rate+120000` liberation-empowered twins, Carlotta's
  Era-of-New-Wave enhanced variants, Baizhi's `11030100503`). Deliberately
  left unmatched — they are not part of any display row's cast.

### Multi-hit representation styles (all handled by one rule)

The data represents a "*N" term three ways: 1 entry for all N hits (Mornye
BA3 "5.2%*6"), N entries of one hit each (Mornye Distributed Array "20%*4" →
4 IDs), or k<N entries (Zhezhi "10.34%*5" → 2 IDs). The rule "consume the
term's ID-cluster, repeat the last consumed entry for remaining hits" yields
the correct total in all three.

### Bonus: the `type` field, verified — weaker than it first looked

> **SUPERSEDED by P13-fix-5 (2026-07-04) — see below.** The "imperfect
> correlation" conclusion in this section was an artifact of the flawed
> *text* classifier it was being compared against, NOT of the `type` field.
> The maintainer's later roster-wide spot-checks confirmed the raw
> per-instance `type` tag matches in-game damage type *perfectly* when read
> at the correct granularity (per damage instance via `matchRowHits`, not per
> row-name kind). `type` is now the single source of truth for `formulaType`.
> The two bullets below are retained for history but their negative verdicts
> are withdrawn.

The initial cross-tab (row-name kind × entry `type`) suggested `type` might
be clean per-hit "considered as X DMG" ground truth, a candidate replacement
for the kit-text heuristic. The maintainer asked for a real verification
pass rather than shipping that as a "future opportunity" — it does NOT hold
up as a reliable standalone signal:

- **Coordinated Attack** (the maintainer's other hypothesis — off-field
  damage): checked `type` on the actual coordinated-attack damage row for
  6 characters with this mechanic already modeled (`off-field.js`
  `offFieldActions`). Result: type 0 (Zhezhi, Cantarella), 2 (Mortefi,
  Verina), 4 (Yinlin, Yuanwu) — completely scattered, zero correlation.
  Ruled out.
- **Echo Skill DMG** (`type=5`): a real but IMPERFECT correlation, not the
  clean marker it first appeared to be. Rigorous row-level test (every row
  roster-wide, `isEchoSkill` computed independently from raw kit text,
  cross-tabbed against its own matched entries' `type`): 20 of 25 type-5
  rows are Echo-Skill rows (80%), but the SAME character's OWN kit splits
  across types for different hits — Galbrena's "Volley of Death" Stage 1/2
  are type 1 while Stage 3 is type 5, all equally Echo-Skill DMG per her
  kit text; Cantarella's Echo-Skill rows (Phantom Sting, Abysmal Vortex,
  Perception Drain) are 100% type 0, not 5 at all. Not reliable enough to
  wire in as an override signal.

**What WAS real and got fixed** (P13-fix-4, below): investigating the
concrete symptom that prompted this whole detour — the maintainer's own
in-game read that Aemeath deals mostly Resonance Liberation damage,
contradicting the compiled data — led to a real, separate, high-value bug
in the EXISTING kit-text-based classifier, not a `type`-field gap at all.

## P13-fix-4 (2026-07-03) — the "considered as X DMG" fallback path was HTML-blind

Root cause, found by directly running `parseDescConversions` against
Aemeath's real description text rather than hand-tracing it: her kit text
literally says *"considered `<color=Highlight>`Resonance Liberation
DMG`</color>`"* for Seraphic Duet: Overture/Encore — an in-scope, already-
tracked conversion phrase (`FORMULA_CONVERSION_MAP` has `resonance
liberation`) that should have applied. It didn't, because:

- The function's PRIMARY path (isolating the row's own section by matching
  its display name against a section header) failed here: the game's
  section header is `"Resonance Skill - Seraphic Duet: Overture"`, but the
  row's display name is just `"Seraphic Duet: Overture DMG"` — the header
  carries a category prefix the row name lacks, so none of the exact/
  prefix/substring rules matched.
- That's an accepted, designed gap — the function has a WHOLE-DESCRIPTION
  FALLBACK for exactly this case (accept a node-wide conversion when the
  entire description names exactly one type). But the fallback built its
  scan text as `nodeDesc.toLowerCase()` — the RAW description, HTML tags
  still in it. The game always wraps a reclassified type name in
  `<color=Highlight>...</color>`, so "considered `<color=Highlight>`X
  DMG`</color>`" can never match a regex expecting "considered X DMG" as
  contiguous text. The section-matched primary path was unaffected (it
  already scans HTML-stripped text via `parseDescSections`) — only the
  fallback was blind, and only rows that need the fallback were affected.

**Fix**: strip HTML/placeholders in the fallback the same way
`parseDescSections` already does for the primary path (one line).
**Verified roster-wide before shipping**: of 952 rows that rely on the
fallback path, 349 now find a type versus 311 before (38 newly-recovered
single-type conversions) and Echo-Skill detection rises from 11 to 35 rows
— landing exactly on Phrolova/Cantarella/Galbrena/Lucilla (the four the
maintainer named from memory, before this fix existed) plus Qiuyuan and
Sigrika (found independently here — their kit text also says "considered
Echo Skill DMG", just not recalled by name). **Zero regressions**: no row's
detected type CHANGED to a different single type, and no row gained a
second conflicting type (checked explicitly, not just spot-checked).
Aemeath's Seraphic Duet hits now correctly carry `formulaType: liberation`
— confirmed against `MEMORY.md` team-ER coverage: matches the maintainer's
own in-game observation that she deals mostly Liberation damage.

No impact on the currently-shipped P12 meta weights (verified: byte-
identical weights for all 6 covered characters after regen) — `isEchoSkill`
isn't consumed by any live sim code yet (grepped: appears only in
`preprocess.mjs` and the compiled dataset), so this fix is pure-forward
correctness, ready for whichever future feature reads it, plus the
immediate `formulaType`/stat-priority correctness gain for any newly-
covered character whose kit uses this "considered as X DMG" + prefixed-
header combination (Aemeath, and structurally any future character with
the same header-vs-row-name mismatch shape).

`tests/formula-conversion.test.mjs` locks the Aemeath case and the six
Echo-Skill recoveries, plus a roster-wide "every formulaType is a
recognized value" invariant.

## P13-fix-5 (2026-07-04) — `formulaType` is DATA-DRIVEN; the regex is retired

The maintainer, after the Galbrena correction, pushed the conclusion the
opposite way from the "weaker than it looked" section above: the raw
per-instance `type` tag is *100% reliable* and the text parser was the weak
link all along. Verification bore this out — the Galbrena "imperfect
correlation" example (BA Stage 1-3 type 1, Stage 4 type 5; Volley of Death
type 1) is not noise, it is the game's own **correct per-stage** typing: her
Basic Attack Stage 1-3 ARE Heavy Attack DMG, only Stage 4 is Echo Skill DMG,
and Volley of Death is Heavy Attack DMG. The previous section read that as a
failure only because it compared against a row-name-level heuristic that
can't see per-stage splits.

**What changed.** `matchRowHits` already maps each display row to its exact
`sk.damage` instances by full 20-level rate-vector (the same matcher that
extracts per-hit energy and Concerto). It now also returns those instances'
`type` tags, and a new `resolveInstanceFormula(hitTypes, baseFormula)` reads
the row's `formulaType` and `isEchoSkill` straight from them:

| raw `type` | meaning        | `formulaType` |
| ---------- | -------------- | ------------- |
| 0          | Basic Attack   | `basic`       |
| 1          | Heavy Attack   | `heavy`       |
| 2          | Res. Liberation| `liberation`  |
| 3          | Intro Skill    | `intro`       |
| 4          | Res. Skill     | `skill`       |
| 5          | Echo Skill DMG | *(unchanged)* — sets `isEchoSkill`, keeps mechanical `baseFormula` |

A uniform non-echo type wins; all-echo keeps the mechanical fallback with
`isEchoSkill` set; >1 distinct non-echo type on one row is ambiguous → keeps
the mechanical fallback (logged, 7 such rows roster-wide). Because each
display stage is its own `paramK` matching its own instances, per-stage
conversions (Galbrena) resolve with **no staged logic at all**.

**Dead code removed.** `parseDescConversions`, `parseDescSections`,
`detectStagedConversions`, `resolveStagedConversion`, `STAGE_TYPE_RE/NAME`,
`ECHO_SKILL_NAME_RE` — the entire "considered as X DMG" text machinery,
including P13-fix-4's HTML-strip fix and P13-fix-5's own earlier staged-regex
attempt — deleted. `type=5` (Echo) does NOT become a `formulaType`:
`dmgBonusBySkillType` (`src/core/stats.js`) has no Echo bucket and there is
no Echo skill-level table, so an echo hit keeps its mechanical bucket for
level/scaling and simply gets no type-specific DMG bonus
(`dmgBonusBySkillType?.[…] ?? 0`, null-safe). `isEchoSkill` stays a dormant
flag until a real Echo DMG Bonus stat exists.

**Results (roster-wide).**

- 256 data-driven reclassifications (instance type ≠ mechanical default).
- Aemeath's Seraphic Duet: Overture/Encore now `liberation` (the reported
  bug); mechanical `skillType` stays `forte_heavy`.
- Galbrena exactly matches in-game: BA Stage 1-3 `heavy`, Stage 4
  `isEchoSkill` (mechanical `basic`), Volley of Death `heavy`, and Volley
  Stage 1/2 **no longer** falsely `isEchoSkill` (the old regex's bug).
- Cantarella correctly **loses** her false `isEchoSkill`: she has **zero**
  type=5 damage instances in source — her "considered as casting Echo Skill"
  is a mechanical cast trigger, not Echo Skill DMG. The old regex conflated
  the two. Her Forte/skills correctly read as Basic Attack DMG, so the P12
  meta now correctly ranks Basic DMG Bonus for her.
- Canonical reclassifications preserved, now data-sourced: Carlotta
  Liberation → `skill`, Phoebe Skills → `basic`, Phrolova Scarlet Coda →
  `skill`.

**Cross-validation.** `isEchoSkill` presence was checked against an
*independent* raw-source scan of type=5 counts: every character with type=5
in source (Phrolova 30, Galbrena 31, Lucilla 7, Qiuyuan 12, Sigrika 35) has
≥1 compiled `isEchoSkill` row; every character without (Cantarella, Carlotta)
has none. 48/48 tests pass; module-load sweep clean; meta regenerated with
no non-finite or degenerate stat weights (252 weight objects checked).
`tests/formula-conversion.test.mjs` rewritten for the data-driven model.

## Correction (2026-07-23) — Hiyuki/Lucilla ARE energy-gated (the data doesn't lie)

The Dimbreath→Arikatsu source migration filled a data GAP that had been read as
a mechanical fact. Earlier sections (and the roster-wide sweeps above) treated
**Hiyuki and Lucilla as "not energy-gated" (`libCostKnown:false`)** — but that
was only true because Dimbreath supplied **no `baseStats` entry** for them, so
`energyMax` came back missing. Arikatsu supplies their real Resonance Energy bar
(**Hiyuki `energyMax` 125**, Lucilla 0). Maintainer guidance (2026-07-23):

> The extracted data doesn't lie — it just needs correct interpretation. Kits
> with a real energy bar should be populated with `energyMax` if the data says
> so. Hiyuki genuinely wants **~110–120% ER**, tailored around her in-state
> ("2nd") Liberation. The proper energy **sources and triggers** are also in the
> data, though sometimes hidden or requiring skill-description interpretation.

**What changed.** The model now reads `liberationCost` straight from
`baseStats.energyMax` (no curated override). Hiyuki: `libCostKnown:true`,
`liberationCost:125`; her curated team surfaces a **real** `erOverride` (~102.6%
floor, non-provisional) instead of the gating-forced provisional fallback. A
briefly-added `src/core/liberation-gate.js` that force-nulled these kits was
**removed** — it second-guessed authoritative data, exactly what the maintainer's
correction rules out. The `libCostKnown:false` path now means only a genuine data
gap (no shipped kit hits it post-Arikatsu); it stays covered by synthetic-entry
unit tests.

**Still open (unchanged by this).** Kit-accurate energy **income** for
multi-gauge states (Hiyuki's Frostheart/Dedication, "only the correct kit skills
generate energy") is the same multi-gauge modeling future work called out in
`CLAUDE.md`. It refines how fast the bar fills — and therefore how tight the ER
floor is — not *whether* the bar exists. The ~102.6% floor above under-counts her
in-state income and will rise toward the maintainer's ~110–120% as those sources
are attributed. The "kits that aren't energy-gated (Hiyuki, Lucilla)" phrasing in
the 2026-07-02 sections above is **superseded** by this note.
