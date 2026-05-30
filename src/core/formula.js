// src/core/formula.js
/**
 * Damage formula — pure, no DOM.
 *
 * Implements the consensus WuWa damage equation:
 *
 *   Final
 *   = BaseDmg × ResMult × DefMult × (1 - DmgReduction) × CritMult × BonusMult
 *
 *   where:
 *     BaseDmg  = (scalingStat × skillMultiplier + flatDmg) × (1 + flatBonus)
 *     BonusMult = (1 + dmgBonus) × (1 + amplify) × (1 + deepen)
 *     CritMult  = 1 + critRate × critDmg          (expected-value form)
 *               or 1 + critDmg if critRate >= 1   (guaranteed crit)
 *     DefMult   = (atkLv + 800)
 *                 / ((atkLv + 800) + (defLv + 800) × (1 - defShred) × (1 - defIgnore))
 *     ResMult   = piecewise:
 *                   resTotal <  0    : 1 - resTotal/2
 *                   0..0.8           : 1 - resTotal
 *                   >= 0.8           : 1 / (1 + 5 × resTotal)
 *
 * Output: a Damage object containing the final number AND a Breakdown
 * tree showing every multiplier on the way. The UI's "show your math"
 * panel renders directly from the Breakdown — never re-derives values.
 *
 * Sources:
 *   - WuWa Fandom wiki Damage formula module (community-maintained)
 *   - Prydwen calculator + wutheringwaves.gg cross-checks
 */

/**
 * Compute damage for a single skill cast.
 *
 * @param {object} args
 * @param {object} args.stats           - resolveTotalStats(build, dataset) output
 * @param {object} args.skill           - the skill being cast (multiplier, scaling, element, type)
 * @param {object} args.target          - enemy parameters
 * @param {object} [args.context]       - active buffs / situational modifiers
 * @returns {object}                    - { damage, crit, nonCrit, expected, breakdown }
 *
 * Skill shape:
 *   {
 *     name: 'Resonance Skill',
 *     skillType: 'skill' | 'basic' | 'heavy' | 'liberation' | 'intro',
 *     multiplier: 1.80,            // 180% scaling on ATK
 *     scaling: 'atk' | 'hp' | 'def',
 *     element: 1,                  // ElementId (1..6); 0 = Physical
 *     flat: 0,                     // optional flat damage component
 *   }
 *
 * Target shape:
 *   {
 *     level: 90,
 *     resistances: { [elementId]: fraction },   // 0.1 = 10% RES
 *     defShred: 0,                 // 0..1, multiplicative reduction of enemy DEF
 *     defIgnore: 0,
 *     dmgReduction: 0,             // 0..1, miscellaneous damage reduction
 *   }
 *
 * Context shape (all fields optional):
 *   {
 *     dmgBonus: 0,                 // additional flat-add buffs (e.g. weapon passive)
 *     amplify:  0,                 // separate amplify bucket (e.g. Concerto)
 *     deepen:   0,                 // deepen bucket (e.g. some sonatas)
 *     critRateBonus: 0, critDmgBonus: 0,
 *     scalingFlat: 0, scalingRatio: 0,   // adds/multiplies the scaling stat
 *   }
 */
export function computeDamage({ stats, skill, target, context = {} }) {
    if (!stats || stats.error) {
        return makeError(stats?.error || 'No stats');
    }
    if (!skill) return makeError('No skill');
    if (!target) return makeError('No target');

    // --- 1. Scaling stat -------------------------------------------------
    const scalingKey = skill.scaling ?? 'atk';
    const baseScale = (stats[scalingKey] ?? 0) + (context.scalingFlat ?? 0);
    const scale = baseScale * (1 + (context.scalingRatio ?? 0));

    // --- 2. Base DMG -----------------------------------------------------
    const flat = skill.flat ?? 0;
    const flatBonus = context.flatBonus ?? 0;
    const baseDmg = (scale * (skill.multiplier ?? 0) + flat) * (1 + flatBonus);

    // --- 3. DMG bonus bucket (additive within the bucket) ----------------
    const elementId = skill.element ?? 0;
    const elementDmg = stats.dmgBonusByElement?.[elementId] ?? 0;
    const typeDmg = stats.dmgBonusBySkillType?.[skill.skillType] ?? 0;
    const dmgBonus = elementDmg + typeDmg + (context.dmgBonus ?? 0);

    // --- 4. Amplify + deepen buckets -------------------------------------
    const amplify = context.amplify ?? 0;
    const deepen = context.deepen ?? 0;
    const bonusMult = (1 + dmgBonus) * (1 + amplify) * (1 + deepen);

    // --- 5. Crit ---------------------------------------------------------
    // WuWa convention: Crit DMG is the multiplier *applied on crit*, not
    // a bonus on top. Base 150% means a crit deals 1.5× the non-crit
    // damage. Source: Fandom wiki "Crit. DMG" article.
    const rawCritRate = (stats.critRate ?? 0) + (context.critRateBonus ?? 0);
    const critRate = Math.max(0, Math.min(1, rawCritRate));
    const critDmg = (stats.critDmg ?? 1.5) + (context.critDmgBonus ?? 0);
    const critMultExpected = 1 + critRate * (critDmg - 1);
    const critMultRolled = critDmg;        // crit hit
    const critMultMissed = 1;              // non-crit hit

    // --- 6. DEF mult -----------------------------------------------------
    const atkLv = target.atkLv ?? target.attackerLevel ?? 90;  // legacy alias
    const defLv = target.level ?? 90;
    const defShred = clamp01(context.defShred ?? target.defShred ?? 0);
    const defIgnore = clamp01(context.defIgnore ?? target.defIgnore ?? 0);
    const defMult = (atkLv + 800)
        / ((atkLv + 800)
            + (defLv + 800) * (1 - defShred) * (1 - defIgnore));

    // --- 7. RES mult (piecewise) ----------------------------------------
    const baseRes = target.resistances?.[elementId] ?? 0;
    const resReduce = context.resReduce ?? 0;
    const resTotal = baseRes - resReduce;
    const resMult = computeResMult(resTotal);

    // --- 8. Damage reduction --------------------------------------------
    const dmgReduction = clamp01(target.dmgReduction ?? 0);
    const reductionMult = 1 - dmgReduction;

    // --- 9. Combine ------------------------------------------------------
    const common = baseDmg * bonusMult * defMult * resMult * reductionMult;
    const nonCrit = common * critMultMissed;
    const critHit = common * critMultRolled;
    const expected = common * critMultExpected;

    return {
        damage: expected,        // alias for the common case
        nonCrit, crit: critHit, expected,
        breakdown: {
            scale, scalingKey, scalingFlat: context.scalingFlat ?? 0, scalingRatio: context.scalingRatio ?? 0,
            multiplier: skill.multiplier ?? 0,
            flat, flatBonus, baseDmg,
            elementId,
            elementDmg, typeDmg, dmgBonusContext: context.dmgBonus ?? 0, dmgBonus,
            amplify, deepen, bonusMult,
            critRate, critDmg,
            critMult: { expected: critMultExpected, rolled: critMultRolled, missed: critMultMissed },
            atkLv, defLv, defShred, defIgnore, defMult,
            baseRes, resReduce, resTotal, resMult,
            dmgReduction, reductionMult,
        },
    };
}

// --- Resistance multiplier — piecewise per consensus formula -----------
export function computeResMult(resTotal) {
    if (resTotal < 0) return 1 - resTotal / 2;     // bonus damage zone
    if (resTotal < 0.8) return 1 - resTotal;          // linear band
    return 1 / (1 + 5 * resTotal);                     // diminishing returns
}

function clamp01(x) {
    if (!Number.isFinite(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
}

function makeError(msg) {
    return {
        damage: 0, nonCrit: 0, crit: 0, expected: 0,
        breakdown: { error: msg },
        error: msg,
    };
}

export const __test__ = { clamp01 };

/**
 * Compute heal or shield output for a single supportTable row.
 *
 * Formula: flat + ratio × stat  (no crit, no resistance, no element)
 *
 * scalingStat mapping:
 *   'hp'  → stats.hp
 *   'atk' → stats.atk
 *   'def' → stats.def
 *   'er'  → flat + rawCoef × (stats.energyRegen × 100)  (Brant)
 *   'tuneAmp' → character-specific, returns 0 (unsupported flag set)
 *
 * @param {{ stats, row, skillLv }} args
 * @returns {{ value, flat, ratioAmount, scalingStat, rowType, unsupported? }}
 */
export function computeSupport({ stats, row, skillLv = 10 }) {
    if (!row || !stats) {
        return { value: 0, flat: 0, ratioAmount: 0, scalingStat: 'atk', rowType: 'heal' };
    }

    const idx = Math.max(0, Math.min((skillLv ?? 10) - 1, 19));
    const flat = row.flatsByLevel?.[idx] ?? 0;
    const ratio = row.ratiosByLevel?.[idx] ?? 0;
    const rawCoef = row.rawCoefsByLevel?.[idx] ?? 0;
    const { scalingStat = 'atk', rowType = 'heal' } = row;

    if (scalingStat === 'tuneAmp') {
        return { value: 0, flat: 0, ratioAmount: 0, scalingStat, rowType, unsupported: true };
    }

    if (scalingStat === 'er') {
        const erPct = (stats.energyRegen ?? 1) * 100;
        const ratioAmount = rawCoef * erPct;
        return { value: flat + ratioAmount, flat, ratioAmount, scalingStat, rowType };
    }

    const statValue = stats[scalingStat] ?? stats.atk ?? 0;
    const ratioAmount = ratio * statValue;
    return { value: flat + ratioAmount, flat, ratioAmount, scalingStat, rowType };
}