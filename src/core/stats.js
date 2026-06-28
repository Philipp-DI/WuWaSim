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
import { subMainStatFor } from './echo-rules.js';
import { weaponPassiveStats } from './weapon-buffs.js';
import { weaponConditionalContribution, sonataConditionalContribution } from './conditional-buffs.js';

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

    // ── Primary path: Dimbreath-derived baseStats + growth curve ─────────────
    const base = dataset.baseStats?.[reso.propertyId];
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
    if (reso.source === 'nanoka' && reso.statsByLevel) {
        const s = reso.statsByLevel[build.level] ?? reso.statsByLevel[90];
        if (!s) return null;
        return {
            atk: s.atk,
            hp: s.hp,
            def: s.def,
            critRate: reso.baseCritRate ?? 0.05,
            critDmg: reso.baseCritDmg ?? 1.50,
            energyRegen: reso.baseEnergyRegen ?? 1.00,
        };
    }

    return null;
}

function weaponContribution(build, dataset) {
    if (!build.weapon) return null;
    const w = dataset.weapons.find(x => x.id === build.weapon.id);
    if (!w) return null;

    // ── nanoka-sourced weapon: stats are pre-resolved per level ──────────────
    if (w.source === 'nanoka' && w.statsByLevel) {
        const lv = build.weapon.level ?? 90;
        const s = w.statsByLevel[lv] ?? w.statsByLevel[90];
        if (!s) return null;
        const out = { atk: 0, hp: 0, def: 0, critRate: 0, critDmg: 0, energyRegen: 0, byProp: {} };
        // Flat stats
        out.atk += s.atk ?? 0;
        out.hp += s.hp ?? 0;
        out.def += s.def ?? 0;
        // Percent stats (already normalized to 0..1 fractions in preprocess)
        out.critRate += s.critRate ?? 0;
        out.critDmg += s.critDmg ?? 0;
        out.energyRegen += s.energyRegen ?? 0;
        // %-stats that feed the bonus layer (ATK%/HP%/DEF%)
        if (s.atkPct) out.byProp[10007] = s.atkPct;
        if (s.hpPct) out.byProp[10002] = s.hpPct;
        if (s.defPct) out.byProp[10010] = s.defPct;
        return out;
    }

    // ── Dimbreath-sourced weapon: apply growth curves ────────────────────────
    const baseCurve = weaponCurveAt(dataset.weaponGrowthCurves, w.baseCurveId, build.weapon.level);
    const subCurve = weaponCurveAt(dataset.weaponGrowthCurves, w.subCurveId, build.weapon.level);

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

    const reso = dataset.resonators.find(r => r.id === build.resonatorId);

    // ── Preferred: per-node skillTreeBonuses array (supports toggling) ────────
    // Each entry carries { propId, key, value, col, tier }. col+tier allow
    // per-node enable/disable via build.statNodesActive. This is the nanoka
    // source and takes precedence over the legacy aggregated table because it
    // preserves which individual node each bonus came from.
    // propIds 22-27 are element-specific DMG bonuses (Glacio=22 … Havoc=27),
    // mapped to elementId 1-6 and accumulated in out.dmgByElement.
    if (reso?.skillTreeBonuses?.length) {
        const statActive = build.statNodesActive ?? {};
        out.dmgByElement = out.dmgByElement ?? {};
        for (const bonus of reso.skillTreeBonuses) {
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

    for (const e of build.echoes) {
        if (!e) continue;
        if (e.sonataId != null) out.sonataCounts[e.sonataId] = (out.sonataCounts[e.sonataId] || 0) + 1;
        // Auto-derived sub-main stat: every echo has one fixed flat stat
        // determined by its cost (4c → 30→150 ATK, 3c → 20→100 ATK,
        // 1c → 456→2280 HP), scaling linearly with level. Apply it via
        // the same path as user-set stats so the engine bucket logic
        // stays in one place.
        const subMain = subMainStatFor(e.cost, e.level);
        if (subMain) applyEchoStat(out, subMain, 'main');
        if (e.mainStat) applyEchoStat(out, e.mainStat, 'main');
        for (const s of e.subStats || []) applyEchoStat(out, s, 'sub');
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
    const v = stat.value;
    const frac = stat.isPercent ? v / 100 : v;

    (kind === 'main' ? out.mainStats : out.subStats).push(stat);

    switch (stat.propId) {
        case PROP.ATK_FLAT:
        case PROP.ATK_RATIO:
            // ATK%/ATK both share propId 10007 in newer data; distinguish via
            // either the explicit ratio bucket or the inherent-percent flag.
            if (pctBucket || stat.isPercent) out.atkRatio += frac;
            else out.atkFlat += v;
            break;
        case PROP.HP_FLAT:
        case PROP.HP_RATIO:
            if (pctBucket || stat.isPercent) out.hpRatio += frac;
            else out.hpFlat += v;
            break;
        case PROP.DEF_FLAT:
        case PROP.DEF_RATIO:
            if (pctBucket || stat.isPercent) out.defRatio += frac;
            else out.defFlat += v;
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

// =============================================================================
// Sonata set constant lookup table (setConstLut)
//
// Precompiles the always-active AddProp contributions for every possible
// set-tier combination into a keyed map. The key is a canonical string of
// "setId:tierPieces" pairs sorted by setId, e.g. "1:5,7:2".
//
// This avoids re-parsing sonata tiers on every resolveTotalStats call when
// only echo substats change (the common optimizer hot-path). The LUT is built
// once per unique set-combination; subsequent calls with the same combination
// hit the cache.
//
// Architecture reference: thewuwacalculator.com uses the same pattern as
// `setConstLut` in their optimizer stage — precompile, then index by bitmask.
// We use a string key rather than bitmask since we don't yet have a fixed
// set-id→bit assignment, but the semantics are identical.
// =============================================================================

const _sonataCacheLUT = new Map();

function sonataCacheKey(sonataCounts) {
    return Object.entries(sonataCounts)
        .filter(([, n]) => n > 0)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([id, n]) => `${id}:${n}`)
        .join(',');
}

/**
 * Build or retrieve the cached AddProp stats for a given set combination.
 * Returns the same `stats` accumulator shape as sonataContribution().stats,
 * but ONLY the deterministic AddProp portion (no conditional pending count).
 * The full sonataContribution() is still called for metadata and conditional
 * tracking — this cache only short-circuits the stat accumulation.
 */
export function buildSonataLUT(sonataCounts, dataset) {
    const key = sonataCacheKey(sonataCounts);
    if (_sonataCacheLUT.has(key)) return _sonataCacheLUT.get(key);

    const stats = {
        atkFlat: 0, atkRatio: 0,
        hpFlat: 0, hpRatio: 0,
        defFlat: 0, defRatio: 0,
        critRate: 0, critDmg: 0,
        energyRegen: 0, healingBonus: 0,
        dmgByElement: {},
        dmgBySkillType: { basic: 0, heavy: 0, skill: 0, liberation: 0, intro: 0 },
    };

    for (const [idStr, count] of Object.entries(sonataCounts)) {
        const sonata = dataset.sonatas?.find(s => s.id === Number(idStr));
        if (!sonata) continue;
        for (const tier of sonata.tiers) {
            if (count >= tier.pieces && Array.isArray(tier.addProp) && tier.addProp.length > 0) {
                applyAddPropsToStats(tier.addProp, stats);
            }
        }
    }

    _sonataCacheLUT.set(key, stats);
    return stats;
}

/** Invalidate the LUT cache (call when the dataset changes between sessions). */
export function clearSonataLUT() {
    _sonataCacheLUT.clear();
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
        const sonata = dataset.sonatas.find(s => s.id === id);
        if (!sonata) continue;
        const activeTiers = sonata.tiers.filter(t => count >= t.pieces);
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
    for (const p of addProps) {
        const v = p.value;
        switch (p.propId) {
            case PROP.ATK_FLAT: stats.atkFlat += v; break;
            case PROP.ATK_RATIO: case 10007 + 0: stats.atkRatio += v; break;
            case PROP.HP_FLAT: stats.hpFlat += v; break;
            case PROP.HP_RATIO: stats.hpRatio += v; break;
            case PROP.DEF_FLAT: stats.defFlat += v; break;
            case PROP.DEF_RATIO: stats.defRatio += v; break;
            case PROP.CRIT_RATE: stats.critRate += v; break;
            case PROP.CRIT_DMG: stats.critDmg += v; break;
            case PROP.ENERGY_REGEN: stats.energyRegen += v; break;
            case PROP.HEALING_BONUS: stats.healingBonus += v; break;
            case PROP.DMG_BASIC: stats.dmgBySkillType.basic += v; break;
            case PROP.DMG_HEAVY: stats.dmgBySkillType.heavy += v; break;
            case PROP.DMG_SKILL: stats.dmgBySkillType.skill += v; break;
            case PROP.DMG_LIBERATION: stats.dmgBySkillType.liberation += v; break;
            default:
                if (p.propId >= 22 && p.propId <= 27) {
                    const elId = p.propId - 21;
                    stats.dmgByElement[elId] = (stats.dmgByElement[elId] || 0) + v;
                }
                break;
        }
        applied.push({ propId: p.propId, value: v, isRatio: p.isRatio });
    }
    return applied;
}

// =============================================================================
// Public: resolveTotalStats(build, dataset) -> TotalStats
// =============================================================================

export function resolveTotalStats(build, dataset, enemyStatuses = null, teamBuffs = null) {
    const reso = resonatorContribution(build, dataset);
    const weapon = weaponContribution(build, dataset);
    const tree = skillTreeContribution(build, dataset);
    const echoes = echoContribution(build);

    if (!reso) {
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
    const weaponDef = build.weapon ? dataset.weapons?.find(w => w.id === build.weapon.id) : null;
    const rank = build.weapon?.rank ?? 1;
    const wResonator = dataset.resonators?.find(r => r.id === build.resonatorId);
    const wpass = weaponPassiveStats(weaponDef, rank);
    // enemyStatuses (P13 L2): team-inflicted statuses that un-gate status-
    // conditional weapon/sonata buffs even when the wielder's own kit can't
    // inflict them (null → solo own-kit gating, unchanged).
    const wcond = weaponConditionalContribution(weaponDef, rank, wResonator, dataset, enemyStatuses);
    // Sonata multi-stage crit/amplify the window path doesn't model (e.g. Wishes'
    // Snowfall +25% Crit Rate). Crit folds in here; amplify applies per-hit (sim).
    const scond = sonataConditionalContribution(build, dataset, wResonator, enemyStatuses);

    // ATK = (resonatorBase + weaponBase + echoFlat + sonataFlat) × (1 + tree.ratio + echo.ratio + sonata.ratio)
    const atkBase = reso.atk + (weapon?.atk ?? 0) + echoes.atkFlat + sonStats.atkFlat;
    const hpBase = reso.hp + (weapon?.hp ?? 0) + echoes.hpFlat + sonStats.hpFlat;
    const defBase = reso.def + (weapon?.def ?? 0) + echoes.defFlat + sonStats.defFlat;

    // teamBuffs (P13 L3): team-wide auras OTHER members grant this resonator
    // ("all team members' ATK +20%", etc.). Additive into the same buckets; null
    // → solo / no external team buff (unchanged).
    const tb = teamBuffs ?? {};
    const atkTotalRatio = 1 + (tree?.atkRatio ?? 0) + echoes.atkRatio + sonStats.atkRatio + wpass.atkRatio + wcond.atkRatio + (tb.atkRatio ?? 0);
    const hpTotalRatio = 1 + (tree?.hpRatio ?? 0) + echoes.hpRatio + sonStats.hpRatio + wpass.hpRatio + wcond.hpRatio;
    const defTotalRatio = 1 + (tree?.defRatio ?? 0) + echoes.defRatio + sonStats.defRatio + wpass.defRatio + wcond.defRatio;

    const atk = atkBase * atkTotalRatio;
    const hp = hpBase * hpTotalRatio;
    const def = defBase * defTotalRatio;

    const critRate = reso.critRate + (weapon?.critRate ?? 0) + (tree?.critRate ?? 0) + echoes.critRate + sonStats.critRate + wpass.critRate + wcond.critRate + scond.critRate + (tb.critRate ?? 0);
    const critDmg = reso.critDmg + (weapon?.critDmg ?? 0) + (tree?.critDmg ?? 0) + echoes.critDmg + sonStats.critDmg + wpass.critDmg + wcond.critDmg + scond.critDmg + (tb.critDmg ?? 0);
    const energyRegen = (reso.energyRegen ?? 1) + (weapon?.energyRegen ?? 0) + echoes.energyRegen + sonStats.energyRegen + wpass.energyRegen + wcond.energyRegen + (tb.energyRegen ?? 0);
    const healingBonus = (tree?.healingBonus ?? 0) + echoes.healingBonus + sonStats.healingBonus;

    // Combine echo + sonata + skill-tree + weapon-passive + team DMG bonus maps
    // (each bucket adds independently; multiplication happens in the damage formula).
    const dmgBonusByElement = mergeNumericMaps(
        mergeNumericMaps(mergeNumericMaps(echoes.dmgByElement, sonStats.dmgByElement), mergeNumericMaps(wpass.dmgByElement, wcond.dmgByElement)),
        mergeNumericMaps(tree?.dmgByElement ?? {}, tb.dmgByElement ?? {}),
    );
    const dmgBonusBySkillType = mergeNumericMaps(mergeNumericMaps(echoes.dmgBySkillType, sonStats.dmgBySkillType), mergeNumericMaps(wcond.dmgBySkillType, tb.dmgBySkillType ?? {}));

    return {
        atk, hp, def,
        critRate, critDmg,
        energyRegen, healingBonus,
        dmgBonusByElement,
        dmgBonusBySkillType,

        breakdown: {
            resonatorBase: reso,
            weaponBase: weapon,
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
function mergeNumericMaps(a = {}, b = {}) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
        out[k] = (out[k] || 0) + v;
    }
    return out;
}

function makeEmpty(error) {
    return {
        atk: 0, hp: 0, def: 0, critRate: 0, critDmg: 0, energyRegen: 1, healingBonus: 0,
        dmgBonusByElement: {}, dmgBonusBySkillType: { basic: 0, heavy: 0, skill: 0, liberation: 0, intro: 0 },
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