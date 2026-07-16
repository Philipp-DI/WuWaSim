/**
 * Tests for data/hit-map.json (2026-07-16) — the skill-key → raw per-hit
 * damage-instance ID artifact preprocess.mjs writes for external BinData
 * overlays (tools/extract-forte.mjs ID join).
 *
 *   node tests/hit-map.test.mjs
 *
 * Foundation fact under test: nanoka's per-hit entry IDs ARE the game's own
 * BinData damage IDs (verified 2650/2650 roster-wide against the Arikatsu
 * dump, 2026-07-16) — so these IDs are a direct join key, and the sums the
 * join produces must agree with what preprocess itself extracted from the
 * same entries (energy), which the anchors below lock.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rd = (p) => JSON.parse(readFileSync(resolve(__dirname, '..', p), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const hm = rd('data/hit-map.json');
const d = rd('data/wuwa-data.json');

// ── Structure ────────────────────────────────────────────────────────────────
{
    assert('hit-map has _doc + map', typeof hm._doc === 'string' && typeof hm.map === 'object');
    const rids = Object.keys(hm.map);
    assert('covers the full nanoka roster (== autoSkillMap)', rids.length === Object.keys(d.autoSkillMap).length);
    let total = 0, badId = 0, emptyKey = 0;
    for (const keys of Object.values(hm.map)) {
        for (const ids of Object.values(keys)) {
            if (!ids.length) emptyKey++;
            for (const id of ids) { total++; if (!/^\d+$/.test(id)) badId++; }
        }
    }
    assert('total hit IDs ≥ 2500 (roster-wide coverage)', total >= 2500);
    assert('every ID is a plain digit string', badId === 0);
    assert('no key maps to an empty ID list', emptyKey === 0);
    // Every hit-map key must be a real autoSkillMap key of the same resonator.
    let orphan = 0;
    for (const [rid, keys] of Object.entries(hm.map)) {
        for (const k of Object.keys(keys)) if (!d.autoSkillMap[rid]?.[k]) orphan++;
    }
    assert('every hit-map key exists in autoSkillMap', orphan === 0);
}

// ── Anchor: Chisa basic_2 (3-hit row) ───────────────────────────────────────
{
    const ids = hm.map['1508']?.basic_2;
    assert('Chisa basic_2 matched exactly its 3 raw hits',
        Array.isArray(ids) && ids.length === 3
        && ids.join(',') === '1508000001,1508000002,1508000003');
}

// ── Cross-consistency: hit-map IDs ↔ energyGen from the SAME raw entries ────
// The raw nanoka character file is committed; summing `energy` over the
// hit-map's IDs must reproduce autoSkillMap's energyGen (both derive from the
// same matchRowHits attribution — if they ever disagree, the artifact and the
// dataset were generated from different states).
{
    const nChar = rd('data/extracted-nanoka/characters/1508.json');
    const rawById = new Map();
    for (const node of Object.values(nChar.skill_trees ?? {})) {
        for (const [id, e] of Object.entries(node.skill?.damage ?? {})) rawById.set(id, e);
    }
    let checked = 0, mismatched = 0;
    for (const [key, ids] of Object.entries(hm.map['1508'] ?? {})) {
        const def = d.autoSkillMap['1508'][key];
        if (!def) continue;
        const sum = ids.reduce((s, id) => s + ((rawById.get(id)?.energy ?? 0) / 100), 0);
        checked++;
        if (!close(sum, def.energyGen, 1e-6)) mismatched++;
    }
    assert('Chisa: energy summed over hit-map IDs reproduces energyGen for every key', checked > 15 && mismatched === 0);
}

// ── Forte overlay downstream of the ID join (committed forte-data.json) ─────
{
    assert('Chisa forte channel/cap (Ring of Chainsaw, 100)', d.forte?.['1508']?.cap === 100);
    assert('Chisa basic_2 carries forteGen 14 (SE sum of its 3 hits: 2+3+9)', d.autoSkillMap['1508'].basic_2.forteGen === 14);
    assert('Chisa Sawring-Blitz Stage 2 is a SPEND (negative forteGen)', d.autoSkillMap['1508'].forte_heavy_sawring_blitz_2.forteGen < 0);
    assert('Hiyuki forte cap 300 (Frostheart — the per-hit channel; Dedication is the flagged second gauge)', d.forte?.['1108']?.cap === 300);
    assert('Hiyuki Foreclaimed basics generate Frostheart', (d.autoSkillMap['1108'].basic_fore_1?.forteGen ?? 0) > 0);
    // Flat on-cast grants (extract-forte.mjs Phase 2, 2026-07-16): kit-text
    // "Casting X grants N points of [Resource]" state effects with no damage
    // instance in any source — recovered from text, unconditional-only.
    assert('Chisa Liberation carries its flat +40 Ring of Chainsaw', d.autoSkillMap['1508'].liberation.forteGen === 40);
    assert('Chisa Intro carries its flat +20 Ring of Chainsaw', d.autoSkillMap['1508'].intro.forteGen === 20);
    assert('Aemeath Liberation carries its flat +30 Sync Rate at ×100 raw scale (3000)',
        d.autoSkillMap['1210'].liberation_heavenfall_edict_overdrive?.forteGen === 3000);
    assert('Aemeath both Intros carry the flat +40 Sync Rate (4000 raw)',
        d.autoSkillMap['1210'].intro_songs_across_the_universe?.forteGen === 4000
        && d.autoSkillMap['1210'].intro_debut_of_meteoric_radiance?.forteGen === 4000);
    // Guard regressions: a 3-point stack counter must NEVER pass the ×100
    // scale rule (Frostharden Iai 3×100 == Frostheart's 300 cap is coincidence),
    // and Hiyuki's cast-only Dedication grants stay unapplied (second gauge).
    assert('Hiyuki liberation_inward_vision has NO fabricated flat grant',
        (d.autoSkillMap['1108'].liberation_inward_vision?.forteGen ?? 0) === 0);
    assert('Hiyuki intro carries NO Dedication grant (cross-channel, flagged not applied)',
        (d.autoSkillMap['1108'].intro?.forteGen ?? 0) === 0);
    if (existsSync(resolve(__dirname, '../data/bindata/damage.json'))) {
        // Only when the (large, committed) dump is present: every hit-map ID
        // must exist in it (the 100%-join invariant; a miss = stale dump).
        const binIds = new Set(rd('data/bindata/damage.json').filter(e => e.Id >= 1e6).map(e => String(e.Id)));
        let missing = 0;
        for (const keys of Object.values(hm.map)) for (const ids of Object.values(keys)) for (const id of ids) if (!binIds.has(id)) missing++;
        assert('every hit-map ID exists in the BinData dump (100% join)', missing === 0);
    }
}

console.log(`hit-map: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
