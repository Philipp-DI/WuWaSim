/**
 * P12 §2 — the reference build (anchor).
 *
 * Constructs, deterministically, the per-resonator anchor at which every
 * breakpoint and weight is computed (PHASE0-ARCHITECTURE.md §4). The anchor is:
 *   - a synthesized, prerequisite-valid reference rotation (§2a.1),
 *   - a fixed template echo main/sub stat-set (§2b),
 *   - a sequence level (build.chain),
 *   - one sonata set (varied across the enumeration by the orchestrator).
 *
 * Pure + headless: imports the same core modules the runtime sim uses, so the
 * anchor is exactly what the engine would compute for a real user build.
 *
 * Documented anchor choices (PHASE0 §9 leaves templateStats per-resonator to
 * this phase; §2b: "the exact spread does not need to be optimal — it is the
 * anchor, not the answer. What matters is that it is fixed and documented"):
 *   - Echo cost layout 4+3+3+1+1 (the standard endgame spread).
 *   - 4-cost main: Crit DMG (the canonical 4-cost damage main for crit DPS).
 *   - 3-cost mains: the character's element DMG bonus + ATK% (or scaling stat).
 *   - 1-cost mains: ATK% (or scaling stat) ×2.
 *   - Substats: a fixed 25-roll package (CR×8, CD×3, ATK%×6, ER×3, flat-ATK×5)
 *     distributed 5 per echo — CR-heavy on purpose so that, combined with the
 *     representative weapon's Crit DMG secondary + the CD main, effective crit
 *     lands at a realistic, non-saturated ≈ CR 69% / CD 285% (§4b) where Crit
 *     DMG keeps a meaningful per-roll value; ER sits near the typical band.
 *   - Representative 5★ weapon (highest-base-ATK of the resonator's weapon type)
 *     — a well-invested build always has one; omitting it shrinks the ATK base
 *     and systematically inflates ATK%/flat-ATK weight relative to crit. The
 *     chosen weapon is emitted in the meta.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createBuild, setChain, setEcho, setWeapon } from '../../src/core/build.js';
import { rulesForResonator } from '../../src/core/rotation-rules.js';
import { validateRotation } from '../../src/core/rotation-graph.js';
import { effectiveSkillMap } from '../../src/core/sim.js';
import { PROP, resolveTotalStats } from '../../src/core/stats.js';

// Curated reference rotations (data/reference-rotations.json) — authored from
// canonical guide rotations + kit mechanics, validated to zero warnings. When a
// resonator has a curated entry it is the source of truth for both the weight
// anchor and the empty-build default; synthesis is the fallback for the rest.
let _curated = null;
function curatedRotations() {
    if (_curated) return _curated;
    const __dirname = dirname(fileURLToPath(import.meta.url));
    try {
        _curated = JSON.parse(readFileSync(resolve(__dirname, '../../data/reference-rotations.json'), 'utf8'));
    } catch { _curated = {}; }
    return _curated;
}

export function curatedRotationFor(resonatorId) {
    const entry = curatedRotations()[String(resonatorId)];
    return Array.isArray(entry?.rotation) ? entry.rotation.slice() : null;
}

// elementId 1..6 → element DMG-bonus propId 22..27 (PROP.DMG_ELEMENT_BASE + el).
export const elementDmgProp = (elementId) => PROP.DMG_ELEMENT_BASE + elementId;

// Scaling stat → the propId used for that stat's % main/substat. Default ATK
// covers every current seed character; HP/DEF scalers (future) override here.
const SCALING_RATIO_PROP = { atk: PROP.ATK_RATIO, hp: PROP.HP_RATIO, def: PROP.DEF_RATIO };
const SCALING_FLAT_PROP = { atk: PROP.ATK_FLAT, hp: PROP.HP_FLAT, def: PROP.DEF_FLAT };

// Per-resonator scaling-stat overrides (none needed for the seed six — all ATK).
const SCALING_OVERRIDES = Object.freeze({});

export function scalingStatFor(resonator) {
    return SCALING_OVERRIDES[resonator.id] ?? 'atk';
}

// elementId → the canonical element-matching 5-piece sonata id (its 2pc grants
// that element's DMG bonus). The character's "standard set" (§5b). Expandable:
// a curated per-character table can add alternative sets later; the meta schema
// already keys results by sonata id, so adding sets is non-breaking.
const ELEMENT_SONATA = Object.freeze({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 });

export function standardSonatasFor(resonator) {
    const s = ELEMENT_SONATA[resonator.element];
    return s != null ? [s] : [];
}

/**
 * A representative 5★ weapon for the anchor: the highest-base-ATK 5★ of the
 * resonator's weapon type. A well-invested build always has a weapon; omitting
 * it shrinks the ATK base and systematically inflates the marginal weight of
 * ATK% / flat ATK relative to crit (§2 "accurate for a well-invested build").
 * Deterministic and documented; the chosen weapon is emitted in the meta.
 */
export function representativeWeaponId(resonator, dataset) {
    const cands = (dataset.weapons ?? []).filter(w => w.type === resonator.weaponType && w.rarity === 5);
    if (cands.length === 0) return null;
    return cands.reduce((best, w) =>
        (w.statsByLevel?.['90']?.atk ?? 0) > (best.statsByLevel?.['90']?.atk ?? 0) ? w : best, cands[0]).id;
}

// Resolve a 5★ echo main-stat option to a build-ready stat object at level 25.
function mainStat(dataset, cost, propId) {
    const opt = (dataset.echoMainStats?.[String(cost)] ?? []).find(o => o.propId === propId);
    if (!opt) return null;
    const value = opt.scaling?.['5']?.lv25;
    if (value == null) return null;
    return { propId: opt.propId, addType: opt.addType, value, isPercent: opt.isPercent };
}

/**
 * The fixed template stat-set (§2b): five echo main stats by cost slot, plus a
 * neutral substat package. Returns an array of 5 echo descriptors
 * `{ cost, mainStat, subStats }` in the 4/3/3/1/1 layout.
 */
export function templateStats(resonator, dataset) {
    const scaling = scalingStatFor(resonator);
    const ratioProp = SCALING_RATIO_PROP[scaling];
    const flatProp = SCALING_FLAT_PROP[scaling];
    const elDmg = elementDmgProp(resonator.element);

    const mains = [
        mainStat(dataset, 4, PROP.CRIT_DMG),   // 4-cost: Crit DMG
        mainStat(dataset, 3, elDmg),           // 3-cost: element DMG bonus
        mainStat(dataset, 3, ratioProp),       // 3-cost: ATK% (scaling stat)
        mainStat(dataset, 1, ratioProp),       // 1-cost: ATK% (scaling stat)
        mainStat(dataset, 1, ratioProp),       // 1-cost: ATK% (scaling stat)
    ];
    const costs = [4, 3, 3, 1, 1];

    // Neutral 25-roll substat package (per-roll values are representative mid
    // rolls; fixed and documented, not tuned for optimality).
    const roll = (propId, addType, value, isPercent, n) =>
        Array.from({ length: n }, () => ({ propId, addType, value, isPercent }));
    // Substat package, tuned so the anchor (WITH the representative weapon's
    // base ATK + crit secondary) lands a realistic, NON-saturated crit ratio
    // (§4b). A 5★ DPS weapon + Crit DMG main already supply ~250%+ Crit DMG, so
    // a real build invests its crit substats mostly in Crit RATE to catch up —
    // stacking more CD on top over-saturates it (CD ≫ 300%, CR stuck ~55%) and
    // makes the marginal CD weight pathologically low. CR-heavy (8 CR / 3 CD)
    // lands ≈ CR 69% / CD 285%, a realistic endgame ratio where Crit DMG keeps a
    // meaningful per-roll value above ATK%.
    const subPool = [
        ...roll(PROP.CRIT_RATE, 1, 7, true, 8),    // +56% Crit Rate
        ...roll(PROP.CRIT_DMG, 1, 14, true, 3),    // +42% Crit DMG
        ...roll(ratioProp, 2, 9, true, 6),         // +54% scaling%  (ATK%)
        ...roll(PROP.ENERGY_REGEN, 1, 10, true, 3),// +30% Energy Regen
        ...roll(flatProp, 1, 45, false, 5),        // +225 flat scaling (ATK)
    ];

    // Distribute the 25-roll pool 5 per echo (any layout is equivalent — the
    // stat resolver sums all substats regardless of slot — but 5/echo mirrors a
    // real fully-rolled build).
    return mains.map((m, i) => ({
        cost: costs[i],
        mainStat: m,
        subStats: subPool.slice(i * 5, i * 5 + 5),
    }));
}

/**
 * Synthesize the reference rotation (§2a.1): Intro → Skill → Forte → Liberation
 * → Basic filler, drawn from the resonator's autoSkillMap, then pruned to zero
 * `validateRotation` warnings (P10 prerequisites + intra-skill stage ordering).
 * No curated `defaultRotation` exists in the dataset today, so this is the
 * source of the build-page default too (§2a.1 "the two features share it").
 */
export function synthesizeReferenceRotation(resonator, dataset) {
    // Curated rotation wins when present (validated below; a curation error that
    // produces warnings is surfaced loudly rather than silently shipped).
    const curated = curatedRotationFor(resonator.id);
    if (curated) {
        const skillMap = effectiveSkillMap(dataset, resonator.id);
        const warnings = validateRotation(curated, rulesForResonator(resonator.id), skillMap);
        if (warnings.length) {
            throw new Error(`Curated rotation for ${resonator.name} (${resonator.id}) has ${warnings.length} validateRotation warning(s): ` +
                warnings.map(w => `${w.skillKey} [${w.gate}]`).join(', '));
        }
        return curated;
    }

    const map = dataset.autoSkillMap?.[String(resonator.id)] ?? {};
    const keys = Object.keys(map);
    const rules = rulesForResonator(resonator.id);
    const damages = (k) => (map[k]?.damageIds?.length ?? 0) > 0;
    const typeOf = (k) => map[k]?.skillType ?? map[k]?.formulaType ?? '';

    const firstByType = (pred) => keys.find(k => damages(k) && pred(typeOf(k), k));

    const intro = firstByType(t => t === 'intro');
    const skill = map.skill && damages('skill') ? 'skill' : firstByType(t => t === 'skill');
    const forte = firstByType(t => t.startsWith('forte'));
    const lib = map.liberation && damages('liberation') ? 'liberation' : firstByType(t => t === 'liberation');
    const basics = keys.filter(k => typeOf(k).startsWith('basic') && damages(k)).sort();

    const candidate = [intro, skill, forte, lib, ...basics.slice(0, 3)].filter(Boolean);
    return pruneToValid(candidate, rules, map);
}

// Remove the steps that trigger prerequisite / stage-ordering warnings, one at a
// time (highest index first so earlier indices stay stable), until the rotation
// validates cleanly. A dropped gated step just yields a simpler-but-valid anchor
// — acceptable: the anchor must be valid and fixed, not maximal.
function pruneToValid(rotation, rules, skillMap) {
    let rot = rotation.slice();
    for (let guard = 0; guard < rotation.length + 1; guard++) {
        const warnings = validateRotation(rot, rules, skillMap);
        if (warnings.length === 0) return rot;
        const dropIndex = Math.max(...warnings.map(w => w.index));
        rot = rot.filter((_, i) => i !== dropIndex);
        if (rot.length === 0) return rot;
    }
    return rot;
}

/**
 * Construct the full anchor build for one (resonator, sequenceLevel, sonataId).
 * @param {object} args
 * @param {object} args.resonator
 * @param {object} args.dataset
 * @param {number} args.sequenceLevel  — chain level 0..6
 * @param {number} args.sonataId
 * @param {string[]} [args.rotation]    — precomputed reference rotation (reused
 *        across sequence/sonata iterations); synthesized if omitted
 * @param {Array} [args.template]       — precomputed templateStats() output
 * @param {number|null} [args.weaponId] — representative weapon (defaults to
 *        representativeWeaponId; pass null to force a weaponless anchor)
 * @returns {object} a Build
 */
export function referenceBuild({ resonator, dataset, sequenceLevel, sonataId, rotation, template, weaponId }) {
    const rot = rotation ?? synthesizeReferenceRotation(resonator, dataset);
    const tmpl = template ?? templateStats(resonator, dataset);
    const wid = weaponId === undefined ? representativeWeaponId(resonator, dataset) : weaponId;

    let build = setChain(createBuild(resonator), sequenceLevel);
    if (wid != null) build = setWeapon(build, wid);
    tmpl.forEach((echo, i) => {
        build = setEcho(build, i, {
            id: null,                 // stats don't depend on echo id (see header)
            cost: echo.cost,
            level: 25,
            mainStat: echo.mainStat,
            subStats: echo.subStats,
            sonataId,
        });
    });
    build = { ...build, rotation: rot, rotationMeta: rot.map(() => ({})) };
    return build;
}

/**
 * Return a copy of `build` whose TOTAL Energy Regen resolves to exactly
 * `targetEr` (a fraction, e.g. 1.25 = 125%), by appending a synthetic ER
 * substat carrying the needed delta onto echo slot 0. Used by the ER-mode
 * analysis and the weight anchor (PHASE0 §4 "held constant except for the one
 * stat being swept/perturbed"). The delta may be negative — the stat resolver
 * sums it the same way, so this can lower ER below the template baseline too.
 *
 * @param {object} build
 * @param {object} dataset
 * @param {number} targetEr  — desired total Energy Regen as a fraction
 * @returns {object} new build
 */
export function withTotalEr(build, dataset, targetEr) {
    const current = resolveTotalStats(build, dataset).energyRegen;
    const deltaPct = (targetEr - current) * 100;       // percentage points
    const echoes = build.echoes.slice();
    const slot0 = echoes[0];
    if (!slot0) return build;
    const erSub = { propId: PROP.ENERGY_REGEN, addType: 1, value: deltaPct, isPercent: true, __synthetic: 'er' };
    // Replace any prior synthetic ER injection so repeated calls compose cleanly.
    const subStats = [...(slot0.subStats ?? []).filter(s => s.__synthetic !== 'er'), erSub];
    echoes[0] = { ...slot0, subStats };
    return { ...build, echoes };
}
