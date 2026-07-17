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
import { __test__ } from '../src/ui/components/build-editor/index.js';
import { effectiveSkillMap } from '../src/core/sim.js';
import { validateRotation } from '../src/core/rotation-graph.js';
import { rulesForResonator } from '../src/core/rotation-rules.js';
import { createBuild, appendRotationStep, setEcho, setChain } from '../src/core/build.js';

import { suggestedBuildFor } from '../src/data/meta-loader.js';
import { echoUpgradeRanking } from '../src/core/live-weights.js';
import { setWeapon } from '../src/core/build.js';
import { PROP } from '../src/core/stats.js';
const { formatTipDesc, groupPaletteEntries, computeFixTarget, applyFix, dominantSonataId, statPriorityPanelHtml, applySuggestion, isEmptyBuild } = __test__;

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

// ── P12 Stat Priority: dominant-sonata resolution for the meta lookup ────────
{
    const echo = (sonataId) => ({ id: 1, cost: 1, sonataId });
    assert('dominant sonata is the most-equipped set',
        dominantSonataId([echo(1), echo(1), echo(1), echo(2), echo(2)]) === 1);
    assert('dominant sonata handles a clean 5-set', dominantSonataId([echo(5), echo(5), echo(5), echo(5), echo(5)]) === 5);
    assert('dominant sonata ignores empty slots', dominantSonataId([null, echo(3), echo(3), null, null]) === 3);
    assert('dominant sonata of no echoes is null', dominantSonataId([null, null, null, null, null]) === null);
    assert('dominant sonata of undefined is null', dominantSonataId(undefined) === null);
}

// ── P12 Stat Priority panel: real markup over the committed meta ──────────────
{
    const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
    // Carlotta (covered) with 5× Freezing Frost (sonata 1, the computed set).
    let cov = setChain(createBuild(resoOf(1107)), 0);
    const costs = [4, 3, 3, 1, 1];
    for (let i = 0; i < 5; i++) cov = setEcho(cov, i, { id: null, cost: costs[i], level: 25, mainStat: null, subStats: [{ propId: 8, addType: 1, value: 7, isPercent: true }], sonataId: 1 });

    const balanced = statPriorityPanelHtml({ meta, build: cov, dataset: d, statMode: 'balanced' });
    assert('panel renders the STAT PRIORITY header for a covered build', balanced.includes('STAT PRIORITY'));
    assert('panel shows all three mode toggle buttons', ['DMG Focus', 'Balanced', 'ER Focus'].every(l => balanced.includes(l)));
    assert('balanced lists Crit Rate and the element bonus', balanced.includes('Crit Rate') && balanced.includes('Element DMG Bonus'));
    assert('balanced shows the ER target gate', /target ~125%/.test(balanced));

    const dmg = statPriorityPanelHtml({ meta, build: cov, dataset: d, statMode: 'dmgFocus' });
    assert('DMG Focus suppresses the ER "aim for" nag', !/aim for/.test(dmg) && /DMG Focus ignores Energy Regen/.test(dmg));

    const erF = statPriorityPanelHtml({ meta, build: cov, dataset: d, statMode: 'erFocus' });
    assert('ER Focus notes the deferred solo breakpoint', /multi-cycle|team energy/.test(erF));

    // Uncovered configuration → graceful fallback message, no crash.
    let unc = setChain(createBuild(resoOf(1107)), 0);
    for (let i = 0; i < 5; i++) unc = setEcho(unc, i, { id: null, cost: costs[i], level: 25, mainStat: null, subStats: [], sonataId: 2 }); // sonata 2 not computed for Carlotta
    const fallback = statPriorityPanelHtml({ meta, build: unc, dataset: d, statMode: 'balanced' });
    assert('uncovered config shows the no-suggestion fallback', /No precomputed suggestion available/.test(fallback));

    // No meta at all → panel omitted entirely.
    assert('no meta → empty panel', statPriorityPanelHtml({ meta: null, build: cov, dataset: d, statMode: 'balanced' }) === '');

    // Hiyuki (covered, not energy-gated) → ER prefix omitted, gate message shown.
    let hiy = setChain(createBuild(resoOf(1108)), 0);
    for (let i = 0; i < 5; i++) hiy = setEcho(hiy, i, { id: null, cost: costs[i], level: 25, mainStat: null, subStats: [], sonataId: 1 });
    const hHtml = statPriorityPanelHtml({ meta, build: hiy, dataset: d, statMode: 'balanced' });
    assert('Hiyuki panel notes Liberation is not energy-gated', /not energy-gated|isn't energy-gated/.test(hHtml));
}

// ── P12 suggested build: empty-build detection, panel card, one-click apply ────
{
    const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));

    // isEmptyBuild: fresh build is empty; equipping a weapon or echo isn't.
    const fresh = createBuild(resoOf(1107));
    assert('fresh build is empty', isEmptyBuild(fresh) === true);
    const withEcho = setEcho(fresh, 0, { id: null, cost: 4, level: 25, mainStat: null, subStats: [], sonataId: 1 });
    assert('build with an echo is not empty', isEmptyBuild(withEcho) === false);

    // Panel on an empty COVERED build → suggestion card with the Apply action.
    const panel = statPriorityPanelHtml({ meta, build: fresh, dataset: d, statMode: 'balanced' });
    assert('empty covered build shows the suggested-build card', panel.includes('APPLY SUGGESTED BUILD'));
    // Carlotta's suggested set is Frosty Resolve (Resonance Skill DMG 2pc + Glacio-
    // after-skill 5pc beats the element sets for a skill carry; the Glacio-Chafe
    // set is also correctly gated off — see triggerability).
    assert('suggestion card names the suggested sonata', panel.includes('Frosty Resolve'));

    // suggestedBuildFor returns the best sonata/weapon + rotation + mains.
    const sug = suggestedBuildFor(meta, 1107);
    assert('suggestedBuildFor returns a sonata + weapon', sug && sug.sonataId === 10 && sug.weaponId != null);
    assert('suggestedBuildFor carries the reference rotation', Array.isArray(sug.referenceRotation) && sug.referenceRotation.length > 0);
    assert('suggestedBuildFor carries template mains with addType/isPercent',
        sug.templateStats.mains.every(m => m.propId != null && m.addType != null && typeof m.isPercent === 'boolean'));
    assert('suggestedBuildFor is null for an uncovered resonator', suggestedBuildFor(meta, 9999) === null);

    // applySuggestion equips weapon + 5 sonata echoes + the rotation, with REAL
    // echoes (concrete ids, not "Unknown Echo") when the dataset is passed.
    const applied = applySuggestion(fresh, sug, d);
    assert('apply equips the suggested weapon', applied.weapon?.id === sug.weaponId);
    assert('apply fills 5 echoes with the suggested sonata', applied.echoes.filter(e => e?.sonataId === sug.sonataId).length === 5);
    assert('apply picks REAL echoes (concrete ids, no Unknown Echo)', applied.echoes.every(e => e?.id != null));
    assert('apply picks echoes that actually carry the suggested sonata', applied.echoes.every(e => {
        const def = d.echoes.find(x => x.id === e.id);
        return def && (def.sonataIds ?? []).includes(sug.sonataId) && def.cost === e.cost;
    }));
    assert('apply sets recommended main stats (4-cost Crit DMG)', applied.echoes[0].mainStat.propId === sug.templateStats.mains[0].propId);
    assert('apply leaves substats empty for the user to roll', applied.echoes.every(e => (e.subStats ?? []).length === 0));
    assert('apply sets the reference rotation', applied.rotation.length === sug.referenceRotation.length);
    assert('applied build is no longer empty', isEmptyBuild(applied) === false);

    // Non-empty build → suggestion card suppressed (don't clobber a real build).
    const nonEmptyPanel = statPriorityPanelHtml({ meta, build: applied, dataset: d, statMode: 'balanced' });
    assert('suggestion card hidden once a build is populated', !nonEmptyPanel.includes('APPLY SUGGESTED BUILD'));
}

// ── P12 live stat-priority panel: live values + worst-echo callout ────────────
{
    const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
    const sub = (propId, addType, value) => ({ propId, addType, value, isPercent: true });
    // Simmable Carlotta with a junk echo in slot 1.
    let b = setWeapon(createBuild(resoOf(1107)), 21030036);
    const rot = meta.characters['1107'].referenceRotation;
    b = { ...b, rotation: rot, rotationMeta: rot.map(() => ({})) };
    const echoes = [
        { cost: 4, main: { propId: PROP.CRIT_DMG, addType: 1, value: 44, isPercent: true }, subs: [sub(PROP.CRIT_RATE, 1, 7.8), sub(PROP.CRIT_DMG, 1, 15.6)] },
        { cost: 3, main: { propId: 22, addType: 1, value: 30, isPercent: true }, subs: [sub(PROP.HP_RATIO, 2, 9), sub(PROP.DEF_RATIO, 2, 9)] },
        { cost: 3, main: { propId: PROP.ATK_RATIO, addType: 2, value: 30, isPercent: true }, subs: [sub(PROP.CRIT_RATE, 1, 7.8)] },
        { cost: 1, main: { propId: PROP.ATK_RATIO, addType: 2, value: 18, isPercent: true }, subs: [sub(PROP.CRIT_DMG, 1, 15.6)] },
        { cost: 1, main: { propId: PROP.ATK_RATIO, addType: 2, value: 18, isPercent: true }, subs: [sub(PROP.CRIT_RATE, 1, 7.8)] },
    ];
    echoes.forEach((e, i) => { b = setEcho(b, i, { id: null, cost: e.cost, level: 25, sonataId: 1, mainStat: e.main, subStats: e.subs }); });

    const live = echoUpgradeRanking(b, d);
    assert('echoUpgradeRanking produces a live analysis for the panel', live && live.live?.values?.length > 0);

    // With live passed, the panel switches to the live view.
    const livePanel = statPriorityPanelHtml({ meta, build: b, dataset: d, statMode: 'balanced', live });
    assert('live panel marks itself live', /live · your current stats/.test(livePanel));
    assert('live panel lists Crit Rate', livePanel.includes('Crit Rate'));
    assert('live panel flags the worst echo slot (2)', /Echo slot 2 has the most upgrade headroom/.test(livePanel));

    // Without live, the same build falls back to the frozen/covered path (no live banner).
    const frozenPanel = statPriorityPanelHtml({ meta, build: b, dataset: d, statMode: 'balanced' });
    assert('frozen path shown when no live analysis passed', !/live · your current stats/.test(frozenPanel));
}

console.log(`\nbuild-editor-v2: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
