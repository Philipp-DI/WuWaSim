#!/usr/bin/env node
/**
 * Verify a targeted FModel export before running any ConfigDB extractor.
 *
 * A FULL Client export is ~1 GB of ConfigDB alone (486 `db_*.db`). The
 * extractors read SIX of them plus a handful of small JavaScript files — about
 * 16 MB. So a version bump does not need the whole client re-exported; it needs
 * this list. `tools/extract/export-manifest.json` is that list, and this script
 * is what proves an export satisfies it.
 *
 * WHY A CHECKER AND NOT JUST A LIST: a missing table does not fail loudly. The
 * extractors read what they find and write a smaller JSON, so an incomplete
 * export surfaces later as a buff that quietly stopped existing — the exact
 * failure mode this project keeps finding by accident. A ZERO-BYTE file is the
 * nastier version of it: this export already carries two (db_PropertyIndex,
 * db_ElementalReaction), which look present to any `existsSync` check and parse
 * as an empty table. Size is therefore checked, not just existence.
 *
 * Usage:
 *   node tools/check-export.mjs <export-root>            # verify
 *   node tools/check-export.mjs <export-root> --list     # print the paths to select in FModel
 *   node tools/check-export.mjs <export-root> --for 1212 # add one resonator's asset dir
 *
 * Exits non-zero when anything required is missing or empty.
 */
import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, 'extract/export-manifest.json'), 'utf8'));

const argv = process.argv.slice(2);
const root = argv.find(arg => !arg.startsWith('--'));
const listOnly = argv.includes('--list');
const forIndex = argv.indexOf('--for');
const forResonator = forIndex >= 0 ? argv[forIndex + 1] : null;

if (!root && !listOnly) {
    console.error('Usage: node tools/check-export.mjs <export-root> [--list] [--for <resonatorId>]');
    process.exit(2);
}

const groups = ['configdb', 'accessors', 'clientLogic'];
const wanted = [];
for (const name of groups) {
    for (const entry of manifest.groups[name].paths) {
        wanted.push({ ...entry, group: name, required: entry.required !== false });
    }
}

// A resonator's own asset directory, read from the repo's committed timing data
// rather than guessed — it records the source_table each covered resonator was
// extracted from. A brand-new resonator has no entry, which is itself the
// answer: their directory has never been exported.
function assetDirsFor(resonatorId) {
    const path = resolve(here, '../data/timing-data.json');
    if (!existsSync(path)) return [];
    const entry = JSON.parse(readFileSync(path, 'utf8')).resonators?.[String(resonatorId)];
    if (!entry) return null;
    return [...new Set((entry.source_table ?? [])
        .map(table => table.split('/').slice(0, 2).join('/'))
        .filter(Boolean))];
}

if (listOnly) {
    console.log('# Select these under Content/ in FModel, then Export.');
    console.log('# Everything else in the client is unnecessary for the extractors.\n');
    for (const name of groups) {
        console.log(`# --- ${name}: ${manifest.groups[name].why.split('.')[0]}.`);
        for (const entry of manifest.groups[name].paths) {
            console.log(entry.path + (entry.required === false ? '   (optional)' : ''));
        }
        console.log();
    }
    console.log('# --- characterAssets: only for resonators that CHANGED this patch.');
    console.log(`# ${manifest.groups.characterAssets.pathPattern}`);
    if (forResonator) {
        const dirs = assetDirsFor(forResonator);
        if (dirs === null) {
            console.log(`# resonator ${forResonator} has no timing-data entry yet — find their directory by name`);
        } else for (const dir of dirs) console.log(`Content/Aki/Character/Role/${dir}/`);
    }
    process.exit(0);
}

let missing = 0, empty = 0, bytes = 0;
const report = [];
for (const entry of wanted) {
    const full = join(root, entry.path);
    const isDir = entry.kind === 'dir';
    if (!existsSync(full)) {
        report.push([entry.required ? 'MISSING' : 'absent', entry.path, entry.required ? '' : '(optional)']);
        if (entry.required) missing++;
        continue;
    }
    let size;
    if (isDir) {
        const files = readdirSync(full).filter(name => name.endsWith('.js'));
        if (!files.length) { report.push(['EMPTY', entry.path, 'directory has no .js files']); empty++; continue; }
        size = files.reduce((sum, name) => sum + statSync(join(full, name)).size, 0);
    } else {
        size = statSync(full).size;
        if (size === 0) { report.push(['EMPTY', entry.path, 'zero bytes — re-export this one']); empty++; continue; }
    }
    bytes += size;
    report.push(['ok', entry.path, `${(size / 1024).toFixed(0)} KB`]);
}

for (const [status, path, note] of report) {
    const mark = status === 'ok' ? '  ok    ' : status === 'absent' ? '  --    ' : `  ${status.padEnd(6)}`;
    console.log(`${mark}${path}${note ? '   ' + note : ''}`);
}

console.log(`\n${(bytes / 1048576).toFixed(1)} MB of required export present.`);

const configDbDir = join(root, 'Content/Aki/ConfigDB');
if (existsSync(configDbDir)) {
    const all = readdirSync(configDbDir).filter(name => name.endsWith('.db'));
    console.log(`ConfigDB holds ${all.length} tables; the extractors read ${manifest.groups.configdb.paths.length}.`);
}

if (forResonator) {
    const dirs = assetDirsFor(forResonator);
    if (dirs === null) {
        console.log(`\nresonator ${forResonator}: no timing-data entry — their character assets have never been exported.`);
    } else {
        console.log(`\nresonator ${forResonator} asset dirs:`);
        for (const dir of dirs) {
            const full = join(root, 'Content/Aki/Character/Role', dir);
            console.log(`  ${existsSync(full) ? 'ok    ' : 'MISSING'} Content/Aki/Character/Role/${dir}/`);
            if (!existsSync(full)) missing++;
        }
    }
}

if (missing || empty) {
    console.error(`\nFAIL: ${missing} missing, ${empty} empty. Run with --list for the FModel selection.`);
    process.exit(1);
}
console.log('\nExport is sufficient for every ConfigDB extractor.');
