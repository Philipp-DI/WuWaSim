/**
 * Tests for the v2 Resonator Roster page (docs/design_handoff_wuwa_sim/
 * roster page).
 *
 *   node test/roster-v2.test.mjs
 *
 * Covers the pure filter/sort seam (AND-across-dimensions, OR-within-each,
 * matching the handoff's §Filter & Sort Logic exactly) against the real
 * wuwa-data.json, the element-enum completeness, plus a render smoke test
 * that drives mount() against a fake DOM and asserts the handoff's key
 * markup is produced without throwing — and that filter/search interactions
 * re-render cleanly.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mount, filterResonators, sortResonators, __test__ } from '../src/ui/components/roster-v2.js';

const { ELEM } = __test__;

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const resonators = d.resonators;
const elemMap = Object.fromEntries(d.elements.map(e => [e.id, e]));

// ── Element enum (repo palette, not the handoff's) ──────────────────────────
{
    assert('6 elements defined', Object.keys(ELEM).length === 6);
    for (const id of [1, 2, 3, 4, 5, 6]) {
        assert(`element ${id} has name+token`, !!ELEM[id]?.name && /^var\(--el-/.test(ELEM[id]?.c));
    }
}

// ── filterResonators ──────────────────────────────────────────────────────────
{
    assert('no filters -> all resonators', filterResonators(resonators, {}).length === resonators.length);
    assert('default arg -> all resonators', filterResonators(resonators).length === resonators.length);

    // Search is case-insensitive substring on name.
    const sample = resonators[0].name.slice(0, 3).toLowerCase();
    const searched = filterResonators(resonators, { search: sample.toUpperCase() });
    assert('search is case-insensitive', searched.length > 0 && searched.every(r => r.name.toLowerCase().includes(sample)));
    assert('impossible search -> empty', filterResonators(resonators, { search: '___nope___' }).length === 0);

    // Element filter (OR within selElements).
    const glacio = filterResonators(resonators, { selElements: [1] });
    assert('element filter keeps only that element', glacio.length > 0 && glacio.every(r => r.element === 1));
    const glacioOrFusion = filterResonators(resonators, { selElements: [1, 2] });
    assert('element filter ORs multiple selections', glacioOrFusion.length >= glacio.length
        && glacioOrFusion.every(r => r.element === 1 || r.element === 2));

    // Weapon filter.
    const someWeaponId = resonators[0].weaponType;
    const byWeapon = filterResonators(resonators, { selWeapons: [someWeaponId] });
    assert('weapon filter keeps only that weapon type', byWeapon.length > 0 && byWeapon.every(r => r.weaponType === someWeaponId));

    // Rarity filter.
    const fiveStar = filterResonators(resonators, { selRarities: [5] });
    assert('rarity filter keeps only 5-star', fiveStar.length > 0 && fiveStar.every(r => r.rarity === 5));

    // AND-combination across dimensions.
    const both = filterResonators(resonators, { selElements: [1], selRarities: [5] });
    assert('filters AND-combine across dimensions', both.every(r => r.element === 1 && r.rarity === 5));
    assert('AND result subset of each single filter', both.length <= glacio.length && both.length <= fiveStar.length);
}

// ── sortResonators ────────────────────────────────────────────────────────────
{
    const byRarity = sortResonators(resonators, 'rarity', elemMap);
    assert('rarity sort: 5-star before 4-star', byRarity[0].rarity >= byRarity[byRarity.length - 1].rarity);
    let rarityOk = true;
    for (let i = 1; i < byRarity.length; i++) if (byRarity[i - 1].rarity < byRarity[i].rarity) rarityOk = false;
    assert('rarity sort fully descending', rarityOk);

    const byName = sortResonators(resonators, 'name', elemMap);
    let nameOk = true;
    for (let i = 1; i < byName.length; i++) if (byName[i - 1].name.localeCompare(byName[i].name) > 0) nameOk = false;
    assert('name sort alphabetical', nameOk);

    const byElement = sortResonators(resonators, 'element', elemMap);
    let elementOk = true;
    for (let i = 1; i < byElement.length; i++) {
        const na = elemMap[byElement[i - 1].element]?.name ?? '';
        const nb = elemMap[byElement[i].element]?.name ?? '';
        if (na.localeCompare(nb) > 0) elementOk = false;
    }
    assert('element sort groups by element name', elementOk);

    assert('sort does not mutate the input array', resonators === d.resonators && sortResonators(resonators, 'name', elemMap) !== resonators);
}

// ── Render smoke test (fake DOM, real data) ──────────────────────────────────
{
    let lastHTML = '';
    const clickHandlers = [];
    const inputHandlers = [];
    const regions = new Map(); // selector -> stub node, so querySelector returns a stable object
    function regionStub() {
        const node = { innerHTML: '' };
        return node;
    }
    const stub = () => ({
        innerHTML: '', style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        appendChild() {}, addEventListener() {},
        querySelector(sel) {
            if (!regions.has(sel)) regions.set(sel, regionStub());
            return regions.get(sel);
        },
        querySelectorAll() { return []; },
        contains() { return true; },
    });
    const hostNode = stub();
    Object.defineProperty(hostNode, 'innerHTML', {
        get() { return lastHTML; },
        set(v) { lastHTML = v; regions.clear(); },
    });
    hostNode.contains = () => true;
    hostNode.addEventListener = (type, cb) => {
        if (type === 'click') clickHandlers.push(cb);
        if (type === 'input') inputHandlers.push(cb);
    };

    globalThis.window = { innerWidth: 1200, innerHeight: 800 };
    globalThis.document = { createElement: () => stub(), body: { classList: { toggle() {} }, appendChild() {} } };

    let threw = false;
    let api;
    try {
        api = mount(hostNode, { dataset: d, theme: 'dark' });
    } catch (e) { threw = true; console.error('    mount() threw:', e.message, e.stack); }

    assert('mount renders without throwing', !threw);
    assert('header shows the roster tab', lastHTML.includes('WUWA') && lastHTML.includes('ROSTER'));
    assert('title row present', lastHTML.includes('RESONATOR ROSTER'));
    assert('count label reflects all resonators', lastHTML.includes(`/ ${resonators.length} RESONATORS`));
    assert('filter labels present', lastHTML.includes('ELEMENT') && lastHTML.includes('WEAPON') && lastHTML.includes('RARITY'));
    assert('sort chips present', lastHTML.includes('data-act="sort"'));
    assert('search input present', lastHTML.includes('data-act="search"'));
    assert('no CLEAR FILTERS button when no filters active', !lastHTML.includes('CLEAR FILTERS'));
    assert('renders a card per resonator by default', resonators.every(r => lastHTML.includes(r.name)));
    assert('mount returns an update() handle', typeof api?.update === 'function');

    // Element filter click -> re-render with fewer cards + CLEAR FILTERS shown.
    let clickThrew = false;
    try {
        for (const cb of clickHandlers) cb({ target: { closest: (sel) => (sel === '[data-act="elem"]' ? { dataset: { val: '1' } } : null) }, stopPropagation() {} });
    } catch (e) { clickThrew = true; console.error('    elem-click threw:', e.message); }
    assert('element-chip click re-renders without throwing', !clickThrew);
    const glacioCount = resonators.filter(r => r.element === 1).length;
    assert('element filter narrows the count label', lastHTML.includes(`${glacioCount} / ${resonators.length} RESONATORS`));
    assert('CLEAR FILTERS appears once a filter is active', lastHTML.includes('CLEAR FILTERS'));

    // Clear filters -> back to full roster, no CLEAR FILTERS button.
    let clearThrew = false;
    try {
        for (const cb of clickHandlers) cb({ target: { closest: (sel) => (sel === '[data-act="clear"]' ? {} : null) }, stopPropagation() {} });
    } catch (e) { clearThrew = true; console.error('    clear-click threw:', e.message); }
    assert('clear-filters click does not throw', !clearThrew);
    assert('clear resets to the full roster count', lastHTML.includes(`/ ${resonators.length} RESONATORS`));
    assert('CLEAR FILTERS hidden again after clearing', !lastHTML.includes('CLEAR FILTERS'));

    // Search input -> partial refresh (must not throw, and must not replace the
    // whole page — refreshResults() only touches the count/grid regions so the
    // input itself never loses focus mid-keystroke).
    let searchThrew = false;
    const beforeSearch = lastHTML;
    try {
        for (const cb of inputHandlers) {
            cb({ target: { closest: (sel) => (sel === '[data-act="search"]' ? { value: resonators[0].name } : null), value: resonators[0].name } });
        }
    } catch (e) { searchThrew = true; console.error('    search-input threw:', e.message); }
    assert('search input handler runs without throwing', !searchThrew);
    assert('search input does not trigger a full page re-render', lastHTML === beforeSearch);
}

console.log(`\nroster-v2: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
