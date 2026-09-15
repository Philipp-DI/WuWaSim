#!/usr/bin/env node
/**
 * Work out the SMALLEST FModel load that can produce everything the extractors
 * need — so a game patch costs a targeted export instead of dumping the client.
 *
 * The problem this solves is not "which files do I export" (that is
 * `tools/extract/export-manifest.json`, checked by `tools/check-export.mjs`).
 * It is that FModel mounts every `.pak` in the game's Paks directory — 55 of
 * them, ~81 GB — before you can export a single byte, and most of those mounts
 * are Wwise audio that nothing here reads.
 *
 * The paks are AES-encrypted with a main key plus ~450 per-chunk dynamic keys
 * and Oodle-compressed, so reading them directly would mean reimplementing
 * CUE4Parse. The cheap lever instead: **each pak declares a MOUNT POINT**, and
 * FModel writes it to its own log on every run. A pak whose mount point is not a
 * prefix of a path we need cannot contain that path, so it never has to be
 * loaded. Point FModel at a directory holding only the survivors — CUE4Parse
 * scans a directory for `*.pak`, it does not require the full set — and the
 * mount step drops from ~81 GB to a couple of GB.
 *
 * That mapping is DERIVED, not hardcoded: it is read out of the log each run, so
 * it follows the game when Kuro re-chunks the paks. A patch pak (`*_P.pak`)
 * carries the updated files and must be loaded ALONGSIDE its base, which is why
 * both are kept whenever either matches.
 *
 * Usage:
 *   node tools/plan-export.mjs                 # newest FModel log
 *   node tools/plan-export.mjs --log <path>    # a specific log
 *   node tools/plan-export.mjs --link          # emit the slim-directory commands
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, 'extract/export-manifest.json'), 'utf8'));

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

const settingsPath = join(process.env.APPDATA ?? '', 'FModel', 'AppSettings.json');
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
const gameDir = settings.GameDirectory ?? null;
const pakDir = gameDir ? join(gameDir, 'Client', 'Content', 'Paks') : null;
const logDir = settings.OutputDirectory ? join(settings.OutputDirectory, 'Logs') : null;

function newestLog() {
    if (!logDir || !existsSync(logDir)) return null;
    const logs = readdirSync(logDir).filter(name => name.endsWith('.log'))
        .map(name => ({ name, at: statSync(join(logDir, name)).mtimeMs }))
        .sort((left, right) => right.at - left.at);
    return logs.length ? join(logDir, logs[0].name) : null;
}

const logPath = flag('--log') ?? newestLog();
if (!logPath || !existsSync(logPath)) {
    console.error('No FModel log found. Run FModel once (it logs every pak it mounts), or pass --log <path>.');
    process.exit(2);
}

// "Pak "<name>": <n> files (<n> encrypted), mount point: "<path>""
const mounts = new Map();
for (const match of readFileSync(logPath, 'utf8')
    .matchAll(/Pak "([^"]+)": (\d+) files \(\d+ encrypted\), mount point: "([^"]+)"/g)) {
    mounts.set(match[1], { files: Number(match[2]), mount: match[3] });
}
if (!mounts.size) {
    console.error(`No pak mounts found in ${logPath}.`);
    process.exit(2);
}

// Manifest paths are relative to the EXPORT root ("Content/Aki/..."); a pak's
// mount point is relative to the game root and carries the "Client/" prefix.
const needed = [];
for (const [name, group] of Object.entries(manifest.groups)) {
    for (const entry of group.paths ?? []) needed.push({ path: `Client/${entry.path}`, group: name });
}
if (manifest.groups.characterAssets?.pathPattern) {
    needed.push({ path: 'Client/Content/Aki/Character/Role/', group: 'characterAssets' });
}

const sizeOf = (pak) => (pakDir && existsSync(join(pakDir, pak))) ? statSync(join(pakDir, pak)).size : 0;
const baseName = (pak) => pak.replace(/_P\.pak$/, '.pak');

// A pak can hold a path only if its mount point is a prefix of it — but that
// test alone is useless, because the bulk chunks mount at "Client/Content/" and
// so are a prefix of everything (it selects 69 of 81 GB).
//
// The content is chunked BY FOLDER: the game ships dedicated paks mounted at
// "Client/Content/Aki/ConfigDB/" and "Client/Content/Aki/Character/Role/". So
// the MOST SPECIFIC mount covering a path is the chunk that actually holds it,
// and the generic parents are the ones worth dropping. That is a heuristic about
// how Kuro chunks, not a guarantee — which is exactly why the flow ends at
// `check-export.mjs`: if a file turns out to live somewhere else, the verifier
// names it and you widen by loading the next-most-specific pak.
const chosen = new Map();
for (const want of needed) {
    let best = '';
    for (const info of mounts.values()) {
        const covers = want.path.startsWith(info.mount) || info.mount.startsWith(want.path);
        if (covers && info.mount.length > best.length) best = info.mount;
    }
    if (!best) continue;
    for (const [pak, info] of mounts) {
        if (info.mount !== best) continue;
        if (!chosen.has(pak)) chosen.set(pak, { info, wants: new Set() });
        chosen.get(pak).wants.add(want.group);
    }
}
// A patch pak travels with its base and vice versa.
for (const pak of [...chosen.keys()]) {
    for (const sibling of [baseName(pak), baseName(pak).replace(/\.pak$/, '_P.pak')]) {
        if (mounts.has(sibling) && !chosen.has(sibling)) {
            chosen.set(sibling, { info: mounts.get(sibling), wants: new Set(chosen.get(pak).wants) });
        }
    }
}

// THE LOG IS HISTORY, THE DISK IS NOW. FModel's log accumulates every pak it
// ever mounted, across game versions, and a Steam update rewrites the pak set —
// the `_P` patch paks of one version are folded into the base paks of the next
// and vanish. The first version of this script listed four of them as "0 MB",
// and a symlink to a file that does not exist is a dangling link FModel cannot
// mount. So a pak the log names but the disk lacks is dropped here and reported,
// never emitted.
const onDisk = new Set(pakDir && existsSync(pakDir) ? readdirSync(pakDir).filter(name => name.endsWith('.pak')) : []);
const stale = [...chosen.keys()].filter(pak => onDisk.size && !onDisk.has(pak));
for (const pak of stale) chosen.delete(pak);

const allBytes = [...onDisk].reduce((sum, pak) => sum + sizeOf(pak), 0);
const keepBytes = [...chosen.keys()].reduce((sum, pak) => sum + sizeOf(pak), 0);

console.log(`log:  ${logPath}`);
console.log(`disk: ${onDisk.size} paks in ${pakDir ?? '(unknown — no FModel GameDirectory)'}`);
console.log(`paks: ${chosen.size} needed`
    + (allBytes ? `  (${(keepBytes / 1e9).toFixed(2)} GB of ${(allBytes / 1e9).toFixed(1)} GB on disk)` : ''));
if (stale.length) {
    console.log(`\n  dropped ${stale.length} pak(s) the log names but the disk no longer has (an older patch's files):`);
    for (const pak of stale) console.log(`    ${pak}`);
}
console.log();
for (const [pak, entry] of [...chosen].sort((left, right) => sizeOf(right[0]) - sizeOf(left[0]))) {
    console.log(`  ${pak.padEnd(44)} ${(sizeOf(pak) / 1e6).toFixed(0).padStart(6)} MB   ${entry.info.mount}`);
    console.log(`  ${' '.repeat(44)}        for: ${[...entry.wants].join(', ')}`);
}

if (argv.includes('--link')) {
    // FModel resolves <GameDirectory>/Client/Content/Paks, so the slim tree has
    // to MIRROR that shape — a bare folder of paks is not something it can be
    // pointed at. Symlinks, so nothing is copied and no disk is spent.
    const slimRoot = flag('--slim') ?? 'G:\\WuWaSlim';
    const slimPaks = join(slimRoot, 'Client', 'Content', 'Paks');
    // Errors are left VISIBLE: the first draft piped every line to Out-Null,
    // which is precisely what hid a silent failure from the maintainer. Each
    // link prints its LinkType and Target on success, so a dangling or missing
    // link is obvious in the transcript.
    console.log(`\n# Build a slim game root (symlinks — nothing is copied).`);
    console.log(`# Symlinks need Developer Mode (Settings > System > For developers) OR an`);
    console.log(`# elevated PowerShell. Then set FModel's Game Directory to:  ${slimRoot}`);
    console.log(`New-Item -ItemType Directory -Force '${slimPaks}' | Select-Object FullName`);
    // Every pak ships with a `.sig` beside it, and CUE4Parse can refuse a pak
    // whose signature file is missing — so the sig travels with the pak.
    for (const pak of [...chosen.keys()].sort()) {
        for (const file of [pak, pak.replace(/\.pak$/, '.sig')]) {
            if (!existsSync(join(pakDir ?? '', file))) continue;
            console.log(`New-Item -ItemType SymbolicLink -Path '${join(slimPaks, file)}' -Target '${join(pakDir ?? '', file)}' -Force | Select-Object Name, LinkType`);
        }
    }
    console.log(`# The AES keys are per-pak GUID and unchanged, so FModel's stored keys still apply.`);
    console.log(`# Re-run after every game patch: Steam rewrites the pak set and stale links dangle.`);
} else {
    console.log('\nRun again with --link for the slim-directory commands.');
}

console.log('\nThen, in FModel, export these folders (right-click > Export Folder\'s Packages Raw Data):');
const folders = new Set();
for (const [name, group] of Object.entries(manifest.groups)) {
    if (name === 'characterAssets') continue;
    for (const entry of group.paths ?? []) {
        folders.add(entry.kind === 'dir' ? entry.path : dirname(entry.path).replace(/\\/g, '/'));
    }
}
for (const folder of [...folders].sort()) console.log(`  ${folder}/`);
console.log(`  ${manifest.groups.characterAssets.pathPattern}   (only for resonators that changed)`);
console.log('\nVerify with:  node tools/check-export.mjs <export-root>');
