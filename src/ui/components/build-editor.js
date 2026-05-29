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
import * as echoEditor from './echo-stat-editor.js';
import { mount as mountStats } from './stats-panel.js';
import { mount as mountDamage } from './damage-panel.js';
import { mount as mountRotation } from './rotation-panel.js';
import {
    setLevel, setChain, setSkillLevel, setInherentSkill, setStatNode, setWeapon, setWeaponLevel, setWeaponRank,
    setEcho, setName, SKILL_KEYS, SKILL_LABELS, ECHO_SLOTS,
} from '../../core/build.js';
import { totalEchoCost, COST_BUDGET } from '../../core/echo-rules.js';

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

    const lv = build.weapon.level;
    const curves = dataset.weaponGrowthCurves ?? {};
    const { base: baseStat, sub: subStat } = formatWeaponStats(w, lv, curves);

    // .weapon-slot is now a <div> so we can nest real <button> elements
    // inside it without triggering the invalid-HTML nested-button rule.
    // The pick area is its own <button> (data-action="pick-weapon") and
    // the dials sit beside it.
    return `
        <div class="weapon-slot">
            <button class="weapon-slot__pick" data-action="pick-weapon">
                <div class="weapon-slot__icon" data-letter="${esc(w.name.charAt(0))}"></div>
                <div class="weapon-slot__body">
                    <span class="weapon-slot__name">${esc(w.name)}</span>
                    <span class="weapon-slot__sub">${esc(baseStat)}${subStat ? ' · ' + esc(subStat) : ''}</span>
                </div>
            </button>
            <div class="weapon-slot__controls">
                <span class="weapon-slot__rarity" data-rarity="${w.rarity}">${'★'.repeat(w.rarity)}</span>
                <span class="weapon-slot__dials">
                    ${renderWeaponDial('Lv', lv, 'weapon-level', 1, 90)}
                    ${renderWeaponDial('R', build.weapon.rank, 'weapon-rank', 1, w.maxRank)}
                </span>
            </div>
        </div>
    `;
}

// Format a weapon's stats for display at a given level.
// Handles both weapon shapes:
//   Dimbreath: w.baseStat / w.subStat with growth-curve math
//   nanoka:    w.statsByLevel[level] with pre-resolved values
function formatWeaponStats(w, level, curves) {
    if (!w) return { base: '', sub: '' };

    // ── nanoka weapon ─────────────────────────────────────────────────────────
    if (w.source === 'nanoka' && w.statsByLevel) {
        const s = w.statsByLevel[String(level)] ?? w.statsByLevel['90'];
        if (!s) return { base: '', sub: '' };
        const base = `ATK ${Math.floor(s.atk ?? 0)}`;
        let sub = '';
        if (w.subStatName) {
            // Find the sub-stat value from the known keys
            const SUB_KEY = {
                'Crit. Rate': s.critRate,
                'Crit. DMG': s.critDmg,
                'Energy Regen': s.energyRegen,
                'ATK%': s.atkPct,
                'HP%': s.hpPct,
                'DEF%': s.defPct,
                'ATK': s.atk,
                'HP': s.hp,
                'DEF': s.def,
            };
            const val = SUB_KEY[w.subStatName];
            if (val != null) {
                const isFlat = w.subStatName === 'ATK' || w.subStatName === 'HP' || w.subStatName === 'DEF';
                sub = isFlat
                    ? `${w.subStatName} ${Math.floor(val)}`
                    : `${w.subStatName} ${(val * 100).toFixed(1)}%`;
            }
        }
        return { base, sub };
    }

    // ── Dimbreath weapon (baseStat / subStat + growth curves) ─────────────────
    const fmt = (stat, curveId) => {
        if (!stat) return '';
        const curve = (curves[String(curveId)] ?? {})[String(level)] ?? 1;
        const scaled = stat.baseValue * curve;
        if (stat.isPercent) return `${stat.name} ${(scaled / 10000 * 100).toFixed(1)}%`;
        return `${stat.name} ${Math.floor(scaled)}`;
    };
    return {
        base: fmt(w.baseStat, w.baseCurveId),
        sub: fmt(w.subStat, w.subCurveId),
    };
}

// Compact inline +/− dial for weapon level and rank. The buttons use
// data-action instead of propagating a click to the parent weapon-slot
// so they are caught by the bindEvents handler before bubbling.
function renderWeaponDial(label, value, action, min, max) {
    return `<span class="weapon-dial">
        <button class="weapon-dial__btn" data-action="${esc(action)}" data-step="-1"
                ${value <= min ? 'disabled' : ''}>−</button>
        <span class="weapon-dial__label">${esc(label)}</span>
        <span class="weapon-dial__value">${esc(String(value))}</span>
        <button class="weapon-dial__btn" data-action="${esc(action)}" data-step="+1"
                ${value >= max ? 'disabled' : ''}>+</button>
    </span>`;
}

function renderSkills(build, dataset) {
    const reso = dataset?.resonators?.find(r => r.id === build.resonatorId);
    const inherentSkills = reso?.inherentSkills ?? [];
    const statNodes = reso?.statNodeBonuses ?? {};
    const inherentActive = build.inherentSkillsActive ?? [true, true];
    const statActive = build.statNodesActive ?? {};

    return SKILL_KEYS.map(key => {
        const level = build.skillLevels[key];

        // ── Stat/passive node toggles attached below this column ─────────────
        let passiveSection = '';

        if (key === 'forte') {
            // Forte Circuit column → Inherent Skills
            if (inherentSkills.length) {
                const rows = inherentSkills.map((sk, i) => `
                    <label class="inherent-row" title="${esc(sk.desc)}">
                        <input type="checkbox" class="inherent-check" data-inherent="${i}"
                               ${inherentActive[i] !== false ? 'checked' : ''}>
                        <span class="inherent-row__name">${esc(sk.name)}</span>
                    </label>
                `).join('');
                passiveSection = `<div class="passive-nodes">${rows}</div>`;
            }
        } else {
            // Normal Attack / Resonance Skill / Liberation / Intro → stat nodes
            const colNodes = statNodes[key] ?? [];
            if (colNodes.length) {
                const colAct = statActive[key] ?? [true, true];
                const rows = colNodes.map((node, i) => {
                    const tier = node.tier - 1;   // 0-indexed for statNodesActive
                    const label = `${node.name.replace('+', '')} +${(node.value * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
                    return `
                        <label class="inherent-row" title="${esc(label)}">
                            <input type="checkbox" class="stat-node-check"
                                   data-col="${esc(key)}" data-tier="${tier}"
                                   ${colAct[tier] !== false ? 'checked' : ''}>
                            <span class="inherent-row__name">${esc(label)}</span>
                        </label>
                    `;
                }).join('');
                passiveSection = `<div class="passive-nodes">${rows}</div>`;
            }
        }

        return `
            <div class="skill-col">
                <div class="skill-row">
                    <span class="skill-row__label">${esc(SKILL_LABELS[key])}</span>
                    <div class="skill-row__controls">
                        <button class="dial__btn" data-skill="${esc(key)}" data-step="-1"
                                ${level <= 1 ? 'disabled' : ''}>−</button>
                        <span class="skill-row__value">${esc(String(level))}</span>
                        <button class="dial__btn" data-skill="${esc(key)}" data-step="+1"
                                ${level >= 10 ? 'disabled' : ''}>+</button>
                    </div>
                </div>
                ${passiveSection}
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

// Cost budget indicator. Soft warning: shows red and a "!" when over
// budget but doesn't block the user.
function renderCostBadge(build) {
    const total = totalEchoCost(build.echoes);
    const over = total > COST_BUDGET;
    return `
        <span class="cost-badge ${over ? 'cost-badge--over' : ''}" title="Total echo cost. Max ${COST_BUDGET}.">
            <span class="cost-badge__label">Cost</span>
            <span class="cost-badge__value">${total}/${COST_BUDGET}</span>
            ${over ? '<span class="cost-badge__warn">!</span>' : ''}
        </span>
    `;
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
    // Show a quick visual summary of how many stats are set: main + sub
    // count gives the user a quick "is this echo finished?" check.
    const subCount = (echo.subStats || []).length;
    const mainSet = !!echo.mainStat;
    return `
        <button class="echo-slot" data-action="edit-echo" data-slot="${index}">
            <div class="echo-slot__head">
                <span>SLOT ${index + 1}</span>
                <span class="echo-slot__cost">${echo.cost}-COST</span>
            </div>
            <div class="echo-slot__body">
                ${sColor ? `<span class="echo-slot__sonata" style="--sonata-color:${sColor};"></span>` : ''}
                <span class="echo-slot__name">${esc(name)}</span>
                <span class="echo-slot__stats">${mainSet ? '●' : '○'}${' ' + '◆'.repeat(subCount) + '◇'.repeat(5 - subCount)}</span>
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
                    <div class="skill-grid">${raw(renderSkills(build, dataset))}</div>
                </div>
                <div class="section" style="grid-column: 1 / -1;">
                    <div class="section__header-row">
                        <h3 class="section__title">Echoes</h3>
                        ${raw(renderCostBadge(build))}
                    </div>
                    ${raw(renderEchoes(build, dataset))}
                </div>
            </div>
            <div class="editor__damage-area">
                <div data-region="stats-panel"></div>
                <div data-region="damage-panel"></div>
            </div>
            <div class="editor__rotation-area">
                <div data-region="rotation-panel"></div>
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
            const curves = api.dataset.weaponGrowthCurves ?? {};
            const { base: baseLine, sub: subLine } = formatWeaponStats(w, 1, curves);
            const statLine = baseLine + (subLine ? ' · ' + subLine : '');
            return `
                <div class="option__body">
                    <span class="option__name">${esc(w.name)}</span>
                    <span class="option__sub">${esc(statLine)}</span>
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
    // Filter out echoes with no name (incomplete nanoka entries)
    const items = dataset.echoes.filter(e => e.name);
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
                kind: 'class', label: 'Class',
                options: [
                    { value: 'Calamity', label: 'Calamity', test: (e, v) => e.className === v },
                    { value: 'Overlord', label: 'Overlord', test: (e, v) => e.className === v },
                    { value: 'Elite', label: 'Elite', test: (e, v) => e.className === v },
                    { value: 'Common', label: 'Common', test: (e, v) => e.className === v },
                ],
            },
        ],
        renderRow: (e) => {
            // Element comes from active skill (nanoka) or elementTypes (Dimbreath)
            const el = e.activeSkill?.element
                ?? (e.elementTypes?.length ? e.elementTypes[0] : null);
            const elName = el ? (dataset.elements.find(x => x.id === el)?.name ?? '') : '';
            return `
                <div class="option__body">
                    <span class="option__name">${esc(e.name)}</span>
                    <span class="option__sub">${e.cost}-cost · ${e.className}${elName ? ' · ' + elName : ''}</span>
                </div>
                <span class="option__badge">${e.cost}c</span>
            `;
        },
        onPick: (item) => {
            if (!item) {
                api.build = setEcho(api.build, slotIndex, null);
                api.onChange?.(api.build);
                paint();
                return;
            }
            const newEcho = {
                id: item.id,
                cost: item.cost,
                level: 25,
                starLevel: item.starLevel ?? 5,
                mainStat: null,
                subStats: [],
                sonataId: item.sonataIds?.[0] ?? null,
            };
            api.build = setEcho(api.build, slotIndex, newEcho);
            api.onChange?.(api.build);
            paint();
            openEchoStatEditor(slotIndex);
        },
    });
    // Pre-select cost filter for the slot
    requestAnimationFrame(() => {
        const chip = document.querySelector(`.modal.is-open .chip[data-kind="cost"][data-value="${targetCost}"]`);
        if (chip) chip.click();
    });
}

// Open the per-echo stat editor. Used both on slot click (when an echo
// is already equipped) and immediately after picking a new echo so the
// user can fill in main/sub stats.
function openEchoStatEditor(slotIndex) {
    const echo = api.build.echoes[slotIndex];
    if (!echo) return;
    echoEditor.open({
        dataset: api.dataset,
        echo,
        slotIndex,
        onSave: (updated) => {
            api.build = setEcho(api.build, slotIndex, updated);
            api.onChange?.(api.build);
            paint();
        },
        onUnequip: () => {
            api.build = setEcho(api.build, slotIndex, null);
            api.onChange?.(api.build);
            paint();
        },
        onPickOther: () => {
            // Drop into the picker so the user can swap to a different
            // echo for this slot. The current cost determines the picker's
            // default filter.
            openEchoPicker(slotIndex, echo.cost);
        },
    });
}

// =============================================================================
// Render / event wiring
// =============================================================================

function paint() {
    render(api.root, renderRoot());
    // After full repaint, re-mount the sub-panels into their dedicated
    // regions. They keep their own internal state across remounts (which
    // is rare); the per-build re-render path is `updatePanels()` below.
    mountSubPanels();
}

function mountSubPanels() {
    const statsRoot = api.root.querySelector('[data-region="stats-panel"]');
    const damageRoot = api.root.querySelector('[data-region="damage-panel"]');
    const rotationRoot = api.root.querySelector('[data-region="rotation-panel"]');
    if (statsRoot) api.stats = mountStats(statsRoot, { dataset: api.dataset, build: api.build });
    if (damageRoot) api.damage = mountDamage(damageRoot, { dataset: api.dataset, build: api.build });
    if (rotationRoot) api.rotation = mountRotation(rotationRoot, {
        dataset: api.dataset,
        build: api.build,
        target: defaultTarget(api.build),
        onChange: (next) => {
            // Rotation edits change the build (rotation array). Persist
            // and refresh the other panels' build references so the stats
            // panel and damage panel see the new build (they don't depend
            // on rotation but consistency keeps things simple).
            api.build = next;
            api.onChange?.(api.build);
            api.stats?.update(api.build);
            api.damage?.update(api.build);
        },
    });
}

// Default target the rotation simulator uses. Phase 5 keeps this simple
// (lv90 enemy, 10% RES across the board); Phase 6 will wire the damage
// panel's target inputs to the rotation panel so both share one source.
function defaultTarget(build) {
    return {
        level: 90,
        atkLv: build.level ?? 90,
        resistances: { 0: 0, 1: 0.10, 2: 0.10, 3: 0.10, 4: 0.10, 5: 0.10, 6: 0.10 },
    };
}

// Cheap re-render path used by editor controls. Avoids a full editor
// repaint when only the build's numeric state changed — keeps the
// damage-panel's expanded-card and target-input states intact.
function refreshPanels() {
    api.stats?.update(api.build);
    api.damage?.update(api.build);
    api.rotation?.update(api.build);
}

function bindEvents() {
    const root = api.root;

    on(root, 'click', '[data-dial]', (_e, btn) => {
        const dial = btn.dataset.dial;
        const step = Number(btn.dataset.step);
        if (dial === 'level') api.build = setLevel(api.build, api.build.level + step);
        if (dial === 'chain') api.build = setChain(api.build, api.build.chain + step);
        api.onChange?.(api.build);
        updateDials();
        refreshPanels();
    });

    on(root, 'click', '[data-skill]', (_e, btn) => {
        const key = btn.dataset.skill;
        const step = Number(btn.dataset.step);
        api.build = setSkillLevel(api.build, key, api.build.skillLevels[key] + step);
        api.onChange?.(api.build);
        updateSkillRow(key);
        refreshPanels();
    });

    on(root, 'change', '.inherent-check', (_e, chk) => {
        const i = Number(chk.dataset.inherent);
        api.build = setInherentSkill(api.build, i, chk.checked);
        api.onChange?.(api.build);
        refreshPanels();
    });

    on(root, 'change', '.stat-node-check', (_e, chk) => {
        const col = chk.dataset.col;
        const tier = Number(chk.dataset.tier);
        api.build = setStatNode(api.build, col, tier, chk.checked);
        api.onChange?.(api.build);
        refreshPanels();
    });

    on(root, 'click', '[data-action="pick-weapon"]', () => openWeaponPicker());

    // Weapon level / rank dials sit inside the .weapon-slot button. Stop
    // propagation so clicking +/− doesn't also trigger pick-weapon.
    on(root, 'click', '[data-action="weapon-level"]', (e, btn) => {
        e.stopPropagation();
        if (!api.build.weapon) return;
        const next = api.build.weapon.level + Number(btn.dataset.step);
        api.build = setWeaponLevel(api.build, next);
        api.onChange?.(api.build);
        updateWeaponSlot();
        refreshPanels();
    });
    on(root, 'click', '[data-action="weapon-rank"]', (e, btn) => {
        e.stopPropagation();
        if (!api.build.weapon) return;
        const next = api.build.weapon.rank + Number(btn.dataset.step);
        api.build = setWeaponRank(api.build, next);
        api.onChange?.(api.build);
        updateWeaponSlot();
        refreshPanels();
    });

    on(root, 'click', '[data-action="pick-echo"]', (_e, btn) => {
        openEchoPicker(Number(btn.dataset.slot), Number(btn.dataset.targetCost));
    });

    on(root, 'click', '[data-action="edit-echo"]', (_e, btn) => {
        openEchoStatEditor(Number(btn.dataset.slot));
    });

    on(root, 'input', '[data-action="rename"]', (e) => {
        api.build = setName(api.build, e.target.value);
        api.onChange?.(api.build);
        // Don't repaint — would lose focus on the input.
    });

    on(root, 'click', '[data-action="back"]', () => api.onBack?.());
}

// Surgical DOM updates so the sub-panels (with their own state) don't
// remount on every dial click.
function updateDials() {
    const root = api.root;
    const values = root.querySelectorAll('.editor__head .dial__value');
    if (values[0]) values[0].textContent = String(api.build.level);
    if (values[1]) values[1].textContent = String(api.build.chain);
    // Disabled states
    const reso = findResonator(api.dataset, api.build.resonatorId);
    setDialDisabled(root, 'level', api.build.level, 1, reso?.maxLevel ?? 90);
    setDialDisabled(root, 'chain', api.build.chain, 0, 6);
}
function setDialDisabled(root, kind, value, min, max) {
    const minus = root.querySelector(`[data-dial="${kind}"][data-step="-1"]`);
    const plus = root.querySelector(`[data-dial="${kind}"][data-step="+1"]`);
    if (minus) minus.disabled = value <= min;
    if (plus) plus.disabled = value >= max;
}
function updateSkillRow(key) {
    const root = api.root;
    const row = root.querySelector(`.skill-row:has(.dial__btn[data-skill="${key}"])`);
    if (!row) return;
    const value = api.build.skillLevels[key];
    const valueEl = row.querySelector('.skill-row__value');
    if (valueEl) valueEl.textContent = String(value);
    const minus = row.querySelector(`[data-step="-1"]`);
    const plus = row.querySelector(`[data-step="+1"]`);
    if (minus) minus.disabled = value <= 1;
    if (plus) plus.disabled = value >= 10;
}

// Surgically refresh the weapon slot without a full repaint so the
// damage-panel's expanded state is preserved.
function updateWeaponSlot() {
    const root = api.root;
    const slot = root.querySelector('.weapon-slot');
    if (!slot || !api.build.weapon) return;
    const w = findWeapon(api.dataset, api.build.weapon.id);
    if (!w) return;

    const lv = api.build.weapon.level;
    const rank = api.build.weapon.rank;
    const curves = api.dataset.weaponGrowthCurves ?? {};

    // Update stat sub-line inside the pick area
    const sub = slot.querySelector('.weapon-slot__sub');
    if (sub) {
        const { base: baseLine, sub: subLine } = formatWeaponStats(w, lv, curves);
        sub.textContent = baseLine + (subLine ? ' · ' + subLine : '');
    }

    // Update both dials: value text + disabled states
    updateWeaponDial(slot, 'weapon-level', lv, 1, 90);
    updateWeaponDial(slot, 'weapon-rank', rank, 1, w.maxRank);
}

function updateWeaponDial(slot, action, value, min, max) {
    // Find the value span that's a sibling of the buttons with this action.
    // Selects the first .weapon-dial__value inside the .weapon-dial that
    // contains a button with the matching data-action.
    const dials = slot.querySelectorAll('.weapon-dial');
    for (const dial of dials) {
        if (!dial.querySelector(`[data-action="${action}"]`)) continue;
        const valueEl = dial.querySelector('.weapon-dial__value');
        if (valueEl) valueEl.textContent = String(value);
        const minus = dial.querySelector(`[data-step="-1"]`);
        const plus = dial.querySelector(`[data-step="+1"]`);
        if (minus) minus.disabled = value <= min;
        if (plus) plus.disabled = value >= max;
        break;
    }
}

export function mount(root, opts) {
    api = {
        root,
        dataset: opts.dataset,
        build: opts.build,
        onChange: opts.onChange,
        onBack: opts.onBack,
    };
    paint();
    bindEvents();
    return {
        getBuild: () => api.build,
        destroy: () => { root.innerHTML = ''; api = null; },
    };
}