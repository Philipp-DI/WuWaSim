#!/usr/bin/env node
/**
 * Pre-processor for WuWa damage simulator.
 *
 * Downloads raw datamined configs from Dimbreath/WutheringData, joins
 * the tables we care about, resolves localization keys, and writes a
 * single lean JSON (~few hundred KB) that the static site fetches at
 * runtime.
 *
 * Usage:  node tools/preprocess.mjs [--lang en] [--out data/wuwa-data.json]
 *
 * Run this when:
 *   - A game patch ships and you want the new resonators/weapons.
 *   - You change the shape of the output (bump SCHEMA_VERSION).
 *
 * The output is committed to the repo. Between full re-runs you can
 * hand-edit data/patch.json to override individual entries (see merge
 * logic in src/data/loader.js).
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 1;
const BASE = 'https://raw.githubusercontent.com/Dimbreath/WutheringData/master';

// Files we pull. Add more as the engine grows. Keep this list small;
// each file is fetched in parallel and held in memory during processing.
const FILES = {
    roleInfo:      'ConfigDB/RoleInfo.json',
    elementInfo:   'ConfigDB/ElementInfo.json',
    rolePropGrow:  'ConfigDB/RolePropertyGrowth.json',
    baseProperty:  'ConfigDB/BaseProperty.json',
    // Localization
    textMap:       'TextMap/{lang}/MultiText.json',
};

// Element IDs verified against ElementInfo.json — these are canonical.
// We hard-code so the UI can colour-code without a lookup.
const ELEMENT_COLORS = {
    0: '#9aa4b2', // Physical
    1: '#88dfff', // Glacio
    2: '#ff7755', // Fusion
    3: '#bb88ff', // Electro
    4: '#66ddaa', // Aero
    5: '#ffd44d', // Spectro
    6: '#ff66cc', // Havoc
};

// WeaponType ID → canonical name (verified against in-game labels).
const WEAPON_TYPES = {
    1: 'Broadblade',
    2: 'Sword',
    3: 'Pistols',
    4: 'Gauntlets',
    5: 'Rectifier',
};

// CLI parsing — kept dumb, no library.
function parseArgs(argv) {
    const args = { lang: 'en', out: 'data/wuwa-data.json' };
    for (let i = 2; i < argv.length; i++) {
        const k = argv[i];
        if (k === '--lang')      args.lang = argv[++i];
        else if (k === '--out')  args.out  = argv[++i];
        else if (k === '--help') { printHelp(); process.exit(0); }
        else { console.error(`Unknown arg: ${k}`); process.exit(2); }
    }
    return args;
}

function printHelp() {
    console.log('Usage: node tools/preprocess.mjs [--lang en] [--out data/wuwa-data.json]');
}

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return res.json();
}

async function downloadAll(lang) {
    const tasks = Object.entries(FILES).map(async ([key, path]) => {
        const url = `${BASE}/${path.replace('{lang}', lang)}`;
        process.stderr.write(`  fetching ${path.replace('{lang}', lang)}\n`);
        const data = await fetchJson(url);
        return [key, data];
    });
    return Object.fromEntries(await Promise.all(tasks));
}

// Pulls localized text. Returns the original key if no translation found,
// so missing entries are visible in the UI rather than silently empty.
function makeTextResolver(textMap) {
    return (key) => (key && textMap[key]) || key || '';
}

// Some NickName entries in the text map are placeholders ("An error
// occurred..."), draft strings ("Jianxin's Nickname"), or duplicates of
// the proper Name. These are noise for the UI — drop them. Returns a
// clean nickname string, or '' if it should be hidden.
function sanitizeNickname(nickname, name) {
    if (!nickname) return '';
    const n = nickname.trim();
    if (!n) return '';

    // Same as name (case-insensitive) — redundant.
    if (n.toLowerCase() === name.trim().toLowerCase()) return '';

    // Localization-system placeholders. Kuro's text map ships these for
    // entries without an English translation; never display them.
    const lower = n.toLowerCase();
    if (lower.includes('an error occurred')) return '';
    if (lower.includes('error detected'))    return '';
    if (lower.includes('customer service'))  return '';

    // Unresolved localization keys (resolver passed them through).
    if (/^[A-Z][A-Za-z]+_\d+_/.test(n)) return '';

    // Obvious draft strings of the form "Foo's Nickname" / "Foo's Title".
    if (/'s\s+(Nickname|Title)$/i.test(n)) return '';

    return n;
}

// Filter RoleInfo down to playable resonators.
// QualityId 4 = 4★, 5 = 5★. RoleType 1 = playable. IsTrial = event-only loaners.
function isPlayable(role) {
    return role.RoleType === 1
        && (role.QualityId === 4 || role.QualityId === 5)
        && !role.IsTrial;
}

// Build the icon URL. WuWa wiki uses Special:Filepath which 302s to the
// real CDN URL — predictable, no need to know hashes/revisions.
// Rover variants need disambiguation suffixes; we'll patch those later.
function iconUrlFor(name) {
    const slug = encodeURIComponent(name.replace(/\s+/g, '_'));
    return `https://wutheringwaves.fandom.com/wiki/Special:Filepath/${slug}_Card.png`;
}

// Project a raw RoleInfo entry to the lean shape the runtime consumes.
// Anything not listed here is dropped — RoleInfo has ~70 fields and
// most are asset paths irrelevant to a damage calculator.
function projectResonator(role, t) {
    const name = t(role.Name);
    const rawNick = t(role.NickName);
    const nickname = sanitizeNickname(rawNick, name);
    return {
        id: role.Id,
        name,
        nickname: nickname || undefined,
        rarity: role.QualityId,
        element: role.ElementId,
        weaponType: role.WeaponType,
        propertyId: role.PropertyId,
        maxLevel: role.MaxLevel ?? 90,
        skillId: role.SkillId,
        // Cosmetic — UI uses this if iconUrl 404s.
        elementColor: ELEMENT_COLORS[role.ElementId] ?? '#888',
        weaponTypeName: WEAPON_TYPES[role.WeaponType] ?? 'Unknown',
        iconUrl: iconUrlFor(name),
    };
}

// Main.
async function main() {
    const args = parseArgs(process.argv);
    process.stderr.write(`Pre-processing WuWa data (lang=${args.lang}) ...\n`);

    const raw = await downloadAll(args.lang);
    const t = makeTextResolver(raw.textMap);

    const resonators = raw.roleInfo
        .filter(isPlayable)
        .map(r => projectResonator(r, t))
        .sort((a, b) => a.id - b.id);

    const elements = raw.elementInfo
        .filter(e => e.Id !== 0)            // drop "Physical" placeholder for UI
        .map(e => ({ id: e.Id, name: t(e.Name), color: ELEMENT_COLORS[e.Id] }))
        .sort((a, b) => a.id - b.id);

    const out = {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        source: `Dimbreath/WutheringData (lang=${args.lang})`,
        lang: args.lang,
        counts: {
            resonators: resonators.length,
            elements: elements.length,
        },
        elements,
        weaponTypes: Object.entries(WEAPON_TYPES).map(([id, name]) => ({ id: +id, name })),
        resonators,
    };

    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, JSON.stringify(out, null, 2) + '\n');
    process.stderr.write(`\nWrote ${args.out}\n`);
    process.stderr.write(`  resonators: ${resonators.length}\n`);
    process.stderr.write(`  elements:   ${elements.length}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
