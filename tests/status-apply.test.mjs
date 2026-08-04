/**
 * WHICH casts inflict a negative status (OPEN-ITEMS #29), 2026-08-02.
 *
 * Before this, `applicationsFromSteps` treated EVERY damaging step as an
 * application — Cartethyia's 16-step reference rotation applied 16 stacks of
 * Aero Erosion where her kit names three casts worth 5. The derivation
 * (tools/preprocess/status-apply.mjs) reads each kit's own clauses; the risk it
 * carries is scoping, since a description section is the whole FAMILY and a
 * "Stage 4" clause is otherwise inherited by stages 1-3.
 *
 * So the assertions below are deliberately per-kit and negative as often as
 * positive: they pin the keys that must NOT be there. The counts are also
 * checked against the game's own applier buffs (data/status-appliers.json),
 * which is the one part of this that is data rather than text.
 *
 *   node tests/status-apply.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { statusApplyRules, applicationsFromSteps, STATUS_APPLY_RULES } from '../src/core/enemy-status.js';
import { assertCountsAgainstGame } from '../tools/preprocess/status-apply.mjs';
import { simulateRotation } from '../src/core/sim.js';
import { createBuild, appendRotationStep } from '../src/core/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const appliers = JSON.parse(readFileSync(resolve(__dirname, '../data/status-appliers.json'), 'utf8'));
const referenceRotations = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const derived = dataset.statusApplyRules ?? {};
/** Every (key → stacks) pair derived for a resonator, flattened. */
const keysOf = (resonatorId) => {
    const out = new Map();
    for (const rule of derived[String(resonatorId)] ?? []) {
        for (const key of rule.keys) out.set(key, rule.stacks);
    }
    return out;
};

// ── The dataset ships the derivation ────────────────────────────────────────
assert('dataset carries statusApplyRules', Object.keys(derived).length > 0);
assert('every rule names a status, a stack count and at least one key',
    Object.values(derived).flat().every(rule =>
        typeof rule.status === 'string' && rule.stacks >= 1 && rule.keys.length > 0));
assert('every rule quotes the clause it came from',
    Object.values(derived).flat().every(rule => /inflict/i.test(rule.derivedFrom ?? '')));

// ── Stage scoping: the failure mode this derivation exists to avoid ─────────
// "Basic Attack Stage 4 inflicts 1 stack of [Aero Erosion] upon the target hit."
const ciaccona = keysOf(1407);
assert('Ciaccona inflicts on Basic Stage 4', ciaccona.get('basic_4') === 1);
assert('...and NOT on stages 1-3',
    !ciaccona.has('basic_1') && !ciaccona.has('basic_2') && !ciaccona.has('basic_3'));
assert('...nor on the aimed shots that share the section',
    !ciaccona.has('basic_aimed_shot') && !ciaccona.has('basic_fully_charged_aimed_shot'));
assert('Ciaccona also inflicts on Resonance Skill, intro and Downbeat Notes',
    ciaccona.get('skill') === 1 && ciaccona.get('intro') === 1
    && ciaccona.get('forte_heavy_quadruple_downbeat') === 1);

// "Following [Basic Attack - Cartethyia] Stage 4, inflict 1 stack of Aero Erosion"
const cartethyia = keysOf(1409);
assert('Cartethyia inflicts 1 on Basic Stage 4', cartethyia.get('basic_4') === 1);
assert('...and NOT on stages 1-3',
    !cartethyia.has('basic_1') && !cartethyia.has('basic_2') && !cartethyia.has('basic_3'));
assert('...2 on her Resonance Skill and 2 on her marking intro',
    cartethyia.get('skill') === 2 && cartethyia.get('intro_sword_to_mark_tide_s_trace') === 2);
assert('Cartethyia applies 5 stacks over her reference rotation, not 16',
    [...cartethyia].filter(([key]) => ['basic_4', 'skill', 'intro_sword_to_mark_tide_s_trace'].includes(key))
        .reduce((sum, [, stacks]) => sum + stacks, 0) === 5);

// "[Basic Attack - Drizzle Stance Stage 4] inflicts [Glacio Chafe] 1 time"
const suisui = keysOf(1110);
assert('Suisui inflicts on Drizzle Stance 4 only',
    suisui.get('forte_basic_drizzle_stance_4') === 1
    && !suisui.has('forte_basic_drizzle_stance_1')
    && !suisui.has('forte_basic_drizzle_stance_3'));
assert('...and on Awakening Spring, whose clause says "Casting this skill"',
    suisui.get('skill_awakening_spring') === 1);

// ── Named-subject scoping ───────────────────────────────────────────────────
// "While casting [Spotlight] … inflicts 1 extra of [Glacio Chafe]" sits in the
// section Phantom Frame shares, so only the named key may take it.
const lucilla = keysOf(1109);
assert('Lucilla inflicts on Spotlight', lucilla.get('skill_spotlight') === 1);
assert('...and not on Phantom Frame, which shares the section',
    !lucilla.has('skill_phantom_frame'));
assert('...and on both intros and Oblivion', lucilla.get('intro_clip_it') === 1
    && lucilla.get('intro_hard_cut') === 1 && lucilla.get('forte_heavy_oblivion') === 1);

// "Hurl out an [Ichor Blade] and inflict [Tune Strain - Shifting]" — the blade
// is his Forte's projectile, not the acting skill; gating on it drops the intro.
const luuk = keysOf(1510);
assert('Luuk keeps his intro despite naming the Forte blade it throws',
    luuk.get('intro') === 1);
assert('...and inflicts on his mid-air chain and Golden Reflux',
    luuk.get('midair_mid_air_attack_1') === 1 && luuk.get('skill_golden_reflux') === 1);

// "consume 1 point of [Frostharden Iai] to inflict 3 stacks of [Glacio Chafe]"
assert('Hiyuki inflicts 3 stacks on her Iai, and only there',
    keysOf(1108).get('forte_basic_iai') === 3 && keysOf(1108).size === 1);

// ── Clauses that mention a status without applying one ──────────────────────
assert('Yangyang: Xuanling derives nothing — her clauses all say "does not inflict"',
    !derived['1610']);
assert('Zani derives nothing — hers is a teammate\'s infliction she reacts to',
    !derived['1507']);
assert('Lynae derives nothing — "Lynae CAN inflict" is a capability, not a cast',
    !derived['1509']);
assert('Buling derives nothing — her array is periodic ("every 2s"), not per-cast',
    !derived['1307']);
assert('Aemeath derives nothing — her Forte defers to a list of "the following skills"',
    !derived['1210']);

// ── Curated rules outrank derived ones ──────────────────────────────────────
const aemeath = statusApplyRules(1210, 'fusion_burst', dataset);
assert('Aemeath still uses her curated eight-skill rule',
    aemeath?.[0].keys.length === 8 && aemeath[0].icdSeconds === 3);
// S3 grants a SECOND applier her Forte's list never mentions — the Heavy
// Attacks, live only in [Instant Response]. Both gates are the kit's own.
assert('...plus the S3 Heavy Attack applier at chain 3+',
    aemeath?.length === 2 && aemeath[1].state === 'Instant Response'
    && aemeath[1].keys.every(key => key.startsWith('heavy_')));
assert('...which is absent below S3',
    statusApplyRules(1210, 'fusion_burst', dataset, 2)?.length === 1);
assert('...and it stays mode-gated', statusApplyRules(1210, 'tune_rupture', dataset) === null);
assert('a curated kit is never ALSO derived (the two would be rival readings)',
    Object.keys(STATUS_APPLY_RULES).every(id => !derived[id]));

// ── Fallback preserved for everyone else ────────────────────────────────────
assert('Phoebe keeps the every-damaging-step fallback',
    statusApplyRules(1506, null, dataset) === null);
assert('a dataset-less call still resolves curated rules',
    statusApplyRules(1210, 'fusion_burst')?.length === 2);
assert('...and returns null where only a derived rule exists',
    statusApplyRules(1409, null) === null && statusApplyRules(1409, null, dataset)?.length > 0);

// ── The mode gate on derived rules ──────────────────────────────────────────
// Rules are derived across ALL of a kit's Resonance Modes, so the chosen mode's
// inflicted set is what decides which of them fire.
{
    const steps = [{ skillKey: 'basic_4', startTime: 0, stepDamage: 100 }];
    const rules = [{ status: 'aero_erosion', stacks: 1, icdSeconds: 0, keys: ['basic_4'] }];
    assert('a rule for a status the build cannot inflict does not fire',
        applicationsFromSteps(steps, new Set(['glacio_chafe']), 1409, 90, rules).length === 0);
    assert('...and fires when it can',
        applicationsFromSteps(steps, new Set(['aero_erosion']), 1409, 90, rules).length === 1);
}

// ── Against the game's own numbers ──────────────────────────────────────────
assert('data/status-appliers.json carries the game\'s per-application counts',
    Object.keys(appliers.appliers ?? {}).length >= 70
    && Object.values(appliers.appliers).every(entry => entry.stacks >= 1 && entry.status));
{
    const problems = assertCountsAgainstGame(derived, appliers);
    assert('no derived count exceeds the largest applier the game defines for that kit',
        problems.length === 0);
    if (problems.length) console.error('   ', JSON.stringify(problems, null, 1));
}

// ── Live: the derivation actually reduces applications ──────────────────────
{
    const skillMap = dataset.autoSkillMap['1409'] ?? {};
    const steps = Object.keys(skillMap).slice(0, 16)
        .map((skillKey, index) => ({ skillKey, startTime: index, stepDamage: 100 }));
    const inflicted = new Set(['aero_erosion']);
    const withFallback = applicationsFromSteps(steps, inflicted, 1409, 90, null);
    const withRules = applicationsFromSteps(steps, inflicted, 1409, 90,
        statusApplyRules(1409, null, dataset));
    assert('Cartethyia applies strictly fewer stacks under her derived rule',
        withRules.length < withFallback.length);
    assert('...and every one is Aero Erosion credited to her',
        withRules.every(entry => entry.status === 'aero_erosion' && entry.applicatorId === 1409));
}


// ── Periodic appliers: a field keeps applying after the cast that placed it ──
// Buling's array is the roster's only one. It is CURATED, not derived: the
// sentence that applies the status has "The array" as its subject, and the cast
// that creates the array is named only in the sentence before it.
{
    const buling = statusApplyRules(1307, null, dataset);
    assert('Buling has a curated periodic rule', buling?.length === 1
        && buling[0].everySeconds === 2 && buling[0].durationS === 24 && buling[0].stacks === 2);
    assert('...keyed to the cast that PLACES the array, not the array damage row',
        buling[0].keys.length === 1
        && buling[0].keys[0] === 'forte_heavy_flashing_thunder_spell_harmony');
    assert('...and the periodic clause is never derived instead', !dataset.statusApplyRules?.['1307']);

    // Ticks are clamped to the rotation the way an off-field turret's are
    // (off-field.js: the shorter of the action duration and the window).
    const rule = [{ status: 'electro_flare', stacks: 2, icdSeconds: 0, everySeconds: 2, durationS: 24, keys: ['k'] }];
    const inflicted = new Set(['electro_flare']);
    const short = applicationsFromSteps(
        [{ skillKey: 'k', startTime: 0, endTime: 5, stepDamage: 100 }], inflicted, 1307, 90, rule);
    assert('a 24s field in a 5s rotation applies only the ticks inside it',
        short.length === 2 * 3 && short.at(-1).t === 4);
    const long = applicationsFromSteps(
        [{ skillKey: 'k', startTime: 0, endTime: 40, stepDamage: 100 }], inflicted, 1307, 90, rule);
    assert('...and never runs past its own duration in a longer rotation',
        long.at(-1).t === 24 && long.length === 2 * 13);
    assert('a non-periodic rule still applies exactly once per qualifying cast',
        applicationsFromSteps([{ skillKey: 'k', startTime: 0, endTime: 5, stepDamage: 100 }],
            inflicted, 1307, 90, [{ status: 'electro_flare', stacks: 2, icdSeconds: 0, keys: ['k'] }]).length === 2);
}

// ── A calibrated status that deals nothing says WHY (the zero-value rule) ────
// Applied, real per-stack table, and still zero because the rotation ends
// before the first tick. Silent, that reads as a broken sim.
{
    const target = { level: 90, atkLv: 90, resistances: {} };
    const skillMap = dataset.autoSkillMap['1307'] ?? {};
    const buling = dataset.resonators.find(entry => entry.id === 1307);
    let build = createBuild(buling);
    for (const key of referenceRotations['1307'].rotation) {
        if (skillMap[key] || key === '__echo__') build = appendRotationStep(build, key);
    }
    const sim = simulateRotation({ build, dataset, target });
    const lane = sim.statusDamage.stackTimelines.find(strip => strip.status === 'electro_flare');
    assert('Buling\'s array applies its clamped ticks', lane?.applications === 6);
    const gap = sim.statusDamage.gaps.find(entry => entry.status === 'electro_flare');
    assert('...and the zero damage it deals carries a measured reason, not silence',
        !!gap && /ticks every 5s/.test(gap.reason) && /before the first tick/.test(gap.reason));
    assert('...naming both instants the reader needs to check it',
        /applied at 6\.2s/.test(gap.reason) && /ends at 10\.3s/.test(gap.reason));
    assert('a status that deals damage reports no gap',
        !sim.statusDamage.gaps.some(entry => entry.countedDamage > 0));
}

// ── The measured Aemeath rotation (maintainer, 2026-08-03) ──────────────────
// A controlled ToA run, reported cast by cast with the enemy's Fusion Burst and
// Fusion Trail counters read off the debuff bar. The enemy already held 1 FB /
// 2 FT from a teammate, so the assertions below are on the DELTAS:
//
//   Res. Lib. Overdrive       1 FB  2 FT   (unchanged — the Liberation applies nothing)
//   Basic - Mech Stage 3      2 FB  4 FT   +1 / +2
//   Basic - Mech Stage 4      3 FB  6 FT   +1 / +2
//   Enh. Res. Skill (Duet)    3 FB 16 FT   +0 / +10  (the S6 on-cast grant)
//   Basic - Aemeath Stage 3   4 FB 18 FT   +1 / +2
//   Basic - Aemeath Stage 4   5 FB 20 FT   +1 / +2
//   Enh. Res. Skill (Duet)    5 FB  0 FT   consumed
//   Basic - Mech Stage 3      6 → 1 FB, 2 → 4 FT  (detonation + re-seed, +2 FT)
//   Basic - Mech Stage 4      2 FB  6 FT   +1 / +2
//   Enh. Res. Skill (Duet)    2 FB  0 FT   consumed
//   Enh. Heavy Attack         3 FB  2 FT   +1 / +2   ← NOT in her Forte's list
{
    const aemeath = dataset.resonators.find(entry => entry.id === 1210);
    const rotation = [
        'liberation_heavenfall_edict_overdrive',
        'skill_mech_1', 'skill_mech_2', 'skill_mech_3', 'skill_mech_4',
        'forte_heavy_seraphic_duet_encore',
        'basic_aemeath_1', 'basic_aemeath_2', 'basic_aemeath_3', 'basic_aemeath_4',
        'forte_heavy_seraphic_duet_overture',
        'skill_mech_1', 'skill_mech_2', 'skill_mech_3', 'skill_mech_4',
        'forte_heavy_seraphic_duet_encore',
        'heavy_aemeath_charged_ii',
        'liberation_heavenfall_edict_finale',
    ];
    const build = { ...createBuild(aemeath), chain: 6, level: 90,
        resonanceMode: 'fusion_burst', rotation };
    const sim = simulateRotation({ build, dataset, target: { level: 100, resistances: {} } });
    const applied = new Set(sim.steps
        .filter(step => step.skillKey && sim.statusDamage.stackTimelines.length)
        .map(step => step.skillKey));
    const rules = statusApplyRules(1210, 'fusion_burst', dataset, 6);
    const applies = (key) => rules.some(rule => rule.keys.includes(key));

    assert('the Liberation applies no Fusion Burst', !applies('liberation_heavenfall_edict_overdrive'));
    assert('...nor does the Seraphic Duet that triggers it',
        !applies('forte_heavy_seraphic_duet_encore') && !applies('forte_heavy_seraphic_duet_overture'));
    assert('Basic stages 3 and 4 apply, in BOTH forms',
        ['skill_mech_3', 'skill_mech_4', 'basic_aemeath_3', 'basic_aemeath_4'].every(applies));
    assert('...and stages 1 and 2 do not',
        !['skill_mech_1', 'skill_mech_2', 'basic_aemeath_1', 'basic_aemeath_2'].some(applies));
    assert('the Heavy Attack applies too (S3, in Instant Response)',
        applies('heavy_aemeath_charged_ii'));
    assert('every rotation step is a real skill of hers', applied.size > 0);

    // Eleven casts qualify by key; six of the seven applications come from the
    // Basic stages and the seventh from the Heavy. The Duets and the Liberation
    // contribute none, which is the whole point of the rule.
    const trail = sim.statusDamage.stackTimelines.find(strip => strip.status === 'fusion_burst');
    assert('seven Fusion Burst applications across the run', trail?.applications === 7);
    assert('...and the Heavy Attack is the last of them',
        sim.steps[16].skillKey === 'heavy_aemeath_charged_ii');
}

console.log(`status-apply: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
