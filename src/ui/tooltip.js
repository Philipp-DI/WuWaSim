/**
 * Shared hover-box tooltip (`.bv2-tooltip`) — a single body-appended div
 * reused by every v2 page (build, team, compare) for the
 * data-tip-title/data-tip-desc hover pattern. Previously each page carried
 * its own copy of this logic; centralised here so positioning/collision and
 * scroll-into behaviour stay identical everywhere and only need fixing once.
 *
 * Pair with the `.bv2-tooltip` rules in styles/build-v2.css.
 */

import { esc } from './dom.js';
import { formatTipDesc } from './tip-format.js';

let tooltipEl = null;
let hideTimer = null;

function cancelPendingHide() {
    if (hideTimer != null) { clearTimeout(hideTimer); hideTimer = null; }
}

function ensureTooltipEl() {
    // app.js sweeps stray `.bv2-tooltip` nodes from the DOM on every page
    // navigation — re-create if our cached reference was one of them.
    if (tooltipEl && document.body.contains(tooltipEl)) return tooltipEl;
    const el = document.createElement('div');
    el.className = 'bv2-tooltip';
    // The box lives outside whatever element it describes, so the delegated
    // mouseout in bindTooltipHover can't tell "cursor moved onto the
    // tooltip" from "cursor left it" — these two listeners are the other
    // half of that check, letting a reader scroll a long description
    // instead of it vanishing the instant the cursor leaves the target.
    el.addEventListener('mouseenter', cancelPendingHide);
    el.addEventListener('mouseleave', hideTooltipSoon);
    document.body.appendChild(el);
    tooltipEl = el;
    return el;
}

export function showTooltip(targetEl, title, desc) {
    cancelPendingHide();
    const el = ensureTooltipEl();
    el.innerHTML = `<div class="bv2-tooltip__title">${esc(title)}</div>` + (desc ? `<div class="bv2-tooltip__desc">${formatTipDesc(esc(desc))}</div>` : '');
    el.classList.add('is-open');

    const r = targetEl.getBoundingClientRect();
    const margin = 12;
    // Elements near the right edge would otherwise clip the box off-screen —
    // grow it leftward (right edge pinned to the target's right edge) instead.
    const overflowsRight = r.left + el.offsetWidth > window.innerWidth - margin;
    el.style.left = Math.round(overflowsRight ? Math.max(margin, r.right - el.offsetWidth) : r.left) + 'px';

    // Prefer below the target; flip above it when there's more room there;
    // then clamp fully inside the viewport. Without this, a tall description
    // near the bottom of the screen ran off the edge with no way to scroll
    // the rest into view (position:fixed content can't be brought into view
    // by scrolling the page).
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    let top = (el.offsetHeight <= spaceBelow || spaceBelow >= spaceAbove) ? r.bottom + 8 : r.top - el.offsetHeight - 8;
    top = Math.max(margin, Math.min(top, window.innerHeight - margin - el.offsetHeight));
    el.style.top = Math.round(top) + 'px';
}

/** Immediate, synchronous close — use before tearing down/re-rendering the page. */
export function hideTooltip() {
    cancelPendingHide();
    tooltipEl?.classList.remove('is-open');
}

/** Grace-period close — use from the mouseout delegation (see bindTooltipHover). */
export function hideTooltipSoon() {
    cancelPendingHide();
    hideTimer = setTimeout(hideTooltip, 150);
}

/**
 * Wires the standard mouseover/mouseout delegation for `[data-tip-title]`
 * elements. mouseenter/mouseleave don't bubble, so delegation uses
 * mouseover/mouseout (which do) + a relatedTarget check on mouseout so
 * moving between children of the same tipped element doesn't flicker.
 */
export function bindTooltipHover(root, on) {
    on(root, 'mouseover', '[data-tip-title]', (_e, el) => showTooltip(el, el.dataset.tipTitle, el.dataset.tipDesc || ''));
    on(root, 'mouseout', '[data-tip-title]', (e, el) => {
        if (el.contains(e.relatedTarget)) return;
        hideTooltipSoon();
    });
}
