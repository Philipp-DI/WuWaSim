/**
 * Tests for P11 §3/§4 sim-output enrichment.
 *
 *   node test/sim-enrichment.test.mjs
 *
 * Covers:
 *   - every step carries a damageCategory in the 7 valid values
 *   - steps carry an activeBuffNames array
 *   - deriveBuffWindows builds contiguous windows with correct start/end
 *   - deriveBuffWindows is empty when no buffs are ever active
 *   - team-sim exposes memberSteps + memberBuffWindows
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { simulateRotation } from '../src/core/sim.js';
import { deriveBuffWindows } from '../src/core/buffs/buff-windows.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createBuild, appendRotationStep } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const VALID_CATEGORIES = new Set(['basic', 'heavy', 'skill', 'liberation', 'echo', 'intro', 'outro']);
const target = { level: 90, atkLv: 90, resistances: {} };

// Pick a resonator with an autoSkillMap so we can build a real rotation.
const rid = Object.keys(d.autoSkillMap).find(k => Object.keys(d.autoSkillMap[k]).length >= 3);
const resonator = d.resonators.find(r => String(r.id) === String(rid));
const skillKeys = Object.keys(d.autoSkillMap[rid]);

// ── §3a: damageCategory on every step ───────────────────────────────────────
{
    let b = createBuild(resonator);
    for (const k of skillKeys.slice(0, 5)) b = appendRotationStep(b, k);
    const sim = simulateRotation({ build: b, dataset: d, target });

    assert('sim returns steps', sim.steps.length === 5);
    assert('every step has a valid damageCategory',
        sim.steps.every(s => VALID_CATEGORIES.has(s.damageCategory)));
    assert('every step has an activeBuffNames array',
        sim.steps.every(s => Array.isArray(s.activeBuffNames)));
    assert('sim exposes a buffTimeline array', Array.isArray(sim.buffTimeline));
    assert('legacy sonata buffWindows field still present', Array.isArray(sim.buffWindows));
}

// ── §3c: deriveBuffWindows contiguity (synthetic, deterministic) ────────────
{
    const steps = [
        { index: 0, startTime: 0,  endTime: 1,  activeBuffNames: [] },
        { index: 1, startTime: 1,  endTime: 2,  activeBuffNames: ['Crit Surge'] },
        { index: 2, startTime: 2,  endTime: 3,  activeBuffNames: ['Crit Surge'] },
        { index: 3, startTime: 3,  endTime: 4,  activeBuffNames: [] },
        { index: 4, startTime: 4,  endTime: 5,  activeBuffNames: ['Crit Surge'] },
    ];
    const w = deriveBuffWindows(steps);
    assert('two separate windows for the re-appearing buff', w.length === 2);
    assert('first window spans steps 1–2', w[0].startStep === 1 && w[0].endStep === 2);
    assert('first window times are correct', w[0].startTime === 1 && w[0].endTime === 3);
    assert('second window stays open to the end', w[1].startStep === 4 && w[1].endStep === 4);
    assert('second window closes at last endTime', w[1].endTime === 5);

    // A buff active to the very end closes at the last step's endTime.
    const allOn = [
        { index: 0, startTime: 0, endTime: 1, activeBuffNames: ['X'] },
        { index: 1, startTime: 1, endTime: 2, activeBuffNames: ['X'] },
    ];
    const wAll = deriveBuffWindows(allOn);
    assert('persisting buff → one window to the end', wAll.length === 1 && wAll[0].endStep === 1 && wAll[0].endTime === 2);
}

// ── §3c: empty when no buffs are ever active ────────────────────────────────
{
    const steps = [
        { index: 0, startTime: 0, endTime: 1, activeBuffNames: [] },
        { index: 1, startTime: 1, endTime: 2, activeBuffNames: [] },
    ];
    assert('no active buffs → no windows', deriveBuffWindows(steps).length === 0);
    assert('empty steps → no windows', deriveBuffWindows([]).length === 0);
}

// ── §4: team-sim exposes memberSteps + memberBuffWindows ─────────────────────
{
    let b = createBuild(resonator);
    for (const k of skillKeys.slice(0, 4)) b = appendRotationStep(b, k);
    b = { ...b, id: 'b_test_member' };
    const builds = new Map([[b.id, b]]);

    const team = setTeamSlot(createTeam('T'), 0, b.id);
    const ts = simulateTeamRotation({
        team, dataset: d, target,
        resolveBuild: (id) => builds.get(id) ?? null,
    });

    assert('team result has memberSteps Map', ts.memberSteps instanceof Map);
    assert('team result has memberBuffWindows Map', ts.memberBuffWindows instanceof Map);
    assert('memberSteps holds the member\'s steps', (ts.memberSteps.get(resonator.id) ?? []).length >= 4);
    assert('memberBuffWindows is keyed by resonatorId', ts.memberBuffWindows.has(resonator.id));

    // Empty team → empty maps (stable shape).
    const empty = simulateTeamRotation({ team: createTeam('E'), dataset: d, target, resolveBuild: () => null });
    assert('empty team → empty memberSteps map', empty.memberSteps instanceof Map && empty.memberSteps.size === 0);
}

// ── Skill labels never name two categories at once ───────────────────────────
// The game files a move under the INPUT that casts it, which is not always what
// it calls the move: Aemeath's Mech basic chain lives inside her Resonance Skill
// node, so the node type is 'skill' while the row is named "Basic Attack - Mech
// Stage 4". Prefixing the node's category produced "Resonance Skill: Basic
// Attack — Mech Stage 4" for 18 keys across 9 resonators.
{
    const CATEGORIES = ['Basic Attack', 'Heavy Attack', 'Resonance Skill',
        'Resonance Liberation', 'Intro Skill', 'Outro Skill'];
    const contradictions = [];
    for (const [resonatorId, map] of Object.entries(d.autoSkillMap)) {
        for (const [key, def] of Object.entries(map)) {
            const label = def.label ?? '';
            const split = label.indexOf(': ');
            if (split < 0) continue;
            const prefix = label.slice(0, split), sub = label.slice(split + 2);
            const named = CATEGORIES.find(category => sub.toLowerCase().startsWith(category.toLowerCase()));
            if (named && !prefix.toLowerCase().startsWith(named.toLowerCase())) {
                contradictions.push(`${resonatorId} ${key}: ${label}`);
            }
        }
    }
    assert(`no label names two categories (found ${contradictions.length}: ${contradictions[0] ?? ''})`,
        contradictions.length === 0);

    // The game's own category wins; the node's annotation is kept.
    assert('Aemeath Mech Stage 4 is a Basic Attack, as the game names it',
        d.autoSkillMap['1210'].skill_mech_4.label === 'Basic Attack: Mech Stage 4');
    assert('...while its mechanical skillType stays the node’s',
        d.autoSkillMap['1210'].skill_mech_4.skillType === 'skill');
    assert('a Forte-accessed Resonance Skill keeps its (Forte) annotation',
        d.autoSkillMap['1306'].forte_heavy_undying_sunlight_strike.label
            === 'Resonance Skill (Forte): Undying Sunlight — Strike');
    assert('an Echo-accessed one keeps (Echo)',
        d.autoSkillMap['1608'].liberation_hecate_1.label === 'Basic Attack (Echo): Hecate Stage 1');
    assert('a label that never contradicted is untouched',
        d.autoSkillMap['1210'].liberation_heavenfall_edict_overdrive.label
            === 'Resonance Liberation: Heavenfall Edict — Overdrive');
}

console.log(`\nsim-enrichment: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
