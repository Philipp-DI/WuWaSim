/**
 * Shared v2 chrome — the sticky top header used by every "main" (v2) page:
 * the Build page (build-editor-v2.js), the Party / team-sim page
 * (team-editor-v2.js), and the Compare stub. Extracted so all three render
 * an identical header with a single active-tab highlight, and so the theme
 * preference is shared across them (toggle once, persists as you navigate).
 *
 * Nav model:
 *   data-nav="build|party|compare|archived"  → onNav(tab)
 *   data-act="v2-theme"                       → onTheme()
 *
 * "ARCHIVED" is the entry point into the classic (pre-v2) shell — the roster
 * picker, saved-builds drawer, classic editors and teams — which is preserved
 * intact and reachable on demand rather than deleted.
 *
 * All markup uses the `.bv2`-scoped design tokens (styles/build-v2.css), so the
 * host page must carry `class="bv2" data-theme="…"`.
 */

import { on } from '../dom.js';

// Shared theme preference across all v2 pages. Module-level so navigating
// Build → Party → Compare keeps whatever the user last picked.
let v2Theme = 'dark';
export function getV2Theme() { return v2Theme; }
export function toggleV2Theme() { v2Theme = v2Theme === 'dark' ? 'light' : 'dark'; return v2Theme; }

const NAV = [
    { tab: 'build', label: 'BUILD' },
    { tab: 'party', label: 'PARTY' },
    { tab: 'compare', label: 'COMPARE' },
];

function navLink({ tab, label }, active) {
    const on = tab === active;
    const underline = on
        ? `<span style="position:absolute;left:13px;right:13px;bottom:0;height:2px;border-radius:2px;background:var(--acc);box-shadow:0 0 9px var(--acc);"></span>`
        : '';
    return `<a data-nav="${tab}" style="position:relative;display:flex;align-items:center;height:100%;padding:0 15px;font-family:'Chakra Petch',sans-serif;font-size:13px;letter-spacing:.6px;cursor:pointer;color:${on ? 'var(--txt)' : 'var(--faint)'};font-weight:${on ? '700' : '400'};">${label}${underline}</a>`;
}

const THEME_ICON = {
    dark: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
    light: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
};

/**
 * Render the sticky v2 header.
 * @param {object} opts
 * @param {'build'|'party'|'compare'} opts.active — which nav tab is current
 * @param {string} opts.theme — 'dark' | 'light' (for the toggle icon)
 * @returns {string} HTML
 */
export function renderV2Header({ active = 'build', theme = 'dark' }) {
    return `
    <header style="position:sticky;top:0;z-index:40;height:58px;display:flex;align-items:center;gap:8px;padding:0 20px;background:var(--bar);border-bottom:1px solid var(--bd);">
      <div style="display:flex;align-items:center;gap:11px;margin-right:14px;">
        <span style="position:relative;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;">
          <span style="position:absolute;width:18px;height:18px;background:var(--acc);transform:rotate(45deg);border-radius:4px;box-shadow:0 0 13px rgba(70,214,198,.55);"></span>
          <span style="position:absolute;width:7px;height:7px;background:var(--bar);transform:rotate(45deg);border-radius:1px;"></span>
        </span>
        <span style="font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:17px;letter-spacing:1.5px;color:var(--txt);line-height:1;">WUWA<span style="color:var(--acc);">·</span><span style="font-weight:400;color:var(--dim);">SIM</span></span>
      </div>
      <nav style="display:flex;align-items:stretch;height:100%;">
        ${NAV.map(n => navLink(n, active)).join('')}
      </nav>
      <div style="margin-left:auto;display:flex;align-items:center;gap:10px;">
        <button data-nav="archived" title="Roster, saved builds & classic (archived) pages"
                style="font-family:'Chakra Petch',sans-serif;font-size:11px;letter-spacing:1px;color:var(--dim);background:var(--btn);border:1px solid var(--btnbd);border-radius:9px;padding:9px 12px;cursor:pointer;">ARCHIVED</button>
        <span style="width:1px;height:22px;background:var(--bd);"></span>
        <button data-act="v2-theme" class="bv2-iconbtn" title="Toggle theme">${THEME_ICON[theme] ?? THEME_ICON.dark}</button>
      </div>
    </header>`;
}

/**
 * Wire the header's nav + theme controls. Idempotent-friendly: delegates off
 * `root`, so it survives the host page's full repaints.
 * @param {HTMLElement} root
 * @param {object} handlers
 * @param {(tab:string)=>void} handlers.onNav — 'build'|'party'|'compare'|'archived'
 * @param {()=>void} handlers.onTheme
 */
export function bindV2Header(root, { onNav, onTheme }) {
    on(root, 'click', '[data-nav]', (_e, el) => onNav?.(el.dataset.nav));
    on(root, 'click', '[data-act="v2-theme"]', () => onTheme?.());
}
