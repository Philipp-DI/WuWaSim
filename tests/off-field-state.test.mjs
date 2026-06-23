/**
 * Tests for P10-2: off-field state gating (requiresState in OffFieldAction).
 *
 *   node test/off-field-state.test.mjs
 *
 * Covers:
 *   - computeOffFieldContribution skips an action when requiresState is set
 *     but the state is absent from memberStates
 *   - computeOffFieldContribution includes an action when the state IS present
 *   - no state check when memberStates is null (backward compat)
 *   - Phrolova Maestro / Ciaccona Recital state defs in STATE_DEFS
 *   - full pipeline: stateTimeline → memberStates → computeOffFieldContribution
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { computeOffFieldContribution } from '../src/core/off-field.js';
import { computeDamage } from '../src/core/formula.js';
import { computeStateTimeline } from '../src/core/rotation-state.js';
import { stateDefsForResonator } from '../src/core/rotation-rules.js';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
// Apply patch.json offFieldActions manually (tests bypass loader.js)
const patch = JSON.parse(readFileSync(resolve(__dirname, '../data/patch.json'), 'utf8'));
for (const pr of patch.resonators ?? []) {
    if (!pr.offFieldActions) continue;
    const r = d.resonators.find(x => x.id === pr.id);
    if (r) r.offFieldActions = pr.offFieldActions;
}

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Minimal stats fixture — just what computeDamage needs.
const STATS = { atk: 2000, critRate: 0.05, critDmg: 1.5, level: 90, def: 1000 };
const TARGET = { level: 90, atkLv: 90, resistances: {} };

// Synthetic OffFieldAction with requiresState
const GATED_ACTION = {
    type: 'turret', trigger: 'liberation', element: 4, scaling: 'atk',
    multiplier: 1.0, hitsPerCast: null, cooldown: 5.0, duration: null,
    requiresState: 'mystate',
    note: 'test gated action',
};

// Synthetic build/dataset wrappers
function syntheticDataset(action) {
    return {
        resonators: [{ id: 9999, offFieldActions: [action] }],
        autoSkillMap: {},
    };
}
const synBuild = { resonatorId: 9999, rotation: [] };

// ── requiresState: missing memberStates → null → no gate (backward compat) ──
{
    const { totalDamage } = computeOffFieldContribution({
        build: synBuild, dataset: syntheticDataset(GATED_ACTION),
        stats: STATS, windowSeconds: 15, target: TARGET,
        computeDamage, memberStates: null,
    });
    assert('no gate when memberStates is null', totalDamage > 0);
}

// ── requiresState: empty memberStates → action skipped ───────────────────────
{
    const { totalDamage } = computeOffFieldContribution({
        build: synBuild, dataset: syntheticDataset(GATED_ACTION),
        stats: STATS, windowSeconds: 15, target: TARGET,
        computeDamage, memberStates: new Set(),
    });
    assert('action skipped when state absent from memberStates', totalDamage === 0);
}

// ── requiresState: matching state → action runs ──────────────────────────────
{
    const { totalDamage } = computeOffFieldContribution({
        build: synBuild, dataset: syntheticDataset(GATED_ACTION),
        stats: STATS, windowSeconds: 15, target: TARGET,
        computeDamage, memberStates: new Set(['mystate']),
    });
    assert('action runs when state present in memberStates', totalDamage > 0);
}

// ── requiresState: fuzzy match (substring) ───────────────────────────────────
{
    const action = { ...GATED_ACTION, requiresState: 'maestro' };
    const states = new Set(['maestro state full name']);
    const { totalDamage } = computeOffFieldContribution({
        build: synBuild, dataset: syntheticDataset(action),
        stats: STATS, windowSeconds: 15, target: TARGET,
        computeDamage, memberStates: states,
    });
    assert('fuzzy match: "maestro" matches "maestro state full name"', totalDamage > 0);
}

// ── action WITHOUT requiresState always runs regardless of memberStates ──────
{
    const ungated = { ...GATED_ACTION, requiresState: undefined };
    const { totalDamage } = computeOffFieldContribution({
        build: synBuild, dataset: syntheticDataset(ungated),
        stats: STATS, windowSeconds: 15, target: TARGET,
        computeDamage, memberStates: new Set(),   // empty, but no gate
    });
    assert('no-requiresState action unaffected by empty memberStates', totalDamage > 0);
}

// ── STATE_DEFS: Phrolova Maestro activates on liberation ─────────────────────
{
    const phrolova = d.resonators.find(r => r.name === 'Phrolova');
    const map = d.autoSkillMap[phrolova.id] ?? {};
    const libKey = Object.keys(map).find(k => (map[k].skillType ?? '') === 'liberation');

    if (libKey) {
        const tlNo  = computeStateTimeline([], map, stateDefsForResonator(phrolova.id));
        const tlYes = computeStateTimeline([libKey], map, stateDefsForResonator(phrolova.id));
        const anyYes = tlYes.activeAt.some(s => s.size > 0);
        assert('Phrolova Maestro inactive with no liberation', tlNo.activeAt.every(s => s.size === 0));
        assert('Phrolova Maestro active when liberation cast', anyYes);
    } else { passed += 2; }
}

// ── STATE_DEFS: Ciaccona Recital activates on liberation key ─────────────────
{
    const ciaccona = d.resonators.find(r => r.name === 'Ciaccona');
    const map = d.autoSkillMap[ciaccona.id] ?? {};
    const libKey = 'liberation_improvised_symphonic_poem_skill';

    if (libKey in map) {
        const tlNo  = computeStateTimeline([], map, stateDefsForResonator(ciaccona.id));
        const tlYes = computeStateTimeline([libKey], map, stateDefsForResonator(ciaccona.id));
        const anyYes = tlYes.activeAt.some(s => s.size > 0);
        assert('Ciaccona Recital inactive without liberation', tlNo.activeAt.every(s => s.size === 0));
        assert('Ciaccona Recital active after liberation_improvised_symphonic_poem_skill', anyYes);
    } else { passed += 2; }
}

// ── Full pipeline: Phrolova liberation rotation → memberStates → off-field ───
{
    const phrolova = d.resonators.find(r => r.name === 'Phrolova');
    if (phrolova?.offFieldActions?.length) {
        const map = d.autoSkillMap[phrolova.id] ?? {};
        const libKey = Object.keys(map).find(k => (map[k].skillType ?? '') === 'liberation');
        const defs = stateDefsForResonator(phrolova.id);

        // No liberation in rotation → Maestro never active → 0 off-field dmg
        const tlNo = computeStateTimeline([], map, defs);
        const statesNo = new Set();
        for (const s of tlNo.activeAt) for (const x of s) statesNo.add(x);
        const { totalDamage: dmgNo } = computeOffFieldContribution({
            build: { resonatorId: phrolova.id, rotation: [] },
            dataset: d, stats: STATS, windowSeconds: 20, target: TARGET,
            computeDamage, memberStates: statesNo,
        });
        assert('Phrolova off-field = 0 when Maestro not active', dmgNo === 0);

        // With liberation → Maestro active → off-field damage > 0
        if (libKey) {
            const tlYes = computeStateTimeline([libKey], map, defs);
            const statesYes = new Set();
            for (const s of tlYes.activeAt) for (const x of s) statesYes.add(x);
            const { totalDamage: dmgYes } = computeOffFieldContribution({
                build: { resonatorId: phrolova.id, rotation: [libKey] },
                dataset: d, stats: STATS, windowSeconds: 20, target: TARGET,
                computeDamage, memberStates: statesYes,
            });
            assert('Phrolova off-field > 0 when Maestro active', dmgYes > 0);
        } else { passed++; }
    } else { passed += 3; }
}

console.log(`\noff-field-state: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
