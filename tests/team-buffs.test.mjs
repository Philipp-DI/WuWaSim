/**
 * Team Effect Model — L3 team-wide buff propagation (P13).
 *
 * A buff GRANTED TO "all team members" reaches every member; a personal buff (or
 * a self buff gated on a team CONDITION) does not. Solo path unchanged.
 *
 *   node tests/team-buffs.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { isTeamWideBuff, teamWideContribution, teamWideWindowSpecs, mergeTeamBundles } from '../src/core/buffs.js';
import { resolveTotalStats, PROP } from '../src/core/stats.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { createBuild, setEcho } from '../src/core/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
const resonatorOf = (id) => d.resonators.find(r => r.id === id);
const TARGET = { level: 90, atkLv: 90, resistances: {} };

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

function build(id, sonataId, rot = null, chain = 0) {
    let b = { ...createBuild(resonatorOf(id)), chain };
    for (let i = 0; i < 5; i++) b = setEcho(b, i, { id: null, cost: [4, 3, 3, 1, 1][i], level: 25, sonataId,
        mainStat: { propId: PROP.CRIT_DMG, addType: 1, value: 44, isPercent: true }, subStats: [] });
    if (rot) b = { ...b, rotation: rot, rotationMeta: rot.map(() => ({})), id };
    return b;
}

// ── recipient vs actor classification ────────────────────────────────────────
{
    assert('"all team members\' ATK" → team-wide', isTeamWideBuff("After Intro Skill is cast, all team members' ATK is increased by 20% for 30s."));
    assert('"DMG Bonus of all team members" → team-wide', isTeamWideBuff('Outro Skill increases the Glacio DMG Bonus of all team members by 20%.'));
    assert('"Resonators in the team gain" → team-wide', isTeamWideBuff('All nearby Resonators in the team gain Crit. DMG increase'));
    assert('"Resonators in the team INFLICT … Aemeath\'s Crit DMG" → NOT team-wide (self buff, team condition)',
        !isTeamWideBuff("when Resonators in the team inflict Fusion Burst, Aemeath's Crit. DMG is increased by 60%"));
    assert('a plain self buff is not team-wide', !isTeamWideBuff('Crit. DMG is increased by 30%.'));
}

// ── teamWideContribution / teamWideWindowSpecs partition (2026-07-15) ─────────
// A team-wide effect lives in exactly ONE of the two paths: WINDOWED when its
// castMatch trigger + seconds window are resolvable (→ team-buff timeline),
// FLAT otherwise (unconditional auras, unresolved triggers, crit kinds).
{
    // Changli S4 ("after Intro, all team members' ATK +20% for 30s") is
    // windowable → OUT of the flat bundle, IN the window specs.
    const changliFlat = teamWideContribution(build(1205, 2, null, 6), resonatorOf(1205));
    assert('Changli S4 team ATK is no longer in the FLAT bundle (windowed)', changliFlat.atkRatio === 0);
    const changliSpecs = teamWideWindowSpecs(build(1205, 2, null, 6), resonatorOf(1205));
    assert('Changli S4 appears as a window spec (intro trigger, 30s, +20% ATK)',
        changliSpecs.length === 1 && changliSpecs[0].triggerSkillType === 'intro'
        && changliSpecs[0].seconds === 30 && Math.abs(changliSpecs[0].bonusPct - 0.2) < 1e-9
        && changliSpecs[0].bonusKind === 'atk');
    const changliS0 = teamWideWindowSpecs(build(1205, 2, null, 0), resonatorOf(1205)); // S4 locked at seq 0
    assert('Changli grants nothing at S0 (sequence-gated)', changliS0.length === 0
        && teamWideContribution(build(1205, 2, null, 0), resonatorOf(1205)).atkRatio === 0);
    const carlotta = teamWideContribution(build(1107, 1, null, 6), resonatorOf(1107));
    assert('Carlotta grants no team buff (her kit is personal)', carlotta.atkRatio === 0 && Object.keys(carlotta.dmgByElement).length === 0
        && teamWideWindowSpecs(build(1107, 1, null, 6), resonatorOf(1107)).length === 0);
    // Shorekeeper S2 (+40% team ATK, unconditional always-on) has no honest
    // window to derive → stays FLAT, exactly as before.
    const shorekeeper = d.resonators.find(r => /shorekeeper/i.test(r.name));
    const shorekeeperFlat = teamWideContribution(build(shorekeeper.id, 1, null, 6), shorekeeper);
    assert('Shorekeeper unconditional team ATK stays in the FLAT bundle', Math.abs(shorekeeperFlat.atkRatio - 0.4) < 1e-9);
    assert('…and is NOT double-emitted as a window spec', teamWideWindowSpecs(build(shorekeeper.id, 1, null, 6), shorekeeper).length === 0);
}

// ── Team-buff TIMELINE: window-path sonata buffs reach teammates by literal
// team-time overlap (2026-07-15, replacing the flat sonataTeamWideContribution).
// A support's "increases the ATK of all party members by 15% for 30s upon
// healing allies" (Rejuvenating Glow) opens a real window when the support
// heals; a LATER-playing teammate's steps inside that window are buffed (and
// list it in activeBuffNames); steps outside are not.
{
    const glowId = d.sonatas.find(s => s.name === 'Rejuvenating Glow')?.id;
    const havocId = d.sonatas.find(s => s.name === 'Havoc Eclipse')?.id;
    // Chisa (1508, healer) plays FIRST with a short healing rotation; Carlotta
    // (1107) plays second — her early steps fall inside Glow's 30s window.
    const chisaRot = ['basic_2', 'basic_rending_lunge', 'basic_death_snip', 'liberation'];
    const carl = build(1107, 1, meta.characters['1107'].referenceRotation);
    const run = (sonataId) => {
        const chisa = build(1508, sonataId, chisaRot);
        const blds = { 1508: chisa, 1107: carl };
        return simulateTeamRotation({ team: { slots: [1508, 1107] }, resolveBuild: (id) => blds[id], dataset: d, target: TARGET });
    };
    const glow = run(glowId), havoc = run(havocId);
    const carlDmg = (r) => r.memberTotals.find(m => m.resonatorId === 1107).damage;
    const carlSteps = (r) => r.memberSteps.get(1107) ?? [];
    assert('Glow-buffed Carlotta out-damages Havoc-Eclipse-Chisa Carlotta (window reaches her)',
        carlDmg(glow) > carlDmg(havoc));
    const buffed = carlSteps(glow).filter(s => (s.activeBuffNames ?? []).some(n => /\+15% ATK · Chisa/.test(n)));
    assert('Carlotta steps INSIDE the Glow window list the received buff', buffed.length > 0);
    assert('Havoc Eclipse (self-only) never reaches Carlotta',
        carlSteps(havoc).every(s => !(s.activeBuffNames ?? []).some(n => /Chisa/.test(n))));
    // The Glow window renders from the WIELDER's map, tagged teamWide — and the
    // buffed teammate steps are EXACTLY the ones whose start falls inside it
    // (literal team-time overlap; steps past the window's end are unbuffed).
    const glowWins = (glow.memberStackedBuffWindows.get(1508) ?? []).filter(w => w.teamWide);
    assert('the wielder emits the team-wide Glow window for the UI', glowWins.length === 1 && Math.abs(glowWins[0].bonusPct - 0.15) < 1e-9);
    const win = glowWins[0];
    const inWin = carlSteps(glow).filter(s => s.startTime + 1e-6 >= win.start && s.startTime < win.end);
    assert('buffed teammate steps are exactly the steps inside the window', buffed.length === inWin.length);
    // A NON-healer wielding Glow never heals → the window never opens → nothing
    // reaches the teammate (the old supportTable gate, now emergent from the sim).
    const carlAsWielder = build(1107, glowId, meta.characters['1107'].referenceRotation);
    const jin = build(1304, 5, meta.characters['1304'].referenceRotation);
    const blds2 = { 1107: carlAsWielder, 1304: jin };
    const r2 = simulateTeamRotation({ team: { slots: [1107, 1304] }, resolveBuild: (id) => blds2[id], dataset: d, target: TARGET });
    assert('Rejuvenating Glow on a non-healer opens no window (no heal → no trigger)',
        (r2.memberStackedBuffWindows.get(1107) ?? []).every(w => !/ATK/.test(w.name) || !w.teamWide));
}

// ── resolveTotalStats folds an external team bundle ──────────────────────────
{
    const carl = build(1107, 1);
    const base = resolveTotalStats(carl, d).atk;
    const buffed = resolveTotalStats(carl, d, null, { atkRatio: 0.2 }).atk;
    assert('external team ATK raises resolved ATK', buffed > base * 1.1);
    assert('null team bundle = solo (unchanged)', resolveTotalStats(carl, d, null, null).atk === base);
}

// ── mergeTeamBundles sums element/skill/atk buckets ──────────────────────────
{
    const m = mergeTeamBundles([{ atkRatio: 0.2, dmgByElement: { 1: 0.1 } }, { atkRatio: 0.1, dmgByElement: { 1: 0.05, 2: 0.2 } }]);
    assert('merge sums atkRatio', Math.abs(m.atkRatio - 0.3) < 1e-9);
    assert('merge sums per-element', Math.abs(m.dmgByElement[1] - 0.15) < 1e-9 && Math.abs(m.dmgByElement[2] - 0.2) < 1e-9);
}

// ── integration: a teammate's team-ATK lifts the carry — WINDOWED (2026-07-15):
// Changli S4 triggers on her INTRO cast, which only fires when she SWAPS IN
// (slot ≥ 2 or a later pass) — so she plays second (intro fires at her swap-in)
// and Carlotta third, inside the 30s window. With S0 (locked) there is no
// window and no lift. Slot-0-Changli honestly grants nothing in pass 0 (no
// intro cast → no trigger — the flat model used to credit this regardless).
{
    const carl = build(1107, 1, meta.characters['1107'].referenceRotation);
    const jinhsi = build(1304, 5, meta.characters['1304'].referenceRotation);
    const run = (changliSeq) => {
        const changli = build(1205, 2, meta.characters['1205'].referenceRotation, changliSeq);
        const blds = { 1205: changli, 1107: carl, 1304: jinhsi };
        return simulateTeamRotation({ team: { slots: [1304, 1205, 1107] }, resolveBuild: (id) => blds[id], dataset: d, target: TARGET });
    };
    const s4 = run(4), s0 = run(0);
    const carlDmg = (r) => r.memberTotals.find(m => m.resonatorId === 1107).damage;
    assert('Changli S4 (+team ATK window from her intro) lifts Carlotta over Changli S0', carlDmg(s4) > carlDmg(s0) * 1.02);
    const carlSteps = s4.memberSteps.get(1107) ?? [];
    assert('Carlotta steps list the received Changli buff', carlSteps.some(step => (step.activeBuffNames ?? []).some(n => /\+20% ATK · Changli/.test(n))));
    // The window renders from Changli's map, tagged teamWide, sourced to her kit.
    const win = (s4.memberStackedBuffWindows.get(1205) ?? []).find(w => w.teamWide && /ATK/.test(w.name));
    assert('Changli emits the team-wide window entry (KIT · Chain S4)', !!win && /Chain S4/.test(win.sonataName));
    // Self-credit (2026-07-15 gap fix): the intro trigger fires in the AUTO-
    // INJECTED intro segment, which Changli's own rotation sim never sees — so
    // her only honest self-credit path is the timeline (selfApplicable). Until
    // this fix her S4 buffed every member EXCEPT herself.
    const changliOwn = (s4.memberSteps.get(1205) ?? []).filter(step => step.skillType !== 'intro');
    assert('Changli credits HERSELF her intro-triggered team buff (selfApplicable)',
        changliOwn.some(step => (step.activeBuffNames ?? []).some(n => /\+20% ATK · Changli/.test(n))));
}

// ── curated-trigger team buffs (2026-07-15, effect-overrides): Sanhua S6 ─────
// "After an Ice Prism or a Glacier is detonated, all team members' ATK +10%
// for 20s" — the parser couldn't resolve the trigger (kit-specific detonate
// casts), so it sat in the FLAT path. Now curated to her detonate skillKeys →
// windowed; her own sim resolves it natively too (it never activated for her
// own damage before at all).
{
    const refs = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));
    const sanhuaR = resonatorOf(1102);
    assert('Sanhua S6 moved OUT of the flat bundle', teamWideContribution(build(1102, 1, null, 6), sanhuaR).atkRatio === 0);
    const specs = teamWideWindowSpecs(build(1102, 1, null, 6), sanhuaR);
    assert('Sanhua S6 is a window spec keyed to her detonate casts',
        specs.length === 1 && specs[0].triggerSkillKeys?.includes('forte_heavy_detonate_damage') && specs[0].seconds === 20);
    const sanhua = build(1102, 1, refs['1102'].rotation, 6);
    const carl = build(1107, 1, meta.characters['1107'].referenceRotation);
    const blds = { 1102: sanhua, 1107: carl };
    const r = simulateTeamRotation({ team: { slots: [1102, 1107] }, resolveBuild: (id) => blds[id], dataset: d, target: TARGET });
    assert('Sanhua\'s detonate opens a team-wide window',
        (r.memberStackedBuffWindows.get(1102) ?? []).some(w => w.teamWide && /\+10% ATK/.test(w.name)));
    assert('a following Carlotta receives it in-window',
        (r.memberSteps.get(1107) ?? []).some(step => (step.activeBuffNames ?? []).some(n => /\+10% ATK · Sanhua/.test(n))));
    // Baizhi S6 ("when Euphonia is PICKED UP" — a player action, not a cast)
    // has no honest cast trigger → stays flat, exactly as before.
    const baizhi = teamWideContribution(build(1103, 1, null, 6), resonatorOf(1103));
    assert('Baizhi S6 (pickup-triggered) honestly stays in the flat bundle', Math.abs((baizhi.dmgByElement[1] ?? 0) - 0.12) < 1e-9);
}

// ── incoming-resonator transfer DISPLAY (2026-07-15): Wishes' Outro transfer ──
// The Outro→Intro handoff bundle (e.g. "+25% Glacio DMG to the incoming
// Resonator") is applied flat to the receiving member's rotation — the display
// now shows exactly that: a strip in the RECEIVER's own lane (not team-wide),
// spanning their segment, named for the granting member.
{
    const wishesId = d.sonatas.find(s => /Wishes of Quiet Snowfall/i.test(s.name))?.id;
    assert('Wishes of Quiet Snowfall exists', wishesId != null);
    const hiyukiRot = meta.characters['1108'].referenceRotation;
    const lucilla = build(1109, wishesId, ['basic_1', 'basic_2']);
    const hiyuki = build(1108, 1, hiyukiRot);
    const blds = { 1109: lucilla, 1108: hiyuki };
    const r = simulateTeamRotation({ team: { slots: [1109, 1108] }, resolveBuild: (id) => blds[id], dataset: d, target: TARGET });
    const strips = (r.memberStackedBuffWindows.get(1108) ?? []).filter(w => /Outro transfer/.test(w.sonataName));
    assert('the receiving member\'s lane carries the transfer strip', strips.length >= 1 && strips.every(w => w.teamWide === false));
    assert('the strip names the granting member', strips.every(w => /Lucilla/.test(w.sonataName)));
    assert('receiving steps list the transfer', (r.memberSteps.get(1108) ?? []).some(step => (step.activeBuffNames ?? []).some(n => /from Lucilla/.test(n))));
    assert('the GRANTING member\'s own lane has no transfer strip',
        !(r.memberStackedBuffWindows.get(1109) ?? []).some(w => /Outro transfer/.test(w.sonataName)));
}

// ── echo shield/aura DMG-Boost auras distribute team-wide (2026-07-15) ────────
// Bell-Borne Geochelone grants "+10% DMG Boost for the current team members" on
// its Active Skill cast — a flat team-wide amplify reaching EVERY member (incl.
// the caster; survives switching) when the wielder's rotation casts __echo__.
{
    const bellBorne = d.echoes.find(e => e.name === 'Bell-Borne Geochelone');
    assert('Bell-Borne Geochelone carries an extracted team DMG-boost', bellBorne?.activeSkill?.teamBuff?.dmgBoost > 0);
    const carry = build(1107, 1, meta.characters['1107'].referenceRotation);   // Carlotta
    const echoStat = { propId: PROP.CRIT_DMG, addType: 1, value: 44, isPercent: true };
    // Support (Changli) equipping Bell-Borne in slot 0 and casting its echo.
    const withBell = setEcho(build(1205, 2, ['__echo__']), 0, { id: bellBorne.id, cost: 4, level: 25, sonataId: 2, mainStat: echoStat, subStats: [] });
    // Control: same rotation (casts __echo__) but the default (null) slot-0 echo
    // has no team buff → no aura — isolates the aura from the echo cast itself.
    const plain = build(1205, 2, ['__echo__']);
    const carryDmg = (sup) => {
        const blds = { 1205: sup, 1107: carry };
        const r = simulateTeamRotation({ team: { slots: [1205, 1107] }, resolveBuild: (id) => blds[id], dataset: d, target: TARGET });
        return { dmg: r.memberTotals.find(m => m.resonatorId === 1107).damage, auras: r.teamWideEchoBuffs };
    };
    const A = carryDmg(withBell), B = carryDmg(plain);
    assert('casting Bell-Borne surfaces the aura in teamWideEchoBuffs',
        A.auras.length === 1 && A.auras[0].dmgBoost === bellBorne.activeSkill.teamBuff.dmgBoost);
    assert('a non-aura echo → no aura', B.auras.length === 0);
    assert('the echo aura amplifies the teammate carry damage', A.dmg > B.dmg);
}

console.log(`\nteam-buffs: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
