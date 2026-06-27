/**
 * Tests for the committed data/wuwa-meta.json (P12 §10 meta-schema).
 *
 *   node tests/meta-schema.test.mjs
 *
 * Covers: schema conformance, every covered character has the required fields,
 * the reference rotation validates with zero warnings, weights are finite, and
 * — the strong staleness guard — the committed meta's engineHash matches the
 * CURRENT engine recomputed from src/core (catches a meta not regenerated after
 * an engine change).
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { validateRotation } = await import('../src/core/rotation-graph.js');
const { rulesForResonator } = await import('../src/core/rotation-rules.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const meta = JSON.parse(readFileSync(resolve(root, 'data/wuwa-meta.json'), 'utf8'));
const d = JSON.parse(readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── Top-level schema ─────────────────────────────────────────────────────────
{
    assert('metaVersion is a number', typeof meta.metaVersion === 'number');
    assert('gameVersion present', typeof meta.gameVersion === 'string');
    assert('generatedAt is ISO-ish', typeof meta.generatedAt === 'string' && !Number.isNaN(Date.parse(meta.generatedAt)));
    assert('engineHash present', typeof meta.engineHash === 'string' && meta.engineHash.length === 64);
    assert('erModel documents the deviation', meta.erModel === 'mode-based-v1');
    assert('characters is a non-empty object', meta.characters && Object.keys(meta.characters).length > 0);
}

// ── Per-character conformance ────────────────────────────────────────────────
for (const [id, c] of Object.entries(meta.characters)) {
    assert(`${c.name}: has referenceRotation`, Array.isArray(c.referenceRotation) && c.referenceRotation.length > 0);
    assert(`${c.name}: has templateStats`, c.templateStats && Array.isArray(c.templateStats.mains));
    assert(`${c.name}: has anchorStats`, c.anchorStats && typeof c.anchorStats.critRate === 'number');
    assert(`${c.name}: has at least S0`, c.bySequence && c.bySequence['0']);
    assert(`${c.name}: has all sequences S0..S6`, [0,1,2,3,4,5,6].every(s => c.bySequence[String(s)]));

    // referenceRotation must validate with zero prerequisite warnings (§10).
    const warns = validateRotation(c.referenceRotation, rulesForResonator(Number(id)), d.autoSkillMap[id]);
    assert(`${c.name}: referenceRotation has zero validateRotation warnings`, warns.length === 0);

    // Every scenario carries finite weights + a well-formed erMode.
    for (const [seq, bySeq] of Object.entries(c.bySequence)) {
        for (const [sonataId, entry] of Object.entries(bySeq.bySonata)) {
            const label = `${c.name} S${seq}/${sonataId}`;
            assert(`${label}: weights finite`, entry.weights && Object.values(entry.weights).every(Number.isFinite));
            assert(`${label}: erMode well-formed`, entry.erMode && typeof entry.erMode.scalesWithEr === 'boolean' && typeof entry.erMode.libCostKnown === 'boolean');
            assert(`${label}: conditionalThresholds is an array`, Array.isArray(entry.conditionalThresholds));
        }
    }
}

// ── Engine-hash staleness guard (the strong check) ───────────────────────────
{
    const ENGINE_FILES = ['formula.js', 'stats.js', 'skill.js', 'sim.js', 'buffs.js', 'stat-priority.js'];
    const h = createHash('sha256');
    for (const f of ENGINE_FILES) h.update(readFileSync(resolve(root, 'src/core', f)));
    const current = h.digest('hex');
    assert('committed meta engineHash matches the current engine (regenerate via node tools/optimize.mjs)', meta.engineHash === current);
}

console.log(`\nmeta-schema: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
