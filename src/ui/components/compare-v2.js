/**
 * Compare (COMPARE) — v2 page.
 *
 * Implements docs/design_handoff_wuwa_sim/compare page. Side-by-side
 * comparison of either up to 6 saved resonator builds or up to 3 saved teams.
 * A mode toggle switches the view; slots are managed via a chip strip (add
 * opens a picker overlay, remove pops the chip). Shares the v2 sticky header
 * (v2-header.js) and the `.bv2`-scoped design tokens (styles/build-v2.css).
 *
 *   mount(root, {
 *     dataset, theme,
 *     listBuilds() -> [build], listTeams() -> [team],
 *     resolveBuild(buildId) -> build|null,
 *     loadCompareState() -> { mode, buildSlots, teamSlots },
 *     saveCompareState(state),
 *     onOpenBuild(buildId),                  // resonator-icon click (both modes)
 *     saveTeam(team) -> team,                // team-member switch/remove (Teams mode)
 *     createBuildForResonator(resonator) -> build (created+saved),
 *   }) -> { update() }
 *
 * Per the handoff's own notes (§Notes for Implementation), this pulls real
 * saved builds/teams and runs the real sim engine rather than the
 * prototype's hardcoded sample data. Two deliberate deviations from the
 * literal spec, called out where the maintainer said the repo's own tokens
 * win: the element palette uses the repo's retuned hex values (not the
 * handoff's), and per-member "role" (DPS/SUB DPS/HEALER) is omitted — this
 * codebase has no role-classification data to back it, and CLAUDE.md's rule
 * against fabricating unbacked fields applies here.
 */

import { html, raw, render, on, esc } from '../dom.js';
import { renderV2Header } from './v2-header.js';
import { iconHtml } from '../icons.js';
import { bindTooltipHover } from '../tooltip.js';
import * as modal from './modal-picker.js';
import { resolveTotalStats } from '../../core/stats.js';
import { simulateRotation } from '../../core/sim.js';
import { simulateTeamRotation } from '../../core/team-sim.js';
import { resolveTeamSlots, setTeamSlot } from '../../core/team.js';

let api = null;

// Repo's canonical element palette (tokens.css) — wins over the handoff's
// per the maintainer's instruction this turn ("our tokens have priority").
const ELEM = {
    1: { name: 'Glacio', c: 'var(--el-glacio)' },
    2: { name: 'Fusion', c: 'var(--el-fusion)' },
    3: { name: 'Electro', c: 'var(--el-electro)' },
    4: { name: 'Aero', c: 'var(--el-aero)' },
    5: { name: 'Spectro', c: 'var(--el-spectro)' },
    6: { name: 'Havoc', c: 'var(--el-havoc)' },
};
const NO_ELEM = { name: '—', c: 'var(--faint)' };
// Element colour at a given alpha %, composed from the token (no hex suffixes).
const elemTint = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
const elemOf = (id) => ELEM[id] ?? NO_ELEM;

// Damage-category palette — matches the handoff's table exactly for the 5
// categories it lists, plus intro/outro (the sim produces these too; leaving
// them out would silently drop real damage from the breakdown).
const DMG_COLOR = {
    basic: 'var(--dmg-basic)', heavy: 'var(--dmg-heavy)', skill: 'var(--dmg-skill)',
    liberation: 'var(--dmg-liberation)', echo: 'var(--dmg-echo)', intro: 'var(--dmg-intro)', outro: 'var(--dmg-outro)',
};
const DMG_ORDER = ['basic', 'heavy', 'skill', 'liberation', 'echo', 'intro', 'outro'];

const TARGET = { level: 90, atkLv: 90, resistances: { 0: 0, 1: 0.1, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 } };
const MAX_BUILD_SLOTS = 6;
const MAX_TEAM_SLOTS = 3;

// ── Pure helpers (exported for tests) ───────────────────────────────────────

export function fmtDmg(n) {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(Math.round(n));
}
export function fmtDps(n) { return Number.isFinite(n) ? fmtDmg(n) + '/s' : '—'; }
export function fmtPct(n) { return Number.isFinite(n) ? n.toFixed(1) + '%' : '—'; }
export function fmtDur(n) { return Number.isFinite(n) ? n.toFixed(1) + 's' : '—'; }

/**
 * Per-cell best/delta/fill calculation — handoff §State Management's
 * mkCell algorithm, ported verbatim (best = max for higher-is-better stats,
 * min otherwise; fill bar fraction clamped to [0.05, 1]; delta is % below
 * the winning value).
 */
export function mkCell(value, maxVal, minVal, isHigherBetter) {
    const range = maxVal - minVal;
    const isBest = isHigherBetter
        ? (range < 0.001 || Math.abs(value - maxVal) < 0.001)
        : (range < 0.001 || Math.abs(value - minVal) < 0.001);
    const bestVal = isHigherBetter ? maxVal : minVal;
    const deltaPct = (!isBest && bestVal !== 0) ? ((value - bestVal) / Math.abs(bestVal) * 100) : 0;
    const normFrac = range > 0
        ? (isHigherBetter ? (value - minVal) / range : (maxVal - value) / range)
        : 1.0;
    return { isBest, fill: Math.max(0.05, normFrac), deltaPct };
}

/** The build's primary equipped sonata set — highest piece-count entry. */
export function primarySonata(stats, dataset) {
    const sonatas = Object.values(stats?.breakdown?.sonatas ?? {});
    if (!sonatas.length) return null;
    return sonatas.reduce((best, s) => (s.count > (best?.count ?? 0) ? s : best), null);
}

/** Aggregate a build's sim steps into damage-category totals, in DMG_ORDER. */
export function damageBreakdown(steps) {
    const cats = {};
    for (const s of steps ?? []) {
        if ((s.stepDamage ?? 0) > 0) cats[s.damageCategory] = (cats[s.damageCategory] ?? 0) + s.stepDamage;
    }
    const total = Object.values(cats).reduce((a, b) => a + b, 0);
    return DMG_ORDER.filter(k => cats[k]).map(k => ({ key: k, dmg: cats[k], pct: total > 0 ? cats[k] / total * 100 : 0 }));
}

/** Hover-box text for a build's primary sonata — only the tiers actually
 *  active at its current piece count (primarySonata()'s `activeTiers`). */
export function sonataTooltipDesc(sonata) {
    if (!sonata?.activeTiers?.length) return '';
    return sonata.activeTiers
        .slice().sort((a, b) => a.pieces - b.pieces)
        .filter(t => t.effect)
        .map(t => `${t.pieces}PC — ${t.effect}`)
        .join('\n');
}

// "ATK 587 · Crit. Rate 24.3%" — the weapon's resolved main/sub stat at its
// current level. Same convention as build-editor-v2.js's weaponStatsLine
// (duplicated locally — feature modules don't import each other's internals).
const WEAPON_STAT_KEY = {
    'ATK': 'atk', 'HP': 'hp', 'DEF': 'def',
    'Crit. Rate': 'critRate', 'Crit. DMG': 'critDmg', 'Energy Regen': 'energyRegen',
    'ATK%': 'atkPct', 'HP%': 'hpPct', 'DEF%': 'defPct',
};
function weaponStatsLine(wpn, level) {
    const byLevel = wpn?.statsByLevel;
    if (!byLevel) return '';
    const lv = byLevel[level] ? level : 90;
    const s = byLevel[lv];
    if (!s) return '';
    const parts = [`ATK ${Math.round(s.atk ?? 0)}`];
    const subKey = WEAPON_STAT_KEY[wpn.subStatName];
    if (subKey && s[subKey] != null) {
        const isFlat = subKey === 'atk' || subKey === 'hp' || subKey === 'def';
        parts.push(`${wpn.subStatName} ${isFlat ? Math.round(s[subKey]) : (Math.round(s[subKey] * 1000) / 10) + '%'}`);
    }
    return parts.join(' · ');
}

// Passive effect desc carries unsubstituted {n} placeholders filled per
// refinement rank (effectParams[n] is a 5-entry [R1..R5] array).
function weaponEffectDesc(wpn, rank) {
    if (!wpn?.effect) return '';
    const idx = Math.max(0, Math.min(4, (rank ?? 1) - 1));
    const filled = wpn.effect.replace(/\{(\d+)\}/g, (m, i) => wpn.effectParams?.[Number(i)]?.[idx] ?? m);
    return wpn.effectName ? `${wpn.effectName} — ${filled}` : filled;
}

export function weaponTooltipDesc(wpn, build) {
    const statsLine = weaponStatsLine(wpn, build?.weapon?.level ?? 1);
    const effectLine = weaponEffectDesc(wpn, build?.weapon?.rank ?? 1);
    return [statsLine, effectLine].filter(Boolean).join('\n\n');
}

// Hover-box tooltip (element/sonata/weapon info that doesn't fit inline) —
// showTooltip/hideTooltip/bindTooltipHover live in ../tooltip.js, shared
// with the build and team pages.

// ── Build/team row computation (real data + real sim) ───────────────────────

function computeBuildRow(build, dataset) {
    const reso = dataset.resonators.find(r => r.id === build.resonatorId);
    const stats = resolveTotalStats(build, dataset);
    const weapon = build.weapon ? dataset.weapons.find(w => w.id === build.weapon.id) : null;
    let sim = { totals: { damage: 0, dps: 0, time: 0 }, steps: [] };
    if (build.rotation?.length) {
        try { sim = simulateRotation({ build, dataset, target: TARGET }); } catch { /* leave zeroed */ }
    }
    const el = elemOf(reso?.element);
    return {
        build, reso, el, stats, weapon, sim,
        sonata: primarySonata(stats, dataset),
        elemDmg: (stats.dmgBonusByElement?.[reso?.element] ?? 0) * 100,
    };
}

function computeTeamRow(team, dataset, resolveBuild) {
    const slots = resolveTeamSlots(team, resolveBuild).filter(s => s.build != null);
    let result = { totals: { damage: 0, dps: 0, time: 0, heal: 0 }, memberTotals: [] };
    if (slots.length) {
        try { result = simulateTeamRotation({ team, resolveBuild, dataset, target: TARGET, passCount: 1 }); } catch { /* leave zeroed */ }
    }
    const members = result.memberTotals.map(m => {
        const reso = dataset.resonators.find(r => r.id === m.resonatorId);
        const stats = resolveBuild(m.buildId) ? resolveTotalStats(resolveBuild(m.buildId), dataset) : null;
        return { ...m, reso, el: elemOf(reso?.element), er: (stats?.energyRegen ?? 0) * 100 };
    });
    const accentColor = members[0]?.el?.c ?? 'var(--gold)';
    return { team, members, totals: result.totals, accentColor };
}

// ── Chip rendering (slot manager) ───────────────────────────────────────────

function slotChip(label, elementId, onRemoveAttr) {
    const el = elemOf(elementId);
    const color = el.c;
    return `
      <div style="display:inline-flex;align-items:center;gap:5px;font-family:var(--font-display);font-size:10px;letter-spacing:.4px;padding:5px 9px;border-radius:7px;background:${elemTint(color, 9)};border:1px solid ${elemTint(color, 27)};color:${color};">
        ${iconHtml('element', elementId, { label: el.name, size: 12 })}
        <span style="line-height:1;">${esc(label)}</span>
        <button data-act="${esc(onRemoveAttr)}" style="background:transparent;border:none;color:${elemTint(color, 60)};cursor:pointer;font-size:14px;line-height:1;padding:0 0 0 2px;margin-left:2px;">×</button>
      </div>`;
}

function addBtn(label, enabled, act) {
    const base = "display:inline-flex;align-items:center;font-family:var(--font-display);font-weight:700;font-size:10px;letter-spacing:.5px;padding:5px 11px;border-radius:7px;transition:all .12s;";
    const style = enabled
        ? base + "background:var(--inp);border:1px dashed var(--bd2);color:var(--faint);cursor:pointer;"
        : base + "background:var(--inp);border:1px solid var(--bd);color:var(--faint);opacity:.4;cursor:default;";
    return `<button data-act="${enabled ? act : ''}" style="${style}">${esc(label)}</button>`;
}

function renderSlotManager() {
    const isBuilds = api.mode === 'builds';
    if (isBuilds) {
        const used = new Set(api.buildSlots.filter(Boolean));
        const allBuilds = api.listBuilds();
        const emptySlot = api.buildSlots.indexOf(null);
        const hasUnused = allBuilds.some(b => !used.has(b.id));
        const canAdd = emptySlot >= 0 && hasUnused;
        const label = allBuilds.length === 0 ? 'NO SAVED BUILDS'
            : emptySlot < 0 ? `MAX  ${used.size}/${MAX_BUILD_SLOTS}`
                : !hasUnused ? 'ALL ADDED'
                    : `+ ADD BUILD  ${used.size}/${MAX_BUILD_SLOTS}`;
        const chips = api.buildSlots.map((id, si) => {
            if (!id) return '';
            const build = api.resolveBuild(id);
            if (!build) return '';
            const reso = api.dataset.resonators.find(r => r.id === build.resonatorId);
            return slotChip(reso?.name ?? '?', reso?.element, `rm-build:${si}`);
        }).join('');
        return `
          <span style="font-family:var(--font-display);font-size:8px;letter-spacing:1.3px;color:var(--faint);flex:none;margin-right:4px;">BUILDS</span>
          ${chips}
          ${addBtn(label, canAdd, 'add-build')}`;
    }
    const used = new Set(api.teamSlots.filter(Boolean));
    const allTeams = api.listTeams();
    const emptySlot = api.teamSlots.indexOf(null);
    const hasUnused = allTeams.some(t => !used.has(t.id));
    const canAdd = emptySlot >= 0 && hasUnused;
    const label = allTeams.length === 0 ? 'NO SAVED TEAMS'
        : emptySlot < 0 ? `MAX  ${used.size}/${MAX_TEAM_SLOTS}`
            : !hasUnused ? 'ALL ADDED'
                : `+ ADD TEAM  ${used.size}/${MAX_TEAM_SLOTS}`;
    const chips = api.teamSlots.map((id, si) => {
        if (!id) return '';
        const team = allTeams.find(t => t.id === id);
        if (!team) return '';
        const members = resolveTeamSlots(team, api.resolveBuild).filter(s => s.build);
        const firstReso = members.length ? api.dataset.resonators.find(r => r.id === members[0].build.resonatorId) : null;
        return slotChip(team.name, firstReso?.element, `rm-team:${si}`);
    }).join('');
    return `
      <span style="font-family:var(--font-display);font-size:8px;letter-spacing:1.3px;color:var(--faint);flex:none;margin-right:4px;">TEAMS</span>
      ${chips}
      ${addBtn(label, canAdd, 'add-team')}`;
}

// ── Stat cell rendering ──────────────────────────────────────────────────────

function statCell(value, maxVal, minVal, color, fmt, isHigherBetter, showDelta) {
    const { isBest, fill, deltaPct } = mkCell(value, maxVal, minVal, isHigherBetter);
    const badge = !showDelta ? '' : isBest ? '◆ BEST' : `${deltaPct.toFixed(0)}%`;
    const badgeColor = isBest ? 'var(--acc)' : (deltaPct < -15 ? 'var(--warn)' : 'var(--faint)');
    return `
      <div style="position:relative;flex:1;min-width:0;padding:11px 13px 10px;border-right:1px solid var(--bd);overflow:hidden;border-left:3px solid ${isBest ? color : 'transparent'};">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${(fill * 100).toFixed(1)}%;background:${elemTint(color, 8)};pointer-events:none;"></div>
        <span style="display:block;font-family:var(--font-display);font-weight:700;font-size:15px;color:${isBest ? color : 'var(--txt)'};line-height:1;">${esc(fmt(value))}</span>
        <span style="display:block;font-family:var(--font-display);font-size:8px;letter-spacing:.3px;margin-top:2px;color:${badgeColor};">${esc(badge)}</span>
      </div>`;
}

function dashCell() {
    return `<div style="flex:1;min-width:0;padding:11px 13px 10px;border-right:1px solid var(--bd);border-left:3px solid transparent;">
      <span style="font-family:var(--font-display);font-size:14px;color:var(--faint);">—</span></div>`;
}

// A row's value can be informational without implying "better" — e.g.
// Duration depends on rotation length/scope, not build quality, so it gets
// no fill bar, no best-border, and no delta badge (just the plain value).
function plainCell(value, fmt) {
    return `
      <div style="flex:1;min-width:0;padding:11px 13px 10px;border-right:1px solid var(--bd);border-left:3px solid transparent;">
        <span style="display:block;font-family:var(--font-display);font-weight:700;font-size:15px;color:var(--txt);line-height:1;">${esc(fmt(value))}</span>
      </div>`;
}

function statRow(label, cellsHtml) {
    return `
      <div style="display:flex;border-top:1px solid var(--bd);">
        <div style="flex:none;width:124px;padding:10px 14px;background:var(--card);border-right:1px solid var(--bd);display:flex;align-items:center;">
          <span style="font-family:var(--font-display);font-size:8.5px;letter-spacing:.8px;color:var(--faint);">${esc(label)}</span>
        </div>
        ${cellsHtml}
      </div>`;
}

function sectionBanner(label) {
    return `<div style="padding:5px 14px 4px;background:var(--node);border-top:1px solid var(--bd);">
      <span style="font-family:var(--font-display);font-size:7.5px;letter-spacing:1.8px;color:var(--faint);">${esc(label)}</span></div>`;
}

// ── Builds comparison table ──────────────────────────────────────────────────

function renderBuildHeaderRow(rows) {
    const cells = rows.map(r => {
        const { build, reso, el, weapon } = r;
        const weaponTip = weapon ? weaponTooltipDesc(weapon, build) : '';
        const sonataTip = r.sonata ? sonataTooltipDesc(r.sonata) : '';
        return `
          <div style="position:relative;flex:1;min-width:0;padding:14px 14px 12px;border-right:1px solid var(--bd);display:flex;flex-direction:column;gap:6px;">
            <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,${elemTint(el.c, 80)},transparent);"></div>
            <div style="display:flex;gap:10px;align-items:flex-start;">
              <div class="bv2-hover-target" style="position:relative;width:56px;height:56px;flex:none;">
                <button class="bv2-portrait" data-act="open-build" data-id="${esc(build.id)}" title="Open in Build Editor"
                        style="width:100%;height:100%;border-radius:10px;border:1.5px solid ${elemTint(el.c, 27)};cursor:pointer;padding:0;overflow:hidden;background:none;transition:border-color .12s;">
                  <img src="${esc(reso?.iconUrl ?? '')}" alt="${esc(reso?.name ?? '')}" style="width:100%;height:100%;object-fit:cover;">
                </button>
                <div class="bv2-hover-actions" style="position:absolute;top:-6px;right:-6px;display:flex;gap:4px;z-index:2;">
                  <span data-act="switch-build-slot" data-slot="${esc(String(r.slotIndex))}" title="Switch build" role="button" style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;border-radius:5px;border:1px solid var(--gold);background:var(--card2);color:var(--gold);flex:none;cursor:pointer;box-shadow:0 1px 5px rgba(var(--shadow-rgb),.5);">⇄</span>
                  <span data-act="rm-build-slot" data-slot="${esc(String(r.slotIndex))}" title="Remove" role="button" style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;border-radius:5px;border:1px solid var(--warn);background:var(--card2);color:var(--warn);flex:none;cursor:pointer;box-shadow:0 1px 5px rgba(var(--shadow-rgb),.5);">✕</span>
                </div>
              </div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-weight:700;font-size:14px;color:var(--txt);line-height:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(reso?.name ?? '?')}</div>
                <div style="display:flex;gap:5px;margin-top:4px;align-items:center;flex-wrap:wrap;">
                  <span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--font-display);font-size:9px;font-weight:600;letter-spacing:.4px;padding:2px 7px;border-radius:4px;background:${elemTint(el.c, 9)};color:${el.c};border:1px solid ${elemTint(el.c, 20)};">${iconHtml('element', reso?.element, { label: el.name, size: 11 })}${esc(el.name.toUpperCase())}</span>
                  <span style="font-family:var(--font-display);font-size:9px;color:var(--faint);">Lv.${esc(String(build.level))} · S${esc(String(build.chain ?? 0))}</span>
                </div>
              </div>
            </div>
            <div ${weapon ? `data-tip-title="${esc(weapon.name)}" data-tip-desc="${esc(weaponTip)}"` : ''} style="display:flex;align-items:baseline;gap:5px;cursor:${weapon ? 'default' : ''};">
              <span style="font-family:var(--font-body);font-size:10px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;">${weapon ? esc(weapon.name) : 'No weapon'}</span>
              ${weapon ? `<span style="font-family:var(--font-display);font-weight:700;font-size:9px;color:var(--gold);flex:none;">R${esc(String(build.weapon?.rank ?? 1))}</span>` : ''}
            </div>
            <div ${r.sonata ? `data-tip-title="${esc(r.sonata.name)}" data-tip-desc="${esc(sonataTip)}"` : ''} style="display:flex;align-items:center;gap:5px;cursor:${r.sonata ? 'default' : ''};">
              ${r.sonata
                ? iconHtml('sonata', r.sonata.name, { label: r.sonata.name, size: 14 })
                : `<span style="width:8px;height:8px;border-radius:2px;flex:none;background:var(--bd);"></span>`}
              <span style="font-family:var(--font-display);font-size:9px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.sonata ? esc(`${r.sonata.name} (${r.sonata.count}pc)`) : '—'}</span>
            </div>
            <button data-act="rm-build-slot" data-slot="${esc(String(r.slotIndex))}" style="position:absolute;top:10px;right:10px;width:22px;height:22px;border-radius:6px;background:var(--btn);border:1px solid var(--bd);color:var(--faint);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;">×</button>
          </div>`;
    }).join('');
    return `
      <div style="display:flex;border-bottom:1px solid var(--bd);">
        <div style="flex:none;width:124px;padding:14px 14px 12px;border-right:1px solid var(--bd);display:flex;align-items:flex-end;">
          <span style="font-family:var(--font-display);font-size:7.5px;letter-spacing:1.5px;color:var(--faint);">RESONATOR</span>
        </div>
        ${cells}
      </div>`;
}

function renderBuildStatRows(rows) {
    const showDelta = rows.length > 1;
    const mk = (label, getFn, fmt, higher) => {
        const vals = rows.map(getFn);
        const maxVal = Math.max(...vals), minVal = Math.min(...vals);
        const cells = rows.map((r, i) => statCell(vals[i], maxVal, minVal, r.el.c, fmt, higher, showDelta)).join('');
        return statRow(label, cells);
    };
    // Duration reflects the rotation's scope/length, not build quality — no
    // best/worse framing (see plainCell).
    const mkPlain = (label, getFn, fmt) => statRow(label, rows.map(r => plainCell(getFn(r), fmt)).join(''));
    return `
      ${sectionBanner('CORE STATS')}
      ${mk('ATK', r => r.stats.atk, v => v.toLocaleString(), true)}
      ${mk('CRIT RATE', r => r.stats.critRate * 100, fmtPct, true)}
      ${mk('CRIT DMG', r => r.stats.critDmg * 100, fmtPct, true)}
      ${mk('ENERGY REGEN', r => r.stats.energyRegen * 100, fmtPct, true)}
      ${mk('HP', r => r.stats.hp, v => v.toLocaleString(), true)}
      ${mk('DMG BONUS', r => r.elemDmg, fmtPct, true)}
      ${sectionBanner('SIMULATION')}
      ${mk('DPS', r => r.sim.totals.dps, fmtDps, true)}
      ${mk('TOTAL DMG', r => r.sim.totals.damage, fmtDmg, true)}
      ${mkPlain('DURATION', r => r.sim.totals.time, fmtDur)}
    `;
}

function renderBuildBreakdownRow(rows) {
    const cells = rows.map(r => {
        const segs = damageBreakdown(r.sim.steps);
        const bar = segs.map(s => `<div style="height:100%;flex:${s.pct.toFixed(2)};background:${DMG_COLOR[s.key]};" title="${esc(s.key)}: ${fmtDmg(s.dmg)} (${s.pct.toFixed(0)}%)"></div>`).join('');
        const legend = segs.map(s => `
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="width:6px;height:6px;border-radius:50%;background:${DMG_COLOR[s.key]};flex:none;"></span>
            <span style="font-family:var(--font-display);font-size:7.5px;letter-spacing:.3px;color:var(--faint);flex:1;min-width:0;">${esc(s.key.toUpperCase())}</span>
            <span style="font-family:var(--font-display);font-size:8px;font-weight:700;color:var(--dim);">${s.pct.toFixed(0)}%</span>
          </div>`).join('');
        return `
          <div style="flex:1;min-width:0;padding:12px 14px;border-right:1px solid var(--bd);">
            <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;gap:1.5px;margin-bottom:9px;">${bar || `<div style="height:100%;flex:1;background:var(--bd);"></div>`}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;">${legend}</div>
          </div>`;
    }).join('');
    return `
      ${sectionBanner('DAMAGE BREAKDOWN')}
      <div style="display:flex;border-top:1px solid var(--bd);">
        <div style="flex:none;width:124px;padding:12px 14px;background:var(--card);border-right:1px solid var(--bd);display:flex;align-items:center;">
          <span style="font-family:var(--font-display);font-size:8.5px;letter-spacing:.8px;color:var(--faint);">BY TYPE</span>
        </div>
        ${cells}
      </div>`;
}

function renderBuildsTable() {
    const rows = api.buildSlots
        .map((id, si) => (id ? { id, si } : null))
        .filter(Boolean)
        .map(({ id, si }) => {
            const build = api.resolveBuild(id);
            return build ? { ...computeBuildRow(build, api.dataset), slotIndex: si } : null;
        })
        .filter(Boolean);
    if (!rows.length) return '';
    return `
      <div style="position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -16px rgba(var(--shadow-rgb),.5);">
        <span style="position:absolute;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,var(--acc),transparent);opacity:.7;z-index:1;pointer-events:none;"></span>
        ${renderBuildHeaderRow(rows)}
        ${renderBuildStatRows(rows)}
        ${renderBuildBreakdownRow(rows)}
      </div>`;
}

// ── Teams comparison table ───────────────────────────────────────────────────

function renderTeamHeaderRow(rows) {
    const cells = rows.map(r => {
        // Mirrors Builds mode's enlarged-portrait + hover switch/remove: each
        // member gets a real resonator portrait (was a plain element-icon
        // pill); hovering reveals switch/remove for that team slot, clicking
        // opens the member's build page (reuses the existing "open-build"
        // action/handler — same module, no name collision to worry about).
        const memberChips = r.members.map(m => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:5px;">
            <div class="bv2-hover-target" style="position:relative;width:75px;height:75px;flex:none;">
              <button class="bv2-portrait" data-act="open-build" data-id="${esc(String(m.buildId))}" title="Open in Build Editor"
                      style="width:100%;height:100%;border-radius:10px;border:1.5px solid ${elemTint(m.el.c, 27)};cursor:pointer;padding:0;overflow:hidden;background:none;">
                <img src="${esc(m.reso?.iconUrl ?? '')}" alt="${esc(m.reso?.name ?? '')}" style="width:100%;height:100%;object-fit:cover;">
              </button>
              <div class="bv2-hover-actions" style="position:absolute;top:-6px;right:-6px;display:flex;gap:4px;z-index:2;">
                <span data-act="switch-team-member" data-slot="${esc(String(r.slotIndex))}" data-member="${esc(String(m.slotIndex))}" title="Switch" role="button" style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;border-radius:5px;border:1px solid var(--gold);background:var(--card2);color:var(--gold);flex:none;cursor:pointer;box-shadow:0 1px 5px rgba(var(--shadow-rgb),.5);">⇄</span>
                <span data-act="remove-team-member" data-slot="${esc(String(r.slotIndex))}" data-member="${esc(String(m.slotIndex))}" title="Remove" role="button" style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;border-radius:5px;border:1px solid var(--warn);background:var(--card2);color:var(--warn);flex:none;cursor:pointer;box-shadow:0 1px 5px rgba(var(--shadow-rgb),.5);">✕</span>
              </div>
            </div>
            <span style="font-family:var(--font-display);font-size:10px;color:${m.el.c};max-width:75px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;">${esc(m.reso?.name ?? '?')}</span>
          </div>`).join('');
        return `
          <div style="position:relative;flex:1;min-width:0;padding:14px 14px 12px;border-right:1px solid var(--bd);display:flex;flex-direction:column;gap:10px;">
            <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,${elemTint(r.accentColor, 80)},transparent);"></div>
            <div style="font-family:var(--font-display);font-weight:700;font-size:13px;color:var(--txt);padding-right:64px;line-height:1.3;">${esc(r.team.name)}</div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;">${memberChips}</div>
            <div style="position:absolute;top:10px;right:10px;display:flex;gap:6px;">
              <button data-act="switch-team-slot" data-slot="${esc(String(r.slotIndex))}" title="Switch team" style="width:22px;height:22px;border-radius:6px;background:var(--btn);border:1px solid var(--gold);color:var(--gold);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;">⇄</button>
              <button data-act="rm-team-slot" data-slot="${esc(String(r.slotIndex))}" title="Remove" style="width:22px;height:22px;border-radius:6px;background:var(--btn);border:1px solid var(--bd);color:var(--faint);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;">×</button>
            </div>
          </div>`;
    }).join('');
    return `
      <div style="display:flex;border-bottom:1px solid var(--bd);">
        <div style="flex:none;width:124px;padding:14px 14px 12px;border-right:1px solid var(--bd);display:flex;align-items:flex-end;">
          <span style="font-family:var(--font-display);font-size:7.5px;letter-spacing:1.5px;color:var(--faint);">TEAM</span>
        </div>
        ${cells}
      </div>`;
}

function renderTeamTotalsRows(rows) {
    const showDelta = rows.length > 1;
    const mk = (label, getFn, fmt, higher) => {
        const vals = rows.map(getFn);
        const nonZero = vals.filter(v => v > 0);
        if (!nonZero.length) return statRow(label, rows.map(dashCell).join(''));
        const maxVal = Math.max(...nonZero), minVal = Math.min(...nonZero);
        const cells = rows.map((r, i) => vals[i] > 0
            ? statCell(vals[i], maxVal, minVal, r.accentColor, fmt, higher, showDelta)
            : dashCell()).join('');
        return statRow(label, cells);
    };
    // Duration reflects the rotation's scope/length, not team quality — no
    // best/worse framing (see plainCell).
    const mkPlain = (label, getFn, fmt) => statRow(label, rows.map(r => {
        const v = getFn(r);
        return v > 0 ? plainCell(v, fmt) : dashCell();
    }).join(''));
    return `
      ${sectionBanner('TEAM TOTALS')}
      ${mk('TEAM DPS', r => r.totals.dps, fmtDps, true)}
      ${mk('TOTAL DMG', r => r.totals.damage, fmtDmg, true)}
      ${mkPlain('DURATION', r => r.totals.time, fmtDur)}
      ${mk('HEAL', r => r.totals.heal, fmtDmg, true)}
    `;
}

function renderTeamMemberRows(rows) {
    const maxSlots = Math.max(0, ...rows.map(r => r.members.length));
    const sections = [];
    for (let mi = 0; mi < maxSlots; mi++) {
        const allDmgs = rows.map(r => r.members[mi]?.damage ?? 0).filter(v => v > 0);
        const maxDmg = allDmgs.length ? Math.max(...allDmgs) : 0;
        const cells = rows.map(r => {
            const m = r.members[mi];
            if (!m) return `<div style="flex:1;min-width:0;padding:11px 13px 10px;border-right:1px solid var(--bd);border-left:3px solid transparent;background:var(--inp);">
                <span style="display:block;font-family:var(--font-display);font-size:13px;color:var(--faint);">—</span></div>`;
            const frac = maxDmg > 0 ? Math.max(0.05, m.damage / maxDmg) : 1.0;
            return `
              <div style="position:relative;flex:1;min-width:0;padding:11px 13px 9px;border-right:1px solid var(--bd);overflow:hidden;border-left:3px solid transparent;">
                <div style="position:absolute;left:0;top:0;bottom:0;width:${(frac * 100).toFixed(1)}%;background:${elemTint(m.el.c, 8)};pointer-events:none;"></div>
                <span style="display:block;font-family:var(--font-display);font-weight:700;font-size:13px;color:${m.el.c};line-height:1;">${esc(m.reso?.name ?? '?')}</span>
                <span style="display:block;font-family:var(--font-display);font-size:8px;color:var(--faint);margin-top:3px;">${fmtDmg(m.damage)} · ER ${m.er.toFixed(0)}%</span>
              </div>`;
        }).join('');
        sections.push(statRow(`SLOT ${mi + 1}`, cells));
    }
    return sections.join('');
}

function renderTeamShareRow(rows) {
    const cells = rows.map(r => {
        const total = r.totals.damage;
        const members = r.members.filter(m => m.damage > 0);
        const bar = members.map(m => `<div style="height:100%;flex:${(total > 0 ? m.damage / total : 0).toFixed(4)};background:${m.el.c};" title="${esc(m.reso?.name ?? '?')}: ${(total > 0 ? m.damage / total * 100 : 0).toFixed(1)}%"></div>`).join('');
        const legend = members.map(m => `
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="width:7px;height:7px;border-radius:50%;background:${m.el.c};flex:none;"></span>
            <span style="font-family:var(--font-display);font-size:9px;color:var(--dim);flex:1;">${esc(m.reso?.name ?? '?')}</span>
            <span style="font-family:var(--font-display);font-size:9px;font-weight:700;color:var(--txt);">${(total > 0 ? m.damage / total * 100 : 0).toFixed(0)}%</span>
          </div>`).join('');
        return `
          <div style="flex:1;min-width:0;padding:12px 14px;border-right:1px solid var(--bd);">
            <div style="display:flex;height:7px;border-radius:4px;overflow:hidden;gap:1px;margin-bottom:9px;">${bar || `<div style="height:100%;flex:1;background:var(--bd);"></div>`}</div>
            <div style="display:flex;flex-direction:column;gap:5px;">${legend}</div>
          </div>`;
    }).join('');
    return `
      ${sectionBanner('DAMAGE SHARE')}
      <div style="display:flex;border-top:1px solid var(--bd);">
        <div style="flex:none;width:124px;padding:12px 14px;background:var(--card);border-right:1px solid var(--bd);display:flex;align-items:center;">
          <span style="font-family:var(--font-display);font-size:8.5px;letter-spacing:.8px;color:var(--faint);">BY MEMBER</span>
        </div>
        ${cells}
      </div>`;
}

function renderTeamsTable() {
    const rows = api.teamSlots
        .map((id, si) => (id ? { id, si } : null))
        .filter(Boolean)
        .map(({ id, si }) => {
            const team = api.listTeams().find(t => t.id === id);
            return team ? { ...computeTeamRow(team, api.dataset, api.resolveBuild), slotIndex: si } : null;
        })
        .filter(Boolean);
    if (!rows.length) return '';
    return `
      <div style="position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -16px rgba(var(--shadow-rgb),.5);">
        <span style="position:absolute;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,var(--gold),transparent);opacity:.8;z-index:1;pointer-events:none;"></span>
        ${renderTeamHeaderRow(rows)}
        ${renderTeamTotalsRows(rows)}
        ${sectionBanner('PER MEMBER')}
        ${renderTeamMemberRows(rows)}
        ${renderTeamShareRow(rows)}
      </div>`;
}

// Floating builds/resonator selector for a single team member slot — same
// "old style" modal-picker used by Party's openSlotPicker, scoped here to one
// member of one compared team (switch hover button on a Teams-mode portrait).
function openTeamMemberPicker(compareSlotIndex, teamMemberSlotIndex) {
    const team = api.listTeams().find(t => t.id === api.teamSlots[compareSlotIndex]);
    if (!team) return;
    const builds = api.listBuilds();
    const usedIds = new Set(team.slots.filter(Boolean));
    const currentId = team.slots[teamMemberSlotIndex];
    const availableBuilds = builds.filter(b => !usedIds.has(b.id) || b.id === currentId);

    const buildItems = availableBuilds.map(b => {
        const r = api.dataset.resonators.find(x => x.id === b.resonatorId);
        return { kind: 'build', build: b, resonator: r, name: b.name, resoName: r?.name ?? '' };
    });
    const rosterItems = api.dataset.resonators.map(r => ({ kind: 'roster', resonator: r, name: r.name, resoName: r.name }));

    modal.open({
        title: `Team Slot ${teamMemberSlotIndex + 1}`,
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
        renderRow: (it) => {
            const r = it.resonator;
            const icon = r?.iconUrl
                ? `<img class="option__icon" src="${esc(r.iconUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
                : `<span class="option__icon option__icon--missing"></span>`;
            const sub = it.kind === 'build' ? `Saved build · Lv ${it.build.level}` : 'Roster · new build';
            const badge = it.kind === 'build' ? 'B' : 'R';
            return `${icon}
              <div class="option__body">
                <span class="option__name">${esc(it.name)}</span>
                <span class="option__sub">${esc(sub)}</span>
              </div>
              <span class="option__badge">${badge}</span>`;
        },
        onPick: (it) => {
            const buildId = it == null ? null : (it.kind === 'build' ? it.build.id : api.createBuildForResonator?.(it.resonator)?.id);
            const next = setTeamSlot(team, teamMemberSlotIndex, buildId ?? null);
            api.saveTeam?.(next);
            paint();
        },
    });
}

// ── Picker overlay ───────────────────────────────────────────────────────────

function renderPickerCard(kind, item) {
    if (kind === 'build') {
        const reso = api.dataset.resonators.find(r => r.id === item.resonatorId);
        const el = elemOf(reso?.element);
        const inUse = api.buildSlots.includes(item.id);
        const dps = (() => { try { return item.rotation?.length ? simulateRotation({ build: item, dataset: api.dataset, target: TARGET }).totals.dps : 0; } catch { return 0; } })();
        return `
          <div data-act="${inUse ? '' : 'pick-build'}" data-id="${esc(item.id)}"
               style="position:relative;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;background:var(--card2);border:1px solid ${inUse ? 'var(--bd)' : elemTint(el.c, 27)};cursor:${inUse ? 'default' : 'pointer'};opacity:${inUse ? '.45' : '1'};transition:all .12s;">
            <div style="position:absolute;top:0;left:0;right:0;height:2px;border-radius:12px 12px 0 0;background:linear-gradient(90deg,${elemTint(el.c, 80)},transparent);"></div>
            <div style="display:flex;gap:9px;align-items:flex-start;">
              <img src="${esc(reso?.iconUrl ?? '')}" alt="${esc(reso?.name ?? '')}" style="width:40px;height:40px;flex:none;border-radius:8px;object-fit:cover;border:1.5px solid ${elemTint(el.c, 27)};">
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-weight:700;font-size:13px;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(reso?.name ?? '?')} <span style="color:var(--faint);font-weight:400;font-size:11px;">${esc(item.name)}</span></div>
                <div style="display:flex;gap:5px;align-items:center;margin-top:3px;flex-wrap:wrap;">
                  <span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--font-display);font-size:8.5px;font-weight:600;padding:1px 6px;border-radius:3px;background:${elemTint(el.c, 9)};color:${el.c};border:1px solid ${elemTint(el.c, 20)};">${iconHtml('element', reso?.element, { label: el.name, size: 10 })}${esc(el.name.toUpperCase())}</span>
                  <span style="font-family:var(--font-display);font-weight:700;font-size:11px;color:var(--acc);">${esc(fmtDps(dps))}</span>
                </div>
              </div>
            </div>
            ${inUse ? `<span style="position:absolute;top:8px;right:8px;font-family:var(--font-display);font-size:7.5px;letter-spacing:.8px;color:var(--faint);background:var(--node);border:1px solid var(--bd);border-radius:4px;padding:2px 5px;">IN USE</span>` : ''}
          </div>`;
    }
    // team
    const members = resolveTeamSlots(item, api.resolveBuild).filter(s => s.build);
    const inUse = api.teamSlots.includes(item.id);
    const dots = members.map(s => {
        const reso = api.dataset.resonators.find(r => r.id === s.build.resonatorId);
        const el = elemOf(reso?.element);
        return `<span style="display:inline-flex;">${iconHtml('element', reso?.element, { label: el.name, size: 14 })}</span>`;
    }).join('');
    const chips = members.map(s => {
        const reso = api.dataset.resonators.find(r => r.id === s.build.resonatorId);
        const c = elemOf(reso?.element).c;
        return `<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--font-display);font-size:8px;padding:1px 5px;border-radius:3px;background:${elemTint(c, 9)};color:${c};border:1px solid ${elemTint(c, 20)};">${iconHtml('element', reso?.element, { label: elemOf(reso?.element).name, size: 10 })}${esc(reso?.name ?? '?')}</span>`;
    }).join('');
    const accent = members.length ? elemOf(api.dataset.resonators.find(r => r.id === members[0].build.resonatorId)?.element).c : 'var(--gold)';
    return `
      <div data-act="${inUse ? '' : 'pick-team'}" data-id="${esc(item.id)}"
           style="position:relative;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:var(--card2);border:1px solid ${inUse ? 'var(--bd)' : elemTint(accent, 27)};cursor:${inUse ? 'default' : 'pointer'};opacity:${inUse ? '.45' : '1'};transition:all .12s;">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;border-radius:12px 12px 0 0;background:linear-gradient(90deg,${elemTint(accent, 80)},transparent);"></div>
        <div style="display:flex;gap:3px;flex:none;">${dots}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--font-display);font-weight:700;font-size:12px;color:var(--txt);">${esc(item.name)}</div>
          <div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;">${chips}</div>
        </div>
        ${inUse ? `<span style="font-family:var(--font-display);font-size:7.5px;letter-spacing:.8px;color:var(--faint);background:var(--node);border:1px solid var(--bd);border-radius:4px;padding:2px 5px;flex:none;">IN USE</span>` : ''}
      </div>`;
}

function renderPicker() {
    if (!api.pickerOpen) return '';
    const isBuilds = api.mode === 'builds';
    const items = isBuilds ? api.listBuilds() : api.listTeams();
    const title = isBuilds ? 'SELECT BUILD' : 'SELECT TEAM';
    const gridStyle = isBuilds
        ? 'padding:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;overflow-y:auto;'
        : 'padding:16px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;';
    const empty = `<div style="padding:40px 16px;text-align:center;font-family:var(--font-body);font-size:12px;color:var(--faint);">${isBuilds ? 'No saved builds yet.' : 'No saved teams yet.'}</div>`;
    const body = items.length ? items.map(it => renderPickerCard(isBuilds ? 'build' : 'team', it)).join('') : empty;
    return `
      <div data-act="picker-backdrop" style="position:fixed;inset:0;z-index:50;background:rgba(var(--shadow-rgb),.72);display:flex;align-items:center;justify-content:center;padding:24px;">
        <div data-act="picker-stop" style="background:var(--card);border:1px solid var(--bd2);border-radius:18px;width:100%;max-width:740px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(var(--shadow-rgb),.85);">
          <div style="display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--bd);flex:none;">
            <span style="width:3px;height:18px;background:var(--acc);border-radius:2px;flex:none;box-shadow:0 0 8px var(--acc);"></span>
            <span style="font-family:var(--font-display);font-weight:700;font-size:13px;letter-spacing:1.5px;color:var(--txt);">${title}</span>
            <div style="flex:1;"></div>
            <button data-act="close-picker" style="width:28px;height:28px;border-radius:8px;background:var(--btn);border:1px solid var(--bd);color:var(--dim);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;">×</button>
          </div>
          <div style="${gridStyle}">${body}</div>
        </div>
      </div>`;
}

// ── Page shell ────────────────────────────────────────────────────────────────

// "cmp-mode", not "mode" — build-editor-v2.js's Resonance Mode buttons
// already use a bare `data-act="mode"` on the same persistent #main root, and
// since neither page ever unbinds its click listeners, a stale handler from
// an earlier Build visit would otherwise fire too and repaint the Build page
// over Compare on every click.
function renderModeToggle() {
    const chip = (key, label) => {
        const on = api.mode === key;
        const style = "font-family:var(--font-display);font-weight:700;font-size:11px;letter-spacing:.9px;padding:6px 16px;border-radius:7px;cursor:pointer;transition:all .12s;border:none;"
            + (on ? "background:var(--acc);color:var(--on-acc);" : "background:transparent;color:var(--dim);");
        return `<button data-act="cmp-mode" data-val="${key}" style="${style}">${label}</button>`;
    };
    return `<div style="display:flex;gap:4px;background:var(--node);border:1px solid var(--bd);border-radius:10px;padding:3px;">${chip('builds', 'BUILDS')}${chip('teams', 'TEAMS')}</div>`;
}

function renderTitleRow() {
    return `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="width:4px;height:22px;background:var(--acc);border-radius:3px;box-shadow:0 0 10px var(--acc);flex:none;"></div>
        <span style="font-family:var(--font-display);font-weight:700;font-size:16px;letter-spacing:2px;color:var(--txt);">COMPARE</span>
        <div style="flex:1;height:1px;background:var(--bd);margin:0 4px;min-width:20px;"></div>
        ${renderModeToggle()}
      </div>`;
}

function renderEmptyState() {
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:80px 20px;color:var(--faint);">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"></path></svg>
        <span style="font-family:var(--font-display);font-size:13px;letter-spacing:1.5px;color:var(--dim);">NOTHING TO COMPARE</span>
        <span style="font-family:var(--font-body);font-size:12px;color:var(--faint);">Add entries using the slot manager above</span>
      </div>`;
}

function renderPage() {
    const isBuilds = api.mode === 'builds';
    const hasBuilds = api.buildSlots.some(Boolean);
    const hasTeams = api.teamSlots.some(Boolean);
    const showEmpty = isBuilds ? !hasBuilds : !hasTeams;

    return html`
      <div class="bv2" data-theme="${api.theme}">
        ${raw(renderV2Header({ active: 'compare', theme: api.theme }))}
        <div style="max-width:1280px;margin:0 auto;padding:28px 24px 60px;display:flex;flex-direction:column;gap:16px;">
          ${raw(renderTitleRow())}
          <div style="background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:11px 16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:52px;">
            ${raw(renderSlotManager())}
          </div>
          ${raw(showEmpty ? renderEmptyState() : (isBuilds ? renderBuildsTable() : renderTeamsTable()))}
        </div>
        ${raw(renderPicker())}
      </div>`;
}

function paint() {
    render(api.root, renderPage());
}

function persist() {
    api.saveCompareState?.({ mode: api.mode, buildSlots: api.buildSlots, teamSlots: api.teamSlots });
}

// ── Events ────────────────────────────────────────────────────────────────────

function bind() {
    const root = api.root;
    on(root, 'click', '[data-act="cmp-mode"]', (_e, el) => { api.mode = el.dataset.val; persist(); paint(); });
    on(root, 'click', '[data-act="add-build"]', () => { api.pickerOpen = true; paint(); });
    on(root, 'click', '[data-act="add-team"]', () => { api.pickerOpen = true; paint(); });
    on(root, 'click', '[data-act^="rm-build:"]', (_e, el) => {
        const si = Number(el.dataset.act.split(':')[1]);
        api.buildSlots[si] = null; persist(); paint();
    });
    on(root, 'click', '[data-act^="rm-team:"]', (_e, el) => {
        const si = Number(el.dataset.act.split(':')[1]);
        api.teamSlots[si] = null; persist(); paint();
    });
    on(root, 'click', '[data-act="rm-build-slot"]', (_e, el) => {
        api.buildSlots[Number(el.dataset.slot)] = null; persist(); paint();
    });
    on(root, 'click', '[data-act="rm-team-slot"]', (_e, el) => {
        api.teamSlots[Number(el.dataset.slot)] = null; persist(); paint();
    });
    // Per-member switch/remove (Teams mode hover overlay) — mutates and
    // saves the underlying team itself, not the compare slot (mirrors
    // Party's pick-reso/remove-reso, scoped to whichever team is in this
    // compare slot).
    on(root, 'click', '[data-act="switch-team-member"]', (_e, el) => {
        openTeamMemberPicker(Number(el.dataset.slot), Number(el.dataset.member));
    });
    on(root, 'click', '[data-act="remove-team-member"]', (_e, el) => {
        const compareSlot = Number(el.dataset.slot);
        const memberSlot = Number(el.dataset.member);
        const team = api.listTeams().find(t => t.id === api.teamSlots[compareSlot]);
        if (!team) return;
        api.saveTeam?.(setTeamSlot(team, memberSlot, null));
        paint();
    });
    // Switch (hover overlay on a row's resonator icon) opens the same picker
    // as "+ ADD BUILD" but targets this specific occupied slot instead of
    // the first empty one.
    on(root, 'click', '[data-act="switch-build-slot"]', (_e, el) => {
        api.pickerTargetSlot = Number(el.dataset.slot);
        api.pickerOpen = true; paint();
    });
    on(root, 'click', '[data-act="pick-build"]', (_e, el) => {
        const target = api.pickerTargetSlot ?? api.buildSlots.indexOf(null);
        if (target >= 0) api.buildSlots[target] = el.dataset.id;
        api.pickerTargetSlot = null;
        api.pickerOpen = false; persist(); paint();
    });
    // Switch (top-right of a team card, next to "×") opens the same picker
    // as "+ ADD TEAM" but targets this specific occupied slot instead of
    // the first empty one — mirrors switch-build-slot above.
    on(root, 'click', '[data-act="switch-team-slot"]', (_e, el) => {
        api.pickerTargetSlot = Number(el.dataset.slot);
        api.pickerOpen = true; paint();
    });
    on(root, 'click', '[data-act="pick-team"]', (_e, el) => {
        const target = api.pickerTargetSlot ?? api.teamSlots.indexOf(null);
        if (target >= 0) api.teamSlots[target] = el.dataset.id;
        api.pickerTargetSlot = null;
        api.pickerOpen = false; persist(); paint();
    });
    on(root, 'click', '[data-act="close-picker"]', () => { api.pickerTargetSlot = null; api.pickerOpen = false; paint(); });
    on(root, 'click', '[data-act="picker-backdrop"]', () => { api.pickerTargetSlot = null; api.pickerOpen = false; paint(); });
    on(root, 'click', '[data-act="picker-stop"]', (e) => e.stopPropagation());
    on(root, 'click', '[data-act="open-build"]', (_e, el) => api.onOpenBuild?.(el.dataset.id));

    // Hover-box tooltip (element/sonata/weapon info, see ../tooltip.js).
    bindTooltipHover(root, on);
}

// ── Public mount ──────────────────────────────────────────────────────────────

export function mount(root, config) {
    const saved = config.loadCompareState?.() ?? { mode: 'builds', buildSlots: Array(6).fill(null), teamSlots: Array(3).fill(null) };
    api = {
        root,
        dataset: config.dataset,
        theme: config.theme ?? 'dark',
        listBuilds: config.listBuilds,
        listTeams: config.listTeams,
        resolveBuild: config.resolveBuild,
        saveCompareState: config.saveCompareState,
        onOpenBuild: config.onOpenBuild,
        saveTeam: config.saveTeam,
        createBuildForResonator: config.createBuildForResonator,
        mode: saved.mode,
        buildSlots: saved.buildSlots,
        teamSlots: saved.teamSlots,
        pickerOpen: false,
        pickerTargetSlot: null,
    };
    paint();
    // Re-mounting (revisiting #compare) must not restack listeners on the
    // persistent #main root — same guard as team-editor-v2.js's __partyBound.
    if (root.__compareBound) return { update: () => paint() };
    root.__compareBound = true;
    bind();
    return { update: () => paint() };
}

export const __test__ = { ELEM, DMG_COLOR, DMG_ORDER, TARGET };
