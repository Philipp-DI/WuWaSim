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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMA_VERSION = 7;
const BASE    = 'https://raw.githubusercontent.com/Dimbreath/WutheringData/master';
const NANOKA_STATIC = 'https://static.nanoka.cc';

// Source files. All fetched in parallel, held in memory during the pass.
const FILES = {
    roleInfo:       'ConfigDB/RoleInfo.json',
    elementInfo:    'ConfigDB/ElementInfo.json',
    weaponConf:     'ConfigDB/WeaponConf.json',
    phantomItem:    'ConfigDB/PhantomItem.json',
    phantomFetter:        'ConfigDB/PhantomFetterGroup.json',
    phantomFetterEffects: 'ConfigDB/PhantomFetter.json',
    phantomMain:    'ConfigDB/PhantomMainPropItem.json',
    phantomGrowth:  'ConfigDB/PhantomGrowth.json',
    phantomSub:     'ConfigDB/PhantomSubProperty.json',
    propertyIndex:  'ConfigDB/PropertyIndex.json',
    baseProperty:   'ConfigDB/BaseProperty.json',
    roleGrowth:     'ConfigDB/RolePropertyGrowth.json',
    weaponGrowth:   'ConfigDB/WeaponPropertyGrowth.json',
    skillTree:      'ConfigDB/SkillTree.json',
    damage:         'ConfigDB/Damage.json',
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
// PhantomItem.Rarity is the **class tier**, NOT the in-game star rating.
// The in-game star rating lives in PhantomItem.QualityId (2..5).
//
// Absolute truth (verified via MainProp.RandGroupId cross-check):
//   3 = Calamity (4-cost) — world-boss echoes, e.g. Bell-Borne Geochelone, Dreamless
//   2 = Overlord (4-cost) — overlord-monster echoes, e.g. Tempest Mephis, Inferno Rider
//   1 = Elite    (3-cost) — elite-enemy echoes
//   0 = Common   (1-cost) — basic enemy echoes
//
// Verification: Rarity 2 and 3 both use MainProp.RandGroupId 501 (4-cost pool),
// Rarity 1 uses RandGroupId 502 (3-cost pool), Rarity 0 uses 503 (1-cost pool).
const RARITY_TO_COST  = { 0: 1, 1: 3, 2: 4, 3: 4 };
const RARITY_TO_CLASS = { 0: 'Common', 1: 'Elite', 2: 'Overlord', 3: 'Calamity' };

// Echoes with IDs in the 60200000-60299999 range are named after
// resonators (Jinhsi, Camellya, etc.) and aren't real in-game echoes —
// likely event leftovers or unreleased content. They all share
// `starLevel: 2` (lowest tier) in the source. Filter them out so the
// picker only shows playable echoes.
function isEventLeftoverEcho(itemId) {
    return itemId >= 60200000 && itemId < 60300000;
}

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

function cleanText(text) {
    if (!text) return '';
    const t = text.trim();
    if (!t) return '';
    if (isPlaceholder(t)) return '';
    if (isUnresolvedKey(t)) return '';
    return t;
}

// =============================================================================
// Nanoka data loader
// =============================================================================
// Reads the curated JSON files under data/extracted-nanoka/ (downloaded from
// static.nanoka.cc). These are the primary source for icon URLs — nanoka uses
// actual in-engine asset paths which resolve directly to webp files served
// from their CDN. No wiki scraping needed.
//
// Credit: nanoka.cc (https://ww.nanoka.cc) — community game-data service.
// All icon assets © Kuro Games. Data used for non-commercial fan tooling only.

function loadNanokaData() {
    const dir = resolve(__dirname, '../data/extracted-nanoka');
    function tryLoad(file) {
        const p = resolve(dir, file);
        if (!existsSync(p)) return {};
        try { return JSON.parse(readFileSync(p, 'utf8')); }
        catch { return {}; }
    }
    return {
        characters: tryLoad('character.json'),   // id → { en, icon, background, element, weapon, rank, ... }
        weapons:    tryLoad('weapon.json'),       // id → { en, icon, rank, type, atk, sub, ... }
        echoes:     tryLoad('echo.json'),         // monsterId → { en, icon, code, rank, group, ... }
        monsters:   tryLoad('monster.json'),      // monsterId → { ... }
    };
}

// Convert a Nanoka Unreal Engine asset path to a live static.nanoka.cc webp URL.
// e.g. "/Game/Aki/UI/UIResources/Common/Image/IconRolePile/T_Foo_UI.T_Foo_UI"
//   → "https://static.nanoka.cc/assets/ww/UIResources/Common/Image/IconRolePile/T_Foo_UI.webp"
function nanokaAssetUrl(rawPath) {
    if (!rawPath) return null;
    const base = rawPath.split('.')[0];   // strip UE4 ".AssetName" suffix
    const web  = base.replace('/Game/Aki/UI/', '/assets/ww/');
    return `${NANOKA_STATIC}${web}.webp`;
}

// =============================================================================
// Icon URL resolution — nanoka CDN → local file → wiki fallback
// =============================================================================
// Priority order:
//   1. nanoka.cc CDN (webp, ~50ms, always current)
//   2. Local file at assets/icons/{kind}/{id}.png (served from GitHub Pages CDN,
//      populated by running: node tools/download-icons.mjs)
//   3. Fandom wiki Special:Filepath (png, external, ~300ms)
//
// The resolved URL is baked into wuwa-data.json at preprocess time, so the
// browser never has to resolve it at runtime.

let _nanoka = null;   // loaded lazily once, shared across all calls

function iconUrlFor(name, id, kind = 'resonators') {
    // Lazy-load nanoka data on first call
    if (!_nanoka) _nanoka = loadNanokaData();

    // ── 1. Local file (committed to repo, served from GitHub Pages CDN) ──────
    // Check both .png (download-icons.mjs output) and .webp (manually placed).
    for (const ext of ['png', 'webp']) {
        if (existsSync(new URL(`../assets/icons/${kind}/${id}.${ext}`, import.meta.url))) {
            return `./assets/icons/${kind}/${id}.${ext}`;
        }
    }
    // Rover: all three element variants share a single manually-placed icon.
    if (kind === 'resonators' && name.startsWith('Rover')) {
        if (existsSync(new URL(`../assets/icons/resonators/Rover.webp`, import.meta.url))) {
            return './assets/icons/resonators/Rover.webp';
        }
        if (existsSync(new URL(`../assets/icons/resonators/Rover.png`, import.meta.url))) {
            return './assets/icons/resonators/Rover.png';
        }
    }

    // ── 2. nanoka CDN webp ────────────────────────────────────────────────────
    let rawPath = null;
    if (kind === 'resonators') {
        const c = _nanoka.characters[String(id)];
        // Use "icon" (IconRoleHead — the portrait bust), not "background" (IconRolePile card art)
        rawPath = c?.icon ?? null;
    } else if (kind === 'weapons') {
        rawPath = _nanoka.weapons[String(id)]?.icon ?? null;
    } else if (kind === 'echoes') {
        rawPath = _nanoka.echoes[String(id)]?.icon ?? null;
    }
    if (rawPath) {
        const url = nanokaAssetUrl(rawPath);
        if (url) return url;
    }

    // ── 3. Fandom wiki fallback ───────────────────────────────────────────────
    if (name.startsWith('Rover')) {
        return 'https://wutheringwaves.fandom.com/wiki/Special:Filepath/Resonator_Rover.png';
    }
    const s = encodeURIComponent(name.replace(/\s+/g, '_'));
    const prefix = kind === 'resonators' ? 'Resonator_'
                 : kind === 'weapons'    ? 'Weapon_'
                 : 'Echo_';
    return `https://wutheringwaves.fandom.com/wiki/Special:Filepath/${prefix}${s}.png`;
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
    return {
        id: role.Id,
        name,
        rarity: role.QualityId,
        element: role.ElementId,
        weaponType: role.WeaponType,
        propertyId: role.PropertyId,
        maxLevel: role.MaxLevel ?? 90,
        skillId: role.SkillId,
        elementColor: ELEMENT_COLORS[role.ElementId] ?? '#888',
        weaponTypeName: WEAPON_TYPES[role.WeaponType] ?? 'Unknown',
        iconUrl: iconUrlFor(name, role.Id, 'resonators'),
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
        // Curve IDs index into dataset.weaponGrowthCurves to scale stats
        // up from their level-1 baseValue to the player's chosen level.
        baseCurveId: weapon.FirstCurve,
        subCurveId:  weapon.SecondCurve,
        maxRank:  weapon.ResonLevelLimit ?? 5,
        description: cleanText(t(weapon.Desc)) || undefined,
        iconUrl: iconUrlFor(name, weapon.ItemId, 'weapons'),
    };
}

// =============================================================================
// Nanoka-sourced entries (new characters/weapons not yet in Dimbreath)
// =============================================================================

// nanoka element/weapon integers → our enums
// nanoka uses: 1=Glacio 2=Fusion 3=Electro 4=Aero 5=Spectro 6=Havoc (same!)
// nanoka weapon: 1=Broadblade 2=Sword 3=Pistols 4=Gauntlets 5=Rectifier (same!)

function projectNanokaCharacter(id, entry) {
    const elementId  = entry.element ?? 0;
    const weaponType = entry.weapon  ?? 0;
    return {
        id,
        name:           entry.en,
        rarity:         entry.rank ?? 5,
        element:        elementId,
        weaponType,
        propertyId:     null,   // not available from nanoka; baseStats/growthCurve unsupported
        maxLevel:       90,
        skillId:        null,
        elementColor:   ELEMENT_COLORS[elementId] ?? '#888',
        weaponTypeName: WEAPON_TYPES[weaponType]  ?? 'Unknown',
        iconUrl:        iconUrlFor(entry.en, id, 'resonators'),
        source:         'nanoka',   // flag so we can surface attribution in the UI
    };
}

// SUB_STAT_NAME → propId mapping for nanoka weapons.
// nanoka stores the sub-stat as a display string (e.g. "Crit. Rate").
// We map it to the propId used throughout our engine.
const NANOKA_SUB_TO_PROPID = {
    'Crit. Rate':     8,
    'Crit. DMG':      9,
    'Energy Regen':  11,
    'ATK%':       10007,
    'HP%':        10002,
    'DEF%':       10010,
};

function projectNanokaWeapon(id, entry) {
    if (!entry.en) return null;
    const subPropId = NANOKA_SUB_TO_PROPID[entry.sub] ?? null;
    return {
        id,
        name:        entry.en,
        type:        entry.type   ?? 0,
        typeName:    WEAPON_TYPES[entry.type] ?? 'Unknown',
        rarity:      entry.rank   ?? 5,
        baseStat: {
            propId:    7,                   // ATK — always the base stat for weapons
            name:      'ATK',
            baseValue: entry.atk ?? 0,
            isPercent: false,
        },
        subStat: subPropId ? {
            propId:    subPropId,
            name:      entry.sub,
            baseValue: 0,                   // exact base curve not available from nanoka
            isPercent: subPropId !== 10007 && subPropId !== 10002 && subPropId !== 10010
                       ? true : true,       // all weapon sub-stats are percentages in WuWa
        } : null,
        baseCurveId:  1,                    // standard curve — precise curve unknown from nanoka
        subCurveId:   2,
        maxRank:      5,
        description:  entry.desc ?? undefined,
        iconUrl:      iconUrlFor(entry.en, id, 'weapons'),
        source:       'nanoka',
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
        if (isEventLeftoverEcho(p.ItemId)) continue;
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
        classRank: phantom.Rarity,            // 0..3 (Common→Calamity)
        className: RARITY_TO_CLASS[phantom.Rarity],
        starLevel: phantom.QualityId,         // in-game star rating (2..5)
        elementTypes: phantom.ElementType ?? [],
        sonataIds: phantom.FetterGroup ?? [],
        skillId: phantom.SkillId,
        iconUrl: iconUrlFor(name, phantom.MonsterId, 'echoes'),
    };
}

// =============================================================================
// Stat curve, base properties, skill tree
// =============================================================================

// RolePropertyGrowth is universal — same curve for every resonator.
// Ratios are integers scaled by 10,000 (10000 = 1.0x). We emit floats.
// One row per level (1..90); BreachLevel is implicit (max for that level).
function projectGrowthCurve(growth) {
    return growth
        .slice()
        .sort((a, b) => a.Level - b.Level)
        .map(g => ({
            level:      g.Level,
            breach:     g.BreachLevel,
            hpRatio:    g.LifeMaxRatio / 10000,
            atkRatio:   g.AtkRatio     / 10000,
            defRatio:   g.DefRatio     / 10000,
        }));
}

// WeaponPropertyGrowth maps (curveId, level) → multiplier (10000 = 1.0x).
// Each weapon has FirstCurve + SecondCurve indices selecting which curve
// scales its base stat / sub stat. Returned shape:
//   { '1': { 1: 1.0, 2: 1.08, ... 90: 4.05 }, '2': { ... } }
function projectWeaponGrowthCurves(weaponGrowth) {
    const curves = {};
    for (const row of weaponGrowth) {
        const cid = row.CurveId;
        if (!curves[cid]) curves[cid] = {};
        curves[cid][row.Level] = row.CurveValue / 10000;
    }
    return curves;
}

// Damage.json is the master per-skill multiplier table — 7,979 rows, one
// per damage instance in the game. We project per-resonator skill entries
// to a lean shape: {id, roleId, element, type, related, mults[1..10]}.
//
// Each entry's `Id` is a float like 110703101.0 whose first 4 digits are
// the resonator id (1107). `RateLv[]` holds the multiplier at skill levels
// 1..10, scaled by 10,000.
//
// Filtering rules:
//   - Drop rows whose Id doesn't begin with a known resonator id
//   - Drop rows with all-zero RateLv (passives without an explicit mult)
//
// Output is grouped by roleId for cheap UI lookup:
//   { '1107': [ {id, element, type, relatedProp, mults: [0.27, 0.30, ...]} ], ... }
function projectDamageTable(damage, knownRoleIds) {
    const out = {};
    const idSet = new Set(knownRoleIds.map(String));
    for (const row of damage) {
        const idStr = String(Math.trunc(row.Id));
        // Resonator id is the first 4 digits. Confirm against the known set.
        const prefix = idStr.slice(0, 4);
        if (!idSet.has(prefix)) continue;

        const rate = row.RateLv;
        if (!Array.isArray(rate) || rate.every(v => v === 0)) continue;

        if (!out[prefix]) out[prefix] = [];
        out[prefix].push({
            id: Number(idStr),
            element: row.Element ?? 0,
            type: row.Type ?? 0,
            relatedProp: row.RelatedProperty ?? 7,  // 7 = ATK by default
            mults: rate.map(v => v / 10000),         // length 10
        });
    }
    // Sort each group by id for stable output
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.id - b.id);
    return out;
}

// Per-resonator base stats (level 1). PropertyId from RoleInfo joins
// directly here. We keep only the offensive/defensive fields the
// damage engine reads — drops ~60 unused stamina/swim/element-power
// fields per row — and only emit rows for known resonator PropertyIds
// (the source file has ~2400 entries for every entity in the game).
function projectBaseStats(baseProperty, knownPropertyIds) {
    const propIdSet = new Set(knownPropertyIds);
    const out = {};
    for (const b of baseProperty) {
        if (b.Lv !== 1) continue;
        if (!propIdSet.has(b.Id)) continue;
        out[b.Id] = {
            propertyId: b.Id,
            hp:         b.LifeMax       ?? 0,
            atk:        b.Atk           ?? 0,
            def:        b.Def_          ?? 0,
            // Crit values are stored as integer hundredths-of-percent
            // (e.g. 500 = 5.00%). We normalize to a 0..1 fraction so
            // the damage engine never has to remember the scale.
            critRate:   (b.Crit         ?? 0) / 10000,
            critDmg:    (b.CritDamage   ?? 0) / 10000,
            energyRegen:(b.EnergyEfficiency ?? 10000) / 10000,
            energyMax:  (b.EnergyMax    ?? 0) / 100,
        };
    }
    return out;
}

// Skill-tree stat bonuses (the "inherent" passive nodes that activate
// at ascension milestones). Returned keyed by resonator id; each value
// is a flat map of {propId: {flat, ratio}} summed across all nodes.
//
// Note: this is the FULLY UNLOCKED bonus — every node assumed activated.
// Phase 4+ can let the user toggle individual node activation.
function projectSkillTreeBonuses(skillTree) {
    const out = {};
    for (const node of skillTree) {
        if (node.NodeType !== 4) continue;       // 4 = stat-bonus node
        if (!Array.isArray(node.Property)) continue;
        const roleId = node.NodeGroup;
        if (!out[roleId]) out[roleId] = {};
        for (const prop of node.Property) {
            const propId = prop.Id;
            const slot = out[roleId][propId] ??= { flat: 0, ratio: 0 };
            if (prop.IsRatio) {
                slot.ratio += prop.Value;        // already a fraction (0.012 = 1.2%)
            } else {
                // Flat crit values are in hundredths-of-percent (120 = 1.20%).
                // Normalize the same way as BaseProperty for consistency.
                if (propId === 8 || propId === 9 || propId === 11) {
                    slot.flat += prop.Value / 10000;
                } else {
                    slot.flat += prop.Value;
                }
            }
        }
    }
    return out;
}

// =============================================================================
// Sonatas
// =============================================================================

// FetterMap[i] = { Key: piecesNeeded, Value: effectId }. effectId resolves
// to "PhantomFetter_<effectId>_EffectDescription" in the text map.
// Project one sonata. Each tier carries:
//   - effect / summary    localized description text (with {0},{1} placeholders for newer effects)
//   - addProp[]           STRUCTURED stat bonuses, always-active when tier reached
//                         (e.g., 2pc Freezing Frost = +10% Glacio DMG via prop22)
//                         These are wired into the damage formula directly.
//   - descParams[]        positional substitution values (resolves {0}/{1} placeholders).
//                         Lets the UI render the actual numbers in the description text.
//   - buffIds[]           conditional buff trigger ids (e.g., 5pc "after Resonance Skill")
//                         Phase 7 will model these as uptime windows; for now they're
//                         surfaced so the user knows the effect is conditional.
function projectSonata(sonata, t, effectMap) {
    const name = cleanText(t(sonata.FetterGroupName));
    if (!name) return null;

    const tiers = [];
    for (const entry of sonata.FetterMap || []) {
        const effectId = entry.Value;
        const pieces   = entry.Key;
        if (!effectId || !pieces) continue;
        const e = effectMap.get(effectId) || {};
        tiers.push({
            pieces,
            effect:       cleanText(t(`PhantomFetter_${effectId}_EffectDescription`)),
            summary:      cleanText(t(`PhantomFetter_${effectId}_SimplyEffectDesc`)),
            addProp:      projectAddProp(e.AddProp),
            descParams:   Array.isArray(e.EffectDescriptionParam)
                          ? e.EffectDescriptionParam.slice() : [],
            buffIds:      Array.isArray(e.BuffIds) && e.BuffIds.length > 0
                          ? e.BuffIds.map(b => Math.trunc(b)) : [],
        });
    }
    tiers.sort((a, b) => a.pieces - b.pieces);
    return { id: sonata.Id, name, tiers };
}

// Convert raw AddProp entries to a uniform { propId, isRatio, value } shape.
// Game-internal flat values are scaled by 10000 (1000 = 10%), so we normalize
// to a 0..1 fraction for consistency with the rest of the dataset.
function projectAddProp(addProp) {
    if (!Array.isArray(addProp)) return [];
    return addProp.map(p => ({
        propId:  p.Id,
        isRatio: !!p.IsRatio,
        // When IsRatio=true the value is already a fraction (e.g., 0.10);
        // when IsRatio=false the value is scaled by 10000 (e.g., 1000 = 10%).
        value:   p.IsRatio ? p.Value : p.Value / 10000,
    }));
}

// =============================================================================
// Echo stat options
// =============================================================================

function projectEchoMainStats(phantomMain, phantomGrowth, propDict) {
    // Build the growth curve: { level → multiplier }. All main stats share
    // GrowthId=1 (confirmed). Level 0 = 1.0×, Level 25 = 5.0×.
    const growthCurve = {};
    for (const g of phantomGrowth) {
        growthCurve[g.Level] = g.Value / 10000;
    }

    // PhantomMainPropItem.Id encodes star quality and slot index:
    //   Id = starQuality × 1000 + slotIndex
    //
    // Slot ranges define the cost pool:
    //   1–6   = 4-cost (Calamity + Overlord): CR, CD, ATK%, HP%, DEF%, Healing
    //   7–16  = 3-cost (Elite): 6 elements + ATK%, HP%, DEF%, ER
    //   17–19 = 1-cost (Common): ATK%, HP%, DEF%
    //
    // CRITICAL: ATK%, HP%, DEF% appear in ALL THREE pools with different
    // StandardProperty values. Grouping by propId:addType alone collapses
    // them incorrectly. We MUST include cost in the grouping key.
    //
    // Output shape: { 4: [...], 3: [...], 1: [...] } — each list contains
    // stat entries with per-star scaling data for that cost tier only.

    function slotToCost(slot) {
        if (slot >= 1  && slot <= 6)  return 4;
        if (slot >= 7  && slot <= 16) return 3;
        if (slot >= 17 && slot <= 19) return 1;
        return null;
    }

    // Accumulate: Map<cost, Map<propId:addType, entry>>
    const byCost = { 4: new Map(), 3: new Map(), 1: new Map() };

    for (const m of phantomMain) {
        const starTier = Math.floor(m.Id / 1000);
        if (starTier < 2 || starTier > 5) continue;      // skip sub-mains (50001…)
        const slot = m.Id % 1000;
        const cost = slotToCost(slot);
        if (!cost) continue;

        const key = `${m.PropId}:${m.AddType}`;
        const pool = byCost[cost];
        if (!pool.has(key)) {
            const opt = makeStatOption(m.PropId, m.AddType, propDict);
            if (!opt) continue;
            pool.set(key, { ...opt, standardValue: 0, scaling: {} });
        }
        const entry = pool.get(key);
        entry.scaling[starTier] = {
            standardProp: m.StandardProperty,
            lv0:  computeMainStatDisplay(m.StandardProperty, growthCurve[0],  m.PropId, m.AddType),
            lv25: computeMainStatDisplay(m.StandardProperty, growthCurve[25], m.PropId, m.AddType),
        };
        if (starTier === 5) entry.standardValue = m.StandardProperty;
    }

    // Convert to plain arrays, preserving insertion order (= slot order)
    return {
        4: [...byCost[4].values()],
        3: [...byCost[3].values()],
        1: [...byCost[1].values()],
    };
}

// Compute the display value (the number a user sees in-game) for a main stat.
// Percent stats: StandardProperty × multiplier / 100 = display percent (e.g. 22.0)
// Flat stats:    StandardProperty × multiplier rounded to integer
function computeMainStatDisplay(standardProp, multiplier, propId, addType) {
    if (!multiplier) return 0;
    const scaled = standardProp * multiplier;
    const PERCENT_PROPS = new Set([8, 9, 35, 11, 22, 23, 24, 25, 26, 27]);
    if (addType === 2 || PERCENT_PROPS.has(propId)) {
        return Math.round(scaled / 100 * 10) / 10;  // 1 decimal place
    }
    return Math.round(scaled);
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

    // ── Resonators: Dimbreath (primary, full stats) + nanoka (new chars only) ──
    // Deduplicate: Rover exists as male and female variants with different ids
    // but identical names and stats. Keep the first (lower id) per name.
    const seen = new Set();
    const dimbreathResonators = raw.roleInfo
        .filter(isPlayable)
        .map(r => projectResonator(r, t))
        .sort((a, b) => a.id - b.id)
        .filter(r => {
            if (seen.has(r.name)) return false;
            seen.add(r.name);
            return true;
        });

    // Merge new characters from nanoka that aren't in Dimbreath yet.
    // Dimbreath IDs always win — we only add IDs not already covered.
    const nanoka = loadNanokaData();
    const dimbreathIds = new Set(dimbreathResonators.map(r => r.id));
    const nanokaChars = Object.entries(nanoka.characters)
        .map(([k, v]) => [Number(k), v])
        .filter(([id, v]) => {
            if (dimbreathIds.has(id)) return false;  // already have it
            if (!v.en) return false;                  // no english name
            if (seen.has(v.en)) return false;         // name-dedup (Rover female variants)
            return true;
        })
        .map(([id, v]) => {
            seen.add(v.en);
            return projectNanokaCharacter(id, v);
        });

    if (nanokaChars.length > 0) {
        process.stderr.write(`  + ${nanokaChars.length} character(s) from nanoka: ${nanokaChars.map(r => r.name).join(', ')}\n`);
    }

    const resonators = [...dimbreathResonators, ...nanokaChars]
        .sort((a, b) => a.id - b.id);

    const elements = raw.elementInfo
        .filter(e => e.Id !== 0)
        .map(e => ({ id: e.Id, name: t(e.Name), color: ELEMENT_COLORS[e.Id] }))
        .sort((a, b) => a.id - b.id);

    // ── Weapons: Dimbreath (primary) + nanoka (new weapons only) ─────────────
    const dimbreathWeapons = raw.weaponConf
        .map(w => projectWeapon(w, t, propDict))
        .filter(Boolean);
    const dimbreathWeaponIds = new Set(dimbreathWeapons.map(w => w.id));

    const nanokaWeapons = Object.entries(nanoka.weapons)
        .map(([k, v]) => [Number(k), v])
        .filter(([id, v]) => !dimbreathWeaponIds.has(id) && v.en)
        .map(([id, v]) => projectNanokaWeapon(id, v))
        .filter(Boolean);

    // Projection-only weapons (80080xxx) are cosmetic skins with no
    // stat curves — they would cause damage-formula division-by-zero.
    // Exclude IDs in the 80xxxxxx range from the active weapon list.
    const isProjectionWeapon = id => id >= 80000000;

    const weapons = [...dimbreathWeapons, ...nanokaWeapons.filter(w => !isProjectionWeapon(w.id))]
        .sort((a, b) => (b.rarity - a.rarity) || (a.type - b.type) || a.name.localeCompare(b.name));

    if (nanokaWeapons.length > 0) {
        const real = nanokaWeapons.filter(w => !isProjectionWeapon(w.id));
        const proj = nanokaWeapons.filter(w =>  isProjectionWeapon(w.id));
        if (real.length > 0) process.stderr.write(`  + ${real.length} weapon(s) from nanoka: ${real.map(w => w.name).join(', ')}\n`);
        if (proj.length > 0) process.stderr.write(`  (skipped ${proj.length} projection-skin weapon(s) — no stat curves)\n`);
    }

    // ── Echoes: Dimbreath only (nanoka echo data is monsterId-keyed; ──────────
    // the icon URLs are already resolved via iconUrlFor → nanokaAssetUrl).
    const echoes = uniqueEchoFamilies(raw.phantomItem, t)
        .map(p => projectEcho(p, t))
        .sort((a, b) => (b.cost - a.cost) || a.name.localeCompare(b.name));

    const effectMap = new Map((raw.phantomFetterEffects || []).map(e => [e.Id, e]));
    const sonatas = raw.phantomFetter
        .map(s => projectSonata(s, t, effectMap))
        .filter(Boolean)
        .sort((a, b) => a.id - b.id);

    const echoMainStats = projectEchoMainStats(raw.phantomMain, raw.phantomGrowth, propDict);
    const echoSubStats  = projectEchoSubStats(raw.phantomSub, propDict);
    const growthCurve   = projectGrowthCurve(raw.roleGrowth);
    const baseStats     = projectBaseStats(raw.baseProperty, resonators.map(r => r.propertyId));
    const skillTree     = projectSkillTreeBonuses(raw.skillTree);
    const weaponGrowthCurves = projectWeaponGrowthCurves(raw.weaponGrowth);
    const damageTable   = projectDamageTable(raw.damage, resonators.map(r => r.id));

    const out = {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        source: 'Dimbreath/WutheringData + nanoka.cc',
        credits: {
            dimbreath: 'https://github.com/Dimbreath/WutheringData — raw datamined config tables',
            nanoka:    'https://ww.nanoka.cc — community game-data service, icon CDN, and current-patch character/weapon coverage',
        },
        lang: args.lang,
        counts: {
            resonators:    resonators.length,
            weapons:       weapons.length,
            echoes:        echoes.length,
            sonatas:       sonatas.length,
            elements:      elements.length,
            echoMainStats: Object.values(echoMainStats).flat().length,
            echoSubStats:  echoSubStats.length,
            growthCurve:   growthCurve.length,
            baseStats:     Object.keys(baseStats).length,
            skillTree:     Object.keys(skillTree).length,
            weaponCurves:  Object.keys(weaponGrowthCurves).length,
            damageTable:   Object.values(damageTable).reduce((n, arr) => n + arr.length, 0),
        },
        elements,
        weaponTypes: Object.entries(WEAPON_TYPES).map(([id, name]) => ({ id: +id, name })),
        resonators,
        weapons,
        echoes,
        sonatas,
        echoMainStats,
        echoSubStats,
        growthCurve,
        baseStats,
        skillTree,
        weaponGrowthCurves,
        damageTable,
    };

    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, JSON.stringify(out, null, 2) + '\n');
    process.stderr.write(`\nWrote ${args.out}\n`);
    for (const [k, v] of Object.entries(out.counts)) {
        process.stderr.write(`  ${k.padEnd(15)} ${v}\n`);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
