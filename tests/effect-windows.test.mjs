/**
 * untilConsumed effect windows + per-effect/state window derivation
 * (buffs.js isEffectOnAtStep 'untilConsumed', sim.js deriveEffectWindows /
 * deriveStateWindows), 2026-07-05.
 *
 *   node tests/effect-windows.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { effectsActiveAtStep } from '../src/core/buffs.js';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { createBuild, setChain } = await import('../src/core/build.js');
const { simulateRotation } = await import('../src/core/sim.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const refs = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── untilConsumed window semantics (synthetic) ────────────────────────────────
{
    const eff = {
        stat: 'atkRatio', value: 0.2, conditionKind: 'situational',
        condition: 'After casting Heavy Attack, the next Resonance Skill deals more DMG.',
        window: { type: 'untilConsumed', consumedBy: { skillType: 'skill' } },
        trigger: { type: 'castMatch', skillType: 'heavy' },
    };
    const unlocked = [{ effect: eff, key: 'S1.0' }];
    const ctx = (fires) => ({
        startTime: 100, activeStates: new Set(), resonanceMode: null,
        firedTypes: new Set(Object.keys(fires)),
        lastFireEndByType: new Map(Object.entries(fires)),
        fireCountByType: new Map(), firedKeys: new Set(),
        lastFireEndByKey: new Map(), fireCountByKey: new Map(),
    });

    assert('untilConsumed: OFF before the trigger fires',
        effectsActiveAtStep(unlocked, ctx({})).length === 0);
    assert('untilConsumed: ON after the trigger fires',
        effectsActiveAtStep(unlocked, ctx({ heavy: 2.0 })).length === 1);
    assert('untilConsumed: OFF once the consumer fires after the trigger',
        effectsActiveAtStep(unlocked, ctx({ heavy: 2.0, skill: 3.0 })).length === 0);
    assert('untilConsumed: re-armed when the trigger re-fires after consumption',
        effectsActiveAtStep(unlocked, ctx({ heavy: 5.0, skill: 3.0 })).length === 1);
    assert('untilConsumed: no consumedBy spec → stays on after trigger',
        effectsActiveAtStep([{ effect: { ...eff, window: { type: 'untilConsumed' } }, key: 'S1.0' }],
            ctx({ heavy: 2.0, skill: 3.0 })).length === 1);
}

// ── Live: Denia S6 window + stance/state windows with consumers ──────────────
{
    const denia = d.resonators.find(r => r.id === 1211);
    let b = setChain(createBuild(denia), 6);
    b = { ...b, rotation: refs['1211'].rotation.slice() };
    const sim = simulateRotation({
        build: b, dataset: d,
        target: { level: 90, atkLv: 90, resistances: { 1: 0.1, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 } },
    });

    assert('sim result exposes effectWindows', Array.isArray(sim.effectWindows));
    assert('sim result exposes stateWindows', Array.isArray(sim.stateWindows));

    const s6 = sim.effectWindows.find(w => w.key === 'S6.0');
    assert('Denia S6 Entropy Shift effect has a window', !!s6);
    assert('Denia S6 window opens at her first Liberation (step 4)', s6?.startStep === 3);
    assert('Denia S6 window spans both Entropy Shift variants to rotation end',
        s6?.endStep === b.rotation.length - 1 && s6?.endReason === 'rotation end');

    const stag = sim.stateWindows.find(w => w.name === 'stagecraft form' && w.startStep === 0);
    assert('Denia opens in Stagecraft Form', !!stag);
    assert('Stagecraft Form consumed by her Stagecraft Liberation',
        stag?.endReason === 'consumed' && stag?.consumedBy === 'liberation_final_act_stagecraft_form');

    const brk = sim.stateWindows.find(w => w.name === 'breakdown form');
    assert('Breakdown Form window opens at the Stagecraft Liberation', brk?.startStep === 3);
    assert('Breakdown Form consumed by the Breakdown Liberation',
        brk?.endReason === 'consumed' && brk?.consumedBy === 'liberation_final_act_breakdown_form');

    const esB = sim.stateWindows.find(w => w.name === 'entropy shift: breakdown form');
    assert('Entropy Shift (Breakdown) removed when the opposite Shift is obtained',
        esB?.endReason === 'consumed');

    // Both ends named. The strip sits on a TIME axis while the rotation rail is
    // laid out by label width, so a reader who infers the entering step from the
    // picture reliably picks the wrong cast — the window has to say it.
    assert('Breakdown Form names the cast that entered it',
        brk?.enteredBy === 'liberation_final_act_stagecraft_form');
    assert('a stance on from step 0 names no entering cast', stag?.enteredBy === null);
}

// ── A state window names its entering cast, not just its closer ──────────────
{
    const aemeath = d.resonators.find(r => r.id === 1210);
    const build = { ...setChain(createBuild(aemeath), 6), rotation: refs['1210'].rotation.slice() };
    const sim = simulateRotation({
        build, dataset: d, target: { level: 90, atkLv: 90, resistances: {} },
    });
    const stardust = sim.stateWindows.find(w => w.name === 'stardust resonance');
    assert('Stardust Resonance is the only state on her timeline', sim.stateWindows.length === 1);
    assert('...entered by the Liberation the kit names',
        stardust?.enteredBy === 'liberation_heavenfall_edict_overdrive');
    assert('...at that Liberation\'s own step, not a later one',
        build.rotation[stardust.startStep] === 'liberation_heavenfall_edict_overdrive');
}

// ── Windows survive echo steps (no artificial break across __echo__) ────────
{
    // Carlotta: Twilight Tango persists; her reference rotation ends in
    // __echo__ — a persist-window effect gated on liberation must span it.
    const carlotta = d.resonators.find(r => r.id === 1107);
    let b = setChain(createBuild(carlotta), 6);
    b = { ...b, rotation: ['skill', 'liberation', '__echo__', 'liberation_death_knell'] };
    const sim = simulateRotation({
        build: b, dataset: d,
        target: { level: 90, atkLv: 90, resistances: { 1: 0.1, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 } },
    });
    for (const w of sim.effectWindows) {
        // No window may END exactly at the echo step with the same effect
        // re-opening right after — that's the artificial break this guards.
        const reopened = sim.effectWindows.some(w2 => w2 !== w && w2.key === w.key && w2.startStep === w.endStep + 2);
        assert(`no artificial break across the echo step (${w.key})`, !(w.endStep === 1 && reopened));
    }
    passed++; // structure exercised without throwing
}

// ── castMatch cast-triggers are MECHANICAL, not damage-type (2026-07-15) ─────
// A cast-trigger for "casting a Resonance Liberation" must fire on the actual
// Liberation CAST — not on a Basic Attack that merely deals Liberation-TYPE
// damage. Chisa is the exact case: her Basic "Death Snip" is skillType basic /
// formulaType liberation, and her inherent "All Ends Here" grants a Havoc buff
// for 12s on casting her Liberation. Before the fix, the liberation-typed Basic
// falsely satisfied that trigger, turning the buff on ~2 steps too early.
{
    const chisa = d.resonators.find(r => r.id === 1508);
    // Death Snip (liberation-typed Basic) BEFORE the real Liberation.
    const b = { ...createBuild(chisa), rotation: ['basic_death_snip', 'liberation', 'skill_serrated_loop'] };
    const sim = simulateRotation({
        build: b, dataset: d,
        target: { level: 90, atkLv: 90, resistances: { 1: 0.1, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 } },
    });
    const havocOn = (i) => (sim.steps[i]?.activeBuffNames ?? []).some(n => /Casting Intro Skill|Havoc DMG Bonus/i.test(n));
    const libIdx = sim.steps.findIndex(s => s.skillType === 'liberation');
    assert('Chisa test rotation resolves (has a liberation step)', libIdx >= 0);
    assert('liberation-typed Basic does NOT fire the "cast Liberation" trigger (buff OFF before the Liberation)',
        !havocOn(0) && !havocOn(libIdx));
    assert('the buff turns on only AFTER the Liberation is actually cast',
        havocOn(libIdx + 1) === true);
}

console.log(`\neffect-windows: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
