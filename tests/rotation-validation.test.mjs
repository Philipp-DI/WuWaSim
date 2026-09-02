/**
 * Tests for Phase 10 rotation validation (rotation-graph + rotation-rules).
 *
 * Zero-dependency, runs with plain Node:
 *   node test/rotation-validation.test.mjs
 *
 * Exits non-zero if any assertion fails, so it can gate CI.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
    fromLinear, toLinear, addPrerequisite, prerequisitesSatisfied,
    validateRotation, buildRuleGraph, EdgeKind,
} from '../src/core/rotation-graph.js';
import {
    rulesForResonator, hasRules, ROTATION_RULES,
    CHAIN_LOCKED_SKILLS, resolveChainLockedRotation,
} from '../src/core/rotation-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function assert(name, cond) {
    if (cond) { passed++; }
    else { failed++; console.error(`  ✗ FAIL: ${name}`); }
}

// ── Graph round-trip ─────────────────────────────────────────────────────────
{
    const linear = ['liberation', 'skill', 'basic_1', 'basic_1'];
    const g = fromLinear(linear);
    assert('round-trip preserves order', JSON.stringify(toLinear(g)) === JSON.stringify(linear));
    assert('duplicate keys become distinct nodes', g.nodes.size === 4);
    assert('sequence edges = n-1', g.edges.filter(e => e.kind === EdgeKind.SEQUENCE).length === 3);
}

// ── prerequisitesSatisfied (index-based) ──────────────────────────────────────
{
    const g = addPrerequisite(fromLinear(['skill', 'basic_1']), 'skill', 'basic_1');
    assert('prereq satisfied when ordered correctly', prerequisitesSatisfied(g, 'basic_1') === true);
    const gBad = addPrerequisite(fromLinear(['basic_1', 'skill']), 'skill', 'basic_1');
    assert('prereq unsatisfied when out of order', prerequisitesSatisfied(gBad, 'basic_1') === false);
}

// ── validateRotation: Carlotta ────────────────────────────────────────────────
{
    const rules = rulesForResonator(1107);
    assert('Carlotta has rules', rules.length > 0);

    const bad = ['skill', 'liberation_fatal_finale'];
    const wBad = validateRotation(bad, rules);
    assert('Fatal Finale before Liberation flagged', wBad.some(w => w.skillKey === 'liberation_fatal_finale'));

    const good = ['skill', 'skill_chromatic_splendor', 'forte_heavy_imminent_oblivion',
                  'liberation', 'liberation_death_knell', 'liberation_fatal_finale'];
    assert('valid Carlotta rotation has no warnings', validateRotation(good, rules).length === 0);

    // Occurrence-aware: state persists for later casts
    const repeat = ['liberation', 'liberation_fatal_finale', 'liberation_fatal_finale'];
    assert('repeated Fatal Finale OK after state entered', validateRotation(repeat, rules).length === 0);
}

// ── validateRotation: Hiyuki form gating ──────────────────────────────────────
{
    const rules = rulesForResonator(1108);
    const bad = ['basic_present_1', 'basic_fore_1'];
    assert('Fore basic before Liberation flagged', validateRotation(bad, rules).some(w => w.skillKey === 'basic_fore_1'));
    const good = ['liberation_blade_liberation', 'basic_fore_1', 'heavy_fore'];
    assert('Fore basics OK after Liberation', validateRotation(good, rules).length === 0);
}

// ── validateRotation: edge cases ──────────────────────────────────────────────
{
    assert('empty rotation → no warnings', validateRotation([], rulesForResonator(1107)).length === 0);
    assert('no rules → no warnings', validateRotation(['a', 'b'], []).length === 0);
    assert('unknown resonator → no rules', hasRules(99999) === false);
}

// ── validateRotation: intra-skill stage ordering (P11 §6) ─────────────────────
{
    // A staged family known from the skillMap: Basic Attack Stages 1–3.
    const skillMap = {
        basic_atk_1: { name: 'Basic Attack Stage 1', skillType: 'basic' },
        basic_atk_2: { name: 'Basic Attack Stage 2', skillType: 'basic' },
        basic_atk_3: { name: 'Basic Attack Stage 3', skillType: 'basic' },
        skill:       { name: 'Resonance Skill', skillType: 'skill' },
    };

    const w1 = validateRotation(['basic_atk_3', 'skill'], [], skillMap);
    assert('Stage 3 without Stage 2 produces a warning',
        w1.some(w => w.skillKey === 'basic_atk_3' && w.gate === 'sequence'));

    const w2 = validateRotation(['basic_atk_1', 'basic_atk_2', 'basic_atk_3'], [], skillMap);
    assert('Stages in order produce no warning', w2.length === 0);

    const w3 = validateRotation(['skill', 'basic_atk_1'], [], skillMap);
    assert('Stage ordering does not fire for non-staged skills', w3.length === 0);

    // Stage 1 alone never warns; missing-stage-2 (1 then 3) is flagged.
    const w4 = validateRotation(['basic_atk_1', 'basic_atk_3'], [], skillMap);
    assert('Stage 1→3 (missing 2) flags Stage 3', w4.length === 1 && w4[0].skillKey === 'basic_atk_3');

    // Fallback without a skillMap: rotation-only staged-family detection.
    const w5 = validateRotation(['basic_atk_2', 'basic_atk_1'], []);
    assert('stage check works without skillMap (2 before 1)', w5.some(w => w.skillKey === 'basic_atk_2'));

    // A lone numeric-suffixed key with no sibling stage is not treated as staged.
    const w6 = validateRotation(['heavy_smash_2'], []);
    assert('lone numbered key is not staged → no warning', w6.length === 0);
}

// ── buildRuleGraph: prerequisite edges ────────────────────────────────────────
{
    const good = ['skill', 'skill_chromatic_splendor', 'liberation', 'liberation_fatal_finale'];
    const g = buildRuleGraph(good, rulesForResonator(1107));
    const prereqEdges = g.edges.filter(e => e.kind === EdgeKind.PREREQUISITE);
    assert('rule graph adds prerequisite edges', prereqEdges.length > 0);
    assert('rule graph preserves sequence edges', g.edges.some(e => e.kind === EdgeKind.SEQUENCE));
}

// ── Data integrity: every rule key references a real autoSkillMap entry ───────
{
    const dataPath = resolve(__dirname, '../data/wuwa-data.json');
    const d = JSON.parse(readFileSync(dataPath, 'utf8'));
    let invalid = 0;
    for (const [rid, rules] of Object.entries(ROTATION_RULES)) {
        const keys = new Set(Object.keys(d.autoSkillMap[rid] ?? {}));
        for (const rule of rules) {
            if (!keys.has(rule.skillKey)) invalid++;
            for (const req of rule.requires) if (!keys.has(req)) invalid++;
        }
    }
    assert('all rule keys reference real skill-map entries', invalid === 0);
}

// ── Chain-locked skills: a sequence node can CREATE the skill a step names ───
// Lupa S6 replaces Forte Circuit "Dance With the Wolf" with "Dance With the
// Wolf: Climax". The game ships both as damage rows, so both resolve as
// ordinary keys and nothing stopped an S0 rotation from casting the S6 one —
// her own reference rotation does. Measured: 1.35x on that step, 8.13% across
// her whole reference rotation.
{
    const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
    const references = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));
    const rotationsById = references.rotations ?? references;
    const LUPA = 1207;
    const CLIMAX = 'forte_heavy_dance_with_the_wolf_climax';
    const BASE = 'forte_heavy_dance_with_the_wolf';

    const at = (chain) => resolveChainLockedRotation(['heavy_wolf_s_claw', CLIMAX], LUPA, chain);
    assert('below the unlocking node the step falls back', at(0).rotation[1] === BASE);
    assert('...and says so rather than substituting silently',
        at(0).substitutions.length === 1 && at(0).substitutions[0].from === CLIMAX
        && at(0).substitutions[0].to === BASE && at(0).substitutions[0].minChain === 6);
    assert('one level short still falls back', at(5).rotation[1] === BASE);
    assert('at the unlocking node the real skill is cast', at(6).rotation[1] === CLIMAX);
    assert('...with nothing to report', at(6).substitutions.length === 0);
    assert('above it too', at(6).rotation[1] === CLIMAX && at(6).substitutions.length === 0);

    // The common path must not allocate: callers may compare by identity.
    const untouched = ['basic_1', 'skill'];
    assert('a rotation with no locked step is returned unchanged, by identity',
        resolveChainLockedRotation(untouched, LUPA, 0).rotation === untouched);
    assert('a resonator with no locked skills is a no-op',
        resolveChainLockedRotation(untouched, 9999, 0).rotation === untouched);
    assert('a non-array rotation does not throw',
        resolveChainLockedRotation(null, LUPA, 0).substitutions.length === 0);

    // Roster guard: a lock is only expressible when BOTH keys really exist —
    // a replacement the dataset has no row for is a missing-damage gap instead.
    for (const [resonatorId, locks] of Object.entries(CHAIN_LOCKED_SKILLS)) {
        const keys = Object.keys(dataset.autoSkillMap?.[resonatorId] ?? {});
        for (const [locked, lock] of Object.entries(locks)) {
            assert(`${resonatorId} ${locked} exists in the skill map`, keys.includes(locked));
            assert(`${resonatorId} ${locked} falls back to a key that exists`, keys.includes(lock.fallback));
            assert(`${resonatorId} ${locked} states the node text that creates it`,
                typeof lock.quote === 'string' && lock.quote.length > 0);
            assert(`${resonatorId} ${locked} is gated on a real chain level`,
                Number.isInteger(lock.minChain) && lock.minChain >= 1 && lock.minChain <= 6);
        }
    }

    // The reason this exists at all: her shipped reference rotation names it.
    const lupaRotation = (rotationsById[String(LUPA)] ?? rotationsById[LUPA])?.rotation ?? [];
    assert('Lupa\'s reference rotation still names the chain-locked skill',
        lupaRotation.includes(CLIMAX));
    assert('...and the lock covers it', CHAIN_LOCKED_SKILLS[LUPA][CLIMAX]?.minChain === 6);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\nrotation-validation: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
