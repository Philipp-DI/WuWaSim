/**
 * The Tune Strain chain: Shifting → Tune Break → Interfered → damage.
 *
 * The mechanic is stated in four kits with near-identical wording, which is what
 * makes the derivation worth having — and what these tests are mostly for. The
 * uniformity assertions below are the point: all four responders must agree on
 * the +1 cap raise and the 0.12%-per-point rate, because the game states ONE
 * rule and four copies of it. A future kit that states a different rate is a
 * real finding, and this file names it rather than letting a parser silently
 * average it away.
 *
 * The payout is deliberately conservative in one respect worth pinning: it is
 * ZERO unless all three of a responder, a Tune Break, and a Shifting mark are
 * present. Any of the three missing means the chain never started.
 *
 *   node tests/tune-strain.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
    resolveTuneStrain, interferedCap, boostPointsFor, selfAmplifyFor,
    TUNE_BREAK_BOOST_GRANTS, INTERFERED_EXTRA_STACKS, INTERFERED_SELF_AMPLIFY,
} from '../src/core/tune-break.js';
import { deriveTuneStrain } from '../tools/preprocess/tune-strain.mjs';
import { simulateRotation, TUNE_BREAK_STEP_KEY } from '../src/core/sim.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createBuild, setChain } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const referenceRotations = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const target = { level: 90, resistances: {} };
const DENIA = 1211, LUUK = 1510, LYNAE = 1509, MORNYE = 1209, CARLOTTA = 1107;
const member = (id, chain = 0, mode = null, rotation = []) =>
    ({ resonatorId: id, chain, resonanceMode: mode, rotation });

// ── The derivation, and the uniformity that justifies it ────────────────────
{
    const responders = d.resonators.filter(resonator => resonator.tuneBreak?.strain);
    assert('exactly four resonators respond to Tune Strain - Interfered',
        responders.length === 4);
    assert('...and they are Mornye, Denia, Lynae and Luuk Herssen',
        [MORNYE, DENIA, LYNAE, LUUK].every(id => responders.some(entry => entry.id === id)));

    // The game states ONE rule; these are four copies of it. Disagreement is a
    // finding about the kit, not a parser bug to paper over.
    assert('every responder states the SAME +1 cap raise',
        responders.every(entry => entry.tuneBreak.strain.interferedCapRaise === 1));
    assert('every responder states the SAME 0.12% per point per stack',
        responders.every(entry => entry.tuneBreak.strain.boostPerPoint === 0.0012));

    // …and nobody else is quietly carrying the mechanic.
    assert('a non-responder has no strain block',
        !d.resonators.find(entry => entry.id === CARLOTTA).tuneBreak.strain);
    assert('the derivation reads it from the node text, not from a list',
        deriveTuneStrain(d.resonators.find(entry => entry.id === DENIA))?.respondsToStrain === true
        && deriveTuneStrain(d.resonators.find(entry => entry.id === CARLOTTA)) === null);
}

// ── The cap IS the responder count ──────────────────────────────────────────
{
    assert('one responder caps the target at 1',
        interferedCap([member(DENIA)], d) === 1);
    assert('three responders cap it at 3',
        interferedCap([member(DENIA), member(LUUK), member(LYNAE)], d) === 3);
    assert('a team with none caps it at 0',
        interferedCap([member(CARLOTTA)], d) === 0);
    assert('a non-responder contributes nothing to a team that has some',
        interferedCap([member(DENIA), member(CARLOTTA)], d) === 1);
}

// ── Boost points: GRANTS alone (no dataset ⇒ no base) ──────────────────────
{
    for (const [id, grants] of Object.entries(TUNE_BREAK_BOOST_GRANTS)) {
        assert(`${id}: every Boost grant quotes the kit`,
            grants.every(grant => (grant.quote ?? '').length > 20));
        assert(`${id}: every Boost grant is a positive point count`,
            grants.every(grant => grant.points > 0));
    }
    assert('a kit with no grant contributes nothing',
        boostPointsFor(member(CARLOTTA), [member(CARLOTTA)]) === 0);

    // Denia's mode gate is real: her +10 is "Resonance Mode - Tune Strain".
    assert('Denia grants 10 in Tune Strain mode',
        boostPointsFor(member(DENIA, 0, 'tune_strain'), [member(DENIA, 0, 'tune_strain')]) === 10);
    assert('...and nothing in her other mode',
        boostPointsFor(member(DENIA, 0, 'fusion_burst'), [member(DENIA, 0, 'fusion_burst')]) === 0);
    // Her S2 needs the chain level AND the chain to have fired.
    assert('her S2 +20 needs S2', boostPointsFor(member(DENIA, 1, 'tune_strain'),
        [member(DENIA, 1, 'tune_strain')], { interfered: true }) === 10);
    assert('...and pays out at S2', boostPointsFor(member(DENIA, 2, 'tune_strain'),
        [member(DENIA, 2, 'tune_strain')], { interfered: true }) === 30);

    // Team-wide means team-wide: Denia's grant reaches a teammate who has none.
    assert('a teammate receives Denia\'s team-wide grant',
        boostPointsFor(member(LUUK), [member(DENIA, 0, 'tune_strain'), member(LUUK)]) === 10);

    // Lynae's grant is gated on HER OWN cast being in the rotation.
    const lynaeCasts = new Set(['forte_basic_iridescent_splash']);
    assert('Lynae\'s 40 needs her Iridescent Splash cast',
        boostPointsFor(member(LYNAE), [member(LYNAE)], { keysCast: lynaeCasts }) === 40);
    assert('...and does not apply without it',
        boostPointsFor(member(LYNAE), [member(LYNAE)], { keysCast: new Set() }) === 0);
}

// ── The BASE the game ships (attribute 142 WeaknessMastery) ────────────────
{
    // 10 points for each of the seven Tune-family responders, nothing for
    // anyone else. This is the attribute Pact of Neonlight Leap's 5-piece
    // scales off ("each POINT of Tune Break Boost", Ratio 1), and reading the
    // wrong one (140 WeaknessTotalBonus, 0 on every resonator) is what made the
    // stat look like it had no base at all.
    const withBase = d.resonators.filter(entry => entry.tuneBreakBoostBase > 0);
    assert('exactly seven resonators ship a Tune Break Boost base',
        withBase.length === 7 && withBase.every(entry => entry.tuneBreakBoostBase === 10));
    assert('...and every one of them responds to a Tune family',
        withBase.every(entry => entry.tuneBreak != null));

    assert('a responder holds their base with no grants at all',
        boostPointsFor(member(LUUK), [member(LUUK)], { dataset: d }) === 10);
    assert('a non-responder holds nothing',
        boostPointsFor(member(CARLOTTA), [member(CARLOTTA)], { dataset: d }) === 0);
    assert('base and grants add: Denia base 10 + her mode grant 10',
        boostPointsFor(member(DENIA, 0, 'tune_strain'),
            [member(DENIA, 0, 'tune_strain')], { dataset: d }) === 20);
    assert('...and a non-responder still gets only the team-wide grant',
        boostPointsFor(member(CARLOTTA),
            [member(DENIA, 0, 'tune_strain'), member(CARLOTTA)], { dataset: d }) === 10);
}

// ── Luuk's flat branch: per 10 points, capped, and S2 REPLACES the rate ─────
{
    assert('below 10 points it pays nothing', selfAmplifyFor(member(LUUK), 9) === 0);
    assert('10 points is 5%', Math.abs(selfAmplifyFor(member(LUUK), 10) - 0.05) < 1e-9);
    assert('30 points is 15%', Math.abs(selfAmplifyFor(member(LUUK), 30) - 0.15) < 1e-9);
    assert('it caps at 30%', selfAmplifyFor(member(LUUK), 500) === 0.30);
    assert('S2 doubles the rate rather than adding to it',
        Math.abs(selfAmplifyFor(member(LUUK, 2), 10) - 0.10) < 1e-9);
    assert('...still capped at 30%', selfAmplifyFor(member(LUUK, 2), 500) === 0.30);
    assert('nobody else has a flat branch', Object.keys(INTERFERED_SELF_AMPLIFY).length === 1);
}

// ── The chain needs all three parts, or it pays nothing ────────────────────
{
    const team = [member(DENIA, 6, 'tune_strain')];
    const full = resolveTuneStrain({ members: team, dataset: d, tuneBreaks: 1, shifting: true });
    assert('with responder + Tune Break + mark, it pays', full.stacks === 1
        && full.perMember.get(DENIA).amplify > 0);

    for (const [name, args] of [
        ['no Tune Break', { tuneBreaks: 0, shifting: true }],
        ['no Shifting mark', { tuneBreaks: 1, shifting: false }],
    ]) {
        const partial = resolveTuneStrain({ members: team, dataset: d, ...args });
        assert(`${name} → no stacks and no payout`, partial.stacks === 0
            && partial.perMember.get(DENIA).amplify === 0);
    }
    const none = resolveTuneStrain({ members: [member(CARLOTTA)], dataset: d, tuneBreaks: 1, shifting: true });
    assert('no responder → no stacks and no payout',
        none.cap === 0 && none.stacks === 0 && none.perMember.get(CARLOTTA).amplify === 0);
}

// ── Stacks accrue per Tune Break, and the cap binds ────────────────────────
{
    const solo = [member(DENIA, 6, 'tune_strain')];
    assert('a solo responder is capped at 1 however many Tune Breaks land',
        resolveTuneStrain({ members: solo, dataset: d, tuneBreaks: 3, shifting: true }).stacks === 1);

    const trio = [member(DENIA, 6, 'tune_strain'), member(LUUK), member(LYNAE)];
    // Denia S6 adds a second stack per Tune Break, so one break already lands 2.
    assert('Denia S6 lands 2 stacks per Tune Break',
        resolveTuneStrain({ members: trio, dataset: d, tuneBreaks: 1, shifting: true }).stacks === 2);
    assert('...and three responders let it reach 3',
        resolveTuneStrain({ members: trio, dataset: d, tuneBreaks: 2, shifting: true }).stacks === 3);
    assert('...never past the cap',
        resolveTuneStrain({ members: trio, dataset: d, tuneBreaks: 9, shifting: true }).stacks === 3);

    const base = [member(DENIA, 5, 'tune_strain'), member(LUUK), member(LYNAE)];
    assert('below S6 one break lands one stack',
        resolveTuneStrain({ members: base, dataset: d, tuneBreaks: 1, shifting: true }).stacks === 1);
    assert('every extra-stack rule states its chain level',
        Object.values(INTERFERED_EXTRA_STACKS).flat().every(rule => rule.minChain > 0));
}

// ── Only a RESPONDER converts points into damage ───────────────────────────
{
    // A teammate can hold Boost points and get nothing for them — the payout
    // clause lives on the responder's own Tune Break node.
    const mixed = [member(DENIA, 0, 'tune_strain'), member(CARLOTTA)];
    const result = resolveTuneStrain({ members: mixed, dataset: d, tuneBreaks: 1, shifting: true });
    assert('a non-responder still receives the team-wide points',
        result.perMember.get(CARLOTTA).points === 10);
    assert('...but converts none of them to damage',
        result.perMember.get(CARLOTTA).amplify === 0);
    assert('while the responder does',
        // Denia holds her base 10 + her own team-wide grant 10.
        Math.abs(result.perMember.get(DENIA).amplify - 20 * 0.0012 * 1) < 1e-9);
}

// ── Solo: it reaches real damage, and only with a Tune Break slotted ───────
{
    const denia = d.resonators.find(entry => entry.id === DENIA);
    const rotation = referenceRotations[String(DENIA)].rotation.slice();
    const skillDamage = (chain, withBreak) => {
        const build = { ...setChain(createBuild(denia), chain), level: 90,
            resonanceMode: 'tune_strain',
            rotation: withBreak ? [...rotation, TUNE_BREAK_STEP_KEY] : rotation };
        return simulateRotation({ build, dataset: d, target }).steps
            .filter(step => step.skillKey !== TUNE_BREAK_STEP_KEY)
            .reduce((total, step) => total + step.stepDamage, 0);
    };
    // (base 10 + mode grant 10) x 0.12% x 1 stack = 2.4%; at S2 her +20 lands
    // too, so (10+10+20) x 0.12% = 4.8%.
    for (const [chain, expected] of [[0, 0.024], [2, 0.048]]) {
        const uplift = skillDamage(chain, true) / skillDamage(chain, false) - 1;
        assert(`solo Denia S${chain}: +${(expected * 100).toFixed(1)}% on her other steps`,
            Math.abs(uplift - expected) < 5e-4);
    }
    // S6 grants a SECOND Interfered stack, but a solo responder caps at one —
    // so the payout is unchanged, which is the cap doing its job.
    assert('S6\'s extra stack is clamped by her solo cap of 1',
        Math.abs((skillDamage(6, true) / skillDamage(6, false) - 1) - 0.048) < 5e-4);
}

// ── Team: cap, stacks and payout all reported ─────────────────────────────
{
    const ids = [DENIA, LUUK, LYNAE];
    const build = (withBreak, chain) => {
        let team = createTeam();
        const builds = new Map();
        ids.forEach((id, index) => {
            const resonator = d.resonators.find(entry => entry.id === id);
            const memberBuild = setChain(createBuild(resonator), chain);
            memberBuild.level = 90;
            memberBuild.resonanceMode = (resonator.resonanceModes ?? [])
                .some(mode => mode.key === 'tune_strain') ? 'tune_strain' : null;
            memberBuild.rotation = [...(referenceRotations[String(id)]?.rotation ?? ['intro'])];
            if (withBreak && index === 0) memberBuild.rotation.push(TUNE_BREAK_STEP_KEY);
            builds.set(memberBuild.id, memberBuild);
            team = setTeamSlot(team, index, memberBuild.id);
        });
        return simulateTeamRotation({ team, resolveBuild: (id) => builds.get(id) ?? null,
            dataset: d, target: { level: 90, atkLv: 90, resistances: {} }, passCount: 1 });
    };
    const withoutBreak = build(false, 6);
    const withBreak = build(true, 6);

    assert('the team reports the cap its responders create', withBreak.tuneStrain.cap === 3);
    assert('...and the stacks one Tune Break lands at S6', withBreak.tuneStrain.stacks === 2);
    assert('no Tune Break → no stacks', withoutBreak.tuneStrain.stacks === 0);
    assert('every member is reported, responders flagged',
        withBreak.tuneStrain.members.length === 3
        && withBreak.tuneStrain.members.every(entry => entry.responds));

    const skillOnly = (result) => [...result.memberSteps.values()].flat()
        .filter(step => step.skillKey !== TUNE_BREAK_STEP_KEY)
        .reduce((total, step) => total + step.stepDamage, 0);
    assert('the chain raises the team\'s other damage', skillOnly(withBreak) > skillOnly(withoutBreak));
    assert('...and Luuk gains most, carrying the flat branch too',
        withBreak.tuneStrain.members.find(entry => entry.resonatorId === LUUK).amplify
        > withBreak.tuneStrain.members.find(entry => entry.resonatorId === DENIA).amplify);
}

console.log(`\ntune-strain: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
