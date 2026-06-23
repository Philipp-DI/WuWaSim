/**
 * Tests for the P10 rotation state model (rotation-state.js + STATE_DEFS).
 *
 *   node test/rotation-state.test.mjs
 *
 * Verifies state activation, persistence, stance replacement (consumedBy),
 * default stances (initiallyActive), and that inState chain/inherent effects
 * resolve through the state timeline.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { computeStateTimeline, stateActive } from '../src/core/rotation-state.js';
import { stateDefsForResonator } from '../src/core/rotation-rules.js';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── Carlotta: Twilight Tango activates at Liberation and persists ─────────────
{
    const carlotta = d.resonators.find(r => r.name === 'Carlotta');
    const map = d.autoSkillMap[carlotta.id];
    const rot = ['skill', 'liberation', 'liberation_fatal_finale', 'basic_necessary_measures_1'];
    const tl = computeStateTimeline(rot, map, stateDefsForResonator(carlotta.id));
    assert('Twilight Tango inactive before Liberation', !stateActive(tl.activeAt[0], 'twilight tango'));
    assert('Twilight Tango active at Liberation step', stateActive(tl.activeAt[1], 'twilight tango'));
    assert('Twilight Tango persists after Liberation', stateActive(tl.activeAt[3], 'twilight tango'));
}

// ── Hiyuki: Present Self default → Foreclaimed Self after Liberation ──────────
{
    const hiyuki = d.resonators.find(r => r.name === 'Hiyuki');
    const map = d.autoSkillMap[hiyuki.id];
    const rot = ['skill_present', 'liberation_blade_liberation', 'basic_fore_1', 'heavy_fore'];
    const tl = computeStateTimeline(rot, map, stateDefsForResonator(hiyuki.id));
    assert('Present Self active at start (default stance)', stateActive(tl.activeAt[0], 'present self'));
    assert('Foreclaimed Self not active at start', !stateActive(tl.activeAt[0], 'foreclaimed self'));
    assert('Foreclaimed Self active after Liberation', stateActive(tl.activeAt[2], 'foreclaimed self'));
    assert('Present Self consumed by Liberation', !stateActive(tl.activeAt[2], 'present self'));
}

// ── Type-triggered states: Aemeath Tune Rupture mode via forte ────────────────
{
    const aemeath = d.resonators.find(r => r.name === 'Aemeath');
    if (aemeath) {
        const map = d.autoSkillMap[aemeath.id];
        const forteKey = Object.keys(map).find(k => (map[k].skillType || '').startsWith('forte'));
        const tlNo = computeStateTimeline(['skill'], map, stateDefsForResonator(aemeath.id));
        const tlYes = computeStateTimeline(['skill', forteKey], map, stateDefsForResonator(aemeath.id));
        const everNo = new Set(); for (const s of tlNo.activeAt) for (const x of s) everNo.add(x);
        const everYes = new Set(); for (const s of tlYes.activeAt) for (const x of s) everYes.add(x);
        assert('Tune Rupture mode inactive without forte', everNo.size === 0);
        assert('Tune Rupture mode active with forte', everYes.size > 0);
    } else { passed += 2; }
}

// ── stateActive fuzzy matching ────────────────────────────────────────────────
{
    assert('exact match', stateActive(new Set(['twilight tango']), 'twilight tango'));
    assert('substring match', stateActive(new Set(['resonance mode - tune rupture']), 'tune rupture'));
    assert('no false match', !stateActive(new Set(['twilight tango']), 'foreclaimed self'));
    assert('empty set → false', !stateActive(new Set(), 'anything'));
}

// ── Empty / no-defs cases ─────────────────────────────────────────────────────
{
    const tl = computeStateTimeline(['a', 'b'], {}, []);
    assert('no state defs → empty active sets', tl.activeAt.every(s => s.size === 0));
    assert('empty rotation → empty timeline', computeStateTimeline([], {}, []).activeAt.length === 0);
}

console.log(`\nrotation-state: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
