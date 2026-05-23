// src/ui/components/damage-panel.js
/**
 * Damage panel.
 *
 * Lists the curated skills for the build's resonator, computes damage
 * for each at the player's chosen skill level, and lets the user expand
 * any row to see the full math.
 *
 * If the resonator has no entry in data/skill-map.json (most don't yet),
 * the panel shows an inviting empty state explaining how to contribute.
 *
 *   mount(root, { dataset, build })
 *
 * Reactive via `update(build)`. Target parameters (enemy level, RES)
 * are local UI state — they don't mutate the build.
 */

import { html, raw, render, on, esc } from '../dom.js';
import { resolveTotalStats } from '../../core/stats.js';
import { computeDamage } from '../../core/formula.js';

let api = null;

// =============================================================================
// State
// =============================================================================

const DEFAULTS = {
    enemyLevel: 90,
    enemyRes:   0.10,
    expanded:   new Set(),
};

// =============================================================================
// Per-skill computation
// =============================================================================

/**
 * For one curated skill definition, build a Skill object the formula
 * accepts. Each entry in `damageIds` is one hit instance; we sum their
 * expected damage to give the cast's total.
 *
 * Returns { totalExpected, totalCrit, totalNonCrit, hits[] } or null.
 */
function computeSkill(skillDef, build, dataset, stats, target) {
    const skillLv = build.skillLevels[skillDef.skillType] ?? 1;
    const tableForReso = dataset.damageTable?.[String(build.resonatorId)] || [];
    const rows = skillDef.damageIds
        .map(id => tableForReso.find(d => d.id === id))
        .filter(Boolean);
    if (rows.length === 0) return null;

    const hits = rows.map(row => {
        const mult = row.mults[skillLv - 1] ?? 0;
        const skill = {
            skillType: skillDef.skillType,
            multiplier: mult,
            scaling: row.relatedProp === 2 ? 'hp'
                   : row.relatedProp === 10 ? 'def'
                   : 'atk',
            element: row.element,
        };
        const r = computeDamage({ stats, skill, target });
        return { id: row.id, skill, result: r };
    });

    const totalExpected = hits.reduce((s, h) => s + h.result.expected, 0);
    const totalCrit     = hits.reduce((s, h) => s + h.result.crit,     0);
    const totalNonCrit  = hits.reduce((s, h) => s + h.result.nonCrit,  0);
    return { skillLv, hits, totalExpected, totalCrit, totalNonCrit };
}

// =============================================================================
// Render
// =============================================================================

function fmt(v) {
    if (!Number.isFinite(v)) return '—';
    if (v >= 10000) return v.toFixed(0);
    if (v >= 100)   return v.toFixed(0);
    return v.toFixed(1);
}

function renderSkillCard(key, def, computed, isOpen) {
    if (!computed) return '';
    const total = computed.totalExpected;
    return html`
        <div class="skill-card ${raw(isOpen ? 'is-open' : '')}" data-key="${esc(key)}">
            <div class="skill-card__head" data-action="toggle">
                <div>
                    <div class="skill-card__name">${esc(def.label)}</div>
                    <div class="skill-card__meta">Lv ${esc(String(computed.skillLv))} · ${computed.hits.length} hit${computed.hits.length === 1 ? '' : 's'}</div>
                </div>
                <div class="skill-card__damage">${esc(fmt(total))}</div>
                <span class="skill-card__chevron">▸</span>
            </div>
            <div class="skill-card__body">
                ${raw(renderSkillBreakdown(computed))}
                ${def.notes ? html`<div class="skill-card__hint">${esc(def.notes)}</div>` : ''}
            </div>
        </div>
    `;
}

function renderSkillBreakdown(computed) {
    const rows = computed.hits.map((h, i) => {
        const r = h.result;
        const bd = r.breakdown;
        const mult = (bd.multiplier * 100).toFixed(1);
        return html`
            <div class="skill-card__row">
                <span class="skill-card__row-label">Hit ${i + 1} · ${esc(mult)}% ATK</span>
                <span class="skill-card__row-value skill-card__row-value--dim">non-crit ${esc(fmt(r.nonCrit))}</span>
                <span class="skill-card__row-value skill-card__row-value--crit">crit ${esc(fmt(r.crit))}</span>
                <span class="skill-card__row-value skill-card__row-value--avg">avg ${esc(fmt(r.expected))}</span>
            </div>
        `;
    });

    const first = computed.hits[0]?.result?.breakdown;
    const env = first ? html`
        <div class="skill-card__row" style="margin-top: var(--sp-2); border-top: 1px solid var(--line-dim); padding-top: 6px;">
            <span class="skill-card__row-label">Environment</span>
            <span class="skill-card__row-value skill-card__row-value--dim">DEF mult ${esc(first.defMult.toFixed(3))}</span>
            <span class="skill-card__row-value skill-card__row-value--dim">RES mult ${esc(first.resMult.toFixed(3))}</span>
            <span class="skill-card__row-value skill-card__row-value--dim">DMG× ${esc(first.bonusMult.toFixed(3))}</span>
        </div>
    ` : '';

    return html`
        ${raw(rows.join(''))}
        ${raw(env)}
    `;
}

function renderHead(state) {
    return html`
        <div class="damage-panel__head">
            <span class="damage-panel__title">Damage</span>
            <div class="damage-panel__target">
                <label class="field">
                    <span class="field__label">Enemy Lv</span>
                    <input class="field__input" type="number" min="1" max="120"
                           value="${esc(String(state.enemyLevel))}"
                           data-action="set-enemy-level">
                </label>
                <label class="field">
                    <span class="field__label">Enemy RES</span>
                    <input class="field__input" type="number" min="-1" max="2" step="0.05"
                           value="${esc(state.enemyRes.toFixed(2))}"
                           data-action="set-enemy-res">
                </label>
            </div>
        </div>
    `;
}

function renderEmpty(resonator) {
    return html`
        <div class="no-skill-map">
            <strong>${esc(resonator.name)}</strong> doesn't have a curated skill map yet —
            damage calculations are paused for this resonator.
            <br><br>
            The raw multiplier table is in <code>data/wuwa-data.json</code> under
            <code>damageTable["${esc(String(resonator.id))}"]</code>. Add an entry to
            <code>data/skill-map.json</code> matching the format used for Carlotta
            (id 1107) and reload.
        </div>
    `;
}

function renderRoot() {
    if (!api) return '';
    const { dataset, build, state } = api;
    const resonator = dataset.resonators.find(r => r.id === build.resonatorId);
    const skillMap = dataset.skillMap?.[String(build.resonatorId)];
    const stats = resolveTotalStats(build, dataset);
    api.lastStats = stats;

    const target = {
        level: state.enemyLevel,
        atkLv: build.level,                           // attacker = resonator level
        resistances: { 0: 0, 1: state.enemyRes, 2: state.enemyRes, 3: state.enemyRes,
                       4: state.enemyRes, 5: state.enemyRes, 6: state.enemyRes },
    };

    let body;
    if (!skillMap) {
        body = renderEmpty(resonator);
    } else {
        const entries = Object.entries(skillMap)
            .filter(([k]) => !k.startsWith('_'));    // skip "_note" etc.
        const cards = entries.map(([key, def]) => {
            const computed = computeSkill(def, build, dataset, stats, target);
            return renderSkillCard(key, def, computed, state.expanded.has(key));
        });
        body = html`<div class="skill-list">${raw(cards.join(''))}</div>`;
    }

    return html`
        <div class="damage-panel">
            ${raw(renderHead(state))}
            ${raw(body)}
        </div>
    `;
}

// =============================================================================
// Events
// =============================================================================

function paint() {
    render(api.root, renderRoot());
}

function bind() {
    on(api.root, 'click', '[data-action="toggle"]', (_e, head) => {
        const card = head.closest('.skill-card');
        if (!card) return;
        const key = card.dataset.key;
        if (api.state.expanded.has(key)) api.state.expanded.delete(key);
        else                              api.state.expanded.add(key);
        paint();
    });

    on(api.root, 'input', '[data-action="set-enemy-level"]', (e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= 1 && v <= 120) {
            api.state.enemyLevel = v;
            paint();
        }
    });

    on(api.root, 'input', '[data-action="set-enemy-res"]', (e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= -1 && v <= 2) {
            api.state.enemyRes = v;
            paint();
        }
    });
}

// =============================================================================
// Public API
// =============================================================================

export function mount(root, { dataset, build }) {
    api = {
        root, dataset, build,
        state: {
            enemyLevel: DEFAULTS.enemyLevel,
            enemyRes:   DEFAULTS.enemyRes,
            expanded:   new Set(),
        },
        lastStats: null,
    };
    paint();
    bind();
    return {
        update(newBuild) {
            api.build = newBuild;
            paint();
        },
        destroy() { api.root.innerHTML = ''; api = null; },
    };
}
