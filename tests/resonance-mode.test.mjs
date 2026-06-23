/**
 * Tests for Resonance Mode (RESONANCE-MODE-SPEC.md §9).
 *
 *   node test/resonance-mode.test.mjs
 *
 * Covers:
 *   - the four mode-having resonators carry their mode pair; others have none
 *   - createBuild defaults to mode A; normalizeBuild validates/migrates
 *   - a modeMatch effect is active in its mode, inactive in the other
 *   - modeMatch + windowed requires BOTH (mode AND triggered window)
 *   - Aemeath S6 double-listed crit: both parsed (own mode each), only the
 *     active mode's copy resolves — no collapse / dedupe / double-count
 *   - switching build.resonanceMode flips the resolved effect set
 *   - data integrity: every mode name appears in that resonator's text
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { RESONANCE_MODES, modesForResonator } from '../tools/resonance-modes.js';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { createBuild, setResonanceMode, normalizeBuild } = await import('../src/core/build.js');
const { collectActiveEffects, effectsActiveAtStep } = await import('../src/core/buffs.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const reso = id => d.resonators.find(r => r.id === id);
const MODE_IDS = [1210, 1509, 1211, 1109];

// ── Mode pairs projected; defaults; non-mode resonators ───────────────────────
{
    for (const id of MODE_IDS) {
        const r = reso(id);
        assert(`${r.name} has a 2-mode pair`, (r.resonanceModes ?? []).length === 2);
        const b = createBuild(r);
        assert(`${r.name} build defaults to mode A`, b.resonanceMode === r.resonanceModes[0].key);
    }
    const carlotta = reso(1107);
    assert('non-mode resonator has no resonanceModes', !carlotta.resonanceModes);
    assert('non-mode build has resonanceMode null', createBuild(carlotta).resonanceMode === null);
}

// ── normalizeBuild validation / migration ─────────────────────────────────────
{
    const aemeath = reso(1210);
    // invalid stored mode → migrate to mode A
    const migrated = normalizeBuild({ resonatorId: 1210, resonanceMode: 'bogus_mode' }, { dataset: d });
    assert('invalid mode migrates to mode A', migrated.resonanceMode === aemeath.resonanceModes[0].key);
    // valid stored mode preserved
    const kept = normalizeBuild({ resonatorId: 1210, resonanceMode: 'fusion_burst' }, { dataset: d });
    assert('valid mode preserved', kept.resonanceMode === 'fusion_burst');
    // no dataset → preserve stored value
    const noDs = normalizeBuild({ resonatorId: 1210, resonanceMode: 'tune_rupture' });
    assert('no dataset preserves stored mode', noDs.resonanceMode === 'tune_rupture');
}

// ── Aemeath S6 double-count guard: only the active mode's copy resolves ───────
{
    const aemeath = reso(1210);
    const s6 = aemeath.resonanceChain.find(c => c.level === 6).effects;
    const critRateCopies = s6.filter(e => e.stat === 'critRate');
    assert('S6 lists the crit effect twice (one per mode)', critRateCopies.length === 2);
    assert('the two copies carry different modes',
        critRateCopies[0].mode !== critRateCopies[1].mode && !!critRateCopies[0].mode && !!critRateCopies[1].mode);

    // Resolve via collectActiveEffects (mode-gated-only effects are unconditional
    // within their mode). Exactly the active mode's copy should appear.
    const bTune = setResonanceMode(createBuild(aemeath), 'tune_rupture');
    const bFus  = setResonanceMode(createBuild(aemeath), 'fusion_burst');
    bTune.chain = 6; bFus.chain = 6;
    const tuneCrit = collectActiveEffects(bTune, aemeath).filter(e => e.stat === 'critRate' && e.mode);
    const fusCrit  = collectActiveEffects(bFus,  aemeath).filter(e => e.stat === 'critRate' && e.mode);
    assert('exactly one critRate resolves in Tune Rupture', tuneCrit.length === 1 && tuneCrit[0].mode === 'tune_rupture');
    assert('exactly one critRate resolves in Fusion Burst', fusCrit.length === 1 && fusCrit[0].mode === 'fusion_burst');
}

// ── Switching mode flips the resolved set ─────────────────────────────────────
{
    const aemeath = reso(1210);
    const bA = setResonanceMode({ ...createBuild(aemeath), chain: 6 }, 'tune_rupture');
    const bB = setResonanceMode({ ...createBuild(aemeath), chain: 6 }, 'fusion_burst');
    const setA = collectActiveEffects(bA, aemeath).filter(e => e.mode).map(e => e.mode + ':' + e.stat).sort().join();
    const setB = collectActiveEffects(bB, aemeath).filter(e => e.mode).map(e => e.mode + ':' + e.stat).sort().join();
    assert('mode-gated active set differs between modes', setA !== setB && setA.length > 0 && setB.length > 0);
}

// ── effectsActiveAtStep: mode gate, and modeMatch + windowed needs BOTH ───────
{
    const mk = (effect) => [{ effect, key: 'x' }];
    const ctx = (over) => ({ startTime: 5, activeStates: new Set(), resonanceMode: null,
        firedTypes: new Set(), lastFireEndByType: new Map(), fireCountByType: new Map(), ...over });

    const modeOnly = { stat: 'critDmg', value: 1, mode: 'tune_rupture', trigger: { type: 'modeMatch', mode: 'tune_rupture' }, window: { type: 'always' } };
    assert('mode-gated active in its mode', effectsActiveAtStep(mk(modeOnly), ctx({ resonanceMode: 'tune_rupture' })).length === 1);
    assert('mode-gated inactive in the other mode', effectsActiveAtStep(mk(modeOnly), ctx({ resonanceMode: 'fusion_burst' })).length === 0);

    // mode + windowed: needs the mode AND the triggered window.
    const modeWin = { stat: 'critRate', value: 0.1, mode: 'fusion_burst', trigger: { type: 'castMatch', skillType: 'skill' }, window: { type: 'seconds', seconds: 10 } };
    const firedInWindow = { resonanceMode: 'fusion_burst', firedTypes: new Set(['skill']), lastFireEndByType: new Map([['skill', 2]]), startTime: 5 };
    assert('mode+window active when mode matches AND fired in window', effectsActiveAtStep(mk(modeWin), ctx(firedInWindow)).length === 1);
    assert('mode+window inactive in wrong mode even if fired', effectsActiveAtStep(mk(modeWin), ctx({ ...firedInWindow, resonanceMode: 'tune_rupture' })).length === 0);
    assert('mode+window inactive in right mode if not fired', effectsActiveAtStep(mk(modeWin), ctx({ resonanceMode: 'fusion_burst' })).length === 0);
}

// ── Data integrity: mode table references real resonators + real mode names ───
{
    function allText(r) {
        const t = [];
        for (const c of r.resonanceChain ?? []) { t.push(c.name, c.desc); for (const e of c.effects ?? []) t.push(e.condition); }
        for (const s of r.inherentSkills ?? []) { t.push(s.name, s.desc); }
        const sm = d.autoSkillMap[r.id] ?? {};
        for (const k of Object.keys(sm)) { t.push(sm[k].name, sm[k].desc); }
        return t.filter(Boolean).join(' ').toLowerCase();
    }
    let bad = 0;
    for (const [idStr, modeNames] of Object.entries(RESONANCE_MODES)) {
        const r = reso(Number(idStr));
        if (!r) { bad++; continue; }
        const txt = allText(r);
        for (const name of modeNames) if (!txt.includes(name.toLowerCase())) { bad++; console.error(`   ${r.name}: mode "${name}" not in text`); }
    }
    assert('every mode name appears in its resonator text', bad === 0);
    assert('modesForResonator returns {key,name} pairs', modesForResonator(1210)[0].key === 'tune_rupture');
}

console.log(`\nresonance-mode: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
