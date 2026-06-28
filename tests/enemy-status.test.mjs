/**
 * Enemy negative-status timeline — per-cast accrual, decay, gating queries (P13 L1).
 *
 *   node tests/enemy-status.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
    STATUS_KEYS, NEGATIVE_STATUS_DEFS, statusKeyForm, statusSpaceForm,
    statusesInflictedBy, applicationsFromSteps, buildEnemyStatusTimeline,
    distinctApplicators, computeNegativeStatusDamage, computeTuneBreakDamage,
} from '../src/core/enemy-status.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const resoOf = (id) => d.resonators.find(r => r.id === id);

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── key/space-form round trip ────────────────────────────────────────────────
{
    assert('space↔key form round-trips', statusKeyForm(statusSpaceForm('glacio_chafe')) === 'glacio_chafe');
    assert('all defs cover all status keys', STATUS_KEYS.every(k => NEGATIVE_STATUS_DEFS[k]));
}

// ── inflictor detection (mode + kit) ─────────────────────────────────────────
{
    // Lucilla (1109) in glacio_chafe mode inflicts glacio_chafe.
    const lucilla = statusesInflictedBy(resoOf(1109), d, 'glacio_chafe');
    assert('Lucilla(glacio_chafe mode) inflicts glacio_chafe', lucilla.has('glacio_chafe'));
    // Hiyuki (1108) inflicts Glacio Chafe via kit even with no mode.
    const hiyuki = statusesInflictedBy(resoOf(1108), d, null);
    assert('Hiyuki inflicts glacio_chafe from kit', hiyuki.has('glacio_chafe'));
    // Carlotta (1107) inflicts no negative status.
    const carlotta = statusesInflictedBy(resoOf(1107), d, null);
    assert('Carlotta inflicts no status', carlotta.size === 0);
    // Aemeath (1210) in fusion_burst mode inflicts fusion_burst.
    const aemeath = statusesInflictedBy(resoOf(1210), d, 'fusion_burst');
    assert('Aemeath(fusion_burst mode) inflicts fusion_burst', aemeath.has('fusion_burst'));
}

// ── per-cast accrual + cap (no-decay status: glacio_chafe) ───────────────────
{
    const steps = [0, 1, 2, 3].map(t => ({ startTime: t, stepDamage: 100 }));
    const apps = applicationsFromSteps(steps, new Set(['glacio_chafe']), 1108);
    assert('one application per damaging step', apps.length === 4);
    const tl = buildEnemyStatusTimeline(apps);
    assert('stacks accrue per cast (t=0 → 1)', tl.statusStacksAt('glacio_chafe', 0) === 1);
    assert('stacks accrue per cast (t=2 → 3)', tl.statusStacksAt('glacio_chafe', 2) === 3);
    assert('no decay → persists after last cast', tl.statusStacksAt('glacio_chafe', 100) === 4);
    assert('absent before first application is 0', tl.statusStacksAt('fusion_burst', 0) === 0);
}

// ── cap is respected (havoc_bane max 3) ──────────────────────────────────────
{
    const steps = [0, 1, 2, 3, 4].map(t => ({ startTime: t, stepDamage: 50 }));
    const tl = buildEnemyStatusTimeline(applicationsFromSteps(steps, new Set(['havoc_bane']), 1508));
    assert('havoc_bane caps at maxStacks 3', tl.statusStacksAt('havoc_bane', 10) === 3);
}

// ── decay (spectro_frazzle loses 1 stack / 3s) ───────────────────────────────
{
    // 3 applications at t=0,1,2 → 3 stacks; then decay 1 per 3s after last (t=2).
    const steps = [0, 1, 2].map(t => ({ startTime: t, stepDamage: 50 }));
    const tl = buildEnemyStatusTimeline(applicationsFromSteps(steps, new Set(['spectro_frazzle']), 1506));
    assert('frazzle at 3 stacks right after last cast', tl.statusStacksAt('spectro_frazzle', 2) === 3);
    assert('frazzle decays 1 stack by t=5 (3s after last)', tl.statusStacksAt('spectro_frazzle', 5) === 2);
    assert('frazzle fully decays by t=11', tl.statusStacksAt('spectro_frazzle', 11) === 0);
}

// ── presence queries + persistence across a gap ──────────────────────────────
{
    const apps = applicationsFromSteps([{ startTime: 5, stepDamage: 10 }], new Set(['glacio_chafe']), 1109);
    const tl = buildEnemyStatusTimeline(apps);
    assert('not present before first application', !tl.presentDuring('glacio_chafe', 0, 4));
    assert('present in a window after application (persists)', tl.presentDuring('glacio_chafe', 10, 20));
    assert('presentStatusesAt collects active statuses', tl.presentStatusesAt(10).has('glacio_chafe'));
    assert('lastApplicatorAt tracks the applicator', tl.lastApplicatorAt('glacio_chafe', 10)?.applicatorId === 1109);
}

// ── no applications → empty timeline ─────────────────────────────────────────
{
    const tl = buildEnemyStatusTimeline([]);
    assert('empty timeline → 0 stacks', tl.statusStacksAt('glacio_chafe', 5) === 0);
    assert('empty timeline → nothing present', tl.presentStatusesAt(5).size === 0);
}

// ── distinctApplicators (Snow Rust-style per-applicator dedup) ────────────────
{
    const apps = [
        { t: 1, status: 'glacio_chafe', applicatorId: 1109 },
        { t: 2, status: 'glacio_chafe', applicatorId: 1109 },   // same applicator again — no new count
        { t: 3, status: 'havoc_bane',   applicatorId: 1508 },
        { t: 10, status: 'glacio_chafe', applicatorId: 1108 },  // after t=5, shouldn't count at t=5
    ];
    const at5 = distinctApplicators(apps, ['glacio_chafe', 'havoc_bane'], 5);
    assert('distinctApplicators dedups repeats from the same resonator', at5.size === 2);
    assert('distinctApplicators includes both qualifying statuses', at5.has(1109) && at5.has(1508));
    assert('distinctApplicators excludes applications after t', !at5.has(1108));
}

// ── computeNegativeStatusDamage — calibrated against real worked examples ────
// Source: community-reverse-engineered formula (no official doc exists),
// verified against 3 independent in-game-calculator examples (Hiyuki, lvl 90,
// Glacio Chafe). The 12%-shred case is ALSO an independent cross-check of our
// existing Havoc Bane model (6 stacks × 2%/stack = 12%).
{
    const baseTarget = { level: 90, resistances: { 1: 0.10 } };
    const d1 = computeNegativeStatusDamage({ status: 'glacio_chafe', stacks: 7, atkLv: 90, target: { ...baseTarget, defShred: 0.12 } });
    assert('7 stacks, 12% DEF-shred ≈ 2540 (real example)', Math.abs(d1 - 2540) / 2540 < 0.001);

    const d2 = computeNegativeStatusDamage({ status: 'glacio_chafe', stacks: 1, atkLv: 90, target: { ...baseTarget, defShred: 0 } });
    assert('1 stack, 0% DEF-shred ≈ 407 (real example)', Math.abs(d2 - 407) / 407 < 0.005);

    const d3 = computeNegativeStatusDamage({ status: 'glacio_chafe', stacks: 10, atkLv: 90, target: { ...baseTarget, defShred: 0 } });
    assert('10 stacks (max), 0% DEF-shred ≈ 3378 (real example)', Math.abs(d3 - 3378) / 3378 < 0.001);

    assert('damage scales monotonically with stack count', d3 > d1 && d1 > d2);
    assert('unknown status → 0, no throw', computeNegativeStatusDamage({ status: 'fusion_burst', stacks: 5, target: baseTarget }) === 0);
    assert('missing target → 0, no throw', computeNegativeStatusDamage({ status: 'glacio_chafe', stacks: 5, target: null }) === 0);
}

// ── computeTuneBreakDamage — calibrated against one real worked example ──────
// Source: same community formula family. Hiyuki, lvl 90, Glacio element,
// Overlord-class enemy (Enemy Type Multiplier 14), 12% DEF-shred (the same
// 6-stack Havoc Bane cross-check as the Glacio Chafe example).
{
    const target = { level: 90, defShred: 0.12, resistances: { 1: 0.10 } };
    const d = computeTuneBreakDamage({ status: 'tune_rupture', atkLv: 90, target, element: 1, enemyType: 'overlord' });
    assert('Tune Rupture, Overlord, 12% shred ≈ 76993 (real example)', Math.abs(d - 76993) / 76993 < 0.001);

    assert('tune_strain shares the same constant as tune_rupture', computeTuneBreakDamage({ status: 'tune_strain', atkLv: 90, target, element: 1, enemyType: 'overlord' }) === d);

    const commonD = computeTuneBreakDamage({ status: 'tune_rupture', atkLv: 90, target, element: 1, enemyType: 'common' });
    assert('Common-class enemy takes 14x less than Overlord (multiplier 1 vs 14)', Math.abs(d / commonD - 14) < 1e-9);

    assert('unknown enemyType → 0, no throw', computeTuneBreakDamage({ status: 'tune_rupture', target, enemyType: 'boss' }) === 0);
    assert('missing target → 0, no throw', computeTuneBreakDamage({ status: 'tune_rupture', target: null }) === 0);
}

console.log(`\nenemy-status: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
