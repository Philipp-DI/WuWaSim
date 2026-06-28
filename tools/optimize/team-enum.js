// tools/optimize/team-enum.js
/**
 * P13 §4 — candidate team generation (hard-pruned).
 *
 * Turns the curated synergy hints (synergy-hints.js) into full 3-member
 * candidate teams for a given anchor, pruned BEFORE simulation so the sim pass
 * stays bounded. Two sources feed candidates:
 *
 *   1. CURATED_TEAMS containing the anchor — guaranteed candidates (the
 *      authoritative current-meta comps; never pruned away).
 *   2. Role/synergy enumeration — {anchor} ∪ {compatible teammates}, filtered by
 *      the §4a rules (no two MAIN_DPS unless an explicit hint links them, at
 *      least one sustain/heal, positive mutual affinity), capped by summed
 *      pairwise affinity.
 *
 * Deterministic: sorted iteration + stable tie-breaks, so the meta is
 * reproducible (same requirement as P12 §5a). The sim (team-rank.js) ranks the
 * survivors; this module only decides WHICH teams are worth simulating.
 */

import {
    ROLE, rolesOf, affinityOf, synergyOf, coveredCharacters, CURATED_TEAMS,
} from './synergy-hints.js';

const SUSTAIN_ROLES = new Set([ROLE.HEALER, ROLE.SUSTAIN]);
const MID_ROLES = new Set([ROLE.HYBRID, ROLE.SUB_DPS, ROLE.TB_RESPONDER, ROLE.TB_SHIFTER]);

const hasRole = (id, role) => rolesOf(id).includes(role);
const isMainDps = (id) => hasRole(id, ROLE.MAIN_DPS);
const providesSustain = (id) => rolesOf(id).some(r => SUSTAIN_ROLES.has(r));

// TURN ORDER matters: the team sim is order-dependent (intro/outro hand-offs,
// status setup persisting forward, single-pass buff flow). The carry plays LAST
// so it receives every enabler's status + team buffs + outro + its own intro;
// supports/enablers play first. Rank: buffer/heal/sustain (0) → hybrid/sub-dps
// (1) → main_dps (2). Stable tie-break by id for determinism.
function playRank(id) {
    if (isMainDps(id)) return 2;
    if (rolesOf(id).some(r => MID_ROLES.has(r))) return 1;
    return 0;
}
const orderForPlay = (ids) => [...ids].sort((a, b) => playRank(a) - playRank(b) || a - b);
// Canonical (order-independent) key for de-duplication across orderings.
const teamKey = (ids) => [...ids].sort((a, b) => a - b).join('+');

// Summed pairwise curated affinity over all member pairs.
function teamAffinity(ids) {
    let total = 0;
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) total += affinityOf(ids[i], ids[j]);
    }
    return total;
}

// A reason string from whichever member pair carries a curated synergy entry.
function teamReason(ids) {
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            const s = synergyOf(ids[i], ids[j]);
            if (s) return s.reason;
        }
    }
    return null;
}

// Two MAIN_DPS may only share a team if an explicit synergy hint links them
// (otherwise two carries is usually a non-team — §4a).
function mainDpsConflict(ids) {
    const carries = ids.filter(isMainDps);
    if (carries.length < 2) return false;
    for (let i = 0; i < carries.length; i++) {
        for (let j = i + 1; j < carries.length; j++) {
            if (affinityOf(carries[i], carries[j]) <= 0) return true;   // unlinked carries → conflict
        }
    }
    return false;
}

/** The curated teams that contain `anchorId`, normalized to the candidate shape. */
function curatedCandidatesFor(anchorId) {
    return CURATED_TEAMS
        .filter(t => t.members.some(m => m.id === anchorId))
        .map(t => {
            // Preserve the maintainer's PLAY ORDER (enabler → carry last); the
            // team sim is order-dependent. Do NOT sort by id.
            const ids = t.members.map(m => m.id);
            const modes = Object.fromEntries(t.members.filter(m => m.mode).map(m => [m.id, m.mode]));
            return {
                members: ids,
                affinity: teamAffinity(ids),
                roles: ids.map(id => rolesOf(id)),
                modes,
                curated: true,
                archetype: t.archetype,
                reason: t.reason,
            };
        });
}

/**
 * Generate pruned candidate teams for an anchor.
 *
 * @param {number} anchorId
 * @param {object} [opts]
 * @param {number} [opts.cap=30]            — max candidates after pruning
 * @param {number} [opts.minAffinity=1]     — drop enumerated teams below this summed affinity
 * @returns {Array<{members:number[], affinity:number, roles:string[][], modes:object, curated:boolean, archetype?:string, reason?:string}>}
 */
export function generateCandidates(anchorId, { cap = 30, minAffinity = 1 } = {}) {
    if (rolesOf(anchorId).length === 0) return [];   // uncovered anchor → no suggestions

    const out = [];
    const seen = new Set();
    const push = (cand) => {
        const key = teamKey(cand.members);   // order-independent dedup
        if (seen.has(key)) return;
        seen.add(key);
        out.push(cand);
    };

    // 1) Curated teams first — guaranteed, never pruned.
    for (const c of curatedCandidatesFor(anchorId)) push(c);

    // 2) Compatible teammate pool: positive affinity to the anchor OR a
    //    complementary (non-duplicate-carry) role.
    const pool = coveredCharacters().filter(id => {
        if (id === anchorId) return false;
        if (affinityOf(anchorId, id) > 0) return true;
        // complementary: don't pair two carries without an explicit hint
        if (isMainDps(anchorId) && isMainDps(id)) return false;
        return true;
    }).sort((a, b) => a - b);

    // 3) Enumerate 3-member combinations {anchor} ∪ two from the pool.
    for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
            // The ANCHOR must synergize with at least one teammate — otherwise
            // it's just an unrelated carry bolted onto a synergetic pair (the
            // inverse of §4a's weak-team case). This keeps suggestions honest:
            // an anchor with no curated synergy gets "no suggestion available"
            // rather than a spurious pairing.
            if (affinityOf(anchorId, pool[i]) <= 0 && affinityOf(anchorId, pool[j]) <= 0) continue;
            const ids = orderForPlay([anchorId, pool[i], pool[j]]);   // carry last
            if (mainDpsConflict(ids)) continue;
            if (!ids.some(providesSustain)) continue;        // need a sustain/heal (§4a)
            const affinity = teamAffinity(ids);
            if (affinity < minAffinity) continue;            // members don't mutually synergize
            push({
                members: ids,
                affinity,
                roles: ids.map(id => rolesOf(id)),
                modes: {},
                curated: false,
                reason: teamReason(ids),
            });
        }
    }

    // 4) Final prune: curated first, then by summed affinity, then by ids
    //    (deterministic). Cap the count.
    out.sort((a, b) => {
        if (a.curated !== b.curated) return a.curated ? -1 : 1;
        if (b.affinity !== a.affinity) return b.affinity - a.affinity;
        return a.members.join('+').localeCompare(b.members.join('+'));
    });
    return out.slice(0, cap);
}
