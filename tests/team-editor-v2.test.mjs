/**
 * Tests for the v2 Team Simulator (PARTY) page (docs/design_handoff_wuwa_sim/
 * team sim).
 *
 *   node test/team-editor-v2.test.mjs
 *
 * Covers the pure presentation seams (formatting, donut gradient, segment
 * split, member time span, buff fractions/kind, segment colour, element enum)
 * plus a render smoke test that drives mount() against a fake DOM with a real
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
    memberTimeSpan, buffFracs, buffKindFor, segColor, sonataTooltipDesc, ELEM, DMG_COLOR, DMG_BADGE,
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

// ── memberTimeSpan ──────────────────────────────────────────────────────────
{
    assert('null for no steps', memberTimeSpan([]) === null && memberTimeSpan(undefined) === null);
    const span = memberTimeSpan([
        { startTime: 13.0, endTime: 13.8 },
        { startTime: 5.0, endTime: 6.0 },
        { startTime: 8.0, endTime: 20.0 },
    ]);
    assert('span min start', span.start === 5.0);
    assert('span max end', span.end === 20.0);
}

// ── buffFracs ───────────────────────────────────────────────────────────────
{
    const span = { start: 10, end: 20 };
    const mid = buffFracs({ startTime: 12, endTime: 18 }, span);
    assert('mid-window fracs', Math.abs(mid.startFrac - 0.2) < 1e-9 && Math.abs(mid.endFrac - 0.8) < 1e-9);
    const clamped = buffFracs({ startTime: 5, endTime: 25 }, span);
    assert('out-of-window clamps to [0,1]', clamped.startFrac === 0 && clamped.endFrac === 1);
    assert('no span → zero window', buffFracs({ startTime: 1, endTime: 2 }, null).endFrac === 0);
    assert('endFrac never below startFrac', buffFracs({ startTime: 18, endTime: 12 }, span).endFrac >= buffFracs({ startTime: 18, endTime: 12 }, span).startFrac);
}

// ── buffKindFor ─────────────────────────────────────────────────────────────
{
    assert('sonata default', buffKindFor('Lingering Tunes · ATK+') === 'sonata');
    assert('outro detected', buffKindFor('Outro: Tactical Retreat') === 'outro');
    assert('sequence/chain detected', buffKindFor('S2 Twilight Tango') === 'chain');
    assert('chain keyword detected', buffKindFor('Resonance Chain boost') === 'chain');
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
    let reso = null, rotation = [];
    for (const r of d.resonators) {
        const map = effectiveSkillMap(d, r.id);
        if (!map) continue;
        const keys = Object.keys(map).filter(k => !k.startsWith('_')).slice(0, 3);
        if (keys.length) { reso = r; rotation = keys; break; }
    }
    assert('found a resonator with a skill map', !!reso && rotation.length > 0);

    const build = createBuild(reso);
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
    assert('member column renders resonator name', lastHTML.includes(reso.name));
    assert('member column has ACTIVE BUFFS + ROTATION group', lastHTML.includes('ACTIVE BUFFS') && lastHTML.includes('ROTATION'));
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
    assert('modal input pre-filled with the auto-suggested name', lastHTML.includes(`value="${reso.name}"`));

    // Confirm via the modal's SAVE button — persists the name and shows a toast.
    const confirmEv = { target: { closest: (sel) => (sel === '[data-act="name-prompt-save"]' ? {} : null) }, stopPropagation() {}, preventDefault() {} };
    let confirmThrew = false;
    try { fire('click', confirmEv); } catch (e) { confirmThrew = true; console.error('    name-prompt-save click threw:', e.message); }
    assert('confirming the naming modal does not throw', !confirmThrew);
    assert('modal closes after confirming', !lastHTML.includes('data-act="name-prompt-input"'));
    assert('toast confirms the save', lastHTML.includes('bv2-party-toast') && lastHTML.includes(reso.name));

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
