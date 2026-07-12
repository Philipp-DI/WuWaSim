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
import { possibleRollsFor } from './echo-rules.js';

const DEFAULT_TARGET = Object.freeze({ level: 90, atkLv: 90, resistances: {} });

// Flat-stat roll magnitudes (one mid roll), matching the template package.
const FLAT_ROLL = Object.freeze({ atk: 45, hp: 470, def: 55 });

const RATIO_PROP = { atk: PROP.ATK_RATIO, hp: PROP.HP_RATIO, def: PROP.DEF_RATIO };
// Flat ATK/HP/DEF substats share their ratio counterpart's propId, addType=1
// instead of 2 (stats.js's applyEchoStat: "ATK%/ATK both share propId 10007
// in newer data; distinguish via the ratio bucket/isPercent flag" — this is
// the convention the real echo-substat picker always writes, keyed off
// dataset.echoSubStats). The legacy PROP.ATK_FLAT/HP_FLAT/DEF_FLAT (7/2/10)
// is a separate, older encoding that stats.js still resolves correctly, but
// it has no entry in the substat catalog — a name lookup against it always
// misses, which is what left these substats without a display name.
const FLAT_PROP = RATIO_PROP;

const RATIO_ROLL_KEY = { atk: 'atkRatio', hp: 'hpRatio', def: 'defRatio' };

/**
 * The rollable substat pool for a given scaling stat. Each entry knows how to
 * inject one roll (propId/addType/value) and its weight key for labelling.
 * `value` is in the unit the stat resolver expects (percentage points for %
 * stats, flat units for flat stats).
 *
 * All three ratio stats (ATK%/HP%/DEF%) are real, always-rollable substat
 * options in this game — not just the character's own damage-scaling stat —
 * so all three are included unconditionally rather than pre-selecting one.
 * This lets the greedy search itself discover which ratio stat actually pays
 * (e.g. HP% for an HP-scaling healer under the 'heal' objective) instead of
 * baking that choice in ahead of time.
 *
 * @param {string} [scaling='atk'] — which ratio stat gets the flat-stat slot too
 * @param {object} [statRanges] — dataset.statRanges, for real per-roll magnitudes
 */
export function substatPool(scaling = 'atk', statRanges) {
    const flatProp = FLAT_PROP[scaling] ?? PROP.ATK_FLAT;
    const ratioEntries = Object.entries(RATIO_ROLL_KEY).map(([stat, key]) => ({
        key, propId: RATIO_PROP[stat], addType: 2, value: rollValueOf(key, statRanges), isPercent: true,
    }));
    return [
        { key: 'critRate', propId: PROP.CRIT_RATE, addType: 1, value: rollValueOf('critRate', statRanges), isPercent: true },
        { key: 'critDmg', propId: PROP.CRIT_DMG, addType: 1, value: rollValueOf('critDmg', statRanges), isPercent: true },
        ...ratioEntries,
        { key: `${scaling}Flat`, propId: flatProp, addType: 1, value: FLAT_ROLL[scaling] ?? 45, isPercent: false },
        { key: 'energyRegen', propId: PROP.ENERGY_REGEN, addType: 1, value: rollValueOf('energyRegen', statRanges), isPercent: true },
        { key: 'dmgBonus.basic', propId: PROP.DMG_BASIC, addType: 1, value: rollValueOf('dmgBonus.basic', statRanges), isPercent: true },
        { key: 'dmgBonus.heavy', propId: PROP.DMG_HEAVY, addType: 1, value: rollValueOf('dmgBonus.heavy', statRanges), isPercent: true },
        { key: 'dmgBonus.skill', propId: PROP.DMG_SKILL, addType: 1, value: rollValueOf('dmgBonus.skill', statRanges), isPercent: true },
        { key: 'dmgBonus.liberation', propId: PROP.DMG_LIBERATION, addType: 1, value: rollValueOf('dmgBonus.liberation', statRanges), isPercent: true },
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

// The metric a candidate roll is judged against. 'damage' (default) is right
// for MAIN_DPS/SUB_DPS/BUFFER roles — even a "support" typically has real own-
// cast damage (basic attacks, off-field contribution) that a marginal-gain
// search can still meaningfully optimize against. 'heal' is for HEALER-tagged
// kits whose own damage is often near-zero (Verina/Shorekeeper-style) — their
// real substat priority is governed by healing output, not damage, an
// objectively different metric, not a judgment call. A true team-DPS-uplift
// objective for pure buffers (optimizing the TEAM's damage, not their own)
// would require re-simulating the whole team per candidate roll — a materially
// larger capability, deliberately out of scope here.
function metricOf(build, dataset, target, objective) {
    const totals = simulateRotation({ build, dataset, target }).totals;
    return objective === 'heal' ? (totals?.heal ?? 0) : (totals?.damage ?? 0);
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
 * @param {'damage'|'heal'} [args.objective='damage']
 * @returns {{ counts:Record<string,number>, build:object, damage:number, base:number }}
 */
export function allocateSubstats({ baseBuild, dataset, scaling = 'atk', target = DEFAULT_TARGET, budget = 25, perStatCap = 10, objective = 'damage' }) {
    const pool = substatPool(scaling, dataset?.statRanges);
    const counts = {};
    let build = baseBuild;
    let cur = metricOf(build, dataset, target, objective);
    const base = cur;

    for (let n = 0; n < budget; n++) {
        let bestStat = null, bestGain = 0, bestBuild = null;
        for (const stat of pool) {
            const used = counts[stat.key] ?? 0;
            if (used >= perStatCap) continue;
            const trial = addRoll(build, stat, used + 1);
            const gain = metricOf(trial, dataset, target, objective) - cur;
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
export function allocationToSubstats(counts, scaling = 'atk', statRanges) {
    const pool = substatPool(scaling, statRanges);
    const byKey = new Map(pool.map(s => [s.key, s]));
    return Object.entries(counts)
        .filter(([, rolls]) => rolls > 0)
        .map(([key, rolls]) => {
            const s = byKey.get(key);
            return { propId: s.propId, addType: s.addType, value: s.value * rolls, isPercent: s.isPercent, rolls, key };
        });
}

/**
 * Render an allocation's counts into a REALISTIC 5-echo substat layout — one
 * line per stat per echo at its real single-roll magnitude, never the same
 * stat twice on one echo (the actual in-game rule: a substat line is ONE roll
 * assigned when its slot unlocks, not N stacked rolls of the same stat).
 * `allocateSubstats`'s internal search models "N rolls of stat X" as a single
 * stacked synthetic value for cheap marginal-gain search — this function is
 * what turns that back into a build a real player could actually have.
 * Requires `counts[key] <= echoCount` (the caller's `perStatCap` must respect
 * this) or a stat's rolls are silently truncated at the 5th echo.
 *
 * @param {Record<string,number>} counts
 * @param {string} [scaling='atk']
 * @param {object} [statRanges]
 * @param {number} [echoCount=5]
 * @param {number} [maxPerEcho=5]
 * @param {Array} [echoSubStats] — dataset.echoSubStats, the canonical substat
 *   catalog. Every OTHER path that puts a substat onto a build (the manual
 *   echo picker) attaches this catalog's `.name` alongside propId/addType —
 *   the build-editor's substat chips key off `.name` for their abbreviation/
 *   tooltip and throw without it. Optional only for callers that don't need
 *   display (e.g. pure damage re-simulation).
 * @returns {Array<Array<{propId,addType,value,isPercent,name}>>} one substat array per echo slot
 */
export function allocationToEchoSubstats(counts, scaling = 'atk', statRanges, echoCount = 5, maxPerEcho = 5, echoSubStats = []) {
    const pool = substatPool(scaling, statRanges);
    const byKey = new Map(pool.map(s => [s.key, s]));
    const nameFor = (propId, addType) =>
        echoSubStats.find(s => s.propId === propId && s.addType === addType)?.name ?? null;
    // The pool's `value` is the STAT'S AVERAGE roll (fair for the marginal-gain
    // search's stacked-synthetic math), not a real discrete roll a player could
    // ever land on — snapping to the nearest actual `possible_rolls` entry here
    // is what makes a materialized echo's value match one of the build editor's
    // tappable roll buttons (`rolls.indexOf(value)`), so it renders as selected
    // instead of silently matching nothing (2026-07-11).
    const snapToRoll = (stat) => {
        const rolls = possibleRollsFor(stat, statRanges);
        if (!rolls.length) return stat.value;
        return rolls.reduce((best, r) => Math.abs(r - stat.value) < Math.abs(best - stat.value) ? r : best, rolls[0]);
    };
    const perEcho = Array.from({ length: echoCount }, () => []);
    // Stable order (highest roll-value stat first) so a truncated stat is the
    // marginally least valuable one, not whichever happened to iterate last.
    const entries = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .sort((a, b) => (byKey.get(b[0])?.value ?? 0) - (byKey.get(a[0])?.value ?? 0));
    for (const [key, n] of entries) {
        const stat = byKey.get(key);
        if (!stat) continue;
        let placed = 0;
        for (let i = 0; i < echoCount && placed < n; i++) {
            if (perEcho[i].length >= maxPerEcho) continue;
            perEcho[i].push({
                propId: stat.propId, addType: stat.addType, value: snapToRoll(stat), isPercent: stat.isPercent,
                name: nameFor(stat.propId, stat.addType),
            });
            placed++;
        }
    }
    return perEcho;
}
