// tools/preprocess/base-stats.mjs — property dictionary, growth curves, damage/base-stat/skill-tree tables.
// Split from the monolithic preprocess.mjs (Simplification Plan S4.1);
// bodies moved verbatim — LOCK A (byte-identical wuwa-data.json) verifies.
import { cleanText } from './text.mjs';

// =============================================================================
// Property dictionary
// =============================================================================

// PropertyIndex Id -> { name, isPercent, key }. The UI uses this to
// label weapon stats. Note: the game stores some stats under multiple
// PropIds (e.g. flat ATK is 7, weapon ATK is also surfaced as 10007
// "Green ATK"). We keep them all addressable by id.
export function buildPropertyDict(propertyIndex, resolveText) {
    const dict = {};
    for (const prop of propertyIndex) {
        if (!prop.Id) continue;
        const name = cleanText(resolveText(prop.Name)) || prop.Key || `Prop ${prop.Id}`;
        dict[prop.Id] = {
            propId: prop.Id,
            name,
            isPercent: !!prop.IsPercent,
            key: prop.Key || '',
        };
    }
    return dict;
}

// A stat option = (propId, addType). AddType 2 turns flat into percent,
// so we synthesize the display label here once instead of letting the
// UI re-derive the rule.
export function makeStatOption(propId, addType, propDict) {
    const prop = propDict[propId];
    if (!prop) return null;
    const displayName = addType === 2 ? `${prop.name}%` : prop.name;
    return {
        propId,
        addType,
        name: displayName,
        isPercent: addType === 2 || prop.isPercent,
        key: prop.key,
    };
}

// =============================================================================
// Stat curve, base properties, skill tree
// =============================================================================

// RolePropertyGrowth is universal — same curve for every resonator.
// Ratios are integers scaled by 10,000 (10000 = 1.0x). We emit floats.
// One row per level (1..90); BreachLevel is implicit (max for that level).
export function projectGrowthCurve(growth) {
    return growth
        .slice()
        .sort((levelA, levelB) => levelA.Level - levelB.Level)
        .map(growth => ({
            level:      growth.Level,
            breach:     growth.BreachLevel,
            hpRatio:    growth.LifeMaxRatio / 10000,
            atkRatio:   growth.AtkRatio     / 10000,
            defRatio:   growth.DefRatio     / 10000,
        }));
}

// Damage.json is the master per-skill multiplier table — 7,979 rows, one
// per damage instance in the game. We project per-resonator skill entries
// to a lean shape: {id, roleId, element, type, related, mults[1..10]}.
//
// Each entry's `Id` is a float like 110703101.0 whose first 4 digits are
// the resonator id (1107). `RateLv[]` holds the multiplier at skill levels
// 1..10, scaled by 10,000.
//
// Filtering rules:
//   - Drop rows whose Id doesn't begin with a known resonator id
//   - Drop rows with all-zero RateLv (passives without an explicit multiplier)
//
// Output is grouped by roleId for cheap UI lookup:
//   { '1107': [ {id, element, type, relatedProp, mults: [0.27, 0.30, ...]} ], ... }
export function projectDamageTable(damage, knownRoleIds) {
    const out = {};
    const idSet = new Set(knownRoleIds.map(String));
    for (const row of damage) {
        const idStr = String(Math.trunc(row.Id));
        // Resonator id is the first 4 digits. Confirm against the known set.
        const prefix = idStr.slice(0, 4);
        if (!idSet.has(prefix)) continue;

        const rate = row.RateLv;
        if (!Array.isArray(rate) || rate.every(value => value === 0)) continue;

        if (!out[prefix]) out[prefix] = [];
        out[prefix].push({
            id: Number(idStr),
            element: row.Element ?? 0,
            type: row.Type ?? 0,
            relatedProp: row.RelatedProperty ?? 7,  // 7 = ATK by default
            mults: rate.map(value => value / 10000),         // length 10
        });
    }
    // Sort each group by id for stable output
    for (const k of Object.keys(out)) out[k].sort((rowA, rowB) => rowA.id - rowB.id);
    return out;
}

// Per-resonator base stats (level 1). PropertyId from RoleInfo joins
// directly here. We keep only the offensive/defensive fields the
// damage engine reads — drops ~60 unused stamina/swim/element-power
// fields per row — and only emit rows for known resonator PropertyIds
// (the source file has ~2400 entries for every entity in the game).
export function projectBaseStats(baseProperty, knownPropertyIds) {
    const propIdSet = new Set(knownPropertyIds);
    const out = {};
    for (const property of baseProperty) {
        if (property.Lv !== 1) continue;
        if (!propIdSet.has(property.Id)) continue;
        out[property.Id] = {
            propertyId: property.Id,
            hp:         property.LifeMax       ?? 0,
            atk:        property.Atk           ?? 0,
            def:        property.Def_          ?? 0,
            // Crit values are stored as integer hundredths-of-percent
            // (e.g. 500 = 5.00%). We normalize to a 0..1 fraction so
            // the damage engine never has to remember the scale.
            critRate:   (property.Crit         ?? 0) / 10000,
            critDmg:    (property.CritDamage   ?? 0) / 10000,
            energyRegen:(property.EnergyEfficiency ?? 10000) / 10000,
            energyMax:  (property.EnergyMax    ?? 0) / 100,
        };
    }
    return out;
}

// Skill-tree stat bonuses (the "inherent" passive nodes that activate
// at ascension milestones). Returned keyed by resonator id; each value
// is a flat map of {propId: {flat, ratio}} summed across all nodes.
//
// Note: this is the FULLY UNLOCKED bonus — every node assumed activated.
// Phase 4+ can let the user toggle individual node activation.
export function projectSkillTreeBonuses(skillTree) {
    const out = {};
    for (const node of skillTree) {
        if (node.NodeType !== 4) continue;       // 4 = stat-bonus node
        if (!Array.isArray(node.Property)) continue;
        const roleId = node.NodeGroup;
        if (!out[roleId]) out[roleId] = {};
        for (const prop of node.Property) {
            const propId = prop.Id;
            const slot = out[roleId][propId] ??= { flat: 0, ratio: 0 };
            if (prop.IsRatio) {
                slot.ratio += prop.Value;        // already a fraction (0.012 = 1.2%)
            } else {
                // Flat crit values are in hundredths-of-percent (120 = 1.20%).
                // Normalize the same way as BaseProperty for consistency.
                if (propId === 8 || propId === 9 || propId === 11) {
                    slot.flat += prop.Value / 10000;
                } else {
                    slot.flat += prop.Value;
                }
            }
        }
    }
    return out;
}
