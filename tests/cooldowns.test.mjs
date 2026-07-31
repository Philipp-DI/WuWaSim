/**
 * Tests for the cooldown overlay (2026-07-12) — tools/preprocess.mjs
 * extraction (skill-map `cooldown`/`cooldownGroup`, echo
 * `activeSkill.cooldown`) + src/core/cooldowns.js tracking + the sim.js /
 * team-sim.js wiring.
 *
 *   node tests/cooldowns.test.mjs
 *
 * Convention under test: the rotation is authored as executed — a violating
 * cast still executes, deals damage, and re-arms its group's timer;
 * `violated` is a diagnostic overlay that never changes damage/time.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { annotateStepCooldowns } from '../src/core/cooldowns.js';
import { simulateRotation, ECHO_STEP_KEY } from '../src/core/sim.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createBuild, setEcho } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const target = { level: 90, atkLv: 90, resistances: {} };

// ── Extraction anchors (data integrity) ─────────────────────────────────────
{
    const m = d.autoSkillMap;
    assert('Sanhua skill carries its 10s cooldown', m['1102'].skill.cooldown === 10);
    assert('Sanhua liberation carries its 16s cooldown', m['1102'].liberation.cooldown === 16);

    // ONE shared "Jade Cleave/Petalfall Cooldown" row → ONE shared timer.
    const jc = m['1108'].skill_jade_cleave, pf = m['1108'].skill_petalfall;
    assert('Hiyuki Jade Cleave/Petalfall share 12s', jc.cooldown === 12 && pf.cooldown === 12);
    assert('…and share ONE cooldownGroup', jc.cooldownGroup === pf.cooldownGroup && !!jc.cooldownGroup);

    const b1 = m['1211'].skill_banish_breakdown_form_1, b2 = m['1211'].skill_banish_breakdown_form_2;
    assert('Denia Banish stages share 4s + one group', b1.cooldown === 4 && b2.cooldown === 4 && b1.cooldownGroup === b2.cooldownGroup);

    // Roster-wide shape: intros are concerto-gated, never CD-gated.
    let cdKeys = 0, introCd = 0;
    for (const keys of Object.values(m)) {
        for (const [k, e] of Object.entries(keys)) {
            if (k.startsWith('_') || e.cooldown == null) continue;
            cdKeys++;
            if (e.skillType === 'intro') introCd++;
            if (e.cooldownGroup == null) introCd += 1000; // group must accompany cooldown
        }
    }
    assert('cooldown coverage present roster-wide (≥130 keys)', cdKeys >= 130);
    assert('no intro key carries a cooldown; every cooldown has a group', introCd === 0);

    // Echoes: every damage-carrying echo has a positive CD from its own desc.
    const withSkill = d.echoes.filter(e => e.activeSkill);
    assert('every damage echo carries activeSkill.cooldown > 0',
        withSkill.length > 150 && withSkill.every(e => e.activeSkill.cooldown > 0));
    const junrock = d.echoes.find(e => e.name === 'Vanguard Junrock');
    const dreamless = d.echoes.find(e => e.name === 'Dreamless');
    assert('anchor echo CDs (Junrock 8s, Dreamless 20s)',
        junrock?.activeSkill?.cooldown === 8 && dreamless?.activeSkill?.cooldown === 20);
}

// ── annotateStepCooldowns: tracker semantics (synthetic) ────────────────────
{
    const skillMap = {
        a: { cooldown: 10, cooldownGroup: 'g1' },
        b: { cooldown: 10, cooldownGroup: 'g1' },   // shares g1 with a
        c: {},                                       // no cooldown
    };
    const step = (skillKey, startTime, index) => ({ skillKey, startTime, index });

    // Re-cast before ready → violated with exact deficit; cast re-arms anyway.
    // a@4 re-arms g1 to 14 — so a@13 violates (deficit 1); had the violating
    // cast NOT re-armed, the timer would still be 10 and a@13 would be legal.
    const s1 = [step('a', 0, 0), step('a', 4, 1), step('a', 13, 2)];
    const v1 = annotateStepCooldowns(s1, { skillMap });
    assert('re-cast before ready is violated with exact deficit',
        v1.length === 2 && s1[1].cd.violated && close(s1[1].cd.deficit, 6) && close(s1[1].cd.blockedUntil, 10));
    assert('violating cast re-arms the timer (authored as executed)',
        s1[2].cd.violated && close(s1[2].cd.deficit, 1) && close(s1[2].cd.blockedUntil, 14));
    assert('first cast is never violated and reports nextReadyAt',
        !s1[0].cd.violated && close(s1[0].cd.nextReadyAt, 10));

    // Group sharing = activation family: a DIFFERENT key inside the armed
    // window is a stage continuation (legal, CD keeps running from the
    // activation); re-casting an already-used key is an early restart.
    const s2 = [step('a', 0, 0), step('b', 5, 1), step('a', 8, 2)];
    const v2 = annotateStepCooldowns(s2, { skillMap });
    assert('same-group sibling inside the window is a legal continuation',
        !s2[1].cd.violated && s2[1].cd.continuation === true && close(s2[1].cd.nextReadyAt, 10));
    assert('restarting an already-used key inside the window is a violation',
        v2.length === 1 && s2[2].cd.violated && close(s2[2].cd.deficit, 2));
    const s2b = [step('a', 0, 0), step('b', 11, 1)];
    const v2b = annotateStepCooldowns(s2b, { skillMap });
    assert('sibling after the window expires is a fresh activation, not a continuation',
        v2b.length === 0 && !s2b[1].cd.violated && s2b[1].cd.continuation === undefined);

    // Exactly-at-ready and no-CD keys are legal / untouched.
    const s3 = [step('a', 0, 0), step('a', 10, 1), step('c', 11, 2)];
    const v3 = annotateStepCooldowns(s3, { skillMap });
    assert('cast exactly at ready time is legal', v3.length === 0 && !s3[1].cd.violated);
    assert('keys without a cooldown are left untouched', s3[2].cd === undefined);

    // Echo steps: gated only when an echo CD is provided.
    const s4 = [step(ECHO_STEP_KEY, 0, 0), step(ECHO_STEP_KEY, 5, 1)];
    const v4 = annotateStepCooldowns(s4, { skillMap, echoCooldown: 20 });
    assert('echo re-cast within echo CD is violated', v4.length === 1 && s4[1].cd.violated && close(s4[1].cd.deficit, 15));
    const s5 = [step(ECHO_STEP_KEY, 0, 0), step(ECHO_STEP_KEY, 5, 1)];
    const v5 = annotateStepCooldowns(s5, { skillMap, echoCooldown: null });
    assert('no echo equipped → echo steps untouched', v5.length === 0 && s5[0].cd === undefined);

    // groupState carry-over: a second call continues the same windows (team path).
    const carry = new Map();
    annotateStepCooldowns([step('a', 0, 0)], { skillMap, groupState: carry });
    const s6 = [step('a', 6, 0)];
    const v6 = annotateStepCooldowns(s6, { skillMap, groupState: carry });
    assert('groupState carry-over persists windows across calls', v6.length === 1 && close(s6[0].cd.deficit, 4));
}

// ── Solo sim integration ────────────────────────────────────────────────────
{
    const sanhua = d.resonators.find(r => r.id === 1102);
    let b = createBuild(sanhua);
    b.rotation = ['skill', 'skill'];   // ~1.3s apart, CD 10 → second violates
    const sim = simulateRotation({ build: b, dataset: d, target });
    assert('solo sim flags the too-early re-cast', sim.cooldownViolations.length === 1 && sim.cooldownViolations[0].index === 1);
    assert('step.cd carries the diagnostic', sim.steps[1].cd?.violated === true && !sim.steps[0].cd.violated);
    assert('violating cast still deals damage (authored as executed)',
        sim.steps[1].stepDamage > 0 && sim.steps[1].stepDamage === sim.steps[0].stepDamage);

    // Legal spacing: skill at t=0, enough basics later that the CD has elapsed.
    // The filler count is DERIVED from the dataset's own timings rather than
    // hardcoded — stepDuration is real extracted animation data now
    // (docs/TIMING_MODEL.md), so any fixed count silently rots when a montage
    // measurement changes. Sanhua's basic_1 was 0.55s fabricated, 0.3333s real.
    const sanhuaSkills = d.autoSkillMap['1102'];
    const fillerCount = Math.ceil(sanhuaSkills.skill.cooldown / sanhuaSkills.basic_1.stepDuration) + 1;
    let b2 = createBuild(sanhua);
    b2.rotation = ['skill', ...Array(fillerCount).fill('basic_1'), 'skill'];
    const sim2 = simulateRotation({ build: b2, dataset: d, target });
    assert('re-cast after the CD elapsed is legal', sim2.cooldownViolations.length === 0);

    // Real stage family (Hiyuki): Jade Cleave → Petalfall is ONE activation
    // (shared 12s group) — back-to-back is legal; restarting Jade Cleave
    // inside the window is the violation.
    const hiyuki = d.resonators.find(r => r.id === 1108);
    let hb = createBuild(hiyuki);
    hb.rotation = ['skill_jade_cleave', 'skill_petalfall'];
    const hSim = simulateRotation({ build: hb, dataset: d, target });
    assert('Hiyuki stage continuation is legal (no violations)', hSim.cooldownViolations.length === 0 && hSim.steps[1].cd.continuation === true);
    let hb2 = createBuild(hiyuki);
    hb2.rotation = ['skill_jade_cleave', 'skill_petalfall', 'skill_jade_cleave'];
    const hSim2 = simulateRotation({ build: hb2, dataset: d, target });
    assert('Hiyuki early sequence restart is flagged', hSim2.cooldownViolations.length === 1 && hSim2.steps[2].cd.violated);

    // Echo re-cast within its own CD; no echo equipped → inert.
    let b3 = createBuild(sanhua);
    b3 = setEcho(b3, 0, { id: d.echoes.find(e => e.name === 'Dreamless').id, cost: 4, level: 25, sonataId: null, mainStat: null, subStats: [] });
    b3.rotation = [ECHO_STEP_KEY, ECHO_STEP_KEY];
    const sim3 = simulateRotation({ build: b3, dataset: d, target });
    assert('equipped echo re-cast within its CD is flagged', sim3.cooldownViolations.length === 1);
    let b4 = createBuild(sanhua);
    b4.rotation = [ECHO_STEP_KEY, ECHO_STEP_KEY];
    const sim4 = simulateRotation({ build: b4, dataset: d, target });
    assert('no echo equipped → echo steps carry no CD annotation', sim4.cooldownViolations.length === 0);
}

// ── Team sim integration: timers persist across passes ─────────────────────
{
    const sanhua = d.resonators.find(r => r.id === 1102);
    const mornye = d.resonators.find(r => r.id === 1209);

    const filler = createBuild(mornye);
    filler.rotation = ['basic_wide_field_observation_mode_1'];
    const sb = createBuild(sanhua);
    sb.rotation = ['skill'];   // one cast per pass; pass gap << 10s CD

    let team = createTeam();
    team = setTeamSlot(team, 0, sb.id);
    team = setTeamSlot(team, 1, filler.id);
    const builds = new Map([[sb.id, sb], [filler.id, filler]]);
    const resolveBuild = (id) => builds.get(id) ?? null;

    const r1 = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 1 });
    assert('single pass → no cross-pass violation possible', r1.cooldownViolations.filter(v => v.skillKey === 'skill').length === 0);

    const r2 = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 2 });
    const skillViolations = r2.cooldownViolations.filter(v => v.resonatorId === 1102 && v.skillKey === 'skill');
    assert('pass-2 re-cast within the CD is flagged (timers persist across passes)', skillViolations.length === 1);
    assert('violation carries team-absolute time + deficit', skillViolations[0].t > 0 && skillViolations[0].deficit > 0);

    // The annotation must be visible on the segments' team-time steps (UI path).
    const violStep = r2.segments
        .filter(s => s.resonatorId === 1102 && s.kind === 'rotation')
        .flatMap(s => s.steps)
        .find(s => s.skillKey === 'skill' && s.cd?.violated);
    assert('segment step copies carry the team-time cd annotation', !!violStep && close(violStep.cd.deficit, skillViolations[0].deficit));

    // Additive guarantee at team level: overlay never changes totals.
    const again = simulateTeamRotation({ team, resolveBuild, dataset: d, target, passCount: 2 });
    assert('team totals deterministic with the cooldown overlay attached', again.totals.damage === r2.totals.damage);
}

console.log(`\ncooldowns: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
