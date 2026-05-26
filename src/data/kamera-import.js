// src/data/kamera-import.js
/**
 * Inventory Kamera (IK) import.
 *
 * Parses one or more JSON files exported by Psycho-Marcus's
 * WuWa_Inventory_Kamera tool and converts them into the internal
 * Build schema (see src/core/build.js).
 *
 * IK exports up to four files; we accept any subset, with characters
 * being the only required one for build construction:
 *
 *   characters_wuwainventorykamera.json   (required: builds the resonator)
 *   echoes_wuwainventorykamera.json       (optional: maps to character via sonata + slot heuristic)
 *   weapons_wuwainventorykamera.json      (ignored: extra unequipped weapons)
 *   achievements_wuwainventorykamera.json (ignored)
 *
 * **Echo placement** — IK exports echoes as a flat list with no
 * equipped-to-character field. Live equips ARE inside the characters
 * file (some versions), but not always. For now, the importer:
 *   1. Imports each character (level, chain, weapon, skill levels) from
 *      the characters file
 *   2. Imports the echo list as a separate pool; echoes can be assigned
 *      to builds via the editor in Phase 4+ (or auto-fitted by sonata
 *      and element in a future pass).
 *
 * Public API:
 *   - parseKameraFiles(filesByName) -> ParseResult
 *   - applyImport(parseResult, dataset, storage) -> SummaryReport
 *
 * filesByName: { 'characters_wuwainventorykamera.json': <File or string>, ... }
 * Returns warnings rather than throwing on partial / malformed data.
 */

import { normalizeBuild, ECHO_SLOTS } from '../core/build.js';

// =============================================================================
// File detection — IK names files predictably, but users may rename them.
// =============================================================================

const FILE_PATTERNS = {
    characters: /characters?_?(wuwainventorykamera)?\.json$/i,
    echoes: /echoes?_?(wuwainventorykamera)?\.json$/i,
    weapons: /weapons?_?(wuwainventorykamera)?\.json$/i,
    achievements: /achievements?_?(wuwainventorykamera)?\.json$/i,
};

/**
 * Sort an array of File-like objects (each has `name` and `text()`) into
 * the four known categories. Returns { characters, echoes, weapons,
 * achievements, unknown: [] }.
 */
export function classifyFiles(files) {
    const out = { characters: null, echoes: null, weapons: null, achievements: null, unknown: [] };
    for (const f of files) {
        let placed = false;
        for (const [kind, pattern] of Object.entries(FILE_PATTERNS)) {
            if (pattern.test(f.name)) {
                out[kind] = f;
                placed = true;
                break;
            }
        }
        if (!placed) out.unknown.push(f);
    }
    return out;
}

// =============================================================================
// Sonata name lookup — IK exports lowercase no-space sonata names
// =============================================================================

/**
 * Build a lookup { lowercasename → sonataId } from the dataset.
 * Sonata names in IK look like "freezingfrost" / "moltenrift".
 */
function buildSonataLookup(dataset) {
    const map = new Map();
    for (const s of dataset.sonatas || []) {
        const key = (s.name || '').toLowerCase().replace(/\s+/g, '');
        if (key) map.set(key, s.id);
    }
    return map;
}

// =============================================================================
// Echo stat name lookup — IK exports stat names like "ATK%", "Crit DMG%"
// =============================================================================

/**
 * Build a lookup { lowercased name → {propId, addType} } from the
 * dataset's echo main + sub stat dictionaries. Used by the echo parser
 * to convert {"ATK%": 8.6} into a structured stat entry.
 *
 * The IK convention appends "%" for percent stats and leaves flat
 * stats as plain numbers. We match against the dataset's own display
 * names so we don't carry a duplicate stat dictionary.
 */
function buildStatLookup(dataset) {
    const map = new Map();
    const add = (opt) => {
        if (!opt) return;
        const key = normalizeStatName(opt.name);
        if (!map.has(key)) map.set(key, opt);
        // IK appends "%" to inherent-percent stats even though the
        // dataset name doesn't. Register the keyed-with-% variant too
        // so "Crit Rate%" finds the "Crit. Rate" entry.
        if (opt.isPercent && !key.endsWith('%')) {
            const pctKey = key + '%';
            if (!map.has(pctKey)) map.set(pctKey, opt);
        }
    };
    for (const m of Object.values(dataset.echoMainStats ?? {}).flat()) add(m);
    for (const s of dataset.echoSubStats || []) add(s);
    return map;
}

// Strip punctuation + whitespace before comparison so the dataset's
// "Crit. Rate%" matches IK's "Crit Rate%" (no period). Also handles
// future skews like "Crit-Rate%" or "CritRate%". The trailing % is
// preserved because it's semantically meaningful in IK's encoding.
function normalizeStatName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9%]+/g, '');
}

// =============================================================================
// Skill key mapping: IK → our internal keys
// =============================================================================

// IK uses {normal, resonance, forte, liberation, intro}; we use
// {basic, heavy, skill, liberation, intro}. We map normal→basic,
// resonance→skill, forte→heavy (Forte Circuit = enhanced heavy attack
// in WuWa terminology). Liberation and intro line up directly.
const SKILL_KEY_MAP = Object.freeze({
    normal: 'basic',
    resonance: 'skill',
    forte: 'heavy',
    liberation: 'liberation',
    intro: 'intro',
});

// =============================================================================
// Core parsers — each takes raw JSON, returns a structured result + warnings
// =============================================================================

function parseCharacters(raw, dataset, warn) {
    if (!raw || typeof raw !== 'object') {
        warn('characters file is not a JSON object');
        return [];
    }
    const builds = [];
    for (const [resoIdRaw, c] of Object.entries(raw)) {
        const resonatorId = Number(resoIdRaw);
        if (!Number.isFinite(resonatorId)) {
            warn(`Skipping non-numeric resonator key "${resoIdRaw}"`);
            continue;
        }
        const resonator = dataset.resonators.find(r => r.id === resonatorId);
        if (!resonator) {
            warn(`Unknown resonator id ${resonatorId} — skipping`);
            continue;
        }

        // Skill levels: translate IK keys to ours
        const skillLevels = {};
        for (const [ikKey, ourKey] of Object.entries(SKILL_KEY_MAP)) {
            const v = c.skills?.[ikKey];
            skillLevels[ourKey] = clampSkill(v);
        }

        // Weapon
        let weapon = null;
        if (c.weapon && c.weapon.id) {
            const w = dataset.weapons.find(x => x.id === Number(c.weapon.id));
            if (w) {
                weapon = {
                    id: w.id,
                    level: clampWeaponLevel(c.weapon.level),
                    rank: clampWeaponRank(c.weapon.rank),
                };
            } else {
                warn(`Resonator ${resonator.name}: unknown weapon id ${c.weapon.id} — leaving slot empty`);
            }
        }

        // Build object — echoes left empty here; populated by parseEchoes pass.
        const build = normalizeBuild({
            resonatorId,
            name: `${resonator.name} (imported)`,
            level: clampLevel(c.level, resonator.maxLevel ?? 90),
            chain: clampChain(c.chain),
            skillLevels,
            weapon,
            echoes: Array.from({ length: ECHO_SLOTS }, () => null),
        }, { dataset });

        builds.push(build);
    }
    return builds;
}

function parseEchoes(raw, dataset, warn) {
    if (!Array.isArray(raw)) {
        warn('echoes file is not a JSON array');
        return [];
    }

    const sonataLookup = buildSonataLookup(dataset);
    const statLookup = buildStatLookup(dataset);
    const out = [];

    for (let i = 0; i < raw.length; i++) {
        const entry = raw[i];
        if (!entry || typeof entry !== 'object') {
            warn(`Echo at index ${i} is not an object`);
            continue;
        }
        // Each echo is wrapped as { "<echoId>": {...} }
        const keys = Object.keys(entry);
        if (keys.length === 0) continue;
        const echoIdRaw = keys[0];
        const data = entry[echoIdRaw];
        const echoId = Number(echoIdRaw);
        if (!Number.isFinite(echoId)) {
            warn(`Echo at index ${i}: id "${echoIdRaw}" is not numeric — skipping`);
            continue;
        }
        const echoDef = dataset.echoes.find(e => e.id === echoId);
        if (!echoDef) {
            warn(`Echo at index ${i}: unknown echo id ${echoId} — skipping`);
            continue;
        }

        const sonataId = sonataLookup.get(String(data.sonata || '').toLowerCase()) ?? null;
        const { mainStat, subStats } = parseStats(data.stats, statLookup, warn, i);

        out.push({
            id: echoId,
            cost: echoDef.cost,
            level: clampInt(data.level, 0, 25, 0),
            tuneLv: clampInt(data.tuneLv, 0, 5, 0),
            mainStat,
            subStats,
            sonataId,
            // Soft metadata kept for echo-fitting heuristics later:
            _meta: {
                rarity: data.rarity ?? null,
                elements: echoDef.elementTypes,
            },
        });
    }
    return out;
}

function parseStats(stats, statLookup, warn, echoIndex) {
    const mainPair = stats?.main && Object.entries(stats.main)[0];
    const main = mainPair ? toStatEntry(mainPair, statLookup, warn, `echo ${echoIndex} main`) : null;

    const subEntries = stats?.sub ? Object.entries(stats.sub) : [];
    const subs = subEntries
        .map((p, i) => toStatEntry(p, statLookup, warn, `echo ${echoIndex} sub ${i}`))
        .filter(Boolean);

    return { mainStat: main, subStats: subs };
}

function toStatEntry([nameWithPct, value], statLookup, warn, ctx) {
    const lookup = statLookup.get(normalizeStatName(nameWithPct));
    if (!lookup) {
        warn(`${ctx}: unknown stat "${nameWithPct}" — dropped`);
        return null;
    }
    return {
        propId: lookup.propId,
        addType: lookup.addType,
        name: lookup.name,
        isPercent: lookup.isPercent,
        value: Number(value) || 0,
    };
}

// =============================================================================
// Clamps — kept tiny and inline so they don't drift from build.js
// =============================================================================

function clampInt(value, min, max, fallback) {
    const n = Number.isFinite(value) ? Math.trunc(value) : fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}
function clampLevel(v, maxLevel) { return clampInt(v, 1, maxLevel, maxLevel); }
function clampChain(v) { return clampInt(v, 0, 6, 0); }
function clampSkill(v) { return clampInt(v, 1, 10, 1); }
function clampWeaponLevel(v) { return clampInt(v, 1, 90, 90); }
function clampWeaponRank(v) { return clampInt(v, 1, 5, 1); }

// =============================================================================
// Public: parseKameraFiles
// =============================================================================

/**
 * Parse a set of IK files. Returns:
 *   {
 *     builds:   Build[] (newly created, not yet persisted),
 *     echoes:   ParsedEcho[],
 *     warnings: string[],
 *     summary:  { characters, echoes, weaponsIgnored, warnings },
 *   }
 *
 * @param {{ characters?: File|string, echoes?: File|string }} filesByKind
 * @param {object} dataset - loaded by src/data/loader.js
 */
export async function parseKameraFiles(filesByKind, dataset) {
    const warnings = [];
    const warn = (m) => warnings.push(m);

    const charactersRaw = await readJson(filesByKind.characters, warn, 'characters');
    const echoesRaw = await readJson(filesByKind.echoes, warn, 'echoes');

    const builds = charactersRaw ? parseCharacters(charactersRaw, dataset, warn) : [];
    const echoes = echoesRaw ? parseEchoes(echoesRaw, dataset, warn) : [];

    return {
        builds,
        echoes,
        warnings,
        summary: {
            characters: builds.length,
            echoes: echoes.length,
            warnings: warnings.length,
        },
    };
}

async function readJson(source, warn, label) {
    if (!source) return null;
    let text;
    try {
        if (typeof source === 'string') text = source;
        else if (typeof source.text === 'function') text = await source.text();
        else { warn(`${label} file: unsupported source type`); return null; }
    } catch (err) {
        warn(`${label} file: failed to read (${err.message})`);
        return null;
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        warn(`${label} file: invalid JSON (${err.message})`);
        return null;
    }
}

// =============================================================================
// Public: applyImport — write builds to storage
// =============================================================================

/**
 * Persist imported builds via the provided storage module.
 * Existing builds (matched by resonatorId + import marker) are
 * REPLACED to avoid duplicates on re-import.
 *
 * @returns {{ created: number, replaced: number, skipped: number }}
 */
export function applyImport(parseResult, dataset, storage) {
    const existing = storage.listBuilds({ dataset });
    let created = 0, replaced = 0;

    for (const b of parseResult.builds) {
        const dup = existing.find(x => x.resonatorId === b.resonatorId && /\(imported\)/.test(x.name));
        if (dup) {
            // Reuse the duplicate's id so we overwrite in place.
            const merged = { ...b, id: dup.id, createdAt: dup.createdAt };
            storage.saveBuild(merged, { dataset });
            replaced++;
        } else {
            storage.saveBuild(b, { dataset });
            created++;
        }
    }
    return { created, replaced, skipped: 0 };
}

// Test hooks
export const __test__ = { parseCharacters, parseEchoes, buildSonataLookup, buildStatLookup, classifyFiles, SKILL_KEY_MAP };