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
import {
    rulesForResonator, stageGrantsForResonator, swapInEntryForResonator,
    resourceDefsForResonator, stateDefsForResonator,
} from '../../src/core/rotation-rules.js';
import { analyzeRotation } from '../../src/core/rotation-graph.js';
import { effectiveSkillMap } from '../../src/core/sim.js';
import { PROP, resolveTotalStats } from '../../src/core/stats.js';
import { isTeamRecipientClause } from '../../src/core/conditional-buffs.js';
import { ROLE } from './synergy-hints.js';

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

/** The resonance mode a curated rotation is authored for (null = single-mode). */
export function curatedModeFor(resonatorId) {
    return curatedRotations()[String(resonatorId)]?.resonanceMode ?? null;
}

// elementId 1..6 → element DMG-bonus propId 22..27 (PROP.DMG_ELEMENT_BASE + el).
export const elementDmgProp = (elementId) => PROP.DMG_ELEMENT_BASE + elementId;

// Scaling stat → the propId used for that stat's % main/substat. Default ATK
// covers every current seed character; HP/DEF scalers (future) override here.
const SCALING_RATIO_PROP = { atk: PROP.ATK_RATIO, hp: PROP.HP_RATIO, def: PROP.DEF_RATIO };
const SCALING_FLAT_PROP = { atk: PROP.ATK_FLAT, hp: PROP.HP_FLAT, def: PROP.DEF_FLAT };

// Per-resonator scaling-stat overrides (none needed for the seed six — all ATK).
const SCALING_OVERRIDES = Object.freeze({});

/**
 * A resonator's real investment-scaling stat. Damage-focused characters stay
 * 'atk' (SCALING_OVERRIDES, or the default). HEALER-tagged characters derive
 * it from their OWN heal formula's scaling stat (dataset.supportTable, e.g.
 * Baizhi's heal rows all carry scalingStat:'hp') — data-driven, not
 * hand-curated, and gated on the HEALER role specifically so a DPS character
 * with an incidental minor self-heal utility skill is never misclassified.
 *
 * @param {object} resonator
 * @param {object} [dataset] — needed only for the HEALER heal-scaling lookup
 * @param {string[]} [roles] — rolesOf(resonator.id) from synergy-hints.js
 */
export function scalingStatFor(resonator, dataset, roles = []) {
    if (SCALING_OVERRIDES[resonator.id]) return SCALING_OVERRIDES[resonator.id];
    if (roles.includes(ROLE.HEALER)) {
        const healRows = (dataset?.supportTable?.[resonator.id] ?? []).filter(r => r.rowType === 'heal');
        if (healRows.length && healRows.every(r => r.scalingStat === healRows[0].scalingStat)) {
            return healRows[0].scalingStat;
        }
    }
    return 'atk';
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

// A sonata is usable if at least one of its tiers carries a parsed effect (some
// newer sets land in the dataset with empty effect strings — skip those).
function hasUsableTiers(sonata) {
    return (sonata.tiers ?? []).some(t => (t.effect ?? '').trim().length > 0);
}

// The element a sonata's 2-piece bonus boosts (propId 22..27 → element 1..6),
// or null for a non-elemental set (ATK / ER / healing / coordinated).
function sonata2pcElement(sonata) {
    const t2 = (sonata.tiers ?? []).find(t => t.pieces === 2);
    const p = (t2?.addProp ?? []).find(a => a.propId >= 22 && a.propId <= 27);
    return p ? p.propId - 21 : null;
}

// Sets whose 2pc grants Healing Bonus% (PROP.HEALING_BONUS = 35) — the real,
// data-driven "healing set" identification (Rejuvenating Glow, Halo of Starry
// Radiance), same addProp-scan pattern as sonata2pcElement.
function sonataGrantsHealingBonus(sonata) {
    return (sonata.tiers ?? []).some(t => (t.addProp ?? []).some(a => a.propId === PROP.HEALING_BONUS));
}

// Sets with a genuine TEAM-AMP tier — a clause whose beneficiary is the whole
// team, not just the wielder (isTeamRecipientClause, shared with the runtime
// weapon/sonata conditional parser so "can we detect this buff" and "should
// it be a candidate" never drift apart). Fixes the gap flagged below: BUFFER/
// HEALER-tagged supports previously had no team-damage-amplify category in
// their pool at all, only their own element/universal/healing sets.
function sonataGrantsTeamAmp(sonata) {
    return (sonata.tiers ?? []).some(t => isTeamRecipientClause(t.effect ?? ''));
}

// Universal / damage-type sets worth simming for any carry, regardless of
// element. These are NOT element-2pc sets, so the old element-only pruning
// dropped them — but a damage-type set can easily beat an element set (e.g.
// Frosty Resolve's Resonance Skill DMG 2pc + Glacio-after-skill 5pc is ~50%
// stronger than Freezing Frost for a Resonance-Skill carry like Carlotta). The
// sim ranks them correctly per character, so including them costs nothing and
// fixes the "best set never considered" bug.
//   9  Lingering Tunes  — ATK (universal)
//   10 Frosty Resolve   — Resonance Skill DMG (skill carries)
//   31 Reel of Spliced Memories — ATK (universal)
const UNIVERSAL_SONATA_IDS = [9, 10, 31];

/**
 * Candidate sonata sets for a resonator (§5b): the element-matching sets (their
 * 2pc grants the character's element DMG) PLUS the universal / damage-type sets
 * above. The search sims each and keeps the best, so the pool only needs to
 * CONTAIN every plausible winner — it doesn't have to pre-rank them.
 *
 * Role-aware addition (maintainer direction, 2026-07-10 — "roles should help
 * smart pruning"): HEALER-tagged resonators additionally get the real,
 * data-driven healing sets (Rejuvenating Glow / Halo of Starry Radiance — any
 * set whose 2pc grants Healing Bonus%, sonataGrantsHealingBonus) ADDED to the
 * pool — never removing the existing candidates, so the sim still picks
 * whichever actually wins for that character.
 *
 * **Team-amp addition (2026-07-13, maintainer-directed):** HEALER/BUFFER-
 * tagged resonators also get every set with a genuine team-recipient tier
 * (sonataGrantsTeamAmp) ADDED to the pool — the missing category the note
 * above used to flag as deferred. Per the maintainer: "healing is secondary,
 * buffing/amping DMG is the primary focus of a support unit" — so a support's
 * gear search must be able to SEE a team-amp set at all, not just her own
 * element/healing sets, for team-context evaluation (team-rank.js) to have
 * anything real to pick between.
 *
 * @param {object} resonator
 * @param {object} dataset
 * @param {string[]} [roles] — rolesOf(resonator.id) from synergy-hints.js
 * Deterministic, sorted.
 */
export function candidateSonatasFor(resonator, dataset, roles = []) {
    const el = resonator.element;
    const sets = (dataset.sonatas ?? []).filter(hasUsableTiers);
    const elementSets = sets.filter(s => sonata2pcElement(s) === el).map(s => s.id);
    const universal = UNIVERSAL_SONATA_IDS.filter(id => sets.some(s => s.id === id));
    const isSupport = roles.includes(ROLE.HEALER) || roles.includes(ROLE.BUFFER);
    const healing = roles.includes(ROLE.HEALER) ? sets.filter(sonataGrantsHealingBonus).map(s => s.id) : [];
    const teamAmp = isSupport ? sets.filter(sonataGrantsTeamAmp).map(s => s.id) : [];
    return [...new Set([...elementSets, ...universal, ...healing, ...teamAmp])].sort((a, b) => a - b);
}

/**
 * Top-N representative 5★ weapons of the resonator's weapon type by base ATK
 * (the realistic candidate pool). The search sims each so the secondary stat is
 * accounted for; weapon passives are only partially modeled, so base ATK is the
 * pre-filter, not the final ranking.
 */
export function candidateWeaponsFor(resonator, dataset, n = 8) {
    // Base ATK is only a pre-filter — a weapon's passive (now modeled, incl.
    // conditional amplify) can make a lower-base weapon win, so keep a wide pool
    // and let the sim rank it. There are only ~10 5★ per weapon type.
    return (dataset.weapons ?? [])
        .filter(w => w.type === resonator.weaponType && w.rarity === 5)
        .sort((a, b) => (b.statsByLevel?.['90']?.atk ?? 0) - (a.statsByLevel?.['90']?.atk ?? 0))
        .slice(0, n)
        .map(w => w.id);
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
 *
 * @param {object} resonator
 * @param {object} dataset
 * @param {string[]} [roles] — rolesOf(resonator.id); HEALER gets a Healing
 *   Bonus 4-cost main (a real echo main-stat option) instead of Crit DMG —
 *   a healer whose kit doesn't crit has no use for a Crit DMG main slot.
 */
export function templateStats(resonator, dataset, roles = []) {
    const scaling = scalingStatFor(resonator, dataset, roles);
    const ratioProp = SCALING_RATIO_PROP[scaling];
    const flatProp = SCALING_FLAT_PROP[scaling];
    const elDmg = elementDmgProp(resonator.element);
    const isHealer = roles.includes(ROLE.HEALER);

    const mains = [
        isHealer ? mainStat(dataset, 4, PROP.HEALING_BONUS) : mainStat(dataset, 4, PROP.CRIT_DMG),
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
        const warnings = rotationWarnings(curated, resonator.id, skillMap);
        if (warnings.length) {
            throw new Error(`Curated rotation for ${resonator.name} (${resonator.id}) has ${warnings.length} validateRotation warning(s): ` +
                warnings.map(w => `${w.skillKey} [${w.gate}]`).join(', '));
        }
        return curated;
    }

    const map = dataset.autoSkillMap?.[String(resonator.id)] ?? {};
    const keys = Object.keys(map);
    const damages = (k) => (map[k]?.damageIds?.length ?? 0) > 0;
    const typeOf = (k) => map[k]?.skillType ?? map[k]?.formulaType ?? '';

    const firstByType = (pred) => keys.find(k => damages(k) && pred(typeOf(k), k));

    const intro = firstByType(t => t === 'intro');
    const skill = map.skill && damages('skill') ? 'skill' : firstByType(t => t === 'skill');
    const forte = firstByType(t => t.startsWith('forte'));
    const lib = map.liberation && damages('liberation') ? 'liberation' : firstByType(t => t === 'liberation');
    const basics = keys.filter(k => typeOf(k).startsWith('basic') && damages(k)).sort();

    const candidate = [intro, skill, forte, lib, ...basics.slice(0, 3)].filter(Boolean);
    return pruneToValid(candidate, resonator.id, map);
}

// Grant-aware validation (rotation-rules.js STAGE_GRANTS/SWAP_IN_ENTRY/
// RESOURCE_DEFS/state timeline) — matches build-editor-v2.js's own
// analyzeRotation call so the anchor/curation gate and the live UI's
// rotation warnings agree on what's legal. The OLD grant-blind
// validateRotation() wrapper used here through 2026-07-13 silently
// mismatched: it only ever ran against the P12 six (none of whose curated
// rotations rely on a grant), so a real curated entry that DOES rely on one
// (e.g. Denia's Intro → Basic Stagecraft Stage 4 grant, rotation-rules.js
// STAGE_GRANTS[1211]) threw a false "invalid curation" the moment anything
// else (the team-context gear search, 2026-07-13) exercised this path for
// her — a real, if latent, bug this fix closes at the root.
function rotationWarnings(rotation, resonatorId, skillMap) {
    return analyzeRotation(rotation, {
        rules: rulesForResonator(resonatorId),
        skillMap,
        grants: stageGrantsForResonator(resonatorId),
        swapInEntry: swapInEntryForResonator(resonatorId),
        resourceDefs: resourceDefsForResonator(resonatorId),
        stateDefs: stateDefsForResonator(resonatorId),
    }).warnings;
}

// Remove the steps that trigger prerequisite / stage-ordering warnings, one at a
// time (highest index first so earlier indices stay stable), until the rotation
// validates cleanly. A dropped gated step just yields a simpler-but-valid anchor
// — acceptable: the anchor must be valid and fixed, not maximal.
function pruneToValid(rotation, resonatorId, skillMap) {
    let rot = rotation.slice();
    for (let guard = 0; guard < rotation.length + 1; guard++) {
        const warnings = rotationWarnings(rot, resonatorId, skillMap);
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
