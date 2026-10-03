/**
 * "The incoming Resonator gains …" is the OUTRO lane's, not a self-buff
 * (2026-10-03).
 *
 *   node tests/incoming-recipient.test.mjs
 *
 * An Outro Skill's grant goes to the member switching IN, and `outroBuffs`
 * already carries it — read from the sentence that states it, filtered against
 * the outgoing member's own mode, and applied at the hand-off. The same sentence
 * also reaches the ordinary effect parser, which had no notion of a recipient
 * other than "the wielder" or "the team", so it emitted a SECOND copy as a
 * self-buff. That is the "two paths, one cast" error the outro invariant names.
 *
 * MEASURED, which is what makes this safe to assert rather than assume: all four
 * roster clauses of this shape are already in their own resonator's `outroBuffs`
 * at the SAME value and the SAME 14s. Not one of them is a distinct grant.
 *
 * None was paying at the time of the fix, but three were LATENT rather than
 * harmless, each held off by something unrelated to the recipient:
 *   Iuno SN1.0     its trigger fires on four Heavy casts and the window opens —
 *                  only the dead scope ('heavy', a bucket her kit never reads)
 *                  stopped it, so "fixing" that scope would have switched on a
 *                  50% self-amplify.
 *   Qiuyuan SN2.0  no mechanically `echo`-typed cast in her rotation, though her
 *                  kit DOES read the echo bucket.
 *   Lynae S2.1     no `outro` cast in a SOLO rotation — but a team sim casts one.
 *   Lynae SN0.0    fires, but no later hit of hers reads the liberation bucket.
 *
 * THEY ARE MARKED, NEVER DROPPED. Removing an effect changes its node's effect
 * COUNT and re-slots every `S{level}.{index}` after it — Lynae carries a curated
 * override at `S3.1`, directly after one of these at `S2.1`, which is exactly how
 * a curated patch once moved silently onto a different effect (CLAUDE.md,
 * "Effect-slot keys are FROZEN before anything reads them"). So the parser stamps
 * `recipient: 'incoming'` and `resolveChainInherentContext` skips it.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { resolveChainInherentContext } from '../src/core/buffs.js';
import { INCOMING_RECIPIENT_RE } from '../tools/preprocess/effects.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── The phrase detector ──────────────────────────────────────────────────────
{
    assert('it reads the plain form', INCOMING_RECIPIENT_RE.test('The incoming Resonator gains 50% …'));
    assert('and the "next incoming" form',
        INCOMING_RECIPIENT_RE.test('The next incoming Resonator gain 15% All DMG Amplification'));
    assert('and the "to the incoming Resonator" form',
        INCOMING_RECIPIENT_RE.test('Grant 50% Echo Skill DMG Amplification to the incoming Resonator'));
    // Word-bounded, so it cannot catch an unrelated "incoming" (a stray backspace
    // in place of \b once made this regex match nothing at all, silently).
    assert('it does not fire on an unrelated "incoming"',
        !INCOMING_RECIPIENT_RE.test('reduces incoming damage by 20%'));
    assert('the source carries real word boundaries', INCOMING_RECIPIENT_RE.source.includes('\\b'));
}

// ── The population, and the proof each one is a DUPLICATE ────────────────────
const marked = [];
for (const resonator of dataset.resonators) {
    for (const [lane, nodes] of [['S', resonator.resonanceChain], ['IH', resonator.inherentSkills],
        ['SN', resonator.skillNodeEffects]]) {
        (nodes ?? []).forEach((node, ni) => (node.effects ?? []).forEach((effect, ei) => {
            if (effect.recipient === 'incoming') marked.push({ resonator, lane, ni, ei, effect });
        }));
    }
}
{
    assert(`exactly four clauses on the roster name the incoming Resonator (found ${marked.length})`,
        marked.length === 4);
    assert('they belong to Iuno, Qiuyuan and Lynae',
        JSON.stringify([...new Set(marked.map(entry => entry.resonator.id))].sort()) === '[1410,1411,1509]');

    // THE CROSS-CHECK. Each marked effect must be matched by an entry in its own
    // resonator's outroBuffs at the same value AND duration. This is what proves
    // the effect is a second copy rather than a distinct grant — and it is why
    // skipping it loses nothing. Matched on value+duration, NOT on scope: Lynae's
    // S2.1 parses skillType 'outro' off its leading trigger ("Outro Skill gains
    // the following effect: …") where the real grant is her Liberation, so the
    // scopes legitimately disagree while the grant is the same one.
    for (const { resonator, lane, ni, ei, effect } of marked) {
        const slot = lane === 'S' ? `S${ni + 1}.${ei}` : `${lane}${ni}.${ei}`;
        const twin = (resonator.outroBuffs ?? []).find(buff =>
            Math.abs(buff.value - effect.value) < 1e-9 && buff.duration === effect.durationSeconds);
        assert(`${resonator.id} ${slot} (${effect.value} for ${effect.durationSeconds}s) has its twin in outroBuffs`,
            !!twin);
    }
    assert('every one states a duration, which is half the join',
        marked.every(entry => entry.effect.durationSeconds > 0));
}

// ── The consumer ignores them ────────────────────────────────────────────────
{
    // Built so that EVERY other gate passes: the stat is one the resolver reads,
    // the category matches the hit exactly, and nothing else would exclude it.
    // Only the recipient may keep it out.
    const hit = { element: 1, skillType: 'heavy', skillKey: 'heavy_heavy_attack' };
    const self = { stat: 'amplify', value: 0.5, element: null, skillType: 'heavy' };
    const incoming = { ...self, recipient: 'incoming' };

    assert('a self-recipient amplify DOES apply, so the control is valid',
        Math.abs(resolveChainInherentContext([self], hit).amplify - 0.5) < 1e-9);
    assert('the same effect marked for the incoming Resonator applies NOTHING',
        resolveChainInherentContext([incoming], hit).amplify === 0);
    // It must not leak into any other bucket either.
    const resolved = resolveChainInherentContext([incoming], hit);
    assert('and contributes to no other bucket',
        Object.values(resolved).every(value => value === 0));
    // A sibling in the same list is unaffected — the skip is per effect.
    assert('a sibling self-buff in the same list still applies',
        Math.abs(resolveChainInherentContext([incoming, self], hit).amplify - 0.5) < 1e-9);
    // Other recipient values are NOT swallowed: only 'incoming' is special.
    assert("an unrecognised recipient value does not silence an effect",
        Math.abs(resolveChainInherentContext([{ ...self, recipient: 'self' }], hit).amplify - 0.5) < 1e-9);
}

// ── Each real one, through the resolver with its own kit's hit ───────────────
{
    for (const { resonator, effect } of marked) {
        const hit = { element: effect.element, skillType: effect.skillType, skillKey: null };
        const resolved = resolveChainInherentContext([effect], hit);
        assert(`${resonator.id} ${effect.stat} ${effect.value} pays the wielder nothing`,
            Object.values(resolved).every(value => value === 0));
    }
}

console.log(`\nincoming-recipient: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
