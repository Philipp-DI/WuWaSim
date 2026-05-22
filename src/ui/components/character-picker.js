/**
 * Character picker.
 *
 * Renders a filterable grid of resonators. Owns its own filter state;
 * notifies the parent via `onSelect(resonator)` when a card is clicked.
 *
 *   mount(rootElement, { dataset, onSelect })
 *
 * The picker is reactive only to internal filter changes. If the
 * dataset itself changes (e.g. after a hot patch), the parent should
 * call `mount` again to rebuild.
 */

import { html, raw, render, on, $$, esc } from '../dom.js';

const ALL = Symbol('all');

function createState(dataset) {
    return {
        elementId: ALL,
        rarity: ALL,
        weaponTypeId: ALL,
        query: '',
        selectedId: null,
        dataset,
    };
}

function applyFilters(state) {
    const q = state.query.trim().toLowerCase();
    return state.dataset.resonators.filter(r => {
        if (state.elementId    !== ALL && r.element    !== state.elementId)    return false;
        if (state.rarity       !== ALL && r.rarity     !== state.rarity)       return false;
        if (state.weaponTypeId !== ALL && r.weaponType !== state.weaponTypeId) return false;
        if (q) {
            const hay = `${r.name} ${r.nickname || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

function countBy(arr, getKey) {
    const m = new Map();
    for (const item of arr) {
        const k = getKey(item);
        m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
}

// ---------- Render helpers (return HTML strings) ----------

function chip({ label, isActive, value, kind, swatch, count }) {
    return html`
        <button class="chip ${raw(isActive ? 'is-active' : '')}"
                data-kind="${kind}"
                data-value="${esc(String(value))}"
                style="${raw(swatch ? `--chip-color: ${swatch};` : '')}">
            ${raw(swatch ? `<span class="chip__swatch"></span>` : '')}
            <span>${label}</span>
            ${raw(count != null ? `<span class="chip__count">${count}</span>` : '')}
        </button>
    `;
}

function filterBar(state) {
    const ds = state.dataset;
    const all = ds.resonators;
    const elCount = countBy(all, r => r.element);
    const rarCount = countBy(all, r => r.rarity);
    const wepCount = countBy(all, r => r.weaponType);

    const elementChips = [
        chip({ label: 'All',  isActive: state.elementId === ALL, value: 'all', kind: 'element', count: all.length }),
        ...ds.elements.map(e => chip({
            label: e.name,
            isActive: state.elementId === e.id,
            value: e.id,
            kind: 'element',
            swatch: e.color,
            count: elCount.get(e.id) || 0,
        })),
    ];

    const rarityChips = [
        chip({ label: 'All', isActive: state.rarity === ALL, value: 'all', kind: 'rarity' }),
        chip({ label: '5★', isActive: state.rarity === 5, value: 5, kind: 'rarity', count: rarCount.get(5) || 0 }),
        chip({ label: '4★', isActive: state.rarity === 4, value: 4, kind: 'rarity', count: rarCount.get(4) || 0 }),
    ];

    const weaponChips = [
        chip({ label: 'All', isActive: state.weaponTypeId === ALL, value: 'all', kind: 'weapon' }),
        ...ds.weaponTypes.map(w => chip({
            label: w.name,
            isActive: state.weaponTypeId === w.id,
            value: w.id,
            kind: 'weapon',
            count: wepCount.get(w.id) || 0,
        })),
    ];

    return html`
        <div class="filter-bar" role="toolbar" aria-label="Resonator filters">
            <div class="filter-bar__group">
                <span class="filter-bar__label">Element</span>
                ${raw(elementChips.join(''))}
            </div>
            <div class="filter-bar__divider"></div>
            <div class="filter-bar__group">
                <span class="filter-bar__label">Rarity</span>
                ${raw(rarityChips.join(''))}
            </div>
            <div class="filter-bar__divider"></div>
            <div class="filter-bar__group">
                <span class="filter-bar__label">Weapon</span>
                ${raw(weaponChips.join(''))}
            </div>
            <div class="filter-bar__group" style="margin-left: auto;">
                <input class="search"
                       type="search"
                       placeholder="Search"
                       value="${esc(state.query)}"
                       data-kind="search"
                       autocomplete="off"
                       spellcheck="false">
            </div>
        </div>
    `;
}

function card(resonator, isSelected) {
    return html`
        <button class="card ${raw(isSelected ? 'is-selected' : '')}"
                style="${raw(`--el-color: ${resonator.elementColor};`)}"
                data-id="${resonator.id}"
                aria-pressed="${isSelected ? 'true' : 'false'}">
            <div class="card__art">
                <img src="${esc(resonator.iconUrl)}"
                     alt=""
                     loading="lazy"
                     onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card__art--missing',textContent:'No image'}))">
            </div>
            <div class="card__body">
                <span class="card__name">${esc(resonator.name)}</span>
                ${raw(resonator.nickname ? `<span class="card__nick">${esc(resonator.nickname)}</span>` : '')}
                <div class="card__meta">
                    <span class="card__rarity" data-rarity="${resonator.rarity}">${'★'.repeat(resonator.rarity)}</span>
                    <span class="card__weapon">${esc(resonator.weaponTypeName)}</span>
                </div>
            </div>
        </button>
    `;
}

function grid(state) {
    const filtered = applyFilters(state);
    if (filtered.length === 0) {
        return html`<div class="cards"><div class="cards--empty">No resonators match these filters.</div></div>`;
    }
    return html`
        <div class="cards" role="listbox" aria-label="Resonators">
            ${raw(filtered.map(r => card(r, r.id === state.selectedId)).join(''))}
        </div>
    `;
}

function template(state) {
    return html`
        <div class="picker">
            ${raw(filterBar(state))}
            <div data-region="grid">${raw(grid(state))}</div>
        </div>
    `;
}

// ---------- Public mount ----------

export function mount(root, { dataset, onSelect } = {}) {
    if (!dataset || !Array.isArray(dataset.resonators)) {
        throw new Error('character-picker: dataset.resonators required');
    }
    const state = createState(dataset);
    render(root, template(state));

    // Partial re-render of the grid only — preserves the search input
    // focus + cursor position across filter toggles.
    const repaintGrid = () => {
        const region = root.querySelector('[data-region="grid"]');
        if (region) region.innerHTML = grid(state);
    };
    const repaintAll = () => render(root, template(state));

    // Chip clicks (element / rarity / weapon).
    on(root, 'click', '.chip', (_event, chipEl) => {
        const kind  = chipEl.dataset.kind;
        const value = chipEl.dataset.value;
        const next  = value === 'all' ? ALL : Number(value);
        if (kind === 'element') state.elementId    = next;
        if (kind === 'rarity')  state.rarity       = next;
        if (kind === 'weapon')  state.weaponTypeId = next;
        repaintAll();
    });

    // Search input. `input` event for live filtering.
    on(root, 'input', '.search', (event) => {
        state.query = event.target.value;
        repaintGrid();
        // Restore focus to the search input (innerHTML resets it on full repaint;
        // here we use repaintGrid which doesn't touch it).
    });

    // Card selection.
    on(root, 'click', '.card', (_event, cardEl) => {
        const id = Number(cardEl.dataset.id);
        state.selectedId = id;
        repaintGrid();
        const resonator = dataset.resonators.find(r => r.id === id);
        if (resonator && typeof onSelect === 'function') onSelect(resonator);
    });

    return {
        getState: () => ({ ...state }),
        destroy: () => { root.innerHTML = ''; },
    };
}
