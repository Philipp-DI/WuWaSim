/**
 * Damage instances a Resonance Chain ADDS, which no display row mentions.
 *
 *   node tests/chain-extra-hits.test.mjs
 *
 * The game ships them as bullets marked 共鸣N whose damage rows are already in
 * `damageTable` — `matchRowHits` never attaches them to a skill key, because
 * the kit's display rows describe an S0 build. 111 such rows exist across 20
 * resonators, so the shape matters well beyond the one character shipped here.
 *
 * WHAT THIS FILE GUARDS. Two opposite failures, and the second is the dangerous
 * one:
 *   1. an addition silently contributing nothing (the bug being fixed), and
 *   2. a REPLACEMENT being added on top of the hit it replaces, which inflates
 *      a character instead of merely understating them.
 * Most chain-marked bullets are replacements — 84 of 106 measured — so the
 * classifier refusing is the normal, correct outcome, and the ratchet below
 * pins that only kit-verified entries ever ship.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { buildChainExtraHits, stripChainMarker } from '../tools/preprocess/chain-extra-hits.mjs';
import { chainExtraHitsFor } from '../src/core/skill.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── The shipped data ─────────────────────────────────────────────────────────
{
    const all = Object.values(dataset.chainExtraHits ?? {}).flat();
    assert('the dataset carries chain-added hits', all.length > 0);
    assert('every shipped entry cites the kit text that confirms it',
        all.every(entry => typeof entry.note === 'string' && entry.note.length > 40));
    assert('every entry names a real skill key', all.every(entry =>
        dataset.autoSkillMap?.[Object.keys(dataset.chainExtraHits).find(rid =>
            dataset.chainExtraHits[rid].includes(entry))]?.[entry.skillKey] != null));
    assert('every entry resolves to a damage row', all.every(entry => {
        const rid = Object.keys(dataset.chainExtraHits).find(id => dataset.chainExtraHits[id].includes(entry));
        return (dataset.damageTable?.[rid] ?? []).some(row => row.id === entry.damageId);
    }));
    assert('every count is a positive integer', all.every(entry => Number.isInteger(entry.count) && entry.count > 0));
}

// ── Xiangli Yao: the worked case, confirmed three independent ways ───────────
{
    const entries = dataset.chainExtraHits?.['1305'] ?? [];
    const rows = dataset.damageTable['1305'];
    const s1 = entries.find(entry => entry.chain === 1);
    const s6 = entries.find(entry => entry.chain === 6);
    assert('S1 attaches six Convolution Matrices to Law of Reigns',
        s1?.count === 6 && s1.skillKey === 'forte_heavy_law_of_reigns' && s1.damageId === 1305053101);

    // 1. The kit says "8% of the skill's DMG Multiplier"; Law of Reigns' own
    //    hits sum to 3.21 (4 x 0.4815 + 1.284) and the matrix row is 0.2568.
    const matrix = rows.find(row => row.id === 1305053101);
    const parent = 4 * rows.find(row => row.id === 1305053001).mults[0]
        + rows.find(row => row.id === 1305053002).mults[0];
    assert('the matrix multiplier is exactly 8% of Law of Reigns\' total',
        Math.abs(matrix.mults[0] - 0.08 * parent) < 1e-9);

    // 2. S6 states "+76% DMG Multiplier of Law of Reigns", and its matrix row
    //    is exactly 1.76x the S1 one — so it is the SAME six hits, upgraded.
    // (to the precision the game ships: its rates are integers in 1/10000,
    //  2568 -> 4520, so the ratio lands at 1.76012 rather than dead on)
    const upgraded = rows.find(row => row.id === 1305053201);
    assert('the S6 matrix row is +76% of the S1 one',
        Math.abs(upgraded.mults[0] / matrix.mults[0] - 1.76) < 1e-3);

    // 3. …which means it must SUPERSEDE, never stack.
    const at = (chain) => chainExtraHitsFor(entries, chain, 'forte_heavy_law_of_reigns');
    assert('S0 gets no extra hits', at(0).length === 0);
    assert('S1 gets the S1 row', at(1).length === 1 && at(1)[0].damageId === 1305053101);
    assert('S5 still gets the S1 row (S6 is not unlocked)', at(5)[0].damageId === 1305053101);
    assert('S6 gets the S6 row ONLY — six hits, not twelve',
        at(6).length === 1 && at(6)[0].damageId === 1305053201 && at(6)[0].count === 6);
    assert('S6 supersedes rather than adds',
        at(6).reduce((sum, entry) => sum + entry.count, 0) === 6);
    assert('a different skill key gets nothing', at(6, 'basic_1').length >= 0
        && chainExtraHitsFor(entries, 6, 'basic_1').length === 0);
    void s6;
}

// ── The classifier: additions in, replacements out ───────────────────────────
{
    const hitMap = { 9001: { skill_x: ['9001010001'] } };
    const damageTable = { 9001: [{ id: '9001010001', mults: [1] }, { id: '9001010101', mults: [1] },
        { id: '9001010201', mults: [1] }] };

    // An UPGRADE: its base sibling exists under the same name, so it replaces.
    const replacement = buildChainExtraHits({
        bulletNames: { 9001010001: '大招-终结', 9001010101: '大招-终结-共鸣2' },
        bulletDamageIds: { 9001010001: ['9001010001'], 9001010101: ['9001010201'] },
        hitMap, damageTable,
    });
    assert('a chain bullet whose base sibling exists is NOT added',
        (replacement.extras['9001'] ?? []).length === 0);

    // An ADDITION with no base sibling is still refused until the kit confirms.
    const unconfirmed = buildChainExtraHits({
        bulletNames: { 9001010001: '大招-终结', 9001010101: '额外子弹-共鸣2' },
        bulletDamageIds: { 9001010001: ['9001010001'], 9001010101: ['9001010201'] },
        hitMap, damageTable,
    });
    assert('an unconfirmed addition candidate is refused, not shipped',
        (unconfirmed.extras['9001'] ?? []).length === 0
        && unconfirmed.skipped.some(row => row.reason === 'candidate not confirmed by kit text'));

    // A row already attached to a skill key must never be counted twice.
    const already = buildChainExtraHits({
        bulletNames: { 9001010101: '額外-共鸣2' },
        bulletDamageIds: { 9001010101: ['9001010001'] },
        hitMap, damageTable,
    });
    assert('a damage id already on a skill key is not re-added',
        (already.extras['9001'] ?? []).length === 0);
}

// ── stripChainMarker keeps what distinguishes two siblings ───────────────────
{
    assert('the chain marker is removed', stripChainMarker('大招-终结-共鸣2') === '大招-终结');
    assert('parenthesised markers are removed', stripChainMarker('伤害-E技能(共鸣3)') === '伤害-E技能');
    // Trailing DIGITS survive: 子魔方1 and 子魔方2 are different sub-cubes, and
    // collapsing them would call the second a replacement of the first.
    assert('a trailing index is NOT stripped',
        stripChainMarker('子魔方1-共鸣1') === '子魔方1'
        && stripChainMarker('子魔方2-共鸣1') === '子魔方2');
}

console.log(`chain-extra-hits: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
