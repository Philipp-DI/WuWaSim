// src/ui/components/stats-panel.js
/**
 * Live stats panel.
 *
 * Renders the total stats derived from a Build + dataset. Reactive: call
 * `update(build)` whenever the build changes and the panel re-renders.
 *
 *   mount(root, { dataset, build })
 *
 * Pure display — never mutates the build. The computation lives in
 * `src/core/stats.js`; this component is presentation only.
 */

import { html, raw, render, esc } from '../dom.js';
import { resolveTotalStats } from '../../core/stats.js';

let api = null;

function fmt(value, kind = 'flat') {
    if (kind === 'percent') return `${(value * 100).toFixed(1)}%`;
    return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function statCell(label, value, opts = {}) {
    const classes = ['stat-cell'];
    if (opts.primary) classes.push('stat-cell--primary');
    if (opts.kind === 'crit') classes.push('stat-cell--crit');
    if (opts.kind === 'warn') classes.push('stat-cell--warn');
    return html`
        <div class="${raw(classes.join(' '))}" title="${esc(opts.title || '')}">
            <span class="stat-cell__label">${esc(label)}</span>
            <span class="stat-cell__value">${esc(value)}</span>
            ${opts.delta ? html`<span class="stat-cell__delta">${esc(opts.delta)}</span>` : ''}
        </div>
    `;
}

function renderRoot(stats) {
    if (stats.error) {
        return html`
            <div class="state state--error">
                <span class="eyebrow">Stats unavailable</span>
                <p>${esc(stats.error)}</p>
            </div>
        `;
    }

    // Display Crit Rate and Crit DMG as their commonly-quoted percentages.
    // Crit DMG of 1.5 → "150.0%".
    return html`
        <div class="stats-panel">
            <div class="stats-panel__head">
                <span class="stats-panel__title">Combat Stats</span>
                <span class="stats-panel__source">computed · skill tree maxed</span>
            </div>
            <div class="stats-grid">
                ${raw(statCell('ATK',       fmt(stats.atk),                  { primary: true,  title: 'Total ATK after weapon + skill-tree % bonus' }))}
                ${raw(statCell('HP',        fmt(stats.hp),                   { title: 'Total HP' }))}
                ${raw(statCell('DEF',       fmt(stats.def),                  { title: 'Total DEF' }))}
                ${raw(statCell('Crit Rate', fmt(stats.critRate, 'percent'),  { kind: 'crit',   title: 'Probability of crit' }))}
                ${raw(statCell('Crit DMG',  fmt(stats.critDmg, 'percent'),   { kind: 'crit',   title: 'Multiplier on crit hits' }))}
                ${raw(statCell('Energy %',  fmt(stats.energyRegen, 'percent'), { kind: 'warn', title: 'Energy regen rate' }))}
            </div>
            ${raw(renderBonuses(stats))}
        </div>
    `;
}

function renderBonuses(stats) {
    const elBonuses  = Object.entries(stats.dmgBonusByElement || {}).filter(([, v]) => v > 0);
    const tBonuses   = Object.entries(stats.dmgBonusBySkillType || {}).filter(([, v]) => v > 0);
    if (elBonuses.length === 0 && tBonuses.length === 0) return '';

    const cells = [
        ...elBonuses.map(([elId, v]) => statCell(
            `Element ${elId} DMG`, fmt(v, 'percent'), { kind: 'warn' }
        )),
        ...tBonuses.map(([type, v]) => statCell(
            `${type[0].toUpperCase() + type.slice(1)} DMG`, fmt(v, 'percent'), { kind: 'warn' }
        )),
    ];

    return html`
        <div class="stats-panel__head" style="margin-top: var(--sp-3); border-top: 1px solid var(--line-dim); padding-top: var(--sp-3);">
            <span class="stats-panel__title">DMG Bonuses</span>
        </div>
        <div class="stats-grid">${raw(cells.join(''))}</div>
    `;
}

function paint() {
    if (!api) return;
    api.lastStats = resolveTotalStats(api.build, api.dataset);
    render(api.root, renderRoot(api.lastStats));
}

export function mount(root, { dataset, build }) {
    api = { root, dataset, build, lastStats: null };
    paint();
    return {
        update(newBuild) {
            api.build = newBuild;
            paint();
        },
        getStats() { return api.lastStats; },
        destroy()  { root.innerHTML = ''; api = null; },
    };
}
