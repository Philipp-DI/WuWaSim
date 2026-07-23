/**
 * Tests for the icon resolver + glyph fallback (housekeeping H4).
 *
 *   node test/icons.test.mjs
 *
 * Covers:
 *   - iconFor resolves elements / weapon types / sonatas by id and by name
 *   - missing ids (and bogus kinds) return null → fallback path
 *   - every resolved path points at a file that actually exists on disk
 *   - every dataset element and currently-known sonata resolves to an asset
 *   - iconHtml renders <img> for full-colour, .icon--mask for monochrome,
 *     and a .icon--fallback glyph (with initial) when nothing resolves
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const { iconFor, iconHtml, slugFor, kebab, __test__ } = await import('../src/ui/icons.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const d = JSON.parse(readFileSync(resolve(repoRoot, 'data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Resolve a './assets/...' web path to an on-disk absolute path.
const onDisk = p => resolve(repoRoot, p.replace(/^\.\//, ''));

// ── kebab + slugFor ──────────────────────────────────────────────────────
assert("kebab strips apostrophes", kebab("Flamewing's Shadow") === 'flamewings-shadow');
assert("kebab collapses spaces",   kebab('Sound of True Name') === 'sound-of-true-name');
assert("slugFor element by id",    slugFor('element', 1) === 'glacio');
assert("slugFor weaponType by id", slugFor('weaponType', 4) === 'gauntlets');
assert("slugFor by name",          slugFor('sonata', 'Crown of Valor') === 'crown-of-valor');

// ── iconFor by id and by name ──────────────────────────────────────────────
assert("element by id → path",   iconFor('element', 1) === './assets/icons/elements/glacio.webp');
assert("element by name → path", iconFor('element', 'Aero') === './assets/icons/elements/aero.webp');
assert("weaponType by id → path", iconFor('weaponType', 4) === './assets/icons/weapon-types/gauntlets.webp');
assert("sonata by name → path",  iconFor('sonata', 'Crown of Valor') === './assets/icons/sonata/crown-of-valor.webp');

// ── missing / bogus → null (→ fallback) ────────────────────────────────────
assert("missing sonata → null", iconFor('sonata', 'Shadow of Shattered Dreams') === null);
assert("bogus kind → null",     iconFor('totallyNotAKind', 1) === null);
assert("unknown element → null", iconFor('element', 99) === null);
assert("null id → null",        iconFor('element', null) === null);

// ── every resolved path exists on disk ─────────────────────────────────────
for (const [kind, cfg] of Object.entries(__test__.KINDS)) {
    for (const slug of cfg.slugs) {
        const p = `./assets/icons/${cfg.dir}/${slug}.${cfg.ext ?? 'webp'}`;
        assert(`asset exists: ${kind}/${slug}`, existsSync(onDisk(p)));
    }
}

// ── every dataset element resolves ─────────────────────────────────────────
for (const el of d.elements) {
    assert(`element resolves: ${el.name}`, iconFor('element', el.id) != null);
}

// ── sonatas resolve to committed local assets; a small allowlist of known
// gaps falls back to the letter glyph ──────────────────────────────────────
// Sonata icons are local-only (no baked CDN URL, unlike resonators/weapons/
// echoes), so a set added by a game patch has no icon until its asset lands in
// assets/icons/sonata/. This asserts every OTHER sonata resolves — so it flags
// both a regression (an existing icon breaking) AND a new set that still needs
// an asset. When you add the asset, drop the name from this list.
const KNOWN_SONATA_ICON_GAPS = new Set([
    "Shadow of Shattered Dreams", // 1PC collab set (long-standing gap)
    "Song of Feathered Trace",    // added by the 3.4/3.5 data refresh — asset pending
    "Heart of Evil's Purge",      // added by the 3.4/3.5 data refresh — asset pending
    "Lamp of Nether Road",        // added by the 3.4/3.5 data refresh — asset pending
]);
let sonataResolved = 0;
const unexpectedSonataGaps = [];
for (const s of d.sonatas) {
    if (iconFor('sonata', s.name)) sonataResolved++;
    else if (!KNOWN_SONATA_ICON_GAPS.has(s.name)) unexpectedSonataGaps.push(s.name);
}
assert("most sonatas resolve to an asset", sonataResolved >= 30);
assert(`no unexpected sonata icon gaps (add asset + allowlist): ${unexpectedSonataGaps.join(", ") || "none"}`,
    unexpectedSonataGaps.length === 0);

// ── iconHtml render modes ──────────────────────────────────────────────────
const imgHtml = iconHtml('element', 1, { label: 'Glacio' });
assert("full-colour renders <img>", imgHtml.startsWith('<img') && imgHtml.includes('glacio.webp'));

const maskHtml = iconHtml('weaponType', 4, { label: 'Gauntlets', tint: '--el-fusion' });
assert("monochrome renders icon--mask", maskHtml.includes('icon--mask'));
assert("mask sets mask-image", maskHtml.includes('mask-image:url(') && maskHtml.includes('gauntlets.webp'));
assert("mask honours tint", maskHtml.includes('color:var(--el-fusion)'));

const fbHtml = iconHtml('sonata', 'Shadow of Shattered Dreams', { label: 'Shadow of Shattered Dreams' });
assert("missing renders icon--fallback", fbHtml.includes('icon--fallback'));
assert("fallback shows the initial", fbHtml.includes('>S</span>'));

const elFbHtml = iconHtml('element', 99, { label: 'Zephyr' });
assert("element fallback uses --accent when unknown", elFbHtml.includes('var(--accent)'));

console.log(`\nicons: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
