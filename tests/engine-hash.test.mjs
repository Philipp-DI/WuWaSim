/**
 * Tests for tools/engine-hash.mjs: the file set behind the meta's engineHash.
 *
 *   node tests/engine-hash.test.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineModules, engineFiles, engineHash, hashedBytes, ENGINE_DATA_FILES } from '../tools/engine-hash.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const modules = engineModules();

// The two sim entry points and everything the optimizer reaches only through
// `await import(...)` (tools/optimize.mjs) must be followed.
for (const expected of [
    'tools/optimize.mjs', 'tools/engine-hash.mjs',
    'src/core/sim.js', 'src/core/team-sim.js', 'src/core/target.js', 'src/data/loader.js',
    'src/core/build.js', 'src/core/rotation-graph.js', 'src/core/substat-allocate.js',
    'tools/optimize/reference-build.js', 'tools/optimize/team-rank.js', 'tools/optimize/synergy-hints.js',
]) {
    assert(`engine modules include ${expected}`, modules.includes(expected));
}
assert('no UI module is part of the engine', !modules.some(file => file.startsWith('src/ui/')));
assert('modules are sorted and unique', JSON.stringify(modules) === JSON.stringify([...new Set(modules)].sort()));

// Drift guard: a data file read by any engine module must be hashed. Only
// same-line `readFileSync(... 'data/x.json' ...)` reads are detected.
// src/data/loader.js is excluded: its data paths are browser fetches.
const dataPathLiteral = /['"](?:\.\.\/)*(data\/[\w-]+\.json)['"]/g;
for (const module of modules.filter(file => file !== 'src/data/loader.js')) {
    for (const line of readFileSync(resolve(root, module), 'utf8').split('\n')) {
        if (!line.includes('readFileSync(')) continue;
        for (const match of line.matchAll(dataPathLiteral)) {
            assert(`${module} reads ${match[1]}, which ENGINE_DATA_FILES must list`, ENGINE_DATA_FILES.includes(match[1]));
        }
    }
}
assert('the meta itself is never hashed', !engineFiles().includes('data/wuwa-meta.json'));
assert('engineFiles = modules + data files', engineFiles().length === modules.length + ENGINE_DATA_FILES.length);
assert('engineHash is a sha256 hex digest and deterministic', /^[0-9a-f]{64}$/.test(engineHash()) && engineHash() === engineHash());

// wuwa-data.json's generatedAt churns on every `npm run data`; it is blanked.
const hashedData = hashedBytes('data/wuwa-data.json').toString('utf8');
assert('wuwa-data.json is hashed with generatedAt blanked', hashedData.includes('"generatedAt":""'));
assert('only generatedAt is blanked in wuwa-data.json',
    hashedData === readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8').replace(/"generatedAt":\s*"[^"]*"/, '"generatedAt":""'));
assert('other files are hashed as raw bytes', hashedBytes('data/patch.json').equals(readFileSync(resolve(root, 'data/patch.json'))));

console.log(`engine-hash: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
