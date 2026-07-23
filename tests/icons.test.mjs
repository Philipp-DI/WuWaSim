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

const { iconFor, iconHtml, slugFor, kebab, dynamicIconPath, __test__ } = await import('../src/ui/icons.js');

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
assert("unknown sonata → null", iconFor('sonata', 'Nonexistent Sonata Set') === null);
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

// ── every sonata set resolves to a committed local asset ───────────────────
// Sonata icons are local-only (no baked CDN URL, unlike resonators/weapons/
// echoes): when a game patch adds a set, download its crest into
// assets/icons/sonata/<slug>.webp and register the slug in icons.js
// SONATA_SLUGS. Asserting NONE are missing flags both a regression (an existing
// icon breaking) and a new set that still needs an asset.
const sonataGaps = d.sonatas.filter(s => !iconFor('sonata', s.name)).map(s => s.name);
assert(`every sonata set resolves to an asset (missing: ${sonataGaps.join(", ") || "none"})`,
    sonataGaps.length === 0);

// ── every echo's per-entity local asset exists (echoes/ or monsters/) ──────
// Echoes render via dynamicIconHtml, which derives the committed local path
// from the dataset iconUrl (MonsterHead → monsters/, else echoes/) and only
// falls back to a glyph on an actual load error — so a missing OR mis-filed
// asset shows nothing at render time but passes silently otherwise. Assert the
// derived path exists for every echo, using the SAME helper the UI uses (so
// the two can't disagree on the directory split).
const echoIconGaps = d.echoes
    .filter(e => e.iconUrl)
    .map(e => ({ name: e.name, path: dynamicIconPath(e.iconUrl) }))
    .filter(e => !existsSync(onDisk(e.path)));
assert(`every echo has a committed icon asset (missing ${echoIconGaps.length}: ${echoIconGaps.slice(0, 5).map(e => e.name).join(", ")}${echoIconGaps.length > 5 ? ", …" : ""})`,
    echoIconGaps.length === 0);

// ── iconHtml render modes ──────────────────────────────────────────────────
const imgHtml = iconHtml('element', 1, { label: 'Glacio' });
assert("full-colour renders <img>", imgHtml.startsWith('<img') && imgHtml.includes('glacio.webp'));

const maskHtml = iconHtml('weaponType', 4, { label: 'Gauntlets', tint: '--el-fusion' });
assert("monochrome renders icon--mask", maskHtml.includes('icon--mask'));
assert("mask sets mask-image", maskHtml.includes('mask-image:url(') && maskHtml.includes('gauntlets.webp'));
assert("mask honours tint", maskHtml.includes('color:var(--el-fusion)'));

const fbHtml = iconHtml('sonata', 'Nonexistent Sonata Set', { label: 'Nonexistent Sonata Set' });
assert("missing renders icon--fallback", fbHtml.includes('icon--fallback'));
assert("fallback shows the initial", fbHtml.includes('>N</span>'));

const elFbHtml = iconHtml('element', 99, { label: 'Zephyr' });
assert("element fallback uses --accent when unknown", elFbHtml.includes('var(--accent)'));

console.log(`\nicons: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
