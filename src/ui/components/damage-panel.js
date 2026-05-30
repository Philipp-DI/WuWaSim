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
import { resolveSkill, resolveSupport } from '../../core/skill.js';

// Returns the best available skill map for a resonator:
// 1. Curated hand-map from skill-map.json (Carlotta etc.)
// 2. Auto-generated map from nanoka character JSON (new chars)
// 3. null when neither exists
function effectiveSkillMap(dataset, resonatorId) {
    const curated = dataset.skillMap?.[String(resonatorId)];
    if (curated && Object.keys(curated).some(k => !k.startsWith('_'))) return curated;
    const auto = dataset.autoSkillMap?.[String(resonatorId)];
    if (auto && Object.keys(auto).length > 0) return auto;
    return null;
}

let api = null;

// =============================================================================
// State
// =============================================================================

const DEFAULTS = {
    enemyLevel: 90,
    enemyRes: 0.10,
    expanded: new Set(),
    buffStacks: {},    // key → stack count for conditional buff toggles
};

// =============================================================================
// Per-skill computation — delegates to the shared core resolver. Kept as a
// thin wrapper so call sites can stay terse and the simulator (Phase 5+)
// reuses identical math.
// =============================================================================

function computeSkill(skillDef, build, dataset, stats, target) {
    return resolveSkill({ skillDef, build, dataset, stats, target });
}

// Resolve support rows for a skillDef (heal/shield), standalone.
// Returns null if no supportIds.
function computeSupportOnly(skillDef, build, dataset, stats) {
    return resolveSupport({ skillDef, build, dataset, stats });
}

// Human-readable heal/shield total for a support result array.
function fmtSupport(supportRows, rowType) {
    if (!supportRows?.length) return '—';
    const total = supportRows.filter(r => r.rowType === rowType).reduce((t, r) => t + r.value, 0);
    return total > 0 ? fmt(total) : '—';
}

// =============================================================================
// Render
// =============================================================================

function fmt(v) {
    if (!Number.isFinite(v)) return '—';
    if (v >= 10000) return v.toFixed(0);
    if (v >= 100) return v.toFixed(0);
    return v.toFixed(1);
}

function renderSkillCard(key, def, computed, isOpen, state) {
    if (!computed) return '';
    const total = computed.totalExpected;
    const skillLv = computed.skillLv;
    const support = computed.supportOutput ?? null;
    const healTotal = support ? support.filter(r => r.rowType === 'heal').reduce((t, r) => t + r.value, 0) : 0;
    const shieldTotal = support ? support.filter(r => r.rowType === 'shield').reduce((t, r) => t + r.value, 0) : 0;

    // META info rows
    const metaRows = (def.meta ?? []).map(m => {
        const val = m.mults?.[skillLv - 1] ?? m.mults?.[0] ?? '—';
        const label = m.label
            .replace(/\s+STA Cost$/i, ' Stamina')
            .replace(/\s+Cooldown$/i, ' CD')
            .replace(/\s+Concerto Regen$/i, ' Concerto')
            .replace(/\s+Resonance Cost$/i, ' Energy Cost')
            .replace(/Hold Breath STA Cost per second/i, 'Hold Breath / s');
        return html`<div class="skill-card__info-row">
            <span class="skill-card__info-label">${esc(label)}</span>
            <span class="skill-card__info-value">${esc(String(val))}</span>
        </div>`;
    }).join('');

    // Conditional buff toggle
    const buff = def.conditionalBuff;
    const buffStacks = state?.buffStacks?.[key] ?? buff?.defaultStacks ?? 0;
    const buffSection = buff ? html`
        <div class="skill-card__buff">
            <span class="skill-card__buff-label" title="${esc(buff.label)}">${esc(shortBuffLabel(buff.label))}</span>
            <div class="skill-card__buff-controls">
                <button class="buff-stack-btn" data-action="buff-stack" data-key="${esc(key)}" data-step="-1"
                        ${buffStacks <= 0 ? 'disabled' : ''}>−</button>
                <span class="buff-stack-count" data-key="${esc(key)}">${esc(String(buffStacks))}</span>
                <button class="buff-stack-btn" data-action="buff-stack" data-key="${esc(key)}" data-step="+1">+</button>
                <span class="skill-card__buff-val">${esc(buffStacks > 0 ? `+${(buff.perStackMults?.[skillLv - 1] * buffStacks * 100).toFixed(0)}%` : 'off')}</span>
            </div>
        </div>
    ` : '';

    // Support output line (if this skill also heals or shields)
    const supportLine = (healTotal > 0 || shieldTotal > 0) ? html`
        <div class="skill-card__support-row">
            ${raw(healTotal > 0 ? html`<span class="skill-card__heal"   title="Heal per cast">♥ ${esc(fmt(healTotal))}</span>` : '')}
            ${raw(shieldTotal > 0 ? html`<span class="skill-card__shield" title="Shield per cast">◆ ${esc(fmt(shieldTotal))}</span>` : '')}
        </div>` : '';

    return html`
        <div class="skill-card ${raw(isOpen ? 'is-open' : '')}" data-key="${esc(key)}">
            <div class="skill-card__head" data-action="toggle">
                <div>
                    <div class="skill-card__name">${esc(def.label)}</div>
                    <div class="skill-card__meta">Lv ${esc(String(skillLv))} · ${computed.hits.length} hit${computed.hits.length === 1 ? '' : 's'}</div>
                </div>
                <div>
                    ${raw(total > 0 ? html`<div class="skill-card__damage">${esc(fmt(total))}</div>` : '')}
                    ${raw(supportLine)}
                </div>
                <span class="skill-card__chevron">▸</span>
            </div>
            <div class="skill-card__body">
                ${raw(renderSkillBreakdown(computed))}
                ${raw(renderSupportBreakdown(support))}
                ${raw(def.notes ? html`<div class="skill-card__hint">${esc(def.notes)}</div>` : '')}
                ${raw(metaRows ? `<div class="skill-card__info">${metaRows}</div>` : '')}
                ${raw(buffSection)}
            </div>
        </div>
    `;
}

// Support-only card — for skills with no damage but heal/shield output (e.g. Shorekeeper Liberation).
function renderSupportCard(key, def, supportRows, skillLv) {
    if (!supportRows?.length) return '';
    const healTotal = supportRows.filter(r => r.rowType === 'heal').reduce((t, r) => t + r.value, 0);
    const shieldTotal = supportRows.filter(r => r.rowType === 'shield').reduce((t, r) => t + r.value, 0);
    if (healTotal === 0 && shieldTotal === 0) return '';

    const rows = supportRows.map(r => {
        if (r.unsupported) return '';
        const lbl = r.scalingStat.toUpperCase();
        const breakdown = r.flat > 0 && r.ratioAmount > 0
            ? `${fmt(r.flat)} flat + ${fmt(r.ratioAmount)} (${lbl}%)`
            : r.flat > 0 ? `${fmt(r.flat)} flat` : `${fmt(r.ratioAmount)} (${lbl}%)`;
        return html`<div class="skill-card__row">
            <span class="skill-card__row-label">${esc(r.rowType === 'heal' ? '♥ Heal' : '◆ Shield')}</span>
            <span class="skill-card__row-val ${raw(r.rowType === 'heal' ? 'support-heal' : 'support-shield')}">${esc(fmt(r.value))}</span>
        </div>`;
    }).join('');

    return html`
        <div class="skill-card is-support" data-key="${esc(key)}">
            <div class="skill-card__head" data-action="toggle">
                <div>
                    <div class="skill-card__name">${esc(def.label)}</div>
                    <div class="skill-card__meta">Lv ${esc(String(skillLv))}</div>
                </div>
                <div>
                    ${raw(healTotal > 0 ? html`<span class="skill-card__heal"   title="Heal">♥ ${esc(fmt(healTotal))}</span>` : '')}
                    ${raw(shieldTotal > 0 ? html`<span class="skill-card__shield" title="Shield">◆ ${esc(fmt(shieldTotal))}</span>` : '')}
                </div>
                <span class="skill-card__chevron">▸</span>
            </div>
            <div class="skill-card__body">${raw(rows)}</div>
        </div>
    `;
}

// Breakdown rows for support output inside an expanded skill card.
function renderSupportBreakdown(supportRows) {
    if (!supportRows?.length) return '';
    const rows = supportRows.filter(r => !r.unsupported && r.value > 0).map(r => {
        const lbl = r.scalingStat.toUpperCase();
        const statDetail = r.flat > 0 && r.ratioAmount > 0
            ? `${fmt(r.flat)} + ${fmt(r.ratioAmount)} (${lbl}%)`
            : r.flat > 0 ? `${fmt(r.flat)} flat` : `${fmt(r.ratioAmount)} (${lbl}%)`;
        return html`<div class="skill-card__row">
            <span class="skill-card__row-label ${raw(r.rowType === 'heal' ? 'support-heal' : 'support-shield')}">
                ${r.rowType === 'heal' ? '♥' : '◆'} ${esc(r.rowType === 'heal' ? 'Heal' : 'Shield')}
            </span>
            <span class="skill-card__row-stat">${esc(statDetail)}</span>
            <span class="skill-card__row-val ${raw(r.rowType === 'heal' ? 'support-heal' : 'support-shield')}">${esc(fmt(r.value))}</span>
        </div>`;
    });
    return rows.join('');
}

function shortBuffLabel(label) {
    // Truncate long buff names for the compact toggle UI
    return label.replace(/^Total\s+/i, '').replace(/\s+DMG Increase per\b.*/i, ' per stack');
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
    const skillMap = effectiveSkillMap(dataset, build.resonatorId);
    const stats = resolveTotalStats(build, dataset);
    api.lastStats = stats;

    const target = {
        level: state.enemyLevel,
        atkLv: build.level,                           // attacker = resonator level
        resistances: {
            0: 0, 1: state.enemyRes, 2: state.enemyRes, 3: state.enemyRes,
            4: state.enemyRes, 5: state.enemyRes, 6: state.enemyRes
        },
    };

    let body;
    if (!skillMap) {
        body = renderEmpty(resonator);
    } else {
        const SKILL_LV_KEY = {
            basic: 'normal', heavy: 'normal', midair: 'normal',
            forte_basic: 'forte', forte_heavy: 'forte',
            skill: 'skill', liberation: 'liberation',
            intro: 'intro', outro: 'intro',
        };
        const entries = Object.entries(skillMap)
            .filter(([k]) => !k.startsWith('_'));
        const cards = entries.map(([key, def]) => {
            const computed = computeSkill(def, build, dataset, stats, target);
            // Pure-support step: no damage rows, only supportIds
            if (!computed && def.supportIds?.length) {
                const supportRows = computeSupportOnly(def, build, dataset, stats);
                const lvKey = SKILL_LV_KEY[def.skillType] ?? def.skillType;
                const skillLv = build.skillLevels?.[lvKey] ?? 10;
                return renderSupportCard(key, def, supportRows, skillLv);
            }
            return renderSkillCard(key, def, computed, state.expanded.has(key), state);
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
        else api.state.expanded.add(key);
        paint();
    });

    on(api.root, 'click', '[data-action="buff-stack"]', (_e, btn) => {
        const key = btn.dataset.key;
        const step = Number(btn.dataset.step);
        const cur = api.state.buffStacks?.[key] ?? 0;
        const next = Math.max(0, cur + step);
        if (!api.state.buffStacks) api.state.buffStacks = {};
        api.state.buffStacks[key] = next;
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
            enemyRes: DEFAULTS.enemyRes,
            expanded: new Set(),
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