// tools/preprocess/download.mjs — source download, nanoka raw-data loading, icon-URL resolution.
// Split from the monolithic preprocess.mjs (Simplification Plan S4.1);
// bodies moved verbatim — LOCK A (byte-identical wuwa-data.json) verifies.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Arikatsu/WutheringWaves_Data supersedes Dimbreath/WutheringData, which lags a
// full game version behind (its ConfigDB/Damage carried 7,979 of Arikatsu's
// 9,697 rows, and 28 of 34 sonata sets — the missing rows ARE current content).
// Arikatsu tags every game version as its own branch and points the repo default
// branch at the live one, so we resolve the ref at run time — no manual per-patch
// bump. FALLBACK_REF is used only when the API is unreachable/rate-limited.
export const REPO = 'Arikatsu/WutheringWaves_Data';
export const BASE = `https://raw.githubusercontent.com/${REPO}`;
const FALLBACK_REF = '3.5';

export const NANOKA_STATIC = 'https://static.nanoka.cc';

// Dimbreath lang code → Arikatsu Textmaps directory (only textMap is localized).
const LANG_DIR = {
    en: 'en', zh: 'zh-Hans', 'zh-Hans': 'zh-Hans', 'zh-Hant': 'zh-Hant',
    ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', es: 'es', pt: 'pt', ru: 'ru',
    id: 'id', th: 'th', vi: 'vi',
};

// Source files under BASE/<ref>/. All fetched in parallel, held in memory during
// the pass. Arikatsu's raw BinData dumps; schemas match every field the
// projections read (feasibility-verified — the only Dimbreath fields Arikatsu
// omits, RoleInfo.SkillDapath* and SkillTree.UnlockCondition, are unused).
export const FILES = {
    roleInfo:             'BinData/role/roleinfo.json',
    elementInfo:          'BinData/element_info/elementinfo.json',
    weaponConf:           'BinData/weapon/weaponconf.json',
    phantomItem:          'BinData/phantom/phantomitem.json',
    phantomFetter:        'BinData/phantom/phantomfettergroup.json',
    phantomFetterEffects: 'BinData/phantom/phantomfetter.json',
    phantomMain:          'BinData/phantom/phantommainpropitem.json',
    phantomGrowth:        'BinData/phantom/phantomgrowth.json',
    phantomSub:           'BinData/phantom/phantomsubproperty.json',
    propertyIndex:        'BinData/property/propertyindex.json',
    baseProperty:         'BinData/property/baseproperty.json',
    roleGrowth:           'BinData/property/rolepropertygrowth.json',
    weaponGrowth:         'BinData/property/weaponpropertygrowth.json',
    skillTree:            'BinData/skillTree/skilltree.json',
    damage:               'BinData/damage/damage.json',
    textMap:              'Textmaps/{lang}/multi_text/MultiText.json',
};

export async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return res.json();
}

// Current version branch = Arikatsu's repo default. One API call per pass; falls
// back to the pinned ref when the API is unavailable.
export async function resolveRef() {
    try {
        const meta = await (await fetch(`https://api.github.com/repos/${REPO}`,
            { headers: { 'User-Agent': 'WuWaSimPreprocess/1.0 (github.com/Philipp-DI/WuWaSim)' } })).json();
        return meta?.default_branch || FALLBACK_REF;
    } catch {
        return FALLBACK_REF;
    }
}

// Arikatsu's MultiText is a LIST of { Id, Content, RedirectDbIndex } records
// (index-keyed), unlike Dimbreath's flat { Id: text } map that makeTextResolver
// expects — flatten it so every downstream projection stays unchanged. All
// RedirectDbIndex=1 rows carry their own Content (no cross-shard follow needed;
// verified during the Dimbreath→Arikatsu feasibility check).
function flattenTextMap(raw) {
    const flat = {};
    for (const row of Object.values(raw)) {
        if (row && row.Id != null) flat[row.Id] = row.Content ?? '';
    }
    return flat;
}

export async function downloadAll(lang, pinnedRef = null) {
    const ref = pinnedRef ?? await resolveRef();
    const langDir = LANG_DIR[lang] ?? lang;
    process.stderr.write(`  source: ${REPO}@${ref} (textmap lang dir: ${langDir})\n`);
    const tasks = Object.entries(FILES).map(async ([key, path]) => {
        const relPath = path.replace('{lang}', langDir);
        process.stderr.write(`  fetching ${relPath}\n`);
        const data = await fetchJson(`${BASE}/${ref}/${relPath}`);
        return [key, key === 'textMap' ? flattenTextMap(data) : data];
    });
    return Object.fromEntries(await Promise.all(tasks));
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

export function loadNanokaData() {
    const dir = resolve(__dirname, '../../data/extracted-nanoka');
    function tryLoad(file) {
        const path = resolve(dir, file);
        if (!existsSync(path)) return {};
        try { return JSON.parse(readFileSync(path, 'utf8')); }
        catch { return {}; }
    }
    return {
        characters: tryLoad('character.json'),    // id → { en, icon, background, element, weapon, rank, ... }
        weapons:    tryLoad('weapon.json'),       // id → { en, icon, rank, type, atk, sub, ... }
        echoes:     tryLoad('echo.json'),         // monsterId → { en, icon, code, rank, group, ... }
        monsters:   tryLoad('monster.json'),      // monsterId → { ... }
    };
}

// Convert a Nanoka Unreal Engine asset path to a live static.nanoka.cc webp URL.
// e.g. "/Game/Aki/UI/UIResources/Common/Image/IconRolePile/T_Foo_UI.T_Foo_UI"
//   → "https://static.nanoka.cc/assets/ww/UIResources/Common/Image/IconRolePile/T_Foo_UI.webp"
export function nanokaAssetUrl(rawPath) {
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

export let _nanoka = null;   // loaded lazily once, shared across all calls

export function iconUrlFor(name, id, kind = 'resonators') {
    // Lazy-load nanoka data on first call
    if (!_nanoka) _nanoka = loadNanokaData();

    // ── 1. Local file (committed to repo, served from GitHub Pages CDN) ──────
    // Check both .png (download-icons.mjs output) and .webp (manually placed).
    for (const ext of ['png', 'webp']) {
        if (existsSync(new URL(`../../assets/icons/${kind}/${id}.${ext}`, import.meta.url))) {
            return `./assets/icons/${kind}/${id}.${ext}`;
        }
    }
    // Rover: all three element variants share a single manually-placed icon.
    if (kind === 'resonators' && name.startsWith('Rover')) {
        if (existsSync(new URL(`../../assets/icons/resonators/Rover.webp`, import.meta.url))) {
            return './assets/icons/resonators/Rover.webp';
        }
        if (existsSync(new URL(`../../assets/icons/resonators/Rover.png`, import.meta.url))) {
            return './assets/icons/resonators/Rover.png';
        }
    }

    // ── 2. nanoka CDN webp ────────────────────────────────────────────────────
    let rawPath = null;
    if (kind === 'resonators') {
        const character = _nanoka.characters[String(id)];
        // Use "icon" (IconRoleHead — the portrait bust), not "background" (IconRolePile card art)
        rawPath = character?.icon ?? null;
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
    const slug = encodeURIComponent(name.replace(/\s+/g, '_'));
    const prefix = kind === 'resonators' ? 'Resonator_'
                 : kind === 'weapons'    ? 'Weapon_'
                 : 'Echo_';
    return `https://wutheringwaves.fandom.com/wiki/Special:Filepath/${prefix}${slug}.png`;
}
