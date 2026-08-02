/**
 * Shared buff-window timeline renderer (P11 §8). Both the build-editor page
 * (per-sonata-trigger windows, sim.buffWindows) and team-editor-v2.js
 * (per-step-derived windows, memberBuffWindows) plot a strip per active buff
 * on a time axis — this module owns the one shared visual: lane-packed,
 * colour-coded strips (with a heal/shield glyph on defensive buffs only). Each call site maps its own native window
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
 *     dmgType, when set, is one of buffs/sonata-buffs.js's damage-type keys
 *     ('basic'|'heavy'|'skill'|'liberation'|'echo'|'intro'|'outro') and maps
 *     to the matching --dmg-* token. Callers that have it structurally
 *     (build-editor's sim.buffWindows) pass it directly; callers that
 *     only have a rendered label (team-editor-v2.js) leave it unset and
 *     `classifyBuff` falls back to detecting it from `name` text.
 */

import { iconHtml } from '../icons.js';
import { esc } from '../dom.js';
import { detectDamageType } from '../../core/buffs/sonata-buffs.js';

// One decimal place ONLY when the value isn't already a whole percent — a
// per-stack magnitude like Havoc Eclipse's 7.5% must never round to "8%"
// (2026-07-14 maintainer report). Mirrors sim.js's own (core-layer) copy —
// duplicated, not imported, since core must not depend on the UI layer.
export function fmtPctTrim(v) {
    const s = v.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
}

// Buff-name keywords that read as a defensive effect (heal/shield/mitigation) —
// the ONLY buffs that still carry a strip glyph. The generic buff icon that used
// to mark every other buff (ATK/crit/DMG-bonus/element/energy) was dropped as
// visual noise: the strip's colour + name already identify those.
const DEFENSIVE_KEYWORDS = /heal|shield|barrier|defen[cs]e|resist|tenacity|mitigat/i;

/** The strip glyph (icons.js kind 'misc') for a buff name, or null for the
 *  generic case — no icon. */
export function iconSlugFor(name) {
    return DEFENSIVE_KEYWORDS.test(String(name ?? '')) ? 'defensive-buff-icon' : null;
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
 * stacks / maxStacks (0..1). Shared by the build-editor page (per-solo-sim
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
    // `count` is the raw stack number. `level` is normalised PER LANE, so it
    // conveys the shape of a ramp but is not comparable between rows — the
    // number is what settles "how many", and renderTrackBoard prints it.
    return merged.map((m) => ({
        startFrac: (m.a - winStart) / span,
        widthFrac: (m.b - m.a) / span,
        level: maxStacks > 0 ? m.lvl / maxStacks : 0,
        count: m.lvl,
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
 * a duration) are optional — the build editor's richer 3-line strips set them,
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
    const iconGlyph = iconSlug ? iconHtml('misc', iconSlug, { label: strip.name, size: iconSize, tintColor: color }) : '';
    rows.push(`<span style="display:flex;align-items:center;gap:5px;min-width:0;">${iconGlyph}<span style="flex:1;min-width:0;font-family:var(--font-display);font-weight:700;font-size:9.5px;color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(strip.name)}</span></span>`);
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

/**
 * TRACK BOARD — a labelled, grouped alternative to renderBuffBar's lane-packed
 * strip stack (2026-08-01).
 *
 * renderBuffBar packs strips into shared rows and writes each label INSIDE its
 * own bar, which works while every strip is wide. It stops working as soon as
 * short ones appear: a 0.6s window on a 22s axis is ~3% wide, so its name is
 * clipped to "Fusion Burst …" and two unrelated tracks share a row with no way
 * to tell which is which.
 *
 * This lays the same data out as a table instead — one row per track, its NAME
 * in a fixed left column, its bar in a time-aligned right column — and groups
 * the rows under headings, so buffs and debuffs are never interleaved.
 *
 * The board draws its OWN time axis under the tracks. It cannot borrow the
 * chart's above it: the label column shifts the plot area right by
 * `labelWidth`, so a bar read against that chart's ruler is overstated by up to
 * a fifth of the rotation. Step boundaries are drawn behind the bars as
 * gridlines so a bar can also be read against the cast that caused it.
 *
 * `groups` is [{ title, strips }] with strips in the shape:
 *   { name, meta?, eyebrow?, start, end, elementColor?, dmgType?, tip*?,
 *     stackBands?: [{ startFrac, widthFrac, level, count? }] }
 * A band's `count` is printed when the band is wide enough — height alone is
 * normalised per lane, so two equal-looking bands on different rows can be
 * different counts, and the number is the only thing that settles it.
 */
export function renderTrackBoard(groups, totalSpan, steps = [], opts = {}) {
    const live = (groups ?? []).filter((group) => group.strips?.length);
    if (!live.length || !(totalSpan > 0)) return '';
    const { rowH = 26, gap = 4, labelWidth = 200 } = opts;

    // Step boundaries, drawn once behind every track so the whole board shares
    // one ruler. The axis end needs no line of its own.
    const gridlines = (steps ?? [])
        .filter((step) => step.startTime > 0 && step.startTime < totalSpan - 1e-9)
        .map((step) => `<div style="position:absolute;left:${((step.startTime / totalSpan) * 100).toFixed(3)}%;top:0;bottom:0;width:1px;background:var(--bd);opacity:.5;"></div>`)
        .join('');

    const sections = live.map((group) => {
        const rows = group.strips.map((strip) => {
            const { color, iconSlug } = classifyBuff(strip.name, strip.elementColor, strip.dmgType);
            const leftPct = (Math.max(0, strip.start) / totalSpan) * 100;
            const widthPct = Math.max(0.4, ((strip.end - strip.start) / totalSpan) * 100);
            // The label column carries the NAME only. Everything else — the
            // eyebrow that classifies the row, and the meta that quantifies it —
            // moves into the hover: three lines per row at 7-8px was clutter,
            // and it forced a column wide enough to clip anyway.
            const tipTitle = strip.tipTitle ?? strip.name;
            const tipBody = [strip.eyebrow, strip.meta, strip.tipDesc].filter(Boolean).join('\n');
            const tipAttrs = `data-tip-title="${esc(tipTitle)}"${tipBody ? ` data-tip-desc="${esc(tipBody)}"` : ''}`;
            const iconGlyph = iconSlug ? iconHtml('misc', iconSlug, { label: strip.name, size: 11, tintColor: color }) : '';

            // Height-encoded stack bands, with the count printed where it fits —
            // height is normalised per lane, so it shows the SHAPE of a ramp but
            // never a comparable number across rows.
            // A band's width as a fraction of the WHOLE AXIS, not of its own
            // strip — otherwise a short strip prints every number and a long one
            // prints every other, and the visible sequence reads as a steeper
            // ramp than the real curve (1,3,5,7 for a +1 climb).
            const spanFrac = (strip.end - strip.start) / totalSpan;
            const bands = strip.stackBands?.length ?
                strip.stackBands.map((band) => {
                    // A count of zero is NOT a short bar — it is nothing. The
                    // height floor below would otherwise draw "emptied" and "one
                    // stack left" 2px apart, at the exact moment a consumption
                    // is meant to be legible.
                    if (band.count === 0) return '';
                    return `<div style="position:absolute;left:${(band.startFrac * 100).toFixed(2)}%;width:${(band.widthFrac * 100).toFixed(2)}%;bottom:0;height:${Math.max(14, Math.round(band.level * 100))}%;background:color-mix(in srgb, ${color} ${Math.round(16 + band.level * 30)}%, transparent);border-right:1px solid color-mix(in srgb, ${color} 30%, transparent);"></div>`;
                }).join('')
              : '';

            // Counts live in their OWN layer, anchored to the top of the bar
            // rather than inside their band. The shortest band is the 14% height
            // floor — about 4px — and a 7.5px digit inside it was cut in half by
            // the bar's overflow, on the FIRST band of every ramp.
            const bandNumbers = strip.stackBands?.length ?
                strip.stackBands.map((band) => {
                    if (band.count == null || band.count === 0) return '';
                    if (band.widthFrac * spanFrac < 0.018) return '';   // no room to print
                    return `<span style="position:absolute;left:${(band.startFrac * 100).toFixed(2)}%;width:${(band.widthFrac * 100).toFixed(2)}%;top:1px;text-align:center;font-family:var(--font-display);font-size:7.5px;line-height:1;color:${color};opacity:.85;pointer-events:none;">${esc(String(band.count))}</span>`;
                }).join('')
              : '';

            // Markers: single instants worth seeing (a mark being spent), which a
            // bar cannot express because they have no width.
            const marks = (strip.markers ?? []).map((marker) =>
                `<div data-tip-title="${esc(marker.label ?? '')}" style="position:absolute;left:${((marker.t / totalSpan) * 100).toFixed(3)}%;top:0;bottom:0;width:2px;margin-left:-1px;background:${color};box-shadow:0 0 3px ${color};cursor:default;"></div>`,
            ).join('');

            return `<div style="display:flex;align-items:stretch;gap:8px;height:${rowH}px;margin-bottom:${gap}px;">
                <div ${tipAttrs} style="width:${labelWidth}px;flex:none;display:flex;align-items:center;gap:4px;min-width:0;cursor:default;">
                  ${iconGlyph}<span style="flex:1;min-width:0;font-family:var(--font-display);font-weight:700;font-size:9.5px;color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(strip.name)}</span>
                </div>
                <div style="position:relative;flex:1;min-width:0;border-radius:5px;background:color-mix(in srgb, var(--bd) 22%, transparent);overflow:hidden;">
                  ${gridlines}
                  <div ${tipAttrs} style="position:absolute;left:${leftPct.toFixed(2)}%;width:${widthPct.toFixed(2)}%;top:0;bottom:0;border-radius:5px;background:color-mix(in srgb, ${color} 14%, transparent);border:1px solid color-mix(in srgb, ${color} 45%, transparent);overflow:hidden;box-sizing:border-box;cursor:default;">${bands}${bandNumbers}</div>
                  ${marks}
                </div>
              </div>`;
        }).join('');

        return `<div style="margin-bottom:6px;">
            <div style="font-family:var(--font-display);font-size:7.5px;letter-spacing:1.2px;color:var(--faint);margin-bottom:4px;">${esc(group.title.toUpperCase())}</div>
            ${rows}
          </div>`;
    }).join('');

    // The board's own ruler, aligned to the TRACK column (not the page), so a
    // bar is read against a scale that actually applies to it.
    // Ticks land on WHOLE seconds at a round interval. Dividing the span into a
    // fixed number of parts made every label a rounded lie ("3s" printed at
    // 2.70s) and the run read as a non-uniform scale (0,3,5,8,11,13,16,19,22).
    const step = [1, 2, 5, 10, 15, 30, 60].find(candidate => totalSpan / candidate <= 8) ?? 60;
    const ticks = [];
    for (let at = 0; at <= totalSpan + 1e-9; at += step) {
        const frac = at / totalSpan;
        const align = frac < 0.02 ? 'left:0;text-align:left;'
            : `left:${(frac * 100).toFixed(2)}%;transform:translateX(-50%);`;
        ticks.push(`<span style="position:absolute;${align}top:0;font-family:var(--font-display);font-size:8px;color:var(--faint);">${at}s</span>`);
    }

    return `<div style="display:flex;flex-direction:column;padding-bottom:6px;">
        ${sections}
        <div style="display:flex;gap:8px;">
          <div style="width:${labelWidth}px;flex:none;"></div>
          <div style="position:relative;flex:1;min-width:0;height:11px;border-top:1px solid var(--bd);padding-top:2px;">${ticks.join('')}</div>
        </div>
      </div>`;
}

export const __test__ = { DEFENSIVE_KEYWORDS };

