/**
 * Tests for Build Page v2's pure UI-logic helpers (P11 §7b/§9b/§9d, §E, §I).
 *
 *   node test/build-editor-v2.test.mjs
 *
 * These exercise the module-private helpers exported via `__test__`:
 *   - formatTipDesc      — §I hover-box element/percent highlighting
 *   - groupPaletteEntries — §E palette grouping by skill family (+ stance split)
 *   - computeFixTarget    — §9d "Fix" target resolution
 *   - applyFix            — §9d rotation reorder that resolves a warning
 *
 * Runs against the real wuwa-data.json so the grouping/fix logic is validated
 * over actual skill maps, not synthetic fixtures (CLAUDE.md test policy).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { __test__ } from '../src/ui/components/build-editor-v2.js';
import { effectiveSkillMap } from '../src/core/sim.js';
import { validateRotation } from '../src/core/rotation-graph.js';
import { rulesForResonator } from '../src/core/rotation-rules.js';
import { createBuild, appendRotationStep } from '../src/core/build.js';

const { formatTipDesc, groupPaletteEntries, computeFixTarget, applyFix } = __test__;

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const resoOf = (id) => d.resonators.find(r => r.id === id);
const paletteEntries = (id) =>
    Object.entries(effectiveSkillMap(d, id)).filter(([k, def]) => !k.startsWith('_') && def.paletteInclude !== false);

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── §I formatTipDesc ────────────────────────────────────────────────────────
{
    const out = formatTipDesc('Deal Glacio DMG increased by 12.5% and 126% more.');
    assert('element name wrapped with its colour token', out.includes('<span class="bv2-tip-el" style="color:var(--el-glacio)">Glacio</span>'));
    assert('decimal percent wrapped', out.includes('<span class="bv2-tip-num">12.5%</span>'));
    assert('integer percent wrapped', out.includes('<span class="bv2-tip-num">126%</span>'));

    // No element / no percent → text passes through unchanged.
    assert('plain text untouched', formatTipDesc('Cast the skill now.') === 'Cast the skill now.');
    // Null/undefined tolerated.
    assert('nullish input → empty string', formatTipDesc(null) === '' && formatTipDesc(undefined) === '');

    // Every element name resolves to a coloured span (regression on the ELEM map).
    for (const name of ['Glacio', 'Fusion', 'Electro', 'Aero', 'Spectro', 'Havoc']) {
        assert(`${name} highlighted`, formatTipDesc(`${name} DMG`).includes('bv2-tip-el'));
    }

    // Safety: operates on already-escaped text, so pre-escaped entities survive
    // and no double-wrapping of a number occurs inside an element span.
    const escd = formatTipDesc('A &amp; B deal 50% Fusion DMG');
    assert('escaped entity preserved', escd.includes('&amp;'));
    assert('single num span only', (escd.match(/bv2-tip-num/g) || []).length === 1);
}

// ── §E groupPaletteEntries ──────────────────────────────────────────────────
{
    // Carlotta: flat list groups into families; no stance split.
    const groups = groupPaletteEntries(paletteEntries(1107), 1107);
    const labels = groups.map(g => g.label);
    assert('Carlotta groups exist', groups.length >= 4);
    assert('Basic Attack family present', labels.includes('Basic Attack'));
    assert('Resonance Skill family present', labels.includes('Resonance Skill'));
    assert('Resonance Liberation family present', labels.includes('Resonance Liberation'));
    // Every palette entry survives the grouping (no items dropped).
    const grouped = groups.reduce((n, g) => n + g.items.length, 0);
    assert('no entries lost in grouping', grouped === paletteEntries(1107).length);
    // Groups are ordered by skill-family order (basic before liberation).
    const bi = labels.indexOf('Basic Attack'), li = labels.indexOf('Resonance Liberation');
    assert('basic ordered before liberation', bi >= 0 && li >= 0 && bi < li);

    // Hiyuki: basic/heavy/skill families split per stance from STATE_DEFS.
    const hiyuki = groupPaletteEntries(paletteEntries(1108), 1108);
    const hLabels = hiyuki.map(g => g.label);
    assert('Hiyuki Present Self header', hLabels.some(l => /Present Self/.test(l)));
    assert('Hiyuki Foreclaimed Self header', hLabels.some(l => /Foreclaimed Self/.test(l)));
    assert('Hiyuki no entries lost',
        hiyuki.reduce((n, g) => n + g.items.length, 0) === paletteEntries(1108).length);

    // A resonator with no STATE_DEFS never produces a "—" split.
    assert('Carlotta has no stance split', !labels.some(l => l.includes('—')));
}

// ── §9d computeFixTarget / applyFix ─────────────────────────────────────────
{
    const carlotta = resoOf(1107);
    const rules = rulesForResonator(1107);
    const skillMap = effectiveSkillMap(d, 1107);

    // Prerequisite gate: death_knell needs liberation earlier. Build it wrong.
    let b = createBuild(carlotta);
    for (const k of ['skill', 'skill_chromatic_splendor', 'liberation_death_knell']) b = appendRotationStep(b, k);
    let warnings = validateRotation(b.rotation, rules, skillMap);
    const dkWarn = warnings.find(w => w.skillKey === 'liberation_death_knell');
    assert('death_knell without liberation warns', !!dkWarn);

    // No 'liberation' present yet → fix must INSERT it before the flagged step.
    const tgtInsert = computeFixTarget(b, dkWarn);
    assert('fix target is insert when requirement absent', tgtInsert?.mode === 'insert' && tgtInsert.key === 'liberation');
    let fixed = applyFix(b, dkWarn);
    assert('applyFix inserts the requirement', fixed.rotation.includes('liberation'));
    assert('inserted requirement precedes the flagged step',
        fixed.rotation.indexOf('liberation') < fixed.rotation.indexOf('liberation_death_knell'));
    assert('applyFix resolves that warning',
        !validateRotation(fixed.rotation, rules, skillMap).some(w => w.skillKey === 'liberation_death_knell'));

    // Requirement present but out of order → fix must MOVE the flagged step.
    let b2 = createBuild(carlotta);
    for (const k of ['liberation_death_knell', 'liberation']) b2 = appendRotationStep(b2, k);
    const w2 = validateRotation(b2.rotation, rules, skillMap).find(w => w.skillKey === 'liberation_death_knell');
    const tgtMove = computeFixTarget(b2, w2);
    assert('fix target is move when requirement present', tgtMove?.mode === 'move' && tgtMove.afterKey === 'liberation');
    const fixed2 = applyFix(b2, w2);
    assert('move fix resolves the warning',
        !validateRotation(fixed2.rotation, rules, skillMap).some(w => w.skillKey === 'liberation_death_knell'));

    // Stage-ordering warning (no `requires`) → derive the prior stage key.
    const hiyuki = resoOf(1108);
    let b3 = createBuild(hiyuki);
    for (const k of ['basic_present_3']) b3 = appendRotationStep(b3, k);   // stage 3 with no 1/2
    const stageWarn = validateRotation(b3.rotation, rulesForResonator(1108), effectiveSkillMap(d, 1108))
        .find(w => w.gate === 'sequence');
    assert('staged step without predecessor warns', !!stageWarn);
    const stageTgt = computeFixTarget(b3, stageWarn);
    assert('stage fix derives prior stage key', stageTgt?.key === 'basic_present_2' || stageTgt?.afterKey === 'basic_present_2');
}

console.log(`\nbuild-editor-v2: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
