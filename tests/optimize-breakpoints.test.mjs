/**
 * Tests for P12 ER-mode analysis + conditional thresholds
 * (tools/optimize/breakpoints.js).
 *
 *   node tests/optimize-breakpoints.test.mjs
 *
 * Covers the mode-based ER design (authorized deviation, see module header):
 * scalesWithEr detection, libCostKnown gap handling, balancedTarget, and the
 * numeric conditional-threshold scanner.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { analyzeErMode, detectConditionalThresholds, BALANCED_ER_TARGET } = await import('../tools/optimize/breakpoints.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── analyzeErMode: non-ER-scaling kit with a known Liberation cost ───────────
{
    const carlotta = d.resonators.find(r => r.id === 1107);
    const m = analyzeErMode({ resonator: carlotta, dataset: d, erWeight: 0, baseline: 82527 });
    assert('Carlotta: scalesWithEr is false (ER weight 0)', m.scalesWithEr === false);
    assert('Carlotta: libCostKnown is true', m.libCostKnown === true);
    assert('Carlotta: liberationCost matches baseStats.energyMax', m.liberationCost === d.baseStats['1107'].energyMax);
    assert('balancedTarget defaults to 125%', m.balancedTarget === BALANCED_ER_TARGET && m.balancedTarget === 1.25);
}

// ── analyzeErMode: ER-scaling detection (synthetic materially-positive weight) ─
{
    const carlotta = d.resonators.find(r => r.id === 1107);
    const scaling = analyzeErMode({ resonator: carlotta, dataset: d, erWeight: 50, baseline: 82527 });
    assert('a materially positive ER weight flags scalesWithEr', scaling.scalesWithEr === true);
    const dust = analyzeErMode({ resonator: carlotta, dataset: d, erWeight: 1e-9, baseline: 82527 });
    assert('float-dust ER weight does NOT flag scalesWithEr', dust.scalesWithEr === false);
}

// ── analyzeErMode: a resonator with no Liberation energy gate ─────────────────
{
    const hiyuki = d.resonators.find(r => r.id === 1108);
    const m = analyzeErMode({ resonator: hiyuki, dataset: d, erWeight: 0, baseline: 56636 });
    assert('Hiyuki: libCostKnown is false (no baseStats.energyMax)', m.libCostKnown === false);
    assert('Hiyuki: liberationCost is null, never fabricated', m.liberationCost === null);
}

// ── detectConditionalThresholds: synthetic positive + real-data scan ─────────
{
    const synthetic = {
        resonanceChain: [{ level: 2, effects: [
            { condition: 'When DEF reaches 1000, gain 15% Crit Rate.' },
            { condition: 'Resonance Skill DMG is increased by 30%.' },          // not a threshold
        ] }],
        inherentSkills: [],
    };
    const found = detectConditionalThresholds(synthetic);
    assert('detects a "when DEF reaches 1000" threshold', found.length === 1 && found[0].stat === 'def' && found[0].value === 1000);
    assert('threshold carries its source + unlock text', found[0].source.includes('chain S2') && found[0].unlocks.length > 0);

    // Real seed characters: the scanner must not crash and must not invent
    // thresholds where the kit has none (most have none).
    for (const id of [1107, 1108, 1304, 1205, 1506, 1607]) {
        const r = d.resonators.find(x => x.id === id);
        const res = detectConditionalThresholds(r);
        assert(`${r.name}: threshold scan returns an array`, Array.isArray(res));
        assert(`${r.name}: any detected threshold is well-formed`, res.every(t => typeof t.stat === 'string' && Number.isFinite(t.value)));
    }
}

console.log(`\noptimize-breakpoints: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
