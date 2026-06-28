/**
 * Tests for the effect-audit tool (PRE-P12-DATA-QUALITY.md §2/§5).
 *
 *   node tests/audit-effects.test.mjs
 *
 * Covers:
 *   - detectWarnings on synthetic fixtures for each of the five categories
 *   - a clean unconditional effect produces zero warnings
 *   - report determinism: same dataset → byte-identical markdown
 *   - real dataset: report builds without throwing, every resonator appears,
 *     and the per-category counts sum to the total
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { detectWarnings, iterResonatorEffects, buildAuditReport } from '../tools/effect-audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── detectWarnings: one fixture per category ─────────────────────────────────
{
    const plainResonator = { id: 9001, name: 'Fixture', resonanceModes: [] };

    const clean = { stat: 'critRate', value: 0.1, condition: 'Crit. Rate is increased by 10%.',
        trigger: { type: 'none' }, window: { type: 'always' } };
    assert('clean unconditional effect has zero warnings', detectWarnings(clean, plainResonator).length === 0);

    const unknownTrig = { stat: 'amplify', value: 0.2, condition: 'When in some untracked status, DMG is Amplified by 20%.',
        trigger: { type: 'unknown' }, window: { type: 'persist' } };
    assert('unknown trigger flagged', detectWarnings(unknownTrig, plainResonator).includes('UNKNOWN_TRIGGER'));

    const unmappedPhrase = { stat: 'critDmg', value: 0.1, condition: 'After using Some Unrecognized Move, Crit. DMG is increased by 10%.',
        trigger: { type: 'castMatch', skillType: null, phrase: 'Some Unrecognized Move' }, window: { type: 'persist' } };
    assert('unmapped castMatch phrase flagged', detectWarnings(unmappedPhrase, plainResonator).includes('UNMAPPED_PHRASE'));

    const skillKeysResolved = { stat: 'critRate', value: 0.25, condition: 'Enflamement increases Crit. Rate by 25% for 8s.',
        trigger: { type: 'castMatch', skillKeys: ['skill_true_sight_conquest', 'skill_true_sight_charge', 'liberation'] }, window: { type: 'seconds', seconds: 8 } };
    assert('castMatch resolved via skillKeys[] is NOT flagged UNMAPPED_PHRASE (regression: Changli S2.0)',
        !detectWarnings(skillKeysResolved, plainResonator).includes('UNMAPPED_PHRASE'));
    assert('castMatch resolved via skillKeys[] has zero warnings overall', detectWarnings(skillKeysResolved, plainResonator).length === 0);

    const missingDuration = { stat: 'critRate', value: 0.1, condition: 'Basic Attack V increases Crit. Rate by 15% for 10 seconds.',
        trigger: { type: 'castMatch', skillType: 'basic' }, window: { type: 'persist' } };
    assert('worded "for N seconds" with no durationSeconds flagged', detectWarnings(missingDuration, plainResonator).includes('MISSING_DURATION'));

    const properDuration = { stat: 'critRate', value: 0.1, condition: 'Basic Attack V increases Crit. Rate by 15% for 10s.',
        trigger: { type: 'castMatch', skillType: 'basic' }, window: { type: 'seconds', seconds: 10 }, durationSeconds: 10 };
    assert('numeric "for 10s" WITH durationSeconds is clean', detectWarnings(properDuration, plainResonator).length === 0);

    const misclassified = { stat: 'multiplierUp', value: 1.26, skillType: 'liberation',
        condition: 'The DMG Multiplier of Resonance Liberation Fatal Finale is increased by 126%.',
        trigger: { type: 'stateEnter', state: 'some state' }, window: { type: 'stateBound', state: 'some state' } };
    assert('unconditional-phrased multiplier with a non-none trigger flagged',
        detectWarnings(misclassified, plainResonator).includes('MISCLASSIFIED_UNCONDITIONAL'));

    const correctlyUnconditional = { ...misclassified, trigger: { type: 'none' }, window: { type: 'always' } };
    assert('the same multiplier text with trigger:none is clean', detectWarnings(correctlyUnconditional, plainResonator).length === 0);

    const modeResonator = { id: 9002, name: 'ModeFixture', resonanceModes: [{ key: 'tune_rupture', name: 'Tune Rupture' }] };
    const modeUntagged = { stat: 'critRate', value: 0.8, condition: 'When in Resonance Mode - Tune Rupture, Crit. Rate is fixed at 80%.',
        trigger: { type: 'stateEnter', state: 'resonance mode - tune rupture' }, window: { type: 'stateBound', state: 'resonance mode - tune rupture' } };
    assert('mode-referencing text without e.mode set is flagged', detectWarnings(modeUntagged, modeResonator).includes('MODE_NOT_TAGGED'));

    const modeTagged = { ...modeUntagged, mode: 'tune_rupture', trigger: { type: 'modeMatch', mode: 'tune_rupture' }, window: { type: 'always' } };
    assert('mode-referencing text WITH correct e.mode is clean', detectWarnings(modeTagged, modeResonator).length === 0);
}

// ── iterResonatorEffects: stable slot-key order ───────────────────────────────
{
    const r = {
        resonanceChain: [
            { level: 2, effects: [{ stat: 'a' }] },
            { level: 1, effects: [{ stat: 'b' }, { stat: 'c' }] },
        ],
        inherentSkills: [{ effects: [{ stat: 'd' }] }, { effects: [{ stat: 'e' }] }],
    };
    const keys = [...iterResonatorEffects(r)].map(x => x.slotKey);
    assert('chain entries sorted by level ascending, inherent in array order',
        keys.join(',') === 'S1.0,S1.1,S2.0,IH0.0,IH1.0');
}

// ── Determinism: same dataset → byte-identical report ─────────────────────────
{
    const ids = [1107, 1108, 1304, 1205, 1506, 1607, 1109, 1210, 1211, 1509];
    const overridesDoc = JSON.parse(readFileSync(resolve(__dirname, '../data/effect-overrides.json'), 'utf8'));
    const a = buildAuditReport(d, { deepAuditIds: ids, deferred: overridesDoc.deferred ?? {} });
    const b = buildAuditReport(d, { deepAuditIds: ids, deferred: overridesDoc.deferred ?? {} });
    assert('report markdown is byte-identical across runs', a.markdown === b.markdown);
    assert('summary totals identical across runs', a.totalWarnings === b.totalWarnings && a.totalEffects === b.totalEffects);
}

// ── Deferred entries: excluded from warning counts, surfaced with their reason ─
{
    const r = { id: 9003, name: 'DeferFixture', resonanceModes: [],
        resonanceChain: [{ level: 1, effects: [
            { stat: 'amplify', value: 0.3, condition: 'Some unmodeled team mechanic.', trigger: { type: 'unknown' }, window: { type: 'persist' } },
        ] }] };
    const withoutDeferred = buildAuditReport({ resonators: [r] }, { deepAuditIds: [9003] });
    assert('undeferred unknown-trigger effect counts toward the gate', withoutDeferred.deepAuditWarnings === 1);
    assert('undeferred unknown-trigger effect is NOT counted as deferred', withoutDeferred.totalDeferred === 0);

    const withDeferred = buildAuditReport({ resonators: [r] },
        { deepAuditIds: [9003], deferred: { '9003': { 'S1.0': 'Needs team-wide mechanic tracking — deferred.' } } });
    assert('deferred effect does not count toward the gate', withDeferred.deepAuditWarnings === 0);
    assert('deferred effect is counted in totalDeferred', withDeferred.totalDeferred === 1 && withDeferred.deepAuditDeferred === 1);
    assert('deferred reason text appears in the report', withDeferred.markdown.includes('Needs team-wide mechanic tracking'));
    assert('deferred entry is marked, not silently hidden', withDeferred.markdown.includes('DEFERRED'));
}

// ── Real Hiyuki deferral: registered entries clear the gate, reason text present ─
{
    const overridesDoc = JSON.parse(readFileSync(resolve(__dirname, '../data/effect-overrides.json'), 'utf8'));
    const hiyukiDeferred = overridesDoc.deferred?.['1108'] ?? {};
    // IH0.0/.1/.2 (the base Snow Rust tiers) were resolved 2026-06-28 via
    // distinctApplicatorTierContribution (conditional-buffs.js) and moved to
    // overrides.1108.* (suppress:true) — only the chain-level (S3.1/S6.0/S6.1)
    // modifications remain deferred (chains stay display-only per CLAUDE.md).
    assert('Hiyuki Snow Rust chain-level deferral is registered (3 slots)', Object.keys(hiyukiDeferred).length === 3);
    const report = buildAuditReport(d, { deepAuditIds: [1108], deferred: overridesDoc.deferred ?? {} });
    assert('Hiyuki contributes zero undecided ⚠ to the gate once deferred', report.deepAuditWarnings === 0);
    assert('Hiyuki contributes 3 deferred entries to the gate tally', report.deepAuditDeferred === 3);
}

// ── PRE-P12-DATA-QUALITY.md §6 exit criterion: the gate is CLEAR ──────────────
// Zero undecided ⚠ across the P12 seed set + the four Resonance Mode
// characters (the actual gate this whole audit tool exists to check).
{
    const SEED_AND_MODE_IDS = [1107, 1108, 1304, 1205, 1506, 1607, 1109, 1210, 1211, 1509];
    const overridesDoc = JSON.parse(readFileSync(resolve(__dirname, '../data/effect-overrides.json'), 'utf8'));
    const report = buildAuditReport(d, { deepAuditIds: SEED_AND_MODE_IDS, deferred: overridesDoc.deferred ?? {} });
    assert('PRE-P12-DATA-QUALITY.md gate is CLEAR: zero undecided ⚠ in the seed + mode set', report.deepAuditWarnings === 0);
    assert('gate clearance includes explicitly-tracked deferrals, not silent gaps', report.deepAuditDeferred > 0);
    assert('"Gate: CLEAR" appears in the rendered report', report.markdown.includes('Gate: CLEAR'));
}

// ── Real dataset: structural integrity ────────────────────────────────────────
{
    const report = buildAuditReport(d, { deepAuditIds: [] });
    assert('report builds without throwing and is non-empty', typeof report.markdown === 'string' && report.markdown.length > 0);
    for (const r of d.resonators) {
        assert(`report mentions ${r.name}`, report.markdown.includes(`## ${r.name}`));
    }
    const categorySum = Object.values(report.categoryCounts).reduce((a, b) => a + b, 0);
    assert('category counts sum to total warnings', categorySum === report.totalWarnings);
}

console.log(`\naudit-effects: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
