/**
 * Outro Skills: their DAMAGE, their mode-gated buffs, and the cap raise one of
 * them opens.
 *
 *   node tests/outro.test.mjs
 *
 * Three defects this pins, all found 2026-08-07 while chasing a 2.6x team-DPS
 * shortfall against a published benchmark:
 *
 *  1. An Outro node's `level` map is EMPTY — the skill does not scale with skill
 *     level — so preprocess walked zero params and 55 of 56 resonators shipped
 *     with no outro damage row at all. team-sim scored a hard-coded 0 for every
 *     swap in every team, losing up to 795% of ATK per member per pass.
 *  2. An outro that is a MODE MENU was read as one flat grant: Denia's took its
 *     value from the Tune Strain branch and its duration from the Fusion Burst
 *     one, then handed the mix to every build regardless of mode.
 *  3. Chisa's Outro raises the max stacks of every Negative Status by 3, which
 *     doubles this roster's Fusion Burst damage. It was in no table at all.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createBuild, setChain } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';
import { capRaiseOutroGates, capRaiseWindowsFromInflicts, buildEnemyStatusTimeline, STATUS_CAP_RAISES } from '../src/core/enemy-status.js';

// The game's own per-stack table — the lift is only worth what this says.
const NS_TABLE = JSON.parse(readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../data/status-damage.json'), 'utf8')).statuses;

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const target = { level: 90, atkLv: 90, resistances: {} };
const byName = (name) => d.resonators.find(r => r.name === name);
const outroEntry = (id) => Object.entries(d.autoSkillMap[String(id)] ?? {})
    .find(([key, def]) => !key.startsWith('_') && def.skillType === 'outro') ?? null;

// ── The rows exist, and only where the game states damage ────────────────────
{
    // 13 until 2026-08-13, when the second sentence shape (see the bottom of
    // this file) recovered Lynae's and Iuno's. The remaining 41 outros state no
    // damage at all — they are buff/heal transfers, which is ordinary WuWa
    // design, so this number is NOT expected to keep climbing toward 56.
    const withRow = d.resonators.filter(r => outroEntry(r.id));
    assert(`15 resonators have an outro damage row (got ${withRow.length})`, withRow.length === 15);

    const [key, def] = outroEntry(byName('Carlotta').id);
    const row = d.damageTable['1107'].find(entry => entry.id === def.damageIds[0]);
    assert('Carlotta\'s outro key is derived from the skill name', key === 'outro_closing_remark');
    assert('…its multiplier is the 794.2% the description states',
        Math.abs(row.mults[9] - 7.942) < 1e-9);
    assert('…and it is FLAT across the level band (an Outro has no level curve)',
        row.mults[0] === row.mults[19] && row.mults.length === 20);
    assert('…scaling and element come from the node (Glacio, ATK)',
        row.element === 1 && row.relatedProp === 7);
    assert('an outro row is never offered in the rotation palette', def.paletteInclude === false);

    // The three whose outro damage is already paid by the off-field lane must
    // NOT also carry a row that the team sim would cast — Calcharo and
    // Rover: Havoc summon, Galbrena bursts.
    for (const name of ['Calcharo', 'Rover: Havoc']) {
        const resonator = byName(name);
        assert(`${name}'s outro damage stays in the off-field lane only`,
            !outroEntry(resonator.id)
            && resonator.offFieldActions.some(action => action.trigger === 'outro'));
    }
}

// ── The team sim casts them, credits the outgoing member, and refuses the
//    double count ─────────────────────────────────────────────────────────────
function runTeam(names, rotations = {}) {
    let team = createTeam();
    const builds = new Map();
    names.forEach((name, index) => {
        const resonator = byName(name);
        const build = setChain(createBuild(resonator), 0);
        const map = d.autoSkillMap[String(resonator.id)];
        build.rotation = (rotations[name] ?? Object.keys(map).filter(k => !k.startsWith('_')).slice(0, 2));
        builds.set(build.id, build);
        team = setTeamSlot(team, index, build.id);
    });
    return simulateTeamRotation({ team, resolveBuild: (id) => builds.get(id) ?? null, dataset: d, target, passCount: 1 });
}

{
    const result = runTeam(['Carlotta', 'Sanhua']);
    const outro = result.segments.find(s => s.kind === 'outro' && s.resonatorId === 1107);
    assert('Carlotta\'s outro segment carries real damage', (outro?.damage ?? 0) > 0);
    assert('…and its one step is the outro row', outro?.steps?.length === 1);
    // The outro plays in parallel with the incoming Intro, so it must not push
    // the shared cursor — its window overlaps the next segment rather than
    // preceding it (the same rule the segment's own note states).
    assert('the outro does not advance the shared cursor',
        Math.abs((outro.endTime - outro.startTime) - 1) < 1e-6);
    const carlottaTotal = result.memberTotals.find(m => m.resonatorId === 1107);
    assert('outro damage is credited to the OUTGOING member',
        carlottaTotal.damage >= outro.damage);

    // Galbrena's outro is already paid as an outroBurst off-field action; the
    // segment must stay at zero or the same cast is counted twice.
    const galbrena = runTeam(['Galbrena', 'Sanhua']);
    const gOutro = galbrena.segments.find(s => s.kind === 'outro' && s.resonatorId === 1208);
    assert('Galbrena\'s outro segment stays at 0 (the off-field lane owns it)',
        (gOutro?.damage ?? 0) === 0);

    // A buff-only outro still produces a segment, just with no damage.
    const chisa = runTeam(['Chisa', 'Sanhua']);
    const cOutro = chisa.segments.find(s => s.kind === 'outro' && s.resonatorId === 1508);
    assert('a buff-only outro still emits a segment, at 0 damage',
        !!cOutro && cOutro.damage === 0);
}

// ── Mode-gated outro buffs ───────────────────────────────────────────────────
{
    const denia = byName('Denia');
    assert('Denia\'s outro has exactly one grant, and it is mode-gated',
        denia.outroBuffs.length === 1 && denia.outroBuffs[0].mode === 'tune_strain');
    assert('…with the Tune Strain branch\'s OWN value and duration (15% / 16s)',
        Math.abs(denia.outroBuffs[0].value - 0.15) < 1e-9 && denia.outroBuffs[0].duration === 16);
    assert('…and the Fusion Burst branch grants nothing here — it amplifies the '
        + 'STATUS\'s damage, not the wielder\'s hits',
        !denia.outroBuffs.some(buff => buff.mode === 'fusion_burst'));

    // The gate is honoured at hand-off: the same Denia grants the amplify in one
    // mode and nothing in the other.
    const runMode = (mode) => {
        let team = createTeam();
        const builds = new Map();
        [['Denia', mode], ['Sanhua', null]].forEach(([name, m], index) => {
            const resonator = byName(name);
            const build = setChain(createBuild(resonator), 0);
            const map = d.autoSkillMap[String(resonator.id)];
            build.rotation = Object.keys(map).filter(k => !k.startsWith('_')).slice(0, 3);
            if (m) build.resonanceMode = m;
            builds.set(build.id, build);
            team = setTeamSlot(team, index, build.id);
        });
        const result = simulateTeamRotation({ team, resolveBuild: (id) => builds.get(id) ?? null, dataset: d, target, passCount: 1 });
        return result.memberTotals.find(m => m.resonatorId === 1102).damage;
    };
    assert('Sanhua takes MORE from a Tune Strain Denia than a Fusion Burst one',
        runMode('tune_strain') > runMode('fusion_burst'));
}

// ── Chisa's Outro cap raise ──────────────────────────────────────────────────
{
    assert('Chisa owns a cap raise', !!STATUS_CAP_RAISES[1508]);
    const gates = capRaiseOutroGates(12.5, 1508, 0);
    assert('her outro opens a 20s gate at the swap',
        gates.length === 1 && gates[0].start === 12.5 && gates[0].end === 32.5);
    assert('a resonator without an outro-gated raise opens none',
        capRaiseOutroGates(12.5, 1102, 0).length === 0);
    // Suisui's raise is gated on a rotation STEP, not the outro — the two lanes
    // must not leak into each other.
    assert('Suisui\'s step-gated raise is not an outro gate',
        capRaiseOutroGates(12.5, 1110, 0).length === 0);

    // What the raise DOES: it lifts the cap in force, which for a resetOnMax
    // status like Fusion Burst is the DETONATION point. 10 → 13 stacks, and the
    // game's own per-stack table takes the multiplier 6.9863 → 13.9726 — the
    // burst lands later and is worth twice as much.
    const applications = Array.from({ length: 16 }, (_, i) => ({
        status: 'fusion_burst', t: i * 0.5, stacks: 1, applicatorId: 1211, applicatorLevel: 90,
    }));
    const raises = capRaiseWindowsFromInflicts(
        applications,
        [{ resonatorId: 1508, chain: 0 }, { resonatorId: 1211, chain: 0 }],
        capRaiseOutroGates(0, 1508, 0));
    const raised = buildEnemyStatusTimeline(applications, raises);
    const plain = buildEnemyStatusTimeline(applications, []);
    assert('the base Fusion Burst cap is 10', plain.capAt('fusion_burst', 2) === 10);
    assert('…and 13 while Chisa\'s Resonant Thread of Closure holds',
        raised.capAt('fusion_burst', 2) === 13);
    assert('the raise lapses with the 20s gate, not silently forever',
        raised.capAt('fusion_burst', 60) === 10);
    assert('the per-stack table doubles across that lift',
        Math.abs(NS_TABLE.fusion_burst.byStacks['13'] / NS_TABLE.fusion_burst.byStacks['10'] - 2) < 0.01);
}

// ── The SECOND outro-damage sentence shape (2026-08-13) ─────────────────────
// The game writes outro damage two ways, and the pass above read only one of
// them: "deals <Element> DMG equal to X% of <name>'s ATK". The other puts the
// multiplier FIRST and names no scaling stat at all — "Attack the target and
// deal {0} Spectro DMG" — and two resonators ship ONLY that shape, so their
// outro damage was dropped silently, with no warning and no diff.
{
    const outroRowOf = (id) => {
        const damageId = outroEntry(id)?.[1]?.damageIds?.[0];
        return damageId == null ? null
            : (d.damageTable[String(id)] ?? []).find(row => row.id === damageId) ?? null;
    };

    for (const [id, name, element] of [[1509, 'Lynae', 5], [1410, 'Iuno', 4]]) {
        const row = outroRowOf(id);
        assert(`${name}'s outro ships a damage row`, !!row);
        assert(`${name}'s outro multiplier is the stated 100%`, row?.mults?.[0] === 1);
        assert(`${name}'s outro carries her own element`, row?.element === element);
        // Neither node states a scaling stat and both ship an empty `damage`
        // map, so this is the ATK default — pinned so a future edit that starts
        // guessing a stat here is visible.
        assert(`${name}'s outro scales off ATK`, row?.relatedProp === 7);
        assert(`${name}'s outro has NO level curve`,
            !!row && row.mults.length === 20 && new Set(row.mults).size === 1);
    }

    // The other half of the same finding, pinned so it does not get "fixed"
    // back: an Outro Skill with no damage clause must stay at ZERO. All three of
    // the benchmark team's outros are buff-only in the GAME's own text (Chisa's
    // raises negative-status max stacks; Denia's and Aemeath's hand mode-gated
    // amplification to the incoming resonator), so a zero there is the right
    // answer and not a missing extraction. This was reported as a defect twice.
    for (const [id, name] of [[1508, 'Chisa'], [1211, 'Denia'], [1210, 'Aemeath']]) {
        assert(`${name}'s buff-only outro correctly deals no damage`, outroEntry(id) === null);
    }
}

console.log(`outro: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
