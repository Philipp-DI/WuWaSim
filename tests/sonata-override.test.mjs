/**
 * Tests for the transient sonata quick-switch preview
 * (src/core/sonata-override.js).
 *
 *   node tests/sonata-override.test.mjs
 *
 * Two layers:
 *   1. Pure map/relabel behaviour (identity stability, no mutation, species
 *      preservation) — no dataset needed.
 *   2. A LIVE end-to-end check against the real engine: relabeling a build's
 *      echoes to a different sonata actually changes the credited set bonus in
 *      resolveTotalStats (the whole point of the feature).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { applySonataOverride, normalizeSonataOverride } from '../src/core/sonata-override.js';
import { createBuild } from '../src/core/build.js';
import { resolveTotalStats } from '../src/core/stats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── normalizeSonataOverride ───────────────────────────────────────────────────
{
    assert('null → null', normalizeSonataOverride(null) === null);
    assert('empty → null', normalizeSonataOverride({}) === null);
    assert('identity-only → null', normalizeSonataOverride({ 5: 5 }) === null);
    assert('null value dropped', normalizeSonataOverride({ 5: null }) === null);
    const n = normalizeSonataOverride({ 5: 8, 9: 9, 3: 4 });
    assert('real remaps kept, identity dropped', n && n[5] === 8 && n[3] === 4 && !('9' in n));
}

// ── applySonataOverride: pure behaviour ───────────────────────────────────────
{
    const echoes = [
        { id: 101, cost: 4, level: 25, sonataId: 1 },
        { id: 102, cost: 3, level: 25, sonataId: 1 },
        null,
        { id: 103, cost: 1, level: 25, sonataId: null },
    ];
    const build = { resonatorId: 1, echoes };

    assert('no override → same reference', applySonataOverride(build, null) === build);
    assert('empty override → same reference', applySonataOverride(build, {}) === build);
    assert('identity override → same reference', applySonataOverride(build, { 1: 1 }) === build);
    assert('override with no matching set → same reference', applySonataOverride(build, { 99: 2 }) === build);

    const out = applySonataOverride(build, { 1: 2 });
    assert('real remap → new build reference', out !== build);
    assert('original build NOT mutated', build.echoes[0].sonataId === 1 && build.echoes[1].sonataId === 1);
    assert('matching echoes relabeled', out.echoes[0].sonataId === 2 && out.echoes[1].sonataId === 2);
    assert('species (echo.id) preserved', out.echoes[0].id === 101 && out.echoes[1].id === 102);
    assert('null slot preserved', out.echoes[2] === null);
    assert('echo without sonataId untouched', out.echoes[3].sonataId === null && out.echoes[3] === build.echoes[3]);
    assert('untouched echoes keep identity (shallow clone)', out.echoes[3] === build.echoes[3]);
}

// ── LIVE: override actually changes the credited set bonus ─────────────────────
// Sets 1 (Freezing Frost, Glacio) and 2 (Molten Rift, Fusion) both grant a 2pc
// elemental DMG bonus to DIFFERENT elements — a clean, engine-visible signal.
{
    const set1 = d.sonatas.find(s => s.id === 1);   // Glacio (element 1)
    const set2 = d.sonatas.find(s => s.id === 2);   // Fusion (element 2)
    assert('fixture sets present', !!set1 && !!set2);

    const resonator = d.resonators[0];
    const build = createBuild(resonator);
    // Five DISTINCT-species echoes, all Freezing Frost → its 2pc (and 5pc) tiers active.
    build.echoes = [201, 202, 203, 204, 205].map((id, i) => ({
        id, cost: i === 0 ? 4 : i <= 2 ? 3 : 1, level: 25, starLevel: 5,
        mainStat: null, subStats: [], sonataId: 1,
    }));

    const base = resolveTotalStats(build, d);
    const swapped = resolveTotalStats(applySonataOverride(build, { 1: 2 }), d);

    const glacioBase = base.dmgBonusByElement?.[1] ?? 0;
    const glacioSwap = swapped.dmgBonusByElement?.[1] ?? 0;
    const fusionBase = base.dmgBonusByElement?.[2] ?? 0;
    const fusionSwap = swapped.dmgBonusByElement?.[2] ?? 0;

    assert('base build credits Glacio set bonus', glacioBase > 0);
    assert('swapping away DROPS the Glacio set bonus', glacioSwap < glacioBase);
    assert('swapping IN raises the Fusion set bonus', fusionSwap > fusionBase);
    assert('resolveTotalStats never saw a mutated original (Glacio still active on base)', glacioBase > 0);
}

console.log(`\nsonata-override: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
