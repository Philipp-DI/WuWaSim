// tests/thread-of-bane.test.mjs — Chisa's Thread of Bane (team-wide DEF ignore)
// and Denia's Erosion Field (off-field persistent lane), both wired 2026-08-10.
//
// Both were found by the DPS-gap harness (tools/benchmark-gap.mjs): the team was
// 1.634x below the external benchmark and these were two of the named causes.
import { readFileSync } from 'fs';
import {
    DEF_IGNORE_GRANTS, defIgnoreGrantsForResonator, defIgnoreOutroGates,
    defIgnoreForMemberAt,
} from '../src/core/enemy-status.js';
import { computeOffFieldDamage } from '../src/core/off-field.js';
import { computeDamage } from '../src/core/formula.js';
import { applyPatch } from '../src/data/loader.js';
import { createBuild, setChain, setEcho, setWeapon } from '../src/core/build.js';
import { simulateTeamRotation } from '../src/core/team-sim.js';
import { distinctApplicatorTierContribution } from '../src/core/buffs/conditional-buffs.js';
import { templateStats } from '../tools/optimize/reference-build.js';

// patch.json is a RUNTIME overlay — Denia's Erosion Field lives there, so the
// dataset must be merged the same way the app merges it (loader.js applyPatch).
const dataset = applyPatch(
    JSON.parse(readFileSync(new URL('../data/wuwa-data.json', import.meta.url), 'utf8')),
    JSON.parse(readFileSync(new URL('../data/patch.json', import.meta.url), 'utf8')),
);

let failed = 0;
function assert(name, cond) {
    if (cond) { console.log(`  ok   ${name}`); } else { console.log(`  FAIL ${name}`); failed++; }
}

const CHISA = 1508, DENIA = 1211, AEMEATH = 1210;
const TEAM = [{ resonatorId: CHISA, chain: 0 }, { resonatorId: DENIA, chain: 0 }, { resonatorId: AEMEATH, chain: 0 }];

// The benchmark team, built the way tools/benchmark-gap.mjs builds it.
const ROTATIONS = {
    [CHISA]: ['basic_2', 'basic_rending_lunge', 'basic_death_snip', '__echo__', 'liberation',
        'forte_heavy_sawring_blitz_1', 'forte_heavy_sawring_blitz_2', 'forte_heavy_sawring_blitz_3'],
    [DENIA]: ['basic_stagecraft_form_4', 'skill_phantom_bubble_stagecraft_form',
        'liberation_final_act_stagecraft_form', 'basic_breakdown_form_1', 'basic_breakdown_form_2',
        'basic_breakdown_form_3', 'basic_breakdown_form_4', 'skill_banish_breakdown_form_1',
        'skill_banish_breakdown_form_2', 'liberation_final_act_breakdown_form', '__echo__'],
    [AEMEATH]: ['skill_mech_3', 'skill_mech_4', 'liberation_heavenfall_edict_overdrive', '__echo__',
        'skill_mech_2', 'skill_mech_3', 'skill_mech_4', '__tunebreak__',
        'forte_heavy_seraphic_duet_encore', 'basic_aemeath_2', 'basic_aemeath_3', 'basic_aemeath_4',
        'forte_heavy_seraphic_duet_overture', 'heavy_mech_charged_ii', 'liberation_heavenfall_edict_finale'],
};

function memberBuild(resonatorId, weaponId, sonataId, mode) {
    const resonator = dataset.resonators.find(entry => entry.id === resonatorId);
    let build = setWeapon(setChain(createBuild(resonator), 0), weaponId);
    templateStats(resonator, dataset, []).forEach((echo, index) => {
        build = setEcho(build, index, {
            id: null, cost: echo.cost, level: 25,
            mainStat: echo.mainStat, subStats: echo.subStats, sonataId,
        });
    });
    const rotation = ROTATIONS[resonatorId];
    return { ...build, id: resonatorId, level: 90, resonanceMode: mode,
        rotation, rotationMeta: rotation.map(() => ({})) };
}

// ── The curated grant matches the game's own params ──────────────────────────
// "Unraveling - Law Zero", param [20, 3, 15, 15]: a 20s team window, +3 stacks
// for 15s, and Thread of Bane for 15s. The 18% is from the Forte node.
{
    const grant = DEF_IGNORE_GRANTS[CHISA][0];
    assert('Chisa Thread of Bane is 18% DEF ignore', grant.defIgnore === 0.18);
    assert('Thread of Bane lasts 15s (param[3])', grant.seconds === 15);
    assert('its Outro gate is 20s (param[0])', grant.gate.onOutro === true && grant.gate.seconds === 20);
    assert('it is NOT chain-gated (S0 must have it)', (grant.chain ?? 0) === 0);
    assert('no other resonator ships a DEF-ignore grant', Object.keys(DEF_IGNORE_GRANTS).length === 1);
    assert('a teammate has no grant of their own', defIgnoreGrantsForResonator(DENIA).length === 0);
}

// ── The gate opens on the OUTRO, which is never a step ───────────────────────
{
    const gates = defIgnoreOutroGates(10, CHISA, 0);
    assert('Chisa outro opens one gate', gates.length === 1);
    assert('gate spans outro → outro + 20s', gates[0].start === 10 && gates[0].end === 30);
    assert('a teammate outro opens none', defIgnoreOutroGates(10, DENIA, 0).length === 0);
}

// ── The WIELDER holds it permanently, with no gate ───────────────────────────
// Verified against the game's own tables: the tag buff 1508970005 requires is
// granted by 1508970003 (DurationPolicy 1, NO duration = permanent, Chisa's own)
// AND by 1508970004 (15.0s, the Outro copy). Gating the owner behind her own
// Outro denied her a passive she always has — and since that gate opens as she
// LEAVES the field, she would have held it never.
{
    const noGates = [];
    assert('Chisa holds 18% with no gate open at all',
        defIgnoreForMemberAt(noGates, TEAM, new Set(['havoc_bane']), 0, CHISA) === 0.18);
    assert('...and at any later time too',
        defIgnoreForMemberAt(noGates, TEAM, new Set(['havoc_bane']), 999, CHISA) === 0.18);
    assert('a TEAMMATE gets nothing without a gate',
        defIgnoreForMemberAt(noGates, TEAM, new Set(['fusion_burst']), 0, AEMEATH) === 0);
}

// ── A status-inflicting TEAMMATE inside the gate holds the borrowed copy ─────
{
    const gates = defIgnoreOutroGates(10, CHISA, 0);      // open [10, 30]
    const inflictsFusion = new Set(['fusion_burst']);
    const inflictsNothing = new Set();
    assert('a teammate who inflicts, inside the gate, holds 18%',
        defIgnoreForMemberAt(gates, TEAM, inflictsFusion, 12, AEMEATH) === 0.18);
    assert('the same teammate holds nothing once the gate closes',
        defIgnoreForMemberAt(gates, TEAM, inflictsFusion, 31, AEMEATH) === 0);
    assert('a teammate who inflicts NOTHING never holds it, gate or no gate',
        defIgnoreForMemberAt(gates, TEAM, inflictsNothing, 12, AEMEATH) === 0);
    assert('exactly at the gate edges it is still held',
        defIgnoreForMemberAt(gates, TEAM, inflictsFusion, 10, AEMEATH) === 0.18
        && defIgnoreForMemberAt(gates, TEAM, inflictsFusion, 30, AEMEATH) === 0.18);
    assert('a non-qualifying status does not earn it',
        defIgnoreForMemberAt(gates, TEAM, new Set(['tune_strain']), 12, AEMEATH) === 0);
}

// ── With no granting kit on the team, nothing is ever granted ────────────────
{
    assert('a team with no granting kit gets nothing even with a gate',
        defIgnoreForMemberAt(defIgnoreOutroGates(0, CHISA, 0),
            [{ resonatorId: DENIA, chain: 0 }, { resonatorId: AEMEATH, chain: 0 }],
            new Set(['fusion_burst']), 5, AEMEATH) === 0);
}

// ── It never stacks with itself ──────────────────────────────────────────────
{
    const gates = [...defIgnoreOutroGates(0, CHISA, 0), ...defIgnoreOutroGates(5, CHISA, 0)];
    assert('overlapping gates still yield 18%, never 36%',
        defIgnoreForMemberAt(gates, TEAM, new Set(['fusion_burst']), 6, AEMEATH) === 0.18);
    assert('the owner inside her own gate still holds 18%, not 36%',
        defIgnoreForMemberAt(gates, TEAM, new Set(['havoc_bane']), 6, CHISA) === 0.18);
}

// ── Denia's Erosion Field ────────────────────────────────────────────────────
{
    const denia = dataset.resonators.find(resonator => resonator.id === DENIA);
    const actions = denia?.offFieldActions ?? [];
    const field = actions.find(action => /erosion field/i.test(action.note ?? ''));
    assert('Denia ships an Erosion Field off-field action', !!field);
    if (field) {
        assert('it is a 4s-period turret lasting 30s',
            field.type === 'turret' && field.cooldown === 4 && field.duration === 30);
        assert('armed by her Liberation', field.trigger === 'liberation');
        assert('Fusion element', field.element === 2);
        // The kit: "dealing Fusion DMG, considered [Resonance Liberation DMG]".
        assert('typed liberation, not the default basic bucket', field.skillType === 'liberation');
        // mults[9] of damageTable row 12110007001 (skill level 10).
        const row = (dataset.damageTable[String(DENIA)] ?? []).find(entry => entry.id === 12110007001);
        assert('multiplier equals the damage row at skill level 10',
            !!row && Math.abs(field.multiplier - row.mults[9]) < 1e-4);
    }
}

// ── An off-field action's declared skillType reaches the formula ─────────────
// Regression guard: before 2026-08-10 computeOffFieldDamage hardcoded 'basic',
// which silently dropped the wielder's Liberation DMG bucket from this lane.
{
    const stats = { atk: 3000, critRate: 0, critDmg: 1, dmgBonusBySkillType: { liberation: 1.0 }, amplify: 0, deepen: 0 };
    const target = { level: 90, atkLv: 90, resistances: {} };
    const base = { type: 'turret', element: 2, scaling: 'atk', multiplier: 1, cooldown: 4, duration: 30, hitsPerCast: null };
    const asBasic = computeOffFieldDamage({ action: base, stats, windowSeconds: 30, target, computeDamage });
    const asLib = computeOffFieldDamage({ action: { ...base, skillType: 'liberation' }, stats, windowSeconds: 30, target, computeDamage });
    assert('a liberation-typed action outdamages a basic-typed one under a liberation bonus',
        asLib.damage > asBasic.damage * 1.5);
    assert('omitting skillType still means basic (no behaviour change for existing actions)',
        computeOffFieldDamage({ action: base, stats, windowSeconds: 30, target, computeDamage }).damage === asBasic.damage);
}

// ── Off-field damage runs on the ORDINARY lane ───────────────────────────────
// An off-field hit is normal damage that happens to land while its owner is
// benched: same buffs, same buckets, and it can apply statuses. Only the
// `offField` flag and its zero time cost distinguish it.
{
    const team = { slots: [CHISA, DENIA, AEMEATH] };
    const builds = new Map([
        [CHISA, memberBuild(CHISA, 21010056, 7, null)],
        [DENIA, memberBuild(DENIA, 21050076, 28, 'fusion_burst')],
        [AEMEATH, memberBuild(AEMEATH, 21020076, 27, 'fusion_burst')],
    ]);
    const result = simulateTeamRotation({
        team, resolveBuild: (id) => builds.get(id) ?? null, dataset,
        target: { level: 90, atkLv: 90, resistances: {} }, passCount: 3, timingMode: 'toa',
    });
    const offSegments = result.segments.filter(segment => segment.kind === 'offField');
    assert('off-field segments exist', offSegments.length > 0);

    const offSteps = offSegments.flatMap(segment => segment.steps ?? []);
    assert('a simulable off-field action produces REAL steps', offSteps.length > 0);
    assert('every off-field step is flagged offField', offSteps.every(step => step.offField === true));
    assert('off-field steps cost no time', offSteps.every(step => step.stepDuration === 0));
    assert('off-field steps carry real damage', offSteps.every(step => (step.stepDamage ?? 0) > 0));
    assert('off-field steps stay inside their window', offSegments.every(segment =>
        (segment.steps ?? []).every(step =>
            step.startTime >= segment.startTime - 1e-6 && step.startTime <= segment.endTime + 1e-6)));

    // The whole point of the lane (maintainer, 2026-08-10): the Erosion Field
    // builds Fusion Burst, so it pays through the status timeline too, not only
    // through its own ticks.
    const denia = result.memberTotals.find(entry => entry.resonatorId === DENIA);
    assert('Denia accrues off-field damage', (denia?.offFieldDmg ?? 0) > 0);
    assert('and a negative-status lane fed by it', (denia?.statusDmg ?? 0) > 0);
    // Off-field casts must NOT be credited to the energy ledger — the gauge model
    // already gives a benched member a 50% share of the active member's income.
    const trace = result.memberEnergy?.get(DENIA)?.trace ?? [];
    assert('no off-field cast is credited to the energy trace',
        !trace.some(event => event.label && /erosion/i.test(event.label)));
}

// ── Aemeath's Between the Stars: the tier supplies stacks 2..N ONLY ──────────
// Stack 1 already comes from the parsed inherent effect (IH1.0 tune_rupture
// 0.20 / IH1.1 fusion_burst 0.30, measured live in a solo sim), so the tier
// adding a first stack too would double-count a main carry's Crit. DMG. And S3
// REPLACES the whole inherent with a flat 60% + 25%, so the tier must go silent
// from S3 up. Game rows: 1210075116 CritDamage 3000 stack 2 (Fusion Burst),
// 1210075016 CritDamage 2000 stack 3 (Tune Rupture).
{
    const applicators = (count) => () => new Set(Array.from({ length: count }, (_, i) => 1000 + i));
    const fusion = (count, chain = 0) => distinctApplicatorTierContribution(AEMEATH, 'fusion_burst', applicators(count), chain);
    const tune = (count, chain = 0) => distinctApplicatorTierContribution(AEMEATH, 'tune_rupture', applicators(count), chain);

    assert('Fusion Burst: ONE applicator adds nothing here (the pipeline owns stack 1)',
        fusion(1).critDmg === 0);
    assert('Fusion Burst: two applicators add the SECOND stack only (30%)',
        Math.abs(fusion(2).critDmg - 0.30) < 1e-9);
    assert('Fusion Burst: it caps at two ("up to 2 times")',
        Math.abs(fusion(5).critDmg - 0.30) < 1e-9);
    assert('Fusion Burst: the 25% Finale amplify unlocks at the cap',
        (fusion(1).amplifyByType.liberation ?? 0) === 0
        && Math.abs((fusion(2).amplifyByType.liberation ?? 0) - 0.25) < 1e-9);

    assert('Tune Rupture: one applicator adds nothing here', tune(1).critDmg === 0);
    assert('Tune Rupture: stacks 2 and 3 add 20% each',
        Math.abs(tune(2).critDmg - 0.20) < 1e-9 && Math.abs(tune(3).critDmg - 0.40) < 1e-9);
    assert('Tune Rupture: it caps at three ("up to 3 times")',
        Math.abs(tune(9).critDmg - 0.40) < 1e-9);
    assert('Tune Rupture: its amplify needs all three',
        (tune(2).amplifyByType.liberation ?? 0) === 0
        && Math.abs((tune(3).amplifyByType.liberation ?? 0) - 0.25) < 1e-9);

    // S3 replaces the inherent outright — the chain pipeline then grants the
    // flat 60% + 25% itself, so this table must contribute NOTHING from S3 up.
    for (const chain of [3, 4, 5, 6]) {
        assert(`S${chain}: the tier is silent (S3 replaces Between the Stars)`,
            fusion(2, chain).critDmg === 0
            && (fusion(2, chain).amplifyByType.liberation ?? 0) === 0
            && tune(3, chain).critDmg === 0
            && (tune(3, chain).amplifyByType.liberation ?? 0) === 0);
    }
    assert('S2 still pays (the replacement only starts at S3)',
        Math.abs(fusion(2, 2).critDmg - 0.30) < 1e-9);

    assert('no mode selected → neither branch fires',
        distinctApplicatorTierContribution(AEMEATH, null, applicators(5), 0).critDmg === 0);
    // Hiyuki has no maxChain, so her ladder must be unaffected by the new gate.
    const hiyuki = (chain) => distinctApplicatorTierContribution(1108, null, applicators(3), chain);
    assert('an entry without maxChain is not gated by chain level',
        Math.abs(hiyuki(0).critDmg - hiyuki(6).critDmg) < 1e-9 && hiyuki(6).critDmg > 0);
}

console.log(`thread-of-bane: ${failed === 0 ? 'all passed' : failed + ' failed'}`);
process.exit(failed === 0 ? 0 : 1);
