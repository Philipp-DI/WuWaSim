/**
 * Tests for the effect-overrides mechanism (PRE-P12-DATA-QUALITY.md §3/§5).
 *
 *   node test/effect-overrides.test.mjs
 *
 * Covers:
 *   - effectSlot resolves S/IH keys; null for bad keys
 *   - applyEffectOverrides: surgical field merge, suppress removal, add-missed
 *   - data integrity: every key in the real data/effect-overrides.json
 *     references a real chain/inherent slot in the dataset
 *   - a corrected effect resolves with the overridden values end-to-end
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { effectSlot, applyEffectOverrides } from '../tools/effect-overrides.js';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { collectActiveEffects } = await import('../src/core/buffs.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const overridesDoc = JSON.parse(readFileSync(resolve(__dirname, '../data/effect-overrides.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Build a small synthetic resonators fixture.
function fixture() {
    return [{
        id: 9001,
        resonanceChain: [{ level: 1, effects: [
            { stat: 'critRate', value: 0.1, trigger: { type: 'none' }, window: { type: 'always' } },
            { stat: 'atkRatio', value: 0.2, trigger: { type: 'none' }, window: { type: 'always' } },
        ] }],
        inherentSkills: [{ effects: [
            { stat: 'critDmg', value: 0.3, trigger: { type: 'none' }, window: { type: 'always' } },
        ] }],
    }];
}

// ── effectSlot ────────────────────────────────────────────────────────────────
{
    const r = fixture()[0];
    assert('effectSlot resolves chain key', effectSlot(r, 'S1.1')?.arr[1]?.stat === 'atkRatio');
    assert('effectSlot resolves inherent key', effectSlot(r, 'IH0.0')?.arr[0]?.stat === 'critDmg');
    assert('effectSlot null for missing chain level', effectSlot(r, 'S5.0') === null);
    assert('effectSlot null for malformed key', effectSlot(r, 'XYZ') === null);
}

// ── applyEffectOverrides: merge / suppress / add ──────────────────────────────
{
    const rs = fixture();
    const stats = applyEffectOverrides(rs, { '9001': {
        'S1.0': { value: 0.5 },                                                            // surgical merge
        'S1.1': { suppress: true },                                                        // remove
        'IH0.1': { stat: 'healingBonus', value: 0.4, trigger: { type: 'none' }, window: { type: 'always' } }, // add
    } });
    const chain = rs[0].resonanceChain[0].effects;
    const inh = rs[0].inherentSkills[0].effects;
    assert('field merge applied', chain.find(e => e.stat === 'critRate')?.value === 0.5);
    assert('suppress removed the effect', !chain.some(e => e.stat === 'atkRatio'));
    assert('suppress renumbered (one chain effect left)', chain.length === 1);
    assert('added effect appears', inh.some(e => e.stat === 'healingBonus' && e.value === 0.4));
    assert('stats counts correct', stats.patched === 1 && stats.suppressed === 1 && stats.added === 1 && stats.bad === 0);
    assert('no __suppressed marker leaks', !chain.some(e => e.__suppressed) && !inh.some(e => e.__suppressed));
}

// ── End-to-end: overridden value resolves through the resolver ────────────────
{
    const rs = fixture();
    applyEffectOverrides(rs, { '9001': { 'S1.0': { value: 0.99 } } });
    const build = { resonatorId: 9001, chain: 1, inherentSkillsActive: [true, true], resonanceMode: null };
    const active = collectActiveEffects(build, rs[0]);
    assert('overridden value resolves through collectActiveEffects', active.find(e => e.stat === 'critRate')?.value === 0.99);
}

// ── Data integrity: real override keys reference real slots ───────────────────
{
    const overrides = overridesDoc.overrides ?? {};
    let bad = 0, checked = 0;
    for (const [idStr, byKey] of Object.entries(overrides)) {
        const r = d.resonators.find(x => String(x.id) === idStr);
        if (!r) { bad++; continue; }
        for (const key of Object.keys(byKey)) {
            checked++;
            // Node must exist; index may add a new slot, so only the node is required.
            const m = /^S(\d+)\.\d+$/.exec(key) || /^IH(\d+)\.\d+$/.exec(key);
            const nodeExists = key.startsWith('S')
                ? (r.resonanceChain ?? []).some(c => c.level === Number(m[1]))
                : !!(r.inherentSkills ?? [])[Number(m[1])];
            if (!m || !nodeExists) { bad++; console.error(`   bad override key: ${idStr}/${key}`); }
        }
    }
    assert(`all ${checked} real override keys reference a real slot`, bad === 0);
    assert('overrides file has a schemaVersion', typeof overridesDoc.schemaVersion === 'number');
}

console.log(`\neffect-overrides: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
