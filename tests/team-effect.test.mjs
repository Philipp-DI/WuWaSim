/**
 * Team Effect Model — L2 team-aware triggerability (P13).
 *
 * A status-conditional buff is un-gated when ANY teammate inflicts the status,
 * not just the wielder's own kit. Solo path stays own-kit gated.
 *
 *   node tests/team-effect.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { resolveTotalStats, PROP } from '../src/core/stats.js';
import { simulateRotation } from '../src/core/sim.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createBuild, setEcho } from '../src/core/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
const resoOf = (id) => d.resonators.find(r => r.id === id);
const TARGET = { level: 90, atkLv: 90, resistances: {} };

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Build a resonator on a given sonata (Wishes = 30, Chafe-gated +25% CR Snowfall).
function buildOn(id, sonataId, rotation = null) {
    let b = createBuild(resoOf(id));
    for (let i = 0; i < 5; i++) b = setEcho(b, i, { id: null, cost: [4, 3, 3, 1, 1][i], level: 25, sonataId,
        mainStat: { propId: PROP.CRIT_DMG, addType: 1, value: 44, isPercent: true }, subStats: [] });
    if (rotation) b = { ...b, rotation, rotationMeta: rotation.map(() => ({})) };
    return b;
}

// ── L2 gating: Wishes' Chafe-gated CR is OFF solo for a non-inflictor, ON with team Chafe ──
{
    const carlotta = buildOn(1107, 30);   // Carlotta cannot inflict Glacio Chafe
    const solo = resolveTotalStats(carlotta, d);
    const team = resolveTotalStats(carlotta, d, new Set(['glacio_chafe']));
    assert('Wishes CR gated OFF solo for a non-inflictor', team.critRate - solo.critRate > 0.2);
    assert('the team un-gate is exactly the +25% Snowfall CR', Math.abs((team.critRate - solo.critRate) - 0.25) < 1e-6);
}

// ── inflictor solo path unchanged: Hiyuki (inflicts Chafe) gets it solo ───────
{
    const hiyuki = buildOn(1108, 30);
    const solo = resolveTotalStats(hiyuki, d);                       // own kit inflicts Chafe
    const team = resolveTotalStats(hiyuki, d, new Set(['glacio_chafe']));
    assert('inflictor already has the buff solo (own kit)', solo.critRate > 0.3);
    assert('team context does not double-credit the inflictor', Math.abs(solo.critRate - team.critRate) < 1e-6);
}

// ── non-Chafe team context does NOT un-gate ──────────────────────────────────
{
    const carlotta = buildOn(1107, 30);
    const wrongStatus = resolveTotalStats(carlotta, d, new Set(['spectro_frazzle']));
    const solo = resolveTotalStats(carlotta, d);
    assert('a different status does not un-gate Wishes', Math.abs(wrongStatus.critRate - solo.critRate) < 1e-6);
}

// ── integration: Carlotta-on-Wishes earns more in a team with a Chafe applier ─
{
    const carlotta = buildOn(1107, 30, meta.characters['1107'].referenceRotation);
    const dSolo = simulateRotation({ build: carlotta, dataset: d, target: TARGET }).totals.damage;

    // Team with Lucilla (Glacio Chafe applier) FIRST so her Chafe persists into
    // Carlotta's window (carry after enabler — the real Glacio-Chafe ordering).
    const lucillaRot = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'))['1109'];
    const lucilla = { ...buildOn(1109, 1, lucillaRot.rotation), resonanceMode: 'glacio_chafe' };
    const jinhsi = buildOn(1304, 5, meta.characters['1304'].referenceRotation);
    const builds = { 1107: { ...carlotta, id: 1107 }, 1109: { ...lucilla, id: 1109 }, 1304: { ...jinhsi, id: 1304 } };
    const res = simulateTeamRotation({ team: { slots: [1109, 1304, 1107] }, resolveBuild: (id) => builds[id], dataset: d, target: TARGET });
    const carlInTeam = res.memberTotals.find(m => m.resonatorId === 1107);
    assert('Carlotta-on-Wishes earns more in a Chafe team than solo', (carlInTeam.damage + (carlInTeam.introDamage ?? 0)) > dSolo);
}

console.log(`\nteam-effect: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
