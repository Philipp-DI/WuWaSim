/**
 * P13 §10 — candidate team generation (team-enum.js).
 *
 *   node tests/team-enum.test.mjs
 */

import { generateCandidates } from '../tools/optimize/team-enum.js';
import { CURATED_TEAMS, rolesOf, ROLE, affinityOf } from '../tools/optimize/synergy-hints.js';

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── determinism: same anchor → identical candidate list ──────────────────────
{
    const a = generateCandidates(1108);
    const b = generateCandidates(1108);
    assert('deterministic candidate generation', JSON.stringify(a) === JSON.stringify(b));
}

// ── structural invariants ────────────────────────────────────────────────────
{
    for (const anchor of [1108, 1107, 1209, 1210]) {
        const cands = generateCandidates(anchor);
        for (const c of cands) {
            assert(`${anchor}: team has exactly 3 members`, c.members.length === 3);
            assert(`${anchor}: anchor present in team`, c.members.includes(anchor));
            assert(`${anchor}: no duplicate members`, new Set(c.members).size === 3);
            // Play order: a MAIN_DPS carry must not precede a non-carry support
            // (the carry plays LAST to receive setup + buffs). Curated teams use
            // the maintainer order, which already satisfies this.
            const ranks = c.members.map(id => rolesOf(id).includes(ROLE.MAIN_DPS) ? 2 : (rolesOf(id).some(r => [ROLE.SUB_DPS, ROLE.TB_SHIFTER, ROLE.TB_RUPTURE, ROLE.TB_STRAIN].includes(r)) ? 1 : 0));
            assert(`${anchor}: carry not ordered before a support`, ranks.every((r, k) => k === 0 || ranks[k - 1] <= r));
        }
    }
}

// ── curated team is always surfaced for its members ──────────────────────────
{
    // Hiyuki (1108) is in the curated Glacio Chafe team [1108,1109,1508].
    const cands = generateCandidates(1108);
    const glacio = cands.find(c => c.curated && c.archetype === 'Glacio Chafe');
    assert('Hiyuki gets her curated Glacio Chafe team', !!glacio);
    assert('curated team carries its resonance modes', glacio && glacio.modes['1109'] === 'glacio_chafe');
    assert('curated team preserves play order (enablers → carry last)', glacio && JSON.stringify(glacio.members) === JSON.stringify([1508, 1109, 1108]));
    assert('curated team ranks first (curated flag wins the sort)', cands[0]?.curated === true);
}

// ── cap is respected ─────────────────────────────────────────────────────────
{
    const cands = generateCandidates(1108, { cap: 2 });
    assert('candidate cap respected', cands.length <= 2);
}

// ── no two UNLINKED MAIN_DPS in a generated team ─────────────────────────────
// The real rule (mainDpsConflict in team-enum.js): 2+ carries are only allowed
// when an explicit affinity hint links them — curated-team membership is one
// way to get that link, but roster-wide tag-derived affinity (e.g. Changli's
// Liberation DMG Amplification tag matching Aemeath's/Hiyuki's Liberation-
// focus tag) is a legitimate SECOND way, so `c.curated` alone is no longer a
// reliable proxy for "linked." Check the actual pairwise affinity instead.
{
    for (const anchor of [1108, 1510, 1210]) {
        for (const c of generateCandidates(anchor)) {
            const carries = c.members.filter(id => rolesOf(id).includes(ROLE.MAIN_DPS));
            if (carries.length <= 1) continue;
            for (let i = 0; i < carries.length; i++) {
                for (let j = i + 1; j < carries.length; j++) {
                    assert(`${anchor}: MAIN_DPS pair ${carries[i]}+${carries[j]} is affinity-linked`, affinityOf(carries[i], carries[j]) > 0);
                }
            }
        }
    }
}

// ── uncovered anchor → no candidates ─────────────────────────────────────────
{
    assert('uncovered anchor yields no candidates', generateCandidates(9999).length === 0);
}

// ── every generated (non-curated) team has a sustain/heal ────────────────────
{
    const SUSTAIN = new Set([ROLE.HEALER]);
    for (const c of generateCandidates(1108)) {
        if (c.curated) continue;
        assert('generated team has a sustain/heal member', c.members.some(id => rolesOf(id).some(r => SUSTAIN.has(r))));
    }
}

console.log(`\nteam-enum: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
