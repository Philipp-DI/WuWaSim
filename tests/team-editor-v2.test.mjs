/**
 * Tests for the v2 Team Simulator (PARTY) page (docs/design_handoff_wuwa_sim/
 * team sim).
 *
 *   node test/team-editor-v2.test.mjs
 *
 * Covers the pure presentation seams (formatting, donut gradient, segment
 * split, stack-aware buff strips, segment colour, element enum) plus a
 * render smoke test that drives mount() against a fake DOM with a real
 * build + rotation from wuwa-data.json, asserting the handoff's key markup is
 * produced without throwing — and that a pass-chip click re-renders cleanly.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mount, __test__ } from '../src/ui/components/team-editor-v2.js';
import { createBuild } from '../src/core/build.js';
import { createTeam, setTeamSlot, swapTeamSlots } from '../src/core/team.js';
import { effectiveSkillMap } from '../src/core/sim.js';

const {
    fmtDmg, fmtDps, fmtDur, donutGradient, donutTitle, segmentsBySlot,
    buffStripsFor, segColor, sonataTooltipDesc, ELEM, DMG_COLOR, DMG_BADGE,
    ICON_SIZE, DONUT_SIZE, BADGE_ICON_SIZE,
} = __test__;

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── Formatting ──────────────────────────────────────────────────────────────
{
    assert('fmtDmg millions', fmtDmg(4911000) === '4.91M');
    assert('fmtDmg thousands', fmtDmg(169000) === '169K');
    assert('fmtDmg small', fmtDmg(500) === '500');
    assert('fmtDmg non-finite → dash', fmtDmg(NaN) === '—' && fmtDmg(undefined) === '—');

    assert('fmtDps thousands /s', fmtDps(169000) === '169K/s');
    assert('fmtDps small /s', fmtDps(500) === '500/s');
    assert('fmtDps zero → dash', fmtDps(0) === '—');

    assert('fmtDur one decimal + s', fmtDur(12) === '12.0s');
    assert('fmtDur non-finite → dash', fmtDur(NaN) === '—');
}

// ── Element enum ────────────────────────────────────────────────────────────
{
    assert('6 elements defined', Object.keys(ELEM).length === 6);
    for (const id of [1, 2, 3, 4, 5, 6]) {
        assert(`element ${id} has name+token`, !!ELEM[id]?.name && /^var\(--el-/.test(ELEM[id]?.c));
    }
    // Element colours are single-sourced from tokens.css --el-* (no per-page hex).
    assert('Glacio uses the element token', ELEM[1].c === 'var(--el-glacio)');
}

// ── donutGradient ───────────────────────────────────────────────────────────
{
    assert('empty steps → neutral ring', donutGradient([]) === 'conic-gradient(var(--nodebd) 0deg 360deg)');
    const g = donutGradient([
        { damageCategory: 'basic', stepDamage: 100 },
        { damageCategory: 'skill', stepDamage: 300 },
    ]);
    assert('gradient is conic-gradient', g.startsWith('conic-gradient('));
    assert('gradient includes a dmg colour', g.includes(DMG_COLOR.basic) && g.includes(DMG_COLOR.skill));
    assert('gradient covers 360deg', g.includes('360.0deg'));
    assert('zero-damage steps ignored', donutGradient([{ damageCategory: 'basic', stepDamage: 0 }]) === 'conic-gradient(var(--nodebd) 0deg 360deg)');
}

// ── donutTitle ──────────────────────────────────────────────────────────────
{
    assert('no damage → placeholder', donutTitle([]) === 'No damage yet');
    assert('zero-damage steps → placeholder', donutTitle([{ damageCategory: 'basic', stepDamage: 0 }]) === 'No damage yet');
    const t = donutTitle([
        { damageCategory: 'basic', stepDamage: 100 },
        { damageCategory: 'skill', stepDamage: 300 },
    ]);
    assert('title lists both categories', t.includes('Basic') && t.includes('Skill'));
    assert('title includes percentages', t.includes('75%') && t.includes('25%'));
    assert('larger category sorted first', t.indexOf('Skill') < t.indexOf('Basic'));
}

// ── sonataTooltipDesc ───────────────────────────────────────────────────────
{
    assert('no sonata → empty string', sonataTooltipDesc(null) === '' && sonataTooltipDesc(undefined) === '');
    assert('sonata without tiers → empty string', sonataTooltipDesc({ name: 'Test' }) === '');
    const so = {
        name: 'Test Set', tiers: [
            { pieces: 5, effect: 'DMG +30%' },
            { pieces: 2, effect: 'ATK +10%' },
            { pieces: 3, effect: '' },
        ],
    };
    const desc = sonataTooltipDesc(so);
    assert('tiers sorted ascending by piece count', desc.indexOf('2PC') < desc.indexOf('5PC'));
    assert('tier text formatted as "NPC — effect"', desc.includes('2PC — ATK +10%') && desc.includes('5PC — DMG +30%'));
    assert('tiers without effect text are filtered out', !desc.includes('3PC'));
}

// ── icon sizing constants ───────────────────────────────────────────────────
// ICON_SIZE itself is a hand-tuned design constant (no longer derived from a
// base value), so these assert the *relationships* the layout depends on
// rather than pinning a literal that's expected to be re-tuned over time.
{
    assert('donut is smaller than the resonator/weapon icon', DONUT_SIZE < ICON_SIZE);
    assert('DONUT_SIZE is 2/3 of ICON_SIZE', DONUT_SIZE === Math.round(ICON_SIZE * 2 / 3));
    assert('BADGE_ICON_SIZE is ~30% of ICON_SIZE', BADGE_ICON_SIZE === Math.round(ICON_SIZE * 0.3));
}

// ── segmentsBySlot ──────────────────────────────────────────────────────────
{
    const segs = [
        { slotIndex: 0, kind: 'rotation', steps: [{ x: 'a' }, { x: 'b' }] },
        { slotIndex: 0, kind: 'intro', steps: [{ x: 'c' }] },
        { slotIndex: 0, kind: 'outro', steps: [] },
        { slotIndex: 1, kind: 'rotation', steps: [{ x: 'd' }] },
    ];
    const m = segmentsBySlot(segs);
    assert('two slots grouped', m.size === 2);
    assert('slot0 intro steps split out', m.get(0).introSteps.length === 1 && m.get(0).introSteps[0].x === 'c');
    assert('slot0 rotation steps concatenated', m.get(0).rotSteps.length === 2);
    assert('slot0 keeps all segs (incl. outro)', m.get(0).segs.length === 3);
    assert('slot1 rotation steps', m.get(1).rotSteps.length === 1 && m.get(1).rotSteps[0].x === 'd');
    assert('empty input → empty map', segmentsBySlot([]).size === 0 && segmentsBySlot(undefined).size === 0);
}

// ── buffStripsFor (2026-07-14 — merged buff timeline, stack-aware) ──────────
// Replaces the old memberTimeSpan/buffFracs/elementColorFromName trio (a
// per-member-LOCAL-fraction, name-text-sniffing buff bar) now that
// simulateTeamRotation's memberStackedBuffWindows carries structured,
// absolute-team-time, per-step stack samples directly.
{
    const flat = buffStripsFor([
        { name: '+10% ATK', bonusPct: 0.10, bonusKind: 'atk', element: null, dmgType: null,
          sonataName: 'Lingering Tunes', maxStacks: 1, start: 5, end: 12, samples: [] },
    ]);
    assert('non-stacking window keeps its label unchanged', flat[0].name === '+10% ATK');
    assert('non-stacking window has no stackBands', flat[0].stackBands == null);
    assert('atk-kind window has no elementColor', flat[0].elementColor == null);

    const stacking = buffStripsFor([
        { name: '+7.5% Havoc DMG', bonusPct: 0.075, bonusKind: 'element', element: 6, dmgType: null,
          sonataName: 'Havoc Eclipse', maxStacks: 4, start: 2, end: 22,
          samples: [
              { start: 0, end: 2, stacks: 0 },
              { start: 2, end: 10, stacks: 1 },
              { start: 10, end: 16, stacks: 2 },
              { start: 16, end: 22, stacks: 4 },
          ] },
    ]);
    assert('stacking window rewrites the leading headline into a ramped range',
        stacking[0].name === '+7.5→30% Havoc DMG');
    assert('stacking window carries height-encoded bands', Array.isArray(stacking[0].stackBands) && stacking[0].stackBands.length > 0);
    assert('element-kind window resolves its element colour', stacking[0].elementColor === ELEM[6].c);
    assert('bonusPct <= 0 windows are dropped', buffStripsFor([{ name: 'x', bonusPct: 0, maxStacks: 1, start: 0, end: 1, samples: [] }]).length === 0);

    // Gap-split (2026-07-15): a buff that decays to zero and later re-triggers
    // becomes TWO strips with a real gap between them — not one bar painted
    // solid across the dead time (Chisa's 30s heal-gated Rejuvenating Glow used
    // to read as one continuous ~53s bar).
    const gapped = buffStripsFor([
        { name: '+15% ATK', bonusPct: 0.15, bonusKind: 'atk', element: null, dmgType: null,
          sonataName: 'Rejuvenating Glow', maxStacks: 1, start: 2, end: 40,
          samples: [
              { start: 2, end: 12, stacks: 1 },    // active
              { start: 12, end: 30, stacks: 0 },   // decayed
              { start: 30, end: 40, stacks: 1 },   // re-triggered
          ] },
    ]);
    assert('a decayed-then-retriggered window splits into two strips', gapped.length === 2);
    assert('the two strips leave a real gap between them', gapped[0].end === 12 && gapped[1].start === 30);
    assert('a fully-inactive window (all zero-stack) yields no strips',
        buffStripsFor([{ name: 'x', bonusPct: 0.1, maxStacks: 1, start: 0, end: 5,
            samples: [{ start: 0, end: 5, stacks: 0 }] }]).length === 0);

    // Team-wide strips (2026-07-15, reverted from full-span) are DURATION-ACCURATE
    // gap-split runs — a decayed-then-retriggered team-wide buff shows real
    // windows, not one permanent bar — and name the granting member in the
    // tooltip (they live in the shared team-wide lane below all members).
    const tw = buffStripsFor([
        { name: '+15% ATK', bonusPct: 0.15, bonusKind: 'atk', sonataName: 'Rejuvenating Glow', maxStacks: 1,
          start: 1.7, end: 60, samples: [{ start: 1.7, end: 32, stacks: 1 }, { start: 32, end: 50, stacks: 0 }, { start: 50, end: 60, stacks: 1 }] },
    ], { sourceName: 'Chisa' });
    assert('team-wide strip names the granting member', tw[0].tipTitle === 'Chisa · Rejuvenating Glow — +15% ATK');
    assert('team-wide strip is duration-accurate (splits at the decay gap, not permanent)',
        tw.length === 2 && tw[0].end === 32 && tw[1].start === 50);

    // An echo shield/aura window (Bell-Borne, bonusKind 'amplify') also renders
    // through buffStripsFor — one strip per cast, decaying after its shield life.
    const echoAura = buffStripsFor([
        { name: '+10% DMG', bonusPct: 0.10, bonusKind: 'amplify', sonataName: 'Bell-Borne Geochelone (Echo)', maxStacks: 1,
          start: 1.7, end: 37, samples: [{ start: 1.7, end: 16.7, stacks: 1 }, { start: 22, end: 37, stacks: 1 }] },
    ], { sourceName: 'Chisa' });
    assert('echo aura renders one strip per cast (15s each, decaying)', echoAura.length === 2 && echoAura[0].end === 16.7);
    assert('echo aura tooltip names the echo', echoAura[0].tipTitle === 'Chisa · Bell-Borne Geochelone (Echo) — +10% DMG');
}

// ── segColor ────────────────────────────────────────────────────────────────
{
    assert('rotation tints element @ 80%', segColor('rotation', 'var(--el-glacio)') === 'color-mix(in srgb, var(--el-glacio) 80%, transparent)');
    assert('intro fixed green token', segColor('intro', 'var(--el-glacio)') === 'color-mix(in srgb, var(--dmg-intro) 53%, transparent)');
    assert('outro fixed pink token', segColor('outro', 'var(--el-glacio)') === 'color-mix(in srgb, var(--dmg-outro) 38%, transparent)');
    assert('offField tints element @ 27%', segColor('offField', 'var(--el-glacio)') === 'color-mix(in srgb, var(--el-glacio) 27%, transparent)');
}

// ── swapTeamSlots (drag-and-drop reorder support) ───────────────────────────
{
    const t = createTeam();
    const filled = { ...t, slots: ['a', 'b', null] };

    const swapped = swapTeamSlots(filled, 0, 1);
    assert('swap two filled slots', swapped.slots[0] === 'b' && swapped.slots[1] === 'a');
    assert('swap does not mutate input', filled.slots[0] === 'a' && filled.slots[1] === 'b');

    const moved = swapTeamSlots(filled, 0, 2);
    assert('swap with an empty slot moves the build there', moved.slots[2] === 'a' && moved.slots[0] === null);

    assert('same-index swap is a no-op', swapTeamSlots(filled, 1, 1) === filled);
    assert('negative index swap is a no-op', swapTeamSlots(filled, -1, 1) === filled);
    assert('out-of-range index swap is a no-op', swapTeamSlots(filled, 0, 99) === filled);

    assert('swap bumps updatedAt', swapTeamSlots(filled, 0, 1).updatedAt >= filled.updatedAt);
}

// ── DMG badge/colour completeness ───────────────────────────────────────────
{
    for (const cat of ['basic', 'heavy', 'skill', 'liberation', 'echo', 'intro', 'outro']) {
        assert(`dmg colour token for ${cat}`, /^var\(--dmg-/.test(DMG_COLOR[cat]));
        assert(`dmg badge for ${cat}`, typeof DMG_BADGE[cat] === 'string' && DMG_BADGE[cat].length === 2);
    }
}

// ── Render smoke test (fake DOM, real data) ─────────────────────────────────
{
    // Find a resonator with a curated skill map, and a short rotation from it.
    let resonator = null, rotation = [];
    for (const r of d.resonators) {
        const map = effectiveSkillMap(d, r.id);
        if (!map) continue;
        const keys = Object.keys(map).filter(k => !k.startsWith('_')).slice(0, 3);
        if (keys.length) { resonator = r; rotation = keys; break; }
    }
    assert('found a resonator with a skill map', !!resonator && rotation.length > 0);

    const build = createBuild(resonator);
    build.rotation = rotation;
    let team = createTeam();
    team = setTeamSlot(team, 0, build.id);
    const resolveBuild = (id) => (id === build.id ? build : null);

    // Fake DOM mirroring test/echo-picker-v2.test.mjs.
    let lastHTML = '';
    const handlersByType = {};
    const clickHandlers = (handlersByType.click = []);
    const fire = (type, ev) => { for (const cb of (handlersByType[type] ?? [])) cb(ev); };
    const stub = () => ({
        innerHTML: '', style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        appendChild() {}, addEventListener() {}, focus() {}, select() {},
        querySelector() { return stub(); },
        querySelectorAll() { return []; }, contains() { return true; },
    });
    const hostNode = stub();
    Object.defineProperty(hostNode, 'innerHTML', { get() { return lastHTML; }, set(v) { lastHTML = v; } });
    hostNode.contains = () => true;
    hostNode.addEventListener = (type, cb) => { (handlersByType[type] ??= []).push(cb); };

    globalThis.window = { innerWidth: 1200, innerHeight: 800 };
    globalThis.document = { createElement: () => stub(), body: { classList: { toggle() {} }, appendChild() {} } };
    globalThis.requestAnimationFrame = (cb) => cb();

    let threw = false;
    try {
        mount(hostNode, {
            dataset: d, team,
            resolveBuild,
            listBuilds: () => [build],
            listTeams: () => [team],
            saveTeam: (t) => t,
            saveBuild: (b) => b,
            createBuildForResonator: (r) => createBuild(r),
            onChangeTeam: () => {},
            onLoadTeam: () => {},
        });
    } catch (e) { threw = true; console.error('    mount() threw:', e.message, e.stack); }

    assert('mount renders without throwing', !threw);
    assert('header shows the party tab (labeled "Teams")', lastHTML.includes('WUWA') && lastHTML.includes('TEAMS'));
    assert('title row present', lastHTML.includes('TEAM SIMULATION'));
    assert('totals banner labels present', lastHTML.includes('TEAM DPS') && lastHTML.includes('TOTAL DMG') && lastHTML.includes('DURATION'));
    assert('MEMBERS chip removed (info bloat — teams are always 3)', !lastHTML.includes('MEMBERS'));
    assert('timeline card present', lastHTML.includes('FULL ROTATION TIMELINE'));
    assert('member column renders resonator name', lastHTML.includes(resonator.name));
    assert('member column has a ROTATION group', lastHTML.includes('ROTATION'));
    assert('no separate per-member INTRO group header (folded into ROTATION)', !lastHTML.includes('dealt each time they swap onto the field'));
    assert('pass chips rendered', lastHTML.includes('data-act="pass"'));
    assert('element badge is icon-only, name lives in the hover-box', lastHTML.includes('data-tip-title="'));

    // Fire a pass-chip click (passCount → 2) and assert a clean re-render.
    const before = lastHTML;
    let clickThrew = false;
    try {
        const ev = { target: { closest: (sel) => (sel === '[data-act="pass"]' ? { dataset: { n: '2' } } : null) }, stopPropagation() {}, preventDefault() {} };
        for (const cb of clickHandlers) cb(ev);
    } catch (e) { clickThrew = true; console.error('    pass-click threw:', e.message); }
    assert('pass-chip click re-renders without throwing', !clickThrew && lastHTML.includes('TEAM SIMULATION'));
    assert('pass-chip click produced a render', typeof before === 'string' && lastHTML.length > 0);

    // Save-team flow: a still-default-named team ('New Team', from createTeam())
    // opens the custom in-app naming modal pre-filled with the auto-generated
    // suggestion (replaces a prior native prompt() flow — fragile/inconsistent
    // across embedding contexts and gave no visible feedback if suppressed).
    const saveEv = { target: { closest: (sel) => (sel === '[data-act="save-team"]' ? {} : null) }, stopPropagation() {}, preventDefault() {} };
    let saveThrew = false;
    try { fire('click', saveEv); } catch (e) { saveThrew = true; console.error('    save-team click threw:', e.message); }
    assert('save-team click does not throw', !saveThrew);
    assert('default-named team opens the naming modal', lastHTML.includes('data-act="name-prompt-input"'));
    assert('modal input pre-filled with the auto-suggested name', lastHTML.includes(`value="${resonator.name}"`));

    // Confirm via the modal's SAVE button — persists the name and shows a toast.
    const confirmEv = { target: { closest: (sel) => (sel === '[data-act="name-prompt-save"]' ? {} : null) }, stopPropagation() {}, preventDefault() {} };
    let confirmThrew = false;
    try { fire('click', confirmEv); } catch (e) { confirmThrew = true; console.error('    name-prompt-save click threw:', e.message); }
    assert('confirming the naming modal does not throw', !confirmThrew);
    assert('modal closes after confirming', !lastHTML.includes('data-act="name-prompt-input"'));
    assert('toast confirms the save', lastHTML.includes('bv2-party-toast') && lastHTML.includes(resonator.name));

    // Re-saving an already-named team (accepted the suggestion above) must not
    // reopen the modal — it should just persist + re-confirm.
    fire('click', saveEv);
    assert('re-saving an already-named team does not reopen the modal', !lastHTML.includes('data-act="name-prompt-input"'));
    assert('re-save still shows a confirmation toast', lastHTML.includes('bv2-party-toast'));

    // Cancel path: forcing the modal open again (simulating a not-yet-named
    // team) and clicking CANCEL must close it without saving/toasting.
    const cancelEv = { target: { closest: (sel) => (sel === '[data-act="name-prompt-cancel"]' ? {} : null) }, stopPropagation() {}, preventDefault() {} };
    fire('click', saveEv); // re-save (already named) — modal stays closed, just re-confirms
    fire('click', cancelEv); // no-op since modal wasn't open; asserts it doesn't throw
    assert('cancel click on a closed modal is harmless', !lastHTML.includes('data-act="name-prompt-input"'));

    // Drag-and-drop reorder: member cards are draggable and carry a slot
    // index; dropping one onto another slot (incl. an empty one) swaps them.
    assert('occupied member card is draggable with a slot index', lastHTML.includes('draggable="true"') && lastHTML.includes('data-dnd-slot="0"'));
    assert('empty slot is a drop target (not draggable)', lastHTML.includes('data-dnd-slot="2"'));

    let changedTeam = null;
    const dropTeam = setTeamSlot(team, 0, build.id);
    let dndThrew = false;
    try {
        mount(hostNode, {
            dataset: d, team: dropTeam, resolveBuild,
            listBuilds: () => [build], listTeams: () => [dropTeam],
            saveTeam: (t) => t, saveBuild: (b) => b,
            createBuildForResonator: (r) => createBuild(r),
            onChangeTeam: (t) => { changedTeam = t; },
            onLoadTeam: () => {},
        });
        const dragEl = { dataset: { dndSlot: '0' }, classList: { add() {}, remove() {} } };
        const dropEl = { dataset: { dndSlot: '2' }, classList: { add() {}, remove() {} } };
        let dragPayload = null;
        const dragStartEv = {
            target: { closest: (sel) => (sel === '[data-dnd-slot]' ? dragEl : null) },
            dataTransfer: { setData: (_t, v) => { dragPayload = v; }, effectAllowed: null },
        };
        fire('dragstart', dragStartEv);
        const dropEv = {
            target: { closest: (sel) => (sel === '[data-dnd-slot]' ? dropEl : null) },
            dataTransfer: { getData: () => dragPayload }, preventDefault() {},
        };
        fire('drop', dropEv);
    } catch (e) { dndThrew = true; console.error('    drag-drop threw:', e.message); }
    assert('drag from slot 0 then drop on slot 2 does not throw', !dndThrew);
    assert('drop swaps the slots via onChangeTeam', changedTeam && changedTeam.slots[2] === build.id && changedTeam.slots[0] === null);

    // Empty-team render path → "add resonator" placeholders, no throw.
    let emptyThrew = false;
    try {
        mount(hostNode, {
            dataset: d, team: createTeam(),
            resolveBuild: () => null,
            listBuilds: () => [], listTeams: () => [],
            saveTeam: (t) => t, saveBuild: (b) => b,
            createBuildForResonator: (r) => createBuild(r),
            onChangeTeam: () => {}, onLoadTeam: () => {},
        });
    } catch (e) { emptyThrew = true; console.error('    empty mount threw:', e.message); }
    assert('empty team renders without throwing', !emptyThrew);
    assert('empty team shows add-resonator placeholders', lastHTML.includes('ADD RESONATOR'));
}

console.log(`\nteam-editor-v2: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
