/**
 * Live stat weights — per-build perturbation + echo upgrade ranking.
 *
 *   node tests/live-weights.test.mjs
 *
 * Runs against real wuwa-data.json + a real rotation, so the perturbation
 * exercises the actual sim (CLAUDE.md policy).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { liveSubstatValues, echoUpgradeRanking, substatKeyOf } from '../src/core/live-weights.js';
import { createBuild, setWeapon, setEcho } from '../src/core/build.js';
import { PROP } from '../src/core/stats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-meta.json'), 'utf8'));
d.statRanges = JSON.parse(readFileSync(resolve(__dirname, '../data/stat-ranges.json'), 'utf8'))?.stat_ranges ?? {};
const resoOf = (id) => d.resonators.find(r => r.id === id);

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Build a realistic Carlotta with a "junk" echo in slot 1 (HP%/DEF%/flat ATK).
function carlottaBuild() {
    let b = setWeapon(createBuild(resoOf(1107)), 21030036);
    const rot = meta.characters['1107'].referenceRotation;
    b = { ...b, rotation: rot, rotationMeta: rot.map(() => ({})) };
    const main = (cost, propId, value, addType = 1) => ({ propId, addType, value, isPercent: true });
    const sub = (propId, addType, value) => ({ propId, addType, value, isPercent: true });
    const echoes = [
        { cost: 4, main: main(4, PROP.CRIT_DMG, 44), subs: [sub(PROP.CRIT_RATE, 1, 7.8), sub(PROP.CRIT_DMG, 1, 15.6), sub(PROP.ATK_RATIO, 2, 9), sub(PROP.ENERGY_REGEN, 1, 9.2)] },
        { cost: 3, main: main(3, 22, 30), subs: [sub(PROP.HP_RATIO, 2, 9), sub(PROP.DEF_RATIO, 2, 9), sub(PROP.ATK_FLAT, 1, 40), sub(PROP.ENERGY_REGEN, 1, 9.2)] }, // junk
        { cost: 3, main: main(3, PROP.ATK_RATIO, 30, 2), subs: [sub(PROP.CRIT_RATE, 1, 7.8), sub(PROP.CRIT_DMG, 1, 15.6), sub(PROP.DMG_SKILL, 1, 9)] },
        { cost: 1, main: main(1, PROP.ATK_RATIO, 18, 2), subs: [sub(PROP.CRIT_DMG, 1, 15.6), sub(PROP.ATK_RATIO, 2, 9)] },
        { cost: 1, main: main(1, PROP.ATK_RATIO, 18, 2), subs: [sub(PROP.CRIT_RATE, 1, 7.8)] },
    ];
    echoes.forEach((e, i) => { b = setEcho(b, i, { id: null, cost: e.cost, level: 25, sonataId: 1, mainStat: e.main, subStats: e.subs }); });
    return b;
}

// ── liveSubstatValues: ranked per-roll damage gains at the user's stats ───────
{
    const b = carlottaBuild();
    const live = liveSubstatValues(b, d);
    assert('returns a value set for a simmable build', live && Array.isArray(live.values) && live.values.length > 0);
    assert('values are normalized to a top of 100', Math.abs(live.values[0].normalized - 100) < 1e-6);
    assert('values are sorted descending by gain', live.values.every((v, i) => i === 0 || live.values[i - 1].gain >= v.gain));
    assert('every value carries a label + a non-negative gain', live.values.every(v => typeof v.label === 'string' && v.gain >= 0));
    // Carlotta is a Skill carry → Resonance Skill DMG should carry real value.
    assert('Resonance Skill DMG is among the live values', live.values.some(v => v.key === 'dmgBonus.skill'));
    assert('Crit Rate and Crit DMG both valued', live.values.some(v => v.key === 'critRate' && v.gain > 0) && live.values.some(v => v.key === 'critDmg' && v.gain > 0));

    // EVERY rollable stat is reported, worth-nothing ones included: a row that
    // vanishes is indistinguishable from a failed computation, which is how a
    // correct zero reads as a bug (2026-07-31).
    const ROLLABLE = ['critRate', 'critDmg', 'atkRatio', 'hpRatio', 'defRatio',
        'dmgBonus.basic', 'dmgBonus.heavy', 'dmgBonus.skill', 'dmgBonus.liberation', 'energyRegen'];
    assert('every rollable substat is reported, not just the valuable ones',
        ROLLABLE.every(key => live.values.some(value => value.key === key)));
    assert('worth-nothing stats carry a zeroReason and exactly 0',
        live.values.every(value => (value.gain > 0) === (value.zeroReason == null)) &&
        live.values.every(value => value.zeroReason == null || value.gain === 0));
    assert('zeroReason is one of the known codes',
        live.values.every(value => value.zeroReason == null || value.zeroReason === 'critCap' || value.zeroReason === 'noScaling'));
    assert('critCapped share is a fraction', live.critCapped >= 0 && live.critCapped <= 1);
    // This build is nowhere near the cap, so Crit Rate must be a real value.
    assert('uncapped build → Crit Rate has real value, no critCap reason',
        live.values.find(value => value.key === 'critRate')?.zeroReason == null);

    assert('a build with a working rotation is measured on it',
        live.measure === 'rotation' && live.assumedEcho === false);
}

// ── An empty or broken rotation is ranked against the KIT ────────────────────
// A stat's per-roll value can only be read off something being cast, so the old
// gate returned null for a build with no rotation — blank panel exactly when a
// new build most needs the guidance. Maintainer-directed 2026-07-31: fall back
// to the resonator's own kit, ranked by average damage per hit — the same
// reading the build page's top strip shows as OVERALL AVG.
{
    // No rotation at all.
    const noRotation = { ...carlottaBuild(), rotation: [], rotationMeta: [] };
    const onKit = liveSubstatValues(noRotation, d);
    assert('an empty rotation still ranks', onKit != null);
    assert('and says it was measured on the kit', onKit.measure === 'kit');
    assert("while the echoes are the user's own", onKit.assumedEcho === false);
    assert('the ranking is real, not all zeroes', onKit.values.some(value => value.gain > 0));

    // The kit base IS the top strip's OVERALL AVG: mean expected damage per hit
    // instance over every curated ability, so it must sit in per-HIT territory,
    // far below a whole rotation's total.
    const rotationBase = liveSubstatValues(carlottaBuild(), d).base;
    assert('the kit base is a per-hit average, not a rotation total', onKit.base < rotationBase / 10);
    assert('and it is a real number', onKit.base > 0 && Number.isFinite(onKit.base));

    // A "flawed" rotation — steps that resolve to nothing — takes the same path,
    // because the test is whether the rotation DEALS DAMAGE, not whether it
    // parses.
    const broken = { ...carlottaBuild(), rotation: ['__nonexistent_step__'], rotationMeta: [{}] };
    assert('a rotation that deals no damage falls back too',
        liveSubstatValues(broken, d)?.measure === 'kit');

    // The user's OWN rotation always wins when it produces damage, however messy.
    const messy = { ...carlottaBuild(), rotation: ['skill', '__nonexistent_step__'], rotationMeta: [{}, {}] };
    assert('a partly-broken rotation that still deals damage is kept',
        liveSubstatValues(messy, d)?.measure === 'rotation');

    // No echoes: seed one bare slot so the perturbation has somewhere to live.
    const noEchoes = { ...carlottaBuild(), echoes: [null, null, null, null, null] };
    const seeded = liveSubstatValues(noEchoes, d);
    assert('no echoes still ranks, on a seeded empty slot', seeded != null);
    assert('and says the echo was assumed', seeded.assumedEcho === true);
    assert('with the rotation still the measure', seeded.measure === 'rotation');

    // A blank build needs both stand-ins and must report both.
    const fromBoth = liveSubstatValues(createBuild(resoOf(1107)), d);
    assert('a blank build still ranks', fromBoth != null);
    assert('reporting kit measure AND the assumed echo',
        fromBoth.measure === 'kit' && fromBoth.assumedEcho === true);
    assert('with a usable ranking', fromBoth.values.filter(value => value.gain > 0).length >= 3);

    // No curation needed, so the three resonators with no reference rotation
    // (Suisui, Rover: Electro, Yangyang: Xuanling) rank like everyone else.
    for (const name of ['Suisui', 'Rover: Electro', 'Yangyang: Xuanling']) {
        const resonator = d.resonators.find(candidate => candidate.name === name);
        if (!resonator) continue;
        const ranked = liveSubstatValues(createBuild(resonator), d);
        assert(`${name} (no reference rotation) still ranks on its kit`,
            ranked?.measure === 'kit' && ranked.values.some(value => value.gain > 0));
    }
}

// ── The 100% Crit Rate cap is REPORTED, never a silent omission ──────────────
// The damage formula clamps crit rate at 1, so past the cap another roll buys
// exactly nothing. Dropping the row made a correct zero look like a broken
// panel — the maintainer hit this on a suggested build (2026-07-31).
{
    // Flood slot 0 with Crit Rate until every hit is capped.
    const flooded = carlottaBuild();
    const echoes = flooded.echoes.slice();
    echoes[0] = { ...echoes[0], subStats: [...(echoes[0].subStats ?? []), { propId: PROP.CRIT_RATE, addType: 1, value: 100, isPercent: true }] };

    const live = liveSubstatValues({ ...flooded, echoes }, d);
    const crit = live.values.find(value => value.key === 'critRate');
    assert('capped build still LISTS Crit Rate', crit != null);
    assert('capped Crit Rate is worth exactly 0', crit.gain === 0);
    assert('capped Crit Rate says why', crit.zeroReason === 'critCap');
    assert('critCapped reports the damage-weighted share', live.critCapped > 0.99);
    // Crit DMG is untouched by the crit-rate cap and must still rank.
    assert('Crit DMG still valued at the crit cap', live.values.find(value => value.key === 'critDmg')?.gain > 0);
    // The panel still has something to show — normalization survives the zeros.
    assert('a capped build still normalizes to a top of 100', Math.abs(live.values[0].normalized - 100) < 1e-6);
}

// ── Off-ATK scalers get their real scaling stat ranked ───────────────────────
// A kit scales off whatever `relatedProp` its damage rows name, and seven
// resonators are mostly or entirely off-ATK. SUBSTAT_SET used to list only ATK%,
// so Cartethyia — 100% HP-scaling — was shown ATK% at zero and no HP% row at
// all (maintainer-reported 2026-07-31).
{
    const scalerOf = (name) => d.resonators.find(resonator => resonator.name === name);

    const cartethyia = scalerOf('Cartethyia');
    const hpLive = liveSubstatValues(createBuild(cartethyia), d);
    const hpRow = hpLive.values.find(value => value.key === 'hpRatio');
    assert('Cartethyia ranks HP%', hpRow != null && hpRow.gain > 0);
    assert('and HP% is her TOP stat, above every DMG bonus', hpRow.normalized === 100);
    assert('while ATK% is reported as worth nothing, with a reason',
        hpLive.values.find(value => value.key === 'atkRatio')?.zeroReason === 'noScaling');
    assert('and DEF% likewise',
        hpLive.values.find(value => value.key === 'defRatio')?.zeroReason === 'noScaling');

    // DEF scalers are the same shape, and would have been missed by an
    // HP-only fix.
    for (const name of ['Taoqi', 'Yuanwu', 'Mornye']) {
        const resonator = scalerOf(name);
        if (!resonator) continue;
        const live = liveSubstatValues(createBuild(resonator), d);
        assert(`${name} ranks DEF% above ATK%`,
            live.values.find(value => value.key === 'defRatio')?.gain >
            live.values.find(value => value.key === 'atkRatio')?.gain);
    }
    for (const name of ['Shorekeeper', 'Suisui', 'Baizhi']) {
        const resonator = scalerOf(name);
        if (!resonator) continue;
        const live = liveSubstatValues(createBuild(resonator), d);
        assert(`${name} ranks HP% above ATK%`,
            live.values.find(value => value.key === 'hpRatio')?.gain >
            live.values.find(value => value.key === 'atkRatio')?.gain);
    }

    // And the converse still holds: on an ATK scaler the ratios that do nothing
    // report it, rather than being hardcoded as junk.
    const atkLive = liveSubstatValues(carlottaBuild(), d);
    assert('Carlotta still ranks ATK%', atkLive.values.find(value => value.key === 'atkRatio')?.gain > 0);
    assert('and reports HP%/DEF% as measured zeroes',
        atkLive.values.find(value => value.key === 'hpRatio')?.zeroReason === 'noScaling' &&
        atkLive.values.find(value => value.key === 'defRatio')?.zeroReason === 'noScaling');
}

// ── echoUpgradeRanking: worst echo = the junk slot ───────────────────────────
{
    const b = carlottaBuild();
    const er = echoUpgradeRanking(b, d);
    assert('returns per-echo + worstSlot', er && Array.isArray(er.perEcho) && er.worstSlot != null);
    assert('worst echo is the HP/DEF/flat junk slot (1)', er.worstSlot === 1);
    // The junk echo has the most headroom; a fully-crit echo has less.
    const junk = er.perEcho[1], good = er.perEcho[2];
    assert('junk echo has more headroom than a crit echo', junk.headroom > good.headroom);
    assert('junk echo substats sum to ~zero value', junk.substatValue < good.substatValue);
}

// ── substatKeyOf maps real propIds ───────────────────────────────────────────
{
    assert('Crit Rate propId maps to critRate', substatKeyOf(PROP.CRIT_RATE) === 'critRate');
    assert('Crit DMG propId maps to critDmg', substatKeyOf(PROP.CRIT_DMG) === 'critDmg');
    assert('Skill DMG propId maps to dmgBonus.skill', substatKeyOf(PROP.DMG_SKILL) === 'dmgBonus.skill');
    // HP%/DEF% are REAL scaling stats, not off-stats — seven resonators scale
    // off them. Whether they're worth anything is measured per build, never
    // assumed by the propId map (2026-07-31).
    assert('HP% maps to hpRatio', substatKeyOf(PROP.HP_RATIO) === 'hpRatio');
    assert('DEF% maps to defRatio', substatKeyOf(PROP.DEF_RATIO) === 'defRatio');
    assert('a flat roll is still an off-stat', substatKeyOf(PROP.ATK_FLAT) === null);
}

console.log(`\nlive-weights: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
