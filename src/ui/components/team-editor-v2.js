/**
 * Team Simulator (PARTY) — v2 page. Implements
 * docs/design_handoff_wuwa_sim/team sim. The full per-member-column
 * visualization that replaces the classic flat summary table (team-editor.js,
 * now archived). Shares the v2 sticky header (v2-header.js) and the
 * `.bv2`-scoped design tokens (styles/build-v2.css + styles/team.css).
 *
 *   mount(root, {
 *     dataset, team,
 *     resolveBuild(buildId) -> build|null,
 *     listBuilds() -> [build], listTeams() -> [team],
 *     saveTeam(team) -> team,        // explicit "Save team"
 *     saveBuild(build) -> build,     // persist a member's weapon change
 *     createBuildForResonator(r) -> build (created+saved),
 *     onChangeTeam(team),            // autosave (debounced by caller)
 *     onLoadTeam(teamId),            // navigate to a saved team
 *   }) -> { update(team) }
 *
 * The shared v2 header's nav/theme are bound once by app.js, not here.
 *
 * The engine layer is complete: simulateTeamRotation returns segments,
 * memberTotals, memberSteps, memberBuffWindows and totals. This module is a
 * presentation seam — it maps that result onto the handoff layout. Pure helpers
 * (formatting, donut, segment split, buff fractions) are exported via `__test__`.
 */

import { html, raw, render, on, esc } from '../dom.js';
import * as modal from './modal-picker.js';
import { simulateTeamRotation } from '../../core/team-sim.js';
import { resolveTeamSlots, setTeamSlot, setTeamName, TEAM_SLOTS } from '../../core/team.js';
import { setWeapon } from '../../core/build.js';
import { iconHtml } from '../icons.js';
import { renderV2Header, getV2Theme } from './v2-header.js';
import { formatTipDesc } from '../tip-format.js';

let api = null;

// Element id → { name, hex } using the repo's canonical element palette
// (tokens.css / build page). Per the maintainer: repo element colours win over
// the handoff's. Hex (not CSS var) so we can append an alpha suffix (cc/44/…).
const ELEM = {
    1: { name: 'Glacio',  c: '#5fc0f5' },
    2: { name: 'Fusion',  c: '#e68c66' },
    3: { name: 'Electro', c: '#a765de' },
    4: { name: 'Aero',    c: '#47f4b3' },
    5: { name: 'Spectro', c: '#dad484' },
    6: { name: 'Havoc',   c: '#bf4a92' },
};
const NO_ELEM = { name: '—', c: '#5a6670' };
const elemOf = (id) => ELEM[id] ?? NO_ELEM;

// Damage-category display colours + badges — these are the handoff's
// damage-type palette (mirrors tokens.css --dmg-*). Hex so step bars can append
// an alpha suffix; the donut also uses them as conic-gradient stops.
const DMG_COLOR = {
    basic: '#9ad8ff', heavy: '#ff9c66', skill: '#46d6c6',
    liberation: '#c084fc', echo: '#facc15', intro: '#86efac', outro: '#f9a8d4',
};
const DMG_BADGE = {
    basic: 'BA', heavy: 'HA', skill: 'SK', liberation: 'LB', echo: 'EC', intro: 'IN', outro: 'OU',
};
const BUFF_KIND_COLOR = { sonata: '#facc15', chain: '#c084fc', outro: '#f9a8d4' };

// Member-column icon sizing. Resonator/weapon portraits share ICON_SIZE; the
// damage donut and the element/sonata glyphs are fixed fractions of it.
const ICON_SIZE = 75;
const DONUT_SIZE = Math.round(ICON_SIZE * 2 / 3);
const DONUT_HOLE_RATIO = 0.4;     // ring thickness relative to donut diameter
const DONUT_HOLE = Math.round(DONUT_SIZE * DONUT_HOLE_RATIO);
const DONUT_HOLE_OFF = Math.round((DONUT_SIZE - DONUT_HOLE) / 2);
const BADGE_ICON_SIZE = Math.round(ICON_SIZE * 0.3);

// ── Pure formatting / shaping helpers (exported for tests) ──────────────────

function fmtDmg(n) {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(Math.round(n));
}
function fmtDps(n) {
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K/s';
    return Math.round(n) + '/s';
}
const fmtDur = (s) => (Number.isFinite(s) ? s.toFixed(1) + 's' : '—');

// conic-gradient string for the per-member damage donut, segments grouped by
// damageCategory. Returns a neutral ring when there's no damage.
function donutGradient(steps) {
    const cats = {};
    for (const s of steps ?? []) {
        if ((s.stepDamage ?? 0) > 0) cats[s.damageCategory] = (cats[s.damageCategory] ?? 0) + s.stepDamage;
    }
    const total = Object.values(cats).reduce((a, b) => a + b, 0);
    if (!total) return 'conic-gradient(var(--nodebd) 0deg 360deg)';
    let angle = 0;
    const parts = Object.entries(cats).map(([cat, dmg]) => {
        const start = angle;
        angle += dmg / total * 360;
        return `${DMG_COLOR[cat] ?? '#888'} ${start.toFixed(1)}deg ${angle.toFixed(1)}deg`;
    });
    return `conic-gradient(${parts.join(', ')})`;
}

// Hover-title text for the donut: damage-category breakdown, largest first.
// Replaces the donut's old centered "S{n}" label — the info now surfaces on
// hover instead of taking up permanent space in the hole.
function donutTitle(steps) {
    const cats = {};
    for (const s of steps ?? []) {
        if ((s.stepDamage ?? 0) > 0) cats[s.damageCategory] = (cats[s.damageCategory] ?? 0) + s.stepDamage;
    }
    const total = Object.values(cats).reduce((a, b) => a + b, 0);
    if (!total) return 'No damage yet';
    return Object.entries(cats)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, dmg]) => `${cat.charAt(0).toUpperCase()}${cat.slice(1)}: ${fmtDmg(dmg)} (${Math.round(dmg / total * 100)}%)`)
        .join('\n');
}

// Group sim segments by slotIndex, splitting each member's steps into the
// intro group vs. the rotation group (the handoff renders two step groups).
function segmentsBySlot(segments) {
    const m = new Map();
    for (const seg of segments ?? []) {
        let e = m.get(seg.slotIndex);
        if (!e) { e = { introSteps: [], rotSteps: [], segs: [] }; m.set(seg.slotIndex, e); }
        e.segs.push(seg);
        if (seg.kind === 'intro') e.introSteps.push(...(seg.steps ?? []));
        else if (seg.kind === 'rotation') e.rotSteps.push(...(seg.steps ?? []));
    }
    return m;
}

// [min start, max end] across a member's steps (team-rotation time).
function memberTimeSpan(steps) {
    if (!steps?.length) return null;
    let start = Infinity, end = -Infinity;
    for (const s of steps) {
        if (s.startTime < start) start = s.startTime;
        if (s.endTime > end) end = s.endTime;
    }
    return Number.isFinite(start) ? { start, end } : null;
}

// Buff strip [startFrac, endFrac] within the member's own window (clamped).
function buffFracs(w, span) {
    if (!span || span.end <= span.start) return { startFrac: 0, endFrac: 0 };
    const dur = span.end - span.start;
    const sf = Math.max(0, Math.min(1, (w.startTime - span.start) / dur));
    const ef = Math.max(0, Math.min(1, (w.endTime - span.start) / dur));
    return { startFrac: sf, endFrac: Math.max(sf, ef) };
}

// The engine's buff windows carry only a name (no kind), so colour-code by a
// light heuristic over the name: outro buffs, sequence/chain effects, else
// treat as a sonata set bonus.
function buffKindFor(name) {
    const n = String(name ?? '').toLowerCase();
    if (n.includes('outro')) return 'outro';
    if (/\bs[1-6]\b/.test(n) || n.includes('sequence') || n.includes('chain')) return 'chain';
    return 'sonata';
}

// Segment colour on the shared timeline — element-tinted, opacity by kind.
function segColor(kind, elHex) {
    if (kind === 'rotation') return elHex + 'cc';
    if (kind === 'intro') return '#86efac88';
    if (kind === 'outro') return '#f9a8d460';
    return elHex + '44'; // offField
}

// ── Data lookups (touch api/dataset) ────────────────────────────────────────

function resonatorOf(build) { return api.dataset.resonators.find(r => r.id === build.resonatorId) ?? null; }
function weaponOf(build) { return build?.weapon ? api.dataset.weapons.find(w => w.id === build.weapon.id) ?? null : null; }
function dominantSonata(build) {
    const counts = new Map();
    for (const e of build?.echoes ?? []) if (e?.sonataId != null) counts.set(e.sonataId, (counts.get(e.sonataId) ?? 0) + 1);
    let best = null, bestC = 0;
    for (const [id, c] of counts) if (c > bestC) { best = id; bestC = c; }
    return best != null ? api.dataset.sonatas.find(s => s.id === best) ?? null : null;
}

// Set-bonus text for the sonata hover-box — every tier the set defines.
function sonataTooltipDesc(so) {
    if (!so?.tiers?.length) return '';
    return so.tiers
        .slice()
        .sort((a, b) => a.pieces - b.pieces)
        .filter(t => t.effect)
        .map(t => `${t.pieces}PC — ${t.effect}`)
        .join('\n');
}

// Hover-box tooltip (same body-appended `.bv2-tooltip` pattern as the build
// page — element/sonata badges are icon-only here for space, so their name
// (+ sonata set-bonus text) lives in this hover-box instead).
function ensureTooltipEl() {
    if (api.tooltipEl) return api.tooltipEl;
    const el = document.createElement('div');
    el.className = 'bv2-tooltip';
    document.body.appendChild(el);
    api.tooltipEl = el;
    return el;
}
function showTooltip(targetEl, title, desc) {
    const el = ensureTooltipEl();
    const r = targetEl.getBoundingClientRect();
    el.innerHTML = `<div class="bv2-tooltip__title">${esc(title)}</div>` + (desc ? `<div class="bv2-tooltip__desc">${formatTipDesc(esc(desc))}</div>` : '');
    el.classList.add('is-open');
    const margin = 12;
    const overflowsRight = r.left + el.offsetWidth > window.innerWidth - margin;
    el.style.left = Math.round(overflowsRight ? Math.max(margin, r.right - el.offsetWidth) : r.left) + 'px';
    el.style.top = Math.round(r.bottom + 8) + 'px';
}
function hideTooltip() {
    api.tooltipEl?.classList.remove('is-open');
}

// Run the team sim for the current team + pass count. Returns null when no
// member is occupied, or { empty:'no-rotation', occupied } when members exist
// but none has a rotation yet.
function runSim() {
    const slots = resolveTeamSlots(api.team, api.resolveBuild).filter(s => s.build);
    if (!slots.length) return null;
    const hasRotations = slots.some(s => (s.build.rotation?.length ?? 0) > 0);
    if (!hasRotations) return { empty: 'no-rotation', occupied: slots.length };
    const target = { level: 90, atkLv: 90, resistances: { 0: 0, 1: 0.1, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 } };
    return simulateTeamRotation({
        team: api.team, resolveBuild: api.resolveBuild, dataset: api.dataset, target, passCount: api.passCount,
    });
}

// =============================================================================
// Render
// =============================================================================

function paint() {
    hideTooltip();
    api.result = runSim();
    api.segBySlot = api.result && !api.result.empty ? segmentsBySlot(api.result.segments) : new Map();
    render(api.root, renderPage());
}

function renderPage() {
    return html`
        <div class="bv2 bv2-party" data-theme="${api.theme}">
            ${raw(renderV2Header({ active: 'party', theme: api.theme }))}
            <div style="max-width:1240px;margin:0 auto;padding:28px 24px 40px;display:flex;flex-direction:column;gap:16px;">
                ${raw(renderTitleRow())}
                ${raw(renderTotalsBanner())}
                ${raw(renderTimelineCard())}
                ${raw(renderMemberGrid())}
            </div>
            ${raw(renderToast())}
        </div>
    `;
}

function renderToast() {
    if (!api.toast) return '';
    return `
      <div class="bv2-party-toast" style="position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:50;display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;background:var(--card2);border:1px solid var(--acc);box-shadow:0 10px 30px -10px rgba(0,0,0,.6);">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--acc);box-shadow:0 0 8px var(--acc);flex:none;"></span>
        <span style="font-family:'Chakra Petch',sans-serif;font-size:11.5px;letter-spacing:.4px;color:var(--txt);">${esc(api.toast)}</span>
      </div>`;
}

function renderTitleRow() {
    const ghostBtn = "font-family:'Chakra Petch',sans-serif;font-weight:600;font-size:9.5px;letter-spacing:.7px;color:var(--dim);background:var(--inp);border:1px solid var(--bd);border-radius:8px;padding:6px 13px;cursor:pointer;";
    const passChips = [1, 2, 3].map(n => {
        const on = api.passCount === n;
        return `<button data-act="pass" data-n="${n}" style="font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:11px;padding:5px 12px;border-radius:7px;cursor:pointer;border:1px solid ${on ? 'var(--acc)' : 'var(--bd)'};background:${on ? 'rgba(70,214,198,.14)' : 'var(--inp)'};color:${on ? 'var(--acc)' : 'var(--dim)'};">${n}</button>`;
    }).join('');
    return `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="width:4px;height:22px;background:var(--acc);border-radius:3px;box-shadow:0 0 10px var(--acc);flex:none;"></div>
        <span style="font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:16px;letter-spacing:2px;color:var(--txt);">TEAM SIMULATION</span>
        <span style="font-family:'Manrope',sans-serif;font-size:11px;color:var(--faint);">${esc(api.team?.name ?? '')}</span>
        <div style="flex:1;height:1px;background:var(--bd);margin:0 4px;min-width:20px;"></div>
        <button data-act="save-team" style="${ghostBtn}">SAVE TEAM</button>
        <button data-act="load-team" style="${ghostBtn}">LOAD TEAM</button>
        <span style="width:1px;height:20px;background:var(--bd);flex:none;"></span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-family:'Chakra Petch',sans-serif;font-size:8.5px;letter-spacing:1.3px;color:var(--faint);">PASSES</span>
          <div style="display:flex;gap:3px;">${passChips}</div>
        </div>
        <button data-act="run-sim" style="font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:11px;letter-spacing:.8px;padding:7px 16px;border-radius:9px;cursor:pointer;background:var(--acc);border:none;color:#06201d;box-shadow:0 1px 10px rgba(70,214,198,.35);">▶ RUN SIM</button>
      </div>`;
}

function renderTotalsBanner() {
    const r = api.result;
    const totals = r && !r.empty ? r.totals : null;

    const mkChip = (label, value, valColor) =>
        `<div style="display:flex;flex-direction:column;gap:1px;">
           <span style="font-family:'Chakra Petch',sans-serif;font-size:7.5px;letter-spacing:1px;color:var(--faint);">${label}</span>
           <span style="font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:20px;color:${valColor};">${esc(value)}</span>
         </div>`;
    const chips = [
        mkChip('TEAM DPS', totals ? fmtDps(totals.dps) : '—', 'var(--acc)'),
        mkChip('TOTAL DMG', totals ? fmtDmg(totals.damage) : '—', 'var(--txt)'),
        mkChip('DURATION', totals ? fmtDur(totals.time) : '—', 'var(--txt)'),
    ].join('');

    // Damage share — one segment per occupied member, element-coloured.
    let shareBar = '', legend = '';
    if (totals && totals.damage > 0) {
        const rows = r.memberTotals.filter(m => m.damage > 0).map(m => {
            const reso = api.dataset.resonators.find(x => x.id === m.resonatorId);
            const el = elemOf(reso?.element);
            const pct = m.damage / totals.damage * 100;
            return { name: reso?.name ?? '?', el, pct };
        });
        shareBar = rows.map(x =>
            `<div style="flex:${x.pct.toFixed(1)};background:${x.el.c};" title="${esc(x.name)}: ${x.pct.toFixed(1)}% · ${esc(fmtDmg(x.pct / 100 * totals.damage))}"></div>`).join('');
        legend = rows.map(x =>
            `<div style="display:flex;align-items:center;gap:4px;">
               <span style="width:7px;height:7px;border-radius:50%;background:${x.el.c};flex:none;"></span>
               <span style="font-family:'Chakra Petch',sans-serif;font-size:8.5px;color:var(--dim);">${esc(x.name)}</span>
               <span style="font-family:'Chakra Petch',sans-serif;font-size:8.5px;font-weight:700;color:var(--txt);">${x.pct.toFixed(0)}%</span>
             </div>`).join('');
    }

    const shareBlock = shareBar
        ? `<div style="flex:1;min-width:180px;max-width:360px;">
             <div style="font-family:'Chakra Petch',sans-serif;font-size:7.5px;letter-spacing:1px;color:var(--faint);margin-bottom:6px;">DAMAGE SHARE</div>
             <div style="display:flex;height:7px;border-radius:4px;overflow:hidden;gap:1px;">${shareBar}</div>
             <div style="display:flex;gap:12px;margin-top:6px;flex-wrap:wrap;">${legend}</div>
           </div>`
        : '';

    return `
      <div style="position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--bd);border-radius:14px;overflow:hidden;">
        <span style="position:absolute;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,var(--acc),transparent);opacity:.8;"></span>
        <div style="display:flex;align-items:center;gap:20px;padding:12px 18px;flex-wrap:wrap;">
          <div style="display:flex;gap:24px;flex-wrap:wrap;">${chips}</div>
          ${shareBlock}
        </div>
      </div>`;
}

function renderTimelineCard() {
    const r = api.result;
    const occupied = resolveTeamSlots(api.team, api.resolveBuild).filter(s => s.build);
    const hasData = r && !r.empty && r.totals.time > 0;
    const totalTime = hasData ? r.totals.time : 0;

    let body;
    if (!occupied.length) {
        body = `<div style="padding:6px 2px;font-family:'Manrope',sans-serif;font-size:12px;color:var(--faint);">Add resonators below to build a team.</div>`;
    } else if (!hasData) {
        body = `<div style="padding:6px 2px;font-family:'Manrope',sans-serif;font-size:12px;color:var(--faint);">Give each member a rotation (in their Build page) to see the team timeline and DPS.</div>`;
    } else {
        const tickCount = Math.ceil(totalTime / 5);
        const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * 5).filter(t => t <= totalTime + 0.1).map(t =>
            `<span style="position:absolute;left:${(t / totalTime * 100).toFixed(2)}%;font-family:'Chakra Petch',sans-serif;font-size:8px;color:var(--faint);">${t.toFixed(0)}s</span>`).join('');

        const rows = occupied.map(slot => {
            const reso = resonatorOf(slot.build);
            const el = elemOf(reso?.element);
            const segs = (api.segBySlot.get(slot.slotIndex)?.segs ?? []).map(seg => {
                const left = (seg.startTime / totalTime * 100).toFixed(2);
                const width = Math.max(0.4, (seg.endTime - seg.startTime) / totalTime * 100).toFixed(2);
                const title = `${reso?.name ?? '?'} · ${seg.kind} · ${seg.startTime.toFixed(1)}–${seg.endTime.toFixed(1)}s${seg.damage > 0 ? ' · ' + fmtDmg(seg.damage) : ''}`;
                return `<div style="position:absolute;top:0;height:100%;left:${left}%;width:${width}%;background:${segColor(seg.kind, el.c)};border-radius:3px;" title="${esc(title)}"></div>`;
            }).join('');
            return `
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:62px;flex:none;display:flex;align-items:center;gap:5px;">
                  <span style="width:8px;height:8px;border-radius:50%;background:${el.c};flex:none;"></span>
                  <span style="font-family:'Chakra Petch',sans-serif;font-size:10px;font-weight:600;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;">${esc(reso?.name ?? '?')}</span>
                </div>
                <div style="flex:1;position:relative;height:22px;background:var(--node);border-radius:4px;overflow:hidden;">${segs}</div>
              </div>`;
        }).join('');

        const legend = [['ROTATION', '#dad484cc'], ['INTRO', '#86efac88'], ['OUTRO', '#f9a8d460']].map(([label, c]) =>
            `<div style="display:flex;align-items:center;gap:5px;">
               <span style="width:18px;height:7px;border-radius:2px;background:${c};"></span>
               <span style="font-family:'Chakra Petch',sans-serif;font-size:8px;letter-spacing:.6px;color:var(--faint);">${label}</span>
             </div>`).join('');

        body = `
          <div style="position:relative;height:14px;margin-left:72px;margin-bottom:6px;">${ticks}</div>
          <div style="display:flex;flex-direction:column;gap:9px;">${rows}</div>
          <div style="display:flex;align-items:center;gap:14px;margin-top:12px;padding-top:10px;border-top:1px solid var(--bd);flex-wrap:wrap;">${legend}</div>`;
    }

    const durStr = hasData ? `${fmtDur(totalTime)} · ${occupied.length} members · ${api.passCount} pass${api.passCount === 1 ? '' : 'es'}` : '';
    return `
      <div style="position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -16px rgba(0,0,0,.5);">
        <span style="position:absolute;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,var(--acc),transparent);opacity:.7;"></span>
        <div style="display:flex;align-items:center;gap:10px;padding:13px 18px 11px;border-bottom:1px solid var(--bd);">
          <span style="width:8px;height:18px;border-radius:3px;background:var(--acc);box-shadow:0 0 8px var(--acc);flex:none;"></span>
          <span style="font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:13px;letter-spacing:1.5px;color:var(--txt);">FULL ROTATION TIMELINE</span>
          <span style="font-family:'Manrope',sans-serif;font-size:11px;color:var(--faint);">${esc(durStr)}</span>
        </div>
        <div style="padding:14px 18px 16px;">${body}</div>
      </div>`;
}

// Empty-slot placeholder column (handoff leaves this to implementation).
function renderEmptySlotCard(slotIndex) {
    return `
      <div style="position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:1.5px dashed var(--bd2);border-radius:16px;min-height:220px;display:flex;align-items:center;justify-content:center;">
        <button data-act="pick-reso" data-slot="${slotIndex}" style="display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;background:transparent;border:none;color:var(--faint);padding:24px;">
          <span style="font-size:34px;font-weight:300;line-height:1;color:var(--faint);">+</span>
          <span style="font-family:'Chakra Petch',sans-serif;font-size:10px;letter-spacing:1px;">ADD RESONATOR · SLOT ${slotIndex + 1}</span>
        </button>
      </div>`;
}

function renderStepBar(step, maxDmg) {
    const c = DMG_COLOR[step.damageCategory] ?? '#888';
    const h = Math.max(18, Math.round((step.stepDamage ?? 0) / maxDmg * 68));
    const buffs = (step.activeBuffNames ?? []).length ? ` · buffs: ${(step.activeBuffNames).join(', ')}` : '';
    const title = `${step.label} · ${DMG_BADGE[step.damageCategory] ?? '??'} · ${fmtDmg(step.stepDamage ?? 0)}${buffs}`;
    return `
      <div style="height:${h}px;background:${c}1a;border-left:3px solid ${c};border-radius:5px;display:flex;align-items:center;padding:0 8px 0 10px;gap:6px;" title="${esc(title)}">
        <span style="flex:none;font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:7px;letter-spacing:.3px;padding:2px 5px;border-radius:3px;background:${c}28;color:${c};">${DMG_BADGE[step.damageCategory] ?? '??'}</span>
        <span style="flex:1;min-width:0;font-family:'Chakra Petch',sans-serif;font-size:10px;font-weight:600;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(step.label)}</span>
        <span style="flex:none;font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:10px;color:${c};min-width:34px;text-align:right;">${esc(fmtDmg(step.stepDamage ?? 0))}</span>
      </div>`;
}

// Intro/Outro casts (handled exclusively by the team sim's auto-injected
// segments — see AUTO_CAST_SKILL_TYPES in team-sim.js) are folded into the
// same list as the member's own rotation steps. There is no separate
// "INTRO" group: a swap-in cast is just the first entry here, distinguished
// by its own damage-category badge/colour like any other step.
function renderStepGroups(slotIndex, introSteps, rotSteps) {
    const allSteps = [...introSteps, ...rotSteps];
    const maxDmg = Math.max(1, ...allSteps.map(s => s.stepDamage ?? 0));
    const grpHdr = 'display:flex;align-items:center;gap:6px;padding:9px 15px 7px;border-top:1px solid var(--bd);';
    const lblBase = "font-family:'Chakra Petch',sans-serif;font-size:8px;letter-spacing:1.2px;color:var(--faint);";

    const key = `${slotIndex}_rot`;
    const defaultExp = allSteps.length <= 6;
    const expanded = api.expandedGroups[key] ?? defaultExp;
    const countStyle = "font-family:'Chakra Petch',sans-serif;font-size:7.5px;font-weight:700;padding:1px 6px;border-radius:4px;background:var(--node);border:1px solid var(--bd);color:var(--dim);";
    let out = `<div style="${grpHdr}">
        <span style="${lblBase}">ROTATION</span>
        <span style="${countStyle}">${allSteps.length}</span>
        <div style="flex:1;"></div>
        <button data-act="toggle-group" data-slot="${slotIndex}" data-key="rot" style="background:transparent;border:none;color:var(--faint);cursor:pointer;font-size:10px;padding:2px 5px;line-height:1;">${expanded ? '▴' : '▾'}</button>
      </div>`;
    if (expanded) {
        out += allSteps.length
            ? `<div style="padding:0 15px 10px;display:flex;flex-direction:column;gap:3px;">${allSteps.map(s => renderStepBar(s, maxDmg)).join('')}</div>`
            : `<div style="padding:0 15px 10px;font-family:'Manrope',sans-serif;font-size:10px;color:var(--faint);">No rotation set for this member.</div>`;
    }
    return out;
}

function renderBuffBar(slotIndex, buffWindows, span, elHex) {
    const windows = (buffWindows ?? []).filter(w => span && w.endTime > w.startTime);
    let body;
    if (!windows.length) {
        body = `<span style="font-family:'Manrope',sans-serif;font-size:10px;color:var(--faint);">No conditional buffs active.</span>`;
    } else {
        const strips = windows.map((w, i) => {
            const { startFrac, endFrac } = buffFracs(w, span);
            const c = BUFF_KIND_COLOR[buffKindFor(w.name)] ?? elHex;
            return `<div title="${esc(w.name)}" style="position:absolute;top:${i * 24}px;left:${(startFrac * 100).toFixed(1)}%;width:${Math.max(2, (endFrac - startFrac) * 100).toFixed(1)}%;height:20px;border-left:2px solid ${c};background:${c}1a;border-radius:3px;display:flex;align-items:center;padding:0 6px;overflow:hidden;">
              <span style="font-family:'Chakra Petch',sans-serif;font-size:7.5px;letter-spacing:.3px;color:${c};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(w.name)}</span>
            </div>`;
        }).join('');
        body = `<div style="position:relative;height:${Math.max(20, windows.length * 24)}px;">${strips}</div>`;
    }
    return `<div style="border-top:1px solid var(--bd);padding:10px 15px 13px;">
        <span style="font-family:'Chakra Petch',sans-serif;font-size:8px;letter-spacing:1.3px;color:var(--faint);display:block;margin-bottom:8px;">ACTIVE BUFFS</span>
        ${body}
      </div>`;
}

function renderMemberColumn(slot) {
    const build = slot.build;
    const reso = resonatorOf(build);
    const el = elemOf(reso?.element);
    const wpn = weaponOf(build);
    const so = dominantSonata(build);
    const slotIndex = slot.slotIndex;

    const split = api.segBySlot.get(slotIndex);
    const introSteps = split?.introSteps ?? [];
    const rotSteps = split?.rotSteps ?? [];
    const allSteps = [...introSteps, ...rotSteps];
    const total = (api.result && !api.result.empty)
        ? api.result.memberTotals.find(m => m.slotIndex === slotIndex) ?? null : null;
    const buffWindows = (api.result && !api.result.empty)
        ? api.result.memberBuffWindows.get(build.resonatorId) ?? [] : [];
    const span = memberTimeSpan(allSteps);
    const teamDmg = (api.result && !api.result.empty) ? api.result.totals.damage : 0;
    const sharePct = total && teamDmg > 0 ? (total.damage / teamDmg * 100) : null;
    const dps = total && total.time > 0 ? total.damage / total.time : 0;

    // Header pieces ----------------------------------------------------------
    const resoIcon = `
      <button data-act="pick-reso" data-slot="${slotIndex}" title="Change resonator"
              style="position:relative;width:${ICON_SIZE}px;height:${ICON_SIZE}px;flex:none;border-radius:10px;border:1px solid var(--bd2);cursor:pointer;padding:0;overflow:hidden;background:${reso?.iconUrl ? 'var(--node)' : 'repeating-linear-gradient(135deg,rgba(120,205,215,.09) 0 4px,transparent 4px 8px)'};">
        ${reso?.iconUrl ? `<img src="${esc(reso.iconUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : ''}
        <span style="position:absolute;bottom:0;left:0;right:0;text-align:center;font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:7px;color:var(--faint);background:linear-gradient(transparent,rgba(4,7,10,.7));padding-top:6px;padding-bottom:1px;">Lv.${build.level}</span>
      </button>`;

    const shareBadge = sharePct != null
        ? `<div style="font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:11px;color:${el.c};padding:2px 6px;flex:none;white-space:nowrap;">${sharePct.toFixed(0)}%</div>`
        : '';

    const donut = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:none;">
        <div style="position:relative;width:${DONUT_SIZE}px;height:${DONUT_SIZE}px;" title="${esc(donutTitle(allSteps))}">
          <div style="width:${DONUT_SIZE}px;height:${DONUT_SIZE}px;border-radius:50%;background:${donutGradient(allSteps)};"></div>
          <div style="position:absolute;top:${DONUT_HOLE_OFF}px;left:${DONUT_HOLE_OFF}px;width:${DONUT_HOLE}px;height:${DONUT_HOLE}px;border-radius:50%;background:var(--card);"></div>
        </div>
        ${shareBadge}
      </div>`;

    // Icon-only — no room for both icon + label next to each other, so the
    // name (element) / name + set-bonus text (sonata) move into the shared
    // hover-box on hover instead.
    const elemBadge = `
      <span data-tip-title="${esc(el.name)}" style="display:inline-flex;align-items:center;justify-content:center;cursor:default;">
        ${iconHtml('element', reso?.element, { label: el.name, size: BADGE_ICON_SIZE })}
      </span>`;

    const sonataBadge = so
        ? `<span data-tip-title="${esc(so.name)}" data-tip-desc="${esc(sonataTooltipDesc(so))}" style="display:inline-flex;align-items:center;justify-content:center;cursor:default;">
             ${iconHtml('sonata', so.name, { label: so.name, size: BADGE_ICON_SIZE })}
           </span>`
        : '';

    const weapIcon = `
      <button data-act="pick-weapon" data-slot="${slotIndex}" title="Change weapon"
              style="position:relative;width:${ICON_SIZE}px;height:${ICON_SIZE}px;flex:none;border-radius:10px;border:1px solid rgba(233,185,74,.28);cursor:pointer;padding:0;overflow:hidden;background:${wpn?.iconUrl ? 'var(--node)' : 'repeating-linear-gradient(135deg,rgba(233,185,74,.1) 0 4px,transparent 4px 8px)'};">
        ${wpn?.iconUrl ? `<img src="${esc(wpn.iconUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : ''}
        <span style="position:absolute;bottom:0;left:0;right:0;text-align:center;font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:7px;color:var(--dim);background:linear-gradient(transparent,rgba(4,7,10,.7));padding-top:6px;padding-bottom:1px;">${build.weapon ? 'Lv.' + (build.weapon.level ?? 1) : '—'}</span>
      </button>`;

    // Build Name floats inside the icon row itself, flush with its bottom
    // edge — not a row of its own. Inset past the donut (left) and weapon
    // icon (right) so the centred text clips via ellipsis instead of ever
    // bleeding visually into either icon cluster.
    const buildNameLeftInset = ICON_SIZE + DONUT_SIZE + 18;
    const buildNameRightInset = ICON_SIZE + 8;

    const header = `
      <div style="padding:13px 14px 9px;border-bottom:1px solid var(--bd);">
        <div style="position:relative;display:flex;align-items:flex-start;gap:8px;">
          ${resoIcon}${donut}
          <div style="flex:1;min-width:0;">
            <span style="display:block;font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:14px;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(reso?.name ?? '—')}</span>
            <div style="display:flex;align-items:center;gap:6px;margin-top:5px;">
              ${elemBadge}${sonataBadge}
            </div>
          </div>
          <div style="display:flex;flex-direction:row;align-items:center;gap:6px;flex:none;">
            ${weapIcon}
          </div>
          <div style="position:absolute;left:${buildNameLeftInset}px;right:${buildNameRightInset}px;bottom:0;text-align:left;font-family:'Chakra Petch',sans-serif;font-size:9.5px;font-weight:600;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;">${esc(build.name || (so ? so.name : '—'))}</div>
        </div>
      </div>`;

    // Member totals ----------------------------------------------------------
    const healStyle = total && total.heal > 0 ? '#86efac' : 'var(--faint)';
    const totalsRow = `
      <div style="border-top:1px solid var(--bd);background:var(--node);padding:11px 15px 13px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <div><div style="font-family:'Chakra Petch',sans-serif;font-size:7.5px;letter-spacing:1px;color:var(--faint);margin-bottom:2px;">TOTAL DMG</div>
          <div style="font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:14px;color:${el.c};">${esc(total ? fmtDmg(total.damage) : '—')}</div></div>
        <div><div style="font-family:'Chakra Petch',sans-serif;font-size:7.5px;letter-spacing:1px;color:var(--faint);margin-bottom:2px;">DPS</div>
          <div style="font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:14px;color:var(--txt);">${esc(total ? fmtDps(dps) : '—')}</div></div>
        <div><div style="font-family:'Chakra Petch',sans-serif;font-size:7.5px;letter-spacing:1px;color:var(--faint);margin-bottom:2px;">HEAL</div>
          <div style="font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:14px;color:${healStyle};">${esc(total && total.heal > 0 ? fmtDmg(total.heal) : '—')}</div></div>
      </div>`;

    return `
      <div style="position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -16px rgba(0,0,0,.5);">
        <span style="position:absolute;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,${el.c},transparent);z-index:1;"></span>
        ${header}
        ${renderStepGroups(slotIndex, introSteps, rotSteps)}
        ${renderBuffBar(slotIndex, buffWindows, span, el.c)}
        ${totalsRow}
      </div>`;
}

function renderMemberGrid() {
    const slots = resolveTeamSlots(api.team, api.resolveBuild);
    const cols = slots.map(s => s.build ? renderMemberColumn(s) : renderEmptySlotCard(s.slotIndex)).join('');
    return `<div class="bv2-party-grid" style="display:grid;grid-template-columns:repeat(${TEAM_SLOTS},1fr);gap:14px;align-items:start;">${cols}</div>`;
}

// =============================================================================
// Pickers
// =============================================================================

function pickerRow(it) {
    const r = it.resonator;
    const elColor = elemOf(r?.element).c;
    const icon = r?.iconUrl
        ? `<img class="option__icon" src="${esc(r.iconUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<span class="option__icon option__icon--missing"></span>`;
    const sub = it.kind === 'build' ? `Saved build · Lv ${it.build.level}` : 'Roster · new build';
    const badge = it.kind === 'build' ? 'B' : 'R';
    return `${icon}
      <div class="option__body" style="--el-color:${esc(elColor)}">
        <span class="option__name">${esc(it.name)}</span>
        <span class="option__sub">${esc(sub)}</span>
      </div>
      <span class="option__badge">${badge}</span>`;
}

function openSlotPicker(slotIndex) {
    const builds = api.listBuilds();
    const usedIds = new Set(api.team.slots.filter(Boolean));
    const currentId = api.team.slots[slotIndex];
    const availableBuilds = builds.filter(b => !usedIds.has(b.id) || b.id === currentId);

    const buildItems = availableBuilds.map(b => {
        const r = api.dataset.resonators.find(x => x.id === b.resonatorId);
        return { kind: 'build', build: b, resonator: r, name: b.name, resoName: r?.name ?? '' };
    });
    const rosterItems = api.dataset.resonators.map(r => ({ kind: 'roster', resonator: r, name: r.name, resoName: r.name }));

    modal.open({
        title: `Slot ${slotIndex + 1}`,
        items: [...buildItems, ...rosterItems],
        searchFields: ['name', 'resoName'],
        allowUnequip: !!currentId,
        filters: [{
            kind: 'source', label: 'Source',
            options: [
                { value: 'build', label: 'Saved builds', test: (it) => it.kind === 'build' },
                { value: 'roster', label: 'Roster', test: (it) => it.kind === 'roster' },
            ],
        }],
        renderRow: pickerRow,
        onPick: (it) => {
            if (it == null) {
                api.team = setTeamSlot(api.team, slotIndex, null);
            } else {
                const buildId = it.kind === 'build' ? it.build.id : api.createBuildForResonator(it.resonator).id;
                api.team = setTeamSlot(api.team, slotIndex, buildId);
            }
            api.onChangeTeam?.(api.team);
            paint();
        },
    });
}

function openWeaponPickerForSlot(slotIndex) {
    const build = api.resolveBuild(api.team.slots[slotIndex]);
    if (!build) return;
    const reso = resonatorOf(build);
    if (!reso) return;
    const weapons = api.dataset.weapons
        .filter(w => w.type === reso.weaponType)
        .sort((a, b) => (b.rarity - a.rarity) || a.name.localeCompare(b.name));
    modal.open({
        title: `Choose a ${reso.weaponTypeName}`,
        items: weapons,
        searchFields: ['name'],
        allowUnequip: !!build.weapon,
        renderRow: (w) => `<div class="option__body"><span class="option__name">${esc(w.name)}</span>
            <span class="option__sub">${'★'.repeat(w.rarity)} · ${esc(w.typeName ?? reso.weaponTypeName)}</span></div>`,
        onPick: (w) => {
            const next = setWeapon(build, w ? w.id : null);
            api.saveBuild?.(next);
            paint();
        },
    });
}

function openLoadTeamPicker() {
    const teams = (api.listTeams?.() ?? []).filter(t => t.id !== api.team?.id);
    if (!teams.length) { alert('No other saved teams to load.'); return; }
    modal.open({
        title: 'Load team',
        items: teams,
        searchFields: ['name'],
        renderRow: (t) => {
            const members = t.slots.filter(Boolean).length;
            return `<div class="option__body"><span class="option__name">${esc(t.name)}</span>
                <span class="option__sub">${members}/${TEAM_SLOTS} members</span></div>`;
        },
        onPick: (t) => { if (t) api.onLoadTeam?.(t.id); },
    });
}

// Suggests a name from the occupied members, e.g. "Aemeath / Changli / Verina".
function autoTeamName(team) {
    const names = team.slots
        .map(id => (id ? api.resolveBuild(id) : null))
        .filter(Boolean)
        .map(b => resonatorOf(b)?.name)
        .filter(Boolean);
    return names.length ? names.join(' / ') : 'New Team';
}

// Only prompt for a name the first time a team is saved (still carrying the
// createTeam() default) — suggesting an auto-generated, fitting name rather
// than a blank/generic one. Re-saving an already-named team just persists +
// confirms, no repeated prompting.
function saveTeamFlow() {
    if (String(api.team?.name ?? '').trim() === 'New Team') {
        const suggested = autoTeamName(api.team);
        const name = prompt('Save team as:', suggested);
        if (name == null) return;
        api.team = setTeamName(api.team, name.trim() || suggested);
    }
    api.saveTeam?.(api.team);
    api.onChangeTeam?.(api.team);
    showToast(`Saved “${api.team.name}”`);
}

function showToast(msg) {
    api.toast = msg;
    clearTimeout(api.toastTimer);
    api.toastTimer = setTimeout(() => { api.toast = null; paint(); }, 2200);
    paint();
}

// =============================================================================
// Events
// =============================================================================

function bind() {
    const root = api.root;
    // The shared header's nav/theme controls are bound once by app.js (on the
    // persistent #main root). This page only binds its own page-specific
    // controls, guarded by __partyBound in mount() against re-mount restacking.
    on(root, 'click', '[data-act="pass"]', (_e, el) => {
        api.passCount = Math.max(1, Math.min(3, Number(el.dataset.n) || 1));
        paint();
    });
    on(root, 'click', '[data-act="run-sim"]', () => paint());
    on(root, 'click', '[data-act="save-team"]', () => saveTeamFlow());
    on(root, 'click', '[data-act="load-team"]', () => openLoadTeamPicker());
    on(root, 'click', '[data-act="pick-reso"]', (_e, el) => openSlotPicker(Number(el.dataset.slot)));
    on(root, 'click', '[data-act="pick-weapon"]', (_e, el) => openWeaponPickerForSlot(Number(el.dataset.slot)));
    on(root, 'click', '[data-act="toggle-group"]', (_e, el) => {
        const key = `${el.dataset.slot}_${el.dataset.key}`;
        const slotIndex = Number(el.dataset.slot);
        const rotLen = api.segBySlot.get(slotIndex)?.rotSteps?.length ?? 0;
        const cur = api.expandedGroups[key] ?? (rotLen <= 6);
        api.expandedGroups[key] = !cur;
        paint();
    });

    // Hover-box tooltip (element/sonata badges). mouseenter/mouseleave don't
    // bubble, so delegation uses mouseover/mouseout + a relatedTarget check.
    on(root, 'mouseover', '[data-tip-title]', (_e, el) => showTooltip(el, el.dataset.tipTitle, el.dataset.tipDesc || ''));
    on(root, 'mouseout', '[data-tip-title]', (e, el) => {
        if (el.contains(e.relatedTarget)) return;
        hideTooltip();
    });
}

// =============================================================================
// Public mount
// =============================================================================

export function mount(root, config) {
    api = {
        root,
        dataset: config.dataset,
        team: config.team,
        resolveBuild: config.resolveBuild,
        listBuilds: config.listBuilds,
        listTeams: config.listTeams,
        saveTeam: config.saveTeam,
        saveBuild: config.saveBuild,
        createBuildForResonator: config.createBuildForResonator,
        onChangeTeam: config.onChangeTeam,
        onLoadTeam: config.onLoadTeam,
        theme: getV2Theme(),
        passCount: 1,
        expandedGroups: {},
        result: null,
        segBySlot: new Map(),
        toast: null,
        toastTimer: null,
    };
    paint();
    if (!root.__partyBound) { root.__partyBound = true; bind(); }
    return {
        update(team) { api.team = team; paint(); },
    };
}

// Pure helpers for tests (no DOM / no module state).
export const __test__ = {
    fmtDmg, fmtDps, fmtDur, donutGradient, donutTitle, segmentsBySlot, memberTimeSpan,
    buffFracs, buffKindFor, segColor, sonataTooltipDesc, ELEM, DMG_COLOR, DMG_BADGE,
    ICON_SIZE, DONUT_SIZE, BADGE_ICON_SIZE,
};
