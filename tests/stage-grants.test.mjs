/**
 * Stage-entry grants, swap-in combo entry, and curated resources
 * (rotation-rules.js STAGE_GRANTS / SWAP_IN_ENTRY / RESOURCE_DEFS +
 * rotation-graph.js analyzeRotation), 2026-07-05.
 *
 *   node tests/stage-grants.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { analyzeRotation, validateRotation } from '../src/core/rotation-graph.js';
import {
    STAGE_GRANTS, SWAP_IN_ENTRY, RESOURCE_DEFS, STATE_DEFS,
    rulesForResonator, stageGrantsForResonator, swapInEntryForResonator,
    resourceDefsForResonator, stateDefsForResonator,
} from '../src/core/rotation-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const refs = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const analyze = (rid, rotation) => analyzeRotation(rotation, {
    rules: rulesForResonator(rid),
    skillMap: d.autoSkillMap[String(rid)],
    grants: stageGrantsForResonator(rid),
    swapInEntry: swapInEntryForResonator(rid),
    resourceDefs: resourceDefsForResonator(rid),
    stateDefs: stateDefsForResonator(rid),
});

// ── Data integrity: every referenced key/state exists in the dataset ─────────
{
    for (const [idStr, grants] of Object.entries(STAGE_GRANTS)) {
        const sm = d.autoSkillMap[idStr];
        assert(`STAGE_GRANTS ${idStr}: resonator has a skill map`, !!sm);
        if (!sm) continue;
        for (const [key, g] of Object.entries(grants)) {
            assert(`STAGE_GRANTS ${idStr}.${key}: grantee key exists`, !!sm[key]);
            assert(`STAGE_GRANTS ${idStr}.${key}: has a note`, typeof g.note === 'string' && g.note.length > 0);
            for (const a of g.after ?? []) {
                assert(`STAGE_GRANTS ${idStr}.${key}: after-key ${a} exists`, !!sm[a]);
            }
            if (g.state) {
                const states = (STATE_DEFS[Number(idStr)] ?? []).map(s => s.name.toLowerCase());
                assert(`STAGE_GRANTS ${idStr}.${key}: state '${g.state}' defined in STATE_DEFS`,
                    states.some(s => s === g.state || s.includes(g.state) || g.state.includes(s)));
            }
            if (g.resource) {
                const names = (RESOURCE_DEFS[Number(idStr)] ?? []).map(r => r.name);
                assert(`STAGE_GRANTS ${idStr}.${key}: resource '${g.resource.name}' defined`,
                    names.includes(g.resource.name));
            }
        }
    }
    for (const [idStr, entry] of Object.entries(SWAP_IN_ENTRY)) {
        assert(`SWAP_IN_ENTRY ${idStr}: resonator exists`, !!d.resonators.find(r => r.id === Number(idStr)));
        assert(`SWAP_IN_ENTRY ${idStr}: preSeen is a non-empty stage list`,
            Array.isArray(entry.preSeen) && entry.preSeen.length > 0 && entry.preSeen.every(Number.isInteger));
    }
    for (const [idStr, defs] of Object.entries(RESOURCE_DEFS)) {
        const sm = d.autoSkillMap[idStr];
        for (const def of defs) {
            for (const k of Object.keys(def.gains ?? {})) {
                assert(`RESOURCE_DEFS ${idStr} '${def.name}': gain key ${k} exists`, !!sm?.[k]);
            }
            for (const k of def.spendAll ?? []) {
                assert(`RESOURCE_DEFS ${idStr} '${def.name}': spendAll key ${k} exists`, !!sm?.[k]);
            }
        }
    }
}

// ── Denia: intro grants Stagecraft Stage 4 (the originally reported bug) ─────
{
    const withIntro = analyze(1211, ['intro_it_s_been_a_while', 'basic_stagecraft_form_4']);
    assert('Denia: intro → Stage 4 no longer warns', withIntro.warnings.length === 0);
    assert('Denia: intro → Stage 4 emits an after-chip',
        withIntro.chips.some(c => c.skillKey === 'basic_stagecraft_form_4' && c.kind === 'after'));

    const bare = analyze(1211, ['skill_phantom_bubble_stagecraft_form', 'basic_stagecraft_form_4']);
    assert('Denia: Stage 4 without a granting cast still warns',
        bare.warnings.some(w => w.skillKey === 'basic_stagecraft_form_4'));
}

// ── Brant: Interlude Applause license survives intermediate casts, once ──────
{
    const licensed = analyze(1206, ['intro', 'skill_plunging_attack', 'liberation', 'midair_mid_air_attack_2']);
    assert('Brant: intro license reaches Mid-air 2 across intermediate casts', licensed.warnings.length === 0);
    assert('Brant: license emits a state-chip',
        licensed.chips.some(c => c.skillKey === 'midair_mid_air_attack_2' && c.kind === 'state'));

    const consumed = analyze(1206, ['intro', 'midair_mid_air_attack_2', 'liberation', 'midair_mid_air_attack_2']);
    assert('Brant: the license is CONSUMED by the first mid-air attack',
        consumed.warnings.some(w => w.index === 3 && w.skillKey === 'midair_mid_air_attack_2'));

    const unlicensed = analyze(1206, ['skill_plunging_attack', 'midair_mid_air_attack_2']);
    assert('Brant: Mid-air 2 without intro warns',
        unlicensed.warnings.some(w => w.skillKey === 'midair_mid_air_attack_2'));
}

// ── Sigrika: Full Stop resource gate ─────────────────────────────────────────
{
    const withResource = analyze(1412, ['forte_heavy_runic_chain_whip', 'liberation', 'basic_basic_attack_2']);
    assert('Sigrika: ≥50 Full Stop legalizes Basic Stage 2', withResource.warnings.length === 0);
    assert('Sigrika: resource chip emitted',
        withResource.chips.some(c => c.kind === 'resource'));

    const noResource = analyze(1412, ['liberation', 'basic_basic_attack_2']);
    assert('Sigrika: Basic 2 with 0 Full Stop and no granting cast warns',
        noResource.warnings.some(w => w.skillKey === 'basic_basic_attack_2'));

    const spent = analyze(1412, ['forte_heavy_runic_chain_whip',
        'forte_heavy_forte_circuit_learn_my_true_name', 'basic_basic_attack_2']);
    assert('Sigrika: Learn My True Name consumes all Full Stop → Basic 2 warns again',
        spent.warnings.some(w => w.skillKey === 'basic_basic_attack_2'));
}

// ── Swap-in combo entry (maintainer-verified in-game 2026-07-05) ─────────────
{
    const yy3 = analyze(1402, ['basic_3', 'heavy_heavy_attack']);
    assert('Yangyang: rotation starting at Basic 3 is legal (stages 1–2 pre-seen)', yy3.warnings.length === 0);
    assert('Yangyang: swap-in chip emitted', yy3.chips.some(c => c.kind === 'swapIn'));

    const yy4 = analyze(1402, ['basic_4']);
    assert('Yangyang: starting at Basic 4 still warns (entry is at Stage 3)',
        yy4.warnings.some(w => w.skillKey === 'basic_4'));

    // Chisa explicitly does NOT have the swap-in entry.
    const chisa = analyze(1508, ['basic_2']);
    assert('Chisa: bare Basic 2 start still warns (no swap-in entry)',
        chisa.warnings.some(w => w.skillKey === 'basic_2'));
}

// ── Rule-covered keys don't double-warn from the stage heuristic ─────────────
{
    const cant = analyze(1607, ['forte_heavy_phantom_sting_2']);
    const forKey = cant.warnings.filter(w => w.skillKey === 'forte_heavy_phantom_sting_2');
    assert('Cantarella: unsatisfied Phantom Sting 2 warns exactly ONCE (rule, not rule+stage)',
        forKey.length === 1 && forKey[0].gate !== 'sequence');
}

// ── validateRotation stays back-compatible (warnings only, no grants) ────────
{
    const legacy = validateRotation(['intro_it_s_been_a_while', 'basic_stagecraft_form_4'],
        rulesForResonator(1211), d.autoSkillMap['1211']);
    assert('validateRotation (legacy, grant-blind) still warns on Denia Stage 4',
        legacy.some(w => w.skillKey === 'basic_stagecraft_form_4'));
}

// ── Reference-rotation canary: ZERO warnings across all curated rotations ────
// (Prydwen rotations are community/expert-verified — the maintainer confirmed
// the last two open cases in-game on 2026-07-05: Yinlin intro→BA4 and Danjin
// skill→BA2 are real, undocumented interactions, now curated as grants.)
{
    const open = [];
    for (const [id, ref] of Object.entries(refs)) {
        const rot = ref.rotation ?? ref;
        if (!Array.isArray(rot)) continue;
        for (const w of analyze(Number(id), rot).warnings) {
            open.push(`${id}:${w.skillKey}`);
        }
    }
    assert(`reference rotations: zero warnings (got: ${open.join(', ') || 'none'})`, open.length === 0);
}

// ── Maintainer-verified undocumented grants (2026-07-05) ─────────────────────
{
    const yinlin = analyze(1302, ['intro', 'basic_4']);
    assert('Yinlin: intro → Basic 4 is legal (verified in-game)', yinlin.warnings.length === 0);
    assert('Yinlin: grant chip emitted', yinlin.chips.some(c => c.skillKey === 'basic_4' && c.kind === 'after'));

    const danjin = analyze(1602, ['skill_carmine_gleam_damage', 'basic_2']);
    assert('Danjin: Carmine Gleam → Basic 2 is legal (verified in-game)', danjin.warnings.length === 0);
    assert('Danjin: Basic 2 without the weave still warns',
        analyze(1602, ['liberation_consecutive_attack', 'basic_2']).warnings.some(w => w.skillKey === 'basic_2'));
}

console.log(`\nstage-grants: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
