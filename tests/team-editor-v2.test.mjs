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
import { createTeam, setTeamSlot } from '../src/core/team.js';
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
        assert(`element ${id} has name+hex`, !!ELEM[id]?.name && /^#[0-9a-f]{6}$/i.test(ELEM[id]?.c));
    }
    // Repo element colours win over the handoff's (e.g. Glacio is the repo's
    // #5fc0f5, not the handoff's #5fb8ff).
    assert('Glacio uses the repo colour', ELEM[1].c === '#5fc0f5');
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
    assert('rotation tints element @ cc', segColor('rotation', '#5fc0f5') === '#5fc0f5cc');
    assert('intro fixed green', segColor('intro', '#5fc0f5') === '#86efac88');
    assert('outro fixed pink', segColor('outro', '#5fc0f5') === '#f9a8d460');
    assert('offField tints element @ 44', segColor('offField', '#5fc0f5') === '#5fc0f544');
}

// ── DMG badge/colour completeness ───────────────────────────────────────────
{
    for (const cat of ['basic', 'heavy', 'skill', 'liberation', 'echo', 'intro', 'outro']) {
        assert(`dmg colour for ${cat}`, /^#[0-9a-f]{6}$/i.test(DMG_COLOR[cat]));
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
    const clickHandlers = [];
    const stub = () => ({
        innerHTML: '', style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        appendChild() {}, addEventListener() {}, querySelector() { return stub(); },
        querySelectorAll() { return []; }, contains() { return true; },
    });
    const hostNode = stub();
    Object.defineProperty(hostNode, 'innerHTML', { get() { return lastHTML; }, set(v) { lastHTML = v; } });
    hostNode.contains = () => true;
    hostNode.addEventListener = (type, cb) => { if (type === 'click') clickHandlers.push(cb); };

    globalThis.window = { innerWidth: 1200, innerHeight: 800 };
    globalThis.document = { createElement: () => stub(), body: { classList: { toggle() {} }, appendChild() {} } };

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
    // prompts for a name pre-filled with the auto-generated suggestion; accepting
    // it persists the team and shows a confirmation toast.
    let promptCalls = [];
    globalThis.prompt = (msg, def) => { promptCalls.push([msg, def]); return def; };
    const saveEv = { target: { closest: (sel) => (sel === '[data-act="save-team"]' ? {} : null) }, stopPropagation() {}, preventDefault() {} };
    let saveThrew = false;
    try {
        for (const cb of clickHandlers) cb(saveEv);
    } catch (e) { saveThrew = true; console.error('    save-team click threw:', e.message); }
    assert('save-team click does not throw', !saveThrew);
    assert('default-named team prompts for a name', promptCalls.length === 1);
    assert('prompt suggests the occupied member\'s name', promptCalls[0]?.[1] === reso.name);
    assert('toast confirms the save', lastHTML.includes('bv2-party-toast') && lastHTML.includes(reso.name));

    // Re-saving an already-named team (accepted the suggestion above) must not
    // prompt again — it should just persist + re-confirm.
    promptCalls = [];
    for (const cb of clickHandlers) cb(saveEv);
    assert('re-saving an already-named team does not prompt', promptCalls.length === 0);
    assert('re-save still shows a confirmation toast', lastHTML.includes('bv2-party-toast'));

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
