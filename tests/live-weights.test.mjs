/**
 * Live stat weights — per-build perturbation + echo upgrade ranking.
 *
 *   node tests/live-weights.test.mjs
 *
 * Runs against real wuwa-data.json + a real rotation, so the perturbation
 * exercises the actual sim (CLAUDE.md policy).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { liveSubstatValues, echoUpgradeRanking, substatKeyOf } from '../src/core/live-weights.js';
import { createBuild, setWeapon, setEcho } from '../src/core/build.js';
import { PROP } from '../src/core/stats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
d.statRanges = JSON.parse(readFileSync(resolve(__dirname, '../data/stat-ranges.json'), 'utf8'))?.stat_ranges ?? {};
const resoOf = (id) => d.resonators.find(r => r.id === id);

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Build a realistic Carlotta with a "junk" echo in slot 1 (HP%/DEF%/flat ATK).
function carlottaBuild() {
    let b = setWeapon(createBuild(resoOf(1107)), 21030036);
    const rot = meta.characters['1107'].referenceRotation;
    b = { ...b, rotation: rot, rotationMeta: rot.map(() => ({})) };
    const main = (cost, propId, value, addType = 1) => ({ propId, addType, value, isPercent: true });
    const sub = (propId, addType, value) => ({ propId, addType, value, isPercent: true });
    const echoes = [
        { cost: 4, main: main(4, PROP.CRIT_DMG, 44), subs: [sub(PROP.CRIT_RATE, 1, 7.8), sub(PROP.CRIT_DMG, 1, 15.6), sub(PROP.ATK_RATIO, 2, 9), sub(PROP.ENERGY_REGEN, 1, 9.2)] },
        { cost: 3, main: main(3, 22, 30), subs: [sub(PROP.HP_RATIO, 2, 9), sub(PROP.DEF_RATIO, 2, 9), sub(PROP.ATK_FLAT, 1, 40), sub(PROP.ENERGY_REGEN, 1, 9.2)] }, // junk
        { cost: 3, main: main(3, PROP.ATK_RATIO, 30, 2), subs: [sub(PROP.CRIT_RATE, 1, 7.8), sub(PROP.CRIT_DMG, 1, 15.6), sub(PROP.DMG_SKILL, 1, 9)] },
        { cost: 1, main: main(1, PROP.ATK_RATIO, 18, 2), subs: [sub(PROP.CRIT_DMG, 1, 15.6), sub(PROP.ATK_RATIO, 2, 9)] },
        { cost: 1, main: main(1, PROP.ATK_RATIO, 18, 2), subs: [sub(PROP.CRIT_RATE, 1, 7.8)] },
    ];
    echoes.forEach((e, i) => { b = setEcho(b, i, { id: null, cost: e.cost, level: 25, sonataId: 1, mainStat: e.main, subStats: e.subs }); });
    return b;
}

// ── liveSubstatValues: ranked per-roll damage gains at the user's stats ───────
{
    const b = carlottaBuild();
    const live = liveSubstatValues(b, d);
    assert('returns a value set for a simmable build', live && Array.isArray(live.values) && live.values.length > 0);
    assert('values are normalized to a top of 100', Math.abs(live.values[0].normalized - 100) < 1e-6);
    assert('values are sorted descending by gain', live.values.every((v, i) => i === 0 || live.values[i - 1].gain >= v.gain));
    assert('every value carries a label + positive gain', live.values.every(v => typeof v.label === 'string' && v.gain > 0));
    // Carlotta is a Skill carry → Resonance Skill DMG should carry real value,
    // and the off-element/off-type bonuses should not appear (zero gain dropped).
    assert('Resonance Skill DMG is among the live values', live.values.some(v => v.key === 'dmgBonus.skill'));
    assert('Crit Rate and Crit DMG both valued', live.values.some(v => v.key === 'critRate') && live.values.some(v => v.key === 'critDmg'));

    // Not simmable → null (no rotation / no echoes).
    const noRot = setWeapon(createBuild(resoOf(1107)), 21030036);
    assert('no rotation → null (not simmable)', liveSubstatValues(noRot, d) === null);
    assert('no echoes → null', liveSubstatValues({ ...carlottaBuild(), echoes: [null, null, null, null, null] }, d) === null);
}

// ── echoUpgradeRanking: worst echo = the junk slot ───────────────────────────
{
    const b = carlottaBuild();
    const er = echoUpgradeRanking(b, d);
    assert('returns per-echo + worstSlot', er && Array.isArray(er.perEcho) && er.worstSlot != null);
    assert('worst echo is the HP/DEF/flat junk slot (1)', er.worstSlot === 1);
    // The junk echo has the most headroom; a fully-crit echo has less.
    const junk = er.perEcho[1], good = er.perEcho[2];
    assert('junk echo has more headroom than a crit echo', junk.headroom > good.headroom);
    assert('junk echo substats sum to ~zero value', junk.substatValue < good.substatValue);
}

// ── substatKeyOf maps real propIds ───────────────────────────────────────────
{
    assert('Crit Rate propId maps to critRate', substatKeyOf(PROP.CRIT_RATE) === 'critRate');
    assert('Crit DMG propId maps to critDmg', substatKeyOf(PROP.CRIT_DMG) === 'critDmg');
    assert('Skill DMG propId maps to dmgBonus.skill', substatKeyOf(PROP.DMG_SKILL) === 'dmgBonus.skill');
    assert('off-stat (HP%) maps to null', substatKeyOf(PROP.HP_RATIO) === null);
}

console.log(`\nlive-weights: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
