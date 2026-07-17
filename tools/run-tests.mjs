// tools/run-tests.mjs
/**
 * Cross-platform test runner (`npm test`) — replaces the bash/PowerShell
 * loop that used to live only in CLAUDE.md.
 *
 * Runs every tests/*.test.mjs sequentially (always the whole directory —
 * never a hand-picked list), prints one line per file, replays a failing
 * file's full output, and exits non-zero if anything failed.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = resolve(root, 'tests');
const files = readdirSync(testsDir).filter(name => name.endsWith('.test.mjs')).sort();

const failures = [];
for (const file of files) {
    const run = spawnSync(process.execPath, [resolve(testsDir, file)], { encoding: 'utf8' });
    if (run.status === 0) {
        console.log(`PASS ${file}`);
    } else {
        failures.push(file);
        console.log(`FAIL ${file}`);
        if (run.stdout) process.stdout.write(run.stdout);
        if (run.stderr) process.stderr.write(run.stderr);
    }
}

console.log(`\n${files.length - failures.length}/${files.length} test files passed`);
if (failures.length > 0) {
    console.log(`Failed: ${failures.join(', ')}`);
    process.exit(1);
}
