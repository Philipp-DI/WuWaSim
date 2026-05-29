/**
 * Generic modal picker.
 *
 * Renders a searchable, filterable list of options. Used by the build
 * editor for weapon selection, echo selection, and sonata selection.
 *
 *   open({
 *     title: 'Choose a weapon',
 *     items: [...],              // raw items
 *     renderRow: (item) => html,  // returns the inner HTML of one .option
 *     filters: [{kind, label, options:[{value,label,test:(item,value)=>bool}]}],
 *     searchFields: ['name'],    // dotted paths into each item, joined with ' '
 *     allowUnequip: bool,        // show a dashed "remove" option at top
 *     onPick: (item|null) => {}, // null for unequip
 *   })
 *
 * One modal instance is shared across all callers — open() closes the
 * previous one before mounting the new content.
 */

import { html, raw, render, on, esc } from '../dom.js';

let mountEl = null;
let state = null;

function ensureMount() {
    if (mountEl) return mountEl;
    mountEl = document.createElement('div');
    mountEl.className = 'modal';
    mountEl.setAttribute('role', 'dialog');
    mountEl.setAttribute('aria-modal', 'true');
    document.body.appendChild(mountEl);

    // Close on backdrop click. Inner clicks bubble up to the panel and
    // stop here only via the explicit close button.
    mountEl.addEventListener('click', (e) => {
        if (e.target === mountEl) close();
    });

    // Escape closes.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mountEl.classList.contains('is-open')) close();
    });

    return mountEl;
}

function getByPath(obj, path) {
    if (!obj || !path) return '';
    return path.split('.').reduce((o, k) => (o == null ? '' : o[k]), obj);
}

function applyFilters(items, filterValues, searchQuery, searchFields, filterDefs) {
    const q = searchQuery.trim().toLowerCase();
    return items.filter(item => {
        for (const def of filterDefs) {
            const v = filterValues[def.kind];
            if (v == null || v === 'all') continue;
            const opt = def.options.find(o => String(o.value) === String(v));
            if (opt && opt.test && !opt.test(item, opt.value)) return false;
        }
        if (q) {
            const hay = searchFields.map(f => String(getByPath(item, f) || '')).join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

function renderFilters(filterDefs, filterValues) {
    return filterDefs.map(def => {
        const chips = [
            { value: 'all', label: 'All' },
            ...def.options,
        ].map(o => {
            const active = String(filterValues[def.kind] ?? 'all') === String(o.value);
            const swatchStyle = o.color ? ` style="--swatch-color:${o.color};"` : '';
            const swatch = o.color ? `<span class="option__swatch"${swatchStyle}></span>` : '';
            return `<button class="chip ${active ? 'is-active' : ''}"
                            data-kind="${esc(def.kind)}"
                            data-value="${esc(String(o.value))}"
                            ${swatchStyle}>
                        ${swatch}
                        <span>${esc(o.label)}</span>
                    </button>`;
        }).join('');
        return `<div class="filter-bar__group">
                    <span class="filter-bar__label">${esc(def.label)}</span>
                    ${chips}
                </div>`;
    }).join('<div class="filter-bar__divider" aria-hidden="true"></div>');
}

function renderBody(items) {
    if (items.length === 0) {
        return `<div class="cards--empty">No matches.</div>`;
    }
    return `<div class="option-list">${items.map((item, idx) =>
        `<button class="option" data-idx="${idx}">${state.renderRow(item)}</button>`
    ).join('')}</div>`;
}

function renderRoot() {
    const filtered = applyFilters(
        state.items,
        state.filterValues,
        state.searchQuery,
        state.searchFields,
        state.filterDefs,
    );
    state.filteredItems = filtered;

    const countHtml = state.showCounts
        ? `<span class="modal__count">${filtered.length} / ${state.totalCount ?? state.items.length}</span>`
        : '';

    const unequip = state.allowUnequip
        ? `<button class="option option--unequip" data-action="unequip">
               <span class="option__name">— Remove —</span>
           </button>`
        : '';

    return html`
        <div class="modal__panel" role="document">
            <div class="modal__header">
                <h3 class="modal__title">${esc(state.title)}</h3>
                ${raw(countHtml)}
                <button class="modal__close" type="button" data-action="close">Close · ESC</button>
            </div>
            <div class="modal__filters">
                ${raw(renderFilters(state.filterDefs, state.filterValues))}
                <div class="filter-bar__group" style="margin-left: auto;">
                    <input class="search" type="search"
                           placeholder="Search"
                           value="${esc(state.searchQuery)}"
                           data-action="search"
                           autocomplete="off"
                           spellcheck="false">
                </div>
            </div>
            <div class="modal__body" data-region="body">
                ${raw(unequip)}
                ${raw(renderBody(filtered))}
            </div>
        </div>
    `;
}

function paintAll() { render(mountEl, renderRoot()); }
function paintBody() {
    const body = mountEl.querySelector('[data-region="body"]');
    if (!body) return paintAll();
    const filtered = applyFilters(state.items, state.filterValues, state.searchQuery, state.searchFields, state.filterDefs);
    state.filteredItems = filtered;
    const unequip = state.allowUnequip
        ? `<button class="option option--unequip" data-action="unequip">
               <span class="option__name">— Remove —</span>
           </button>` : '';
    body.innerHTML = unequip + renderBody(filtered);
}

/** Public: open the modal with the given configuration. */
export function open(config) {
    const mount = ensureMount();
    state = {
        title: config.title || 'Choose',
        items: config.items || [],
        filteredItems: [],
        renderRow: config.renderRow,
        filterDefs: config.filters || [],
        searchFields: config.searchFields || ['name'],
        allowUnequip: !!config.allowUnequip,
        showCounts: !!config.showCounts,
        totalCount: config.totalCount ?? null,
        onPick: config.onPick || (() => { }),

        searchQuery: '',
        filterValues: Object.fromEntries((config.filters || []).map(f => [f.kind, 'all'])),
    };

    paintAll();
    mount.classList.add('is-open');

    // Bind events once per open (the body's innerHTML changes on filter,
    // so use delegation instead of direct listeners).
    const onceTag = '__bound__';
    if (!mount[onceTag]) {
        mount[onceTag] = true;

        on(mount, 'click', '[data-action="close"]', () => close());

        on(mount, 'click', '.chip', (_e, chip) => {
            const kind = chip.dataset.kind;
            const value = chip.dataset.value;
            if (!state) return;
            state.filterValues[kind] = value === 'all' ? 'all' : value;
            paintAll();
        });

        on(mount, 'input', '[data-action="search"]', (e) => {
            if (!state) return;
            state.searchQuery = e.target.value;
            paintBody();
        });

        on(mount, 'click', '.option[data-idx]', (_e, btn) => {
            if (!state) return;
            const idx = Number(btn.dataset.idx);
            const item = state.filteredItems[idx];
            if (item) state.onPick(item);
            close();
        });

        on(mount, 'click', '[data-action="unequip"]', () => {
            if (!state) return;
            state.onPick(null);
            close();
        });
    }

    // Autofocus the search field for keyboard-first interaction.
    requestAnimationFrame(() => {
        const search = mount.querySelector('[data-action="search"]');
        if (search) search.focus();
    });
}

/** Public: close the modal. */
export function close() {
    if (!mountEl) return;
    mountEl.classList.remove('is-open');
    state = null;
}

export const __test__ = { applyFilters };