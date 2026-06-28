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
 * Which statuses a member inflicts, from (a) the resonance MODE it runs (a mode
 * named after a status inflicts it) and (b) its KIT text (triggerability scan —
 * e.g. Hiyuki/Phoebe/Chisa apply their status without a mode). Returns a Set of
 * canonical status keys.
 */
export function statusesInflictedBy(resonator, dataset, resonanceMode = null) {
    const out = new Set();
    if (resonanceMode && STATUS_KEYS.includes(resonanceMode)) out.add(resonanceMode);
    for (const key of STATUS_KEYS) {
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
    for (const s of steps) {
        if (!(s.stepDamage > 0)) continue;            // only damaging casts apply
        for (const status of inflicted) {
            out.push({ t: s.startTime, status, applicatorId, applicatorLevel });
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
    for (const a of applications) {
        if (!byStatus.has(a.status)) byStatus.set(a.status, []);
        byStatus.get(a.status).push(a);
    }
    for (const arr of byStatus.values()) arr.sort((x, y) => x.t - y.t);

    function statusStacksAt(status, t) {
        const arr = byStatus.get(status);
        if (!arr || arr.length === 0) return 0;
        const def = NEGATIVE_STATUS_DEFS[status] ?? {};
        const cap = def.maxStacks ?? 10;
        const decayS = def.stackDecayS ?? null;
        let stacks = 0, last = null;
        for (const a of arr) {
            if (a.t > t + 1e-9) break;
            if (last != null && decayS) stacks = Math.max(0, stacks - Math.floor((a.t - last) / decayS));
            stacks = Math.min(cap, stacks + 1);
            last = a.t;
        }
        if (stacks > 0 && last != null && decayS) stacks = Math.max(0, stacks - Math.floor((t - last) / decayS));
        return stacks;
    }

    function presentDuring(status, a, b) {
        if (statusStacksAt(status, b) > 0) return true;
        for (const ap of byStatus.get(status) ?? []) {
            if (ap.t >= a - 1e-9 && ap.t <= b + 1e-9 && statusStacksAt(status, ap.t) > 0) return true;
        }
        return false;
    }

    function presentStatusesAt(t) {
        const out = new Set();
        for (const status of byStatus.keys()) if (statusStacksAt(status, t) > 0) out.add(status);
        return out;
    }

    function lastApplicatorAt(status, t) {
        let app = null;
        for (const a of byStatus.get(status) ?? []) {
            if (a.t > t + 1e-9) break;
            app = a;
        }
        return app;
    }

    return { statusStacksAt, presentDuring, presentStatusesAt, lastApplicatorAt, statuses: [...byStatus.keys()], applications };
}
