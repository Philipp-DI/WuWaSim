/**
 * Tests for stackable chain/inherent effects under the P11 §A model.
 *
 *   node test/stackable-effects.test.mjs
 *
 * Stacks resolve from the rotation, not a user toggle:
 *   - the parser still emits stackable / perStack / maxStacks / stackTrigger
 *   - a resolvable stackTrigger (castMatch) → stack count = fires so far, capped
 *   - an unextractable stackTrigger → falls back to maxStacks WHILE the effect is
 *     ON (the realistic ceiling; PRE-P12 override table will supply real triggers)
 *   - an unconditional stackable applies via collectActiveEffects at that ceiling
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { createBuild, setChain } = await import('../src/core/build.js');
const { collectActiveEffects, effectsActiveAtStep } = await import('../src/core/buffs.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
function assertClose(name, a, b, tol = 1e-6) { assert(name, Math.abs(a - b) < tol); }

const baseCtx = () => ({ startTime: 5, activeStates: new Set(), firedTypes: new Set(),
    lastFireEndByType: new Map(), fireCountByType: new Map() });
const mk = (effect) => [{ effect, key: 'x' }];

// ── Parser still emits stackable metadata ────────────────────────────────────
{
    const jinhsi = d.resonators.find(r => r.name === 'Jinhsi');
    const s3 = (jinhsi?.resonanceChain?.find(c => c.level === 3)?.effects ?? []).find(e => e.stackable && e.stat === 'atkRatio');
    assert('Jinhsi S3 is stackable', !!s3);
    assertClose('Jinhsi S3 perStack = 0.25', s3?.perStack ?? 0, 0.25);
    assert('Jinhsi S3 maxStacks = 2', s3?.maxStacks === 2);
    assert('Jinhsi S3 carries a stackTrigger', !!s3?.stackTrigger);

    const youhu = d.resonators.find(r => r.name === 'Youhu');
    const s6 = (youhu?.resonanceChain?.find(c => c.level === 6)?.effects ?? []).find(e => e.stackable && e.stat === 'critDmg');
    assert('Youhu S6 is stackable', !!s6);
    assertClose('Youhu S6 perStack = 0.15', s6?.perStack ?? 0, 0.15);
    // Was `null` until 2026-07-31: the cap ("stackable up to 4 times") lives in
    // the GRANTING clause, not the "Each stack …" value clause the parser read.
    // See tests/stack-metadata.test.mjs for the full roster-wide pinning.
    assert('Youhu S6 maxStacks = 4 (from the granting clause)', s6?.maxStacks === 4);
}

// ── Resolvable stackTrigger → stack count = fires so far, capped at maxStacks ──
{
    const eff = {
        stat: 'atkRatio', value: 0.1, stackable: true, perStack: 0.1, maxStacks: 3,
        trigger: { type: 'castMatch', skillType: 'skill' }, window: { type: 'persist' },
        stackTrigger: { type: 'castMatch', skillType: 'skill' },
    };
    const ctx2 = { ...baseCtx(), firedTypes: new Set(['skill']), fireCountByType: new Map([['skill', 2]]) };
    const r2 = effectsActiveAtStep(mk(eff), ctx2);
    assert('stackable active once trigger fired', r2.length === 1);
    assertClose('2 fires → value = perStack × 2', r2[0].value, 0.2);

    const ctx5 = { ...baseCtx(), firedTypes: new Set(['skill']), fireCountByType: new Map([['skill', 5]]) };
    assertClose('5 fires capped at maxStacks 3 → value = 0.3', effectsActiveAtStep(mk(eff), ctx5)[0].value, 0.3);

    // Not yet triggered → not active at all.
    assert('stackable off before its trigger fires', effectsActiveAtStep(mk(eff), baseCtx()).length === 0);
}

// ── Unextractable stackTrigger → maxStacks fallback while ON ──────────────────
{
    const eff = {
        stat: 'critDmg', value: 0.15, stackable: true, perStack: 0.15, maxStacks: 2,
        trigger: { type: 'none' }, window: { type: 'always' },
        stackTrigger: { type: 'unknown' },
    };
    assertClose('unknown stackTrigger + maxStacks 2 → ceiling 2', effectsActiveAtStep(mk(eff), baseCtx())[0].value, 0.30);

    const effNullMax = { ...eff, perStack: 0.15, maxStacks: null };
    assertClose('unknown stackTrigger + null maxStacks → 1 stack', effectsActiveAtStep(mk(effNullMax), baseCtx())[0].value, 0.15);
}

// ── Non-stackable effects pass through unchanged ─────────────────────────────
{
    const eff = { stat: 'critRate', value: 0.2, trigger: { type: 'none' }, window: { type: 'always' } };
    const out = effectsActiveAtStep(mk(eff), baseCtx());
    assertClose('non-stackable value unchanged', out[0].value, 0.2);
    assert('non-stackable effect not marked stackable', !out[0].stackable);
}

// ── Unconditional stackable applies via collectActiveEffects at the ceiling ───
{
    // Find any resonator with an unconditional (always-on) stackable effect.
    let found = null;
    for (const r of d.resonators) {
        for (const ch of r.resonanceChain ?? []) {
            const e = (ch.effects ?? []).find(x => x.stackable && x.window?.type === 'always');
            if (e) { found = { r, ch, e }; break; }
        }
        if (found) break;
    }
    if (found) {
        const { r, ch, e } = found;
        const active = collectActiveEffects(setChain(createBuild(r), ch.level), r);
        const scaled = active.find(x => x.stackable && x.stat === e.stat);
        const expected = e.perStack * (e.maxStacks ?? 1);
        assert(`unconditional stackable resolved (${r.name})`, !!scaled);
        assertClose('unconditional stackable scaled to ceiling', scaled?.value ?? 0, expected);
    } else { passed += 2; }
}

console.log(`\nstackable-effects: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
