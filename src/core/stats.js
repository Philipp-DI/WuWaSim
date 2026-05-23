// src/core/stats.js
/**
 * Stat resolver — derives total stats from a Build + dataset.
 *
 * Output schema (TotalStats):
 *   {
 *     // Multiplicative-base offensive
 *     atk: number,        hp: number,       def: number,
 *     // Fractions (0..1+) — crit chance, crit damage multiplier
 *     critRate: number,   critDmg: number,
 *     // % bonuses applied in damage formula
 *     dmgBonusByElement: { [elementId]: fraction },
 *     dmgBonusBySkillType: { basic, heavy, skill, liberation, intro }: fraction,
 *     energyRegen: number,        // 1.0 = 100%
 *     healingBonus: number,
 *
 *     // Per-source breakdown for the UI's "show your math" panel
 *     breakdown: {
 *       resonatorBase: { atk, hp, def, critRate, critDmg },
 *       weaponBase:    { atk, plus: [...] },
 *       skillTree:     { ... },
 *       echoes:        { mainStats: [...], subStats: [...], summed: { ... } },
 *       sonatas:       { [id]: { pieces, applied: [...] } },
 *     },
 *   }
 *
 * Pure functions only — no DOM, no fetch, no global state. Given the
 * same Build + dataset, output is deterministic.
 */

import { SKILL_KEYS } from './build.js';

// =============================================================================
// Property ID constants — mirrors PropertyIndex / BaseProperty
// =============================================================================
// (Kept here as a constant so the damage engine never refers to a magic
// number. If the game ever renumbers, this is the single source of truth.)

export const PROP = Object.freeze({
    ATK_FLAT:   7,    // base ATK
    ATK_RATIO:  10007,// ATK% (when AddType=2 in echo stats)
    HP_FLAT:    2,    // base HP
    HP_RATIO:   10002,
    DEF_FLAT:   10,
    DEF_RATIO:  10010,
    CRIT_RATE:  8,
    CRIT_DMG:   9,
    ENERGY_REGEN: 11,

    // Element DMG bonuses — PROPID 22..27 cover Glacio..Havoc, 21 is Physical.
    DMG_PHYS:     21,
    DMG_ELEMENT_BASE: 21,   // add elementId for the others (22 = Glacio)

    // Skill-type DMG bonuses (additive within bucket)
    DMG_BASIC:       17,
    DMG_HEAVY:       18,
    DMG_SKILL:       14,
    DMG_LIBERATION:  19,
    DMG_INTRO:       0,     // there's no clean "Intro Skill DMG" prop in echoes

    HEALING_BONUS:   35,
});

// elementId 1..6 → PropertyIndex DMG-bonus id (22..27)
function dmgBonusPropForElement(elementId) {
    return 21 + elementId;  // 22..27
}

// =============================================================================
// Growth curve helpers
// =============================================================================

/**
 * Pick the max-breach row of the growth curve at the given level.
 * Levels 20/40/50/60/70/80 have a "pre-ascension" and "post-ascension"
 * row; for any displayed total stat the post-ascension row is correct
 * (the game shows the displayed stat at full breach).
 */
function curveAt(growthCurve, level) {
    const eligible = growthCurve.filter(g => g.level === level);
    if (eligible.length === 0) {
        // Defensive fallback: if exact level isn't in the curve, pick the
        // highest level ≤ requested.
        return growthCurve.filter(g => g.level <= level).pop() ?? null;
    }
    return eligible.reduce((best, g) => g.breach > best.breach ? g : best, eligible[0]);
}

function weaponCurveAt(curves, curveId, level) {
    const c = curves[String(curveId)];
    if (!c) return 1;
    return c[String(level)] ?? c[String(Math.min(level, 90))] ?? 1;
}

// =============================================================================
// Per-source contributions
// =============================================================================

function resonatorContribution(build, dataset) {
    const reso = dataset.resonators.find(r => r.id === build.resonatorId);
    if (!reso) return null;
    const base = dataset.baseStats?.[reso.propertyId];
    if (!base) return null;

    const growth = curveAt(dataset.growthCurve, build.level);
    if (!growth) return null;

    return {
        atk:      base.atk * growth.atkRatio,
        hp:       base.hp  * growth.hpRatio,
        def:      base.def * growth.defRatio,
        critRate: base.critRate,
        critDmg:  base.critDmg,
        energyRegen: base.energyRegen,
    };
}

function weaponContribution(build, dataset) {
    if (!build.weapon) return null;
    const w = dataset.weapons.find(x => x.id === build.weapon.id);
    if (!w) return null;

    const baseCurve = weaponCurveAt(dataset.weaponGrowthCurves, w.baseCurveId, build.weapon.level);
    const subCurve  = weaponCurveAt(dataset.weaponGrowthCurves, w.subCurveId,  build.weapon.level);

    const out = { atk: 0, hp: 0, def: 0, critRate: 0, critDmg: 0, energyRegen: 0, byProp: {} };

    if (w.baseStat) {
        applyWeaponStat(out, w.baseStat, baseCurve);
    }
    if (w.subStat) {
        applyWeaponStat(out, w.subStat, subCurve);
    }
    return out;
}

function applyWeaponStat(out, stat, multiplier) {
    const raw = stat.baseValue * multiplier;
    // Weapon stat values from WeaponConf follow the same convention as
    // BaseProperty: flat stats (ATK/HP/DEF) are in natural units; %-stats
    // (Crit Rate, Crit DMG, Energy Regen, %-ATK passives) are in
    // hundredths-of-percent (1080 = 10.80%, 4860 = 48.60%). We normalize
    // % values to 0..1 fractions so the damage engine never has to know
    // the source scaling.
    switch (stat.propId) {
        case PROP.ATK_FLAT:    out.atk      += raw; break;
        case PROP.HP_FLAT:     out.hp       += raw; break;
        case PROP.DEF_FLAT:    out.def      += raw; break;
        case PROP.ATK_RATIO:   out.atk      += raw; break;  // 10007: flat ATK on weapons
        case PROP.HP_RATIO:    out.hp       += raw; break;
        case PROP.DEF_RATIO:   out.def      += raw; break;
        case PROP.CRIT_RATE:   out.critRate += raw / 10000; break;  // 4860 → 0.486
        case PROP.CRIT_DMG:    out.critDmg  += raw / 10000; break;
        case PROP.ENERGY_REGEN:out.energyRegen += raw / 10000; break;
        default: break;  // other stats handled at the bonus level
    }
    out.byProp[stat.propId] = (out.byProp[stat.propId] || 0) + raw;
}

function skillTreeContribution(build, dataset) {
    const tree = dataset.skillTree?.[String(build.resonatorId)];
    if (!tree) return null;
    const out = { atkRatio: 0, hpRatio: 0, defRatio: 0, critRate: 0, critDmg: 0, byProp: {} };
    for (const [propId, slot] of Object.entries(tree)) {
        const id = Number(propId);
        switch (id) {
            case PROP.ATK_RATIO:   out.atkRatio += slot.ratio; break;
            case PROP.HP_RATIO:    out.hpRatio  += slot.ratio; break;
            case PROP.DEF_RATIO:   out.defRatio += slot.ratio; break;
            case PROP.CRIT_RATE:   out.critRate += slot.flat;  break;
            case PROP.CRIT_DMG:    out.critDmg  += slot.flat;  break;
            default: break;
        }
        out.byProp[id] = { flat: slot.flat, ratio: slot.ratio };
    }
    return out;
}

function echoContribution(build) {
    // Echoes (Phase 3) accept main/sub stats as plain {propId, addType, value}
    // tuples. AddType 1 = flat (in the value's natural units), AddType 2 =
    // percent (in the value's natural units, e.g. 30 = 30%).
    const out = {
        atkFlat: 0, atkRatio: 0,
        hpFlat: 0,  hpRatio: 0,
        defFlat: 0, defRatio: 0,
        critRate: 0, critDmg: 0,
        energyRegen: 0,
        healingBonus: 0,
        dmgByElement: {}, dmgBySkillType: { basic:0, heavy:0, skill:0, liberation:0, intro:0 },
        sonataCounts: {},
        mainStats: [], subStats: [],
    };

    for (const e of build.echoes) {
        if (!e) continue;
        if (e.sonataId != null) out.sonataCounts[e.sonataId] = (out.sonataCounts[e.sonataId] || 0) + 1;
        if (e.mainStat) applyEchoStat(out, e.mainStat, 'main');
        for (const s of e.subStats || []) applyEchoStat(out, s, 'sub');
    }
    return out;
}

function applyEchoStat(out, stat, kind) {
    if (!stat || stat.value == null) return;
    const pct  = stat.addType === 2;
    const v    = stat.value;
    const frac = pct ? v / 100 : v;

    (kind === 'main' ? out.mainStats : out.subStats).push(stat);

    switch (stat.propId) {
        case PROP.ATK_FLAT:
        case PROP.ATK_RATIO:
            if (pct || stat.propId === PROP.ATK_RATIO) out.atkRatio += frac;
            else                                        out.atkFlat  += v;
            break;
        case PROP.HP_FLAT:
        case PROP.HP_RATIO:
            if (pct || stat.propId === PROP.HP_RATIO) out.hpRatio += frac;
            else                                       out.hpFlat  += v;
            break;
        case PROP.DEF_FLAT:
        case PROP.DEF_RATIO:
            if (pct || stat.propId === PROP.DEF_RATIO) out.defRatio += frac;
            else                                        out.defFlat  += v;
            break;
        case PROP.CRIT_RATE:    out.critRate    += frac; break;
        case PROP.CRIT_DMG:     out.critDmg     += frac; break;
        case PROP.ENERGY_REGEN: out.energyRegen += frac; break;
        case PROP.HEALING_BONUS:out.healingBonus+= frac; break;
        case PROP.DMG_BASIC:      out.dmgBySkillType.basic      += frac; break;
        case PROP.DMG_HEAVY:      out.dmgBySkillType.heavy      += frac; break;
        case PROP.DMG_SKILL:      out.dmgBySkillType.skill      += frac; break;
        case PROP.DMG_LIBERATION: out.dmgBySkillType.liberation += frac; break;
        default:
            if (stat.propId >= 22 && stat.propId <= 27) {
                const elId = stat.propId - 21;
                out.dmgByElement[elId] = (out.dmgByElement[elId] || 0) + frac;
            }
            break;
    }
}

function sonataContribution(build, dataset, sonataCounts) {
    // For Phase 3 we surface which set effects are active. Their numeric
    // application is delegated to the damage engine where we can express
    // conditional / scaling effects. Here we just emit the structured
    // list for the breakdown panel.
    const out = {};
    for (const [idStr, count] of Object.entries(sonataCounts)) {
        const id = Number(idStr);
        const sonata = dataset.sonatas.find(s => s.id === id);
        if (!sonata) continue;
        const activeTiers = sonata.tiers.filter(t => count >= t.pieces);
        if (activeTiers.length === 0) continue;
        out[id] = { name: sonata.name, count, activeTiers };
    }
    return out;
}

// =============================================================================
// Public: resolveTotalStats(build, dataset) -> TotalStats
// =============================================================================

export function resolveTotalStats(build, dataset) {
    const reso   = resonatorContribution(build, dataset);
    const weapon = weaponContribution(build, dataset);
    const tree   = skillTreeContribution(build, dataset);
    const echoes = echoContribution(build);

    if (!reso) {
        return makeEmpty(`Resonator id ${build.resonatorId} or its base stats not in dataset.`);
    }

    // ATK = (resonatorBase + weaponBase + echoFlat) × (1 + tree.ratio + echo.ratio)
    const atkBase = reso.atk + (weapon?.atk ?? 0) + echoes.atkFlat;
    const hpBase  = reso.hp  + (weapon?.hp  ?? 0) + echoes.hpFlat;
    const defBase = reso.def + (weapon?.def ?? 0) + echoes.defFlat;

    const atkTotalRatio = 1 + (tree?.atkRatio ?? 0) + echoes.atkRatio;
    const hpTotalRatio  = 1 + (tree?.hpRatio  ?? 0) + echoes.hpRatio;
    const defTotalRatio = 1 + (tree?.defRatio ?? 0) + echoes.defRatio;

    const atk = atkBase * atkTotalRatio;
    const hp  = hpBase  * hpTotalRatio;
    const def = defBase * defTotalRatio;

    const critRate = reso.critRate + (weapon?.critRate ?? 0) + (tree?.critRate ?? 0) + echoes.critRate;
    const critDmg  = reso.critDmg  + (weapon?.critDmg  ?? 0) + (tree?.critDmg  ?? 0) + echoes.critDmg;
    const energyRegen = (reso.energyRegen ?? 1) + (weapon?.energyRegen ?? 0) + echoes.energyRegen;

    const sonatas = sonataContribution(build, dataset, echoes.sonataCounts);

    return {
        atk, hp, def,
        critRate,
        critDmg,
        energyRegen,
        healingBonus: echoes.healingBonus,
        dmgBonusByElement: { ...echoes.dmgByElement },
        dmgBonusBySkillType: { ...echoes.dmgBySkillType },

        breakdown: {
            resonatorBase: reso,
            weaponBase:    weapon,
            skillTree:     tree,
            echoes,
            sonatas,
            atkBase, hpBase, defBase,
            atkTotalRatio, hpTotalRatio, defTotalRatio,
        },
    };
}

function makeEmpty(error) {
    return {
        atk: 0, hp: 0, def: 0, critRate: 0, critDmg: 0, energyRegen: 1, healingBonus: 0,
        dmgBonusByElement: {}, dmgBonusBySkillType: { basic:0,heavy:0,skill:0,liberation:0,intro:0 },
        breakdown: { error },
        error,
    };
}

// =============================================================================
// Convenience formatters (used by UI; not in damage engine path)
// =============================================================================

export function formatStat(value, kind = 'flat') {
    if (kind === 'percent') return `${(value * 100).toFixed(1)}%`;
    return value >= 1000
        ? value.toFixed(0)
        : value.toFixed(1);
}

export const __test__ = { curveAt, weaponCurveAt, applyEchoStat };
