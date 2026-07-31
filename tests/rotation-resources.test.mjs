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
import { computeResourceTimeline, resourceLevelAt } from '../src/core/rotation-resources.js';
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

console.log(`rotation-resources: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
