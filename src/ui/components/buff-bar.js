/**
 * Shared buff-window timeline renderer (P11 §8). Both build-editor-v2.js
 * (per-sonata-trigger windows, sim.buffWindows) and team-editor-v2.js
 * (per-step-derived windows, memberBuffWindows) plot a strip per active buff
 * on a time axis — this module owns the one shared visual: lane-packed,
 * colour- and icon-coded strips. Each call site maps its own native window
 * shape into the normalized `strip` shape below; the underlying data stays
 * distinct (see sim.js's two buff-window structures) by design.
 *
 *   strip = { name, start, end, elementColor?, dmgType?, tipTitle?, tipDesc?,
 *            stackBands? }
 *     start/end are absolute seconds on the caller's own time axis.
 *     stackBands, when set, is an array of { startFrac, widthFrac, level }
 *     (fractions 0..1 relative to the strip's own width; level 0..1 = stacks /
 *     maxStacks) — rendered as a height-encoded ramp behind the label so a
 *     stacking buff's per-step ramp/decay is visible, not a flat block.
 *     elementColor, when set, is a resolved CSS colour (e.g. 'var(--el-glacio)').
 *     dmgType, when set, is one of sonata-buffs.js's damage-type keys
 *     ('basic'|'heavy'|'skill'|'liberation'|'echo'|'intro'|'outro') and maps
 *     to the matching --dmg-* token. Callers that have it structurally
 *     (build-editor-v2.js's sim.buffWindows) pass it directly; callers that
 *     only have a rendered label (team-editor-v2.js) leave it unset and
 *     `classifyBuff` falls back to detecting it from `name` text.
 */

import { iconHtml } from '../icons.js';
import { esc } from '../dom.js';
import { detectDamageType } from '../../core/sonata-buffs.js';

// One decimal place ONLY when the value isn't already a whole percent — a
// per-stack magnitude like Havoc Eclipse's 7.5% must never round to "8%"
// (2026-07-14 maintainer report). Mirrors sim.js's own (core-layer) copy —
// duplicated, not imported, since core must not depend on the UI layer.
export function fmtPctTrim(v) {
    const s = v.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
}

// Buff-name keywords that read as a defensive effect (heal/shield/mitigation).
// Everything else (ATK/crit/DMG-bonus/element/energy buffs) gets the generic glyph.
const DEFENSIVE_KEYWORDS = /heal|shield|barrier|defen[cs]e|resist|tenacity|mitigat/i;

/** Which buff-bar glyph (icons.js kind 'misc') a buff name should use. */
export function iconSlugFor(name) {
    return DEFENSIVE_KEYWORDS.test(String(name ?? '')) ? 'defensive-buff-icon' : 'gen-buff-icon';
}

/**
 * Strip colour, in priority order: an explicit element colour, then a
 * damage-type colour (--dmg-basic/heavy/skill/liberation/echo/intro/outro),
 * then the neutral buff token for everything else (ATK%, heal%, energy, etc.).
 */
export function colorFor(elementColor, dmgType) {
    if (elementColor) return elementColor;
    if (dmgType) return `var(--dmg-${dmgType})`;
    return 'var(--buff-neutral)';
}

/** { color, iconSlug } for a buff strip — the single classification call sites use. */
export function classifyBuff(name, elementColor, dmgType) {
    const resolvedDmgType = dmgType ?? detectDamageType(String(name ?? ''));
    return { color: colorFor(elementColor, resolvedDmgType), iconSlug: iconSlugFor(name) };
}

/**
 * Turn a stacking buff's per-step stack samples into height-encoded time
 * bands (fractions relative to the strip's own [winStart, winEnd] span).
 * Adjacent equal-stack samples merge into one band; `level` is
 * stacks / maxStacks (0..1). Shared by build-editor-v2.js (per-solo-sim
 * windows, `sim.buffWindows` + `stacksByStepIndex`) and team-editor-v2.js
 * (team-time-shifted windows from `simulateTeamRotation`'s
 * `memberStackedBuffWindows`) — one band-merging implementation for both
 * pages' ramp visualization (2026-07-14).
 *
 * @param {Array<{start:number,end:number,stacks:number}>} samples — should
 *   cover the WHOLE [winStart, winEnd] span (including zero-stack gaps), not
 *   just the active portion, so decay-to-baseline renders correctly.
 * @param {number} winStart
 * @param {number} winEnd
 * @returns {Array<{startFrac:number,widthFrac:number,level:number}>|null}
 */
export function stackBandsFromSamples(samples, winStart, winEnd) {
    const span = winEnd - winStart;
    if (!(span > 0) || !samples?.length) return null;
    const maxStacks = Math.max(0, ...samples.map(s => s.stacks));
    const merged = [];
    for (const s of samples) {
        const a = Math.max(s.start, winStart);
        const b = Math.min(s.end, winEnd);
        if (b <= a) continue; // outside the rendered span
        const lvl = s.stacks ?? 0;
        const last = merged[merged.length - 1];
        if (last && last.lvl === lvl && Math.abs(last.b - a) < 1e-6) last.b = b;
        else merged.push({ a, b, lvl });
    }
    return merged.map((m) => ({
        startFrac: (m.a - winStart) / span,
        widthFrac: (m.b - m.a) / span,
        level: maxStacks > 0 ? m.lvl / maxStacks : 0,
    }));
}

/**
 * Lane-packs strips so overlapping windows stack into separate rows while
 * sequential (non-overlapping) ones share a row. Strips must already be in
 * `{ start, end, ... }` form; returns the same objects with a `lane` field.
 */
export function laneLayout(strips) {
    const laneEnds = [];
    return strips.map((s) => {
        let lane = laneEnds.findIndex((e) => e <= s.start);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
        laneEnds[lane] = s.end;
        return { ...s, lane };
    });
}

function laneCount(lanedStrips) {
    return lanedStrips.reduce((max, s) => Math.max(max, s.lane + 1), 0);
}

/**
 * One positioned strip. `totalSpan` is the caller's full time axis (seconds).
 * `strip.eyebrow` (small line above) and `strip.meta` (small line below, e.g.
 * a duration) are optional — build-editor-v2's richer 3-line strips set them,
 * team-editor-v2's single-line strips leave them unset.
 */
export function renderBuffStrip(strip, totalSpan, opts = {}) {
    const { rowH = 24, gap = 5 } = opts;
    const { color, iconSlug } = classifyBuff(strip.name, strip.elementColor, strip.dmgType);
    const leftPct = (strip.start / totalSpan) * 100;
    const widthPct = Math.max(0.5, ((strip.end - strip.start) / totalSpan) * 100);
    const iconSize = Math.round(rowH * 0.4);
    const tipTitle = strip.tipTitle ?? strip.name;
    const tipAttrs = `data-tip-title="${esc(tipTitle)}"${strip.tipDesc ? ` data-tip-desc="${esc(strip.tipDesc)}"` : ''}`;

    const rows = [];
    if (strip.eyebrow) rows.push(`<span style="font-family:var(--font-display);font-size:7px;letter-spacing:.8px;color:${color};opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1;">${esc(strip.eyebrow)}</span>`);
    rows.push(`<span style="display:flex;align-items:center;gap:5px;min-width:0;">${iconHtml('misc', iconSlug, { label: strip.name, size: iconSize, tintColor: color })}<span style="flex:1;min-width:0;font-family:var(--font-display);font-weight:700;font-size:9.5px;color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(strip.name)}</span></span>`);
    if (strip.meta) rows.push(`<span style="font-family:var(--font-display);font-size:8px;color:${color};opacity:.5;line-height:1.1;">${esc(strip.meta)}</span>`);

    // Stack-ramp layer: height-encoded bands behind the label (taller = more
    // stacks at that time slice), so the per-step ramp/decay is visible.
    const bandLayer = strip.stackBands?.length
        ? `<div style="position:absolute;inset:0;z-index:0;pointer-events:none;">${strip.stackBands.map(b =>
            `<div style="position:absolute;left:${(b.startFrac * 100).toFixed(2)}%;width:${(b.widthFrac * 100).toFixed(2)}%;bottom:0;height:${Math.max(12, Math.round(b.level * 100))}%;background:color-mix(in srgb, ${color} ${Math.round(14 + b.level * 26)}%, transparent);border-right:1px solid color-mix(in srgb, ${color} 22%, transparent);"></div>`
          ).join('')}</div>`
        : '';

    return `<div ${tipAttrs} style="position:absolute;left:${leftPct.toFixed(2)}%;width:${widthPct.toFixed(2)}%;top:${strip.lane * (rowH + gap)}px;height:${rowH}px;border-radius:6px;background:color-mix(in srgb, ${color} 12%, transparent);border:1px solid color-mix(in srgb, ${color} 40%, transparent);overflow:hidden;box-sizing:border-box;cursor:default;">${bandLayer}<div style="position:relative;z-index:1;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:1px;padding:0 7px;">${rows.join('')}</div></div>`;
}

/**
 * The full lane-packed strip stack (no header/empty-state — callers own
 * their own wrapper text since wording differs between pages). Returns ''
 * when there's nothing to show.
 */
export function renderBuffBar(strips, totalSpan, opts = {}) {
    if (!strips?.length || !(totalSpan > 0)) return '';
    const { rowH = 24, gap = 5 } = opts;
    const laned = laneLayout(strips);
    const bars = laned.map((s) => renderBuffStrip(s, totalSpan, opts)).join('');
    return `<div style="position:relative;width:100%;height:${laneCount(laned) * (rowH + gap)}px;">${bars}</div>`;
}

export const __test__ = { DEFENSIVE_KEYWORDS };

