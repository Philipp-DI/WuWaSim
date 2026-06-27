/**
 * Weapon passive (unconditional leading stat) parsing + application.
 *
 *   node tests/weapon-buffs.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { weaponPassiveStats } from '../src/core/weapon-buffs.js';
import { resolveTotalStats } from '../src/core/stats.js';
import { createBuild, setWeapon } from '../src/core/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const weaponByName = (name) => d.weapons.find(w => w.name === name);

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── leading-stat parsing across phrasings ────────────────────────────────────
{
    const eog = weaponPassiveStats(weaponByName('Emerald of Genesis'), 1);
    assert('EoG → Energy Regen passive', eog.energyRegen > 0 && eog.atkRatio === 0);

    const frost = weaponPassiveStats(weaponByName('Frostburn'), 1);
    assert('Frostburn → ATK% passive', frost.atkRatio > 0 && frost.energyRegen === 0);

    const verdant = weaponPassiveStats(weaponByName('Verdant Summit'), 1);
    assert('Verdant Summit → all-element DMG bonus', Object.keys(verdant.dmgByElement).length === 6 && verdant.dmgByElement[1] > 0);

    // Refinement rank scales the value (rank 5 ≥ rank 1).
    const r1 = weaponPassiveStats(weaponByName('Frostburn'), 1).atkRatio;
    const r5 = weaponPassiveStats(weaponByName('Frostburn'), 5).atkRatio;
    assert('higher refinement → larger passive', r5 > r1);

    // Robustness: no effect / missing weapon → zeroed contribution, no throw.
    const zero = weaponPassiveStats(null, 1);
    assert('null weapon → empty passive', zero.atkRatio === 0 && Object.keys(zero.dmgByElement).length === 0);
}

// ── the passive actually flows into resolved total stats ──────────────────────
{
    const carlotta = d.resonators.find(r => r.id === 1107);
    // Lux & Umbra has an ATK% passive → ATK with it should exceed a weaponless ATK.
    const withWeapon = setWeapon(createBuild(carlotta), weaponByName('Lux & Umbra').id);
    const noWeapon = createBuild(carlotta);
    const a1 = resolveTotalStats(withWeapon, d).atk;
    const a0 = resolveTotalStats(noWeapon, d).atk;
    assert('equipping an ATK%-passive weapon raises resolved ATK', a1 > a0);

    // EoG's ER passive raises resolved Energy Regen above base.
    const eogBuild = setWeapon(createBuild(carlotta), weaponByName('Emerald of Genesis').id);
    assert('EoG passive raises resolved Energy Regen', resolveTotalStats(eogBuild, d).energyRegen > resolveTotalStats(noWeapon, d).energyRegen);
}

console.log(`\nweapon-buffs: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
