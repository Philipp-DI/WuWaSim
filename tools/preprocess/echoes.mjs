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

    // A team ATK grant whose value is written LITERALLY, not as a {N} param.
    // Fallacy of No Return is the only echo that does this — "all team members
    // 10% bonus ATK for 20s" — so there is no param column to read and the
    // number has to come from the sentence. It does not scale with echo level
    // for the same reason.
    const literalAtk = desc.match(
        /\b(?:all\s+)?team\s+members?\s+(\d+(?:\.\d+)?)\s*%\s*(?:bonus\s+)?ATK\b/i);
    if (literalAtk) {
        const percent = parseFloat(literalAtk[1]);
        const seconds = parseFloat(desc.slice(literalAtk.index).match(/for\s+(\d+(?:\.\d+)?)\s*s/i)?.[1]);
        if (Number.isFinite(percent) && percent > 0) {
            return { atkRatio: percent / 100, ...(Number.isFinite(seconds) ? { duration: seconds } : {}) };
        }
    }

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

// Element word → elementId, the same 1..6 the rest of the pipeline uses.
const ECHO_ELEMENTS = Object.freeze({
    glacio: 1, fusion: 2, electro: 3, aero: 4, spectro: 5, havoc: 6,
});

/**
 * An echo skill that hands a buff to the INCOMING resonator on the Outro swap.
 *
 * Four echoes do this and NONE was modelled: Glommoth and Reminiscence: Denia
 * (12% element DMG Bonus), Hyvatia (10% All-Attribute) and Voidwing Moth (12%
 * ATK). They were missed because the only echo buff the pipeline read was the
 * TEAM-wide `DMG Boost` shape — "grants … to the incoming Resonator" matches
 * none of that wording, so a whole transfer lane scored zero in silence.
 *
 * Values come from the PARAM LADDER, not the sentence: `{2}` and `{3}` index
 * `params[level]`, exactly as the weapon lane reads `effectParams[rank-1]`. The
 * MAX level is used because a build equips a maxed echo — matching the cooldown
 * reader above, and unlike `extractEchoTeamBuff`, which reads level 1 (harmless
 * only because Bell-Borne's buff params happen not to scale).
 *
 * Returns null unless the clause names the incoming resonator AND a stat this
 * engine models AND resolves to a real percentage — an unreadable clause
 * contributes nothing rather than a guess.
 */
export function extractEchoIncomingBuff(desc, params) {
    if (!desc || !Array.isArray(params) || !params.length) return null;
    const maxLevel = params[params.length - 1];
    if (!Array.isArray(maxLevel)) return null;

    const sentence = desc.split(/(?<=[.!])\s+|\n+/)
        .find(part => /\b(incoming|next)\s+Resonator\b/i.test(part));
    if (!sentence) return null;

    // Both orders the game writes, and the STAT is named explicitly rather than
    // matched as "any word after a placeholder" — the loose form latches onto
    // the `{1}s` of "within {1}s after summoning" and reads the stat as "s".
    const STAT = String.raw`(All-Attribute\s+DMG\s+Bonus|(?:Glacio|Fusion|Electro|Aero|Spectro|Havoc)\s+DMG(?:\s+Bonus)?|ATK)`;
    const match = sentence.match(new RegExp(String.raw`\{(\d+)\}\s*` + STAT, 'i'))
        || sentence.match(new RegExp(String.raw`\b(?:incoming|next)\s+Resonator(?:'s)?\s+` + STAT + String.raw`\s+by\s+\{(\d+)\}`, 'i'));
    if (!match) return null;
    const [rawIndex, rawStat] = /^\d+$/.test(match[1]) ? [match[1], match[2]] : [match[2], match[1]];

    const percent = parseFloat(maxLevel[Number(rawIndex)]);
    if (!Number.isFinite(percent) || percent <= 0) return null;

    const stat = String(rawStat).toLowerCase();
    let bucket = null, elementId = null;
    if (/all-attribute/.test(stat)) bucket = 'dmgAll';
    else if (/\batk\b/.test(stat)) bucket = 'atkRatio';
    else {
        for (const [name, id] of Object.entries(ECHO_ELEMENTS)) {
            if (stat.includes(name)) { bucket = 'dmgElement'; elementId = id; break; }
        }
    }
    if (!bucket) return null;

    // "for {3}s" — the buff's own life on the receiver; and "within {1}s after"
    // — how long the wielder has to Outro. Both are recorded; only the first is
    // used today, the window is carried for when uptime is modelled.
    const durationIndex = sentence.match(/for\s+\{(\d+)\}\s*s/i)?.[1];
    const windowIndex = desc.match(/within\s+\{(\d+)\}\s*s/i)?.[1];
    const readIndex = (index) => {
        const value = index != null ? parseFloat(maxLevel[Number(index)]) : NaN;
        return Number.isFinite(value) ? value : null;
    };
    return {
        bucket,
        ...(elementId != null ? { elementId } : {}),
        value: percent / 100,
        duration: readIndex(durationIndex),
        windowSeconds: readIndex(windowIndex),
    };
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
                ...((() => { const incoming = extractEchoIncomingBuff(skill.desc, skill.param); return incoming ? { incomingBuff: incoming } : {}; })()),
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

/**
 * The MAIN-SLOT passive an echo grants its wielder — "The Resonator with this
 * Echo equipped in the main slot gains 12% Fusion DMG Bonus and 12% Resonance
 * Liberation DMG Bonus."
 *
 * This is a large, always-on buff source the pipeline read NOTHING of: 35
 * echoes state one and the engine credited zero, so every carry running a
 * cost-4 main echo was short roughly 12% element DMG plus 12% skill-type DMG.
 *
 * ── The two sources, and why BOTH are needed ────────────────────────────────
 * VALUES come from the game (`data/external-buffs.json` echoes, keyed by the
 * skill's `settleId`), because the tables state each grant as its own attribute
 * row and the sentence states only a formatted percentage. The extractor takes
 * DIRECT rows of `PhantomSkill.BuffEffects` only, which is what separates an
 * always-on main-slot buff from a triggered one — a conditional buff sits
 * behind an `ExtraEffectID 2` chain instead.
 *
 * The GATE comes from the description, because ConfigDB has none. Sigillum's
 * 25% Resonance Liberation row is identical in shape to Lioness of Glory's 12%,
 * and only its sentence says "When equipped in the main slot BY AEMEATH".
 *
 * ── The cross-check is the safety net ──────────────────────────────────────
 * A grant set is credited only when its VALUES equal the percentages the
 * main-slot sentence itself states, as a multiset. Two independent sources
 * agreeing is the whole warrant, and it refuses exactly the cases that would
 * otherwise be wrong:
 *   - Glacio Dreadmane has a 20% Glacio row and NO main-slot sentence — that
 *     row is its mid-air damage bonus, not a passive.
 *   - Reminiscence: Fleurdelys ships THREE 10% Aero rows for a sentence stating
 *     one, the rest being its "Rover: Aero or Cartethyia" branch.
 *   - Twin Nova: Collapsar Blade ships three rows for two stated values.
 *   - Reminiscence - Nightmare: Adam Smasher is gated on Lucy or Rebecca.
 *   - Nightmare: Lampylumen Myriad states a Coordinated Attack DMG bonus that
 *     is not an attribute row at all.
 * 30 of the 35 match exactly; the five above are left uncredited rather than
 * guessed at.
 *
 * @param {object} activeSkill  — the echo's own activeSkill (desc + params)
 * @param {object} entry        — externalBuffs.echoes[settleId], or null
 * @param {Array}  roster       — dataset resonators, for the name gate
 * @returns {{grants, requiresResonatorId}|null}
 */
const MAIN_SLOT_RE = /equipped in (?:the|their) main slot/i;

export function extractEchoMainSlotBuffs(activeSkill, entry, roster = []) {
    const grants = entry?.grants ?? [];
    if (!grants.length) return null;
    const sentence = String(activeSkill?.desc ?? '')
        .split(/\n+|(?<=[.!])\s+/)
        .find(part => MAIN_SLOT_RE.test(part));
    if (!sentence) return null;

    // The sentence's own values, resolved through the MAX-level param ladder —
    // a build equips a maxed echo, matching every other reader in this file.
    const params = activeSkill?.params?.[activeSkill.params.length - 1];
    if (!Array.isArray(params)) return null;
    const stated = [];
    for (const match of sentence.matchAll(/\{(\d+)\}/g)) {
        const percent = String(params[Number(match[1])] ?? '').match(/^([\d.]+)\s*%/);
        if (percent) stated.push(Math.round(Number(percent[1]) * 1e4) / 1e6);
    }
    const asKey = (values) => values
        .map(value => Math.round(value * 1e6))
        .sort((left, right) => left - right)
        .join(',');
    if (asKey(stated) !== asKey(grants.map(grant => grant.value))) return null;

    // "…by Aemeath" / "When Lucy or Rebecca has this Echo…" — the restriction
    // lives only in the sentence. One echo states one today (Sigillum); an echo
    // naming SEVERAL is not modelled and is refused above by the value check.
    // Plain substring, not a word-boundary regex: roster names carry colons and
    // apostrophes ("Rover: Aero", "Luuk Herssen"), which a regex would have to
    // escape for no gain — no roster name is a prefix of another.
    const named = roster.filter(resonator => sentence.includes(resonator.name));
    if (named.length > 1) return null;

    return {
        grants: grants.map(grant => ({
            attribute: grant.attribute,
            attributeName: grant.attributeName ?? null,
            value: grant.value,
        })),
        ...(named.length === 1 ? { requiresResonatorId: named[0].id } : {}),
    };
}
