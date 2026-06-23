/**
 * Resonator Roster (ROSTER) — v2 page.
 *
 * Implements docs/design_handoff_wuwa_sim/roster page. A full-page browseable
 * directory of all resonators: search by name, filter by element / weapon
 * type / rarity (AND across dimensions, OR within each), sort three ways,
 * clear all filters in one click. Shares the v2 sticky header (v2-header.js)
 * and the `.bv2`-scoped design tokens (styles/build-v2.css).
 *
 *   mount(root, { dataset, theme, onOpenResonator(resonatorId) }) -> { update() }
 *
 * Clicking a card always starts a fresh build for that resonator (consistent
 * with the classic roster picker) via onOpenResonator.
 */

import { html, raw, render, on, esc } from '../dom.js';
import { iconHtml } from '../icons.js';
import { renderV2Header, getV2Theme } from './v2-header.js';

let api = null;

// Element id → { name, hex } using the repo's canonical element palette
// (tokens.css), matching the convention in team-editor-v2.js: repo element
// colours win over the handoff's.
const ELEM = {
    1: { name: 'Glacio', c: '#5fc0f5' },
    2: { name: 'Fusion', c: '#e68c66' },
    3: { name: 'Electro', c: '#a765de' },
    4: { name: 'Aero', c: '#47f4b3' },
    5: { name: 'Spectro', c: '#dad484' },
    6: { name: 'Havoc', c: '#bf4a92' },
};

// ── Pure filter + sort (exported for tests) ──────────────────────────────────

export function filterResonators(resonators, { search = '', selElements = [], selWeapons = [], selRarities = [] } = {}) {
    const q = search.trim().toLowerCase();
    return (resonators ?? []).filter(r => {
        if (q && !r.name.toLowerCase().includes(q)) return false;
        if (selElements.length && !selElements.includes(r.element)) return false;
        if (selWeapons.length && !selWeapons.includes(r.weaponType)) return false;
        if (selRarities.length && !selRarities.includes(r.rarity)) return false;
        return true;
    });
}

export function sortResonators(resonators, sort, elemMap) {
    const sorted = [...(resonators ?? [])];
    sorted.sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name);
        if (sort === 'element') {
            const na = elemMap?.[a.element]?.name ?? '';
            const nb = elemMap?.[b.element]?.name ?? '';
            return na.localeCompare(nb) || a.name.localeCompare(b.name);
        }
        // 'rarity' (default)
        return b.rarity - a.rarity || a.name.localeCompare(b.name);
    });
    return sorted;
}

function toggle(arr, val) {
    return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];
}

function hasActiveFilters() {
    return api.search.trim().length > 0 || api.selElements.length > 0
        || api.selWeapons.length > 0 || api.selRarities.length > 0;
}

// ── Chip rendering ────────────────────────────────────────────────────────────
// Per the handoff's §Row 1/2/3 colour tables, "off" and the plain accent "on"
// state differ by literal rgba between dark/light (not just the --bd/--dim
// tokens), so these are theme-keyed rather than resolved purely via CSS vars.

const CHIP_BASE = "display:inline-flex;align-items:center;font-family:'Chakra Petch',sans-serif;font-size:11px;letter-spacing:.7px;border-radius:7px;padding:2px 8px;cursor:pointer;transition:all .12s;border:1px solid ";
const CHIP_OFF = {
    dark: CHIP_BASE + "rgba(120,205,215,.13);background:rgba(255,255,255,.04);color:#8a96a0;",
    light: CHIP_BASE + "rgba(20,45,50,.12);background:rgba(20,45,50,.035);color:#5c6a73;",
};
const CHIP_ON = {
    dark: CHIP_BASE + "#46d6c6;background:rgba(70,214,198,.1);color:#46d6c6;box-shadow:0 0 8px rgba(70,214,198,.2);",
    light: CHIP_BASE + "#0e988c;background:rgba(14,152,140,.08);color:#0e988c;box-shadow:0 0 7px rgba(14,152,140,.18);",
};
// Active rarity chip colours (handoff §Design System Tokens — Rarity Colours).
const RARITY_ON = {
    4: { dark: CHIP_BASE + "#9b7de8;background:rgba(155,125,232,.1);color:#9b7de8;", light: CHIP_BASE + "#7c5cbf;background:rgba(124,92,191,.08);color:#7c5cbf;" },
    5: { dark: CHIP_BASE + "#e9b94a;background:rgba(233,185,74,.1);color:#e9b94a;", light: CHIP_BASE + "#b78617;background:rgba(183,134,23,.08);color:#b78617;" },
};

function themeKey() { return api.theme === 'dark' ? 'dark' : 'light'; }

function elementChip(el) {
    // el === null is the ALL chip. `el` is the dataset's raw element object
    // ({id, name, color}) — resolve the repo's canonical hex (ELEM) by id
    // rather than trusting the dataset's own `color` field (handoff's table
    // predates the repo's retuned element palette).
    const c = el ? (ELEM[el.id]?.c ?? el.color) : null;
    const value = el ? el.id : 'all';
    const label = el ? el.name.toUpperCase() : 'ALL';
    const on = el ? api.selElements.includes(el.id) : api.selElements.length === 0;
    const style = !on ? CHIP_OFF[themeKey()]
        : el ? `${CHIP_BASE}${c}bb;background:${c}18;color:${c};box-shadow:0 0 9px ${c}30;`
            : CHIP_ON[themeKey()];
    // Full-colour element icon (not a dot) — the icon asset already carries
    // the element's identity, so it reads regardless of chip state.
    const icon = el ? `<span style="display:inline-flex;margin-right:5px;">${iconHtml('element', el.id, { label: el.name, size: 13 })}</span>` : '';
    return `<button data-act="elem" data-val="${esc(String(value))}" style="${style}">${icon}${esc(label)}</button>`;
}

function weaponChip(wt) {
    const value = wt ? wt.id : 'all';
    const label = wt ? wt.name.toUpperCase() : 'ALL';
    const on = wt ? api.selWeapons.includes(wt.id) : api.selWeapons.length === 0;
    const style = on ? CHIP_ON[themeKey()] : CHIP_OFF[themeKey()];
    // Weapon icons are tintable masks (no per-weapon colour, per the handoff —
    // "active uses standard var(--acc) highlight") so they just track the
    // chip's own on/off text colour.
    const icon = wt ? `<span style="display:inline-flex;margin-right:5px;">${iconHtml('weaponType', wt.id, { label: wt.name, size: 24, tint: on ? '--acc' : '--dim' })}</span>` : '';
    return `<button data-act="weapon" data-val="${esc(String(value))}" style="${style}">${icon}${esc(label)}</button>`;
}

function rarityChip(rarity) {
    const value = rarity ?? 'all';
    const label = rarity ? `${rarity} ◆` : 'ALL';
    const on = rarity ? api.selRarities.includes(rarity) : api.selRarities.length === 0;
    const style = on ? (rarity ? RARITY_ON[rarity][themeKey()] : CHIP_ON[themeKey()]) : CHIP_OFF[themeKey()];
    return `<button data-act="rarity" data-val="${esc(String(value))}" style="${style}">${esc(label)}</button>`;
}

function sortChip(key, label) {
    const on = api.sort === key;
    const sortBase = "font-family:'Chakra Petch',sans-serif;font-size:10px;letter-spacing:.8px;padding:5px 10px;border-radius:6px;cursor:pointer;border:1px solid ";
    const style = sortBase + (on
        ? (api.theme === 'dark' ? "#46d6c6;background:rgba(70,214,198,.1);color:#46d6c6;" : "#0e988c;background:rgba(14,152,140,.08);color:#0e988c;")
        : (api.theme === 'dark' ? "rgba(120,205,215,.13);background:rgba(255,255,255,.04);color:#8a96a0;" : "rgba(20,45,50,.12);background:rgba(20,45,50,.035);color:#5c6a73;"));
    return `<button data-act="sort" data-val="${key}" style="${style}">${esc(label)}</button>`;
}

// ── Card rendering ────────────────────────────────────────────────────────────

function resonatorCard(r) {
    const el = ELEM[r.element] ?? { name: 'Unknown', c: '#888888' };
    const is5 = r.rarity === 5;
    const isDark = api.theme === 'dark';
    const starColor = is5 ? 'var(--gold)' : (isDark ? '#b090ee' : '#7c5cbf');
    const cardBg = `linear-gradient(180deg,${el.c}14 0%,transparent 60%),var(--card)`;
    // Frame lines always read by element colour (rarity is conveyed by the
    // star row/colour instead, so the border isn't overloaded with both).
    const borderColor = `${el.c}${isDark ? '22' : '28'}`;
    const hoverBorderColor = `${el.c}${isDark ? '77' : '66'}`;

    return `
      <div class="bv2-roster-card" data-act="open-build" data-id="${esc(String(r.id))}"
           style="--rc-bd:${esc(borderColor)};--rc-bd-hover:${esc(hoverBorderColor)};border-radius:10px;border:1px solid var(--rc-bd);background:${esc(cardBg)};overflow:hidden;cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s;">
        <div style="position:relative;overflow:hidden;">
          <div style="width:100%;aspect-ratio:.84;overflow:hidden;">
            <img src="${esc(r.iconUrl)}" alt="${esc(r.name)}" style="width:100%;height:100%;object-fit:cover;object-position:top center;" loading="lazy">
          </div>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg,transparent 48%,rgba(0,0,0,.62) 100%);pointer-events:none;"></div>
          <div style="position:absolute;bottom:5px;left:0;right:0;display:flex;justify-content:center;">
            <span style="font-size:9.5px;letter-spacing:1.5px;color:${starColor};text-shadow:0 1px 4px rgba(0,0,0,.9),0 0 10px rgba(0,0,0,.6);">${'◆'.repeat(r.rarity)}</span>
          </div>
          <div style="position:absolute;top:6px;right:6px;filter:drop-shadow(0 1px 4px rgba(0,0,0,.9)) drop-shadow(0 0 6px rgba(0,0,0,.6));">
            ${iconHtml('element', r.element, { label: el.name, size: 22 })}
          </div>
        </div>
        <div style="padding:8px 9px 4px;">
          <div style="font-family:'Chakra Petch',sans-serif;font-size:11.5px;font-weight:600;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.25;">${esc(r.name)}</div>
          <div style="display:flex;align-items:center;gap:5px;margin-top:4px;">
            ${iconHtml('weaponType', r.weaponType, { label: r.weaponTypeName, size: 19, tint: '--faint' })}
            <span style="font-family:'Chakra Petch',sans-serif;font-size:10px;letter-spacing:.4px;color:var(--faint);">${esc(r.weaponTypeName ?? '')}</span>
          </div>
        </div>
      </div>`;
}

// ── Page render ───────────────────────────────────────────────────────────────

function visibleResonators() {
    const elemMap = Object.fromEntries((api.dataset.elements ?? []).map(e => [e.id, e]));
    const filtered = filterResonators(api.dataset.resonators, api);
    return sortResonators(filtered, api.sort, elemMap);
}

function renderMeta(count, total) {
    const clearBtn = hasActiveFilters()
        ? `<button data-act="clear" style="font-family:'Chakra Petch',sans-serif;font-size:10px;letter-spacing:.8px;padding:5px 12px;border-radius:6px;cursor:pointer;border:1px solid var(--warn);background:transparent;color:var(--warn);">CLEAR FILTERS</button>`
        : '';
    return `
        <span style="font-family:'Chakra Petch',sans-serif;font-size:11px;letter-spacing:.8px;color:var(--faint);">${count} / ${total} RESONATORS</span>
        ${clearBtn}`;
}

function renderTitleRow(count, total) {
    return `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="width:4px;height:22px;background:var(--acc);border-radius:3px;box-shadow:0 0 10px var(--acc);flex:none;"></div>
        <span style="font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:16px;letter-spacing:2px;color:var(--txt);">RESONATOR ROSTER</span>
        <div style="flex:1;height:1px;background:var(--bd);margin:0 4px;min-width:20px;"></div>
        <span data-region="roster-meta" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">${renderMeta(count, total)}</span>
      </div>`;
}

function renderFilterPanel() {
    const sortChips = [sortChip('rarity', 'RARITY'), sortChip('name', 'NAME'), sortChip('element', 'ELEMENT')].join('');
    const elementChips = [elementChip(null), ...(api.dataset.elements ?? []).map(elementChip)].join('');
    const weaponChips = [weaponChip(null), ...(api.dataset.weaponTypes ?? []).map(weaponChip)].join('');
    const rarityChips = [rarityChip(null), rarityChip(4), rarityChip(5)].join('');

    return `
      <div style="background:var(--card);border:1px solid var(--bd);border-radius:14px;overflow:hidden;">
        <span style="display:block;height:2px;background:linear-gradient(90deg,transparent,var(--acc),transparent);opacity:.45;"></span>
        <div style="padding:15px 18px 17px;display:flex;flex-direction:column;gap:12px;">

          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <div style="flex:1;min-width:200px;position:relative;display:flex;align-items:center;">
              <svg style="position:absolute;left:12px;pointer-events:none;color:var(--faint);" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>
              <input data-act="search" type="text" placeholder="Search resonators…" value="${esc(api.search)}" autocomplete="off" spellcheck="false"
                     style="width:100%;background:var(--inp);border:1px solid var(--bd);border-radius:9px;padding:9px 12px 9px 34px;font-family:'Manrope',sans-serif;font-size:13px;color:var(--txt);outline:none;transition:border-color .14s;">
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex:none;">
              <span style="font-family:'Chakra Petch',sans-serif;font-size:8.5px;letter-spacing:1.3px;color:var(--faint);">SORT</span>
              <div style="display:flex;gap:3px;">${sortChips}</div>
            </div>
          </div>

          <div style="height:1px;background:var(--bd);"></div>

          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="font-family:'Chakra Petch',sans-serif;font-size:8.5px;letter-spacing:1.3px;color:var(--faint);flex:none;width:58px;">ELEMENT</span>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">${elementChips}</div>
          </div>

          <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1;min-width:280px;">
              <span style="font-family:'Chakra Petch',sans-serif;font-size:8.5px;letter-spacing:1.3px;color:var(--faint);flex:none;width:58px;">WEAPON</span>
              <div style="display:flex;gap:5px;flex-wrap:wrap;">${weaponChips}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span style="font-family:'Chakra Petch',sans-serif;font-size:8.5px;letter-spacing:1.3px;color:var(--faint);flex:none;width:58px;">RARITY</span>
              <div style="display:flex;gap:5px;">${rarityChips}</div>
            </div>
          </div>

        </div>
      </div>`;
}

function renderEmptyState() {
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:80px 20px;">
        <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="1.2" stroke-linecap="round"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>
        <span style="font-family:'Chakra Petch',sans-serif;font-size:13px;letter-spacing:1.5px;color:var(--dim);">NO RESONATORS MATCH</span>
        <span style="font-family:'Manrope',sans-serif;font-size:12px;color:var(--faint);">Try adjusting or clearing your filters</span>
      </div>`;
}

function renderGrid(cards) {
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(138px,1fr));gap:10px;">${cards.map(resonatorCard).join('')}</div>`;
}

function renderResults(cards) {
    return cards.length === 0 ? renderEmptyState() : renderGrid(cards);
}

function renderPage() {
    const all = api.dataset.resonators ?? [];
    const cards = visibleResonators();

    return html`
      <div class="bv2" data-theme="${api.theme}">
        ${raw(renderV2Header({ active: 'roster', theme: api.theme }))}
        <div style="max-width:1340px;margin:0 auto;padding:28px 24px 60px;display:flex;flex-direction:column;gap:18px;">
          ${raw(renderTitleRow(cards.length, all.length))}
          ${raw(renderFilterPanel())}
          <div data-region="roster-grid">${raw(renderResults(cards))}</div>
        </div>
      </div>`;
}

function paint() {
    render(api.root, renderPage());
}

// Update just the count/clear-btn + grid regions, keeping the search input's
// DOM node (and caret/focus) intact — a full paint() on every keystroke would
// otherwise steal focus via the innerHTML replace (see echo-picker-v2.js's
// refreshResults for the same pattern).
function refreshResults() {
    const cards = visibleResonators();
    const meta = api.root.querySelector('[data-region="roster-meta"]');
    const grid = api.root.querySelector('[data-region="roster-grid"]');
    if (meta) meta.innerHTML = renderMeta(cards.length, (api.dataset.resonators ?? []).length);
    if (grid) grid.innerHTML = renderResults(cards);
}

// ── Events ────────────────────────────────────────────────────────────────────

function bind() {
    const root = api.root;
    on(root, 'input', '[data-act="search"]', (_e, el) => { api.search = el.value; refreshResults(); });
    on(root, 'click', '[data-act="elem"]', (_e, el) => {
        api.selElements = el.dataset.val === 'all' ? [] : toggle(api.selElements, Number(el.dataset.val));
        paint();
    });
    on(root, 'click', '[data-act="weapon"]', (_e, el) => {
        api.selWeapons = el.dataset.val === 'all' ? [] : toggle(api.selWeapons, Number(el.dataset.val));
        paint();
    });
    on(root, 'click', '[data-act="rarity"]', (_e, el) => {
        api.selRarities = el.dataset.val === 'all' ? [] : toggle(api.selRarities, Number(el.dataset.val));
        paint();
    });
    on(root, 'click', '[data-act="sort"]', (_e, el) => { api.sort = el.dataset.val; paint(); });
    on(root, 'click', '[data-act="clear"]', () => {
        api.search = ''; api.selElements = []; api.selWeapons = []; api.selRarities = [];
        paint();
    });
    on(root, 'click', '[data-act="open-build"]', (_e, el) => api.onOpenResonator?.(Number(el.dataset.id)));
}

// ── Public mount ──────────────────────────────────────────────────────────────

export function mount(root, config) {
    api = {
        root,
        dataset: config.dataset,
        theme: config.theme ?? getV2Theme(),
        search: '',
        selElements: [],
        selWeapons: [],
        selRarities: [],
        sort: 'rarity',
        onOpenResonator: config.onOpenResonator,
    };
    paint();
    // Re-mounting (revisiting #roster) must not restack listeners on the
    // persistent #main root — same guard as team-editor-v2.js's __partyBound.
    if (!root.__rosterBound) { root.__rosterBound = true; bind(); }
    return { update: () => paint() };
}

export const __test__ = { ELEM };
