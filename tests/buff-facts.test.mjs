/**
 * ConfigDB as the PRIMARY source for a buff's bucket, kit text as the fallback.
 *
 *   node tests/buff-facts.test.mjs
 *
 * `computeDamage` composes (1 + dmgBonus) * (1 + amplify) * (1 + deepen), and the
 * client's own CharacterDamageCalculations.js has the same shape:
 *
 *     t = 1 + Proto_DamageChange + elementBonus + attackTypeBonus     ← additive
 *     damage = … * t * (1 - Proto_DamageReduce) * (1 + Proto_SpecialDamageChange)
 *
 * The engine's SHAPE was always right; the bucket ASSIGNMENT was not, and it
 * cannot be recovered from the sentence — the game does not decide it that way.
 * Sigrika's "targets take 30% more DMG" is SpecialDamageChange (multiplicative)
 * while Cartethyia's "take 30% more DMG" is DamageChange (additive). Same words.
 *
 * So this pins two things: that the retargeting happens where the game is
 * unambiguous, and that it REFUSES everywhere else rather than guessing.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { applyBuffFacts, loadBuffFacts } from '../tools/preprocess/buff-facts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const factsPath = resolve(__dirname, '../data/buff-facts.json');

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const resonatorOf = (name) => dataset.resonators.find(entry => entry.name === name);
const effectsOf = (resonator) => [
    ...(resonator.resonanceChain ?? []).flatMap(node => node.effects ?? []),
    ...(resonator.inherentSkills ?? []).flatMap(node => node.effects ?? []),
];

// ── The fact file itself ─────────────────────────────────────────────────────
{
    assert('data/buff-facts.json is committed', existsSync(factsPath));
    const facts = loadBuffFacts(factsPath);
    const owners = Object.keys(facts);
    assert('facts cover most of the roster', owners.length >= 50);
    let values = 0, bad = 0;
    for (const owned of Object.values(facts)) {
        for (const [value, bucket] of Object.entries(owned)) {
            values++;
            if (!(Number(value) > 0)) bad++;
            if (bucket.bucket && !['additive', 'amplify'].includes(bucket.bucket)) bad++;
            if (bucket.scopeByFamily && typeof bucket.scopeByFamily !== 'object') bad++;
        }
    }
    assert(`every fact is a positive value in a known bucket (${values} facts)`, bad === 0 && values >= 200);
    // Every id must be a real resonator — a stale key would bind nothing and
    // hide the fact that the extraction drifted from the dataset.
    const ids = new Set(dataset.resonators.map(entry => String(entry.id)));
    assert('every fact key is a live resonator id', owners.every(id => ids.has(id)));
}

// ── The join refuses more than it accepts ────────────────────────────────────
{
    const node = (effects) => ({ effects });
    const build = (effects) => ({ id: 9001, resonanceChain: [node(effects)], inherentSkills: [] });

    // No fact for this owner → nothing moves, whatever the value.
    const untouched = [{ stat: 'amplify', value: 0.7, element: null, skillType: 'skill' }];
    assert('no fact for the owner leaves every effect alone',
        applyBuffFacts(build(untouched), {}).moved === 0 && untouched[0].stat === 'amplify');

    // A fact for a DIFFERENT value must not bind.
    const other = [{ stat: 'amplify', value: 0.7, element: null, skillType: null }];
    assert('a fact for another value does not bind',
        applyBuffFacts(build(other), { 9001: { 0.55: { bucket: 'additive' } } }).moved === 0);

    // multiplierUp is the skill's own RATE, not a bonus bucket — never moved.
    const rate = [{ stat: 'multiplierUp', value: 0.7, element: null, skillType: 'skill' }];
    assert('multiplierUp is never retargeted',
        applyBuffFacts(build(rate), { 9001: { 0.7: { bucket: 'additive' } } }).moved === 0
        && rate[0].stat === 'multiplierUp');

    // Already in the right bucket → no move, no churn.
    const already = [{ stat: 'dmgBonus', value: 0.7, element: null, skillType: null }];
    assert('an effect already in the game\'s bucket is left alone',
        applyBuffFacts(build(already), { 9001: { 0.7: { bucket: 'additive' } } }).moved === 0);

    // The retarget preserves the effect's own SCOPE.
    const scoped = [
        { stat: 'amplify', value: 0.7, element: 2, skillType: null },
        { stat: 'amplify', value: 0.7, element: null, skillType: 'heavy' },
        { stat: 'amplify', value: 0.7, element: null, skillType: null },
    ];
    applyBuffFacts(build(scoped), { 9001: { 0.7: { bucket: 'additive' } } });
    assert('an element-scoped amplify becomes elementBonus', scoped[0].stat === 'elementBonus');
    assert('a type-scoped amplify becomes skillTypeBonus', scoped[1].stat === 'skillTypeBonus');
    assert('an unscoped amplify becomes dmgBonus', scoped[2].stat === 'dmgBonus');
    assert('each move records the game as its source',
        scoped.every(effect => effect.bucketSource === 'configdb'));

    // The other direction: the game says multiplicative, we had it additive.
    // SCOPE comes from the game too, keyed by stat FAMILY — a value alone
    // collides between unrelated buffs of one owner (Hiyuki's +500% Crit. DMG
    // and her separate 500% amplify are different mechanics on different skills).
    const needsScope = [{ stat: 'critDmg', value: 5, element: null, skillType: null }];
    applyBuffFacts(build(needsScope), { 9001: { 5: { scopeByFamily: { critDmg: ['liberation_a'], damage: ['skill_b'] } } } });
    assert('a crit effect takes the critDmg scope, not the damage one',
        JSON.stringify(needsScope[0].skillKeys) === '["liberation_a"]');
    const wrongFamily = [{ stat: 'critRate', value: 5, element: null, skillType: null }];
    applyBuffFacts(build(wrongFamily), { 9001: { 5: { scopeByFamily: { critDmg: ['liberation_a'] } } } });
    assert('a family with no scope of its own gets none', !wrongFamily[0].skillKeys);
    const ownScope = [{ stat: 'critDmg', value: 5, skillKeys: ['mine'], element: null, skillType: null }];
    applyBuffFacts(build(ownScope), { 9001: { 5: { scopeByFamily: { critDmg: ['theirs'] } } } });
    assert('an effect that already resolved a scope keeps it',
        JSON.stringify(ownScope[0].skillKeys) === '["mine"]');

    const upward = [{ stat: 'skillTypeBonus', value: 0.3, element: null, skillType: 'basic' }];
    applyBuffFacts(build(upward), { 9001: { 0.3: { bucket: 'amplify' } } });
    assert('an additive stat the game amplifies moves to amplify', upward[0].stat === 'amplify');

    // A per-stack effect joins on its PER-STACK value, not its total.
    const stacked = [{ stat: 'amplify', perStack: 0.1, value: 0.1, stackable: true, element: null, skillType: null }];
    applyBuffFacts(build(stacked), { 9001: { 0.1: { bucket: 'additive' } } });
    assert('a stackable effect joins on perStack', stacked[0].stat === 'dmgBonus');
}

// ── The live dataset: the corrections landed, and only where they should ─────
{
    // Each of these states "deal N% more DMG" and the game files it under
    // DamageChange — additive. They were multiplying on top of the bonus bucket.
    const expected = [
        ['Calcharo', 0.5, 'skillTypeBonus'],
        ['Yinlin', 0.7, 'skillTypeBonus'],
        ['Verina', 0.2, 'skillTypeBonus'],
        ['Cartethyia', 0.3, 'dmgBonus'],
    ];
    for (const [name, value, stat] of expected) {
        const hit = effectsOf(resonatorOf(name)).find(effect =>
            effect.bucketSource === 'configdb' && Math.abs((effect.value ?? 0) - value) < 1e-9);
        assert(`${name} ${value} moved to ${stat}`, hit?.stat === stat);
    }

    // Sigrika's clause is worded the same and is genuinely multiplicative —
    // ExtraEffectID 37. It must NOT have been swept up with the others.
    // The 500% Crit. DMG clauses: readable at all only because the game states
    // their scope as explicit skill ids. Hiyuki's uses BulletIds, which nothing
    // maps, so hers is still dropped — the safety net doing its job.
    for (const [name, keys] of [['Suisui', ['intro', 'skill_awakening_spring']],
                                ['Shorekeeper', ['intro_discernment', 'intro_enlightenment']]]) {
        const hit = effectsOf(resonatorOf(name)).find(e => e.stat === 'critDmg' && e.value === 5);
        assert(`${name}'s +500% Crit. DMG is scoped by the game`,
            hit?.scopeSource === 'configdb' && JSON.stringify(hit.skillKeys) === JSON.stringify(keys));
    }
    assert("Hiyuki's stays dropped (hers is scoped by BulletIds)",
        !effectsOf(resonatorOf('Hiyuki')).some(e => e.stat === 'critDmg' && e.value === 5));

    const sigrika = effectsOf(resonatorOf('Sigrika'));
    assert('Sigrika keeps her amplify (hers really is SpecialDamageChange)',
        sigrika.some(effect => effect.stat === 'amplify'));

    const moved = dataset.resonators.flatMap(effectsOf).filter(effect => effect.bucketSource === 'configdb');
    assert(`the pass is surgical (${moved.length} effects moved)`, moved.length > 0 && moved.length <= 20);
    assert('every move is to a real bucket',
        moved.every(effect => ['dmgBonus', 'elementBonus', 'skillTypeBonus', 'amplify'].includes(effect.stat)));
}

console.log(`buff-facts: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
