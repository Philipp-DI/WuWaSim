/**
 * Team rotation simulator (Phase 9).
 *
 * Sequences each member's saved rotation in order, inserting Intro/Outro
 * handoffs at the boundaries. One "pass" visits all occupied slots in order;
 * the caller controls how many passes to simulate (default 1).
 *
 * Handoff model (matches in-game):
 *   Outgoing member → [Outro: timed buffer, no damage] → Incoming member → [Intro: has damage] → Incoming rotation
 *
 * Pure function — no DOM, no fetch, no global state.
 *
 * Output shape (TeamSimResult):
 *   {
 *     segments: [{
 *       slotIndex,            // 0-2
 *       resonatorId,
 *       resonatorName,
 *       buildId,
 *       kind:  'intro' | 'rotation' | 'outro',
 *       startTime,            // seconds from team rotation start
 *       endTime,
 *       damage,               // 0 for outro (no damage params)
 *       steps,                // step array from simulateRotation (rotation only)
 *       buffed,               // true if a sonata/conditional buff was active
 *       simResult,            // full SimResult (rotation segments only)
 *     }],
 *     memberTotals: [{ slotIndex, damage, time, introDamage, stepCount }],
 *     totals: {
 *       damage,               // combined across all members + intros
 *       time,                 // wall-clock rotation time
 *       dps,                  // damage / time
 *       memberCount,
 *       passCount,
 *     },
 *   }
 */

import { simulateRotation, resolveCastTime, ECHO_STEP_KEY, deriveBuffWindows } from './sim.js';
import { resolveTotalStats } from './stats.js';
import { resolveTeamSlots, TEAM_SLOTS } from './team.js';
import { computeOffFieldContribution } from './off-field.js';
import { computeDamage } from './formula.js';
import { computeStateTimeline } from './rotation-state.js';
import { stateDefsForResonator } from './rotation-rules.js';

// Time allotted for the Outro animation (no damage output — just the handoff
// window). If we later add Outro damage params we can extend this.
const OUTRO_CAST_TIME = 1.0;

// Intro skill key used for every resonator (matches autoSkillMap convention).
const INTRO_KEY = 'intro';

/**
 * Simulate a full team rotation for `passCount` passes.
 *
 * @param {object}   args
 * @param {object}   args.team          — Team object (slots: [buildId|null × 3])
 * @param {Function} args.resolveBuild  — (buildId) → build | null
 * @param {object}   args.dataset
 * @param {object}   args.target        — { level, atkLv, resistances }
 * @param {number}   [args.passCount=1] — how many full passes through the roster
 * @returns {TeamSimResult}
 */
export function simulateTeamRotation({ team, resolveBuild, dataset, target, passCount = 1 }) {
    // ── 1. Resolve occupied slots ─────────────────────────────────────────────
    const allSlots = resolveTeamSlots(team, resolveBuild);
    const occupied = allSlots.filter(s => s.build != null);

    if (occupied.length === 0) {
        return emptyResult();
    }

    // Pre-resolve stats for every member once — avoids re-computing them in
    // every pass and makes off-field contribution lookup O(1) per window.
    const memberStats = occupied.map(s => ({
        slotIndex: s.slotIndex,
        build:     s.build,
        stats:     resolveTotalStats(s.build, dataset),
    }));

    const segments   = [];
    let cursor       = 0;

    // Per-member accumulators (across all passes)
    const memberAcc = occupied.map(s => ({
        slotIndex:    s.slotIndex,
        resonatorId:  s.build.resonatorId,
        buildId:      s.build.id,
        damage:       0,
        introDamage:  0,
        offFieldDmg:  0,
        heal:         0,
        shield:       0,
        time:         0,
        stepCount:    0,
    }));

    // ── 2. Walk passes × members ──────────────────────────────────────────────
    for (let pass = 0; pass < passCount; pass++) {
        for (let mi = 0; mi < occupied.length; mi++) {
            const slot  = occupied[mi];
            const build = slot.build;
            const accum = memberAcc[mi];
            const reso  = dataset.resonators.find(r => r.id === build.resonatorId);
            const name  = reso?.name ?? `Resonator ${build.resonatorId}`;

            // ── Intro (every member on every entry except the very first ─────
            const isFirst = pass === 0 && mi === 0;

            // Outro buffs from the PREVIOUS member that are still active.
            const prevSlot   = occupied[(mi - 1 + occupied.length) % occupied.length];
            const prevBuild  = (!isFirst) ? prevSlot?.build : null;
            const prevReso   = prevBuild
                ? dataset.resonators.find(r => r.id === prevBuild.resonatorId)
                : null;
            const amplifyContext = prevReso?.outroBuffs?.length ? prevReso.outroBuffs : null;
            if (!isFirst) {
                const introResult = simulateIntro(build, dataset, target, amplifyContext);
                const introTime   = introResult?.totals.time ?? OUTRO_CAST_TIME;
                const introDmg    = introResult?.totals.damage ?? 0;

                segments.push({
                    slotIndex:     slot.slotIndex,
                    resonatorId:   build.resonatorId,
                    resonatorName: name,
                    buildId:       build.id,
                    kind:          'intro',
                    startTime:     cursor,
                    endTime:       cursor + introTime,
                    damage:        introDmg,
                    steps:         introResult?.steps ?? [],
                    simResult:     introResult,
                });
                accum.introDamage += introDmg;
                accum.damage      += introDmg;
                accum.time        += introTime;
                cursor            += introTime;
            }

            // ── Member's own rotation ─────────────────────────────────────────
            if (build.rotation?.length) {
                // Conditional chain/inherent effects auto-resolve from the
                // rotation (trigger × window) — one resolution path for both sims.
                const simResult = simulateRotation({ build, dataset, target, amplifyContext });
                const rotTime   = simResult.totals.time;
                const rotDmg    = simResult.totals.damage;

                // Offset every step's timestamps by the current cursor
                const offsetSteps = simResult.steps.map(s => ({
                    ...s,
                    startTime: s.startTime + cursor,
                    endTime:   s.endTime   + cursor,
                }));

                segments.push({
                    slotIndex:     slot.slotIndex,
                    resonatorId:   build.resonatorId,
                    resonatorName: name,
                    buildId:       build.id,
                    kind:          'rotation',
                    startTime:     cursor,
                    endTime:       cursor + rotTime,
                    damage:        rotDmg,
                    steps:         offsetSteps,
                    simResult,
                });
                accum.damage    += rotDmg;
                accum.time      += rotTime;
                accum.stepCount += simResult.totals.stepCount;
                // Accumulate healing and shielding from this member's steps
                for (const step of simResult.steps) {
                    accum.heal   += step.stepHeal   ?? 0;
                    accum.shield += step.stepShield ?? 0;
                }
                cursor += rotTime;

                // ── Off-field contributions during this window ────────────────
                // Every OTHER occupied member may contribute off-field damage
                // while the current member is on-field. We compute using each
                // off-field member's pre-resolved stats and their offFieldActions.
                for (let oi = 0; oi < occupied.length; oi++) {
                    if (oi === mi) continue;   // skip the on-field member
                    const offSlot  = occupied[oi];
                    const offStats = memberStats[oi].stats;
                    const offReso  = dataset.resonators.find(r => r.id === offSlot.build.resonatorId);
                    if (!offReso?.offFieldActions?.length) continue;

                    // Compute states ever active in the off-field member's rotation,
                    // used to gate requiresState actions (P10-2).
                    const offStateDefs = stateDefsForResonator(offSlot.build.resonatorId);
                    let offMemberStates = null;
                    if (offStateDefs.length > 0) {
                        const offSkillMap = dataset.autoSkillMap?.[String(offSlot.build.resonatorId)] ?? {};
                        const tl = computeStateTimeline(offSlot.build.rotation ?? [], offSkillMap, offStateDefs);
                        offMemberStates = new Set();
                        for (const s of tl.activeAt) for (const x of s) offMemberStates.add(x);
                    }

                    const contrib = computeOffFieldContribution({
                        build:         offSlot.build,
                        dataset,
                        stats:         offStats,
                        windowSeconds: rotTime,
                        target,
                        computeDamage,
                        memberStates:  offMemberStates,
                    });

                    if (contrib.totalDamage > 0) {
                        memberAcc[oi].offFieldDmg += contrib.totalDamage;
                        memberAcc[oi].damage      += contrib.totalDamage;

                        segments.push({
                            slotIndex:     offSlot.slotIndex,
                            resonatorId:   offSlot.build.resonatorId,
                            resonatorName: offReso.name,
                            buildId:       offSlot.build.id,
                            kind:          'offField',
                            startTime:     cursor - rotTime,
                            endTime:       cursor,
                            damage:        contrib.totalDamage,
                            steps:         [],
                            offFieldActions: contrib.actions,
                            simResult:     null,
                        });
                    }
                }
            }

            // ── Outro (every member that has a successor) ─────────────────────
            const hasNext = mi < occupied.length - 1 || pass < passCount - 1;
            if (hasNext) {
                segments.push({
                    slotIndex:     slot.slotIndex,
                    resonatorId:   build.resonatorId,
                    resonatorName: name,
                    buildId:       build.id,
                    kind:          'outro',
                    startTime:     cursor,
                    endTime:       cursor + OUTRO_CAST_TIME,
                    damage:        0,          // Outro skills have no damage params
                    steps:         [],
                    simResult:     null,
                });
                accum.time += OUTRO_CAST_TIME;
                cursor     += OUTRO_CAST_TIME;
            }
        }
    }

    // ── 3. Aggregate totals ───────────────────────────────────────────────────
    const totalDamage   = memberAcc.reduce((s, m) => s + m.damage, 0);
    const totalOffField = memberAcc.reduce((s, m) => s + m.offFieldDmg, 0);
    const totalHeal     = memberAcc.reduce((s, m) => s + m.heal, 0);
    const totalShield   = memberAcc.reduce((s, m) => s + m.shield, 0);
    const totalTime     = cursor;

    // ── 4. Per-member step arrays + buff windows (P11 §4) ─────────────────────
    // memberSteps: resonatorId → all steps across that member's segments
    // (intro + rotation), in team-rotation time order. memberBuffWindows:
    // resonatorId → contiguous buff windows derived from those steps.
    const memberSteps = new Map();
    for (const seg of segments) {
        if (seg.steps && seg.steps.length) {
            const existing = memberSteps.get(seg.resonatorId) ?? [];
            memberSteps.set(seg.resonatorId, [...existing, ...seg.steps]);
        }
    }
    const memberBuffWindows = new Map();
    for (const [rid, steps] of memberSteps) {
        memberBuffWindows.set(rid, deriveBuffWindows(steps));
    }

    return {
        segments,
        memberTotals: memberAcc,
        memberSteps,
        memberBuffWindows,
        totals: {
            damage:       totalDamage,
            offFieldDmg:  totalOffField,
            heal:         totalHeal,
            shield:       totalShield,
            time:         totalTime,
            dps:          totalTime > 0 ? totalDamage / totalTime : 0,
            memberCount:  occupied.length,
            passCount,
        },
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Simulate only the Intro Skill for a build.
 * Returns a SimResult with a single step, or null if no intro data.
 */
function simulateIntro(build, dataset, target, amplifyContext = null) {
    const introBuild = { ...build, rotation: [INTRO_KEY] };
    try {
        const result = simulateRotation({ build: introBuild, dataset, target, amplifyContext });
        if (result.totals.missingSteps > 0 || result.totals.stepCount === 0) return null;
        return result;
    } catch { return null; }
}

function emptyResult() {
    return {
        segments:     [],
        memberTotals: [],
        memberSteps:       new Map(),
        memberBuffWindows: new Map(),
        totals: {
            damage: 0, time: 0, dps: 0, memberCount: 0, passCount: 0,
        },
    };
}
