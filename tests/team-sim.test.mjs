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
import { createBuild, setChain } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const referenceRotations = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));

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


// ── Cross-pass propagation (OPEN-ITEMS #31, maintainer direction 2026-08-02) ──
// A single rotation attributes only what falls inside its own window. The TEAM
// sim runs up to 3 passes, and effects/buffs/debuffs must carry from one pass
// to the next. Three lanes, all pinned here because each has a different owner:
//   1. debuffs   — one global enemy timeline across every pass
//   2. team buffs — the shared team-buff timeline, with true (unclipped) ends
//   3. own effects — a member's OWN timed effects, via the trigger-fire ledger
{
    const target = { level: 90, atkLv: 90, resistances: {} };
    const buildFor = (resonatorId) => {
        const resonator = d.resonators.find(entry => entry.id === resonatorId);
        let build = setChain(createBuild(resonator), 6);
        const reference = referenceRotations[String(resonatorId)];
        if (reference) {
            build.rotation = reference.rotation.filter(
                key => d.autoSkillMap[String(resonatorId)][key] || key === '__echo__');
            if (reference.resonanceMode) build.resonanceMode = reference.resonanceMode;
        }
        return build;
    };
    const runTeam = (ids, passCount) => {
        let team = createTeam();
        const builds = new Map();
        ids.forEach((id, index) => {
            const build = buildFor(id);
            builds.set(build.id, build);
            team = setTeamSlot(team, index, build.id);
        });
        return simulateTeamRotation({
            team, resolveBuild: (id) => builds.get(id) ?? null, dataset: d, target, passCount,
        });
    };

    // Lane 1 — the enemy timeline is global, so status damage compounds across
    // passes rather than restarting: stacks left standing by pass 1 are still on
    // the enemy when pass 2 begins.
    const BULING = 1307, PHOEBE = 1506, ZANI = 1507;
    const [onePass, threePass] = [runTeam([BULING, PHOEBE, ZANI], 1), runTeam([BULING, PHOEBE, ZANI], 3)];
    const shareOf = (result) => result.totals.statusDmg / result.totals.damage;
    assert('status damage accrues across passes, not per-pass',
        threePass.totals.statusDmg > onePass.totals.statusDmg * 2.5);
    assert('...and compounds, because stacks survive the pass boundary',
        shareOf(threePass) > shareOf(onePass));

    // Lane 2 — pass 1 starts cold; every later pass opens inside teammates'
    // still-live team-wide windows, so a member hits harder from pass 2 on and
    // passes 2+ agree (steady state).
    {
        const result = runTeam([1404, 1607, 1304], 3);   // any 3 with reference rotations
        const damageByPass = new Map();
        for (const segment of result.segments) {
            if (segment.kind !== 'rotation') continue;
            const id = `${segment.resonatorId}|${segment.pass}`;
            damageByPass.set(id, (damageByPass.get(id) ?? 0) + segment.damage);
        }
        const first = result.segments.find(segment => segment.kind === 'rotation')?.resonatorId;
        const perPass = [0, 1, 2].map(pass => damageByPass.get(`${first}|${pass}`) ?? 0);
        assert('a member is never WEAKER on a later pass than on the cold first one',
            perPass[1] >= perPass[0] - 1e-6 && perPass[2] >= perPass[0] - 1e-6);
        assert('...and passes 2 and 3 agree — the loop has settled',
            Math.abs(perPass[2] - perPass[1]) < 1e-6);
    }

    // Lane 3 — a member's OWN timed effect survives their swap-out. Encore's S4
    // is a 30s window opened by a Heavy Attack; his segment is far shorter, so
    // before the fire ledger carried across passes it was truncated at the
    // segment boundary and silently restarted from nothing next pass.
    {
        const result = runTeam([1102, 1103, 1105], 3);
        const carried = [];
        for (const segment of result.segments) {
            if (!segment.simResult || segment.pass === 0) continue;
            for (const window of segment.simResult.effectWindows ?? []) {
                // Active from the segment's very first step = it came in already open.
                if (window.start < 1e-6 && window.effect?.window?.seconds > 0) carried.push(window.key);
            }
        }
        assert('a timed self-effect can arrive already open on a later pass',
            carried.length > 0);
    }

    // The ledger itself: local times, and a fire from an earlier pass is negative.
    {
        const build = buildFor(1102);
        const solo = simulateRotation({ build, dataset: d, target });
        assert('a rotation reports the trigger-fire ledger it ends with',
            Array.isArray(solo.fires?.types) && Array.isArray(solo.fires?.keys));
        assert('...on the local clock, so every fire is inside the rotation',
            solo.fires.types.every(([, time]) => time >= 0 && time <= solo.totals.time + 1e-6));
        // Carrying in a fire 5s before the start must not invent a fire inside it.
        const seeded = simulateRotation({
            build, dataset: d, target,
            carryInFires: { types: [['heavy', -5]], keys: [] },
        });
        assert('a carried-in fire never becomes a cast of this rotation',
            seeded.steps.length === solo.steps.length);
        assert('solo sims are unaffected by the carry-in plumbing',
            Math.abs(solo.totals.damage - simulateRotation({ build, dataset: d, target }).totals.damage) < 1e-9);
    }

    // ── The optional curated OPENING pass ───────────────────────────────────
    // `build.openerRotation` runs on pass 0 and nowhere else. It exists because
    // the first member on field gets no Intro, so a loop written to open off
    // its own Intro (Chisa's begins on basic_2, which only her Intro unlocks)
    // cannot be performed on the opening pass — and the player's real answer is
    // a DIFFERENT sequence, not the same one with filler bolted on.
    {
        const chisa = buildFor(1508);
        const opener = referenceRotations['1508'].openerRotation;
        assert('Chisa ships a curated opening pass', Array.isArray(opener) && opener.length > 0);
        assert('…and it is not just the loop again',
            opener.join() !== referenceRotations['1508'].rotation.join());

        const withOpener = { ...chisa, openerRotation: [...opener] };
        let team = createTeam();
        const builds = new Map([[withOpener.id, withOpener]]);
        team = setTeamSlot(team, 0, withOpener.id);
        const run = (build) => {
            const map = new Map([[build.id, build]]);
            return simulateTeamRotation({
                team: setTeamSlot(createTeam(), 0, build.id),
                resolveBuild: (id) => map.get(id) ?? null, dataset: d, target, passCount: 3 });
        };
        const keysOf = (result, pass) => (result.segments
            .find(segment => segment.slotIndex === 0 && segment.kind === 'rotation' && segment.pass === pass)
            ?.steps ?? []).map(step => step.skillKey);

        const opened = run(withOpener);
        assert('pass 1 runs the opening rotation', keysOf(opened, 0).join() === opener.join());
        assert('pass 2 runs the steady-state loop',
            keysOf(opened, 1).join() === chisa.rotation.filter(key => key !== 'intro').join());
        assert('pass 3 runs it too', keysOf(opened, 2).join() === keysOf(opened, 1).join());

        // Absent, nothing changes — the 55 resonators without one are untouched.
        const plain = run({ ...chisa, openerRotation: [] });
        assert('no opener → every pass is the loop',
            keysOf(plain, 0).join() === keysOf(plain, 1).join());
        assert('…and an absent opener leaves the damage exactly as it was',
            Math.abs(run({ ...chisa, openerRotation: [] }).totals.damage - plain.totals.damage) < 1e-9);
        assert('an opener changes pass 1 and therefore the total',
            Math.abs(opened.totals.damage - plain.totals.damage) > 1);
        // The loop is never mutated — only the turn's copy carries the swap.
        assert('the build itself is not rewritten', withOpener.rotation.join() === chisa.rotation.join());
        assert('team is still a valid single-slot team', team.slots.filter(Boolean).length === 1 && builds.size === 1);
    }

    // ── WHICH Intro the swap casts ──────────────────────────────────────────
    // An Intro node can ship several damage rows, so `skillType === 'intro'`
    // does not identify ONE key: Aemeath has intro_songs_across_the_universe
    // and intro_debut_of_meteoric_radiance, Denia intro_it_s_been_a_while and
    // intro_knock_knock. Taking whichever the skill map listed first cast an
    // Intro the build never asked for — and Aemeath's reference rotation opens
    // on skill_mech_3, which only the Intro she NAMES unlocks, so the team ran a
    // sequence its own validator rejects. The authored step is stripped before
    // the rotation segment, so nothing downstream could see the discrepancy.
    {
        const introKeysOf = (resonatorId) => Object.entries(d.autoSkillMap[String(resonatorId)] ?? {})
            .filter(([key, def]) => !key.startsWith('_') && def?.skillType === 'intro')
            .map(([key]) => key);
        const multiIntro = [1210, 1211].filter(id => introKeysOf(id).length > 1);
        assert('the roster really does ship resonators with more than one Intro row',
            multiIntro.length === 2);

        const result = runTeam([1508, 1211, 1210], 1);
        for (const resonatorId of multiIntro) {
            const authored = buildFor(resonatorId).rotation.find(key => introKeysOf(resonatorId).includes(key));
            const introStep = result.segments
                .find(segment => segment.kind === 'intro' && segment.resonatorId === resonatorId)
                ?.steps?.[0];
            assert(`${resonatorId}: the swap casts the Intro the rotation names`,
                !!authored && introStep?.skillKey === authored);
        }
        // A build that names no Intro still gets one — the swap-in cast is not
        // optional, and this is the path every un-authored rotation takes.
        const bare = { ...buildFor(1210), rotation: ['__echo__'] };
        let team = createTeam();
        const builds = new Map();
        [buildFor(1508), bare].forEach((build, index) => {
            builds.set(build.id, build);
            team = setTeamSlot(team, index, build.id);
        });
        const fallback = simulateTeamRotation({
            team, resolveBuild: (id) => builds.get(id) ?? null, dataset: d, target, passCount: 1 });
        assert('a rotation naming no Intro still gets the auto-injected one',
            !!fallback.segments.find(segment => segment.kind === 'intro' && segment.resonatorId === 1210)?.steps?.length);
    }
}


console.log(`\nteam-sim: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
