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

const SCHEMA_VERSION = 8;
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
    // Thin projection used when no full character JSON is available.
    // Only provides basic picker data (no stats, no damage table).
    const elementId  = entry.element ?? 0;
    const weaponType = entry.weapon  ?? 0;
    return {
        id,
        name:           entry.en,
        rarity:         entry.rank ?? 5,
        element:        elementId,
        weaponType,
        propertyId:     null,
        maxLevel:       90,
        skillId:        null,
        elementColor:   ELEMENT_COLORS[elementId] ?? '#888',
        weaponTypeName: WEAPON_TYPES[weaponType]  ?? 'Unknown',
        iconUrl:        iconUrlFor(entry.en, id, 'resonators'),
        source:         'nanoka',
    };
}

// ── Full projection from data/extracted-nanoka/characters/{id}.json ──────────
// This is used when a complete nanoka character file has been fetched.
// It provides: base stats at every level, skill multipliers, skill tree bonuses.
// =============================================================================
// Nanoka character skill data — classification, key generation, META linking
// =============================================================================
//
// Each row in a nanoka skill_tree node falls into one of three categories:
//   damage  — name contains "DMG" (but not a conditional modifier)
//   buff    — conditional DMG modifier ("Increase per", "Boost per", etc.)
//   meta    — resource/timing info (STA Cost, Cooldown, Concerto Regen, etc.)
//
// The category determines where it appears in the UI:
//   damage → rotation palette step + damage panel skill card
//   buff   → toggleable modifier on the skill card (with stack count)
//   meta   → info section below the relevant skill card

// =============================================================================
// Skill row classification
// =============================================================================
//
// Each row in a nanoka skill_tree node falls into one of five categories:
//   damage  — name contains "DMG" or "Damage" (the attack)
//   heal    — name contains "Heal" or "Healing"
//   shield  — name contains "Shield", "Absorb", or "Barrier" (not "Reduction")
//   buff    — conditional DMG modifier ("Increase per", "Boost per", etc.)
//   meta    — resource/timing info (Cooldown, Concerto Regen, etc.)
//
// The category determines how it flows through the pipeline:
//   damage  → rotation palette step + damage panel (red numbers)
//   heal    → support step on rotation + heal panel (green numbers)
//   shield  → support step on rotation + shield value (amber numbers)
//   buff    → toggleable modifier on the skill card
//   meta    → info section below the relevant skill card

const BUFF_PATTERNS = /\bIncrease per\b|\bBoost per\b|\bper Snowforged\b|\bper Stack\b|\bDMG Increase per\b/i;
const META_SUFFIXES = [
    ' STA Cost', ' Stamina Cost', ' Cooldown', ' Concerto Regen',
    ' Resonance Cost', ' Cost per second', ' Energy Cost', ' Energy Regen', ' Regen',
    ' Duration', ' Stackmax', ' Range',
];

// Shield "Damage Reduction" rows are percentage modifiers, not HP values — skip.
const SHIELD_EXCLUSION_RE = /Damage\s+Reduction|DMG\s+Reduction/i;

function classifySkillRow(name) {
    if (BUFF_PATTERNS.test(name))                       return 'buff';
    if (META_SUFFIXES.some(s => name.includes(s)))      return 'meta';
    if (/\b(?:Heal(?:ing)?)\b/i.test(name))             return 'heal';
    if (/\b(?:Shield|Absorb(?:tion)?|Barrier)\b/i.test(name) &&
        !SHIELD_EXCLUSION_RE.test(name))                return 'shield';
    if (/\bDMG\b|Damage\b/i.test(name))                return 'damage';
    return 'other';
}

// Determine the actual skill type for a row.
// The node-level type (basic/skill/etc.) is overridden when the name signals
// a different attack category (heavy, midair).
// formulaType: what bonus bucket + skill level the damage formula uses.
//   midair      → basic  (mid-air attacks receive Basic Attack bonuses)
//   forte_basic → basic  (forte basic-attack variants use Basic Attack level)
//   forte_heavy → heavy  (forte heavy-attack variants use Heavy Attack level)
// isEchoSkill: the skill is dual-typed — it also benefits from Echo Skill DMG
//   bonuses and can trigger Echo Skill mechanics (e.g. Phrolova's Scarlet Coda).
//   Detection: param name contains "Echo Skill" OR skill description contains
//   "considered as Echo Skill" / "counts as Echo Skill".
const FORMULA_TYPE_MAP = {
    midair:      'basic',
    forte_basic: 'basic',
    forte_heavy: 'heavy',
};

// The (Echo) annotation flag is appended to the category prefix in generateSkillLabel.
const ECHO_SKILL_NAME_RE = /\bEcho Skill\b/i;

// Parse a nanoka skill description into sections separated by double newlines.
// Each WuWa node description groups sub-skills this way:
//   "Basic Attack\nPerform up to...\n\nHeavy Attack\nConsume STA...\n\nScarlet Coda\n..."
// Returns array of { header, full } where header is the first line (lowercased, tag-stripped).
function parseDescSections(desc) {
    if (!desc) return [];
    const plain = desc.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim();
    return plain.split(/\n\s*\n/).map(block => {
        const lines = block.trim().split('\n');
        return {
            header: lines[0].trim().replace(/:$/, '').toLowerCase(),
            full:   block.toLowerCase(),
        };
    }).filter(s => s.header.length > 0);
}

// For a given param name and node description, find cross-type conversion annotations:
//   isEchoSkill      — "considered as casting Echo Skill" or "considered Echo Skill DMG"
//   convertedFormula — "considered Resonance Skill DMG"       → 'skill'
//                      "considered Resonance Liberation DMG"  → 'liberation'
//                      null if no conversion
// Uses section-based matching: split the desc on double-newlines, match the param name
// to the most relevant section header, then scan only that section for "considered" patterns.
function parseDescConversions(paramName, nodeDesc) {
    const sections = parseDescSections(nodeDesc);
    if (!sections.length) return { isEchoSkill: false, convertedFormula: null };

    const cp = paramName.replace(/\s+DMG$/i, '').trim().toLowerCase();

    // Collect ALL sections matching this param (e.g. two "Scarlet Coda" blocks —
    // one with the trigger condition, one with the actual damage + conversion text)
    const matched = [];
    for (const sec of sections) {
        const h = sec.header;
        if (!h || h.length < 3) continue;
        if (cp === h ||
            // param is more specific than header: "basic attack stage 1" starts with "basic attack"
            cp.startsWith(h + ' ') ||
            cp.startsWith(h + ':') ||
            // header is a colon-subheading of the param: "scarlet coda: consume sta..."
            h.startsWith(cp + ':')) {
            matched.push(sec.full);
        }
    }
    // Loose fallback: header is a significant substring of the param name
    if (!matched.length) {
        for (const sec of sections) {
            if (sec.header.length > 5 && cp.includes(sec.header)) {
                matched.push(sec.full);
            }
        }
    }
    const relevantText = matched.join('\n');

    const isEchoSkill = /considered (?:as (?:casting )?)?echo skill/i.test(relevantText);
    let convertedFormula = null;
    if      (/considered (?:as )?resonance skill dmg/i.test(relevantText))       convertedFormula = 'skill';
    else if (/considered (?:as )?resonance liberation dmg/i.test(relevantText))  convertedFormula = 'liberation';

    return { isEchoSkill, convertedFormula };
}

function inferRowTypes(nodeType, name, skillDesc) {
    let skillType = nodeType;
    if (nodeType === 'forte') {
        if (/\bBasic Attack\b/i.test(name))    skillType = 'forte_basic';
        else                                    skillType = 'forte_heavy';
    } else if (/\bHeavy Attack\b/i.test(name)) skillType = 'heavy';
    else if (/\bMid-air\b/i.test(name))        skillType = 'midair';

    // Check for cross-type DMG conversions from skill description
    const { isEchoSkill, convertedFormula } = ECHO_SKILL_NAME_RE.test(name)
        ? { isEchoSkill: true, convertedFormula: null }
        : parseDescConversions(name, skillDesc);

    // convertedFormula overrides formulaType: e.g. Scarlet Coda is a Basic Attack
    // that deals Resonance Skill DMG — it uses the RS bonus bucket + skill level.
    const baseFormula  = FORMULA_TYPE_MAP[skillType] ?? skillType;
    const formulaType  = convertedFormula ?? baseFormula;

    return { skillType, formulaType, isEchoSkill, convertedFormula };
}

// Dodge Counters live in the damage panel for reference but are excluded
// from the rotation palette — they're reactive, not planned steps.
function isPaletteIncluded(name) {
    return !/Dodge Counter/i.test(name);
}

// Derive the correct scaling stat for a skill node from its sk.damage entries.
// WuWa skills scale off ATK (default), HP (healers like Baizhi/Shorekeeper),
// or DEF (tank-style chars like Taoqi/Yuanwu).
// We look at the dominant related_property across non-healing damage entries
// (healing entries have element=0 and type=0 — excluded here).
const RELATED_PROP_ID = { ATK: 7, HP: 2, DEF: 10 };

function nodeRelatedPropId(skDamage) {
    const counts = {};
    for (const entry of Object.values(skDamage ?? {})) {
        if (entry.element === 0 || entry.type === 0) continue;   // skip healing entries
        const propId = RELATED_PROP_ID[entry.related_property] ?? 7;
        counts[propId] = (counts[propId] ?? 0) + 1;
    }
    const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
    return sorted.length > 0 ? Number(sorted[0][0]) : 7;   // default: ATK
}

// Derive scaling stat from the `format` field on a level param row.
// The format is the authoritative source for per-row scaling in heal/shield rows
// (unlike damage rows where sk.damage.related_property is used).
// Returns: 'hp' | 'atk' | 'def' | 'er' | 'tuneAmp'
function scalingStatFromFormat(fmt) {
    if (!fmt || fmt === 'null') return 'atk';
    if (/\{0\}%\s*HP/i.test(fmt))            return 'hp';   // Danjin "36" = 36% HP
    if (/\{0\}\s*HP/i.test(fmt))             return 'hp';
    if (/\{0\}\s*DEF/i.test(fmt))            return 'def';
    if (/\{0\}\s*ATK/i.test(fmt))            return 'atk';
    if (/per.*Energy\s*Regen/i.test(fmt))    return 'er';
    if (/Tune\s*AMP/i.test(fmt))             return 'tuneAmp';
    return 'atk';
}

// Parse a heal/shield param string for one level into { flat, ratio, rawCoef }.
// flatsByLevel[i] + ratiosByLevel[i] × stat = support output at level i+1.
//
// Patterns handled:
//   "575+2.90%"  → flat=575,  ratio=0.029              (flat HP + HP%)
//   "2.90%"      → flat=0,    ratio=0.029              (pure HP/ATK/DEF %)
//   "1041+39%"   → flat=1041, ratio=0.39               (flat + ATK%)
//   "36" ({0}% HP)→ flat=0,   ratio=0.36               (integer IS the percent)
//   "500+1.75"   → flat=500,  rawCoef=1.75, ratio=0    (ER-based — Brant)
function parseHealParam(valStr, fmt) {
    const s = String(valStr ?? '').trim();
    if (!s || s === 'N/A') return { flat: 0, ratio: 0 };

    const isPercentHP = /\{0\}%\s*HP/i.test(fmt ?? '');
    const isER        = /per.*Energy\s*Regen/i.test(fmt ?? '');

    // "flat+ratio%"
    const mixM = s.match(/^([\d.]+)\+([\d.]+)%$/);
    if (mixM) return { flat: parseFloat(mixM[1]), ratio: parseFloat(mixM[2]) / 100 };

    // "flat+rawCoef" (ER-based Brant)
    const erM = s.match(/^([\d.]+)\+([\d.]+)$/);
    if (erM && isER) return { flat: parseFloat(erM[1]), ratio: 0, rawCoef: parseFloat(erM[2]) };

    // Pure percentage
    const pctM = s.match(/^([\d.]+)%$/);
    if (pctM) return { flat: 0, ratio: parseFloat(pctM[1]) / 100 };

    // Pure flat — if format is "{0}% HP", value IS the percentage
    const flatM = s.match(/^([\d.]+)$/);
    if (flatM) {
        if (isPercentHP) return { flat: 0, ratio: parseFloat(flatM[1]) / 100 };
        return { flat: parseFloat(flatM[1]), ratio: 0 };
    }

    return { flat: 0, ratio: 0 };
}

// Key format:  {skillType}_{description}  e.g. basic_present_1, heavy_fore, skill_jade_cleave
function generateSkillKey(name, skillType, nodeSkillName) {
    let clean = name.replace(/\s+DMG$/i, '').trim();

    // Strip the node skill name prefix ("Frostblight: ", "Foreclaiming: " etc.)
    if (nodeSkillName) {
        const esc = nodeSkillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        clean = clean.replace(new RegExp(`^${esc}:\\s*`, 'i'), '');
    }

    // Strip redundant attack-type prefixes (skillType already captures the type)
    clean = clean
        .replace(/^Basic Attack\s*[-–]\s*/i, '')
        .replace(/^Heavy Attack\s*[-–]\s*/i, '')
        .replace(/^Mid-air Plunging Attack\s*[-–]\s*/i, 'Plunging ')
        .replace(/^Mid-air Attack\s*[-–]\s*/i, '')
        .replace(/^Resonance Skill\s*[-–]\s*/i, '')
        .replace(/^Resonance Liberation\s*[-–]\s*/i, '')
        .replace(/\s+Base\s*$/i, '')
        .trim();

    // Normalise stance names and stage numbers for brevity
    clean = clean
        .replace(/\bPresent Self\b/gi, 'present')
        .replace(/\bForeclaimed Self\b/gi, 'fore')
        .replace(/\bStage\s+(\d)\b/gi, '$1')
        .trim();

    const suffix = (!clean || clean.toLowerCase() === skillType || clean.toLowerCase() === 'skill') ? '' : '_' + clean;
    return (skillType + suffix)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .replace(/_+/g, '_');
}

// Category prefix shown on every skill card and rotation step.
// These are the core WuWa combat mechanics that must always be visible.
const CATEGORY_PREFIX = {
    'basic':        'Basic Attack',
    'heavy':        'Heavy Attack',
    'midair':       'Basic Attack',           // mid-air = Basic Attack category
    'skill':        'Resonance Skill',
    'liberation':   'Resonance Liberation',
    'intro':        'Intro Skill',
    'outro':        'Outro Skill',
    'forte_basic':  'Basic Attack (Forte)',   // forte circuit — basic attack variant
    'forte_heavy':  'Heavy Attack (Forte)',   // forte circuit — heavy attack variant (default)
};

// Builds the display prefix, adding (Echo) annotation for dual-typed echo skills.
// e.g. isEchoSkill=true + skillType='heavy' → "Heavy Attack (Echo)"
function categoryPrefix(skillType, isEchoSkill) {
    const base = CATEGORY_PREFIX[skillType] ?? skillType;
    if (!isEchoSkill) return base;
    // Insert (Echo) before any existing parenthetical, or append it.
    // "Basic Attack"        → "Basic Attack (Echo)"
    // "Heavy Attack (Forte)"→ "Heavy Attack (Forte, Echo)"
    return base.replace(/\(([^)]+)\)$/, '($1, Echo)') +
           (base.includes('(') ? '' : ' (Echo)');
}

// Strip the redundant category prefix from the sub-name.
// Handles both "Basic Attack - Stage 1" (with dash) and "Basic Attack Stage 1" (no dash).
// forte subtypes also strip "Forte Circuit" which is implied by the (Forte) annotation.
const CATEGORY_STRIP_RE = {
    'basic':        /^Basic Attack\s*[-–]?\s+/i,
    'heavy':        /^Heavy Attack\s*[-–]?\s+/i,
    'forte_basic':  /^(?:Basic Attack|Forte Circuit)\s*[-–]?\s+/i,
    'forte_heavy':  /^(?:Heavy Attack|Forte Circuit)\s*[-–]?\s+/i,
    'skill':        /^Resonance Skill\s*[-–]?\s+/i,
    'liberation':   /^Resonance Liberation\s*[-–]?\s+/i,
};

// Generate the human-readable label. Format: "{Category}: {sub-name}"
// The category prefix (Basic Attack, Resonance Skill, etc.) is ALWAYS visible.
function generateSkillLabel(name, skillType, nodeSkillName, isEchoSkill = false) {
    const prefix = categoryPrefix(skillType, isEchoSkill);

    let sub = name.replace(/\s+DMG$/i, '').trim();

    // Strip the redundant category prefix from the sub-name
    const stripRe = CATEGORY_STRIP_RE[skillType];
    if (stripRe) sub = sub.replace(stripRe, '');

    // Generic residuals ("Skill", "DMG", or identical to prefix) → use node skill name.
    // Exception: basic/heavy/midair nodes have generic node names like "One, Two, Three"
    // (the overall attack sequence name) that add no meaning to individual params.
    // For those, a bare "Heavy Attack" is more informative than "Heavy Attack: One, Two, Three".
    const isNamedSkill = !['basic', 'heavy', 'midair'].includes(skillType);
    if (!sub || /^(Skill|DMG)$/i.test(sub) || sub.toLowerCase() === prefix.toLowerCase()) {
        sub = isNamedSkill ? (nodeSkillName || '') : '';
    }

    // Normalise separators in the sub-name:
    //   colon+space  "Frostblight: Jade Cleave"  → "Frostblight — Jade Cleave"
    //   space-dash-space  "Iai - Stage 1"  → "Iai — Stage 1"
    //   bare hyphen in "Mid-air" intentionally left untouched
    sub = sub.replace(/:\s+/g, ' — ').replace(/\s+-\s+/g, ' — ').trim();

    return sub ? `${prefix}: ${sub}` : prefix;
}

// Link META rows to their parent damage steps by name matching.
// Strategy: strip the known META suffix from the row name to recover the
// "attack base", then match against each damage row's base name.
// Handles "/" in names (e.g. "Jade Cleave/Petalfall Cooldown" → both skills).
// Returns a Map:  damageKey → [ { name, mults } ]
function linkMetaToSteps(damageRows, metaRows) {
    const links = new Map(damageRows.map(r => [r.key, []]));

    for (const meta of metaRows) {
        let base = meta.name;
        for (const suf of META_SUFFIXES) {
            const re = new RegExp(suf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
            base = base.replace(re, '');
        }
        base = base.trim();

        // Split on "/" to handle shared-cooldown rows
        const parts = base.split('/').map(p => p.trim()).filter(Boolean);
        let attached = false;

        for (const part of parts) {
            for (const dmg of damageRows) {
                const dmgBase = dmg.name.replace(/\s+DMG$/i, '').trim();
                if (part.length > 3 &&
                    (dmgBase.toLowerCase().includes(part.toLowerCase()) ||
                     part.toLowerCase().includes(dmgBase.toLowerCase()))) {
                    links.get(dmg.key).push({ label: meta.name.trim(), mults: meta.mults });
                    attached = true;
                }
            }
        }

        // Fallback: attach to the first damage row of this node
        if (!attached && damageRows.length > 0) {
            links.get(damageRows[0].key)
                 .push({ label: meta.name.trim(), mults: meta.mults, nodeLevel: true });
        }
    }

    return links;
}

// Parse a nanoka multiplier string to a decimal fraction.
// "72.49%"           → 0.7249
// "33.62%*5+252.11%" → (33.62*5 + 252.11) / 100 = 4.3921
function parseMult(m) {
    if (typeof m === 'number') return m;
    const terms = String(m).replace(/%/g, '').split('+');
    const total = terms.reduce((sum, t) => {
        const parts = t.split('*');
        return sum + parts.reduce((p, v) => p * parseFloat(v || '0'), 1);
    }, 0);
    return total / 100;
}

function projectNanokaCharacterFull(nChar, propDict) {
    const id         = nChar.id;
    const name       = nChar.name;
    const elementId  = nChar.element  ?? 0;
    const weaponType = nChar.weapon   ?? 0;

    // ── Base stats: use phase 6, level 90 as the canonical Lv90 value ─────────
    // Standard base Crit Rate / Crit DMG / Energy Regen for 5★ resonators.
    // These are NOT in nanoka but are identical across all 5★ characters in WuWa.
    // If a future character differs, override via patch.json.
    const BASE_CRIT_RATE   = 0.05;   // 5%
    const BASE_CRIT_DMG    = 1.50;   // 150%
    const BASE_ENERGY_REGEN = 1.00;  // 100%

    // Derive full stat lookup table: { [level]: { hp, atk, def } }
    const statsByLevel = {};
    for (const [_phase, levels] of Object.entries(nChar.stats ?? {})) {
        for (const [lvStr, s] of Object.entries(levels)) {
            const lv = Number(lvStr);
            // Take the max value at each level (post-ascension wins)
            if (!statsByLevel[lv] || s.atk > statsByLevel[lv].atk) {
                statsByLevel[lv] = { hp: s.life, atk: s.atk, def: s.def };
            }
        }
    }
    // Lv90 = canonical final value
    const lv90 = statsByLevel[90] ?? { hp: 0, atk: 0, def: 0 };

    // ── Skill tree stat bonuses (node_type 4 = passive stat) ─────────────────
    // 4 stat nodes per tier × 2 tiers = 8 total. Node IDs within each tier
    // are sorted ascending and assigned to columns in this order:
    //   normal → skill → liberation → intro  (Forte Circuit gets Inherent Skills)
    // parent_nodes confirms: Node9.parent=[1]=NormalAtk, Node10.parent=[2]=Skill, etc.
    //
    // propId mapping for stat bonus types:
    const STAT_BONUS_PROP = {
        'ATK+':              { propId: 10007, key: 'atkRatio'      },
        'HP+':               { propId: 10002, key: 'hpRatio'       },
        'HP Up':             { propId: 10002, key: 'hpRatio'       },  // alias
        'DEF+':              { propId: 10010, key: 'defRatio'      },
        'Crit. Rate+':       { propId: 8,     key: 'critRate'      },
        'Crit. Rate Up':     { propId: 8,     key: 'critRate'      },  // alias
        'Crit. DMG+':        { propId: 9,     key: 'critDmg'       },
        'Healing Bonus+':    { propId: 35,    key: 'healingBonus'  },
        // Element DMG bonuses — propId = 21 + elementId (1..6)
        'Glacio DMG Bonus+': { propId: 22, key: 'dmgBonus' },
        'Fusion DMG Bonus+': { propId: 23, key: 'dmgBonus' },
        'Electro DMG Bonus+':{ propId: 24, key: 'dmgBonus' },
        'Aero DMG Bonus+':   { propId: 25, key: 'dmgBonus' },
        'Spectro DMG Bonus+':{ propId: 26, key: 'dmgBonus' },
        'Havoc DMG Bonus+':  { propId: 27, key: 'dmgBonus' },
    };
    const STAT_NODE_COLS = ['normal', 'skill', 'liberation', 'intro'];

    // Collect stat nodes grouped by coordinate (tier), sorted by node ID
    const statByTier = {};
    for (const [k, node] of Object.entries(nChar.skill_trees ?? {})) {
        if (node.node_type !== 4) continue;
        const tier = node.coordinate ?? 1;
        if (!statByTier[tier]) statByTier[tier] = [];
        statByTier[tier].push({ nodeId: Number(k), sk: node.skill ?? {} });
    }

    // Build both the flat skillTreeBonuses (for stats engine) and the
    // structured statNodeBonuses (for UI display and toggle control).
    // Each bonus carries col+tier so statNodesActive can filter it.
    const skillTreeBonuses = [];
    const statNodeBonuses  = { normal: [], skill: [], liberation: [], intro: [] };

    for (const [tierStr, nodes] of Object.entries(statByTier)) {
        const tier   = Number(tierStr);
        const sorted = nodes.sort((a, b) => a.nodeId - b.nodeId);
        sorted.forEach((item, i) => {
            const col    = STAT_NODE_COLS[i];
            if (!col) return;
            const def    = STAT_BONUS_PROP[item.sk.name];
            const value  = parseFloat(item.sk.param?.[0]) / 100;
            if (!def || !Number.isFinite(value)) return;

            skillTreeBonuses.push({ propId: def.propId, key: def.key, value, col, tier });
            statNodeBonuses[col].push({ name: item.sk.name, value, tier, propId: def.propId });
        });
    }

    // ── Inherent Skills (node_type 3, sk.type='Inherent Skill') ──────────────
    // Two passive ability nodes per character connected to the Forte Circuit.
    // Tooltip fix: substitute {0},{1}... params BEFORE stripping remaining
    // game-engine {Cus:...} tags, so numbers show instead of "{…}".
    const inherentSkills = [];
    for (const [_k, node] of Object.entries(nChar.skill_trees ?? {})) {
        if (node.node_type !== 3) continue;
        const sk = node.skill ?? {};
        if (sk.type !== 'Inherent Skill') continue;
        // Step 1: strip HTML tags only
        const rawDesc = (sk.desc ?? '').replace(/<[^>]+>/g, '').trim();
        // Step 2: substitute numeric placeholders {0},{1}... with actual values
        const withParams = substituteParams(rawDesc, sk.param ?? []);
        // Step 3: strip any remaining game-engine tags {Cus:...} etc.
        const cleanDesc = withParams.replace(/\{[A-Za-z][^}]*\}/g, '').replace(/\s+/g, ' ').trim();
        inherentSkills.push({ name: sk.name ?? '', desc: cleanDesc, params: sk.param ?? [] });
    }

    // ── Outro Skill buff grants ───────────────────────────────────────────────
    // The Outro Skill grants DMG Amplification to the INCOMING resonator
    // (separate multiplicative bucket from dmgBonus — matches formula.js `amplify`).
    // We parse every buff grant in the Outro description so team-sim can apply
    // them to the next member's damage calculation.
    //
    // WuWa uses several language patterns for the same mechanic:
    //   "Y DMG Amplified by X%"      — most common (Sanhua, Zhezhi, ...)
    //   "X% Y Amplification"         — gains/grants variant (Mortefi, Phrolova, ...)
    //   "Amplify ... Y by X%"        — Brant/Cantarella variant
    //
    // scope.type:
    //   'element'   → amplify hits whose element matches scope.elementId
    //                 elementId null = "All DMG" (applies to every hit)
    //   'skillType' → amplify hits whose formulaType matches scope.skillType

    // These regexes are applied globally to pick up ALL grants in one pass.
    const OUTRO_GLOBAL_A = new RegExp(
        '(?:All|Glacio|Fusion|Electro|Aero|Spectro|Havoc|Basic\\s+Attack|Heavy\\s+Attack|Resonance\\s+Skill|Resonance\\s+Liberation|Echo\\s+Skill|Intro\\s+Skill)\\s+DMG\\s+Amplif\\w+\\s+by\\s+([\\d.]+)%',
        'gi'
    );
    const OUTRO_GLOBAL_B = new RegExp(
        '([\\d.]+)%\\s+((?:All|Glacio|Fusion|Electro|Aero|Spectro|Havoc|Basic\\s+Attack|Heavy\\s+Attack|Resonance\\s+Skill|Resonance\\s+Liberation|Echo\\s+Skill|Intro\\s+Skill)\\s+(?:DMG\\s+)?Amplif)',
        'gi'
    );
    const OUTRO_GLOBAL_C = new RegExp(
        'Amplif\\w+.*?((?:All|Glacio|Fusion|Electro|Aero|Spectro|Havoc|Basic\\s+Attack|Heavy\\s+Attack|Resonance\\s+Skill|Resonance\\s+Liberation|Echo\\s+Skill)\\s+DMG)\\s+by\\s+([\\d.]+)%',
        'gi'
    );

    const OUTRO_ELEMENT_MAP = [
        { re: /All\s+DMG/i,                    elementId: null },
        { re: /Glacio\s+DMG/i,                 elementId: 1 },
        { re: /Fusion\s+DMG/i,                 elementId: 2 },
        { re: /Electro\s+DMG/i,                elementId: 3 },
        { re: /Aero\s+DMG/i,                   elementId: 4 },
        { re: /Spectro\s+DMG/i,                elementId: 5 },
        { re: /Havoc\s+DMG/i,                  elementId: 6 },
    ];
    const OUTRO_SKILL_TYPE_MAP = [
        { re: /Basic\s+Attack\s+DMG/i,         skillType: 'basic' },
        { re: /Heavy\s+Attack\s+DMG/i,         skillType: 'heavy' },
        { re: /Resonance\s+Skill\s+DMG/i,      skillType: 'skill' },
        { re: /Resonance\s+Liberation\s+DMG/i, skillType: 'liberation' },
        { re: /Echo\s+Skill\s+DMG/i,           skillType: 'echo' },
        { re: /Intro\s+Skill\s+DMG/i,          skillType: 'intro' },
    ];

    function labelToScope(label) {
        for (const { re, elementId } of OUTRO_ELEMENT_MAP) {
            if (re.test(label)) return { type: 'element', elementId };
        }
        for (const { re, skillType } of OUTRO_SKILL_TYPE_MAP) {
            if (re.test(label)) return { type: 'skillType', skillType };
        }
        return null;
    }

    const outroBuffs = [];
    for (const [_k, node] of Object.entries(nChar.skill_trees ?? {})) {
        const sk = node.skill ?? {};
        if (sk.type !== 'Outro Skill') continue;

        const raw    = (sk.desc ?? '').replace(/<[^>]+>/g, '');
        const filled = substituteParams(raw, sk.param ?? [])
            .replace(/\{[A-Za-z][^}]*\}/g, '').replace(/\s+/g, ' ').trim();

        // Duration: "for Xs" — default 14s if absent
        const durM     = filled.match(/for\s+([\d.]+)s\b/i);
        const duration = durM ? parseFloat(durM[1]) : 14;

        // Collect all grants via global regexes (handles "X% A and X% B" on one line)
        const seen = new Set();  // dedup by scope key
        function addGrant(label, value) {
            const scope = labelToScope(label.trim());
            if (!scope) return;
            const key = scope.type + ':' + (scope.elementId ?? scope.skillType);
            if (seen.has(key)) return;
            seen.add(key);
            outroBuffs.push({ scope, value: parseFloat(value) / 100, duration });
        }

        // Pattern A: "Y DMG Amplified by X%" — label is the prefix before "Amplif"
        for (const m of filled.matchAll(OUTRO_GLOBAL_A)) {
            const label = m[0].replace(/\s+Amplif\w+.*$/i, '').trim();
            addGrant(label, m[1]);
        }

        // Pattern B: "X% Y Amplification"
        for (const m of filled.matchAll(OUTRO_GLOBAL_B)) {
            const label = m[2].replace(/\s*Amplif\w*/i, '').replace(/\s*DMG\s*$/i, ' DMG').trim();
            addGrant(label, m[1]);
        }

        // Pattern C: "Amplify ... Y by X%"
        for (const m of filled.matchAll(OUTRO_GLOBAL_C)) {
            addGrant(m[1].trim(), m[2]);
        }

        // Pattern D: bare "DMG Amplified by X%" with no type prefix → "All DMG"
        const OUTRO_GLOBAL_D = /\bDMG\s+Amplif\w+\s+by\s+([\d.]+)%/gi;
        for (const m of filled.matchAll(OUTRO_GLOBAL_D)) {
            // Only add if no element or skill-type was already detected from this text
            if (!seen.size) addGrant('All DMG', m[1]);
        }

        break;  // one Outro Skill node per character
    }

    // ── Off-field damage actions ──────────────────────────────────────────────
    // Projected from skill level params (same source as all skillDamage) +
    // description text for rates/durations.
    //
    // Three types (src/core/off-field.js):
    //   'coordinated' — triggers on every on-field hit, rate-limited
    //   'turret'      — periodic damage from a deployed entity
    //   'outroBurst'  — single burst at the switch-out moment (Outro DMG params)
    //
    // IMPORTANT: multipliers come from sk.level params, not desc text.
    // The description only contains rates and durations in human language.
    // Exception: Rover:Havoc outro mentions "X% of Rover's ATK" in desc.

    // Param name patterns that identify off-field DMG rows.
    // Covers both "X DMG" and "X Damage" naming conventions in nanoka data.
    const COORD_PARAM_RE  = /coordinated\s+attack|marcato|inklit\s+spirit|judgement\s+strike|judgment\s+strike|dreamweaver|diffusion|lance.*coord|photosynthesis/i;
    const TURRET_PARAM_RE = /turret|phantom|havoc\s+field|hover\s+cannon/i;
    const DMG_NAME_RE     = /DMG|Damage/i;   // nanoka uses both conventions

    // Description-level patterns for type detection and timing
    const COORD_DESC_RE   = /coordinated\s+attack/i;
    // Matches: "summons a turret", "summons a Havoc Field", "summon Hover Cannons"
    const TURRET_DESC_RE  = /summon\w*\s+.{0,20}(?:turret|phantom|havoc\s*field|hover\s+cannon)/i;

    function descCooldown(text) {
        const m = text.match(/(?:triggered|fires?|once|triggered once)\s+every\s+([\d.]+)\s*s|every\s+([\d.]+)\s*s\b/i);
        return m ? parseFloat(m[1] ?? m[2]) : null;
    }
    function descDuration(text) {
        const m = text.match(/(?:lasts?\s+for|for)\s+([\d.]+)\s*s\b/i);
        return m ? parseFloat(m[1]) : null;
    }
    function descMaxHits(text) {
        const m = text.match(/up to\s+(\d+)\s+times?/i);
        return m ? parseInt(m[1]) : null;
    }
    // Fallback: "X% of CharName's ATK every Ns" in desc text (Rover:Havoc)
    function descInlineMultiplier(text) {
        const m = text.match(/([\d.]+)%\s*of\s+\w+(?:'s)?\s+ATK/i);
        return m ? parseFloat(m[1]) / 100 : null;
    }

    const offFieldActions = [];

    for (const [_k, node] of Object.entries(nChar.skill_trees ?? {})) {
        const sk    = node.skill ?? {};
        const stype = sk.type ?? '';

        if (!['Resonance Liberation', 'Outro Skill', 'Resonance Skill',
              'Forte Circuit'].includes(stype)) continue;

        const raw    = (sk.desc ?? '').replace(/<[^>]+>/g, '');
        const filled = substituteParams(raw, sk.param ?? [])
            .replace(/\{[A-Za-z][^}]*\}/g, '').replace(/\s+/g, ' ').trim();

        const trigger = stype === 'Resonance Liberation' ? 'liberation'
            : stype === 'Outro Skill'  ? 'outro'
            : stype === 'Resonance Skill' ? 'skill' : 'forte';

        const cd    = descCooldown(filled);
        const dur   = descDuration(filled);
        const maxHits = descMaxHits(filled);

        // ── Coordinated attacks: multiplier from level params ─────────────────
        if (COORD_DESC_RE.test(filled)) {
            // Sum all level params whose names match coordinated-attack patterns
            let totalMult = 0;
            let hitRows   = 0;
            for (const pv of Object.values(sk.level ?? {})) {
                const rowName = pv.name ?? '';
                if (!COORD_PARAM_RE.test(rowName)) continue;
                if (!DMG_NAME_RE.test(rowName)) continue;
                const mults = pv.param?.[0] ?? [];
                if (!mults.length) continue;
                const m = parseMult(mults[mults.length - 1] ?? mults[0]);
                if (m > 0) { totalMult += m; hitRows++; }
            }
            if (totalMult > 0) {
                offFieldActions.push({
                    type:        'coordinated',
                    trigger,
                    element:     elementId,
                    scaling:     'atk',
                    multiplier:  totalMult,
                    hitsPerCast: maxHits,
                    cooldown:    cd ?? 1.0,
                    duration:    dur,
                    note:        `${sk.name ?? stype} (${hitRows} DMG row${hitRows > 1 ? 's' : ''})`,
                });
            }
        }

        // ── Turret / persistent summon: level params first, desc fallback ─────
        if (TURRET_DESC_RE.test(filled) && stype === 'Outro Skill') {
            let multiplier = null;
            // Primary: level params
            for (const pv of Object.values(sk.level ?? {})) {
                const rowName = pv.name ?? '';
                if (!TURRET_PARAM_RE.test(rowName) && !DMG_NAME_RE.test(rowName)) continue;
                const mults = pv.param?.[0] ?? [];
                if (!mults.length) continue;
                const m = parseMult(mults[mults.length - 1] ?? mults[0]);
                if (m > 0) { multiplier = m; break; }
            }
            // Fallback: inline "X% of ATK" in desc (Rover:Havoc — no level params)
            if (multiplier == null) multiplier = descInlineMultiplier(filled);

            if (multiplier != null) {
                offFieldActions.push({
                    type:        'turret',
                    trigger:     'outro',
                    element:     elementId,
                    scaling:     'atk',
                    multiplier,
                    hitsPerCast: null,
                    cooldown:    cd ?? 1.0,
                    duration:    dur ?? 14,
                    note:        `${sk.name ?? 'Outro'} summon`,
                });
            }
        }

        // ── Outro burst: Outro Skill nodes with DMG level params ──────────────
        if (stype === 'Outro Skill') {
            for (const pv of Object.values(sk.level ?? {})) {
                const rowName = pv.name ?? '';
                if (!DMG_NAME_RE.test(rowName)) continue;
                // Skip turret rows (already handled above) and buff rows
                if (TURRET_PARAM_RE.test(rowName)) continue;
                const mults = pv.param?.[0] ?? [];
                if (!mults.length) continue;
                const m = parseMult(mults[mults.length - 1] ?? mults[0]);
                if (m > 0) {
                    offFieldActions.push({
                        type:        'outroBurst',
                        trigger:     'outro',
                        element:     elementId,
                        scaling:     'atk',
                        multiplier:  m,
                        hitsPerCast: 1,
                        cooldown:    null,
                        duration:    null,
                        note:        `${sk.name ?? 'Outro'}: ${rowName}`,
                    });
                }
            }
        }
    }

    // Descriptions are param-substituted like inherent skills so the UI can
    // show the user exactly what each chain level does. Mechanical effects on
    // damage are NOT applied here — chains are bespoke per character and are
    // surfaced as display-only information for now.
    const resonanceChain = [];
    for (const lvl of ['1', '2', '3', '4', '5', '6']) {
        const ch = nChar.chains?.[lvl];
        if (!ch) continue;
        const rawDesc    = (ch.desc ?? '').replace(/<[^>]+>/g, '').trim();
        const withParams = substituteParams(rawDesc, ch.param ?? []);
        const cleanDesc  = withParams.replace(/\{[A-Za-z][^}]*\}/g, '').replace(/\s+/g, ' ').trim();
        resonanceChain.push({
            level:  Number(lvl),
            name:   ch.name ?? `Sequence ${lvl}`,
            desc:   cleanDesc,
            params: ch.param ?? [],
        });
    }

    // ── Skill data: classify, key, and link every row ─────────────────────────
    const SKILL_TYPE_MAP = {
        'Normal Attack':         'basic',
        'Resonance Skill':       'skill',
        'Resonance Liberation':  'liberation',
        'Forte Circuit':         'forte',
        'Intro Skill':           'intro',
        'Outro Skill':           'outro',
    };

    // Accumulate rows per node so META linking can work within each node
    const damageByNode  = {};   // nodeId → [classified damage rows]
    const supportByNode = {};   // nodeId → [heal + shield rows]
    const metaByNode    = {};   // nodeId → [raw meta rows]
    const buffRows      = [];   // conditional buff rows (node-crossing)

    for (const [nodeK, node] of Object.entries(nChar.skill_trees ?? {})) {
        const sk       = node.skill ?? {};
        const nodeType = SKILL_TYPE_MAP[sk.type] ?? 'unknown';
        const levels   = sk.level;
        if (!levels) continue;

        const nid = Number(nodeK);
        if (!damageByNode[nid])  damageByNode[nid]  = [];
        if (!supportByNode[nid]) supportByNode[nid] = [];
        if (!metaByNode[nid])    metaByNode[nid]    = [];

        // Derive scaling stat from sk.damage (the authoritative source).
        // This correctly handles HP scalers (Baizhi, Shorekeeper) and
        // DEF scalers (Taoqi, Yuanwu) rather than hardcoding ATK for all.
        const relatedPropId = nodeRelatedPropId(sk.damage);

        for (const [paramK, paramV] of Object.entries(levels)) {
            const rowName = paramV.name ?? '';
            const mults   = paramV.param?.[0] ?? [];
            if (!mults.length) continue;

            const cls = classifySkillRow(rowName);

            if (cls === 'damage') {
                // Pass sk.desc for description-based Echo Skill detection
                // (e.g. "considered as casting Echo Skill" in skill text)
                const { skillType, formulaType, isEchoSkill } = inferRowTypes(nodeType, rowName, sk.desc);
                const key   = generateSkillKey(rowName, skillType, sk.name);
                const label = generateSkillLabel(rowName, skillType, sk.name, isEchoSkill);
                damageByNode[nid].push({
                    nodeId:        nid,
                    paramId:       Number(paramK),
                    skillName:     sk.name,
                    name:          rowName,
                    type:          nodeType,
                    skillType,
                    formulaType,
                    isEchoSkill,
                    element:       elementId,
                    relatedPropId,   // correct per-node: 7=ATK, 2=HP, 10=DEF
                    mults,
                    key,
                    label,
                    paletteInclude: isPaletteIncluded(rowName),
                });
            } else if (cls === 'heal' || cls === 'shield') {
                // Support rows: heal or shield values.
                // Each level param has its own format (e.g. "{0} HP") which
                // determines the scaling stat — format is authoritative here.
                const fmt        = paramV.format ?? null;
                const scalingStat = scalingStatFromFormat(fmt);
                // Parse flats and ratios across all 20 skill levels
                const flatsByLevel  = mults.map(v => parseHealParam(v, fmt).flat);
                const ratiosByLevel = mults.map(v => parseHealParam(v, fmt).ratio);
                const rawCoefsByLevel = mults.map(v => parseHealParam(v, fmt).rawCoef ?? 0);
                // Build a key mirroring the parent damage key so the sim can
                // find support rows via the same autoSkillMap entry.
                const { skillType } = inferRowTypes(nodeType, rowName, sk.desc);
                const key = generateSkillKey(rowName, skillType, sk.name);
                supportByNode[nid].push({
                    nodeId:        nid,
                    paramId:       Number(paramK),
                    skillName:     sk.name,
                    name:          rowName,
                    rowType:       cls,         // 'heal' | 'shield'
                    skillType,
                    scalingStat,
                    flatsByLevel,
                    ratiosByLevel,
                    rawCoefsByLevel,
                    key,
                    label:         `${sk.name}: ${rowName}`,
                });
            } else if (cls === 'meta') {
                metaByNode[nid].push({ name: rowName, mults });
            } else if (cls === 'buff') {
                buffRows.push({
                    nodeId:    nid,
                    paramId:   Number(paramK),
                    skillName: sk.name,
                    name:      rowName,
                    mults,
                    nodeType,
                });
            }
        }
    }

    // Link META rows to their parent damage steps within each node
    const skillMeta = {};    // damageKey → [{ label, mults }]
    for (const [nid, dmgRows] of Object.entries(damageByNode)) {
        const links = linkMetaToSteps(dmgRows, metaByNode[nid] ?? []);
        for (const [key, items] of links) {
            if (items.length) skillMeta[key] = items;
        }
    }

    // Assign each buff row to the closest damage step in the same node
    // (the last damage row = the node's primary output, typically correct
    //  for Liberation buffs like "Increase per Snowforged Blade")
    const skillBuffs = buffRows.map(buff => {
        const nodeDmg = damageByNode[buff.nodeId] ?? [];
        const parentKey = nodeDmg[nodeDmg.length - 1]?.key ?? null;
        return { ...buff, parentKey };
    });

    const skillDamage  = Object.values(damageByNode).flat();
    const skillSupport = Object.values(supportByNode).flat();  // heal + shield rows

    return {
        id,
        name,
        rarity:          nChar.rarity ?? 5,
        element:         elementId,
        weaponType,
        propertyId:      id,
        maxLevel:        90,
        skillId:         null,
        elementColor:    ELEMENT_COLORS[elementId] ?? '#888',
        weaponTypeName:  WEAPON_TYPES[weaponType]  ?? 'Unknown',
        iconUrl:         iconUrlFor(name, id, 'resonators'),
        source:          'nanoka',
        baseAtk:         lv90.atk,
        baseHp:          lv90.hp,
        baseDef:         lv90.def,
        baseCritRate:    BASE_CRIT_RATE,
        baseCritDmg:     BASE_CRIT_DMG,
        baseEnergyRegen: BASE_ENERGY_REGEN,
        statsByLevel,
        skillTreeBonuses,
        statNodeBonuses,   // { normal, skill, liberation, intro } → [{name,value,tier,propId}]
        inherentSkills,
        resonanceChain,
        outroBuffs,       // [{ scope: {type,elementId?|skillType?}, value, duration }]
        offFieldActions,  // [{ type, trigger, element, scaling, multiplier, cooldown, duration, note }]
        skillDamage,   // granular, classified, keyed
        skillSupport,  // heal + shield rows, keyed same as skillDamage
        skillMeta,     // key → [meta items] for the damage panel
        skillBuffs,    // conditional buff rows with parentKey
    };
}

// nanoka weapon sub-stat display name → engine propId + normalization.
// All values come pre-resolved per level from the nanoka detail file, so
// we just need the propId. The "is_percent" flag in the data tells us
// whether to divide by 10000 (percent stored as e.g. 2430 = 24.30%).
const NANOKA_STAT_NAME = {
    'ATK':          { propId: 7,     key: 'atk',         percent: false },
    'HP':           { propId: 1,     key: 'hp',          percent: false },
    'DEF':          { propId: 3,     key: 'def',         percent: false },
    'Crit. Rate':   { propId: 8,     key: 'critRate',    percent: true  },
    'Crit. DMG':    { propId: 9,     key: 'critDmg',     percent: true  },
    'Energy Regen': { propId: 11,    key: 'energyRegen', percent: true  },
    'ATK%':         { propId: 10007, key: 'atkPct',      percent: true  },
    'HP%':          { propId: 10002, key: 'hpPct',       percent: true  },
    'DEF%':         { propId: 10010, key: 'defPct',      percent: true  },
};

// Thin projection (index only — no per-level stats).
function projectNanokaWeapon(id, entry) {
    if (!entry.en) return null;
    return {
        id,
        name:     entry.en,
        type:     entry.type ?? 0,
        typeName: WEAPON_TYPES[entry.type] ?? 'Unknown',
        rarity:   entry.rank ?? 5,
        iconUrl:  iconUrlFor(entry.en, id, 'weapons'),
        source:   'nanoka',
    };
}

// Full projection from data/extracted-nanoka/weapons/{id}.json.
// nanoka stats[phase][level] = [ {name, value, is_ratio, is_percent}, ... ]
// where index 0 = base stat (always ATK), index 1 = sub stat.
// We build a flat statsByLevel: { [level]: { atk, critRate, ... } } using
// the highest-phase value at each level (post-ascension wins).
function projectNanokaWeaponFull(nWeapon) {
    const id = nWeapon.id;
    const statsByLevel = {};

    for (const [_phase, levels] of Object.entries(nWeapon.stats ?? {})) {
        for (const [lvStr, statArr] of Object.entries(levels)) {
            const lv = Number(lvStr);
            const resolved = {};
            for (const s of statArr) {
                const def = NANOKA_STAT_NAME[s.name];
                if (!def) continue;
                // Percent stats stored as hundredths-of-percent (2430 = 24.30%)
                resolved[def.key] = def.percent ? s.value / 10000 : s.value;
            }
            // Higher phase wins at shared breakpoint levels (e.g. Lv80 in phase 5 vs 6)
            if (!statsByLevel[lv] || (resolved.atk ?? 0) >= (statsByLevel[lv].atk ?? 0)) {
                statsByLevel[lv] = resolved;
            }
        }
    }

    // Identify the sub-stat name (index 1 of any level's stat array)
    const sampleArr = nWeapon.stats?.['0']?.['1'] ?? [];
    const subName   = sampleArr[1]?.name ?? null;

    return {
        id,
        name:     nWeapon.name,
        type:     nWeapon.type ?? 0,
        typeName: WEAPON_TYPES[nWeapon.type] ?? 'Unknown',
        rarity:   nWeapon.rarity ?? 5,
        subStatName: subName,
        statsByLevel,                         // { [level]: { atk, critRate, ... } }
        effect:     nWeapon.effect ?? undefined,
        effectName: nWeapon.effect_name ?? undefined,
        effectParams: nWeapon.param ?? undefined,   // [ [R1..R5], ... ] per placeholder
        iconUrl:    iconUrlFor(nWeapon.name, id, 'weapons'),
        source:     'nanoka',
    };
}

// ── Echo full projection from data/extracted-nanoka/echoes/{id}.json ─────────
// nanoka keys echoes by monsterId (390xxxxxx). Provides the active skill
// (damage.rate_lv), sonata groups with pre-split descParams, and class rank.
//
// intensity_code → class + cost (authoritative; matches verified truth):
//   3 = Calamity (4-cost)
//   2 = Overlord (4-cost)
//   1 = Elite    (3-cost)
//   0 = Common   (1-cost)
const INTENSITY_TO_COST  = { 3: 4, 2: 4, 1: 3, 0: 1 };
const INTENSITY_TO_CLASS = { 3: 'Calamity', 2: 'Overlord', 1: 'Elite', 0: 'Common' };

function projectNanokaEchoFull(nEcho, indexEntry) {
    const monsterId = nEcho.id;
    const intensity = nEcho.intensity_code ?? indexEntry?.intensity ?? 0;
    const cost      = INTENSITY_TO_COST[intensity]  ?? 1;
    const className = INTENSITY_TO_CLASS[intensity] ?? 'Common';

    let activeSkill = null;
    const skill = nEcho.skill;
    if (skill?.damage) {
        const [settleId, dmg] = Object.entries(skill.damage)[0] ?? [];
        if (dmg) {
            activeSkill = {
                settleId:        Number(settleId),
                element:         dmg.element,
                relatedProperty: dmg.related_property ?? 'ATK',
                relatedPropId:   ({ 'ATK': 7, 'HP': 2, 'DEF': 10 })[dmg.related_property] ?? 7,
                rateByLevel:     (dmg.rate_lv ?? []).map(v => v / 10000),
                energyGain:      dmg.energy ?? 0,
                desc:            skill.desc ?? undefined,
                params:          skill.param ?? undefined,
            };
        }
    }

    const sonataIds = indexEntry?.group ?? Object.keys(nEcho.group ?? {}).map(Number);

    return {
        id:        monsterId,
        monsterId,
        name:      nEcho.name,
        cost,
        classRank: intensity,
        className,
        starLevel: 5,
        code:      nEcho.code ?? undefined,
        sonataIds,
        activeSkill,
        iconUrl:   iconUrlFor(nEcho.name, monsterId, 'echoes'),
        source:    'nanoka',
    };
}

function projectNanokaSonatas(echoDetailFiles) {
    const sonatas = new Map();
    for (const nEcho of echoDetailFiles) {
        for (const [gid, group] of Object.entries(nEcho.group ?? {})) {
            const id = Number(gid);
            if (sonatas.has(id)) continue;
            const tiers = [];
            for (const [pieces, setData] of Object.entries(group.set ?? {})) {
                tiers.push({
                    pieces:    Number(pieces),
                    effect:    substituteParams(setData.desc ?? '', setData.param ?? []),
                    rawEffect: setData.desc ?? '',
                    params:    setData.param ?? [],
                    buffIds:   Number(pieces) >= 5 ? [id * 1000 + Number(pieces)] : [],
                    addProp:   [],
                });
            }
            sonatas.set(id, {
                id,
                name:  group.name,
                color: group.color ?? undefined,
                tiers: tiers.sort((a, b) => a.pieces - b.pieces),
            });
        }
    }
    return [...sonatas.values()].sort((a, b) => a.id - b.id);
}

// Substitute {0}/{1}/... placeholders with params — solves Phase 7's gap.
function substituteParams(desc, params) {
    return desc.replace(/\{(\d+)\}/g, (m, i) => params[Number(i)] ?? m);
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
    const CHAR_DIR = resolve(__dirname, '../data/extracted-nanoka/characters');
    const dimbreathIds = new Set(dimbreathResonators.map(r => r.id));

    const nanokaChars = Object.entries(nanoka.characters)
        .map(([k, v]) => [Number(k), v])
        .filter(([id, v]) => {
            if (dimbreathIds.has(id)) return false;
            if (!v.en) return false;
            if (seen.has(v.en)) return false;
            return true;
        })
        .map(([id, v]) => {
            seen.add(v.en);
            // If a full character JSON was fetched by fetch-nanoka-chars.mjs, use it.
            const fullPath = resolve(CHAR_DIR, `${id}.json`);
            if (existsSync(fullPath)) {
                try {
                    const nChar = JSON.parse(readFileSync(fullPath, 'utf8'));
                    return projectNanokaCharacterFull(nChar, propDict);
                } catch { /* fall through to thin projection */ }
            }
            return projectNanokaCharacter(id, v);
        });

    if (nanokaChars.length > 0) {
        const full = nanokaChars.filter(r => r.skillDamage);
        const thin = nanokaChars.filter(r => !r.skillDamage);
        if (full.length) process.stderr.write(`  + ${full.length} nanoka char(s) [FULL stats]: ${full.map(r => r.name).join(', ')}\n`);
        if (thin.length) process.stderr.write(`  + ${thin.length} nanoka char(s) [basic only]: ${thin.map(r => r.name).join(', ')}\n`);
    }

    const resonators = [...dimbreathResonators, ...nanokaChars]
        .sort((a, b) => a.id - b.id);

    // ── Weapons: nanoka detail (primary) + Dimbreath (fallback) ──────────────
    const WEAPON_DIR = resolve(__dirname, '../data/extracted-nanoka/weapons');
    const nanokaWeaponDetail = {};   // id → parsed detail JSON
    if (existsSync(WEAPON_DIR)) {
        for (const [idStr] of Object.entries(nanoka.weapons)) {
            const p = resolve(WEAPON_DIR, `${idStr}.json`);
            if (existsSync(p)) {
                try { nanokaWeaponDetail[idStr] = JSON.parse(readFileSync(p, 'utf8')); }
                catch { /* skip */ }
            }
        }
    }

    const dimbreathWeapons = raw.weaponConf
        .map(w => projectWeapon(w, t, propDict))
        .filter(Boolean);
    const dimbreathWeaponIds = new Set(dimbreathWeapons.map(w => w.id));

    // Build the weapon list: nanoka-full where we have a detail file,
    // else nanoka-thin for new IDs, else Dimbreath.
    const weaponsById = new Map();
    for (const w of dimbreathWeapons) weaponsById.set(w.id, w);
    for (const [idStr, entry] of Object.entries(nanoka.weapons)) {
        const id = Number(idStr);
        const detail = nanokaWeaponDetail[idStr];
        if (detail) {
            weaponsById.set(id, projectNanokaWeaponFull(detail));   // nanoka full wins
        } else if (!weaponsById.has(id)) {
            const thin = projectNanokaWeapon(id, entry);            // new id, no detail yet
            if (thin) weaponsById.set(id, thin);
        }
    }
    const isProjectionWeapon = id => id >= 80000000;
    const weapons = [...weaponsById.values()]
        .filter(w => !isProjectionWeapon(w.id))
        .sort((a, b) => (b.rarity - a.rarity) || (a.type - b.type) || a.name.localeCompare(b.name));

    const nanokaFullWeapons = weapons.filter(w => w.statsByLevel).length;
    process.stderr.write(`  weapons: ${weapons.length} total, ${nanokaFullWeapons} with nanoka per-level stats\n`);

    // ── Echoes: nanoka detail (primary) + Dimbreath (fallback) ───────────────
    const ECHO_DIR = resolve(__dirname, '../data/extracted-nanoka/echoes');
    const nanokaEchoDetail = [];   // parsed detail JSONs (for sonata extraction)
    let echoes;

    const haveNanokaEchoes = existsSync(ECHO_DIR) &&
        Object.keys(nanoka.echoes).some(id => existsSync(resolve(ECHO_DIR, `${id}.json`)));

    if (haveNanokaEchoes) {
        // nanoka is the authoritative echo source
        const echoList = [];
        for (const [idStr, indexEntry] of Object.entries(nanoka.echoes)) {
            const p = resolve(ECHO_DIR, `${idStr}.json`);
            if (!existsSync(p)) continue;
            try {
                const nEcho = JSON.parse(readFileSync(p, 'utf8'));
                nanokaEchoDetail.push(nEcho);
                echoList.push(projectNanokaEchoFull(nEcho, indexEntry));
            } catch { /* skip */ }
        }
        echoes = echoList.sort((a, b) => (b.cost - a.cost) || a.name.localeCompare(b.name));
        process.stderr.write(`  echoes: ${echoes.length} from nanoka detail files\n`);
    } else {
        // Fallback: Dimbreath PhantomItem
        echoes = uniqueEchoFamilies(raw.phantomItem, t)
            .map(p => projectEcho(p, t))
            .sort((a, b) => (b.cost - a.cost) || a.name.localeCompare(b.name));
        process.stderr.write(`  echoes: ${echoes.length} from Dimbreath (no nanoka echo files found)\n`);
    }

    const elements = raw.elementInfo
        .filter(e => e.Id !== 0)
        .map(e => ({ id: e.Id, name: t(e.Name), color: ELEMENT_COLORS[e.Id] }))
        .sort((a, b) => a.id - b.id);

    const effectMap = new Map((raw.phantomFetterEffects || []).map(e => [e.Id, e]));
    // Prefer nanoka sonatas (pre-split descParams) when echo detail files exist.
    const sonatas = nanokaEchoDetail.length > 0
        ? projectNanokaSonatas(nanokaEchoDetail)
        : raw.phantomFetter
            .map(s => projectSonata(s, t, effectMap))
            .filter(Boolean)
            .sort((a, b) => a.id - b.id);
    process.stderr.write(`  sonatas: ${sonatas.length} from ${nanokaEchoDetail.length > 0 ? 'nanoka' : 'Dimbreath'}\n`);

    const echoMainStats = projectEchoMainStats(raw.phantomMain, raw.phantomGrowth, propDict);
    const echoSubStats  = projectEchoSubStats(raw.phantomSub, propDict);
    const growthCurve   = projectGrowthCurve(raw.roleGrowth);
    const baseStats     = projectBaseStats(raw.baseProperty, resonators.map(r => r.propertyId));
    const skillTree     = projectSkillTreeBonuses(raw.skillTree);
    const weaponGrowthCurves = projectWeaponGrowthCurves(raw.weaponGrowth);
    const damageTable   = projectDamageTable(raw.damage, resonators.map(r => r.id));
    const supportTable  = {};   // resonatorId → [{id, rowType, scalingStat, flatsByLevel, ratiosByLevel}]

    // Merge nanoka skill damage into the damageTable for nanoka-sourced chars.
    // Nanoka rows use { nodeId, paramId, skillName, name, type, element, mults }.
    // We convert them to the same row shape the engine reads:
    //   { id, mults, element, relatedProp }
    // The synthetic id is resonatorId * 1e7 + nodeId * 1000 + paramId (unique).
    // Build autoSkillMap + supplemental damageTable entries for ALL resonators
    // that have a nanoka character JSON — not just the ones new to Dimbreath.
    // This gives skill data to every Dimbreath char (Sanhua, Jinhsi, etc.) as
    // soon as their JSON is fetched with: node tools/fetch-nanoka-chars.mjs --all
    const autoSkillMap = {};

    const CAST_TIMES = {
        basic: 0.55, heavy: 1.40, skill: 1.30, liberation: 1.80,
        intro: 0.80, outro: 1.00, midair: 0.60,
        forte_basic: 0.80, forte_heavy: 1.60,
    };

    // Combine: nanokaChars (IDs not in Dimbreath) + Dimbreath resonators
    // that have a downloaded nanoka character JSON.
    const charsToProcess = [...nanokaChars.filter(r => r.skillDamage?.length)];
    for (const r of dimbreathResonators) {
        const p = resolve(CHAR_DIR, `${r.id}.json`);
        if (!existsSync(p)) continue;
        try {
            const nChar = JSON.parse(readFileSync(p, 'utf8'));
            const proj  = projectNanokaCharacterFull(nChar, propDict);
            if (proj.skillDamage?.length) charsToProcess.push(proj);
            // Copy inherent skills onto the Dimbreath resonator object
            // so the build editor can display the passive toggles for all chars.
            if (proj.inherentSkills?.length) r.inherentSkills = proj.inherentSkills;
            if (proj.resonanceChain?.length) r.resonanceChain = proj.resonanceChain;
            if (proj.outroBuffs?.length)     r.outroBuffs     = proj.outroBuffs;
            if (proj.offFieldActions?.length) r.offFieldActions = proj.offFieldActions;
            if (proj.statNodeBonuses)        r.statNodeBonuses = proj.statNodeBonuses;
            if (proj.skillTreeBonuses?.length && !r.skillTreeBonuses?.length) {
                r.skillTreeBonuses = proj.skillTreeBonuses;
            }
        } catch { /* skip malformed JSON */ }
    }

    for (const r of charsToProcess) {
        if (!r.skillDamage?.length && !r.skillSupport?.length) continue;
        const rid = r.id;
        if (!damageTable[rid]) damageTable[rid] = [];
        if (!supportTable[rid]) supportTable[rid] = [];
        autoSkillMap[rid] = {};

        for (const row of r.skillDamage ?? []) {
            const synId = rid * 1e7 + row.nodeId * 1000 + row.paramId;

            damageTable[rid].push({
                id:          synId,
                mults:       row.mults.map(parseMult),
                element:     row.element,
                relatedProp: row.relatedPropId ?? 7,   // ATK(7), HP(2), DEF(10)
                name:        row.label,
            });

            if (autoSkillMap[rid][row.key]) {
                autoSkillMap[rid][row.key].damageIds.push(synId);
                continue;
            }

            const meta = r.skillMeta?.[row.key] ?? [];
            const buff = r.skillBuffs?.find(b => b.parentKey === row.key);

            autoSkillMap[rid][row.key] = {
                label:          row.label,
                skillType:      row.skillType,
                formulaType:    row.formulaType,
                isEchoSkill:    row.isEchoSkill ?? false,
                paletteInclude: row.paletteInclude,
                damageIds:      [synId],
                supportIds:     [],
                castTime:       CAST_TIMES[row.skillType] ?? 1.0,
                meta,
                ...(buff ? {
                    conditionalBuff: {
                        label:         buff.name,
                        perStackMults: buff.mults.map(parseMult),
                        defaultStacks: 0,
                    },
                } : {}),
                source: 'nanoka',
            };
        }

        // Attach support (heal/shield) rows to their autoSkillMap entries.
        // If the entry doesn't exist yet (skill-only healers like Shorekeeper
        // Liberation), create a stub entry so the step appears on the palette.
        for (const row of r.skillSupport ?? []) {
            const synId = rid * 1e7 + row.nodeId * 1000 + row.paramId + 0.5;  // offset avoids collision

            supportTable[rid].push({
                id:             synId,
                rowType:        row.rowType,       // 'heal' | 'shield'
                scalingStat:    row.scalingStat,   // 'hp' | 'atk' | 'def' | 'er' | 'tuneAmp'
                flatsByLevel:   row.flatsByLevel,
                ratiosByLevel:  row.ratiosByLevel,
                rawCoefsByLevel: row.rawCoefsByLevel,
                name:           row.label,
            });

            if (autoSkillMap[rid][row.key]) {
                autoSkillMap[rid][row.key].supportIds ??= [];
                autoSkillMap[rid][row.key].supportIds.push(synId);
            } else {
                // Stub for heal/shield-only skills (no damage rows)
                autoSkillMap[rid][row.key] = {
                    label:          row.label,
                    skillType:      row.skillType,
                    formulaType:    row.skillType,
                    isEchoSkill:    false,
                    paletteInclude: true,
                    damageIds:      [],
                    supportIds:     [synId],
                    castTime:       CAST_TIMES[row.skillType] ?? 1.0,
                    meta:           [],
                    source:         'nanoka',
                };
            }
        }
    }

    const nanokaSkillCount = Object.values(autoSkillMap)
        .reduce((n, m) => n + Object.keys(m).length, 0);
    process.stderr.write(`  autoSkillMap: ${nanokaSkillCount} steps across ${Object.keys(autoSkillMap).length} chars\n`);

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
            skillMapAuto:  Object.keys(autoSkillMap).length,
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
        supportTable,
        autoSkillMap,
    };

    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, JSON.stringify(out, null, 2) + '\n');
    process.stderr.write(`\nWrote ${args.out}\n`);
    for (const [k, v] of Object.entries(out.counts)) {
        process.stderr.write(`  ${k.padEnd(15)} ${v}\n`);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
