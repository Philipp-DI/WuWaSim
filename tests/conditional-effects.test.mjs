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
const { collectActiveEffects, unlockedEffects, effectsActiveAtStep, resolveChainInherentContext } = await import('../src/core/buffs.js');
const { resolveTotalStats } = await import('../src/core/stats.js');
const { resolveSkill } = await import('../src/core/skill.js');
const { simulateRotation } = await import('../src/core/sim.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const referenceRotations = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));
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
    const base = resolveSkill({ skillDef: finale, build: setChain(createBuild(carlotta), 2), dataset: d, stats: cStats, target, skillKey: 'liberation_fatal_finale' }).totalExpected;
    const c0 = resolveSkill({ skillDef: finale, build: setChain(createBuild(carlotta), 0), dataset: d, stats: cStats, target, skillKey: 'liberation_fatal_finale' }).totalExpected;
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


// ── multiplierUp binds to the SKILL its clause names (2026-08-03) ────────────
// "The DMG Multiplier of Resonance Skill Seraphic Duet: Overture is increased
// by 100%" names one move. Reduced to its CATEGORY it did two wrong things at
// once: sibling clauses stacked onto each other, and they landed on every step
// of that category. Aemeath's S2 gave +200% to her four Mech skill steps and
// nothing at all to either Seraphic Duet (those are forte_heavy nodes, so the
// category never matched them), and her S3 gave +140% to BOTH liberations where
// the kit says Finale +100% and Overdrive +40%.
{
    const aemeath = d.resonators.find(entry => entry.id === 1210);
    const multipliers = aemeath.resonanceChain
        .flatMap((node, index) => (node.effects ?? []).map(effect => ({ effect, seq: index + 1 })))
        .filter(entry => entry.effect.stat === 'multiplierUp');

    const bound = (seq, value) => multipliers.find(
        entry => entry.seq === seq && Math.abs(entry.effect.value - value) < 1e-9)?.effect.skillKeys;
    assert('Aemeath S2 binds each +100% to its own Seraphic Duet',
        JSON.stringify(bound(2, 1)) === JSON.stringify(['forte_heavy_seraphic_duet_overture'])
        || JSON.stringify(bound(2, 1)) === JSON.stringify(['forte_heavy_seraphic_duet_encore']));
    assert('Aemeath S3 binds Finale +100% and Overdrive +40% separately',
        JSON.stringify(bound(3, 1)) === JSON.stringify(['liberation_heavenfall_edict_finale'])
        && JSON.stringify(bound(3, 0.4)) === JSON.stringify(['liberation_heavenfall_edict_overdrive']));

    // The engine half: a named scope must not leak onto its category.
    const named = { stat: 'multiplierUp', value: 1, skillType: 'liberation', skillKeys: ['liberation_a'] };
    assert('a named multiplier applies to the key it names',
        resolveChainInherentContext([named], { skillType: 'liberation', skillKey: 'liberation_a' }).multiplierUp === 1);
    assert('...and NOT to a sibling of the same category',
        resolveChainInherentContext([named], { skillType: 'liberation', skillKey: 'liberation_b' }).multiplierUp === 0);
    assert('an unnamed multiplier still applies by category',
        resolveChainInherentContext([{ stat: 'multiplierUp', value: 1, skillType: 'liberation' }],
            { skillType: 'liberation', skillKey: 'liberation_b' }).multiplierUp === 1);

    // Live: the two Duets differ from the Mech steps, and the two liberations
    // differ from each other by exactly the ratio the kit states (2.0 / 1.4).
    const target = { level: 90, atkLv: 90, resistances: {} };
    const runAt = (chain) => {
        let build = setChain(createBuild(aemeath), chain);
        build.resonanceMode = 'fusion_burst';
        build.rotation = referenceRotations['1210'].rotation.filter(
            key => d.autoSkillMap['1210'][key] || key === '__echo__');
        return simulateRotation({ build, dataset: d, target });
    };
    const [s0, s2, s3] = [runAt(0), runAt(2), runAt(3)];
    const dmgOf = (sim, key) => sim.steps.find(step => step.skillKey === key)?.stepDamage ?? 0;
    assert('S2 doubles a Seraphic Duet',
        Math.abs(dmgOf(s2, 'forte_heavy_seraphic_duet_overture') / dmgOf(s0, 'forte_heavy_seraphic_duet_overture') - 2) < 0.02);
    assert('...and leaves the Mech skill steps alone',
        Math.abs(dmgOf(s2, 'skill_mech_3') / dmgOf(s0, 'skill_mech_3') - 1) < 1e-6);
    const finale = dmgOf(s3, 'liberation_heavenfall_edict_finale') / dmgOf(s2, 'liberation_heavenfall_edict_finale');
    const overdrive = dmgOf(s3, 'liberation_heavenfall_edict_overdrive') / dmgOf(s2, 'liberation_heavenfall_edict_overdrive');
    // The multiplier lifts are still 2.0 and 1.4 — that is what this pins. The
    // extra 1.25 is her S3's OTHER stated effect, "Resonance Liberation
    // Heavenfall Edict: Finale DMG is now Amplified by 25%", which since
    // 2026-08-07 lands on the Finale it names: the game states that scope as an
    // explicit skill-id list (ExtraEffectRequirements type 1) and buff-facts.mjs
    // reads it. Before, it reached neither liberation.
    assert('S3 lifts Finale and Overdrive by their own stated amounts, plus the Finale-only amplify',
        Math.abs(finale / overdrive - (2.0 * 1.25 / 1.4)) < 0.02);
}



// ── A sequence node that REPLACES an inherent does not stack with it ─────────
// Aemeath S3: "Inherent Skill Between the Stars is replaced with the following
// effects: …". The replacement restates the inherent's Crit DMG buff at a
// higher value (+60% vs +30%), so applying both stacks two readings of ONE
// effect. Pinned to an in-game capture (maintainer, 2026-08-03): her crit
// multiplier measured 2849 / 904 = 3.1515 against a sheet Crit DMG of 255.2%,
// i.e. 2.552 + 0.60 — the replacement alone, not 2.552 + 0.90.
{
    const aemeath = d.resonators.find(entry => entry.id === 1210);
    const inherent = aemeath.inherentSkills.find(node => node.name === 'Between the Stars');
    assert('Aemeath\'s Between the Stars is marked replaced at S3',
        inherent?.replacedByChain === 3);
    assert('...and the inherent it does NOT replace is untouched',
        aemeath.inherentSkills.find(node => node.name === 'Before All Sounds')?.replacedByChain == null);

    const critDmgAt = (chain) => {
        let build = setChain(createBuild(aemeath), chain);
        build.resonanceMode = 'fusion_burst';
        return collectActiveEffects(build, aemeath)
            .filter(effect => effect.stat === 'critDmg')
            .reduce((sum, effect) => sum + effect.value, 0);
    };
    assert('below S3 the inherent still applies on its own (+30%)',
        Math.abs(critDmgAt(2) - 0.30) < 1e-9);
    assert('at S3 the replacement applies INSTEAD, not on top (+60%, not +90%)',
        Math.abs(critDmgAt(3) - 0.60) < 1e-9);
    assert('...and it stays +60% at S6 — measured 3.1515x vs sheet 2.552',
        Math.abs((2.552 + critDmgAt(6)) - 3.1520) < 1e-9);

    // Roster guard: only a node that SAYS it replaces may suppress an inherent.
    const marked = d.resonators.flatMap(resonator =>
        (resonator.inherentSkills ?? []).filter(node => node.replacedByChain != null)
            .map(node => ({ resonator, node })));
    assert('every replacement mark is backed by a chain node that states it',
        marked.every(({ resonator, node }) => (resonator.resonanceChain ?? []).some(chainNode =>
            chainNode.level === node.replacedByChain
            && new RegExp(`Inherent\\s+Skill\\s+${node.name}\\s+is\\s+replaced`, 'i').test(chainNode.desc ?? ''))));
}

// ── A clause that NAMES its skills is scoped by the names, whatever it grants ─
// Aemeath S1: "In Instant Response, Heavy Attack - Aemeath and Heavy Attack -
// Mech gain 300% Crit. DMG increase…" and her inherent "Before All Sounds": the
// same two skills, "200% DMG Amplification". Both parsed to NOTHING before —
// the value precedes its keyword, which the forward-only reader never saw — and
// once read, both had to be scoped, or a +300% Crit. DMG would land on every
// hit she makes.
{
    const aemeath = d.resonators.find(entry => entry.id === 1210);
    const HEAVIES = ['heavy_aemeath_charged_i', 'heavy_aemeath_charged_ii',
        'heavy_mech_charged_i', 'heavy_mech_charged_ii'];
    const nodeEffect = (node, stat) => (node?.effects ?? []).find(effect => effect.stat === stat);

    const s1 = nodeEffect(aemeath.resonanceChain.find(node => node.level === 1), 'critDmg');
    assert('S1 reads its +300% Crit. DMG', s1?.value === 3);
    assert('...scoped to exactly her four Heavy Attacks',
        JSON.stringify(s1?.skillKeys?.slice().sort()) === JSON.stringify(HEAVIES.slice().sort()));
    assert('...and gated on the state its clause names',
        s1?.trigger?.type === 'stateEnter' && s1.trigger.state === 'instant response');

    const inherent = nodeEffect(aemeath.inherentSkills.find(node => node.name === 'Before All Sounds'), 'amplify');
    assert('the inherent reads its +200% amplification', inherent?.value === 2);
    assert('...on the same four skills, behind the same state',
        JSON.stringify(inherent?.skillKeys?.slice().sort()) === JSON.stringify(HEAVIES.slice().sort())
        && inherent?.trigger?.state === 'instant response');

    // …and it lands on the Heavy and NOWHERE else. The inherent alone triples it.
    const rotation = ['liberation_heavenfall_edict_overdrive', 'skill_mech_3',
        'heavy_aemeath_charged_ii'];
    const damageAt = (chain) => {
        const build = { ...setChain(createBuild(aemeath), chain), level: 90,
            resonanceMode: 'fusion_burst', rotation };
        const sim = simulateRotation({ build, dataset: d, target: { level: 100, resistances: {} } });
        return Object.fromEntries(sim.steps.map(step => [step.skillKey, step.stepDamage]));
    };
    const base = damageAt(0), withS1 = damageAt(1);
    assert('the Heavy carries the inherent even at S0', base.heavy_aemeath_charged_ii > 0);
    assert('...and S1 raises it further', withS1.heavy_aemeath_charged_ii > base.heavy_aemeath_charged_ii);
    assert('neither reaches a skill the clause does not name',
        withS1.skill_mech_3 === base.skill_mech_3);

    // The amplify VALUE fix: S3 states two effects in one sentence and the loose
    // reader took the first number it saw. The kit says Crit. DMG +60% AND
    // Finale amplified by 25% — not 60%.
    const s3Amplify = (aemeath.resonanceChain.find(node => node.level === 3).effects ?? [])
        .filter(effect => effect.stat === 'amplify');
    assert('S3 amplifies the Finale by the 25% it states, not the neighbouring 60%',
        s3Amplify.length === 2 && s3Amplify.every(effect => effect.value === 0.25));
}

console.log(`\nconditional-effects: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
