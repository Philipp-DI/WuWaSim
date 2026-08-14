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

import { subMainStatFor } from './echo-rules.js';
import { weaponPassiveStats } from './buffs/weapon-buffs.js';
import { weaponConditionalContribution, sonataConditionalContribution, emptyContribution } from './buffs/conditional-buffs.js';
import { foldExternalGrants } from './buffs/external-buffs.js';

// =============================================================================
// Property ID constants — mirrors PropertyIndex / BaseProperty
// =============================================================================
// (Kept here as a constant so the damage engine never refers to a magic
// number. If the game ever renumbers, this is the single source of truth.)

export const PROP = Object.freeze({
    ATK_FLAT: 7,    // base ATK
    ATK_RATIO: 10007,// ATK% (when AddType=2 in echo stats)
    HP_FLAT: 2,    // base HP
    HP_RATIO: 10002,
    DEF_FLAT: 10,
    DEF_RATIO: 10010,
    CRIT_RATE: 8,
    CRIT_DMG: 9,
    ENERGY_REGEN: 11,

    // Element DMG bonuses — PROPID 22..27 cover Glacio..Havoc, 21 is Physical.
    DMG_PHYS: 21,
    DMG_ELEMENT_BASE: 21,   // add elementId for the others (22 = Glacio)

    // Skill-type DMG bonuses (additive within bucket)
    DMG_BASIC: 17,
    DMG_HEAVY: 18,
    DMG_SKILL: 14,
    DMG_LIBERATION: 19,
    DMG_INTRO: 0,     // there's no clean "Intro Skill DMG" prop in echoes

    HEALING_BONUS: 35,
});

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
    const eligible = growthCurve.filter(row => row.level === level);
    if (eligible.length === 0) {
        // Defensive fallback: if exact level isn't in the curve, pick the
        // highest level ≤ requested.
        return growthCurve.filter(row => row.level <= level).pop() ?? null;
    }
    return eligible.reduce((best, row) => row.breach > best.breach ? row : best, eligible[0]);
}

function weaponCurveAt(curves, curveId, level) {
    const curve = curves[String(curveId)];
    if (!curve) return 1;
    return curve[String(level)] ?? curve[String(Math.min(level, 90))] ?? 1;
}

// =============================================================================
// Per-source contributions
// =============================================================================

function resonatorContribution(build, dataset) {
    const resonator = dataset.resonators.find(resonator => resonator.id === build.resonatorId);
    if (!resonator) return null;

    // ── Primary path: Dimbreath-derived baseStats + growth curve ─────────────
    const base = dataset.baseStats?.[resonator.propertyId];
    if (base) {
        const growth = curveAt(dataset.growthCurve, build.level);
        if (!growth) return null;
        return {
            atk: base.atk * growth.atkRatio,
            hp: base.hp * growth.hpRatio,
            def: base.def * growth.defRatio,
            critRate: base.critRate,
            critDmg: base.critDmg,
            energyRegen: base.energyRegen,
        };
    }

    // ── Fallback: nanoka-sourced resonator (new chars not yet in Dimbreath) ──
    // The resonator carries pre-computed stats at every level (statsByLevel)
    // and standard base crit/energy values.
    if (resonator.source === 'nanoka' && resonator.statsByLevel) {
        const levelStats = resonator.statsByLevel[build.level] ?? resonator.statsByLevel[90];
        if (!levelStats) return null;
        return {
            atk: levelStats.atk,
            hp: levelStats.hp,
            def: levelStats.def,
            critRate: resonator.baseCritRate ?? 0.05,
            critDmg: resonator.baseCritDmg ?? 1.50,
            energyRegen: resonator.baseEnergyRegen ?? 1.00,
        };
    }

    return null;
}

function weaponContribution(build, dataset) {
    if (!build.weapon) return null;
    const weapon = dataset.weapons.find(x => x.id === build.weapon.id);
    if (!weapon) return null;

    // ── nanoka-sourced weapon: stats are pre-resolved per level ──────────────
    if (weapon.source === 'nanoka' && weapon.statsByLevel) {
        const level = build.weapon.level ?? 90;
        const levelStats = weapon.statsByLevel[level] ?? weapon.statsByLevel[90];
        if (!levelStats) return null;
        const out = { atk: 0, hp: 0, def: 0, critRate: 0, critDmg: 0, energyRegen: 0, byProp: {} };
        // Flat stats
        out.atk += levelStats.atk ?? 0;
        out.hp += levelStats.hp ?? 0;
        out.def += levelStats.def ?? 0;
        // Percent stats (already normalized to 0..1 fractions in preprocess)
        out.critRate += levelStats.critRate ?? 0;
        out.critDmg += levelStats.critDmg ?? 0;
        out.energyRegen += levelStats.energyRegen ?? 0;
        // %-stats that feed the bonus layer (ATK%/HP%/DEF%)
        if (levelStats.atkPct) out.byProp[10007] = levelStats.atkPct;
        if (levelStats.hpPct) out.byProp[10002] = levelStats.hpPct;
        if (levelStats.defPct) out.byProp[10010] = levelStats.defPct;
        return out;
    }

    // ── Dimbreath-sourced weapon: apply growth curves ────────────────────────
    const baseCurve = weaponCurveAt(dataset.weaponGrowthCurves, weapon.baseCurveId, build.weapon.level);
    const subCurve = weaponCurveAt(dataset.weaponGrowthCurves, weapon.subCurveId, build.weapon.level);

    const out = { atk: 0, hp: 0, def: 0, critRate: 0, critDmg: 0, energyRegen: 0, byProp: {} };

    if (weapon.baseStat) {
        applyWeaponStat(out, weapon.baseStat, baseCurve);
    }
    if (weapon.subStat) {
        applyWeaponStat(out, weapon.subStat, subCurve);
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
        case PROP.ATK_FLAT: out.atk += raw; break;
        case PROP.HP_FLAT: out.hp += raw; break;
        case PROP.DEF_FLAT: out.def += raw; break;
        case PROP.ATK_RATIO: out.atk += raw; break;  // 10007: flat ATK on weapons
        case PROP.HP_RATIO: out.hp += raw; break;
        case PROP.DEF_RATIO: out.def += raw; break;
        case PROP.CRIT_RATE: out.critRate += raw / 10000; break;  // 4860 → 0.486
        case PROP.CRIT_DMG: out.critDmg += raw / 10000; break;
        case PROP.ENERGY_REGEN: out.energyRegen += raw / 10000; break;
        default: break;  // other stats handled at the bonus level
    }
    out.byProp[stat.propId] = (out.byProp[stat.propId] || 0) + raw;
}

function skillTreeContribution(build, dataset) {
    const out = { atkRatio: 0, hpRatio: 0, defRatio: 0, critRate: 0, critDmg: 0, healingBonus: 0, byProp: {} };

    const resonator = dataset.resonators.find(resonator => resonator.id === build.resonatorId);

    // ── Preferred: per-node skillTreeBonuses array (supports toggling) ────────
    // Each entry carries { propId, key, value, col, tier }. col+tier allow
    // per-node enable/disable via build.statNodesActive. This is the nanoka
    // source and takes precedence over the legacy aggregated table because it
    // preserves which individual node each bonus came from.
    // propIds 22-27 are element-specific DMG bonuses (Glacio=22 … Havoc=27),
    // mapped to elementId 1-6 and accumulated in out.dmgByElement.
    if (resonator?.skillTreeBonuses?.length) {
        const statActive = build.statNodesActive ?? {};
        out.dmgByElement = out.dmgByElement ?? {};
        for (const bonus of resonator.skillTreeBonuses) {
            if (bonus.col && bonus.tier != null) {
                const colActive = statActive[bonus.col];
                if (Array.isArray(colActive) && colActive[bonus.tier - 1] === false) continue;
            }
            const id = bonus.propId;
            // Element DMG bonus: propId 22-27 → elementId 1-6
            if (id >= 22 && id <= 27) {
                const elementId = id - 21;
                out.dmgByElement[elementId] = (out.dmgByElement[elementId] ?? 0) + bonus.value;
                out.byProp[id] = (out.byProp[id] ?? 0) + bonus.value;
                continue;
            }
            switch (id) {
                case PROP.ATK_RATIO: out.atkRatio += bonus.value; break;
                case PROP.HP_RATIO: out.hpRatio += bonus.value; break;
                case PROP.DEF_RATIO: out.defRatio += bonus.value; break;
                case PROP.CRIT_RATE: out.critRate += bonus.value; break;
                case PROP.CRIT_DMG: out.critDmg += bonus.value; break;
                case PROP.HEALING_BONUS: out.healingBonus = (out.healingBonus ?? 0) + bonus.value; break;
                default: break;
            }
            out.byProp[id] = (out.byProp[id] ?? 0) + bonus.value;
        }
        return out;
    }

    // ── Legacy fallback: Dimbreath aggregated skillTree table ─────────────────
    // No per-node breakdown, so toggles can't apply — used only when the
    // resonator has no skillTreeBonuses array.
    const tree = dataset.skillTree?.[String(build.resonatorId)];
    if (tree) {
        for (const [propId, slot] of Object.entries(tree)) {
            const id = Number(propId);
            switch (id) {
                case PROP.ATK_RATIO: out.atkRatio += slot.ratio; break;
                case PROP.HP_RATIO: out.hpRatio += slot.ratio; break;
                case PROP.DEF_RATIO: out.defRatio += slot.ratio; break;
                case PROP.CRIT_RATE: out.critRate += slot.flat; break;
                case PROP.CRIT_DMG: out.critDmg += slot.flat; break;
                default: break;
            }
            out.byProp[id] = { flat: slot.flat, ratio: slot.ratio };
        }
        return out;
    }

    return out;
}

/**
 * The MAIN-SLOT passive the equipped slot-0 echo grants its wielder.
 *
 * "The Resonator with this Echo equipped in the main slot gains 12% Fusion DMG
 * Bonus and 12% Resonance Liberation DMG Bonus" — always on, no trigger, no
 * duration. THIRTY echoes state one and the engine credited none of them, so
 * every carry running a cost-4 main echo was short roughly 12% element DMG plus
 * 12% skill-type DMG.
 *
 * SLOT 0 ONLY, which is what "main slot" means and what the rest of the engine
 * already assumes for echo skills (sim.js resolveEchoSkill). An echo in slots
 * 1-4 contributes its gear stats and nothing else.
 *
 * `requiresResonatorId` is the one gate the game states in prose rather than in
 * the tables: Sigillum's 25% Resonance Liberation row is identical in shape to
 * Lioness of Glory's 12%, and only its sentence says "by Aemeath". Crediting it
 * to anyone else would be a 25% Liberation bonus handed to the wrong build —
 * and the meta optimizer does pick Sigillum for other resonators.
 */
function echoMainSlotContribution(build, dataset) {
    const empty = { atkRatio: 0, critRate: 0, critDmg: 0, energyRegen: 0, healingBonus: 0,
        dmgByElement: {}, dmgBySkillType: {} };
    const slotZero = build?.echoes?.[0];
    if (slotZero?.id == null) return empty;
    const echoDef = dataset?.echoes?.find(echo => echo.id === slotZero.id);
    const passive = echoDef?.activeSkill?.mainSlotBuffs;
    if (!passive?.grants?.length) return empty;
    if (passive.requiresResonatorId != null
        && passive.requiresResonatorId !== build.resonatorId) return empty;

    const folded = foldExternalGrants(passive.grants);
    return {
        atkRatio: folded.atkRatio,
        critRate: folded.critRate,
        critDmg: folded.critDmg,
        energyRegen: folded.energyRegen,
        // Proto_HealChange has no damage bucket, so `bucketForAttribute` returns
        // null for it and `foldExternalGrants` skips it — read it from the raw
        // grants instead of inventing a bucket nothing else uses.
        healingBonus: passive.grants
            .filter(grant => grant.attribute === PROP.HEALING_BONUS)
            .reduce((sum, grant) => sum + Number(grant.value || 0), 0),
        dmgByElement: folded.dmgByElement,
        dmgBySkillType: folded.dmgBySkillType,
    };
}

function echoContribution(build) {
    // Echoes (Phase 3) accept main/sub stats as plain {propId, addType, value}
    // tuples. AddType 1 = flat (in the value's natural units), AddType 2 =
    // percent (in the value's natural units, e.g. 30 = 30%).
    const out = {
        atkFlat: 0, atkRatio: 0,
        hpFlat: 0, hpRatio: 0,
        defFlat: 0, defRatio: 0,
        critRate: 0, critDmg: 0,
        energyRegen: 0,
        healingBonus: 0,
        dmgByElement: {}, dmgBySkillType: { basic: 0, heavy: 0, skill: 0, liberation: 0, intro: 0 },
        sonataCounts: {},
        mainStats: [], subStats: [],
    };

    // Sonata piece-count credit requires DISTINCT echo species within the set
    // (maintainer-confirmed 2026-07-12 game rule): two copies of the same
    // echo do not stack toward 2pc/5pc. `e.id` is the echo species; a slot
    // with no species assigned yet (sonataId set on a bare mainStat
    // placeholder) can't be deduped against, so it always counts.
    const seenEchoIdsBySonata = {};
    for (const echo of build.echoes) {
        if (!echo) continue;
        if (echo.sonataId != null) {
            const seen = (seenEchoIdsBySonata[echo.sonataId] ??= new Set());
            if (echo.id == null || !seen.has(echo.id)) {
                out.sonataCounts[echo.sonataId] = (out.sonataCounts[echo.sonataId] || 0) + 1;
                if (echo.id != null) seen.add(echo.id);
            }
        }
        // Auto-derived sub-main stat: every echo has one fixed flat stat
        // determined by its cost (4c → 30→150 ATK, 3c → 20→100 ATK,
        // 1c → 456→2280 HP), scaling linearly with level. Apply it via
        // the same path as user-set stats so the engine bucket logic
        // stays in one place.
        const subMain = subMainStatFor(echo.cost, echo.level);
        if (subMain) applyEchoStat(out, subMain, 'main');
        if (echo.mainStat) applyEchoStat(out, echo.mainStat, 'main');
        for (const sub of echo.subStats || []) applyEchoStat(out, sub, 'sub');
    }
    return out;
}

function applyEchoStat(out, stat, kind) {
    if (!stat || stat.value == null) return;
    // `addType` distinguishes which ATK/HP/DEF bucket the value lands in
    // (addType=2 = "ratio"/percent bucket; addType=1 = flat bucket). But
    // for inherently-percent stats like Crit Rate / Crit DMG / element
    // DMG bonus, the value is a display percent (22 for "22%") regardless
    // of addType, and we must always normalize to a 0..1 fraction.
    //
    // Source of truth: `stat.isPercent` from the dataset's stat dictionary.
    const pctBucket = stat.addType === 2;          // adds to atkRatio/hpRatio/defRatio bucket
    const value = stat.value;
    const frac = stat.isPercent ? value / 100 : value;

    (kind === 'main' ? out.mainStats : out.subStats).push(stat);

    switch (stat.propId) {
        case PROP.ATK_FLAT:
        case PROP.ATK_RATIO:
            // ATK%/ATK both share propId 10007 in newer data; distinguish via
            // either the explicit ratio bucket or the inherent-percent flag.
            if (pctBucket || stat.isPercent) out.atkRatio += frac;
            else out.atkFlat += value;
            break;
        case PROP.HP_FLAT:
        case PROP.HP_RATIO:
            if (pctBucket || stat.isPercent) out.hpRatio += frac;
            else out.hpFlat += value;
            break;
        case PROP.DEF_FLAT:
        case PROP.DEF_RATIO:
            if (pctBucket || stat.isPercent) out.defRatio += frac;
            else out.defFlat += value;
            break;
        case PROP.CRIT_RATE: out.critRate += frac; break;
        case PROP.CRIT_DMG: out.critDmg += frac; break;
        case PROP.ENERGY_REGEN: out.energyRegen += frac; break;
        case PROP.HEALING_BONUS: out.healingBonus += frac; break;
        case PROP.DMG_BASIC: out.dmgBySkillType.basic += frac; break;
        case PROP.DMG_HEAVY: out.dmgBySkillType.heavy += frac; break;
        case PROP.DMG_SKILL: out.dmgBySkillType.skill += frac; break;
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
    // Each sonata tier whose `pieces` count is satisfied contributes its
    // AddProp[] entries to the resolved stats. AddProp values are already
    // normalized to 0..1 fractions by the pre-processor.
    //
    // Returns BOTH:
    //   - A per-sonata metadata map for the UI breakdown panel
    //   - A structured `stats` accumulator the resolver folds into totals
    //
    // Conditional 5pc / 3pc effects (those with BuffIds but no AddProp)
    // are surfaced as `pending` so the UI can show them with a future
    // "active when…" toggle. They contribute zero stats in Phase 6.
    const out = {};
    const stats = {
        atkFlat: 0, atkRatio: 0,
        hpFlat: 0, hpRatio: 0,
        defFlat: 0, defRatio: 0,
        critRate: 0, critDmg: 0,
        energyRegen: 0, healingBonus: 0,
        dmgByElement: {},
        dmgBySkillType: { basic: 0, heavy: 0, skill: 0, liberation: 0, intro: 0 },
        pendingConditional: 0,    // count of conditional effects surfaced but not applied
    };

    for (const [idStr, count] of Object.entries(sonataCounts)) {
        const id = Number(idStr);
        const sonata = dataset.sonatas.find(sonata => sonata.id === id);
        if (!sonata) continue;
        const activeTiers = sonata.tiers.filter(tier => count >= tier.pieces);
        if (activeTiers.length === 0) continue;

        const appliedByTier = [];
        for (const tier of activeTiers) {
            const tierApplied = applyAddPropsToStats(tier.addProp, stats);
            const conditional = (!tier.addProp || tier.addProp.length === 0)
                && Array.isArray(tier.buffIds) && tier.buffIds.length > 0;
            if (conditional) stats.pendingConditional++;
            appliedByTier.push({
                pieces: tier.pieces,
                effect: tier.effect,
                summary: tier.summary,
                descParams: tier.descParams,
                appliedStats: tierApplied,
                conditional,
            });
        }
        out[id] = { id, name: sonata.name, count, activeTiers: appliedByTier };
    }
    return { metadata: out, stats };
}

// Apply an AddProp[] list to a stats accumulator. Returns an array of
// human-readable applied entries for the UI breakdown.
//
// PropertyIndex IDs follow the same convention as elsewhere:
//   22..27   element DMG bonus  (Glacio..Havoc)
//   14       Resonance Skill DMG bonus
//   17       Basic Attack DMG bonus
//   18       Heavy Attack DMG bonus
//   19       Resonance Liberation DMG bonus
//   10007    ATK%
//   10002    HP%
//   10010    DEF%
//   8        Crit Rate
//   9        Crit DMG
//   11       Energy Regen
//   35       Healing Bonus
function applyAddPropsToStats(addProps, stats) {
    if (!Array.isArray(addProps)) return [];
    const applied = [];
    for (const prop of addProps) {
        const value = prop.value;
        switch (prop.propId) {
            case PROP.ATK_FLAT: stats.atkFlat += value; break;
            case PROP.ATK_RATIO: case 10007 + 0: stats.atkRatio += value; break;
            case PROP.HP_FLAT: stats.hpFlat += value; break;
            case PROP.HP_RATIO: stats.hpRatio += value; break;
            case PROP.DEF_FLAT: stats.defFlat += value; break;
            case PROP.DEF_RATIO: stats.defRatio += value; break;
            case PROP.CRIT_RATE: stats.critRate += value; break;
            case PROP.CRIT_DMG: stats.critDmg += value; break;
            case PROP.ENERGY_REGEN: stats.energyRegen += value; break;
            case PROP.HEALING_BONUS: stats.healingBonus += value; break;
            case PROP.DMG_BASIC: stats.dmgBySkillType.basic += value; break;
            case PROP.DMG_HEAVY: stats.dmgBySkillType.heavy += value; break;
            case PROP.DMG_SKILL: stats.dmgBySkillType.skill += value; break;
            case PROP.DMG_LIBERATION: stats.dmgBySkillType.liberation += value; break;
            default:
                if (prop.propId >= 22 && prop.propId <= 27) {
                    const elId = prop.propId - 21;
                    stats.dmgByElement[elId] = (stats.dmgByElement[elId] || 0) + value;
                }
                break;
        }
        applied.push({ propId: prop.propId, value: value, isRatio: prop.isRatio });
    }
    return applied;
}

// =============================================================================
// Public: resolveTotalStats(build, dataset) -> TotalStats
// =============================================================================

export function resolveTotalStats(build, dataset, enemyStatuses = null, teamBuffs = null, { includeConditionals = true } = {}) {
    const resonator = resonatorContribution(build, dataset);
    const weapon = weaponContribution(build, dataset);
    const tree = skillTreeContribution(build, dataset);
    const echoes = echoContribution(build);
    // The slot-0 echo's own always-on main-slot passive (30 echoes state one).
    const echoMain = echoMainSlotContribution(build, dataset);

    if (!resonator) {
        return makeEmpty(`Resonator id ${build.resonatorId} or its base stats not in dataset.`);
    }

    // Sonata is computed before totals so its AddProp stats fold into
    // the same buckets as echoes and the skill tree.
    const sonataResult = sonataContribution(build, dataset, echoes.sonataCounts);
    const sonStats = sonataResult.stats;

    // Weapon PASSIVE. Base/sub stats are in `weapon`; the always-on leading stat
    // (Frostburn's +ATK%, EoG's +ER) folds into the % buckets, and the CONDITIONAL
    // clauses (EoG's stacking ATK, Lustrous Razor's Liberation DMG, …) fold in at
    // full uptime/stacks — gated by triggerability (a Glacio-Chafe amplify counts
    // only if the wielder inflicts Glacio Chafe). Amplify + DEF-ignore from the
    // conditional clauses are NOT here — they apply per-hit (see sim.js).
    const weaponDef = build.weapon ? dataset.weapons?.find(weapon => weapon.id === build.weapon.id) : null;
    const rank = build.weapon?.rank ?? 1;
    const wResonator = dataset.resonators?.find(resonator => resonator.id === build.resonatorId);
    const weaponPassive = weaponPassiveStats(weaponDef, rank);
    // enemyStatuses (P13 L2): team-inflicted statuses that un-gate status-
    // conditional weapon/sonata buffs even when the wielder's own kit can't
    // inflict them (null → solo own-kit gating, unchanged).
    // includeConditionals=false: stats panel display mode — omits conditional
    // weapon/sonata contributions so the panel matches the in-game stowed stat
    // screen (no active combat buffs). The sim always passes includeConditionals=true
    // (the default) for full-uptime expected-DPS accuracy.
    const emptyTeamWideCond = { critRate: 0, critDmg: 0, amplifyByElement: {}, amplifyByType: {}, amplifyAll: 0, defIgnore: 0 };
    const weaponConditional = includeConditionals
        ? weaponConditionalContribution(weaponDef, rank, wResonator, dataset, enemyStatuses)
        : { ...emptyContribution(), teamWide: emptyContribution() };
    // Sonata multi-stage crit/amplify the window path doesn't model (e.g. Wishes'
    // Snowfall +25% Crit Rate). Crit folds in here; amplify applies per-hit (sim).
    const sonataConditional = includeConditionals
        ? sonataConditionalContribution(build, dataset, wResonator, enemyStatuses)
        : { critRate: 0, critDmg: 0, amplifyByElement: {}, amplifyByType: {}, amplifyAll: 0, defIgnore: 0, teamWide: emptyTeamWideCond };

    // ATK = (resonatorBase + weaponBase) × (1 + Σratios) + Σflats
    // The game multiplies ratios against the "base ATK" (resonator + weapon only).
    // Flat additions from echoes/sonatas are added after the ratio multiplication.
    const atkBase = resonator.atk + (weapon?.atk ?? 0);
    const atkFlat = echoes.atkFlat + sonStats.atkFlat;
    const hpBase = resonator.hp + (weapon?.hp ?? 0);
    const hpFlat = echoes.hpFlat + sonStats.hpFlat;
    const defBase = resonator.def + (weapon?.def ?? 0);
    const defFlat = echoes.defFlat + sonStats.defFlat;

    // teamBuffs (P13 L3): team-wide auras OTHER members grant this resonator
    // ("all team members' ATK +20%", etc.). Additive into the same buckets; null
    // → solo / no external team buff (unchanged).
    const teamBundle = teamBuffs ?? {};
    // An ALL-ATTRIBUTE team bonus is scoped to nothing, so it belongs in the
    // generic bucket every hit reads, not in a per-element or per-type map.
    const teamDmgAll = teamBundle.dmgAll ?? 0;
    const atkTotalRatio = 1 + (tree?.atkRatio ?? 0) + echoes.atkRatio + echoMain.atkRatio + sonStats.atkRatio + weaponPassive.atkRatio + weaponConditional.atkRatio + (teamBundle.atkRatio ?? 0);
    const hpTotalRatio = 1 + (tree?.hpRatio ?? 0) + echoes.hpRatio + sonStats.hpRatio + weaponPassive.hpRatio + weaponConditional.hpRatio;
    const defTotalRatio = 1 + (tree?.defRatio ?? 0) + echoes.defRatio + sonStats.defRatio + weaponPassive.defRatio + weaponConditional.defRatio;

    const atk = atkBase * atkTotalRatio + atkFlat;
    const hpTotal = hpBase * hpTotalRatio + hpFlat;
    const def = defBase * defTotalRatio + defFlat;

    const critRate = resonator.critRate + (weapon?.critRate ?? 0) + (tree?.critRate ?? 0) + echoes.critRate + echoMain.critRate + sonStats.critRate + weaponPassive.critRate + weaponConditional.critRate + sonataConditional.critRate + (teamBundle.critRate ?? 0);
    const critDmg = resonator.critDmg + (weapon?.critDmg ?? 0) + (tree?.critDmg ?? 0) + echoes.critDmg + echoMain.critDmg + sonStats.critDmg + weaponPassive.critDmg + weaponConditional.critDmg + sonataConditional.critDmg + (teamBundle.critDmg ?? 0);
    const energyRegen = (resonator.energyRegen ?? 1) + (weapon?.energyRegen ?? 0) + echoes.energyRegen + echoMain.energyRegen + sonStats.energyRegen + weaponPassive.energyRegen + weaponConditional.energyRegen + (teamBundle.energyRegen ?? 0);
    const healingBonus = (tree?.healingBonus ?? 0) + echoes.healingBonus + echoMain.healingBonus + sonStats.healingBonus;

    // Combine echo + sonata + skill-tree + weapon-passive + team DMG bonus maps
    // (each bucket adds independently; multiplication happens in the damage formula).
    const dmgBonusByElement = mergeNumericMaps(
        mergeNumericMaps(mergeNumericMaps(echoes.dmgByElement, sonStats.dmgByElement), mergeNumericMaps(weaponPassive.dmgByElement, weaponConditional.dmgByElement)),
        mergeNumericMaps(mergeNumericMaps(tree?.dmgByElement ?? {}, teamBundle.dmgByElement ?? {}), echoMain.dmgByElement),
    );
    const dmgBonusBySkillType = mergeNumericMaps(
        mergeNumericMaps(mergeNumericMaps(echoes.dmgBySkillType, sonStats.dmgBySkillType), mergeNumericMaps(weaponPassive.dmgBySkillType, weaponConditional.dmgBySkillType)),
        mergeNumericMaps(teamBundle.dmgBySkillType ?? {}, echoMain.dmgBySkillType),
    );

    // The team-recipient half of the weapon/sonata conditional clauses (e.g.
    // Kumokiri's "at max stacks, when Resonators in the team inflict Negative
    // Statuses, they gain All-Attribute DMG Bonus") — additive to this
    // resonator's own totals above (self already got it via the weapon/sonata
    // conditional contributions), and
    // exposed here so team-sim.js can distribute it to the REST of the team
    // via the same mergeTeamBundles pipeline teamWideContribution's kit
    // effects already use, instead of re-parsing the weapon/sonata text.
    const weaponSonataTeamWide = {
        atkRatio: weaponConditional.teamWide?.atkRatio ?? 0,
        critRate: (weaponConditional.teamWide?.critRate ?? 0) + (sonataConditional.teamWide?.critRate ?? 0),
        critDmg: (weaponConditional.teamWide?.critDmg ?? 0) + (sonataConditional.teamWide?.critDmg ?? 0),
        energyRegen: weaponConditional.teamWide?.energyRegen ?? 0,
        dmgByElement: mergeNumericMaps(weaponConditional.teamWide?.dmgByElement ?? {}),
        dmgBySkillType: mergeNumericMaps(weaponConditional.teamWide?.dmgBySkillType ?? {}),
        amplifyByElement: mergeNumericMaps(weaponConditional.teamWide?.amplifyByElement ?? {}, sonataConditional.teamWide?.amplifyByElement ?? {}),
        amplifyByType: mergeNumericMaps(weaponConditional.teamWide?.amplifyByType ?? {}, sonataConditional.teamWide?.amplifyByType ?? {}),
        amplifyAll: (weaponConditional.teamWide?.amplifyAll ?? 0) + (sonataConditional.teamWide?.amplifyAll ?? 0),
    };

    return {
        atk, hp: hpTotal, def,
        critRate, critDmg,
        energyRegen, healingBonus,
        dmgBonusByElement,
        dmgBonusBySkillType,
        dmgBonusAll: teamDmgAll,
        weaponSonataTeamWide,

        breakdown: {
            resonatorBase: resonator,
            weaponBase: weapon,
            weaponPassive: weaponPassive,
            skillTree: tree,
            echoes,
            sonatas: sonataResult.metadata,
            sonataStats: sonStats,
            atkBase, hpBase, defBase,
            atkTotalRatio, hpTotalRatio, defTotalRatio,
        },
    };
}

// Sum two {key → number} maps without mutating either input.
function mergeNumericMaps(mapA = {}, mapB = {}) {
    const out = { ...mapA };
    for (const [k, value] of Object.entries(mapB)) {
        out[k] = (out[k] || 0) + value;
    }
    return out;
}

function makeEmpty(error) {
    return {
        atk: 0, hp: 0, def: 0, critRate: 0, critDmg: 0, energyRegen: 1, healingBonus: 0,
        dmgBonusByElement: {}, dmgBonusBySkillType: { basic: 0, heavy: 0, skill: 0, liberation: 0, intro: 0 }, dmgBonusAll: 0,
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