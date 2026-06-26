/**
 * Tests for tip-format.js — the shared hover-box description formatter and
 * extractSkillSection, the section-extraction heuristic that picks the
 * relevant part of a combined move-family `desc` for one skill key (P11
 * wrap-up follow-on: hover-box descriptions everywhere).
 *
 *   node tests/tip-format.test.mjs
 */

import { formatTipDesc, extractSkillSection } from '../src/ui/tip-format.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
