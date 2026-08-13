/**
 * Resource (gauge) timeline + gauge-scaled buffs, 2026-07-31.
 *
 * The third stack source: a curated non-energy gauge (rotation-rules.js
 * RESOURCE_DEFS) whose per-step level scales a buff. Changli's Enflamement is
 * the worked case — the kit states the whole mechanic in her Forte Circuit text
 * ("Changli can hold up to 4 stacks", +1 per True Sight Conquest/Charge, +4 per
 * Resonance Liberation, all consumed by Heavy Attack Flaming Sacrifice) while
 * the buff itself lives in an inherent skill that mentions none of it.
 *
 * Runs against the real dataset and her real reference rotation.
 *
 *   node tests/rotation-resources.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { computeResourceConsumption, computeResourceTimeline, resourceConsumedAt, resourceLevelAt } from '../src/core/rotation-resources.js';
import { RESOURCE_DEFS, resourceDefsForResonator } from '../src/core/rotation-rules.js';
import { effectsActiveAtStepDetailed, unlockedEffects } from '../src/core/buffs.js';
import { createBuild } from '../src/core/build.js';
import { phraseTypesForStep } from '../src/core/sim.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const references = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));
const rotationsById = references.rotations ?? references;

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── computeResourceTimeline: entering level, spend-before-gain, cap ──────────
{
    const def = [{ name: 'Gauge', cap: 4, gains: { add: 1, big: 4 }, spendAll: ['burn'] }];
    const levels = (rotation) => computeResourceTimeline(rotation, def).get('gauge');

    assert('an empty rotation yields an empty timeline', levels([]).length === 0);
    assert('a step ENTERS at the level before its own gain',
        JSON.stringify(levels(['add', 'add', 'add'])) === JSON.stringify([0, 1, 2]));
    assert('gains clamp at the cap',
        JSON.stringify(levels(['big', 'big', 'add'])) === JSON.stringify([0, 4, 4]));
    assert('a spendAll step enters holding its stacks, and the NEXT step sees zero',
        JSON.stringify(levels(['big', 'burn', 'add'])) === JSON.stringify([0, 4, 0]));
    assert('spends apply before gains within one step',
        JSON.stringify(computeResourceTimeline(['big', 'both'],
            [{ name: 'G', cap: 9, gains: { big: 4, both: 1 }, spendAll: ['both'] }]).get('g')) === JSON.stringify([0, 4]));
    assert('an unlisted skill key moves nothing',
        JSON.stringify(levels(['add', 'unrelated', 'add'])) === JSON.stringify([0, 1, 1]));
    assert('no definitions → an empty map', computeResourceTimeline(['add'], []).size === 0);

    // resourceLevelAt: null (no such gauge) must stay distinct from 0 (empty).
    const timeline = computeResourceTimeline(['add'], def);
    assert('a known gauge at a known step reads its level', resourceLevelAt(timeline, 'Gauge', 0) === 0);
    assert('gauge lookup is case-insensitive', resourceLevelAt(timeline, 'gAuGe', 0) === 0);
    assert('an UNDEFINED gauge reads null, not 0', resourceLevelAt(timeline, 'Nonexistent', 0) === null);
    assert('a step past the end reads null', resourceLevelAt(timeline, 'Gauge', 99) === null);
    assert('a missing timeline reads null', resourceLevelAt(null, 'Gauge', 0) === null);

    // computeResourceConsumption / resourceConsumedAt: the same walk, reporting
    // what each step SPENDS rather than what it enters holding.
    const spentOn = (rotation) => computeResourceConsumption(rotation, def).get('gauge');
    assert('a step that spends nothing consumes 0',
        JSON.stringify(spentOn(['add', 'add'])) === JSON.stringify([0, 0]));
    assert('a spendAll step consumes exactly what it entered holding',
        JSON.stringify(spentOn(['big', 'burn', 'add'])) === JSON.stringify([0, 4, 0]));
    assert('spending an empty gauge consumes 0, not a negative',
        JSON.stringify(spentOn(['burn'])) === JSON.stringify([0]));
    assert('a fixed spend takes only what is there',
        JSON.stringify(computeResourceConsumption(['add', 'take'],
            [{ name: 'G', cap: 9, gains: { add: 1 }, spend: { take: 5 } }]).get('g')) === JSON.stringify([0, 1]));
    assert('a step that both spends and gains consumes what it ENTERED with',
        JSON.stringify(computeResourceConsumption(['big', 'both'],
            [{ name: 'G', cap: 9, gains: { big: 4, both: 1 }, spendAll: ['both'] }]).get('g')) === JSON.stringify([0, 4]));

    const consumption = computeResourceConsumption(['big', 'burn'], def);
    assert('resourceConsumedAt reads the spending step', resourceConsumedAt(consumption, 'Gauge', 1) === 4);
    assert('consumption lookup is case-insensitive', resourceConsumedAt(consumption, 'gAuGe', 1) === 4);
    // Unlike resourceLevelAt, an unknown gauge is 0 rather than null: an
    // unmodelled gauge is one nothing spends, and 0 is the safe direction.
    assert('an UNDEFINED gauge consumes 0, never null', resourceConsumedAt(consumption, 'Nonexistent', 0) === 0);
    assert('a step past the end consumes 0', resourceConsumedAt(consumption, 'Gauge', 99) === 0);
    assert('a missing consumption map consumes 0', resourceConsumedAt(null, 'Gauge', 0) === 0);
}

// ── Data integrity: every curated def references real skill keys ────────────
{
    for (const [idString, defs] of Object.entries(RESOURCE_DEFS)) {
        const skillMap = dataset.autoSkillMap[idString];
        assert(`RESOURCE_DEFS ${idString}: the resonator has a skill map`, !!skillMap);
        if (!skillMap) continue;
        for (const def of defs) {
            assert(`RESOURCE_DEFS ${idString} '${def.name}': cap is a positive number`,
                typeof def.cap === 'number' && def.cap > 0);
            assert(`RESOURCE_DEFS ${idString} '${def.name}': has at least one gain`,
                Object.keys(def.gains ?? {}).length > 0);
            for (const [key, amount] of Object.entries(def.gains ?? {})) {
                assert(`RESOURCE_DEFS ${idString} '${def.name}': gain key ${key} exists`, !!skillMap[key]);
                assert(`RESOURCE_DEFS ${idString} '${def.name}': gain ${key} is positive`, amount > 0);
            }
            for (const key of def.spendAll ?? []) {
                assert(`RESOURCE_DEFS ${idString} '${def.name}': spendAll key ${key} exists`, !!skillMap[key]);
            }
        }
    }
}

// ── The game's own gauge caps back the curated ones ─────────────────────────
// tools/extract-forte.mjs reads SpecialEnergy{N}Max out of the BinData
// baseproperty table for every channel a resonator owns, and preprocess stamps
// it onto the resonator. A curated gauge that declares a `channel` must agree
// with that number: the point is that a stack cap is the game's, not one read
// out of kit text by a regex, and that a hand-written literal cannot drift.
{
    const capsFor = (id) => dataset.resonators.find(resonator => resonator.id === Number(id))?.specialEnergyCaps ?? null;

    assert('the dataset carries per-channel gauge caps',
        dataset.resonators.filter(resonator => resonator.specialEnergyCaps).length > 0);

    let channelDefs = 0;
    for (const [idString, defs] of Object.entries(RESOURCE_DEFS)) {
        for (const def of defs) {
            if (def.channel == null) continue;
            channelDefs++;
            const gameCap = capsFor(idString)?.[def.channel];
            assert(`${idString} '${def.name}': channel ${def.channel} has a cap in the game data`, gameCap != null);
            assert(`${idString} '${def.name}': curated cap ${def.cap} matches the game's SpecialEnergy${def.channel}Max (${gameCap})`,
                gameCap === def.cap);
        }
    }
    assert('at least one curated gauge is backed by a game channel', channelDefs >= 1);

    // Resolving WITH the dataset takes the cap from the game; resolving without
    // it falls back to the literal. Both must agree, which is the guard above.
    const fromData = resourceDefsForResonator(1205, dataset)[0];
    const fromLiteral = resourceDefsForResonator(1205)[0];
    assert('Changli Enflamement cap resolves to 4 from the game data', fromData.cap === 4);
    assert('and the offline fallback agrees', fromLiteral.cap === fromData.cap);
    assert('resolving with a dataset does not disturb gains',
        JSON.stringify(fromData.gains) === JSON.stringify(fromLiteral.gains));
    assert('an unknown resonator still returns an empty array',
        resourceDefsForResonator(999999, dataset).length === 0);

    // Independent spot-checks of the extraction itself, against numbers stated
    // in the kits: Youhu's Sky Blue stacks 4, and Lynae's Lumiflow gate reads
    // "at least 120 points" — both are that resonator's declared channel cap.
    assert("Youhu owns a channel capped at 4 (Sky Blue's stack limit)",
        Object.values(capsFor(1106) ?? {}).includes(4));
    assert("Lynae owns a channel capped at 120 (Lumiflow's stated gate)",
        Object.values(capsFor(1509) ?? {}).includes(120));
}

// ── Changli's Enflamement, end to end on her real reference rotation ────────
{
    const CHANGLI = 1205;
    const rotation = rotationsById[String(CHANGLI)]?.rotation ?? [];
    assert('Changli has a reference rotation to check against', rotation.length > 0);

    const timeline = computeResourceTimeline(rotation, resourceDefsForResonator(CHANGLI));
    const levels = timeline.get('enflamement');
    assert('Enflamement is defined for Changli', Array.isArray(levels));

    // Her rotation: intro, Capture, Conquest, Charge, midair ×2, Capture,
    // Conquest, Liberation, Flaming Sacrifice ×2, echo.
    assert('she starts with no Enflamement', levels[0] === 0);
    assert('True Sight Capture grants nothing (only Conquest/Charge do)', levels[1] === 0);
    assert('the first Conquest enters empty', levels[2] === 0);
    assert('Charge enters holding the stack Conquest just granted', levels[3] === 1);
    assert('the second Conquest enters holding two', levels[7] === 2);
    assert('Liberation enters at three', levels[8] === 3);
    assert('Flaming Sacrifice enters at the cap of four (Liberation grants 4)', levels[9] === 4);
    assert('it consumes everything, so the next step enters empty', levels[10] === 0);
    assert('the gauge never exceeds its cap', levels.every(level => level <= 4));
    assert('the gauge never goes negative', levels.every(level => level >= 0));

    // The buff: Secret Strategist (IH0.0), +5% Fusion DMG per Enflamement stack,
    // on True Sight Conquest/Charge casts only.
    const changli = dataset.resonators.find(resonator => resonator.id === CHANGLI);
    const unlocked = unlockedEffects(createBuild(changli), changli);
    const skillMap = dataset.autoSkillMap[String(CHANGLI)];
    const atStep = (stepIndex) => effectsActiveAtStepDetailed(unlocked, {
        startTime: 0, activeStates: new Set(), firedTypes: new Set(),
        lastFireEndByType: new Map(), fireCountByType: new Map(),
        firedKeys: new Set(), lastFireEndByKey: new Map(), fireCountByKey: new Map(),
        manualStacks: new Map(), resourceLevels: timeline, stepIndex,
        stepKey: rotation[stepIndex],
        stepTypes: phraseTypesForStep(skillMap?.[rotation[stepIndex]]?.skillType),
    }).find(entry => entry.key === 'IH0.0')?.effect ?? null;

    assert('the buff is OFF on Intro', atStep(0) === null);
    assert('the buff is OFF on True Sight Capture (the kit names only Conquest/Charge)', atStep(1) === null);
    assert('the buff is ON for the Conquest cast itself', atStep(2) !== null);
    assert('at zero stacks it is worth nothing', Math.abs((atStep(2)?.value ?? -1)) < 1e-9);
    assert('the buff reports the gauge as its source', atStep(2)?.stacksSource === 'resource');
    assert('one stack → +5% Fusion DMG', Math.abs((atStep(3)?.value ?? 0) - 0.05) < 1e-9);
    assert('two stacks → +10% Fusion DMG', Math.abs((atStep(7)?.value ?? 0) - 0.10) < 1e-9);
    assert('the buff is OFF on Liberation, which is not a True Sight cast', atStep(8) === null);
    assert('the buff is OFF on Flaming Sacrifice', atStep(9) === null);

    // A 'thisCast' window must not leak onto later steps the way 'persist' would.
    const onLaterSteps = rotation.map((_, i) => atStep(i)).filter(Boolean).length;
    assert('exactly the three True Sight Conquest/Charge steps carry the buff', onLaterSteps === 3);
}

// ── Denia's Dark Core: a multiplier scoped by ARITHMETIC, not by name ───────
// "For each [Dark Core] consumed, the DMG Multiplier of the attack is increased
// by 150%." The clause names no skill, so it cannot be scoped by binding a name.
// It does not need to be: its stack count is what the STEP CONSUMES, which is
// zero on every cast that spends nothing. That is the whole mechanism.
//
// The game ships the answer key. Her display row for [Banish - Breakdown Form
// Stage 2] is 56.34%, and damageTable holds five PRE-MULTIPLIED variants at
// exactly base x (1 + 1.5N) for N = 1..5 cores. So the sim's computed multiplier
// can be checked against the game's own number rather than against arithmetic
// this test repeats — if the model were wrong, it would have to be wrong in
// exactly the way the game is.
{
    const DENIA = 1211;
    const rotation = rotationsById[String(DENIA)]?.rotation ?? [];
    const defs = resourceDefsForResonator(DENIA, dataset);
    assert('Denia has a Dark Core definition', defs.length === 1 && defs[0].name === 'Dark Core');
    assert('its cap is the game\'s SpecialEnergy2Max', defs[0].cap === 3);

    const consumption = computeResourceConsumption(rotation, defs);
    const levels = computeResourceTimeline(rotation, defs).get('dark core');
    const spent = consumption.get('dark core');
    const banishTwo = rotation.indexOf('skill_banish_breakdown_form_2');
    const introAt = rotation.indexOf('intro_it_s_been_a_while');
    assert('her reference rotation opens with an Intro and casts Banish Stage 2',
        introAt === 0 && banishTwo > 0);
    assert('the Intro grants a core, so Banish Stage 2 enters holding one',
        levels[banishTwo] === 1);
    assert('Banish Stage 2 is the ONLY step that consumes any',
        spent.filter(amount => amount > 0).length === 1 && spent[banishTwo] === 1);
    assert('every other step consumes nothing',
        spent.every((amount, i) => i === banishTwo || amount === 0));

    const denia = dataset.resonators.find(resonator => resonator.id === DENIA);
    const skillMap = dataset.autoSkillMap[String(DENIA)];
    const unlocked = unlockedEffects(createBuild(denia), denia);
    const multiplierUpAt = (stepIndex) => {
        const active = effectsActiveAtStepDetailed(unlocked, {
            startTime: 0, activeStates: new Set(), firedTypes: new Set(),
            lastFireEndByType: new Map(), fireCountByType: new Map(),
            firedKeys: new Set(), lastFireEndByKey: new Map(), fireCountByKey: new Map(),
            manualStacks: new Map(),
            resourceLevels: computeResourceTimeline(rotation, defs),
            resourceConsumed: consumption,
            stepIndex,
            stepKey: rotation[stepIndex],
            stepTypes: phraseTypesForStep(skillMap?.[rotation[stepIndex]]?.skillType),
        });
        return active
            .filter(entry => entry.effect.stat === 'multiplierUp' && entry.effect.stackTrigger?.consumed)
            .reduce((sum, entry) => sum + (entry.effect.value ?? 0), 0);
    };

    assert('one core consumed → +150% DMG Multiplier on that cast',
        Math.abs(multiplierUpAt(banishTwo) - 1.5) < 1e-9);
    // The point of the `consumed` reading: she is still HOLDING cores on other
    // steps, so a level-based trigger would pay here too and multiply her kit.
    const leaks = rotation
        .map((_, i) => i)
        .filter(i => i !== banishTwo && multiplierUpAt(i) !== 0);
    assert(`no other step in the rotation is multiplied (${leaks.length} leaked)`, leaks.length === 0);

    // Against the game's own pre-multiplied rows, at every level of the curve.
    const table = dataset.damageTable[String(DENIA)];
    const rowOf = (id) => table.find(row => row.id === id);
    const base = rowOf(12110002005);
    assert('the display-row base for Banish Stage 2 is in the damage table', !!base);
    const VARIANTS = [12111052110, 12111052120, 12111052130, 12111052140, 12111052150];
    let ladderOk = 0;
    VARIANTS.forEach((id, index) => {
        const cores = index + 1;
        const variant = rowOf(id);
        if (!variant) return;
        const matches = variant.mults.every((mult, level) =>
            Math.abs(base.mults[level] * (1 + 1.5 * cores) - mult) < 1e-3);
        if (matches) ladderOk++;
    });
    assert(`the game's own rows ARE base x (1 + 1.5N) for N = 1..5, at every level (${ladderOk}/5)`,
        ladderOk === 5);
    // The one the reference rotation actually produces, tied to the sim's value.
    const oneCore = rowOf(VARIANTS[0]);
    assert('the sim\'s one-core multiplier reproduces the game\'s own row at L1',
        Math.abs(base.mults[0] * (1 + multiplierUpAt(banishTwo)) - oneCore.mults[0]) < 1e-4);
}

// ── An effect naming a gauge the resonator has no definition for ────────────
{
    // The resource branch must fall through to stacks-unknown rather than
    // reading a missing gauge as an empty one.
    const effect = {
        stat: 'critDmg', value: 0.1, stackable: true, perStack: 0.1, maxStacks: 5,
        trigger: { type: 'none' }, window: { type: 'always' },
        stackTrigger: { type: 'resource', resource: 'NoSuchGauge', perStackCost: 1 },
    };
    const [{ effect: scaled }] = effectsActiveAtStepDetailed([{ effect, key: 'IH0.0' }], {
        startTime: 0, activeStates: new Set(), firedTypes: new Set(),
        lastFireEndByType: new Map(), fireCountByType: new Map(),
        resourceLevels: new Map(), stepIndex: 0,
    });
    assert('an undefined gauge falls through to stacks-unknown', scaled.stacksUnknown === true);
    assert('and credits the conservative single stack', Math.abs(scaled.value - 0.1) < 1e-9);
}

// ── perStackCost: a gauge whose points are not 1:1 with stacks ──────────────
{
    const effect = {
        stat: 'critDmg', value: 0.1, stackable: true, perStack: 0.1, maxStacks: null,
        trigger: { type: 'none' }, window: { type: 'always' },
        stackTrigger: { type: 'resource', resource: 'Points', perStackCost: 25 },
    };
    const scaledAt = (level) => effectsActiveAtStepDetailed([{ effect, key: 'IH0.0' }], {
        startTime: 0, activeStates: new Set(), firedTypes: new Set(),
        lastFireEndByType: new Map(), fireCountByType: new Map(),
        resourceLevels: new Map([['points', [level]]]), stepIndex: 0,
    })[0].effect;

    assert('60 points at 25/stack → 2 stacks (floor, never rounded up)', scaledAt(60).stacks === 2);
    assert('24 points at 25/stack → 0 stacks', scaledAt(24).stacks === 0);
    assert('a genuinely empty gauge reads 0 stacks, not unknown', !scaledAt(0).stacksUnknown);
}

// ── Partial consumption: `spend` takes a fixed amount, `spendAll` empties ───
// Most kits draw a gauge DOWN rather than emptying it ("consume 50 of
// [Wolflame]", "consume 1 of [Frostharden Iai]", "consume 100 of [Frostheart]").
// Modelling only spendAll would zero a pool the game leaves change in, so a
// later cast in the same rotation would read 0 where the game still has some.
{
    const def = [{ name: 'Pool', cap: 100, gains: { fill: 50 }, spend: { tap: 20 }, spendAll: ['dump'] }];
    const levels = (rotation) => computeResourceTimeline(rotation, def).get('pool');

    assert('a fixed spend leaves the remainder',
        JSON.stringify(levels(['fill', 'tap', 'tap'])) === JSON.stringify([0, 50, 30]));
    assert('spending never goes below zero',
        JSON.stringify(levels(['tap', 'tap'])) === JSON.stringify([0, 0]));
    assert('spendAll still empties the pool',
        JSON.stringify(levels(['fill', 'fill', 'dump', 'tap'])) === JSON.stringify([0, 50, 100, 0]));
    assert('a step both spending and gaining resolves spend first',
        JSON.stringify(computeResourceTimeline(['fill', 'both'],
            [{ name: 'P', cap: 100, gains: { fill: 50, both: 10 }, spend: { both: 20 } }]).get('p'))
            === JSON.stringify([0, 50]));

    // The entering level a step READS is still the level before its own spend.
    const timeline = computeResourceTimeline(['fill', 'tap'], def).get('pool');
    assert('the spending step enters holding what it is about to spend', timeline[1] === 50);
}

console.log(`rotation-resources: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
