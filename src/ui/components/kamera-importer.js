// src/ui/components/kamera-importer.js
/**
 * Inventory Kamera import dialog.
 *
 * Three-step flow:
 *   1. Drop (or pick) up to four IK JSON files
 *   2. Preview what will be imported (builds + echoes + warnings)
 *   3. Confirm — writes new builds to localStorage and (optionally) the
 *      echo pool
 *
 * Mounts its own DOM (separate from modal-picker since the UX is
 * meaningfully different — drag-drop area + multi-step). Closes via
 * Escape, backdrop click, or the explicit close button.
 *
 *   open({ dataset, storage, onApplied })
 *
 * `onApplied(report)` fires after successful import so the picker can
 * refresh its build count.
 */

import { html, raw, render, on, esc } from '../dom.js';
import { classifyFiles, parseKameraFiles, applyImport } from '../../data/kamera-import.js';

let mountEl = null;
let state = null;

function ensureMount() {
    if (mountEl) return mountEl;
    mountEl = document.createElement('div');
    mountEl.className = 'modal ik-modal';
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
// Step 1 — Drop zone
// =============================================================================

function renderDropStep() {
    const fileSlots = ['characters', 'echoes', 'weapons', 'achievements'];
    return html`
        <div class="ik-step">
            <p class="ik-intro">
                Drop one or more files exported by
                <a href="https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera" target="_blank" rel="noopener">WuWa Inventory Kamera</a>.
                <code>characters_wuwainventorykamera.json</code> is required; others are optional.
            </p>
            <div class="ik-drop ${raw(state.dragActive ? 'is-active' : '')}"
                 data-action="drop"
                 tabindex="0">
                <span class="ik-drop__icon">⇩</span>
                <span class="ik-drop__title">Drop JSON files here</span>
                <span class="ik-drop__sub">or
                    <label class="ik-drop__link">
                        browse
                        <input type="file" accept="application/json,.json" multiple data-action="pick" hidden>
                    </label>
                </span>
            </div>
            <div class="ik-file-list">
                ${raw(fileSlots.map(kind => renderFileSlot(kind)).join(''))}
            </div>
            <div class="ik-actions">
                <button class="btn" data-action="close">Cancel</button>
                <button class="btn btn--primary"
                        data-action="parse"
                        ${state.classified.characters ? '' : 'disabled'}>
                    Continue →
                </button>
            </div>
        </div>
    `;
}

function renderFileSlot(kind) {
    const file = state.classified[kind];
    const label = kind[0].toUpperCase() + kind.slice(1);
    const required = kind === 'characters';
    return `
        <div class="ik-slot ${file ? 'is-filled' : ''} ${required ? 'is-required' : ''}">
            <div class="ik-slot__head">
                <span class="ik-slot__label">${esc(label)}${required ? ' *' : ''}</span>
                ${file ? `<button class="ik-slot__remove" data-action="remove" data-kind="${esc(kind)}" title="Remove">×</button>` : ''}
            </div>
            <div class="ik-slot__name">${esc(file ? file.name : '— not provided —')}</div>
        </div>
    `;
}

// =============================================================================
// Step 2 — Preview
// =============================================================================

function renderPreviewStep() {
    const { result, dataset } = state;
    return html`
        <div class="ik-step">
            <div class="ik-stat-bar">
                ${raw(statTile('Builds',   result.summary.characters))}
                ${raw(statTile('Echoes',   result.summary.echoes))}
                ${raw(statTile('Warnings', result.summary.warnings, result.summary.warnings > 0 ? 'warn' : ''))}
            </div>

            <h4 class="ik-section-title">Resonators to import</h4>
            <div class="ik-builds">
                ${raw(result.builds.map(b => renderBuildRow(b, dataset)).join('') || `<div class="ik-empty">None.</div>`)}
            </div>

            ${raw(result.echoes.length > 0 ? html`
                <h4 class="ik-section-title">Echoes (${result.echoes.length})</h4>
                <p class="ik-note">
                    Echoes are imported as a pool. You'll equip them to builds in the editor.
                    <em>(Auto-fitting by sonata + element is planned for a later phase.)</em>
                </p>
            ` : '')}

            ${raw(result.warnings.length > 0 ? html`
                <details class="ik-warnings">
                    <summary>${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}</summary>
                    <ul>${raw(result.warnings.map(w => `<li>${esc(w)}</li>`).join(''))}</ul>
                </details>
            ` : '')}

            <div class="ik-actions">
                <button class="btn" data-action="back-to-drop">← Back</button>
                <button class="btn btn--primary"
                        data-action="apply"
                        ${result.builds.length === 0 ? 'disabled' : ''}>
                    Import ${esc(String(result.builds.length))} build${result.builds.length === 1 ? '' : 's'}
                </button>
            </div>
        </div>
    `;
}

function statTile(label, value, kind = '') {
    return `
        <div class="ik-stat-tile ${kind ? 'ik-stat-tile--' + kind : ''}">
            <span class="ik-stat-tile__value">${esc(String(value))}</span>
            <span class="ik-stat-tile__label">${esc(label)}</span>
        </div>
    `;
}

function renderBuildRow(build, dataset) {
    const reso = dataset.resonators.find(r => r.id === build.resonatorId);
    if (!reso) return '';
    const weapon = build.weapon ? dataset.weapons.find(w => w.id === build.weapon.id) : null;
    return `
        <div class="ik-build-row" style="--el-color: ${reso.elementColor};">
            <span class="ik-build-row__swatch"></span>
            <span class="ik-build-row__name">${esc(reso.name)}</span>
            <span class="ik-build-row__meta">Lv ${esc(String(build.level))} · C${esc(String(build.chain))}</span>
            <span class="ik-build-row__meta">${weapon ? esc(weapon.name) : '— no weapon —'}</span>
            <span class="ik-build-row__skills">
                ${esc([build.skillLevels.basic, build.skillLevels.heavy, build.skillLevels.skill, build.skillLevels.liberation, build.skillLevels.intro].join('/'))}
            </span>
        </div>
    `;
}

// =============================================================================
// Step 3 — Done
// =============================================================================

function renderDoneStep() {
    const { report } = state;
    return html`
        <div class="ik-step ik-step--done">
            <div class="ik-success">
                <span class="ik-success__check">✓</span>
                <h3 class="ik-success__title">Imported</h3>
                <p class="ik-success__sub">
                    ${esc(String(report.created))} new ·
                    ${esc(String(report.replaced))} updated
                </p>
            </div>
            <div class="ik-actions">
                <button class="btn btn--primary" data-action="close">Done</button>
            </div>
        </div>
    `;
}

// =============================================================================
// Root render
// =============================================================================

function renderRoot() {
    let body;
    if (state.step === 'drop')         body = renderDropStep();
    else if (state.step === 'preview') body = renderPreviewStep();
    else if (state.step === 'done')    body = renderDoneStep();

    return html`
        <div class="modal__panel ik-panel" role="document">
            <div class="modal__header">
                <h3 class="modal__title">Inventory Kamera Import</h3>
                <button class="modal__close" type="button" data-action="close">Close · ESC</button>
            </div>
            <div class="modal__body ik-body">${raw(body)}</div>
        </div>
    `;
}

function paint() { render(mountEl, renderRoot()); }

// =============================================================================
// File handling
// =============================================================================

function acceptFiles(fileList) {
    const accepted = [...fileList].filter(f => /\.json$/i.test(f.name));
    if (accepted.length === 0) return;
    const newClassified = classifyFiles([...currentFileArray(), ...accepted]);
    state.classified = newClassified;
    state.dragActive = false;
    paint();
}

// Reconstruct an array of current File objects from state.classified for
// re-classification when adding more files.
function currentFileArray() {
    return Object.values(state.classified).filter(x => x && typeof x === 'object' && 'name' in x);
}

// =============================================================================
// Events
// =============================================================================

function bind() {
    const root = mountEl;

    on(root, 'click', '[data-action="close"]', () => close());
    on(root, 'click', '[data-action="back-to-drop"]', () => {
        state.step = 'drop';
        paint();
    });
    on(root, 'click', '[data-action="remove"]', (_e, btn) => {
        const kind = btn.dataset.kind;
        state.classified[kind] = null;
        paint();
    });

    // File picker
    on(root, 'change', 'input[data-action="pick"]', (e) => {
        if (e.target.files?.length) acceptFiles(e.target.files);
    });

    // Drag and drop
    on(root, 'dragover', '[data-action="drop"]', (e) => {
        e.preventDefault();
        if (!state.dragActive) { state.dragActive = true; paint(); }
    });
    on(root, 'dragleave', '[data-action="drop"]', (e) => {
        // Only deactivate when leaving the drop zone entirely, not its children.
        if (e.target === e.currentTarget) {
            state.dragActive = false;
            paint();
        }
    });
    on(root, 'drop', '[data-action="drop"]', (e) => {
        e.preventDefault();
        acceptFiles(e.dataTransfer?.files || []);
    });

    // Parse step
    on(root, 'click', '[data-action="parse"]', async () => {
        await runParse();
    });

    // Apply
    on(root, 'click', '[data-action="apply"]', () => {
        runApply();
    });
}

async function runParse() {
    try {
        state.result = await parseKameraFiles(state.classified, state.dataset);
        state.step = 'preview';
        paint();
    } catch (err) {
        console.error(err);
        state.classified.unknown = [];
        alert('Parse failed: ' + err.message);
    }
}

function runApply() {
    const report = applyImport(state.result, state.dataset, state.storage);
    // Echo pool persistence is a Phase-5 add-on; for now we surface the
    // count but don't store. The parser already returned them in
    // state.result.echoes for future use.
    state.report = report;
    state.step = 'done';
    paint();
    state.onApplied?.(report);
}

// =============================================================================
// Public API
// =============================================================================

export function open(config) {
    const mount = ensureMount();
    state = {
        dataset: config.dataset,
        storage: config.storage,
        onApplied: config.onApplied,
        step: 'drop',
        dragActive: false,
        classified: { characters: null, echoes: null, weapons: null, achievements: null, unknown: [] },
        result: null,
        report: null,
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
