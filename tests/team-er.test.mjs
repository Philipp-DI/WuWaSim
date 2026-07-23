/**
 * Tests for P13 §7 — team-level ER override resolution (src/core/team-er.js).
 *
 *   node tests/team-er.test.mjs
 *
 * Covers the hybrid contract (PHASE0-ARCHITECTURE §5): character-level default
 * with no team context, team override on a matching simulated team, fallback to
 * character-level on an unmatched team (never null when character-level
 * exists), and the never-fabricate null cases (absent meta / uncovered).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { resolveErTarget, findMetaTeam } from '../src/core/team-er.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Hiyuki (1108): P12-covered (has erMode) AND a team anchor. Her curated
// Glacio Chafe team is [1508, 1109, 1108].
const HIYUKI = 1108;
const hiyukiChar = meta.characters[String(HIYUKI)];
const seq = Object.keys(hiyukiChar.bySequence)[0];
const sonata = Object.keys(hiyukiChar.bySequence[seq].bySonata)[0];
const hiyukiTeam = meta.teams.byCharacter[String(HIYUKI)][0];

// ── No team context → character-level (build page default) ──────────────────
{
    const r = resolveErTarget(meta, HIYUKI, seq, sonata);
    assert('solo resolution returns a value', r != null);
    assert('solo source is character', r.source === 'character');
    assert('solo recommended is the balanced target', r.recommended === hiyukiChar.bySequence[seq].bySonata[sonata].erMode.balancedTarget);
    assert('mode-based character value is provisional', r.provisional === true && r.minViable === null);
    assert('libCostKnown surfaced (Hiyuki: energy-gated, energyMax 125)', r.libCostKnown === true);
}

// ── Matching team context → team override ───────────────────────────────────
{
    const shuffled = [...hiyukiTeam.members].reverse();
    const r = resolveErTarget(meta, HIYUKI, seq, sonata, { members: shuffled });
    assert('team match is order-agnostic', r != null && r.source === 'team');
    assert('team override recommended returned', r.recommended === hiyukiTeam.erOverride[String(HIYUKI)].recommended);
    assert('matched team members echoed back', JSON.stringify([...r.team.members].sort()) === JSON.stringify([...hiyukiTeam.members].sort()));

    // A member of the matched team WITHOUT character-level coverage (Lucilla,
    // 1109 — not in P12's seed) still gets the team value.
    const LUCILLA = 1109;
    if (hiyukiTeam.members.includes(LUCILLA) && !meta.characters[String(LUCILLA)]) {
        const rl = resolveErTarget(meta, LUCILLA, 0, null, { members: hiyukiTeam.members });
        assert('team-covered but character-uncovered member resolves via team', rl != null && rl.source === 'team');
    } else {
        assert('Lucilla fixture assumption holds (in team, not covered)', false);
    }
}

// ── Unmatched team context → character-level fallback (hard-req #3) ─────────
{
    const r = resolveErTarget(meta, HIYUKI, seq, sonata, { members: [HIYUKI, 99998, 99999] });
    assert('unmatched team falls back to character-level, never null', r != null && r.source === 'character');
    assert('fallback carries the character-level number', r.recommended === hiyukiChar.bySequence[seq].bySonata[sonata].erMode.balancedTarget);
}

// ── Never fabricate ──────────────────────────────────────────────────────────
{
    assert('absent/stale meta → null', resolveErTarget(null, HIYUKI, seq, sonata) === null);
    assert('uncovered character, no team → null', resolveErTarget(meta, 99999, 0, null) === null);
    assert('uncovered character, unmatched team → null', resolveErTarget(meta, 99999, 0, null, { members: [99999, 1, 2] }) === null);
}

// ── findMetaTeam ─────────────────────────────────────────────────────────────
{
    assert('findMetaTeam matches regardless of member order', findMetaTeam(meta, [...hiyukiTeam.members].reverse()) != null);
    assert('findMetaTeam misses on a non-simulated team', findMetaTeam(meta, [1, 2, 3]) === null);
    assert('findMetaTeam null-safe on empty input', findMetaTeam(meta, []) === null && findMetaTeam(null, [1, 2, 3]) === null);
}

// ── Non-provisional team override passthrough (synthetic — the shape the
//    sweep emits once a kit's modeled income credibly covers its cost) ───────
{
    const synth = {
        characters: { '42': { bySequence: { '0': { bySonata: { '7': { erMode: { balancedTarget: 1.25, libCostKnown: true, scalesWithEr: false } } } } } } },
        teams: { byCharacter: { '42': [{ members: [42, 43, 44], erOverride: { '42': { minViable: 1.12, recommended: 1.176 } } }] } },
    };
    const r = resolveErTarget(synth, 42, 0, 7, { members: [44, 43, 42] });
    assert('computed team override is not provisional', r.provisional === false);
    assert('computed minViable passes through', r.minViable === 1.12 && r.recommended === 1.176);
    assert('recommended carries the +5% margin', Math.abs(r.recommended - r.minViable * 1.05) < 1e-9);
}

console.log(`\nteam-er: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
