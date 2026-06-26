/**
 * Tests for the shared buff-bar renderer (P11 §8 wrap-up) — the lane-packing
 * and colour/icon classification used by both build-editor-v2.js's
 * BUFF WINDOWS strip and team-editor-v2.js's per-member ACTIVE BUFFS strip.
 *
 *   node tests/buff-bar.test.mjs
 */

import {
    iconSlugFor, colorFor, classifyBuff, laneLayout, renderBuffBar, renderBuffStrip,
} from '../src/ui/components/buff-bar.js';

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── iconSlugFor ──────────────────────────────────────────────────────────────
{
    assert('heal → defensive glyph', iconSlugFor('Healing Bonus +20%') === 'defensive-buff-icon');
    assert('shield → defensive glyph', iconSlugFor('Shield Strength +15%') === 'defensive-buff-icon');
    assert('resist → defensive glyph', iconSlugFor('Glacio Resist Ignore') === 'defensive-buff-icon');
    assert('ATK buff → generic glyph', iconSlugFor('+10% ATK') === 'gen-buff-icon');
    assert('element DMG buff → generic glyph', iconSlugFor('+25% Glacio DMG') === 'gen-buff-icon');
    assert('dmg-type buff → generic glyph', iconSlugFor('+25% Heavy Attack DMG') === 'gen-buff-icon');
}

// ── colorFor / classifyBuff — colour priority: element > dmgType > neutral ──
{
    assert('element colour wins', colorFor('var(--el-glacio)', 'heavy') === 'var(--el-glacio)');
    assert('dmg-type colour when no element', colorFor(null, 'heavy') === 'var(--dmg-heavy)');
    assert('neutral when neither', colorFor(null, null) === 'var(--buff-neutral)');

    const elemBuff = classifyBuff('+25% Glacio DMG', 'var(--el-glacio)', null);
    assert('classifyBuff: explicit element colour used', elemBuff.color === 'var(--el-glacio)');

    const dmgTypeBuff = classifyBuff('+25% Heavy Attack DMG', null, 'heavy');
    assert('classifyBuff: explicit dmgType used', dmgTypeBuff.color === 'var(--dmg-heavy)');

    // No explicit dmgType supplied (team-editor-v2's case) — falls back to
    // detecting it from the label text via sonata-buffs.js's detectDamageType.
    const fallbackBuff = classifyBuff('+25% Resonance Skill DMG', null, undefined);
    assert('classifyBuff: detects dmgType from name when not provided', fallbackBuff.color === 'var(--dmg-skill)');
    const fallbackLiberation = classifyBuff('+18% Resonance Liberation DMG', null, undefined);
    assert('classifyBuff: detects liberation dmgType from name', fallbackLiberation.color === 'var(--dmg-liberation)');

    const neutralBuff = classifyBuff('+10% ATK', null, undefined);
    assert('classifyBuff: neutral fallback for ATK', neutralBuff.color === 'var(--buff-neutral)');
}

// ── laneLayout — overlap packing ────────────────────────────────────────────
{
    const sequential = laneLayout([{ start: 0, end: 5 }, { start: 5, end: 10 }]);
    assert('sequential windows share lane 0', sequential[0].lane === 0 && sequential[1].lane === 0);

    const overlapping = laneLayout([{ start: 0, end: 10 }, { start: 2, end: 8 }]);
    assert('overlapping windows take separate lanes', overlapping[0].lane === 0 && overlapping[1].lane === 1);

    // A third window starting at t=9 still overlaps lane 0's occupant (ends
    // at t=10), so it correctly reuses lane 1 (ends at t=8) instead.
    const stillOverlapping = laneLayout([{ start: 0, end: 10 }, { start: 2, end: 8 }, { start: 9, end: 12 }]);
    assert('a window overlapping lane 0 reuses the free lane 1', stillOverlapping[2].lane === 1);

    // Once both original windows have ended, a new one reuses the first free lane (0).
    const free = laneLayout([{ start: 0, end: 10 }, { start: 2, end: 8 }, { start: 11, end: 12 }]);
    assert('a window after both lanes free reuses lane 0', free[2].lane === 0);
}

// ── renderBuffBar / renderBuffStrip — render smoke + empty state ───────────
{
    assert('empty strips → empty string', renderBuffBar([], 10) === '');
    assert('zero totalSpan → empty string', renderBuffBar([{ name: 'x', start: 0, end: 1 }], 0) === '');

    const bar = renderBuffBar([{ name: '+25% Glacio DMG', start: 0, end: 5, elementColor: 'var(--el-glacio)' }], 10);
    assert('renders a positioned strip', bar.includes('position:absolute') && bar.includes('var(--el-glacio)'));

    const strip = renderBuffStrip({ name: '+18% Resonance Liberation DMG', start: 0, end: 5, lane: 0 }, 10);
    assert('strip with no explicit dmgType still resolves dmg-type colour from name', strip.includes('var(--dmg-liberation)'));
    assert('strip carries a tooltip title', strip.includes('data-tip-title='));
}

console.log(`\nbuff-bar.test.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
