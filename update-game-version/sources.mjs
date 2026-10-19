// update-game-version/sources.mjs — where each half of a game version comes
// from, where it is staged, and where an install puts it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE, FILES, NANOKA_STATIC } from '../tools/preprocess/download.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const UPDATE_DIR = resolve(ROOT, 'update-game-version');
export const ARIKATSU_RAW = BASE;
export const NANOKA = NANOKA_STATIC;
export const USER_AGENT = 'WuWaSimPreprocess/1.0 (github.com/Philipp-DI/WuWaSim)';

export const stagingDir = (version) => resolve(UPDATE_DIR, 'staging', version);
export const reportsDir = (version) => resolve(UPDATE_DIR, 'reports', version);

// The ONE place the adopted version lives. preprocess.mjs reads `arikatsu` as
// its pinned ref; `nanoka` is the CDN version data/extracted-nanoka/ was
// fetched at, which can be spelled differently ("3.7.0" against branch "3.7").
export const GAME_VERSION_FILE = resolve(ROOT, 'data/game-version.json');

export function readGameVersion() {
    return JSON.parse(readFileSync(GAME_VERSION_FILE, 'utf8'));
}

export function writeGameVersion({ arikatsu, nanoka }) {
    const current = readGameVersion();
    writeFileSync(GAME_VERSION_FILE, `${JSON.stringify({ ...current, arikatsu, nanoka }, null, 2)}\n`);
}

// data/bindata/<name> ← Arikatsu path. The committed copies are the upstream
// bytes plus a trailing newline (measured against the 3.6 branch).
export const COMMITTED_BINDATA = {
    'baseproperty.json': 'BinData/property/baseproperty.json',
    'damage.json':       'BinData/damage/damage.json',
    'roleinfo.json':     'BinData/role/roleinfo.json',
    'skill.json':        'BinData/skill/skill.json',
};

// Every table preprocess downloads (English text map, its default) plus the
// committed BinData copies.
export const ARIKATSU_TABLES = [...new Set([
    ...Object.values(FILES).map(path => path.replace('{lang}', 'en')),
    ...Object.values(COMMITTED_BINDATA),
])].sort();

// nanoka type → its detail directory under data/extracted-nanoka/ (null: the
// index is all that is kept). Indexes live at ww/<version>/<type>.json with NO
// /en/; detail files at ww/<version>/en/<type>/<id>.json.
export const NANOKA_TYPES = { character: 'characters', weapon: 'weapons', echo: 'echoes', monster: null };

/**
 * The nanoka CDN version that stands for a game version: the exact string if
 * listed, else the one `<version>.<n>` build. Null when absent or ambiguous —
 * never `manifest.latest`, which runs ahead of `live`.
 */
export function nanokaVersionFor(available, version) {
    if (available.includes(version)) return version;
    const builds = available.filter(entry => entry.startsWith(`${version}.`));
    return builds.length === 1 ? builds[0] : null;
}

/** Machine-local settings (gitignored): { installPath, exportRoot }. */
export function loadLocal() {
    const path = resolve(UPDATE_DIR, 'local.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

/** `--name value` from argv, or null. */
export function flag(argv, name) {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] ?? null : null;
}

export async function fetchText(url) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.text();
}
