#!/usr/bin/env node
/**
 * Pre-processor for WuWa damage simulator.
 *
 * Downloads raw datamined configs from Dimbreath/WutheringData, joins
 * the tables we care about, resolves localization keys, and writes a
 * single lean JSON the static site fetches at runtime.
 *
 * Usage:  node tools/preprocess.mjs [--lang en] [--out data/wuwa-data.json]
 *
 * Re-run when:
 *   - A game patch ships and you want new resonators/weapons/echoes.
 *   - The shape of the output changes (bump SCHEMA_VERSION).
 *
 * Output is committed. Between full re-runs, edit data/patch.json to
 * override individual entries (see src/data/loader.js for merge logic).
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 2;
const BASE = 'https://raw.githubusercontent.com/Dimbreath/WutheringData/master';

// Source files. All fetched in parallel, held in memory during the pass.
const FILES = {
    roleInfo:       'ConfigDB/RoleInfo.json',
    elementInfo:    'ConfigDB/ElementInfo.json',
    weaponConf:     'ConfigDB/WeaponConf.json',
    phantomItem:    'ConfigDB/PhantomItem.json',
    phantomFetter:  'ConfigDB/PhantomFetterGroup.json',
    phantomMain:    'ConfigDB/PhantomMainPropItem.json',
    phantomSub:     'ConfigDB/PhantomSubProperty.json',
    propertyIndex:  'ConfigDB/PropertyIndex.json',
    textMap:        'TextMap/{lang}/MultiText.json',
};

// =============================================================================
// Canonical lookups (hard-coded so the UI can map without runtime joins).
// =============================================================================

const ELEMENT_COLORS = {
    0: '#9aa4b2', // Physical
    1: '#88dfff', // Glacio
    2: '#ff7755', // Fusion
    3: '#bb88ff', // Electro
    4: '#66ddaa', // Aero
    5: '#ffd44d', // Spectro
    6: '#ff66cc', // Havoc
};
const WEAPON_TYPES = {
    1: 'Broadblade',
    2: 'Sword',
    3: 'Pistols',
    4: 'Gauntlets',
    5: 'Rectifier',
};
// PhantomItem.Rarity -> equippable cost (verified via known echoes:
// Mephis/Inferno = rarity 2 = 3-cost; Bell-Borne/Dreamless = rarity 3 = 4-cost).
const RARITY_TO_COST = { 0: 1, 1: 1, 2: 3, 3: 4 };

// =============================================================================
// Args + IO
// =============================================================================

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
        return [key, await fetchJson(url)];
    });
    return Object.fromEntries(await Promise.all(tasks));
}

// Resolve a localization key. Returns the key on miss so misses are
// visible in the UI rather than silently empty.
function makeTextResolver(textMap) {
    return (key) => (key && textMap[key]) || key || '';
}

// =============================================================================
// Sanitization
// =============================================================================

function isPlaceholder(text) {
    const lower = text.toLowerCase();
    return lower.includes('an error occurred')
        || lower.includes('error detected')
        || lower.includes('customer service');
}
function isUnresolvedKey(text) {
    return /^[A-Z][A-Za-z]+_\d+_/.test(text);
}

function sanitizeNickname(nickname, name) {
    if (!nickname) return '';
    const n = nickname.trim();
    if (!n) return '';
    if (n.toLowerCase() === name.trim().toLowerCase()) return '';
    if (isPlaceholder(n)) return '';
    if (isUnresolvedKey(n)) return '';
    if (/'s\s+(Nickname|Title)$/i.test(n)) return '';
    return n;
}

function cleanText(text) {
    if (!text) return '';
    const t = text.trim();
    if (!t) return '';
    if (isPlaceholder(t)) return '';
    if (isUnresolvedKey(t)) return '';
    return t;
}

function iconUrlFor(name) {
    const slug = encodeURIComponent(name.replace(/\s+/g, '_'));
    return `https://wutheringwaves.fandom.com/wiki/Special:Filepath/${slug}_Card.png`;
}

// =============================================================================
// Property dictionary
// =============================================================================

// PropertyIndex Id -> { name, isPercent, key }. The UI uses this to
// label weapon stats. Note: the game stores some stats under multiple
// PropIds (e.g. flat ATK is 7, weapon ATK is also surfaced as 10007
// "Green ATK"). We keep them all addressable by id.
function buildPropertyDict(propertyIndex, t) {
    const dict = {};
    for (const p of propertyIndex) {
        if (!p.Id) continue;
        const name = cleanText(t(p.Name)) || p.Key || `Prop ${p.Id}`;
        dict[p.Id] = {
            propId: p.Id,
            name,
            isPercent: !!p.IsPercent,
            key: p.Key || '',
        };
    }
    return dict;
}

// A stat option = (propId, addType). AddType 2 turns flat into percent,
// so we synthesize the display label here once instead of letting the
// UI re-derive the rule.
function makeStatOption(propId, addType, propDict) {
    const p = propDict[propId];
    if (!p) return null;
    const displayName = addType === 2 ? `${p.name}%` : p.name;
    return {
        propId,
        addType,
        name: displayName,
        isPercent: addType === 2 || p.isPercent,
        key: p.key,
    };
}

// =============================================================================
// Resonators
// =============================================================================

function isPlayable(role) {
    return role.RoleType === 1
        && (role.QualityId === 4 || role.QualityId === 5)
        && !role.IsTrial;
}

function projectResonator(role, t) {
    const name = t(role.Name);
    const nickname = sanitizeNickname(t(role.NickName), name);
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
        elementColor: ELEMENT_COLORS[role.ElementId] ?? '#888',
        weaponTypeName: WEAPON_TYPES[role.WeaponType] ?? 'Unknown',
        iconUrl: iconUrlFor(name),
    };
}

// =============================================================================
// Weapons
// =============================================================================

function weaponStat(propWrapper, propDict) {
    if (!propWrapper || !propWrapper.Id) return null;
    const p = propDict[propWrapper.Id];
    return {
        propId: propWrapper.Id,
        name: p ? p.name : `Prop ${propWrapper.Id}`,
        baseValue: propWrapper.Value ?? 0,
        isPercent: p ? p.isPercent : !!propWrapper.IsRatio,
    };
}

function projectWeapon(weapon, t, propDict) {
    const name = cleanText(t(weapon.WeaponName));
    if (!name) return null;
    if (weapon.IsShow === false) return null;
    return {
        id: weapon.ItemId,
        name,
        type: weapon.WeaponType,
        typeName: WEAPON_TYPES[weapon.WeaponType] ?? 'Unknown',
        rarity: weapon.QualityId,
        baseStat: weaponStat(weapon.FirstPropId, propDict),
        subStat:  weaponStat(weapon.SecondPropId, propDict),
        maxRank:  weapon.ResonLevelLimit ?? 5,
        description: cleanText(t(weapon.Desc)) || undefined,
    };
}

// =============================================================================
// Echoes (Phantoms)
// =============================================================================

// Dedupe phantoms to one entry per monster family. The same monster
// ships at four QualityId tiers under different ItemIds; for the
// build picker we want one row per family at the highest quality.
function uniqueEchoFamilies(phantoms, t) {
    const byFamily = new Map();
    for (const p of phantoms) {
        const name = cleanText(t(p.MonsterName));
        if (!name) continue;
        if (!RARITY_TO_COST.hasOwnProperty(p.Rarity)) continue;
        if (p.ShowInBag === false) continue;
        const existing = byFamily.get(name);
        if (!existing || (p.QualityId ?? 0) > (existing.QualityId ?? 0)) {
            byFamily.set(name, p);
        }
    }
    return [...byFamily.values()];
}

function projectEcho(phantom, t) {
    const name = cleanText(t(phantom.MonsterName));
    return {
        id: phantom.ItemId,
        monsterId: phantom.MonsterId,
        name,
        cost: RARITY_TO_COST[phantom.Rarity],
        rarity: phantom.Rarity,
        maxQuality: phantom.QualityId,
        elementTypes: phantom.ElementType ?? [],
        sonataIds: phantom.FetterGroup ?? [],
        skillId: phantom.SkillId,
    };
}

// =============================================================================
// Sonatas
// =============================================================================

// FetterMap[i] = { Key: piecesNeeded, Value: effectId }. effectId resolves
// to "PhantomFetter_<effectId>_EffectDescription" in the text map.
function projectSonata(sonata, t) {
    const name = cleanText(t(sonata.FetterGroupName));
    if (!name) return null;

    const tiers = [];
    for (const entry of sonata.FetterMap || []) {
        const effectId = entry.Value;
        const pieces   = entry.Key;
        if (!effectId || !pieces) continue;
        tiers.push({
            pieces,
            effect:  cleanText(t(`PhantomFetter_${effectId}_EffectDescription`)),
            summary: cleanText(t(`PhantomFetter_${effectId}_SimplyEffectDesc`)),
        });
    }
    tiers.sort((a, b) => a.pieces - b.pieces);
    return { id: sonata.Id, name, tiers };
}

// =============================================================================
// Echo stat options
// =============================================================================

function projectEchoMainStats(phantomMain, propDict) {
    const seen = new Set();
    const out = [];
    for (const m of phantomMain) {
        const key = `${m.PropId}:${m.AddType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const opt = makeStatOption(m.PropId, m.AddType, propDict);
        if (opt) out.push({ ...opt, standardValue: m.StandardProperty });
    }
    return out;
}

function projectEchoSubStats(phantomSub, propDict) {
    const seen = new Set();
    const out = [];
    for (const s of phantomSub) {
        const propId = s.PropId ?? s.Id;
        const key = `${propId}:${s.AddType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const opt = makeStatOption(propId, s.AddType, propDict);
        if (opt) out.push({ ...opt, standardValue: s.SubStandardProperty });
    }
    return out;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
    const args = parseArgs(process.argv);
    process.stderr.write(`Pre-processing WuWa data (lang=${args.lang}) ...\n`);

    const raw = await downloadAll(args.lang);
    const t = makeTextResolver(raw.textMap);
    const propDict = buildPropertyDict(raw.propertyIndex, t);

    const resonators = raw.roleInfo
        .filter(isPlayable)
        .map(r => projectResonator(r, t))
        .sort((a, b) => a.id - b.id);

    const elements = raw.elementInfo
        .filter(e => e.Id !== 0)
        .map(e => ({ id: e.Id, name: t(e.Name), color: ELEMENT_COLORS[e.Id] }))
        .sort((a, b) => a.id - b.id);

    const weapons = raw.weaponConf
        .map(w => projectWeapon(w, t, propDict))
        .filter(Boolean)
        .sort((a, b) => (b.rarity - a.rarity) || (a.type - b.type) || a.name.localeCompare(b.name));

    const echoes = uniqueEchoFamilies(raw.phantomItem, t)
        .map(p => projectEcho(p, t))
        .sort((a, b) => (b.cost - a.cost) || a.name.localeCompare(b.name));

    const sonatas = raw.phantomFetter
        .map(s => projectSonata(s, t))
        .filter(Boolean)
        .sort((a, b) => a.id - b.id);

    const echoMainStats = projectEchoMainStats(raw.phantomMain, propDict);
    const echoSubStats  = projectEchoSubStats(raw.phantomSub, propDict);

    const out = {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        source: `Dimbreath/WutheringData (lang=${args.lang})`,
        lang: args.lang,
        counts: {
            resonators:    resonators.length,
            weapons:       weapons.length,
            echoes:        echoes.length,
            sonatas:       sonatas.length,
            elements:      elements.length,
            echoMainStats: echoMainStats.length,
            echoSubStats:  echoSubStats.length,
        },
        elements,
        weaponTypes: Object.entries(WEAPON_TYPES).map(([id, name]) => ({ id: +id, name })),
        resonators,
        weapons,
        echoes,
        sonatas,
        echoMainStats,
        echoSubStats,
    };

    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, JSON.stringify(out, null, 2) + '\n');
    process.stderr.write(`\nWrote ${args.out}\n`);
    for (const [k, v] of Object.entries(out.counts)) {
        process.stderr.write(`  ${k.padEnd(15)} ${v}\n`);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
