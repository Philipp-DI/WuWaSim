#!/usr/bin/env node
// update-game-version/fetch-nanoka.mjs — step 3: stage nanoka's indexes and
// every detail file, pinned to the TARGET version (never `manifest.latest`,
// which runs ahead of `live`). Replaces tools/fetch-nanoka-{chars,echoes,weapons}.mjs.
//
//   node update-game-version/fetch-nanoka.mjs --version 3.7 [--nanoka 3.7.0]
//
// → staging/<version>/nanoka/ in data/extracted-nanoka/'s layout. The CDN
// blocks datacenter IPs, so this runs on the maintainer's machine.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NANOKA, NANOKA_TYPES, fetchText, flag, nanokaVersionFor, stagingDir } from './sources.mjs';

const DELAY_MS = 150;
const pause = () => new Promise(done => setTimeout(done, DELAY_MS));

// One retry: a CDN hiccup should not cost a whole re-stage.
async function fetchJson(url) {
    try { return JSON.parse(await fetchText(url)); }
    catch { await pause(); return JSON.parse(await fetchText(url)); }
}

// Same serialisation as the committed tree, so an install diffs only content.
const save = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2));

const version = flag(process.argv, '--version');
if (!version) {
    console.error('Usage: node update-game-version/fetch-nanoka.mjs --version <x.y> [--nanoka <cdn version>]');
    process.exit(2);
}
const outDir = resolve(stagingDir(version), 'nanoka');
rmSync(outDir, { recursive: true, force: true });   // a dropped id must not survive a re-stage
mkdirSync(outDir, { recursive: true });

const manifest = await fetchJson(`${NANOKA}/manifest.json`);
const available = manifest.ww?.available ?? [];
const nanokaVersion = flag(process.argv, '--nanoka') ?? nanokaVersionFor(available, version);
if (!nanokaVersion || !available.includes(nanokaVersion)) {
    console.error(`✗ nanoka has no single version for ${version}: available [${available.join(', ')}]. Pass --nanoka <one of them>.`);
    process.exit(1);
}
console.log(`nanoka ${nanokaVersion} (live ${manifest.ww.live}, latest ${manifest.ww.latest})`);
save(resolve(outDir, 'manifest.json'), manifest);

const failures = [];
for (const [type, detailDir] of Object.entries(NANOKA_TYPES)) {
    // Indexes live at ww/<version>/<type>.json — NO /en/.
    const index = await fetchJson(`${NANOKA}/ww/${nanokaVersion}/${type}.json`);
    save(resolve(outDir, `${type}.json`), index);
    if (!detailDir) continue;
    mkdirSync(resolve(outDir, detailDir), { recursive: true });
    const ids = Object.keys(index);
    console.log(`  ${type}: ${ids.length} detail files`);
    for (const id of ids) {
        try {
            save(resolve(outDir, detailDir, `${id}.json`), await fetchJson(`${NANOKA}/ww/${nanokaVersion}/en/${type}/${id}.json`));
        } catch (error) {
            failures.push(`${type}/${id}: ${error.message}`);
        }
        await pause();
    }
}
writeFileSync(`${outDir}.source.json`, `${JSON.stringify({ nanoka: nanokaVersion, fetchedAt: new Date().toISOString() }, null, 2)}\n`);
if (failures.length) {
    console.error(`\n✗ ${failures.length} fetch(es) failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
console.log(`\nStaged nanoka ${nanokaVersion} into ${outDir}`);
