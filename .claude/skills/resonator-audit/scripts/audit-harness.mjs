/**
 * Resonator audit harness — solo and team, from a cold start.
 *
 *   node .claude/skills/resonator-audit/scripts/audit-harness.mjs <resonatorId> [options]
 *
 *   --team <id,id>     teammates (2 ids). Omit to auto-pick from wuwa-meta.json.
 *   --mode <name>      resonance mode for the SUBJECT (fusion_burst, tune_strain, ...)
 *   --passes <n>       team passes (default 3 — steady state; 1 is opener-only)
 *   --zero-res         target with no resistances (the optimizer's target)
 *   --real-echoes      equip real echoes instead of stat-only templates
 *   --json             machine-readable dump instead of the report
 *
 * WHY THIS EXISTS: every number in an audit has to come from the same engine
 * the app runs, with the same target and the same denominator. Hand-rolled
 * probes drift — this one mirrors tools/benchmark-gap.mjs, which is the
 * calibrated reference harness.
 *
 * READ BEFORE TRUSTING OUTPUT:
 *   - The DPS denominator is gameTime (totalTime - freeze), never wall clock.
 *   - Team totals must be read from memberTotals, not by summing segments:
 *     the negative-status lane is accrued post-hoc on a shared timeline.
 *   - Per-pass figures are MARGINALS (N-pass total minus (N-1)-pass total),
 *     so that shared lane is attributed rather than dropped.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBuild, setChain, setEcho, setWeapon, pickEchoId } from '../../../../src/core/build.js';
import { simulateRotation } from '../../../../src/core/sim.js';
import { simulateTeamRotation } from '../../../../src/core/team-sim.js';
import { applyPatch } from '../../../../src/data/loader.js';
import { analyzeRotation } from '../../../../src/core/rotation-graph.js';
import {
    rulesForResonator, stageGrantsForResonator, swapInEntryForResonator,
    resourceDefsForResonator, stateDefsForResonator,
} from '../../../../src/core/rotation-rules.js';
import { templateStats } from '../../../../tools/optimize/reference-build.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (name) => JSON.parse(readFileSync(resolve(ROOT, 'data', name), 'utf8'));

// patch.json is a RUNTIME overlay that preprocess never bakes in. Skipping it
// silently drops curated offFieldActions (Denia's Erosion Field, Phrolova's).
const dataset = applyPatch(read('wuwa-data.json'), read('patch.json'));
const meta = read('wuwa-meta.json');
const references = read('reference-rotations.json');
const rotationsById = references.rotations ?? references;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback = null) => {
    const flagIndex = argv.indexOf(name);
    return flagIndex >= 0 && argv[flagIndex + 1] ? argv[flagIndex + 1] : fallback;
};

const subjectId = Number(argv[0]);
if (!Number.isFinite(subjectId)) throw new Error('usage: audit-harness.mjs <resonatorId> [options]');

const PASSES = Number(value('--passes', '3'));
// team-editor-v2.js:204 — what the app's own team page sims against.
const TARGET_APP = { level: 90, atkLv: 90, resistances: { 0: 0, 1: 0.1, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 } };
// tools/optimize/sim-eval.js:16 — the offline optimizer's target.
const TARGET_ZERO = { level: 90, atkLv: 90, resistances: {} };
const target = flag('--zero-res') ? TARGET_ZERO : TARGET_APP;

const resonatorOf = (id) => dataset.resonators.find(entry => entry.id === Number(id));
const nameOf = (id) => resonatorOf(id)?.name ?? String(id);
const skillMapOf = (id) => dataset.autoSkillMap[String(id)] ?? {};

// ── Team selection ───────────────────────────────────────────────────────────
// wuwa-meta.json teams.byCharacter is the optimizer's own ranking, so an
// auto-picked team is the one the app would suggest — not one invented here.
function pickTeam(id) {
    const explicit = value('--team');
    if (explicit) return explicit.split(',').map(Number);
    const suggestions = meta.teams?.byCharacter?.[String(id)] ?? [];
    const best = suggestions[0];
    if (!best) return [];
    return best.members.filter(member => Number(member) !== Number(id)).slice(0, 2);
}

// ── Build construction (mirrors tools/benchmark-gap.mjs memberBuild) ─────────
function representativeWeapon(resonator) {
    if (resonator.signatureWeaponId) return resonator.signatureWeaponId;
    const sameType = dataset.weapons.filter(weapon => weapon.weaponType === resonator.weaponType);
    const best = sameType.filter(weapon => weapon.rarity === 5).sort((left, right) => left.id - right.id)[0];
    return (best ?? sameType[0])?.id ?? null;
}

function buildFor(id, { rotation, mode }) {
    const resonator = resonatorOf(id);
    if (!resonator) throw new Error(`resonator ${id} not in dataset`);
    const roles = resonator.roles ?? [];
    const template = templateStats(resonator, dataset, roles);
    const sonataId = template.sonataId ?? template[0]?.sonataId ?? null;

    let build = setChain(createBuild(resonator), 0);       // S0 — chain effects are a separate axis
    build = setWeapon(build, representativeWeapon(resonator));
    const used = new Set();
    template.forEach((echo, slot) => {
        let echoId = null;
        if (flag('--real-echoes')) {
            echoId = pickEchoId(dataset, echo.sonataId ?? sonataId, echo.cost, resonator.element, used);
            if (echoId != null) used.add(echoId);
        }
        build = setEcho(build, slot, {
            id: echoId, cost: echo.cost, level: 25,
            mainStat: echo.mainStat, subStats: echo.subStats,
            sonataId: echo.sonataId ?? sonataId,
        });
    });
    return {
        ...build,
        id: Number(id),                 // team slots address builds by id
        level: 90,
        resonanceMode: mode ?? resonator.resonanceModes?.[0]?.key ?? null,
        rotation: rotation.slice(),
        rotationMeta: rotation.map(() => ({})),
    };
}

function rotationOf(id) {
    const authored = rotationsById[String(id)]?.rotation;
    if (!authored?.length) throw new Error(`no reference rotation for ${nameOf(id)} (${id}) — author one first`);
    return authored;
}

// The intro team-sim auto-injects: the FIRST intro-typed key. Prepended before
// validation only, because a stage grant hanging off the intro is otherwise
// reported as a false sequence break — the cast happens, it just is not in the
// authored array.
function introKeyOf(id) {
    return Object.entries(skillMapOf(id))
        .find(([key, def]) => !key.startsWith('_') && def?.skillType === 'intro')?.[0] ?? null;
}

function warningsFor(id, authored) {
    const introKey = introKeyOf(id);
    const rotation = introKey ? [introKey, ...authored] : authored.slice();
    return analyzeRotation(rotation, {
        rules: rulesForResonator(id),
        skillMap: skillMapOf(id),
        grants: stageGrantsForResonator(id),
        swapInEntry: swapInEntryForResonator(id),
        resourceDefs: resourceDefsForResonator(id, dataset),
        stateDefs: stateDefsForResonator(id),
    }).warnings;
}

// ── Solo ─────────────────────────────────────────────────────────────────────
function runSolo(id, mode) {
    const build = buildFor(id, { rotation: rotationOf(id), mode });
    const result = simulateRotation({ build, dataset, target });
    return {
        build,
        total: result.totals.damage,
        skill: result.totals.skillDamage,
        status: result.totals.statusDamage,
        gameTime: result.totals.gameTime,
        dps: result.totals.gameTime > 0 ? result.totals.damage / result.totals.gameTime : 0,
        steps: result.steps.map(step => ({
            key: step.skillKey, label: step.label, damage: step.stepDamage,
            hits: step.hitCount, buffs: step.activeBuffNames ?? [],
            missing: step.missing, resolved: step.resolved,
        })),
    };
}

// ── Team ─────────────────────────────────────────────────────────────────────
function runTeam(ids, subjectMode, passCount) {
    const builds = new Map(ids.map(id => [Number(id), buildFor(id, {
        rotation: rotationOf(id),
        mode: Number(id) === subjectId ? subjectMode : null,
    })]));
    return simulateTeamRotation({
        team: { slots: ids.map(Number) },
        resolveBuild: (id) => builds.get(Number(id)) ?? null,
        dataset, target, passCount,
    });
}

// ── Report ───────────────────────────────────────────────────────────────────
const mode = value('--mode');
const teammates = pickTeam(subjectId);
const order = [subjectId, ...teammates].map(Number);

const solo = runSolo(subjectId, mode);
const out = { subject: { id: subjectId, name: nameOf(subjectId), mode: solo.build.resonanceMode }, solo: {}, team: {} };

out.solo = {
    total: Math.round(solo.total), skill: Math.round(solo.skill), status: Math.round(solo.status),
    gameTime: Number(solo.gameTime.toFixed(2)), dps: Math.round(solo.dps),
    zeroDamageSteps: solo.steps.filter(step => !step.damage).map(step => step.key),
    unresolvedSteps: solo.steps.filter(step => step.missing).map(step => step.key),
    warnings: warningsFor(subjectId, rotationOf(subjectId)),
};

if (teammates.length === 2) {
    const full = runTeam(order, mode, PASSES);
    // Marginals: the negative-status lane is accrued post-hoc on the shared
    // timeline, so an (N-1)-pass run subtracted from an N-pass run attributes
    // it instead of dropping it.
    const previous = PASSES > 1 ? runTeam(order, mode, PASSES - 1) : null;
    out.team = {
        members: order.map(id => nameOf(id)),
        passes: PASSES,
        teamDamage: Math.round(full.totals.damage),
        gameTime: Number((full.totals.gameTime ?? full.totals.time).toFixed(2)),
        dps: Math.round(full.totals.damage / (full.totals.gameTime ?? full.totals.time)),
        perMember: full.memberTotals.map((entry, index) => ({
            name: nameOf(order[index]),
            damage: Math.round(entry.damage),
            introDamage: Math.round(entry.introDamage ?? 0),
            onFieldTime: Number((entry.time ?? 0).toFixed(2)),
            share: `${((entry.damage / full.totals.damage) * 100).toFixed(1)}%`,
            lastPassMarginal: previous
                ? Math.round(entry.damage - (previous.memberTotals[index]?.damage ?? 0))
                : null,
        })),
        subjectSoloVsTeam: Number(
            ((full.memberTotals[0]?.damage ?? 0) / PASSES / (solo.total || 1)).toFixed(3)),
    };
} else {
    out.team = { error: 'no team resolved — pass --team <id,id> or add a meta suggestion' };
}

if (flag('--json')) {
    console.log(JSON.stringify({ ...out, soloSteps: solo.steps }, null, 1));
} else {
    const say = (line = '') => console.log(line);
    say(`RESONATOR AUDIT — ${out.subject.name} (${subjectId})  mode=${out.subject.mode ?? 'none'}`);
    say(`target: ${flag('--zero-res') ? '0% RES (optimizer)' : '10% RES (app team page)'}`);
    say();
    say('SOLO');
    say(`  damage ${out.solo.total.toLocaleString()}  (skill ${out.solo.skill.toLocaleString()}, status ${out.solo.status.toLocaleString()})`);
    say(`  gameTime ${out.solo.gameTime}s   dps ${out.solo.dps.toLocaleString()}`);
    if (out.solo.zeroDamageSteps.length) say(`  ZERO-DAMAGE STEPS: ${out.solo.zeroDamageSteps.join(', ')}`);
    if (out.solo.unresolvedSteps.length) say(`  UNRESOLVED STEPS:  ${out.solo.unresolvedSteps.join(', ')}`);
    if (out.solo.warnings.length) say(`  rotation warnings: ${out.solo.warnings.length}`);
    say();
    say('PER-STEP');
    for (const step of solo.steps) {
        say(`  ${String(step.key).padEnd(44)} ${String(Math.round(step.damage || 0)).padStart(9)}  ${step.hits ?? 0} hit(s)`);
    }
    say();
    if (out.team.error) { say(`TEAM — ${out.team.error}`); }
    else {
        say(`TEAM (${out.team.members.join(' → ')}), ${out.team.passes} pass(es)`);
        say(`  damage ${out.team.teamDamage.toLocaleString()}  gameTime ${out.team.gameTime}s  dps ${out.team.dps.toLocaleString()}`);
        for (const member of out.team.perMember) {
            say(`  ${member.name.padEnd(16)} ${String(member.damage).padStart(10)}  ${member.share.padStart(6)}  on-field ${member.onFieldTime}s`
                + (member.lastPassMarginal != null ? `  last-pass ${member.lastPassMarginal.toLocaleString()}` : ''));
        }
        say(`  subject team-pass vs solo rotation: ${out.team.subjectSoloVsTeam}x`);
    }
}
