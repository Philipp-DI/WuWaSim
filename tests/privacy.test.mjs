/**
 * Privacy guard: no personal paths in anything `git add -A` would commit.
 *
 *   node tests/privacy.test.mjs
 *
 * The repository is public. A user-profile path (a Windows drive, then the
 * Users folder, then the account name; a Linux or macOS home directory; a
 * Windows AppData folder) carries the account name, so none may appear in a
 * tracked or committable file. Ignored files, such as
 * .claude/settings.local.json, never leave the machine and are not scanned.
 * This file is skipped: its patterns would match themselves.
 *
 * Any absolute drive path (`G:/Software/…`) is refused too: it reveals the
 * machine layout without making anything reproducible. Extractors write paths
 * relative to the export root; tools read machine paths from the gitignored
 * update-game-version/local.json. docs/history/ is exempt from that one rule:
 * it records the paths past runs used.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tests/privacy.test.mjs';
const PERSONAL_PATHS = [
    { name: 'Windows user profile', pattern: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/ },
    { name: 'Linux home directory', pattern: /\/home\/[A-Za-z0-9._-]+\// },
    { name: 'macOS home directory', pattern: /\/Users\/[A-Za-z0-9._-]+\// },
    { name: 'Windows AppData folder', pattern: /AppData[\\/]/ },
    // Must start a token, so kit text such as "{0}s:\nWhen" is not a path.
    {
        name: 'machine drive',
        pattern: /(?:^|[\s"'`(=])[A-Za-z]:[\\/]+[A-Za-z]/m,
        exempt: ['docs/history/', 'tests/hooks.test.mjs'],   // hooks: generic C:\repo fixtures
    },
];

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const DRIVE = PERSONAL_PATHS.find(rule => rule.name === 'machine drive').pattern;
assert('a quoted drive path is a machine path', DRIVE.test('"G:\\\\Some\\\\Folder"'));
assert('a forward-slash drive path is one', DRIVE.test(' d:/Some'));
assert('kit text with an escaped newline is not', !DRIVE.test('{0}s:\\nWhen casting'));
assert('a URL is not', !DRIVE.test('see https://example.com/a'));

const listing = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
assert('git can list the committable files', listing.status === 0);
const files = (listing.stdout ?? '').split('\0').filter(file => file && file !== SELF && !file.startsWith('node_modules/'));
assert('the scan covers the repository', files.length > 100);

for (const file of files) {
    let buffer;
    try {
        buffer = readFileSync(join(ROOT, file));
    } catch {
        continue; // listed but deleted in the working tree: nothing to commit
    }
    if (buffer.subarray(0, 8000).includes(0)) continue; // binary
    const text = buffer.toString('utf8');
    for (const { name, pattern, exempt = [] } of PERSONAL_PATHS) {
        if (exempt.some(prefix => file.startsWith(prefix))) continue;
        const match = text.match(pattern);
        assert(`${file}: no ${name} path${match ? ` (found "${match[0]}")` : ''}`, !match);
    }
}

console.log(`\nprivacy: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
