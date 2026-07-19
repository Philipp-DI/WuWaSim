/**
 * Echo Picker (v2) — custom search/filter overlay for choosing an echo.
 *
 * Implements docs/design_handoff_wuwa_sim/echo picker/README_echo_picker.md.
 * A body-appended full-screen overlay (so it escapes the build page's scroll
 * and overflow), scoped under `.bv2[data-theme]` so it reuses the v2 design
 * tokens and follows the active theme. Presentation-only: the caller supplies a
 * fully-prepared item list + sonata list and receives the chosen item back via
 * onPick — no dataset knowledge lives here.
 *
 *   open({
 *     slotIndex,                 // 0-based; shown as "· Slot N+1"
 *     theme,                     // 'dark' | 'light'
 *     items,                     // [{ id, name, cost, elem, sonataIds[], iconUrl, skill, desc, starLevel }]
 *     sonatas,                   // [{ id, name }] — chips + name/icon lookup (only sets present in items)
 *     onPick(item, { sonataFilter }), // chosen echo item; sonataFilter is the
 *                                // sonata id the grid was filtered to, or null
 *   })
 *
 * Filters (cost / element / sonata / search) are AND-combined. Opening always
 * resets every filter to "all" and clears the search (handoff §State).
 */

import { esc } from '../dom.js';
import { iconHtml, dynamicIconHtml } from '../icons.js';
import { formatTipDesc } from '../tip-format.js';

// Fixed game enum (id → label + final handoff colour). Element ids 1–6.
const ELEMENTS = {
    1: { name: 'Glacio',  color: 'var(--el-glacio)' },
    2: { name: 'Fusion',  color: 'var(--el-fusion)' },
    3: { name: 'Electro', color: 'var(--el-electro)' },
    4: { name: 'Aero',    color: 'var(--el-aero)' },
    5: { name: 'Spectro', color: 'var(--el-spectro)' },
    6: { name: 'Havoc',   color: 'var(--el-havoc)' },
};
// Element chip order per the handoff (Aero, Electro, Fusion, Glacio, Spectro, Havoc).
const ELEMENT_ORDER = [4, 3, 2, 1, 5, 6];

let host = null;     // body-appended overlay root
let state = null;    // { slotIndex, items, sonatas, sonataById, onPick, search, costF, elemF, sonataF, theme }

function ensureHost() {
    if (host) return host;
    host = document.createElement('div');
    document.body.appendChild(host);
    return host;
}

// ── Filtering (pure; AND-combined, handoff §State) ───────────────────────────
export function filterEchoes(items, { costF = 'all', elemF = 'all', sonataF = 'all', search = '' } = {}) {
    const q = String(search).trim().toLowerCase();
    return (items ?? []).filter(it => {
        if (costF !== 'all' && it.cost !== costF) return false;
        if (elemF !== 'all' && it.elem !== elemF) return false;
        if (sonataF !== 'all' && !(it.sonataIds ?? []).includes(sonataF)) return false;
        if (q && !it.name.toLowerCase().includes(q)) return false;
        return true;
    });
}
function filteredItems() {
    return filterEchoes(state.items, state);
}

// ── Chip rendering ───────────────────────────────────────────────────────────
const CHIP_BASE = "display:inline-flex;align-items:center;gap:4px;border-radius:6px;font-family:var(--font-display);cursor:pointer;white-space:nowrap;transition:all .12s;flex:none;padding:3px 9px;";

function costChip(value, label) {
    const active = state.costF === value;
    const style = CHIP_BASE + 'font-size:10.5px;font-weight:700;letter-spacing:.3px;'
        + (active
            ? 'border:1px solid var(--acc);background:color-mix(in srgb, var(--acc) 14%, transparent);color:var(--acc);'
            : 'border:1px solid var(--bd);background:var(--inp);color:var(--dim);');
    return `<button data-ep="cost" data-val="${esc(String(value))}" style="${style}">${esc(label)}</button>`;
}

function elemChip(value, label, color) {
    const active = state.elemF === value;
    let style = CHIP_BASE + 'font-size:9px;letter-spacing:.6px;';
    if (!active) {
        style += 'border:1px solid var(--bd);background:var(--inp);color:var(--dim);';
    } else if (value === 'all') {
        style += 'border:1px solid var(--acc);background:color-mix(in srgb, var(--acc) 14%, transparent);color:var(--acc);';
    } else {
        style += `border:1px solid color-mix(in srgb, ${color} 60%, transparent);background:color-mix(in srgb, ${color} 16%, transparent);color:${color};`;
    }
    const dot = (active && color)
        ? `<span style="width:7px;height:7px;border-radius:50%;background:${color};box-shadow:0 0 5px color-mix(in srgb, ${color} 53%, transparent);flex:none;"></span>`
        : '';
    return `<button data-ep="elem" data-val="${esc(String(value))}" style="${style}">${dot}${esc(label)}</button>`;
}

function sonataChip(so) {
    // `so` is { id, name, desc } for a real set, or null for the "ALL SETS" chip.
    const value = so ? so.id : 'all';
    const label = so ? so.name : 'ALL SETS';
    const active = state.sonataF === value;
    const style = CHIP_BASE + 'font-size:9px;letter-spacing:.7px;'
        + (active
            ? 'border:1px solid var(--acc);background:color-mix(in srgb, var(--acc) 14%, transparent);color:var(--acc);'
            : 'border:1px solid var(--bd);background:var(--inp);color:var(--dim);');
    const icon = so ? iconHtml('sonata', so.name, { label: so.name, size: 14 }) : '';
    // Set-detail hover-box lives on the filter chip (handoff fix): hovering a
    // sonata chip shows its 2PC/5PC bonuses. Echo cards deliberately do NOT
    // repeat this — their hover-box is the echo's active skill only.
    const tip = so?.desc ? ` data-tip-title="${esc(so.name)}" data-tip-desc="${esc(so.desc)}"` : '';
    return `<button data-ep="sonata" data-val="${esc(String(value))}"${tip} style="${style}">${icon}${esc(label)}</button>`;
}

const LABEL_STYLE = "font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);flex:none;";

// Non-interactive element sub-header for a sonata category row. `key` is an
// element id (1–6) or 'other' for non-elemental sets.
function sonataGroupLabel(key) {
    if (key === 'other') {
        return `<span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--faint);">OTHER</span>`;
    }
    const el = ELEMENTS[key];
    return `<span style="display:inline-flex;align-items:center;gap:3px;font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:${el.color};"><span style="width:6px;height:6px;border-radius:50%;background:${el.color};flex:none;"></span>${esc(el.name.toUpperCase())}</span>`;
}

// Present sonatas grouped by element, in ELEMENT_ORDER then 'other' last.
function groupSonatasByElement() {
    const groups = new Map();
    for (const s of state.sonatas) {
        const key = s.elem ?? 'other';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
    }
    const keys = [...ELEMENT_ORDER.filter(id => groups.has(id)), ...(groups.has('other') ? ['other'] : [])];
    return keys.map(key => ({ key, sets: groups.get(key) }));
}

function renderFilterBar() {
    const costChips = [costChip('all', 'ALL'), costChip(4, '4'), costChip(3, '3'), costChip(1, '1')].join('');
    const elemChips = [elemChip('all', 'ALL', null),
        ...ELEMENT_ORDER.map(id => elemChip(id, ELEMENTS[id].name.toUpperCase(), ELEMENTS[id].color))].join('');
    // Sonata filter, grouped by element: the "All Sets" chip sits on the title
    // line; each element category gets its own left-aligned row below, so a new
    // category always starts on a fresh line (never mid-row between sets). The
    // sub-header sits in a fixed-width left column so every category's chips
    // line up.
    const groupRows = groupSonatasByElement().map(({ key, sets }) => `
        <div style="display:flex;align-items:flex-start;gap:8px;">
          <span style="width:62px;flex:none;padding-top:4px;">${sonataGroupLabel(key)}</span>
          <div style="flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:4px;">${sets.map(sonataChip).join('')}</div>
        </div>`).join('');

    return `
      <div style="flex:none;padding:10px 20px;border-bottom:1px solid var(--bd);display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="${LABEL_STYLE}">COST</span>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">${costChips}</div>
          <span style="width:1px;height:16px;background:var(--bd);flex:none;margin:0 3px;"></span>
          <span style="${LABEL_STYLE}">ELEMENT</span>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">${elemChips}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="${LABEL_STYLE}">SONATA</span>
            ${sonataChip(null)}
            <span style="flex:1;min-width:0;"></span>
            <span data-region="ep-count" style="font-family:var(--font-body);font-size:10px;color:var(--faint);flex:none;white-space:nowrap;"></span>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">${groupRows}</div>
        </div>
      </div>`;
}

// ── Card grid ────────────────────────────────────────────────────────────────
function renderCard(it) {
    const el = ELEMENTS[it.elem];
    const color = el?.color ?? 'var(--acc)';
    const art = `background:radial-gradient(circle at 55% 40%,color-mix(in srgb, ${color} 31%, transparent) 0%,transparent 70%),linear-gradient(145deg,var(--card2),var(--page));`;
    // Show every set this echo can belong to, as crests (no text — the set
    // names already read in the SONATA filter line above).
    const sonataIcons = (it.sonataIds ?? [])
        .map(sid => state.sonataById.get(sid))
        .filter(Boolean)
        .map(so => iconHtml('sonata', so.name, { label: so.name, size: 15 }))
        .join('');

    // Hover-box = the echo's active skill only (handoff fix). Generic
    // data-tip-* so it shares the picker's single tooltip + §I highlighting.
    return `
      <button class="bv2-ep-card" data-ep="pick" data-id="${esc(String(it.id))}"
              data-tip-title="${esc(it.skill || it.name)}" data-tip-desc="${esc(it.desc || '')}"
              style="display:flex;flex-direction:row;align-items:stretch;min-height:62px;background:var(--inp);border:1px solid var(--bd);border-radius:10px;cursor:pointer;overflow:hidden;padding:0;text-align:left;font:inherit;">
        <div style="width:62px;height:62px;flex:none;border-right:1px solid var(--bd);overflow:hidden;${art}display:flex;align-items:center;justify-content:center;position:relative;">
          ${dynamicIconHtml(it.iconUrl, { label: it.name, size: 62, className: 'bv2-ep-art' })}
          <span class="bv2-ep-cost">${esc(String(it.cost))}</span>
        </div>
        <div style="flex:1;min-width:0;padding:7px 10px;display:flex;flex-direction:column;justify-content:center;gap:3px;">
          <div style="font-family:var(--font-display);font-weight:700;font-size:10.5px;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(it.name)}</div>
          <div style="display:flex;align-items:center;gap:3px;min-width:0;min-height:15px;">${sonataIcons}</div>
          <span style="font-family:var(--font-body);font-size:9.5px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(it.skill || '')}</span>
        </div>
      </button>`;
}

function renderGridInner(filtered) {
    if (filtered.length === 0) {
        return `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;gap:10px;padding:48px 0;color:var(--faint);">
          <span style="font-size:28px;line-height:1;">⊘</span>
          <span style="font-family:var(--font-body);font-size:13px;">No echoes match this filter.</span>
        </div>`;
    }
    return filtered.map(renderCard).join('');
}

function countHtml(filteredLen) {
    return `${filteredLen}<span style="color:var(--nodebd);"> / ${state.items.length}</span> echoes`;
}

// Refresh only the grid + count (used on search input, to keep input focus).
function refreshResults() {
    const filtered = filteredItems();
    const grid = host.querySelector('[data-region="ep-grid"]');
    const count = host.querySelector('[data-region="ep-count"]');
    if (grid) grid.innerHTML = renderGridInner(filtered);
    if (count) count.innerHTML = countHtml(filtered.length);
}

function renderPanel() {
    const filtered = filteredItems();
    return `
      <div data-ep="backdrop" style="position:fixed;inset:0;z-index:60;background:rgba(var(--scrim-rgb),.75);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:24px;">
        <div data-ep="panel" style="width:min(980px,96vw);max-height:88vh;background:var(--card);border:1px solid var(--bd2);border-radius:18px;box-shadow:0 40px 120px -20px rgba(var(--shadow-rgb),.9);display:flex;flex-direction:column;overflow:hidden;">
          <div style="flex:none;display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--bd);">
            <div style="width:4px;height:20px;background:var(--acc);border-radius:3px;box-shadow:0 0 8px var(--acc);flex:none;"></div>
            <span style="font-family:var(--font-display);font-weight:700;font-size:15px;letter-spacing:1.5px;color:var(--txt);">SELECT ECHO</span>
            <span style="font-family:var(--font-display);font-size:10px;letter-spacing:.5px;color:var(--faint);">· Slot ${state.slotIndex + 1}</span>
            <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
              <input data-ep="search" type="text" value="${esc(state.search)}" placeholder="Search…" autocomplete="off" spellcheck="false"
                     style="height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--bd);background:var(--inp);font-family:var(--font-body);font-size:12px;color:var(--txt);width:150px;outline:none;">
              <button data-ep="close" style="width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;background:var(--inp);border:1px solid var(--bd);border-radius:8px;color:var(--dim);cursor:pointer;font-size:15px;">✕</button>
            </div>
          </div>
          ${renderFilterBar()}
          <div class="bv2-ep-grid" data-region="ep-grid" style="flex:1;overflow-y:auto;padding:10px 14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:5px;align-content:start;">
            ${renderGridInner(filtered)}
          </div>
        </div>
      </div>`;
}

function paint() {
    host.innerHTML = renderPanel();
    // innerHTML reset above removed the tooltip node — drop the stale reference
    // so the next hover recreates it (else the tip silently stops working after
    // any filter click, which rebuilds the panel).
    host.__tip = null;
    const count = host.querySelector('[data-region="ep-count"]');
    if (count) count.innerHTML = countHtml(filteredItems().length);
}

// ── Hover-box (shared by echo cards and sonata filter chips) ─────────────────
// Reads data-tip-title / data-tip-desc off the hovered element and reuses the
// §I formatter so element names + percentages are highlighted, matching every
// other v2 hover-box. Appended to `host` (inside .bv2) so var(--*) tokens and
// the active theme resolve.
function ensureTip() {
    if (host.__tip) return host.__tip;
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;z-index:70;width:260px;background:var(--popover-bg-2);border:1px solid var(--bd2);border-radius:11px;padding:13px 15px;box-shadow:0 12px 40px rgba(var(--shadow-rgb),.7);pointer-events:none;display:none;';
    host.appendChild(t);
    host.__tip = t;
    return t;
}
function showTip(el) {
    const title = el.dataset.tipTitle || '';
    const desc = el.dataset.tipDesc || '';
    if (!title && !desc) return;
    const t = ensureTip();
    t.innerHTML = `<div style="font-family:var(--font-display);font-weight:700;font-size:12px;color:var(--acc);margin-bottom:4px;">${esc(title)}</div>`
        + (desc ? `<div style="font-family:var(--font-body);font-size:11px;color:var(--dim);line-height:1.55;">${formatTipDesc(esc(desc))}</div>` : '');
    const r = el.getBoundingClientRect();
    t.style.display = 'block';
    const margin = 12;
    const left = Math.min(r.left, window.innerWidth - 260 - margin);
    t.style.left = Math.round(Math.max(margin, left)) + 'px';
    t.style.top = Math.round(r.bottom + 8) + 'px';
}
function hideTip() { if (host.__tip) host.__tip.style.display = 'none'; }

// ── Events (delegated, bound once on the host) ──────────────────────────────
function bindOnce() {
    if (host.__bound) return;
    host.__bound = true;

    host.addEventListener('click', (e) => {
        const t = e.target.closest('[data-ep]');
        if (!t) return;
        const kind = t.dataset.ep;
        if (kind === 'backdrop') { close(); return; }
        if (kind === 'close') { close(); return; }
        if (kind === 'panel') { e.stopPropagation(); return; }
        if (kind === 'cost')   { state.costF   = t.dataset.val === 'all' ? 'all' : Number(t.dataset.val); paint(); return; }
        if (kind === 'elem')   { state.elemF   = t.dataset.val === 'all' ? 'all' : Number(t.dataset.val); paint(); return; }
        if (kind === 'sonata') { state.sonataF = t.dataset.val === 'all' ? 'all' : Number(t.dataset.val); paint(); return; }
        if (kind === 'pick') {
            const item = state.items.find(it => String(it.id) === t.dataset.id);
            const pick = state.onPick;
            // Captured BEFORE close() tears state down. The caller uses it to
            // equip the echo with the set the user was actually filtering for.
            const sonataFilter = state.sonataF === 'all' ? null : state.sonataF;
            close();
            if (item && pick) pick(item, { sonataFilter });
        }
    });

    host.addEventListener('input', (e) => {
        const inp = e.target.closest('[data-ep="search"]');
        if (!inp) return;
        state.search = inp.value;
        refreshResults();
    });

    host.addEventListener('mouseover', (e) => {
        const el = e.target.closest('[data-tip-title]');
        if (el) showTip(el);
    });
    host.addEventListener('mouseout', (e) => {
        const el = e.target.closest('[data-tip-title]');
        if (el && !el.contains(e.relatedTarget)) hideTip();
    });

    host.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    // Escape works even when focus is outside the input (host isn't focusable
    // by default, so also listen at document level while open).
    host.__keyHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', host.__keyHandler, true);
}

export function open({ slotIndex, theme = 'dark', items, sonatas, onPick }) {
    ensureHost();
    host.className = 'bv2 bv2-echo-picker';
    host.dataset.theme = theme;
    const sonataById = new Map((sonatas ?? []).map(s => [s.id, s]));
    state = {
        slotIndex, items: items ?? [], sonatas: sonatas ?? [], sonataById, onPick,
        search: '', costF: 'all', elemF: 'all', sonataF: 'all', theme,
    };
    paint();
    bindOnce();
    requestAnimationFrame(() => host.querySelector('[data-ep="search"]')?.focus());
}

export function close() {
    if (!host) return;
    hideTip();
    host.innerHTML = '';
    host.__tip = null;
    state = null;
}

// Pure helpers for unit testing (tests/echo-picker-v2.test.mjs).
export const __test__ = { filterEchoes, ELEMENTS, ELEMENT_ORDER };
