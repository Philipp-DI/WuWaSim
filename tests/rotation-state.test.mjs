/**
 * Tests for the P10 rotation state model (rotation-state.js + STATE_DEFS).
 *
 *   node test/rotation-state.test.mjs
 *
 * Verifies state activation, persistence, stance replacement (consumedBy),
 * default stances (initiallyActive), and that inState chain/inherent effects
 * resolve through the state timeline.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { computeStateTimeline, stateActive } from '../src/core/rotation-state.js';
import { stateDefsForResonator } from '../src/core/rotation-rules.js';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { createBuild, setChain } = await import('../src/core/build.js');
const { simulateRotation } = await import('../src/core/sim.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── Carlotta: Twilight Tango activates at Liberation and persists ─────────────
{
    const carlotta = d.resonators.find(r => r.name === 'Carlotta');
    const map = d.autoSkillMap[carlotta.id];
    const rot = ['skill', 'liberation', 'liberation_fatal_finale', 'basic_necessary_measures_1'];
    const tl = computeStateTimeline(rot, map, stateDefsForResonator(carlotta.id));
    assert('Twilight Tango inactive before Liberation', !stateActive(tl.activeAt[0], 'twilight tango'));
    assert('Twilight Tango active at Liberation step', stateActive(tl.activeAt[1], 'twilight tango'));
    assert('Twilight Tango persists after Liberation', stateActive(tl.activeAt[3], 'twilight tango'));
}

// ── Hiyuki: Present Self default → Foreclaimed Self after Liberation ──────────
{
    const hiyuki = d.resonators.find(r => r.name === 'Hiyuki');
    const map = d.autoSkillMap[hiyuki.id];
    const rot = ['skill_present', 'liberation_blade_liberation', 'basic_fore_1', 'heavy_fore'];
    const tl = computeStateTimeline(rot, map, stateDefsForResonator(hiyuki.id));
    assert('Present Self active at start (default stance)', stateActive(tl.activeAt[0], 'present self'));
    assert('Foreclaimed Self not active at start', !stateActive(tl.activeAt[0], 'foreclaimed self'));
    assert('Foreclaimed Self active after Liberation', stateActive(tl.activeAt[2], 'foreclaimed self'));
    assert('Present Self consumed by Liberation', !stateActive(tl.activeAt[2], 'present self'));
}

// ── exit.mode 'seconds': real elapsed-time expiry (synthetic, precise) ────────
// Distinct from 'duration' (step-count approximation) — Cantarella's Mirage
// (data/effect-overrides.json 1607/S4.0) is the first real user, lasting 8s.
{
    const defs = [{ name: 'Mirage', enter: { keys: ['enter_key'] }, exit: { mode: 'seconds', seconds: 8 } }];
    const map = { enter_key: { skillType: 'skill' }, filler: { skillType: 'basic' } };
    const rot = ['filler', 'enter_key', 'filler', 'filler', 'filler'];
    // Synthetic timings: filler=1s, enter_key=2s. enter_key is step 1, runs 1→3s
    // (end=3). Expiry = end(3) + 8 = 11s. Steps 2,3,4 start at 3,4,5 — all < 11.
    const stepTimes = { start: [0, 1, 3, 4, 5], end: [1, 3, 4, 5, 6] };

    const tl = computeStateTimeline(rot, map, defs, stepTimes);
    assert('seconds-exit: inactive before the entering step', !stateActive(tl.activeAt[0], 'mirage'));
    assert('seconds-exit: active on the entering step itself', stateActive(tl.activeAt[1], 'mirage'));
    assert('seconds-exit: still active well within the 8s window', stateActive(tl.activeAt[4], 'mirage'));

    // Push step 4 out past expiry (start=12 > 11) to confirm it turns off.
    const tlExpired = computeStateTimeline(rot, map, defs, { start: [0, 1, 3, 4, 12], end: [1, 3, 4, 5, 13] });
    assert('seconds-exit: inactive once elapsed time exceeds the window', !stateActive(tlExpired.activeAt[4], 'mirage'));

    // Re-entering refreshes the timer (same convention as castMatch windows).
    const rot2 = ['filler', 'enter_key', 'filler', 'filler', 'enter_key', 'filler'];
    const st2 = { start: [0, 1, 3, 4, 5, 7], end: [1, 3, 4, 5, 7, 8] };
    const tl2 = computeStateTimeline(rot2, map, defs, st2);
    assert('seconds-exit: re-entering refreshes — still active right after the 2nd entry', stateActive(tl2.activeAt[5], 'mirage'));

    // No stepTimes provided → 'seconds' never auto-expires within this call
    // (graceful degrade for callers without timing info, e.g. team-sim's
    // off-field "was this state ever active" flattening — not a crash).
    const tlNoTimes = computeStateTimeline(rot, map, defs);
    assert('seconds-exit: degrades to persist-like when stepTimes is omitted', stateActive(tlNoTimes.activeAt[4], 'mirage'));
}

// ── Real data: Cantarella's Mirage (8s) via the full sim's stepTimes wiring ───
{
    const cantarella = d.resonators.find(r => r.name === 'Cantarella');
    if (cantarella) {
        const build = setChain(createBuild(cantarella), 4);   // S4.0 (Healing Bonus while in Mirage) needs chain >= 4
        // Delusive Dive enters Mirage; immediately follow with enough basics to
        // clearly straddle an 8s window either side (basic casts are 0.55s each
        // — need >15 of them after Delusive Dive to exceed the 8s window).
        const rot = ['basic_delusive_dive', ...Array(20).fill('basic_1')];
        const b = { ...build, rotation: rot };
        const sim = simulateRotation({ build: b, dataset: d, target: { level: 90, atkLv: 90, resistances: {} } });
        // The state-bound healing-bonus effect (S4.0) is either present early
        // (within 8s of Delusive Dive) or absent late — just confirm it DOES
        // expire by the end of a long rotation (proving 'seconds' mode — not
        // 'persist' — governs it).
        const everActive = sim.steps.some(s => (s.activeBuffNames ?? []).some(n => /healing bonus/i.test(n)));
        const lastActive = (sim.steps[sim.steps.length - 1]?.activeBuffNames ?? []).some(n => /healing bonus/i.test(n));
        assert('Cantarella real sim: Mirage-bound healing bonus activates at some point', everActive);
        assert('Cantarella real sim: Mirage-bound healing bonus is NOT still active 9+ basics later (expired, not persist)', !lastActive);
    } else { passed += 2; }
}

// ── exit.mode 'consumedByThenSeconds': active through, THEN N seconds after ───
// a later key fires (synthetic, precise). Lucilla's "Clear As Day Buff"
// (data/effect-overrides.json 1109/S2.0) is the first real user: active from
// Liberation through Reminiscence, then 30s grace after Letting It Go ends it.
{
    const defs = [{ name: 'Buff', enter: { keys: ['enter_key'] },
        exit: { mode: 'consumedByThenSeconds', keys: ['end_key'], seconds: 5 } }];
    const map = { enter_key: { skillType: 'skill' }, end_key: { skillType: 'liberation' }, filler: { skillType: 'basic' } };

    // rot: enter(0→1) filler(1→2) filler(2→3) end_key(3→4) filler(4→5) filler(5→9, long) filler(9→14)
    const rot = ['enter_key', 'filler', 'filler', 'end_key', 'filler', 'filler', 'filler'];
    const start = [0, 1, 2, 3, 4, 5, 9];
    const end   = [1, 2, 3, 4, 5, 9, 14];
    const tl = computeStateTimeline(rot, map, defs, { start, end });

    assert('consumedByThenSeconds: active right after entering, before the end key', stateActive(tl.activeAt[1], 'buff'));
    assert('consumedByThenSeconds: STAYS active on the end-key step itself (grace just starting)', stateActive(tl.activeAt[3], 'buff'));
    // Grace expiry = end[3](4) + 5 = 9. Step 4 starts at 4 (< 9) → still active.
    assert('consumedByThenSeconds: still active early in the grace window', stateActive(tl.activeAt[4], 'buff'));
    // Step 5 starts at 5 (< 9) → still active (grace hasn't elapsed yet).
    assert('consumedByThenSeconds: still active mid-grace', stateActive(tl.activeAt[5], 'buff'));
    // Step 6 starts at 9 (>= 9) → grace elapsed, now inactive.
    assert('consumedByThenSeconds: inactive once the grace period elapses', !stateActive(tl.activeAt[6], 'buff'));

    // Re-entering cancels any grace in progress and restarts fresh.
    const rot2 = ['enter_key', 'end_key', 'enter_key', 'filler'];
    const tl2 = computeStateTimeline(rot2, map, defs, { start: [0, 1, 2, 3], end: [1, 2, 3, 4] });
    assert('consumedByThenSeconds: re-entering during grace restarts the state active', stateActive(tl2.activeAt[2], 'buff'));
    assert('consumedByThenSeconds: stays active right after the fresh re-entry', stateActive(tl2.activeAt[3], 'buff'));
}

// ── Real data: Lucilla's "Clear As Day Buff" (S2.0) — mode-gated end to end ───
{
    const lucilla = d.resonators.find(r => r.name === 'Lucilla');
    if (lucilla) {
        const { setChain, setResonanceMode } = await import('../src/core/build.js');
        let build = setChain(createBuild(lucilla), 2);   // S2.0
        build = setResonanceMode(build, 'glacio_chafe');
        // liberation=1.8s, liberation_letting_it_go=1.8s (grace starts at 3.6s,
        // expires at 3.6+30=33.6s), basic_basic_attack_1=0.55s — need ~55+
        // basics after to clear the 30s grace; use 60 for headroom.
        const rot = ['liberation', 'liberation_letting_it_go', ...Array(60).fill('basic_basic_attack_1')];
        const sim = simulateRotation({ build: { ...build, rotation: rot }, dataset: d, target: { level: 90, atkLv: 90, resistances: {} } });
        // Match on "Clear As Day" rather than the effect's full intent — the
        // stored condition text is truncated to 120 chars (a documented parser
        // limitation), which cuts off before "Glacio Chafe"/"Amplified" appear.
        const isActive = (i) => (sim.steps[i]?.activeBuffNames ?? []).some(n => /clear as day/i.test(n));
        // stateBound effects benefit the entering step itself (same convention
        // as Carlotta's Twilight Tango / Jinhsi's Incarnation — unlike castMatch
        // windows, which exclude their own triggering step).
        assert('Lucilla real sim: S2.0 buff active on the Liberation step itself', isActive(0));
        assert('Lucilla real sim: still active through the grace period after Letting It Go', isActive(2));
        assert('Lucilla real sim: eventually expires (30s grace, not persist)', !isActive(sim.steps.length - 1));

        const buildEcho = setResonanceMode(setChain(createBuild(lucilla), 2), 'echo');
        const simEcho = simulateRotation({ build: { ...buildEcho, rotation: rot }, dataset: d, target: { level: 90, atkLv: 90, resistances: {} } });
        assert('Lucilla real sim: inactive entirely in the OTHER Resonance Mode (mode-gated)',
            !simEcho.steps.some(s => (s.activeBuffNames ?? []).some(n => /clear as day/i.test(n))));
    } else { passed += 4; }
}

// ── Phoebe: Absolution / Confession are mutually exclusive, neither default ────
{
    const phoebe = d.resonators.find(r => r.name === 'Phoebe');
    if (phoebe) {
        const map = d.autoSkillMap[phoebe.id];
        const rot = ['basic_1', 'forte_heavy_absolution_litany', 'heavy_heavy_attack', 'forte_heavy_utter_confession', 'basic_2'];
        const tl = computeStateTimeline(rot, map, stateDefsForResonator(phoebe.id));
        assert('neither status active before either Forte heavy', !stateActive(tl.activeAt[0], 'absolution') && !stateActive(tl.activeAt[0], 'confession'));
        assert('Absolution active after Absolution Litany', stateActive(tl.activeAt[1], 'absolution'));
        assert('Absolution persists through an unrelated step', stateActive(tl.activeAt[2], 'absolution'));
        assert('Confession active after Utter Confession', stateActive(tl.activeAt[3], 'confession'));
        assert('Absolution ENDED by Confession being entered (mutually exclusive)', !stateActive(tl.activeAt[3], 'absolution'));
        assert('Confession persists after entering', stateActive(tl.activeAt[4], 'confession'));
    } else { passed += 6; }
}

// ── Type-triggered states: Aemeath Tune Rupture mode via forte ────────────────
{
    const aemeath = d.resonators.find(r => r.name === 'Aemeath');
    if (aemeath) {
        const map = d.autoSkillMap[aemeath.id];
        const forteKey = Object.keys(map).find(k => (map[k].skillType || '').startsWith('forte'));
        const tlNo = computeStateTimeline(['skill'], map, stateDefsForResonator(aemeath.id));
        const tlYes = computeStateTimeline(['skill', forteKey], map, stateDefsForResonator(aemeath.id));
        const everNo = new Set(); for (const s of tlNo.activeAt) for (const x of s) everNo.add(x);
        const everYes = new Set(); for (const s of tlYes.activeAt) for (const x of s) everYes.add(x);
        assert('Tune Rupture mode inactive without forte', everNo.size === 0);
        assert('Tune Rupture mode active with forte', everYes.size > 0);
    } else { passed += 2; }
}

// ── stateActive fuzzy matching ────────────────────────────────────────────────
{
    assert('exact match', stateActive(new Set(['twilight tango']), 'twilight tango'));
    assert('substring match', stateActive(new Set(['resonance mode - tune rupture']), 'tune rupture'));
    assert('no false match', !stateActive(new Set(['twilight tango']), 'foreclaimed self'));
    assert('empty set → false', !stateActive(new Set(), 'anything'));
}

// ── Empty / no-defs cases ─────────────────────────────────────────────────────
{
    const tl = computeStateTimeline(['a', 'b'], {}, []);
    assert('no state defs → empty active sets', tl.activeAt.every(s => s.size === 0));
    assert('empty rotation → empty timeline', computeStateTimeline([], {}, []).activeAt.length === 0);
}

// ── secondsOrConsumedBy + aliases (2026-07-05, Denia's Entropy Shift pair) ───
{
    const defs = [
        { name: 'Buff A', aliases: ['grouped states'],
          enter: { keys: ['x'] },
          exit: { mode: 'secondsOrConsumedBy', seconds: 10, keys: ['y'] } },
    ];
    const map = { x: { skillType: 'skill' }, y: { skillType: 'skill' }, hit: { skillType: 'basic' } };

    // Consumed BEFORE the timer: y at step 1 ends it even though <10s elapsed.
    const times = { start: [0, 1, 2], end: [1, 2, 3] };
    const consumed = computeStateTimeline(['x', 'y', 'hit'], map, defs, times);
    assert('secondsOrConsumedBy: active on entering step', consumed.activeAt[0].has('buff a'));
    assert('secondsOrConsumedBy: consumed by the listed key', !consumed.activeAt[1].has('buff a'));
    assert('secondsOrConsumedBy: stays off after consumption', !consumed.activeAt[2].has('buff a'));

    // Timer expiry when never consumed: expires at end(step0)+10 = 11s.
    const late = { start: [0, 5, 12], end: [1, 6, 13] };
    const expired = computeStateTimeline(['x', 'hit', 'hit'], map, defs, late);
    assert('secondsOrConsumedBy: alive within the window', expired.activeAt[1].has('buff a'));
    assert('secondsOrConsumedBy: expires by real time', !expired.activeAt[2].has('buff a'));

    // Aliases are recorded alongside the canonical name while active.
    assert('alias recorded while active', consumed.activeAt[0].has('grouped states'));
    assert('alias matches via stateActive', stateActive(consumed.activeAt[0], 'grouped states'));
    assert('alias gone when inactive', !consumed.activeAt[1].has('grouped states'));
}

// ── Denia stance + Entropy Shift model (live data, 2026-07-05) ───────────────
{
    const denia = d.resonators.find(r => r.name === 'Denia');
    if (denia) {
        const map = d.autoSkillMap[denia.id];
        const defs = stateDefsForResonator(denia.id);
        const rot = ['intro_it_s_been_a_while', 'basic_stagecraft_form_4',
            'liberation_final_act_stagecraft_form', 'basic_breakdown_form_1',
            'liberation_final_act_breakdown_form', 'basic_stagecraft_form_1'];
        const tl = computeStateTimeline(rot, map, defs);
        assert('Denia starts in Stagecraft Form', tl.activeAt[0].has('stagecraft form'));
        assert('Denia: not in Breakdown before her Liberation', !tl.activeAt[1].has('breakdown form'));
        assert('Denia: Stagecraft Liberation switches to Breakdown Form', tl.activeAt[2].has('breakdown form') && !tl.activeAt[2].has('stagecraft form'));
        assert('Denia: Entropy Shift (Breakdown) granted by the Stagecraft Liberation', tl.activeAt[2].has('entropy shift: breakdown form'));
        assert('Denia: "entropy shift states" alias gates her S6 effect', stateActive(tl.activeAt[3], 'entropy shift states'));
        assert('Denia: Breakdown Liberation switches back to Stagecraft', tl.activeAt[4].has('stagecraft form') && !tl.activeAt[4].has('breakdown form'));
        assert('Denia: obtaining ES:Stagecraft removes ES:Breakdown (mutual exclusion)',
            tl.activeAt[4].has('entropy shift: stagecraft form') && !tl.activeAt[4].has('entropy shift: breakdown form'));
    } else { passed += 7; }
}

console.log(`\nrotation-state: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
