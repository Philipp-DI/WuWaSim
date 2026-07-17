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
        // Resonance Mode (RESONANCE-MODE-SPEC.md §4): build-level mode choice for
        // the four mode-having resonators; defaults to mode A. null otherwise.
        resonanceMode: resonator.resonanceModes?.[0]?.key ?? null,
        skillLevels: { ...DEFAULT_SKILL_LEVELS },
        // Inherent skill nodes — both active by default (always unlocked at max level)
        inherentSkillsActive: [true, true],
        // Passive stat nodes — [tier1Active, tier2Active] per skill column
        statNodesActive: { normal: [true, true], skill: [true, true], liberation: [true, true], intro: [true, true] },

        weapon: null,
        echoes: Array.from({ length: ECHO_SLOTS }, () => null),
        rotation: [],
        // Parallel to `rotation`: rotationMeta[i] describes step i.
        // {} = user-added (default); { autoInserted: true } = machine-inserted
        // by a trigger rule (rotation-triggers.js). Sparse entries read as {}.
        rotationMeta: [],
        statOverrides: {},
    };
}

// Build fields that constitute a "real" configuration. id/name/timestamps are
// excluded — a build matching defaults on all of these is considered pristine
// (unmodified since creation) regardless of its name.
const PRISTINE_FIELDS = [
    'level', 'chain', 'resonanceMode', 'skillLevels', 'inherentSkillsActive', 'statNodesActive',
    'weapon', 'echoes', 'rotation', 'statOverrides',
];

/**
 * True when `build` matches the creation defaults for its resonator on every
 * meaningful field (weapon, echoes, rotation, levels, toggles, …). Used to
 * mark "unmodified" builds in the roster. Returns false if the resonator
 * can't be resolved (can't compute defaults to compare against).
 */
export function isPristineBuild(build, dataset) {
    if (!build || build.resonatorId == null) return false;
    const resonator = dataset?.resonators?.find(r => r.id === build.resonatorId);
    if (!resonator) return false;
    const def = createBuild(resonator);
    return PRISTINE_FIELDS.every(
        k => JSON.stringify(build[k] ?? null) === JSON.stringify(def[k] ?? null),
    );
}

/**
 * Coerce a possibly-foreign (older schema / hand-edited / Inventory Kamera
 * imported) object into a valid current-schema build. Missing fields are
 * filled with defaults. Returns a new object — never mutates input.
 *
 * Throws only if essential identity is missing (no resonatorId).
 */
export function normalizeBuild(input, { dataset, onNotice } = {}) {
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

    // Weapon: if the saved id no longer resolves in the dataset (e.g. a 1–3★
    // weapon trimmed from the projection), clear the slot rather than carrying
    // a broken reference, keep the rest of the build, and notify the caller
    // once so the UI can surface a one-line notice.
    // Rotation: strings only (skill keys reference dataset.skillMap entries).
    // rotationMeta is kept index-aligned with the sanitized rotation so the
    // auto-inserted markers never drift onto the wrong step.
    const rotation = Array.isArray(input.rotation)
        ? input.rotation.filter(s => typeof s === 'string' && s.length > 0)
        : [];
    const srcMeta = Array.isArray(input.rotationMeta) ? input.rotationMeta : [];
    const rotationMeta = rotation.map((_, i) =>
        (srcMeta[i] && typeof srcMeta[i] === 'object') ? { ...srcMeta[i] } : {});

    let weapon = null;
    if (input.weapon && input.weapon.id != null) {
        const weaponDef = dataset?.weapons?.find(w => w.id === input.weapon.id);
        if (dataset?.weapons && !weaponDef) {
            onNotice?.('Weapon no longer available — slot cleared');
        } else {
            weapon = {
                id: input.weapon.id,
                level: clampInt(input.weapon.level, 1, 90, 90),
                rank: clampInt(input.weapon.rank, 1, 5, 1),
            };
        }
    }

    return {
        version: BUILD_VERSION,
        id: input.id || nextId(),
        name: input.name || resonator?.name || `Build ${input.resonatorId}`,
        createdAt: input.createdAt || now,
        updatedAt: now,

        resonatorId: input.resonatorId,
        level: clampInt(input.level, 1, resonator?.maxLevel ?? 90, resonator?.maxLevel ?? 90),
        chain: clampInt(input.chain, 0, 6, 0),
        // Resonance Mode: validate against the resonator's mode pair; mode-having
        // resonators default to mode A when unset/invalid (migration). When the
        // resonator can't be resolved (no dataset), preserve the stored value.
        resonanceMode: (() => {
            const modes = resonator?.resonanceModes;
            if (!modes) return input.resonanceMode ?? null;
            if (modes.length === 0) return null;
            return modes.some(m => m.key === input.resonanceMode) ? input.resonanceMode : modes[0].key;
        })(),
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

        weapon,

        echoes,
        // v1 → v2: rotation didn't exist; default to empty array.
        rotation,
        rotationMeta,
        statOverrides: input.statOverrides && typeof input.statOverrides === 'object'
            ? { ...input.statOverrides } : {},
        // P13 §1d — a build materialized from a suggested-team recipe, not
        // authored by the user. Hidden from listBuilds() by default (storage.js
        // includeTemplates) so it never clutters My Builds until the user
        // explicitly saves it (which clears this flag).
        template: input.template === true,
        // P11 §A: effectToggles is deprecated — the engine resolves conditional
        // effects from the rotation. Any legacy field is dropped here (stripped
        // on next save); it is intentionally not carried forward.
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
    const level = clampInt(value, 0, 25, 25);
    return Math.round(level / 5) * 5;
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

// Set the build-level Resonance Mode (RESONANCE-MODE-SPEC.md §4). `mode` is a
// normalized key from the resonator's mode pair (e.g. 'tune_rupture'), or null.
export function setResonanceMode(build, mode) {
    return touch({ ...build, resonanceMode: mode ?? null });
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
    const current = build.statNodesActive ?? {};
    const tiers = [...(current[col] ?? [true, true])];
    tiers[tier] = !!active;                           // tier 0-indexed here
    return touch({ ...build, statNodesActive: { ...current, [col]: tiers } });
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
    const current = build.echoes[slotIndex];
    if (!current) return build;
    const snapped = snapEchoLevel(level);
    if (snapped === current.level) return build;
    const next = [...build.echoes];
    next[slotIndex] = { ...current, level: snapped };
    return touch({ ...build, echoes: next });
}

export function setName(build, name) {
    return touch({ ...build, name: (name || '').trim() || build.name });
}

// =============================================================================
// Rotation mutators — all immutable. Steps are skill keys (strings)
// referring to entries in dataset.skillMap[resonatorId].
// =============================================================================

// rotation and rotationMeta are parallel arrays. Every mutator below keeps
// them index-aligned — drifting them silently mislabels auto-inserted steps.
// metaOf() returns a length-matched copy of rotationMeta, padding with {}.
function metaOf(build, len) {
    const m = (build.rotationMeta ?? []).slice(0, len);
    while (m.length < len) m.push({});
    return m;
}

// Append a step. Optional `meta` (e.g. { autoInserted: true }) tags the new
// step; omitted → a plain user-added step.
export function appendRotationStep(build, skillKey, meta = null) {
    if (typeof skillKey !== 'string' || !skillKey) return build;
    const rotation = [...(build.rotation ?? []), skillKey];
    const rotationMeta = [...metaOf(build, rotation.length - 1), meta ?? {}];
    return touch({ ...build, rotation, rotationMeta });
}

export function removeRotationStep(build, index) {
    const r = build.rotation ?? [];
    if (index < 0 || index >= r.length) return build;
    const rotation = [...r];
    const rotationMeta = metaOf(build, r.length);
    rotation.splice(index, 1);
    rotationMeta.splice(index, 1);
    return touch({ ...build, rotation, rotationMeta });
}

// Move the step at `from` to position `to`. Both clamped; no-op when
// the move would leave the array unchanged. The step's meta moves with it.
export function moveRotationStep(build, from, to) {
    const r = build.rotation ?? [];
    if (from < 0 || from >= r.length) return build;
    const target = clampInt(to, 0, r.length - 1, from);
    if (target === from) return build;
    const rotation = [...r];
    const rotationMeta = metaOf(build, r.length);
    const [movedStep] = rotation.splice(from, 1);
    const [movedMeta] = rotationMeta.splice(from, 1);
    rotation.splice(target, 0, movedStep);
    rotationMeta.splice(target, 0, movedMeta);
    return touch({ ...build, rotation, rotationMeta });
}

export function clearRotation(build) {
    return touch({ ...build, rotation: [], rotationMeta: [] });
}

// Set or clear the metadata for one rotation step. meta=null reverts to the
// default ({} — a user-added step).
export function setRotationMeta(build, index, meta) {
    if (index < 0) return build;
    const len = Math.max((build.rotation ?? []).length, index + 1);
    const rotationMeta = metaOf(build, len);
    rotationMeta[index] = meta ?? {};
    return touch({ ...build, rotationMeta });
}

/**
 * Resolve a real echo id matching a cost/sonata/element combination — the
 * shared echo-identity lookup used both by the offline team-suggestion
 * pipeline (tools/optimize/team-rank.js) and the runtime "apply suggestion"
 * flow (build-editor-v2.js), so a suggested build's echoes are the same real
 * echo ids in both places rather than two independently-maintained copies.
 * Falls back to any echo of the right cost/sonata if none matches the
 * element (some 1-cost echoes carry no element).
 *
 * @param {object} dataset
 * @param {number} sonataId
 * @param {number} cost
 * @param {number|null} [element]
 * @returns {number|null}
 */
// `excludeIds` — echo species already placed elsewhere in the SAME build.
// Sonata piece-count credit requires distinct echo species within the set
// (real game rule, maintainer-confirmed 2026-07-12) — auto-generating every
// slot of the same cost independently would otherwise pick the identical
// species repeatedly and silently forfeit the set bonus it was meant to
// grant. Falls back to a repeat only when the set genuinely has no other
// species of this cost (rare — see the (sonata,cost) species-count audit).
export function pickEchoId(dataset, sonataId, cost, element, excludeIds = null) {
    const cands = (dataset?.echoes ?? []).filter(
        (e) => e.name && e.cost === cost && (e.sonataIds ?? []).includes(sonataId),
    );
    if (cands.length === 0) return null;
    const elementOf = (e) => e.activeSkill?.element ?? e.elementTypes?.[0] ?? null;
    const fresh = excludeIds ? cands.filter((e) => !excludeIds.has(e.id)) : cands;
    const pool = fresh.length ? fresh : cands;
    return (pool.find((e) => elementOf(e) === element) ?? pool[0]).id;
}

// Test hooks.
export const __test__ = { clampInt, clampCost, nextId, metaOf };