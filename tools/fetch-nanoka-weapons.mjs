#!/usr/bin/env node
// tools/fetch-nanoka-weapons.mjs
/**
 * Fetches full weapon JSON files from static.nanoka.cc and saves them to
 * data/extracted-nanoka/weapons/{id}.json
 *
 * Reads the weapon index (data/extracted-nanoka/weapon.json) to know which
 * IDs exist, then downloads each detail file. Run on your local machine —
 * the CDN blocks datacenter IPs.
 *
 * Usage:
 *   node tools/fetch-nanoka-weapons.mjs           # fetch missing only
 *   node tools/fetch-nanoka-weapons.mjs --all      # re-fetch all
 *   node tools/fetch-nanoka-weapons.mjs --id=21030015
 *
 * After running: node tools/preprocess.mjs
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir   = dirname(fileURLToPath(import.meta.url));
const NANOKA  = 'https://static.nanoka.cc';
const OUT_DIR = resolve(__dir, '../data/extracted-nanoka/weapons');
const IDX     = resolve(__dir, '../data/extracted-nanoka/weapon.json');
const DELAY   = 250;

const args   = process.argv.slice(2);
const ALL    = args.includes('--all');
const SINGLE = args.find(a => a.startsWith('--id='))?.split('=')[1];

mkdirSync(OUT_DIR, { recursive: true });

// Get version from manifest
const manifest = await (await fetch(`${NANOKA}/manifest.json`)).json();
const version  = manifest?.ww?.latest;
if (!version) { console.error('✗ no manifest.ww.latest'); process.exit(1); }
console.log(`nanoka version: ${version}`);

// Determine target IDs
let ids;
if (SINGLE) {
    ids = [SINGLE];
} else {
    const idx = JSON.parse(readFileSync(IDX, 'utf8'));
    ids = Object.keys(idx);
}
console.log(`Weapons to process: ${ids.length}\n`);

let ok = 0, failed = 0;
const failures = [];
for (const id of ids) {
    const out = resolve(OUT_DIR, `${id}.json`);
    if (existsSync(out) && !ALL && !SINGLE) { ok++; continue; }
    process.stdout.write(`  GET ${id} … `);
    try {
        const res = await fetch(`${NANOKA}/ww/${version}/en/weapon/${id}.json`,
            { headers: { 'User-Agent': 'WuWaSimPreprocess/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        writeFileSync(out, JSON.stringify(data, null, 2));
        process.stdout.write(`✓ ${data.name ?? id}\n`);
        ok++;
    } catch (e) {
        process.stdout.write(`✗ ${e.message}\n`);
        failures.push(id); failed++;
    }
    await new Promise(r => setTimeout(r, DELAY));
}
console.log(`\nDone: ${ok} ok, ${failed} failed`);
if (failures.length) console.log(`Failed: ${failures.join(', ')}`);
console.log('\nNext: node tools/preprocess.mjs');
