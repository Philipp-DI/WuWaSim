#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const DATA_PATH = resolve('data/wuwa-data.json');
const MANIFEST_OUTPUT = resolve('data/icon-manifest.json');

function slugifyWikiName(name) {
    // Normalizes names to match standard Wiki file naming conventions
    return name
        .trim()
        .replace(/:\s*/g, '_')
        .replace(/\s+/g, '_');
}

try {
    const rawData = readFileSync(DATA_PATH, 'utf-8');
    const db = JSON.parse(rawData);

    const manifest = {
        resonators: {},
        weapons: {},
        echoes: {}
    };

    // 1. Map Resonators
    if (db.resonators) {
        db.resonators.forEach(char => {
            const isRover = char.name.toLowerCase().includes('rover');
            const normalizedName = slugifyWikiName(char.name);
            manifest.resonators[char.id] = {
                id: char.id,
                name: char.name,
                wikiFile: isRover ? "Resonator_Rover.png" : `Resonator_${normalizedName}.png`
            };
        });
    }

    // 2. Map Weapons (Inside tools/generate-manifest.mjs)
    if (db.weapons) {
        db.weapons.forEach(wp => {
            // Skip internal testing/placeholder items completely
            if (wp.name.includes('#')) return;

            manifest.weapons[wp.id] = {
                id: wp.id,
                name: wp.name,
                wikiFile: `Weapon_${slugifyWikiName(wp.name)}.png`
            };
        });
    }

    // 3. Map Echoes
    if (db.echoes) {
        db.echoes.forEach(echo => {
            const normalizedName = slugifyWikiName(echo.name);
            manifest.echoes[echo.id] = {
                id: echo.id,
                name: echo.name,
                wikiFile: `Echo_${normalizedName}.png`,
                wikiFallback: `${normalizedName}.png`
            };
        });
    }

    mkdirSync(dirname(MANIFEST_OUTPUT), { recursive: true });
    writeFileSync(MANIFEST_OUTPUT, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`✓ Successfully compiled asset manifest:`);
    console.log(`  - Resonators: ${Object.keys(manifest.resonators).length}`);
    console.log(`  - Weapons: ${Object.keys(manifest.weapons).length}`);
    console.log(`  - Echoes: ${Object.keys(manifest.echoes).length}`);

} catch (error) {
    console.error("Critical: Failed to compile local runtime asset index maps", error);
}