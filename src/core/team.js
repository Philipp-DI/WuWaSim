/**
 * Team model — a named group of up to 3 resonators for full-team rotation
 * simulation (Phase 9).
 *
 * Schema (v1):
 *   {
 *     version:   1,
 *     id:        't_xxxxxxxx',
 *     name:      'My Team',
 *     createdAt: ms,
 *     updatedAt: ms,
 *     slots:     [ buildId | null, buildId | null, buildId | null ],
 *   }
 *
 * Design decision (Q1=A): a slot REFERENCES a saved build by id. Editing the
 * referenced build is reflected in the team; deleting the build empties the
 * slot (resolved lazily at read time — a dangling id simply resolves to null).
 * This keeps teams lightweight and always in sync with the underlying builds.
 *
 * The team module is intentionally storage-agnostic: it deals only in plain
 * objects. Persistence lives in src/data/storage.js.
 */

export const TEAM_SLOTS = 3;

function nextId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return 't_' + crypto.randomUUID().slice(0, 8);
    }
    return 't_' + Math.random().toString(36).slice(2, 10);
}

function touch(team) {
    return { ...team, updatedAt: Date.now() };
}

/** Construct a fresh empty team. */
export function createTeam(name = 'New Team') {
    const now = Date.now();
    return {
        version: 1,
        id: nextId(),
        name: String(name || 'New Team').slice(0, 80),
        createdAt: now,
        updatedAt: now,
        slots: Array.from({ length: TEAM_SLOTS }, () => null),
    };
}

/**
 * Coerce a possibly-foreign object into a valid current-schema team.
 * Missing/extra fields are filled or dropped. Never mutates input.
 */
export function normalizeTeam(input) {
    if (!input || typeof input !== 'object') return createTeam();
    const now = Date.now();

    // Slots: keep only string build ids; pad/truncate to TEAM_SLOTS.
    const rawSlots = Array.isArray(input.slots) ? input.slots : [];
    const slots = Array.from({ length: TEAM_SLOTS }, (_, i) => {
        const value = rawSlots[i];
        return typeof value === 'string' && value ? value : null;
    });

    return {
        version: 1,
        id: typeof input.id === 'string' && input.id ? input.id : nextId(),
        name: String(input.name || 'New Team').slice(0, 80),
        createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
        updatedAt: now,
        slots,
        // P13 §1d — a team materialized from a suggested-team recipe, not
        // authored by the user. Hidden from listTeams() by default (storage.js
        // includeTemplates) until the user explicitly saves it.
        template: input.template === true,
    };
}

/** Set the build id at a slot index (or null to clear). Returns a new team. */
export function setTeamSlot(team, index, buildId) {
    if (index < 0 || index >= TEAM_SLOTS) return team;
    const slots = [...team.slots];
    slots[index] = (typeof buildId === 'string' && buildId) ? buildId : null;
    return touch({ ...team, slots });
}

/**
 * Swap the builds occupying two slots (drag-and-drop reorder — rotation/
 * on-field order is the slot order, so this is how a user changes it).
 * Swapping with an empty slot simply moves the build there. No-op for equal
 * or out-of-range indices. Returns a new team.
 */
export function swapTeamSlots(team, i, j) {
    if (i === j || i < 0 || j < 0 || i >= TEAM_SLOTS || j >= TEAM_SLOTS) return team;
    const slots = [...team.slots];
    [slots[i], slots[j]] = [slots[j], slots[i]];
    return touch({ ...team, slots });
}

/**
 * Add a build to the first empty slot. If the build is already in the team,
 * it's a no-op. If the team is full, returns the team unchanged.
 * Returns { team, added: bool, slotIndex: number|null }.
 */
export function addBuildToTeam(team, buildId) {
    if (typeof buildId !== 'string' || !buildId) return { team, added: false, slotIndex: null };
    if (team.slots.includes(buildId)) {
        return { team, added: false, slotIndex: team.slots.indexOf(buildId) };
    }
    const empty = team.slots.indexOf(null);
    if (empty === -1) return { team, added: false, slotIndex: null };
    return { team: setTeamSlot(team, empty, buildId), added: true, slotIndex: empty };
}

/** Remove a build id from whichever slot holds it. Returns a new team. */
export function removeBuildFromTeam(team, buildId) {
    const index = team.slots.indexOf(buildId);
    if (index === -1) return team;
    return setTeamSlot(team, index, null);
}

/** Rename a team. Returns a new team. */
export function setTeamName(team, name) {
    return touch({ ...team, name: String(name || '').slice(0, 80) });
}

/** Count of occupied slots. */
export function teamSize(team) {
    return team.slots.filter(Boolean).length;
}

/**
 * Resolve a team's slots into build objects via a reader function.
 * `readBuild(id)` should return a build or null. Dangling ids resolve to null.
 * Returns an array of { slotIndex, buildId, build|null }.
 */
export function resolveTeamSlots(team, readBuild) {
    return team.slots.map((buildId, slotIndex) => ({
        slotIndex,
        buildId,
        build: buildId ? (readBuild(buildId) ?? null) : null,
    }));
}