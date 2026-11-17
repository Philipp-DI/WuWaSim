/**
 * The engine fingerprint stored in data/wuwa-meta.json as `engineHash`.
 *
 * The meta is stale whenever anything it was computed from changes, so the
 * hash covers exactly that: every module the optimizer loads, found by walking
 * the import graph from tools/optimize.mjs (static AND dynamic imports), plus
 * the data files that graph reads off disk. Deriving the module list keeps it
 * from drifting; it used to be two hand-synced lists that missed 16 files.
 *
 * Raw bytes are hashed, so line endings count (.gitattributes pins LF). The
 * single exception is noted at hashedBytes().
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ENTRY_MODULE = 'tools/optimize.mjs';

// Every data file the optimizer's import graph reads with readFileSync.
// tests/engine-hash.test.mjs fails when a graph file names a data/*.json that
// is missing here. skill-map.json and data-version.json are browser-only
// fetches in src/data/loader.js; the optimizer never reads them.
export const ENGINE_DATA_FILES = [
    'data/wuwa-data.json',
    'data/patch.json',
    'data/stat-ranges.json',
    'data/reference-rotations.json',
];

// Relative specifiers in `import … from '…'`, `export … from '…'`,
// `import '…'` and `import('…')`. Bare specifiers (node:fs) are not engine.
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
// A dynamic import whose argument is not a string literal cannot be followed.
const NON_LITERAL_DYNAMIC_IMPORT = /\bimport\s*\(\s*[^'"\s]/;

function toRootRelative(absolutePath) {
    return relative(root, absolutePath).split(sep).join('/');
}

/** Root-relative paths of every module reachable from tools/optimize.mjs, sorted. */
export function engineModules() {
    const seen = new Set();
    const pending = [resolve(root, ENTRY_MODULE)];
    while (pending.length > 0) {
        const file = pending.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        const source = readFileSync(file, 'utf8');
        if (NON_LITERAL_DYNAMIC_IMPORT.test(source)) {
            throw new Error(`${toRootRelative(file)}: dynamic import with a non-literal specifier; engineHash cannot follow it`);
        }
        for (const match of source.matchAll(RELATIVE_IMPORT)) {
            const target = resolve(dirname(file), match[1]);
            if (!existsSync(target)) throw new Error(`${toRootRelative(file)}: import '${match[1]}' does not exist`);
            pending.push(target);
        }
    }
    return [...seen].map(toRootRelative).sort();
}

/** Every file the hash covers, root-relative: the modules, then the data files. */
export function engineFiles() {
    return [...engineModules(), ...ENGINE_DATA_FILES];
}

// The one exception to raw bytes: wuwa-data.json's top-level `generatedAt`
// changes on every `npm run data` rerun without any behaviour change
// (maintainer, 2026-11-17). Blanked the same way preprocess.mjs blanks it for
// the data-version manifest.
const GENERATED_AT = /"generatedAt":\s*"[^"]*"/;

export function hashedBytes(file) {
    const bytes = readFileSync(resolve(root, file));
    if (file !== 'data/wuwa-data.json') return bytes;
    return Buffer.from(bytes.toString('utf8').replace(GENERATED_AT, '"generatedAt":""'), 'utf8');
}

export function engineHash() {
    const hash = createHash('sha256');
    for (const file of engineFiles()) hash.update(hashedBytes(file));
    return hash.digest('hex');
}
