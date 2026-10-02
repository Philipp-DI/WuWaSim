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
import { computeResourceConsumption, computeResourceEndLevels, computeResourceTickPhases, computeResourceTimeline, resourceConsumedAt, resourceLevelAt } from '../src/core/rotation-resources.js';
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
            const rawGameCap = capsFor(idString)?.[def.channel];
            assert(`${idString} '${def.name}': channel ${def.channel} has a cap in the game data`, rawGameCap != null);
            const gameCap = rawGameCap != null ? rawGameCap / (def.unit ?? 1) : null;
            assert(`${idString} '${def.name}': curated cap ${def.cap} matches the game's SpecialEnergy${def.channel}Max`
                + ` (${rawGameCap}${def.unit ? ` / unit ${def.unit}` : ''} = ${gameCap})`,
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
    const byName = (list, name) => list.find(def => def.name === name);
    const darkCore = byName(defs, 'Dark Core');
    assert('Denia has a Dark Core definition', !!darkCore);
    assert('its cap is the game\'s SpecialEnergy2Max', darkCore.cap === 3);
    // "When Denia engages in combat in Stagecraft Form: restore Dark Cores to 2
    // if she has fewer than 2." A gauge does not necessarily open a fight empty.
    assert('and the fight opens on 2, not on 0', darkCore.start === 2);

    // Her other two gauges share ONE spender: row 1211053 carries a spendAll on
    // SpecialEnergy1 AND SpecialEnergy3, which is the kit's "When [Conformal
    // Charge] is full, consume all [Conformal Charge] and [Void Particle]".
    const voidParticle = byName(defs, 'Void Particle');
    const conformal = byName(defs, 'Conformal Charge');
    assert('Void Particle is defined at the game\'s SpecialEnergy1Max',
        voidParticle?.cap === 100 && voidParticle.channel === 1);
    assert('Conformal Charge is defined at the game\'s SpecialEnergy3Max',
        conformal?.cap === 100 && conformal.channel === 3);
    assert('the same inherent floors Void Particle at 20', voidParticle.start === 20);
    assert('Conformal Charge states no floor, so it opens empty', conformal.start === undefined);
    assert('both are emptied by Final Act - Breakdown Form, the one row that spends both',
        voidParticle.spendAll[0] === 'liberation_final_act_breakdown_form'
        && conformal.spendAll[0] === 'liberation_final_act_breakdown_form');
    assert('S3 fills Void Particle to the max too, and leaves its cap alone',
        byName(resourceDefsForResonator(DENIA, dataset, 3), 'Void Particle').start === 100
        && byName(resourceDefsForResonator(DENIA, dataset, 3), 'Void Particle').cap === 100);

    const consumption = computeResourceConsumption(rotation, defs);
    const levels = computeResourceTimeline(rotation, defs).get('dark core');
    const spent = consumption.get('dark core');
    const banishTwo = rotation.indexOf('skill_banish_breakdown_form_2');
    const introAt = rotation.indexOf('intro_it_s_been_a_while');
    assert('her reference rotation opens with an Intro and casts Banish Stage 2',
        introAt === 0 && banishTwo > 0);
    assert('the opening step already holds the inherent\'s 2', levels[introAt] === 2);
    assert('the Intro grants a third, so Banish Stage 2 enters holding 3',
        levels[banishTwo] === 3);
    assert('Banish Stage 2 is the ONLY step that consumes any',
        spent.filter(amount => amount > 0).length === 1 && spent[banishTwo] === 3);
    assert('every other step consumes nothing',
        spent.every((amount, i) => i === banishTwo || amount === 0));

    // S3 moves the cap and the start TOGETHER — it raises the limit to 5 and
    // enhances the inherent to "restored to the max", so an S3 build opens full
    // and the Intro grant it needs at S0 overflows.
    const s3Defs = resourceDefsForResonator(DENIA, dataset, 3);
    assert('S3 raises the cap to 5', byName(s3Defs, 'Dark Core').cap === 5);
    assert('S3 opens the fight full, at 5', byName(s3Defs, 'Dark Core').start === 5);
    assert('S2 still reads the base gauge',
        byName(resourceDefsForResonator(DENIA, dataset, 2), 'Dark Core').cap === 3
        && byName(resourceDefsForResonator(DENIA, dataset, 2), 'Dark Core').start === 2);
    const s3Levels = computeResourceTimeline(rotation, s3Defs).get('dark core');
    const s3Spent = computeResourceConsumption(rotation, s3Defs).get('dark core');
    assert('an S3 build spends 5 on Banish Stage 2', s3Spent[banishTwo] === 5);
    assert('and its Intro grant is wasted — the gauge was already full',
        s3Levels[introAt] === 5 && s3Levels[introAt + 1] === 5);

    // A CARRIED level outranks `start`. `start` is what entering the FIGHT
    // gives you; a segment that legitimately emptied the gauge carries 0, and
    // re-reading `start` there would refill it once per segment for free.
    const carried = computeResourceTimeline(rotation, defs, new Map([['dark core', 0]])).get('dark core');
    assert('a carried 0 stays 0 instead of re-reading start', carried[introAt] === 0);

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

    assert('three cores consumed → +450% DMG Multiplier on that cast',
        Math.abs(multiplierUpAt(banishTwo) - 4.5) < 1e-9);
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
    // It is the THREE-core row, because her inherent opens the fight on 2 — the
    // game's own pre-multiplied row is the independent witness that the start
    // level is being applied, not just stored.
    const threeCore = rowOf(VARIANTS[2]);
    assert('the sim\'s three-core multiplier reproduces the game\'s own row at L1',
        Math.abs(base.mults[0] * (1 + multiplierUpAt(banishTwo)) - threeCore.mults[0]) < 1e-4);
}

// ── Aemeath's two gauges: a channel read in the kit's OWN units ─────────────
// SpecialEnergy1Max/SpecialEnergy2Max both read 20000 in the game's raw table;
// her kit states "capped at 4 points" / "capped at 200 points". `unit` is what
// converts one into the other — this is the shape the offline literal AND the
// game-backed resolution must agree on, exactly as the plain-cap gauges above.
{
    const AEMEATH = 1210;
    const rotation = rotationsById[String(AEMEATH)]?.rotation ?? [];
    const defs = resourceDefsForResonator(AEMEATH, dataset);
    const byName = (list, name) => list.find(def => def.name === name);

    const resonanceRate = byName(defs, 'Resonance Rate');
    const syncRate = byName(defs, 'Synchronization Rate');
    assert('Resonance Rate resolves to 4 via unit 5000 (raw SpecialEnergy1Max 20000)',
        resonanceRate?.cap === 4);
    assert('Synchronization Rate resolves to 200 via unit 100 (raw SpecialEnergy2Max 20000)',
        syncRate?.cap === 200);
    assert('the offline literal agrees with the game-backed resolution',
        resourceDefsForResonator(AEMEATH)[0].cap === resonanceRate.cap
        && resourceDefsForResonator(AEMEATH)[1].cap === syncRate.cap);

    assert('her reference rotation opens with an Intro and casts Overdrive then Finale',
        rotation[0] === 'intro_debut_of_meteoric_radiance'
        && rotation.includes('liberation_heavenfall_edict_overdrive')
        && rotation.at(-1) === 'liberation_heavenfall_edict_finale');

    const syncLevels = computeResourceTimeline(rotation, defs).get('synchronization rate');
    const resoLevels = computeResourceTimeline(rotation, defs).get('resonance rate');
    const overdriveAt = rotation.indexOf('liberation_heavenfall_edict_overdrive');
    const finaleAt = rotation.indexOf('liberation_heavenfall_edict_finale');
    assert('the Intro grant lands: Synchronization Rate reads 40 entering the next step',
        syncLevels[1] === 40);
    assert('Overdrive adds its own 30 on top: Synchronization Rate reads 70 after it',
        syncLevels[overdriveAt + 1] === 70);
    assert('Overdrive also grants Resonance Rate its one point',
        resoLevels[overdriveAt + 1] === 1);
    assert('Finale is the last step and enters holding both gauges',
        finaleAt === rotation.length - 1 && syncLevels[finaleAt] > 0 && resoLevels[finaleAt] > 0);
    const endLevels = computeResourceEndLevels(rotation, defs);
    assert('Finale drains both gauges to 0',
        endLevels.get('synchronization rate') === 0 && endLevels.get('resonance rate') === 0);
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

// ── tick: a gauge that fills on the CLOCK ───────────────────────────────────
// The clock runs on gameTime, fires at elapsed 0 and every `period` after, and
// carries its phase across segments. Every case below is unit-level on purpose:
// Denia's own rotation is 9.8s, shorter than one period, so her reference run
// exercises the t=0 firing ONLY and cannot prove any of the cycle behaviour.
{
    const times = (starts, ends) => ({ gameStart: starts, gameEnd: ends ?? starts });
    const floorDef = [{ name: 'Pool', cap: 5, gains: {}, spendAll: ['burn'],
        tick: { period: 10, refillTo: 2 } }];
    const walk = (rotation, context, defs = floorDef, carry = null) =>
        computeResourceTimeline(rotation, defs, carry, context).get('pool');

    // Without stepTimes the tick is inert — rotation-graph's legality check has
    // no timing info and must behave exactly as it did before ticks existed.
    assert('a tick with no stepTimes does nothing',
        JSON.stringify(walk(['x', 'x', 'x'], null)) === JSON.stringify([0, 0, 0]));
    assert('a tick with no stepTimes does nothing (empty context)',
        JSON.stringify(walk(['x', 'x', 'x'], {})) === JSON.stringify([0, 0, 0]));

    // Fires at elapsed 0, then every period.
    assert('the opening tick fires at elapsed 0',
        JSON.stringify(walk(['x', 'x'], { stepTimes: times([0, 1]) })) === JSON.stringify([2, 2]));
    assert('a refillTo tick RAISES to its floor and never lowers',
        JSON.stringify(walk(['burn', 'x'], { stepTimes: times([0, 1], [1, 2]) },
            [{ name: 'Pool', cap: 5, gains: { x: 4 }, spendAll: ['burn'],
               tick: { period: 10, refillTo: 2 } }])) === JSON.stringify([2, 0]));
    assert('a later firing refills a gauge the rotation emptied',
        JSON.stringify(walk(['burn', 'x', 'x'],
            { stepTimes: times([0, 1, 11]) })) === JSON.stringify([2, 0, 2]));
    assert('the clock does not re-fire within one period',
        JSON.stringify(walk(['burn', 'x', 'x'],
            { stepTimes: times([0, 1, 9]) })) === JSON.stringify([2, 0, 0]));

    // A refill never exceeds the cap, and `amount` is the additive shape.
    assert('refillTo clamps to the cap',
        JSON.stringify(walk(['x'], { stepTimes: times([0]) },
            [{ name: 'Pool', cap: 3, gains: {}, tick: { period: 10, refillTo: 99 } }])) === JSON.stringify([3]));
    assert('an `amount` tick ADDS instead of flooring',
        JSON.stringify(walk(['x', 'x', 'x'], { stepTimes: times([0, 10, 20]) },
            [{ name: 'Pool', cap: 9, gains: {}, tick: { period: 10, amount: 2 } }]))
            === JSON.stringify([2, 4, 6]));
    assert('an `amount` tick clamps at the cap',
        JSON.stringify(walk(['x', 'x', 'x'], { stepTimes: times([0, 10, 20]) },
            [{ name: 'Pool', cap: 3, gains: {}, tick: { period: 10, amount: 2 } }]))
            === JSON.stringify([2, 3, 3]));

    // The PHASE carry. This is what a measurement cannot show: a refill to a
    // floor is idempotent, so a wrongly re-fired opening tick is invisible
    // whenever the gauge is already at or above the floor.
    const phaseOf = (rotation, context, carry) =>
        computeResourceTickPhases(rotation, floorDef, null, { ...context, tickPhases: carry }).get('pool');
    assert('the end phase is the elapsed gameTime of the segment',
        Math.abs(phaseOf(['x', 'x'], { stepTimes: times([0, 4], [4, 7]) }, null) - 7) < 1e-9);
    assert('a carried phase accumulates across segments',
        Math.abs(phaseOf(['x'], { stepTimes: times([0], [5]) }, new Map([['pool', 7]])) - 12) < 1e-9);
    assert('a segment resuming mid-cycle does NOT re-fire the opening tick',
        JSON.stringify(computeResourceTimeline(['burn', 'x'],
            [{ name: 'Pool', cap: 5, gains: {}, spendAll: ['burn'],
               tick: { period: 10, refillTo: 2 } }],
            new Map([['pool', 4]]),
            { stepTimes: times([0, 1]), tickPhases: new Map([['pool', 5]]) }).get('pool')) === JSON.stringify([4, 0]));
    assert('...but it DOES fire once the carried clock crosses the next period',
        JSON.stringify(computeResourceTimeline(['burn', 'x'],
            [{ name: 'Pool', cap: 5, gains: {}, spendAll: ['burn'],
               tick: { period: 10, refillTo: 2 } }],
            new Map([['pool', 4]]),
            { stepTimes: times([0, 6]), tickPhases: new Map([['pool', 5]]) }).get('pool')) === JSON.stringify([4, 2]));

    // `byState` varies what a firing is WORTH, never the schedule. One passive on
    // one clock can restore to different ceilings in different forms.
    const perForm = [{ name: 'Pool', cap: 6, gains: {}, spendAll: ['burn'],
        tick: { period: 10, refillTo: 'cap', byState: { 'Form A': 2 } } }];
    const states = (list) => list.map(names => new Set(names));
    assert('a named state supplies its own floor',
        JSON.stringify(computeResourceTimeline(['x'], perForm, null,
            { stepTimes: times([0]), activeStates: states([['form a']]) }).get('pool'))
            === JSON.stringify([2]));
    assert('an UNNAMED state falls through to the default branch',
        JSON.stringify(computeResourceTimeline(['x'], perForm, null,
            { stepTimes: times([0]), activeStates: states([['form b']]) }).get('pool'))
            === JSON.stringify([6]));
    assert("refillTo 'cap' resolves to the gauge's own cap, never a repeated literal",
        JSON.stringify(computeResourceTimeline(['x'], [{ name: 'Pool', cap: 4, gains: {},
            tick: { period: 10, refillTo: 'cap' } }], null,
            { stepTimes: times([0]) }).get('pool')) === JSON.stringify([4]));
    assert('an empty byState leaves every firing on the default branch',
        JSON.stringify(computeResourceTimeline(['x'], [{ name: 'Pool', cap: 6, gains: {},
            tick: { period: 10, refillTo: 'cap', byState: {} } }], null,
            { stepTimes: times([0]), activeStates: states([['form a']]) }).get('pool'))
            === JSON.stringify([6]));
    // The clock is indifferent to which branch pays: firings still land on
    // 0 / 10 / 20 / 30 when the form changes underneath them, and the new form's
    // value applies from the next firing. It takes effect one step later than
    // the switch because a firing landing exactly on step i's start belongs to
    // the step already IN PROGRESS, so it reads step i-1's states — the same
    // rule that lets the t=0 firing be credited before step 0 reads its level.
    assert('a form switch changes the value but not the schedule',
        JSON.stringify(computeResourceTimeline(['burn', 'burn', 'burn', 'burn'], perForm, null,
            { stepTimes: times([0, 10, 20, 30]),
              activeStates: states([['form a'], ['form a'], ['form b'], ['form b']]) })
            .get('pool')) === JSON.stringify([2, 2, 2, 6]));
}

// ── Denia's 12s inherent, both forms and both chain branches ────────────────
{
    const byTickName = (list, name) => list.find(def => def.name === name);
    const baseDefs = resourceDefsForResonator(1211, dataset, 0);
    const s3TickDefs = resourceDefsForResonator(1211, dataset, 3);
    // She opens the fight in Stagecraft Form (STATE_DEFS initiallyActive), which
    // is what makes `start` and the t=0 firing describe the same instant.
    const inForm = (form) => [new Set([form.toLowerCase()])];
    const levelIn = (defs, gauge, form) => computeResourceTimeline(['x'],
        [byTickName(defs, gauge)], null,
        { stepTimes: { gameStart: [0], gameEnd: [0] }, activeStates: inForm(form) }).get(gauge.toLowerCase())[0];

    for (const [defs, level] of [[baseDefs, 'S0'], [s3TickDefs, 'S3']]) {
        for (const gauge of ['Dark Core', 'Void Particle']) {
            const def = byTickName(defs, gauge);
            assert(`${level} ${gauge} ticks on the extracted 12s period`, def.tick?.period === 12);
            // `start` is the t=0 firing of this same tick, and at t=0 she is in
            // Stagecraft Form — so the two must agree or one of them is wrong.
            assert(`${level} ${gauge} start agrees with its opening firing`,
                def.start === levelIn(defs, gauge, 'Stagecraft Form'));
        }
    }

    // The correction of 2026-09-02: the form decides HOW FAR the passive
    // refills, not WHETHER it fires. Gated on Stagecraft, Breakdown paid nothing.
    assert('S0 Dark Core stops at 2 in Stagecraft Form',
        levelIn(baseDefs, 'Dark Core', 'Stagecraft Form') === 2);
    assert('S0 Dark Core is UNLIMITED in Breakdown Form — it fills to the cap',
        levelIn(baseDefs, 'Dark Core', 'Breakdown Form') === 3);
    assert('S0 Void Particle stops at 20 in Stagecraft Form',
        levelIn(baseDefs, 'Void Particle', 'Stagecraft Form') === 20);
    assert('S0 Void Particle is UNLIMITED in Breakdown Form',
        levelIn(baseDefs, 'Void Particle', 'Breakdown Form') === 100);
    // The cap is 3 in BOTH forms — the 2 is a floor on this passive, not a
    // second limit — so an Intro grant still takes a Stagecraft Denia to 3.
    assert('the cap is the same in both forms', byTickName(baseDefs, 'Dark Core').cap === 3);

    // S3 restores "to the max" with no form qualifier, so no branch survives.
    assert('S3 refills to the max in Stagecraft Form too',
        levelIn(s3TickDefs, 'Dark Core', 'Stagecraft Form') === 5);
    assert('S3 refills to the max in Breakdown Form',
        levelIn(s3TickDefs, 'Dark Core', 'Breakdown Form') === 5);
    assert('S3 Void Particle refills to its cap in either form',
        levelIn(s3TickDefs, 'Void Particle', 'Stagecraft Form') === 100
        && levelIn(s3TickDefs, 'Void Particle', 'Breakdown Form') === 100);
    // 'cap' is written rather than a literal, so the S3 cap bump carries in.
    assert("the floor is stated as 'cap', so raising the cap raises it too",
        byTickName(s3TickDefs, 'Dark Core').tick.refillTo === 'cap');
    assert('Conformal Charge has no tick — no row grants it on a clock',
        byTickName(baseDefs, 'Conformal Charge').tick === undefined);
    // A partial chain override must not drop the fields it does not mention.
    assert('the S3 tick override keeps the 12s period',
        byTickName(s3TickDefs, 'Dark Core').tick.period === 12);
}

// ── Luuk Herssen's Endnotes on the Endgame: a gauge with NO channel ─────────
// OPEN-ITEMS 2, 2026-10-02. Three things this block pins that nothing else does.
//
// 1. A gauge may legitimately declare NO `channel`. His specialEnergyCaps are
//    {1: 30000, 2: 300, 3: 150, 4: 6000, 5: 10000} and none reads 3 — TWO of
//    them reach it under a divisor (ch2 at unit 100, ch3 at unit 50), and
//    gauge-income.json holds no SpecialEnergy row for him at all, so there is
//    no raw magnitude to settle which. The docblock over RESOURCE_DEFS requires
//    a second witness before a `unit` is trusted; with none, the channel stays
//    unclaimed rather than guessed. The kit states the cap twice instead
//    ("stacking up to 3 times", and S6's "40% DMG Bonus, up to 120%" = 3).
// 2. The effect is scoped BY NAME, because the clause states no category at all.
//    Its only "Resonance Liberation" is the lead of the skill's own proper name,
//    which the parser lifts into skillType 'liberation' — a false positive off
//    the NAME. A grant to a named skill pays whatever bucket that skill's hits
//    read, and the invented category happened to name the one bucket this
//    Liberation does NOT read (its instances are type 0, so the hit reads Basic
//    Attack — an ordinary Liberation CAST dealing Basic-bucket damage, which is
//    correct and not a defect), so both gates together matched nothing and the
//    effect paid zero even once triggered and stacked.
// 3. A 'persist' window is safe HERE because the count is the gauge: the
//    Liberation's own spendAll zeroes it, so the effect self-scopes to nothing
//    on every later step. The last assertion is what proves that, and it is the
//    one that would break if the window or the spend ever moved.
{
    const LUUK = 1510;
    const FORMS = ['skill_aureole_of_execution_ring', 'skill_aureole_of_execution_breach',
        'skill_aureole_of_execution_glare'];
    const defs = resourceDefsForResonator(LUUK, dataset);
    const endnotes = defs.find(def => def.name === 'Endnotes on the Endgame');

    assert('Endnotes on the Endgame is curated', !!endnotes);
    assert('it declares NO channel — two of his channels reach 3 under a divisor',
        endnotes?.channel === undefined);
    assert('its cap is the kit-stated 3', endnotes?.cap === 3);
    assert('the offline fallback agrees with the dataset-backed resolution',
        resourceDefsForResonator(LUUK)[0].cap === endnotes.cap);
    // Only the three FORMS grant. Golden Reflux is the base Resonance Skill
    // that Aureole REPLACES; Golden Impale and Ichor Deposit are follow-ups a
    // form spawns, not forms of it — and all three sit under `skill_` keys.
    assert('exactly the three Aureole forms grant, 1 each',
        JSON.stringify(Object.keys(endnotes.gains).sort()) === JSON.stringify([...FORMS].sort())
        && Object.values(endnotes.gains).every(amount => amount === 1));
    assert('the Liberation spends all of it',
        JSON.stringify(endnotes.spendAll) === JSON.stringify(['liberation']));

    // His reference rotation casts all three forms, in order, before the
    // Liberation — so it reaches the cap exactly, with nothing to spare.
    const rotation = rotationsById[String(LUUK)]?.rotation ?? [];
    const levels = computeResourceTimeline(rotation, defs).get('endnotes on the endgame');
    const libAt = rotation.indexOf('liberation');
    assert('his reference rotation ends on the Liberation',
        libAt === rotation.length - 1);
    assert('it casts each of the three forms exactly once',
        FORMS.every(form => rotation.filter(key => key === form).length === 1));
    assert('the gauge reads exactly 3 entering the Liberation', levels[libAt] === 3);
    assert('and 0 entering the rotation', levels[0] === 0);
    assert('the Liberation drains it',
        computeResourceEndLevels(rotation, defs).get('endnotes on the endgame') === 0);
    // A fourth grant must not push it past the cap.
    const overCapped = computeResourceTimeline([...FORMS, FORMS[2], 'liberation'], defs)
        .get('endnotes on the endgame');
    assert('a fourth grant is capped at 3', overCapped[4] === 3);

    // The effect: S6.1, +40% per stack to a 3-stack ceiling, name-bound.
    const resonator = dataset.resonators.find(entry => entry.id === LUUK);
    const effect = resonator.resonanceChain[5].effects[1];
    assert('S6.1 reads the gauge by name',
        effect.stackTrigger?.type === 'resource'
        && effect.stackTrigger.resource === 'Endnotes on the Endgame');
    assert('it is 40% per stack to 3', effect.perStack === 0.4 && effect.maxStacks === 3);
    assert('it is bound to the Liberation BY NAME, not by category',
        JSON.stringify(effect.skillKeys) === JSON.stringify(['liberation']));
    // The contradiction that made the category gate unusable, asserted so a
    // future re-tagging of the row surfaces here rather than silently.
    const libRow = (dataset.damageTable[String(LUUK)] ?? [])
        .find(row => (resonator.id, dataset.autoSkillMap[String(LUUK)].liberation.damageIds.includes(row.id)));
    assert("the game tags that Liberation's hits 'basic' — a Liberation CAST in the Basic bucket, so only the NAME can scope this grant",
        JSON.stringify(libRow?.dmgTypes) === JSON.stringify(['basic']));
    assert('his Intro row is tagged intro, so the tagging discriminates',
        JSON.stringify((dataset.damageTable[String(LUUK)] ?? [])
            .find(row => /Intro Skill/i.test(row.name ?? ''))?.dmgTypes) === JSON.stringify(['intro']));
    // The gauge is the stack count, so it scales linearly and self-zeroes.
    const skillMap = dataset.autoSkillMap[String(LUUK)];
    const s6Build = createBuild(resonator);
    s6Build.chain = 6;
    const unlocked = unlockedEffects(s6Build, resonator);
    const endnotesAt = (steps, index) => {
        const levelMap = computeResourceTimeline(steps, defs);
        return effectsActiveAtStepDetailed(unlocked, {
            startTime: 0, activeStates: new Set(),
            firedTypes: new Set(), lastFireEndByType: new Map(), fireCountByType: new Map(),
            firedKeys: new Set(steps.slice(0, index)), lastFireEndByKey: new Map(),
            fireCountByKey: new Map(), manualStacks: new Map(),
            resourceLevels: levelMap, stepIndex: index, stepKey: steps[index],
            stepTypes: phraseTypesForStep(skillMap?.[steps[index]]?.skillType),
        }).find(entry => entry.key === 'S6.1')?.effect ?? null;
    };
    const oneStack = endnotesAt([FORMS[0], 'liberation'], 1);
    const threeStacks = endnotesAt([...FORMS, 'liberation'], 3);
    const afterSpend = endnotesAt([...FORMS, 'liberation', 'liberation'], 4);
    assert('one form held reads 1 stack / +40%',
        oneStack?.stacks === 1 && Math.abs(oneStack.value - 0.4) < 1e-9);
    assert('three forms held read 3 stacks / +120%',
        threeStacks?.stacks === 3 && Math.abs(threeStacks.value - 1.2) < 1e-9);
    assert('the gauge is the count, so it is never flagged underivable',
        threeStacks?.stacksSource === 'resource' && !threeStacks.stacksUnknown);
    assert('after the Liberation spends it, a persist window pays ZERO',
        afterSpend === null || afterSpend.value === 0);
    assert('an S0 build does not have the effect at all',
        effectsActiveAtStepDetailed(unlockedEffects(createBuild(resonator), resonator), {
            startTime: 0, activeStates: new Set(), firedTypes: new Set(),
            lastFireEndByType: new Map(), fireCountByType: new Map(),
            firedKeys: new Set(FORMS), lastFireEndByKey: new Map(), fireCountByKey: new Map(),
            manualStacks: new Map(), resourceLevels: computeResourceTimeline([...FORMS, 'liberation'], defs),
            stepIndex: 3, stepKey: 'liberation',
            stepTypes: phraseTypesForStep(skillMap?.liberation?.skillType),
        }).every(entry => entry.key !== 'S6.1'));

}

console.log(`rotation-resources: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
