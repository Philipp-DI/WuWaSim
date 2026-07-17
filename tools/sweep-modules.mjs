// tools/sweep-modules.mjs
/**
 * Module-load sweep (`npm run sweep`) — imports EVERY module under src/ so
 * an ES-module parse error or a broken import path fails here (and in CI),
 * not in a user's browser. There is no bundler to catch these otherwise.
 *
 * Replaces the hand-kept module list that used to live in CLAUDE.md: new
 * modules are covered automatically, nothing to keep in sync.
 *
 * Single exclusion: src/ui/app.js touches the DOM at import time (it is the
 * browser entry point). Every other module — core, data, ui components —
 * must import cleanly in plain Node.
 */
import { readdirSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['src/ui/app.js']);

function* walkJsFiles(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) yield* walkJsFiles(path);
        else if (entry.name.endsWith('.js')) yield path;
    }
}

let imported = 0;
let skipped = 0;
const failures = [];
for (const path of walkJsFiles(resolve(root, 'src'))) {
    const rel = relative(root, path).replaceAll('\\', '/');
    if (SKIP.has(rel)) { skipped++; continue; }
    try {
        await import(pathToFileURL(path));
        imported++;
    } catch (error) {
        failures.push(`${rel} -> ${String(error?.message ?? error).split('\n')[0]}`);
    }
}

for (const failure of failures) console.log(`FAIL ${failure}`);
console.log(`module-load sweep: ${imported} imported, ${skipped} skipped (DOM entry point), ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
