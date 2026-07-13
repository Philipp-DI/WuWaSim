// src/ui/components/energy-chart.js
/**
 * Interactive Resonance Energy timeline (P13 §12 transparency pass).
 *
 * `memberEnergy`/`concerto` have been computed by the team sim since P13 but
 * never rendered anywhere. This turns the per-member energy trace into an
 * SVG step chart — energy is genuinely discontinuous (flat between casts,
 * a vertical jump at each event), never a smoothed/interpolated curve — with
 * a shared 100%-of-Liberation-cost reference line and a hover-scrub crosshair
 * synced to the team rotation's time axis (the same `t / totalSpan` percentage
 * convention as buff-bar.js and team-editor-v2.js's renderTimelineCard, so it
 * lines up pixel-for-pixel underneath the existing segment rows).
 *
 * Y-axis is normalized to **% of the member's own Liberation cost**, not raw
 * energy — a shared, comparable "how close to ready" signal regardless of
 * each character's absolute cost, and it collapses to a single shared
 * reference line at 100% for every member (one axis, per dataviz's core rule,
 * rather than a separate raw-value axis per member).
 *
 * Pure render (`renderEnergyChart`) + a separate bind step
 * (`bindEnergyChartHover`), matching buff-bar.js's shape. The hover handler
 * mutates the crosshair/readout DOM nodes directly on `mousemove` — it must
 * NOT trigger a host-page repaint (team-editor-v2.js's `paint()` does a full
 * `innerHTML` replace, which would be replaced dozens of times a second).
 */

import { esc } from '../dom.js';

const VB_W = 1000;
const VB_H = 220;
const PAD_L = 6, PAD_R = 6, PAD_T = 14, PAD_B = 14;

// Rounds to a whole percent normally, but falls back to one decimal for a
// genuinely nonzero value that would otherwise round away to "0%" — a real
// 0.3%-of-cost tick should never read the same as "nothing happened".
const fmtPct = (p) => {
    const abs = Math.abs(p);
    if (abs > 0 && abs < 1) return `${p.toFixed(1)}%`;
    return `${Math.round(p)}%`;
};
const fmtE = (v) => {
    const n = v ?? 0;
    if (Math.abs(n) > 0 && Math.abs(n) < 1) return n.toFixed(1);
    return Math.round(n).toLocaleString();
};

// One member's trace re-expressed as % of their own Liberation cost. Members
// with no known cost (not energy-gated, e.g. Hiyuki) have nothing to plot.
function pctTrace(member) {
    const cost = member.liberationCost;
    if (!cost || cost <= 0 || !member.trace?.length) return null;
    return member.trace.map(e => ({
        t: e.t,
        before: (e.energyBefore / cost) * 100,
        after: (e.energyAfter / cost) * 100,
        isLiberation: e.isLiberation === true,
        castable: e.liberationCastable,
        label: e.label,
        own: e.own !== false,
        sourceName: e.sourceName,
    }));
}

// A step's tooltip body. `after === before` happens for real when the gauge
// was already at (or clamped to) the Liberation cost before this cast landed
// — that's honestly "no further gain", not a rounding artifact, so it gets
// its own sentence instead of printing the misleading "+0%".
function stepDeltaDesc(p, liberationCost) {
    const delta = p.after - p.before;
    if (delta === 0) {
        return p.before >= 100
            ? 'gauge already full — no further gain this step'
            : '0 gained this step';
    }
    const rawDelta = (delta / 100) * liberationCost;
    const sign = delta > 0 ? '+' : '';
    return `${sign}${fmtPct(delta)} of cost this step (${sign}${fmtE(rawDelta)})`;
}

function xOf(t, totalSpan) {
    const span = totalSpan > 0 ? totalSpan : 1;
    return PAD_L + Math.max(0, Math.min(1, t / span)) * (VB_W - PAD_L - PAD_R);
}

// A step-after path: flat at the pre-event value up to the event's time, then
// a vertical jump to the post-event value — never interpolated, since nothing
// generates continuously between casts.
function buildStepPath(points, totalSpan, yOf) {
    let d = `M ${xOf(0, totalSpan).toFixed(1)} ${yOf(0).toFixed(1)}`;
    let lastY = 0;
    for (const p of points) {
        const x = xOf(p.t, totalSpan).toFixed(1);
        d += ` L ${x} ${yOf(p.before).toFixed(1)} L ${x} ${yOf(p.after).toFixed(1)}`;
        lastY = p.after;
    }
    d += ` L ${xOf(totalSpan, totalSpan).toFixed(1)} ${yOf(lastY).toFixed(1)}`;
    return d;
}

/**
 * @param {Array<{resonatorId:number, name:string, elementColor:string, liberationCost:number|null, trace:Array}>} members
 *   — one entry per team slot; shape matches simulateTeamRotation's
 *   `memberEnergy` map values plus `name`/`elementColor` for display.
 * @param {number} totalSpan — team rotation seconds (same span renderTimelineCard uses)
 * @returns {string}
 */
export function renderEnergyChart(members, totalSpan) {
    const withPct = (members ?? [])
        .map(m => ({ ...m, pts: pctTrace(m) }))
        .filter(m => m.pts);

    const uncovered = (members ?? []).filter(m => !m.liberationCost);

    if (!withPct.length) {
        return `<div style="padding:14px 18px;font-family:var(--font-body);font-size:11.5px;color:var(--faint);">
            No energy-gated members in this team — nothing to plot.
        </div>`;
    }

    let lo = 0, hi = 100;
    for (const m of withPct) for (const p of m.pts) {
        lo = Math.min(lo, p.before, p.after);
        hi = Math.max(hi, p.before, p.after);
    }
    lo = Math.floor(Math.min(lo, 0) / 10) * 10 - (lo < 0 ? 10 : 0);
    hi = Math.ceil(Math.max(hi, 105) / 10) * 10 + 5;
    const plotH = VB_H - PAD_T - PAD_B;
    const yOf = (pct) => PAD_T + (1 - (pct - lo) / (hi - lo)) * plotH;
    const readyY = yOf(100).toFixed(1);

    // Time-axis ticks — same 5s cadence as renderTimelineCard, for visual continuity.
    const ticks = [];
    for (let t = 0; t <= totalSpan; t += 5) ticks.push(t);

    const lines = withPct.map(m => {
        const d = buildStepPath(m.pts, totalSpan, yOf);
        // Every non-Liberation step gets its own small dot — deliberately
        // smaller than the Liberation marker below so the two read as
        // different kinds of event at a glance — with a hover tooltip naming
        // the ACTUAL cast (never the generic word "step") and, for an
        // off-field member, whose action they're drawing a 50% share from.
        const stepDots = m.pts.filter(p => !p.isLiberation).map(p => {
            const x = xOf(p.t, totalSpan).toFixed(1);
            const y = yOf(p.after).toFixed(1);
            const action = p.label || 'action';
            const title = p.own
                ? `${esc(m.name)} — ${esc(action)}`
                : `${esc(m.name)} – 50% of ${esc(p.sourceName || 'active resonator')}'s ${esc(action)}`;
            return `<circle cx="${x}" cy="${y}" r="2" fill="${m.elementColor}" stroke="var(--card)" stroke-width="1"
                data-tip-title="${title}" data-tip-desc="${esc(stepDeltaDesc(p, m.liberationCost))}"></circle>`;
        }).join('');
        const libMarkers = m.pts.filter(p => p.isLiberation).map(p => {
            const x = xOf(p.t, totalSpan).toFixed(1);
            const y = yOf(p.before).toFixed(1);
            const ok = p.castable === true;
            const fill = p.castable == null ? 'var(--faint)' : (ok ? 'var(--acc)' : 'var(--warn)');
            const status = p.castable == null ? 'castability unknown' : (ok ? 'castable' : 'NOT castable — deficit');
            return `<circle cx="${x}" cy="${y}" r="4.5" fill="${fill}" stroke="var(--card)" stroke-width="2"
                data-tip-title="${esc(m.name)} — ${esc(p.label || 'Liberation cast')}" data-tip-desc="${esc(status)} · ${fmtPct(p.before)} of cost at cast time"></circle>`;
        }).join('');
        return `<path d="${d}" fill="none" stroke="${m.elementColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" data-member="${m.resonatorId}"/>${stepDots}${libMarkers}`;
    }).join('');

    const legend = withPct.length > 1
        ? `<div style="display:flex;gap:14px;flex-wrap:wrap;padding:2px 18px 8px;">
            ${withPct.map(m => `<div style="display:flex;align-items:center;gap:5px;">
                <span style="width:14px;height:2.5px;border-radius:2px;background:${m.elementColor};"></span>
                <span style="font-family:var(--font-display);font-size:9px;color:var(--dim);">${esc(m.name)}</span>
            </div>`).join('')}
           </div>`
        : '';

    const note = uncovered.length
        ? `<div style="padding:2px 18px 8px;font-family:var(--font-body);font-size:9.5px;color:var(--faint);">
            ${uncovered.map(m => esc(m.name)).join(', ')} not energy-gated — no Liberation cost to plot.
           </div>`
        : '';

    return `<div style="position:relative;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 18px 0;">
            <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1.3px;color:var(--faint);">RESONANCE ENERGY · % OF LIBERATION COST</span>
            <span style="font-family:var(--font-display);font-size:8.5px;color:var(--faint);">hover to scrub</span>
        </div>
        ${legend}
        ${note}
        <div data-energy-track style="position:relative;padding:0 18px 12px;cursor:crosshair;">
            <svg viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none" style="width:100%;height:180px;display:block;overflow:visible;">
                ${ticks.map(t => `<line x1="${xOf(t, totalSpan).toFixed(1)}" y1="${PAD_T}" x2="${xOf(t, totalSpan).toFixed(1)}" y2="${VB_H - PAD_B}" stroke="var(--bd)" stroke-width="1"/>`).join('')}
                <line x1="${PAD_L}" y1="${readyY}" x2="${VB_W - PAD_R}" y2="${readyY}" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="5,4"/>
                <text x="${VB_W - PAD_R}" y="${Number(readyY) - 5}" text-anchor="end" font-size="11" fill="var(--gold)" font-family="var(--font-display)">READY (100%)</text>
                ${lines}
                <line data-crosshair-line x1="0" y1="${PAD_T}" x2="0" y2="${VB_H - PAD_B}" stroke="var(--txt)" stroke-width="1" opacity="0" pointer-events="none"/>
            </svg>
            <div data-energy-readout style="position:absolute;top:6px;left:18px;right:18px;pointer-events:none;opacity:0;transition:opacity .08s;
                background:color-mix(in srgb, var(--card) 92%, transparent);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;
                font-family:var(--font-display);font-size:10px;color:var(--dim);display:flex;gap:12px;flex-wrap:wrap;"></div>
        </div>
    </div>`;
}

// Value at an arbitrary time on a member's step trace (last event at/before t;
// 0 before the first event — the gauge starts empty at rotation start).
function valueAt(pts, t) {
    let v = 0;
    for (const p of pts) {
        if (p.t > t) break;
        v = p.after;
    }
    return v;
}

/**
 * Wire the hover-scrub crosshair for every `[data-energy-track]` rendered by
 * `renderEnergyChart`. Delegated on `root` ONCE (survives host repaints,
 * matching every other v2 component's bind pattern) but mutates the crosshair
 * line and readout div directly per event — never calls the host's `paint()`.
 *
 * `getData()` is called fresh on every event (not captured once at bind time)
 * — team-editor-v2.js's `bind()` only runs once per `mount()`, but the sim
 * result (and thus each member's trace) changes on every RUN SIM click, so a
 * value captured at bind time would silently go stale.
 *
 * @param {Element} root
 * @param {Function} on — the host's `on(root, event, selector, handler)` delegator
 * @param {Function} getData — () => ({ members, totalSpan }), called live
 */
export function bindEnergyChartHover(root, on, getData) {
    const update = (track, clientX) => {
        const { members, totalSpan } = getData() ?? {};
        const withPct = (members ?? []).map(m => ({ ...m, pts: pctTrace(m) })).filter(m => m.pts);
        const svg = track.querySelector('svg');
        const readout = track.querySelector('[data-energy-readout]');
        const crosshair = track.querySelector('[data-crosshair-line]');
        if (!svg || !readout || !crosshair || !withPct.length || !totalSpan) return;
        const rect = svg.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const t = frac * totalSpan;
        const x = xOf(t, totalSpan);

        crosshair.setAttribute('x1', x.toFixed(1));
        crosshair.setAttribute('x2', x.toFixed(1));
        crosshair.setAttribute('opacity', '1');

        readout.replaceChildren();
        const timeEl = document.createElement('span');
        timeEl.style.color = 'var(--txt)';
        timeEl.style.fontWeight = '700';
        timeEl.textContent = `t=${t.toFixed(1)}s`;
        readout.appendChild(timeEl);
        for (const m of withPct) {
            const pct = valueAt(m.pts, t);
            const raw = (pct / 100) * m.liberationCost;
            const span = document.createElement('span');
            span.style.color = 'var(--dim)';
            span.textContent = `${m.name}: ${Math.round(pct)}% (${fmtE(raw)}/${fmtE(m.liberationCost)})`;
            readout.appendChild(span);
        }
        readout.style.opacity = '1';
    };

    const hide = (track) => {
        const readout = track.querySelector('[data-energy-readout]');
        const crosshair = track.querySelector('[data-crosshair-line]');
        if (readout) readout.style.opacity = '0';
        if (crosshair) crosshair.setAttribute('opacity', '0');
    };

    on(root, 'mousemove', '[data-energy-track]', (e, track) => update(track, e.clientX));
    // mouseleave doesn't bubble, so delegation can't use it directly (dom.js's
    // `on` is a plain addEventListener + closest() match) — mouseout + a
    // relatedTarget check is the bubbling equivalent, same pattern tooltip.js
    // uses for its own delegated hover.
    on(root, 'mouseout', '[data-energy-track]', (e, track) => {
        if (track.contains(e.relatedTarget)) return;
        hide(track);
    });
}
