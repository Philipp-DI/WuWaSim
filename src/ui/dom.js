/**
 * Minimal DOM helpers shared by all UI components.
 *
 * Kept deliberately tiny. No virtual DOM, no JSX. Components render
 * HTML strings via tagged template literals and use event delegation
 * for interactivity.
 */

/**
 * HTML-escape a value for safe interpolation in templates.
 * Numbers/booleans pass through stringified. Null/undefined become ''.
 */
export function esc(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Tagged template literal that escapes interpolations by default.
 * Use `${raw(html)}` to opt out for already-trusted markup (e.g. when
 * composing a child component's output).
 *
 *   html`<p>Hello ${userName}</p>`
 */
export function html(strings, ...values) {
    let out = '';
    for (let i = 0; i < strings.length; i++) {
        out += strings[i];
        if (i < values.length) {
            const v = values[i];
            if (v && typeof v === 'object' && v.__raw__) out += v.value;
            else if (Array.isArray(v))                   out += v.join('');
            else                                         out += esc(v);
        }
    }
    return out;
}
export const raw = (value) => ({ __raw__: true, value: value ?? '' });

/**
 * Replace a node's children with new innerHTML in one operation.
 * Single seam for the UI so we can swap to a more sophisticated
 * renderer later without touching components.
 */
export function render(root, htmlString) {
    root.innerHTML = htmlString;
}

/** Find by selector, scoped to root (defaults to document). */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Event delegation: attach one listener on `root` and dispatch to a
 * handler when the event target matches `selector`.
 *
 *   on(picker, 'click', '.card', (e, card) => ...)
 */
export function on(root, eventName, selector, handler) {
    root.addEventListener(eventName, (event) => {
        const match = event.target.closest(selector);
        if (match && root.contains(match)) handler(event, match);
    });
}
