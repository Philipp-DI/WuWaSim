// tools/optimize/synergy-hints.js
/**
 * P13 §3 — synergy-hint table (the enumeration pruning source).
 *
 * Brute-forcing all 3-member teams is ~27,720 combinations — wrong on both
 * compute and output quality (a player wants the ~10-20 teams that make sense,
 * not a team ranked #4,012). This module encodes WHICH characters plausibly
 * belong together, so team-enum.js only generates candidates worth simulating;
 * the sim (team-rank.js) provides the actual ranking. Curated knowledge defines
 * the space, the sim ranks it (PHASE0-ARCHITECTURE.md §1, (c)→(a)).
 *
 * SOURCE OF TRUTH (2026-07-10 rewrite): the game's own in-game "role label"
 * tags (`resonator.roles`, projected by tools/preprocess.mjs's
 * applyResonatorRoles from the raw nanoka `tag` field), NOT hand-guessed
 * per-character assignments. The previous version of this file hand-curated
 * CHARACTER_ROLES and derived SYNERGY only from 3 hand-picked CURATED_TEAMS —
 * accurate for those teams but silent for everyone else, and in at least one
 * case (Mornye tagged TB_BOOST) simply wrong: the official tags show Mornye
 * carries "Off-Tune Buildup Efficiency", not "Tune Break Boost" (that's Denia
 * /Rebecca/Lynae). This rewrite purges the guesswork: CHARACTER_ROLES is now
 * MAPPED from official tag names (deriveCharacterRoles), and SYNERGY is
 * auto-derived roster-wide from six tag-matching rules (deriveTagAffinity) —
 * any two characters whose tags imply a mechanical link (an amplify tag
 * naming the other's element/damage-focus, a shared negative-status tag, the
 * Tune Break Boost→Strain chain, an energy battery feeding a Liberation
 * carry, a Coordinated Attack amplifier feeding a CA specialist) get real
 * affinity, not just the maintainer's 3 example teams. CURATED_TEAMS is
 * UNCHANGED — it still exists to guarantee & pin maintainer-verified current-
 * meta comps ahead of pure-tag pairings (Math.max, not replacement).
 *
 * Coverage is now roster-wide: every resonator with at least one role tag is
 * "covered" (coveredCharacters() returns all of them, not just a seed list).
 * A character with tags that don't imply any of the six rules simply gets no
 * SYNERGY entries — team-enum.js's "anchor must synergize with a teammate"
 * gate still applies, so this never fabricates a pairing; it only widens who
 * CAN have one.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Self-loaded once at import — keeps the external API (rolesOf(id), no
// dataset param) unchanged for team-enum.js/optimize.mjs. Minor redundancy
// with optimize.mjs's own dataset load (a build-time tool, not perf-critical).
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../../data/wuwa-data.json'), 'utf8'));
const resonatorsById = new Map(dataset.resonators.map(r => [r.id, r]));

// Role tags: what function a character serves on a team. Mapped FROM the
// official tag data (see deriveCharacterRoles), not assigned by hand.
export const ROLE = Object.freeze({
    MAIN_DPS: 'main_dps',
    SUB_DPS: 'sub_dps',       // fallback: has role tags, but none imply a more specific slot below
    BUFFER: 'buffer',         // any amplify-category tag (element or damage-type DMG Amplification)
    HEALER: 'healer',         // "Support and Healer" tag
    // Tune Break sub-roles — one per real in-game tag (replaces the old,
    // less precise single TB_RESPONDER: the game actually distinguishes
    // Rupture Response from Strain Response, and Off-Tune Buildup Efficiency
    // from Tune Break Boost, so the role model does too):
    TB_SHIFTER: 'tb_shifter', // "Off-Tune Buildup Efficiency" — sets up Off-Tune Buildup
    TB_BOOST: 'tb_boost',     // "Tune Break Boost" — provides the Boost buff
    TB_RUPTURE: 'tb_rupture', // "Tune Rupture Response" — deals/responds to Rupture DMG
    TB_STRAIN: 'tb_strain',   // "Tune Strain Response" — gains DMG from Tune Break Boost
});

// tag id -> ROLE, for the tags that map onto a team-composition role.
// (Most tags — damage-focus, negative-status, utility — don't map to a ROLE
// at all; they still feed deriveTagAffinity below via their raw ids.)
const TAG_ID_TO_ROLE = {
    2: ROLE.MAIN_DPS,          // Main Damage Dealer
    1: ROLE.HEALER,            // Support and Healer
    35: ROLE.TB_SHIFTER,       // Off-Tune Buildup Efficiency
    34: ROLE.TB_BOOST,         // Tune Break Boost
    33: ROLE.TB_RUPTURE,       // Tune Rupture Response
    36: ROLE.TB_STRAIN,        // Tune Strain Response
};

/** Map one resonator's official role tags onto the ROLE enum (§ above). */
function deriveRoleSet(resonatorRoles) {
    const roles = new Set();
    for (const tag of resonatorRoles ?? []) {
        if (TAG_ID_TO_ROLE[tag.id]) roles.add(TAG_ID_TO_ROLE[tag.id]);
        else if (tag.category === 'amplify') roles.add(ROLE.BUFFER);
    }
    // Has tags, but none imply a specific slot (e.g. a pure utility/CC/
    // negative-status specialist) — SUB_DPS keeps them poolable as a
    // mid-tier teammate rather than silently uncovered.
    if (roles.size === 0 && (resonatorRoles ?? []).length > 0) roles.add(ROLE.SUB_DPS);
    return [...roles];
}

/** {id -> ROLE[]} for every resonator with at least one role tag (roster-wide). */
function deriveCharacterRoles() {
    const out = {};
    for (const r of dataset.resonators) {
        const roles = deriveRoleSet(r.roles);
        if (roles.length) out[r.id] = roles;
    }
    return out;
}

export const CHARACTER_ROLES = Object.freeze(deriveCharacterRoles());

// ── Curated current-meta teams (maintainer-supplied, 2026-06-28) — the
// authoritative known-good comps, UNCHANGED by this rewrite. Each member
// carries the resonance MODE it runs. GUARANTEED candidates, seeded straight
// into the enumeration ahead of pure-tag pairings.
export const CURATED_TEAMS = Object.freeze([
    {
        archetype: 'Tune Break',
        reason: 'Mornye Tune Break Boost enables Lynae + Luuk Herssen',
        members: [
            { id: 1209, mode: null },            // Mornye — Off-Tune Buildup + Rupture/Strain Response
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

/** Canonical pair key — order-independent, sorted ids. */
export function pairKey(a, b) {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return `${lo}+${hi}`;
}

// Pairwise affinities DERIVED from curated team co-membership (no fabricated
// meta priors). affinity magnitude is a prior, NOT the final score.
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
    return out;
}

// ── Tag-matching rules (§3, roster-wide) ─────────────────────────────────────
// Each rule checks BOTH directions of a pair and, on a hit, contributes 1 to
// the pair's affinity plus a reason string. Multiple rule hits between the
// same pair stack (e.g. Zhezhi -> Carlotta matches both the element-amp rule
// AND the damage-focus-amp rule = affinity 2), which is why the final
// affinityOf takes Math.max against curated (3) rather than always deferring
// to curation — a double tag-match is a genuinely stronger signal than a
// single one, even if still below a hand-verified curated team.
const MAIN_DPS_TAG = 2;
const ELEMENT_AMP_TAG_TO_ELEMENT = { 14: 6, 15: 4, 16: 3, 17: 2, 18: 1, 19: 5 }; // amp tag id -> elementId (Havoc/Aero/Electro/Fusion/Glacio/Spectro)
const TYPE_AMP_TAG_TO_FOCUS_TAG = { 20: 4, 21: 5, 22: 6, 23: 7, 32: 37 };        // amp tag id -> matching damage-focus tag id
const NEGATIVE_STATUS_TAG_IDS = [24, 25, 26, 27, 28, 29];
const CA_AMP_TAG = 31, CA_SPECIALIST_TAG = 9;
const LIBERATION_REGEN_TAG = 11, LIBERATION_FOCUS_TAG = 7;
const TUNE_BOOST_TAG = 34, TUNE_STRAIN_TAG = 36;

const tagIdsOf = (r) => new Set((r?.roles ?? []).map(t => t.id));
const tagNameOf = (r, id) => (r?.roles ?? []).find(t => t.id === id)?.name;

/** One-directional check: does `amp`'s tags amplify a role `dps` actually has? */
function tagAffinityHits(amp, dps) {
    const hits = [];
    const A = tagIdsOf(amp);
    if (!A.size || !dps) return hits;

    if (dps.roles?.some(t => t.id === MAIN_DPS_TAG)) {
        for (const [ampId, elemId] of Object.entries(ELEMENT_AMP_TAG_TO_ELEMENT)) {
            if (A.has(+ampId) && dps.element === elemId) {
                hits.push(`${amp.name}'s ${tagNameOf(amp, +ampId)} boosts ${dps.name}`);
            }
        }
        for (const [ampId, focusId] of Object.entries(TYPE_AMP_TAG_TO_FOCUS_TAG)) {
            if (A.has(+ampId) && dps.roles.some(t => t.id === +focusId)) {
                hits.push(`${amp.name}'s ${tagNameOf(amp, +ampId)} boosts ${dps.name}'s ${tagNameOf(dps, +focusId)}`);
            }
        }
        if (A.has(LIBERATION_REGEN_TAG) && dps.roles.some(t => t.id === LIBERATION_FOCUS_TAG)) {
            hits.push(`${amp.name}'s Resonance Liberation Regeneration feeds ${dps.name}'s Liberation-focused kit`);
        }
    }
    if (A.has(CA_AMP_TAG) && dps.roles?.some(t => t.id === CA_SPECIALIST_TAG)) {
        hits.push(`${amp.name}'s Coordinated Attack DMG Amplification boosts ${dps.name}'s Coordinated Attacks`);
    }
    return hits;
}

/** Pairwise tag-derived affinity + reasons for one pair (both directions + shared-tag rules). */
function tagAffinityForPair(a, b) {
    const hits = [...tagAffinityHits(a, b), ...tagAffinityHits(b, a)];

    const A = tagIdsOf(a), B = tagIdsOf(b);
    for (const id of NEGATIVE_STATUS_TAG_IDS) {
        if (A.has(id) && B.has(id)) hits.push(`${a.name} + ${b.name} both scale off ${tagNameOf(a, id)}`);
    }
    if (A.has(TUNE_BOOST_TAG) && B.has(TUNE_STRAIN_TAG)) hits.push(`${a.name}'s Tune Break Boost feeds ${b.name}'s Tune Strain Response`);
    if (B.has(TUNE_BOOST_TAG) && A.has(TUNE_STRAIN_TAG)) hits.push(`${b.name}'s Tune Break Boost feeds ${a.name}'s Tune Strain Response`);

    return hits.length ? { affinity: hits.length, reason: hits[0] } : null;
}

/** SYNERGY entries derived from tag-matching rules, roster-wide (all pairs). */
function deriveTagAffinity() {
    const out = {};
    const ids = dataset.resonators.map(r => r.id).sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            const entry = tagAffinityForPair(resonatorsById.get(ids[i]), resonatorsById.get(ids[j]));
            if (entry) out[pairKey(ids[i], ids[j])] = entry;
        }
    }
    return out;
}

/** Merge two SYNERGY maps, keeping the higher-affinity entry per pair. */
function mergeSynergy(curated, tagDerived) {
    const out = { ...tagDerived };
    for (const [key, entry] of Object.entries(curated)) {
        if (!out[key] || entry.affinity >= out[key].affinity) out[key] = entry;
    }
    return Object.freeze(out);
}

export const SYNERGY = mergeSynergy(deriveSynergyFromTeams(CURATED_TEAMS), deriveTagAffinity());

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

/** Every character id with at least one role tag (deterministic, sorted). Roster-wide. */
export function coveredCharacters() {
    return Object.keys(CHARACTER_ROLES).map(Number).sort((a, b) => a - b);
}
