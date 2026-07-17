// tools/preprocess/weapons.mjs — weapon projection (Dimbreath + nanoka) and weapon growth curves.
// Split from the monolithic preprocess.mjs (Simplification Plan S4.1);
// bodies moved verbatim — LOCK A (byte-identical wuwa-data.json) verifies.
import { WEAPON_TYPES } from './constants.mjs';
import { iconUrlFor } from './download.mjs';
import { cleanText } from './text.mjs';

// =============================================================================
// Weapons
// =============================================================================

export function weaponStat(propWrapper, propDict) {
    if (!propWrapper || !propWrapper.Id) return null;
    const prop = propDict[propWrapper.Id];
    return {
        propId: propWrapper.Id,
        name: prop ? prop.name : `Prop ${propWrapper.Id}`,
        baseValue: propWrapper.Value ?? 0,
        isPercent: prop ? prop.isPercent : !!propWrapper.IsRatio,
    };
}

export function projectWeapon(weapon, resolveText, propDict) {
    const name = cleanText(resolveText(weapon.WeaponName));
    if (!name) return null;
    if (weapon.IsShow === false) return null;
    return {
        id: weapon.ItemId,
        name,
        type: weapon.WeaponType,
        typeName: WEAPON_TYPES[weapon.WeaponType] ?? 'Unknown',
        rarity: weapon.QualityId,
        baseStat: weaponStat(weapon.FirstPropId, propDict),
        subStat:  weaponStat(weapon.SecondPropId, propDict),
        // Curve IDs index into dataset.weaponGrowthCurves to scale stats
        // up from their level-1 baseValue to the player's chosen level.
        baseCurveId: weapon.FirstCurve,
        subCurveId:  weapon.SecondCurve,
        maxRank:  weapon.ResonLevelLimit ?? 5,
        description: cleanText(resolveText(weapon.Desc)) || undefined,
        iconUrl: iconUrlFor(name, weapon.ItemId, 'weapons'),
    };
}

// nanoka weapon sub-stat display name → engine propId + normalization.
// All values come pre-resolved per level from the nanoka detail file, so
// we just need the propId. The "is_percent" flag in the data tells us
// whether to divide by 10000 (percent stored as e.g. 2430 = 24.30%).
export const NANOKA_STAT_NAME = {
    'ATK':          { propId: 7,     key: 'atk',         percent: false },
    'HP':           { propId: 1,     key: 'hp',          percent: false },
    'DEF':          { propId: 3,     key: 'def',         percent: false },
    'Crit. Rate':   { propId: 8,     key: 'critRate',    percent: true  },
    'Crit. DMG':    { propId: 9,     key: 'critDmg',     percent: true  },
    'Energy Regen': { propId: 11,    key: 'energyRegen', percent: true  },
    'ATK%':         { propId: 10007, key: 'atkPct',      percent: true  },
    'HP%':          { propId: 10002, key: 'hpPct',       percent: true  },
    'DEF%':         { propId: 10010, key: 'defPct',      percent: true  },
};

// The nanoka detail file mislabels a weapon's %-scaling substat with the
// flat-stat's own name (e.g. a substat entry named "ATK" that is really
// ATK%) — `is_ratio: true` is the only signal this entry is actually the
// percent variant, never the base stat itself (base ATK is always index 0
// and always is_ratio:false). Confirmed against every weapon: the combo
// `{name: ATK|HP|DEF, is_ratio: true}` only ever appears as a substat, and
// its `value` is already the resolved fraction (unlike the true
// is_percent encoding, which stores hundredths-of-percent and needs /10000).
export const RATIO_ALIAS = { ATK: 'ATK%', HP: 'HP%', DEF: 'DEF%' };

export function resolveNanokaStat(stat) {
    const name = (stat.is_ratio && RATIO_ALIAS[stat.name]) || stat.name;
    const def = NANOKA_STAT_NAME[name];
    if (!def) return null;
    const value = stat.is_ratio ? stat.value : (def.percent ? stat.value / 10000 : stat.value);
    return { key: def.key, value };
}

// Thin projection (index only — no per-level stats).
export function projectNanokaWeapon(id, entry) {
    if (!entry.en) return null;
    return {
        id,
        name:     entry.en,
        type:     entry.type ?? 0,
        typeName: WEAPON_TYPES[entry.type] ?? 'Unknown',
        rarity:   entry.rank ?? 5,
        iconUrl:  iconUrlFor(entry.en, id, 'weapons'),
        source:   'nanoka',
    };
}

// Full projection from data/extracted-nanoka/weapons/{id}.json.
// nanoka stats[phase][level] = [ {name, value, is_ratio, is_percent}, ... ]
// where index 0 = base stat (always ATK), index 1 = sub stat.
// We build a flat statsByLevel: { [level]: { atk, critRate, ... } } using
// the highest-phase value at each level (post-ascension wins).
export function projectNanokaWeaponFull(nWeapon) {
    const id = nWeapon.id;
    const statsByLevel = {};

    for (const [_phase, levels] of Object.entries(nWeapon.stats ?? {})) {
        for (const [lvStr, statArr] of Object.entries(levels)) {
            const level = Number(lvStr);
            const resolved = {};
            for (const rawStat of statArr) {
                const stat = resolveNanokaStat(rawStat);
                if (!stat) continue;
                resolved[stat.key] = stat.value;
            }
            // Higher phase wins at shared breakpoint levels (e.g. Lv80 in phase 5 vs 6)
            if (!statsByLevel[level] || (resolved.atk ?? 0) >= (statsByLevel[level].atk ?? 0)) {
                statsByLevel[level] = resolved;
            }
        }
    }

    // Identify the sub-stat name (index 1 of any level's stat array) — apply
    // the same is_ratio alias so a mislabeled "ATK" substat reports as ATK%.
    const sampleArr = nWeapon.stats?.['0']?.['1'] ?? [];
    const subEntry  = sampleArr[1] ?? null;
    const subName   = subEntry ? ((subEntry.is_ratio && RATIO_ALIAS[subEntry.name]) || subEntry.name) : null;

    return {
        id,
        name:     nWeapon.name,
        type:     nWeapon.type ?? 0,
        typeName: WEAPON_TYPES[nWeapon.type] ?? 'Unknown',
        rarity:   nWeapon.rarity ?? 5,
        subStatName: subName,
        statsByLevel,                         // { [level]: { atk, critRate, ... } }
        effect:     nWeapon.effect ?? undefined,
        effectName: nWeapon.effect_name ?? undefined,
        effectParams: nWeapon.param ?? undefined,   // [ [R1..R5], ... ] per placeholder
        iconUrl:    iconUrlFor(nWeapon.name, id, 'weapons'),
        source:     'nanoka',
    };
}

// WeaponPropertyGrowth maps (curveId, level) → multiplier (10000 = 1.0x).
// Each weapon has FirstCurve + SecondCurve indices selecting which curve
// scales its base stat / sub stat. Returned shape:
//   { '1': { 1: 1.0, 2: 1.08, ... 90: 4.05 }, '2': { ... } }
export function projectWeaponGrowthCurves(weaponGrowth) {
    const curves = {};
    for (const row of weaponGrowth) {
        const cid = row.CurveId;
        if (!curves[cid]) curves[cid] = {};
        curves[cid][row.Level] = row.CurveValue / 10000;
    }
    return curves;
}
