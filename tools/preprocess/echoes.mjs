// tools/preprocess/echoes.mjs — echo projection, echo main/sub-stat pools, echo team buffs.
// Split from the monolithic preprocess.mjs (Simplification Plan S4.1);
// bodies moved verbatim — LOCK A (byte-identical wuwa-data.json) verifies.
import {
    RARITY_TO_CLASS, RARITY_TO_COST, INTENSITY_TO_CLASS, INTENSITY_TO_COST,
    isEventLeftoverEcho,
} from './constants.mjs';
import { iconUrlFor } from './download.mjs';
import { cleanText } from './text.mjs';
import { makeStatOption } from './base-stats.mjs';

// Team-wide DMG Boost granted by an echo's shield/aura active skill (e.g.
// Bell-Borne Geochelone: "...provides {2} DMG Reduction and {3} DMG Boost for
// the current team members..."). A universal DMG amplification that reaches
// ALL team members and survives resonator switching (2026-07-15, maintainer-
// directed). The hit-count consume condition ("disappears after being hit N
// times") is enemy-dependent and ignored by direction. Rank-invariant across
// the roster → read rank 0; the "lasts for {i}s" duration is kept as metadata.
export function extractEchoTeamBuff(desc, params) {
    if (!desc || !Array.isArray(params) || !params.length) return null;
    const boostMatch = desc.match(/\{(\d+)\}\s*DMG Boost/i);
    if (!boostMatch) return null;
    // The boost must be granted to the TEAM (not merely the wielder).
    if (!/DMG Boost for (?:the )?(?:current )?(?:team members|all|nearby)/i.test(desc)) return null;
    const pct = parseFloat(params[0]?.[Number(boostMatch[1])]);
    if (!Number.isFinite(pct) || pct <= 0) return null;
    const durIdx = desc.match(/lasts? for \{(\d+)\}s/i)?.[1];
    const duration = durIdx != null ? parseFloat(params[0]?.[Number(durIdx)]) : null;
    return { dmgBoost: pct / 100, ...(Number.isFinite(duration) ? { duration } : {}) };
}

export function projectNanokaEchoFull(nEcho, indexEntry) {
    const monsterId = nEcho.id;
    const intensity = nEcho.intensity_code ?? indexEntry?.intensity ?? 0;
    const cost      = INTENSITY_TO_COST[intensity]  ?? 1;
    const className = INTENSITY_TO_CLASS[intensity] ?? 'Common';

    let activeSkill = null;
    const skill = nEcho.skill;
    if (skill?.damage) {
        const [settleId, dmg] = Object.entries(skill.damage)[0] ?? [];
        if (dmg) {
            // Echo Skill cooldown (2026-07-12): the desc's own "CD: {i}s" /
            // "Cooldown: {i}s" placeholder names which param column holds the
            // CD. Read from the last (max) rank — builds equip max-rank echoes.
            let cooldown;
            const cdIdx = skill.desc?.match(/(?:CD|Cooldown)[:\s]*\{(\d+)\}/i)?.[1];
            if (cdIdx != null) {
                const lastRank = skill.param?.[skill.param.length - 1];
                const secs = parseFloat(lastRank?.[Number(cdIdx)]);
                if (Number.isFinite(secs) && secs > 0) cooldown = secs;
            }
            activeSkill = {
                settleId:        Number(settleId),
                element:         dmg.element,
                relatedProperty: dmg.related_property ?? 'ATK',
                relatedPropId:   ({ 'ATK': 7, 'HP': 2, 'DEF': 10 })[dmg.related_property] ?? 7,
                rateByLevel:     (dmg.rate_lv ?? []).map(value => value / 10000),
                // Base Resonance Energy per cast, ÷100 like the character
                // per-hit `energy` fields (P13-fix convention, in-game
                // verified) — e.g. Vanguard Junrock raw 180 → 1.8. Echo
                // element_power is 0 across all 163 echoes (2026-07-12 scan):
                // echo casts generate NO Concerto, so no concerto field here.
                energyGain:      (dmg.energy ?? 0) / 100,
                ...(cooldown != null ? { cooldown } : {}),
                // Team-wide DMG Boost aura (Bell-Borne Geochelone etc.) — a flat
                // universal amplify applied to every team member (team-sim.js §L3).
                ...((() => { const teamBuff = extractEchoTeamBuff(skill.desc, skill.param); return teamBuff ? { teamBuff: teamBuff } : {}; })()),
                desc:            skill.desc ?? undefined,
                params:          skill.param ?? undefined,
            };
        }
    }

    const sonataIds = indexEntry?.group ?? Object.keys(nEcho.group ?? {}).map(Number);

    return {
        id:        monsterId,
        monsterId,
        name:      nEcho.name,
        cost,
        classRank: intensity,
        className,
        starLevel: 5,
        code:      nEcho.code ?? undefined,
        sonataIds,
        activeSkill,
        iconUrl:   iconUrlFor(nEcho.name, monsterId, 'echoes'),
        source:    'nanoka',
    };
}

// Dedupe phantoms to one entry per monster family. The same monster
// ships at four QualityId tiers under different ItemIds; for the
// build picker we want one row per family at the highest quality.
export function uniqueEchoFamilies(phantoms, resolveText) {
    const byFamily = new Map();
    for (const phantom of phantoms) {
        const name = cleanText(resolveText(phantom.MonsterName));
        if (!name) continue;
        if (!Object.hasOwn(RARITY_TO_COST, phantom.Rarity)) continue;
        if (phantom.ShowInBag === false) continue;
        if (isEventLeftoverEcho(phantom.ItemId)) continue;
        const existing = byFamily.get(name);
        if (!existing || (phantom.QualityId ?? 0) > (existing.QualityId ?? 0)) {
            byFamily.set(name, phantom);
        }
    }
    return [...byFamily.values()];
}

export function projectEcho(phantom, resolveText) {
    const name = cleanText(resolveText(phantom.MonsterName));
    return {
        id: phantom.ItemId,
        monsterId: phantom.MonsterId,
        name,
        cost: RARITY_TO_COST[phantom.Rarity],
        classRank: phantom.Rarity,            // 0..3 (Common→Calamity)
        className: RARITY_TO_CLASS[phantom.Rarity],
        starLevel: phantom.QualityId,         // in-game star rating (2..5)
        elementTypes: phantom.ElementType ?? [],
        sonataIds: phantom.FetterGroup ?? [],
        skillId: phantom.SkillId,
        iconUrl: iconUrlFor(name, phantom.MonsterId, 'echoes'),
    };
}

// =============================================================================
// Echo stat options
// =============================================================================

export function projectEchoMainStats(phantomMain, phantomGrowth, propDict) {
    // Build the growth curve: { level → multiplier }. All main stats share
    // GrowthId=1 (confirmed). Level 0 = 1.0×, Level 25 = 5.0×.
    const growthCurve = {};
    for (const growth of phantomGrowth) {
        growthCurve[growth.Level] = growth.Value / 10000;
    }

    // PhantomMainPropItem.Id encodes star quality and slot index:
    //   Id = starQuality × 1000 + slotIndex
    //
    // Slot ranges define the cost pool:
    //   1–6   = 4-cost (Calamity + Overlord): CR, CD, ATK%, HP%, DEF%, Healing
    //   7–16  = 3-cost (Elite): 6 elements + ATK%, HP%, DEF%, ER
    //   17–19 = 1-cost (Common): ATK%, HP%, DEF%
    //
    // CRITICAL: ATK%, HP%, DEF% appear in ALL THREE pools with different
    // StandardProperty values. Grouping by propId:addType alone collapses
    // them incorrectly. We MUST include cost in the grouping key.
    //
    // Output shape: { 4: [...], 3: [...], 1: [...] } — each list contains
    // stat entries with per-star scaling data for that cost tier only.

    function slotToCost(slot) {
        if (slot >= 1  && slot <= 6)  return 4;
        if (slot >= 7  && slot <= 16) return 3;
        if (slot >= 17 && slot <= 19) return 1;
        return null;
    }

    // Accumulate: Map<cost, Map<propId:addType, entry>>
    const byCost = { 4: new Map(), 3: new Map(), 1: new Map() };

    for (const mainRow of phantomMain) {
        const starTier = Math.floor(mainRow.Id / 1000);
        if (starTier < 2 || starTier > 5) continue;      // skip sub-mains (50001…)
        const slot = mainRow.Id % 1000;
        const cost = slotToCost(slot);
        if (!cost) continue;

        const key = `${mainRow.PropId}:${mainRow.AddType}`;
        const pool = byCost[cost];
        if (!pool.has(key)) {
            const opt = makeStatOption(mainRow.PropId, mainRow.AddType, propDict);
            if (!opt) continue;
            pool.set(key, { ...opt, standardValue: 0, scaling: {} });
        }
        const entry = pool.get(key);
        entry.scaling[starTier] = {
            standardProp: mainRow.StandardProperty,
            lv0:  computeMainStatDisplay(mainRow.StandardProperty, growthCurve[0],  mainRow.PropId, mainRow.AddType),
            lv25: computeMainStatDisplay(mainRow.StandardProperty, growthCurve[25], mainRow.PropId, mainRow.AddType),
        };
        if (starTier === 5) entry.standardValue = mainRow.StandardProperty;
    }

    // Convert to plain arrays, preserving insertion order (= slot order)
    return {
        4: [...byCost[4].values()],
        3: [...byCost[3].values()],
        1: [...byCost[1].values()],
    };
}

// Compute the display value (the number a user sees in-game) for a main stat.
// Percent stats: StandardProperty × multiplier / 100 = display percent (e.g. 22.0)
// Flat stats:    StandardProperty × multiplier rounded to integer
export function computeMainStatDisplay(standardProp, multiplier, propId, addType) {
    if (!multiplier) return 0;
    const scaled = standardProp * multiplier;
    const PERCENT_PROPS = new Set([8, 9, 35, 11, 22, 23, 24, 25, 26, 27]);
    if (addType === 2 || PERCENT_PROPS.has(propId)) {
        return Math.round(scaled / 100 * 10) / 10;  // 1 decimal place
    }
    return Math.round(scaled);
}

export function projectEchoSubStats(phantomSub, propDict) {
    const seen = new Set();
    const out = [];
    for (const subRow of phantomSub) {
        const propId = subRow.PropId ?? subRow.Id;
        const key = `${propId}:${subRow.AddType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const opt = makeStatOption(propId, subRow.AddType, propDict);
        if (opt) out.push({ ...opt, standardValue: subRow.SubStandardProperty });
    }
    return out;
}
