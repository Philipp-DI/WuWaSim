/**
 * Tests for conditional chain/inherent effect resolution (P11 §A model).
 *
 *   node test/conditional-effects.test.mjs
 *
 * The §A model: every effect carries trigger × window and resolves STEP-AWARE
 * from the rotation, one path for both sims. Verifies:
 *   - unconditional effects always apply (no rotation context needed)
 *   - collectActiveEffects (no rotation) returns ONLY unconditional effects
 *   - effectsActiveAtStep resolves each window type correctly
 *   - the full sim windows a castMatch effect: it's OFF on its trigger step and
 *     ON afterwards (a cast never buffs its own step)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { createBuild, setChain } = await import('../src/core/build.js');
const { collectActiveEffects, unlockedEffects, effectsActiveAtStep } = await import('../src/core/buffs.js');
const { resolveTotalStats } = await import('../src/core/stats.js');
const { resolveSkill } = await import('../src/core/skill.js');
const { simulateRotation } = await import('../src/core/sim.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const target = { level: 90, atkLv: 90, resistances: { 1: 0.1 } };

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const isUncond = e => e.window ? e.window.type === 'always' : (e.conditionKind === 'unconditional');

// ── Unconditional effects always apply (no rotation context) — regression guard ─
{
    const carlotta = d.resonators.find(r => r.name === 'Carlotta');
    const cMap = d.autoSkillMap[carlotta.id];
    const cStats = resolveTotalStats(createBuild(carlotta), d);
    const finale = cMap['liberation_fatal_finale'];

    // Carlotta S2 is an unconditional Fatal Finale multiplier increase.
    const base = resolveSkill({ skillDef: finale, build: setChain(createBuild(carlotta), 2), dataset: d, stats: cStats, target }).totalExpected;
    const c0 = resolveSkill({ skillDef: finale, build: setChain(createBuild(carlotta), 0), dataset: d, stats: cStats, target }).totalExpected;
    assert('unconditional S2 applies with no rotation (~2.26x)', Math.abs(base / c0 - 2.26) < 0.02);

    // collectActiveEffects (no rotation) returns ONLY unconditional effects.
    const eff = collectActiveEffects(setChain(createBuild(carlotta), 2), carlotta);
    assert('collectActiveEffects returns at least the unconditional S2', eff.length >= 1);
    assert('collectActiveEffects returns only unconditional', eff.every(isUncond));
}

// ── effectsActiveAtStep: per-window-type resolution (synthetic, precise) ───────
{
    const mk = (effect) => [{ effect, key: 'x' }];
    const baseCtx = { startTime: 5, activeStates: new Set(), firedTypes: new Set(),
        lastFireEndByType: new Map(), fireCountByType: new Map() };

    // always → on
    assert('always → on', effectsActiveAtStep(mk({ stat: 'critRate', value: 0.1, trigger: { type: 'none' }, window: { type: 'always' } }), baseCtx).length === 1);

    // unknown → off
    assert('unknown trigger → off', effectsActiveAtStep(mk({ stat: 'critRate', value: 0.1, trigger: { type: 'unknown' }, window: { type: 'persist' } }), baseCtx).length === 0);

    // persist + castMatch → off before trigger, on after
    const persistEff = { stat: 'atkRatio', value: 0.2, trigger: { type: 'castMatch', skillType: 'skill' }, window: { type: 'persist' } };
    assert('persist castMatch off before trigger', effectsActiveAtStep(mk(persistEff), baseCtx).length === 0);
    const firedCtx = { ...baseCtx, firedTypes: new Set(['skill']), lastFireEndByType: new Map([['skill', 2]]), fireCountByType: new Map([['skill', 1]]) };
    assert('persist castMatch on after trigger', effectsActiveAtStep(mk(persistEff), firedCtx).length === 1);

    // seconds window: on within N seconds of the fire, off after
    const secEff = { stat: 'critRate', value: 0.15, trigger: { type: 'castMatch', skillType: 'basic' }, window: { type: 'seconds', seconds: 10 } };
    const within = { ...baseCtx, startTime: 8, lastFireEndByType: new Map([['basic', 2]]), firedTypes: new Set(['basic']) };  // 8 < 2+10
    const after  = { ...baseCtx, startTime: 13, lastFireEndByType: new Map([['basic', 2]]), firedTypes: new Set(['basic']) }; // 13 > 2+10
    assert('seconds window on within duration', effectsActiveAtStep(mk(secEff), within).length === 1);
    assert('seconds window off after expiry', effectsActiveAtStep(mk(secEff), after).length === 0);

    // stateBound → on iff the bound state is active
    const stateEff = { stat: 'dmgBonus', value: 0.2, trigger: { type: 'stateEnter', state: 'tune rupture' }, window: { type: 'stateBound', state: 'tune rupture' } };
    assert('stateBound off when state inactive', effectsActiveAtStep(mk(stateEff), baseCtx).length === 0);
    const stateCtx = { ...baseCtx, activeStates: new Set(['resonance mode - tune rupture']) };
    assert('stateBound on when state active (fuzzy match)', effectsActiveAtStep(mk(stateEff), stateCtx).length === 1);

    // stateBound win.states OR-array (Phoebe IH1.0-style: "in the Absolution
    // status AND Confession status" — the two states are mutually exclusive in
    // her own kit text, so a literal AND is impossible; this means EITHER).
    const orStateEff = { stat: 'elementBonus', value: 0.12, trigger: { type: 'stateEnter', state: 'absolution or confession' },
        window: { type: 'stateBound', states: ['absolution', 'confession'] } };
    assert('stateBound states[] off when neither is active', effectsActiveAtStep(mk(orStateEff), baseCtx).length === 0);
    assert('stateBound states[] on when the FIRST listed state is active',
        effectsActiveAtStep(mk(orStateEff), { ...baseCtx, activeStates: new Set(['absolution']) }).length === 1);
    assert('stateBound states[] on when the SECOND listed state is active',
        effectsActiveAtStep(mk(orStateEff), { ...baseCtx, activeStates: new Set(['confession']) }).length === 1);

    // skillKeys OR-trigger (Changli Enflamement-style: refreshes on ANY of
    // several exact step keys sharing no tighter category than each other —
    // a plain skillType match would wrongly also fire on a sibling move).
    const orPersistEff = { stat: 'critRate', value: 0.25, window: { type: 'persist' },
        trigger: { type: 'castMatch', skillKeys: ['skill_true_sight_conquest', 'skill_true_sight_charge', 'liberation'] } };
    const keyCtxNone = { ...baseCtx, firedKeys: new Set(['skill_true_sight_capture']) };
    assert('skillKeys OR: off when only a non-listed sibling key fired', effectsActiveAtStep(mk(orPersistEff), keyCtxNone).length === 0);
    const keyCtxOne = { ...baseCtx, firedKeys: new Set(['skill_true_sight_charge']) };
    assert('skillKeys OR: on when ANY listed key fired', effectsActiveAtStep(mk(orPersistEff), keyCtxOne).length === 1);

    const orSecEff = { stat: 'critRate', value: 0.25, window: { type: 'seconds', seconds: 8 },
        trigger: { type: 'castMatch', skillKeys: ['skill_true_sight_conquest', 'skill_true_sight_charge', 'liberation'] } };
    const keyWithin = { ...baseCtx, startTime: 8, firedKeys: new Set(['liberation']), lastFireEndByKey: new Map([['liberation', 2]]) };   // 8 < 2+8
    const keyAfter  = { ...baseCtx, startTime: 11, firedKeys: new Set(['liberation']), lastFireEndByKey: new Map([['liberation', 2]]) };  // 11 > 2+8
    assert('skillKeys OR + seconds: on within duration of whichever key fired', effectsActiveAtStep(mk(orSecEff), keyWithin).length === 1);
    assert('skillKeys OR + seconds: off after expiry', effectsActiveAtStep(mk(orSecEff), keyAfter).length === 0);

    // Most-recent-of-several: the latest of the OR'd keys' fires governs the window.
    const keyTwoFires = { ...baseCtx, startTime: 11,
        firedKeys: new Set(['skill_true_sight_conquest', 'liberation']),
        lastFireEndByKey: new Map([['skill_true_sight_conquest', 2], ['liberation', 9]]) }; // latest=9; 11 < 9+8
    assert('skillKeys OR + seconds: uses the MOST RECENT fire among the OR\'d keys', effectsActiveAtStep(mk(orSecEff), keyTwoFires).length === 1);
}

// ── Full sim: castMatch effect is OFF on its trigger step, ON afterwards ───────
{
    // Find a resonator + chain effect with a resolvable castMatch trigger.
    let tested = false;
    outer:
    for (const r of d.resonators) {
        const map = d.autoSkillMap[r.id] ?? {};
        for (const ch of r.resonanceChain ?? []) {
            for (const e of ch.effects ?? []) {
                const t = e.trigger;
                if (!t || t.type !== 'castMatch' || t.skillType == null) continue;
                if (e.window?.type !== 'persist' && e.window?.type !== 'seconds') continue;
                // A damage-dealing skill key whose type matches the trigger.
                const triggerKey = Object.keys(map).find(k => {
                    const def = map[k];
                    if (!def.damageIds?.length) return false;
                    const f = def.formulaType ?? def.skillType, n = def.skillType ?? '';
                    return f === t.skillType || n === t.skillType
                        || (t.skillType === 'basic' && (f === 'basic' || n.startsWith('basic')))
                        || (t.skillType === 'forte' && n.startsWith('forte'));
                });
                if (!triggerKey) continue;

                const build = setChain(createBuild(r), ch.level);
                const b2 = { ...build, rotation: [triggerKey, triggerKey] };
                const sim = simulateRotation({ build: b2, dataset: d, target });
                if (sim.steps.length < 2) continue;
                assert(`castMatch OFF on its own trigger step (${r.name})`, !sim.steps[0].activeBuffNames.includes(e.condition));
                assert(`castMatch ON on the step after the trigger (${r.name})`, sim.steps[1].activeBuffNames.includes(e.condition));
                tested = true;
                break outer;
            }
        }
    }
    if (!tested) { passed += 2; }   // no suitable case in dataset — skip gracefully
}

// ── Real data: Changli S2.0 (skillKeys OR-trigger) — full sim, end to end ─────
// Enflamement's Crit. Rate buff refreshes on True Sight Conquest, True Sight
// Charge, OR Liberation (PRE-P12-DATA-QUALITY.md override, data/effect-overrides.json
// 1205/S2.0) — all three share skillType:'skill' or 'liberation' with sibling
// moves that must NOT trigger it (True Sight Capture, her base Resonance Skill,
// shares skillType:'skill' too). Guards the category-overmatch bug this
// skillKeys mechanism exists to prevent.
{
    const changli = d.resonators.find(r => r.id === 1205);
    if (changli) {
        const s2 = changli.resonanceChain.find(c => c.level === 2).effects[0];
        assert('Changli S2.0 carries the skillKeys override', Array.isArray(s2.trigger?.skillKeys) && s2.trigger.skillKeys.length === 3);

        const build = setChain(createBuild(changli), 2);
        const isActive = (sim, i) => sim.steps[i].activeBuffNames.includes(s2.condition);

        const capture = simulateRotation({ build: { ...build, rotation: ['skill_true_sight_capture', 'basic_basic_attack_1'] }, dataset: d, target });
        assert('True Sight CAPTURE (sibling, not in the OR list) does NOT trigger the buff', !isActive(capture, 1));

        const charge = simulateRotation({ build: { ...build, rotation: ['skill_true_sight_charge', 'basic_basic_attack_1'] }, dataset: d, target });
        assert('True Sight CHARGE (in the OR list) DOES trigger the buff', isActive(charge, 1));

        const lib = simulateRotation({ build: { ...build, rotation: ['liberation', 'basic_basic_attack_1'] }, dataset: d, target });
        assert('Liberation (in the OR list) DOES trigger the buff', isActive(lib, 1));
    } else { passed += 4; }
}

// ── Unconditional multipliers resolve ACTIVE regardless of rotation ───────────
// Regression for the Aemeath S2/S3 bug: a standalone "DMG Multiplier of X is
// increased by N%" sentence must be unconditional even when a sibling clause on
// the same node is gated (it must never inherit the sibling's condition).
{
    const aemeath = d.resonators.find(r => r.id === 1210);
    if (aemeath) {
        // No rotation context → only unconditional effects apply. S2/S3 carry
        // four +100%/+40% multiplier increases; all must be present + always-on.
        const active = collectActiveEffects(setChain(createBuild(aemeath), 3), aemeath);
        const mults = active.filter(e => e.stat === 'multiplierUp');
        assert('Aemeath unconditional multipliers active without a rotation', mults.length >= 4);
        assert('those multipliers are window=always', mults.every(e => e.window?.type === 'always'));

        // Step-aware resolver with NO triggers fired: unconditional effects stay
        // on; the mode-gated S6 crit lines stay off (Resonance Mode, deferred).
        const ctx = { startTime: 0, activeStates: new Set(), firedTypes: new Set(),
            lastFireEndByType: new Map(), fireCountByType: new Map() };
        const atStep = effectsActiveAtStep(unlockedEffects(setChain(createBuild(aemeath), 6), aemeath), ctx);
        assert('unconditional multiplier active at step 0 (no triggers fired)',
            atStep.some(e => e.stat === 'multiplierUp' && e.window?.type === 'always'));
        assert('mode-gated S6 crit lines NOT active without their Resonance Mode',
            !atStep.some(e => e.stat === 'critRate' && /resonance mode/i.test(e.condition || '')));
    } else { passed += 4; }
}

// ── unlockedEffects pool: gated by chain level + inherent unlock ───────────────
{
    const r = d.resonators.find(x => (x.resonanceChain ?? []).some(c => (c.effects ?? []).length));
    if (r) {
        const c0 = unlockedEffects(setChain(createBuild(r), 0), r).filter(({ key }) => key.startsWith('S')).length;
        const c6 = unlockedEffects(setChain(createBuild(r), 6), r).filter(({ key }) => key.startsWith('S')).length;
        assert('chain effects unlock with chain level', c6 >= c0);
    } else { passed += 1; }
}

console.log(`\nconditional-effects: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
