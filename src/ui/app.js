/**
 * App entry point.
 *
 * Boots the page: loads the dataset, mounts the character picker,
 * surfaces errors clearly. Phase 1 of the simulator — picker only.
 * Subsequent phases will mount additional regions (build editor,
 * rotation timeline, etc.) inside the same shell.
 */

import { loadDataset } from '../data/loader.js';
import { mount as mountPicker } from './components/character-picker.js';
import { html, raw, render } from './dom.js';

// ---------- DOM regions (set on boot) ----------
const root        = document.getElementById('main');
const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');
const versionTag  = document.getElementById('version-tag');

function setStatus(label, isIdle = false) {
    statusText.textContent = label;
    statusDot.classList.toggle('idle', isIdle);
}

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
                <p>Could not load dataset. Phase 1 requires the bundled data file at <code>data/wuwa-data.json</code>.</p>
                <pre>${err && err.stack ? err.stack : String(err)}</pre>
            </div>
        </section>
    `);
}

function showPicker(dataset) {
    const meta = formatMeta(dataset);
    render(root, html`
        <section class="panel" aria-labelledby="picker-title">
            <div class="panel__header">
                <h2 class="panel__title" id="picker-title">Resonators</h2>
                <span class="panel__meta">${meta}</span>
            </div>
            <div id="picker-root"></div>
        </section>
    `);

    mountPicker(document.getElementById('picker-root'), {
        dataset,
        onSelect: (r) => {
            // Phase 2 will wire this to the build editor. For now, just
            // surface the selection in the status bar so we can verify
            // events flow correctly.
            setStatus(`Selected · ${r.name}`);
        },
    });
}

function formatMeta(dataset) {
    const date = dataset.generatedAt
        ? new Date(dataset.generatedAt).toISOString().slice(0, 10)
        : '—';
    return `${dataset.counts.resonators} resonators · ${dataset.lang} · ${date}`;
}

// ---------- Boot ----------

async function boot() {
    setStatus('Loading');
    showLoading();
    try {
        const dataset = await loadDataset();
        if (versionTag) versionTag.textContent = `schema v${dataset.schemaVersion}`;
        showPicker(dataset);
        setStatus('Ready', true);
    } catch (err) {
        console.error(err);
        showError(err);
        setStatus('Error');
    }
}

boot();
