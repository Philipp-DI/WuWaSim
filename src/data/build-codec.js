// src/data/build-codec.js
/**
 * Build URL codec.
 *
 * Encodes a Build into a URL-safe string and decodes it back. Designed
 * to keep the encoded form short enough to live in a URL hash and
 * survive copy-paste.
 *
 *   encodeBuild(build) -> 'v1.<base64url>'
 *   decodeBuild(str, dataset) -> Build | null
 *
 * Versioned envelope (`v1.<payload>`) so future codec changes don't
 * silently break shared links.
 *
 * Format (v1, JSON inside base64url):
 *   {
 *     r: resonatorId,
 *     lv: level,
 *     ch: chain,
 *     sk: [basic, heavy, skill, liberation, intro],   // 5 ints
 *     w:  [id, level, rank] | null,
 *     ec: [echoEntry x5],                              // entries can be null
 *     ro: [skillKey, ...]
 *   }
 *
 * Echo entry shape (array form keeps it compact):
 *   [ id, cost, level, sonataId,
 *     mainStat | null,
 *     [subStat, ...] ]
 *
 * Stat shape inside echo: [propId, addType, value].
 *
 * Names are NOT serialized — they're resolved from the dataset at
 * decode time. This keeps shared URLs short and means renames in
 * upstream data don't break old links.
 */

import { normalizeBuild } from '../core/build.js';

const CODEC_VERSION = 'v1';

// =============================================================================
// Public API
// =============================================================================

/**
 * Encode a build to a URL-safe string. Returns null if the build is
 * malformed (resonator id missing).
 */
export function encodeBuild(build) {
    if (!build || build.resonatorId == null) return null;
    const packed = {
        r: build.resonatorId,
        lv: build.level,
        ch: build.chain ?? 0,
        sk: [
            build.skillLevels?.basic ?? 1,
            build.skillLevels?.heavy ?? 1,
            build.skillLevels?.skill ?? 1,
            build.skillLevels?.liberation ?? 1,
            build.skillLevels?.intro ?? 1,
        ],
        w: build.weapon ? [build.weapon.id, build.weapon.level, build.weapon.rank] : null,
        ec: (build.echoes ?? []).map(packEcho),
        ro: Array.isArray(build.rotation) ? build.rotation.slice() : [],
    };
    return `${CODEC_VERSION}.${base64urlEncode(JSON.stringify(packed))}`;
}

/**
 * Decode a string back to a Build. Returns null on any parse error
 * (lets callers fall back to a default build without exception flow).
 * Names are looked up via the dataset and used to repopulate stat
 * entries.
 */
export function decodeBuild(str, dataset) {
    if (typeof str !== 'string' || !str.startsWith(`${CODEC_VERSION}.`)) return null;
    let packed;
    try {
        packed = JSON.parse(base64urlDecode(str.slice(CODEC_VERSION.length + 1)));
    } catch {
        return null;
    }
    if (!packed || packed.r == null) return null;

    const skillLevels = {
        basic: packed.sk?.[0] ?? 1,
        heavy: packed.sk?.[1] ?? 1,
        skill: packed.sk?.[2] ?? 1,
        liberation: packed.sk?.[3] ?? 1,
        intro: packed.sk?.[4] ?? 1,
    };

    const echoes = (packed.ec ?? []).map(echo => unpackEcho(echo, dataset));

    const build = {
        resonatorId: packed.r,
        level: packed.lv,
        chain: packed.ch ?? 0,
        skillLevels,
        weapon: packed.w ? { id: packed.w[0], level: packed.w[1], rank: packed.w[2] } : null,
        echoes,
        rotation: Array.isArray(packed.ro) ? packed.ro.slice() : [],
    };
    // Run through the normalizer so we get a valid, current-version
    // Build object regardless of what we serialized.
    return normalizeBuild(build, { dataset });
}

// =============================================================================
// Echo packing — keep stat entries compact
// =============================================================================

function packEcho(echo) {
    if (!echo || echo.id == null) return null;
    return [
        echo.id,
        echo.cost ?? 0,
        echo.level ?? 25,
        echo.sonataId ?? null,
        echo.mainStat ? packStat(echo.mainStat) : null,
        (echo.subStats ?? []).map(packStat),
    ];
}
function packStat(stat) {
    if (!stat) return null;
    return [stat.propId, stat.addType, stat.value];
}

// Flatten the cost-keyed echoMainStats map into a single array for
// name/isPercent lookup during decode (cost isn't stored in the codec).
function allMainStats(dataset) {
    const map = dataset.echoMainStats ?? {};
    return Object.values(map).flat();
}

function unpackEcho(entry, dataset) {
    if (!entry) return null;
    const [id, cost, level, sonataId, mainArr, subArr] = entry;
    if (id == null) return null;
    return {
        id,
        cost: cost ?? 0,
        level: level ?? 25,
        sonataId: sonataId ?? null,
        mainStat: mainArr ? unpackStat(mainArr, allMainStats(dataset)) : null,
        subStats: Array.isArray(subArr)
            ? subArr.map(stat => unpackStat(stat, dataset.echoSubStats)).filter(Boolean)
            : [],
    };
}
function unpackStat(packed, pool) {
    if (!packed) return null;
    const [propId, addType, value] = packed;
    // Find the matching dataset entry to get the canonical `name` +
    // `isPercent` flag. If not found, fall back to a minimal stat —
    // engine still works, UI labels just show empty.
    const opt = pool.find(candidate => candidate.propId === propId && candidate.addType === addType);
    return {
        propId, addType, value,
        name: opt?.name ?? '',
        isPercent: opt?.isPercent ?? false,
    };
}

// =============================================================================
// base64url (URL-safe, no padding)
// =============================================================================

function base64urlEncode(text) {
    // btoa handles latin-1; we want UTF-8 first
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const byte of bytes) bin += String.fromCharCode(byte);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (b64.length % 4)) % 4;
    const bin = atob(b64 + '='.repeat(pad));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

export const __test__ = { base64urlEncode, base64urlDecode };