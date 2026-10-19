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
 * TWO LANES, TWO RULES.
 *   - An Outro node's own text is not read as skill-node effects at all when
 *     `outroBuffs` carries its grants (tools/preprocess.mjs). That removed the
 *     SN copies of Iuno, Qiuyuan, Lynae, Zani, Yangyang: Xuanling and Hsin; Hsin's
 *     was live. Dropping them re-slots no other key: on all seven the Outro node
 *     was the LAST skill node.
 *   - A chain or inherent clause naming the incoming Resonator is MARKED, NEVER
 *     DROPPED. Removing an effect changes its node's effect COUNT and re-slots
 *     every `S{level}.{index}` after it — Lynae carries a curated override at
 *     `S3.1`, directly after one of these at `S2.1` (CLAUDE.md, "Effect-slot keys
 *     are FROZEN before anything reads them"). The parser stamps
 *     `recipient: 'incoming'` and `resolveChainInherentContext` skips it.
 *
 * Lynae S2.1 is a DUPLICATE: its own `outroBuffs` carries it at the same value
 * and 14s, so skipping it loses nothing. Suoming's two are DISTINCT grants with
 * no producer — a chain-gated Crit. DMG grant and an Aligned Seals (Unison)
 * Electro grant, both handed to the incoming Resonator through her Outro — so
 * skipping them UNDERSTATES. They are named in DISTINCT_GRANTS with the reason.
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
// Incoming grants that are NOT in outroBuffs, so nothing pays them yet.
const DISTINCT_GRANTS = {
    '1312 S2.1': 'S2 "Casting Outro Skill increases the incoming Resonator\'s Crit. DMG by 10%, plus an additional '
        + '6% for each stack of Unison Boon" — chain-gated, and outroBuffs has no chain gate.',
    '1312 IH1.0': 'Sunken Seal, Forged Lock: the 30% Electro DMG Bonus to the incoming Resonator needs Aligned '
        + 'Seals, which needs Unison; the Unison system is not modelled.',
};
{
    assert(`exactly three clauses on the roster name the incoming Resonator (found ${marked.length})`,
        marked.length === 3);
    assert('they belong to Suoming and Lynae',
        JSON.stringify([...new Set(marked.map(entry => entry.resonator.id))].sort()) === '[1312,1509]');
    // The Outro node's own SN copy is gone wherever outroBuffs carries the grant.
    const outroCopies = dataset.resonators.filter(resonator => resonator.outroBuffs?.length
        && (resonator.skillNodeEffects ?? []).some(node => node.skillKeys.some(key => key.startsWith('outro'))));
    assert(`no Outro node is read twice (found ${outroCopies.map(resonator => resonator.id).join(',') || 'none'})`,
        outroCopies.length === 0);

    // THE CROSS-CHECK. Each marked effect must be matched by an entry in its own
    // resonator's outroBuffs at the same value AND duration. This is what proves
    // the effect is a second copy rather than a distinct grant — and it is why
    // skipping it loses nothing. Matched on value+duration, NOT on scope: Lynae's
    // S2.1 parses skillType 'outro' off its leading trigger ("Outro Skill gains
    // the following effect: …") where the real grant is her Liberation, so the
    // scopes legitimately disagree while the grant is the same one.
    const duplicates = [];
    for (const entry of marked) {
        const { resonator, lane, ni, ei, effect } = entry;
        const slot = lane === 'S' ? `S${ni + 1}.${ei}` : `${lane}${ni}.${ei}`;
        const twin = (resonator.outroBuffs ?? []).find(buff =>
            Math.abs(buff.value - effect.value) < 1e-9 && buff.duration === effect.durationSeconds);
        if (DISTINCT_GRANTS[`${resonator.id} ${slot}`]) {
            assert(`${resonator.id} ${slot} is listed as distinct and really has no twin`, !twin);
            continue;
        }
        duplicates.push(entry);
        assert(`${resonator.id} ${slot} (${effect.value} for ${effect.durationSeconds}s) has its twin in outroBuffs`,
            !!twin);
    }
    assert('every duplicate states a duration, which is half the join',
        duplicates.every(entry => entry.effect.durationSeconds > 0));
    for (const key of Object.keys(DISTINCT_GRANTS)) {
        assert(`DISTINCT_GRANTS entry ${key} still exists`, marked.some(entry =>
            `${entry.resonator.id} ${entry.lane === 'S' ? `S${entry.ni + 1}` : `${entry.lane}${entry.ni}`}.${entry.ei}` === key));
    }
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
