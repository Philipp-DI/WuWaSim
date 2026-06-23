/**
 * Tests for the v2 echo picker (docs/design_handoff_wuwa_sim/echo picker).
 *
 *   node test/echo-picker-v2.test.mjs
 *
 * Covers the pure filtering seam (`filterEchoes`) and the element-enum
 * completeness, plus a render smoke test that drives `open()` against a fake
 * DOM with items mapped from the real wuwa-data.json (same mapping the build
 * page uses), asserting key handoff markup is produced without throwing.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { __test__, open, close } from '../src/ui/components/echo-picker-v2.js';

const { filterEchoes, ELEMENTS, ELEMENT_ORDER } = __test__;

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Same mapping build-editor-v2.openEchoPicker uses, against real data.
const items = d.echoes.filter(e => e.name).map(e => ({
    id: e.id, name: e.name, cost: e.cost,
    elem: e.activeSkill?.element ?? e.elementTypes?.[0] ?? null,
    sonataIds: e.sonataIds ?? [], iconUrl: e.iconUrl,
    skill: e.activeSkill?.name ?? '', desc: '', starLevel: e.starLevel ?? 5,
}));

// ── Element enum completeness ───────────────────────────────────────────────
{
    assert('6 elements defined', Object.keys(ELEMENTS).length === 6);
    assert('element order lists all 6', ELEMENT_ORDER.length === 6 && new Set(ELEMENT_ORDER).size === 6);
    for (const id of [1, 2, 3, 4, 5, 6]) {
        assert(`element ${id} has name+colour`, !!ELEMENTS[id]?.name && /^#/.test(ELEMENTS[id]?.color));
    }
}

// ── filterEchoes ────────────────────────────────────────────────────────────
{
    assert('no filters → all items', filterEchoes(items, {}).length === items.length);
    assert('default arg → all items', filterEchoes(items).length === items.length);

    // Cost filter.
    const cost4 = filterEchoes(items, { costF: 4 });
    assert('cost filter keeps only that cost', cost4.length > 0 && cost4.every(i => i.cost === 4));

    // Element filter.
    const glacio = filterEchoes(items, { elemF: 1 });
    assert('element filter keeps only that element', glacio.length > 0 && glacio.every(i => i.elem === 1));

    // Sonata filter (pick a sonata id actually present).
    const someSonata = items.find(i => i.sonataIds.length)?.sonataIds[0];
    const sonataF = filterEchoes(items, { sonataF: someSonata });
    assert('sonata filter matches via includes', sonataF.length > 0 && sonataF.every(i => i.sonataIds.includes(someSonata)));

    // Search is case-insensitive substring on name.
    const sample = items[0].name.slice(0, 3).toLowerCase();
    const searched = filterEchoes(items, { search: sample.toUpperCase() });
    assert('search is case-insensitive', searched.length > 0 && searched.every(i => i.name.toLowerCase().includes(sample)));

    // AND-combination: cost 4 AND glacio.
    const both = filterEchoes(items, { costF: 4, elemF: 1 });
    assert('filters AND-combine', both.every(i => i.cost === 4 && i.elem === 1));
    assert('AND result ⊆ each single filter', both.length <= cost4.length && both.length <= glacio.length);

    // No match → empty.
    assert('impossible search → empty', filterEchoes(items, { search: '___nope___' }).length === 0);
}

// ── Render smoke test (fake DOM) ────────────────────────────────────────────
{
    let lastHTML = '';
    const listeners = new Map();
    const stub = () => ({
        innerHTML: '', style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        appendChild() {}, addEventListener() {}, removeEventListener() {}, focus() {},
        querySelector() { return stub(); }, querySelectorAll() { return []; },
        getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; },
        contains() { return false; },
    });
    const hostNode = stub();
    Object.defineProperty(hostNode, 'innerHTML', { get() { return lastHTML; }, set(v) { lastHTML = v; } });
    hostNode.querySelector = () => stub();
    hostNode.addEventListener = (type, cb) => { listeners.set(type, cb); };
    const fireClick = (dataset) => listeners.get('click')?.({
        target: { closest: (sel) => sel === '[data-ep]' ? { dataset } : null },
        stopPropagation() {},
    });

    globalThis.window = { innerWidth: 1200, innerHeight: 800 };
    globalThis.requestAnimationFrame = (cb) => cb();
    globalThis.document = {
        createElement: () => hostNode,
        body: { appendChild() {} },
        addEventListener() {}, removeEventListener() {},
    };

    const sonatas = (() => {
        const present = new Set();
        for (const it of items) for (const s of it.sonataIds) present.add(s);
        return d.sonatas.filter(s => s.name && present.has(s.id)).sort((a, b) => a.id - b.id)
            .map(s => ({ id: s.id, name: s.name, desc: `2PC — test bonus +10%` }));
    })();

    let picked = null;
    let threw = false;
    try {
        open({ slotIndex: 2, theme: 'dark', items, sonatas, onPick: (it) => { picked = it; } });
    } catch (e) { threw = true; console.error('    open() threw:', e.message); }
    assert('open() renders without throwing', !threw);
    assert('header shows SELECT ECHO', lastHTML.includes('SELECT ECHO'));
    assert('slot label reflects slotIndex (1-based)', lastHTML.includes('· Slot 3'));
    assert('cost/element/sonata filter labels present', lastHTML.includes('COST') && lastHTML.includes('ELEMENT') && lastHTML.includes('SONATA'));
    assert('renders at least one echo card', lastHTML.includes('data-ep="pick"'));
    assert('search input present', lastHTML.includes('data-ep="search"'));

    // #5 — sonata filter chips carry a set-detail hover-box.
    assert('sonata filter chip has a set-detail hover-box', /data-ep="sonata"[^>]*data-tip-title=/.test(lastHTML));
    // #3/#7 — echo card hover-box uses the shared generic tip attrs (skill only).
    assert('echo card uses generic tip attrs', /data-ep="pick"[^>]*data-tip-title=/.test(lastHTML));
    assert('old card-specific data-skill attr is gone', !lastHTML.includes('data-skill='));
    // #4 — sonata filter row wraps (no horizontal scroll container left).
    assert('filter rows no longer use the horizontal-scroll class', !lastHTML.includes('bv2-ep-scroll'));

    // Card click → onPick with the matching item, then auto-close.
    fireClick({ ep: 'pick', id: String(items[0].id) });
    assert('card click fires onPick with the matching item', picked?.id === items[0].id);
    assert('selection auto-closes the picker', lastHTML === '');

    close();
    assert('close() clears markup', lastHTML === '');
}

console.log(`\necho-picker-v2: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
