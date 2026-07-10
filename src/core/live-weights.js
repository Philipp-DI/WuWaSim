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

import { simulateRotation } from './sim.js';
import { PROP } from './stats.js';
import { rollValueOf, statLabel, NEAR_ZERO } from './stat-priority.js';

const DEFAULT_TARGET = Object.freeze({ level: 90, atkLv: 90, resistances: {} });

// Echo SUBSTAT-rollable stats and how to inject each (matches the offline
// weightStatSet, minus element DMG which is a 3-cost MAIN, not a substat).
// `value` is injected in percentage points (1 = +1%), so injecting
// rollValueOf(key) is exactly one average roll of that stat.
const SUBSTAT_SET = Object.freeze([
    { key: 'critRate',          propId: PROP.CRIT_RATE,      addType: 1 },
    { key: 'critDmg',           propId: PROP.CRIT_DMG,       addType: 1 },
    { key: 'atkRatio',          propId: PROP.ATK_RATIO,      addType: 2 },
    { key: 'dmgBonus.basic',    propId: PROP.DMG_BASIC,      addType: 1 },
    { key: 'dmgBonus.heavy',    propId: PROP.DMG_HEAVY,      addType: 1 },
    { key: 'dmgBonus.skill',    propId: PROP.DMG_SKILL,      addType: 1 },
    { key: 'dmgBonus.liberation', propId: PROP.DMG_LIBERATION, addType: 1 },
    { key: 'energyRegen',       propId: PROP.ENERGY_REGEN,   addType: 1 },
]);

// propId → weight key, for valuing a user's existing substats.
const PROP_TO_KEY = Object.freeze(Object.fromEntries(SUBSTAT_SET.map(s => [s.propId, s.key])));

/** Which weight key an echo substat propId corresponds to (null = off-stat). */
export function substatKeyOf(propId) {
    return PROP_TO_KEY[propId] ?? null;
}

function totalDamage(build, dataset, target) {
    return simulateRotation({ build, dataset, target }).totals?.damage ?? 0;
}

// Inject +1 roll of a stat onto the first equipped echo. Echo substats sum
// globally in the stat resolver, so the slot is irrelevant; the injection just
// needs an echo to live on. Replaces any prior injection of the same stat.
function injectRoll(build, stat, value) {
    const echoes = build.echoes.slice();
    const idx = echoes.findIndex(Boolean);
    if (idx < 0) return build;
    const tag = `live:${stat.propId}`;
    const sub = { propId: stat.propId, addType: stat.addType, value, isPercent: true, __synthetic: tag };
    const subStats = [...(echoes[idx].subStats ?? []).filter(s => s.__synthetic !== tag), sub];
    echoes[idx] = { ...echoes[idx], subStats };
    return { ...build, echoes };
}

/**
 * Live per-roll value of each rollable substat at the user's current build.
 * @returns {{ base:number, values:Array<{key,label,gain,normalized}> } | null}
 *          ranked desc (top normalized = 100); null when not simmable.
 */
export function liveSubstatValues(build, dataset, target = DEFAULT_TARGET) {
    if (!build?.echoes?.some(Boolean)) return null;
    const base = totalDamage(build, dataset, target);
    if (base <= 0) return null;

    const values = [];
    for (const stat of SUBSTAT_SET) {
        const gain = totalDamage(injectRoll(build, stat, rollValueOf(stat.key, dataset.statRanges)), dataset, target) - base;
        if (gain > NEAR_ZERO) values.push({ key: stat.key, label: statLabel(stat.key), gain });
    }
    values.sort((a, b) => b.gain - a.gain);
    const max = values[0]?.gain ?? 0;
    return { base, values: values.map(v => ({ ...v, normalized: max > 0 ? (v.gain / max) * 100 : 0 })) };
}

/**
 * Per-echo upgrade analysis. Values each equipped echo's substats by the live
 * per-roll numbers and flags the echo with the most headroom — the one whose
 * substats sit furthest below an all-top-stat echo, i.e. the most to gain by
 * re-rolling. Off-priority substats (HP%/DEF%/flat) count as zero value.
 *
 * @returns {{ perEcho:Array, worstSlot:number|null, live:object } | null}
 */
export function echoUpgradeRanking(build, dataset, target = DEFAULT_TARGET) {
    const live = liveSubstatValues(build, dataset, target);
    if (!live) return null;
    const valueOf = new Map(live.values.map(v => [v.key, v.normalized]));   // 0..100 per roll

    const perEcho = (build.echoes ?? []).map((echo, slot) => {
        if (!echo) return { slot, equipped: false, substatValue: 0, headroom: 0, substatCount: 0 };
        const subs = echo.subStats ?? [];
        let value = 0;
        for (const s of subs) {
            const key = substatKeyOf(s.propId);
            value += key ? (valueOf.get(key) ?? 0) : 0;   // off-stat → 0 value
        }
        // headroom = (an all-best-stat echo's value) − this echo's value.
        const headroom = subs.length > 0 ? (100 * subs.length - value) : 0;
        return { slot, equipped: true, substatValue: value, headroom, substatCount: subs.length };
    });

    const equipped = perEcho.filter(e => e.equipped && e.substatCount > 0);
    const worstSlot = equipped.length
        ? equipped.reduce((w, e) => (e.headroom > w.headroom ? e : w), equipped[0]).slot
        : null;
    return { perEcho, worstSlot, live };
}
