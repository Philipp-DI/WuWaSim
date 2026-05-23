/**
 * Build schema — pure, no DOM.
 *
 * A Build is the user's configuration of one resonator: level, weapon,
 * 5 echoes, sonata effects, skill levels, and any stat overrides.
 * Builds are the smallest persistable unit in the app.
 *
 * Shape (BUILD_VERSION = 1):
 *   {
 *     version: 1,
 *     id: 'b_<random>',            // local-only build id (not the resonator id)
 *     name: 'Carlotta C0R1',       // user-supplied label, optional
 *     createdAt: ISO string,
 *     updatedAt: ISO string,
 *
 *     resonatorId: 1107,           // -> dataset.resonators[].id
 *     level: 90,
 *     chain: 0,                    // resonance chain (0..6), aka "sequence"
 *     skillLevels: { basic:10, heavy:10, skill:10, liberation:10, intro:10 },
 *
 *     weapon: {
 *       id: 21050026,              // -> dataset.weapons[].id
 *       level: 90,
 *       rank: 1,                   // refinement / "tuning" (1..5)
 *     } | null,
 *
 *     echoes: [Echo | null] (length 5),
 *
 *     // Optional manual override of derived total stats. Computed stats
 *     // win unless the user clicks "lock" on a row. Keys are PropertyIndex
 *     // ids. Phase 3 will populate this on edit; for Phase 2 it's empty.
 *     statOverrides: {},
 *   }
 *
 *   Echo = {
 *     id: 60000222,                // -> dataset.echoes[].id (family-level)
 *     cost: 4 | 3 | 1,
 *     level: 25,
 *     mainStat: { propId, addType, value },
 *     subStats: [{ propId, addType, value }, ...],   // up to 5
 *     sonataId: 3,                 // active sonata for this slot
 *   }
 */

export const BUILD_VERSION = 1;
export const ECHO_SLOTS = 5;

// Skill keys are the categories the UI exposes to the user. The simulator
// will map these onto the game's actual skill ids in Phase 5.
export const SKILL_KEYS = ['basic', 'heavy', 'skill', 'liberation', 'intro'];

export const SKILL_LABELS = {
    basic:      'Basic Attack',
    heavy:      'Heavy Attack',
    skill:      'Resonance Skill',
    liberation: 'Resonance Liberation',
    intro:      'Intro Skill',
};

const DEFAULT_SKILL_LEVELS = Object.fromEntries(SKILL_KEYS.map(k => [k, 1]));

// Cheap, collision-resistant id for client-side use. crypto.randomUUID is
// universal in modern browsers and Node 19+; the fallback is for very old
// browsers reached via static hosting.
function nextId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return 'b_' + crypto.randomUUID().slice(0, 8);
    }
    return 'b_' + Math.random().toString(36).slice(2, 10);
}

/**
 * Construct a fresh build for the given resonator at sensible defaults.
 * @param {object} resonator - dataset entry
 */
export function createBuild(resonator) {
    if (!resonator || resonator.id == null) {
        throw new Error('createBuild: resonator with id required');
    }
    const now = new Date().toISOString();
    return {
        version: BUILD_VERSION,
        id: nextId(),
        name: resonator.name,
        createdAt: now,
        updatedAt: now,

        resonatorId: resonator.id,
        level: resonator.maxLevel ?? 90,
        chain: 0,
        skillLevels: { ...DEFAULT_SKILL_LEVELS },

        weapon: null,
        echoes: Array.from({ length: ECHO_SLOTS }, () => null),
        statOverrides: {},
    };
}

/**
 * Coerce a possibly-foreign (older schema / hand-edited / Inventory Kamera
 * imported) object into a valid current-schema build. Missing fields are
 * filled with defaults. Returns a new object — never mutates input.
 *
 * Throws only if essential identity is missing (no resonatorId).
 */
export function normalizeBuild(input, { dataset } = {}) {
    if (!input || typeof input !== 'object') {
        throw new Error('normalizeBuild: object required');
    }
    if (input.resonatorId == null) {
        throw new Error('normalizeBuild: resonatorId required');
    }

    const resonator = dataset?.resonators?.find(r => r.id === input.resonatorId);
    const now = new Date().toISOString();

    const skillLevels = { ...DEFAULT_SKILL_LEVELS };
    for (const k of SKILL_KEYS) {
        const v = input.skillLevels?.[k];
        if (typeof v === 'number' && v >= 1 && v <= 10) skillLevels[k] = v;
    }

    const echoes = Array.from({ length: ECHO_SLOTS }, (_, i) => {
        const e = input.echoes?.[i];
        if (!e || e.id == null) return null;
        return {
            id: e.id,
            cost: clampCost(e.cost),
            level: clampInt(e.level, 0, 25, 0),
            mainStat: e.mainStat ?? null,
            subStats: Array.isArray(e.subStats) ? e.subStats.slice(0, 5) : [],
            sonataId: e.sonataId ?? null,
        };
    });

    return {
        version: BUILD_VERSION,
        id: input.id || nextId(),
        name: input.name || resonator?.name || `Build ${input.resonatorId}`,
        createdAt: input.createdAt || now,
        updatedAt: now,

        resonatorId: input.resonatorId,
        level: clampInt(input.level, 1, resonator?.maxLevel ?? 90, resonator?.maxLevel ?? 90),
        chain: clampInt(input.chain, 0, 6, 0),
        skillLevels,

        weapon: input.weapon && input.weapon.id != null ? {
            id: input.weapon.id,
            level: clampInt(input.weapon.level, 1, 90, 90),
            rank:  clampInt(input.weapon.rank,  1, 5,  1),
        } : null,

        echoes,
        statOverrides: input.statOverrides && typeof input.statOverrides === 'object'
            ? { ...input.statOverrides } : {},
    };
}

function clampInt(value, min, max, fallback) {
    const n = Number.isFinite(value) ? Math.trunc(value) : fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}
function clampCost(v) {
    return v === 4 || v === 3 || v === 1 ? v : 0;
}

// =============================================================================
// Mutation helpers — kept here so the UI never reaches inside the object.
// All return a NEW build, never mutate. Callers do: state.build = setLevel(...).
// =============================================================================

function touch(build) {
    return { ...build, updatedAt: new Date().toISOString() };
}

export function setLevel(build, level) {
    return touch({ ...build, level: clampInt(level, 1, 90, build.level) });
}

export function setChain(build, chain) {
    return touch({ ...build, chain: clampInt(chain, 0, 6, build.chain) });
}

export function setSkillLevel(build, key, level) {
    if (!SKILL_KEYS.includes(key)) return build;
    return touch({
        ...build,
        skillLevels: { ...build.skillLevels, [key]: clampInt(level, 1, 10, 1) },
    });
}

export function setWeapon(build, weaponId) {
    if (weaponId == null) return touch({ ...build, weapon: null });
    return touch({
        ...build,
        weapon: { id: weaponId, level: build.weapon?.level ?? 90, rank: build.weapon?.rank ?? 1 },
    });
}

export function setWeaponLevel(build, level) {
    if (!build.weapon) return build;
    return touch({
        ...build,
        weapon: { ...build.weapon, level: clampInt(level, 1, 90, build.weapon.level) },
    });
}

export function setWeaponRank(build, rank) {
    if (!build.weapon) return build;
    return touch({
        ...build,
        weapon: { ...build.weapon, rank: clampInt(rank, 1, 5, build.weapon.rank) },
    });
}

export function setEcho(build, slotIndex, echo) {
    if (slotIndex < 0 || slotIndex >= ECHO_SLOTS) return build;
    const next = [...build.echoes];
    next[slotIndex] = echo;
    return touch({ ...build, echoes: next });
}

export function setName(build, name) {
    return touch({ ...build, name: (name || '').trim() || build.name });
}

// Test hooks.
export const __test__ = { clampInt, clampCost, nextId };
