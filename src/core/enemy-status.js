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
 * Per-kit STACK-LIMIT RAISES (2026-08-01).
 *
 * `NEGATIVE_STATUS_DEFS.maxStacks` is the BASE an enemy holds. Several kits
 * raise it for a window, and the raise is what makes their own higher-band
 * effects reachable at all — Yangyang: Xuanling amplifies at 4-6 stacks of Havoc
 * Bane, which the base cap of 3 forbids until her own S3 lifts it:
 *
 *   "After casting Intro Skill - Skybound Feather, Resonance Skill - Sword
 *    Stance Flow: Azure, or Resonance Skill - Sword Stance Flow: Feather,
 *    increase the maximum Havoc Bane stacks on targets within a certain range
 *    by 3, lasting 20s. This effect does not stack."
 *
 * Curated because the raise is stated in kit text and the chain→buff walk
 * (docs/CONFIGDB-RECON.md) reaches only about a quarter of chain nodes. Every
 * entry below quotes its own kit sentence and is data-integrity tested against
 * real skill keys and a real status name.
 *
 *   { amount, chain, seconds, note,
 *     status?, keys?: [skillKey],            — a CAST arms it, for one status
 *     onInflict?: [status], gate?: {keys, seconds} }  — INFLICTING arms it
 *
 * Two trigger shapes, because kits use both. `keys` is a cast ("Casting
 * Resonance Liberation … increases the max stack limit"). `onInflict` arms the
 * raise on the status APPLICATION itself and raises whichever status was
 * applied — Suisui's Ceaseless Landscape lifts the cap of whichever of five
 * negative statuses a teammate just inflicted — optionally only while an
 * enclosing `gate` window is open (hers is the 30s Landscape from her
 * Liberation).
 *
 * `chain` is the resonance-chain level that must be UNLOCKED (a skill tree —
 * once unlocked it is permanently in effect), 0 for a base-kit raise.
 * `seconds: null` means the kit states NO duration — modelled as lasting to the
 * end of the rotation, which is the only reading the text supports.
 * "Does not stack" is honoured by taking the MAX amount per source rather than
 * summing repeats; different sources do sum.
 *
 * Spatial qualifiers ("on targets within a certain range", "targets near the
 * active Resonator") are deliberately dropped: the sim has no positioning and
 * enemy-facing abilities are taken to always hit and always trigger.
 */
export const STATUS_CAP_RAISES = Object.freeze({
    // Suisui — Liberation deploys [Ceaseless Landscape] for 30s, which grants
    // ALL nearby team Resonators: "Inflicting a target with [Spectro Frazzle],
    // [Fusion Burst], [Glacio Chafe], and [Aero Erosion], or dealing the
    // corresponding Negative Status DMG increases the max stack limit of the
    // corresponding [Negative Status] the target can receive by 3 for 15s. This
    // effect does not stack." — plus the same for [Electro Flare] (its partner
    // [Electro Rage] is an Electro-specific counter we do not model, so only the
    // Flare half is represented).
    1110: [{
        amount: 3, chain: 0, seconds: 15,
        onInflict: ['spectro_frazzle', 'fusion_burst', 'glacio_chafe', 'aero_erosion', 'electro_flare'],
        gate: { keys: ['liberation_healing_per_plume_step'], seconds: 30 },
        note: 'Ceaseless Landscape (Liberation, 30s): inflicting one of five negative statuses raises THAT status\'s cap by 3 for 15s, for the whole team. Does not stack.',
    }],
    // Cartethyia — S2 "Casting Resonance Liberation - A Knight's Heartfelt
    // Prayers increases the max stack limit of Aero Erosion on targets within a
    // certain range by 3." No duration is stated, so it runs to the end of the
    // rotation. Her two Liberation forms (A Knight's Heartfelt Prayers /
    // Blade of Howling Squall, the Fleurdelys transformation) share the single
    // `liberation_blade_of_howling_squall` skill-map entry, which is therefore
    // the only Liberation step a rotation can hold for her.
    1409: [{
        status: 'aero_erosion', amount: 3, chain: 2, seconds: null,
        keys: ['liberation_blade_of_howling_squall'],
        note: 'S2: casting Resonance Liberation increases the max stack limit of Aero Erosion by 3. No duration stated.',
    }],
    // Yangyang: Xuanling — S3 "My Grief Follows You into the Clouds".
    1610: [{
        status: 'havoc_bane', amount: 3, chain: 3, seconds: 20,
        keys: ['intro_skybound_feather', 'forte_heavy_sword_stance_flow_azure', 'forte_heavy_sword_stance_flow_feather'],
        note: 'S3: increase the maximum Havoc Bane stacks on targets within a certain range by 3, lasting 20s. This effect does not stack.',
    }],
    // NOT curated — Aemeath S6: "the max stack limit of Rupturous Trail/Fusion
    // Trail … is increased to 60". Rupturous Trail and Fusion Trail are a
    // SEPARATE Aemeath mechanic, not tune_rupture / fusion_burst (her kit names
    // all four distinctly), and we model no Trail stacks at all. Mapping it onto
    // a status we do model would invent a mechanic. It is also a SET ("to 60"),
    // not an ADD, which this table has no shape for.
});

/** Cap-raise definitions for a resonator at a given unlocked chain level. */
export function capRaisesForResonator(resonatorId, chainLevel = 0) {
    return (STATUS_CAP_RAISES[Number(resonatorId)] ?? [])
        .filter(raise => (raise.chain ?? 0) <= chainLevel);
}

/**
 * CAST-triggered cap-raise windows on the shared enemy. A raise arms at the END
 * of a triggering cast and lasts `seconds`, the same convention castMatch buff
 * windows use, so a raise and a buff triggered by the same cast agree about
 * when they start. Inflict-triggered raises are capRaiseWindowsFromInflicts.
 *
 * @param {Array<{skillKey, endTime}>} steps  — team-time steps for one member
 * @param {number} resonatorId
 * @param {number} chainLevel
 * @returns {Array<{status, amount, start, end, source}>}
 */
export function capRaiseWindowsFromSteps(steps, resonatorId, chainLevel = 0) {
    const out = [];
    // A null duration means the kit states none — it holds for the rest of the
    // fight rather than silently becoming zero-length.
    const endOf = (start, seconds) => (seconds == null ? Infinity : start + seconds);

    for (const raise of capRaisesForResonator(resonatorId, chainLevel)) {
        // Cast-triggered: every matching step arms one window for one status.
        if (raise.keys) {
            const source = `${resonatorId}:${raise.status}`;
            for (const step of steps ?? []) {
                if (!raise.keys.includes(step.skillKey)) continue;
                const start = step.endTime ?? step.startTime ?? 0;
                out.push({ status: raise.status, amount: raise.amount, start, end: endOf(start, raise.seconds), source });
            }
        }

    }
    return out;
}

/**
 * GATE windows a member's own casts open, for its own inflict-triggered raises.
 * Kept separate from the raise windows because a gate outlives the segment that
 * opened it: Suisui deploys Ceaseless Landscape in HER segment, and it is a
 * teammate inflicting a status later that actually arms the raise.
 *
 * @returns {Array<{resonatorId, start, end}>}
 */
export function capRaiseGateWindows(steps, resonatorId, chainLevel = 0) {
    const out = [];
    for (const raise of capRaisesForResonator(resonatorId, chainLevel)) {
        if (!raise.onInflict || !raise.gate) continue;
        for (const step of steps ?? []) {
            if (!raise.gate.keys.includes(step.skillKey)) continue;
            const start = step.endTime ?? step.startTime ?? 0;
            out.push({ resonatorId: Number(resonatorId), start, end: start + raise.gate.seconds });
        }
    }
    return out;
}

/**
 * Windows that status APPLICATIONS arm, across every team member that owns an
 * inflict-triggered raise. The raise lifts whichever status was just applied,
 * by whoever applied it — it is a property of the enemy, not of the applicator,
 * so one member's Ceaseless Landscape raises the cap for the whole team.
 *
 * @param {StatusApplication[]} applications
 * @param {Array<{resonatorId, chain}>} members — the team, with unlocked chain levels
 * @param {Array<{resonatorId, start, end}>} gates — from capRaiseGateWindows
 * @returns {Array<{status, amount, start, end, source}>}
 */
export function capRaiseWindowsFromInflicts(applications, members, gates = []) {
    const out = [];
    for (const member of members ?? []) {
        for (const raise of capRaisesForResonator(member.resonatorId, member.chain ?? 0)) {
            if (!raise.onInflict) continue;
            const ownGates = raise.gate
                ? gates.filter(gate => gate.resonatorId === Number(member.resonatorId)) : null;
            for (const application of applications ?? []) {
                if (!raise.onInflict.includes(application.status)) continue;
                if (ownGates && !ownGates.some(gate =>
                    application.t >= gate.start - 1e-9 && application.t <= gate.end + 1e-9)) continue;
                out.push({
                    status: application.status,
                    amount: raise.amount,
                    start: application.t,
                    end: raise.seconds == null ? Infinity : application.t + raise.seconds,
                    // Per STATUS, so one kit raising five statuses keeps five
                    // independent "does not stack" groups rather than one.
                    source: `${member.resonatorId}:${application.status}`,
                });
            }
        }
    }
    return out;
}

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
// straight from the client ConfigDB). That table is one value per level,
// IDENTICAL across all six elements, so it is the LevelModifier for every
// ELEMENTAL negative status — not just the one whose worked examples happened
// to pin the constant. Tune Rupture/Strain are NOT in it: they carry no element
// and their 716.22 is a different mechanic's constant.
const ABNORMAL_DAMAGE_STATUSES = new Set(
    Object.entries(NEGATIVE_STATUS_DEFS)
        .filter(([, def]) => def.element != null)
        .map(([status]) => status),
);

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

/**
 * Affliction damage at an explicit multiplier — the kit-triggered path.
 *
 * Same formula family as computeNegativeStatusDamage; the only difference is
 * where the multiplier comes from. There it is the status's own per-stack
 * table; here it is the triggering kit's table, read from the game
 * (data/affliction-damage.json).
 *
 * @param {object} args
 * @param {string} args.status
 * @param {number} args.multiplier  — already a fraction (1.15 = 115%)
 * @param {number} [args.atkLv=90]
 * @param {object} args.target
 * @param {object} [args.dataset]
 * @returns {number}
 */
export function computeAfflictionDamage({ status, multiplier, atkLv = 90, target, dataset = null }) {
    const levelMod = nsLevelModifier(status, atkLv, dataset);
    if (levelMod == null || !target || !(multiplier > 0)) return 0;
    const elementId = ELEMENT_ID_BY_NAME[NEGATIVE_STATUS_DEFS[status]?.element];
    return levelMod * multiplier * nsDefMult(atkLv, target) * computeResMult(target.resistances?.[elementId] ?? 0);
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

// Spectro Frazzle and Aero Erosion, maintainer-confirmed in
// docs/NEGATIVE-STATUS-REFERENCE.md §2c since 2026-06-28 but never wired into
// the engine until 2026-08-01 — their damage was silently absent, not zero.
// Aero Erosion's stacks 4-6 are only reachable through a cap raise (Cartethyia
// S2, Suisui's Landscape — STATUS_CAP_RAISES), which is exactly why the table
// goes past its base cap of 3.
const SPECTRO_FRAZZLE_STACK_MV = Object.freeze({
    1: 0.240, 2: 0.4355, 3: 0.6298, 4: 0.8251, 5: 1.020,
    6: 1.216, 7: 1.409, 8: 1.605, 9: 1.800, 10: 1.995,
});

const AERO_EROSION_STACK_MV = Object.freeze({
    1: 0.360, 2: 0.899, 3: 1.799, 4: 2.698, 5: 3.597, 6: 4.497,
});

const STACK_MV_TABLES = Object.freeze({
    glacio_chafe: GLACIO_CHAFE_STACK_MV,
    spectro_frazzle: SPECTRO_FRAZZLE_STACK_MV,
    aero_erosion: AERO_EROSION_STACK_MV,
    // fusion_burst / electro_flare: NO confirmed stack multiplier exists
    // (docs/NEGATIVE-STATUS-REFERENCE.md §2c "pending calibration"). Their
    // damage is therefore UNCOUNTABLE rather than zero — statusDamageGaps()
    // reports it so an absent number is visible instead of silently missing.
    // havoc_bane deals no damage at all by design (DEF reduction only).
});

// =============================================================================
// Kit-TRIGGERED affliction damage (2026-08-01)
// =============================================================================
//
// Separate from the generic affliction damage above. A few kits consume a
// stacking mark on the target to fire one big affliction instance, and the
// multiplier for it lives on THAT KIT'S buff (extracted to
// data/affliction-damage.json, `ExtraEffectID 121`) rather than in any global
// per-status table — which is why Fusion Burst was never calibratable by
// observing one character.
//
// Aemeath is the worked case, and her kit text reproduces the extracted numbers
// exactly:
//   "when Resonators in the team inflict [Fusion Burst], inflict 1 of [Fusion
//    Trail] for 30s, stacking up to 30 times"
//   "Resonance Skill [Seraphic Duet] removes the [Fusion Trail] stacks … and
//    trigger the [Fusion Burst] on the target"
//   "Each stack of [Fusion Trail] removed increases the DMG Multiplier of
//    [Fusion Burst] on the main target by 10%"   → 100% + 10%/stack
//   S2: "…now provides a 15% DMG Multiplier increase"  → 100% + 15%/stack
//   S6: max stack limit 30 → 60
// Extracted table 1210072022 reads 1.1 at 1 stack and 7.0 at 60 — exactly
// 1.00 + 0.10 × stacks. 1210072024 (S2) reads 1.15 and 10.0 — 1.00 + 0.15 × n.
//
// The MARK is derived, not curated: Fusion Trail accrues one stack per team
// Fusion Burst infliction, and those applications are already on the shared
// enemy timeline.
export const AFFLICTION_TRIGGERS = Object.freeze({
    1210: [{
        status: 'fusion_burst',
        mode: 'fusion_burst',                       // her Resonance Mode
        keys: ['forte_heavy_seraphic_duet_encore', 'forte_heavy_seraphic_duet_overture'],
        mark: { fromStatus: 'fusion_burst', seconds: 30, cap: 30, capByChain: { 6: 60 } },
        // Buff ids in data/affliction-damage.json; the sim reads its numbers
        // from there, this only says WHICH table is live.
        buffId: 1210072022,
        buffIdByChain: { 2: 1210072024 },
        note: 'Seraphic Duet consumes Fusion Trail to trigger Fusion Burst. '
            + 'The Stardust Resonance variants (1210072023 / 1210072025, +200% / +400%) '
            + 'are NOT selected: that state is not modelled, so the sim takes the '
            + 'un-buffed table rather than assuming the stronger one.',
    }],
});

/**
 * The kit-triggered affliction entry live for a build, or null.
 * @param {number} resonatorId
 * @param {number} chainLevel
 * @param {string|null} resonanceMode
 */
export function afflictionTriggerFor(resonatorId, chainLevel = 0, resonanceMode = null) {
    for (const entry of AFFLICTION_TRIGGERS[Number(resonatorId)] ?? []) {
        if (entry.mode && resonanceMode && entry.mode !== resonanceMode) continue;
        const byChain = Object.entries(entry.buffIdByChain ?? {})
            .map(([level, id]) => [Number(level), id])
            .filter(([level]) => level <= chainLevel)
            .sort((low, high) => high[0] - low[0])[0];
        const cap = Object.entries(entry.mark.capByChain ?? {})
            .map(([level, value]) => [Number(level), value])
            .filter(([level]) => level <= chainLevel)
            .sort((low, high) => high[0] - low[0])[0];
        return {
            ...entry,
            buffId: byChain ? byChain[1] : entry.buffId,
            markCap: cap ? cap[1] : entry.mark.cap,
        };
    }
    return null;
}

/**
 * The mark's stack count at one instant: one stack per qualifying status
 * application inside the mark's window, capped.
 */
export function markStacksAt(timeline, mark, cap, time) {
    if (!timeline) return 0;
    let count = 0;
    for (const application of timeline.applications) {
        if (application.status !== mark.fromStatus) continue;
        if (application.t > time + 1e-9) continue;
        if (application.t < time - mark.seconds - 1e-9) continue;
        count++;
    }
    return Math.min(count, cap);
}

/**
 * Damage instances from a member's kit-triggered afflictions.
 *
 * @param {object} timeline    — the shared enemy timeline
 * @param {Array<{skillKey, endTime}>} steps — that member's team-time steps
 * @param {object} build
 * @param {object} dataset     — carries afflictionDamage.multipliers
 * @param {(status:string, multiplier:number, atkLv:number) => number} damageOf
 * @returns {Array<{status, t, stacks, multiplier, damage, applicatorId}>}
 */
export function resolveAfflictionTriggers(timeline, steps, build, dataset, damageOf) {
    const entry = afflictionTriggerFor(build?.resonatorId, build?.chain ?? 0, build?.resonanceMode ?? null);
    if (!entry || !timeline) return [];
    const table = (dataset?.afflictionDamage?.multipliers ?? [])
        .find(row => row.buffId === entry.buffId)?.byStacks;
    if (!table) return [];

    const out = [];
    for (const step of steps ?? []) {
        if (!entry.keys.includes(step.skillKey)) continue;
        const time = step.endTime ?? step.startTime ?? 0;
        const stacks = markStacksAt(timeline, entry.mark, entry.markCap, time);
        if (stacks <= 0) continue;                       // nothing to consume
        const multiplier = table[String(stacks)];
        if (multiplier == null) continue;
        const damage = damageOf(entry.status, multiplier, build?.level ?? 90);
        if (damage > 0) out.push({ status: entry.status, t: time, stacks, multiplier, damage, applicatorId: build.resonatorId });
    }
    return out;
}

/** Statuses that deal damage but have no confirmed per-stack multiplier yet. */
export function statusHasDamageModel(status) {
    const def = NEGATIVE_STATUS_DEFS[status];
    if (!def) return false;
    if (!(def.damageOnStack || def.damageOnTick || def.damageOnMax)) return false;
    return STACK_MV_TABLES[status] != null;
}

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
/**
 * Negative-status damage that is NOT one-per-application: periodic ticks
 * (Aero Erosion, Spectro Frazzle, Electro Flare) and burst-on-max (Fusion
 * Burst). Both were entirely unmodelled until 2026-08-01 — `damageOnTick` and
 * `damageOnMax` were declared in NEGATIVE_STATUS_DEFS and read by nothing, so
 * four of the six statuses contributed no damage whatsoever.
 *
 * Resolved as a POST-PASS over the finished timeline rather than incrementally,
 * because a tick needs to know how long the status survived and a burst needs
 * the cap in force — neither is known while the rotation is still being built.
 *
 * Attribution follows `lastApplicatorAt`: the member who most recently applied
 * the status owns the damage, which is the same rule the per-application path
 * uses for the inflicting level.
 *
 * @param {object} timeline    — from buildEnemyStatusTimeline
 * @param {number} endTime     — team-rotation end, in the same clock as applications
 * @param {(status:string, stacks:number, atkLv:number) => number} damageOf
 * @returns {Array<{status, t, stacks, applicatorId, damage, kind}>}
 */
export function resolveStatusOverTimeDamage(timeline, endTime, damageOf) {
    const out = [];
    if (!timeline || !(endTime > 0)) return out;

    for (const status of timeline.statuses) {
        const def = NEGATIVE_STATUS_DEFS[status] ?? {};
        if (!STACK_MV_TABLES[status]) continue;          // no model → reported as a gap instead
        const applications = timeline.applications.filter(entry => entry.status === status);
        if (applications.length === 0) continue;

        // Periodic ticks, from the first application to the end of the fight.
        if (def.damageOnTick && def.tickIntervalS > 0) {
            const first = applications[0].t;
            for (let time = first + def.tickIntervalS; time <= endTime + 1e-9; time += def.tickIntervalS) {
                const stacks = timeline.statusStacksAt(status, time);
                if (stacks <= 0) continue;
                const applicator = timeline.lastApplicatorAt(status, time);
                const damage = damageOf(status, stacks, applicator?.applicatorLevel ?? 90);
                if (damage > 0) out.push({ status, t: time, stacks, applicatorId: applicator?.applicatorId ?? null, damage, kind: 'tick' });
            }
        }

        // Burst on reaching the cap: the application that takes the status to
        // its limit detonates it. `resetOnMax` clears the stacks in-game; the
        // presence timeline deliberately does not model that removal (see
        // buildEnemyStatusTimeline), so the burst is credited where the cap is
        // first reached and not re-credited while it stays pinned there.
        if (def.damageOnMax) {
            let wasAtCap = false;
            for (const application of applications) {
                const stacks = timeline.statusStacksAt(status, application.t);
                const atCap = stacks >= timeline.capAt(status, application.t);
                if (atCap && !wasAtCap) {
                    const damage = damageOf(status, stacks, application.applicatorLevel ?? 90);
                    if (damage > 0) out.push({ status, t: application.t, stacks, applicatorId: application.applicatorId, damage, kind: 'burst' });
                }
                wasAtCap = atCap;
            }
        }
    }
    return out;
}

/**
 * Status damage the sim CANNOT compute, with the reason — so an absent number
 * is visible rather than silently missing (the 2026-07-31 zero-value rule).
 *
 * The live case is Aemeath: her whole kit revolves around Fusion Burst / Tune
 * Rupture, and neither has a confirmed per-stack multiplier
 * (docs/NEGATIVE-STATUS-REFERENCE.md §2c, "pending calibration"), so every
 * stack she applies resolves to no damage at all. That is a missing
 * measurement, not a mechanic that deals nothing.
 *
 * @param {object} timeline
 * @returns {Array<{status, applications, reason}>}
 */
export function statusDamageGaps(timeline) {
    const out = [];
    if (!timeline) return out;
    for (const status of timeline.statuses) {
        const def = NEGATIVE_STATUS_DEFS[status] ?? {};
        const deals = def.damageOnStack || def.damageOnTick || def.damageOnMax;
        if (!deals || STACK_MV_TABLES[status]) continue;
        out.push({
            status,
            applications: timeline.applications.filter(entry => entry.status === status).length,
            reason: 'no confirmed per-stack multiplier (pending in-game calibration)',
        });
    }
    return out;
}

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
 * @param {Array<{status, amount, start, end, source}>} [capRaises] — windows in
 *        which a kit lifts the status's base cap (capRaiseWindowsFromSteps)
 */
export function buildEnemyStatusTimeline(applications = [], capRaises = []) {
    const byStatus = new Map();
    for (const application of applications) {
        if (!byStatus.has(application.status)) byStatus.set(application.status, []);
        byStatus.get(application.status).push(application);
    }
    for (const events of byStatus.values()) events.sort((x, y) => x.t - y.t);

    // The cap in force at one instant: the base plus any raise window covering
    // it. Repeats of the SAME source do not stack ("This effect does not stack"
    // — re-casting the trigger refreshes the window rather than adding to the
    // lift), so each source contributes its largest amount once; distinct
    // sources sum, which is what two different kits raising the same status
    // would do.
    function capAt(status, time) {
        const base = NEGATIVE_STATUS_DEFS[status]?.maxStacks ?? 10;
        const bySource = new Map();
        for (const raise of capRaises) {
            if (raise.status !== status) continue;
            if (time < raise.start - 1e-9 || time > raise.end + 1e-9) continue;
            const key = raise.source ?? 'anonymous';
            bySource.set(key, Math.max(bySource.get(key) ?? 0, raise.amount));
        }
        let extra = 0;
        for (const amount of bySource.values()) extra += amount;
        return base + extra;
    }

    function statusStacksAt(status, time) {
        const events = byStatus.get(status);
        if (!events || events.length === 0) return 0;
        const def = NEGATIVE_STATUS_DEFS[status] ?? {};
        const decayS = def.stackDecayS ?? null;
        let stacks = 0, last = null;
        for (const application of events) {
            if (application.t > time + 1e-9) break;
            if (last != null && decayS) stacks = Math.max(0, stacks - Math.floor((application.t - last) / decayS));
            // Capped at the limit in force WHEN THE STACK LANDS, not at query
            // time — a stack gained under a raise was legitimately gained.
            stacks = Math.min(capAt(status, application.t), stacks + 1);
            last = application.t;
        }
        if (stacks > 0 && last != null && decayS) stacks = Math.max(0, stacks - Math.floor((time - last) / decayS));
        // ...but the enemy cannot still be HOLDING more than the cap now in
        // force: when a raise lapses the excess falls away.
        return Math.min(stacks, capAt(status, time));
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

    return { statusStacksAt, capAt, presentDuring, presentStatusesAt, lastApplicatorAt, statuses: [...byStatus.keys()], applications };
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
