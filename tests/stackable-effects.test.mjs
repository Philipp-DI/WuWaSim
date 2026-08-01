/**
 * Tests for stackable chain/inherent effects under the P11 §A model.
 *
 *   node test/stackable-effects.test.mjs
 *
 * Stacks resolve from the rotation, or from the user when the rotation can't
 * describe them:
 *   - the parser still emits stackable / perStack / maxStacks / stackTrigger
 *   - a resolvable stackTrigger (castMatch) → stack count = fires so far, capped
 *   - a user count (build.effectStacks) outranks both, capped at maxStacks
 *   - an unextractable stackTrigger → ONE stack, flagged `stacksUnknown`
 *
 * That last rule replaced a maxStacks ceiling fallback on 2026-07-31. Once
 * descStackCap recovered real caps roster-wide, the ceiling stopped being a
 * conservative guess and became a large silent assertion — Lynae's Premixed Hue
 * is 55% per stack to a cap of 25, so the fallback was worth +1375% Spectro DMG
 * on a number the app cannot derive. See tests/stack-metadata.test.mjs.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { createBuild, setChain, setEffectStacks, normalizeBuild } = await import('../src/core/build.js');
const { collectActiveEffects, effectsActiveAtStep, underivableStacks, unlockedEffects } = await import('../src/core/buffs.js');

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

// ── Unextractable stackTrigger → ONE stack, flagged as underivable ───────────
{
    const eff = {
        stat: 'critDmg', value: 0.15, stackable: true, perStack: 0.15, maxStacks: 2,
        trigger: { type: 'none' }, window: { type: 'always' },
        stackTrigger: { type: 'unknown' },
    };
    const out = effectsActiveAtStep(mk(eff), baseCtx())[0];
    assertClose('unknown stackTrigger → 1 stack, NOT the maxStacks ceiling', out.value, 0.15);
    assert('unknown stackTrigger → stacksUnknown flag set', out.stacksUnknown === true);
    assert('unknown stackTrigger → stacksSource "unknown"', out.stacksSource === 'unknown');
    assert('unknown stackTrigger → stacks reported as 1', out.stacks === 1);

    const effNullMax = { ...eff, maxStacks: null };
    assertClose('unknown stackTrigger + null maxStacks → 1 stack', effectsActiveAtStep(mk(effNullMax), baseCtx())[0].value, 0.15);
}

// ── A user-supplied count outranks everything, and is capped ─────────────────
{
    const eff = {
        stat: 'critDmg', value: 0.15, stackable: true, perStack: 0.15, maxStacks: 4,
        trigger: { type: 'none' }, window: { type: 'always' },
        stackTrigger: { type: 'unknown' },
    };
    const withManual = (count) => effectsActiveAtStep(mk(eff),
        { ...baseCtx(), manualStacks: new Map([['x', count]]) })[0];

    assertClose('manual 3 stacks → perStack × 3', withManual(3).value, 0.45);
    assert('manual count is not flagged unknown', !withManual(3).stacksUnknown);
    assert('manual count reports its source', withManual(3).stacksSource === 'manual');
    assertClose('manual count above the cap is clamped to maxStacks', withManual(9).value, 0.60);
    assertClose('manual 0 stacks is honoured (not treated as absent)', withManual(0).value, 0);

    // A manual count for a DIFFERENT slot must not leak onto this one.
    const otherSlot = effectsActiveAtStep(mk(eff), { ...baseCtx(), manualStacks: new Map([['S6.0', 3]]) })[0];
    assertClose('a count keyed to another slot does not apply', otherSlot.value, 0.15);
    assert('a count keyed to another slot leaves the flag set', otherSlot.stacksUnknown === true);

    // A resolvable trigger still loses to the user's own number.
    const derivable = { ...eff, stackTrigger: { type: 'castMatch', skillType: 'skill' } };
    const ctx = { ...baseCtx(), fireCountByType: new Map([['skill', 2]]), manualStacks: new Map([['x', 4]]) };
    assertClose('manual outranks a resolvable castMatch trigger', effectsActiveAtStep(mk(derivable), ctx)[0].value, 0.60);
}

// ── Non-stackable effects pass through unchanged ─────────────────────────────
{
    const eff = { stat: 'critRate', value: 0.2, trigger: { type: 'none' }, window: { type: 'always' } };
    const out = effectsActiveAtStep(mk(eff), baseCtx());
    assertClose('non-stackable value unchanged', out[0].value, 0.2);
    assert('non-stackable effect not marked stackable', !out[0].stackable);
}

// ── Unconditional stackable applies via collectActiveEffects at one stack ────
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
        const build = setChain(createBuild(r), ch.level);
        const scaled = collectActiveEffects(build, r).find(x => x.stackable && x.stat === e.stat);
        assert(`unconditional stackable resolved (${r.name})`, !!scaled);
        // No rotation context, so the count is underivable unless the effect
        // carries a resolvable trigger — one stack, and it says so.
        if (scaled?.stacksSource === 'unknown') {
            assertClose('unconditional stackable scaled to ONE stack', scaled.value, e.perStack);
        } else {
            assert('a derived count is capped at maxStacks',
                e.maxStacks == null || scaled.stacks <= e.maxStacks);
        }
    } else { passed += 2; }
}

// ── build.effectStacks round-trips through createBuild + setEffectStacks ─────
{
    const resonator = d.resonators.find(r => r.id === 1509);   // Lynae — S3.1 Premixed Hue
    const build = createBuild(resonator);
    assert('a fresh build starts with no manual stack counts',
        Object.keys(build.effectStacks ?? {}).length === 0);

    const set = setEffectStacks(build, 'S3.1', 12);
    assert('setEffectStacks stores the count', set.effectStacks['S3.1'] === 12);
    assert('setEffectStacks truncates to an integer', setEffectStacks(build, 'S3.1', 12.7).effectStacks['S3.1'] === 12);
    assert('setEffectStacks rejects a negative count', setEffectStacks(build, 'S3.1', -1).effectStacks['S3.1'] === undefined);
    assert('setEffectStacks rejects a malformed slot key', setEffectStacks(build, 'nonsense', 3) === build);
    assert('null CLEARS the entry (hands the count back to the engine)',
        setEffectStacks(set, 'S3.1', null).effectStacks['S3.1'] === undefined);
    assert('0 is stored, not treated as a clear', setEffectStacks(build, 'S3.1', 0).effectStacks['S3.1'] === 0);

    // A hand-edited save cannot inject a negative multiplier or a junk key.
    const dirty = normalizeBuild({ ...build, effectStacks: { 'S3.1': -5, 'IH0.0': '2', 'bad key': 9 } }, { dataset: d });
    assert('normalizeBuild drops a negative stored count', dirty.effectStacks['S3.1'] === undefined);
    assert('normalizeBuild coerces a numeric string', dirty.effectStacks['IH0.0'] === 2);
    assert('normalizeBuild drops a malformed slot key', dirty.effectStacks['bad key'] === undefined);
}

// ── underivableStacks: the rows the build editor's stepper renders ──────────
{
    const lynae = d.resonators.find(r => r.id === 1509);
    const atS3 = setChain(createBuild(lynae), 3);
    const rows = underivableStacks(atS3, lynae);
    const premixedHue = rows.find(row => row.key === 'S3.1');

    assert('Lynae S3.1 (Premixed Hue) is reported as underivable', !!premixedHue);
    assert('it carries the recovered cap so the stepper can bound itself', premixedHue?.maxStacks === 25);
    assert('it defaults to the assumed single stack', premixedHue?.stacks === 1);
    assert('it says the count is not derived', premixedHue?.stacksSource === 'unknown');
    assert('it carries the kit text so the row can explain itself',
        typeof premixedHue?.condition === 'string' && premixedHue.condition.length > 0);

    // Below the unlock level the effect is not in the pool at all.
    assert('a locked chain effect is not offered a stepper',
        !underivableStacks(setChain(createBuild(lynae), 2), lynae).some(row => row.key === 'S3.1'));

    // Once the user sets a count the row stays (so it is editable) but flips source.
    const withCount = underivableStacks(setEffectStacks(atS3, 'S3.1', 8), lynae).find(row => row.key === 'S3.1');
    assert('a user-set row reports the user count', withCount?.stacks === 8);
    assert('a user-set row reports source "manual"', withCount?.stacksSource === 'manual');

    // An effect the rotation CAN derive is not offered a stepper.
    const jinhsi = d.resonators.find(r => r.id === 1304);
    assert('a derivable stack (Jinhsi S3.0, castMatch intro) gets no stepper row',
        !underivableStacks(setChain(createBuild(jinhsi), 3), jinhsi).some(row => row.key === 'S3.0'));

    // Roster-wide: every row the stepper can show is genuinely underivable.
    for (const resonator of d.resonators) {
        for (const row of underivableStacks(setChain(createBuild(resonator), 6), resonator)) {
            assert(`${resonator.id} ${row.key}: a stepper row has a positive perStack`, row.perStack > 0);
            assert(`${resonator.id} ${row.key}: a stepper row's count never exceeds its cap`,
                row.maxStacks == null || row.stacks <= row.maxStacks);
        }
    }
}

// ── The user's count actually reaches the damage total ──────────────────────
{
    const lynae = d.resonators.find(r => r.id === 1509);
    const atS3 = setChain(createBuild(lynae), 3);
    const assumed = collectActiveEffects(atS3, lynae).find(e => e.stackable && e.stacksSource);
    if (assumed) {
        const key = underivableStacks(atS3, lynae)[0]?.key;
        const bumped = collectActiveEffects(setEffectStacks(atS3, key, 3), lynae)
            .find(e => e.stackable && e.perStack === assumed.perStack);
        assert('setting a stack count changes the effect value the sim sees',
            bumped != null && Math.abs(bumped.value - assumed.perStack * 3) < 1e-9);
    } else { passed += 1; }
}

// ── Stack BANDS: one branch of a piecewise per-stack function ───────────────
// Yangyang: Xuanling amplifies 10%/stack at 1-3 stacks of Havoc Bane and
// 12%/stack at 4-6. The game ships those as two separate effects, mutually
// exclusive by stack count, so exactly one may ever contribute.
{
    const mkBand = (band, perStack, cap) => ({
        stat: 'amplify', value: perStack, stackable: true, perStack, maxStacks: cap,
        trigger: { type: 'none' }, window: { type: 'always' },
        stackTrigger: { type: 'unknown' }, stackBand: band,
    });
    const low = mkBand({ min: 1, max: 3 }, 0.10, 3);
    const high = mkBand({ min: 4, max: 6 }, 0.12, 3);
    const at = (effect, count) => effectsActiveAtStep([{ effect, key: 'x' }],
        { ...baseCtx(), manualStacks: new Map([['x', count]]) })[0];

    assertClose('1 stack lights the 1-3 branch only', at(low, 1).value, 0.10);
    assert('...and the 4-6 branch reports out of band', at(high, 1).outOfBand === true);
    assertClose('...contributing exactly nothing', at(high, 1).value, 0);
    assertClose('3 stacks = the 1-3 branch at its stated 30% ceiling', at(low, 3).value, 0.30);

    assertClose('4 stacks switch branches: 1-3 goes silent', at(low, 4).value, 0);
    assert('...marked out of band, not merely zero', at(low, 4).outOfBand === true);
    assertClose('...and 4-6 pays its stated 36% ceiling', at(high, 4).value, 0.36);
    assertClose('6 stacks stay at the 36% ceiling', at(high, 6).value, 0.36);

    // The band gates on the RAW count; maxStacks caps only the VALUE. Capping
    // first would pull a raw 4 down to 3 and wrongly light the 1-3 branch.
    assert('a raw count above the cap still fails the lower band', at(low, 5).outOfBand === true);
    assertClose('0 stacks light nothing at all', at(low, 0).value + at(high, 0).value, 0);

    // Underivable + banded: the branch excluding 1 must not claim a floor.
    const unknownLow = effectsActiveAtStep([{ effect: low, key: 'x' }], baseCtx())[0];
    const unknownHigh = effectsActiveAtStep([{ effect: high, key: 'x' }], baseCtx())[0];
    assertClose('an underivable count lights the band containing 1', unknownLow.value, 0.10);
    assert('and leaves the 4-6 branch inert rather than at its floor',
        unknownHigh.value === 0 && unknownHigh.outOfBand === true);

    // An unbanded stackable is untouched by any of this.
    const plain = { ...low };
    delete plain.stackBand;
    assertClose('an effect with no band is capped as before', at(plain, 9).value, 0.30);
    assert('and never reports outOfBand', at(plain, 9).outOfBand === undefined);
}

// ── The live pair, as shipped ──────────────────────────────────────────────
{
    const xuanling = d.resonators.find(r => r.id === 1610);
    const unlocked = unlockedEffects(createBuild(xuanling), xuanling)
        .filter(entry => entry.key.startsWith('IH0.'));
    assert('Yangyang: Xuanling ships both Havoc Bane branches', unlocked.length === 2);

    const totalAt = (count) => effectsActiveAtStep(unlocked, {
        ...baseCtx(),
        manualStacks: new Map(unlocked.map(entry => [entry.key, count])),
    }).reduce((sum, effect) => sum + effect.value, 0);

    assertClose('3 Havoc Bane stacks -> 30% amplify', totalAt(3), 0.30);
    assertClose('4 Havoc Bane stacks -> 36%, NOT 30 + 48', totalAt(4), 0.36);
    assertClose('6 Havoc Bane stacks -> 36%', totalAt(6), 0.36);
    assert('no count double-counts the two branches',
        [0, 1, 2, 3, 4, 5, 6].every(count => totalAt(count) <= 0.36 + 1e-9));
}

console.log(`\nstackable-effects: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
