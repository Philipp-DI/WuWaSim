// src/ui/components/sonata-quickswitch.js — the floating "quick-switch" set
// picker shared by the build editor's header sonata chips and the team page's
// member sonata badge.
//
// It is a PREVIEW-only control: picking a set never edits or saves a build. The
// caller decides what a pick means (relabel a transient override map) via the
// onPick/onReset callbacks. Body-appended (survives page repaints), one instance
// at a time — mirrors the menu pattern in build-editor/menus.js and the shared
// tooltip in ../tooltip.js.
import { esc } from '../dom.js';
import { iconHtml } from '../icons.js';

let menuEl = null;
let state = null;   // { onOptClick, onOutside, onKey } for teardown

function ensureEl() {
    if (menuEl && document.body.contains(menuEl)) return menuEl;
    const el = document.createElement('div');
    el.className = 'bv2-sonata-menu';
    document.body.appendChild(el);
    menuEl = el;
    return el;
}

export function closeSonataQuickswitch() {
    if (!menuEl) return;
    menuEl.classList.remove('is-open');
    if (state) {
        menuEl.removeEventListener('click', state.onOptClick);
        document.removeEventListener('mousedown', state.onOutside, true);
        document.removeEventListener('keydown', state.onKey, true);
        state = null;
    }
}

// Row markup — icon + name, with the set's tier bonuses on the native title so
// the body-appended popover needs no extra tooltip wiring. `current` lights the
// row matching the previewed/equipped set.
function optionRow(sonata, current) {
    const active = sonata.id === current;
    const tiers = (sonata.tiers ?? [])
        .slice()
        .sort((tierA, tierB) => tierA.pieces - tierB.pieces)
        .filter((tier) => tier.effect)
        .map((tier) => `${tier.pieces}PC — ${tier.effect}`)
        .join('\n');
    return `<button type="button" class="bv2-sonata-menu__opt" data-qs-id="${sonata.id}" title="${esc(sonata.name + (tiers ? '\n\n' + tiers : ''))}"
        style="display:flex;align-items:center;gap:8px;width:100%;border:none;background:${active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent'};padding:6px 9px;border-radius:7px;cursor:pointer;text-align:left;color:${active ? 'var(--accent)' : 'var(--popover-ink)'};font:inherit;font-size:12px;font-weight:600;">
        <span style="width:20px;height:20px;flex:none;display:inline-flex;align-items:center;justify-content:center;">${iconHtml('sonata', sonata.name, { label: sonata.name, size: 20 })}</span>
        <span style="min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(sonata.name)}</span>
        ${active ? '<span style="flex:none;font-size:10px;color:var(--accent);">●</span>' : ''}
      </button>`;
}

/**
 * Open the picker under `anchorEl`.
 *   sonatas   — full set list (dataset.sonatas)
 *   currentId — set to highlight (the previewed/equipped set)
 *   canReset  — show a "↺ Reset to equipped" row (this chip is overridden)
 *   onPick(id), onReset() — caller applies the transient override
 */
export function openSonataQuickswitch({ anchorEl, sonatas, currentId, canReset, onPick, onReset }) {
    closeSonataQuickswitch();
    const el = ensureEl();

    const list = (sonatas ?? [])
        .slice()
        .sort((setA, setB) => setA.name.localeCompare(setB.name))
        .map((sonata) => optionRow(sonata, currentId))
        .join('');
    const resetRow = canReset
        ? `<button type="button" data-qs-reset style="display:flex;align-items:center;gap:8px;width:100%;border:none;background:transparent;padding:6px 9px;border-radius:7px;cursor:pointer;text-align:left;color:var(--popover-ink);font:inherit;font-size:11.5px;font-weight:700;letter-spacing:.3px;">
             <span style="width:20px;text-align:center;flex:none;">↺</span><span>Reset to equipped</span>
           </button>
           <div style="height:1px;background:var(--popover-border);margin:4px 2px;"></div>`
        : '';
    el.innerHTML = `${resetRow}<div class="bv2-qs-list" style="max-height:340px;overflow:auto;scrollbar-width:thin;">${list}</div>`;
    el.classList.add('is-open');

    const rect = anchorEl.getBoundingClientRect();
    const margin = 12;
    const overflowsRight = rect.left + el.offsetWidth > window.innerWidth - margin;
    el.style.left = Math.round(overflowsRight ? Math.max(margin, rect.right - el.offsetWidth) : rect.left) + 'px';
    // Prefer below; flip above when there isn't room (the list can be tall).
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const top = (el.offsetHeight <= spaceBelow || spaceBelow >= rect.top - margin)
        ? rect.bottom + 6
        : Math.max(margin, rect.top - el.offsetHeight - 6);
    el.style.top = Math.round(top) + 'px';

    const onOptClick = (event) => {
        if (event.target.closest('[data-qs-reset]')) { closeSonataQuickswitch(); onReset?.(); return; }
        const btn = event.target.closest('.bv2-sonata-menu__opt');
        if (!btn) return;
        closeSonataQuickswitch();
        onPick?.(Number(btn.dataset.qsId));
    };
    const onOutside = (event) => {
        if (el.contains(event.target) || anchorEl.contains(event.target)) return;
        closeSonataQuickswitch();
    };
    const onKey = (event) => { if (event.key === 'Escape') closeSonataQuickswitch(); };

    el.addEventListener('click', onOptClick);
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    state = { onOptClick, onOutside, onKey };
}
