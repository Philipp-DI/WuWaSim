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
 *   node tools/plan-export.mjs --profile       # FModel CLOSED: give the slim root the
 *                                              # game's AES keys + UE version profile
 */
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, copyFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, 'extract/export-manifest.json'), 'utf8'));

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

const settingsPath = join(process.env.APPDATA ?? '', 'FModel', 'AppSettings.json');
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
const slimRootArg = flag('--slim') ?? 'G:\\WuWaSlim';
// The REAL install, not whatever FModel currently points at — once the slim
// root is in use that is the slim root, which has no Saved/Resources and
// would send the planner looking for hotfixes inside its own output. Same rule
// `--profile` uses: the profile that is not the slim root and holds the keys.
const gameDir = (() => {
    const profiles = Object.keys(settings.PerDirectory ?? {})
        .filter(path => path !== slimRootArg && existsSync(join(path, 'Client', 'Content', 'Paks')))
        .sort((left, right) => (settings.PerDirectory[right].AesKeys?.dynamicKeys?.length ?? 0) - (settings.PerDirectory[left].AesKeys?.dynamicKeys?.length ?? 0));
    return profiles[0] ?? (settings.GameDirectory !== slimRootArg ? settings.GameDirectory : null) ?? null;
})();
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

// THE BASE PAKS ARE NOT THE LIVE GAME. Steam's Content/Paks holds the version
// the client was INSTALLED at (BuildInfo said 3.6.0); everything since arrives
// as `_P` patch paks under Client/Saved/Resources/<version>/<lane>/<hotfix>/,
// which the client mounts OVER the base. That is why a full-root FModel load
// read 248 paks when Content/Paks holds 55: the other 193 are hot-patches. An
// export that links only the base paks is an export of launch day — and that is
// exactly how Thousandfold Deliverance's Crit DMG read 6%/stack from the base
// `db_buff` while the live stat sheet showed 4%: the 3.6.15 patch to pakchunk44
// (931 MB, a near-full ConfigDB re-ship) had never been mounted. ~~"The log is
// history, the disk is now": a `_P` pak the log names but Content/Paks lacks was
// dropped as stale.~~ It was not stale; it was in the other directory. So the
// planner resolves every chosen base pak's `_P` sibling in the NEWEST hotfix of
// the Resource lane, and a pak found in neither place is what gets dropped.
const hotfixDir = (() => {
    const resources = gameDir ? join(gameDir, 'Client', 'Saved', 'Resources') : null;
    if (!resources || !existsSync(resources)) return null;
    // Only version-shaped names: Saved/Resources also holds "Video", which a
    // plain sort puts above "3.6.0".
    const byVersion = (dir) => readdirSync(dir)
        .filter(name => /^\d+(\.\d+)*$/.test(name) && statSync(join(dir, name)).isDirectory())
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    const version = byVersion(resources)[0];
    const lane = version ? join(resources, version, 'Resource') : null;
    if (!lane || !existsSync(lane)) return null;
    const hotfix = byVersion(lane)[0];
    return hotfix ? join(lane, hotfix) : null;
})();
const patchOnDisk = new Set(hotfixDir ? readdirSync(hotfixDir).filter(name => name.endsWith('_P.pak')) : []);
const baseOnDisk = new Set(pakDir && existsSync(pakDir) ? readdirSync(pakDir).filter(name => name.endsWith('.pak')) : []);
// Where a pak actually lives, so the link targets the right directory.
const locate = (pak) => baseOnDisk.has(pak) ? join(pakDir, pak)
    : patchOnDisk.has(pak) && hotfixDir ? join(hotfixDir, pak) : null;

for (const pak of [...chosen.keys()]) {
    const patch = baseName(pak).replace(/\.pak$/, '_P.pak');
    if (patchOnDisk.has(patch) && !chosen.has(patch)) {
        chosen.set(patch, { info: { mount: chosen.get(pak).info.mount + ' (hotfix)' }, wants: new Set(chosen.get(pak).wants) });
    }
}
const stale = [...chosen.keys()].filter(pak => (baseOnDisk.size || patchOnDisk.size) && !locate(pak));
for (const pak of stale) chosen.delete(pak);

const sizeAt = (pak) => { const path = locate(pak); return path && existsSync(path) ? statSync(path).size : 0; };
const allBytes = [...baseOnDisk].reduce((sum, pak) => sum + sizeOf(pak), 0)
    + [...patchOnDisk].reduce((sum, pak) => sum + (hotfixDir ? statSync(join(hotfixDir, pak)).size : 0), 0);
const keepBytes = [...chosen.keys()].reduce((sum, pak) => sum + sizeAt(pak), 0);

console.log(`log:     ${logPath}`);
console.log(`base:    ${baseOnDisk.size} paks in ${pakDir ?? '(unknown — no FModel GameDirectory)'}`);
console.log(`hotfix:  ${patchOnDisk.size} patch paks in ${hotfixDir ?? '(none found under Client/Saved/Resources)'}`);
console.log(`paks:    ${chosen.size} needed`
    + (allBytes ? `  (${(keepBytes / 1e9).toFixed(2)} GB of ${(allBytes / 1e9).toFixed(1)} GB on disk)` : ''));
if (stale.length) {
    console.log(`\n  dropped ${stale.length} pak(s) the log names but neither directory has:`);
    for (const pak of stale) console.log(`    ${pak}`);
}
console.log();
for (const [pak, entry] of [...chosen].sort((left, right) => sizeAt(right[0]) - sizeAt(left[0]))) {
    console.log(`  ${pak.padEnd(44)} ${(sizeAt(pak) / 1e6).toFixed(0).padStart(6)} MB   ${entry.info.mount}`);
    console.log(`  ${' '.repeat(44)}        for: ${[...entry.wants].join(', ')}`);
}

if (argv.includes('--link')) {
    // FModel resolves <GameDirectory>/Client/Content/Paks, so the slim tree has
    // to MIRROR that shape — a bare folder of paks is not something it can be
    // pointed at. Symlinks, so nothing is copied and no disk is spent.
    const slimRoot = slimRootArg;
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
    // whose signature file is missing — so the sig travels with the pak. A base
    // pak links from Content/Paks and its `_P` hotfix from Saved/Resources; both
    // land in ONE slim Paks dir, where the `_P` suffix gives the patch mount
    // priority exactly as it does in the real install.
    for (const pak of [...chosen.keys()].sort()) {
        const source = locate(pak);
        if (!source) continue;
        for (const file of [source, source.replace(/\.pak$/, '.sig')]) {
            if (!existsSync(file)) continue;
            const name = file.slice(file.lastIndexOf('\\') + 1);
            console.log(`New-Item -ItemType SymbolicLink -Path '${join(slimPaks, name)}' -Target '${file}' -Force | Select-Object Name, LinkType`);
        }
    }
    console.log(`# Then, with FModel CLOSED:  node tools/plan-export.mjs --profile`);
    console.log(`# Re-run after every game patch AND every hotfix: a new Saved/Resources/<ver>/Resource/<hotfix>/`);
    console.log(`# directory means new _P paks, and an export without them is the previous hotfix's data.`);
} else if (argv.includes('--profile')) {
    applyProfile(slimRootArg);
} else {
    console.log('\nRun again with --link for the slim-directory commands.');
}

// FModel keys EVERYTHING that makes a game loadable — the AES keys AND the UE
// version — to the exact GameDirectory path string (`PerDirectory` in its
// AppSettings.json). Pointing it at the slim root therefore creates a FRESH
// profile with FModel's defaults: one key and generic UE 4.26. That produced
// `Mounted: 0/4 | AES: 0/1` seven times over, and saving the setting also reset
// the ORIGINAL profile's UE version, which is how a directory switch broke the
// full game too (`Mounted: 26/248`, 468 ArgumentOutOfRangeException in MountTo —
// Kuro's pak format parsed as stock 4.26). None of it was the keys: the run that
// worked that same morning read `AES: 39/39`.
//
// 68812811 is `0x041A000B`: `0x041A0000` is CUE4Parse's GAME_UE4_26 and the +11
// selects the Wuthering Waves entry in that family. It is the value the profile
// carried on every full mount in the logs and the one FModel's own "Wuthering
// Waves" preset sets; `--ue-version` overrides it if a later FModel renumbers
// the enum. FModel rewrites the file on exit, so this refuses to run while it
// is open — an edit made underneath it is silently lost.
const WUWA_EGAME = 68812811;

function applyProfile(slimRoot) {
    const fmodelRunning = (() => {
        try { return execSync('tasklist /FI "IMAGENAME eq FModel.exe" /NH', { encoding: 'utf8' }).includes('FModel.exe'); }
        catch { return false; }
    })();
    if (fmodelRunning) {
        console.error('FModel is running. Close it first — it rewrites AppSettings.json on exit and would undo this.');
        process.exit(1);
    }
    if (!existsSync(settingsPath)) {
        console.error(`No FModel settings at ${settingsPath}.`);
        process.exit(1);
    }
    const ueVersion = Number(flag('--ue-version') ?? WUWA_EGAME);
    const profiles = settings.PerDirectory ?? (settings.PerDirectory = {});
    // The SOURCE is the real game directory: whichever profile is not the slim
    // root and holds the most keys, so this still works when FModel's current
    // GameDirectory has already been switched to the slim root.
    const source = Object.entries(profiles)
        .filter(([path]) => path !== slimRoot)
        .sort((left, right) => (right[1].AesKeys?.dynamicKeys?.length ?? 0) - (left[1].AesKeys?.dynamicKeys?.length ?? 0))[0];
    if (!source) {
        console.error('No source game profile found in FModel settings — open the real game directory in FModel once first.');
        process.exit(1);
    }
    const backup = `${settingsPath}.bak-${new Date().toISOString().slice(0, 10)}`;
    copyFileSync(settingsPath, backup);

    const [sourcePath, sourceProfile] = source;
    profiles[slimRoot] = {
        ...structuredClone(sourceProfile),
        GameDirectory: slimRoot,
        UeVersion: ueVersion,
    };
    const before = sourceProfile.UeVersion;
    sourceProfile.UeVersion = ueVersion;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    console.log(`backup:  ${backup}`);
    console.log(`source:  ${sourcePath}   UeVersion ${before} -> ${ueVersion}, ${sourceProfile.AesKeys?.dynamicKeys?.length ?? 0} dynamic keys`);
    console.log(`slim:    ${slimRoot}   cloned from source, UeVersion ${ueVersion}`);
    console.log('\nLaunch FModel, set Game Directory to the slim root, and check the log reads Mounted: 4/4.');
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
