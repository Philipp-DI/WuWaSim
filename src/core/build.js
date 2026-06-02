/**
 * Build schema — pure, no DOM.
 *
 * A Build is the user's configuration of one resonator: level, weapon,
 * 5 echoes, sonata effects, skill levels, any stat overrides, and an
 * optional rotation (ordered sequence of skill casts).
 *
 * Shape (BUILD_VERSION = 2):
 *   {
 *     version: 2,
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
 *     // Ordered list of skill keys (referring to dataset.skillMap[resonatorId])
 *     // representing the player's combat rotation. Empty by default.
 *     // The simulator (src/core/sim.js) consumes this with the rotation
 *     // settings to produce DPS/total damage.
 *     rotation: ['skill', 'basic_3', 'forte_heavy', ...],
 *
 *     // Optional manual override of derived total stats. Computed stats
 *     // win unless the user clicks "lock" on a row. Keys are PropertyIndex
 *     // ids. Reserved; not yet used by the UI.
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
 *
 * normalizeBuild() migrates v1 builds in place by adding an empty
 * rotation array. No localStorage changes required.
 */

export const BUILD_VERSION = 2;
export const ECHO_SLOTS = 5;

// Skill keys are the categories the UI exposes to the user. The simulator
// Skill keys match the in-game skill tree order exactly.
// 'normal' covers Normal Attack (basic stages, heavy, mid-air, plunge).
// 'forte'  covers Forte Circuit — its own upgradeable node separate from Normal Attack.
export const SKILL_KEYS = ['normal', 'skill', 'forte', 'liberation', 'intro'];

export const SKILL_LABELS = {
    normal: 'Normal Attack',
    skill: 'Resonance Skill',
    forte: 'Forte Circuit',
    liberation: 'Resonance Liberation',
    intro: 'Intro Skill',
};

const DEFAULT_SKILL_LEVELS = Object.fromEntries(SKILL_KEYS.map(k => [k, 10]));

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
        // Inherent skill nodes — both active by default (always unlocked at max level)
        inherentSkillsActive: [true, true],
        // Passive stat nodes — [tier1Active, tier2Active] per skill column
        statNodesActive: { normal: [true, true], skill: [true, true], liberation: [true, true], intro: [true, true] },

        weapon: null,
        echoes: Array.from({ length: ECHO_SLOTS }, () => null),
        rotation: [],
        statOverrides: {},
        // Toggles for conditional chain/inherent effects, keyed "S{lvl}.{i}" / "IH{n}.{i}".
        // Absent key → use the effect's defaultActive. Present → explicit override.
        effectToggles: {},
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

        // Always re-derive cost and starLevel from the dataset when available.
        const echoDef = dataset?.echoes?.find(d => d.id === e.id);

        // If the echo id doesn't resolve in the current dataset (e.g. a build
        // saved before the v8 echo-id scheme change from ItemId → monsterId),
        // drop the slot rather than carrying a broken reference. The user can
        // re-pick the echo; everything else in the build is preserved.
        if (dataset?.echoes && !echoDef) return null;

        const cost = echoDef?.cost ?? clampCost(e.cost);
        const starLevel = echoDef?.starLevel ?? (e.starLevel ?? 5);

        return {
            id: e.id,
            cost,
            level: snapEchoLevel(e.level ?? 25),
            starLevel,
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
        inherentSkillsActive: Array.isArray(input.inherentSkillsActive)
            ? [input.inherentSkillsActive[0] !== false, input.inherentSkillsActive[1] !== false]
            : [true, true],
        statNodesActive: (() => {
            const def = { normal: [true, true], skill: [true, true], liberation: [true, true], intro: [true, true] };
            const src = input.statNodesActive;
            if (!src || typeof src !== 'object') return def;
            for (const col of ['normal', 'skill', 'liberation', 'intro']) {
                if (Array.isArray(src[col])) {
                    def[col] = [src[col][0] !== false, src[col][1] !== false];
                }
            }
            return def;
        })(),

        weapon: input.weapon && input.weapon.id != null ? {
            id: input.weapon.id,
            level: clampInt(input.weapon.level, 1, 90, 90),
            rank: clampInt(input.weapon.rank, 1, 5, 1),
        } : null,

        echoes,
        // v1 → v2: rotation didn't exist; default to empty array.
        // Strings only (skill keys reference dataset.skillMap entries);
        // we drop anything that isn't a non-empty string.
        rotation: Array.isArray(input.rotation)
            ? input.rotation.filter(s => typeof s === 'string' && s.length > 0)
            : [],
        statOverrides: input.statOverrides && typeof input.statOverrides === 'object'
            ? { ...input.statOverrides } : {},
        effectToggles: input.effectToggles && typeof input.effectToggles === 'object'
            ? { ...input.effectToggles } : {},
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
// Snap any input to a valid echo enhancement level (0/5/10/15/20/25).
// Default fallback is 25 (fully levelled) so picker-equipped echoes
// have all 5 substat slots unlocked immediately.
function snapEchoLevel(value) {
    const lv = clampInt(value, 0, 25, 25);
    return Math.round(lv / 5) * 5;
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

// Toggle a conditional chain/inherent effect on or off.
// key format: "S{level}.{index}" for chains, "IH{node}.{index}" for inherent.
// Passing `undefined` for `on` clears the override (reverts to defaultActive).
export function setEffectToggle(build, key, on) {
    const toggles = { ...(build.effectToggles ?? {}) };
    if (on === undefined) delete toggles[key];
    // Integer ≥ 0: stack count for stackable effects. Otherwise: boolean toggle.
    else if (typeof on === 'number' && on >= 0) toggles[key] = Math.round(on);
    else toggles[key] = !!on;
    return touch({ ...build, effectToggles: toggles });
}

export function setSkillLevel(build, key, level) {
    if (!SKILL_KEYS.includes(key)) return build;
    return touch({
        ...build,
        skillLevels: { ...build.skillLevels, [key]: clampInt(level, 1, 10, 1) },
    });
}

export function setInherentSkill(build, index, active) {
    const next = [...(build.inherentSkillsActive ?? [true, true])];
    next[index] = !!active;
    return touch({ ...build, inherentSkillsActive: next });
}

export function setStatNode(build, col, tier, active) {
    const cur = build.statNodesActive ?? {};
    const arr = [...(cur[col] ?? [true, true])];
    arr[tier] = !!active;                           // tier 0-indexed here
    return touch({ ...build, statNodesActive: { ...cur, [col]: arr } });
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

// Update only the level of an equipped echo. No-op when slot is empty
// or level snaps to the same value.
export function setEchoLevel(build, slotIndex, level) {
    if (slotIndex < 0 || slotIndex >= ECHO_SLOTS) return build;
    const cur = build.echoes[slotIndex];
    if (!cur) return build;
    const snapped = snapEchoLevel(level);
    if (snapped === cur.level) return build;
    const next = [...build.echoes];
    next[slotIndex] = { ...cur, level: snapped };
    return touch({ ...build, echoes: next });
}

export function setName(build, name) {
    return touch({ ...build, name: (name || '').trim() || build.name });
}

// =============================================================================
// Rotation mutators — all immutable. Steps are skill keys (strings)
// referring to entries in dataset.skillMap[resonatorId].
// =============================================================================

export function appendRotationStep(build, skillKey) {
    if (typeof skillKey !== 'string' || !skillKey) return build;
    return touch({ ...build, rotation: [...(build.rotation ?? []), skillKey] });
}

export function removeRotationStep(build, index) {
    const r = build.rotation ?? [];
    if (index < 0 || index >= r.length) return build;
    const next = [...r];
    next.splice(index, 1);
    return touch({ ...build, rotation: next });
}

// Move the step at `from` to position `to`. Both clamped; no-op when
// the move would leave the array unchanged.
export function moveRotationStep(build, from, to) {
    const r = build.rotation ?? [];
    if (from < 0 || from >= r.length) return build;
    const target = clampInt(to, 0, r.length - 1, from);
    if (target === from) return build;
    const next = [...r];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved);
    return touch({ ...build, rotation: next });
}

export function clearRotation(build) {
    return touch({ ...build, rotation: [] });
}

// Test hooks.
export const __test__ = { clampInt, clampCost, nextId };