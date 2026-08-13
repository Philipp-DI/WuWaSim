/**
 * External buff grants read from the game's own tables (data/external-buffs.json).
 *
 *   node tests/external-buffs.test.mjs
 *
 * What this pins, and why each one is worth a test:
 *
 *  1. The game's attribute ids ARE our PROP ids. The whole routing rests on it —
 *     if they ever diverge, every grant lands in the wrong bucket at once.
 *  2. A grant reachable from SEVERAL trigger paths appears ONCE. Everbright
 *     Polestar's DEF-ignore is added by two passives (one listening for Tune
 *     Rupture - Shifting, one for Fusion Burst); emitting per path would double
 *     it, and inflation is the failure mode that looks like nothing is wrong.
 *  3. The SCOPE survives. The weapon states "the wielder's Resonance Liberation
 *     DMG ignores 32% DEF" as a DamageTypes requirement; dropping it would credit
 *     the ignore to Basic Attacks and to the Tune Break response as well.
 *  4. `stackLimit` is part of the VALUE. Kumokiri's Liberation bonus is "8%,
 *     stacking up to 3 times" — 24% at cap, which is what the sim credits.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { PROP } from '../src/core/stats.js';
import {
    bucketForAttribute, foldExternalGrants, weaponExternalGrants, targetModApplies,
} from '../src/core/buffs/external-buffs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const names = dataset.externalBuffs?.attributeNames ?? {};

// ── 1. The game's attribute ids are our PROP ids ─────────────────────────────
{
    assert('attribute 7 is ATK (PROP.ATK_FLAT)', names[String(PROP.ATK_FLAT)] === 'Proto_Atk');
    assert('attribute 8 is Crit Rate (PROP.CRIT_RATE)', names[String(PROP.CRIT_RATE)] === 'Proto_Crit');
    assert('attribute 9 is Crit DMG (PROP.CRIT_DMG)', names[String(PROP.CRIT_DMG)] === 'Proto_CritDamage');
    assert('attribute 11 is Energy Regen (PROP.ENERGY_REGEN)',
        names[String(PROP.ENERGY_REGEN)] === 'Proto_EnergyEfficiency');
    assert('attribute 35 is Healing Bonus (PROP.HEALING_BONUS)',
        names[String(PROP.HEALING_BONUS)] === 'Proto_HealChange');
    // The element DMG bonuses sit at PROP.DMG_ELEMENT_BASE + elementId, the same
    // 22..27 = Glacio..Havoc mapping CLAUDE.md fixes for echo main stats.
    for (let element = 1; element <= 6; element++) {
        assert(`element ${element} DMG bonus is attribute ${PROP.DMG_ELEMENT_BASE + element}`,
            names[String(PROP.DMG_ELEMENT_BASE + element)] === `Proto_DamageChangeElement${element}`);
    }
    // The four skill-type ids are confirmed by the game's own substat names.
    const subName = (propId) => (dataset.echoSubStats ?? [])
        .find(stat => stat.propId === propId)?.name ?? null;
    assert('attribute 17 is the Basic Attack DMG substat', subName(PROP.DMG_BASIC) === 'Basic Attack DMG Bonus');
    assert('attribute 18 is the Heavy Attack DMG substat', subName(PROP.DMG_HEAVY) === 'Heavy Attack DMG Bonus');
    assert('attribute 14 is the Resonance Skill DMG substat', subName(PROP.DMG_SKILL) === 'Resonance Skill DMG Bonus');
    assert('attribute 19 is the Resonance Liberation DMG substat',
        subName(PROP.DMG_LIBERATION) === 'Resonance Liberation DMG Bonus');
}

// ── 2. Routing ───────────────────────────────────────────────────────────────
{
    assert('99 routes to defIgnore', bucketForAttribute(99).bucket === 'defIgnore');
    assert('23 routes to Fusion DMG bonus',
        bucketForAttribute(23).bucket === 'dmgByElement' && bucketForAttribute(23).key === 2);
    assert('30 routes to the target Fusion resistance',
        bucketForAttribute(30).bucket === 'resistanceByElement' && bucketForAttribute(30).key === 2);
    assert('19 routes to the liberation DMG type',
        bucketForAttribute(19).bucket === 'dmgBySkillType' && bucketForAttribute(19).key === 'liberation');
    assert('95 routes to the multiplicative amplify lane', bucketForAttribute(95).bucket === 'amplifyAll');
    // An attribute the damage pipeline does not model is a deliberate SKIP.
    assert('Proto_Energy (60) is not routed', bucketForAttribute(60) === null);
}

// ── 3. Everbright Polestar — dedupe, scope, and both grants present ──────────
{
    const grants = weaponExternalGrants(dataset, 21020076, 1) ?? [];
    assert('Everbright Polestar has exactly TWO grants at R1 (not four)', grants.length === 2);

    const defIgnore = grants.find(grant => grant.attribute === 99);
    const resistance = grants.find(grant => grant.attribute === 30);
    assert('…a 32% DEF ignore', Math.abs((defIgnore?.value ?? 0) - 0.32) < 1e-9);
    assert('…a -10% Fusion resistance (a shred, written as a negative)',
        Math.abs((resistance?.value ?? 0) + 0.10) < 1e-9);
    assert('…both lasting 8s', defIgnore?.durationSeconds === 8 && resistance?.durationSeconds === 8);
    assert('…both scoped to DamageType 2 (Resonance Liberation)',
        defIgnore?.scope?.damageTypes?.[0] === 2 && resistance?.scope?.damageTypes?.[0] === 2);

    // R5 walks the tooltip's own ladder.
    const r5 = weaponExternalGrants(dataset, 21020076, 5) ?? [];
    assert('R5 DEF ignore is 64%',
        Math.abs((r5.find(grant => grant.attribute === 99)?.value ?? 0) - 0.64) < 1e-9);

    const folded = foldExternalGrants(grants);
    assert('both land in targetMods, not in a stat bucket', folded.targetMods.length === 2);
    assert('nothing was left unplaced', folded.unplaced.length === 0);

    // The scope must actually gate: a Liberation hit takes it, a Basic does not.
    const ignoreMod = folded.targetMods.find(mod => mod.defIgnore);
    assert('the DEF ignore applies to a Liberation hit', targetModApplies(ignoreMod, 'liberation', 2));
    assert('…and NOT to a Basic Attack hit', !targetModApplies(ignoreMod, 'basic', 2));
    // A Tune Break response is not Liberation damage, which is why wiring this
    // must not move the gear-independent Tune Break anchor.
    assert('…and NOT to a Tune Break', !targetModApplies(ignoreMod, 'tuneBreak', 2));
}

// ── 4. Kumokiri — stack limit is part of the value, all six elements present ──
{
    const grants = weaponExternalGrants(dataset, 21010056, 1) ?? [];
    const liberation = grants.find(grant => grant.attribute === PROP.DMG_LIBERATION);
    assert('Kumokiri states 8% per stack', Math.abs((liberation?.value ?? 0) - 0.08) < 1e-9);
    assert('…stacking up to 3', liberation?.stackLimit === 3);

    const folded = foldExternalGrants(grants);
    assert('…so the credited Liberation bonus is 24% at cap',
        Math.abs((folded.dmgBySkillType.liberation ?? 0) - 0.24) < 1e-9);
    // "All-Attribute DMG Bonus" is shipped as SIX element rows, not one
    // standalone attribute — the reason routing has to be data-driven.
    for (let element = 1; element <= 6; element++) {
        assert(`…and the team bonus covers element ${element}`,
            Math.abs((folded.dmgByElement[element] ?? 0) - 0.24) < 1e-9);
    }
}

// ── 5. Coverage ──────────────────────────────────────────────────────────────
{
    const weapons = dataset.externalBuffs?.weapons ?? {};
    assert('the dataset carries external buffs for the weapon roster',
        Object.keys(weapons).length >= 90);
    // A scoped grant that is NOT a target modifier has nowhere to go: the stat
    // buckets are whole-build numbers with no room for "…but only on Heavy
    // Attacks". Six weapons state a scoped AMPLIFY, and they are deliberately
    // left unplaced rather than widened, because their rows are mutually
    // EXCLUSIVE branches rather than simultaneous grants — Lux & Umbra ships
    // +24% scoped to Heavy, +24% scoped to Echo Skill, and +24% scoped to BOTH,
    // which is the tooltip's "DMG Amplification on each attack is capped at 24%"
    // and not a third bonus. They differ only in `BuffAction`, so separating cap
    // from grant needs that chain modelled first. Until then these weapons fall
    // through to the text reader, which is why the list is a CONTRACT: it may
    // shrink, and anything joining it must be understood, not absorbed.
    const KNOWN_UNPLACED = ['21020046', '21020086', '21020096', '21030036',
        '21030056', '21040056', '21040066', '21050066'];
    const unplaced = Object.entries(weapons)
        .filter(([, entry]) => foldExternalGrants(entry.ranks?.['1'] ?? []).unplaced.length)
        .map(([id]) => id)
        .sort();
    assert(`exactly the known scoped-amplify weapons are unplaced (got ${unplaced.join(',')})`,
        unplaced.join(',') === [...KNOWN_UNPLACED].sort().join(','));
    // Whatever cannot be placed must still be READ by the text path, so the
    // weapon is never left with nothing at all.
    assert('every unplaced weapon still has a text effect to fall back on',
        unplaced.every(id => {
            const weapon = (dataset.weapons ?? []).find(entry => String(entry.id) === id);
            return typeof weapon?.effect === 'string' && weapon.effect.length > 0;
        }));
}

console.log(`external-buffs: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
