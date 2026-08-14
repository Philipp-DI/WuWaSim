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
    sonataExternalGrants, sonataWindowGrants, derivedGrantValue, DERIVED_SOURCE,
    sonataConditionalGrants,
} from '../src/core/buffs/external-buffs.js';
import { incomingResonatorContribution } from '../src/core/buffs/conditional-buffs.js';
import { createBuild, setChain, setEcho } from '../src/core/build.js';

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

// ── 6. Sonata lane ───────────────────────────────────────────────────────────
{
    const sonatas = dataset.externalBuffs?.sonatas ?? {};
    assert('every sonata with a 5pc buff row is extracted', Object.keys(sonatas).length >= 30);

    // Trailblazing Star states TWO grants in one tier — the exact shape the text
    // parser cannot hold, since one ParsedBuff carries one value.
    const trail = sonataExternalGrants(dataset, 27, 5) ?? [];
    assert('Trailblazing Star yields BOTH of its grants', trail.length === 2);
    assert('…+20% Crit Rate for 8s',
        trail.some(g => g.attribute === PROP.CRIT_RATE && Math.abs(g.value - 0.2) < 1e-9 && g.durationSeconds === 8));
    assert('…and +20% Fusion DMG for 8s',
        trail.some(g => g.attribute === PROP.DMG_ELEMENT_BASE + 2 && Math.abs(g.value - 0.2) < 1e-9 && g.durationSeconds === 8));
    // Only the element half may reach the WINDOW path; the crit half belongs to
    // sonataConditionalContribution, and taking both would double it.
    const trailWindow = sonataWindowGrants(trail);
    assert('only the element half reaches the window path (crit is the other lane)',
        trailWindow.length === 1 && trailWindow[0].bonusKind === 'element' && trailWindow[0].element === 2);

    // Chromatic Foam: a self grant and a hand-off the game routes elsewhere.
    const foam = sonataExternalGrants(dataset, 28, 5) ?? [];
    assert('Chromatic Foam yields both of its grants', foam.length === 2);
    assert('…the self 10% Fusion DMG for 15s',
        foam.some(g => Math.abs(g.value - 0.1) < 1e-9 && g.durationSeconds === 15 && !g.recipient));
    // The 25% is the Outro→Intro transfer, and the GAME says so: the grant sits
    // behind an AddBuffTrigger whose EventType is the QTE handoff and whose
    // TargetType is that event's counterparty — the resonator swapping IN.
    // "Opponent" in `GetTargetByType` is not "the enemy"; `BuffEffectBase.Check`
    // fills it from whichever entity the firing event supplies.
    assert('…and the 25% routed to the INCOMING resonator',
        foam.some(g => Math.abs(g.value - 0.25) < 1e-9 && g.recipient === 'incoming'));
    assert('only the SELF grant reaches the window path', sonataWindowGrants(foam).length === 1);

    // Rejuvenating Glow buffs "all party members" — FormationPolicy says so.
    const glow = sonataExternalGrants(dataset, 7, 5) ?? [];
    assert('Rejuvenating Glow grants ATK', glow.some(g => g.attribute === PROP.ATK_FLAT));
    assert('…and is marked team-wide', glow.every(g => g.teamWide === true));

    // The trigger override must stay narrow: only a status inflict can never be
    // a cast. Rejuvenating Glow's DamageTrigger keeps the text's "upon healing",
    // which is what gates its team distribution.
    assert('Chromatic Foam\'s self grant fires on a status inflict',
        foam.find(g => !g.recipient)?.triggerType === 'BuffInstigatorTrigger');
    assert('Rejuvenating Glow does NOT fire on a status inflict (keeps its healing trigger)',
        glow.every(g => g.triggerType !== 'BuffInstigatorTrigger'));

    // Crown of Valor's 3-piece reaches its grants through TargetType 2
    // (Instigator). For a SELF-applied shield the instigator is the wielder, so
    // these are self grants — the tooltip agrees ("increase the Resonator's
    // ATK…"), EventType 7 is fired by CharacterShieldComponent with its OWN buff
    // component, and the CD/stack values match the sentence exactly.
    const crown = sonataExternalGrants(dataset, 20, 3) ?? [];
    assert('Crown of Valor 3pc grants ATK and Crit DMG', crown.length === 2);
    assert('…6% ATK, 4s, 5 stacks',
        crown.some(g => g.attribute === PROP.ATK_FLAT && Math.abs(g.value - 0.06) < 1e-9
            && g.durationSeconds === 4 && g.stackLimit === 5));
    assert('…4% Crit DMG, 4s, 5 stacks',
        crown.some(g => g.attribute === PROP.CRIT_DMG && Math.abs(g.value - 0.04) < 1e-9
            && g.durationSeconds === 4 && g.stackLimit === 5));
    assert('…and both are SELF, not unrouted', crown.every(g => !g.recipient));

    // With that settled, nothing in the sonata tables is left unrouted: every
    // grant is either the wielder's or the incoming resonator's.
    const unrouted = [];
    for (const [id, entry] of Object.entries(sonatas)) {
        for (const [pieces, tier] of Object.entries(entry.tiers ?? {})) {
            for (const grant of tier.grants ?? []) {
                if (grant.recipient && grant.recipient !== 'incoming') {
                    unrouted.push(`${id}/${pieces}`);
                }
            }
        }
    }
    assert(`no sonata grant is left unrouted (got ${unrouted.join(',') || 'none'})`, unrouted.length === 0);

    // ── DERIVED magnitudes: the FORMULA, not the raw number ─────────────────
    // `CalculationPolicy[0]` 2/4/9 means the magnitude is a coefficient in a
    // runtime formula, not a percentage. The client evaluates it in
    // `BaseAttributeComponent.Cbr`: subtract Min (policy[5]), divide by Ratio
    // (policy[6]), multiply by the magnitude, cap at Max (policy[7]).
    //
    // Every one of these expected values is the SET'S OWN TOOLTIP, so the
    // arithmetic is checked against the game's words rather than against
    // itself. Reading the magnitude flat instead put a HEALER at 3.6M damage on
    // the team page — 21x her real output.
    const halo = sonataExternalGrants(dataset, 25, 5) ?? [];
    const atkGrant = halo.find(grant => grant.attribute === PROP.ATK_FLAT);
    assert('Halo of Starry Radiance\'s ATK grant is marked derived', atkGrant?.derived === true);
    assert('…and its raw magnitude really is the absurd one (2000%)',
        Math.abs((atkGrant?.value ?? 0) - 20) < 1e-9);
    // "every 1% of Off-Tune Buildup Rate grants a 0.2% ATK increase … up to
    // 25%". Off-Tune Buildup Rate is 10000 (100%) on all 2,740 baseproperty
    // rows and nothing raises it, so this resolves with no caller input at all.
    assert('…but resolves to the tooltip\'s 20% ATK',
        Math.abs(derivedGrantValue(atkGrant) - 0.20) < 1e-9);
    const haloFolded = foldExternalGrants(halo);
    assert('…which is what lands in the ATK bucket',
        Math.abs(haloFolded.atkRatio - 0.20) < 1e-9);
    assert('…with nothing left unplaced', haloFolded.unplaced.length === 0);
    assert('…and the sonata window path carries it too',
        sonataWindowGrants(halo).some(grant => grant.bonusKind === 'atk'
            && Math.abs(grant.bonusPct - 0.20) < 1e-9));

    // Song of Feathered Trace: "0.1% ATK … for every 1% of the Resonator's
    // Energy Regen, up to 25%". 100% Energy Regen is 10000 in the game's fixed
    // point, so the floor is 10% and the cap binds at 250% ER.
    const feathered = (sonataExternalGrants(dataset, 33, 5) ?? [])
        .find(grant => grant.derived);
    for (const [regen, expected] of [[1.00, 0.10], [1.80, 0.18], [2.50, 0.25], [4.00, 0.25]]) {
        assert(`Song of Feathered Trace at ${regen * 100}% ER → ${expected * 100}% ATK`,
            Math.abs(derivedGrantValue(feathered,
                { [DERIVED_SOURCE.ENERGY_REGEN]: regen * 10000 }) - expected) < 1e-9);
    }

    // Pact of Neonlight Leap: "each point of Tune Break Boost the incoming
    // Resonator has additionally increases their ATK by 0.3%, up to 15%". Its
    // Ratio is 1, not 100 — the game divides a PERCENT source by 100 and a
    // POINT source by 1, so the Ratio itself says which kind of quantity the
    // source is.
    const pact = (sonataExternalGrants(dataset, 24, 5) ?? []).find(grant => grant.derived);
    assert('Pact of Neonlight Leap counts POINTS, not percent',
        pact?.calculationPolicy?.[6] === 1);
    for (const [points, expected] of [[0, 0], [10, 0.03], [40, 0.12], [50, 0.15], [90, 0.15]]) {
        assert(`Pact of Neonlight Leap at ${points} Tune Break Boost → ${expected * 100}% ATK`,
            Math.abs(derivedGrantValue(pact,
                { [DERIVED_SOURCE.TUNE_BREAK_BOOST]: points }) - expected) < 1e-9);
    }

    // A source the caller cannot supply stays VISIBLE. Crediting it as zero
    // would be a silent under-read; unplaced is a number someone can look at.
    const noSource = foldExternalGrants([feathered, pact]);
    assert('a derived grant with no source value stays unplaced',
        noSource.unplaced.length === 2 && noSource.atkRatio === 0);

    // Roster-wide: every derived grant must be a shape this formula can read.
    const unreadable = [];
    for (const [id, entry] of Object.entries(sonatas)) {
        for (const [pieces, tier] of Object.entries(entry.tiers ?? {})) {
            for (const grant of (tier.grants ?? []).filter(one => one.derived)) {
                const value = derivedGrantValue(grant, {
                    [DERIVED_SOURCE.ENERGY_REGEN]: 10000,
                    [DERIVED_SOURCE.TUNE_BREAK_BOOST]: 10,
                });
                // A readable grant is a real, bounded fraction — never the
                // order-of-magnitude number the raw magnitude would have given.
                if (!(value > 0 && value <= 1)) unreadable.push(`${id}/${pieces}`);
            }
        }
    }
    assert(`every derived grant resolves to a sane fraction (bad: ${unreadable.join(',') || 'none'})`,
        unreadable.length === 0);

    // The transfer must reach the incoming-resonator lane, which is what
    // actually pays it. The text reader scored ZERO here for as long as it has
    // existed, because the tier writes the value BEFORE the stat.
    const denia = dataset.resonators.find(entry => entry.id === 1211);
    let build = setChain(createBuild(denia), 0);
    [4, 3, 3, 1, 1].forEach((cost, index) => {
        build = setEcho(build, index, { id: null, cost, level: 25, mainStat: null, subStats: [], sonataId: 28 });
    });
    const transfer = incomingResonatorContribution(build, dataset, denia);
    assert('Chromatic Foam hands the incoming resonator 25% Fusion DMG',
        Math.abs((transfer.dmgByElement?.[2] ?? 0) - 0.25) < 1e-9);
    assert('…and does not also hand over the wielder\'s own 10%',
        Math.abs((transfer.dmgByElement?.[2] ?? 0) - 0.35) > 1e-9);
}

// ── LANE 4: the conditional lane reads the tables too ──────────────────────
//
// `sonataConditionalGrants` is the exact COMPLEMENT of `sonataWindowGrants`:
// between them they must partition a tier's grants, because a bucket in neither
// is dropped and a bucket in both is counted twice.
{
    const both = [];
    for (const [id, entry] of Object.entries(dataset.externalBuffs?.sonatas ?? {})) {
        for (const [pieces, tier] of Object.entries(entry.tiers ?? {})) {
            const grants = tier.grants ?? [];
            const window = sonataWindowGrants(grants);
            const conditional = sonataConditionalGrants(grants);
            // A tier's crit can only be claimed by ONE lane.
            const windowHasCrit = window.some(g => g.bonusKind === 'crit');
            if (windowHasCrit && conditional) both.push(`${id}/${pieces}`);
        }
    }
    assert(`no sonata grant is claimed by BOTH lanes (${both.join(',') || 'none'})`, both.length === 0);

    // The five tiers the TEXT reader scored as zero. Each value is the set's own
    // tooltip; every one of them was silently missing before the data path.
    // Resolved BY NAME: a set's numeric id is not stable knowledge and guessing
    // one silently tests a different set.
    const sonataNamed = (name) => dataset.sonatas.find(one => one.name === name)?.id ?? null;
    const zeroedByText = [
        ['Eternal Radiance', 5, 'critRate', 0.20],
        ['Windward Pilgrimage', 5, 'critRate', 0.10],
        ['Crown of Valor', 3, 'critDmg', 0.20],
        ['Song of Feathered Trace', 5, 'critRate', 0.20],
        ["Heart of Evil's Purge", 5, 'critDmg', 0.20],
    ];
    for (const [name, pieces, bucket, expected] of zeroedByText) {
        const id = sonataNamed(name);
        const lane = sonataConditionalGrants(sonataExternalGrants(dataset, id, pieces));
        assert(`${name} ${pieces}pc: ${bucket} reads ${expected * 100}% from the tables`,
            id != null && lane != null && Math.abs(lane[bucket] - expected) < 1e-9);
    }

    // Lamp of Nether Road is 5% x 4 stacks; the sentence carries only the 5%.
    const lamp = sonataConditionalGrants(sonataExternalGrants(dataset, sonataNamed('Lamp of Nether Road'), 5));
    assert('a stacking crit grant is credited at cap (5% x 4), not per stack',
        lamp != null && Math.abs(lamp.critRate - 0.20) < 1e-9);

    // teamWide comes from the GRANT. No sonata crit grant is team-wide today, so
    // this pins the CURRENT truth rather than a hoped-for one — if one ships,
    // this test says so instead of a sentence quietly deciding.
    let teamWideCrit = 0;
    for (const entry of Object.values(dataset.externalBuffs?.sonatas ?? {})) {
        for (const tier of Object.values(entry.tiers ?? {})) {
            const lane = sonataConditionalGrants(tier.grants ?? []);
            if (lane && (lane.teamWide.critRate || lane.teamWide.critDmg)) teamWideCrit++;
        }
    }
    assert('no sonata crit grant is team-wide (per the tables, not the prose)', teamWideCrit === 0);
}

// ── A weapon trigger's SCOPE is not its grant's RECIPIENT ───────────────────
//
// `TriggerPreset[0] === '1'` says a TEAMMATE MAY FIRE the passive;
// `InstigatorType` says who receives what it grants ('Owner' the wielder,
// 'Attacker' whoever fired it). Only both together mean team-wide. Phasic
// Homogenizer and Boson Astrolabe are the counterexample the game ships: "After
// a Resonator in the team casts a Tune Break skill, it grants … TO THE WIELDER"
// — team trigger, self grant. Reading the preset alone handed their buffs to
// all three members.
{
    const teamWideAt = (weaponId) => (weaponExternalGrants(dataset, weaponId, 1) ?? [])
        .some(grant => grant.teamWide);
    const named = (name) => dataset.weapons.find(weapon => weapon.name === name)?.id ?? null;

    for (const name of ['Phasic Homogenizer', 'Boson Astrolabe']) {
        const id = named(name);
        assert(`${name}: a team TRIGGER does not make its grant team-wide`,
            id != null && !teamWideAt(id));
    }
    for (const name of ['Kumokiri', 'Forged Dwarf Star']) {
        const id = named(name);
        assert(`${name}: names the team in its tooltip AND is team-wide`,
            id != null && teamWideAt(id));
    }
    // Every team-wide weapon must actually say so in its own tooltip. This is
    // the roster-wide guard: the mechanism is data, but the tooltip is the
    // independent witness, and they may not disagree.
    const TEAM_PHRASE = /resonators? in the team|all team|teammates?|party members?|all resonators|other resonators|nearby resonators/i;
    const silent = [];
    for (const [weaponId, entry] of Object.entries(dataset.externalBuffs?.weapons ?? {})) {
        if (!(entry.ranks?.['1'] ?? []).some(grant => grant.teamWide)) continue;
        const weapon = dataset.weapons.find(one => one.id === Number(weaponId));
        if (!TEAM_PHRASE.test(String(weapon?.effect ?? ''))) silent.push(weapon?.name ?? weaponId);
    }
    assert(`every team-wide weapon names the team in its tooltip (${silent.join(',') || 'none'})`,
        silent.length === 0);
}

console.log(`external-buffs: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
