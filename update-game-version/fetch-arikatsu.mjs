#!/usr/bin/env node
// update-game-version/fetch-arikatsu.mjs — step 2: stage every Arikatsu table
// the pipeline reads, at the TARGET branch and at the pinned one (the diff's
// baseline: only data/bindata/* of these is committed).
//
//   node update-game-version/fetch-arikatsu.mjs --version 3.7
//
// → staging/<version>/arikatsu/<path>, staging/<version>/baseline/<path>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ARIKATSU_RAW, ARIKATSU_TABLES, fetchText, flag, readGameVersion, stagingDir } from './sources.mjs';

// A table that parses to nothing is a failed fetch, not an empty table.
function checkedTable(text, url) {
    const parsed = JSON.parse(text);
    if (Object.keys(parsed ?? {}).length === 0) throw new Error(`empty table at ${url}`);
    return text.endsWith('\n') ? text : `${text}\n`;
}

async function stage(ref, outDir) {
    const failures = [];
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const path of ARIKATSU_TABLES) {
        const url = `${ARIKATSU_RAW}/${ref}/${path}`;
        try {
            const text = checkedTable(await fetchText(url), url);
            mkdirSync(dirname(resolve(outDir, path)), { recursive: true });
            writeFileSync(resolve(outDir, path), text);
            console.log(`  ${ref}  ${path}  ${(text.length / 1e6).toFixed(1)} MB`);
        } catch (error) {
            failures.push(`${path}: ${error.message}`);
        }
    }
    writeFileSync(`${outDir}.source.json`, `${JSON.stringify({ ref, fetchedAt: new Date().toISOString() }, null, 2)}\n`);
    return failures;
}

const version = flag(process.argv, '--version');
if (!version) {
    console.error('Usage: node update-game-version/fetch-arikatsu.mjs --version <x.y>');
    process.exit(2);
}
const baseline = readGameVersion().arikatsu;
const failures = [
    ...await stage(version, resolve(stagingDir(version), 'arikatsu')),
    ...await stage(baseline, resolve(stagingDir(version), 'baseline')),
];
if (failures.length) {
    console.error(`\n✗ ${failures.length} fetch(es) failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
console.log(`\nStaged ${ARIKATSU_TABLES.length} tables at ${version} and at the pinned ${baseline}.`);
