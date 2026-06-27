/**
 * Tests for the runtime meta loader (src/data/meta-loader.js, P12 §10).
 *
 *   node tests/meta-loader.test.mjs
 *
 * Covers: version-mismatch → null, engine-hash-mismatch → null, missing file →
 * null (graceful), and the metaFor / isCovered / coverage lookups.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { loadMeta, validateMeta, metaFor, isCovered, coveredSequences, coveredSonatas, EXPECTED_META_VERSION } =
    await import('../src/data/meta-loader.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Fake fetch returning a given object (or a non-ok response).
const fakeFetch = (obj, ok = true) => async () => ({ ok, json: async () => obj });

// ── validateMeta gating ──────────────────────────────────────────────────────
{
    assert('valid meta passes validation', validateMeta(meta) === meta);
    assert('version mismatch → null', validateMeta({ ...meta, metaVersion: 999 }) === null);
    assert('engine-hash mismatch → null (when checked)',
        validateMeta(meta, { expectedEngineHash: 'deadbeef' }) === null);
    assert('engine-hash match → meta (when checked)',
        validateMeta(meta, { expectedEngineHash: meta.engineHash }) === meta);
    assert('non-object → null', validateMeta(null) === null);
    assert('missing characters → null', validateMeta({ metaVersion: EXPECTED_META_VERSION }) === null);
}

// ── loadMeta with injected fetch ─────────────────────────────────────────────
{
    assert('loadMeta returns the parsed meta on a good fetch', await loadMeta({ fetchImpl: fakeFetch(meta) }) !== null);
    assert('loadMeta returns null on 404', await loadMeta({ fetchImpl: fakeFetch(null, false) }) === null);
    assert('loadMeta returns null on stale version', await loadMeta({ fetchImpl: fakeFetch({ ...meta, metaVersion: 0 }) }) === null);
    const throwingFetch = async () => { throw new Error('network'); };
    assert('loadMeta swallows fetch errors → null', await loadMeta({ fetchImpl: throwingFetch }) === null);
}

// ── lookups ──────────────────────────────────────────────────────────────────
{
    const id = Number(Object.keys(meta.characters)[0]);
    assert('isCovered true for a covered id', isCovered(meta, id) === true);
    assert('isCovered false for an unknown id', isCovered(meta, 999999) === false);

    const entry = metaFor(meta, id, 0, coveredSonatas(meta, id, 0)[0]);
    assert('metaFor returns a scenario entry with weights', entry && entry.weights && entry.erMode);
    assert('metaFor merges character context (name, referenceRotation)', entry.name && Array.isArray(entry.referenceRotation));
    assert('metaFor returns null for an uncovered sequence/sonata', metaFor(meta, id, 0, 999999) === null);
    assert('metaFor returns null for an uncovered character', metaFor(meta, 999999, 0, 1) === null);

    assert('coveredSequences returns S0..S6', coveredSequences(meta, id).join(',') === '0,1,2,3,4,5,6');
    assert('coveredSonatas returns at least one set', coveredSonatas(meta, id, 0).length >= 1);
}

console.log(`\nmeta-loader: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
