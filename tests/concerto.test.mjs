/**
 * Tests for P13 Concerto (swap gauge) — extraction (preprocess `element_power`
 * ÷100, per-hit accounting), the solo trace field, and the team-sim gauge:
 * accumulation, cap, per-swap readiness, consumption, and opt-in enforcement
 * (handoff gating: outro segment + outro buffs + incoming intro).
 *
 *   node tests/concerto.test.mjs
 *
 * ~~Enforcement defaults OFF: measured on the curated meta teams, only ~5% of
 * swaps fill the 100 gauge within one highlight-cycle rotation, and the
 * modeled income has known gaps (echo skills carry no source field; several
 * kits generate 0 on skill casts) — gating by default would fabricate
 * scarcity.~~ The largest of those gaps is closed (2026-08-18): the flat
 * "<name> Concerto Regen" meta-row was folded in for INTRO nodes only, which
 * read 65 of 261 grants and left 2,884 points unread. With Skill/Liberation/
 * Forte/Normal-Attack folded in too, **0 of 55 curated rotations could fill the
 * gauge in one pass; 25 now do**, the median jumped 38.8 → 94.0, and measured
 * across 44 meta teams the swap fill rate went ~5% → **61%**.
 *
 * Enforcement still defaults OFF — that is now a POLICY call, not a data
 * excuse. Turning it on costs 8.2% mean team DPS across those 44 teams, and
 * 39% of swaps are still short. Some of those shortfalls are real and
 * maintainer-verified (Chisa's curated loop reaches 56.3 and fires no Outro in
 * game); others may be remaining income gaps. See docs/energy-signal-findings.md
 * (Concerto section) and docs/OPEN-ITEMS.md.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { simulateRotation } from '../src/core/sim.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createBuild } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
const close = (a, b) => Math.abs(a - b) < 1e-9;

const target = { level: 90, atkLv: 90, resistances: {} };
const sanhua = d.resonators.find(r => r.id === 1102);
const mornye = d.resonators.find(r => r.id === 1209);

// ── Extraction (per-hit × hit-count, same accounting as Resonance energy) ───
{
    const sm = d.autoSkillMap['1102'];
    assert('basic_1 concertoGen 2 (raw element_power 200 ÷100)', close(sm.basic_1.concertoGen, 2));
    assert('basic_3 concertoGen 8 (4 hits × 2)', close(sm.basic_3.concertoGen, 8));
    assert('basic_4 concertoGen 8 (2 hits × 4)', close(sm.basic_4.concertoGen, 8));
    assert('basic_5 concertoGen 10', close(sm.basic_5.concertoGen, 10));
    // ~~skill/liberation generate 0 Concerto (raw element_power 0).~~ The
    // element_power VECTOR is indeed 0 on both, and reading only the vector is
    // what made that look like the answer. The income is a flat, level-
    // invariant "<name> Concerto Regen" meta-row instead — the game mechanic is
    // a restore on a successful CAST, not a per-hit rate — and it exists on
    // Skill, Liberation, Forte and Normal Attack nodes, not only on Intro
    // (widened 2026-08-18). Sanhua states 15 and 20; both are read AS-IS, no
    // ÷100, unlike the ×100-scaled vector fields.
    assert('skill generates its flat 15 Concerto (meta-row, not element_power)', close(sm.skill.concertoGen, 15));
    assert('liberation generates its flat 20 Concerto', close(sm.liberation.concertoGen, 20));
    assert('intro generates 10 Concerto (flat Concerto Regen meta-row, not element_power)', close(sm.intro.concertoGen, 10));
    // A flat grant ADDS to the per-hit vector, never replaces it: Chisa's
    // Sawring - Eradication states 45 and its own hits carry 4.8. That single
    // cast is the difference between her filling the 100 gauge in one pass and
    // never filling it at all (maintainer-verified in game 2026-08-18: the
    // curated loop, which does NOT cast it, reaches 56.3 and fires no Outro).
    assert('a flat grant adds to the per-hit vector (Chisa Eradication 45 + 4.8)',
        close(d.autoSkillMap['1508'].forte_heavy_sawring_eradication.concertoGen, 49.8));
    // SCOPE GUARD — energy must not move with Concerto. It is a DIFFERENT
    // shape, not a smaller version of the same hole: the per-hit
    // `damage[*].energy` vector is already read on every node type (3,557
    // points roster-wide), and a "<name> Energy Regen" meta-row does not exist
    // anywhere on the roster — the energy meta-rows the game writes are COSTS.
    // Sanhua's Skill energy stays the per-hit 10, her Liberation 0 (it spends).
    assert('the Concerto widening did not move energy', close(sm.skill.energyGen, 10) && close(sm.liberation.energyGen, 0));

    let badEntries = 0, withIncome = 0, chars = 0;
    for (const skillMap of Object.values(d.autoSkillMap)) {
        chars++;
        let charTotal = 0;
        for (const [k, def] of Object.entries(skillMap)) {
            if (k.startsWith('_')) continue;
            if (!Number.isFinite(def.concertoGen) || def.concertoGen < 0) badEntries++;
            charTotal += def.concertoGen ?? 0;
        }
        if (charTotal > 0) withIncome++;
    }
    assert('every skill entry has a finite, non-negative concertoGen', badEntries === 0);
    assert(`extraction is not silently empty (${withIncome}/${chars} characters have Concerto income)`, withIncome > chars * 0.8);
}

// ── Solo trace carries rawConcertoGen ────────────────────────────────────────
{
    let b = createBuild(sanhua);
    b.rotation = ['basic_1', 'skill'];
    const sim = simulateRotation({ build: b, dataset: d, target });
    assert('trace entry carries the step\'s rawConcertoGen', close(sim.energyTrace[0].rawConcertoGen, 2));
    assert('a flat-granting cast carries it too (skill 15)', close(sim.energyTrace[1].rawConcertoGen, 15));
}

// 2-member team fixture: Mornye (slot 0) + Sanhua (slot 1, rotation given).
function teamOf(sanhuaRotation, opts = {}) {
    const filler = createBuild(mornye);
    filler.rotation = ['basic_basic_attack_1'];
    const sb = createBuild(sanhua);
    sb.rotation = sanhuaRotation;
    let team = createTeam();
    team = setTeamSlot(team, 0, filler.id);
    team = setTeamSlot(team, 1, sb.id);
    const builds = new Map([[filler.id, filler], [sb.id, sb]]);
    return simulateTeamRotation({ team, resolveBuild: (id) => builds.get(id) ?? null, dataset: d, target, ...opts });
}

// ── Gauge accumulation, readiness, consumption (default: not enforced) ──────
{
    // 10 × basic_5 = exactly 100 Concerto in Sanhua's window.
    const r = teamOf(Array(10).fill('basic_5'), { passCount: 2 });
    assert('result carries the concerto block (enforced:false by default)',
        r.concerto && r.concerto.enforced === false && r.concerto.max === 100);
    assert('every swap boundary is recorded', r.concerto.swaps.length === 3);   // M→S, S→M, M→S

    const sSwaps = r.concerto.swaps.filter(s => s.outgoingId === 1102);
    assert('a window generating exactly 100 reads ready at the swap', sSwaps[0].ready === true && close(sSwaps[0].gauge, 100));
    assert('the handoff consumes the gauge (pass 2 rebuilds from 0 to 100 again)',
        sSwaps.length === 1 || sSwaps.every(s => close(s.gauge, 100)));

    const mSwaps = r.concerto.swaps.filter(s => s.outgoingId === 1209);
    assert('a one-cast window is far from ready, gauge carried across passes',
        mSwaps[0].ready === false && mSwaps.length === 2 && mSwaps[1].gauge > mSwaps[0].gauge);
    assert('unenforced: intro/outro segments unchanged by readiness',
        r.segments.some(s => s.kind === 'intro') && r.segments.filter(s => s.kind === 'outro').length === 3);
}

// ── Cap at 100 ───────────────────────────────────────────────────────────────
{
    const r = teamOf(Array(15).fill('basic_5'), { passCount: 1 });   // 150 raw
    const s = r.concerto.swaps.find(x => x.outgoingId === 1102);
    assert('gauge caps at 100 (overflow lost)', s == null || s.gauge <= 100);
}

// ── Enforcement: handoff gated on readiness ──────────────────────────────────
{
    // Not ready anywhere (short rotations) → no outro fires, no intro fires.
    const r = teamOf(['basic_1'], { passCount: 2, enforceConcerto: true });
    assert('enforced + never ready → no outro segments', r.segments.every(s => s.kind !== 'outro'));
    assert('enforced + never ready → no intro segments', r.segments.every(s => s.kind !== 'intro'));
    assert('readiness still recorded for every boundary', r.concerto.swaps.length === 3 && r.concerto.swaps.every(s => s.ready === false));
    assert('rotation segments unaffected (members still act)', r.segments.filter(s => s.kind === 'rotation').length === 4);

    // Sanhua fills exactly 100 → HER outro fires and the incoming (Mornye,
    // next pass) gets a real intro; Mornye's own swaps stay gated.
    const r2 = teamOf(Array(10).fill('basic_5'), { passCount: 2, enforceConcerto: true });
    const outros = r2.segments.filter(s => s.kind === 'outro');
    const intros = r2.segments.filter(s => s.kind === 'intro');
    assert('enforced: only the ready member\'s outro fires', outros.length === 1 && outros[0].resonatorId === 1102);
    assert('enforced: the member AFTER a ready swap gets the intro', intros.length === 1 && intros[0].resonatorId === 1209);

    // initialConcerto pre-charges every gauge (test/QA hook).
    const r3 = teamOf(['basic_1'], { passCount: 1, enforceConcerto: true, initialConcerto: 100 });
    assert('initialConcerto:100 makes the first handoff fire under enforcement',
        r3.segments.some(s => s.kind === 'intro' && s.resonatorId === 1102));
}

// ── Enforcement changes handoff-dependent damage, not member rotations ──────
{
    const off = teamOf(['basic_1'], { passCount: 1 });
    const on  = teamOf(['basic_1'], { passCount: 1, enforceConcerto: true });
    const rotDmg = (r) => r.segments.filter(s => s.kind === 'rotation').reduce((x, s) => x + s.damage, 0);
    assert('enforcement only removes handoff segments/buffs, rotations still simulate',
        rotDmg(on) > 0 && on.totals.damage <= off.totals.damage);
}

console.log(`\nconcerto: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
