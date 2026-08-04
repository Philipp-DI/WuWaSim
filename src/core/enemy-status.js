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
import { unlockedEffects } from './buffs.js';
import { stateActive } from './rotation-state.js';

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
// Stack limit, stack lifetime and tick period all come from the game's own
// system buffs (data/status-damage.json, tools/extract/extract_status_damage.py,
// 2026-08-01) and are asserted equal to it by tests/enemy-status.test.mjs. Three
// of them were wrong or absent before: Electro Flare declared damageOnTick with
// NO interval, so it silently dealt nothing; Glacio Chafe, Fusion Burst and
// Electro Flare had no stack lifetime at all, so their stacks never expired.
export const NEGATIVE_STATUS_DEFS = Object.freeze({
    glacio_chafe:   { element: 'glacio',  maxStacks: 10, stackDecayS: 15,   resetOnMax: true,  damageOnStack: true,  defReductionPerStack: 0 },
    fusion_burst:   { element: 'fusion',  maxStacks: 10, stackDecayS: 15,   resetOnMax: true,  damageOnMax: true,    defReductionPerStack: 0 },
    aero_erosion:   { element: 'aero',    maxStacks: 3,  stackDecayS: 14.8, resetOnMax: false, damageOnTick: true,   tickIntervalS: 3, defReductionPerStack: 0 },
    electro_flare:  { element: 'electro', maxStacks: 10, stackDecayS: 15,   resetOnMax: false, damageOnTick: true,   tickIntervalS: 5, defReductionPerStack: 0 },
    spectro_frazzle:{ element: 'spectro', maxStacks: 10, stackDecayS: 3,    resetOnMax: false, damageOnTick: true,   tickIntervalS: 3, defReductionPerStack: 0 },
    havoc_bane:     { element: 'havoc',   maxStacks: 3,  stackDecayS: 25,   resetOnMax: false, damageOnTick: false,  defReductionPerStack: 0.02 },
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

// Per-stack multiplier (MV/10000, i.e. already a fraction) for one status.
//
// The game ships these on its own system buffs — one reserved buff id and one
// ExtraEffectID per status — read by tools/extract/extract_status_damage.py into
// data/status-damage.json and carried on the dataset. Glacio Chafe's row is
// EXACTLY the curve this file had reverse-engineered from three worked examples
// (0.2450 / 1.4401 / 2.0377 at stacks 1/7/10), which is what confirms the
// reading of every other row.
//
// The fallback below is that reverse-engineered set, kept so a caller with no
// dataset (unit tests, single-formula checks) still gets Glacio Chafe's verified
// numbers. It is deliberately INCOMPLETE — Fusion Burst and Electro Flare have no
// community figure at all, and Spectro Frazzle / Aero Erosion sat at exactly 0.8x
// the game's values, so anything not covered here is reported as a gap rather
// than guessed.
const FALLBACK_STACK_MV = Object.freeze({
    glacio_chafe: Object.freeze({
        1: 0.2450, 2: 0.4442, 3: 0.6434, 4: 0.8426, 5: 1.0418,
        6: 1.2409, 7: 1.4401, 8: 1.6393, 9: 1.8385, 10: 2.0377,
    }),
});

/**
 * The per-stack multiplier table for a status: the game's own if a dataset is
 * available, else the calibrated fallback, else null (→ reported as a gap).
 * Havoc Bane's game row is a DEF reduction, not damage, and is excluded here.
 */
export function stackMvTable(status, dataset = null) {
    const fromGame = dataset?.statusDamage?.statuses?.[status];
    if (fromGame && !fromGame.isDefReduction && fromGame.byStacks) {
        const out = {};
        for (const [stacks, value] of Object.entries(fromGame.byStacks)) out[Number(stacks)] = value;
        return out;
    }
    return FALLBACK_STACK_MV[status] ?? null;
}

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
        // The MARK — Fusion Trail — is a debuff in its own right, with three
        // separate sources, all from her Forte plus S6:
        //   "when Resonators in the team inflict [Fusion Burst], inflict 1 of
        //    [Fusion Trail] for 30s, stacking up to 30 times"     → perApplication
        //   S6 "The stacks of … Fusion Trail inflicted on the target through
        //    Forte Circuit To Sculpt the Silence is DOUBLED"      → perApplicationByChain
        //   S6 "the max stack limit … is increased to 60"         → capByChain
        //   S6 "While casting Resonance Skill [Seraphic Duet], inflict 10 stacks
        //    of … [Fusion Trail] … for 30s"                       → onCastByChain
        // Only the cap was modelled before, which is why an S6 Aemeath's Trail
        // count in game climbs far faster than the sim showed.
        mark: {
            name: 'Fusion Trail',
            fromStatus: 'fusion_burst', seconds: 30, cap: 30, capByChain: { 6: 60 },
            perApplication: 1, perApplicationByChain: { 6: 2 },
            onCastKeys: ['forte_heavy_seraphic_duet_encore', 'forte_heavy_seraphic_duet_overture'],
            onCast: 0, onCastByChain: { 6: 10 },
        },
        // Buff ids in data/affliction-damage.json; the sim reads its numbers
        // from there, this only says WHICH table is live.
        buffId: 1210072022,
        buffIdByChain: { 2: 1210072024 },
        // The kit table is a DMG MULTIPLIER on the burst, not the burst itself:
        //   "…trigger the [Fusion Burst] on the target BASED ON ITS MAX STACK
        //    LIMIT without removing its stacks. Each stack of [Fusion Trail]
        //    removed increases the DMG Multiplier of [Fusion Burst] by 10%."
        // So the base is the status's own per-stack value AT THE TARGET'S CAP —
        // 10 normally, more while a teammate raises it — and the table (1.00 +
        // 0.10/stack, rising to 5.00 + 0.15/stack at S2 in Stardust) scales it.
        // Reading the table as the whole multiplier understated every burst she
        // triggers by the entire base, ~7x. "without removing its stacks" is why
        // this coexists with the natural detonation instead of replacing it.
        baseAtMaxStacks: true,
        // "[Heavenfall Edict - Overdrive] … Enter [Stardust Resonance] for 30s."
        // Inside it the burst uses her stronger table: +200% base, +400% at S2
        // ("further increased to 400%" — the kit's own word for the upgrade).
        // Gated on the cast rather than the state timeline so this stays
        // self-contained, exactly as the cap-raise gates do.
        // `casts` mirrors the state's own exit budget (rotation-rules.js
        // STATE_DEFS, exit.uses): "This effect ends after [Seraphic Duet] is
        // cast 2 times" — so a third Duet inside the 30s window is NOT
        // empowered, even though the timer is still running.
        stardust: {
            keys: ['liberation_heavenfall_edict_overdrive'], seconds: 30, casts: 2,
            buffId: 1210072023, buffIdByChain: { 2: 1210072025 },
        },
        note: 'Seraphic Duet consumes Fusion Trail to trigger Fusion Burst. '
            + 'Four tables: base 100%+10%/stack, S2 100%+15%/stack, and the '
            + 'Stardust Resonance pair at +200% / +400%.',
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
        const byChainValue = (table, fallback) => {
            const hit = Object.entries(table ?? {})
                .map(([level, value]) => [Number(level), value])
                .filter(([level]) => level <= chainLevel)
                .sort((low, high) => high[0] - low[0])[0];
            return hit ? hit[1] : fallback;
        };
        const stardustByChain = Object.entries(entry.stardust?.buffIdByChain ?? {})
            .map(([level, id]) => [Number(level), id])
            .filter(([level]) => level <= chainLevel)
            .sort((low, high) => high[0] - low[0])[0];
        return {
            ...entry,
            buffId: byChain ? byChain[1] : entry.buffId,
            markCap: byChainValue(entry.mark.capByChain, entry.mark.cap),
            markPerApplication: byChainValue(entry.mark.perApplicationByChain, entry.mark.perApplication ?? 1),
            markOnCast: byChainValue(entry.mark.onCastByChain, entry.mark.onCast ?? 0),
            // The table to use while the kit's empowering state is up, already
            // resolved for this chain level (null when the kit has no such state).
            stardustBuffId: entry.stardust
                ? (stardustByChain ? stardustByChain[1] : entry.stardust.buffId) : null,
            // The source status's own detonation rule, so the mark can count the
            // re-seeded inflictions it grants (markEventsFor). Resolved here
            // rather than passed through three call sites.
            markReseed: statusBurstRules(resonatorId, resonanceMode ?? entry.mode ?? null)
                ?.find(rule => rule.status === entry.mark?.fromStatus) ?? null,
        };
    }
    return null;
}

/**
 * Fixed-crit multiplier for one member's affliction damage (1 = no crit).
 *
 * Affliction damage never crits on its own — the formula above has no crit
 * term, and the wielder's Crit Rate cannot reach this lane. A kit can grant it,
 * at values that REPLACE the wielder's crit rather than adding to it:
 *
 *   Aemeath S6 — "Aemeath's Tune Rupture DMG can critically hit, with a fixed
 *   Crit. Rate of 80%, and fixed Crit. DMG of 275%" (once per Resonance Mode).
 *
 * The parser routes exactly those onto `afflictionCritRate`/`afflictionCritDmg`
 * (tools/preprocess/effects.mjs) so they are invisible to the stat pipeline —
 * they must never reach resolveChainInherentContext, or they buff every hit the
 * wielder lands and push the build past the Crit Rate cap.
 *
 * Expected-value form matches formula.js exactly: 1 + rate × (critDmg − 1),
 * where critDmg is the multiplier applied ON crit (275% → 2.75), not a bonus.
 *
 * Only the kit-triggered path (resolveAfflictionTriggers) consults this. The
 * over-time path is per-STATUS across every applicator, so a fixed crit there
 * would need each applicator's build — which no status of Aemeath's reaches
 * today, since neither Fusion Burst nor Tune Rupture has a per-stack table.
 *
 * @param {object} build      — carries chain level + resonanceMode
 * @param {object} resonator  — dataset entry (chain/inherent effects)
 * @returns {number}
 */
export function afflictionCritMultiplier(build, resonator) {
    const mode = build?.resonanceMode ?? null;
    let rate = 0, critDmg = 0;
    for (const { effect } of unlockedEffects(build, resonator)) {
        if (effect.mode && effect.mode !== mode) continue;
        if (effect.stat === 'afflictionCritRate') rate = Math.max(rate, effect.value ?? 0);
        else if (effect.stat === 'afflictionCritDmg') critDmg = Math.max(critDmg, effect.value ?? 0);
    }
    if (!(rate > 0) || !(critDmg > 1)) return 1;
    return 1 + Math.min(rate, 1) * (critDmg - 1);
}

/**
 * The mark's stack count at one instant: one stack per qualifying status
 * application inside the mark's window, capped.
 */
export function markStacksAt(timeline, mark, cap, time) {
    return markEventsFor(timeline, [], { mark, markCap: cap, markPerApplication: mark.perApplication ?? 1 })
        .stacksAt(time);
}

/**
 * The MARK as a debuff in its own right — Aemeath's Fusion Trail.
 *
 * It is not a derived count: it has its own sources, its own 30s per-stack
 * lifetime, its own cap, and its own consumption. Modelling it as "one stack per
 * qualifying status application" missed two of its three sources outright.
 *
 * Grants, in the order the kit states them:
 *   - `perApplication` per qualifying negative-status application (doubled at S6)
 *   - `onCast` flat stacks when a listed skill is cast (S6's +10 per Seraphic Duet)
 *   - `markReseed` stacks when the source status detonates and re-seeds itself
 * Each grant expires `mark.seconds` after it lands, so the count decays rather
 * than only ever growing. The consuming cast (`consumeKeys`) reads the count and
 * then clears it — and the S6 on-cast grant lands BEFORE that read, so the cast
 * spends its own grant. The kit's "while casting" does not settle the ordering;
 * two in-game captures do (maintainer, 2026-08-03), and both are exact:
 *
 *   8 Trail standing  → Duet → burst priced at 18 → 8 + 10   (212,376 observed)
 *   24 Trail standing → Duet → burst priced at 34 → 24 + 10  (101,299 observed)
 *
 * The earlier "seeds the NEXT consumption" reading was the conservative guess
 * and it was wrong by a whole grant on every single Duet.
 *
 * @returns {{ events, stacksAt(t), consumedAt(t) }}
 */
/**
 * How grants and consumptions that share ONE instant are ordered.
 *
 * They genuinely do share one: an application is stamped at its step's START
 * time, a consumption at its cast's END time, and adjacent steps carry the same
 * number. Encoding the order as a tiny time offset cannot work — the offset has
 * to be smaller than any real gap between steps and larger than the tolerance
 * the sampler uses to mean "at this instant", and no value is both.
 *
 *   cast (0)        — a cast's own grant lands before the consumption IT performs,
 *                     so the cast spends it (measured: 24 Trail → 34 → burst → 0).
 *   consumption (1)
 *   application (2) — stamped at the same number as the previous cast's end, but
 *                     it belongs to the cast that comes AFTER, and survives
 *                     (measured: her Heavy lands 2 Trail right after a Duet
 *                     emptied the target, and they stand).
 */
const EVENT_ORDER = Object.freeze({ cast: 0, consumption: 1, application: 2, reseed: 2 });
const sameInstant = (left, right) => Math.abs(left - right) <= 1e-9;

/**
 * Windows in which an empowering state is open, from the casts that enter it.
 * Same cast-window shape the cap-raise gates use, so a state and a raise armed
 * by one cast agree. Shared by the mark's consumption rule and the burst's
 * table pick, which must never disagree about whether the state was open.
 */
export function markEmpowerWindows(steps, entry) {
    const stardust = entry?.stardust;
    if (!stardust?.keys?.length) return [];
    return (steps ?? [])
        .filter(step => stardust.keys.includes(step.skillKey))
        .map(step => step.endTime ?? step.startTime ?? 0)
        .map(start => ({ start, end: start + (stardust.seconds ?? 0) }));
}

export function markEventsFor(timeline, steps, entry, consumeKeys = null) {
    const mark = entry?.mark ?? {};
    const cap = entry?.markCap ?? mark.cap ?? Infinity;
    const perApplication = entry?.markPerApplication ?? mark.perApplication ?? 1;
    const onCast = entry?.markOnCast ?? mark.onCast ?? 0;
    const events = [];

    for (const application of timeline?.applications ?? []) {
        if (application.status !== mark.fromStatus) continue;
        events.push({ t: application.t, amount: perApplication, source: 'application' });
    }
    if (onCast > 0 && mark.onCastKeys) {
        for (const step of steps ?? []) {
            if (!mark.onCastKeys.includes(step.skillKey)) continue;
            events.push({ t: step.endTime ?? step.startTime ?? 0, amount: onCast, source: 'cast' });
        }
    }
    // A detonation that RE-SEEDS its status inflicts it again, and an infliction
    // of the source status grants the mark exactly like any other. Measured:
    // mech Stage 3 took Fusion Burst to 6 with Trail at 2, the burst detonated
    // to 1 (the re-seed), and Trail read 4 — one re-seeded infliction at S6's
    // doubled 2 stacks per application.
    for (const burst of burstInstants(timeline, mark.fromStatus, entry?.markReseed)) {
        if (!(burst.reseed > 0)) continue;
        events.push({ t: burst.t, amount: burst.reseed * perApplication, source: 'reseed' });
    }
    // A consumption clears everything standing at that instant — EXCEPT the
    // first consuming cast inside an empowering window.
    //
    // Measured in game (maintainer, 2026-08-03): normally every enhanced-skill
    // cast removes all Fusion Trail. Inside Stardust Resonance the stacks
    // SURVIVE the first cast and are only removed by the second — the same cast
    // that spends the state's 2-cast budget and ends it. The detonation still
    // fires on the spared cast, reading the full standing count.
    //
    // This is what made the sim's Trail curve flat: consuming every time kept
    // the count near its per-cast grant, where in game it compounds across the
    // spared cast (observed 8 → 18 → 24 → 34 → 0). The detonation table is
    // steeply stack-scaled, so the spared cast is worth far more than one extra
    // trigger — it makes the NEXT one much bigger too.
    const empowerWindows = markEmpowerWindows(steps, entry);
    const consumingTimes = (consumeKeys ? (steps ?? []) : [])
        .filter(step => consumeKeys.includes(step.skillKey))
        .map(step => step.endTime ?? step.startTime ?? 0)
        .sort((left, right) => left - right);
    const spared = new Set();
    for (const window of empowerWindows) {
        const first = consumingTimes.find(time =>
            time >= window.start - 1e-9 && time <= window.end + 1e-9 && !spared.has(time));
        if (first != null) spared.add(first);
    }
    const consumedAt = consumingTimes.filter(time => !spared.has(time));
    events.sort((left, right) =>
        sameInstant(left.t, right.t) ? EVENT_ORDER[left.source] - EVENT_ORDER[right.source] : left.t - right.t);

    // Two views of the same count, and they legitimately differ AT a consumption:
    //   stacksAt  — what the CONSUMING CAST reads, i.e. what it gets to spend.
    //   heldAt    — what the enemy is left holding, i.e. what to DRAW.
    // A consumption is stamped at its cast's endTime, which is exactly the next
    // step's startTime — the sampling point for the per-step curve — so without
    // the distinction the picture kept the mark at full height for the whole
    // step AFTER the engine had emptied it.
    const sample = (time, includeConsumptionAtTime) => {
        // Where the read stops among the events sharing this exact instant. A
        // consuming cast reads up to its own consumption and no further; every
        // other read takes the whole instant.
        const consumesHere = consumedAt.some(when => sameInstant(when, time));
        const cutoff = includeConsumptionAtTime || !consumesHere ? Infinity : EVENT_ORDER.consumption;
        const clearedAt = Math.max(-Infinity, ...consumedAt.filter(when =>
            includeConsumptionAtTime ? when <= time + 1e-9 : when < time - 1e-9));
        let held = 0;
        for (const event of events) {
            const order = EVENT_ORDER[event.source];
            if (sameInstant(event.t, time) ? order >= cutoff : event.t > time) break;
            if (event.t < time - mark.seconds - 1e-9) continue;    // that grant has expired
            if (event.t < clearedAt - 1e-9) continue;              // wiped by a consumption
            if (sameInstant(event.t, clearedAt) && order < EVENT_ORDER.consumption) continue;
            held += event.amount;
        }
        return Math.min(held, cap);
    };
    const stacksAt = (time) => sample(time, false);
    const heldAt = (time) => sample(time, true);
    return { events, consumedAt, stacksAt, heldAt };
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
    const tableFor = (buffId) => (dataset?.afflictionDamage?.multipliers ?? [])
        .find(row => row.buffId === buffId)?.byStacks;
    const table = tableFor(entry.buffId);
    if (!table) return [];
    const empowered = entry.stardustBuffId ? tableFor(entry.stardustBuffId) : null;
    // A kit can make this lane crit at FIXED values (Aemeath S6). Applied here
    // rather than inside damageOf so every caller gets it, and reported on the
    // instance so a doubled number is explainable instead of mysterious.
    const critMultiplier = afflictionCritMultiplier(build,
        (dataset?.resonators ?? []).find(candidate => candidate.id === build?.resonatorId));

    // When did the empowering state last open? Same cast-window shape the
    // cap-raise gates use, so a state and a raise armed by one cast agree.
    const empowerStarts = entry.stardust
        ? (steps ?? []).filter(step => entry.stardust.keys.includes(step.skillKey))
            .map(step => step.endTime ?? step.startTime ?? 0)
        : [];

    // Casts still owed by each open empowering window. The kit gives a BUDGET,
    // not just a timer ("ends after Seraphic Duet is cast 2 times"), so a third
    // Duet inside the 30s window uses the base table.
    const empowerBudget = empowerStarts.map(start => ({ start, left: entry.stardust?.casts ?? Infinity }));

    // The mark is its own debuff with its own grants, lifetime, cap and
    // consumption — see markEventsFor. Consuming casts are this entry's keys.
    const mark = markEventsFor(timeline, steps, entry, entry.keys);

    const out = [];
    for (const step of steps ?? []) {
        if (!entry.keys.includes(step.skillKey)) continue;
        const time = step.endTime ?? step.startTime ?? 0;
        const stacks = mark.stacksAt(time);
        if (stacks <= 0) continue;                       // nothing to consume
        const window = empowered == null ? null : empowerBudget.find(candidate =>
            candidate.left > 0
            && time >= candidate.start - 1e-9
            && time <= candidate.start + entry.stardust.seconds + 1e-9);
        const inState = window != null;
        if (window) window.left -= 1;
        const boost = (inState ? empowered : table)[String(stacks)];
        if (boost == null) continue;
        // A kit whose burst is "based on its max stack limit" scales the status's
        // OWN per-stack value at the target's cap NOW (a teammate raising the cap
        // therefore makes every trigger bigger); otherwise the table stands alone.
        const cap = timeline.capAt(entry.status, time);
        const base = entry.baseAtMaxStacks ? (stackMvTable(entry.status, dataset)?.[cap] ?? null) : 1;
        if (base == null) continue;
        const multiplier = base * boost;
        const damage = damageOf(entry.status, multiplier, build?.level ?? 90) * critMultiplier;
        if (damage > 0) {
            out.push({ status: entry.status, t: time, stacks, multiplier, damage, burstCap: cap,
                applicatorId: build.resonatorId, empowered: inState, critMultiplier });
        }
    }
    return out;
}

/** Statuses that deal damage but have no confirmed per-stack multiplier yet. */
export function statusHasDamageModel(status, dataset = null) {
    const def = NEGATIVE_STATUS_DEFS[status];
    if (!def) return false;
    if (!(def.damageOnStack || def.damageOnTick || def.damageOnMax)) return false;
    return stackMvTable(status, dataset) != null;
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
    const stackMv = stackMvTable(status, dataset)?.[stacks];
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
/**
 * Per-kit BURST THRESHOLDS: the stack count at which a status detonates, when a
 * kit lowers it below the cap. Aemeath's Forte, verbatim: "If the targets have
 * more than 5 stacks of [Fusion Burst], trigger [Fusion Burst] based on their
 * max stack limit and remove all of their stacks." She also re-seeds ("when the
 * [Fusion Burst] on targets … reaches 0 stacks, inflict 1 stack"), which is not
 * modelled — the re-seed needs a stack count the shared presence timeline does
 * not maintain, so her detonation rate is if anything understated.
 */
export const STATUS_BURST_RULES = Object.freeze({
    // "more than 5" to detonate. `reseed` is her Forte's own re-seed, confirmed
    // in game 2026-08-03: the counter climbs to 5, the next application briefly
    // shows 6 and detonates, and the target is left holding ONE — not zero.
    // That is "when the [Fusion Burst] on targets near the active Resonator
    // reaches 0 stacks, inflict 1 stack of [Fusion Burst]" firing immediately
    // (buff 1210072004; OPEN-ITEMS #30). It matters for RATE, not just display:
    // each cycle then needs 5 further applications rather than 6.
    1210: [{ status: 'fusion_burst', threshold: 6, reseed: 1, mode: 'fusion_burst' }],
});

/** The burst rules live for a build, or null. */
export function statusBurstRules(resonatorId, resonanceMode = null) {
    const rules = (STATUS_BURST_RULES[Number(resonatorId)] ?? [])
        .filter(rule => !rule.mode || rule.mode === resonanceMode);
    return rules.length ? rules : null;
}

function burstThresholdFor(status, rules) {
    return (rules ?? []).find(rule => rule.status === status)?.threshold ?? null;
}

/**
 * When a status DETONATES, counted from its applications alone.
 *
 * The shared presence timeline deliberately does not model the removal (see
 * buildEnemyStatusTimeline), so the count is tracked locally: it accrues per
 * application and resets to the kit's re-seed on each detonation, which is what
 * lets a threshold fire more than once.
 *
 * Shared by the damage lane and by the MARK, which must never disagree about
 * when the target detonated — the damage lane skips a status with no per-stack
 * table (Fusion Burst has none), but the mark still needs its re-seeds.
 *
 * @param {object} timeline
 * @param {string} status
 * @param {object|Array|null} rules — STATUS_BURST_RULES entries, or one entry
 * @returns {Array<{t:number, stacks:number, held:number, reseed:number, applicatorId, applicatorLevel}>}
 */
export function burstInstants(timeline, status, rules) {
    const list = Array.isArray(rules) ? rules : (rules ? [rules] : []);
    const rule = list.find(entry => entry.status === status);
    if (!rule || !timeline) return [];
    const reseed = rule.reseed ?? 0;
    const out = [];
    let held = 0;
    for (const application of timeline.applications) {
        if (application.status !== status) continue;
        held += 1;
        const cap = timeline.capAt(status, application.t);
        const limit = rule.threshold == null ? cap : Math.min(rule.threshold, cap);
        if (held < limit) continue;
        out.push({ t: application.t, stacks: rule.threshold == null ? held : cap, held, reseed,
            applicatorId: application.applicatorId, applicatorLevel: application.applicatorLevel ?? 90 });
        held = reseed;
    }
    return out;
}

export function resolveStatusOverTimeDamage(timeline, endTime, damageOf, dataset = null, burstRules = null) {
    const out = [];
    if (!timeline || !(endTime > 0)) return out;

    for (const status of timeline.statuses) {
        const def = NEGATIVE_STATUS_DEFS[status] ?? {};
        if (!stackMvTable(status, dataset)) continue;    // no model → reported as a gap instead
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

        // Burst on reaching the threshold. Normally that is the cap — the game's
        // own tutorial: "When Fusion Burst is stacked to its max, ALL STACKS WILL
        // BE REMOVED to trigger an explosion" — but a kit can lower it (Aemeath:
        // "If the targets have more than 5 stacks of [Fusion Burst], trigger
        // [Fusion Burst] based on their max stack limit and remove all of their
        // stacks"), which roughly doubles how often the enemy detonates.
        //
        // The explosion CLEARS the stacks, and the shared presence timeline
        // deliberately does not model that removal (see buildEnemyStatusTimeline)
        // — so the count is tracked LOCALLY here: it accrues per application and
        // resets on each detonation, which is what lets a threshold fire more
        // than once. Damage is priced at the cap, per the same kit clause.
        //
        // The counting — including "remove all of their stacks", and a kit that
        // re-seeds at 0 immediately putting one back — is `burstInstants`, which
        // the MARK shares so the two lanes can never disagree about when the
        // target detonated. A threshold-less status detonates at its own cap.
        if (def.damageOnMax) {
            const rule = (burstRules ?? []).find(entry => entry.status === status)
                ?? { status, threshold: burstThresholdFor(status, burstRules) };
            for (const burst of burstInstants(timeline, status, rule)) {
                const damage = damageOf(status, burst.stacks, burst.applicatorLevel);
                if (damage > 0) {
                    out.push({ status, t: burst.t, stacks: burst.stacks, held: burst.held,
                        applicatorId: burst.applicatorId, damage, kind: 'burst' });
                }
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
export function statusDamageGaps(timeline, dataset = null) {
    const out = [];
    if (!timeline) return out;
    for (const status of timeline.statuses) {
        const def = NEGATIVE_STATUS_DEFS[status] ?? {};
        const deals = def.damageOnStack || def.damageOnTick || def.damageOnMax;
        if (!deals || stackMvTable(status, dataset)) continue;
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
 * WHICH casts actually inflict a status, per kit (2026-08-01).
 *
 * The fallback below treats every damaging step as an application, which is a
 * deliberate v1 approximation — but several kits state the rule outright, naming
 * the skills AND an internal cooldown. Aemeath's Forte is the worked case:
 *
 *   "In [Resonance Mode - Tune Rupture]/[Resonance Mode - Fusion Burst], inflict
 *    [Tune Rupture - Shifting]/[Fusion Burst] when the following skills deal
 *    damage. The same skill can only trigger this effect on the same target once
 *    every 3s: [Basic Attack - Aemeath Stage 3 & 4], [Basic Attack - Mech Stage
 *    3 & 4], Resonance Skill [Sync Strike: Armament Merge], Resonance Skill
 *    [Sync Strike: Call of Dawn], Intro Skill [Songs Across the Universe], and
 *    Intro Skill [Debut of Meteoric Radiance]."
 *
 * `icdSeconds` is PER SKILL KEY, exactly as the text says — two different listed
 * skills 1s apart both apply; the same one twice in 3s applies once. `mode` gates
 * the rule to a Resonance Mode when the kit does, `minChain` to a sequence level,
 * and `state` to a named state being active at the cast.
 *
 * A resonator with no entry keeps the every-damaging-step fallback: that is
 * still an approximation, but an explicit one, and it is what every other kit
 * relies on until its own rule is curated.
 */
export const STATUS_APPLY_RULES = Object.freeze({
    // Buling's array is the roster's only PERIODIC applier, and it is curated
    // rather than derived for the same reason Aemeath is: the sentence that
    // applies the status is not about the cast that applies it.
    //
    //   "Attack the target, dealing Electro DMG and generating a [Five Thunders
    //    Spell Array] at the target area. The array deals Electro DMG and
    //    inflicts 2 stacks of [Electro Flare] on all targets within it every
    //    2s, lasting for 24s."
    //
    // The subject of the applying sentence is "The array" — a summon, whose
    // creating cast is named only in the sentence BEFORE it. Section scoping
    // therefore hands the clause to both her Forte keys, and the wrong one of
    // the two (`..._five_thunders_spell_array_continuous`) is the array's own
    // per-tick DAMAGE row, not the cast that places it. Deriving this needs
    // cross-sentence subject resolution for a single kit, so the derivation
    // rejects periodic clauses outright and this rule states it instead.
    1307: [{
        status: 'electro_flare',
        stacks: 2,
        icdSeconds: 0,
        everySeconds: 2,
        durationS: 24,
        keys: ['forte_heavy_flashing_thunder_spell_harmony'],
    }],
    1210: [{
        status: 'fusion_burst',
        mode: 'fusion_burst',
        stacks: 1,
        icdSeconds: 3,
        keys: ['basic_aemeath_3', 'basic_aemeath_4', 'skill_mech_3', 'skill_mech_4',
            'skill_sync_strike_armament_merge', 'skill_sync_strike_call_of_dawn',
            'intro_songs_across_the_universe', 'intro_debut_of_meteoric_radiance'],
    }, {
        // A SECOND applier her Forte's list does not mention, because it is
        // granted by a sequence node — S3: "In [Instant Response], Aemeath now
        // inflicts [Tune Rupture - Shifting] or [Fusion Burst] on nearby targets
        // while casting [Heavy Attack - Aemeath] or [Heavy Attack - Mech], based
        // on her current Resonance Mode."
        //
        // Confirmed in game (maintainer, 2026-08-03): her enhanced Heavy Attack
        // took Fusion Burst 2 → 3 and Fusion Trail 0 → 2 in a rotation where
        // every other application matched the Forte list exactly. Both gates are
        // the kit's own — S3 grants it, [Instant Response] scopes it — and both
        // are real: at S2 the Heavy applies nothing at all.
        status: 'fusion_burst',
        mode: 'fusion_burst',
        minChain: 3,
        state: 'Instant Response',
        stacks: 1,
        icdSeconds: 3,
        keys: ['heavy_aemeath_charged_i', 'heavy_aemeath_charged_ii',
            'heavy_mech_charged_i', 'heavy_mech_charged_ii'],
    }],
});

/**
 * The apply rules live for a build, or null for the every-damaging-step
 * fallback. A CURATED entry wins outright: it exists precisely where the kit
 * states its rule somewhere the per-skill derivation cannot see it (Aemeath's
 * Forte names eight skills and a 3s ICD in a list of its own), so a derived rule
 * for the same kit would be the weaker reading of the same text.
 */
export function statusApplyRules(resonatorId, resonanceMode = null, dataset = null, chainLevel = 6) {
    const curated = (STATUS_APPLY_RULES[Number(resonatorId)] ?? [])
        .filter(rule => !rule.mode || rule.mode === resonanceMode)
        .filter(rule => (rule.minChain ?? 0) <= chainLevel);
    if (curated.length) return curated;
    const derived = dataset?.statusApplyRules?.[String(resonatorId)];
    return derived?.length ? derived : null;
}

/**
 * Emit per-cast applications for a member's steps, at the step's start time
 * (offset into team time). A kit with a curated rule (STATUS_APPLY_RULES) uses
 * its named skills and per-skill ICD; everything else falls back to one stack of
 * each inflicted status per damaging step.
 *
 * @param {Array} steps                  — resolved steps (startTime in team time)
 * @param {Set<string>} inflicted        — status keys this member inflicts
 * @param {number} applicatorId
 * @param {number} [applicatorLevel]
 * @param {Array<object>|null} [rules]   — from statusApplyRules()
 * @returns {StatusApplication[]}
 */
export function applicationsFromSteps(steps, inflicted, applicatorId, applicatorLevel = 90, rules = null) {
    if (rules?.length) {
        const out = [];
        const lastByKey = new Map();          // "status|skillKey" → last application time
        // A PERIODIC rule's field outlives the cast that placed it, so its ticks
        // are clamped to the rotation the same way an off-field turret's are
        // (`off-field.js`: the shorter of the action's duration and the window).
        // Buling's array lasts 24s but is cast at 6.2s of a 10.3s rotation —
        // counting all 12 ticks would credit damage past the clock the DPS
        // denominator measures.
        const rotationEnd = steps.reduce(
            (latest, step) => Math.max(latest, step.endTime ?? step.startTime ?? 0), 0);
        for (const step of steps) {
            if (!(step.stepDamage > 0)) continue;
            for (const rule of rules) {
                // Derived rules cover every Resonance Mode a kit has, because a
                // mode is a build toggle and both branches must be described.
                // `inflicted` is the chosen mode's set, so it decides which fire.
                if (inflicted?.size && !inflicted.has(rule.status)) continue;
                if (!rule.keys.includes(step.skillKey)) continue;
                // A rule the kit scopes to a named state only fires while that
                // state is up (`step.states`, stamped by sim.js from the state
                // timeline). Absent state info, the gate cannot be evaluated and
                // the rule is skipped rather than assumed open.
                if (rule.state && !stateActive(new Set(step.states ?? []), rule.state)) continue;
                const guard = `${rule.status}|${step.skillKey}`;
                const previous = lastByKey.get(guard);
                if (previous != null && step.startTime < previous + rule.icdSeconds - 1e-9) continue;
                lastByKey.set(guard, step.startTime);

                const instants = [step.startTime];
                if (rule.everySeconds > 0) {
                    const lastTick = Math.min(step.startTime + (rule.durationS ?? 0), rotationEnd);
                    for (let tick = step.startTime + rule.everySeconds;
                        tick <= lastTick + 1e-9; tick += rule.everySeconds) {
                        instants.push(tick);
                    }
                }
                for (const instant of instants) {
                    for (let i = 0; i < (rule.stacks ?? 1); i++) {
                        out.push({ t: instant, status: rule.status, applicatorId, applicatorLevel });
                    }
                }
            }
        }
        return out;
    }
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
 * Every negative-status damage instance ONE rotation produces, against its own
 * enemy — the single-member counterpart of team-sim's accrual.
 *
 * Until 2026-08-01 this lane existed only inside `team-sim.js`, so the build
 * page showed none of it: a solo Aemeath's Fusion Burst — the larger half of her
 * output — was simply absent from her own page, and her DPS was understated by
 * however much of her kit routes through a status rather than a hit.
 *
 * The three damage shapes a status can have, all of them resolved here:
 *   1. `damageOnStack` — one instance per application, at the stack count the
 *      application itself reaches (Glacio Chafe).
 *   2. `damageOnTick` / `damageOnMax` — needs the FINISHED timeline, since a
 *      tick has to know how long the status survived and a burst needs the cap
 *      in force (Aero Erosion, Spectro Frazzle, Electro Flare, Fusion Burst).
 *   3. Kit-TRIGGERED afflictions — a cast consuming a mark for one big instance
 *      at that kit's own multiplier (Aemeath's Seraphic Duet).
 *
 * `gaps` carries the statuses that DO deal damage but have no confirmed
 * multiplier yet, so an absent number stays visible instead of reading as zero.
 *
 * @param {object} args
 * @param {Array} args.steps      — resolved sim steps (startTime/endTime/stepDamage)
 * @param {object} args.build
 * @param {object} args.resonator — dataset entry, for statusesInflictedBy
 * @param {object} args.dataset
 * @param {object} args.target
 * @returns {{ instances: Array<object>, total: number, gaps: Array<object> }}
 */
export function soloStatusDamage({ steps, build, resonator, dataset, target }) {
    const empty = { instances: [], total: 0, gaps: [] };
    if (!steps?.length || !resonator || !target) return empty;

    const resonatorId = build?.resonatorId ?? resonator.id;
    const level = build?.level ?? 90;
    const chain = build?.chain ?? 0;
    const inflicted = statusesInflictedBy(resonator, dataset, build?.resonanceMode ?? null);
    const applications = applicationsFromSteps(steps, inflicted, resonatorId, level,
        statusApplyRules(resonatorId, build?.resonanceMode ?? null, dataset, chain));

    // Cap raises this rotation arms on its own enemy — same three kinds and the
    // same order as the team path, just with a roster of one.
    const gates = capRaiseGateWindows(steps, resonatorId, chain);
    const capRaises = [
        ...capRaiseWindowsFromSteps(steps, resonatorId, chain),
        ...capRaiseWindowsFromInflicts(applications, [{ resonatorId, chain }], gates),
    ];
    const timeline = buildEnemyStatusTimeline(applications, capRaises);
    const endTime = steps[steps.length - 1].endTime ?? 0;
    const instances = [];

    for (const application of applications) {
        if (!NEGATIVE_STATUS_DEFS[application.status]?.damageOnStack) continue;
        const stacks = timeline.statusStacksAt(application.status, application.t);
        const damage = computeNegativeStatusDamage({
            status: application.status, stacks, atkLv: level, target, dataset });
        if (damage > 0) {
            instances.push({ status: application.status, t: application.t, stacks, damage,
                kind: 'stack', applicatorId: resonatorId });
        }
    }
    instances.push(...resolveStatusOverTimeDamage(timeline, endTime, (status, stacks, atkLv) =>
        computeNegativeStatusDamage({ status, stacks, atkLv, target, dataset }), dataset,
        statusBurstRules(resonatorId, build?.resonanceMode ?? null)));
    instances.push(...resolveAfflictionTriggers(timeline, steps, build, dataset,
        (status, multiplier, atkLv) => computeAfflictionDamage({ status, multiplier, atkLv, target, dataset }))
        .map(instance => ({ ...instance, kind: 'affliction' })));

    instances.sort((left, right) => left.t - right.t);

    // A gap is per-STATUS, but a status can be partly counted: Aemeath's Fusion
    // Burst has no confirmed per-stack table for the generic detonation, yet her
    // kit-triggered burst carries its own multiplier and IS counted. Reporting
    // "Fusion Burst not counted" beside a large Fusion Burst slice reads as a
    // contradiction, so each gap carries what that status DID contribute.
    const countedByStatus = new Map();
    for (const instance of instances) {
        countedByStatus.set(instance.status, (countedByStatus.get(instance.status) ?? 0) + instance.damage);
    }
    const gaps = statusDamageGaps(timeline, dataset).map(gap => ({
        ...gap, countedDamage: countedByStatus.get(gap.status) ?? 0,
    }));

    // A status that IS calibrated, WAS applied, and still deals nothing because
    // the rotation ends before its first tick. That zero is arithmetically
    // correct and completely opaque on the page (the 2026-07-31 zero-value
    // rule), so it gets a measured reason rather than an empty row: Buling's
    // array lands Electro Flare at 6.23s of a 10.30s rotation and Electro Flare
    // ticks every 5s, so the first tick falls 0.9s outside the window.
    const rotationEnd = steps.reduce(
        (latest, step) => Math.max(latest, step.endTime ?? step.startTime ?? 0), 0);
    const reported = new Set(gaps.map(gap => gap.status));
    for (const status of timeline.statuses) {
        if (reported.has(status) || (countedByStatus.get(status) ?? 0) > 0) continue;
        const tick = NEGATIVE_STATUS_DEFS[status]?.tickIntervalS;
        if (!tick || !stackMvTable(status, dataset)) continue;
        const first = applications.find(application => application.status === status)?.t;
        if (first == null || first + tick <= rotationEnd + 1e-9) continue;
        gaps.push({
            status,
            applications: applications.filter(application => application.status === status).length,
            reason: `applied at ${first.toFixed(1)}s, but it ticks every ${tick}s — the rotation ends at `
                + `${rotationEnd.toFixed(1)}s, before the first tick`,
            countedDamage: 0,
        });
    }

    // The INFLICTION record, damage or not. A status the rotation applies is part
    // of what the rotation does even when it deals nothing itself (Havoc Bane is
    // pure DEF reduction; Tune Rupture is gating-only), so the stack curve is
    // reported for every status applied, sampled at each step boundary.
    const byStatus = new Map();
    for (const application of applications) {
        if (!byStatus.has(application.status)) byStatus.set(application.status, []);
        byStatus.get(application.status).push(application.t);
    }
    // `activeUntil` is where the stacks actually run out, NOT the last
    // application — a status holds its stacks for its own lifetime after the
    // last cast that applied it, and ending the lane at the last application
    // made the debuff look like it vanished mid-rotation.
    const heldThrough = (perStep) => {
        const held = steps.filter(step => (perStep[step.index] ?? 0) > 0);
        return held.length ? (held[held.length - 1].endTime ?? 0) : null;
    };
    const stackTimelines = [...byStatus.entries()].map(([status, times]) => {
        const perStep = Object.fromEntries(
            steps.map(step => [step.index, timeline.statusStacksAt(status, step.startTime)]));
        return {
            status,
            label: statusSpaceForm(status),
            applications: times.length,
            firstAt: times[0],
            lastAt: times[times.length - 1],
            activeUntil: heldThrough(perStep) ?? times[times.length - 1],
            peakStacks: Math.max(...times.map(time => timeline.statusStacksAt(status, time)),
                ...Object.values(perStep)),
            // The cap in force at the peak — a status lane needs it as much as a
            // mark lane does, or "peak x7" reads as a ceiling rather than as 7
            // of 10. For a resetOnMax status the cap is the DETONATION point.
            cap: Math.max(...times.map(time => timeline.capAt(status, time))),
            detonatesAtCap: NEGATIVE_STATUS_DEFS[status]?.resetOnMax === true,
            // Per-step count, keyed by the step's own index (the shape the UI's
            // stack-band renderer already consumes for buff windows).
            stacksByStepIndex: perStep,
            damage: instances.filter(instance => instance.status === status)
                .reduce((sum, instance) => sum + instance.damage, 0),
        };
    });

    // The MARK is a debuff on the same enemy and belongs on the same board:
    // Aemeath's Seraphic Duet consumes FUSION TRAIL, not Fusion Burst, and
    // watching only the Fusion Burst count makes that read as if nothing was
    // spent. Its consumptions are marked so the trade is visible.
    const entry = afflictionTriggerFor(resonatorId, chain, build?.resonanceMode ?? null);
    if (entry?.mark?.name) {
        const mark = markEventsFor(timeline, steps, entry, entry.keys);
        const perStep = Object.fromEntries(
            steps.map(step => [step.index, mark.heldAt(step.startTime)]));
        const counts = Object.values(perStep);
        if (mark.events.length > 0) {
            stackTimelines.push({
                status: entry.mark.fromStatus,
                label: entry.mark.name,
                isMark: true,
                applications: mark.events.length,
                firstAt: mark.events[0].t,
                lastAt: steps[steps.length - 1].endTime ?? 0,
                activeUntil: heldThrough(perStep) ?? (steps[steps.length - 1].endTime ?? 0),
                peakStacks: Math.max(0, ...counts,
                    ...mark.consumedAt.map(time => mark.stacksAt(time))),
                stacksByStepIndex: perStep,
                consumedAt: mark.consumedAt.map(time => ({ t: time, stacks: mark.stacksAt(time) })),
                cap: entry.markCap,
                damage: instances.filter(instance => instance.kind === 'affliction')
                    .reduce((sum, instance) => sum + instance.damage, 0),
            });
        }
    }

    return {
        instances,
        total: instances.reduce((sum, instance) => sum + instance.damage, 0),
        gaps,
        stackTimelines,
    };
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
