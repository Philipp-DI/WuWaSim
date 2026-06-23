/**
 * Tests for team-sim.js's Intro/Outro handoff handling.
 *
 *   node test/team-sim.test.mjs
 *
 * Covers a real data bug: nanoka's extraction keys each resonator's Intro
 * Skill inconsistently (e.g. Mornye's key is literally 'intro', Lynae's is
 * 'intro_time_to_show_some_colors'). That broke two ways at once:
 *   - the auto-injected per-swap-in intro segment silently produced nothing
 *     for any resonator whose key wasn't literally 'intro' (Lynae's case)
 *   - for resonators whose key WAS 'intro' (Mornye's case), a manually
 *     placed Intro step in their own authored rotation got simulated AGAIN
 *     on top of the auto-injected segment, double-counting the damage
 *
 * Covers:
 *   - the auto-injected intro segment resolves by skillType, not a hardcoded
 *     dict key, so it fires for every resonator regardless of nanoka's key
 *   - a manually-placed Intro/Outro step in a member's own rotation is
 *     stripped before simulating in team context, so it can never be
 *     double-counted alongside the auto-injected segment
 *   - the build editor's direct simulateRotation() call is unaffected — it
 *     still honors a manually-placed Intro step verbatim (single-resonator
 *     damage experimentation still allows sequencing it freely)
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

const target = { level: 90, atkLv: 90, resistances: {} };

const MORNYE_ID = 1209;   // autoSkillMap key for her Intro Skill is literally 'intro'
const LYNAE_ID = 1509;    // autoSkillMap key is 'intro_time_to_show_some_colors'

const mornyeReso = d.resonators.find(r => r.id === MORNYE_ID);
const lynaeReso = d.resonators.find(r => r.id === LYNAE_ID);
assert('fixture resonators found', !!mornyeReso && !!lynaeReso);

// 2-member team [filler, target]: the filler occupies slot 0 (mi=0, the
// very-first overall actor, which never gets an auto-intro), so `target`
// always lands at mi=1 and gets a real swap-in.
function teamWith(fillerReso, targetReso, targetRotation) {
    const fillerBuild = createBuild(fillerReso);
    fillerBuild.rotation = ['basic_basic_attack_1'];
    const targetBuild = createBuild(targetReso);
    targetBuild.rotation = targetRotation;

    let team = createTeam();
    team = setTeamSlot(team, 0, fillerBuild.id);
    team = setTeamSlot(team, 1, targetBuild.id);
    const builds = new Map([[fillerBuild.id, fillerBuild], [targetBuild.id, targetBuild]]);
    const resolveBuild = (id) => builds.get(id) ?? null;
    return { team, resolveBuild };
}

// ── Robust intro-key lookup (Lynae: key isn't literally 'intro') ───────────
{
    const { team, resolveBuild } = teamWith(mornyeReso, lynaeReso, ['basic_basic_attack_1']);
    const result = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 1 });

    const lynaeIntro = result.segments.find(s => s.kind === 'intro' && s.resonatorId === LYNAE_ID);
    assert('Lynae (intro key != "intro") still gets an auto-injected intro segment', !!lynaeIntro);
    assert('that segment carries real damage', (lynaeIntro?.damage ?? 0) > 0);
}

// ── No double-count when the player's own rotation also includes the
//    auto-cast Intro step (Mornye: her key literally is 'intro') ───────────
{
    const { team: teamA, resolveBuild: resolveA } =
        teamWith(lynaeReso, mornyeReso, ['intro', 'basic_basic_attack_1']);
    const resultA = simulateTeamRotation({ team: teamA, resolveBuild: resolveA, dataset: d, target, passCount: 1 });

    const { team: teamB, resolveBuild: resolveB } =
        teamWith(lynaeReso, mornyeReso, ['basic_basic_attack_1']);
    const resultB = simulateTeamRotation({ team: teamB, resolveBuild: resolveB, dataset: d, target, passCount: 1 });

    const totalA = resultA.memberTotals.find(m => m.resonatorId === MORNYE_ID)?.damage ?? NaN;
    const totalB = resultB.memberTotals.find(m => m.resonatorId === MORNYE_ID)?.damage ?? NaN;
    assert('manually placing the auto-cast Intro step changes nothing — it is stripped in team context',
        Number.isFinite(totalA) && Math.abs(totalA - totalB) < 1e-6);

    const introSeg = resultA.segments.find(s => s.kind === 'intro' && s.resonatorId === MORNYE_ID);
    const rotSeg = resultA.segments.find(s => s.kind === 'rotation' && s.resonatorId === MORNYE_ID);
    assert('the rotation segment no longer contains a second Intro step',
        !!rotSeg && !rotSeg.steps.some(s => s.skillType === 'intro'));
    assert('the auto-injected intro segment is still the one source of intro damage',
        (introSeg?.damage ?? 0) > 0);
}

// ── Build editor (direct simulateRotation) is unaffected ────────────────────
{
    const build = createBuild(mornyeReso);
    build.rotation = ['intro', 'basic_basic_attack_1'];
    const sim = simulateRotation({ build, dataset: d, target });
    assert('build-editor simulateRotation still honors a manually placed Intro step',
        sim.steps.some(s => s.skillType === 'intro') && sim.totals.stepCount === 2);
}

console.log(`\nteam-sim: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
