/**
 * App entry point.
 *
 * Manages the top-level view state: picker, editor, or builds drawer.
 * Owns the loaded dataset and the currently-edited build. Persistence
 * goes through src/data/storage.js — UI never touches localStorage.
 *
 * View transitions are simple (no router): the URL hash mirrors the
 * current view so reloads preserve state. Hashes are deliberately
 * minimal so they're safe to share.
 *
 *   #picker            -> character grid
 *   #builds            -> saved builds drawer
 *   #edit/<buildId>    -> build editor for that build
 *   #new/<resonatorId> -> create + edit a new build for that resonator
 */

import { loadDataset } from '../data/loader.js';
import { mount as mountPicker } from './components/character-picker.js';
import { mount as mountEditor } from './components/build-editor.js';
import * as kameraImporter from './components/kamera-importer.js';
import { html, raw, render, esc } from './dom.js';
import * as storage from '../data/storage.js';
import {
    listBuilds, readBuild, saveBuild, deleteBuild,
    setCurrentBuildId, readMeta, isAvailable,
} from '../data/storage.js';
import { createBuild } from '../core/build.js';

// ---------- DOM regions (set on boot) ----------
const root = document.getElementById('main');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const versionTag = document.getElementById('version-tag');

// ---------- App state ----------
let dataset = null;
let currentBuild = null;     // editor's working copy
let saveTimer = null;     // debounce handle for autosave

const SAVE_DEBOUNCE_MS = 400;

function setStatus(label, isIdle = false) {
    statusText.textContent = label;
    statusDot.classList.toggle('idle', isIdle);
}

// =============================================================================
// Loading / error states
// =============================================================================

function showLoading() {
    render(root, html`
        <section class="panel">
            <div class="state">
                <span class="eyebrow">Loading</span>
                <p><span class="spinner"></span>Fetching dataset...</p>
            </div>
        </section>
    `);
}

function showError(err) {
    render(root, html`
        <section class="panel">
            <div class="state state--error">
                <span class="eyebrow">Error</span>
                <p>Could not load dataset.</p>
                <pre>${err && err.stack ? err.stack : String(err)}</pre>
            </div>
        </section>
    `);
}

// =============================================================================
// Picker view
// =============================================================================

function showPicker() {
    const buildCount = isAvailable() ? listBuilds({ dataset }).length : 0;
    render(root, html`
        <section class="panel" aria-labelledby="picker-title">
            <div class="panel__header">
                <h2 class="panel__title" id="picker-title">Resonators</h2>
                <div style="display:flex; gap: var(--sp-3); align-items: center;">
                    <span class="panel__meta">${formatMeta(dataset)}</span>
                    <button class="btn" data-action="show-importer">Import…</button>
                    <button class="btn ${raw(buildCount > 0 ? 'btn--primary' : '')}"
                            data-action="show-builds">
                        Saved builds${raw(buildCount ? ` · ${buildCount}` : '')}
                    </button>
                </div>
            </div>
            <div id="picker-root"></div>
        </section>
    `);

    mountPicker(document.getElementById('picker-root'), {
        dataset,
        onSelect: (r) => goto(`#new/${r.id}`),
    });

    root.querySelector('[data-action="show-builds"]')?.addEventListener('click', () => goto('#builds'));
    root.querySelector('[data-action="show-importer"]')?.addEventListener('click', () => {
        kameraImporter.open({
            dataset,
            storage,
            onApplied: () => {
                // Refresh the picker so the build count updates without
                // requiring a navigation away and back.
                showPicker();
            },
        });
    });
    setStatus('Ready', true);
}

function formatMeta(ds) {
    const date = ds.generatedAt ? new Date(ds.generatedAt).toISOString().slice(0, 10) : '—';
    return `${ds.counts.resonators} resonators · ${ds.counts.weapons} weapons · ${ds.counts.echoes} echoes · ${date}`;
}

// =============================================================================
// Builds drawer view
// =============================================================================

function showBuildsDrawer() {
    const builds = listBuilds({ dataset });
    render(root, html`
        <section class="panel">
            <div class="panel__header">
                <h2 class="panel__title">Saved builds</h2>
                <button class="btn btn--back" data-action="back-to-picker">Back to roster</button>
            </div>
            <div class="builds-drawer">
                ${raw(builds.length === 0
        ? `<div class="builds-drawer__empty">No saved builds yet. Pick a resonator to start.</div>`
        : builds.map(b => renderBuildRow(b)).join(''))}
            </div>
        </section>
    `);

    root.querySelector('[data-action="back-to-picker"]')?.addEventListener('click', () => goto('#picker'));
    root.querySelectorAll('[data-action="open-build"]').forEach(el => {
        el.addEventListener('click', () => goto(`#edit/${el.dataset.id}`));
    });
    root.querySelectorAll('[data-action="delete-build"]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${el.dataset.name}"?`)) {
                deleteBuild(el.dataset.id);
                showBuildsDrawer();
            }
        });
    });
    setStatus(`${builds.length} build${builds.length === 1 ? '' : 's'}`, true);
}

function renderBuildRow(build) {
    const resonator = dataset.resonators.find(r => r.id === build.resonatorId);
    const resName = resonator?.name ?? `Resonator #${build.resonatorId}`;
    const equippedEchoes = build.echoes.filter(Boolean).length;
    return `
        <div class="build-row" data-action="open-build" data-id="${esc(build.id)}">
            <span class="build-row__name">${esc(build.name)}</span>
            <span class="build-row__meta">
                ${esc(resName)} · Lv ${esc(String(build.level))}
                · ${equippedEchoes}/5 echoes
                ${build.weapon ? '· Wpn' : ''}
            </span>
            <button class="build-row__delete"
                    data-action="delete-build"
                    data-id="${esc(build.id)}"
                    data-name="${esc(build.name)}"
                    aria-label="Delete ${esc(build.name)}">×</button>
        </div>
    `;
}

// =============================================================================
// Editor view
// =============================================================================

function showEditorForNew(resonatorId) {
    const resonator = dataset.resonators.find(r => r.id === resonatorId);
    if (!resonator) { goto('#picker'); return; }
    currentBuild = createBuild(resonator);
    // Persist immediately so the build appears in the drawer and reloads work.
    currentBuild = saveBuild(currentBuild, { dataset });
    setCurrentBuildId(currentBuild.id);
    // Update hash so this view is bookmarkable, without re-entering goto.
    history.replaceState(null, '', `#edit/${currentBuild.id}`);
    paintEditor();
}

function showEditorForExisting(buildId) {
    currentBuild = readBuild(buildId, { dataset });
    if (!currentBuild) { goto('#builds'); return; }
    setCurrentBuildId(buildId);
    paintEditor();
}

function paintEditor() {
    if (!currentBuild) return;
    render(root, html`
        <section class="panel">
            <div class="panel__header">
                <h2 class="panel__title">Build</h2>
                <div class="editor__actions">
                    <button class="btn btn--back" data-action="back-to-picker">Back</button>
                    <button class="btn" data-action="back-to-builds">Saved builds</button>
                </div>
            </div>
            <div id="editor-root"></div>
        </section>
    `);

    mountEditor(document.getElementById('editor-root'), {
        dataset,
        build: currentBuild,
        onChange: handleBuildChange,
        onBack: () => goto('#picker'),
    });

    root.querySelector('[data-action="back-to-picker"]')?.addEventListener('click', () => goto('#picker'));
    root.querySelector('[data-action="back-to-builds"]')?.addEventListener('click', () => goto('#builds'));

    setStatus(`Editing · ${currentBuild.name}`);
}

function handleBuildChange(nextBuild) {
    currentBuild = nextBuild;
    setStatus(`Editing · ${nextBuild.name}`);
    // Debounced autosave keeps the rename input snappy.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            saveBuild(currentBuild, { dataset });
            setStatus(`Saved · ${currentBuild.name}`, true);
        } catch (err) {
            console.error(err);
            setStatus('Save failed');
        }
    }, SAVE_DEBOUNCE_MS);
}

// =============================================================================
// Router
// =============================================================================

function goto(hash) {
    if (location.hash === hash) {
        // Same hash — force a re-route since hashchange won't fire.
        route();
    } else {
        location.hash = hash;
    }
}

function route() {
    const hash = location.hash || '#picker';
    // Match #new/<id>, #edit/<id>, or #builds/#picker.
    const newMatch = hash.match(/^#new\/(\d+)$/);
    const editMatch = hash.match(/^#edit\/([\w-]+)$/);

    if (newMatch) {
        showEditorForNew(Number(newMatch[1]));
    } else if (editMatch) {
        showEditorForExisting(editMatch[1]);
    } else if (hash === '#builds') {
        showBuildsDrawer();
    } else {
        showPicker();
    }
}

// =============================================================================
// Boot
// =============================================================================

async function boot() {
    setStatus('Loading');
    showLoading();
    try {
        dataset = await loadDataset();
        if (versionTag) versionTag.textContent = `schema v${dataset.schemaVersion}`;

        // If a build was open last time and the hash doesn't already
        // address something, restore it.
        if (!location.hash) {
            const meta = readMeta();
            if (meta.currentBuildId && readBuild(meta.currentBuildId, { dataset })) {
                location.hash = `#edit/${meta.currentBuildId}`;
                return; // hashchange handler will route
            }
        }

        window.addEventListener('hashchange', route);
        route();
    } catch (err) {
        console.error(err);
        showError(err);
        setStatus('Error');
    }
}

boot();