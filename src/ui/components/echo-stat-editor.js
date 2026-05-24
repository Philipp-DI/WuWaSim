// src/ui/components/echo-stat-editor.js
/**
 * Echo stat editor.
 *
 * A modal that lets the user edit the main stat (one) and substats
 * (up to 5) of an equipped echo. Also lets them change the equipped
 * sonata for the slot (an echo can belong to several sonata families;
 * the user picks which one is active).
 *
 *   open({
 *     dataset,
 *     echo,          // the current echo object (must have .id)
 *     slotIndex,     // for the title display only
 *     onSave,        // (updatedEcho) => {}
 *     onUnequip,     // () => {}   — optional, shows a remove button
 *     onPickOther,   // () => {}   — optional, shows a "swap echo" button
 *   })
 *
 * Single shared modal instance; opening a new one closes the previous.
 *
 * Stat shape stored on echo (compatible with src/core/stats.js):
 *   { propId, addType, name, isPercent, value }
 *
 * `value` is in display units (e.g., 22.0 for "22%", 60 for "60 ATK").
 * The damage engine reads `addType` (2 = percent) to interpret it.
 */

import { html, raw, render, on, esc } from '../dom.js';

let mountEl = null;
let state = null;

function ensureMount() {
    if (mountEl) return mountEl;
    mountEl = document.createElement('div');
    mountEl.className = 'modal echo-modal';
    mountEl.setAttribute('role', 'dialog');
    mountEl.setAttribute('aria-modal', 'true');
    document.body.appendChild(mountEl);

    mountEl.addEventListener('click', (e) => {
        if (e.target === mountEl) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mountEl.classList.contains('is-open')) close();
    });
    return mountEl;
}

// =============================================================================
// Sub-helpers
// =============================================================================

function findEchoDef(dataset, echoId) {
    return dataset.echoes.find(e => e.id === echoId) || null;
}

function findSonata(dataset, sonataId) {
    return dataset.sonatas.find(s => s.id === sonataId) || null;
}

// Build a lookup from a unique key to the full stat option, so we can
// recover { propId, addType, name, isPercent } when the user picks a name.
function buildStatOptionMap(options) {
    const m = new Map();
    for (const opt of options || []) {
        m.set(statKey(opt.propId, opt.addType), opt);
    }
    return m;
}
function statKey(propId, addType) { return `${propId}:${addType}`; }

// Build the dropdown <option> elements for a stat list, with `selected`
// applied to the currently-set propId/addType pair.
function optionsHtml(stats, selectedPropId, selectedAddType) {
    const selKey = selectedPropId != null ? statKey(selectedPropId, selectedAddType) : '';
    const head = `<option value="">— select —</option>`;
    const body = (stats || []).map(s => {
        const k = statKey(s.propId, s.addType);
        return `<option value="${esc(k)}" ${k === selKey ? 'selected' : ''}>${esc(s.name)}</option>`;
    }).join('');
    return head + body;
}

// =============================================================================
// Render
// =============================================================================

function renderRoot() {
    const { dataset, echo, slotIndex } = state;
    const def     = findEchoDef(dataset, echo.id);
    if (!def) return errorPanel(`Echo id ${echo.id} not in dataset.`);

    const echoName = def.name;
    const cost     = echo.cost ?? def.cost;
    const sonatas  = (def.sonataIds || []).map(id => findSonata(dataset, id)).filter(Boolean);

    return html`
        <div class="modal__panel echo-editor" role="document">
            <div class="modal__header">
                <h3 class="modal__title">Slot ${esc(String(slotIndex + 1))} — ${esc(echoName)}</h3>
                <button class="modal__close" type="button" data-action="close">Close · ESC</button>
            </div>
            <div class="modal__body echo-editor__body">
                <div class="echo-editor__meta">
                    <span class="echo-editor__cost">${cost}-cost</span>
                    ${raw(sonatas.length > 1 ? renderSonataPicker(echo, sonatas) : renderSingleSonata(echo, sonatas[0]))}
                </div>

                <h4 class="echo-editor__section">Main stat</h4>
                ${raw(renderMainStat(echo, dataset))}

                <h4 class="echo-editor__section">Sub stats <span class="echo-editor__hint">(up to 5)</span></h4>
                ${raw(renderSubStats(echo, dataset))}

                <div class="echo-editor__actions">
                    ${state.onPickOther ? '<button class="btn" data-action="pick-other">Choose different echo</button>' : ''}
                    ${state.onUnequip   ? '<button class="btn btn--danger" data-action="unequip">Unequip</button>' : ''}
                    <button class="btn btn--primary" data-action="save">Save</button>
                </div>
            </div>
        </div>
    `;
}

function renderSonataPicker(echo, sonatas) {
    const opts = sonatas.map(s =>
        `<option value="${s.id}" ${echo.sonataId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`
    ).join('');
    return `
        <label class="echo-editor__field">
            <span class="echo-editor__label">Sonata</span>
            <select class="echo-editor__select" data-action="set-sonata">
                <option value="">— none —</option>
                ${opts}
            </select>
        </label>
    `;
}

function renderSingleSonata(echo, sonata) {
    if (!sonata) return `<span class="echo-editor__sonata">No sonata</span>`;
    const active = echo.sonataId === sonata.id;
    return `
        <span class="echo-editor__sonata">
            <span class="echo-editor__sonata-swatch" data-active="${active}"></span>
            ${esc(sonata.name)}
        </span>
    `;
}

function renderMainStat(echo, dataset) {
    const m = echo.mainStat;
    const opts = optionsHtml(dataset.echoMainStats, m?.propId, m?.addType);
    const value = m?.value ?? '';
    return `
        <div class="stat-row">
            <select class="echo-editor__select stat-row__select"
                    data-action="set-main-key">
                ${opts}
            </select>
            <input class="stat-row__value"
                   type="number" step="0.1" min="0"
                   placeholder="Value"
                   value="${esc(String(value))}"
                   data-action="set-main-value">
            <span class="stat-row__suffix">${esc(m?.isPercent ? '%' : '')}</span>
        </div>
    `;
}

function renderSubStats(echo, dataset) {
    const subs   = echo.subStats || [];
    const rows = [];
    for (let i = 0; i < 5; i++) {
        const s = subs[i];
        const opts = optionsHtml(dataset.echoSubStats, s?.propId, s?.addType);
        const value = s?.value ?? '';
        rows.push(`
            <div class="stat-row" data-sub-index="${i}">
                <select class="echo-editor__select stat-row__select"
                        data-action="set-sub-key" data-index="${i}">
                    ${opts}
                </select>
                <input class="stat-row__value"
                       type="number" step="0.1" min="0"
                       placeholder="Value"
                       value="${esc(String(value))}"
                       data-action="set-sub-value" data-index="${i}">
                <span class="stat-row__suffix">${esc(s?.isPercent ? '%' : '')}</span>
                <button class="stat-row__clear"
                        data-action="clear-sub" data-index="${i}"
                        ${s ? '' : 'disabled'}
                        title="Clear this row">×</button>
            </div>
        `);
    }
    return `<div class="stat-rows">${rows.join('')}</div>`;
}

function errorPanel(msg) {
    return html`
        <div class="modal__panel">
            <div class="modal__header">
                <h3 class="modal__title">Echo editor</h3>
                <button class="modal__close" type="button" data-action="close">Close</button>
            </div>
            <div class="modal__body"><div class="state state--error"><p>${esc(msg)}</p></div></div>
        </div>
    `;
}

// =============================================================================
// Event handling
// =============================================================================

function paint() { render(mountEl, renderRoot()); }

// Resolve a stat-option string ("propId:addType") back to its full option
// object via the dataset lookup. Used when the user picks a stat name
// from the dropdown.
function lookupStatOpt(dataset, key, kind) {
    if (!key) return null;
    const pool = kind === 'main' ? dataset.echoMainStats : dataset.echoSubStats;
    const lookup = buildStatOptionMap(pool);
    return lookup.get(key) || null;
}

function bind() {
    const root = mountEl;
    on(root, 'click', '[data-action="close"]', () => close());

    on(root, 'click', '[data-action="save"]', () => {
        const onSave = state.onSave;
        const echo   = state.echo;
        close();
        onSave?.(echo);
    });

    on(root, 'click', '[data-action="unequip"]', () => {
        const onUnequip = state.onUnequip;
        close();
        onUnequip?.();
    });

    on(root, 'click', '[data-action="pick-other"]', () => {
        const onPickOther = state.onPickOther;
        close();
        onPickOther?.();
    });

    // Sonata change
    on(root, 'change', '[data-action="set-sonata"]', (e) => {
        const v = e.target.value;
        state.echo = { ...state.echo, sonataId: v ? Number(v) : null };
        paint();
    });

    // Main stat
    on(root, 'change', '[data-action="set-main-key"]', (e) => {
        const opt = lookupStatOpt(state.dataset, e.target.value, 'main');
        if (!opt) {
            state.echo = { ...state.echo, mainStat: null };
        } else {
            const prevValue = state.echo.mainStat?.value ?? 0;
            state.echo = {
                ...state.echo,
                mainStat: {
                    propId: opt.propId, addType: opt.addType,
                    name: opt.name, isPercent: opt.isPercent,
                    value: prevValue,
                },
            };
        }
        paint();
    });

    on(root, 'input', '[data-action="set-main-value"]', (e) => {
        const v = parseFloat(e.target.value);
        if (!state.echo.mainStat) return;  // ignore until a key is chosen
        state.echo = {
            ...state.echo,
            mainStat: { ...state.echo.mainStat, value: Number.isFinite(v) ? v : 0 },
        };
        // Don't paint — would lose focus on the number input.
    });

    // Sub stats
    on(root, 'change', '[data-action="set-sub-key"]', (e, sel) => {
        const i   = Number(sel.dataset.index);
        const opt = lookupStatOpt(state.dataset, sel.value, 'sub');
        const subs = [...(state.echo.subStats || [])];
        if (!opt) {
            subs[i] = undefined;
        } else {
            const prevValue = subs[i]?.value ?? 0;
            subs[i] = {
                propId: opt.propId, addType: opt.addType,
                name: opt.name, isPercent: opt.isPercent,
                value: prevValue,
            };
        }
        state.echo = { ...state.echo, subStats: subs.filter(Boolean) };
        paint();
    });

    on(root, 'input', '[data-action="set-sub-value"]', (e, inp) => {
        const i = Number(inp.dataset.index);
        const v = parseFloat(inp.value);
        const subs = [...(state.echo.subStats || [])];
        if (!subs[i]) return;
        subs[i] = { ...subs[i], value: Number.isFinite(v) ? v : 0 };
        state.echo = { ...state.echo, subStats: subs };
        // Don't paint.
    });

    on(root, 'click', '[data-action="clear-sub"]', (_e, btn) => {
        const i = Number(btn.dataset.index);
        const subs = [...(state.echo.subStats || [])];
        subs.splice(i, 1);
        state.echo = { ...state.echo, subStats: subs };
        paint();
    });
}

// =============================================================================
// Public API
// =============================================================================

export function open(config) {
    const mount = ensureMount();
    state = {
        dataset:     config.dataset,
        echo:        deepClone(config.echo),
        slotIndex:   config.slotIndex ?? 0,
        onSave:      config.onSave,
        onUnequip:   config.onUnequip,
        onPickOther: config.onPickOther,
    };
    paint();
    mount.classList.add('is-open');
    if (!mount.__bound__) {
        mount.__bound__ = true;
        bind();
    }
}

export function close() {
    if (!mountEl) return;
    mountEl.classList.remove('is-open');
    state = null;
}

function deepClone(obj) {
    if (!obj) return obj;
    return JSON.parse(JSON.stringify(obj));
}
