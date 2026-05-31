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
import { rulesForResonator, hasRules, ROTATION_RULES } from '../src/core/rotation-rules.js';

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

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\nrotation-validation: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
