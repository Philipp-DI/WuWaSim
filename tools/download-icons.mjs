#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { pipeline } from 'stream/promises';
import { resolve, dirname } from 'path';

const MANIFEST_PATH = resolve('data/icon-manifest.json');
const ASSETS_BASE = resolve('assets/icons');
const DELAY_MS = 300; // Polite delay to prevent rate-limiting

const WIKI_FILEPATH_BASE = "https://wutheringwaves.fandom.com/wiki/Special:Filepath";
const WIKI_API = "https://wutheringwaves.fandom.com/api.php";

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
let targetKind = null;

if (args.some(a => a.startsWith('--only='))) {
    const matched = args.find(a => a.startsWith('--only='));
    targetKind = matched.split('=')[1];
}

// Downloads raw binary data from URL to local target destination path
async function downloadFile(url, destPath) {
    if (dryRun) return true;
    mkdirSync(dirname(destPath), { recursive: true });

    const response = await fetch(url, { headers: { 'User-Agent': 'WuWaSimAssetFetcher/1.0 (Contact: via GitHub)' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const fileStream = createWriteStream(destPath);
    await pipeline(response.body, fileStream);
    return true;
}

// Queries the MediaWiki API using a more aggressive search fallback
async function fetchRealWikiUrl(itemName, category) {
    // 1. First attempt: Look for the exact filename file page
    let params = new URLSearchParams({
        action: 'query',
        titles: `File:${itemName}`,
        prop: 'imageinfo',
        iiprop: 'url',
        format: 'json',
        origin: '*'
    });

    try {
        let res = await fetch(`${WIKI_API}?${params.toString()}`);
        if (res.ok) {
            let data = await res.json();
            let pages = data?.query?.pages;
            let pageId = Object.keys(pages || {})[0];
            if (pageId && pageId !== '-1') {
                return pages[pageId].imageinfo?.[0]?.url || null;
            }
        }

        // 2. Second attempt: If exact match fails, do a fuzzy title search
        // Cleans up colons/underscores back to standard spaces to help the wiki engine search
        const searchQuery = itemName.replace(/_/g, ' ').replace('.png', '');
        params = new URLSearchParams({
            action: 'query',
            list: 'search',
            srsearch: `${searchQuery} filename:png`, // forces searching for images matching the name
            srnamespace: '6', // Namespace 6 is strictly for Files/Images on MediaWiki
            format: 'json',
            origin: '*'
        });

        res = await fetch(`${WIKI_API}?${params.toString()}`);
        if (!res.ok) return null;

        let searchData = await res.json();
        let firstResult = searchData?.query?.search?.[0]?.title; // e.g. "File:Havoc Prism Icon.png"

        if (firstResult) {
            // Re-query the specific file page found by the search engine to get its direct download CDN URL
            params = new URLSearchParams({
                action: 'query',
                titles: firstResult,
                prop: 'imageinfo',
                iiprop: 'url',
                format: 'json',
                origin: '*'
            });
            res = await fetch(`${WIKI_API}?${params.toString()}`);
            if (!res.ok) return null;
            let fileData = await res.json();
            let filePages = fileData?.query?.pages;
            let filePageId = Object.keys(filePages || {})[0];
            return filePages[filePageId]?.imageinfo?.[0]?.url || null;
        }
    } catch (e) {
        return null;
    }
    return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    if (!existsSync(MANIFEST_PATH)) {
        console.error("Error: Manifest missing! Please run 'node tools/generate-manifest.mjs' first.");
        process.exit(1);
    }

    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    const categories = targetKind ? [targetKind] : ['resonators', 'weapons', 'echoes'];

    let ok = 0, failed = 0, skipped = 0;
    const failures = [];

    for (const cat of categories) {
        const entries = Object.values(manifest[cat] || {});
        console.log(`\nProcessing Target Folder: ${cat.toUpperCase()} (${entries.length} items)`);

        for (let i = 0; i < entries.length; i++) {
            const item = entries[i];
            const pct = Math.floor(((i + 1) / entries.length) * 100);

            // Standardizing output format to always save as .png for curation uniformity
            const destPath = resolve(ASSETS_BASE, cat, `${item.id}.png`);

            if (existsSync(destPath) && !force) {
                skipped++;
                continue;
            }

            process.stdout.write(`[${pct}%] Processing: ${item.name} ... `);

            // Construct array of filename variations to try
            let filenameTargets = [item.wikiFile, item.wikiFallback].filter(Boolean);
            let success = false;

            for (const targetName of filenameTargets) {
                // Tier 1: Try Direct Native Path Resolution Route
                try {
                    const directUrl = `${WIKI_FILEPATH_BASE}/${targetName}`;
                    await downloadFile(directUrl, destPath);
                    process.stdout.write(`✓ (Direct)\n`);
                    success = true;
                    ok++;
                    break;
                } catch {
                    // Tier 2: API Search Fallback Route if Direct fails
                    const resolvedApiUrl = await fetchRealWikiUrl(targetName);
                    if (resolvedApiUrl) {
                        try {
                            await downloadFile(resolvedApiUrl, destPath);
                            process.stdout.write(`✓ (API Resolved)\n`);
                            success = true;
                            ok++;
                            break;
                        } catch {
                            // Continue checking remaining fallbacks
                        }
                    }
                }
            }

            if (!success) {
                process.stdout.write(`✗ (Not Found)\n`);
                failed++;
                failures.push(`${cat.toUpperCase()} [ID ${item.id}]: "${item.name}"`);
            }

            await sleep(DELAY_MS);
        }
    }

    console.log(`\nExecution Done: ${ok} downloaded, ${skipped} skipped, ${failed} failed.`);
    if (failures.length > 0) {
        console.log(`\nMissing Entities:`);
        failures.forEach(f => console.log(`  - ${f}`));
    }
}

main();