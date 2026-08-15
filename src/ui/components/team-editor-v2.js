/**
 * Team Simulator (TEAMS) — v2 page. Implements
 * docs/design_handoff_wuwa_sim/team sim. A full per-member-column
 * visualization. Shares the v2 sticky header (v2-header.js) and the design
 * tokens (styles/tokens.css; component rules in build-v2.css + team.css).
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
 *     onNewTeam(),                   // create + navigate to a fresh empty team
 *     onOpenBuild(buildId),          // navigate to a member's build page
 *   }) -> { update(team) }
 *
 * The shared v2 header's nav/theme are bound once by app.js, not here.
 *
 * The engine layer is complete: simulateTeamRotation returns segments,
 * memberTotals, memberSteps, memberStackedBuffWindows and totals. This module
 * is a presentation seam — it maps that result onto the handoff layout. Pure
 * helpers (formatting, donut, segment split, buff strips) are exported via
 * `__test__`. Buff windows render as strips MERGED into the FULL ROTATION
 * TIMELINE (renderTimelineCard, 2026-07-14) — same absolute team-time axis as
 * the segment blocks, stack-aware via buffStripsFor/buff-bar.js's
 * stackBandsFromSamples — not the separate, disconnected per-member-local
 * "ACTIVE BUFFS" card this replaced.
 */

import { html, raw, render, on, esc } from '../dom.js';
import * as modal from './modal-picker.js';
import { openWeaponPicker as openWeaponPickerModal } from './weapon-picker.js';
import { simulateTeamRotation } from '../../core/team-sim.js';
import { applySonataOverride, normalizeSonataOverride } from '../../core/sonata-override.js';
import { openSonataQuickswitch, closeSonataQuickswitch } from './sonata-quickswitch.js';
import { resolveTeamSlots, setTeamSlot, setTeamName, swapTeamSlots, TEAM_SLOTS } from '../../core/team.js';
import { setWeapon } from '../../core/build.js';
import { iconHtml } from '../icons.js';
import { renderV2Header, getV2Theme } from './v2-header.js';
import { createHistory } from '../history.js';
import { extractSkillSection } from '../tip-format.js';
import { renderBuffBar as renderBuffStripBar, stackBandsFromSamples, fmtPctTrim } from './buff-bar.js';
import { effectiveSkillMap } from '../../core/sim.js';
import { hideTooltip, bindTooltipHover } from '../tooltip.js';
import { renderEnergyChart, bindEnergyChartHover } from './energy-chart.js';

let api = null;

// Element id → { name, colour-token }. Single source: styles/tokens.css --el-*.
// Alpha tints are composed via color-mix (see segColor), not hex suffixes.
const ELEM = {
    1: { name: 'Glacio',  c: 'var(--el-glacio)' },
    2: { name: 'Fusion',  c: 'var(--el-fusion)' },
    3: { name: 'Electro', c: 'var(--el-electro)' },
    4: { name: 'Aero',    c: 'var(--el-aero)' },
    5: { name: 'Spectro', c: 'var(--el-spectro)' },
    6: { name: 'Havoc',   c: 'var(--el-havoc)' },
};
const NO_ELEM = { name: '—', c: 'var(--faint)' };
const elemOf = (id) => ELEM[id] ?? NO_ELEM;

// Damage-category display colours + badges. Single source: tokens.css --dmg-*.
// Used as solid step-bar/badge/conic-gradient colours; alpha tints via color-mix.
const DMG_COLOR = {
    basic: 'var(--dmg-basic)', heavy: 'var(--dmg-heavy)', skill: 'var(--dmg-skill)',
    liberation: 'var(--dmg-liberation)', echo: 'var(--dmg-echo)', intro: 'var(--dmg-intro)', outro: 'var(--dmg-outro)',
    tuneBreak: 'var(--dmg-tuneBreak)',
};
const DMG_BADGE = {
    basic: 'BA', heavy: 'HA', skill: 'SK', liberation: 'LB', echo: 'EC', intro: 'IN', outro: 'OU',
    tuneBreak: 'TB',
};

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
        return `${DMG_COLOR[cat] ?? 'var(--faint)'} ${start.toFixed(1)}deg ${angle.toFixed(1)}deg`;
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
    for (const segment of segments ?? []) {
        let e = m.get(segment.slotIndex);
        if (!e) { e = { introSteps: [], rotSteps: [], segs: [] }; m.set(segment.slotIndex, e); }
        e.segs.push(segment);
        if (segment.kind === 'intro') e.introSteps.push(...(segment.steps ?? []));
        else if (segment.kind === 'rotation') e.rotSteps.push(...(segment.steps ?? []));
    }
    return m;
}

// Segment colour on the shared timeline — element-tinted, opacity by kind.
// `el` is an element-colour token reference (e.g. var(--el-aero)); alpha is
// composed via color-mix so the single token source stays authoritative.
function segColor(kind, el) {
    if (kind === 'rotation') return `color-mix(in srgb, ${el} 80%, transparent)`;
    if (kind === 'intro') return 'color-mix(in srgb, var(--dmg-intro) 53%, transparent)';
    if (kind === 'outro') return 'color-mix(in srgb, var(--dmg-outro) 38%, transparent)';
    return `color-mix(in srgb, ${el} 27%, transparent)`; // offField
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

// Hover-box tooltip — showTooltip/hideTooltip/bindTooltipHover live in
// ../tooltip.js, shared with the build and compare pages.

// Build resolver that folds in each member's transient sonata quick-switch
// preview. Used ONLY for the sim (and the member badge) — api.resolveBuild
// stays the pristine source everywhere else, so previews never leak into a
// saved build. Returns the base object untouched when a member has no preview.
function previewResolveBuild(id) {
    const base = api.resolveBuild(id);
    if (!base) return base;
    const override = api.sonataOverrides?.[base.id];
    return override ? applySonataOverride(base, override) : base;
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
        team: api.team, resolveBuild: previewResolveBuild, dataset: api.dataset, target, passCount: api.passCount,
        // Both are user-facing chips in the title row. deriveOpeners defaults
        // OFF so the headline number describes the rotation as written;
        // timingMode picks which clock divides it (docs/TIMING_MODEL.md).
        deriveOpeners: api.deriveOpeners,
        timingMode: api.timingMode,
    });
}

// =============================================================================
// Undo / redo — single mutation chokepoint for team EDITS (slot assign / remove /
// reorder). Records the replaced team, applies the next, syncs autosave, repaints.
// Save/promote/name flows assign api.team directly and are intentionally NOT
// tracked (they aren't content edits). Member weapon changes edit a build, not
// the team, so they belong to the build editor's history, not this one.
// =============================================================================

function commitTeam(next) {
    if (next !== api.team) api.history?.record(api.team);
    api.team = next;
    api.onChangeTeam?.(api.team);
    paint();
}

// Restore a snapshot (bypassing commitTeam's record — the stack stashes the
// current team for the opposite move) and keep autosave in sync.
function undoTeam() {
    const restored = api.history?.undo(api.team);
    if (restored == null) return;
    api.team = restored;
    api.onChangeTeam?.(restored);
    paint();
}
function redoTeam() {
    const restored = api.history?.redo(api.team);
    if (restored == null) return;
    api.team = restored;
    api.onChangeTeam?.(restored);
    paint();
}

// Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z (or Ctrl+Y) on the #party route, ignoring text
// fields. Bound once on window in mount(); mirrors the build editor's handler.
function handleTeamUndoRedoKey(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    if (!location.hash.startsWith('#party')) return;
    if (event.target?.matches?.('input[type="text"], input[type="search"], input[type="number"], input:not([type]), textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    if (key === 'y' || event.shiftKey) redoTeam();
    else undoTeam();
}

// =============================================================================
// Render
// =============================================================================

function paint() {
    hideTooltip();
    closeSonataQuickswitch();
    api.result = runSim();
    api.segBySlot = api.result && !api.result.empty ? segmentsBySlot(api.result.segments) : new Map();
    render(api.root, renderPage());
}

function renderPage() {
    return html`
        <div class="bv2 bv2-party" data-theme="${api.theme}">
            ${raw(renderV2Header({ active: 'party', theme: api.theme, history: { canUndo: api.history?.canUndo() ?? false, canRedo: api.history?.canRedo() ?? false } }))}
            <div style="max-width:1240px;margin:0 auto;padding:28px 24px 40px;display:flex;flex-direction:column;gap:16px;">
                ${raw(renderTitleRow())}
                ${raw(renderTotalsBanner())}
                ${raw(renderTimelineCard())}
                ${raw(renderEnergyCard())}
                ${raw(renderMemberGrid())}
            </div>
            ${raw(renderToast())}
            ${raw(renderNamePrompt())}
        </div>
    `;
}

function renderToast() {
    if (!api.toast) return '';
    return `
      <div class="bv2-party-toast" style="position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:50;display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;background:var(--card2);border:1px solid var(--acc);box-shadow:0 10px 30px -10px rgba(var(--shadow-rgb),.6);">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--acc);box-shadow:0 0 8px var(--acc);flex:none;"></span>
        <span style="font-family:var(--font-display);font-size:11.5px;letter-spacing:.4px;color:var(--txt);">${esc(api.toast)}</span>
      </div>`;
}

// Custom in-app naming dialog — replaces a previous native prompt() (blocking,
// inconsistently supported across embedding contexts, and gave zero visible
// feedback if a host suppressed it). Shown on a team's first save; the input
// is pre-filled with autoTeamName()'s constellation-based suggestion.
function renderNamePrompt() {
    if (!api.namePromptOpen) return '';
    return `
      <div data-act="name-prompt-backdrop" style="position:fixed;inset:0;z-index:60;background:rgba(var(--shadow-rgb),.72);display:flex;align-items:center;justify-content:center;padding:24px;">
        <div data-act="name-prompt-stop" style="background:var(--card);border:1px solid var(--bd2);border-radius:16px;width:100%;max-width:380px;padding:20px;box-shadow:0 24px 60px rgba(var(--shadow-rgb),.85);">
          <div style="font-family:var(--font-display);font-weight:700;font-size:13px;letter-spacing:.8px;color:var(--txt);margin-bottom:4px;">SAVE TEAM AS</div>
          <div style="font-family:var(--font-body);font-size:11px;color:var(--faint);margin-bottom:12px;">Suggested from this team's members — edit or keep it.</div>
          <input class="bv2-text" type="text" value="${esc(api.namePromptValue ?? '')}" data-act="name-prompt-input" autofocus
                 style="width:100%;background:var(--inp);border:1px solid var(--bd);border-radius:9px;padding:10px 12px;font-size:14px;color:var(--txt);margin-bottom:14px;">
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button data-act="name-prompt-cancel" style="font-family:var(--font-display);font-weight:600;font-size:11px;letter-spacing:.5px;padding:8px 14px;border-radius:8px;cursor:pointer;background:var(--btn);border:1px solid var(--btnbd);color:var(--dim);">CANCEL</button>
            <button data-act="name-prompt-save" style="font-family:var(--font-display);font-weight:700;font-size:11px;letter-spacing:.5px;padding:8px 16px;border-radius:8px;cursor:pointer;background:var(--acc);border:none;color:var(--on-acc);">SAVE</button>
          </div>
        </div>
      </div>`;
}

// A title-row on/off chip: accent-filled when active, muted when not. Shared by
// OPENERS and GAME TIME / REAL TIME so the two cannot drift apart visually.
function toggleChip(action, active, label, tipTitle, tipDesc) {
    const border = active ? 'var(--acc)' : 'var(--bd)';
    const background = active ? 'color-mix(in srgb, var(--acc) 14%, transparent)' : 'var(--inp)';
    const color = active ? 'var(--acc)' : 'var(--dim)';
    return `<button data-act="${action}" data-tip-title="${esc(tipTitle)}" data-tip-desc="${esc(tipDesc)}"
          style="font-family:var(--font-display);font-weight:700;font-size:11px;padding:5px 12px;border-radius:7px;cursor:pointer;border:1px solid ${border};background:${background};color:${color};">${esc(label)}</button>`;
}

function renderTitleRow() {
    const ghostBtn = "font-family:var(--font-display);font-weight:600;font-size:9.5px;letter-spacing:.7px;color:var(--dim);background:var(--inp);border:1px solid var(--bd);border-radius:8px;padding:6px 13px;cursor:pointer;";
    const passChips = [1, 2, 3].map(n => {
        const on = api.passCount === n;
        return `<button data-act="pass" data-n="${n}" style="font-family:var(--font-display);font-weight:700;font-size:11px;padding:5px 12px;border-radius:7px;cursor:pointer;border:1px solid ${on ? 'var(--acc)' : 'var(--bd)'};background:${on ? 'color-mix(in srgb, var(--acc) 14%, transparent)' : 'var(--inp)'};color:${on ? 'var(--acc)' : 'var(--dim)'};">${n}</button>`;
    }).join('');
    return `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="width:4px;height:22px;background:var(--acc);border-radius:3px;box-shadow:0 0 10px var(--acc);flex:none;"></div>
        <span style="font-family:var(--font-display);font-weight:700;font-size:16px;letter-spacing:2px;color:var(--txt);">TEAM SIMULATION</span>
        <span style="font-family:var(--font-body);font-size:11px;color:var(--faint);">${esc(api.team?.name ?? '')}</span>
        ${api.team?.template ? `<span data-tip-title="Suggested team template" data-tip-desc="Loaded from a team suggestion — not saved to My Teams. Click SAVE TEAM to keep it (and its member builds) permanently." style="font-family:var(--font-display);font-weight:700;font-size:9px;letter-spacing:.8px;padding:3px 8px;border-radius:6px;background:color-mix(in srgb, var(--acc) 16%, transparent);border:1px solid var(--acc);color:var(--acc);">TEMPLATE · UNSAVED</span>` : ''}
        <div style="flex:1;height:1px;background:var(--bd);margin:0 4px;min-width:20px;"></div>
        <button data-act="new-team" style="${ghostBtn}">NEW TEAM</button>
        <button data-act="save-team" style="${ghostBtn}">SAVE TEAM</button>
        <button data-act="load-team" style="${ghostBtn}">LOAD TEAM</button>
        <button data-act="delete-team" style="${ghostBtn}border-color:var(--warn);color:var(--warn);">DELETE TEAM</button>
        <span style="width:1px;height:20px;background:var(--bd);flex:none;"></span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-family:var(--font-display);font-size:8.5px;letter-spacing:1.3px;color:var(--faint);">PASSES</span>
          <div style="display:flex;gap:3px;">${passChips}</div>
        </div>
        ${toggleChip('toggle-openers', api.deriveOpeners, `OPENERS ${api.deriveOpeners ? 'ON' : 'OFF'}`,
        'Derived openers (honest cold start)',
        'ON: a Liberation the Resonance Energy gauge can\'t cover yet is padded with that member\'s own pre-Liberation cycle (real filler casts, real time) — or gated when nothing can generate the energy. OFF: every scripted cast lands regardless of energy, so the number describes the rotation exactly as written. OFF is the default.')}
        ${toggleChip('toggle-timing-mode', api.timingMode === 'toa', api.timingMode === 'toa' ? 'GAME TIME' : 'REAL TIME',
        'Which clock divides the damage',
        'GAME TIME: a Resonance Liberation freezes the in-game clock, so its animation is excluded from the DPS denominator — the Tower of Adversity convention community DPS figures use. REAL TIME: wall-clock, nothing excluded. The damage total is identical either way; only the divisor changes.')}
        <button data-act="run-sim" style="font-family:var(--font-display);font-weight:700;font-size:11px;letter-spacing:.8px;padding:7px 16px;border-radius:9px;cursor:pointer;background:var(--acc);border:none;color:var(--on-acc);box-shadow:0 1px 10px color-mix(in srgb, var(--acc) 35%, transparent);">▶ RUN SIM</button>
      </div>`;
}

/**
 * The clock the whole page is currently drawn on.
 *
 * Under GAME TIME a Resonance Liberation's freeze is removed, so the axis, the
 * segment bars, the buff strips, every step timestamp and every per-member
 * figure compress by exactly the amount the DPS denominator does. They have to
 * move together: a toggle that shortened the DPS divisor while the timeline
 * stayed the same length would make the page contradict itself.
 *
 * A step's freeze is credited at its END, matching sim.js's deriveGameTimes, so
 * this mapping agrees with the engine at every step boundary. Display only —
 * nothing here feeds a simulation.
 */
function displayClock() {
    const result = api.result;
    return clockFor(api.segBySlot, (result && !result.empty) ? result.totals : null,
        api.timingMode === 'toa');
}

// Every clock-stopping window in the team rotation, in team time, plus each
// slot's own total. A step's freeze counts at its END (deriveGameTimes).
function collectFreezePoints(segBySlot) {
    const points = [];                    // { at, freeze } -> { at, removed }
    const freezeBySlot = new Map();
    for (const [slotIndex, split] of segBySlot) {
        for (const segment of split.segs ?? []) {
            for (const step of segment.steps ?? []) {
                if (!(step.freezeTime > 0)) continue;
                points.push({ at: step.endTime, freeze: step.freezeTime });
                freezeBySlot.set(slotIndex, (freezeBySlot.get(slotIndex) ?? 0) + step.freezeTime);
            }
        }
    }
    points.sort((left, right) => left.at - right.at);
    let running = 0;
    for (const point of points) { running += point.freeze; point.removed = running; }
    return { points, freezeBySlot };
}

// The pure half, so the mapping can be tested without a mounted page.
function clockFor(segBySlot, totals, isGame) {
    const { points, freezeBySlot } = collectFreezePoints(segBySlot);

    const map = (seconds) => {
        if (!isGame) return seconds;
        let removed = 0;
        for (const point of points) {
            if (point.at > seconds) break;
            removed = point.removed;
        }
        return Math.max(0, seconds - removed);
    };
    return {
        isGame,
        map,
        suffix: isGame ? 'g' : 's',
        span: (isGame ? totals?.gameTime : totals?.time) ?? 0,
        // A member's own on-field seconds on this clock, for their DPS divisor.
        memberSeconds: (slotIndex, realSeconds) =>
            isGame ? Math.max(0, realSeconds - (freezeBySlot.get(slotIndex) ?? 0)) : realSeconds,
    };
}

/**
 * DURATION must show the SAME number TEAM DPS divides by — otherwise flipping
 * the clock moves DPS while duration sits still, which reads as a bug. Under
 * GAME TIME that is the freeze-excluded clock, and the wall-clock figure moves
 * into the label so nothing is hidden.
 */
function durationChipParts(totals) {
    const usesGameTime = api.timingMode === 'toa';
    if (!totals) return { label: usesGameTime ? 'DURATION · GAME' : 'DURATION · REAL', seconds: 0 };
    const frozen = totals.time - totals.gameTime;
    if (!usesGameTime) return { label: 'DURATION · REAL', seconds: totals.time };
    return {
        label: frozen > 0.05 ? `DURATION · GAME (${fmtDur(totals.time)} REAL)` : 'DURATION · GAME',
        seconds: totals.gameTime,
    };
}

function renderTotalsBanner() {
    const r = api.result;
    const totals = r && !r.empty ? r.totals : null;

    const mkChip = (label, value, valColor) =>
        `<div style="display:flex;flex-direction:column;gap:1px;">
           <span style="font-family:var(--font-display);font-size:7.5px;letter-spacing:1px;color:var(--faint);">${label}</span>
           <span style="font-family:var(--font-display);font-weight:700;font-size:20px;color:${valColor};">${esc(value)}</span>
         </div>`;
    const duration = durationChipParts(totals);
    const chips = [
        mkChip('TEAM DPS', totals ? fmtDps(totals.dps) : '—', 'var(--acc)'),
        mkChip('TOTAL DMG', totals ? fmtDmg(totals.damage) : '—', 'var(--txt)'),
        mkChip(duration.label, totals ? fmtDur(duration.seconds) : '—', 'var(--txt)'),
    ].join('');

    // Damage share — one segment per occupied member, element-coloured.
    let shareBar = '', legend = '';
    if (totals && totals.damage > 0) {
        const rows = r.memberTotals.filter(m => m.damage > 0).map(m => {
            const resonator = api.dataset.resonators.find(x => x.id === m.resonatorId);
            const el = elemOf(resonator?.element);
            const pct = m.damage / totals.damage * 100;
            return { name: resonator?.name ?? '?', el, pct, damage: m.damage, statusDmg: m.statusDmg ?? 0 };
        });
        // Negative-status damage is already inside each member's total, but it
        // runs on its own formula (no ATK scaling, no crit unless a kit grants
        // one) — so it is named in the hover rather than left as an unexplained
        // gap between a member's share and the hits the timeline shows.
        shareBar = rows.map(x =>
            `<div style="flex:${x.pct.toFixed(1)};background:${x.el.c};" title="${esc(x.name)}: ${x.pct.toFixed(1)}% · ${esc(fmtDmg(x.damage))}${x.statusDmg > 0 ? ` (incl. ${esc(fmtDmg(x.statusDmg))} negative status)` : ''}"></div>`).join('');
        legend = rows.map(x =>
            `<div style="display:flex;align-items:center;gap:4px;">
               <span style="width:7px;height:7px;border-radius:50%;background:${x.el.c};flex:none;"></span>
               <span style="font-family:var(--font-display);font-size:8.5px;color:var(--dim);">${esc(x.name)}</span>
               <span style="font-family:var(--font-display);font-size:8.5px;font-weight:700;color:var(--txt);">${x.pct.toFixed(0)}%</span>
             </div>`).join('');
    }

    const shareBlock = shareBar
        ? `<div style="flex:1;min-width:180px;max-width:360px;">
             <div style="font-family:var(--font-display);font-size:7.5px;letter-spacing:1px;color:var(--faint);margin-bottom:6px;">DAMAGE SHARE</div>
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

// Stack-aware buff strips for a member's row in the FULL ROTATION TIMELINE
// (2026-07-14 — merged in from the old, disconnected per-column "ACTIVE
// BUFFS" section so a buff's exact active window lines up with the casts
// that triggered it, on the SAME absolute team-time axis). Reads
// simulateTeamRotation's memberStackedBuffWindows (team-time per-step stack
// samples), not the flat memberBuffWindows this replaces on this page —
// that field still exists on the engine result for its own tested contract,
// it's just no longer this page's data source. Reuses buff-bar.js's
// stackBandsFromSamples (shared with the Build page) so a stacking sonata
// buff ramps/decays here exactly like it does there, instead of reading as
// one flat block.
// Split a window's per-step stack samples into contiguous ACTIVE runs (stacks
// > 0). A buff that decays to zero and later re-triggers becomes TWO runs with
// a real gap between them, instead of one strip painted solid across the dead
// time (2026-07-15 fix — e.g. Chisa's Rejuvenating Glow, a 30s heal-gated buff,
// used to read as one ~53s bar because the outer strip rectangle ignored the
// samples that correctly dropped to 0 in the middle).
function activeRuns(samples) {
    const runs = [];
    let current = null;
    for (const s of (samples ?? [])) {
        if ((s.stacks ?? 0) > 0) {
            if (current && Math.abs(current.end - s.start) < 1e-6) { current.end = s.end; current.samples.push(s); }
            else { current = { start: s.start, end: s.end, samples: [s] }; runs.push(current); }
        } else current = null;
    }
    return runs;
}

function buffStripsFor(windows, { sourceName = null } = {}) {
    const strips = [];
    for (const w of (windows ?? [])) {
        if (!(w.bonusPct > 0)) continue;
        const stacking = w.maxStacks > 1;
        let name = w.name;
        if (stacking) {
            const perPct = fmtPctTrim(w.bonusPct * 100);
            const maxPct = fmtPctTrim(w.bonusPct * w.maxStacks * 100);
            // Rewrite the leading "+8%" headline into a "+7.5→30%" ramped range.
            name = w.name.replace(/^\+?\d+(?:\.\d+)?\s*%/, `+${perPct}→${maxPct}%`);
        }
        const runs = w.samples?.length ? activeRuns(w.samples) : [{ start: w.start, end: w.end, samples: [] }];
        for (const run of runs) {
            const stackBands = stacking ? stackBandsFromSamples(run.samples, run.start, run.end) : null;
            const durLabel = `${(run.end - run.start).toFixed(1)}s`;
            // A summed strip carries its addends (team-sim.js incomingDisplayEntries)
            // so the tooltip can name the gear behind each part of the total.
            const breakdown = (w.breakdown ?? [])
                .map(part => `${part.label} +${fmtPctTrim(part.value * 100)}%`).join(" · ");
            strips.push({
                name,
                start: run.start,
                end: run.end,
                stackBands,
                elementColor: w.bonusKind === 'element' && w.element ? ELEM[w.element]?.c : null,
                dmgType: w.bonusKind === 'atk' ? null : (w.dmgType ?? null),
                // sourceName present → team-wide strip: name the granting member.
                tipTitle: sourceName ? `${sourceName} · ${w.sonataName} — ${name}` : `${w.sonataName} — ${name}`,
                tipDesc: [stacking ? `×${w.maxStacks} stacks · ${durLabel}` : durLabel, breakdown]
                    .filter(Boolean).join("\n"),
            });
        }
    }
    return strips;
}

// Re-time buff strips onto the displayed clock. Only start/end move; the
// stack bands inside a strip are stored as fractions OF that strip, so they
// stay correct without touching them.
function onClock(strips, clock) {
    if (!clock.isGame) return strips;
    return strips.map(strip => ({ ...strip, start: clock.map(strip.start), end: clock.map(strip.end) }));
}

function renderTimelineCard() {
    const r = api.result;
    const occupied = resolveTeamSlots(api.team, api.resolveBuild).filter(s => s.build);
    const hasData = r && !r.empty && r.totals.time > 0;
    // The axis is drawn on the SELECTED clock, so switching the toggle visibly
    // compresses or expands the timeline by the frozen seconds.
    const clock = displayClock();
    const totalTime = hasData ? clock.span : 0;

    let body;
    if (!occupied.length) {
        body = `<div style="padding:6px 2px;font-family:var(--font-body);font-size:12px;color:var(--faint);">Add resonators below to build a team.</div>`;
    } else if (!hasData) {
        body = `<div style="padding:6px 2px;font-family:var(--font-body);font-size:12px;color:var(--faint);">Give each member a rotation (in their Build page) to see the team timeline and DPS.</div>`;
    } else {
        const tickCount = Math.ceil(totalTime / 5);
        const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * 5).filter(t => t <= totalTime + 0.1).map(t =>
            `<span style="position:absolute;left:${(t / totalTime * 100).toFixed(2)}%;font-family:var(--font-display);font-size:8px;color:var(--faint);">${t.toFixed(0)}s</span>`).join('');

        // Team-wide buffs (e.g. a support's "ATK of all party members") are
        // pulled OUT of the wielder's row into a shared lane below everyone —
        // they affect the whole team, so a single team-time lane reads truer
        // than a copy sitting in one member's row (2026-07-15). Self buffs stay
        // exactly where they're affecting: the wielder's own row.
        const teamWideStrips = [];
        const rows = occupied.map(slot => {
            const resonator = resonatorOf(slot.build);
            const el = elemOf(resonator?.element);
            const segs = (api.segBySlot.get(slot.slotIndex)?.segs ?? []).map(segment => {
                const from = clock.map(segment.startTime), until = clock.map(segment.endTime);
                const left = (from / totalTime * 100).toFixed(2);
                const width = Math.max(0.4, (until - from) / totalTime * 100).toFixed(2);
                const realNote = clock.isGame && (segment.endTime - until) > 0.05
                    ? ` (real ${segment.startTime.toFixed(1)}–${segment.endTime.toFixed(1)}s)` : '';
                const title = `${resonator?.name ?? '?'} · ${segment.kind} · ${from.toFixed(1)}–${until.toFixed(1)}s${realNote}${segment.damage > 0 ? ' · ' + fmtDmg(segment.damage) : ''}`;
                return `<div style="position:absolute;top:0;height:100%;left:${left}%;width:${width}%;background:${segColor(segment.kind, el.c)};border-radius:3px;" title="${esc(title)}"></div>`;
            }).join('');
            const allWins = r.memberStackedBuffWindows?.get(slot.build.resonatorId) ?? [];
            // Strips share the segment axis, so they take the same mapping —
            // otherwise a buff would drift off the cast that granted it the
            // moment the clock is switched. Stack bands are strip-RELATIVE
            // (startFrac/widthFrac), so they ride along untouched.
            teamWideStrips.push(...onClock(buffStripsFor(allWins.filter(w => w.teamWide), { sourceName: resonator?.name }), clock));
            const buffStrips = onClock(buffStripsFor(allWins.filter(w => !w.teamWide)), clock);
            const buffLane = buffStrips.length
                ? `<div style="display:flex;align-items:flex-start;gap:10px;margin-top:3px;">
                     <div style="width:62px;flex:none;"></div>
                     <div style="flex:1;">${renderBuffStripBar(buffStrips, totalTime, { rowH: 16, gap: 3 })}</div>
                   </div>`
                : '';
            return `
              <div>
                <div style="display:flex;align-items:center;gap:10px;">
                  <div style="width:62px;flex:none;display:flex;align-items:center;gap:5px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:${el.c};flex:none;"></span>
                    <span style="font-family:var(--font-display);font-size:10px;font-weight:600;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;">${esc(resonator?.name ?? '?')}</span>
                  </div>
                  <div style="flex:1;position:relative;height:22px;background:var(--node);border-radius:4px;overflow:hidden;">${segs}</div>
                </div>
                ${buffLane}
              </div>`;
        }).join('');

        // Shared TEAM-WIDE lane below all members.
        const teamWideLane = teamWideStrips.length
            ? `<div style="display:flex;align-items:flex-start;gap:10px;margin-top:10px;padding-top:8px;border-top:1px dashed var(--bd);">
                 <div style="width:62px;flex:none;font-family:var(--font-display);font-size:8px;font-weight:700;letter-spacing:.5px;color:var(--faint);padding-top:2px;">TEAM-WIDE</div>
                 <div style="flex:1;">${renderBuffStripBar(teamWideStrips, totalTime, { rowH: 16, gap: 3 })}</div>
               </div>`
            : '';

        const legend = [['ROTATION', 'color-mix(in srgb, var(--el-spectro) 80%, transparent)'], ['INTRO', 'color-mix(in srgb, var(--dmg-intro) 53%, transparent)'], ['OUTRO', 'color-mix(in srgb, var(--dmg-outro) 38%, transparent)']].map(([label, c]) =>
            `<div style="display:flex;align-items:center;gap:5px;">
               <span style="width:18px;height:7px;border-radius:2px;background:${c};"></span>
               <span style="font-family:var(--font-display);font-size:8px;letter-spacing:.6px;color:var(--faint);">${label}</span>
             </div>`).join('');

        body = `
          <div style="position:relative;height:14px;margin-left:72px;margin-bottom:6px;">${ticks}</div>
          <div style="display:flex;flex-direction:column;gap:9px;">${rows}</div>
          ${teamWideLane}
          <div style="display:flex;align-items:center;gap:14px;margin-top:12px;padding-top:10px;border-top:1px solid var(--bd);flex-wrap:wrap;">${legend}</div>`;
    }

    const durStr = hasData ? `${fmtDur(totalTime)} · ${occupied.length} members · ${api.passCount} pass${api.passCount === 1 ? '' : 'es'}` : '';
    // Cooldown-conflict chip (2026-07-12): team-time violations from
    // team-sim.js §4b (timers persist across passes/swaps). The per-step ⏱
    // markers in each member's step list carry the same detail.
    const cdViol = hasData ? (r.cooldownViolations ?? []) : [];
    const nameByRid = new Map(occupied.map(s => [s.build.resonatorId, resonatorOf(s.build)?.name ?? '?']));
    const cdChip = cdViol.length ?
        `<span data-tip-title="Cooldown conflicts" data-tip-desc="${esc(cdViol.map(v => `${nameByRid.get(v.resonatorId) ?? v.resonatorId} · ${v.label} @ ${v.t.toFixed(1)}s — ${v.deficit.toFixed(1)}s early`).join('\n'))}" style="font-family:var(--font-display);font-weight:700;font-size:9px;letter-spacing:.6px;padding:3px 8px;border-radius:6px;background:color-mix(in srgb, var(--gold) 12%, transparent);border:1px solid color-mix(in srgb, var(--gold) 45%, transparent);color:var(--warn);cursor:default;">⏱ ${cdViol.length} CD CONFLICT${cdViol.length === 1 ? '' : 'S'}</span>` : '';
    // Derived-opener chip (2026-07-12): the honest cold-start adjustments —
    // filler time added / Liberations gated per member-pass (opener.js).
    const openerAdj = hasData ? (r.openerAdjustments ?? []) : [];
    const openerLines = openerAdj.map(a => {
        const nm = nameByRid.get(a.resonatorId) ?? a.resonatorId;
        const parts = [];
        if (a.addedTime > 0) parts.push(`+${a.addedTime.toFixed(1)}s filler (${a.insertions.reduce((n, x) => n + x.sequence.length, 0)} steps)`);
        for (const g of a.gated) parts.push(`${g.key} GATED (${g.reason}, ${g.deficit.toFixed(0)} energy short)`);
        return `${nm} · pass ${a.pass + 1}: ${parts.join(' · ')}`;
    });
    const openerTime = openerAdj.reduce((s, a) => s + a.addedTime, 0);
    const openerGates = openerAdj.reduce((s, a) => s + a.gated.length, 0);
    const openerChip = openerAdj.length ?
        `<span data-tip-title="Derived opener (honest cold start)" data-tip-desc="${esc(openerLines.join('\n'))}" style="font-family:var(--font-display);font-weight:700;font-size:9px;letter-spacing:.6px;padding:3px 8px;border-radius:6px;background:color-mix(in srgb, var(--acc) 12%, transparent);border:1px solid color-mix(in srgb, var(--acc) 45%, transparent);color:var(--acc);cursor:default;">↻ OPENER ${openerTime > 0 ? `+${openerTime.toFixed(0)}s` : ''}${openerGates ? ` · ${openerGates} GATED` : ''}</span>` : '';
    return `
      <div style="position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -16px rgba(var(--shadow-rgb),.5);">
        <span style="position:absolute;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,var(--acc),transparent);opacity:.7;"></span>
        <div style="display:flex;align-items:center;gap:10px;padding:13px 18px 11px;border-bottom:1px solid var(--bd);">
          <span style="width:8px;height:18px;border-radius:3px;background:var(--acc);box-shadow:0 0 8px var(--acc);flex:none;"></span>
          <span style="font-family:var(--font-display);font-weight:700;font-size:13px;letter-spacing:1.5px;color:var(--txt);">FULL ROTATION TIMELINE</span>
          <span style="font-family:var(--font-body);font-size:11px;color:var(--faint);">${esc(durStr)}</span>
          ${openerChip}${cdChip}
        </div>
        <div style="padding:14px 18px 16px;">${body}</div>
      </div>`;
}

// Per-member input for energy-chart.js: memberEnergy (computed by the sim
// since P13, never rendered until now) + display name/element for the plot.
function energyChartMembers() {
    const r = api.result;
    if (!r || r.empty || !r.memberEnergy) return [];
    const occupied = resolveTeamSlots(api.team, api.resolveBuild).filter(s => s.build);
    return occupied.map(slot => {
        const resonator = resonatorOf(slot.build);
        const me = r.memberEnergy.get(slot.build.resonatorId);
        return {
            resonatorId: slot.build.resonatorId,
            name: resonator?.name ?? '?',
            elementColor: elemOf(resonator?.element).c,
            liberationCost: me?.liberationCost ?? null,
            trace: me?.trace ?? [],
        };
    });
}

function renderEnergyCard() {
    const r = api.result;
    const hasData = r && !r.empty && r.totals.time > 0;
    if (!hasData) return '';
    return `
      <div style="position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -16px rgba(var(--shadow-rgb),.5);">
        <span style="position:absolute;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,var(--gold),transparent);opacity:.7;"></span>
        ${renderEnergyChart(energyChartMembers(), r.totals.time)}
      </div>`;
}

// Empty-slot placeholder column (handoff leaves this to implementation).
function renderEmptySlotCard(slotIndex) {
    return `
      <div class="bv2-dnd-card" data-dnd-slot="${slotIndex}" style="position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:1.5px dashed var(--bd2);border-radius:16px;min-height:220px;display:flex;align-items:center;justify-content:center;transition:border-color .12s,box-shadow .12s;">
        <button data-act="pick-resonator" data-slot="${slotIndex}" style="display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;background:transparent;border:none;color:var(--faint);padding:24px;">
          <span style="font-size:34px;font-weight:300;line-height:1;color:var(--faint);">+</span>
          <span style="font-family:var(--font-display);font-size:10px;letter-spacing:1px;">ADD RESONATOR · SLOT ${slotIndex + 1}</span>
        </button>
      </div>`;
}

/**
 * When this cast happens, on the clock the page is drawn on.
 *
 * The step bars carried no timestamp at all before, which is exactly what made
 * a clock switch invisible on the resonator cards. Where the two clocks differ
 * the tooltip names both, so the frozen seconds are stated rather than merely
 * subtracted.
 */
function stepTimeParts(step, clock) {
    if (!clock) return { startsAt: null, line: '' };
    const startsAt = clock.map(step.startTime ?? 0);
    const shiftedBy = clock.isGame ? (step.startTime ?? 0) - startsAt : 0;
    const realNote = shiftedBy > 0.005
        ? ` · ${(step.startTime).toFixed(2)}s real (${shiftedBy.toFixed(2)}s frozen before it)` : '';
    const freezeNote = step.freezeTime > 0
        ? ` · freezes the clock for ${step.freezeTime.toFixed(2)}s` : '';
    return {
        startsAt,
        line: `At ${startsAt.toFixed(2)}s ${clock.isGame ? 'game time' : 'real time'}${realNote}${freezeNote}`,
    };
}

function renderStepBar(step, maxDmg, skillMap, clock) {
    const c = DMG_COLOR[step.damageCategory] ?? 'var(--faint)';
    const h = Math.max(18, Math.round((step.stepDamage ?? 0) / maxDmg * 68));
    const buffs = (step.activeBuffNames ?? []).length ? ` · buffs: ${(step.activeBuffNames).join(', ')}` : '';
    const time = stepTimeParts(step, clock);
    const startsAt = time.startsAt;
    const timeLine = time.line;
    const statLine = `${DMG_BADGE[step.damageCategory] ?? '??'} · ${fmtDmg(step.stepDamage ?? 0)}${buffs}`;
    // Cooldown overlay (2026-07-12): team-time re-annotation in team-sim.js
    // §4b — this cast fires before its skill/echo group's CD is ready.
    const cdLine = step.cd?.violated ? `⏱ Cooldown not ready — re-cast ${step.cd.deficit.toFixed(1)}s early (${step.cd.cooldown}s CD)` : '';
    // Derived-opener filler (2026-07-12): a cast the opener spliced in to
    // honestly charge the next Liberation (opener.js).
    // No step is ever spliced now, so nothing carries `openerFiller`. Kept as a
    // no-op read rather than threaded out of every tooltip caller.
    const fillerLine = '';
    // Echo steps have no skillMap entry — their real description rides on the
    // step (step.echoDesc, filled from the echo's active skill). 2026-07-15.
    const skillDef = skillMap?.[step.skillKey];
    const skillDesc = step.echoDesc ?? (skillDef ? extractSkillSection(skillDef.desc, step.skillKey, skillDef.skillType) : '');
    const tipDesc = [statLine, timeLine, fillerLine, cdLine, skillDesc].filter(Boolean).join('\n\n');
    const timeChip = startsAt == null ? ''
        : `<span style="flex:none;font-family:var(--font-display);font-size:8.5px;color:var(--faint);min-width:30px;text-align:right;">${startsAt.toFixed(1)}${clock.suffix}</span>`;
    return `
      <div style="height:${h}px;background:color-mix(in srgb, ${c} 10%, transparent);border-left:3px ${step.openerFiller ? 'dashed' : 'solid'} ${c};border-radius:5px;display:flex;align-items:center;padding:0 8px 0 10px;gap:6px;" data-tip-title="${esc(step.label)}" data-tip-desc="${esc(tipDesc)}">
        ${timeChip}
        <span style="flex:none;font-family:var(--font-display);font-weight:700;font-size:7px;letter-spacing:.3px;padding:2px 5px;border-radius:3px;background:color-mix(in srgb, ${c} 16%, transparent);color:${c};">${DMG_BADGE[step.damageCategory] ?? '??'}</span>
        ${step.openerFiller ? `<span style="flex:none;font-size:9px;line-height:1;color:var(--acc);">↻</span>` : ''}
        ${step.cd?.violated ? `<span style="flex:none;font-size:9px;line-height:1;color:var(--warn);">⏱</span>` : ''}
        <span style="flex:1;min-width:0;font-family:var(--font-display);font-size:10px;font-weight:600;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(step.label)}</span>
        <span style="flex:none;font-family:var(--font-display);font-weight:700;font-size:10px;color:${c};min-width:34px;text-align:right;">${esc(fmtDmg(step.stepDamage ?? 0))}</span>
      </div>`;
}

// Intro/Outro casts (handled exclusively by the team sim's auto-injected
// segments — see AUTO_CAST_SKILL_TYPES in team-sim.js) are folded into the
// same list as the member's own rotation steps. There is no separate
// "INTRO" group: a swap-in cast is just the first entry here, distinguished
// by its own damage-category badge/colour like any other step.
function renderStepGroups(slotIndex, introSteps, rotSteps, skillMap, clock) {
    const allSteps = [...introSteps, ...rotSteps];
    const maxDmg = Math.max(1, ...allSteps.map(s => s.stepDamage ?? 0));
    const grpHdr = 'display:flex;align-items:center;gap:6px;padding:9px 15px 7px;border-top:1px solid var(--bd);';
    const lblBase = "font-family:var(--font-display);font-size:8px;letter-spacing:1.2px;color:var(--faint);";

    const key = `${slotIndex}_rot`;
    const defaultExp = allSteps.length <= 6;
    const expanded = api.expandedGroups[key] ?? defaultExp;
    const countStyle = "font-family:var(--font-display);font-size:7.5px;font-weight:700;padding:1px 6px;border-radius:4px;background:var(--node);border:1px solid var(--bd);color:var(--dim);";
    let out = `<div style="${grpHdr}">
        <span style="${lblBase}">ROTATION</span>
        <span style="${countStyle}">${allSteps.length}</span>
        <div style="flex:1;"></div>
        <button data-act="toggle-group" data-slot="${slotIndex}" data-key="rot" style="background:transparent;border:none;color:var(--faint);cursor:pointer;font-size:10px;padding:2px 5px;line-height:1;">${expanded ? '▴' : '▾'}</button>
      </div>`;
    if (expanded) {
        out += allSteps.length
            ? `<div style="padding:0 15px 10px;display:flex;flex-direction:column;gap:3px;">${allSteps.map(s => renderStepBar(s, maxDmg, skillMap, clock)).join('')}</div>`
            : `<div style="padding:0 15px 10px;font-family:var(--font-body);font-size:10px;color:var(--faint);">No rotation set for this member.</div>`;
    }
    return out;
}

function renderMemberColumn(slot) {
    const build = slot.build;
    const resonator = resonatorOf(build);
    const el = elemOf(resonator?.element);
    const wpn = weaponOf(build);
    // Sonata badge follows the transient preview (effective set), but the swap
    // is keyed by the ORIGINAL dominant set so re-swaps/reset stay stable.
    const memberOverride = api.sonataOverrides?.[build.id] ?? null;
    const so = dominantSonata(applySonataOverride(build, memberOverride));
    const origSo = dominantSonata(build);
    const slotIndex = slot.slotIndex;
    const skillMap = effectiveSkillMap(api.dataset, build.resonatorId);

    const split = api.segBySlot.get(slotIndex);
    const introSteps = split?.introSteps ?? [];
    const rotSteps = split?.rotSteps ?? [];
    const allSteps = [...introSteps, ...rotSteps];
    const total = (api.result && !api.result.empty)
        ? api.result.memberTotals.find(m => m.slotIndex === slotIndex) ?? null : null;
    const teamDmg = (api.result && !api.result.empty) ? api.result.totals.damage : 0;
    const sharePct = total && teamDmg > 0 ? (total.damage / teamDmg * 100) : null;
    // Same clock as the timeline above, so a member's DPS and their step
    // timestamps agree with the axis they are read against.
    const clock = displayClock();
    const onFieldSeconds = total ? clock.memberSeconds(slotIndex, total.time) : 0;
    const dps = onFieldSeconds > 0 ? total.damage / onFieldSeconds : 0;

    // Header pieces ----------------------------------------------------------
    // Hovering the icon reveals switch/remove (same affordance as the echo
    // editor's switch-echo/remove-echo) — clicking the icon itself now opens
    // this member's build page instead of the picker; switching/removing the
    // slot moved to the small overlay buttons.
    const resoIcon = `
      <div class="bv2-hover-target" style="position:relative;width:${ICON_SIZE}px;height:${ICON_SIZE}px;flex:none;">
        <button data-act="open-member-build" data-id="${esc(build.id)}" title="Open build"
                style="width:100%;height:100%;border-radius:10px;border:1px solid var(--bd2);cursor:pointer;padding:0;overflow:hidden;background:${resonator?.iconUrl ? 'var(--node)' : 'repeating-linear-gradient(135deg,var(--bd) 0 4px,transparent 4px 8px)'};">
          ${resonator?.iconUrl ? `<img src="${esc(resonator.iconUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : ''}
          <span style="position:absolute;bottom:0;left:0;right:0;text-align:center;font-family:var(--font-display);font-weight:700;font-size:7px;color:var(--faint);background:linear-gradient(transparent,rgba(var(--scrim-rgb),.7));padding-top:6px;padding-bottom:1px;">Lv.${build.level}</span>
        </button>
        <div class="bv2-hover-actions" style="position:absolute;top:-6px;right:-6px;display:flex;gap:4px;z-index:2;">
          <span data-act="pick-resonator" data-slot="${slotIndex}" title="Change resonator" role="button" style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;border-radius:5px;border:1px solid var(--gold);background:var(--card2);color:var(--gold);flex:none;cursor:pointer;box-shadow:0 1px 5px rgba(var(--shadow-rgb),.5);">⇄</span>
          <span data-act="remove-resonator" data-slot="${slotIndex}" title="Remove from team" role="button" style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;border-radius:5px;border:1px solid var(--warn);background:var(--card2);color:var(--warn);flex:none;cursor:pointer;box-shadow:0 1px 5px rgba(var(--shadow-rgb),.5);">✕</span>
        </div>
      </div>`;

    const shareBadge = sharePct != null
        ? `<div style="font-family:var(--font-display);font-weight:700;font-size:11px;color:${el.c};padding:2px 6px;flex:none;white-space:nowrap;">${sharePct.toFixed(0)}%</div>`
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
        ${iconHtml('element', resonator?.element, { label: el.name, size: BADGE_ICON_SIZE })}
      </span>`;

    const sonataBadge = so
        ? `<button type="button" data-act="member-sonata-quickswitch" data-id="${esc(build.id)}" data-eff="${so.id}" data-orig="${origSo?.id ?? so.id}"
                 data-tip-title="${esc(so.name)}${memberOverride ? ' · preview (not saved)' : ''}" data-tip-desc="${esc(sonataTooltipDesc(so))}" title="Quick-switch set (preview only)"
                 style="display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:1px;border-radius:7px;background:transparent;border:1px solid ${memberOverride ? 'var(--acc)' : 'transparent'};">
             ${iconHtml('sonata', so.name, { label: so.name, size: BADGE_ICON_SIZE })}
           </button>`
        : '';

    const weapIcon = `
      <button data-act="pick-weapon" data-slot="${slotIndex}" title="Change weapon"
              style="position:relative;width:${ICON_SIZE}px;height:${ICON_SIZE}px;flex:none;border-radius:10px;border:1px solid color-mix(in srgb, var(--gold) 28%, transparent);cursor:pointer;padding:0;overflow:hidden;background:${wpn?.iconUrl ? 'var(--node)' : 'repeating-linear-gradient(135deg,color-mix(in srgb, var(--gold) 10%, transparent) 0 4px,transparent 4px 8px)'};">
        ${wpn?.iconUrl ? `<img src="${esc(wpn.iconUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : ''}
        <span style="position:absolute;bottom:0;left:0;right:0;text-align:center;font-family:var(--font-display);font-weight:700;font-size:7px;color:var(--dim);background:linear-gradient(transparent,rgba(var(--scrim-rgb),.7));padding-top:6px;padding-bottom:1px;">${build.weapon ? 'Lv.' + (build.weapon.level ?? 1) : '—'}</span>
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
            <span style="display:block;font-family:var(--font-display);font-weight:700;font-size:14px;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(resonator?.name ?? '—')}</span>
            <div style="display:flex;align-items:center;gap:6px;margin-top:5px;">
              ${elemBadge}${sonataBadge}
            </div>
          </div>
          <div style="display:flex;flex-direction:row;align-items:center;gap:6px;flex:none;">
            ${weapIcon}
          </div>
          <div style="position:absolute;left:${buildNameLeftInset}px;right:${buildNameRightInset}px;bottom:0;text-align:left;font-family:var(--font-display);font-size:9.5px;font-weight:600;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;">${esc(build.name || (so ? so.name : '—'))}</div>
        </div>
      </div>`;

    // Member totals ----------------------------------------------------------
    const healStyle = total && total.heal > 0 ? 'var(--heal)' : 'var(--faint)';
    const totalsRow = `
      <div style="border-top:1px solid var(--bd);background:var(--node);padding:11px 15px 13px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <div><div style="text-align: left;font-family:var(--font-display);font-size:7.5px;letter-spacing:1px;color:var(--faint);margin-bottom:2px;">TOTAL DMG</div>
          <div style="text-align: left;font-family:var(--font-display);font-weight:700;font-size:14px;color:${el.c};">${esc(total ? fmtDmg(total.damage) : '—')}</div></div>
        <div data-tip-title="On-field DPS (${clock.isGame ? 'game time' : 'real time'})"
             data-tip-desc="${esc(total ? `${fmtDmg(total.damage)} over ${onFieldSeconds.toFixed(2)}s on field${clock.isGame && total.time - onFieldSeconds > 0.005 ? ` — ${total.time.toFixed(2)}s real, ${(total.time - onFieldSeconds).toFixed(2)}s of it frozen by a Liberation` : ''}` : 'No damage yet.')}"
             style="cursor:default;"><div style="text-align: center;font-family:var(--font-display);font-size:7.5px;letter-spacing:1px;color:var(--faint);margin-bottom:2px;">DPS · ${clock.isGame ? 'GAME' : 'REAL'}</div>
          <div style="text-align: center;font-family:var(--font-display);font-weight:700;font-size:14px;color:var(--txt);">${esc(total ? fmtDps(dps) : '—')}</div></div>
        <div><div style="text-align: right;font-family:var(--font-display);font-size:7.5px;letter-spacing:1px;color:var(--faint);margin-bottom:2px;">HEAL</div>
          <div style="text-align: right;font-family:var(--font-display);font-weight:700;font-size:14px;color:${healStyle};">${esc(total && total.heal > 0 ? fmtDmg(total.heal) : '—')}</div></div>
      </div>`;

    // Draggable so members can be reordered — slot order IS rotation/on-field
    // order, so this is how a user changes it (drop onto another member or
    // an empty slot to swap; core/team.js's swapTeamSlots does the move).
    return `
      <div class="bv2-dnd-card" draggable="true" data-dnd-slot="${slotIndex}" style="position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -16px rgba(var(--shadow-rgb),.5);transition:border-color .12s,box-shadow .12s;">
        <span style="position:absolute;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,${el.c},transparent);z-index:1;"></span>
        ${header}
        ${renderStepGroups(slotIndex, introSteps, rotSteps, skillMap, clock)}
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
            const buildId =
                it == null ? null
                : it.kind === 'build' ? it.build.id
                : api.createBuildForResonator(it.resonator).id;
            commitTeam(setTeamSlot(api.team, slotIndex, buildId));
        },
    });
}

function openWeaponPickerForSlot(slotIndex) {
    const build = api.resolveBuild(api.team.slots[slotIndex]);
    if (!build) return;
    const resonator = resonatorOf(build);
    if (!resonator) return;
    openWeaponPickerModal({
        dataset: api.dataset,
        resonator: resonator,
        currentWeaponId: build.weapon?.id,
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
        api.namePromptValue = autoTeamName(api.team);
        api.namePromptOpen = true;
        paint();
        focusNamePromptInput();
        return;
    }
    promoteAndSaveTeam();
}

// A suggested-team template (loaded via "OPEN IN TEAM SIM", never auto-saved)
// only becomes real, permanent user data HERE — an explicit SAVE TEAM click.
// Clears template on the team and cascades to every member build it
// references, so a saved team never leaves orphaned hidden template builds
// behind (they'd otherwise never surface in My Builds).
function promoteAndSaveTeam() {
    for (const id of api.team.slots) {
        if (!id) continue;
        const b = api.resolveBuild(id);
        if (b?.template) api.saveBuild?.({ ...b, template: false });
    }
    api.team = { ...api.team, template: false };
    api.saveTeam?.(api.team);
    api.onChangeTeam?.(api.team);
    showToast(`Saved “${api.team.name}”`);
}

function focusNamePromptInput() {
    requestAnimationFrame(() => {
        const input = api.root.querySelector('[data-act="name-prompt-input"]');
        if (input) { input.focus(); input.select(); }
    });
}

function confirmNamePrompt() {
    const suggested = autoTeamName(api.team);
    const raw = api.root.querySelector('[data-act="name-prompt-input"]')?.value ?? api.namePromptValue ?? '';
    api.team = setTeamName(api.team, raw.trim() || suggested);
    api.namePromptOpen = false;
    promoteAndSaveTeam();
}

function showToast(msg) {
    api.toast = msg;
    clearTimeout(api.toastTimer);
    // `api` is reassigned on every mount() (e.g. loading a different saved
    // team). Without pinning the instance this timer fires against, leaving
    // the page within the 2.2s window would clear/repaint a team the user
    // already navigated away from.
    const self = api;
    api.toastTimer = setTimeout(() => {
        if (api !== self) return;
        api.toast = null;
        paint();
    }, 2200);
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
    on(root, 'click', '[data-act="toggle-openers"]', () => {
        api.deriveOpeners = !api.deriveOpeners;
        paint();
    });
    on(root, 'click', '[data-act="toggle-timing-mode"]', () => {
        api.timingMode = api.timingMode === 'toa' ? 'open' : 'toa';
        paint();
    });
    on(root, 'click', '[data-act="run-sim"]', () => paint());
    on(root, 'click', '[data-act="name-prompt-save"]', () => confirmNamePrompt());
    on(root, 'click', '[data-act="name-prompt-cancel"]', () => { api.namePromptOpen = false; paint(); });
    on(root, 'click', '[data-act="name-prompt-backdrop"]', () => { api.namePromptOpen = false; paint(); });
    on(root, 'click', '[data-act="name-prompt-stop"]', (e) => e.stopPropagation());
    on(root, 'keydown', '[data-act="name-prompt-input"]', (e) => {
        if (e.key === 'Enter') confirmNamePrompt();
        else if (e.key === 'Escape') { api.namePromptOpen = false; paint(); }
    });
    on(root, 'click', '[data-act="new-team"]', () => api.onNewTeam?.());
    on(root, 'click', '[data-act="save-team"]', () => saveTeamFlow());
    on(root, 'click', '[data-act="load-team"]', () => openLoadTeamPicker());
    on(root, 'click', '[data-act="delete-team"]', () => {
        if (confirm(`Delete team “${api.team?.name ?? ''}”?`)) api.onDeleteTeam?.(api.team.id);
    });
    on(root, 'click', '[data-act="open-member-build"]', (_e, el) => api.onOpenBuild?.(el.dataset.id));
    // Member sonata quick-switch — PREVIEW a different set for this resonator.
    // Keyed by build.id → override map; persistent on the page, never saved.
    on(root, 'click', '[data-act="member-sonata-quickswitch"]', (_e, el) => {
        const buildId = el.dataset.id;
        const effId = Number(el.dataset.eff);
        const origId = Number(el.dataset.orig);
        openSonataQuickswitch({
            anchorEl: el,
            sonatas: api.dataset.sonatas,
            currentId: effId,
            canReset: !!api.sonataOverrides?.[buildId],
            onPick: (picked) => {
                const map = normalizeSonataOverride({ [origId]: picked });
                const next = { ...(api.sonataOverrides ?? {}) };
                if (map) next[buildId] = map; else delete next[buildId];
                api.sonataOverrides = next;
                paint();
            },
            onReset: () => {
                const next = { ...(api.sonataOverrides ?? {}) };
                delete next[buildId];
                api.sonataOverrides = next;
                paint();
            },
        });
    });
    on(root, 'click', '[data-act="pick-resonator"]', (_e, el) => openSlotPicker(Number(el.dataset.slot)));
    on(root, 'click', '[data-act="remove-resonator"]', (_e, el) => {
        commitTeam(setTeamSlot(api.team, Number(el.dataset.slot), null));
    });
    on(root, 'click', '[data-act="v2-undo"]', () => undoTeam());
    on(root, 'click', '[data-act="v2-redo"]', () => redoTeam());
    on(root, 'click', '[data-act="pick-weapon"]', (_e, el) => openWeaponPickerForSlot(Number(el.dataset.slot)));
    on(root, 'click', '[data-act="toggle-group"]', (_e, el) => {
        const key = `${el.dataset.slot}_${el.dataset.key}`;
        const slotIndex = Number(el.dataset.slot);
        const rotLen = api.segBySlot.get(slotIndex)?.rotSteps?.length ?? 0;
        const current = api.expandedGroups[key] ?? (rotLen <= 6);
        api.expandedGroups[key] = !current;
        paint();
    });

    // Member-card drag-and-drop reorder — swaps slot positions (= rotation/
    // on-field order). Empty slots are valid drop targets (moves the member
    // there) but are not themselves draggable.
    on(root, 'dragstart', '[data-dnd-slot]', (e, el) => {
        e.dataTransfer.setData('text/plain', el.dataset.dndSlot);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('bv2-dnd-dragging');
    });
    on(root, 'dragend', '[data-dnd-slot]', (_e, el) => {
        el.classList.remove('bv2-dnd-dragging');
    });
    on(root, 'dragover', '[data-dnd-slot]', (e, el) => {
        e.preventDefault();
        el.classList.add('bv2-dnd-over');
    });
    on(root, 'dragleave', '[data-dnd-slot]', (_e, el) => {
        el.classList.remove('bv2-dnd-over');
    });
    on(root, 'drop', '[data-dnd-slot]', (e, el) => {
        e.preventDefault();
        el.classList.remove('bv2-dnd-over');
        const from = Number(e.dataTransfer.getData('text/plain'));
        const to = Number(el.dataset.dndSlot);
        if (Number.isFinite(from) && Number.isFinite(to) && from !== to) {
            commitTeam(swapTeamSlots(api.team, from, to));
        }
    });

    // Hover-box tooltip (element/sonata badges, see ../tooltip.js).
    bindTooltipHover(root, on);

    // Energy chart hover-scrub — getData reads api.result live on every
    // event (bind() runs once per mount(), but the sim result changes on
    // every RUN SIM click within the same mount).
    bindEnergyChartHover(root, on, () => ({
        members: energyChartMembers(),
        totalSpan: api.result && !api.result.empty ? api.result.totals.time : 0,
    }));
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
        onNewTeam: config.onNewTeam,
        onDeleteTeam: config.onDeleteTeam,
        onOpenBuild: config.onOpenBuild,
        // Undo/redo stack of team snapshots — fresh per mount (opening a team
        // starts empty). commitTeam() records; undoTeam()/redoTeam() walk it.
        history: createHistory(),
        theme: getV2Theme(),
        passCount: 1,
        // Openers OFF by default (maintainer call, 2026-07-31). Derived openers
        // pad a Liberation the energy gauge cannot cover with real filler casts,
        // which is the honest cold start but makes the headline number answer a
        // different question than the rotation the user actually wrote. The
        // OPENERS chip turns it on for the cold-start comparison.
        deriveOpeners: false,
        // Which clock the DPS denominator uses. 'toa' subtracts Liberation
        // freeze (the Tower-of-Adversity convention community figures use);
        // 'open' counts wall-clock time. See docs/TIMING_MODEL.md.
        timingMode: 'toa',
        expandedGroups: {},
        result: null,
        segBySlot: new Map(),
        // Transient sonata quick-switch previews, keyed by build.id → override
        // map (origSonataId → newSonataId). Persistent while on the page (try
        // different sets per resonator) but NEVER written to the build/team.
        sonataOverrides: {},
        toast: null,
        toastTimer: null,
        namePromptOpen: false,
        namePromptValue: '',
    };
    paint();
    if (!root.__partyBound) {
        root.__partyBound = true;
        bind();
        window.addEventListener('keydown', handleTeamUndoRedoKey);
    }
    return {
        update(team) { api.team = team; paint(); },
    };
}

// Pure helpers for tests (no DOM / no module state).
export const __test__ = {
    fmtDmg, fmtDps, fmtDur, donutGradient, donutTitle, segmentsBySlot, clockFor,
    buffStripsFor, segColor, sonataTooltipDesc, ELEM, DMG_COLOR, DMG_BADGE,
    ICON_SIZE, DONUT_SIZE, BADGE_ICON_SIZE,
};
