/**
 * Icon resolver + glyph fallback — P11 groundwork (housekeeping H4).
 *
 * Single seam for resolving a dataset entity (element / weapon type / sonata
 * set / misc glyph) to a committed local asset path. No component hardcodes
 * icon paths; they call `iconFor(kind, idOrName)` or render `iconHtml(...)`.
 *
 * Assets live under `assets/icons/<dir>/<kebab-slug>.webp` and are committed
 * to the repo (not hotlinked from a CDN — links rot between patches and CORS
 * is out of our control). Filenames are kebab-case and map 1:1 to dataset
 * identifiers (element id → name, sonata set id → name, weapon type id → name).
 *
 * Two render modes:
 *   - Full-colour icons (elements, sonatas) render as plain `<img>`.
 *   - Monochrome white-on-transparent glyphs (weapon types, misc) render via
 *     CSS mask so they are tintable by any token colour (see `.icon--mask`).
 *
 * Missing assets are expected (new sonata next patch, sweep gap): `iconFor`
 * returns `null` and `iconHtml` renders a designed glyph fallback — a rounded
 * square in the relevant token colour containing the entity's initial.
 *
 * When new assets are committed, add their slug to the relevant manifest below.
 */

import { esc } from './dom.js';

const BASE = './assets/icons';

// Fixed game constants (stable across patches) — id → kebab slug.
const ELEMENT_SLUG = { 1: 'glacio', 2: 'fusion', 3: 'electro', 4: 'aero', 5: 'spectro', 6: 'havoc' };
const WEAPON_TYPE_SLUG = { 1: 'broadblade', 2: 'sword', 3: 'pistols', 4: 'gauntlets', 5: 'rectifier' };

// Element token colours (styles/tokens.css) used by the fallback glyph.
const ELEMENT_COLOR = {
    glacio: '--el-glacio', fusion: '--el-fusion', electro: '--el-electro',
    aero: '--el-aero', spectro: '--el-spectro', havoc: '--el-havoc',
};

// Committed sonata-set asset slugs. id 32 (Shadow of Shattered Dreams) has no
// sweep asset yet → resolves to null → glyph fallback.
const SONATA_SLUGS = new Set([
    'celestial-light', 'chromatic-foam', 'crown-of-valor', 'dream-of-the-lost',
    'empyrean-anthem', 'eternal-radiance', 'flamewings-shadow', 'flaming-clawprint',
    'freezing-frost', 'frosty-resolve', 'gusts-of-welkin', 'halo-of-starry-radiance',
    'havoc-eclipse', 'law-of-harmony', 'lingering-tunes', 'midnight-veil',
    'molten-rift', 'moonlit-clouds', 'pact-of-neonlight-leap', 'reel-of-spliced-memories',
    'rejuvenating-glow', 'rite-of-gilded-revelation', 'sierra-gale', 'sound-of-true-name',
    'thread-of-severed-fate', 'tidebreaking-courage', 'trailblazing-star', 'void-thunder',
    'windward-pilgrimage', 'wishes-of-quiet-snowfall',
]);

// Per-kind config: asset subdirectory, whether it's a tintable monochrome mask,
// the manifest of committed slugs (so an unknown id yields null → fallback),
// and the file extension (defaults to 'webp' — see DEFAULT_EXT below).
const KINDS = {
    element:    { dir: 'elements',     mask: false, slugs: new Set(Object.values(ELEMENT_SLUG)) },
    weaponType: { dir: 'weapon-types', mask: true,  slugs: new Set(Object.values(WEAPON_TYPE_SLUG)) },
    sonata:     { dir: 'sonata',       mask: false, slugs: SONATA_SLUGS },
    // Misc/buff glyphs (P11 buff bar) — generic + defensive buff-bar icons.
    misc:       { dir: 'misc', mask: true, ext: 'png', slugs: new Set(['gen-buff-icon', 'defensive-buff-icon']) },
};
const DEFAULT_EXT = 'webp';

/** Lowercase, strip apostrophes, collapse non-alphanumerics to single dashes. */
export function kebab(s) {
    return String(s ?? '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Resolve the kebab slug for an entity. Numeric ids use the fixed maps for
 * elements / weapon types; everything else is the kebab of the supplied name.
 */
export function slugFor(kind, idOrName) {
    if (idOrName == null) return null;
    if (kind === 'element' && typeof idOrName === 'number') return ELEMENT_SLUG[idOrName] ?? null;
    if (kind === 'weaponType' && typeof idOrName === 'number') return WEAPON_TYPE_SLUG[idOrName] ?? null;
    return kebab(idOrName) || null;
}

/**
 * Path to the committed asset, or null when none exists (→ glyph fallback).
 * @param {'element'|'weaponType'|'sonata'|'misc'} kind
 * @param {number|string} idOrName  numeric dataset id, or the entity name
 */
export function iconFor(kind, idOrName) {
    const cfg = KINDS[kind];
    if (!cfg) return null;
    const slug = slugFor(kind, idOrName);
    if (!slug || !cfg.slugs.has(slug)) return null;
    return `${BASE}/${cfg.dir}/${slug}.${cfg.ext ?? DEFAULT_EXT}`;
}

/**
 * Render an icon as an HTML string (matches the codebase's string-template
 * style). Falls back to a designed glyph square when no asset resolves.
 *
 * @param {string} kind
 * @param {number|string} idOrName
 * @param {object} [opts]
 * @param {string} [opts.label]  accessible label + fallback initial source
 * @param {number} [opts.size]   pixel size (default 24)
 * @param {string} [opts.tint]      CSS custom property for mask tint, e.g. '--accent'
 * @param {string} [opts.tintColor] literal CSS colour expression for mask tint
 *        (e.g. 'var(--el-glacio)', a color-mix() result) — takes precedence
 *        over `tint` when a fixed token name isn't known ahead of render time
 */
export function iconHtml(kind, idOrName, { label = '', size = 24, tint = '', tintColor = '' } = {}) {
    const cfg = KINDS[kind];
    const src = iconFor(kind, idOrName);
    const alt = esc(label || String(idOrName ?? ''));

    if (src) {
        if (cfg.mask) {
            const tintDecl = tintColor ? `color:${tintColor};` : (tint ? `color:var(${tint});` : '');
            const style = `--icon-size:${size}px;${tintDecl}`
                + `-webkit-mask-image:url('${src}');mask-image:url('${src}');`;
            return `<span class="icon icon--mask" role="img" aria-label="${alt}" style="${style}"></span>`;
        }
        return `<img class="icon" src="${esc(src)}" alt="${alt}" width="${size}" height="${size}" loading="lazy">`;
    }

    // Glyph fallback: rounded square in the kind's token colour with an initial.
    const slug = slugFor(kind, idOrName) || String(idOrName ?? '');
    const initial = esc(((label || slug).trim().charAt(0) || '?').toUpperCase());
    const colorVar = (kind === 'element' && ELEMENT_COLOR[slug]) ? ELEMENT_COLOR[slug] : '--accent';
    return `<span class="icon icon--fallback" role="img" aria-label="${alt}" `
        + `style="--icon-size:${size}px;--icon-color:var(${colorVar});">${initial}</span>`;
}

// One-time global hook so an inline `onerror=` attribute (the only place we
// can react to a *real* asset-load failure) can swap to the same glyph
// fallback `iconHtml` renders for manifest-backed kinds, without duplicating
// markup inside the attribute string.
if (typeof window !== 'undefined' && !window.__iconFallback) {
    window.__iconFallback = (img, initial, colorVar, className) => {
        const span = document.createElement('span');
        span.className = `${className} icon--fallback`;
        span.setAttribute('role', 'img');
        if (img.alt) span.setAttribute('aria-label', img.alt);
        span.style.setProperty('--icon-size', `${img.width}px`);
        span.style.setProperty('--icon-color', `var(${colorVar})`);
        span.textContent = initial;
        img.replaceWith(span);
    };
}

/**
 * Render an icon for a per-entity asset resolved directly from the dataset's
 * own `iconUrl` (echoes, monsters — too many and too patch-volatile for a
 * hand-maintained manifest, unlike the small fixed enums in KINDS). Existence
 * can't be checked ahead of render time without a manifest, so the fallback
 * triggers on an actual image-load failure via `onerror` instead of `iconFor`.
 *
 * @param {string|null|undefined} iconUrl  the dataset's CDN-style iconUrl;
 *        the local asset path is derived from its basename
 * @param {object} [opts]
 * @param {string} [opts.label]      accessible label + fallback initial source
 * @param {number} [opts.size]       pixel size (default 24)
 * @param {string} [opts.className]  CSS class for sizing/background context
 *        (default 'icon') — combined with 'icon--fallback' on failure so a
 *        caller's own icon-slot styling (e.g. `.option__icon`) still applies
 */
export function dynamicIconHtml(iconUrl, { label = '', size = 24, className = 'icon' } = {}) {
    const alt = esc(label || '');
    const initial = esc((label.trim().charAt(0) || '?').toUpperCase());
    if (!iconUrl) {
        return `<span class="${className} icon--fallback" role="img" aria-label="${alt}" style="--icon-size:${size}px;--icon-color:var(--accent);">${initial}</span>`;
    }
    const dir = iconUrl.includes('MonsterHead') ? 'monsters' : 'echoes';
    const src = `${BASE}/${dir}/${iconUrl.split('/').pop()}`;
    // width/height attributes size the image directly — .icon no longer
    // overrides them (see base.css), so changing `size` here is all it takes.
    return `<img class="${className}" src="${esc(src)}" alt="${alt}" width="${size}" height="${size}" loading="lazy" `
        + `onerror="window.__iconFallback&&window.__iconFallback(this,'${initial}','--accent','${className}')">`;
}

// Test hooks.
export const __test__ = { KINDS, ELEMENT_SLUG, WEAPON_TYPE_SLUG };
