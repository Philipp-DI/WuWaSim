/**
 * Gauge income/expenditure extraction, 2026-08-12.
 *
 * `data/gauge-income.json` (tools/extract/extract_gauge_income.py) joins the
 * game's own tables — DT_SkillInfo rows -> SkillBuff/SkillStartBuff/SkillEndBuff
 * -> db_buff GameAttributeID — to say which cast moves which gauge, by how much.
 * It retires the standing assumption in rotation-rules.js that a named stack
 * gauge's INCOME is unreadable and must be curated from kit text.
 *
 * What this file pins is the JOIN, because the join is the whole claim. Three
 * independent things have to keep agreeing, and any one of them breaking means
 * the extraction has drifted from the game:
 *
 *   1. the extracted cap channel vs the game's own SpecialEnergy{N}Max
 *      (`resonator.specialEnergyCaps`, a different dump entirely);
 *   2. the extracted per-cast amounts vs what the kit text says in English;
 *   3. the extracted spends vs the hand-curated RESOURCE_DEFS that predate it.
 *
 * Denia is the worked case: three gauges, three caps and three grant amounts,
 * all stated in her kit and all reproduced to the digit with no text parsing.
 *
 *   node tests/gauge-income.test.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { RESOURCE_DEFS } from '../src/core/rotation-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(resolve(__dirname, '../data/', name), 'utf8'));
const gauge = read('gauge-income.json');
const dataset = read('wuwa-data.json');

let failed = 0;
function assert(name, cond) {
    if (cond) { console.log(`  ok   ${name}`); } else { console.log(`  FAIL ${name}`); failed++; }
}

const castMoves = (id) => gauge.resonators?.[String(id)]?.cast ?? [];
const resonatorOf = (id) => dataset.resonators.find(entry => entry.id === id);

// ── The file is present, shaped, and did not silently half-run ───────────────
{
    assert('every combat table parsed or is a known non-combat placeholder',
        gauge.source.failed.every(entry => /TestModel|story/i.test(entry.table)));
    assert('the roster is broadly covered (>= 50 resonators)',
        Object.keys(gauge.resonators).length >= 50);

    const rosterIds = new Set(dataset.resonators.map(entry => String(entry.id)));
    // The extraction walks the Role tree, which also holds resonators the
    // dataset does not ship yet. Those are legitimate; anything NOT shaped like
    // a resonator id would mean the monster/echo id space leaked in.
    const strays = Object.keys(gauge.resonators).filter(id => !rosterIds.has(id) && !/^1[1-6]\d{2}$/.test(id));
    assert(`no non-resonator id space leaked in (${strays.join(', ') || 'none'})`, strays.length === 0);
}

// ── A CEILING is never read as income ───────────────────────────────────────
// SpecialEnergy{N}Max and EnergyMax are caps. Summing one as a gain would
// silently hand a resonator a gauge the size of its own maximum, per cast.
{
    let capsMistakenForIncome = 0;
    for (const entry of Object.values(gauge.resonators)) {
        for (const move of [...entry.cast, ...entry.trigger]) {
            if (move.isCap && move.effect.kind === 'add') capsMistakenForIncome++;
        }
    }
    assert('no cap-raising grant is classified as flat income', capsMistakenForIncome === 0);
}

// ── Denia: three gauges, cross-validated against two other sources ──────────
// Kit text, verbatim:
//   "Denia can hold up to 3 [Dark Cores]." / "Denia obtains 1 upon casting
//    Intro Skill [It's Been A While!] and Intro Skill [Knock Knock]."
//   "Denia can hold up to 100 of [Void Particle]." / "Casting Intro Skill [...],
//    Intro Skill [...] or Resonance Skill [Phantom Bubble - Stagecraft Form]
//    grants 25 of [Void Particle]."
//   "Denia can hold up to 100 points of [Conformal Charge]." / "Casting
//    Resonance Skill [Banish - Breakdown Form Stage 2] grants 40."
{
    const caps = resonatorOf(1211)?.specialEnergyCaps ?? {};
    const denia = castMoves(1211);
    const income = (channel) => denia
        .filter(move => move.channel === channel && !move.isCap && move.effect.kind === 'add')
        .map(move => move.effect.amount);

    assert('Dark Core is SpecialEnergy2, cap 3 in the game\'s own table', Number(caps[2]) === 3);
    assert('Void Particle is SpecialEnergy1, cap 100', Number(caps[1]) === 100);
    assert('Conformal Charge is SpecialEnergy3, cap 100', Number(caps[3]) === 100);

    const darkCore = income(2);
    assert(`Dark Core is granted +1 per cast, twice (${darkCore.join('/')})`,
        darkCore.length === 2 && darkCore.every(amount => amount === 1));
    // Both grants sit on a QTE row — the game's name for an Intro Skill — and
    // she has two because she has two forms, exactly as the kit states.
    const introRows = denia.filter(move => move.channel === 2 && move.effect.kind === 'add');
    assert('both Dark Core grants are on a QTE (Intro Skill) row',
        introRows.length === 2 && introRows.every(move => /QTE/.test(move.skillName ?? '')));

    assert(`Void Particle is granted +25 (${income(1).join('/')})`,
        income(1).length === 3 && income(1).every(amount => amount === 25));
    assert(`Conformal Charge is granted +40 (${income(3).join('/')})`,
        income(3).length === 1 && income(3)[0] === 40);
}

// ── The spend side agrees with the curated definitions that predate it ───────
// Sigrika's Full Stop was curated as `cap: 100` + spendAll long before any of
// this was readable. Two independent confirmations of that one guess: her
// SpecialEnergy2Max is 100, and the cast the kit calls the spender removes
// exactly 100 of it.
//
// Note the ENCODING: this is a flat `add` of -100 (CalculationPolicy 0), not one
// of the three spendAll shapes. Draining a gauge by its own full size and
// annihilating it are the same outcome and the game writes both, so a reader
// that only looked for `spendAll` would miss half the roster's spends.
{
    const fullStop = RESOURCE_DEFS[1412]?.[0];
    const caps = resonatorOf(1412)?.specialEnergyCaps ?? {};
    const drains = castMoves(1412).filter(move => move.channel === 2 && !move.isCap
        && ((move.effect.kind === 'add' && move.effect.amount < 0) || move.effect.kind === 'spendAll'));
    assert(`Sigrika: the game removes SpecialEnergy2 on a cast (${drains.length} rows)`,
        drains.length > 0);
    assert(`Sigrika: the amount removed is her whole gauge (-${caps[2]})`,
        drains.some(move => move.effect.kind === 'spendAll'
            || move.effect.amount === -Number(caps[2])));
    assert(`Sigrika: curated Full Stop cap ${fullStop?.cap} == SpecialEnergy2Max ${caps[2]}`,
        Number(fullStop?.cap) === Number(caps[2]));
    assert('Sigrika: her curated spendAll is a real cast', (fullStop?.spendAll ?? []).length > 0);
}

// ── Changli: the cast lane is EMPTY, and that is the point ───────────────────
// Her Enflamement is earned "on hit", not on cast, so it cannot appear here.
// This is what bounds the extraction's claim: it reads the CAST lane only, and
// a gauge with no cast income legitimately shows nothing. Asserting it keeps a
// future widening of the extractor from quietly inventing income for her.
{
    const enflamement = RESOURCE_DEFS[1205]?.[0];
    const changli = castMoves(1205);
    const income = changli.filter(move => move.channel === enflamement?.channel
        && !move.isCap && move.effect.kind === 'add' && move.effect.amount > 0);
    assert('Changli has no CAST-lane income for Enflamement (it is earned on hit)',
        income.length === 0);
    assert('Changli\'s curated gains are still the only source for it',
        Object.keys(enflamement?.gains ?? {}).length > 0);
}

// ── Every classified effect is one the client's own switch defines ───────────
// classify() mirrors ActiveBuff.ModifyStateAttribute. An `unknown` is allowed —
// it is the honest answer for a shape this reader cannot name — but it must stay
// rare, or the mirror has drifted from the client.
{
    const kinds = new Map();
    let total = 0;
    for (const entry of Object.values(gauge.resonators)) {
        for (const move of [...entry.cast, ...entry.trigger]) {
            kinds.set(move.effect.kind, (kinds.get(move.effect.kind) ?? 0) + 1);
            total++;
        }
    }
    const known = ['add', 'spendAll', 'scaleBase', 'addFraction', 'set'];
    const unknown = kinds.get('unknown') ?? 0;
    assert(`every effect kind is named or explicitly unknown (${[...kinds].map(([k, n]) => `${k}:${n}`).join(' ')})`,
        [...kinds.keys()].every(kind => known.includes(kind) || kind === 'unknown'));
    assert(`unknown shapes stay a small minority (${unknown}/${total})`, unknown * 5 < total);
}

console.log(`gauge-income: ${failed === 0 ? 'all passed' : failed + ' failed'}`);
process.exit(failed === 0 ? 0 : 1);
