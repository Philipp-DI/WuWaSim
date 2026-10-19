/**
 * P13 §10 — synergy-hints data integrity (the curated pruning table).
 *
 *   node tests/synergy-hints.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
    ROLE, CHARACTER_ROLES, SYNERGY,
    pairKey, rolesOf, synergyOf, affinityOf, coveredCharacters, tagAffinityForPair,
} from '../tools/optimize/synergy-hints.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const exists = (id) => d.resonators.some(r => r.id === id);

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── every referenced id exists in the dataset ────────────────────────────────
{
    for (const idStr of Object.keys(CHARACTER_ROLES)) {
        assert(`CHARACTER_ROLES id ${idStr} exists in dataset`, exists(Number(idStr)));
    }
    for (const key of Object.keys(SYNERGY)) {
        const [a, b] = key.split('+').map(Number);
        assert(`SYNERGY pair ${key} — both ids exist`, exists(a) && exists(b));
    }
}

// ── roles are valid + non-empty ──────────────────────────────────────────────
{
    const validRoles = new Set(Object.values(ROLE));
    for (const [idStr, roles] of Object.entries(CHARACTER_ROLES)) {
        assert(`${idStr} has a non-empty role list`, Array.isArray(roles) && roles.length > 0);
        assert(`${idStr} roles are all valid ROLE values`, roles.every(r => validRoles.has(r)));
    }
}

// ── every character in SYNERGY has roles assigned ────────────────────────────
{
    for (const key of Object.keys(SYNERGY)) {
        for (const id of key.split('+').map(Number)) {
            assert(`SYNERGY member ${id} has a role list`, rolesOf(id).length > 0);
        }
    }
}

// ── SYNERGY keys are canonical (sorted lo+hi) ────────────────────────────────
{
    for (const key of Object.keys(SYNERGY)) {
        const [a, b] = key.split('+').map(Number);
        assert(`SYNERGY key ${key} is canonical (lo+hi)`, a < b && pairKey(a, b) === key);
        assert(`SYNERGY entry ${key} has a reason`, typeof SYNERGY[key].reason === 'string' && SYNERGY[key].reason.length > 0);
        assert(`SYNERGY entry ${key} affinity is positive`, SYNERGY[key].affinity > 0);
    }
}

// ── pairKey is order-independent ─────────────────────────────────────────────
{
    assert('pairKey order-independent', pairKey(1209, 1510) === pairKey(1510, 1209));
    assert('synergyOf order-independent', synergyOf(1209, 1510) === synergyOf(1510, 1209));
    assert('affinityOf returns 0 for an unhinted pair', affinityOf(1107, 1304) === 0);
    assert('affinityOf returns the curated value for a hinted pair', affinityOf(1209, 1510) === 3);
}

// ── Unison (tag 39, 3.7): a shared tag links the pair ───────────────────────
// No committed resonator carries tag 39 before the 3.7 install, so the rule
// runs on two hand-built resonators.
{
    const resonator = (id, name, tagIds) => ({ id, name, element: 3, roles: tagIds.map(tagId => ({ id: tagId, name: tagId === 39 ? 'Unison' : `tag ${tagId}` })) });
    const hsin = resonator(1311, 'Hsin', [2, 39]), suoming = resonator(1312, 'Suoming', [3, 39]), other = resonator(1, 'Other', [3]);
    const pair = tagAffinityForPair(hsin, suoming);
    assert('two Unison holders get affinity 1', pair?.affinity === 1);
    assert('the Unison reason names both and the tag', /Hsin/.test(pair?.reason) && /Suoming/.test(pair?.reason) && /Unison/.test(pair?.reason));
    assert('one Unison holder alone gets no Unison link', tagAffinityForPair(suoming, other) === null);
}

// ── Hack Response (tag 38): exclusive to the collab pair Rebecca + Lucy ─────
{
    const rebecca = d.resonators.find(resonator => resonator.id === 1308), lucy = d.resonators.find(resonator => resonator.id === 1511);
    const hackTag = (resonator) => resonator?.roles.find(tag => tag.id === 38);
    assert('Rebecca and Lucy carry Hack Response in its own category',
        hackTag(rebecca)?.category === 'hackResponse' && hackTag(lucy)?.category === 'hackResponse');
    assert('only Rebecca and Lucy carry Hack Response',
        d.resonators.filter(hackTag).map(resonator => resonator.id).sort().join(',') === '1308,1511');
    const withoutHack = (resonator) => ({ ...resonator, roles: resonator.roles.filter(tag => tag.id !== 38) });
    const affinity = (first, second) => tagAffinityForPair(first, second)?.affinity ?? 0;
    assert('a shared Hack Response tag adds 1 affinity',
        affinity(rebecca, lucy) === affinity(withoutHack(rebecca), withoutHack(lucy)) + 1);
}

// ── coveredCharacters is deterministic, sorted, and roster-wide ─────────────
{
    const cc = coveredCharacters();
    const sorted = [...cc].sort((a, b) => a - b);
    assert('coveredCharacters is sorted', JSON.stringify(cc) === JSON.stringify(sorted));
    // Roster-wide (2026-07-10 rewrite): every resonator with a role tag is
    // covered, not just a hand-picked anchor seed.
    const taggedIds = d.resonators.filter(r => (r.roles ?? []).length > 0).map(r => r.id);
    assert('coveredCharacters includes every tagged resonator', taggedIds.every(id => cc.includes(id)));
    assert('coveredCharacters has no extra ids beyond tagged resonators', cc.every(id => taggedIds.includes(id)));
}

console.log(`\nsynergy-hints: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
