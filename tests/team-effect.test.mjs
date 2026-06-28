/**
 * Team Effect Model — L2 team-aware triggerability, self vs enemy scope (P13).
 *
 * A status gate is satisfiable by a teammate ONLY for enemy-state / team-inflict
 * phrasing ("targets under X", "the team inflicts X") — NEVER a SELF-inflict
 * clause ("Inflicting X on enemies"), which the wielder must perform personally
 * (e.g. Wishes' Snowfall requires the wielder to inflict Glacio Chafe). Solo path
 * stays own-kit gated.
 *
 *   node tests/team-effect.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { resolveTotalStats, PROP } from '../src/core/stats.js';
import { simulateRotation } from '../src/core/sim.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { statusGateScope } from '../src/core/triggerability.js';
import { statusesInflictedBy } from '../src/core/enemy-status.js';
import { createBuild, setEcho, setWeapon } from '../src/core/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
const rots = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));
const resoOf = (id) => d.resonators.find(r => r.id === id);
const TARGET = { level: 90, atkLv: 90, resistances: {} };

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

function buildOn(id, sonataId, rotation = null, weaponId = null) {
    let b = createBuild(resoOf(id));
    if (weaponId != null) b = setWeapon(b, weaponId);
    for (let i = 0; i < 5; i++) b = setEcho(b, i, { id: null, cost: [4, 3, 3, 1, 1][i], level: 25, sonataId,
        mainStat: { propId: PROP.CRIT_DMG, addType: 1, value: 44, isPercent: true }, subStats: [] });
    if (rotation) b = { ...b, rotation, rotationMeta: rotation.map(() => ({})) };
    return b;
}

// ── scope classification ─────────────────────────────────────────────────────
{
    assert('"Inflicting Glacio Chafe on enemies" → self', statusGateScope('Inflicting Glacio Chafe on enemies increases Glacio DMG') === 'self');
    assert('"targets under Tune Strain" → enemy', statusGateScope('Dealing damage to targets under Tune Strain - Interfered') === 'enemy');
    assert('"hitting a target with Aero Erosion" → enemy', statusGateScope('Hitting a target with Aero Erosion increases Crit. Rate') === 'enemy');
    assert('"Resonators in the team inflict Fusion Burst" → team', statusGateScope('when Resonators in the team inflict Fusion Burst') === 'team');
}

// ── SELF-inflict (Wishes): a teammate's Chafe must NOT un-gate it ────────────
{
    const carlotta = buildOn(1107, 30);                       // cannot inflict Glacio Chafe
    const solo = resolveTotalStats(carlotta, d).critRate;
    const team = resolveTotalStats(carlotta, d, new Set(['glacio_chafe'])).critRate;
    assert('Wishes (self-inflict) NOT un-gated by team Chafe for a non-inflictor', Math.abs(team - solo) < 1e-9);
    // The inflictor (Hiyuki) DOES get it — own kit — and team context doesn't double-count.
    const hiyuki = buildOn(1108, 30);
    const hSolo = resolveTotalStats(hiyuki, d).critRate;
    assert('Wishes IS active for an inflictor solo (own kit)', hSolo > 0.3);
}

// ── ENEMY-state (Windward Pilgrimage, Aero Erosion): team DOES un-gate ────────
{
    const wind = d.sonatas.find(s => /windward pilgrimage/i.test(s.name));
    const carlotta = buildOn(1107, wind.id);                  // cannot inflict Aero Erosion
    const solo = resolveTotalStats(carlotta, d).critRate;
    const team = resolveTotalStats(carlotta, d, new Set(['aero_erosion'])).critRate;
    assert('Windward (enemy-state) IS un-gated by a teammate applying Aero Erosion', team - solo > 0.05);
    // a different status does NOT un-gate it
    const wrong = resolveTotalStats(carlotta, d, new Set(['spectro_frazzle'])).critRate;
    assert('a non-matching team status does not un-gate', Math.abs(wrong - solo) < 1e-9);
}

// ── integration: team sim threads the timeline (enemy-state weapon) ───────────
{
    const rc = d.weapons.find(w => /radiance cleaver/i.test(w.name));   // "targets under Tune Strain"
    const chisa = resoOf(1508);
    assert('Radiance Cleaver fits Chisa weapon type', rc.type === chisa.weaponType);
    assert('Chisa does not inflict Tune Strain herself', !statusesInflictedBy(chisa, d, null).has('tune_strain'));

    const chisaRc = buildOn(1508, 6, rots['1508'].rotation, rc.id);
    const dSolo = simulateRotation({ build: chisaRc, dataset: d, target: TARGET }).totals.damage;

    // Denia in tune_strain mode applies Tune Strain; place her FIRST so it persists.
    const denia = { ...buildOn(1211, 2, rots['1211'].rotation), resonanceMode: 'tune_strain' };
    const builds = { 1211: { ...denia, id: 1211 }, 1508: { ...chisaRc, id: 1508 } };
    const res = simulateTeamRotation({ team: { slots: [1211, 1508] }, resolveBuild: (id) => builds[id], dataset: d, target: TARGET });
    const chisaInTeam = res.memberTotals.find(m => m.resonatorId === 1508);
    assert('enemy-state weapon un-gated in a team with a Tune-Strain applier (> solo)',
        (chisaInTeam.damage + (chisaInTeam.introDamage ?? 0)) > dSolo);
}

// ── L4 (partial): Havoc Bane DEF shred lifts the whole team ──────────────────
{
    const chisaRot = rots['1508'].rotation;       // Chisa applies Havoc Bane
    const chisa = buildOn(1508, 6, chisaRot);
    const jinhsi = buildOn(1304, 5, meta.characters['1304'].referenceRotation);
    const denia = buildOn(1211, 2, rots['1211'].rotation);
    const builds = { 1508: { ...chisa, id: 1508 }, 1304: { ...jinhsi, id: 1304 }, 1211: { ...denia, id: 1211 } };
    // Jinhsi (no Havoc Bane) AFTER Chisa → benefits from her −DEF; Jinhsi FIRST → not yet.
    const teamA = simulateTeamRotation({ team: { slots: [1508, 1304, 1211] }, resolveBuild: (id) => builds[id], dataset: d, target: TARGET });
    const teamB = simulateTeamRotation({ team: { slots: [1304, 1508, 1211] }, resolveBuild: (id) => builds[id], dataset: d, target: TARGET });
    const jA = teamA.memberTotals.find(m => m.resonatorId === 1304).damage;
    const jB = teamB.memberTotals.find(m => m.resonatorId === 1304).damage;
    assert('Havoc Bane DEF shred lifts a teammate placed after Chisa', jA > jB);
}

console.log(`\nteam-effect: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
