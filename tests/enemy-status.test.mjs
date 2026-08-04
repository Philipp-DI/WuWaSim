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
    capRaiseGateWindows, capRaiseWindowsFromInflicts,
    resolveStatusOverTimeDamage, statusDamageGaps, statusHasDamageModel,
    afflictionTriggerFor, markStacksAt, resolveAfflictionTriggers, computeAfflictionDamage,
    afflictionCritMultiplier, soloStatusDamage, stackMvTable, statusApplyRules, statusBurstRules,
    markEventsFor,
} from '../src/core/enemy-status.js';
import { stateDefsForResonator } from '../src/core/rotation-rules.js';
import { computeStateTimeline, stateActive } from '../src/core/rotation-state.js';
import { resolveChainInherentContext } from '../src/core/buffs.js';
import { simulateRotation } from '../src/core/sim.js';

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

// ── per-cast accrual + stack lifetime (glacio_chafe) ─────────────────────────
{
    const steps = [0, 1, 2, 3].map(t => ({ startTime: t, stepDamage: 100 }));
    const apps = applicationsFromSteps(steps, new Set(['glacio_chafe']), 1108);
    assert('one application per damaging step', apps.length === 4);
    const tl = buildEnemyStatusTimeline(apps);
    assert('stacks accrue per cast (t=0 → 1)', tl.statusStacksAt('glacio_chafe', 0) === 1);
    assert('stacks accrue per cast (t=2 → 3)', tl.statusStacksAt('glacio_chafe', 2) === 3);
    // Each stack lives 15s (the game's own DurationMagnitude, wired 2026-08-01
    // — this used to be null, so a stack never expired).
    assert('stacks survive well inside the 15s lifetime', tl.statusStacksAt('glacio_chafe', 5) === 4);
    assert('...and are gone long after it', tl.statusStacksAt('glacio_chafe', 100) === 0);
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
    assert('present in a window inside the stack lifetime', tl.presentDuring('glacio_chafe', 10, 15));
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
            assert(`STATUS_CAP_RAISES ${idString}: amount is positive`, raise.amount > 0);
            assert(`STATUS_CAP_RAISES ${idString}: duration is a positive number or null (unstated)`,
                raise.seconds === null || raise.seconds > 0);
            assert(`STATUS_CAP_RAISES ${idString}: quotes its kit sentence`,
                typeof raise.note === 'string' && raise.note.length > 20);
            assert(`STATUS_CAP_RAISES ${idString}: has exactly one trigger shape`,
                (raise.keys != null) !== (raise.onInflict != null));

            // Cast-triggered: names one real status and real trigger keys.
            if (raise.keys) {
                assert(`STATUS_CAP_RAISES ${idString}: '${raise.status}' is a real status`,
                    NEGATIVE_STATUS_DEFS[raise.status] != null);
                assert(`STATUS_CAP_RAISES ${idString}: names at least one trigger key`, raise.keys.length > 0);
                for (const key of raise.keys) {
                    assert(`STATUS_CAP_RAISES ${idString}: trigger key ${key} exists`, !!skillMap?.[key]);
                }
            }

            // Inflict-triggered: every listed status is real, and any gate names
            // real keys — the raised status comes from the application itself,
            // so a top-level `status` would be meaningless here.
            if (raise.onInflict) {
                assert(`STATUS_CAP_RAISES ${idString}: lists at least one inflictable status`,
                    raise.onInflict.length > 0);
                for (const status of raise.onInflict) {
                    assert(`STATUS_CAP_RAISES ${idString}: onInflict '${status}' is a real status`,
                        NEGATIVE_STATUS_DEFS[status] != null);
                }
                assert(`STATUS_CAP_RAISES ${idString}: carries no meaningless top-level status`,
                    raise.status === undefined);
                for (const key of raise.gate?.keys ?? []) {
                    assert(`STATUS_CAP_RAISES ${idString}: gate key ${key} exists`, !!skillMap?.[key]);
                }
                if (raise.gate) {
                    assert(`STATUS_CAP_RAISES ${idString}: gate duration is positive`, raise.gate.seconds > 0);
                }
            }
        }
    }
}

// ── Cartethyia: a cast-triggered raise with NO stated duration ─────────────
// "Casting Resonance Liberation … increases the max stack limit of Aero Erosion
// … by 3." The kit states no duration, so it holds for the rest of the fight.
{
    const steps = [
        { skillKey: 'basic_1', endTime: 1 },
        { skillKey: 'liberation_blade_of_howling_squall', endTime: 4 },
    ];
    const windows = capRaiseWindowsFromSteps(steps, 1409, 2);
    assert('her Liberation arms an Aero Erosion raise', windows.length === 1);
    assert('...for the right status', windows[0].status === 'aero_erosion');
    assert('...opening at the end of the cast', windows[0].start === 4);
    assert('an unstated duration runs to the end of the fight', windows[0].end === Infinity);
    assert('below S2 nothing arms', capRaiseWindowsFromSteps(steps, 1409, 1).length === 0);

    // Aero Erosion decays (15s), so build a timeline dense enough to reach cap.
    const apps = Array.from({ length: 6 }, (_, i) => (
        { status: 'aero_erosion', t: 5 + i * 0.5, applicatorId: 1409, applicatorLevel: 90 }));
    const base = buildEnemyStatusTimeline(apps);
    const lifted = buildEnemyStatusTimeline(apps, windows);
    assert('base Aero Erosion caps at 3', base.statusStacksAt('aero_erosion', 7.5) === 3);
    assert('her S2 lifts it to 6', lifted.capAt('aero_erosion', 7.5) === 6);
    assert('...and it never lapses', lifted.capAt('aero_erosion', 9999) === 6);
}

// ── Suisui: an INFLICT-triggered raise, gated by Ceaseless Landscape ───────
// Her Liberation deploys the 30s Landscape; while it is up, a teammate
// inflicting one of five statuses raises THAT status's cap by 3 for 15s.
{
    const suisuiSteps = [{ skillKey: 'liberation_healing_per_plume_step', endTime: 10 }];
    const gates = capRaiseGateWindows(suisuiSteps, 1110, 0);
    assert('her Liberation opens one gate', gates.length === 1);
    assert('...running 30s from the cast', gates[0].start === 10 && gates[0].end === 40);
    assert('a non-Landscape cast opens no gate',
        capRaiseGateWindows([{ skillKey: 'intro', endTime: 1 }], 1110, 0).length === 0);

    const members = [{ resonatorId: 1110, chain: 0 }];
    const inside = [{ status: 'glacio_chafe', t: 20, applicatorId: 1108, applicatorLevel: 90 }];
    const outside = [{ status: 'glacio_chafe', t: 50, applicatorId: 1108, applicatorLevel: 90 }];

    const armed = capRaiseWindowsFromInflicts(inside, members, gates);
    assert('inflicting inside the Landscape arms a raise', armed.length === 1);
    assert('...for the status that was actually inflicted', armed[0].status === 'glacio_chafe');
    assert('...running 15s from the application', armed[0].start === 20 && armed[0].end === 35);
    assert('inflicting AFTER the Landscape lapses arms nothing',
        capRaiseWindowsFromInflicts(outside, members, gates).length === 0);
    assert('with no gate open at all, nothing arms',
        capRaiseWindowsFromInflicts(inside, members, []).length === 0);

    // The raise belongs to the ENEMY: a teammate inflicted it, and it still applies.
    assert('a TEAMMATE\'s application arms Suisui\'s raise', armed[0].source.startsWith('1110:'));

    // A status she does not list is untouched.
    const unlisted = [{ status: 'havoc_bane', t: 20, applicatorId: 1610, applicatorLevel: 90 }];
    assert('a status outside her five is not raised',
        capRaiseWindowsFromInflicts(unlisted, members, gates).length === 0);

    // Each status keeps its own "does not stack" group.
    const twoStatuses = [
        { status: 'glacio_chafe', t: 20, applicatorId: 1108, applicatorLevel: 90 },
        { status: 'fusion_burst', t: 21, applicatorId: 1203, applicatorLevel: 90 },
    ];
    const both = capRaiseWindowsFromInflicts(twoStatuses, members, gates);
    assert('two different statuses arm two independent raises', both.length === 2);
    assert('...with distinct sources', both[0].source !== both[1].source);

    // End to end: Glacio Chafe's base cap is 10, so the raise takes it to 13.
    const chafe = Array.from({ length: 14 }, (_, i) => (
        { status: 'glacio_chafe', t: 20 + i * 0.1, applicatorId: 1108, applicatorLevel: 90 }));
    const raises = capRaiseWindowsFromInflicts(chafe, members, gates);
    const timeline = buildEnemyStatusTimeline(chafe, raises);
    assert('Glacio Chafe base cap is 10', buildEnemyStatusTimeline(chafe).statusStacksAt('glacio_chafe', 22) === 10);
    assert('under the Landscape it reaches 13', timeline.statusStacksAt('glacio_chafe', 22) === 13);
}

// ── Damage that is not one-per-application: ticks and burst-on-max ─────────
// `damageOnTick` and `damageOnMax` were declared in NEGATIVE_STATUS_DEFS and
// read by NOTHING until 2026-08-01, so four of six statuses contributed no
// damage at all. Spectro Frazzle and Aero Erosion had confirmed multipliers
// sitting unused in docs/NEGATIVE-STATUS-REFERENCE.md §2c.
{
    const target = { level: 90, resistances: {} };
    const damageOf = (status, stacks, atkLv) =>
        computeNegativeStatusDamage({ status, stacks, atkLv, target, dataset: d });

    // Every status that deals damage now has the GAME's own per-stack table
    // (data/status-damage.json), so the dataset is what these read.
    assert('Glacio Chafe has a damage model', statusHasDamageModel('glacio_chafe', d));
    assert('Spectro Frazzle now has one too', statusHasDamageModel('spectro_frazzle', d));
    assert('Aero Erosion now has one too', statusHasDamageModel('aero_erosion', d));
    assert('Fusion Burst still has none (uncalibrated)', !statusHasDamageModel('fusion_burst'));
    assert('Electro Flare still has none (uncalibrated)', !statusHasDamageModel('electro_flare'));
    assert('Havoc Bane has none BY DESIGN (DEF reduction only)', !statusHasDamageModel('havoc_bane'));

    // Spectro Frazzle: 3s ticks, and its stacks decay every 3s.
    const frazzle = Array.from({ length: 6 }, (_, i) => (
        { status: 'spectro_frazzle', t: i * 0.5, applicatorId: 1506, applicatorLevel: 90 }));
    const timeline = buildEnemyStatusTimeline(frazzle);
    const ticks = resolveStatusOverTimeDamage(timeline, 20, damageOf, d);

    assert('it ticks over the fight instead of dealing nothing', ticks.length > 0);
    assert('every tick is a real damage instance', ticks.every(tick => tick.damage > 0));
    assert('ticks are labelled as such', ticks.every(tick => tick.kind === 'tick'));
    assert('the first tick lands one interval after the first application', Math.abs(ticks[0].t - 3) < 1e-9);
    assert('ticks are attributed to the applicator', ticks.every(tick => tick.applicatorId === 1506));
    assert('damage FALLS as the stacks decay',
        ticks[0].damage > ticks[1].damage && ticks[1].damage > ticks[2].damage);
    assert('no tick outlives the fight', ticks.every(tick => tick.t <= 20 + 1e-9));

    // A shorter fight yields strictly fewer ticks.
    assert('a shorter fight ticks fewer times',
        resolveStatusOverTimeDamage(timeline, 7, damageOf).length < ticks.length);
    assert('a zero-length fight ticks not at all',
        resolveStatusOverTimeDamage(timeline, 0, damageOf).length === 0);

    // Aero Erosion ticks too, and its 4-6 stack multipliers are only reachable
    // through a cap raise — which is exactly why the table extends past 3.
    const aero = Array.from({ length: 4 }, (_, i) => (
        { status: 'aero_erosion', t: i * 0.5, applicatorId: 1409, applicatorLevel: 90 }));
    assert('Aero Erosion ticks', resolveStatusOverTimeDamage(
        buildEnemyStatusTimeline(aero), 20, damageOf, d).length > 0);

    // Fusion Burst detonates at its cap. It sat "pending calibration" and dealt
    // NOTHING until the game's own table landed (2026-08-01).
    const burst = Array.from({ length: 12 }, (_, i) => (
        { status: 'fusion_burst', t: i * 0.4, applicatorId: 1210, applicatorLevel: 90 }));
    const burstTimeline = buildEnemyStatusTimeline(burst);
    const bursts = resolveStatusOverTimeDamage(burstTimeline, 20, damageOf, d);
    assert('Fusion Burst now detonates instead of dealing nothing', bursts.length > 0);
    assert('...at the cap it reached', bursts.every(instance => instance.stacks === 10));
    assert('...for real damage', bursts.every(instance => instance.damage > 0));
    assert('every damaging status is modelled now — no gaps left',
        statusDamageGaps(burstTimeline, d).length === 0);

    // The gap machinery still guards the next unmodelled status: without a
    // dataset only Glacio Chafe's calibrated fallback exists, so Fusion Burst
    // reports rather than silently contributing zero.
    const gaps = statusDamageGaps(burstTimeline);
    assert('an unmodelled status is reported, not silently dropped', gaps.length === 1);
    assert('...naming the status', gaps[0].status === 'fusion_burst');
    assert('...counting the applications that produced nothing', gaps[0].applications === 12);
    assert('...and saying why', /calibration/.test(gaps[0].reason));
    assert('a modelled status reports no gap', statusDamageGaps(timeline, d).length === 0);

    // Havoc Bane deals no damage by design, so it is not a gap either.
    assert('a damage-free status is not reported as a gap', statusDamageGaps(buildEnemyStatusTimeline(
        [{ status: 'havoc_bane', t: 1, applicatorId: 1610, applicatorLevel: 90 }])).length === 0);
}

// ── The affliction LevelModifier applies to every ELEMENTAL status ─────────
// The game's AbnormalDamageConfig is one value per level, identical across all
// six elements — so it is not glacio's alone.
{
    const target = { level: 90, resistances: {} };
    const at = (status, stacks, atkLv) =>
        computeNegativeStatusDamage({ status, stacks, atkLv, target, dataset: d });

    assert('Spectro Frazzle scales with the level curve',
        at('spectro_frazzle', 5, 70) > 0 && at('spectro_frazzle', 5, 70) < at('spectro_frazzle', 5, 90));
    // Assert the MODIFIER directly: total damage also moves with atkLv through
    // nsDefMult, so a damage ratio is not the level-curve ratio on its own.
    assert('...reading the curve, not the old glacio-only constant',
        nsLevelModifier('spectro_frazzle', 70, d) === 1005);
    assert('Aero Erosion likewise', nsLevelModifier('aero_erosion', 90, d) === 3674);
    assert('every elemental status resolves a modifier from the curve',
        ['glacio_chafe', 'fusion_burst', 'aero_erosion', 'electro_flare', 'spectro_frazzle', 'havoc_bane']
            .every(status => nsLevelModifier(status, 80, d) === 2005));
    assert('without a dataset an unpinned status has no modifier at all',
        nsLevelModifier('spectro_frazzle', 80) === null);
    assert('Tune Break keeps its OWN constant, not the abnormal curve',
        nsLevelModifier('tune_rupture', 70, d) === 716.22);
}

// ── Kit-TRIGGERED affliction damage (Aemeath's Fusion Burst) ───────────────
// The multiplier is not a global per-status constant — it lives on the buff
// that triggers the damage, extracted to data/affliction-damage.json. Aemeath's
// tables reproduce her kit text exactly, which is the cross-check that the
// extraction found the right rows.
{
    assert('the dataset carries the extracted multiplier tables',
        (d.afflictionDamage?.multipliers ?? []).length > 0);
    const tableOf = (buffId) => d.afflictionDamage.multipliers.find(row => row.buffId === buffId)?.byStacks;

    // "Each stack of [Fusion Trail] removed increases the DMG Multiplier of
    // [Fusion Burst] by 10%" → 100% + 10%/stack. S2 makes it 15%.
    const base = tableOf(1210072022);
    const withS2 = tableOf(1210072024);
    assert('the base Fusion Burst table exists', base != null);
    assert('...and reads exactly 100% + 10% per stack',
        [1, 5, 20, 60].every(n => Math.abs(base[String(n)] - (1 + 0.10 * n)) < 1e-9));
    assert('the S2 table reads exactly 100% + 15% per stack',
        [1, 5, 20, 60].every(n => Math.abs(withS2[String(n)] - (1 + 0.15 * n)) < 1e-9));
    assert('both are Fusion Burst', d.afflictionDamage.multipliers
        .filter(row => [1210072022, 1210072024].includes(row.buffId))
        .every(row => row.status === 'fusion_burst'));

    // Table selection follows the chain: S2 swaps 10%/stack for 15%/stack,
    // S6 lifts the Fusion Trail cap from 30 to 60.
    const at = (chain) => afflictionTriggerFor(1210, chain, 'fusion_burst');
    assert('below S2 the base table is live', at(0).buffId === 1210072022);
    assert('S1 is still the base table', at(1).buffId === 1210072022);
    assert('S2 switches to the 15%/stack table', at(2).buffId === 1210072024);
    assert('S6 keeps it (a skill tree stays unlocked)', at(6).buffId === 1210072024);
    assert('the Fusion Trail cap is 30 before S6', at(2).markCap === 30);
    assert('...and 60 at S6', at(6).markCap === 60);
    assert('a resonator with no kit trigger returns null',
        afflictionTriggerFor(1102, 6, null) === null);
    assert('the wrong Resonance Mode does not trigger it',
        afflictionTriggerFor(1210, 6, 'tune_rupture') === null);

    // The MARK is derived from the shared timeline: +1 per team Fusion Burst.
    const apps = Array.from({ length: 41 }, (_, i) => (
        { status: 'fusion_burst', t: i * 0.5, applicatorId: 1210, applicatorLevel: 90 }));
    const timeline = buildEnemyStatusTimeline(apps);
    const entry = at(6);
    assert('Fusion Trail accrues one stack per team Fusion Burst',
        markStacksAt(timeline, entry.mark, entry.markCap, 20) === 41);
    assert('...capped by the chain-dependent limit',
        markStacksAt(timeline, entry.mark, 30, 20) === 30);
    assert('...and only counting inflictions inside its 30s window',
        markStacksAt(timeline, entry.mark, 60, 60) === 0);
    assert('no inflictions -> no mark',
        markStacksAt(buildEnemyStatusTimeline([]), entry.mark, 60, 10) === 0);

    // End to end: the cast consumes the mark and deals one instance.
    const target = { level: 90, resistances: {} };
    const damageOf = (status, multiplier, atkLv) =>
        computeAfflictionDamage({ status, multiplier, atkLv, target, dataset: d });
    const build = { resonatorId: 1210, chain: 6, level: 90, resonanceMode: 'fusion_burst' };
    const steps = [
        { skillKey: 'basic_aemeath_1', endTime: 19 },
        { skillKey: 'forte_heavy_seraphic_duet_encore', endTime: 20 },
    ];
    const fired = resolveAfflictionTriggers(timeline, steps, build, d, damageOf);
    assert('exactly the Seraphic Duet cast fires an instance', fired.length === 1);
    // 41 inflictions x2 per infliction at S6 ("The stacks of ... Fusion Trail
    // inflicted ... is DOUBLED"), capped at her S6 limit of 60.
    assert('...consuming the accrued Fusion Trail', fired[0].stacks === 60);
    // The table is a DMG-MULTIPLIER FACTOR ("100% + 15%/stack"), applied to a
    // burst whose base is the status's own value AT THE TARGET'S STACK LIMIT —
    // the kit says "trigger the Fusion Burst based on its max stack limit".
    // Denia's single-value table is the clean confirmation: her S6 reads "gains
    // a 200% DMG Multiplier increase" and her table is exactly 3.0.
    assert('...at the table factor for that count, on the max-stack base',
        Math.abs(fired[0].multiplier
            - (1 + 0.15 * 60) * stackMvTable('fusion_burst', d)[fired[0].burstCap]) < 1e-9);
    assert('...and the burst is priced at the cap in force', fired[0].burstCap === 10);
    assert('...for real damage', fired[0].damage > 0);
    assert('...attributed to Aemeath', fired[0].applicatorId === 1210);

    // S2 must out-damage the base table on the same rotation.
    const baseBuild = { ...build, chain: 0 };
    const baseFired = resolveAfflictionTriggers(timeline, steps, baseBuild, d, damageOf);
    assert('the base chain uses the weaker table', baseFired[0].damage < fired[0].damage);

    // No mark, no instance — a burst with nothing to consume deals nothing.
    // Below S6 that is the whole story. AT S6 the kit hands the cast its own
    // stacks ("While casting Resonance Skill Seraphic Duet, inflict 10 stacks
    // of … Fusion Trail"), and since the grant lands before the cast reads —
    // measured, see markEventsFor — a Duet on a clean enemy still fires, for
    // exactly those 10.
    assert('below S6, a cast with no Fusion Trail fires nothing',
        resolveAfflictionTriggers(buildEnemyStatusTimeline([]), steps, { ...build, chain: 2 }, d, damageOf)
            .length === 0);
    {
        const clean = resolveAfflictionTriggers(buildEnemyStatusTimeline([]), steps, build, d, damageOf);
        assert('at S6 it fires on its own grant', clean.length === 1 && clean[0].stacks === 10);
    }

    // computeAfflictionDamage is the same formula family, driven by the level curve.
    assert('affliction damage scales with the inflicting level',
        computeAfflictionDamage({ status: 'fusion_burst', multiplier: 2, atkLv: 70, target, dataset: d })
        < computeAfflictionDamage({ status: 'fusion_burst', multiplier: 2, atkLv: 90, target, dataset: d }));
    assert('a zero multiplier deals nothing',
        computeAfflictionDamage({ status: 'fusion_burst', multiplier: 0, atkLv: 90, target, dataset: d }) === 0);
}

// ── Combat states that gate a chain effect ─────────────────────────────────
// Five effects named an in-combat state in their text but parsed to
// persist+unknown, which resolves OFF — so the buff never applied at all. Each
// now has a curated state and a stateBound window.
{
    const cases = [
        [1104, 3, 'S3.0', "lion's vigor", ['liberation']],
        [1204, 3, 'S3.0', 'burning rhapsody', ['liberation_violent_finale_damage']],
        [1301, 3, 'S3.0', 'deathblade gear', ['liberation']],
        [1603, 3, 'S3.1', 'budding mode', ['forte_heavy_ephemeral']],
    ];
    for (const [rid, chain, slot, state, enterKeys] of cases) {
        const resonator = d.resonators.find(r => r.id === rid);
        const node = resonator.resonanceChain.find(c => c.level === chain);
        const index = Number(slot.split('.')[1]);
        const effect = node.effects[index];
        assert(`${resonator.name} ${slot} is state-bound now`, effect.window?.type === 'stateBound');
        assert(`${resonator.name} ${slot} names its state`, effect.window.state === state);
        assert(`${resonator.name} ${slot} is no longer an unknown trigger`, effect.trigger?.type !== 'unknown');

        // The state exists, and the entering key is real.
        const defs = stateDefsForResonator(rid);
        const def = defs.find(entry => entry.name.toLowerCase() === state);
        assert(`${resonator.name} has a '${state}' state def`, def != null);
        for (const key of enterKeys) {
            assert(`${resonator.name} '${state}' enters on a real key ${key}`,
                !!d.autoSkillMap[String(rid)]?.[key] && def.enter.keys.includes(key));
        }

        // And it actually turns on once the entering cast happens.
        const timeline = computeStateTimeline(['basic_1', ...enterKeys, 'basic_1'],
            d.autoSkillMap[String(rid)], defs);
        assert(`${resonator.name} '${state}' is OFF before its cast`,
            !stateActive(timeline.activeAt[0], state));
        assert(`${resonator.name} '${state}' is ON after its cast`,
            stateActive(timeline.activeAt[2], state));
    }

    // Lingyang S6 names TWO conditions and only one window is expressible; the
    // tighter 3s-after-Mountain-Roamer is what it binds to.
    const lingyang = d.resonators.find(r => r.id === 1104);
    const s6 = lingyang.resonanceChain.find(c => c.level === 6).effects[0];
    assert('Lingyang S6 binds to the 3s window after Mountain Roamer',
        s6.window?.type === 'seconds' && s6.window.seconds === 3);
    assert('...on the real Mountain Roamer key',
        s6.trigger?.skillKeys?.includes('forte_heavy_mountain_roamer_damage'));

    // Roster-wide: no state-bound effect may name a state its resonator lacks.
    for (const resonator of d.resonators) {
        const names = stateDefsForResonator(resonator.id)
            .flatMap(def => [def.name.toLowerCase(), ...(def.aliases ?? []).map(a => a.toLowerCase())]);
        const visit = (node, prefix) => (node.effects ?? []).forEach((effect, i) => {
            if (effect.window?.type !== 'stateBound') return;
            const wanted = effect.window.state ?? (effect.window.states ?? []).join('|');
            assert(`${resonator.name} ${prefix}.${i}: state '${wanted}' is defined`,
                names.some(name => stateActive(new Set([name]), wanted)));
        });
        for (const chain of resonator.resonanceChain ?? []) visit(chain, `S${chain.level}`);
        (resonator.inherentSkills ?? []).forEach((node, ni) => visit(node, `IH${ni}`));
    }
}

// ── Aemeath's Stardust Resonance selects her stronger burst table ──────────
{
    assert('Stardust Resonance is a curated state',
        stateDefsForResonator(1210).some(def => def.name === 'Stardust Resonance'));
    const def = stateDefsForResonator(1210).find(entry => entry.name === 'Stardust Resonance');
    assert('...entered by Heavenfall Edict - Overdrive',
        def.enter.keys.includes('liberation_heavenfall_edict_overdrive'));
    // "Enter [Stardust Resonance] for 30s" AND "This effect ends after
    // [Seraphic Duet] is cast 2 times" — the kit states both ends, so both are
    // modelled and whichever runs out first closes it.
    assert('...for the 30s the kit states',
        def.exit.mode === 'secondsOrConsumedBy' && def.exit.seconds === 30);
    assert('...or a budget of two Seraphic Duet casts',
        def.exit.uses === 2 && def.exit.keys.length === 2
        && def.exit.keys.every(key => key.startsWith('forte_heavy_seraphic_duet')));

    const entry = afflictionTriggerFor(1210, 2, 'fusion_burst');
    assert('the empowered table is resolved for the chain', entry.stardustBuffId === 1210072025);
    assert('below S2 it is the other empowered table',
        afflictionTriggerFor(1210, 0, 'fusion_burst').stardustBuffId === 1210072023);

    // Inside the window the burst uses the stronger table; outside, the base one.
    const target = { level: 90, resistances: {} };
    const damageOf = (status, multiplier, atkLv) =>
        computeAfflictionDamage({ status, multiplier, atkLv, target, dataset: d });
    const apps = Array.from({ length: 10 }, (_, i) => (
        { status: 'fusion_burst', t: i * 0.5, applicatorId: 1210, applicatorLevel: 90 }));
    const timeline = buildEnemyStatusTimeline(apps);
    const build = { resonatorId: 1210, chain: 2, level: 90, resonanceMode: 'fusion_burst' };

    const inside = resolveAfflictionTriggers(timeline, [
        { skillKey: 'liberation_heavenfall_edict_overdrive', endTime: 5 },
        { skillKey: 'forte_heavy_seraphic_duet_encore', endTime: 10 },
    ], build, d, damageOf);
    const outside = resolveAfflictionTriggers(timeline, [
        { skillKey: 'liberation_heavenfall_edict_overdrive', endTime: 5 },
        { skillKey: 'forte_heavy_seraphic_duet_encore', endTime: 40 },
    ], build, d, damageOf);

    assert('a burst inside Stardust is flagged empowered', inside[0].empowered === true);
    assert('a burst 35s later is not', outside.length === 0 || outside[0].empowered === false);
    assert('the empowered burst hits harder',
        outside.length === 0 || inside[0].multiplier > outside[0].multiplier);
    assert('the empowered multiplier is the +400% table',
        Math.abs(inside[0].multiplier
            - (5 + 0.15 * inside[0].stacks) * stackMvTable('fusion_burst', d)[inside[0].burstCap]) < 1e-9);
}

// ── Aemeath S6: a FIXED crit that reaches only the affliction lane ────────────
// "Aemeath's Tune Rupture DMG can critically hit, with a fixed Crit. Rate of
// 80%, and fixed Crit. DMG of 275%." Affliction damage has no crit term at all,
// and the 80%/275% replace her crit rather than adding to it — so these must
// never appear as ordinary stats, where they would buff every hit she lands and
// push the build past the Crit Rate cap.
{
    const aemeath = d.resonators.find(r => r.id === 1210);
    const s6 = aemeath.resonanceChain.find(c => c.level === 6).effects;

    assert('S6 carries the fixed crit on the affliction lane',
        s6.filter(e => e.stat === 'afflictionCritRate').length === 2
        && s6.filter(e => e.stat === 'afflictionCritDmg').length === 2);
    assert('...and none of it as an ordinary crit stat',
        s6.every(e => e.stat !== 'critRate' && e.stat !== 'critDmg'));
    assert('the affliction-lane stats are invisible to the damage context',
        resolveChainInherentContext(s6, { element: 2, skillType: 'skill' }).critRateBonus === 0);

    // Expected-value form, matching formula.js: 1 + rate × (critDmg − 1).
    const mult = (chain, mode) => afflictionCritMultiplier(
        { resonatorId: 1210, chain, level: 90, resonanceMode: mode }, aemeath);
    assert('S6 in Fusion Burst gives 1 + 0.8 × 1.75 = 2.4',
        Math.abs(mult(6, 'fusion_burst') - 2.4) < 1e-9);
    assert('...and the same in Tune Rupture (one copy per mode)',
        Math.abs(mult(6, 'tune_rupture') - 2.4) < 1e-9);
    assert('below S6 the lane does not crit at all', mult(5, 'fusion_burst') === 1);
    assert('with no mode selected neither copy applies', mult(6, null) === 1);
    assert('a resonator with no such kit never crits on this lane',
        afflictionCritMultiplier({ resonatorId: 1102, chain: 6 }, d.resonators.find(r => r.id === 1102)) === 1);

    // End to end: the same burst, S5 vs S6, differs by exactly that factor.
    const target = { level: 90, resistances: {} };
    const damageOf = (status, multiplier, atkLv) =>
        computeAfflictionDamage({ status, multiplier, atkLv, target, dataset: d });
    const timeline = buildEnemyStatusTimeline(Array.from({ length: 10 }, (_, i) => (
        { status: 'fusion_burst', t: i * 0.5, applicatorId: 1210, applicatorLevel: 90 })));
    const steps = [{ skillKey: 'forte_heavy_seraphic_duet_encore', endTime: 10 }];
    const fire = (chain) => resolveAfflictionTriggers(timeline, steps,
        { resonatorId: 1210, chain, level: 90, resonanceMode: 'fusion_burst' }, d, damageOf);
    const atS5 = fire(5), atS6 = fire(6);
    // Divide the multiplier out: S6 also DOUBLES the Fusion Trail it consumed,
    // so the raw damage ratio carries both effects. Per unit of multiplier, the
    // difference is exactly the fixed-crit factor.
    const perMultiplier = (instance) => instance.damage / instance.multiplier;
    assert('S6 multiplies the burst by the fixed-crit factor',
        Math.abs(perMultiplier(atS6[0]) / perMultiplier(atS5[0]) - 2.4) < 1e-9);
    assert('...and says so on the instance', Math.abs(atS6[0].critMultiplier - 2.4) < 1e-9);
    assert('S5 reports a non-critting lane', atS5[0].critMultiplier === 1);
}

// ── Stardust is a BUDGET of two casts, not just a 30s timer ──────────────────
{
    const target = { level: 90, resistances: {} };
    const damageOf = (status, multiplier, atkLv) =>
        computeAfflictionDamage({ status, multiplier, atkLv, target, dataset: d });
    // Fusion Burst keeps landing throughout, so each Duet has Fusion Trail to
    // consume — a Duet with an empty Trail fires nothing at all.
    const timeline = buildEnemyStatusTimeline(Array.from({ length: 45 }, (_, i) => (
        { status: 'fusion_burst', t: i * 0.5, applicatorId: 1210, applicatorLevel: 90 })));
    const build = { resonatorId: 1210, chain: 2, level: 90, resonanceMode: 'fusion_burst' };

    // Three Seraphic Duets, all inside the 30s window. Only the first two are
    // empowered — "This effect ends after [Seraphic Duet] is cast 2 times".
    const fired = resolveAfflictionTriggers(timeline, [
        { skillKey: 'liberation_heavenfall_edict_overdrive', endTime: 5 },
        { skillKey: 'forte_heavy_seraphic_duet_encore', endTime: 8 },
        { skillKey: 'forte_heavy_seraphic_duet_overture', endTime: 12 },
        { skillKey: 'forte_heavy_seraphic_duet_encore', endTime: 20 },
    ], build, d, damageOf);
    assert('all three Duets fire an instance', fired.length === 3);
    assert('the first two are empowered', fired[0].empowered && fired[1].empowered);
    assert('the third is NOT, though the 30s timer is still running',
        fired[2].empowered === false);
    assert('...and so deals less than the empowered ones', fired[2].damage < fired[1].damage);
}

// ── Solo status damage: the whole lane, for one rotation ─────────────────────
// Until 2026-08-01 this existed only inside team-sim, so the build page showed
// none of it — for several resonators that is most of their output.
{
    const target = { level: 90, resistances: {} };
    const aemeath = d.resonators.find(r => r.id === 1210);
    const refs = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));
    const build = { resonatorId: 1210, level: 90, chain: 6,
        resonanceMode: 'fusion_burst', rotation: refs['1210'].rotation, echoes: [], sonata: {} };
    const sim = simulateRotation({ build, dataset: d, target });

    assert('the solo sim now reports status damage', sim.totals.statusDamage > 0);
    assert('...kept separate from skill damage', sim.totals.skillDamage > 0
        && sim.totals.skillDamage !== sim.totals.damage);
    assert('...and the total is exactly their sum',
        Math.abs(sim.totals.damage - (sim.totals.skillDamage + sim.totals.statusDamage)) < 1e-6);
    assert('...so DPS counts it', Math.abs(sim.totals.dps - sim.totals.damage / sim.totals.gameTime) < 1e-6);
    assert('every instance carries a time inside the rotation',
        sim.statusDamage.instances.every(instance => instance.t >= 0 && instance.t <= sim.totals.time + 1e-6));
    assert('instances are time-ordered',
        sim.statusDamage.instances.every((instance, i, all) => i === 0 || all[i - 1].t <= instance.t));

    // The direct call agrees with what the sim embedded.
    const direct = soloStatusDamage({ steps: sim.steps, build, resonator: aemeath, dataset: d, target });
    assert('soloStatusDamage matches the sim total',
        Math.abs(direct.total - sim.totals.statusDamage) < 1e-6);

    // A resonator that inflicts nothing gets an empty lane, not a crash.
    const yuanwu = d.resonators.find(r => r.id === 1301);
    const quiet = soloStatusDamage({
        steps: sim.steps, build: { resonatorId: yuanwu.id, level: 90, chain: 0 },
        resonator: yuanwu, dataset: d, target });
    assert('a resonator inflicting no status has an empty lane',
        quiet.total === 0 && quiet.instances.length === 0);
    assert('missing steps / target degrade to empty, not a throw',
        soloStatusDamage({ steps: [], build, resonator: aemeath, dataset: d, target }).total === 0
        && soloStatusDamage({ steps: sim.steps, build, resonator: aemeath, dataset: d, target: null }).total === 0);
}

// ── The GENERIC per-stack tables come from the game, not from us ─────────────
// data/status-damage.json is extracted from the ConfigDB system buffs (one
// reserved buff id + ExtraEffectID per status). Glacio Chafe's row is what
// validates the whole reading: it reproduces, to the digit, the curve this
// engine had reverse-engineered from three worked examples years earlier.
{
    const statuses = d.statusDamage?.statuses ?? {};
    assert('the dataset carries all six status tables',
        ['glacio_chafe', 'fusion_burst', 'electro_flare', 'aero_erosion',
            'spectro_frazzle', 'havoc_bane'].every(status => statuses[status]));

    // The independent confirmation: three points the community measured in game.
    const chafe = stackMvTable('glacio_chafe', d);
    assert('Glacio Chafe stack 1 is the measured 0.2450', Math.abs(chafe[1] - 0.2450) < 1e-9);
    assert('Glacio Chafe stack 7 is the measured 1.4401', Math.abs(chafe[7] - 1.4401) < 1e-9);
    assert('Glacio Chafe stack 10 is the measured 2.0377', Math.abs(chafe[10] - 2.0377) < 1e-9);

    // The two that had been contributing nothing at all.
    assert('Fusion Burst has a real table now',
        stackMvTable('fusion_burst', d)[10] > 0);
    assert('Electro Flare has a real table now',
        stackMvTable('electro_flare', d)[10] > 0);

    // Havoc Bane's row is a DEF reduction, not damage — excluded from the MV
    // lane and matching the def's own defReductionPerStack.
    assert('Havoc Bane is not a damage table', stackMvTable('havoc_bane', d) === null);
    assert('...it is the DEF reduction the def already carried',
        Math.abs(-statuses.havoc_bane.byStacks['1'] - NEGATIVE_STATUS_DEFS.havoc_bane.defReductionPerStack) < 1e-9);

    // Structural fields are the game's too — asserted equal so a curated def can
    // never drift from the table it is supposed to describe.
    for (const [status, info] of Object.entries(statuses)) {
        const def = NEGATIVE_STATUS_DEFS[status];
        assert(`${status}: maxStacks matches the game`, def.maxStacks === info.maxStacks);
        assert(`${status}: stack lifetime matches the game`,
            Math.abs(def.stackDecayS - info.stackSeconds) < 1e-6);
        assert(`${status}: tick interval matches the game`,
            (def.tickIntervalS ?? null) === (info.tickIntervalS ?? null));
    }

    // Without a dataset only the calibrated fallback exists — never a guess.
    assert('no dataset still yields the verified Glacio curve',
        Math.abs(stackMvTable('glacio_chafe')[10] - 2.0377) < 1e-9);
    assert('no dataset yields NO table for the rest', stackMvTable('fusion_burst') === null);
}

// ── A kit-triggered burst is priced at the target's STACK LIMIT ──────────────
// Three kits carry an ExtraEffectID-121 table and all three say the same thing,
// which is what settles that the table is a MULTIPLIER FACTOR rather than the
// whole multiplier:
//
//   Hiyuki  "an instance of [Glacio Bite DMG] is triggered based on that
//            enemy's current [Glacio Bite] stack limit"        table 1.00  (no increase)
//   Denia   "trigger Fusion Burst on the target based on its max limit …
//            gains a 200% DMG Multiplier increase"             table 3.00  (100% + 200%)
//   Aemeath "trigger the [Fusion Burst] on the target based on its max stack
//            limit … each stack of [Fusion Trail] removed increases the DMG
//            Multiplier of [Fusion Burst] by 10%"              table 1.00 + 0.10/stack
//
// Denia's is the exact check: a single-value table equal to 1 + the increase her
// own text states. Reading any of them as the complete multiplier drops the
// base entirely — a ~7x understatement on Aemeath's largest damage source.
{
    const tableOf = (buffId) => (d.afflictionDamage?.multipliers ?? [])
        .find(row => row.buffId === buffId)?.byStacks;
    assert("Denia's table is exactly 1 + her stated 200% increase",
        Math.abs(tableOf(1211702602)['1'] - 3.0) < 1e-9);
    assert("Hiyuki's is exactly 1 — her text states no increase at all",
        Math.abs(tableOf(1108501133)['1'] - 1.0) < 1e-9);
    assert("Aemeath's base table is 1 + 0.10/stack",
        Math.abs(tableOf(1210072022)['1'] - 1.1) < 1e-9
        && Math.abs(tableOf(1210072022)['60'] - 7.0) < 1e-9);

    // The entry that opts into the max-stack base says so explicitly.
    assert('Aemeath is flagged as pricing her burst at the stack limit',
        afflictionTriggerFor(1210, 6, 'fusion_burst').baseAtMaxStacks === true);

    // End to end: raising the target's cap raises every trigger, which is the
    // whole point of the "based on its max stack limit" wording — and is what
    // makes a cap-raising teammate a damage gain for her rather than a wash.
    const target = { level: 90, resistances: {} };
    const damageOf = (status, multiplier, atkLv) =>
        computeAfflictionDamage({ status, multiplier, atkLv, target, dataset: d });
    const apps = Array.from({ length: 10 }, (_, i) => (
        { status: 'fusion_burst', t: i * 0.5, applicatorId: 1210, applicatorLevel: 90 }));
    const steps = [{ skillKey: 'forte_heavy_seraphic_duet_encore', endTime: 10 }];
    const build = { resonatorId: 1210, chain: 0, level: 90, resonanceMode: 'fusion_burst' };

    const plain = resolveAfflictionTriggers(buildEnemyStatusTimeline(apps), steps, build, d, damageOf);
    const raised = resolveAfflictionTriggers(
        buildEnemyStatusTimeline(apps, [{ status: 'fusion_burst', amount: 3, start: 0, end: 30, source: 'test' }]),
        steps, build, d, damageOf);
    assert('a cap raise lifts the burst it is priced against',
        raised[0].burstCap === 13 && plain[0].burstCap === 10);
    assert('...and so lifts the damage', raised[0].damage > plain[0].damage);
    assert('...by exactly the ratio of the two cap values',
        Math.abs(raised[0].damage / plain[0].damage
            - stackMvTable('fusion_burst', d)[13] / stackMvTable('fusion_burst', d)[10]) < 1e-9);
}

// ── WHICH casts inflict a status, and WHEN a status deals damage ─────────────
// Both settled from the game's own tutorial text (db lang_multi_text):
//
//   Fusion Burst   "When Fusion Burst is stacked to its max, ALL STACKS WILL BE
//                   REMOVED to trigger an explosion" — no damage on infliction.
//   Glacio Chafe   "When Glacio Chafe is INFLICTED, the target receives Glacio
//                   DMG" — damage on every application; max stacks FREEZES.
//   Electro Flare  "it deals PERIODIC Electro DMG… the target loses half of the
//                   effect stacks with each instance of damage."
{
    assert('Fusion Burst damages at max stacks, not on infliction',
        NEGATIVE_STATUS_DEFS.fusion_burst.damageOnMax === true
        && !NEGATIVE_STATUS_DEFS.fusion_burst.damageOnStack);
    assert('Glacio Chafe damages on every infliction',
        NEGATIVE_STATUS_DEFS.glacio_chafe.damageOnStack === true
        && !NEGATIVE_STATUS_DEFS.glacio_chafe.damageOnMax);
    assert('Electro Flare, Aero Erosion and Spectro Frazzle are the periodic ones',
        ['electro_flare', 'aero_erosion', 'spectro_frazzle']
            .every(status => NEGATIVE_STATUS_DEFS[status].damageOnTick
                && NEGATIVE_STATUS_DEFS[status].tickIntervalS > 0));

    // Aemeath's kit names the inflicting skills AND a per-skill 3s ICD, so a
    // rotation does NOT apply a stack on every damaging cast.
    const rules = statusApplyRules(1210, 'fusion_burst');
    assert('Aemeath has a curated apply rule', rules?.length === 2);
    assert('...listing exactly the eight skills her kit names', rules[0].keys.length === 8);
    assert('...with the 3s per-skill ICD the kit states', rules[0].icdSeconds === 3);
    assert('...gated to her Fusion Burst mode', statusApplyRules(1210, 'tune_rupture') === null);
    assert('every listed key is a real skill of hers',
        rules.every(rule => rule.keys.every(key => d.autoSkillMap['1210'][key])));

    // The ICD is per SKILL: the same skill twice inside 3s applies once, two
    // different listed skills 1s apart both apply.
    const step = (skillKey, startTime) => ({ skillKey, startTime, stepDamage: 100 });
    const same = applicationsFromSteps(
        [step('skill_mech_3', 0), step('skill_mech_3', 1), step('skill_mech_3', 5)],
        null, 1210, 90, rules);
    assert('the same skill re-applies only after its ICD', same.length === 2);
    const different = applicationsFromSteps(
        [step('skill_mech_3', 0), step('skill_mech_4', 1)], null, 1210, 90, rules);
    assert('two different listed skills both apply inside 3s', different.length === 2);
    const unlisted = applicationsFromSteps(
        [step('liberation_heavenfall_edict_finale', 0), step('heavy_mech_charged_ii', 1)],
        null, 1210, 90, rules);
    assert('a damaging cast NOT on the list applies nothing', unlisted.length === 0);

    // No rule → the every-damaging-step fallback, unchanged.
    assert('a resonator with no rule keeps the fallback',
        statusApplyRules(1108, null) === null
        && applicationsFromSteps([step('x', 0), step('y', 1)],
            new Set(['glacio_chafe']), 1108).length === 2);

    // Her kit also lowers the detonation threshold: "If the targets have more
    // than 5 stacks of [Fusion Burst], trigger [Fusion Burst] based on their max
    // stack limit and remove all of their stacks."
    const burst = statusBurstRules(1210, 'fusion_burst');
    assert('Aemeath lowers the Fusion Burst detonation threshold', burst?.[0].threshold === 6);
    assert('...only in Fusion Burst mode', statusBurstRules(1210, 'tune_rupture') === null);

    const target = { level: 90, resistances: {} };
    const damageOf = (status, stacks, atkLv) =>
        computeNegativeStatusDamage({ status, stacks, atkLv, target, dataset: d });
    const apps = Array.from({ length: 12 }, (_, i) => (
        { status: 'fusion_burst', t: i, applicatorId: 1210, applicatorLevel: 90 }));
    const timeline = buildEnemyStatusTimeline(apps);
    const atCap = resolveStatusOverTimeDamage(timeline, 20, damageOf, d);
    const lowered = resolveStatusOverTimeDamage(timeline, 20, damageOf, d, burst);
    assert('at the default threshold 12 applications detonate once', atCap.length === 1);
    assert('...at 6 they detonate twice, because the explosion clears the stacks',
        lowered.length === 2);
    assert('...each priced at the cap, as "based on their max stack limit" says',
        lowered.every(instance => instance.stacks === 10));
    assert('...and reporting the count actually held', lowered[0].held === 6);
}

// ── The MARK is a debuff in its own right ───────────────────────────────────
// Fusion Trail has three sources, all stated in Aemeath's Forte + S6, and only
// the cap was modelled before — which is why an S6 Aemeath's Trail count climbs
// far faster in game than the sim showed:
//   Forte "when Resonators in the team inflict [Fusion Burst], inflict 1 of
//          [Fusion Trail] for 30s, stacking up to 30 times"
//   S6    "The stacks of … Fusion Trail inflicted … is DOUBLED"
//   S6    "the max stack limit … is increased to 60"
//   S6    "While casting Resonance Skill [Seraphic Duet], inflict 10 stacks …"
{
    const base = afflictionTriggerFor(1210, 0, 'fusion_burst');
    const s6 = afflictionTriggerFor(1210, 6, 'fusion_burst');
    assert('the mark is named, so it can be shown as its own debuff',
        s6.mark.name === 'Fusion Trail');
    assert('base: 1 stack per infliction, cap 30, no on-cast grant',
        base.markPerApplication === 1 && base.markCap === 30 && base.markOnCast === 0);
    assert('S6: doubled per infliction, cap 60, +10 per Seraphic Duet',
        s6.markPerApplication === 2 && s6.markCap === 60 && s6.markOnCast === 10);

    // Six inflictions, one Duet at the end.
    const timeline = buildEnemyStatusTimeline(Array.from({ length: 6 }, (_, i) => (
        { status: 'fusion_burst', t: i, applicatorId: 1210, applicatorLevel: 90 })));
    const steps = [{ skillKey: 'forte_heavy_seraphic_duet_encore', endTime: 10 },
        { skillKey: 'forte_heavy_seraphic_duet_overture', endTime: 20 }];

    const markBase = markEventsFor(timeline, steps, base, base.keys);
    const markS6 = markEventsFor(timeline, steps, s6, s6.keys);
    // Six inflictions, plus the RE-SEED the sixth triggers: the burst detonates
    // at 6 and leaves 1 Fusion Burst standing, which is itself an infliction and
    // grants the mark like any other (measured — 6 FB / 2 FT detonated to
    // 1 FB / 4 FT).
    assert('base: six inflictions plus the re-seed are seven stacks',
        markBase.stacksAt(10) === 7);
    assert('S6: the same seven are doubled', markS6.stacksAt(10) === 14 + 10);

    // Consumption empties it — the whole point of the mechanic being that the
    // Duet spends the TRAIL, not the status's own stacks. The S6 on-cast grant
    // lands BEFORE the read, so the cast spends its own 10 and is then wiped
    // with everything else.
    assert('the consuming cast empties the mark', markS6.stacksAt(10.5) === 0);
    assert('...and the next Duet arrives on its own grant alone',
        markS6.stacksAt(20) === 10);
    assert('base has nothing left after its consumption', markBase.stacksAt(10.5) === 0);

    // A grant expires 30s after it lands, so the count decays.
    assert('a grant expires after the mark lifetime', markBase.stacksAt(100) === 0);

    // ── Same-instant ordering ────────────────────────────────────────────────
    // A step's START time IS the previous step's END time, so a consumption and
    // the next cast's application share one number. Three things happen at that
    // instant and the order among them is measured, not chosen:
    //   the consuming cast's own grant → the consumption → the next application.
    {
        const at10 = buildEnemyStatusTimeline([
            { status: 'fusion_burst', t: 10, applicatorId: 1210, applicatorLevel: 90 }]);
        const duetAt10 = [{ skillKey: 'forte_heavy_seraphic_duet_encore', endTime: 10 }];
        const mark = markEventsFor(at10, duetAt10, s6, s6.keys);
        assert('the consuming cast spends its own on-cast grant', mark.stacksAt(10) === 10);
        assert('...and an application at the same instant survives it, being the NEXT cast\'s',
            mark.heldAt(10) === 2);
    }

    // The cap binds.
    const many = buildEnemyStatusTimeline(Array.from({ length: 50 }, (_, i) => (
        { status: 'fusion_burst', t: i * 0.1, applicatorId: 1210, applicatorLevel: 90 })));
    assert('base caps at 30', markEventsFor(many, [], base).stacksAt(10) === 30);
    assert('S6 caps at 60', markEventsFor(many, [], s6).stacksAt(10) === 60);

    // The build page gets the mark as its own lane, with its spends.
    const refs = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));
    const sim = simulateRotation({
        build: { resonatorId: 1210, level: 90, chain: 6, resonanceMode: 'fusion_burst',
            rotation: refs['1210'].rotation, echoes: [], sonata: {} },
        dataset: d, target: { level: 90, resistances: {} },
    });
    const lanes = sim.statusDamage.stackTimelines;
    const trail = lanes.find(lane => lane.isMark);
    const burst = lanes.find(lane => !lane.isMark);
    assert('both the status and its mark are surfaced', !!trail && !!burst);
    assert('the mark carries its own name', trail.label === 'Fusion Trail');
    assert('...its cap', trail.cap === 60);
    assert('...a per-step stack count, so it reads per stack rather than as a total',
        Object.keys(trail.stacksByStepIndex).length === sim.steps.length);
    // Inside Stardust Resonance the FIRST enhanced cast detonates WITHOUT
    // removing the Trail; only the second consumes it (and ends the state).
    // Confirmed in game 2026-08-03 — the stacks were observed compounding
    // 8 -> 18 -> 24 -> 34 -> 0 across the two casts. Both reference Duets fall
    // inside the window, so exactly one of them consumes.
    assert('...and only the consuming cast is recorded, with what was spent',
        trail.consumedAt.length === 1 && trail.consumedAt.every(spend => spend.stacks > 0));
    assert('the status lane is NOT emptied by the mark being spent — the kit says '
        + '"without removing its stacks"',
        burst.stacksByStepIndex[sim.steps[sim.steps.length - 1].index] > 0);
}

console.log(`\nenemy-status: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
