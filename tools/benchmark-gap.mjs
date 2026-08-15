#!/usr/bin/env node
/**
 * DPS-gap harness — runs the sim against data/benchmark-reference.json.
 *
 * Why this exists: the same external benchmark had been compared by hand four
 * times and every gap figure it produced (2.60x / 2.09x / 1.80x) evaporated
 * because neither the inputs nor the method were written down. This file IS the
 * method. Run it, quote its output, and the number is reproducible.
 *
 *   node tools/benchmark-gap.mjs                  # default: the REFERENCE's own conditions
 *   node tools/benchmark-gap.mjs --json           # machine-readable
 *   node tools/benchmark-gap.mjs --variants       # every sensitivity axis below
 *   node tools/benchmark-gap.mjs --profile        # damage share by DMG-bonus bucket
 *
 * Departure flags, each independent and combinable: --app-target, --zero-res,
 * --role-mains, --null-echoes, --template-substats, --openers, --tune-modes,
 * --no-cancel-step.
 *
 * REPORTABLE TOOL, not a pass/fail test — the gap is large and a failing test
 * would just be noise. Ratchet it into tests/ once the gap is understood.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DECISIONS, all of them (the handover's §5/§6 ask that these be written down)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * D1. SLOT ORDER = Chisa → Denia → Aemeath. Derived, not assumed: pass 1 marks
 *     Chisa `intro:false` and the other two `intro:true`, and pass 2 marks all
 *     three `intro:true`. Only a cycle whose slot 0 is Chisa produces that.
 *     team-sim.js:685 (`isFirst = pass === 0 && memberIndex === 0`) then omits
 *     her pass-1 intro on its own — nothing here injects or suppresses one, which
 *     is what the handover §5 asks for.
 *
 * D2. INTRO / OUTRO STEPS ARE NOT IN THE ROTATION ARRAYS. team-sim.js:109
 *     (`AUTO_CAST_SKILL_TYPES`) strips them from a member's own rotation and
 *     relies solely on the auto-injected handoff segments. Listing them would be
 *     silently ignored, so they are omitted rather than written and dropped.
 *
 * D3. "Rending Lunge Basic Attack (Cancel)" (Chisa, pass 1) → the FULL stage,
 *     `basic_rending_lunge`. The engine has no cancel model. In game a cancel
 *     skips recovery frames AFTER the hit lands — the damage is why you cancel —
 *     so crediting the full stage keeps the damage honest and overstates only the
 *     time. Dropping the step instead would understate both. `--no-cancel-step`
 *     runs the other reading; the delta is printed under VARIANTS.
 *
 * D4. Chisa's "Hold Basic to hit Basic 1, 2, 3" (pass 1) and "Spam Basic 1, 2, 3"
 *     (passes 2–3) are ONE move set, per the handover §5 — input mechanics only.
 *     Both map to her Chainsaw-Mode basic chain
 *     `forte_heavy_sawring_blitz_1/2/3`, which is where the game files those
 *     stages (autoSkillMap 1508: "Forte Circuit: Sawring — Blitz Stage N").
 *
 * D5. PER-PASS ROTATIONS. `simulateTeamRotation` takes ONE rotation per build for
 *     every pass; only Chisa's pass 1 differs from her passes 2–3. So:
 *       RUN A (headline) — 3 passes, steady-state rotations (Chisa = pass 2/3).
 *       RUN B            — 1 pass, pass-1 rotations, vs. reference pass 1.
 *     The two are reported separately and never blended. Run A's pass-1 row is
 *     therefore compared against reference pass 1 with that caveat stated inline.
 *
 * D6. SUPERSEDED 2026-08-13 — the ruling is below; the original text is kept.
 *     ~~ECHO STATS = `templateStats(resonator, dataset, rolesOf(id))` from
 *     tools/optimize/reference-build.js:257 — the recommender's own fixed
 *     template, so the baseline cannot silently diverge (handover §6.2). NOTE:
 *     templateStats is role-aware and Chisa is HEALER-tagged (roles id 1,
 *     "Support and Healer"), so she gets a HEALING BONUS 4-cost main where the
 *     other two get Crit DMG. That depresses exactly the member the §4 anchor is
 *     about, so `--neutral-mains` re-runs with roles=[].~~
 *     RULING: "best applicable" mains for all three — `templateStats` with
 *     roles=[], i.e. Crit DMG on the 4-cost. The reference states it uses "the
 *     best applicable Cost-4, Cost-3, and Cost-1 Echo assumptions", and a
 *     Healing Bonus main is not that on a run being scored for DPS.
 *     `--role-mains` restores the recommender's role-aware default as a variant.
 *     The benchmark still PINS weapon and sonata: the sonata id is overridden
 *     onto all five slots and the weapon is set from the reference instead of
 *     `representativeWeaponId`.
 *
 * D7. SUPERSEDED 2026-08-13 — the ruling is below; the original text is kept.
 *     ~~TARGET = the app's TEAM PAGE target (team-editor-v2.js:204) — level 90,
 *     atkLv 90, 10% resistance on elements 1–6. The offline optimizer uses 0%
 *     (sim-eval.js:16); `--zero-res` runs that and the delta is printed.~~
 *     RULING: TARGET = the REFERENCE's own stated conditions — a LEVEL 100 boss
 *     at 20% RESISTANCE (TARGET_REFERENCE). Neither of the two the codebase
 *     already had was right, and they disagree with each other, which was itself
 *     the smell. Settled against ANCHOR 1, which is the cleanest probe available
 *     because computeTuneBreakDamage takes no ATK, no crit and no gear stat:
 *
 *       lv90,  10% res, + this team's DEF shred/ignore   81,727   1.304x
 *       lv100, 20% res, + this team's DEF shred/ignore   71,015   1.133x
 *       lv100, 20% res, UNBUFFED                         62,689   1.000x  (−0.001%)
 *                                            reference   62,689
 *
 *     The third line is an exact hit, so the target is settled AND a second fact
 *     falls out: the reference does not apply the team's DEF reduction to the
 *     tune bar while the sim does (Chisa's Thread of Bane 18% + 3 Havoc Bane
 *     stacks 6%, folded in at team-sim.js:846-847). That is now the whole of
 *     ANCHOR 1's residual and it is an ATTRIBUTION question, not a target one.
 *     `--app-target` and `--zero-res` keep both old readings runnable.
 *     Direction matters here and is easy to get backwards: the reference enemy
 *     is HARDER than either old default, so settling this honestly WIDENS the
 *     gap. The prior handover's §2 composed toward 0% res and reported ≈1.18x.
 *
 * D8. deriveOpeners = false (the engine default, and the team page's default) so
 *     the headline number describes the rotation AS WRITTEN. `--openers` runs it
 *     ON. timingMode = 'toa', the team page default.
 *
 * D9. RESONANCE MODE = `fusion_burst` for BOTH Aemeath and Denia (Chisa has no
 *     modes). SETTLED by maintainer ruling 2026-08-10, not inferred: this
 *     composition is Fusion-Burst-synergy, because Chisa raises negative-status
 *     max stack counts (STATUS_CAP_RAISES[1508], +3/15s off her Outro) and
 *     brings no Tune-Break buffs at all. A Tune-Break Aemeath team is a
 *     different roster entirely — Mornye / Lynae / Aemeath. This also matches
 *     the curated reference-rotations.json modes, which the prose rotations
 *     track nearly step for step. `--tune-modes` remains only to show the
 *     refuted alternative: it costs 24-30% and is NOT a candidate reading.
 *
 * D10. DENOMINATOR = SUM OF PER-MEMBER ON-FIELD **GAME** TIMES (handover §3).
 *     Two corrections stack here and the first one is easy to get wrong:
 *       (a) "sum of per-member on-field times" equals wall-clock by construction
 *           in this engine — the cursor advances only by intro + rotation time
 *           and the outro runs in parallel (team-sim.js:1117). So §3's method
 *           note distinguishes nothing here; both are printed and checked equal.
 *       (b) under timingMode 'toa' the engine's OWN DPS denominator is
 *           `gameTime = totalTime − totalFreeze` (team-sim.js:359-360), not
 *           wall-clock: a frozen Liberation/Tune-Break animation stops the
 *           combat clock. That is the denominator community DPS figures are
 *           measured against, so it is the one this harness reports. Dividing
 *           by wall-clock instead inflates the time gap ~1.8x and is a pure
 *           harness bug — it is what made an early draft of this file report a
 *           3.09x DPS gap against a 1.8x damage gap.
 *     Per-member gameTime = that member's accumulated time minus the freeze on
 *     their own steps, mirroring deriveGameTimes (sim.js:424).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO LANES THAT SCORE ZERO HERE — measured, not assumed. Both are input
 * limitations of this harness that also look like engine gaps; neither is the
 * gap, and both should be settled before anyone ratchets this into a test.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Z1. RESOLVED 2026-08-13 — was "every `__echo__` step deals 0 damage in 0 time".
 *     templateStats set echo `id: null` on purpose (reference-build.js:424 —
 *     "stats don't depend on echo id"), which is true of the MAIN/SUB stats and
 *     false of two other things: the echo CAST (sim.js needs a real id to
 *     resolve one) and the echo's own BASE stats. RULING: real echo ids are now
 *     the DEFAULT (pickEchoId, the same helper the app's suggestion flow uses) —
 *     the reference states it runs real Cost-4 / Cost-3 / Cost-1 echoes, so a
 *     null id is a harness artefact and not a reading of the reference.
 *     `--null-echoes` keeps the old behaviour runnable.
 *
 *     The SUBSTATS moved with it, and that is the larger half. The benchmark no
 *     longer uses templateStats' 25-roll package at all; it spends the
 *     reference's OWN budget (see SUB_* / referenceSubstats below), so both
 *     sides now buy the same gear and a residual gap is the ENGINE. The old
 *     package remains as `--template-substats`.
 *
 * Z2. WITHDRAWN 2026-08-13 — this was never a defect, and the claim as written
 *     was TRUE but the conclusion drawn from it was wrong.
 *     ~~ALL NINE OUTRO SEGMENTS DEAL 0 DAMAGE. Verified directly: none of 1508 /
 *     1211 / 1210 has ANY `skillType === 'outro'` key in `effectiveSkillMap`, so
 *     `simulateOutro` finds nothing to cast. Note this sits against the CLAUDE.md
 *     invariant "An Outro Skill has NO level curve … the multiplier is read from
 *     the sentence that STATES it" — whatever that pass fixed, it did not reach
 *     these three.~~
 *     It is true that none of the three has an outro damage key. It is NOT true
 *     that anything is broken: all three Outro Skills are buff-only in the
 *     GAME's own text — Chisa's "Unraveling - Law Zero" raises negative-status
 *     max stacks, Denia's "Unfinished Lies" and Aemeath's "Silent Protection"
 *     hand mode-gated amplification to the incoming resonator. None contains a
 *     damage clause, so `OUTRO_DMG_RE` (tools/preprocess/resonators.mjs:903-905)
 *     correctly matches nothing and `effectiveSkillMap` filters nothing. A zero
 *     here is the right answer. Roster-wide, 13 of 56 resonators have an outro
 *     damage key and 2 more model it as an off-field `turret`; the remaining 41
 *     are buff/heal transfers, which is ordinary WuWa outro design.
 *     `simulateOutro`'s off-field-trigger refusal (team-sim.js:1423) is also not
 *     in play — all three have no `offFieldActions` at all.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { createBuild, setChain, setEcho, setWeapon, pickEchoId } from '../src/core/build.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { ECHO_STEP_KEY, TUNE_BREAK_STEP_KEY, effectiveSkillMap } from '../src/core/sim.js';
import { computeTuneBreakDamage } from '../src/core/enemy-status.js';
import { analyzeRotation } from '../src/core/rotation-graph.js';
import {
    rulesForResonator, stageGrantsForResonator, swapInEntryForResonator,
    resourceDefsForResonator, stateDefsForResonator,
} from '../src/core/rotation-rules.js';
import { templateStats, scalingStatFor } from '../tools/optimize/reference-build.js';
import { rolesOf } from '../tools/optimize/synergy-hints.js';
import { PROP } from '../src/core/stats.js';
import { applyPatch } from '../src/data/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(resolve(__dirname, '..', rel), 'utf8'));

// patch.json is a RUNTIME overlay that preprocess never bakes in (loader.js
// applyPatch). Reading wuwa-data.json alone gives a dataset the browser app
// never actually uses — Denia's Erosion Field would be missing here while the
// app has it, so the harness would be measuring a different sim than ships.
const loadDataset = () => applyPatch(readJson('data/wuwa-data.json'), readJson('data/patch.json'));

// ─────────────────────────────────────────────────────────────────────────────
// Rotation translation (handover §5). Keys verified against
// dataset.autoSkillMap; the prose token each one answers is on the same line.
// ─────────────────────────────────────────────────────────────────────────────

const CHISA = 1508, DENIA = 1211, AEMEATH = 1210;

// Chisa, pass 1: "Skill, Rending Lunge Basic Attack (Cancel), Echo, Liberation,
//   Basic Attack 2, Rending Lunge (Basic Attack 3), Death Snip (Basic Attack 4),
//   Forte Skill, Hold Basic to hit Basic 1, 2, 3, Outro"
const CHISA_PASS1 = [
    'skill_eye_of_unraveling',          // Skill         — see CHISA SKILL note
    'basic_rending_lunge',              // Rending Lunge Basic Attack (Cancel) — D3
    ECHO_STEP_KEY,                      // Echo
    'liberation',                       // Liberation
    'basic_2',                          // Basic Attack 2
    'basic_rending_lunge',              // Rending Lunge (Basic Attack 3)
    'basic_death_snip',                 // Death Snip (Basic Attack 4)
    'skill_serrated_loop',              // Forte Skill   — see CHISA SKILL note
    'forte_heavy_sawring_blitz_1',      // Hold Basic → Basic 1  (Chainsaw Mode, D4)
    'forte_heavy_sawring_blitz_2',      // Hold Basic → Basic 2
    'forte_heavy_sawring_blitz_3',      // Hold Basic → Basic 3
];                                      // Outro — auto-injected (D2)

// Chisa, passes 2–3: "Intro, Basic 2, Rending Lunge (Basic Attack 3), Death Snip
//   (Basic Attack 4), Echo, Liberation, Spam Basic 1, 2, 3, Outro"
const CHISA_STEADY = [
    // Intro — auto-injected (D2)
    'basic_2',                          // Basic 2
    'basic_rending_lunge',              // Rending Lunge (Basic Attack 3)
    'basic_death_snip',                 // Death Snip (Basic Attack 4)
    ECHO_STEP_KEY,                      // Echo
    'liberation',                       // Liberation
    'forte_heavy_sawring_blitz_1',      // Spam Basic 1  (Chainsaw Mode, D4)
    'forte_heavy_sawring_blitz_2',      // Spam Basic 2
    'forte_heavy_sawring_blitz_3',      // Spam Basic 3
];                                      // Outro — auto-injected (D2)

// Denia, all three passes: "Intro, Basic 4, Skill, Liberation, Basic 1, 2, 3, 4,
//   Skill 1, Skill 2, Liberation, Echo, Outro"
// Step-for-step the curated reference rotation (data/reference-rotations.json
// 1211), except the curated one spends two of the four Breakdown basics as
// mid-airs; the prose says four basics, so four basics is what this uses.
const DENIA_ROTATION = [
    // Intro — auto-injected (D2)
    'basic_stagecraft_form_4',                  // Basic 4
    'skill_phantom_bubble_stagecraft_form',     // Skill
    'liberation_final_act_stagecraft_form',     // Liberation
    'basic_breakdown_form_1',                   // Basic 1
    'basic_breakdown_form_2',                   // Basic 2
    'basic_breakdown_form_3',                   // Basic 3
    'basic_breakdown_form_4',                   // Basic 4
    'skill_banish_breakdown_form_1',            // Skill 1
    'skill_banish_breakdown_form_2',            // Skill 2
    'liberation_final_act_breakdown_form',      // Liberation
    ECHO_STEP_KEY,                              // Echo
];                                              // Outro — auto-injected (D2)

// Aemeath, all three passes: "Intro, Basic 3, 4, Liberation, Echo, Basic 2, 3, 4,
//   Tune Break, Forte Skill, Basic 2, 3, 4, Forte Skill, Heavy Attack,
//   Liberation, Outro"
// The two "Basic" runs before the first Forte Skill are her MECH-form basics —
// the game files those under her Resonance Skill node but NAMES them
// "Basic Attack: Mech Stage N" (autoSkillMap 1210), which is what the prose is
// reading. The run after it is the Aemeath-form chain, exactly as the curated
// rotation orders them.
const AEMEATH_ROTATION = [
    // Intro — auto-injected (D2)
    'skill_mech_3',                             // Basic 3
    'skill_mech_4',                             // Basic 4
    'liberation_heavenfall_edict_overdrive',    // Liberation
    ECHO_STEP_KEY,                              // Echo
    'skill_mech_2',                             // Basic 2
    'skill_mech_3',                             // Basic 3
    'skill_mech_4',                             // Basic 4
    TUNE_BREAK_STEP_KEY,                        // Tune Break
    'forte_heavy_seraphic_duet_encore',         // Forte Skill
    'basic_aemeath_2',                          // Basic 2
    'basic_aemeath_3',                          // Basic 3
    'basic_aemeath_4',                          // Basic 4
    'forte_heavy_seraphic_duet_overture',       // Forte Skill
    'heavy_mech_charged_ii',                    // Heavy Attack
    'liberation_heavenfall_edict_finale',       // Liberation
];                                              // Outro — auto-injected (D2)

// CHISA SKILL note (pass 1 only): her kit has no node the game calls "Forte
// Skill", so the pass-1 prose's "Skill" ... "Forte Skill" pair has to be
// assigned between `skill_eye_of_unraveling` and `skill_serrated_loop`. It is
// settled MECHANICALLY, not by name:
//   - The opening "Skill" is Eye of Unraveling. Its own desc reads "While not in
//     [Chainsaw Mode], after casting this skill, [Normal Attack] ... to cast
//     [Rending Lunge]" — which is verbatim the next prose step. Serrated Loop
//     cannot open: it replaces Eye of Unraveling only once Ring of Chainsaw has
//     charge, and the gauge is empty at fight start.
//   - The later "Forte Skill" is Serrated Loop, the only cast that ENTERS
//     Chainsaw Mode ("Casting this skill sends Chisa into [Chainsaw Mode]"),
//     which the Sawring — Blitz stages that follow it require. The curated
//     rotation (data/reference-rotations.json 1508) places it in exactly that
//     slot, immediately before the blitz chain.
// An earlier draft of this file had the two swapped; that ordering put the blitz
// chain after a cast that never enters Chainsaw Mode. Pass 1 only — it cannot
// move Run A.

const MEMBERS = [
    { id: CHISA,   name: 'Chisa',   weaponId: 21010056, sonataId: 7,  mode: null },
    { id: DENIA,   name: 'Denia',   weaponId: 21050076, sonataId: 28, mode: 'fusion_burst' },
    { id: AEMEATH, name: 'Aemeath', weaponId: 21020076, sonataId: 27, mode: 'fusion_burst' },
];
const TUNE_MODES = { [DENIA]: 'tune_strain', [AEMEATH]: 'tune_rupture' };

// core/target.js — the ONE target the app now sims against, team page and
// offline optimizer alike. Until 2026-08-15 these were two different enemies
// (the optimizer scored at 0% RES), which is why the build page's suggested-team
// card and the team page it opens could never agree.
const TARGET_APP = { level: 90, atkLv: 90, resistances: { 0: 0, 1: 0.1, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 } };
// The retired optimizer target, kept as a reachable comparison point.
const TARGET_ZERO_RES = { level: 90, atkLv: 90, resistances: {} };
// D7 RULING (2026-08-13) — the reference's OWN stated conditions, and now the
// benchmark default. See the D7 block in the header for the derivation; ANCHOR 1
// reproduces the reference's Tune Break on this target to −0.001%.
// Element 0 (physical / no element) is not dealt by any of the three members, so
// its value is inert here; it carries the same 20% for consistency rather than
// TARGET_APP's 0%.
const TARGET_REFERENCE = { level: 100, atkLv: 90, resistances: { 0: 0.2, 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2, 6: 0.2 } };

// ─────────────────────────────────────────────────────────────────────────────
// Build construction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The REFERENCE's own stat budget, verbatim from its "Equal testing conditions"
 * (D6/Z1 ruling 2026-08-13):
 *
 *   "Three Echoes each receive 8.1% Crit Rate, 16.2% Crit DMG, 8.6% in the
 *    relevant scaling stat, and 8.6% in the relevant damage bonus. The other two
 *    Echoes each receive 8.1% Crit Rate and 16.2% Crit DMG."
 *
 * That is 16 substats, not the 25 a real fully-rolled build carries. The missing
 * nine are left EMPTY on purpose: the reference models only the rolls it counts,
 * and filling the rest would be this harness inventing stats the reference never
 * granted — which is exactly the class of silent assumption the old template
 * package was. Both sides now spend the same budget, so a residual gap is the
 * ENGINE rather than the gear.
 */
const SUB_CRIT_RATE = 8.1, SUB_CRIT_DMG = 16.2, SUB_SCALING = 8.6, SUB_DMG_BONUS = 8.6;

// "the relevant damage bonus" — the four skill-type DMG-bonus substats are the
// only damage-bonus rolls the game HAS (dataset.echoSubStats: 14 Skill, 17
// Basic, 18 Heavy, 19 Liberation; element DMG bonus is a MAIN-stat-only option).
// So "relevant" has to name one of them, and the honest way to pick is to read
// which bucket the member's damage actually lands in rather than to guess from
// the kit. Derived with `--profile --template-substats` (measured 2026-08-13),
// which prints the same table this is read from — share of that member's own
// skill damage by formulaType:
//   Chisa    liberation 89.5% · basic  8.6% · intro 2.0%
//   Denia    liberation 72.8% · basic 13.5% · skill 11.9% · intro 1.8%
//   Aemeath  liberation 83.4% · basic 10.5% · skill  4.7% · intro 1.4%
// All three land on Liberation, and NOT because all three are Liberation
// spammers — it is the data-driven `formulaType` tag doing its job. Chisa casts
// mostly Basics and Forte Heavies, but her Death Snip and all three Sawring —
// Blitz stages carry formulaType 'liberation', and Aemeath's charged Heavies do
// the same ("considered Resonance Liberation DMG"). Reading the CAST type here
// instead would have put two of the three in the wrong bucket — which is the
// CLAUDE.md invariant "DMG bonus matches FORMULA type" restated as a measurement.
const RELEVANT_DMG_BONUS = { [CHISA]: PROP.DMG_LIBERATION, [DENIA]: PROP.DMG_LIBERATION, [AEMEATH]: PROP.DMG_LIBERATION };

/**
 * The reference budget as engine substat descriptors, 4 on echoes 0–2 and 2 on
 * echoes 3–4. `name` is resolved against dataset.echoSubStats for the same
 * reason templateStats does it (reference-build.js:294 — an unnamed substat
 * crashes the build editor's chips).
 */
function referenceSubstats(dataset, member, echoIndex, scalingRatioProp) {
    const nameFor = (propId, addType) =>
        (dataset.echoSubStats ?? []).find(stat => stat.propId === propId && stat.addType === addType)?.name ?? null;
    const sub = (propId, addType, value) => ({ propId, addType, value, isPercent: true, name: nameFor(propId, addType) });
    const always = [
        sub(PROP.CRIT_RATE, 1, SUB_CRIT_RATE),
        sub(PROP.CRIT_DMG, 1, SUB_CRIT_DMG),
    ];
    if (echoIndex > 2) return always;
    return [
        ...always,
        sub(scalingRatioProp, 2, SUB_SCALING),
        sub(RELEVANT_DMG_BONUS[member.id], 1, SUB_DMG_BONUS),
    ];
}

function memberBuild(dataset, member, rotation, options) {
    const resonator = dataset.resonators.find(entry => entry.id === member.id);
    if (!resonator) throw new Error(`resonator ${member.id} not in dataset`);

    // D6 RULING: "best applicable" mains, i.e. templateStats with NO roles —
    // Crit DMG 4-cost for all three, not a Healing Bonus 4-cost for the
    // healer-tagged member. `--role-mains` restores the recommender's default.
    const roles = options.roleMains ? rolesOf(member.id) : [];
    const template = templateStats(resonator, dataset, roles);
    const scalingRatioProp = scalingStatFor(resonator, dataset, roles) === 'hp' ? PROP.HP_RATIO
        : scalingStatFor(resonator, dataset, roles) === 'def' ? PROP.DEF_RATIO
        : PROP.ATK_RATIO;

    let build = setChain(createBuild(resonator), 0);           // S0 on both sides
    build = setWeapon(build, member.weaponId);                 // R1 L90 by createBuild/setWeapon defaults
    // Z1 RULING: real echo ids by DEFAULT. A null id costs BOTH the Echo cast and
    // the echo's own base stats, and the reference states it runs real Cost-4 /
    // Cost-3 / Cost-1 echoes. `--null-echoes` restores the old template default.
    const usedEchoIds = new Set();
    template.forEach((echo, i) => {
        let echoId = null;
        if (!options.nullEchoes) {
            echoId = pickEchoId(dataset, member.sonataId, echo.cost, resonator.element, usedEchoIds);
            if (echoId != null) usedEchoIds.add(echoId);
        }
        build = setEcho(build, i, {
            id: echoId, cost: echo.cost, level: 25,
            mainStat: echo.mainStat,
            // The reference's own budget, not the recommender's 25-roll package.
            subStats: options.templateSubstats ? echo.subStats
                : referenceSubstats(dataset, member, i, scalingRatioProp),
            sonataId: member.sonataId,                         // pinned by the reference
        });
    });
    const mode = options.tuneModes ? (TUNE_MODES[member.id] ?? member.mode) : member.mode;
    return {
        ...build,
        id: member.id,                                          // slots address builds by id
        level: 90,
        resonanceMode: mode,
        rotation: rotation.slice(),
        rotationMeta: rotation.map(() => ({})),
    };
}

// The intro team-sim will actually auto-inject for this member: the FIRST
// intro-typed key in the skill map (team-sim.js:1323 introKeyFor). Prepended
// before validation because a stage grant hanging off the intro (Chisa's
// basic_2, Denia's Stagecraft Stage 4) is otherwise reported as a false
// sequence break — the cast happens, it just is not in the authored array.
function autoIntroKey(dataset, resonatorId) {
    const skillMap = effectiveSkillMap(dataset, resonatorId) ?? {};
    return Object.entries(skillMap)
        .find(([key, def]) => !key.startsWith('_') && def?.skillType === 'intro')?.[0] ?? null;
}

// Grant-aware validation, same call shape the build editor and the P12 anchor
// gate use — so a translation that is illegal in the UI is illegal here too.
function rotationWarnings(dataset, resonatorId, authored) {
    const introKey = autoIntroKey(dataset, resonatorId);
    const rotation = introKey ? [introKey, ...authored] : authored.slice();
    return analyzeRotation(rotation, {
        rules: rulesForResonator(resonatorId),
        skillMap: effectiveSkillMap(dataset, resonatorId),
        grants: stageGrantsForResonator(resonatorId),
        swapInEntry: swapInEntryForResonator(resonatorId),
        resourceDefs: resourceDefsForResonator(resonatorId, dataset),
        stateDefs: stateDefsForResonator(resonatorId),
    }).warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runs
// ─────────────────────────────────────────────────────────────────────────────

function runTeam(dataset, rotationsById, passCount, options) {
    const builds = new Map(MEMBERS.map(member =>
        [member.id, memberBuild(dataset, member, rotationsById[member.id], options)]));
    const team = { slots: MEMBERS.map(member => member.id) };             // D1: Chisa, Denia, Aemeath
    const result = simulateTeamRotation({
        team,
        resolveBuild: (id) => builds.get(id) ?? null,
        dataset,
        target: options.target,
        passCount,
        deriveOpeners: options.openers,
        timingMode: 'toa',
    });
    return { result, builds };
}

/**
 * Share of each member's own SKILL damage by DMG-bonus bucket (`formulaType` —
 * the field `dmgBonusBySkillType` keys on, per the CLAUDE.md invariant). This is
 * the derivation behind RELEVANT_DMG_BONUS, kept in the harness so the constant
 * can be re-checked instead of trusted.
 *
 * Only the on-field skill lane is counted: the negative-status and Tune Break
 * lanes take no DMG-bonus bucket at all (enemy-status.js), so folding them in
 * would dilute the very share this picks on.
 *
 * Run it with `--template-substats` for a derivation that cannot be circular —
 * that package carries no damage-bonus roll, so no bucket is boosted by the very
 * constant being derived. The margins are not close enough for it to matter, but
 * the clean reading is the one quoted.
 */
function damageByBucket(dataset, result) {
    const byMember = new Map();
    for (const segment of result.segments) {
        const skillMap = effectiveSkillMap(dataset, segment.resonatorId) ?? {};
        const totals = byMember.get(segment.resonatorName) ?? new Map();
        for (const step of segment.steps ?? []) {
            const bucket = skillMap[step.skillKey]?.formulaType;
            if (!bucket || !(step.stepDamage > 0)) continue;
            totals.set(bucket, (totals.get(bucket) ?? 0) + step.stepDamage);
        }
        byMember.set(segment.resonatorName, totals);
    }
    return byMember;
}

function sayProfile(dataset, options) {
    const steady = { [CHISA]: CHISA_STEADY, [DENIA]: DENIA_ROTATION, [AEMEATH]: AEMEATH_ROTATION };
    const { result } = runTeam(dataset, steady, 3, options);
    console.log('DAMAGE-BONUS BUCKET PROFILE (skill lane only, share of the member\'s own skill damage)');
    console.log('  the derivation behind RELEVANT_DMG_BONUS — "the relevant damage bonus"');
    console.log();
    for (const [name, totals] of damageByBucket(dataset, result)) {
        const sum = [...totals.values()].reduce((acc, value) => acc + value, 0);
        const parts = [...totals.entries()]
            .sort(([, left], [, right]) => right - left)
            .map(([bucket, value]) => `${bucket} ${(100 * value / sum).toFixed(1)}%`);
        console.log(`  ${name.padEnd(8)} ${parts.join(' · ')}`);
    }
    console.log();
}

/**
 * Per-pass, per-member damage by MARGINAL DIFFERENCE: run the team at 1, 2 and 3
 * passes and subtract. Pass N's figure is (N-pass total − (N−1)-pass total).
 *
 * Why not just read the segments, which carry a `pass` tag: the negative-status
 * and kit-affliction lanes are resolved ONCE against the FINISHED timeline after
 * the pass loop (team-sim.js §2b) and credited straight to `memberAcc`, so they
 * appear in no segment and carry no pass. Reading segments alone silently drops
 * them — 755,076 of Aemeath's 2,709,010 and 115,809 of Denia's 639,174 — which
 * overstates the per-pass gap for exactly the two members who have one. The
 * marginals sum to `memberTotals` by construction, which the caller asserts.
 */
function perPassBreakdown(dataset, rotationsById, options) {
    const cumulative = [1, 2, 3].map(passCount => {
        const { result } = runTeam(dataset, rotationsById, passCount, options);
        const freeze = freezeByMember(result);
        const damage = new Map(result.memberTotals.map(entry => [entry.resonatorId, entry.damage]));
        const time = new Map(result.memberTotals.map(entry =>
            [entry.resonatorId, entry.time - (freeze.get(entry.resonatorId) ?? 0)]));
        return { damage, time };
    });
    const byPass = new Map();
    for (let pass = 0; pass < 3; pass++) {
        const now = cumulative[pass], before = pass > 0 ? cumulative[pass - 1] : null;
        const damage = new Map(), time = new Map();
        for (const [id, value] of now.damage) damage.set(id, value - (before?.damage.get(id) ?? 0));
        for (const [id, value] of now.time) time.set(id, value - (before?.time.get(id) ?? 0));
        byPass.set(pass, { damage, time });
    }
    return byPass;
}

/**
 * Freeze consumed by each member's OWN steps — the term that turns wall-clock
 * into the 'toa' DPS denominator (D10b). Mirrors deriveGameTimes (sim.js:424),
 * which sums step.freezeTime raw over a member's steps.
 */
function freezeByMember(result) {
    const freeze = new Map();
    for (const segment of result.segments) {
        for (const step of segment.steps ?? []) {
            freeze.set(segment.resonatorId,
                (freeze.get(segment.resonatorId) ?? 0) + (step.freezeTime ?? 0));
        }
    }
    return freeze;
}

function tuneBreakDamage(result) {
    const hits = [];
    for (const segment of result.segments) {
        for (const step of segment.steps ?? []) {
            if (step.skillKey === TUNE_BREAK_STEP_KEY) {
                hits.push({ pass: segment.pass, member: segment.resonatorName, damage: step.stepDamage });
            }
        }
    }
    return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

const num = (value) => Math.round(value).toLocaleString('en-US');
const ratio = (sim, reference) => (reference > 0 && sim > 0) ? (reference / sim) : NaN;
const fmtRatio = (value) => Number.isFinite(value) ? `${value.toFixed(3)}x` : '   —  ';

// Section: does each translated rotation survive the same grant-aware gate the
// build editor applies? Warnings are advisory — the sim never reads stage grants
// — so this reports rather than blocks, but a break here means the translation
// describes a sequence the UI would flag.
function sayValidation(say, dataset) {
    say('ROTATION VALIDATION (analyzeRotation — same gate as the build editor)');
    const rotationSets = [
        ['pass 1',        { [CHISA]: CHISA_PASS1,  [DENIA]: DENIA_ROTATION, [AEMEATH]: AEMEATH_ROTATION }],
        ['steady (2–3)',  { [CHISA]: CHISA_STEADY, [DENIA]: DENIA_ROTATION, [AEMEATH]: AEMEATH_ROTATION }],
    ];
    for (const [label, set] of rotationSets) {
        for (const member of MEMBERS) {
            const warnings = rotationWarnings(dataset, member.id, set[member.id]);
            say(`  ${label.padEnd(14)} ${member.name.padEnd(8)} ${warnings.length === 0
                ? 'clean'
                : warnings.map(warning => `${warning.skillKey} [${warning.gate}]`).join(', ')}`);
        }
    }
    say();
}

// Section: the per-pass table, from segments only (see the caveat it prints).
function sayPerPass(say, dataset, benchmark, options, referenceByName) {
    const byPass = perPassBreakdown(dataset, {
        [CHISA]: CHISA_STEADY, [DENIA]: DENIA_ROTATION, [AEMEATH]: AEMEATH_ROTATION,
    }, options);
    say('RUN A — 3 passes, steady-state rotations (Chisa = her pass-2/3 rotation)');
    say('  Reference pass 1 used a slightly different Chisa rotation (174,451 vs 209,879');
    say('  = 0.5% of the 3-pass total). Run B below sims that pass on its own.');
    say('  Per-pass figures are MARGINALS (N-pass total − (N−1)-pass total), so the');
    say('  post-hoc negative-status lane is attributed rather than dropped. They sum');
    say('  to the TOTALS block below exactly.');
    say();
    say('  pass  member    sim damage   reference     gap (ref/sim)  game s   ref s');
    say('  ' + '-'.repeat(72));
    for (const pass of [0, 1, 2]) {
        const entry = byPass.get(pass);
        const referencePass = benchmark.passes[pass];
        for (const referenceMember of referencePass.members) {
            const id = referenceByName.get(referenceMember.name);
            const simDamage = entry?.damage.get(id) ?? 0;
            const simTime = entry?.time.get(id) ?? 0;
            say(`   ${pass + 1}    ${referenceMember.name.padEnd(8)} ${num(simDamage).padStart(11)}  ${num(referenceMember.damage).padStart(11)}   ${fmtRatio(ratio(simDamage, referenceMember.damage)).padStart(10)}   ${simTime.toFixed(2).padStart(5)}  ${referenceMember.seconds.toFixed(2).padStart(5)}`);
        }
        const passSim = [...(entry?.damage.values() ?? [])].reduce((sum, value) => sum + value, 0);
        const passTime = [...(entry?.time.values() ?? [])].reduce((sum, value) => sum + value, 0);
        say(`   ${pass + 1}    ${'TEAM'.padEnd(8)} ${num(passSim).padStart(11)}  ${num(referencePass.totalDamage).padStart(11)}   ${fmtRatio(ratio(passSim, referencePass.totalDamage)).padStart(10)}   ${passTime.toFixed(2).padStart(5)}  ${referencePass.seconds.toFixed(2).padStart(5)}`);
        say('  ' + '-'.repeat(72));
    }
}

// Section: the complete per-member totals, the denominator, and the team DPS.
// Returns the figures the anchors and the JSON payload need.
function sayTotals(say, benchmark, runA) {
    const referenceTotals = benchmark.totals;
    say();
    say('  RUN A TOTALS (memberTotals — every lane: skill, off-field, negative status,');
    say('  kit affliction. The per-pass marginals above sum to exactly these figures.)');
    say();
    say('  member     sim damage   reference     gap (ref/sim)   status lane   game s   ref s');
    say('  ' + '-'.repeat(86));
    const freeze = freezeByMember(runA.result);
    const referenceSeconds = (name) => benchmark.passes
        .reduce((sum, pass) => sum + pass.members.find(entry => entry.name === name).seconds, 0);
    let simTotal = 0, simGameTime = 0, simWall = 0;
    for (const member of MEMBERS) {
        const accumulator = runA.result.memberTotals.find(entry => entry.resonatorId === member.id);
        const simDamage = accumulator?.damage ?? 0;
        const referenceDamage = referenceTotals.byMember[member.name];
        const gameTime = (accumulator?.time ?? 0) - (freeze.get(member.id) ?? 0);
        simTotal += simDamage;
        simWall += accumulator?.time ?? 0;
        simGameTime += gameTime;
        say(`  ${member.name.padEnd(9)} ${num(simDamage).padStart(11)}  ${num(referenceDamage).padStart(11)}   ${fmtRatio(ratio(simDamage, referenceDamage)).padStart(10)}   ${num(accumulator?.statusDmg ?? 0).padStart(11)}   ${gameTime.toFixed(2).padStart(6)}  ${referenceSeconds(member.name).toFixed(2).padStart(6)}`);
    }
    say('  ' + '-'.repeat(86));
    say(`  ${'TEAM'.padEnd(9)} ${num(simTotal).padStart(11)}  ${num(referenceTotals.damage).padStart(11)}   ${fmtRatio(ratio(simTotal, referenceTotals.damage)).padStart(10)}   ${''.padStart(11)}   ${simGameTime.toFixed(2).padStart(6)}  ${referenceTotals.seconds.toFixed(2).padStart(6)}`);
    say();

    // D10 — the denominator, spelled out, because getting it wrong is the single
    // easiest way to fabricate a gap.
    const wallClock = runA.result.totals.time;
    const engineDps = runA.result.totals.dps;
    const simDps = simGameTime > 0 ? simTotal / simGameTime : 0;
    say(`  DENOMINATOR  sum of per-member on-field (wall) times = ${simWall.toFixed(2)}s`);
    say(`               engine wall-clock totals.time           = ${wallClock.toFixed(2)}s   ` +
        `(${Math.abs(wallClock - simWall) < 0.01 ? 'agree — outro runs parallel, D10a' : 'DISAGREE — investigate'})`);
    say(`               engine gameTime (wall − freeze, 'toa')  = ${runA.result.totals.gameTime.toFixed(2)}s   <- THE DPS DENOMINATOR (D10b)`);
    say(`               reference                               = ${referenceTotals.seconds.toFixed(2)}s   ` +
        `time gap ${fmtRatio(ratio(runA.result.totals.gameTime, referenceTotals.seconds))}`);
    say(`  TEAM DPS     sim ${num(engineDps)}   reference ${num(referenceTotals.dps)}   gap ${fmtRatio(ratio(engineDps, referenceTotals.dps))}`);
    say(`               (per-member gameTime sum ${simGameTime.toFixed(2)}s -> ${num(simDps)} DPS; ` +
        `agrees with the engine to ${Math.abs(simDps - engineDps) < 1 ? '<1' : Math.round(Math.abs(simDps - engineDps))} DPS)`);
    say(`  WALL-CLOCK DPS would be ${num(simWall > 0 ? simTotal / simWall : 0)} (gap ` +
        `${fmtRatio(ratio(simWall > 0 ? simTotal / simWall : 0, referenceTotals.dps))}) — WRONG denominator, listed only to`);
    say('               show how much of an apparent gap the choice invents.');
    say();
    return { simTotal, simGameTime, simWall, engineDps, freeze, referenceSeconds };
}

// Section: the two anchors of handover §4.
function sayAnchors(say, dataset, benchmark, runA, referenceByName, options) {
    const referenceTotals = benchmark.totals;
    const tuneBreaks = tuneBreakDamage(runA.result);
    const referenceTuneBreak = benchmark.anchors.tuneBreakDamage;
    say('ANCHOR 1 — TUNE BREAK (takes no ATK, no crit and no gear stat — but see the DEF note)');
    if (!tuneBreaks.length) {
        say(`  NO TUNE BREAK STEP FIRED. Reference ${num(referenceTuneBreak)}. ` +
            'The rotation contains one — check capTuneBreaksPerPass.');
    } else {
        for (const hit of tuneBreaks) {
            say(`  pass ${hit.pass + 1}  ${hit.member.padEnd(8)} sim ${num(hit.damage).padStart(9)}   ` +
                `reference ${num(referenceTuneBreak).padStart(9)}   ` +
                `gap ${fmtRatio(ratio(hit.damage, referenceTuneBreak))}`);
        }
        say(`  landed ${tuneBreaks.length}x over 3 passes (cap is one per pass, team-wide)`);
        // COMPUTED, never hardcoded. This block used to print a fixed sensitivity
        // table ("at 0% RES it reads 80,428, at 10% 72,385, at 20% 64,343") that
        // described a DIFFERENT code path than the measured number above it — a
        // bare-target probe against an in-run value that carries the team's DEF
        // reduction. The whole D7 "reference sits just past 20% RES" inference
        // was read off that stale table (2026-08-13).
        const responder = dataset.resonators.find(entry => entry.name === tuneBreaks[0].member);
        const bare = computeTuneBreakDamage({
            status: 'tune_rupture', atkLv: 90, target: options.target,
            element: responder?.element ?? null, enemyType: options.target?.enemyType ?? 'overlord' });
        const measured = tuneBreaks[0].damage;
        say('  computeTuneBreakDamage reads enemy DEF, so this anchor is gear-independent but');
        say('  NOT team-buff-independent — a DEF shred/ignore moves it:');
        say(`    unbuffed, on this target   ${num(Math.round(bare)).padStart(9)}`);
        say(`    as measured in the run     ${num(Math.round(measured)).padStart(9)}   ` +
            `${(measured / bare).toFixed(3)}x — the team's own DEF shred + ignore`);
        say(`    reference                  ${num(referenceTuneBreak).padStart(9)}   ` +
            `${(referenceTuneBreak / bare).toFixed(3)}x of unbuffed  ` +
            `(${(100 * (bare - referenceTuneBreak) / referenceTuneBreak).toFixed(2)}% off it)`);
        say('  The reference matches the UNBUFFED formula on this target, so the residual is');
        say('  that the sim applies the team DEF reduction to the tune bar and the reference');
        say('  does not — an attribution question, not a target-assumption one.');
    }
    if (runA.result.tuneBreaksDropped?.length) {
        say(`  dropped as surplus: ${runA.result.tuneBreaksDropped.map(drop => `${drop.resonatorName} pass ${drop.pass + 1} ×${drop.dropped}`).join(', ')}`);
    }
    say();

    // ── Anchor 2: the Chisa shape ────────────────────────────────────────────
    const gapOf = (name) => {
        const id = referenceByName.get(name);
        const accumulator = runA.result.memberTotals.find(entry => entry.resonatorId === id);
        return ratio(accumulator?.damage ?? 0, referenceTotals.byMember[name]);
    };
    const chisaGap = gapOf('Chisa'), deniaGap = gapOf('Denia'), aemeathGap = gapOf('Aemeath');
    const carriesGap = (deniaGap + aemeathGap) / 2;
    say('ANCHOR 2 — THE CHISA SHAPE (the diagnostic, not the total)');
    say('  Chisa receives NO team buffs from either teammate. If she is much CLOSER');
    say('  to reference than the other two, the gap lives in the team-buff lane.');
    say(`    Chisa    ${fmtRatio(chisaGap)}`);
    say(`    Denia    ${fmtRatio(deniaGap)}`);
    say(`    Aemeath  ${fmtRatio(aemeathGap)}`);
    say(`    Chisa vs. the two buff-receiving carries (mean ${fmtRatio(carriesGap)}):  ` +
        `${Number.isFinite(chisaGap) && Number.isFinite(carriesGap) ? (carriesGap / chisaGap).toFixed(3) + 'x' : '—'}`);
    say(`  SHAPE ${Number.isFinite(chisaGap) && Number.isFinite(carriesGap) && chisaGap < carriesGap - 0.05
        ? 'REPRODUCES — Chisa is closer than both carries.'
        : 'DOES NOT REPRODUCE — Chisa is not the closer member.'}`);
    say();
    return { tuneBreaks, gapOf, chisaGap, deniaGap, aemeathGap, carriesGap };
}

// Section: pass 1 on its own, the only run Chisa's opener and the cancel-step
// decision (D3) can move.
function sayRunB(say, dataset, benchmark, options, referenceByName) {
    const pass1 = { [CHISA]: options.noCancelStep ? CHISA_PASS1.filter((_, index) => index !== 1) : CHISA_PASS1,
        [DENIA]: DENIA_ROTATION, [AEMEATH]: AEMEATH_ROTATION };
    const runB = runTeam(dataset, pass1, 1, options);
    const referencePass1 = benchmark.passes[0];
    say(`RUN B — 1 pass, pass-1 rotations (Chisa's opener; cancel step ${options.noCancelStep ? 'DROPPED' : 'as full stage, D3'})`);
    say();
    say('  member     sim damage   reference     gap (ref/sim)  game s   ref s');
    say('  ' + '-'.repeat(67));
    const freezeB = freezeByMember(runB.result);
    let bSim = 0, bTime = 0;
    for (const referenceMember of referencePass1.members) {
        const id = referenceByName.get(referenceMember.name);
        const accumulator = runB.result.memberTotals.find(entry => entry.resonatorId === id);
        const gameTime = (accumulator?.time ?? 0) - (freezeB.get(id) ?? 0);
        bSim += accumulator?.damage ?? 0;
        bTime += gameTime;
        say(`  ${referenceMember.name.padEnd(9)} ${num(accumulator?.damage ?? 0).padStart(11)}  ${num(referenceMember.damage).padStart(11)}   ${fmtRatio(ratio(accumulator?.damage ?? 0, referenceMember.damage)).padStart(10)}  ${gameTime.toFixed(2).padStart(6)}  ${referenceMember.seconds.toFixed(2).padStart(6)}`);
    }
    say('  ' + '-'.repeat(67));
    say(`  ${'TEAM'.padEnd(9)} ${num(bSim).padStart(11)}  ${num(referencePass1.totalDamage).padStart(11)}   ${fmtRatio(ratio(bSim, referencePass1.totalDamage)).padStart(10)}  ${bTime.toFixed(2).padStart(6)}  ${referencePass1.seconds.toFixed(2).padStart(6)}`);
    say(`  DPS       sim ${num(runB.result.totals.dps)}   reference ${num(referencePass1.dps)}   ` +
        `gap ${fmtRatio(ratio(runB.result.totals.dps, referencePass1.dps))}`);
    say();
    return { total: bSim, time: bTime, gap: ratio(bSim, referencePass1.totalDamage) };
}

function report(dataset, benchmark, options) {
    const out = [];
    const say = (line = '') => out.push(line);
    const referenceTotals = benchmark.totals;
    const referenceByName = new Map(MEMBERS.map(member => [member.name, member.id]));

    sayValidation(say, dataset);

    const steady = { [CHISA]: CHISA_STEADY, [DENIA]: DENIA_ROTATION, [AEMEATH]: AEMEATH_ROTATION };
    const runA = runTeam(dataset, steady, 3, options);
    sayPerPass(say, dataset, benchmark, options, referenceByName);
    const { simTotal, simWall, engineDps, freeze, referenceSeconds } =
        sayTotals(say, benchmark, runA);
    const { tuneBreaks, gapOf, chisaGap, deniaGap, aemeathGap, carriesGap } =
        sayAnchors(say, dataset, benchmark, runA, referenceByName, options);
    const runB = sayRunB(say, dataset, benchmark, options, referenceByName);

    return {
        text: out.join('\n'),
        data: {
            runA: {
                total: simTotal, gameTime: runA.result.totals.gameTime, wallTime: simWall,
                dps: engineDps, dpsGap: ratio(engineDps, referenceTotals.dps),
                timeGap: ratio(runA.result.totals.gameTime, referenceTotals.seconds),
                gap: ratio(simTotal, referenceTotals.damage),
                byMember: Object.fromEntries(MEMBERS.map(member => {
                    const accumulator = runA.result.memberTotals.find(entry => entry.resonatorId === member.id);
                    return [member.name, {
                        damage: accumulator?.damage ?? 0,
                        statusDamage: accumulator?.statusDmg ?? 0,
                        gameTime: (accumulator?.time ?? 0) - (freeze.get(member.id) ?? 0),
                        referenceSeconds: referenceSeconds(member.name),
                        gap: gapOf(member.name),
                    }];
                })),
            },
            runB,
            tuneBreak: { sim: tuneBreaks[0]?.damage ?? null, reference: benchmark.anchors.tuneBreakDamage, landed: tuneBreaks.length },
            chisaShape: { chisa: chisaGap, denia: deniaGap, aemeath: aemeathGap, carriesMean: carriesGap },
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────

function main() {
    const argv = process.argv.slice(2);
    const has = (flag) => argv.includes(flag);
    const dataset = loadDataset();
    const benchmark = readJson('data/benchmark-reference.json').benchmarks
        .find(candidate => candidate.id === 'arabwuwa-chisa-denia-aemeath-3pass');
    if (!benchmark) throw new Error('benchmark arabwuwa-chisa-denia-aemeath-3pass not found');

    const baseOptions = {
        // D7 RULING: the reference's own conditions are the default. The app and
        // optimizer targets remain reachable as the two disagreeing alternatives.
        target: has('--app-target') ? TARGET_APP : has('--zero-res') ? TARGET_ZERO_RES : TARGET_REFERENCE,
        roleMains: has('--role-mains'),
        tuneModes: has('--tune-modes'),
        openers: has('--openers'),
        noCancelStep: has('--no-cancel-step'),
        nullEchoes: has('--null-echoes'),
        templateSubstats: has('--template-substats'),
    };

    if (has('--profile')) { sayProfile(dataset, baseOptions); return; }

    const primary = report(dataset, benchmark, baseOptions);

    if (has('--json')) {
        process.stdout.write(JSON.stringify(primary.data, null, 2) + '\n');
        return;
    }

    console.log('='.repeat(80));
    console.log('DPS-GAP HARNESS — sim vs. data/benchmark-reference.json');
    const targetLabel = baseOptions.target === TARGET_APP ? 'lv90 10% res (app team page)'
        : baseOptions.target === TARGET_ZERO_RES ? 'lv90 0% res (optimizer)'
        : 'lv100 20% res (REFERENCE conditions)';
    console.log(`  target ${targetLabel}` +
        ` · mains ${baseOptions.roleMains ? 'role-aware (recommender default)' : 'best-applicable (Crit DMG ×3)'}` +
        ` · substats ${baseOptions.templateSubstats ? 'template 25-roll' : 'REFERENCE budget (16)'}` +
        ` · modes ${baseOptions.tuneModes ? 'tune_rupture/tune_strain' : 'fusion_burst (curated)'}` +
        ` · openers ${baseOptions.openers ? 'ON' : 'OFF'}` +
        ` · echoes ${baseOptions.nullEchoes ? 'template (id:null)' : 'REAL ids'}`);
    console.log('='.repeat(80));
    console.log();
    console.log(primary.text);

    if (!has('--variants')) {
        console.log('Run with --variants for the sensitivity axes (D6/D7/D8/D9/D3).');
        return;
    }

    console.log('='.repeat(80));
    console.log('VARIANTS — each axis moved on its own, from the configuration above');
    console.log('='.repeat(80));
    console.log();
    const axes = [
        ['role-aware mains (Healing Bonus for Chisa)     D6', { roleMains: !baseOptions.roleMains }],
        ['app target instead (lv90, 10% res)             D7', { target: TARGET_APP }],
        ['optimizer target instead (lv90, 0% res)        D7', { target: TARGET_ZERO_RES }],
        ['derived openers ON                             D8', { openers: !baseOptions.openers }],
        ['tune_rupture / tune_strain modes               D9', { tuneModes: !baseOptions.tuneModes }],
        ['cancel step dropped (Run B only)               D3', { noCancelStep: !baseOptions.noCancelStep }],
        ['null echo ids (old template default)           Z1', { nullEchoes: !baseOptions.nullEchoes }],
        ['template 25-roll substats (old default)        Z1', { templateSubstats: !baseOptions.templateSubstats }],
    ];
    const baseData = primary.data;
    // The cancel-step axis lives entirely in Run B (Chisa's pass-1 opener), so
    // that column is the only one it can move — printed alongside Run A's so a
    // flat Run A row reads as "not applicable" rather than "no effect".
    console.log('  axis                                                 runA total   runA gap  Chisa gap  runB gap');
    console.log('  ' + '-'.repeat(94));
    console.log(`  ${'(baseline)'.padEnd(50)} ${num(baseData.runA.total).padStart(11)}  ${fmtRatio(baseData.runA.gap).padStart(8)}  ${fmtRatio(baseData.chisaShape.chisa).padStart(9)}  ${fmtRatio(baseData.runB.gap).padStart(8)}`);
    for (const [label, override] of axes) {
        const data = report(dataset, benchmark, { ...baseOptions, ...override }).data;
        console.log(`  ${label.padEnd(50)} ${num(data.runA.total).padStart(11)}  ${fmtRatio(data.runA.gap).padStart(8)}  ${fmtRatio(data.chisaShape.chisa).padStart(9)}  ${fmtRatio(data.runB.gap).padStart(8)}`);
    }
    console.log();
    console.log('  Axes compose roughly multiplicatively, and the flags are independent so any');
    console.log('  combination runs. Each row here is the BASELINE with ONE axis moved — the');
    console.log('  rows are not cumulative. The baseline is now the reference\'s own stated');
    console.log('  conditions, so these axes measure departures FROM it, not toward it.');
    console.log();
}

main();
