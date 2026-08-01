// src/core/enemy-status.js
/**
 * Enemy negative-status timeline (P13 — Team Effect Model, Layer 1).
 *
 * Negative statuses live on the ENEMY and are SHARED by the whole team: any
 * member who inflicts a status accrues stacks on a single shared timeline that
 * PERSISTS across resonator switches (maintainer rule 1). This module owns that
 * timeline — per-cast stack accrual (capped + decayed per status) plus the
 * queries the team sim needs:
 *
 *   - statusStacksAt(status, t)        — exact stack count at a time
 *   - presentDuring(status, a, b)      — was the status up anywhere in a window
 *   - presentStatusesAt(t)             — the set present at a time (for gating)
 *   - lastApplicatorAt(status, t)      — whose level drives NS-damage (L4)
 *
 * Stack counts are real (per-cast accrual, the maintainer's L1 choice) so
 * stack-scaling effects (Snow-Rust tiers, NS DoT) read them later without a
 * refactor. v1 gating (Layer 2) only needs presence (stacks > 0).
 *
 * Status mechanics (max stacks, decay, element) come from NEGATIVE_STATUS_DEFS,
 * sourced from docs/NEGATIVE-STATUS-REFERENCE.md. The two Tune Break statuses
 * (tune_rupture / tune_strain) are NOT elemental negative statuses — they have no
 * DoT model — but they ARE enemy-side gating conditions (Aemeath/Luuk synergies),
 * so they're tracked here for presence/gating with a conservative default def.
 *
 * Conservative by design: a status nobody in the team inflicts is simply absent.
 */

import { inflictsStatus } from './triggerability.js';
import { computeResMult } from './formula.js';

const ELEMENT_ID_BY_NAME = Object.freeze({ glacio: 1, fusion: 2, electro: 3, aero: 4, spectro: 5, havoc: 6 });

// Canonical status keys (underscore form — matches resonance-mode keys).
export const STATUS_KEYS = Object.freeze([
    'glacio_chafe', 'fusion_burst', 'aero_erosion', 'electro_flare',
    'spectro_frazzle', 'havoc_bane', 'tune_rupture', 'tune_strain',
]);

// Space form (kit/condition text) ↔ underscore key.
const SPACE_OF = Object.freeze({
    glacio_chafe: 'glacio chafe', fusion_burst: 'fusion burst', aero_erosion: 'aero erosion',
    electro_flare: 'electro flare', spectro_frazzle: 'spectro frazzle', havoc_bane: 'havoc bane',
    tune_rupture: 'tune rupture', tune_strain: 'tune strain',
});
export const statusSpaceForm = (key) => SPACE_OF[key] ?? String(key).replace(/_/g, ' ');
export const statusKeyForm = (name) => String(name).trim().toLowerCase().replace(/\s+/g, '_');

/**
 * Mechanically-relevant status defs (docs/NEGATIVE-STATUS-REFERENCE.md §3).
 * Fields used by the timeline: maxStacks, stackDecayS (null = no decay model).
 * Damage/DEF fields are carried for Layer 4 but unused by L1.
 */
export const NEGATIVE_STATUS_DEFS = Object.freeze({
    glacio_chafe:   { element: 'glacio',  maxStacks: 10, stackDecayS: null, resetOnMax: true,  damageOnStack: true,  defReductionPerStack: 0 },
    fusion_burst:   { element: 'fusion',  maxStacks: 10, stackDecayS: null, resetOnMax: true,  damageOnMax: true,    defReductionPerStack: 0 },
    aero_erosion:   { element: 'aero',    maxStacks: 3,  stackDecayS: 15,   resetOnMax: false, damageOnTick: true,   tickIntervalS: 3, defReductionPerStack: 0 },
    electro_flare:  { element: 'electro', maxStacks: 10, stackDecayS: null, resetOnMax: false, damageOnTick: true,   defReductionPerStack: 0 },
    spectro_frazzle:{ element: 'spectro', maxStacks: 10, stackDecayS: 3,    resetOnMax: false, damageOnTick: true,   tickIntervalS: 3, defReductionPerStack: 0 },
    havoc_bane:     { element: 'havoc',   maxStacks: 3,  stackDecayS: null, resetOnMax: false, damageOnTick: false,  defReductionPerStack: 0.02 },
    // Tune Break — gating-only (no DoT model); generous cap, no decay model.
    tune_rupture:   { element: null, maxStacks: 10, stackDecayS: null, resetOnMax: false, gatingOnly: true, defReductionPerStack: 0 },
    tune_strain:    { element: null, maxStacks: 10, stackDecayS: null, resetOnMax: false, gatingOnly: true, defReductionPerStack: 0 },
});

/**
 * Negative-status DMG formula — community-reverse-engineered (no official
 * source exists; docs/NEGATIVE-STATUS-REFERENCE.md §2c). Structurally DISTINCT
 * from the regular skill-damage formula in formula.js: no ATK/HP/DEF scaling
 * stat, no crit, and its own DEF-multiplier constants — left as a SEPARATE formula
 * here rather than folded into computeDamage.
 *
 *   DMG = LevelModifier × (1 + MvBonus%) × StackMV × DefMult × ResMult × (1 + Amplify%)
 *   DefMult = (8×atkLv + 800) / ((8×atkLv + 800) + (8×defLv + 792) × (1−defShred) × (1−defIgnore))
 *
 * Verified against two independent real worked examples (Hiyuki, lvl 90,
 * Glacio Chafe, 0% and 12% DEF-shred) to within 0.001% — the 12% case
 * independently confirms our existing Havoc Bane model (6 stacks × 2%/stack).
 * ResMult reuses formula.js's existing piecewise function/target.resistances —
 * no new RES convention.
 *
 * LevelModifier is treated as a constant per status type at level 90,
 * independent of the inflicting character: all 3 confirmed Hiyuki examples
 * show the identical 3674 regardless of her own stacks/build, and the
 * formula has no character-specific term at all. ASSUMED to also hold for
 * other inflicters of the same status (e.g. Lucilla for Glacio Chafe) until
 * disproven — flagged here, not silently treated as fully confirmed.
 *
 * Never crits (community source: Glacio Chafe/Tune Break DMG cannot
 * critically hit, barring an explicit kit exception — none modeled yet).
 */
const NS_LEVEL_MODIFIER = Object.freeze({
    glacio_chafe: 3674,    // level 90
    tune_rupture: 716.22,  // level 90 — shared with tune_strain (maintainer-confirmed
    tune_strain:  716.22,  // universal across resonators/modes, same as glacio_chafe)
});

// Statuses whose LevelModifier is the game's own AbnormalDamageConfig curve
// (dataset.abnormalDamage, extracted by tools/extract/extract_abnormal_damage.py
// straight from the client ConfigDB). Tune Rupture/Strain are NOT in that table
// — their 716.22 is a different mechanic's constant and stays as calibrated.
const ABNORMAL_DAMAGE_STATUSES = new Set(['glacio_chafe']);

/**
 * The LevelModifier term for one status at one inflicting level.
 *
 * The game's table is authoritative and covers levels 1–100; it reads 3674 at
 * level 90, which is exactly the constant three worked examples had pinned, and
 * it is identical across all six elements at every level — confirming the
 * "assumed to hold for other inflicters until disproven" caveat above.
 *
 * Without a dataset (unit tests, callers that never loaded one) this falls back
 * to the calibrated level-90 constant, so behaviour at 90 is identical either
 * way. Any OTHER level was previously modelled as if it were 90; passing the
 * dataset is what makes it correct.
 *
 * @param {string} status
 * @param {number} level     — the INFLICTING resonator's level
 * @param {object|null} [dataset]
 * @returns {number|null}
 */
export function nsLevelModifier(status, level, dataset = null) {
    if (dataset && ABNORMAL_DAMAGE_STATUSES.has(status)) {
        const fromGame = dataset.abnormalDamage?.byLevel?.[String(level)];
        if (fromGame != null) return fromGame;
    }
    return NS_LEVEL_MODIFIER[status] ?? null;
}

// Shared DEF-multiplier helper (NS formula's own constants — distinct from formula.js).
function nsDefMult(atkLv, target) {
    const defLv = target.level ?? 90;
    const defShred = target.defShred ?? 0;
    const defIgnore = target.defIgnore ?? 0;
    return (8 * atkLv + 800) / ((8 * atkLv + 800) + (8 * defLv + 792) * (1 - defShred) * (1 - defIgnore));
}

// Per-stack Motion Value (already MV/10000, i.e. a fraction) for Glacio Chafe.
// Confirmed at stacks 1 (0.2450), 7 (1.4401), and 10/max (2.0377) — linearly
// interpolated for 2-6/8-9 (the three confirmed points fit a line to within
// display rounding; community source did not provide the intermediate stacks).
const GLACIO_CHAFE_STACK_MV = Object.freeze({
    1: 0.2450, 2: 0.4442, 3: 0.6434, 4: 0.8426, 5: 1.0418,
    6: 1.2409, 7: 1.4401, 8: 1.6393, 9: 1.8385, 10: 2.0377,
});

const STACK_MV_TABLES = Object.freeze({ glacio_chafe: GLACIO_CHAFE_STACK_MV });

/**
 * Compute one negative-status damage instance.
 * @param {object} args
 * @param {string} args.status      — e.g. 'glacio_chafe'
 * @param {number} args.stacks      — the stack count THIS instance scales at
 * @param {number} [args.atkLv=90]  — inflicting resonator's level
 * @param {object} args.target      — same shape as formula.js computeDamage's target
 * @param {number} [args.amplify=0] — status-specific amplify only (docs §2e: generic
 *                                     DMG bonus/amplify must NOT flow in here)
 * @param {object} [args.dataset]   — pass it to read the game's own per-level
 *                                     LevelModifier curve; omitting it pins the
 *                                     calibrated level-90 value (see nsLevelModifier)
 * @returns {number} expected damage (always non-crit — see above)
 */
export function computeNegativeStatusDamage({ status, stacks, atkLv = 90, target, amplify = 0, dataset = null }) {
    const levelMod = nsLevelModifier(status, atkLv, dataset);
    const stackMv = STACK_MV_TABLES[status]?.[stacks];
    if (levelMod == null || stackMv == null || !target) return 0;

    const defMult = nsDefMult(atkLv, target);
    const elementId = ELEMENT_ID_BY_NAME[NEGATIVE_STATUS_DEFS[status]?.element];
    const baseRes = target.resistances?.[elementId] ?? 0;
    const resMult = computeResMult(baseRes);

    return levelMod * stackMv * defMult * resMult * (1 + amplify);
}

// Enemy class → fixed Tune Break multiplier (maintainer-confirmed). Calamity
// shares Overlord's value. Our standard sim target is theorycrafted against a
// boss-tier training dummy, so it defaults to 'overlord' (matches the one
// verified worked example, which used 14) — overridable via target.enemyType.
export const ENEMY_TYPE_MULTIPLIER = Object.freeze({
    common: 1, elite: 3, overlord: 14, calamity: 14,
});

// "Tune AMP" — treated as a universal mechanic constant (maintainer: "most
// likely a constant," same confidence tier as LevelModifier), shared by Tune
// Rupture and Tune Strain since only one worked example exists and both are
// the same underlying "tune bar" mechanic. Kit-specific modifiers (Tune Break
// Boost, Tune Rupture/Strain Response combat-role tags) are NOT folded in here
// — they correspond to the formula's separately-modeled Bonus DMG / Tune Break
// Boost multiplicative buckets (both 0% in the verified example), passed via
// `bonusDmg`/`tuneBreakBoost` below, not a change to this base constant.
const TUNE_AMP = 16.00;   // 1600%, MV-style fraction

/**
 * Tune Break damage (Tune Rupture / Tune Strain — the "tune bar" mechanic).
 * Same DEF/RES formula family as computeNegativeStatusDamage but with its own
 * AMP constant and an Enemy Type Multiplier the Chafe formula doesn't have.
 * Verified against one real worked example (Hiyuki, lvl 90, Overlord enemy,
 * 12% DEF-shred) to within 0.001%.
 *
 *   DMG = LevelModifier × (1+BonusDmg%) × TuneAmp × DefMult × ResMult
 *         × EnemyTypeMultiplier × (1+TuneBreakBoost%)
 *
 * `element` is the RES bucket to read (target.resistances[element]) — unlike
 * Glacio Chafe, Tune Rupture/Strain have no fixed element of their own
 * (NEGATIVE_STATUS_DEFS marks them `element: null`); the verified example's
 * 90% RES matches Hiyuki's own Glacio RES, so the damage appears to inherit
 * the TRIGGERING resonator's element, not a fixed "tune" element — caller's
 * responsibility to pass the right elementId rather than guessed here.
 *
 * NOT wired into the live team sim: doing so needs an "off-tune buildup" gauge
 * model (per-skill buildup rate, who/when triggers the break) we have zero
 * data for — a separate, larger undertaking from this formula itself.
 */
export function computeTuneBreakDamage({ status, atkLv = 90, target, element = null, enemyType = 'overlord', bonusDmg = 0, tuneBreakBoost = 0 }) {
    const levelMod = NS_LEVEL_MODIFIER[status];
    const enemyMult = ENEMY_TYPE_MULTIPLIER[enemyType];
    if (levelMod == null || enemyMult == null || !target) return 0;

    const defMult = nsDefMult(atkLv, target);
    const resMult = computeResMult(target.resistances?.[element] ?? 0);

    return levelMod * (1 + bonusDmg) * TUNE_AMP * defMult * resMult * enemyMult * (1 + tuneBreakBoost);
}

/**
 * Which statuses a member inflicts, from (a) the resonance MODE it runs (a mode
 * named after a status inflicts it) and (b) its KIT text (triggerability scan —
 * e.g. Hiyuki/Phoebe/Chisa apply their status without a mode). Returns a Set of
 * canonical status keys.
 *
 * P13-fix (2026-07-02): `inflictsStatus`'s plain substring scan over the WHOLE
 * concatenated kit text can't distinguish "this resonator inflicts X" from
 * "this resonator's kit text merely NAMES X" — e.g. Rover: Aero's Resonance
 * Skill "removes all stacks of Spectro Frazzle, Havoc Bane, Fusion Burst,
 * Glacio Chafe, and Electro Flare ... and inflicts 1 stack of Aero Erosion";
 * Hiyuki's Fine Snow inherent reacts to "a Resonator in the team applies
 * Glacio Chafe or Havoc Bane" (a teammate's inflict, not her own). Both false-
 * matched 5 statuses each that the character (Aero / Glacio respectively)
 * cannot possibly inflict. Every status here is tied to a fixed element
 * (`NEGATIVE_STATUS_DEFS[key].element`) — a resonator whose own element
 * doesn't match can never be a real applier, so gate on that BEFORE the text
 * scan. Confirmed against the dataset: this removes exactly the 12 false
 * positives found (Rover: Aero ×5, Cartethyia ×5, Hiyuki ×1, Ciaccona ×1)
 * with zero collateral loss (every genuine applier already matches its own
 * status's element — e.g. Phoebe/spectro_frazzle, Hiyuki/glacio_chafe).
 */
export function statusesInflictedBy(resonator, dataset, resonanceMode = null) {
    const out = new Set();
    if (resonanceMode && STATUS_KEYS.includes(resonanceMode)) out.add(resonanceMode);
    for (const key of STATUS_KEYS) {
        const wantElement = NEGATIVE_STATUS_DEFS[key]?.element;
        if (wantElement && ELEMENT_ID_BY_NAME[wantElement] !== resonator?.element) continue;
        if (inflictsStatus(resonator, dataset, statusSpaceForm(key))) out.add(key);
    }
    return out;
}

/**
 * One application event = one qualifying cast applying one stack of one status.
 * @typedef {{ t:number, status:string, applicatorId:number, applicatorLevel?:number }} StatusApplication
 */

/**
 * Emit per-cast applications for a member's steps: one stack of each inflicted
 * status per damaging step, at the step's start time (offset into team time).
 * v1 accrues on every damaging step the member casts (the member is built around
 * inflicting it); element-matched refinement is additive and noted in the model.
 *
 * @param {Array} steps                  — resolved steps (startTime in team time)
 * @param {Set<string>} inflicted        — status keys this member inflicts
 * @param {number} applicatorId
 * @param {number} [applicatorLevel]
 * @returns {StatusApplication[]}
 */
export function applicationsFromSteps(steps, inflicted, applicatorId, applicatorLevel = 90) {
    if (!inflicted || inflicted.size === 0) return [];
    const out = [];
    for (const step of steps) {
        if (!(step.stepDamage > 0)) continue;            // only damaging casts apply
        for (const status of inflicted) {
            out.push({ t: step.startTime, status, applicatorId, applicatorLevel });
        }
    }
    return out;
}

/**
 * Build a queryable enemy-status timeline from per-cast applications.
 * Accrual: +1 stack per application (capped at maxStacks), with decay between
 * applications where stackDecayS is defined. resetOnMax is NOT applied to the
 * presence timeline (the explosion/consume is a Layer-4 DAMAGE event; for stack
 * PRESENCE the team keeps the status applied) — documented in the model §2a.
 *
 * @param {StatusApplication[]} applications
 */
export function buildEnemyStatusTimeline(applications = []) {
    const byStatus = new Map();
    for (const application of applications) {
        if (!byStatus.has(application.status)) byStatus.set(application.status, []);
        byStatus.get(application.status).push(application);
    }
    for (const events of byStatus.values()) events.sort((x, y) => x.t - y.t);

    function statusStacksAt(status, time) {
        const events = byStatus.get(status);
        if (!events || events.length === 0) return 0;
        const def = NEGATIVE_STATUS_DEFS[status] ?? {};
        const cap = def.maxStacks ?? 10;
        const decayS = def.stackDecayS ?? null;
        let stacks = 0, last = null;
        for (const application of events) {
            if (application.t > time + 1e-9) break;
            if (last != null && decayS) stacks = Math.max(0, stacks - Math.floor((application.t - last) / decayS));
            stacks = Math.min(cap, stacks + 1);
            last = application.t;
        }
        if (stacks > 0 && last != null && decayS) stacks = Math.max(0, stacks - Math.floor((time - last) / decayS));
        return stacks;
    }

    function presentDuring(status, startTime, endTime) {
        if (statusStacksAt(status, endTime) > 0) return true;
        for (const application of byStatus.get(status) ?? []) {
            if (application.t >= startTime - 1e-9 && application.t <= endTime + 1e-9 && statusStacksAt(status, application.t) > 0) return true;
        }
        return false;
    }

    function presentStatusesAt(time) {
        const out = new Set();
        for (const status of byStatus.keys()) if (statusStacksAt(status, time) > 0) out.add(status);
        return out;
    }

    function lastApplicatorAt(status, time) {
        let app = null;
        for (const application of byStatus.get(status) ?? []) {
            if (application.t > time + 1e-9) break;
            app = application;
        }
        return app;
    }

    return { statusStacksAt, presentDuring, presentStatusesAt, lastApplicatorAt, statuses: [...byStatus.keys()], applications };
}

/**
 * Distinct-applicator count for "Snow Rust"-style team-wide tier mechanics
 * (Hiyuki's Fine Snow, Aemeath's Between the Stars): counts how many DISTINCT
 * resonators have, by time t, applied at least one of the given statuses — each
 * applicator counts once no matter how many times, or which, of the statuses
 * they applied ("Each Resonator can trigger this effect only once"). This is
 * deliberately separate from statusStacksAt above: that timeline counts CASTS
 * (for enemy-side stack presence/decay); this counts distinct TEAMMATES (for a
 * resonator's own escalating self-buff), so a single applicator hitting twice
 * still contributes exactly one toward this count.
 *
 * @param {StatusApplication[]} applications
 * @param {string[]} statuses
 * @param {number} t
 * @returns {Set<number>} distinct applicatorIds
 */
export function distinctApplicators(applications, statuses, time) {
    const out = new Set();
    for (const application of applications) {
        if (application.t > time + 1e-9) continue;
        if (statuses.includes(application.status)) out.add(application.applicatorId);
    }
    return out;
}
