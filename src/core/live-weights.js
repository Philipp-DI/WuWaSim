/**
 * Live stat weights (P12 redesign).
 *
 * The frozen meta weights are a precomputed BASIS at an anchor build. This
 * module computes the marginal value of each echo SUBSTAT at the user's ACTUAL
 * build — by injecting +1 roll of each stat into their real rotation and reading
 * the damage gain from the unchanged sim. That makes the priority shift live with
 * the user's current stats (diminishing returns, element/role, equipped buffs),
 * which is what a substat-rolling decision actually depends on.
 *
 * It also values the user's existing substats by those live numbers, so the UI
 * can highlight the best stats to roll and flag the echo with the most upgrade
 * headroom. Pure functions over the core sim; no engine changes.
 *
 * Cost: one base sim + one per rollable stat (~8) per call. The sim is a few ms,
 * so a full recompute is well under a frame — fine to run on each build change.
 */

import { effectiveSkillMap, simulateRotation } from './sim.js';
import { PROP, resolveTotalStats } from './stats.js';
import { resolveSkill } from './skill.js';
import { rollValueOf, statLabel, NEAR_ZERO } from './stat-priority.js';

const DEFAULT_TARGET = Object.freeze({ level: 90, atkLv: 90, resistances: {} });

// Echo SUBSTAT-rollable stats and how to inject each. `value` is injected in
// percentage points (1 = +1%), so injecting rollValueOf(key) is exactly one
// average roll of that stat.
//
// ALL THREE scaling ratios are here, not just ATK%. A kit's damage scales off
// whatever `relatedProp` its damage rows name (skill.js SCALING_BY_PROP), and
// seven resonators are mostly or entirely off-ATK — Cartethyia 100% HP, Yuanwu
// 91% DEF, Taoqi 85% DEF, Shorekeeper 80% HP, Suisui 68% HP, Baizhi 66% HP,
// Mornye 53% DEF. Listing only ATK% left their real scaling stat with no row at
// all while ATK% sat at zero, which is the worst possible pair to show
// (maintainer-reported on Cartethyia, 2026-07-31). Nothing is assumed to be a
// junk stat: the perturbation MEASURES each one, so HP% ranks top on Cartethyia
// and reports 'noScaling' on Carlotta by the same rule.
//
// Element DMG stays out — it is a 3-cost MAIN stat, not a substat. So do the
// flat rolls (ATK/HP/DEF), consistently for all three scaling types.
const SUBSTAT_SET = Object.freeze([
    { key: 'critRate',          propId: PROP.CRIT_RATE,      addType: 1 },
    { key: 'critDmg',           propId: PROP.CRIT_DMG,       addType: 1 },
    { key: 'atkRatio',          propId: PROP.ATK_RATIO,      addType: 2 },
    { key: 'hpRatio',           propId: PROP.HP_RATIO,       addType: 2 },
    { key: 'defRatio',          propId: PROP.DEF_RATIO,      addType: 2 },
    { key: 'dmgBonus.basic',    propId: PROP.DMG_BASIC,      addType: 1 },
    { key: 'dmgBonus.heavy',    propId: PROP.DMG_HEAVY,      addType: 1 },
    { key: 'dmgBonus.skill',    propId: PROP.DMG_SKILL,      addType: 1 },
    { key: 'dmgBonus.liberation', propId: PROP.DMG_LIBERATION, addType: 1 },
    { key: 'energyRegen',       propId: PROP.ENERGY_REGEN,   addType: 1 },
]);

// propId → weight key, for valuing a user's existing substats.
const PROP_TO_KEY = Object.freeze(Object.fromEntries(SUBSTAT_SET.map(sub => [sub.propId, sub.key])));

/** Which weight key an echo substat propId corresponds to (null = off-stat). */
export function substatKeyOf(propId) {
    return PROP_TO_KEY[propId] ?? null;
}

// The two things a +1 roll can be measured against. Both return the same shape
// — a scalar to compare and the hit records behind it — so the perturbation
// loop and critCappedShare don't care which one is in play.

// ROTATION: total damage over the build's own rotation, timing and all.
function rotationMeasure(build, dataset, target) {
    const result = simulateRotation({ build, dataset, target });
    const hits = [];
    for (const step of result?.steps ?? []) hits.push(...(step.resolved?.hits ?? []));
    return { measure: 'rotation', value: result?.totals?.damage ?? 0, hits };
}

// KIT: mean expected damage per hit instance across every curated ability, one
// cast each — no rotation, no timing, no cooldowns. This is exactly the number
// the build page's top strip calls OVERALL AVG (see strips.js abilityAverages),
// so a build with no usable rotation is ranked against the same reading the
// maintainer already reads off the sticky bar (2026-07-31).
function kitMeasure(build, dataset, target) {
    const skillMap = effectiveSkillMap(dataset, build.resonatorId);
    const hits = [];
    if (skillMap) {
        const stats = resolveTotalStats(build, dataset);
        for (const [key, skillDef] of Object.entries(skillMap)) {
            if (key.startsWith('_')) continue;
            const resolved = resolveSkill({ skillDef, build, dataset, stats, target, skillKey: key });
            if (resolved?.hits) hits.push(...resolved.hits);
        }
    }
    const sum = hits.reduce((total, hit) => total + hit.result.expected, 0);
    return { measure: 'kit', value: hits.length > 0 ? sum / hits.length : 0, hits };
}

const MEASURES = Object.freeze({ rotation: rotationMeasure, kit: kitMeasure });

// Damage-weighted share of the hits whose Crit Rate the damage formula clamped
// to the 100% cap. computeDamage reports the CLAMPED rate, so `>= 1` reads
// exactly "this hit could not have used another point of Crit Rate". Buffs are
// why the panel's own Crit Rate figure can read below 100% while every hit is
// capped — the cap is decided per hit, mid-rotation.
function critCappedShare(hits) {
    let capped = 0;
    let total = 0;
    for (const hit of hits) {
        const damage = hit.result?.expected ?? 0;
        if (!(damage > 0)) continue;
        total += damage;
        if ((hit.result.breakdown?.critRate ?? 0) >= 1) capped += damage;
    }
    return total > 0 ? capped / total : 0;
}

// Inject +1 roll of a stat onto the first equipped echo. Echo substats sum
// globally in the stat resolver, so the slot is irrelevant; the injection just
// needs an echo to live on. Replaces any prior injection of the same stat.
function injectRoll(build, stat, value) {
    const echoes = build.echoes.slice();
    const index = echoes.findIndex(Boolean);
    if (index < 0) return build;
    const tag = `live:${stat.propId}`;
    const sub = { propId: stat.propId, addType: stat.addType, value, isPercent: true, __synthetic: tag };
    const subStats = [...(echoes[index].subStats ?? []).filter(sub => sub.__synthetic !== tag), sub];
    echoes[index] = { ...echoes[index], subStats };
    return { ...build, echoes };
}

// The empty slot injectRoll needs when the user hasn't equipped anything yet.
// `cost: 0` is deliberate and load-bearing: echo-rules only auto-derives a
// sub-main stat for costs 1/3/4 (a 1-cost slot would silently add 456 flat HP,
// shifting an HP scaler's baseline off the top strip's OVERALL AVG), so cost 0
// makes the slot contribute exactly nothing. `sonataId: null` keeps it out of
// every set count.
const BARE_ECHO = Object.freeze({ id: null, cost: 0, level: 0, starLevel: 5, sonataId: null, mainStat: null, subStats: [] });

function withBareEcho(build) {
    if (build.echoes?.some(Boolean)) return build;
    const echoes = (build.echoes ?? []).slice();
    echoes[0] = { ...BARE_ECHO };
    return { ...build, echoes };
}

/**
 * What the weights get measured against, and what had to be assumed to get
 * there.
 *
 * A stat's per-roll value can only be read off SOMETHING being cast. A build
 * with no rotation — or one whose steps deal no damage, i.e. half-built or
 * invalid — has nothing to perturb, and returning null there left the panel
 * blank exactly when a new build most needs the guidance. So fall back to the
 * resonator's own KIT and report the switch; the caller is expected to say so
 * on screen (maintainer-directed 2026-07-31).
 *
 * The kit average is preferred over standing in a curated reference rotation:
 * it needs no curation (so it covers all 56 resonators, including the three
 * with no reference rotation), it describes the resonator rather than someone's
 * plan for it, and it is the number already on screen in the top strip.
 *
 * The user's OWN rotation always wins when it produces damage, however messy.
 */
function measurableBuild(build, dataset, target) {
    const seeded = withBareEcho(build);
    const assumedEcho = seeded !== build;

    const own = rotationMeasure(seeded, dataset, target);
    if (own.value > 0) return { measured: seeded, ...own, assumedEcho };

    const kit = kitMeasure(seeded, dataset, target);
    if (kit.value > 0) return { measured: seeded, ...kit, assumedEcho };
    return null;
}

/**
 * Live per-roll value of each rollable substat at the user's current build.
 *
 * EVERY rollable stat is reported, including the ones worth nothing. A stat
 * that silently vanishes from the list is indistinguishable from a stat the app
 * failed to compute, which is how a correct zero reads as a bug; a row saying
 * zero AND why is a finding. `zeroReason` carries the why as a code, so the
 * wording stays in the UI:
 *   'critCap'   — the rotation is already at the 100% Crit Rate cap
 *   'noScaling' — nothing this rotation does scales with the stat
 *
 * `measure` names what a gain is denominated in — `'rotation'` (extra damage
 * over the user's own rotation) or `'kit'` (extra average damage per hit across
 * the whole kit). `assumedEcho` flags a seeded empty slot. The panel is expected
 * to say both, because they change what the numbers MEAN.
 *
 * @returns {{ base:number, critCapped:number, measure:'rotation'|'kit',
 *             assumedEcho:boolean,
 *             values:Array<{key,label,gain,normalized,zeroReason}> } | null}
 *          ranked desc (top normalized = 100); null only when neither the
 *          rotation nor the kit deals any damage.
 */
export function liveSubstatValues(build, dataset, target = DEFAULT_TARGET) {
    if (!build) return null;
    const context = measurableBuild(build, dataset, target);
    if (!context) return null;
    const { measured, measure, value: base, hits, assumedEcho } = context;

    const critCapped = critCappedShare(hits);
    const measureOf = MEASURES[measure];

    const values = SUBSTAT_SET.map(stat => {
        const injected = injectRoll(measured, stat, rollValueOf(stat.key, dataset.statRanges));
        const gain = measureOf(injected, dataset, target).value - base;
        const worthless = !(gain > NEAR_ZERO);
        return {
            key: stat.key,
            label: statLabel(stat.key),
            gain: worthless ? 0 : gain,
            zeroReason: !worthless ? null
                : (stat.key === 'critRate' && critCapped > 0) ? 'critCap'
                : 'noScaling',
        };
    });
    values.sort((valueA, valueB) => valueB.gain - valueA.gain);
    const max = values[0]?.gain ?? 0;
    return {
        base, critCapped, measure, assumedEcho,
        values: values.map(value => ({ ...value, normalized: max > 0 ? (value.gain / max) * 100 : 0 })),
    };
}

/**
 * Per-echo upgrade analysis. Values each equipped echo's substats by the live
 * per-roll numbers and flags the echo with the most headroom — the one whose
 * substats sit furthest below an all-top-stat echo, i.e. the most to gain by
 * re-rolling. Flat rolls count as zero value; every ratio is MEASURED, so HP%
 * is junk on an ATK scaler and the best stat on Cartethyia without either being
 * hardcoded.
 *
 * @returns {{ perEcho:Array, worstSlot:number|null, live:object } | null}
 */
export function echoUpgradeRanking(build, dataset, target = DEFAULT_TARGET) {
    const live = liveSubstatValues(build, dataset, target);
    if (!live) return null;
    const valueOf = new Map(live.values.map(value => [value.key, value.normalized]));   // 0..100 per roll

    const perEcho = (build.echoes ?? []).map((echo, slot) => {
        if (!echo) return { slot, equipped: false, substatValue: 0, headroom: 0, substatCount: 0 };
        const subs = echo.subStats ?? [];
        let value = 0;
        for (const sub of subs) {
            const key = substatKeyOf(sub.propId);
            if (!key) continue;                            // off-stat → 0 value
            // `valueOf` is the value of ONE AVERAGE roll of the stat; scale it by
            // how large THIS roll actually is (its value ÷ the stat's average roll
            // magnitude), so two echoes with identical stat TYPES but different
            // roll QUALITY differ. Marginal damage is ~linear over one substat's
            // narrow range, so linear scaling is a faithful approximation.
            const averageRollMagnitude = rollValueOf(key, dataset.statRanges);
            const rollFactor = averageRollMagnitude > 0 ? sub.value / averageRollMagnitude : 1;
            value += (valueOf.get(key) ?? 0) * rollFactor;
        }
        // headroom = (an all-best-stat echo's value) − this echo's value.
        const headroom = subs.length > 0 ? (100 * subs.length - value) : 0;
        return { slot, equipped: true, substatValue: value, headroom, substatCount: subs.length };
    });

    const equipped = perEcho.filter(echoEntry => echoEntry.equipped && echoEntry.substatCount > 0);
    const worstSlot = equipped.length
        ? equipped.reduce((best, entry) => (entry.headroom > best.headroom ? entry : best), equipped[0]).slot
        : null;
    return { perEcho, worstSlot, live };
}
