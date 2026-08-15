/**
 * P12 — shared sim-evaluation helpers for the optimizer.
 *
 * Single place that (a) runs the headless sim and returns total rotation
 * damage, and (b) perturbs one stat by injecting a synthetic substat onto the
 * anchor. Both the weight gradients (§4) and the ER-scaling detection (§3b)
 * perturb exactly one stat at a time and read the damage slope, so they share
 * this. The optimizer "consumes the engine; it never modifies damage logic"
 * (§13.1) — perturbation is just a normal build mutation fed back through the
 * unchanged sim.
 */

import { simulateRotation } from '../../src/core/sim.js';
import { PROP } from '../../src/core/stats.js';
import { DEFAULT_TARGET } from '../../src/core/target.js';

// ~~`{ level: 90, atkLv: 90, resistances: {} }`~~ — a 0%-RES dummy, while every
// UI surface sims against 10% RES. The optimizer's own rankings were unharmed
// (a uniform ×0.93 reorders nothing), but the DAMAGE it published to the build
// page could never match the team page it links to. One enemy now, defined in
// core/target.js.
const TARGET = DEFAULT_TARGET;

/** Total expected rotation damage for a build (the optimizer's objective). */
export function totalDamage(build, dataset, target = TARGET) {
    return simulateRotation({ build, dataset, target }).totals.damage;
}

// The perturbable weight set (§4a). `propId`/`addType`/`isPercent` describe how
// the stat is injected as a substat; `key` is its meta/weight identifier.
// elementId is filled per-resonator for the element DMG-bonus entry.
export function weightStatSet(elementId) {
    return [
        { key: 'critRate',          propId: PROP.CRIT_RATE,      addType: 1, isPercent: true },
        { key: 'critDmg',           propId: PROP.CRIT_DMG,       addType: 1, isPercent: true },
        // All three scaling ratios, matching src/core/substat-allocate.js and
        // src/core/live-weights.js: a kit scales off whatever its damage rows
        // name, and seven resonators are mostly or entirely off-ATK. Every
        // meta-covered anchor is currently ATK-scaling, so these two contribute
        // exact zeros today and are dropped by derivePriority's NEAR_ZERO
        // filter — they exist so the set stops being wrong the day an HP or DEF
        // scaler becomes an anchor (2026-07-31).
        { key: 'atkRatio',          propId: PROP.ATK_RATIO,      addType: 2, isPercent: true },
        { key: 'hpRatio',           propId: PROP.HP_RATIO,       addType: 2, isPercent: true },
        { key: 'defRatio',          propId: PROP.DEF_RATIO,      addType: 2, isPercent: true },
        { key: 'dmgBonus.basic',    propId: PROP.DMG_BASIC,      addType: 1, isPercent: true },
        { key: 'dmgBonus.heavy',    propId: PROP.DMG_HEAVY,      addType: 1, isPercent: true },
        { key: 'dmgBonus.skill',    propId: PROP.DMG_SKILL,      addType: 1, isPercent: true },
        { key: 'dmgBonus.liberation', propId: PROP.DMG_LIBERATION, addType: 1, isPercent: true },
        { key: `dmgBonus.element`,  propId: PROP.DMG_ELEMENT_BASE + elementId, addType: 1, isPercent: true },
        { key: 'energyRegen',       propId: PROP.ENERGY_REGEN,   addType: 1, isPercent: true },
    ];
}

/**
 * Return a copy of `build` with `value` (display percent, e.g. 1 = +1%) of the
 * given stat injected as a synthetic substat on echo slot 0. Repeated injects
 * of the same propId replace each other (so +δ then −δ doesn't accumulate).
 */
export function injectStat(build, { propId, addType, isPercent }, value) {
    const echoes = build.echoes.slice();
    const slot0 = echoes[0];
    if (!slot0) return build;
    const tag = `perturb:${propId}`;
    const sub = { propId, addType, value, isPercent, __synthetic: tag };
    const subStats = [...(slot0.subStats ?? []).filter(sub => sub.__synthetic !== tag), sub];
    echoes[0] = { ...slot0, subStats };
    return { ...build, echoes };
}

export { TARGET };
