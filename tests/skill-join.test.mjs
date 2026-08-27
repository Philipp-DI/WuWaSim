/**
 * Tests for data/skill-join.json — the DT_SkillInfo skill id -> rotation-step
 * key bridge (tools/extract/build-skill-join.mjs) and the id primitive it
 * shares with map-timings.mjs (tools/extract/skill-row-id.mjs).
 *
 *   node tests/skill-join.test.mjs
 *
 * The generator needs data/timing-data.json, which is gitignored — so these
 * tests read the COMMITTED output, exactly as the sim will. They check three
 * things the join must never get wrong:
 *
 *  1. Every key it names is a real autoSkillMap key. A join that resolves to a
 *     key nothing can cast is worse than a refusal, because it looks resolved.
 *  2. The anchors the routes were verified against still hold — in particular
 *     Lupa's 1207513/1207612, which the montage route SWAPS and the damage-id
 *     route separates by exact id.
 *  3. `genre` is not a skillType. The table records DT_SkillInfo's own
 *     SkillGenre for provenance; its ordinals are not the damage-type tag's,
 *     and it restates the LABEL, not the mechanic. The impurity is asserted
 *     rather than assumed away, so a future reader cannot quietly promote it.
 */
import { readFileSync } from 'node:fs';
import { resolveSkillId } from '../tools/extract/skill-row-id.mjs';

const join = JSON.parse(readFileSync(new URL('../data/skill-join.json', import.meta.url), 'utf8'));
const dataset = JSON.parse(readFileSync(new URL('../data/wuwa-data.json', import.meta.url), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const ROUTES = ['damageId', 'montage', 'genreSingleton'];
const entries = [];
for (const [rid, rows] of Object.entries(join.resonators))
    for (const [skillId, entry] of Object.entries(rows)) entries.push({ rid, skillId, ...entry });

// ── Shape ──────────────────────────────────────────────────────────────────
{
    assert('every entry names at least one key', entries.every(entry => entry.keys?.length > 0));
    assert('every entry carries a known route', entries.every(entry => ROUTES.includes(entry.route)));
    assert('coverage.resolved matches the entry count', join.coverage.resolved === entries.length);
    const byRoute = {};
    for (const entry of entries) byRoute[entry.route] = (byRoute[entry.route] ?? 0) + 1;
    assert('coverage.byRoute matches the entries', ROUTES.every(route => (byRoute[route] ?? 0) === join.coverage.byRoute[route]));
}

// ── Every key resolves ─────────────────────────────────────────────────────
{
    const orphans = [];
    for (const entry of entries)
        for (const key of entry.keys)
            if (!dataset.autoSkillMap?.[entry.rid]?.[key]) orphans.push(`${entry.rid}:${entry.skillId} -> ${key}`);
    assert(`every joined key exists in autoSkillMap (${orphans.length} orphans)`, orphans.length === 0);
    if (orphans.length) console.error('    ', orphans.slice(0, 5).join(', '));
}

// ── The anchors the routes were verified against ───────────────────────────
{
    const keyOf = (rid, skillId) => join.resonators[rid]?.[skillId]?.keys ?? [];
    const routeOf = (rid, skillId) => join.resonators[rid]?.[skillId]?.route;

    // Chisa: her Eradication damage id IS her row id + hit index.
    assert('1508404 -> forte_heavy_sawring_eradication by damage id',
        keyOf('1508', '1508404').join() === 'forte_heavy_sawring_eradication' && routeOf('1508', '1508404') === 'damageId');
    assert('1508500 -> liberation by damage id',
        keyOf('1508', '1508500').join() === 'liberation' && routeOf('1508', '1508500') === 'damageId');
    // ...but her Intro's gauge grant sits in the OTHER id space (1508600 vs
    // damage 1508008xxx), which is the whole reason this table exists.
    assert('1508600 -> intro, and only the montage route reaches it',
        keyOf('1508', '1508600').join() === 'intro' && routeOf('1508', '1508600') === 'montage');

    // Lupa: the montage route swaps these two; exact ids separate them.
    assert('1207513 -> dance_with_the_wolf_climax (NOT swapped)',
        keyOf('1207', '1207513').join() === 'forte_heavy_dance_with_the_wolf_climax');
    assert('1207612 -> dance_with_the_wolf (NOT swapped)',
        keyOf('1207', '1207612').join() === 'forte_heavy_dance_with_the_wolf');

    // Denia's two forms have their own Intro each — a skillType is a KIND, not
    // a KEY, and the join must not collapse them onto one.
    assert('1211061 (form 1 QTE) -> intro_it_s_been_a_while', keyOf('1211', '1211061').join() === 'intro_it_s_been_a_while');
    assert('1211062 (form 2 QTE) -> intro_knock_knock', keyOf('1211', '1211062').join() === 'intro_knock_knock');
    assert('Denia\'s two Intro rows resolve to different keys',
        keyOf('1211', '1211061').join() !== keyOf('1211', '1211062').join());
}

// ── genre is provenance, never a skillType ─────────────────────────────────
{
    const skillTypesFor = genre => {
        const types = new Set();
        for (const entry of entries.filter(entry => entry.genre === genre))
            for (const key of entry.keys) {
                const type = dataset.autoSkillMap?.[entry.rid]?.[key]?.skillType;
                if (type) types.add(type);
            }
        return types;
    };
    // If these ever collapse to one member, genre WOULD be a type — and this
    // test should be revisited deliberately, not silently satisfied.
    assert('genre "basic" spans several mechanical skillTypes', skillTypesFor('basic').size > 1);
    assert('genre "skill" spans several mechanical skillTypes', skillTypesFor('skill').size > 1);
    assert('genre "intro" is the clean bucket but still not exclusive', skillTypesFor('intro').has('intro'));
    // The ordinals differ from the damage-type tag's from 2 on. Reading one as
    // the other swaps skill and liberation.
    assert('SkillGenre 2 is skill and 3 is liberation (NOT the damage-type order)',
        join.genreCategories['2'] === 'skill' && join.genreCategories['3'] === 'liberation');
}

// ── The shared id primitive ────────────────────────────────────────────────
{
    const rows = new Set(['1508404', '1508500', '120201']);
    assert('longest prefix wins over a shorter one', resolveSkillId('15084040010', rows) === '1508404');
    assert('a damage id with no owning row is refused', resolveSkillId('1508008001', rows) === null);
    // Chixia files her rows with a bare, unpadded skill index.
    assert('the de-zero-padded retry recovers Chixia-shaped ids', resolveSkillId('1202001001', rows) === '120201');
}

// ── Coverage ratchet ───────────────────────────────────────────────────────
{
    // The consumer that exists today. These may only improve: a drop means a
    // route regressed or an input moved, both of which must be looked at.
    assert('gauge-income cast rows resolved >= 165', join.coverage.gaugeIncomeResolved >= 165);
    assert('gauge-income rows resolved to a single key >= 146', join.coverage.gaugeIncomeUniqueKey >= 146);
    assert('damage-id route resolves >= 713 rows', join.coverage.byRoute.damageId >= 713);
}

console.log(`\nskill-join: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
