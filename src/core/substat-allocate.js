// src/core/substat-allocate.js
/**
 * Substat co-optimization (Phase C) — greedy marginal allocation.
 *
 * The fixed-template substat package penalises a set/weapon for the stats the
 * template already maxed: a Crit-Rate-providing sonata wastes its CR against a
 * template already near the CR cap, so it loses a comparison it should win. The
 * fair comparison gives EACH candidate its OWN substat allocation, tuned to what
 * that candidate actually wants.
 *
 * This allocator distributes a roll budget greedily: repeatedly add the one roll
 * with the highest CURRENT marginal damage, re-simming after each so the value
 * of each stat reflects the build so far. Diminishing returns fall out for free —
 * Crit Rate stops being chosen as it nears the cap (the formula clamps critRate,
 * so its marginal gain collapses), Energy Regen stops once it stops paying, etc.
 *
 * Pure: it only runs the real sim (no parallel damage math), so whatever the
 * engine models — per-step stack ramps, CR clamp, amplify — is automatically
 * respected. Shared by the offline suggested-build search and the runtime
 * "suggested substats" hint.
 */

import { simulateRotation } from './sim.js';
import { PROP } from './stats.js';
import { rollValueOf } from './stat-priority.js';

const DEFAULT_TARGET = Object.freeze({ level: 90, atkLv: 90, resistances: {} });

// Flat-stat roll magnitudes (one mid roll), matching the template package.
const FLAT_ROLL = Object.freeze({ atk: 45, hp: 470, def: 55 });

const RATIO_PROP = { atk: PROP.ATK_RATIO, hp: PROP.HP_RATIO, def: PROP.DEF_RATIO };
const FLAT_PROP = { atk: PROP.ATK_FLAT, hp: PROP.HP_FLAT, def: PROP.DEF_FLAT };

/**
 * The rollable substat pool for a given scaling stat. Each entry knows how to
 * inject one roll (propId/addType/value) and its weight key for labelling.
 * `value` is in the unit the stat resolver expects (percentage points for %
 * stats, flat units for flat stats).
 */
export function substatPool(scaling = 'atk') {
    const ratioProp = RATIO_PROP[scaling] ?? PROP.ATK_RATIO;
    const flatProp = FLAT_PROP[scaling] ?? PROP.ATK_FLAT;
    const ratioKey = `${scaling}Ratio`;
    return [
        { key: 'critRate', propId: PROP.CRIT_RATE, addType: 1, value: rollValueOf('critRate'), isPercent: true },
        { key: 'critDmg', propId: PROP.CRIT_DMG, addType: 1, value: rollValueOf('critDmg'), isPercent: true },
        { key: ratioKey, propId: ratioProp, addType: 2, value: rollValueOf('atkRatio'), isPercent: true },
        { key: `${scaling}Flat`, propId: flatProp, addType: 1, value: FLAT_ROLL[scaling] ?? 45, isPercent: false },
        { key: 'energyRegen', propId: PROP.ENERGY_REGEN, addType: 1, value: rollValueOf('energyRegen'), isPercent: true },
        { key: 'dmgBonus.basic', propId: PROP.DMG_BASIC, addType: 1, value: rollValueOf('dmgBonus.basic'), isPercent: true },
        { key: 'dmgBonus.heavy', propId: PROP.DMG_HEAVY, addType: 1, value: rollValueOf('dmgBonus.heavy'), isPercent: true },
        { key: 'dmgBonus.skill', propId: PROP.DMG_SKILL, addType: 1, value: rollValueOf('dmgBonus.skill'), isPercent: true },
        { key: 'dmgBonus.liberation', propId: PROP.DMG_LIBERATION, addType: 1, value: rollValueOf('dmgBonus.liberation'), isPercent: true },
    ];
}

const tag = (key) => `alloc:${key}`;

// Append one roll of `stat` onto echo slot 0 (substats sum globally, so the slot
// is irrelevant to the resolved stats — see live-weights.js). Stores the running
// count in the synthetic substat's value so repeated rolls accumulate.
function addRoll(build, stat, count) {
    const echoes = build.echoes.slice();
    const idx = echoes.findIndex(Boolean);
    if (idx < 0) return build;
    const t = tag(stat.key);
    const sub = { propId: stat.propId, addType: stat.addType, value: stat.value * count, isPercent: stat.isPercent, __synthetic: t };
    const subStats = [...(echoes[idx].subStats ?? []).filter(s => s.__synthetic !== t), sub];
    echoes[idx] = { ...echoes[idx], subStats };
    return { ...build, echoes };
}

function damageOf(build, dataset, target) {
    return simulateRotation({ build, dataset, target }).totals?.damage ?? 0;
}

/**
 * Greedily allocate `budget` substat rolls onto `baseBuild` (whose echoes carry
 * mains/sonata/weapon but no co-optimized substats yet).
 *
 * @param {object} args
 * @param {object} args.baseBuild     — build with mains+sonata+weapon+rotation set
 * @param {object} args.dataset
 * @param {string} [args.scaling='atk']
 * @param {object} [args.target]
 * @param {number} [args.budget=25]   — total rolls to distribute
 * @param {number} [args.perStatCap=10] — max rolls of any single stat
 * @returns {{ counts:Record<string,number>, build:object, damage:number, base:number }}
 */
export function allocateSubstats({ baseBuild, dataset, scaling = 'atk', target = DEFAULT_TARGET, budget = 25, perStatCap = 10 }) {
    const pool = substatPool(scaling);
    const counts = {};
    let build = baseBuild;
    let cur = damageOf(build, dataset, target);
    const base = cur;

    for (let n = 0; n < budget; n++) {
        let bestStat = null, bestGain = 0, bestBuild = null;
        for (const stat of pool) {
            const used = counts[stat.key] ?? 0;
            if (used >= perStatCap) continue;
            const trial = addRoll(build, stat, used + 1);
            const gain = damageOf(trial, dataset, target) - cur;
            if (gain > bestGain + 1e-6) { bestStat = stat; bestGain = gain; bestBuild = trial; }
        }
        if (!bestStat) break;   // no roll gives a positive marginal — stop (leaves CR at cap, etc.)
        build = bestBuild;
        cur += bestGain;
        counts[bestStat.key] = (counts[bestStat.key] ?? 0) + 1;
    }

    return { counts, build, damage: cur, base };
}

/**
 * Render an allocation's counts into clean per-echo substat descriptors in the
 * given cost layout, for storing in the meta as a suggested substat target.
 * One synthetic substat per stat carrying its total rolled value (display only —
 * the stat resolver sums them identically regardless of distribution).
 *
 * @returns {Array<{propId,addType,value,isPercent,rolls,key}>}
 */
export function allocationToSubstats(counts, scaling = 'atk') {
    const pool = substatPool(scaling);
    const byKey = new Map(pool.map(s => [s.key, s]));
    return Object.entries(counts)
        .filter(([, rolls]) => rolls > 0)
        .map(([key, rolls]) => {
            const s = byKey.get(key);
            return { propId: s.propId, addType: s.addType, value: s.value * rolls, isPercent: s.isPercent, rolls, key };
        });
}
