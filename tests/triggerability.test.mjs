/**
 * Conditional-effect triggerability — status gating per resonator kit.
 *
 *   node tests/triggerability.test.mjs
 *
 * Real wuwa-data.json so the kit-text scan runs against actual descriptions.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { canSatisfyCondition, inflictsStatus, statusesInText } from '../src/core/triggerability.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const resoOf = (id) => d.resonators.find(r => r.id === id);

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── statusesInText ───────────────────────────────────────────────────────────
{
    assert('detects Glacio Chafe', statusesInText('Inflicting Glacio Chafe on enemies …').includes('glacio chafe'));
    assert('detects Spectro Frazzle', statusesInText('after Spectro Frazzle …').includes('spectro frazzle'));
    assert('no status in a plain action condition', statusesInText('When Resonance Skill is cast').length === 0);
    assert('nullish input → empty', statusesInText(null).length === 0 && statusesInText(undefined).length === 0);
}

// ── inflictsStatus: kit-text scan ────────────────────────────────────────────
{
    assert('Hiyuki inflicts Glacio Chafe', inflictsStatus(resoOf(1108), d, 'Glacio Chafe') === true);
    assert('Carlotta does NOT inflict Glacio Chafe', inflictsStatus(resoOf(1107), d, 'Glacio Chafe') === false);
    assert('Phoebe inflicts Spectro Frazzle', inflictsStatus(resoOf(1506), d, 'Spectro Frazzle') === true);
}

// ── canSatisfyCondition: gate only on un-inflictable statuses ─────────────────
{
    const chafeCond = 'Inflicting Glacio Chafe on enemies increases Glacio DMG dealt by 10% for 15s.';
    assert('Hiyuki CAN satisfy a Glacio-Chafe condition', canSatisfyCondition(resoOf(1108), d, chafeCond) === true);
    assert('Carlotta CANNOT satisfy a Glacio-Chafe condition', canSatisfyCondition(resoOf(1107), d, chafeCond) === false);

    // Non-status (self-action) conditions are always satisfiable — never over-gated.
    assert('action condition always satisfiable (skill)', canSatisfyCondition(resoOf(1107), d, 'When Resonance Skill is cast, increase ATK') === true);
    assert('action condition always satisfiable (basic)', canSatisfyCondition(resoOf(1107), d, 'after releasing Basic Attack or Heavy Attack') === true);
    assert('empty / unrecognised condition satisfiable', canSatisfyCondition(resoOf(1107), d, '') === true);

    // Phoebe + Spectro-Frazzle set (Eternal Radiance) — satisfiable.
    assert('Phoebe satisfies a Spectro-Frazzle condition', canSatisfyCondition(resoOf(1506), d, 'Inflicting Spectro Frazzle on enemies increases Crit. Rate') === true);
    assert('Carlotta does not satisfy a Spectro-Frazzle condition', canSatisfyCondition(resoOf(1107), d, 'Inflicting Spectro Frazzle increases Crit. Rate') === false);
}

console.log(`\ntriggerability: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
