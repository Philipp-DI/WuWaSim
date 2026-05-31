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
import { simulateRotation, resolveCastTime, ECHO_STEP_KEY } from '../../core/sim.js';
import { validateRotation } from '../../core/rotation-graph.js';
import { rulesForResonator } from '../../core/rotation-rules.js';

// Returns the best available skill map for a resonator.
// Curated (skill-map.json) takes priority; auto-generated (nanoka) is fallback.
function effectiveSkillMap(dataset, resonatorId) {
    const curated = dataset.skillMap?.[String(resonatorId)];
    if (curated && Object.keys(curated).some(k => !k.startsWith('_'))) return curated;
    const auto = dataset.autoSkillMap?.[String(resonatorId)];
    if (auto && Object.keys(auto).length > 0) return auto;
    return null;
}

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
// Render — DPS chart (cumulative damage as an area chart over time)
// =============================================================================

const CHART_W = 720;   // viewBox width; CSS scales to container
const CHART_H = 140;
const CHART_PAD = { top: 12, right: 16, bottom: 24, left: 56 };

function renderDpsChart(sim) {
    if (sim.steps.length === 0) return '';
    const innerW = CHART_W - CHART_PAD.left - CHART_PAD.right;
    const innerH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;

    const totalTime = Math.max(sim.totals.time, 0.01);
    const totalDmg = Math.max(sim.totals.damage, 1);

    // Build a stepwise polyline: damage stays flat during a cast, then
    // jumps up at the end of each cast. This matches the simulator's
    // "all hits resolve at end of cast" semantics.
    const xAt = (t) => CHART_PAD.left + (t / totalTime) * innerW;
    const yAt = (d) => CHART_PAD.top + innerH - (d / totalDmg) * innerH;

    const pts = [[xAt(0), yAt(0)]];
    let lastCum = 0;
    for (const s of sim.steps) {
        // Flat line through the cast at the previous cumulative
        pts.push([xAt(s.endTime), yAt(lastCum)]);
        // Jump up to the new cumulative
        pts.push([xAt(s.endTime), yAt(s.cumulativeDamage)]);
        lastCum = s.cumulativeDamage;
    }

    // Close the area down to the baseline
    const lineCmd = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const areaCmd = lineCmd
        + ` L${xAt(totalTime).toFixed(1)},${yAt(0).toFixed(1)}`
        + ` L${xAt(0).toFixed(1)},${yAt(0).toFixed(1)} Z`;

    // Y-axis: 4 horizontal gridlines at 0/25/50/75/100% of max
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
        y: yAt(totalDmg * f),
        label: formatTickLabel(totalDmg * f),
    }));

    // Vertical step boundaries with small labels (step index)
    const stepMarkers = sim.steps.map(s => {
        const x = xAt(s.endTime);
        return `<line class="chart__step-line" x1="${x}" y1="${CHART_PAD.top}" x2="${x}" y2="${CHART_PAD.top + innerH}"/>`;
    }).join('');

    // X-axis label at the right end (total time)
    const baselineY = CHART_PAD.top + innerH;

    return html`
        <svg class="rot-chart" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" role="img" aria-label="Cumulative damage over time">
            <!-- gridlines + y labels -->
            ${raw(ticks.map(t => `
                <line class="chart__grid" x1="${CHART_PAD.left}" y1="${t.y}" x2="${CHART_W - CHART_PAD.right}" y2="${t.y}"/>
                <text class="chart__y-label" x="${CHART_PAD.left - 6}" y="${t.y + 3}" text-anchor="end">${esc(t.label)}</text>
            `).join(''))}
            <!-- step boundaries -->
            ${raw(stepMarkers)}
            <!-- area + line -->
            <path class="chart__area" d="${areaCmd}"/>
            <path class="chart__line" d="${lineCmd}"/>
            <!-- axis -->
            <line class="chart__axis" x1="${CHART_PAD.left}" y1="${baselineY}" x2="${CHART_W - CHART_PAD.right}" y2="${baselineY}"/>
            <text class="chart__x-label" x="${CHART_W - CHART_PAD.right}" y="${CHART_H - 6}" text-anchor="end">${esc(fmtTime(totalTime))}</text>
            <text class="chart__x-label" x="${CHART_PAD.left}" y="${CHART_H - 6}" text-anchor="start">0.00s</text>
        </svg>
    `;
}

function formatTickLabel(v) {
    if (v >= 10000) return `${(v / 1000).toFixed(1)}k`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    if (v >= 100) return v.toFixed(0);
    if (v === 0) return '0';
    return v.toFixed(1);
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
// Render — buff uptime bars (one row per active conditional sonata buff)
// =============================================================================

function renderBuffBars(sim) {
    const wins = sim.buffWindows || [];
    if (wins.length === 0 || sim.totals.time <= 0) return '';

    // Group windows by sonataId+pieces so multi-trigger sonatas share a row.
    const byKey = new Map();
    for (const w of wins) {
        const key = `${w.sonataId}:${w.pieces}`;
        if (!byKey.has(key)) {
            byKey.set(key, {
                label: `${w.sonataName} ${w.pieces}pc`,
                buffLabel: w.label,
                raw: w.raw,
                windows: [],
            });
        }
        byKey.get(key).windows.push(w);
    }

    const totalTime = Math.max(sim.totals.time, 0.01);
    const rows = [];
    for (const [key, group] of byKey) {
        const segs = group.windows.map(w => {
            const leftPct = (Math.max(w.start, 0) / totalTime) * 100;
            const widthPct = (Math.min(w.end, totalTime) - Math.max(w.start, 0)) / totalTime * 100;
            if (widthPct <= 0) return '';
            return `<span class="buff-bar__seg" style="left:${leftPct.toFixed(1)}%; width:${widthPct.toFixed(1)}%;"></span>`;
        }).join('');
        rows.push(`
            <div class="buff-bar" title="${esc(group.raw)}">
                <span class="buff-bar__label">${esc(group.label)}</span>
                <span class="buff-bar__effect">${esc(group.buffLabel)}</span>
                <div class="buff-bar__track">${segs}</div>
            </div>
        `);
    }

    return html`
        <div class="buff-bars">
            <div class="buff-bars__head">Buff uptime</div>
            ${raw(rows.join(''))}
        </div>
    `;
}

// =============================================================================
// Render — step list
// =============================================================================

// Build a rich tooltip for a rotation step.
// For echo skill steps, show the multiplier, scaling stat, and element.
// For character skill steps, fall back to the label alone.
function buildStepTooltip(step, dataset) {
    if (step.skillType !== 'echo' || !step.resolved?.hits?.length) return step.label;

    const hit = step.resolved.hits[0];
    const mult = hit?.skill?.multiplier;
    const scaling = hit?.skill?.scaling ?? 'atk';
    const element = hit?.skill?.element;
    const elName = element
        ? (dataset?.elements?.find(e => e.id === element)?.name ?? '')
        : '';

    const pct = mult != null ? `${(mult * 100).toFixed(2)}%` : '?%';
    const parts = [step.label, `${pct} of ${scaling.toUpperCase()}`];
    if (elName) parts.push(elName);
    return parts.join(' · ');
}

function renderSteps(sim, warningByIndex = new Map()) {
    if (sim.steps.length === 0) {
        return html`<div class="rot-empty">Empty rotation — add steps from the palette below</div>`;
    }
    const rows = sim.steps.map((step) => {
        const warning = warningByIndex.get(step.index);
        const cls = [
            'rot-step',
            step.missing ? 'is-missing' : '',
            warning ? 'is-warned' : '',
            api.activeIndex === step.index ? 'is-active' : '',
        ].filter(Boolean).join(' ');
        const lastIndex = sim.steps.length - 1;
        const tooltip = buildStepTooltip(step, api.dataset);
        // Prerequisite warning marker — sits before the label, carries the
        // rule note as its tooltip so hovering explains the gate.
        const warnMarker = warning
            ? `<span class="rot-step__warn" title="${esc(warning.note)}">⚠</span>`
            : '';
        return `
            <div class="${cls}"
                 data-action="select-step"
                 data-index="${step.index}"
                 data-type="${esc(step.skillType)}"
                 draggable="true">
                <span class="rot-step__idx">${step.index + 1}</span>
                ${warnMarker}
                <span class="rot-step__label" title="${esc(tooltip)}">${esc(step.label)}</span>
                <span class="rot-step__cast">${esc(fmtTime(step.castTime))}</span>
                <span class="rot-step__dmg${step.buffed ? ' is-buffed' : ''}"${step.buffed ? ' title="Boosted by an active conditional buff"' : ''}>${step.buffed ? '▲ ' : ''}${esc(fmtNum(step.stepDamage))}</span>
                ${step.stepHeal > 0 ? `<span class="rot-step__heal"   title="Heal">♥ ${esc(fmtNum(step.stepHeal))}</span>` : ''}
                ${step.stepShield > 0 ? `<span class="rot-step__shield" title="Shield">◆ ${esc(fmtNum(step.stepShield))}</span>` : ''}
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
    const skillMap = effectiveSkillMap(api.dataset, api.build.resonatorId);
    const entries = skillMap
        ? Object.entries(skillMap).filter(([k, def]) =>
            !k.startsWith('_') && (def.paletteInclude !== false))
        : [];

    const buttons = entries.map(([key, def]) => {
        const castTime = resolveCastTime(def, api.dataset);
        const type = def.skillType ?? def.skillType ?? 'basic';
        return `
            <button class="rot-palette__btn"
                    data-action="add-step"
                    data-key="${esc(key)}"
                    data-type="${esc(type)}"
                    title="${esc(def.label)} · ${esc(fmtTime(castTime))}">
                <span>${esc(shortLabelForPalette(def.label))}</span>
                <span class="rot-palette__cast">${esc(fmtTime(castTime))}</span>
            </button>
        `;
    });

    // Echo Skill button — only when the equipped slot-0 echo has an active skill.
    const slot0 = api.build.echoes?.[0];
    const echoDef = slot0 ? api.dataset.echoes?.find(e => e.id === slot0.id) : null;
    if (echoDef?.activeSkill?.rateByLevel?.length) {
        buttons.push(`
            <button class="rot-palette__btn rot-palette__btn--echo"
                    data-action="add-step"
                    data-key="${esc(ECHO_STEP_KEY)}"
                    data-type="echo"
                    title="Echo Skill: ${esc(echoDef.name)} · ${esc(fmtTime(1.20))}">
                <span>Echo: ${esc(echoDef.name)}</span>
                <span class="rot-palette__cast">${esc(fmtTime(1.20))}</span>
            </button>
        `);
    }

    if (buttons.length === 0) return '';

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

    const skillMap = effectiveSkillMap(dataset, build.resonatorId);
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

    // Phase 10: validate the rotation against the resonator's prerequisite
    // rules. Warnings are advisory — they never block. Build an index→warning
    // map so renderSteps can mark individual flagged steps.
    const warnings = validateRotation(build.rotation ?? [], rulesForResonator(build.resonatorId));
    const warningByIndex = new Map(warnings.map(w => [w.index, w]));

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
            ${raw(renderValidationBanner(warnings))}
            ${raw(renderDpsChart(sim))}
            ${raw(renderTimeline(sim))}
            ${raw(renderBuffBars(sim))}
            ${raw(renderSteps(sim, warningByIndex))}
            ${raw(renderPalette())}
        </div>
    `;
}

// Advisory banner summarising prerequisite warnings. Non-blocking: it explains
// that the rotation may not be executable in-game, but the sim still runs.
function renderValidationBanner(warnings) {
    if (!warnings.length) return '';
    const count = warnings.length;
    return `
        <div class="rot-validation" role="status">
            <span class="rot-validation__icon">⚠</span>
            <span class="rot-validation__text">
                ${count} step${count === 1 ? '' : 's'} may not be available in this order.
                Hover the marked step${count === 1 ? '' : 's'} for details — the simulation still runs as ordered.
            </span>
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