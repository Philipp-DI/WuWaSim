/**
 * Team Effect Model — L3 team-wide buff propagation (P13).
 *
 * A buff GRANTED TO "all team members" reaches every member; a personal buff (or
 * a self buff gated on a team CONDITION) does not. Solo path unchanged.
 *
 *   node tests/team-buffs.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { isTeamWideBuff, teamWideContribution, mergeTeamBundles } from '../src/core/buffs.js';
import { resolveTotalStats, PROP } from '../src/core/stats.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createBuild, setEcho } from '../src/core/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
const reso = (id) => d.resonators.find(r => r.id === id);
const TARGET = { level: 90, atkLv: 90, resistances: {} };

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

function build(id, sonataId, rot = null, chain = 0) {
    let b = { ...createBuild(reso(id)), chain };
    for (let i = 0; i < 5; i++) b = setEcho(b, i, { id: null, cost: [4, 3, 3, 1, 1][i], level: 25, sonataId,
        mainStat: { propId: PROP.CRIT_DMG, addType: 1, value: 44, isPercent: true }, subStats: [] });
    if (rot) b = { ...b, rotation: rot, rotationMeta: rot.map(() => ({})), id };
    return b;
}

// ── recipient vs actor classification ────────────────────────────────────────
{
    assert('"all team members\' ATK" → team-wide', isTeamWideBuff("After Intro Skill is cast, all team members' ATK is increased by 20% for 30s."));
    assert('"DMG Bonus of all team members" → team-wide', isTeamWideBuff('Outro Skill increases the Glacio DMG Bonus of all team members by 20%.'));
    assert('"Resonators in the team gain" → team-wide', isTeamWideBuff('All nearby Resonators in the team gain Crit. DMG increase'));
    assert('"Resonators in the team INFLICT … Aemeath\'s Crit DMG" → NOT team-wide (self buff, team condition)',
        !isTeamWideBuff("when Resonators in the team inflict Fusion Burst, Aemeath's Crit. DMG is increased by 60%"));
    assert('a plain self buff is not team-wide', !isTeamWideBuff('Crit. DMG is increased by 30%.'));
}

// ── teamWideContribution: recipient buffs only, mode/sequence gated ───────────
{
    const changli = teamWideContribution(build(1205, 2, null, 6), reso(1205));   // S4 unlocked at seq 6
    assert('Changli grants +20% team ATK at S4', Math.abs(changli.atkRatio - 0.2) < 1e-9);
    const changliS0 = teamWideContribution(build(1205, 2, null, 0), reso(1205)); // S4 locked at seq 0
    assert('Changli grants nothing at S0 (sequence-gated)', changliS0.atkRatio === 0);
    const carlotta = teamWideContribution(build(1107, 1, null, 6), reso(1107));
    assert('Carlotta grants no team buff (her kit is personal)', carlotta.atkRatio === 0 && Object.keys(carlotta.dmgByElement).length === 0);
}

// ── resolveTotalStats folds an external team bundle ──────────────────────────
{
    const carl = build(1107, 1);
    const base = resolveTotalStats(carl, d).atk;
    const buffed = resolveTotalStats(carl, d, null, { atkRatio: 0.2 }).atk;
    assert('external team ATK raises resolved ATK', buffed > base * 1.1);
    assert('null team bundle = solo (unchanged)', resolveTotalStats(carl, d, null, null).atk === base);
}

// ── mergeTeamBundles sums element/skill/atk buckets ──────────────────────────
{
    const m = mergeTeamBundles([{ atkRatio: 0.2, dmgByElement: { 1: 0.1 } }, { atkRatio: 0.1, dmgByElement: { 1: 0.05, 2: 0.2 } }]);
    assert('merge sums atkRatio', Math.abs(m.atkRatio - 0.3) < 1e-9);
    assert('merge sums per-element', Math.abs(m.dmgByElement[1] - 0.15) < 1e-9 && Math.abs(m.dmgByElement[2] - 0.2) < 1e-9);
}

// ── integration: a teammate's team-ATK lifts the carry; personal does not ─────
{
    const carl = build(1107, 1, meta.characters['1107'].referenceRotation);
    const jinhsi = build(1304, 5, meta.characters['1304'].referenceRotation);
    const carlDmg = (changliSeq) => {
        const changli = build(1205, 2, meta.characters['1205'].referenceRotation, changliSeq);
        const blds = { 1205: changli, 1107: carl, 1304: jinhsi };
        const r = simulateTeamRotation({ team: { slots: [1205, 1107, 1304] }, resolveBuild: (id) => blds[id], dataset: d, target: TARGET });
        return r.memberTotals.find(m => m.resonatorId === 1107).damage;
    };
    assert('Changli S4 (+team ATK) lifts Carlotta over Changli S0', carlDmg(4) > carlDmg(0) * 1.05);
}

console.log(`\nteam-buffs: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
