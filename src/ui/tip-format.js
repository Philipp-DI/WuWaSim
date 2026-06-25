/**
 * Shared hover-box description formatter (P11 §I).
 *
 * Highlights element names (each in its canonical element colour) and
 * multiplier/percent values inside a hover-box description. Used by every v2
 * hover-box — the build page (`build-editor-v2.js`) and the echo picker
 * (`echo-picker-v2.js`) — so the "pretty formatting" is identical everywhere.
 *
 * IMPORTANT: operates on ALREADY-ESCAPED text (escape first, then format).
 * Element names and "12.5%" values contain no HTML metacharacters, so matching
 * the escaped string and injecting the only <span>s here is XSS-safe.
 *
 * Pair with the `.bv2-tip-num` / `.bv2-tip-el` rules in styles/build-v2.css.
 */

// Canonical element-name → highlight colour token. Single source:
// styles/tokens.css --el-* (those are :root tokens, so they resolve even inside
// the body-appended hover-box, which is outside the themed .bv2 scope).
const ELEMENT_TIP_COLORS = Object.freeze({
    Glacio: 'var(--el-glacio)', Fusion: 'var(--el-fusion)', Electro: 'var(--el-electro)',
    Aero: 'var(--el-aero)', Spectro: 'var(--el-spectro)', Havoc: 'var(--el-havoc)',
});
const EL_RE = new RegExp(`\\b(${Object.keys(ELEMENT_TIP_COLORS).join('|')})\\b`, 'g');
const NUM_RE = /(\d+(?:\.\d+)?%)/g;

export function formatTipDesc(escapedDesc) {
    return String(escapedDesc ?? '')
        // Numbers first so the element pass never re-scans a number span's markup.
        .replace(NUM_RE, '<span class="bv2-tip-num">$1</span>')
        .replace(EL_RE, (m) => `<span class="bv2-tip-el" style="color:${ELEMENT_TIP_COLORS[m]}">${m}</span>`);
}

export const __test__ = { ELEMENT_TIP_COLORS };
