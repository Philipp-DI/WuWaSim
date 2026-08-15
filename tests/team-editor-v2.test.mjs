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
    fmtDmg, fmtDps, fmtDur, donutGradient, donutTitle, segmentsBySlot, clockFor, differsFromRecipe,
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
// ONE time-ordered list per member. The old shape split intro from rotation and
// the card rendered `[...introSteps, ...rotSteps]`, which is chronological only
// for a single pass: on a 3-pass run every auto-injected Intro (t≈43s, t≈87s)
// was drawn ABOVE the t=0 opening cast.
{
    const segs = [
        { slotIndex: 0, kind: 'rotation', pass: 0, steps: [{ x: 'a', startTime: 0 }, { x: 'b', startTime: 1 }] },
        { slotIndex: 0, kind: 'outro',    pass: 0, steps: [{ x: 'o', startTime: 2 }] },
        { slotIndex: 0, kind: 'intro',    pass: 1, steps: [{ x: 'c', startTime: 40 }] },
        { slotIndex: 0, kind: 'rotation', pass: 1, steps: [{ x: 'e', startTime: 41 }] },
        { slotIndex: 0, kind: 'offField', pass: 0, steps: [{ x: 'f', startTime: 0.5 }] },
        { slotIndex: 1, kind: 'rotation', pass: 0, steps: [{ x: 'd', startTime: 3 }] },
    ];
    const m = segmentsBySlot(segs);
    assert('two slots grouped', m.size === 2);
    assert('slot0 keeps all segs (incl. offField)', m.get(0).segs.length === 5);
    // THE FIX: chronological, and the pass-2 intro sits at its own time, not on top.
    assert('slot0 steps are in time order',
        m.get(0).steps.map(s => s.x).join('') === 'aboce');
    assert('an intro is not hoisted above the opening cast',
        m.get(0).steps[0].x === 'a' && m.get(0).steps.findIndex(s => s.x === 'c') === 3);
    // An OUTRO is a real cast credited to the outgoing member (up to 795% of
    // ATK) — excluded before, so its damage sat in the total with no row.
    assert('outro steps are listed', m.get(0).steps.some(s => s.x === 'o'));
    // offField actions fire while someone ELSE is on field; the timeline owns them.
    assert('offField steps are NOT listed', !m.get(0).steps.some(s => s.x === 'f'));
    assert('each step carries its pass', m.get(0).steps.find(s => s.x === 'c').pass === 1);
    assert('each step carries its segment kind', m.get(0).steps.find(s => s.x === 'o').segmentKind === 'outro');
    // The sim result is not the renderer's to mutate.
    assert('source steps are not mutated', segs[0].steps[0].pass === undefined);
    assert('slot1 rotation steps', m.get(1).steps.length === 1 && m.get(1).steps[0].x === 'd');
    assert('empty input → empty map', segmentsBySlot([]).size === 0 && segmentsBySlot(undefined).size === 0);
}

// ── differsFromRecipe — the YOUR BUILD badge ────────────────────────────────
// Opening a suggested team materializes each member's recipe, EXCEPT where the
// user already owns a real build for that resonator — that one wins silently
// (suggested-teams-panel.js buildIdFor). The team then runs a different
// rotation than the card that sent you there advertised, which is exactly how
// it was reported: as a bug in the displayed rotation.
{
    const meta = { teams: { memberBuilds: { 1211: {
        recipe: { weaponId: 7, sonataId: 3, mode: 'fusion_burst', rotation: ['a', 'b'], openerRotation: [], echoes: [] },
    } } } };
    const sonataIdOf = (build) => build.sonataId ?? null;
    const template = { template: true };
    const match = { resonatorId: 1211, rotation: ['a', 'b'], openerRotation: [], weapon: { id: 7 }, sonataId: 3, resonanceMode: 'fusion_burst' };

    assert('a member matching the recipe is not flagged',
        differsFromRecipe(match, template, meta, sonataIdOf) === false);
    assert('a different ROTATION is flagged (the reported case)',
        differsFromRecipe({ ...match, rotation: ['a', 'midair_x'] }, template, meta, sonataIdOf) === true);
    assert('a different OPENING rotation is flagged',
        differsFromRecipe({ ...match, openerRotation: ['z'] }, template, meta, sonataIdOf) === true);
    assert('a different weapon is flagged',
        differsFromRecipe({ ...match, weapon: { id: 9 } }, template, meta, sonataIdOf) === true);
    assert('a different sonata is flagged',
        differsFromRecipe({ ...match, sonataId: 4 }, template, meta, sonataIdOf) === true);
    assert('a different resonance mode is flagged',
        differsFromRecipe({ ...match, resonanceMode: 'tune_strain' }, template, meta, sonataIdOf) === true);

    // No claim to contradict ⇒ no badge. The badge says "this is not what the
    // card measured", which is meaningless without a card and a recipe.
    assert('a team not opened from a suggestion is never flagged',
        differsFromRecipe({ ...match, rotation: ['x'] }, { template: false }, meta, sonataIdOf) === false);
    assert('a resonator with no recipe is never flagged',
        differsFromRecipe({ ...match, resonatorId: 9999, rotation: ['x'] }, template, meta, sonataIdOf) === false);
    assert('a missing meta is never flagged',
        differsFromRecipe({ ...match, rotation: ['x'] }, template, null, sonataIdOf) === false);
    // The anchor's own editor build is materialized from the same recipe but is
    // NOT tagged template — keying on that flag flagged a slot that matched.
    assert('a matching build is unflagged regardless of its template flag',
        differsFromRecipe({ ...match, template: false }, template, meta, sonataIdOf) === false);
}

// ── clockFor — real team time → the clock the page is drawn on ──────────────
// Under GAME TIME a Liberation's freeze is removed from the axis. A step's
// freeze is credited at its END, matching sim.js's deriveGameTimes, so the two
// agree at every step boundary.
{
    // Slot 0 casts a 3s Liberation ending at t=5 that freezes 2s of it.
    const segBySlot = new Map([
        [0, { segs: [{ steps: [
            { startTime: 0, endTime: 2, freezeTime: 0 },
            { startTime: 2, endTime: 5, freezeTime: 2 },
            { startTime: 5, endTime: 7, freezeTime: 0 },
        ] }] }],
        [1, { segs: [{ steps: [{ startTime: 7, endTime: 10, freezeTime: 0 }] }] }],
    ]);
    const totals = { time: 10, gameTime: 8 };

    const real = clockFor(segBySlot, totals, false);
    assert('REAL TIME is the identity mapping', real.map(0) === 0 && real.map(5) === 5 && real.map(10) === 10);
    assert('REAL TIME spans the wall clock', real.span === 10);
    assert('REAL TIME leaves a member\'s on-field seconds alone', real.memberSeconds(0, 7) === 7);

    const game = clockFor(segBySlot, totals, true);
    assert('GAME TIME spans the freeze-excluded clock', game.span === 8);
    assert('before the freeze, both clocks agree', game.map(0) === 0 && game.map(2) === 2);
    assert('the freeze is credited at the step END, matching deriveGameTimes',
        game.map(5) === 3);
    assert('everything after it shifts by the full frozen amount',
        game.map(7) === 5 && game.map(10) === 8);
    assert('the mapping never runs backwards',
        [0, 1, 2, 3, 5, 6, 7, 9, 10].every((sec, i, all) => i === 0 || game.map(sec) >= game.map(all[i - 1])));
    assert('it never returns a negative time', game.map(-1) === 0);
    assert('a member\'s on-field seconds lose only THEIR OWN freeze',
        game.memberSeconds(0, 7) === 5 && game.memberSeconds(1, 3) === 3);

    // With nothing frozen the two clocks must be indistinguishable.
    const calm = new Map([[0, { segs: [{ steps: [{ startTime: 0, endTime: 4, freezeTime: 0 }] }] }]]);
    const calmGame = clockFor(calm, { time: 4, gameTime: 4 }, true);
    assert('no freeze anywhere → game time is the identity',
        calmGame.map(0) === 0 && calmGame.map(4) === 4 && calmGame.span === 4);

    // Defensive: an unrun page has no totals at all.
    const empty = clockFor(new Map(), null, true);
    assert('no result yet → zero span, still mappable', empty.span === 0 && empty.map(3) === 3);
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

    globalThis.window = { innerWidth: 1200, innerHeight: 800, addEventListener() {} };
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

    // ~~Openers default OFF (2026-07-31): the headline should describe the
    // rotation as written, not one padded with derived cold-start filler.~~
    // Nothing is padded since 2026-08-14 — the flag is a pure REPORT of which
    // Liberations the Resonance Energy cannot fund, so defaulting it off only
    // hid the ER requirement. It is also no longer called OPENERS: a chip whose
    // label promises a mechanism the engine no longer has is the kind of thing
    // that makes a user distrust the numbers next to it.
    assert('the energy check defaults to ON',
        lastHTML.includes('ENERGY CHECK ON') && !lastHTML.includes('ENERGY CHECK OFF'));
    assert('the retired padding/gating vocabulary is gone from the chip',
        !lastHTML.includes('OPENERS ON') && !lastHTML.includes('OPENERS OFF'));
    assert('the chip is still there to turn it off', lastHTML.includes('data-act="toggle-openers"'));

    // Three passes by default, matching the measurement the build page's
    // suggested-team card publishes — the same team must not wear two numbers.
    assert('the 3-pass chip is the selected one',
        /data-act="pass" data-n="3"[^>]*var\(--acc\)/.test(lastHTML));
    // …and the cumulative totals carry a per-pass sub-line, which is what makes
    // the two surfaces directly comparable.
    assert('multi-pass totals show a per-pass figure', lastHTML.includes('/ pass'));

    // Game Time / Real Time. The DURATION chip must name which clock it shows,
    // because it is the number TEAM DPS divides by — a toggle that moved DPS
    // while duration sat still would read as a bug.
    assert('a timing-mode toggle is rendered', lastHTML.includes('data-act="toggle-timing-mode"'));
    assert('it defaults to the ToA game-time convention', lastHTML.includes('GAME TIME'));
    assert('the duration chip says which clock it is showing',
        lastHTML.includes('DURATION · GAME'));
    assert('step bars carry a timestamp, so a clock switch is visible on the card',
        /\d+\.\d+g<\/span>/.test(lastHTML));
    assert('the member DPS tile names its clock', lastHTML.includes('DPS · GAME'));

    // Flipping the clock has to move EVERYTHING together — the axis, the
    // segment bars, the step timestamps and the per-member divisor. A toggle
    // that changed the DPS number while the timeline stayed the same length
    // would make the page contradict itself.
    const gameHTML = lastHTML;
    const axisOf = (html) => [...html.matchAll(/left:([\d.]+)%/g)].map(match => match[1]).join(',');
    const gameAxis = axisOf(gameHTML);
    const clockEv = { target: { closest: (sel) => (sel === '[data-act="toggle-timing-mode"]' ? {} : null) }, stopPropagation() {}, preventDefault() {} };
    let clockThrew = false;
    try { fire('click', clockEv); } catch (err) { clockThrew = true; console.error('    toggle-timing-mode click threw:', err.message); }
    assert('toggling the clock does not throw', !clockThrew);
    assert('the chip flips to REAL TIME', lastHTML.includes('REAL TIME') && !lastHTML.includes('>GAME TIME<'));
    assert('the duration chip follows', lastHTML.includes('DURATION · REAL'));
    assert('the member DPS tile follows', lastHTML.includes('DPS · REAL'));
    assert('step timestamps switch to the real-time suffix', /\d+\.\d+s<\/span>/.test(lastHTML));
    // This fixture's rotation is three basics, so nothing freezes and the two
    // clocks coincide — the layout MUST be identical. The moving case is
    // covered against clockFor below, where a freeze can be arranged.
    assert('with nothing frozen, the two clocks lay out identically',
        axisOf(lastHTML) === gameAxis);
    fire('click', clockEv);
    assert('toggling back restores the game-time chip', lastHTML.includes('DURATION · GAME'));
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
