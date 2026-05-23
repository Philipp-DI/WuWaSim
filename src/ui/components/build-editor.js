/**
 * Build editor.
 *
 * Renders the build for one resonator. Owns the editing UI: name field,
 * level/chain dials, weapon slot, skill levels, echo grid. Delegates the
 * picker UI to modal-picker for weapon/echo/sonata selection.
 *
 *   mount(root, { dataset, build, onChange, onBack, onSave, onDelete })
 *
 * Stateless w.r.t persistence — the parent (app.js) decides when to call
 * saveBuild(). `onChange` fires on every edit so the parent can autosave.
 */

import { html, raw, render, on, esc } from '../dom.js';
import * as modal from './modal-picker.js';
import {
    setLevel, setChain, setSkillLevel, setWeapon, setWeaponLevel, setWeaponRank,
    setEcho, setName, SKILL_KEYS, SKILL_LABELS, ECHO_SLOTS,
} from '../../core/build.js';

let api = null;  // { root, dataset, build, ...callbacks }

// =============================================================================
// Lookups against the dataset
// =============================================================================

function findResonator(dataset, id) {
    return dataset.resonators.find(r => r.id === id) || null;
}
function findWeapon(dataset, id) {
    return dataset.weapons.find(w => w.id === id) || null;
}
function findEcho(dataset, id) {
    return dataset.echoes.find(e => e.id === id) || null;
}
function findSonata(dataset, id) {
    return dataset.sonatas.find(s => s.id === id) || null;
}
function findElement(dataset, id) {
    return dataset.elements.find(e => e.id === id) || null;
}

// Color a sonata swatch by its dominant element family. Resolved by
// looking up the first echo in the dataset that belongs to the sonata,
// then taking its first ElementType. Fallback: accent.
function sonataColor(dataset, sonataId) {
    if (sonataId == null) return null;
    const echo = dataset.echoes.find(e => Array.isArray(e.sonataIds) && e.sonataIds.includes(sonataId));
    if (!echo) return null;
    const elId = echo.elementTypes?.[0];
    return findElement(dataset, elId)?.color ?? null;
}

// =============================================================================
// Render — head strip
// =============================================================================

function renderHead(resonator, build) {
    const elColor = resonator.elementColor;
    const portrait = resonator.iconUrl ? html`
        <img src="${esc(resonator.iconUrl)}" alt=""
             onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'portrait--missing',textContent:'No image'}))">
    ` : html`<div class="portrait--missing">No image</div>`;

    return html`
        <div class="editor__head" style="${raw(`--el-color:${elColor};`)}">
            <div class="portrait" style="${raw(`--el-color:${elColor};`)}">${raw(portrait)}</div>
            <div class="editor__title">
                <span class="editor__resonator-name">${esc(resonator.name)}</span>
                <span class="editor__resonator-meta">
                    <span><span class="swatch" style="${raw(`--el-color:${elColor};`)}"></span>${esc(elementName(resonator))}</span>
                    <span>·</span>
                    <span>${esc(resonator.weaponTypeName)}</span>
                    <span>·</span>
                    <span>${'★'.repeat(resonator.rarity)}</span>
                </span>
                <input class="build-name"
                       type="text"
                       value="${esc(build.name)}"
                       data-action="rename"
                       maxlength="40"
                       aria-label="Build name">
            </div>
            <div class="dial-group">
                ${raw(renderDial('Level', build.level, 'level', 1, resonator.maxLevel))}
                ${raw(renderDial('Chain', build.chain, 'chain', 0, 6))}
            </div>
        </div>
    `;
}

function elementName(resonator) {
    return api?.dataset?.elements?.find(e => e.id === resonator.element)?.name ?? '—';
}

function renderDial(label, value, kind, min, max) {
    return `
        <div class="dial">
            <span class="dial__label">${esc(label)}</span>
            <div class="dial__row">
                <button class="dial__btn" data-dial="${esc(kind)}" data-step="-1"
                        ${value <= min ? 'disabled' : ''} aria-label="Decrease ${esc(label)}">−</button>
                <span class="dial__value">${esc(String(value))}</span>
                <button class="dial__btn" data-dial="${esc(kind)}" data-step="+1"
                        ${value >= max ? 'disabled' : ''} aria-label="Increase ${esc(label)}">+</button>
            </div>
        </div>
    `;
}

// =============================================================================
// Render — sections
// =============================================================================

function renderWeapon(build, dataset) {
    if (!build.weapon) {
        return `
            <button class="weapon-slot" data-action="pick-weapon">
                <div class="weapon-slot__icon" data-letter="W"></div>
                <div class="weapon-slot__body">
                    <span class="weapon-slot__name weapon-slot__name--empty">— No weapon —</span>
                    <span class="weapon-slot__sub">Click to choose</span>
                </div>
            </button>
        `;
    }
    const w = findWeapon(dataset, build.weapon.id);
    if (!w) {
        return `
            <button class="weapon-slot" data-action="pick-weapon">
                <div class="weapon-slot__icon" data-letter="?"></div>
                <div class="weapon-slot__body">
                    <span class="weapon-slot__name">Unknown weapon (id ${esc(String(build.weapon.id))})</span>
                    <span class="weapon-slot__sub">Click to re-pick</span>
                </div>
            </button>
        `;
    }
    const baseStat = w.baseStat ? `${w.baseStat.name} ${formatStatBase(w.baseStat)}` : '';
    const subStat  = w.subStat  ? `${w.subStat.name} ${formatStatBase(w.subStat)}`  : '';
    return `
        <button class="weapon-slot" data-action="pick-weapon">
            <div class="weapon-slot__icon" data-letter="${esc(w.name.charAt(0))}"></div>
            <div class="weapon-slot__body">
                <span class="weapon-slot__name">${esc(w.name)}</span>
                <span class="weapon-slot__sub">${esc(baseStat)}${subStat ? ' · ' + esc(subStat) : ''}</span>
            </div>
            <div class="weapon-slot__controls">
                <span class="weapon-slot__rarity" data-rarity="${w.rarity}">${'★'.repeat(w.rarity)}</span>
                <span class="option__badge">Lv ${esc(String(build.weapon.level))} · R${esc(String(build.weapon.rank))}</span>
            </div>
        </button>
    `;
}

function formatStatBase(stat) {
    if (!stat) return '';
    if (stat.isPercent) return `${stat.baseValue.toFixed(1)}%`;
    return String(Math.round(stat.baseValue));
}

function renderSkills(build) {
    return SKILL_KEYS.map(key => {
        const level = build.skillLevels[key];
        return `
            <div class="skill-row">
                <span class="skill-row__label">${esc(SKILL_LABELS[key])}</span>
                <div class="skill-row__controls">
                    <button class="dial__btn" data-skill="${esc(key)}" data-step="-1"
                            ${level <= 1 ? 'disabled' : ''} aria-label="Decrease ${esc(SKILL_LABELS[key])}">−</button>
                    <span class="skill-row__value">${esc(String(level))}</span>
                    <button class="dial__btn" data-skill="${esc(key)}" data-step="+1"
                            ${level >= 10 ? 'disabled' : ''} aria-label="Increase ${esc(SKILL_LABELS[key])}">+</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderEchoes(build, dataset) {
    const slots = [];
    for (let i = 0; i < ECHO_SLOTS; i++) {
        const e = build.echoes[i];
        // Slot 0 = main echo (4-cost); other slots accept any cost the
        // player has unlocked, but the UI shows cost as a hint.
        const targetCost = i === 0 ? 4 : i <= 2 ? 3 : 1;
        slots.push(renderEchoSlot(i, e, targetCost, dataset));
    }
    return `<div class="echo-grid">${slots.join('')}</div>`;
}

function renderEchoSlot(index, echo, targetCost, dataset) {
    if (!echo) {
        return `
            <button class="echo-slot" data-action="pick-echo" data-slot="${index}" data-target-cost="${targetCost}">
                <div class="echo-slot__head">
                    <span>SLOT ${index + 1}</span>
                    <span class="echo-slot__cost">${targetCost}-COST</span>
                </div>
                <div class="echo-slot__body">
                    <span class="echo-slot__name echo-slot__name--empty">Empty</span>
                </div>
            </button>
        `;
    }
    const def = findEcho(dataset, echo.id);
    const name = def ? def.name : `Unknown #${echo.id}`;
    const sColor = sonataColor(dataset, echo.sonataId);
    return `
        <button class="echo-slot" data-action="pick-echo" data-slot="${index}" data-target-cost="${targetCost}">
            <div class="echo-slot__head">
                <span>SLOT ${index + 1}</span>
                <span class="echo-slot__cost">${echo.cost}-COST</span>
            </div>
            <div class="echo-slot__body">
                ${sColor ? `<span class="echo-slot__sonata" style="--sonata-color:${sColor};"></span>` : ''}
                <span class="echo-slot__name">${esc(name)}</span>
                ${echo.mainStat ? `<span class="echo-slot__main">${esc(echo.mainStat.name || '')}</span>` : ''}
            </div>
        </button>
    `;
}

// =============================================================================
// Whole editor render
// =============================================================================

function renderRoot() {
    const { dataset, build } = api;
    const resonator = findResonator(dataset, build.resonatorId);
    if (!resonator) {
        return html`
            <div class="state state--error">
                <span class="eyebrow">Error</span>
                <p>Resonator id ${esc(String(build.resonatorId))} not in dataset.</p>
                <button class="btn btn--back" data-action="back">Back to picker</button>
            </div>
        `;
    }
    return html`
        <div class="editor">
            ${raw(renderHead(resonator, build))}
            <div class="editor__body">
                <div class="section">
                    <h3 class="section__title">Weapon</h3>
                    ${raw(renderWeapon(build, dataset))}
                </div>
                <div class="section">
                    <h3 class="section__title">Skill levels</h3>
                    <div class="skill-grid">${raw(renderSkills(build))}</div>
                </div>
                <div class="section" style="grid-column: 1 / -1;">
                    <h3 class="section__title">Echoes</h3>
                    ${raw(renderEchoes(build, dataset))}
                </div>
            </div>
        </div>
    `;
}

// =============================================================================
// Pickers — wire up the modal for weapon / echo / sonata
// =============================================================================

function openWeaponPicker() {
    const { dataset, build } = api;
    const resonator = findResonator(dataset, build.resonatorId);
    const weaponsOfType = dataset.weapons.filter(w => w.type === resonator.weaponType);
    modal.open({
        title: `Choose a ${resonator.weaponTypeName}`,
        items: weaponsOfType,
        searchFields: ['name'],
        allowUnequip: !!build.weapon,
        filters: [
            {
                kind: 'rarity', label: 'Rarity',
                options: [
                    { value: 5, label: '5★', test: (w, v) => w.rarity === v },
                    { value: 4, label: '4★', test: (w, v) => w.rarity === v },
                    { value: 3, label: '3★', test: (w, v) => w.rarity === v },
                    { value: 2, label: '2★', test: (w, v) => w.rarity === v },
                    { value: 1, label: '1★', test: (w, v) => w.rarity === v },
                ],
            },
        ],
        renderRow: (w) => {
            const rarityClass = w.rarity === 5 ? 'option__badge--gold' : '';
            const baseLine = w.baseStat ? `${w.baseStat.name} ${formatStatBase(w.baseStat)}` : '';
            return `
                <div class="option__body">
                    <span class="option__name">${esc(w.name)}</span>
                    <span class="option__sub">${esc(baseLine)}</span>
                </div>
                <span class="option__badge ${rarityClass}">${'★'.repeat(w.rarity)}</span>
            `;
        },
        onPick: (item) => {
            api.build = setWeapon(api.build, item ? item.id : null);
            api.onChange?.(api.build);
            paint();
        },
    });
}

function openEchoPicker(slotIndex, targetCost) {
    const { dataset, build } = api;
    // Filter by slot's nominal cost, but let the user override via the
    // "Cost" filter.
    const items = dataset.echoes;
    modal.open({
        title: `Slot ${slotIndex + 1} — choose an echo`,
        items,
        searchFields: ['name'],
        allowUnequip: !!build.echoes[slotIndex],
        filters: [
            {
                kind: 'cost', label: 'Cost',
                options: [
                    { value: 4, label: '4-cost', test: (e, v) => e.cost === v },
                    { value: 3, label: '3-cost', test: (e, v) => e.cost === v },
                    { value: 1, label: '1-cost', test: (e, v) => e.cost === v },
                ],
            },
            {
                kind: 'element', label: 'Element',
                options: dataset.elements.map(el => ({
                    value: el.id, label: el.name, color: el.color,
                    test: (e, v) => (e.elementTypes || []).includes(Number(v)),
                })),
            },
        ],
        renderRow: (e) => `
            <div class="option__body">
                <span class="option__name">${esc(e.name)}</span>
                <span class="option__sub">${e.cost}-cost · ${e.elementTypes.length ? 'elem ' + e.elementTypes.join(',') : 'untyped'}</span>
            </div>
            <span class="option__badge">${e.cost}c</span>
        `,
        onPick: (item) => {
            if (!item) {
                api.build = setEcho(api.build, slotIndex, null);
            } else {
                api.build = setEcho(api.build, slotIndex, {
                    id: item.id,
                    cost: item.cost,
                    level: 25,
                    mainStat: null,
                    subStats: [],
                    sonataId: item.sonataIds?.[0] ?? null,
                });
            }
            api.onChange?.(api.build);
            paint();
        },
    });
    // Pre-select cost filter for the slot
    requestAnimationFrame(() => {
        const chip = document.querySelector(`.modal.is-open .chip[data-kind="cost"][data-value="${targetCost}"]`);
        if (chip) chip.click();
    });
}

// =============================================================================
// Render / event wiring
// =============================================================================

function paint() {
    render(api.root, renderRoot());
}

function bindEvents() {
    const root = api.root;

    on(root, 'click', '[data-dial]', (_e, btn) => {
        const dial = btn.dataset.dial;
        const step = Number(btn.dataset.step);
        if (dial === 'level') api.build = setLevel(api.build, api.build.level + step);
        if (dial === 'chain') api.build = setChain(api.build, api.build.chain + step);
        api.onChange?.(api.build);
        paint();
    });

    on(root, 'click', '[data-skill]', (_e, btn) => {
        const key  = btn.dataset.skill;
        const step = Number(btn.dataset.step);
        api.build = setSkillLevel(api.build, key, api.build.skillLevels[key] + step);
        api.onChange?.(api.build);
        paint();
    });

    on(root, 'click', '[data-action="pick-weapon"]', () => openWeaponPicker());
    on(root, 'click', '[data-action="pick-echo"]',   (_e, btn) => {
        openEchoPicker(Number(btn.dataset.slot), Number(btn.dataset.targetCost));
    });

    on(root, 'input', '[data-action="rename"]', (e) => {
        api.build = setName(api.build, e.target.value);
        api.onChange?.(api.build);
        // Don't repaint — would lose focus on the input.
    });

    on(root, 'click', '[data-action="back"]', () => api.onBack?.());
}

export function mount(root, opts) {
    api = {
        root,
        dataset:  opts.dataset,
        build:    opts.build,
        onChange: opts.onChange,
        onBack:   opts.onBack,
    };
    paint();
    bindEvents();
    return {
        getBuild: () => api.build,
        destroy: () => { root.innerHTML = ''; api = null; },
    };
}
