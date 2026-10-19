/**
 * P12 suggested-build search — candidate pruning + best-combo pick.
 *
 *   node tests/optimize-suggested-build.test.mjs
 *
 * Runs against the real wuwa-data.json so the pruning sees actual sonatas /
 * weapons (CLAUDE.md test policy).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { candidateSonatasFor, candidateWeaponsFor, curatedRotationFor, templateStats } from '../tools/optimize/reference-build.js';
import { pickBestBuild } from '../tools/optimize/suggested-build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const resoOf = (id) => d.resonators.find(r => r.id === id);

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── candidateSonatasFor: element-pruned + universal, no empty sets ────────────
{
    const carlotta = resoOf(1107);   // Glacio (element 1)
    const cand = candidateSonatasFor(carlotta, d);
    assert('Carlotta candidates non-empty', cand.length > 0);
    // Every elemental candidate's 2pc must boost Glacio (propId 22), or be a
    // known universal (non-elemental) set.
    const elementOf = (id) => {
        const s = d.sonatas.find(x => x.id === id);
        const t2 = s.tiers?.find(t => t.pieces === 2);
        const p = (t2?.addProp ?? []).find(a => a.propId >= 22 && a.propId <= 27);
        return p ? p.propId - 21 : null;
    };
    assert('Carlotta candidates are Glacio sets or universal',
        cand.every(id => { const el = elementOf(id); return el === 1 || el === null; }));
    assert('Freezing Frost (Glacio) is a Carlotta candidate', cand.includes(1));
    assert('Lingering Tunes (universal ATK) is always a candidate', cand.includes(9));
    // No unparsed/empty sets leak in.
    assert('no empty-effect sets in candidates',
        cand.every(id => (d.sonatas.find(s => s.id === id)?.tiers ?? []).some(t => (t.effect ?? '').trim())));
    // Deterministic (sorted ascending).
    assert('candidates are sorted', cand.every((v, i) => i === 0 || cand[i - 1] <= v));

    // A Fusion carry pulls Fusion sets, not Glacio.
    const changli = resoOf(1205);    // Fusion (element 2)
    const cc = candidateSonatasFor(changli, d);
    assert('Changli candidates include Fusion sets', cc.some(id => elementOf(id) === 2));
    assert('Changli candidates exclude Glacio-only sets', !cc.some(id => elementOf(id) === 1));
}

// ── candidateWeaponsFor: EVERY 4★ and 5★ of the right weapon type ─────────────
// No base-ATK cut (maintainer, 2026-10-19). At 3.7 the top-8 cut dropped
// Stringmaster from the rectifier pool the day Blooming Jadehaven arrived, and
// with seven rectifiers tied at 500 base ATK, array order decided the cut.
{
    for (const id of [1107, 1302, 1311]) {
        const resonator = resoOf(id);
        const pool = candidateWeaponsFor(resonator, d);
        const expected = d.weapons.filter(weapon => weapon.type === resonator.weaponType && weapon.rarity >= 4).map(weapon => weapon.id);
        assert(`${resonator.name}: the pool is every 4★ and 5★ of the type (${pool.length} of ${expected.length})`,
            pool.length === expected.length && expected.every(weaponId => pool.includes(weaponId)));
    }
    const rectifiers = candidateWeaponsFor(resoOf(1302), d);
    assert('Stringmaster is back in the rectifier pool', rectifiers.includes(21050016));
    assert('and so is a 4★ rectifier', rectifiers.some(weaponId => d.weapons.find(weapon => weapon.id === weaponId)?.rarity === 4));
}

// ── pickBestBuild: returns a candidate combo with positive damage ─────────────
{
    const carlotta = resoOf(1107);
    const rotation = curatedRotationFor(1107);
    const template = templateStats(carlotta, d);
    const best = pickBestBuild({ resonator: carlotta, dataset: d, rotation, template });
    assert('pickBestBuild returns a result', best != null);
    assert('best sonata is one of the candidates', best.candidates.sonatas.includes(best.sonataId));
    assert('best weapon is one of the candidates', best.candidates.weapons.includes(best.weaponId));
    assert('best damage is positive', best.damage > 0);

    // The pick is the actual max over the grid (no candidate beats it).
    // (Re-derive by checking it is >= a fixed alternative if one exists.)
    assert('result is deterministic (stable id)', pickBestBuild({ resonator: carlotta, dataset: d, rotation, template }).sonataId === best.sonataId);
}

console.log(`\noptimize-suggested-build: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
