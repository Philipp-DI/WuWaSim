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
    distinctApplicators, computeNegativeStatusDamage, computeTuneBreakDamage, nsLevelModifier,
    STATUS_CAP_RAISES, capRaisesForResonator, capRaiseWindowsFromSteps,
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

// ── P13-fix: element-gate rejects kit-text false positives ──────────────────
// A status tied to a fixed element can only be inflicted by a resonator of
// that SAME element — the plain kit-text substring scan can't tell "this
// resonator inflicts X" from "this resonator's kit merely NAMES X" (e.g. a
// "removes stacks of ..." clause, or a "when a teammate applies ..." reactive
// trigger). Confirmed false positives before this fix, all element-mismatched.
{
    // Rover: Aero (1406)'s Resonance Skill: "removes all stacks of Spectro
    // Frazzle, Havoc Bane, Fusion Burst, Glacio Chafe, and Electro Flare ...
    // and inflicts 1 stack of Aero Erosion" — only the last is a real inflict.
    const roverAero = statusesInflictedBy(resoOf(1406), d, null);
    assert('Rover: Aero inflicts aero_erosion (real, element-matched)', roverAero.has('aero_erosion'));
    assert('Rover: Aero does NOT inflict glacio_chafe (named only in a "removes" clause)', !roverAero.has('glacio_chafe'));
    assert('Rover: Aero does NOT inflict fusion_burst/electro_flare/spectro_frazzle/havoc_bane',
        !roverAero.has('fusion_burst') && !roverAero.has('electro_flare') && !roverAero.has('spectro_frazzle') && !roverAero.has('havoc_bane'));

    // Cartethyia (1409)'s resonance chain: "After Resonators in the team
    // inflict Havoc Bane, Fusion Burst, ... or Aero Erosion, all Resonators
    // gain 20% DMG Bonus" — a teammate's inflict, not her own.
    const cartethyia = statusesInflictedBy(resoOf(1409), d, null);
    assert('Cartethyia inflicts aero_erosion (real, element-matched)', cartethyia.has('aero_erosion'));
    assert('Cartethyia does NOT inflict glacio_chafe/fusion_burst/electro_flare/spectro_frazzle/havoc_bane',
        !cartethyia.has('glacio_chafe') && !cartethyia.has('fusion_burst') && !cartethyia.has('electro_flare')
        && !cartethyia.has('spectro_frazzle') && !cartethyia.has('havoc_bane'));

    // Hiyuki (1108, Glacio)'s Fine Snow inherent: "When a Resonator in the
    // team applies Glacio Chafe or Havoc Bane, Hiyuki gains a stack" — reacts
    // to Havoc Bane without inflicting it herself.
    const hiyuki = statusesInflictedBy(resoOf(1108), d, null);
    assert('Hiyuki does NOT inflict havoc_bane (element mismatch: she is Glacio)', !hiyuki.has('havoc_bane'));

    // Every genuine, element-matched applier still resolves correctly.
    assert('Phoebe (Spectro) still inflicts spectro_frazzle', statusesInflictedBy(resoOf(1506), d, null).has('spectro_frazzle'));
    assert('Chisa (Havoc) still inflicts havoc_bane', statusesInflictedBy(resoOf(1508), d, null).has('havoc_bane'));
    assert('Lucilla (Glacio) still inflicts glacio_chafe from kit', statusesInflictedBy(resoOf(1109), d, null).has('glacio_chafe'));

    // Roster-wide invariant: no character is ever flagged for an off-element status.
    const ELEMENT_ID_BY_NAME = { glacio: 1, fusion: 2, electro: 3, aero: 4, spectro: 5, havoc: 6 };
    let mismatches = 0;
    for (const resonator of d.resonators) {
        for (const status of statusesInflictedBy(resonator, d, null)) {
            const wantElement = NEGATIVE_STATUS_DEFS[status]?.element;
            if (wantElement && ELEMENT_ID_BY_NAME[wantElement] !== resonator.element) mismatches++;
        }
    }
    assert('no roster-wide element-mismatched status flags remain', mismatches === 0);
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

// -- LevelModifier now comes from the game AbnormalDamageConfig table --------
// The single constant 3674 was reverse-engineered from three worked examples,
// all at level 90. The game ships the whole curve (levels 1-100) and it reads
// 3674 at 90, confirming the calibration exactly; the engine had been treating
// every level as if it were 90.
{
    const table = d.abnormalDamage;
    assert('the dataset carries the abnormal-damage curve', table != null);
    assert('it covers levels 1-100', Object.keys(table?.byLevel ?? {}).length === 100);
    assert('the game agrees with the calibrated level-90 constant', table?.byLevel?.['90'] === 3674);
    assert('the table is element-independent (the flagged assumption, now confirmed)',
        table?.elementIndependent === true);

    assert('nsLevelModifier reads the game curve when given a dataset',
        nsLevelModifier('glacio_chafe', 70, d) === 1005);
    assert('and falls back to the calibrated constant without one',
        nsLevelModifier('glacio_chafe', 70) === 3674);
    assert('Tune Break keeps its own constant (not in the abnormal table)',
        nsLevelModifier('tune_rupture', 70, d) === 716.22);
    assert('an unknown status has no modifier', nsLevelModifier('nonsense', 90, d) === null);

    // At level 90 the two paths must agree exactly, so wiring the dataset
    // through cannot move any committed number.
    const target = { level: 90, resistances: { 1: 0.2 } };
    const pinned = computeNegativeStatusDamage({ status: 'glacio_chafe', stacks: 7, atkLv: 90, target });
    const fromGame = computeNegativeStatusDamage({ status: 'glacio_chafe', stacks: 7, atkLv: 90, target, dataset: d });
    assert('level 90 damage is identical with and without the dataset',
        Math.abs(pinned - fromGame) < 1e-9);

    // Away from 90 the dataset is what makes it right.
    const lv70 = computeNegativeStatusDamage({ status: 'glacio_chafe', stacks: 7, atkLv: 70, target, dataset: d });
    const lv70Old = computeNegativeStatusDamage({ status: 'glacio_chafe', stacks: 7, atkLv: 70, target });
    assert('a level-70 inflicter deals less than the level-90 model claimed', lv70 < lv70Old);
    assert('and scales by exactly the table ratio',
        Math.abs(lv70 / lv70Old - 1005 / 3674) < 1e-9);
}

// ── Per-kit stack-limit RAISES ─────────────────────────────────────────────
// NEGATIVE_STATUS_DEFS.maxStacks is the BASE an enemy holds; kits lift it for a
// window. Yangyang: Xuanling's S3 raises Havoc Bane by 3 for 20s, which is what
// makes her own 4-6 stack band reachable at all — without it the base cap of 3
// forbids the band, and the base cap is CORRECT.
{
    const apps = Array.from({ length: 8 }, (_, i) => (
        { status: 'havoc_bane', t: i * 1.0, applicatorId: 1610, applicatorLevel: 90 }));
    const raise = [{ status: 'havoc_bane', amount: 3, start: 0.5, end: 20.5, source: '1610:havoc_bane' }];

    const base = buildEnemyStatusTimeline(apps);
    const lifted = buildEnemyStatusTimeline(apps, raise);

    assert('without a raise the enemy stops at the base cap of 3',
        base.statusStacksAt('havoc_bane', 7) === 3);
    assert('a raise lifts the cap while its window is open',
        lifted.capAt('havoc_bane', 2) === 6);
    assert('...so stacks climb past the base', lifted.statusStacksAt('havoc_bane', 6) === 6);
    assert('the 4-6 band becomes reachable, which is the whole point',
        lifted.statusStacksAt('havoc_bane', 4) >= 4);

    assert('once the window lapses the cap returns to base',
        lifted.capAt('havoc_bane', 25) === 3);
    assert('...and the enemy can no longer be HOLDING the excess',
        lifted.statusStacksAt('havoc_bane', 25) === 3);

    // "This effect does not stack" — repeats of one source refresh, never add.
    const repeated = buildEnemyStatusTimeline(apps,
        [...raise, { status: 'havoc_bane', amount: 3, start: 1, end: 21, source: '1610:havoc_bane' }]);
    assert('the same source twice does not stack its raise',
        repeated.capAt('havoc_bane', 2) === 6);

    // Two different kits raising the same status DO sum.
    const twoKits = buildEnemyStatusTimeline(apps,
        [...raise, { status: 'havoc_bane', amount: 3, start: 1, end: 21, source: '9999:havoc_bane' }]);
    assert('two distinct sources sum their raises', twoKits.capAt('havoc_bane', 2) === 9);

    // A raise for another status leaves this one alone.
    const other = buildEnemyStatusTimeline(apps,
        [{ status: 'aero_erosion', amount: 3, start: 0, end: 30, source: 'x' }]);
    assert('a raise on a different status does not leak', other.capAt('havoc_bane', 2) === 3);
    assert('no raises at all behaves exactly as before',
        buildEnemyStatusTimeline(apps, []).statusStacksAt('havoc_bane', 7) === 3);
}

// ── Raises are chain-gated and armed by real casts ─────────────────────────
{
    assert('Xuanling has no raise below S3', capRaisesForResonator(1610, 0).length === 0);
    assert('...and exactly one at S3', capRaisesForResonator(1610, 3).length === 1);
    assert('...still one at S6 (a skill tree stays unlocked)', capRaisesForResonator(1610, 6).length === 1);
    assert('a resonator with no raises returns empty', capRaisesForResonator(1102, 6).length === 0);

    const steps = [
        { skillKey: 'basic_azure_sword_stance_1', endTime: 1 },
        { skillKey: 'intro_skybound_feather', endTime: 2 },
        { skillKey: 'forte_heavy_sword_stance_flow_azure', endTime: 5 },
    ];
    const windows = capRaiseWindowsFromSteps(steps, 1610, 3);
    assert('only the triggering casts arm a window', windows.length === 2);
    assert('a window opens at the END of its cast', windows[0].start === 2);
    assert('...and runs for the stated 20s', windows[0].end === 22);
    assert('windows from one kit share a source, so they refresh rather than add',
        windows[0].source === windows[1].source);
    assert('below the chain requirement nothing arms',
        capRaiseWindowsFromSteps(steps, 1610, 2).length === 0);
}

// ── Data integrity: every curated raise references real keys and statuses ──
{
    for (const [idString, raises] of Object.entries(STATUS_CAP_RAISES)) {
        const skillMap = d.autoSkillMap[idString];
        assert(`STATUS_CAP_RAISES ${idString}: the resonator has a skill map`, !!skillMap);
        for (const raise of raises) {
            assert(`STATUS_CAP_RAISES ${idString}: '${raise.status}' is a real status`,
                NEGATIVE_STATUS_DEFS[raise.status] != null);
            assert(`STATUS_CAP_RAISES ${idString}: amount is positive`, raise.amount > 0);
            assert(`STATUS_CAP_RAISES ${idString}: duration is positive`, raise.seconds > 0);
            assert(`STATUS_CAP_RAISES ${idString}: quotes its kit sentence`,
                typeof raise.note === 'string' && raise.note.length > 20);
            assert(`STATUS_CAP_RAISES ${idString}: names at least one trigger key`,
                (raise.keys ?? []).length > 0);
            for (const key of raise.keys ?? []) {
                assert(`STATUS_CAP_RAISES ${idString}: trigger key ${key} exists`, !!skillMap?.[key]);
            }
        }
    }
}

console.log(`\nenemy-status: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
