// src/ui/components/echo-stat-editor.js
/**
 * Echo stat editor.
 *
 * Modal for configuring an equipped echo:
 *   - Sonata (only when echo can belong to multiple families)
 *   - Level (0/5/10/15/20/25) — controls substat slot unlock + sub-main scaling
 *   - Main stat restricted to cost-appropriate pool
 *   - Sub-main read-only (auto-derived from cost + level)
 *   - Up to 5 sub stats with curated roll dropdowns + dedupe
 */

import { html, raw, render, on, esc } from '../dom.js';
import {
    mainStatsForCost, subMainStatFor,
    unlockedSubStatCount, snapLevel, MAX_ECHO_LEVEL, ECHO_LEVEL_STEP,
    possibleRollsFor, mainStatValueFor,
} from '../../core/echo-rules.js';

let mountEl = null;
let state = null;

function ensureMount() {
    if (mountEl) return mountEl;
    mountEl = document.createElement('div');
    mountEl.className = 'modal echo-modal';
    mountEl.setAttribute('role', 'dialog');
    mountEl.setAttribute('aria-modal', 'true');
    document.body.appendChild(mountEl);
    mountEl.addEventListener('click', (e) => { if (e.target === mountEl) close(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mountEl.classList.contains('is-open')) close();
    });
    return mountEl;
}

// Lookups
function findEchoDef(dataset, echoId) { return dataset.echoes.find(e => e.id === echoId) || null; }
function findSonata(dataset, sonataId) { return dataset.sonatas.find(s => s.id === sonataId) || null; }
function statKey(propId, addType) { return `${propId}:${addType}`; }
function parseStatKey(key) {
    if (!key) return null;
    const [p, a] = key.split(':');
    return { propId: Number(p), addType: Number(a) };
}

// =============================================================================
// Render
// =============================================================================

function renderRoot() {
    const { dataset, echo, slotIndex } = state;
    const def = findEchoDef(dataset, echo.id);
    if (!def) return errorPanel(`Echo id ${echo.id} not in dataset.`);

    const cost = echo.cost ?? def.cost;
    const sonatas = (def.sonataIds || []).map(id => findSonata(dataset, id)).filter(Boolean);
    const subMain = subMainStatFor(cost, echo.level);
    const unlocked = unlockedSubStatCount(echo.level);

    return html`
        <div class="modal__panel echo-editor" role="document">
            <div class="modal__header">
                <h3 class="modal__title">Slot ${esc(String(slotIndex + 1))} — ${esc(def.name)}</h3>
                <button class="modal__close" type="button" data-action="close">Close · ESC</button>
            </div>
            <div class="modal__body echo-editor__body">
                <div class="echo-editor__meta">
                    <span class="echo-editor__cost">${cost}-cost</span>
                    ${raw(sonatas.length > 1 ? renderSonataPicker(echo, sonatas) : renderSingleSonata(echo, sonatas[0]))}
                    ${raw(renderLevelDial(echo.level))}
                </div>

                <h4 class="echo-editor__section">Main stat</h4>
                ${raw(renderMainStatRow(echo, dataset, cost))}

                <h4 class="echo-editor__section">Sub-main
                    <span class="echo-editor__hint">auto-derived</span>
                </h4>
                ${raw(renderSubMainRow(subMain))}

                <h4 class="echo-editor__section">Sub stats
                    <span class="echo-editor__hint">${unlocked} of 5 unlocked</span>
                </h4>
                ${raw(renderSubStatRows(echo, dataset, unlocked))}

                <div class="echo-editor__actions">
                    ${raw(state.onPickOther ? '<button class="btn" data-action="pick-other">Choose different echo</button>' : '')}
                    ${raw(state.onUnequip ? '<button class="btn btn--danger" data-action="unequip">Unequip</button>' : '')}
                    ${raw('<button class="btn btn--primary" data-action="save">Save</button>')}
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

function renderLevelDial(level) {
    return `
        <span class="echo-editor__dial">
            <button class="echo-editor__dial-btn"
                    data-action="adjust-level" data-step="-${ECHO_LEVEL_STEP}"
                    ${level <= 0 ? 'disabled' : ''}>−</button>
            <span class="echo-editor__dial-label">Lv</span>
            <span class="echo-editor__dial-value">${level}</span>
            <button class="echo-editor__dial-btn"
                    data-action="adjust-level" data-step="+${ECHO_LEVEL_STEP}"
                    ${level >= MAX_ECHO_LEVEL ? 'disabled' : ''}>+</button>
        </span>
    `;
}

function renderMainStatRow(echo, dataset, cost) {
    const pool = mainStatsForCost(cost, dataset);
    const m = echo.mainStat;
    const selKey = m ? statKey(m.propId, m.addType) : '';

    const opts = [`<option value="">— select —</option>`]
        .concat(pool.map(s => {
            const k = statKey(s.propId, s.addType);
            return `<option value="${k}" ${k === selKey ? 'selected' : ''}>${esc(s.name)}</option>`;
        }))
        .join('');

    // Auto-derive the value from cost + starLevel + level — no manual input.
    const starLevel = echo.starLevel ?? 5;
    const autoValue = m ? mainStatValueFor(m, cost, starLevel, echo.level, dataset) : null;
    const displayNum = autoValue != null ? String(autoValue) : (m ? '—' : '');
    const suffix = m?.isPercent ? '%' : '';

    return `
        <div class="stat-row">
            <select class="echo-editor__select stat-row__select" data-action="set-main-key">
                ${opts}
            </select>
            <span class="stat-row__derived-value" title="Auto-derived: ${starLevel}★ Lv${echo.level}">
                ${esc(displayNum)}
            </span>
            <span class="stat-row__suffix">${esc(suffix)}</span>
        </div>
    `;
}

function renderSubMainRow(subMain) {
    if (!subMain) {
        return `<div class="stat-row stat-row--derived"><span class="stat-row__derived-name">— (unknown cost)</span></div>`;
    }
    return `
        <div class="stat-row stat-row--derived" title="Auto-derived from cost + level. Not editable.">
            <span class="stat-row__derived-name">${esc(subMain.name)}</span>
            <span class="stat-row__derived-value">${esc(String(subMain.value))}</span>
            <span class="stat-row__suffix">${esc(subMain.isPercent ? '%' : '')}</span>
        </div>
    `;
}

function renderSubStatRows(echo, dataset, unlocked) {
    const subs = echo.subStats || [];
    const statRanges = dataset.statRanges || {};

    const chosenKeys = new Set();
    for (const s of subs) {
        if (s) chosenKeys.add(statKey(s.propId, s.addType));
    }

    const rows = [];
    for (let i = 0; i < 5; i++) {
        const unlockedRow = i < unlocked;
        const s = subs[i];
        rows.push(renderOneSubRow(i, s, dataset, chosenKeys, unlockedRow, statRanges));
    }
    return `<div class="stat-rows">${rows.join('')}</div>`;
}

function renderOneSubRow(index, s, dataset, chosenKeys, unlocked, statRanges) {
    if (!unlocked) {
        return `
            <div class="stat-row stat-row--locked" data-sub-index="${index}">
                <span class="stat-row__locked">Locked — unlocks at level ${(index + 1) * ECHO_LEVEL_STEP}</span>
            </div>
        `;
    }

    const selKey = s ? statKey(s.propId, s.addType) : '';

    const keyOpts = [`<option value="">— select —</option>`]
        .concat(dataset.echoSubStats.map(opt => {
            const k = statKey(opt.propId, opt.addType);
            const isOurOwn = k === selKey;
            const isTaken = chosenKeys.has(k) && !isOurOwn;
            return `<option value="${k}" ${k === selKey ? 'selected' : ''} ${isTaken ? 'disabled' : ''}>${esc(opt.name)}${isTaken ? ' (taken)' : ''}</option>`;
        }))
        .join('');

    let valueControl;
    if (s) {
        const rolls = possibleRollsFor(s, statRanges);
        if (rolls.length > 0) {
            const valOpts = [`<option value="">— roll —</option>`]
                .concat(rolls.map(v => `<option value="${v}" ${Number(s.value) === Number(v) ? 'selected' : ''}>${v}${s.isPercent ? '%' : ''}</option>`))
                .join('');
            valueControl = `
                <select class="echo-editor__select stat-row__value-select"
                        data-action="set-sub-value" data-index="${index}">
                    ${valOpts}
                </select>
            `;
        } else {
            valueControl = `
                <input class="stat-row__value" type="number" step="0.1" min="0"
                       placeholder="value" value="${esc(String(s.value ?? ''))}"
                       data-action="set-sub-value-input" data-index="${index}">
            `;
        }
    } else {
        valueControl = `<span class="stat-row__placeholder">—</span>`;
    }

    return `
        <div class="stat-row" data-sub-index="${index}">
            <select class="echo-editor__select stat-row__select"
                    data-action="set-sub-key" data-index="${index}">
                ${keyOpts}
            </select>
            ${valueControl}
            <span class="stat-row__suffix">${esc(s?.isPercent ? '%' : '')}</span>
            <button class="stat-row__clear"
                    data-action="clear-sub" data-index="${index}"
                    ${s ? '' : 'disabled'}
                    title="Clear this row">×</button>
        </div>
    `;
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
// Events
// =============================================================================

function paint() { render(mountEl, renderRoot()); }

// Look up a stat option by its "propId:addType" key.
// For main stats, echoMainStats is a cost-keyed map so we must know
// the echo's cost to search the right pool. Passing cost=null falls
// back to scanning all cost pools (used by the codec name-restore path).
function lookupStatOpt(dataset, key, kind, cost = null) {
    if (!key) return null;
    const parsed = parseStatKey(key);
    if (!parsed) return null;

    if (kind === 'main') {
        const map = dataset.echoMainStats ?? {};
        // Search either the specific cost pool or all pools
        const pools = cost != null
            ? [map[cost] ?? []]
            : Object.values(map);
        for (const pool of pools) {
            const found = (pool ?? []).find(
                s => s.propId === parsed.propId && s.addType === parsed.addType
            );
            if (found) return found;
        }
        return null;
    }

    // Sub stats remain a flat array
    const pool = dataset.echoSubStats ?? [];
    return pool.find(s => s.propId === parsed.propId && s.addType === parsed.addType) || null;
}

function bind() {
    const root = mountEl;
    on(root, 'click', '[data-action="close"]', () => close());

    on(root, 'click', '[data-action="save"]', () => {
        const onSave = state.onSave;
        const echo = state.echo;
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

    on(root, 'change', '[data-action="set-sonata"]', (e) => {
        const v = e.target.value;
        state.echo = { ...state.echo, sonataId: v ? Number(v) : null };
        paint();
    });

    on(root, 'click', '[data-action="adjust-level"]', (_e, btn) => {
        const step = Number(btn.dataset.step);
        const next = snapLevel((state.echo.level ?? 0) + step);
        if (next === state.echo.level) return;
        state.echo = { ...state.echo, level: next };
        // Re-derive main stat value for the new level
        if (state.echo.mainStat) {
            const starLevel = state.echo.starLevel ?? 5;
            const cost = state.echo.cost ?? 4;
            const autoValue = mainStatValueFor(state.echo.mainStat, cost, starLevel, next, state.dataset) ?? 0;
            state.echo = {
                ...state.echo,
                mainStat: { ...state.echo.mainStat, value: autoValue },
            };
        }
        // Trim substats above unlock count when level drops
        const unlocked = unlockedSubStatCount(next);
        if ((state.echo.subStats?.length ?? 0) > unlocked) {
            state.echo = { ...state.echo, subStats: state.echo.subStats.slice(0, unlocked) };
        }
        paint();
    });

    on(root, 'change', '[data-action="set-main-key"]', (e) => {
        const cost = state.echo.cost ?? 4;
        const opt = lookupStatOpt(state.dataset, e.target.value, 'main', cost);
        if (!opt) {
            state.echo = { ...state.echo, mainStat: null };
        } else {
            // Auto-derive the value from starLevel + current level.
            const starLevel = state.echo.starLevel ?? 5;
            const cost = state.echo.cost ?? 4;
            const autoValue = mainStatValueFor(opt, cost, starLevel, state.echo.level, state.dataset) ?? 0;
            state.echo = {
                ...state.echo,
                mainStat: {
                    propId: opt.propId, addType: opt.addType,
                    name: opt.name, isPercent: opt.isPercent,
                    value: autoValue,
                },
            };
        }
        paint();
    });

    on(root, 'change', '[data-action="set-sub-key"]', (_e, sel) => {
        const i = Number(sel.dataset.index);
        const opt = lookupStatOpt(state.dataset, sel.value, 'sub');
        const subs = ensureSubArrayLength(state.echo.subStats, i + 1);
        if (!opt) {
            subs[i] = undefined;
        } else {
            const rolls = possibleRollsFor({ propId: opt.propId, addType: opt.addType }, state.dataset.statRanges);
            const def = rolls.length > 0 ? rolls[0] : 0;
            subs[i] = {
                propId: opt.propId, addType: opt.addType,
                name: opt.name, isPercent: opt.isPercent,
                value: def,
            };
        }
        state.echo = { ...state.echo, subStats: compact(subs) };
        paint();
    });

    on(root, 'change', '[data-action="set-sub-value"]', (_e, sel) => {
        const i = Number(sel.dataset.index);
        const v = parseFloat(sel.value);
        const subs = [...(state.echo.subStats || [])];
        if (!subs[i]) return;
        subs[i] = { ...subs[i], value: Number.isFinite(v) ? v : 0 };
        state.echo = { ...state.echo, subStats: subs };
    });

    on(root, 'input', '[data-action="set-sub-value-input"]', (_e, inp) => {
        const i = Number(inp.dataset.index);
        const v = parseFloat(inp.value);
        const subs = [...(state.echo.subStats || [])];
        if (!subs[i]) return;
        subs[i] = { ...subs[i], value: Number.isFinite(v) ? v : 0 };
        state.echo = { ...state.echo, subStats: subs };
    });

    on(root, 'click', '[data-action="clear-sub"]', (_e, btn) => {
        const i = Number(btn.dataset.index);
        const subs = [...(state.echo.subStats || [])];
        subs.splice(i, 1);
        state.echo = { ...state.echo, subStats: subs };
        paint();
    });
}

function ensureSubArrayLength(arr, len) {
    const out = [...(arr || [])];
    while (out.length < len) out.push(undefined);
    return out;
}
function compact(arr) { return arr.filter(x => x != null); }

// =============================================================================
// Public API
// =============================================================================

export function open(config) {
    const mount = ensureMount();
    state = {
        dataset: config.dataset,
        echo: deepClone(config.echo),
        slotIndex: config.slotIndex ?? 0,
        onSave: config.onSave,
        onUnequip: config.onUnequip,
        onPickOther: config.onPickOther,
    };
    state.echo.level = snapLevel(state.echo.level ?? MAX_ECHO_LEVEL);
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