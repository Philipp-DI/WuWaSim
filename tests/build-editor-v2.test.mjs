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
import { effectiveSkillMap, simulateRotation } from '../src/core/sim.js';
import { validateRotation } from '../src/core/rotation-graph.js';
import { rulesForResonator } from '../src/core/rotation-rules.js';
import { createBuild, appendRotationStep, setEcho, setChain, setEffectStacks } from '../src/core/build.js';

import { suggestedBuildFor, resolveReferenceRotation, teamMemberBuildFor } from '../src/data/meta-loader.js';
import { echoUpgradeRanking, liveSubstatValues } from '../src/core/live-weights.js';
import { abilityAverages } from '../src/ui/components/build-editor/strips.js';
import { makeDmgTarget, damageFamily, TYPE_LABEL, STEP_TYPE } from '../src/ui/components/build-editor/shared.js';
import { renderStats } from '../src/ui/components/build-editor/stats-panel.js';
import { renderStackStepper } from '../src/ui/components/build-editor/rotation.js';
import { missingForLivePanel } from '../src/ui/components/build-editor/stat-priority.js';
import { setApi } from '../src/ui/components/build-editor/state.js';
import { setWeapon } from '../src/core/build.js';
import { PROP } from '../src/core/stats.js';
const { formatTipDesc, groupPaletteEntries, computeFixTarget, applyFix, dominantSonataId, statPriorityPanelHtml, applySuggestion, isEmptyBuild, defaultFreshBuild } = __test__;

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const referenceRotations = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));
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
    // Echoes but no rotation: the live panel is the answer for an uncovered
    // config, so name the one thing blocking it rather than reporting the
    // frozen meta's miss (2026-07-31).
    assert('uncovered config with no rotation asks for rotation steps', /add rotation steps/.test(fallback));
    assert('and does not ask for echoes it already has', !/equip an echo/.test(fallback));

    // Uncovered AND simmable → the frozen meta genuinely has nothing to add.
    const uncSimmable = { ...unc, rotation: ['skill'], rotationMeta: [{}] };
    const uncFallback = statPriorityPanelHtml({ meta, build: uncSimmable, dataset: d, statMode: 'balanced' });
    assert('uncovered config shows the no-suggestion fallback', /No precomputed suggestion available/.test(uncFallback));

    // No meta at all → panel omitted entirely.
    assert('no meta → empty panel', statPriorityPanelHtml({ meta: null, build: cov, dataset: d, statMode: 'balanced' }) === '');

    // Hiyuki (covered, energy-gated: real energyMax 125) → panel surfaces the ER
    // target; her bare-echo build sits below it, so the "aim for" gate advice shows.
    let hiy = setChain(createBuild(resoOf(1108)), 0);
    for (let i = 0; i < 5; i++) hiy = setEcho(hiy, i, { id: null, cost: costs[i], level: 25, mainStat: null, subStats: [], sonataId: 1 });
    const hHtml = statPriorityPanelHtml({ meta, build: hiy, dataset: d, statMode: 'balanced' });
    assert('Hiyuki panel surfaces the ER target (energy-gated)', /aim for ~\d+%|target ~\d+%/.test(hHtml));
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

// ── Fresh-build defaults: signature weapon (data-driven), echoes (the P13
// team pass's real per-member recipe — real substats, not blank ovals — for
// the 53/56 roster it covers; the P12 solo suggestion as a fallback), rotation
// (curated) — opening an empty resonator ────────────────────────────────────
{
    const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));

    // signatureWeaponId (tools/preprocess.mjs): nanoka's own `recommend.weapon[0]`,
    // not a name/regex guess — every resonator resolves to a real 5★ weapon of
    // their own weaponType.
    assert('every resonator has a signatureWeaponId', d.resonators.every(r => r.signatureWeaponId != null));
    assert('every signature weapon resolves, matches weaponType, and is 5-star', d.resonators.every(r => {
        const w = d.weapons.find(x => x.id === r.signatureWeaponId);
        return w && w.type === r.weaponType && w.rarity === 5;
    }));
    const carlotta = resoOf(1107);
    const carlottaWeapon = d.weapons.find(w => w.id === carlotta.signatureWeaponId);
    assert("Carlotta's signatureWeaponId resolves to her real in-game signature (The Last Dance)", carlottaWeapon?.name === 'The Last Dance');

    // resolveReferenceRotation: meta (covered anchors) first, else the curated file.
    const sugCarlotta = suggestedBuildFor(meta, 1107);
    assert('resolveReferenceRotation prefers the meta rotation for a covered anchor',
        resolveReferenceRotation(meta, referenceRotations, 1107).length === sugCarlotta.referenceRotation.length);
    // The discriminator for "fresh builds use the SIGNATURE weapon, not the
    // optimizer's pick" needs a resonator where the two actually differ. It used
    // to be Carlotta, but the optimizer now picks her real signature (The Last
    // Dance) once weapon conditionals come from the game's own tables instead of
    // tooltip text — as it also does for Hiyuki and Changli. Three of six anchors
    // converging on the character's real signature weapon is a good sign, and it
    // is exactly why this assertion cannot be pinned to a resonator that happens
    // to disagree today. Jinhsi still differs (signature Ages of Harvest vs.
    // Kumokiri), so she is the discriminator.
    const jinhsi = resoOf(1304);
    const sugJinhsi = suggestedBuildFor(meta, 1304);
    assert('signature differs from the suggestion\'s optimized weapon pick (else this whole test proves nothing)',
        jinhsi.signatureWeaponId !== sugJinhsi.weaponId);

    // Roster-wide coverage: the P13 team pass's memberBuilds (real per-member
    // recipes, real substats) reaches far more of the roster than the P12
    // solo suggestion (6 anchors) — this is the fix for "many resonators open
    // with no echoes equipped, and those that do have no rolled substats".
    const recipeCoverage = d.resonators.filter(r => meta.teams.memberBuilds[String(r.id)]).length;
    assert('teamMemberBuildFor covers most of the roster (far more than the 6 P12 anchors)', recipeCoverage >= 50);

    // defaultFreshBuild PRIMARY path (has a recipe — the common case): weapon
    // = SIGNATURE (never the recipe's own pick), echoes = the recipe's real
    // echoes WITH real co-optimized substats, rotation = the recipe's rotation.
    const freshCovered = defaultFreshBuild(createBuild(carlotta), carlotta, d, meta, referenceRotations);
    const recipeCarlotta = teamMemberBuildFor(meta, 1107);
    assert('recipe path: weapon is the signature weapon, not the recipe\'s own pick', freshCovered.weapon?.id === carlotta.signatureWeaponId);
    assert('recipe path: echoes filled with the recipe\'s sonata (5 slots)', freshCovered.echoes.filter(e => e?.sonataId === recipeCarlotta.sonataId).length === 5);
    assert('recipe path: echoes carry real ids (no "Unknown Echo")', freshCovered.echoes.every(e => e?.id != null));
    assert('recipe path: echoes carry REAL rolled substats, not blank ovals', freshCovered.echoes.every(e => (e.subStats ?? []).length > 0));
    assert('recipe path: rotation is the recipe\'s rotation', freshCovered.rotation.length === recipeCarlotta.rotation.length && freshCovered.rotation.length > 0);
    assert('recipe path: no longer an empty build', isEmptyBuild(freshCovered) === false);

    // defaultFreshBuild FALLBACK path (no recipe, only a P12 suggestion) —
    // exercised with a synthetic meta (every real anchor already has a
    // recipe too, so this branch needs a mock to reach at all): echoes come
    // from applySuggestion instead, substats deliberately blank there.
    const metaNoRecipe = { ...meta, teams: { ...meta.teams, memberBuilds: {} } };
    const freshSuggestionOnly = defaultFreshBuild(createBuild(carlotta), carlotta, d, metaNoRecipe, referenceRotations);
    assert('fallback path: weapon is still the signature weapon', freshSuggestionOnly.weapon?.id === carlotta.signatureWeaponId);
    assert('fallback path: echoes filled with the SUGGESTION\'s sonata', freshSuggestionOnly.echoes.filter(e => e?.sonataId === sugCarlotta.sonataId).length === 5);
    assert('fallback path: substats deliberately left blank (manual APPLY SUGGESTED BUILD contract)', freshSuggestionOnly.echoes.every(e => (e.subStats ?? []).length === 0));
    assert('fallback path: rotation is the suggestion\'s reference rotation', freshSuggestionOnly.rotation.length === sugCarlotta.referenceRotation.length);

    // defaultFreshBuild on a resonator covered by NEITHER (no recipe, no
    // suggestion) — still gets the signature weapon + the curated-file
    // rotation fallback; no echoes, since there's no data to source them from.
    const roverSpectro = resoOf(1501);
    assert('Rover: Spectro has neither a recipe nor a P12 suggestion (sanity check for this fixture)',
        meta.teams.memberBuilds['1501'] == null && meta.characters?.['1501']?.suggested == null);
    assert('Rover: Spectro has a curated reference rotation (sanity check for this fixture)', referenceRotations['1501']?.rotation?.length > 0);
    const freshUncovered = defaultFreshBuild(createBuild(roverSpectro), roverSpectro, d, meta, referenceRotations);
    assert('uncovered: weapon is still the signature weapon', freshUncovered.weapon?.id === roverSpectro.signatureWeaponId);
    assert('uncovered: rotation falls back to the curated reference-rotations.json',
        freshUncovered.rotation.length === referenceRotations['1501'].rotation.length);
    assert('uncovered: no recipe/suggestion to source echoes from, so none equipped', freshUncovered.echoes.every(e => e == null));
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
    assert('live panel marks itself live and names its measure', /live · your rotation/.test(livePanel));
    assert('live panel lists Crit Rate', livePanel.includes('Crit Rate'));
    assert('live panel flags the worst echo slot (2)', /Echo slot 2 has the most upgrade headroom/.test(livePanel));

    // Without live, the same build falls back to the frozen/covered path (no live banner).
    const frozenPanel = statPriorityPanelHtml({ meta, build: b, dataset: d, statMode: 'balanced' });
    assert('frozen path shown when no live analysis passed', !/live · your current stats/.test(frozenPanel));
}

// ── Stat priority never omits a stat in silence ──────────────────────────────
{
    const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
    const build = createBuild(resoOf(1107));

    // Worth-nothing stats render with the REASON, not as a missing row.
    const cappedLive = {
        worstSlot: null,
        live: {
            base: 1, critCapped: 0.96,
            values: [
                { key: 'critDmg', label: 'Crit DMG', gain: 100, normalized: 100, zeroReason: null },
                { key: 'critRate', label: 'Crit Rate', gain: 0, normalized: 0, zeroReason: 'critCap' },
                { key: 'dmgBonus.heavy', label: 'Heavy DMG', gain: 0, normalized: 0, zeroReason: 'noScaling' },
                { key: 'energyRegen', label: 'Energy Regen', gain: 0, normalized: 0, zeroReason: 'noScaling' },
            ],
        },
    };
    const panel = statPriorityPanelHtml({ meta, build, dataset: d, statMode: 'balanced', live: cappedLive });
    assert('a capped Crit Rate still appears in the panel', panel.includes('Crit Rate'));
    assert('and says it is at the 100% cap', panel.includes('already at the 100% Crit Rate cap'));
    assert('naming the share of damage that is capped', panel.includes('on 96% of your damage'));
    assert('a stat nothing scales with says that instead', panel.includes('nothing in this rotation scales with it'));
    assert('Energy Regen gets its own non-damage wording', panel.includes('ER decides whether Liberation is ready'));

    // Blank build: the panel must say what it needs, not "no suggestion".
    const blankPanel = statPriorityPanelHtml({ meta, build: createBuild(resoOf(1210)), dataset: d, statMode: 'balanced', live: null });
    assert('an empty build is told what stat priority needs',
        blankPanel.includes('equip an echo and add rotation steps'));
    assert('and is not left with a dead-end "no precomputed suggestion"',
        !blankPanel.includes('No precomputed suggestion available'));
    assert('missingForLivePanel is empty once a build is simmable',
        missingForLivePanel({ echoes: [{ id: 1 }], rotation: ['skill'] }).length === 0);

    // Weights measured on the kit rather than the user's rotation must SAY so —
    // it changes what the number means (2026-07-31).
    const kitLive = {
        worstSlot: null,
        live: {
            base: 1, critCapped: 0, measure: 'kit', assumedEcho: true,
            values: [{ key: 'atkRatio', label: 'ATK%', gain: 10, normalized: 100, zeroReason: null }],
        },
    };
    const kitPanel = statPriorityPanelHtml({ meta, build, dataset: d, statMode: 'balanced', live: kitLive });
    assert('a kit-measured ranking is labelled in the header', kitPanel.includes('live · kit average'));
    assert('and points at the reading it matches', kitPanel.includes('OVERALL AVG'));
    assert('and reports the seeded echo slot', kitPanel.includes('one empty echo slot is assumed'));
    assert('the footnote denominates the value per hit',
        kitPanel.includes('extra average damage per hit per +1 substat roll'));

    // A ranking on the user's own rotation keeps the rotation wording.
    const ownLive = { ...kitLive, live: { ...kitLive.live, measure: 'rotation', assumedEcho: false } };
    const ownPanel = statPriorityPanelHtml({ meta, build, dataset: d, statMode: 'balanced', live: ownLive });
    assert('a rotation ranking says so in the header', ownPanel.includes('live · your rotation'));
    assert('and carries no stand-in banner', !ownPanel.includes('OVERALL AVG'));
    assert('and denominates the value per rotation',
        ownPanel.includes('extra rotation damage per +1 substat roll'));

    // A covered character on an empty build must keep the one-click starting
    // point AND gain the ranking — the weights must not displace the offer.
    const bothPanel = statPriorityPanelHtml({ meta, build: createBuild(resoOf(1107)), dataset: d, statMode: 'balanced', live: kitLive });
    assert('an empty covered build still offers APPLY SUGGESTED BUILD', bothPanel.includes('APPLY SUGGESTED BUILD'));
    assert('and now shows the ranking under it', bothPanel.includes('live · kit average'));
    assert('suggestion card first, ranking second',
        bothPanel.indexOf('APPLY SUGGESTED BUILD') < bothPanel.indexOf('live · kit average'));
}

// ── The kit fallback IS the top strip's OVERALL AVG ──────────────────────────
// Maintainer-directed 2026-07-31: an empty rotation should be weighed against
// the resonator's basic kit, "the reading we have in the sticky bar". So assert
// the identity, not merely that both are averages — and include HP scalers,
// which is where a non-inert seeded echo slot would show up first.
{
    const dmgTarget = { level: 90, res: 0.1 };
    for (const name of ['Carlotta', 'Baizhi', 'Shorekeeper', 'Suisui']) {
        const resonator = d.resonators.find((candidate) => candidate.name === name);
        if (!resonator) continue;
        const blank = createBuild(resonator);
        setApi({ dataset: d, build: blank, sonataOverride: null, dmgTarget });
        const strip = abilityAverages()?.overall ?? null;
        const live = liveSubstatValues(blank, d, makeDmgTarget(blank, dmgTarget));
        assert(`${name}: a blank build is ranked on its kit`, live?.measure === 'kit');
        assert(`${name}: the kit base equals the strip's OVERALL AVG`,
            strip != null && Math.abs(live.base - strip) < 1e-9);
    }
}

// ── The stats panel admits when Crit Rate is capped in combat ────────────────
// The CRIT RATE tile shows the STOWED sheet value (includeConditionals:false),
// so a build reading well under 100% there can still spend the whole rotation
// clamped at the formula's cap. Without this note the tile looks like it has
// room while every further roll buys nothing (2026-07-31).
{
    const carlottaMeta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
    const sub = (propId, addType, value) => ({ propId, addType, value, isPercent: true });
    let simmable = setWeapon(createBuild(resoOf(1107)), 21030036);
    const rot = carlottaMeta.characters['1107'].referenceRotation;
    simmable = { ...simmable, rotation: rot, rotationMeta: rot.map(() => ({})) };
    for (let i = 0; i < 5; i++) {
        simmable = setEcho(simmable, i, { id: null, cost: [4, 3, 3, 1, 1][i], level: 25, sonataId: 1,
            mainStat: { propId: PROP.CRIT_DMG, addType: 1, value: 44, isPercent: true }, subStats: [sub(PROP.CRIT_DMG, 1, 15.6)] });
    }

    setApi({ dataset: d, build: simmable, sonataOverride: null });
    assert('an uncapped build gets no cap warning', !renderStats().includes('100% cap on'));

    const cappedEchoes = simmable.echoes.slice();
    cappedEchoes[0] = { ...cappedEchoes[0], subStats: [...cappedEchoes[0].subStats, sub(PROP.CRIT_RATE, 1, 100)] };
    setApi({ dataset: d, build: { ...simmable, echoes: cappedEchoes }, sonataOverride: null });
    const cappedStats = renderStats();
    assert('a capped build says so on the CRIT RATE tile', cappedStats.includes('100% cap on'));
    assert('and names the share of damage it applies to', /cap on 100% of your damage/.test(cappedStats));
}

// -- The stack stepper shows an underivable count instead of assuming one ----
// A stack the rotation cannot describe (enemy status, team composition, an
// uncurated gauge) resolves to ONE stack. The panel exists so that assumption
// is visible and correctable rather than buried in the damage total (2026-07-31,
// the same rule as the zero-value reason codes).
{
    const lynae = resoOf(1509);                       // S3.1 Premixed Hue, 55%/stack, cap 25
    const atS3 = setChain(createBuild(lynae), 3);
    setApi({ dataset: d, build: atS3, sonataOverride: null });
    const html = renderStackStepper();

    assert('the stepper renders for a resonator with an underivable stack', html.length > 0);
    assert('it names the section', html.includes("STACK COUNTS THE ROTATION CAN'T DERIVE"));
    assert('it marks the count as assumed rather than derived', html.includes('ASSUMED 1'));
    assert('it shows the recovered cap so the ceiling is visible', html.includes('/ 25'));
    assert('it offers increment and decrement controls',
        html.includes('data-act="stacks-inc"') && html.includes('data-act="stacks-dec"'));
    assert('it names the slot key the count belongs to', html.includes('data-key="S3.1"'));

    // With a user count set, the row stops calling itself assumed and RESET arms.
    const withCount = setEffectStacks(atS3, 'S3.1', 25);
    setApi({ dataset: d, build: withCount, sonataOverride: null });
    const setHtml = renderStackStepper();
    assert('a user-set row drops the ASSUMED marker', !setHtml.includes('ASSUMED 1'));
    assert('a user-set row can be reset', /data-act="stacks-clear" data-key="S3.1"(?! disabled)/.test(setHtml));
    assert('increment is disabled at the cap', /data-act="stacks-inc" data-key="S3.1" disabled/.test(setHtml));

    // A resonator whose stacks are all derivable (or has none) shows nothing.
    setApi({ dataset: d, build: createBuild(resoOf(1102)), sonataOverride: null });
    assert('no underivable stacks -> no panel at all', renderStackStepper() === '');
}


// ── Donut damage families: Forte is ONE slice, not two (OPEN-ITEMS #10) ─────
// `forte_basic` / `forte_heavy` is a mechanical split (which multiplierUp a
// node matches) that already shares a label, colour and badge. Accumulating the
// donut on the raw node type drew TWO identical "Forte Circuit" arcs for the
// five resonators whose reference rotation uses both — Iuno's Forte is 68% of
// her damage and was shown as a 26% arc beside a 43% arc.
{
    assert('both Forte node types collapse to one damage family',
        damageFamily('forte_basic') === 'forte' && damageFamily('forte_heavy') === 'forte');
    assert('...and that family has a label, badge and colour of its own',
        TYPE_LABEL.forte === 'Forte Circuit' && STEP_TYPE.forte?.abbr === 'FC');
    assert('every other step type is passed through untouched',
        ['basic', 'heavy', 'skill', 'liberation', 'intro', 'outro', 'echo']
            .every(type => damageFamily(type) === type));

    // Live: no reference rotation may produce two slices sharing a label.
    const target = { level: 90, atkLv: 90, resistances: {} };
    const offenders = [];
    for (const [id, entry] of Object.entries(referenceRotations)) {
        const skillMap = d.autoSkillMap[id] ?? {};
        const resonator = d.resonators.find(candidate => String(candidate.id) === id);
        if (!resonator || !entry.rotation?.length) continue;
        let build = createBuild(resonator);
        if (entry.resonanceMode) build.resonanceMode = entry.resonanceMode;
        for (const key of entry.rotation) {
            if (skillMap[key] || key === '__echo__') build = appendRotationStep(build, key);
        }
        const sim = simulateRotation({ build, dataset: d, target });
        const labels = [...new Set(sim.steps.filter(step => step.stepDamage > 0)
            .map(step => damageFamily(step.skillType)))].map(type => TYPE_LABEL[type] ?? type);
        if (labels.length !== new Set(labels).size) offenders.push(resonator.name);
    }
    assert('no reference rotation draws two donut slices with the same label',
        offenders.length === 0);
    if (offenders.length) console.error('    duplicate-label donuts:', offenders.join(', '));

    // The merge must conserve damage, not just dedupe labels.
    const iuno = d.resonators.find(candidate => candidate.name === 'Iuno');
    if (iuno) {
        const entry = referenceRotations[String(iuno.id)];
        const skillMap = d.autoSkillMap[String(iuno.id)] ?? {};
        let build = createBuild(iuno);
        for (const key of entry.rotation) {
            if (skillMap[key] || key === '__echo__') build = appendRotationStep(build, key);
        }
        const sim = simulateRotation({ build, dataset: d, target });
        const raw = sim.steps.filter(step => step.stepDamage > 0
            && damageFamily(step.skillType) === 'forte')
            .reduce((sum, step) => sum + step.stepDamage, 0);
        const byFamily = new Map();
        for (const step of sim.steps) {
            if (!(step.stepDamage > 0)) continue;
            const family = damageFamily(step.skillType);
            byFamily.set(family, (byFamily.get(family) ?? 0) + step.stepDamage);
        }
        assert('Iuno\'s two Forte node types sum into one slice, losing nothing',
            Math.abs((byFamily.get('forte') ?? 0) - raw) < 1e-6 && raw > 0);
    }
}


console.log(`\nbuild-editor-v2: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
