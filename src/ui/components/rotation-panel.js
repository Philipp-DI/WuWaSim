// src/ui/components/rotation-panel.js
/**
 * Rotation panel.
 *
 * Lets the user build a combat rotation by appending skills from a
 * palette, reordering with arrow buttons or drag-and-drop, and
 * removing steps. Displays:
 *   - totals (damage, time, DPS, hits)
 *   - a proportional timeline strip
 *   - a per-step list with running cumulative damage
 *   - a skill palette of all curated skills for the build's resonator
 *
 *   mount(root, { dataset, build, onChange, target })
 *
 * `target` is read on each paint; the caller (build-editor) shares the
 * target between the damage panel and the simulator so changes here
 * stay in sync with the per-skill panel.
 */

import { html, raw, render, on, esc } from '../dom.js';
import {
    appendRotationStep, removeRotationStep, moveRotationStep, clearRotation,
} from '../../core/build.js';
import { simulateRotation, resolveCastTime } from '../../core/sim.js';

let api = null;

// =============================================================================
// Format helpers
// =============================================================================

function fmtNum(v) {
    if (!Number.isFinite(v)) return '—';
    if (v >= 10000) return v.toFixed(0);
    if (v >= 100) return v.toFixed(0);
    return v.toFixed(1);
}
function fmtTime(s) {
    if (!Number.isFinite(s) || s <= 0) return '0.0s';
    return `${s.toFixed(2)}s`;
}
function fmtDps(v) {
    if (!Number.isFinite(v) || v <= 0) return '—';
    if (v >= 1000) return v.toFixed(0);
    return v.toFixed(1);
}

// =============================================================================
// Render — totals
// =============================================================================

function renderTotals(totals) {
    return html`
        <div class="rot-totals">
            <div class="rot-total rot-total--primary">
                <span class="rot-total__label">Total DMG</span>
                <span class="rot-total__value">${esc(fmtNum(totals.damage))}</span>
            </div>
            <div class="rot-total">
                <span class="rot-total__label">Time</span>
                <span class="rot-total__value">${esc(fmtTime(totals.time))}</span>
            </div>
            <div class="rot-total rot-total--primary">
                <span class="rot-total__label">DPS</span>
                <span class="rot-total__value">${esc(fmtDps(totals.dps))}</span>
            </div>
            <div class="rot-total">
                <span class="rot-total__label">Hits</span>
                <span class="rot-total__value">${esc(String(totals.hits))}</span>
            </div>
            <div class="rot-total">
                <span class="rot-total__label">Steps</span>
                <span class="rot-total__value">${esc(String(totals.stepCount))}</span>
            </div>
            ${raw(totals.missingSteps > 0 ? html`
                <div class="rot-total rot-total--warn">
                    <span class="rot-total__label">Unknown</span>
                    <span class="rot-total__value">${esc(String(totals.missingSteps))}</span>
                </div>
            ` : '')}
        </div>
    `;
}

// =============================================================================
// Render — timeline strip (proportional segments)
// =============================================================================

function renderTimeline(sim) {
    if (sim.steps.length === 0) {
        return html`<div class="rot-timeline rot-timeline--empty">No steps yet</div>`;
    }
    const total = Math.max(sim.totals.time, 0.01);
    const segs = sim.steps.map((step) => {
        const widthPct = (step.castTime / total) * 100;
        const cls = `rot-timeline__seg${step.missing ? ' is-missing' : ''}${api.activeIndex === step.index ? ' is-active' : ''}`;
        const labelText = step.missing ? `?${step.skillKey}` : shortLabel(step.label);
        return `
            <div class="${cls}"
                 data-action="select-step"
                 data-index="${step.index}"
                 data-type="${esc(step.skillType)}"
                 style="--seg-flex: ${widthPct.toFixed(2)}%;"
                 title="${esc(step.label)} · ${esc(fmtTime(step.castTime))} · ${esc(fmtNum(step.stepDamage))}">
                <span class="rot-timeline__label">${esc(labelText)}</span>
            </div>
        `;
    });
    return html`<div class="rot-timeline">${raw(segs.join(''))}</div>`;
}

// Compact a skill label so it fits in a narrow timeline segment.
function shortLabel(label) {
    if (!label) return '';
    // Take text before the em-dash if present ("Basic Attack — Stage 1" → "Basic Attack")
    const dash = label.indexOf('—');
    return dash > 0 ? label.slice(0, dash).trim() : label;
}

// =============================================================================
// Render — step list
// =============================================================================

function renderSteps(sim) {
    if (sim.steps.length === 0) {
        return html`<div class="rot-empty">Empty rotation — add steps from the palette below</div>`;
    }
    const rows = sim.steps.map((step) => {
        const cls = [
            'rot-step',
            step.missing ? 'is-missing' : '',
            api.activeIndex === step.index ? 'is-active' : '',
        ].filter(Boolean).join(' ');
        const lastIndex = sim.steps.length - 1;
        return `
            <div class="${cls}"
                 data-action="select-step"
                 data-index="${step.index}"
                 data-type="${esc(step.skillType)}"
                 draggable="true">
                <span class="rot-step__idx">${step.index + 1}</span>
                <span class="rot-step__label" title="${esc(step.label)}">${esc(step.label)}</span>
                <span class="rot-step__cast">${esc(fmtTime(step.castTime))}</span>
                <span class="rot-step__dmg">${esc(fmtNum(step.stepDamage))}</span>
                <span class="rot-step__cum">Σ ${esc(fmtNum(step.cumulativeDamage))}</span>
                <span class="rot-step__nav">
                    <button class="rot-step__btn"
                            data-action="move-step" data-dir="-1" data-index="${step.index}"
                            ${step.index === 0 ? 'disabled' : ''}
                            title="Move up">▲</button>
                    <button class="rot-step__btn"
                            data-action="move-step" data-dir="+1" data-index="${step.index}"
                            ${step.index === lastIndex ? 'disabled' : ''}
                            title="Move down">▼</button>
                    <button class="rot-step__btn rot-step__btn--danger"
                            data-action="remove-step" data-index="${step.index}"
                            title="Remove">×</button>
                </span>
            </div>
        `;
    });
    return html`<div class="rot-steps" data-region="steps">${raw(rows.join(''))}</div>`;
}

// =============================================================================
// Render — palette
// =============================================================================

function renderPalette() {
    const skillMap = api.dataset.skillMap?.[String(api.build.resonatorId)];
    if (!skillMap) return '';

    const entries = Object.entries(skillMap).filter(([k]) => !k.startsWith('_'));
    if (entries.length === 0) return '';

    const buttons = entries.map(([key, def]) => {
        const castTime = resolveCastTime(def, api.dataset);
        return `
            <button class="rot-palette__btn"
                    data-action="add-step"
                    data-key="${esc(key)}"
                    data-type="${esc(def.skillType)}"
                    title="${esc(def.label)} · ${esc(fmtTime(castTime))}">
                <span>${esc(shortLabelForPalette(def.label))}</span>
                <span class="rot-palette__cast">${esc(fmtTime(castTime))}</span>
            </button>
        `;
    });

    return html`
        <div class="rot-palette">
            <div class="rot-palette__title">Add a step</div>
            <div class="rot-palette__grid">${raw(buttons.join(''))}</div>
        </div>
    `;
}

function shortLabelForPalette(label) {
    if (!label) return '';
    return label.replace(/^Resonance\s+/, '').replace(/^Forte:\s+/, 'F: ');
}

// =============================================================================
// Render — root
// =============================================================================

function renderRoot() {
    if (!api) return '';
    const { dataset, build } = api;

    const skillMap = dataset.skillMap?.[String(build.resonatorId)];
    if (!skillMap) {
        const resoName = dataset.resonators.find(r => r.id === build.resonatorId)?.name ?? `#${build.resonatorId}`;
        return html`
            <div class="rotation-panel">
                <div class="rotation-panel__head">
                    <span class="rotation-panel__title">Rotation</span>
                </div>
                <div class="rot-no-map">
                    <strong>${esc(resoName)}</strong> has no curated skill map yet, so rotation simulation is unavailable.
                    Add an entry to <code>data/skill-map.json</code> to enable it.
                </div>
            </div>
        `;
    }

    const sim = simulateRotation({ build, dataset, target: api.target });
    api.lastSim = sim;

    const hasClear = sim.steps.length > 0;

    return html`
        <div class="rotation-panel">
            <div class="rotation-panel__head">
                <span class="rotation-panel__title">Rotation</span>
                <div class="rotation-panel__actions">
                    ${raw(hasClear ? `<button class="btn btn--danger" data-action="clear">Clear all</button>` : '')}
                </div>
            </div>
            ${raw(renderTotals(sim.totals))}
            ${raw(renderTimeline(sim))}
            ${raw(renderSteps(sim))}
            ${raw(renderPalette())}
        </div>
    `;
}

function paint() {
    render(api.root, renderRoot());
}

// =============================================================================
// Drag and drop
// =============================================================================

function bindDragAndDrop(root) {
    let dragSrcIndex = null;
    let dropTargetEl = null;

    root.addEventListener('dragstart', (e) => {
        const step = e.target.closest('.rot-step');
        if (!step) return;
        dragSrcIndex = Number(step.dataset.index);
        step.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Firefox requires non-empty data for the drag to register.
        try { e.dataTransfer.setData('text/plain', String(dragSrcIndex)); } catch { }
    });

    root.addEventListener('dragend', () => {
        root.querySelectorAll('.rot-step').forEach(el => {
            el.classList.remove('is-dragging', 'is-drop-target');
        });
        dragSrcIndex = null;
        dropTargetEl = null;
    });

    root.addEventListener('dragover', (e) => {
        const step = e.target.closest('.rot-step');
        if (!step || dragSrcIndex == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dropTargetEl && dropTargetEl !== step) dropTargetEl.classList.remove('is-drop-target');
        dropTargetEl = step;
        step.classList.add('is-drop-target');
    });

    root.addEventListener('drop', (e) => {
        const step = e.target.closest('.rot-step');
        if (!step || dragSrcIndex == null) return;
        e.preventDefault();
        const to = Number(step.dataset.index);
        if (to !== dragSrcIndex) {
            api.build = moveRotationStep(api.build, dragSrcIndex, to);
            api.onChange?.(api.build);
            api.activeIndex = to;
            paint();
        }
    });
}

// =============================================================================
// Event wiring
// =============================================================================

function bind() {
    const root = api.root;

    on(root, 'click', '[data-action="add-step"]', (_e, btn) => {
        api.build = appendRotationStep(api.build, btn.dataset.key);
        api.onChange?.(api.build);
        // Highlight the new step at the end
        api.activeIndex = (api.build.rotation?.length ?? 1) - 1;
        paint();
    });

    on(root, 'click', '[data-action="remove-step"]', (e, btn) => {
        e.stopPropagation();
        const i = Number(btn.dataset.index);
        api.build = removeRotationStep(api.build, i);
        api.onChange?.(api.build);
        if (api.activeIndex === i) api.activeIndex = null;
        paint();
    });

    on(root, 'click', '[data-action="move-step"]', (e, btn) => {
        e.stopPropagation();
        const i = Number(btn.dataset.index);
        const dir = Number(btn.dataset.dir);
        api.build = moveRotationStep(api.build, i, i + dir);
        api.onChange?.(api.build);
        api.activeIndex = i + dir;
        paint();
    });

    on(root, 'click', '[data-action="select-step"]', (_e, el) => {
        const i = Number(el.dataset.index);
        api.activeIndex = api.activeIndex === i ? null : i;
        paint();
    });

    on(root, 'click', '[data-action="clear"]', () => {
        if (!api.build.rotation?.length) return;
        if (!confirm('Clear all rotation steps?')) return;
        api.build = clearRotation(api.build);
        api.onChange?.(api.build);
        api.activeIndex = null;
        paint();
    });

    bindDragAndDrop(root);
}

// =============================================================================
// Public API
// =============================================================================

export function mount(root, { dataset, build, onChange, target }) {
    api = {
        root, dataset, build, onChange,
        target: target ?? { level: 90, atkLv: build.level ?? 90, resistances: {} },
        activeIndex: null,
        lastSim: null,
    };
    paint();
    bind();
    return {
        update(newBuild, newTarget) {
            api.build = newBuild;
            if (newTarget) api.target = newTarget;
            paint();
        },
        setTarget(newTarget) {
            api.target = newTarget;
            paint();
        },
        getSim() { return api.lastSim; },
        destroy() { api.root.innerHTML = ''; api = null; },
    };
}