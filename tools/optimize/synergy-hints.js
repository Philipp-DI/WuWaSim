// tools/optimize/synergy-hints.js
/**
 * P13 §3 — curated synergy-hint table (the enumeration pruning source).
 *
 * Brute-forcing all 3-member teams is ~27,720 combinations — wrong on both
 * compute and output quality (a player wants the ~10-20 teams that make sense,
 * not a team ranked #4,012). This table encodes WHICH characters plausibly
 * belong together, so team-enum.js only generates candidates worth simulating;
 * the sim (team-rank.js) provides the actual ranking. Curated knowledge defines
 * the space, the sim ranks it (PHASE0-ARCHITECTURE.md §1, (c)→(a)).
 *
 * Authoring discipline (§3b): curated + dataset-verified (a data-integrity test
 * asserts every referenced id exists). Seed from mechanics the sim MODELS —
 * outro/amplify buffers pair with the DPS element they boost; Tune Break shifters
 * pair with responders + the boost provider — because the sim can verify those.
 * Softer community-meta pairings are lower-confidence; add them sparingly.
 *
 * Coverage seed: the 6 P12 anchors (Carlotta, Hiyuki, Jinhsi, Changli, Phoebe,
 * Cantarella) + the 5 Tune Break characters (Mornye, Denia, Aemeath, Lynae, Luuk
 * Herssen — the clearest synergy showcase). Uncovered characters get no
 * suggestions at runtime ("no suggestion available" + live sim), never fabricated.
 *
 * NOTE: roles below are grounded where possible in dataset signals (outroBuffs →
 * BUFFER, kit heal/shield text → HEALER/SUSTAIN, element for amplify matches) and
 * the spec's explicit Tune Break examples; entries marked `// VERIFY` are the
 * lower-confidence ones awaiting maintainer validation (same draft→verify loop as
 * the P12 reference rotations).
 */

// Role tags: what function a character serves on a team.
export const ROLE = Object.freeze({
    MAIN_DPS: 'main_dps',
    SUB_DPS: 'sub_dps',
    HYBRID: 'hybrid',
    BUFFER: 'buffer',          // amplify / outro-buff support
    HEALER: 'healer',
    SUSTAIN: 'sustain',        // shield / sustain
    // Mechanic-specific (Tune Break):
    TB_SHIFTER: 'tb_shifter',  // applies Shifting (Tune Break setup)
    TB_RESPONDER: 'tb_responder', // responds to Interfered / stacks Strain
    TB_BOOST: 'tb_boost',      // provides Tune Break Boost (e.g. Mornye)
});

// Per-resonator role assignment. A character can have multiple roles.
// Grounded in dataset signals (outroBuffs / heal text / element) + maintainer
// direction (2026-06-28); `// VERIFY` = still awaiting maintainer confirmation.
export const CHARACTER_ROLES = Object.freeze({
    // ── P12 seed anchors ─────────────────────────────────────────────────────
    1107: [ROLE.MAIN_DPS],                       // Carlotta — Glacio skill carry
    1108: [ROLE.MAIN_DPS],                       // Hiyuki — Glacio carry
    1304: [ROLE.MAIN_DPS],                       // Jinhsi — Spectro carry
    1205: [ROLE.HYBRID, ROLE.BUFFER],            // Changli — Fusion quickswap + outro amplify
    1506: [ROLE.MAIN_DPS],                       // Phoebe — Spectro carry
    1607: [ROLE.BUFFER, ROLE.SUSTAIN],           // Cantarella — Havoc support (outro + heal)
    // ── Tune Break (maintainer-confirmed framing) ────────────────────────────
    1209: [ROLE.BUFFER, ROLE.TB_BOOST, ROLE.HEALER], // Mornye — Tune Break Boost + heal
    1510: [ROLE.MAIN_DPS],                       // Luuk Herssen — hyper-carry
    1210: [ROLE.MAIN_DPS],                       // Aemeath — hyper-carry (also fusion_burst)
    1509: [ROLE.HYBRID, ROLE.SUB_DPS],           // Lynae — hybrid / support DPS
    1211: [ROLE.HYBRID, ROLE.SUB_DPS],           // Denia — hybrid / support DPS (also fusion_burst)
    // ── Current-meta team enablers ───────────────────────────────────────────
    1508: [ROLE.BUFFER, ROLE.SUSTAIN],           // Chisa — Havoc flex enabler/support  // VERIFY
    1109: [ROLE.SUB_DPS, ROLE.BUFFER],           // Lucilla — Glacio Chafe enabler      // VERIFY
});

// The anchors that GET suggestions (their build page shows suggested teams).
// The P12-covered six; the curated-team carries are teammates, promoted to
// anchors only once they have P12 coverage (weights + reference rotation).
export const COVERED_ANCHORS = Object.freeze([1107, 1108, 1304, 1205, 1506, 1607]);

// Curated current-meta teams (maintainer-supplied, 2026-06-28) — the
// authoritative known-good comps. Each member carries the resonance MODE it runs
// (the team archetype IS the members' modes: glacio_chafe / fusion_burst /
// tune_rupture|tune_strain). These are GUARANTEED candidates seeded straight into
// the enumeration; the pairwise SYNERGY below is DERIVED from co-membership so
// nothing is fabricated. `mode: null` = the member has a single resonance mode.
export const CURATED_TEAMS = Object.freeze([
    {
        archetype: 'Tune Break',
        reason: 'Mornye Tune Break Boost enables Lynae + Luuk Herssen',
        members: [
            { id: 1209, mode: null },            // Mornye — TB Boost
            { id: 1509, mode: 'tune_rupture' },  // Lynae — hybrid/support DPS   // VERIFY mode
            { id: 1510, mode: null },            // Luuk Herssen — hyper-carry
        ],
    },
    {
        archetype: 'Fusion Burst',
        reason: 'Denia + Aemeath Fusion Burst carries with Chisa enabler',
        members: [
            { id: 1508, mode: null },            // Chisa — flex enabler
            { id: 1211, mode: 'fusion_burst' },  // Denia
            { id: 1210, mode: 'fusion_burst' },  // Aemeath
        ],
    },
    {
        archetype: 'Glacio Chafe',
        reason: 'Lucilla Glacio Chafe enabler + Hiyuki carry + Chisa support',
        members: [
            { id: 1508, mode: null },            // Chisa — flex enabler
            { id: 1109, mode: 'glacio_chafe' },  // Lucilla — Glacio Chafe enabler
            { id: 1108, mode: null },            // Hiyuki — carry
        ],
    },
]);

// Pairwise affinities DERIVED from curated team co-membership (no fabricated meta
// priors). affinity magnitude is a prior, NOT the final score (the sim ranks).
// Key is canonical `{lowerId}+{higherId}`; the WHY comes from the team archetype.
function deriveSynergyFromTeams(teams) {
    const out = {};
    for (const team of teams) {
        const ids = team.members.map(m => m.id);
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const key = pairKey(ids[i], ids[j]);
                if (!out[key]) out[key] = { affinity: 3, reason: `${team.archetype}: ${team.reason}` };
            }
        }
    }
    return Object.freeze(out);
}

export const SYNERGY = deriveSynergyFromTeams(CURATED_TEAMS);

/** Canonical pair key — order-independent, sorted ids. */
export function pairKey(a, b) {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return `${lo}+${hi}`;
}

/** Roles for a resonator id (empty array if uncovered). */
export function rolesOf(id) {
    return CHARACTER_ROLES[id] ?? [];
}

/** Curated synergy entry for a pair, or null. */
export function synergyOf(a, b) {
    return SYNERGY[pairKey(a, b)] ?? null;
}

/** Curated affinity for a pair (0 when no explicit hint). */
export function affinityOf(a, b) {
    return synergyOf(a, b)?.affinity ?? 0;
}

/** Every character id with at least one curated role (deterministic, sorted). */
export function coveredCharacters() {
    return Object.keys(CHARACTER_ROLES).map(Number).sort((a, b) => a - b);
}
