#!/usr/bin/env node
// tools/fetch-nanoka-chars.mjs
/**
 * Fetches full character JSON files from static.nanoka.cc and saves
 * them to data/extracted-nanoka/characters/{id}.json
 *
 * Run after each game patch to pick up new characters before Dimbreath
 * updates. This script must run on your local machine — the CDN is
 * accessible from browsers/local Node but blocks datacenter IPs.
 *
 * Usage:
 *   node tools/fetch-nanoka-chars.mjs              # fetch new chars only
 *   node tools/fetch-nanoka-chars.mjs --all         # re-fetch all chars
 *   node tools/fetch-nanoka-chars.mjs --id 1108     # fetch one specific id
 *
 * After running:
 *   node tools/preprocess.mjs                       # bake into wuwa-data.json
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir   = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dir, '../data/extracted-nanoka/characters');
const NANOKA  = 'https://static.nanoka.cc';
const DELAY   = 300;  // ms between requests

const args    = process.argv.slice(2);
const ALL     = args.includes('--all');
const SINGLE  = args.find(arg => arg.startsWith('--id='))?.split('=')[1];

mkdirSync(OUT_DIR, { recursive: true });

// ── Step 1: get the current version from the manifest ──────────────────────
console.log('Fetching nanoka manifest…');
let manifest;
try {
    const res = await fetch(`${NANOKA}/manifest.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
} catch (error) {
    console.error(`✗ Could not fetch manifest: ${error.message}`);
    process.exit(1);
}

const version = manifest?.ww?.latest;
if (!version) {
    console.error('✗ manifest.ww.latest not found');
    process.exit(1);
}
console.log(`  version: ${version}  live: ${manifest.ww.live ?? '?'}`);
const newIds  = manifest?.ww?.new?.character ?? [];
console.log(`  new character IDs in ${version}: [${newIds.join(', ')}]`);

// ── Step 2: decide which IDs to fetch ─────────────────────────────────────
let targetIds;
if (SINGLE) {
    targetIds = [Number(SINGLE)];
    console.log(`\nFetching single character: ${SINGLE}`);
} else if (ALL) {
    // Fetch all IDs that appear in the item.json character list
    console.log('\nFetching full item index to get all character IDs…');
    const itemRes = await fetch(`${NANOKA}/ww/${version}/en/item.json`);
    if (!itemRes.ok) {
        console.error(`✗ item.json HTTP ${itemRes.status}`);
        process.exit(1);
    }
    const itemData = await itemRes.json();
    targetIds = (itemData?.characters ?? []).map(character => character.id ?? character);
    console.log(`  Found ${targetIds.length} characters`);
} else {
    // Default: only fetch IDs that are either new in this patch
    // or missing from the local cache
    const missing = newIds.filter(id => !existsSync(resolve(OUT_DIR, `${id}.json`)));
    if (missing.length === 0 && newIds.length > 0) {
        console.log('\nAll new characters already cached. Use --all to re-fetch.');
        process.exit(0);
    }
    targetIds = newIds.length > 0 ? newIds : [];
    // Also add any IDs referenced in existing character.json that are missing
    try {
        const charMap = JSON.parse(readFileSync(resolve(__dir, '../data/extracted-nanoka/character.json'), 'utf8'));
        for (const id of Object.keys(charMap)) {
            const numId = Number(id);
            if (!existsSync(resolve(OUT_DIR, `${numId}.json`))) {
                if (!targetIds.includes(numId)) targetIds.push(numId);
            }
        }
    } catch { /* no character.json */ }
}

if (targetIds.length === 0) {
    console.log('Nothing to fetch.');
    process.exit(0);
}

// ── Step 3: fetch each character ──────────────────────────────────────────
console.log(`\nFetching ${targetIds.length} character(s)…\n`);
let succeeded = 0, failed = 0;
const failures = [];

for (const id of targetIds) {
    const outPath = resolve(OUT_DIR, `${id}.json`);
    const exists  = existsSync(outPath);
    if (exists && !ALL && !SINGLE) {
        process.stdout.write(`  SKIP  ${id} (already cached)\n`);
        succeeded++;
        continue;
    }

    process.stdout.write(`  GET   ${id} … `);
    try {
        const url = `${NANOKA}/ww/${version}/en/character/${id}.json`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'WuWaSimPreprocess/1.0 (github.com/Philipp-DI/WuWaSim)' }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        writeFileSync(outPath, JSON.stringify(data, null, 2));
        const name = data.name ?? data.en ?? `id ${id}`;
        process.stdout.write(`✓  ${name}\n`);
        succeeded++;
    } catch (error) {
        process.stdout.write(`✗  ${error.message}\n`);
        failures.push(id);
        failed++;
    }

    await new Promise(resolvePromise => setTimeout(resolvePromise, DELAY));
}

console.log(`\nDone: ${succeeded} fetched/cached, ${failed} failed`);
if (failures.length > 0) {
    console.log(`Failed IDs: ${failures.join(', ')}`);
    console.log('Retry with: node tools/fetch-nanoka-chars.mjs --id=<id>');
}
console.log('\nNext step: node tools/preprocess.mjs');
