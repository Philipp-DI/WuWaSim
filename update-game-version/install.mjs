#!/usr/bin/env node
// update-game-version/install.mjs — step 6: staging → data/, and the version
// bump in data/game-version.json. Refuses without a recorded
// `decision: install` for the current diff.
//
//   node update-game-version/install.mjs --version 3.7
import { copyFileSync, cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { COMMITTED_BINDATA, NANOKA_TYPES, ROOT, flag, reportsDir, stagingDir, writeGameVersion } from './sources.mjs';
import { gateDecision, hashPaths } from './update.mjs';

const version = flag(process.argv, '--version');
if (!version) {
    console.error('Usage: node update-game-version/install.mjs --version <x.y>');
    process.exit(2);
}
const staging = stagingDir(version);
const reviewPath = resolve(reportsDir(version), 'review.md');
const verdict = gateDecision(existsSync(reviewPath) ? readFileSync(reviewPath, 'utf8') : null,
    hashPaths([`update-game-version/reports/${version}/diff.md`]));
if (!verdict.open) {
    console.error(`✗ Refused: ${verdict.reason}.`);
    process.exit(1);
}
const readSource = (name) => JSON.parse(readFileSync(resolve(staging, `${name}.source.json`), 'utf8'));
const arikatsu = readSource('arikatsu').ref, nanoka = readSource('nanoka').nanoka;

// The staged tree is the WHOLE version: a detail file nanoka dropped goes too.
const nanokaDir = resolve(ROOT, 'data/extracted-nanoka');
for (const [type, detailDir] of Object.entries(NANOKA_TYPES)) {
    copyFileSync(resolve(staging, 'nanoka', `${type}.json`), resolve(nanokaDir, `${type}.json`));
    if (!detailDir) continue;
    rmSync(resolve(nanokaDir, detailDir), { recursive: true, force: true });
    cpSync(resolve(staging, 'nanoka', detailDir), resolve(nanokaDir, detailDir), { recursive: true });
}
copyFileSync(resolve(staging, 'nanoka', 'manifest.json'), resolve(nanokaDir, 'manifest.json'));
for (const [name, path] of Object.entries(COMMITTED_BINDATA)) {
    copyFileSync(resolve(staging, 'arikatsu', path), resolve(ROOT, 'data/bindata', name));
}
writeGameVersion({ arikatsu, nanoka });
console.log(`Installed Arikatsu ${arikatsu} + nanoka ${nanoka}. data/game-version.json bumped.`);
console.log('Next: node update-game-version/update.mjs all --version', version);
