/**
 * Tests for tip-format.js — the shared hover-box description formatter and
 * extractSkillSection, the section-extraction heuristic that picks the
 * relevant part of a combined move-family `desc` for one skill key (P11
 * wrap-up follow-on: hover-box descriptions everywhere).
 *
 *   node tests/tip-format.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { formatTipDesc, extractSkillSection, formatTimingFacts } from '../src/ui/tip-format.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── extractSkillSection ──────────────────────────────────────────────────────

// Sanhua-style: a single combined desc, one heading per universal move
// bucket, no named sub-moves — the common case (plain Basic Attack stages).
{
    const desc = [
        '## Basic Attack',
        'Performs up to 3 consecutive strikes, dealing Glacio DMG.',
        '',
        '## Heavy Attack',
        'Consumes Stamina to perform a heavy strike, dealing Glacio DMG.',
        '',
        '## Mid-air Attack',
        'Performs a mid-air strike, dealing Glacio DMG.',
        '',
        '## Dodge Counter',
        'Performs a counterattack after a successful Dodge, dealing Glacio DMG.',
    ].join('\n');

    assert('basic_1 resolves to only the Basic Attack section',
        extractSkillSection(desc, 'basic_1', 'basic') === '## Basic Attack\nPerforms up to 3 consecutive strikes, dealing Glacio DMG.');
    assert('basic_3 (a later stage, same bucket) resolves identically to basic_1',
        extractSkillSection(desc, 'basic_3', 'basic') === extractSkillSection(desc, 'basic_1', 'basic'));
    assert('heavy resolves to only the Heavy Attack section',
        extractSkillSection(desc, 'heavy', 'heavy').startsWith('## Heavy Attack'));
    assert('midair resolves to only the Mid-air Attack section',
        extractSkillSection(desc, 'midair', 'midair').startsWith('## Mid-air Attack'));
    assert('dodge_counter (detected via key, not skillType) resolves to the Dodge Counter section',
        extractSkillSection(desc, 'dodge_counter', 'dodge').startsWith('## Dodge Counter'));
}

// Wooly-Strike-style (verified against the real 1203/Encore dataset entry):
// more than one heading matches the universal bucket (a plain "Basic
// Attack" heading plus a named bonus-effect heading whose own heading text
// also contains the words "Basic Attack"). A bare-stage key like "basic_1"
// has no distinctive words to disambiguate with ("basic" is generic) — the
// safe move is the Tier-1 multi-candidate fallback (both sections shown,
// a strict superset that's still narrower than the full combined desc). A
// key that *does* carry the bonus move's own name ("woolies") resolves to
// just that section via the distinctive-word tier.
{
    const desc = [
        '## Basic Attack',
        'Performs up to 4 consecutive strikes.',
        '',
        '## Basic Attack: Wooly Strike',
        'On the 4th hit, additionally triggers Wooly Strike, dealing extra DMG.',
    ].join('\n');

    const plain = extractSkillSection(desc, 'basic_4', 'basic');
    assert('bare basic stage key (no distinctive words) safely falls back to both bucket candidates',
        plain.includes('Performs up to 4 consecutive strikes') && plain.includes('Wooly Strike'));
    assert('wooly_strike key resolves to only the named bonus section via distinctive-word overlap',
        extractSkillSection(desc, 'basic_woolies_damage', 'basic') === '## Basic Attack: Wooly Strike\nOn the 4th hit, additionally triggers Wooly Strike, dealing extra DMG.');
    assert('wooly_strike resolution does not also include the plain Basic Attack section',
        !extractSkillSection(desc, 'basic_woolies_damage', 'basic').includes('Performs up to 4 consecutive strikes'));
}

// death_knell-style: a named Liberation follow-up with zero bucket match
// (liberation/forte/skill/intro/outro have no generic vocabulary) — must
// fall straight through to the distinctive-word tier across all sections.
{
    const desc = [
        '## Liberation',
        'Unleashes a powerful strike, dealing massive DMG.',
        '',
        '## Death Knell',
        'After the Liberation hits, triggers Death Knell, dealing additional DMG.',
        '',
        '## Fatal Finale',
        'If Death Knell defeats an enemy, triggers Fatal Finale.',
    ].join('\n');

    assert('liberation_death_knell resolves to the Death Knell section',
        extractSkillSection(desc, 'liberation_death_knell', 'liberation').startsWith('## Death Knell'));
    assert('liberation_fatal_finale resolves to the Fatal Finale section',
        extractSkillSection(desc, 'liberation_fatal_finale', 'liberation').startsWith('## Fatal Finale'));
    assert('bare liberation key (no distinguishing words) falls back to the full combined text',
        extractSkillSection(desc, 'liberation', 'liberation') === desc);
}

// Fallback safety: when nothing in the heuristic finds a confident single
// section, never guess — always widen to a safe superset.
{
    const desc = '## Forte\nDeals DMG.\n\n## Forte: Bonus\nDeals more DMG.';
    // "forte" alone strips to zero distinctive tokens against either heading
    // (both contain only the generic word "forte") — must show everything,
    // not silently pick the first section.
    const result = extractSkillSection(desc, 'forte', 'forte');
    assert('zero-signal key falls back to full combined text rather than guessing',
        result === desc);
}

// Already-specific descs (≤1 heading, the 100/996 base-key case) pass through
// completely unchanged — no extraction needed or attempted.
{
    const desc = 'Unleashes a devastating attack, dealing massive Spectro DMG.';
    assert('no-heading desc passes through unchanged',
        extractSkillSection(desc, 'liberation', 'liberation') === desc);
}

// ── formatTipDesc ────────────────────────────────────────────────────────────

{
    const out = formatTipDesc('## Basic Attack\nDeals 125.5% ATK as Glacio DMG.');
    assert('heading line becomes a .bv2-tip-heading div',
        out.startsWith('<div class="bv2-tip-heading">Basic Attack</div>'));
    assert('heading conversion composes with percent highlighting',
        out.includes('<span class="bv2-tip-num">125.5%</span>'));
    assert('heading conversion composes with element highlighting',
        out.includes('color:var(--el-glacio)') && out.includes('>Glacio<'));
}

{
    // No headings at all — existing behaviour (number/element highlighting
    // only) must be untouched by the new heading pass.
    const out = formatTipDesc('Deals 50% ATK as Fusion DMG, then 30% ATK as Electro DMG.');
    assert('plain multi-element text highlights every element independently',
        out.includes('var(--el-fusion)') && out.includes('var(--el-electro)'));
    assert('plain multi-element text highlights every percent value',
        (out.match(/bv2-tip-num/g) ?? []).length === 2);
    assert('no heading divs are introduced when there are no ## lines',
        !out.includes('bv2-tip-heading'));
}

// ── formatTimingFacts ────────────────────────────────────────────────────────
// The measured-timing block at the head of a skill's hover box. Every claim it
// makes has to be backed by data that is actually present — the failure mode
// this guards is stating a DEFAULT as a fact when the underlying field is
// simply missing.
{
    const measured = {
        timingSource: 'extracted', firstDamageAt: 0.24, resolvesAt: 2.28,
        damageCount: 20, damageBeforeNextAtt: 5, nextAttAt: 0.8,
        interruptLevel: 2, staminaCost: 0,
    };

    assert('an estimated step shows nothing rather than a block of blanks',
        formatTimingFacts({ timingSource: 'estimated', firstDamageAt: 1 }) === '');
    assert('a step with no timingSource at all shows nothing',
        formatTimingFacts({ firstDamageAt: 1 }) === '');
    assert('null/undefined input is safe', formatTimingFacts(null) === '' && formatTimingFacts(undefined) === '');

    const full = formatTimingFacts(measured);
    assert('reports first damage, full resolve with its hit count, and the queue point',
        full.includes('First DMG at 0.24s') && full.includes('Fully resolves at 2.28s (20 hits)')
        && full.includes('Next action at 0.80s'));
    assert('states the cancel COST, not just the timestamp',
        full.includes('lands only 5 of 20 hits'));
    assert('a zero stamina cost is not printed as a row', !full.includes('STA cost'));
    assert('a single-hit ability does not print a hit count',
        !formatTimingFacts({ ...measured, damageCount: 1, damageBeforeNextAtt: 1 }).includes('hits)'));
    assert('no warning when every hit lands before the queue point',
        !formatTimingFacts({ ...measured, damageBeforeNextAtt: 20 }).includes('⚠'));
    assert('total loss is worded as such, not as "0 of N"',
        formatTimingFacts({ ...measured, damageBeforeNextAtt: 0 }).includes('loses all 20 hits'));
    assert('a real stamina cost is printed',
        formatTimingFacts({ ...measured, staminaCost: 25 }).includes('STA cost 25'));

    // The switch line: three outcomes, and the default must be earned.
    assert('the default (animation finishes on switch) needs a resolved animation',
        formatTimingFacts(measured).includes('✅'));
    assert('a key with no montage data makes NO switch claim at all',
        !formatTimingFacts({ timingSource: 'extracted', interruptLevel: 10 }).includes('✅'));
    assert('an authored end-on-switch window reports its start time',
        formatTimingFacts({ ...measured, switchBehavior: { endsOnSwitch: [{ from: 1.2, duration: 1.27 }] } })
            .includes('❌ Switching ends it from 1.20s'));
    assert('cannot-switch-out is a distinct third state, not the same as ending',
        formatTimingFacts({ ...measured, switchBehavior: { cannotSwitch: [{ from: 0.5, duration: 1 }] } })
            .includes('🔒 Cannot switch out from 0.50s'));

    // A loop hedges rather than asserting per-iteration — see the comment in
    // tip-format.js for why the two known cases disagree.
    const loop = formatTimingFacts({ ...measured, timingIsLoop: true });
    assert('a loop animation is flagged without claiming the times are one iteration',
        loop.includes('↻') && loop.includes('repeat count is not in the data'));
}

// Against the real dataset: the block must appear for measured steps, stay
// silent for the rest, and the warning must land on exactly the channel keys.
{
    const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
    let total = 0, shown = 0, warned = 0, unearnedDefault = 0;
    for (const map of Object.values(dataset.autoSkillMap)) {
        for (const def of Object.values(map)) {
            total++;
            const block = formatTimingFacts(def);
            if (!block) continue;
            shown++;
            if (block.includes('⚠')) warned++;
            if (block.includes('✅') && !(def.damageCount > 0)) unearnedDefault++;
        }
    }
    assert('most of the roster shows a measured block', shown > 900 && shown < total);
    assert('the estimated remainder stays silent', total - shown > 0);
    assert('the cancel warning lands on the small channel set, not the roster',
        warned > 0 && warned < 25);
    assert('no step claims "keeps resolving" without a resolved animation behind it',
        unearnedDefault === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
