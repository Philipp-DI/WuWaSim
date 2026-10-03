/**
 * A negative status's own damage is not the wielder's (2026-10-03).
 *
 *   node tests/status-grant.test.mjs
 *
 * "Glacio Chafe DMG", "Fusion Burst DMG", "Aero Erosion DMG" and the rest open
 * with an element or a mechanic but name the STATUS, whose damage has its own
 * formula — no crit, no gear stat (`enemy-status.js`). A clause granting to one is
 * not a wielder buff, and reading it as one INFLATES.
 *
 * MEASURED, by stripping the single effect: Denia's S6 "The Fusion Burst DMG
 * triggered gains a 200% DMG Multiplier increase against the main target" shipped
 * as an UNSCOPED `multiplierUp` of 2.0 with `window: always`, applying to her
 * ENTIRE kit — **85,304 -> 49,104 on her own reference rotation in Fusion Burst
 * mode, a ×1.737 inflation**. Aemeath's Tune Rupture clause was +1.05% at S2.
 * Denia has no `AFFLICTION_TRIGGERS` entry at all, so the +200% had nowhere
 * legitimate to live and leaked onto everything she throws.
 *
 * THE DISCRIMINATOR IS AN INVARIANT THE PROJECT ALREADY HAS. A status named
 * behind a DEALING verb is the TRIGGER, not the grant's subject — "A sentence's
 * leading TRIGGER is not the effect's SCOPE". The first draft of the detector
 * lacked that test and marked 11 clauses where only 8 are grants: three of the
 * eleven were Aemeath's own Crit DMG and amplify, granted "when Resonators in the
 * team ... deal Tune Rupture DMG", and skipping those would have DELETED live
 * wielder kit. That regression is what the negative cases below exist for.
 *
 * The status name must be followed IMMEDIATELY by "DMG", which keeps Denia's own
 * "60% Fusion DMG Bonus" — two lines above her Fusion Burst clause, in the same
 * node — out of it. The same rule the outro scope map already uses.
 *
 * SKIPPED, NOT DROPPED, and not yet ROUTED. `computeNegativeStatusDamage({
 * amplify })` exists for exactly this and has no producer (no caller passes it),
 * so the value is recorded on the effect and withheld from the wielder meanwhile.
 * That understates, which is the safe direction; paying it to the wielder was
 * inflation. Where it should eventually go differs per clause: Lucilla's amplifies
 * Glacio Chafe DMG AS A WHOLE, not only her own instances (maintainer,
 * 2026-10-03), so it belongs on the SHARED enemy timeline, while Denia's and
 * Aemeath's are DMG-MULTIPLIER increases on an affliction and belong in
 * `AFFLICTION_TRIGGERS` / `computeAfflictionDamage({ multiplier })`.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { statusGrantIn, NEGATIVE_STATUS_NAMES } from '../tools/preprocess/effects.mjs';
import { NEGATIVE_STATUS_DEFS } from '../src/core/enemy-status.js';
import { resolveChainInherentContext } from '../src/core/buffs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── The name table must not drift from the engine's own ─────────────────────
// A tools/ module does not import from src/core, so parity is asserted instead
// of trusted. A status the engine knows and this table does not would silently
// stop being detected.
{
    const mine = new Set(Object.values(NEGATIVE_STATUS_NAMES));
    const theirs = new Set(Object.keys(NEGATIVE_STATUS_DEFS));
    assert(`the tables hold the same statuses (${mine.size} vs ${theirs.size})`,
        mine.size === theirs.size && [...theirs].every(key => mine.has(key)));
}

// ── The detector, in both directions ───────────────────────────────────────
{
    const grants = [
        ['The Fusion Burst DMG triggered gains a 200% DMG Multiplier increase', 'fusion_burst'],
        ['Aero Erosion DMG is Amplified by 50% and the damage interval is decreased', 'aero_erosion'],
        ['Glacio Chafe DMG against targets within a certain range is Amplified by 80%', 'glacio_chafe'],
        ["Aemeath's Tune Rupture DMG can critically hit, with a fixed Crit. Rate of 80%", 'tune_rupture'],
        ['when the additional instances Tune Rupture DMG triggered by Seraphic Duet hit', 'tune_rupture'],
    ];
    for (const [text, want] of grants) {
        assert(`grant: ${want} <- ${text.slice(0, 54)}`, statusGrantIn(text) === want);
    }

    // NEGATIVE CASES. Each of the first two is a real clause whose live wielder
    // buff the over-broad first draft would have deleted.
    const notGrants = [
        'In Resonance Mode - Tune Rupture, when Resonators in the team deal Tune Rupture DMG, gain 60% Crit. DMG',
        'when Resonators in the team inflict Tune Rupture - Shifting or deal Tune Rupture DMG, gain 20% Crit. DMG',
        'While in Entropy Shift states, gain 60% ATK increase and 60% Fusion DMG Bonus.',
        'gain 30% Fusion DMG Bonus',
        'Glacio DMG Bonus is increased by 20%',
        'After dealing Aero Erosion DMG, gain 10% ATK',
    ];
    for (const text of notGrants) {
        assert(`not a grant: ${text.slice(0, 58)}`, statusGrantIn(text) === null);
    }
    assert('an empty clause is not a grant', statusGrantIn('') === null && statusGrantIn(null) === null);
}

// ── The population, and that no plain WIELDER stat is among it ──────────────
const marked = [];
for (const resonator of dataset.resonators) {
    for (const nodes of [resonator.resonanceChain, resonator.inherentSkills, resonator.skillNodeEffects]) {
        for (const node of nodes ?? []) {
            for (const effect of node.effects ?? []) {
                if (effect.statusGrant) marked.push({ resonator, effect });
            }
        }
    }
}
{
    assert(`eight clauses on the roster grant to a status's own damage (found ${marked.length})`,
        marked.length === 8);
    assert('across Lucilla, Aemeath, Denia and Cartethyia',
        JSON.stringify([...new Set(marked.map(entry => entry.resonator.id))].sort()) === '[1109,1210,1211,1409]');
    // Every marked status must be one the engine models, or the skip hides a
    // value that nothing will ever pay.
    assert('every marked status is one enemy-status.js defines',
        marked.every(entry => NEGATIVE_STATUS_DEFS[entry.effect.statusGrant]));
    // THE REGRESSION GUARD. A plain wielder stat must never be marked: that is
    // the shape the over-broad draft produced, and it DELETES live kit.
    const WIELDER_STATS = new Set(['critRate', 'critDmg', 'atkRatio', 'dmgBonus',
        'elementBonus', 'skillTypeBonus', 'healingBonus', 'deepen']);
    const wrong = marked.filter(entry => WIELDER_STATS.has(entry.effect.stat));
    assert(`no plain wielder stat is marked (${wrong.map(w => `${w.resonator.id}:${w.effect.stat}`).join(', ') || 'none'})`,
        wrong.length === 0);
    // Aemeath's three wielder grants specifically — the ones the over-broad draft
    // marked, and would therefore have deleted. Identified by stat+value rather
    // than by matching their clause text: `condition` is truncated to 120 chars
    // and two of the three are cut off BEFORE the words "deal Tune Rupture DMG",
    // which is the same truncation `bindSkillScopes` has to work around.
    const aemeath = dataset.resonators.find(entry => entry.id === 1210);
    const aemeathEffects = [...(aemeath.resonanceChain ?? []), ...(aemeath.inherentSkills ?? [])]
        .flatMap(node => node.effects ?? []);
    const wielderGrants = [['critDmg', 0.6], ['amplify', 0.25], ['critDmg', 0.2]]
        .map(([stat, value]) => aemeathEffects.find(effect =>
            effect.stat === stat && Math.abs(effect.value - value) < 1e-9));
    assert('her three trigger-shaped wielder grants all still exist',
        wielderGrants.every(Boolean));
    assert('and NOT ONE of them is marked as a status grant',
        wielderGrants.every(effect => effect && !effect.statusGrant));
    // At least one of them keeps the dealing verb inside the truncated condition,
    // which is the shape the detector's negative test is built on.
    assert('at least one shows the dealing verb within its stored condition',
        aemeathEffects.some(effect => /deal\s+Tune Rupture DMG/i.test(effect.condition ?? '')
            && !effect.statusGrant));
}

// ── The consumer withholds them from the wielder ────────────────────────────
{
    const hit = { element: 2, skillType: 'skill', skillKey: 'skill_x' };
    const plain = { stat: 'multiplierUp', value: 2, element: null, skillType: null };
    assert('an unscoped multiplierUp DOES apply, so the control is valid',
        Math.abs(resolveChainInherentContext([plain], hit).multiplierUp - 2) < 1e-9);
    assert('marked as a status grant it applies NOTHING',
        resolveChainInherentContext([{ ...plain, statusGrant: 'fusion_burst' }], hit).multiplierUp === 0);
    const resolved = resolveChainInherentContext([{ ...plain, statusGrant: 'fusion_burst' }], hit);
    assert('and reaches no other bucket', Object.values(resolved).every(value => value === 0));
    assert('a sibling wielder buff in the same list still applies',
        Math.abs(resolveChainInherentContext([{ ...plain, statusGrant: 'fusion_burst' }, plain], hit)
            .multiplierUp - 2) < 1e-9);
}

// ── Denia's clause specifically, since it was the live inflation ────────────
{
    const denia = dataset.resonators.find(entry => entry.id === 1211);
    const burst = (denia.resonanceChain[5].effects ?? [])
        .find(effect => effect.statusGrant === 'fusion_burst');
    assert('Denia S6 carries the Fusion Burst grant, marked', !!burst);
    assert('it is the +200% multiplier', burst && burst.stat === 'multiplierUp' && burst.value === 2);
    // It was UNSCOPED, which is why it multiplied her whole kit. The mark is what
    // holds it back now, so a future change that drops the mark must also scope it.
    assert('it is still unscoped, so the mark is the only thing holding it',
        !burst.skillKeys?.length && burst.skillType == null);
    assert('it has no AFFLICTION_TRIGGERS home yet, which is why it is withheld',
        burst.statusGrant === 'fusion_burst');
}

console.log(`\nstatus-grant: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
