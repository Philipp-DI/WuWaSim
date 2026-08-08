/**
 * "Forte" is PROVENANCE, not a damage type.
 *
 *   node tests/node-type-match.test.mjs
 *
 * A `forte_heavy` node is a Heavy Attack reached through the Forte Circuit —
 * the Forte Circuit is the resonator's specialty and a passive enhancement, and
 * it is never itself a category of damage. So a kit clause that says "Heavy
 * Attack" means that node, and `multiplierUp` has to match it.
 *
 * Strict equality did not, and the effect was dropped in full: Changli's S5
 * +50% and Yangyang: Xuanling's S6 +40% both name a Heavy Attack whose only
 * keys are `forte_heavy` nodes, so both were worth exactly nothing. CLAUDE.md
 * had documented the rule ("a `forte_heavy` node uses 'heavy' for multiplierUp
 * matching") since before it was implemented.
 *
 * The census at the bottom is the real guard: it fails when ANY kit clause
 * states a skill type that no node of that resonator can answer to.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { nodeTypeMatches } from '../src/core/buffs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── The matcher ──────────────────────────────────────────────────────────────
{
    assert('a Heavy clause matches a forte_heavy node', nodeTypeMatches('heavy', 'forte_heavy'));
    assert('a Basic clause matches a forte_basic node', nodeTypeMatches('basic', 'forte_basic'));
    assert('an exact type still matches', nodeTypeMatches('heavy', 'heavy')
        && nodeTypeMatches('liberation', 'liberation'));

    // The provenance prefix is stripped, not ignored: a forte_heavy node is a
    // HEAVY attack, so it must not answer to some other category.
    assert('a Basic clause does NOT match a forte_heavy node', !nodeTypeMatches('basic', 'forte_heavy'));
    assert('a Skill clause does NOT match a forte_heavy node', !nodeTypeMatches('skill', 'forte_heavy'));
    assert('a Liberation clause does NOT match a forte_basic node',
        !nodeTypeMatches('liberation', 'forte_basic'));

    // "forte" on its own is the parse artifact this file is named after — it is
    // not a damage type, so it matches nothing and must not be made to.
    assert('"forte" is not a damage type and matches no node', !nodeTypeMatches('forte', 'forte_heavy')
        && !nodeTypeMatches('forte', 'forte_basic') && !nodeTypeMatches('forte', 'heavy'));

    assert('a null/absent node type matches nothing', !nodeTypeMatches('heavy', null)
        && !nodeTypeMatches('heavy', undefined));
}

// ── The census: no clause may state a type its own kit cannot answer ─────────
{
    const dead = [];
    for (const resonator of dataset.resonators) {
        const nodeTypes = [...new Set(Object.values(dataset.autoSkillMap?.[String(resonator.id)] ?? {})
            .map(node => node.skillType))];
        const effects = [
            ...(resonator.resonanceChain ?? []).flatMap(node => (node.effects ?? []).map(e => [`S${node.level}`, e])),
            ...(resonator.inherentSkills ?? []).flatMap((node, i) => (node.effects ?? []).map(e => [`IH${i}`, e])),
        ];
        for (const [slot, effect] of effects) {
            if (effect.stat !== 'multiplierUp' || !effect.skillType) continue;
            if (effect.skillKeys?.length) continue;          // scoped by NAME, matches by key
            if (!nodeTypes.some(nodeType => nodeTypeMatches(effect.skillType, nodeType))) {
                dead.push(`${resonator.name} ${slot} ${effect.skillType} +${(effect.value * 100).toFixed(0)}%`);
            }
        }
    }
    for (const row of dead) console.error(`  · unmatched: ${row}`);

    // The two survivors both say "forte", which is provenance and not a type:
    // Camellya's clause names "Forte Circuit's Sweet Dream" and Taoqi's is the
    // same shape. They are fixed by NAME-scoping the clause (skill-scope.mjs),
    // not by teaching the matcher a category the game does not have — so this
    // ratchet may only ever shrink.
    assert(`no more than 2 multiplierUp clauses match nothing (got ${dead.length})`, dead.length <= 2);
    assert('both survivors are the "forte" pseudo-type',
        dead.every(row => row.includes(' forte +')));
}

console.log(`node-type-match: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
