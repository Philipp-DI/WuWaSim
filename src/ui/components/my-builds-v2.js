/**
 * My Builds (MY BUILDS) — v2 page.
 *
 * A minimal, function-first management list for saved builds: open, duplicate
 * or delete each one, or jump to the Roster to start a new build. Replaces the
 * classic saved-builds drawer. Shares the v2 sticky header (v2-header.js) and
 * the `.bv2`-scoped design tokens (styles/tokens.css + build-v2.css).
 *
 *   mount(root, {
 *     dataset, theme,
 *     listBuilds() -> [build],      // queried fresh on every paint
 *     onOpen(id), onDuplicate(id), onDelete(id),
 *     onNew(),                      // start a new build (→ Roster)
 *   }) -> { update() }
 *
 * Presentation-only: all persistence happens through the injected callbacks.
 * Design is deliberately spartan — to be refined later.
 */

import { html, raw, render, on, esc } from '../dom.js';
import { renderV2Header, getV2Theme } from './v2-header.js';

let api = null;

function resoName(build) {
    const r = api.dataset.resonators.find(x => x.id === build.resonatorId);
    return r?.name ?? `Resonator #${build.resonatorId}`;
}

function buildRow(build) {
    const echoes = (build.echoes ?? []).filter(Boolean).length;
    const meta = `${esc(resoName(build))} · Lv ${esc(String(build.level ?? 1))} · ${echoes}/5 echoes${build.weapon ? ' · Wpn' : ''}`;
    const actBtn = "font-family:var(--font-display);font-size:10px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;border-radius:var(--radius-sm);padding:7px 12px;cursor:pointer;background:var(--btn);border:1px solid var(--btnbd);color:var(--dim);transition:color .12s,border-color .12s;";
    return `
      <div style="display:flex;align-items:center;gap:14px;padding:13px 16px;background:var(--card);border:1px solid var(--bd);border-radius:var(--radius-md);">
        <button data-act="open" data-id="${esc(build.id)}" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;background:none;border:none;text-align:left;cursor:pointer;padding:0;">
          <span style="font-family:var(--font-display);font-weight:700;font-size:14px;letter-spacing:.4px;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(build.name ?? 'Build')}</span>
          <span style="font-family:var(--font-body);font-size:11.5px;color:var(--dim);">${meta}</span>
        </button>
        <button data-act="open"      data-id="${esc(build.id)}" style="${actBtn}">Open</button>
        <button data-act="duplicate" data-id="${esc(build.id)}" style="${actBtn}">Duplicate</button>
        <button data-act="delete"    data-id="${esc(build.id)}" data-name="${esc(build.name ?? 'Build')}"
                style="${actBtn}border-color:var(--warn);color:var(--warn);">Delete</button>
      </div>`;
}

function renderList() {
    const builds = api.listBuilds?.() ?? [];
    if (builds.length === 0) {
        return `
          <div style="padding:48px 18px;text-align:center;border:1px dashed var(--bd);border-radius:var(--radius-md);">
            <div style="font-family:var(--font-display);font-size:14px;letter-spacing:.5px;color:var(--dim);">No saved builds yet</div>
            <div style="font-family:var(--font-body);font-size:12px;color:var(--faint);margin-top:6px;">Open the Roster and pick a resonator to create one.</div>
            <button data-act="new" style="margin-top:16px;font-family:var(--font-display);font-weight:700;font-size:11px;letter-spacing:1px;text-transform:uppercase;border-radius:var(--radius-sm);padding:9px 16px;cursor:pointer;background:var(--acc);border:none;color:var(--on-acc);">Open Roster</button>
          </div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:8px;">${builds.map(buildRow).join('')}</div>`;
}

function renderTitleRow() {
    const count = (api.listBuilds?.() ?? []).length;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div style="display:flex;align-items:center;gap:11px;">
          <span style="width:10px;height:22px;border-radius:3px;background:var(--acc);box-shadow:0 0 10px var(--acc);"></span>
          <span style="font-family:var(--font-display);font-weight:700;font-size:16px;letter-spacing:2px;color:var(--txt);">MY BUILDS</span>
          <span style="font-family:var(--font-display);font-size:11px;color:var(--faint);">${count} saved</span>
        </div>
        <button data-act="new" style="font-family:var(--font-display);font-weight:700;font-size:11px;letter-spacing:1px;text-transform:uppercase;border-radius:var(--radius-sm);padding:9px 16px;cursor:pointer;background:var(--acc);border:none;color:var(--on-acc);">+ New build</button>
      </div>`;
}

function renderPage() {
    return html`
      <div class="bv2" data-theme="${api.theme}">
        ${raw(renderV2Header({ active: 'mybuilds', theme: api.theme }))}
        <div style="max-width:980px;margin:0 auto;padding:28px 24px 60px;display:flex;flex-direction:column;gap:18px;">
          ${raw(renderTitleRow())}
          <div data-region="builds-list">${raw(renderList())}</div>
        </div>
      </div>`;
}

function paint() { render(api.root, renderPage()); }

function bind() {
    const root = api.root;
    on(root, 'click', '[data-act="open"]', (_e, el) => api.onOpen?.(el.dataset.id));
    on(root, 'click', '[data-act="duplicate"]', (_e, el) => { api.onDuplicate?.(el.dataset.id); paint(); });
    on(root, 'click', '[data-act="delete"]', (_e, el) => {
        if (confirm(`Delete "${el.dataset.name}"?`)) { api.onDelete?.(el.dataset.id); paint(); }
    });
    on(root, 'click', '[data-act="new"]', () => api.onNew?.());
}

export function mount(root, config) {
    api = {
        root,
        dataset: config.dataset,
        theme: config.theme ?? getV2Theme(),
        listBuilds: config.listBuilds,
        onOpen: config.onOpen,
        onDuplicate: config.onDuplicate,
        onDelete: config.onDelete,
        onNew: config.onNew,
    };
    paint();
    // Persistent #main root — bind once so revisiting #mybuilds never restacks
    // listeners (same guard pattern as roster-v2.js's __rosterBound).
    if (!root.__myBuildsBound) { root.__myBuildsBound = true; bind(); }
    return { update: () => paint() };
}
