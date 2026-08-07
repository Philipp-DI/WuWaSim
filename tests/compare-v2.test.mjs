/**
 * Tests for the v2 Compare page (docs/design_handoff_wuwa_sim/compare page).
 *
 *   node test/compare-v2.test.mjs
 *
 * Covers the pure helpers (mkCell's best/delta/fill algorithm, fmtDmg/fmtPct/
 * fmtDur, damageBreakdown aggregation) plus a render smoke test that drives
 * mount() against a fake DOM with real builds/teams built from wuwa-data.json,
 * exercising mode toggle, add-via-picker, and slot removal without throwing.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mount, fmtDmg, fmtPct, fmtDur, mkCell, damageBreakdown, __test__ } from '../src/ui/components/compare-v2.js';
import { createBuild } from '../src/core/build.js';
import { createTeam, setTeamSlot } from '../src/core/team.js';
import { effectiveSkillMap } from '../src/core/sim.js';

const { ELEM, DMG_COLOR, DMG_ORDER } = __test__;

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── fmtDmg / fmtPct / fmtDur ─────────────────────────────────────────────────
{
    assert('fmtDmg millions', fmtDmg(4911000) === '4.91M');
    assert('fmtDmg thousands', fmtDmg(169000) === '169K');
    assert('fmtDmg small', fmtDmg(500) === '500');
    assert('fmtDmg non-finite -> dash', fmtDmg(NaN) === '—');
    assert('fmtPct one decimal', fmtPct(71.4) === '71.4%');
    assert('fmtDur one decimal + s', fmtDur(12) === '12.0s');
}

// ── mkCell ───────────────────────────────────────────────────────────────────
{
    const higher = mkCell(100, 100, 50, true);
    assert('higher-is-better: max value is best', higher.isBest === true);
    assert('best cell has full fill', higher.fill === 1.0);
    assert('best cell has zero delta', higher.deltaPct === 0);

    const loserHigher = mkCell(50, 100, 50, true);
    assert('higher-is-better: min value is not best', loserHigher.isBest === false);
    assert('loser delta is negative', loserHigher.deltaPct < 0);
    assert('loser delta is -50%', Math.abs(loserHigher.deltaPct - (-50)) < 0.01);

    const lower = mkCell(5, 10, 5, false);
    assert('lower-is-better: min value is best', lower.isBest === true);
    const loserLower = mkCell(10, 10, 5, false);
    assert('lower-is-better: max value is not best', loserLower.isBest === false);

    const single = mkCell(42, 42, 42, true);
    assert('single value (range=0) is best', single.isBest === true);
    assert('single value fills completely', single.fill === 1.0);

    assert('fill never drops below 0.05', mkCell(0, 100, 0, true).fill >= 0.05);
}

// ── damageBreakdown ──────────────────────────────────────────────────────────
{
    assert('empty steps -> empty breakdown', damageBreakdown([]).length === 0);
    const segs = damageBreakdown([
        { damageCategory: 'basic', stepDamage: 100 },
        { damageCategory: 'skill', stepDamage: 300 },
        { damageCategory: 'basic', stepDamage: 0 }, // zero-damage step ignored
    ]);
    assert('aggregates by category', segs.length === 2);
    const basic = segs.find(s => s.key === 'basic');
    const skill = segs.find(s => s.key === 'skill');
    assert('basic total correct', basic.dmg === 100);
    assert('skill pct is 75%', Math.abs(skill.pct - 75) < 0.01);
    assert('order follows DMG_ORDER', segs[0].key === 'basic' && segs[1].key === 'skill');
}

// ── Element/colour enum completeness ─────────────────────────────────────────
{
    assert('6 elements defined', Object.keys(ELEM).length === 6);
    // Tune Break joined the categories 2026-08-03 — it is a rotation step like
    // any other, and leaving it out of these maps drops real damage from the
    // breakdown rather than colouring it wrong.
    const CATEGORIES = ['basic', 'heavy', 'skill', 'liberation', 'echo', 'intro', 'outro', 'tuneBreak'];
    for (const cat of CATEGORIES) {
        assert(`dmg colour token for ${cat}`, /^var\(--dmg-/.test(DMG_COLOR[cat]));
    }
    assert('DMG_ORDER lists every category', DMG_ORDER.length === CATEGORIES.length
        && CATEGORIES.every(cat => DMG_ORDER.includes(cat)));
}

// ── Render smoke test (fake DOM, real data) ──────────────────────────────────
{
    function buildFor(resonator) {
        const map = effectiveSkillMap(d, resonator.id);
        const keys = map ? Object.keys(map).filter(k => !k.startsWith('_')).slice(0, 3) : [];
        const b = createBuild(resonator);
        b.rotation = keys;
        return b;
    }
    const candidates = d.resonators.filter(r => effectiveSkillMap(d, r.id));
    const [r1, r2, r3] = candidates;
    const b1 = buildFor(r1), b2 = buildFor(r2), b3 = buildFor(r3);
    const builds = new Map([[b1.id, b1], [b2.id, b2], [b3.id, b3]]);
    const resolveBuild = (id) => builds.get(id) ?? null;

    let team1 = createTeam('Alpha');
    team1 = setTeamSlot(team1, 0, b1.id);
    team1 = setTeamSlot(team1, 1, b2.id);
    const teams = [team1];

    let lastHTML = '';
    const clickHandlers = [];
    const regions = new Map();
    const stub = () => ({
        innerHTML: '', style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        appendChild() {}, addEventListener() {},
        querySelector(sel) { if (!regions.has(sel)) regions.set(sel, stub()); return regions.get(sel); },
        querySelectorAll() { return []; }, contains() { return true; },
    });
    const hostNode = stub();
    Object.defineProperty(hostNode, 'innerHTML', { get() { return lastHTML; }, set(v) { lastHTML = v; regions.clear(); } });
    hostNode.contains = () => true;
    hostNode.addEventListener = (type, cb) => { if (type === 'click') clickHandlers.push(cb); };

    globalThis.window = { innerWidth: 1200, innerHeight: 800 };
    globalThis.document = { createElement: () => stub(), body: { classList: { toggle() {} }, appendChild() {} } };

    const persisted = [];
    let threw = false;
    let api;
    try {
        api = mount(hostNode, {
            dataset: d, theme: 'dark',
            listBuilds: () => [b1, b2, b3],
            listTeams: () => teams,
            resolveBuild,
            loadCompareState: () => ({ mode: 'builds', buildSlots: [b1.id, null, null, null, null, null], teamSlots: Array(3).fill(null) }),
            saveCompareState: (s) => persisted.push(s),
        });
    } catch (e) { threw = true; console.error('    mount() threw:', e.message, e.stack); }

    assert('mount renders without throwing', !threw);
    assert('header shows the compare tab', lastHTML.includes('WUWA') && lastHTML.includes('COMPARE'));
    assert('mode toggle present', lastHTML.includes('data-act="cmp-mode"'));
    // Regression: build-editor-v2.js's Resonance Mode buttons use a bare
    // data-act="mode" on the same persistent #main root — compare-v2.js's
    // toggle must NOT reuse that literal name (see renderModeToggle's comment).
    assert('mode toggle does not reuse the colliding bare "mode" action', !lastHTML.includes('data-act="mode"'));
    assert('slot manager shows the loaded build', lastHTML.includes(r1.name));
    assert('builds table sections present', lastHTML.includes('CORE STATS') && lastHTML.includes('SIMULATION') && lastHTML.includes('DAMAGE BREAKDOWN'));
    assert('mount returns an update() handle', typeof api?.update === 'function');

    // Regression: revisiting #compare (a second mount() on the same root)
    // must not restack click listeners — each on() call would otherwise
    // re-attach, multiplying side effects per click on every revisit.
    const handlersAfterFirstMount = clickHandlers.length;
    mount(hostNode, {
        dataset: d, theme: 'dark',
        listBuilds: () => [b1, b2, b3], listTeams: () => teams, resolveBuild,
        loadCompareState: () => ({ mode: 'builds', buildSlots: Array(6).fill(null), teamSlots: Array(3).fill(null) }),
        saveCompareState: (s) => persisted.push(s),
    });
    assert('re-mounting does not restack click listeners on the root', clickHandlers.length === handlersAfterFirstMount);

    // Simulates `event.target.closest(selector)` for the on() delegation used
    // throughout compare-v2.js — matches exact `[data-act="x"]` selectors and
    // prefix `[data-act^="x:"]` selectors, mirroring real DOM `closest` behavior.
    function fire(handlers, act, extra = {}) {
        const dataset = { act, ...extra };
        const ev = {
            target: {
                closest: (sel) => {
                    if (sel === `[data-act="${act}"]`) return { dataset };
                    const prefix = sel.match(/^\[data-act\^="([^"]+)"\]$/)?.[1];
                    if (prefix && act.startsWith(prefix)) return { dataset };
                    return null;
                },
            },
            stopPropagation() {},
        };
        for (const cb of handlers) cb(ev);
    }

    // Switch to teams mode.
    let modeThrew = false;
    try { fire(clickHandlers, 'cmp-mode', { val: 'teams' }); } catch (e) { modeThrew = true; console.error('    mode-click threw:', e.message); }
    assert('mode switch does not throw', !modeThrew);
    assert('teams mode shows the empty state (no team slots loaded)', lastHTML.includes('NOTHING TO COMPARE'));
    assert('mode switch persists state', persisted.some(s => s.mode === 'teams'));

    // Open the team picker and select team1.
    let pickThrew = false;
    try {
        fire(clickHandlers, 'add-team');
        assert('picker opens with team list', lastHTML.includes('SELECT TEAM') && lastHTML.includes('Alpha'));
        fire(clickHandlers, 'pick-team', { id: team1.id });
    } catch (e) { pickThrew = true; console.error('    team-pick threw:', e.message); }
    assert('picking a team does not throw', !pickThrew);
    assert('picked team now shows in the table', lastHTML.includes('Alpha') && lastHTML.includes('DAMAGE SHARE'));
    assert('picker closes after selection', !lastHTML.includes('SELECT TEAM'));

    // Remove the team via its header remove button.
    let rmThrew = false;
    try { fire(clickHandlers, 'rm-team-slot', { slot: '0' }); } catch (e) { rmThrew = true; console.error('    rm-team-slot threw:', e.message); }
    assert('removing a team slot does not throw', !rmThrew);
    assert('back to empty state after removal', lastHTML.includes('NOTHING TO COMPARE'));
}

console.log(`\ncompare-v2: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
