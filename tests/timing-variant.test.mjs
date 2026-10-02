/**
 * Timing-variant selection (OPEN-ITEMS 22) — the mechanism, its guard, and the
 * two shapes of rule.
 *
 *   node tests/timing-variant.test.mjs
 *
 * 13 skillMap keys across 6 resonators carry several MEASURED timings and no
 * kit-stated name to pick between them (`needsStateModel` in
 * data/timing-overrides.json). `TIMING_VARIANT_RULES` says which applies, in
 * one of two shapes: `whenPrevSkillType` (rotation order — Zhezhi's airborne
 * Conjuration) or `whenState` (a STATE_DEFS state — Lucy's Intro inside
 * Algorithm Compaction).
 *
 * The load-bearing guard is the one about EXIT MODES. `computeStepTimes`
 * resolves durations before the full state timeline exists, so it runs
 * `computeStateTimeline` WITHOUT step times while the main walk reads the full
 * one. Those two agree only for a state whose exit needs no clock — so a
 * `whenState` rule naming a 'seconds' state would give one cast two different
 * durations within one rotation. That is what this file forbids.
 */
import { readFileSync } from 'node:fs';
import { simulateRotation } from '../src/core/sim.js';
import { createBuild } from '../src/core/build.js';
import {
    STATE_DEFS, TIMING_VARIANT_RULES, TIME_INDEPENDENT_EXIT_MODES,
    stateDefsForResonator, timingVariantFor,
} from '../src/core/rotation-rules.js';
import { computeStateTimeline } from '../src/core/rotation-state.js';

const dataset = JSON.parse(readFileSync(new URL('../data/wuwa-data.json', import.meta.url), 'utf8'));
const target = { level: 90, resistances: {} };

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const buildFor = (rid, rotation) => {
    const build = createBuild(dataset.resonators.find(resonator => resonator.id === rid));
    build.rotation = rotation;
    return build;
};
const durationOf = (rid, rotation, key) => simulateRotation({ build: buildFor(rid, rotation), dataset, target })
    .steps.find(step => step.skillKey === key)?.stepDuration;

// ── THE GUARD: a whenState rule may only name a time-independent state ───────
// Without this, the pre-pass (no step times) and the main walk (full timeline)
// can disagree, and a 'seconds' state reads persist-like in the pre-pass.
{
    let stateRules = 0;
    for (const [rid, byKey] of Object.entries(TIMING_VARIANT_RULES)) {
        for (const [key, rule] of Object.entries(byKey)) {
            assert(`${rid}.${key}: a rule states exactly one condition`,
                (rule.whenPrevSkillType != null) !== (rule.whenState != null));
            assert(`${rid}.${key}: names a variant montage`, typeof rule.variantMontage === 'string');
            if (rule.whenState == null) continue;
            stateRules++;
            const def = (STATE_DEFS[Number(rid)] ?? [])
                .find(entry => entry.name.toLowerCase() === rule.whenState.toLowerCase());
            assert(`${rid}.${key}: whenState '${rule.whenState}' is a real STATE_DEFS state`, !!def);
            assert(`${rid}.${key}: '${rule.whenState}' exits time-independently (${def?.exit?.mode})`,
                TIME_INDEPENDENT_EXIT_MODES.includes(def?.exit?.mode));
        }
    }
    assert('at least one whenState rule exists to guard', stateRules >= 1);
}

// ── Every rule points at a key that actually HAS the variant it names ────────
{
    for (const [rid, byKey] of Object.entries(TIMING_VARIANT_RULES)) {
        for (const [key, rule] of Object.entries(byKey)) {
            const step = dataset.autoSkillMap[rid]?.[key];
            assert(`${rid}.${key} exists in autoSkillMap`, !!step);
            assert(`${rid}.${key} carries propagated variants`, (step?.variants?.length ?? 0) >= 2);
            assert(`${rid}.${key} has a variant matching ${rule.variantMontage}`,
                (step?.variants ?? []).some(variant => variant.montage?.endsWith(rule.variantMontage)));
        }
    }
}

// ── Zhezhi (1105): rotation-order selection, both directions ────────────────
// AM_Attack05_Air 0.5667s entered from mid-air; AM_Attack05 1.1799s grounded.
{
    const CONJ = 'forte_heavy_ha_conjuration';
    assert('airborne predecessor selects the 0.5667s authoring',
        durationOf(1105, ['midair_mid_air_attack', CONJ], CONJ) === 0.5667);
    assert('a grounded predecessor keeps the 1.1799s default',
        durationOf(1105, ['basic_1', CONJ], CONJ) === 1.1799);
    // i === 0 has no predecessor: a whenPrevSkillType rule must not fire.
    assert('as the opening step it keeps the default',
        durationOf(1105, [CONJ], CONJ) === 1.1799);
}

// ── Lucy (1511): state selection, both directions ───────────────────────────
// Algorithm Compaction is entered by skill_deadlock and exited by any
// liberation, so the Intro's own timing depends on where it sits.
{
    const INTRO = 'intro_intro_skill_outdated_hallucination';
    assert('outside Algorithm Compaction the Intro keeps AM_SkillQte (0.7333s)',
        durationOf(1511, [INTRO, 'skill_deadlock'], INTRO) === 0.7333);
    assert('inside Algorithm Compaction it takes AM_Sp_SkillQte (1.0667s)',
        durationOf(1511, ['skill_deadlock', INTRO], INTRO) === 1.0667);
    // The state's own exit must put the Intro back on the base authoring.
    assert('after a Liberation ends Compaction the Intro is base again',
        durationOf(1511, ['skill_deadlock', 'liberation_netrunner_override', INTRO], INTRO) === 0.7333);

    // The pre-pass and the full timeline must agree — that is the whole point
    // of the exit-mode guard. Compare the state the no-times call reports
    // against the one the sim's full timeline reports, step by step.
    const rotation = ['skill_deadlock', INTRO, 'liberation_netrunner_override', INTRO];
    const skillMap = dataset.autoSkillMap['1511'];
    const prePass = computeStateTimeline(rotation, skillMap, stateDefsForResonator(1511)).activeAt;
    const withTimes = computeStateTimeline(rotation, skillMap, stateDefsForResonator(1511),
        { start: [0, 1, 2, 3], end: [1, 2, 3, 4] }).activeAt;
    assert('the time-independent pre-pass matches the timed timeline for her state',
        prePass.every((set, i) => set.size === withTimes[i].size
            && [...set].every(name => withTimes[i].has(name))));
}

// ── A key with no rule is never touched ─────────────────────────────────────
{
    const skillMap = dataset.autoSkillMap['1105'];
    const noRule = timingVariantFor(1105, 'basic_1', skillMap.basic_1,
        ['midair_mid_air_attack', 'basic_1'], 1, skillMap, new Set());
    assert('a key with no TIMING_VARIANT_RULES entry resolves no variant', noRule === null);
    const unknownResonator = timingVariantFor(9999, 'forte_heavy_ha_conjuration',
        skillMap.forte_heavy_ha_conjuration, ['midair_mid_air_attack', 'forte_heavy_ha_conjuration'], 1, skillMap, new Set());
    assert('an unknown resonator resolves no variant', unknownResonator === null);
}

// ── Rebecca (1308): her reference rotation is MODE-COHERENT ─────────────────
// Not a variant question — the finding that came out of investigating one.
// Her Skill step was `skill_it_s_big_boomin_time`, which the kit casts IN
// Huntress and which switches TO Guts, so the Huntress-mode Forte Heavy after
// it ran in Guts. `skill_come_n_get_me` is the Guts→Huntress one, which is
// what the entry's own `source` text ("Skill to Huntress") describes.
{
    const references = JSON.parse(readFileSync(new URL('../data/reference-rotations.json', import.meta.url), 'utf8'));
    const rotation = (references.rotations ?? references)['1308']?.rotation ?? [];
    const skillMap = dataset.autoSkillMap['1308'];
    const timeline = computeStateTimeline(rotation, skillMap, stateDefsForResonator(1308)).activeAt;
    const modeAt = (key) => {
        const index = rotation.indexOf(key);
        return index < 0 ? null : [...(timeline[index] ?? [])].join(',');
    };
    assert('her reference rotation casts the Guts->Huntress Skill',
        rotation.includes('skill_come_n_get_me') && !rotation.includes('skill_it_s_big_boomin_time'));
    assert('the Huntress-mode Forte Heavy runs in Huntress Mode',
        modeAt('forte_heavy_rat_tat_tat_huntress') === 'huntress mode');
    assert('the Guts basics run in Guts Mode',
        modeAt('basic_guts_1') === 'guts mode' && modeAt('basic_guts_3') === 'guts mode');
    // Both modes must actually occur: a rotation stuck in one of them would
    // pass the two checks above by accident if the pair were mis-defined.
    const modes = new Set(timeline.flatMap(set => [...set]));
    assert('both of her modes are reached across the rotation',
        modes.has('huntress mode') && modes.has('guts mode'));
}

console.log(`\ntiming-variant: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
