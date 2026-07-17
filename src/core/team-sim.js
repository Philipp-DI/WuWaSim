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
 *     memberBuffWindows: Map<resonatorId, [{ name, startStep, endStep,
 *       startTime, endTime }]>,          // flat boolean-presence view (deriveBuffWindows)
 *     memberStackedBuffWindows: Map<resonatorId, [{  // 2026-07-14 — stack-aware,
 *       name, sonataName, trigger, bonusPct, bonusKind, element, dmgType,   // team-TIME
 *       maxStacks, start, end,          // (vs. memberBuffWindows' per-member-local time)
 *       samples: [{ start, end, stacks }],   // one entry per step, covers the WHOLE
 *     }]>,                                    // window incl. zero-stack gaps (ramp/decay)
 *     memberEnergy: Map<resonatorId, {   // P13 — informational, never gates damage
 *       er, liberationCost,              // this member's built ER + gauge cost
 *       trace: [{ t, pass, energyBefore, energyAfter,
 *                 isLiberation, liberationCastable,
 *                 label, own, sourceName }],   // label = what was actually cast;
 *     }>,                                      // own=false → sourceName's 50% share

 *     cooldownViolations: [{             // 2026-07-12 — diagnostic overlay
 *       resonatorId, index, skillKey, label,
 *       t, deficit, blockedUntil,        // team-time seconds
 *     }],                                // per-step detail on step.cd (see cooldowns.js)
 *     openerAdjustments: [{              // 2026-07-12 — derived openers (opener.js);
 *       resonatorId, pass, addedTime,    // only when deriveOpeners is on and a pass
 *       insertions: [{ beforeKey, cycle, count, addedTime }],   // was padded/gated;
 *       gated: [{ key, deficit, reason }],   // filler steps carry step.openerFiller
 *     }],
 *     concerto: {                        // P13 — swap-gauge economy
 *       enforced,                        // whether readiness gated the handoffs
 *       max,                             // gauge size (100)
 *       swaps: [{ time, pass, outgoingId, incomingId, gauge, ready }],
 *     },
 *     totals: {
 *       damage,               // combined across all members + intros
 *       time,                 // wall-clock rotation time
 *       dps,                  // damage / time
 *       memberCount,
 *       passCount,
 *     },
 *   }
 */

import { simulateRotation, ECHO_STEP_KEY, effectiveSkillMap, phraseTypesForStep, deriveGameTimes } from './sim.js';
import { deriveBuffWindows, windowStacksAtStep, shortBuffLabel } from './buff-windows.js';
import { resolveTotalStats } from './stats.js';
import { resolveTeamSlots } from './team.js';
import { computeOffFieldContribution } from './off-field.js';
import { computeDamage } from './formula.js';
import { computeStateTimeline } from './rotation-state.js';
import { stateDefsForResonator } from './rotation-rules.js';
import { statusesInflictedBy, applicationsFromSteps, buildEnemyStatusTimeline, distinctApplicators, computeNegativeStatusDamage, NEGATIVE_STATUS_DEFS } from './enemy-status.js';
import { teamWideContribution, teamWideWindowSpecs, mergeTeamBundles, isTeamWideBuff } from './buffs.js';
import { incomingResonatorContribution, distinctApplicatorTierContribution } from './conditional-buffs.js';
import { collectEnergyEvents, accumulateEnergy, applyEnergyEvent, OFF_FIELD_SHARE } from './team-energy.js';
import { annotateStepCooldowns } from './cooldowns.js';
import { deriveOpenerPadding } from './opener.js';

// Havoc Bane has no DoT — it reduces enemy DEF for the WHOLE team (−2%/stack,
// max 3 → −6%). It feeds the DefMult bucket of computeDamage via target.defShred
// (docs/NEGATIVE-STATUS-REFERENCE.md §5), not the negative-status DoT path.
const HAVOC_BANE_PER_STACK = NEGATIVE_STATUS_DEFS.havoc_bane?.defReductionPerStack ?? 0.02;
const HAVOC_BANE_MAX = NEGATIVE_STATUS_DEFS.havoc_bane?.maxStacks ?? 3;

// Time allotted for the Outro animation (no damage output — just the handoff
// window). If we later add Outro damage params we can extend this.
const OUTRO_CAST_TIME = 1.0;

// Concerto (swap) gauge size — see simulateTeamRotation's enforceConcerto note.
const CONCERTO_MAX = 100;

// Intro/Outro casts always fire automatically on swap (never a player choice
// to sequence), so the team sim ignores any manually-placed step of these
// types in a member's own rotation and relies solely on the auto-injected
// handoff segments below. The build editor (single-resonator damage
// experimentation) is unaffected — it calls simulateRotation directly on the
// unfiltered build and still allows these to be placed freely.
const AUTO_CAST_SKILL_TYPES = new Set(['intro', 'outro']);

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
export function simulateTeamRotation({
    team, resolveBuild, dataset, target, passCount = 1,
    // P13 Concerto (swap gauge, max 100): built by the ACTIVE member's casts
    // (per-hit element_power from the dataset). In-game a swap only fires the
    // Outro→Intro handoff (outro buffs, incoming transfer, real Intro Skill)
    // when the OUTGOING member's gauge is full — the cast consumes it.
    // `enforceConcerto` gates the handoff on the modeled gauge; it defaults
    // OFF because the modeled income has known gaps (echo skills carry no
    // source field; several kits generate 0 on skill casts), so enforcement
    // would fabricate scarcity for rotations that fill the gauge in-game.
    // The gauge + per-swap readiness are always reported (result.concerto).
    enforceConcerto = false,
    initialConcerto = 0,
    // Derived openers (2026-07-12, maintainer direction partially revoking
    // "energy never gates damage"): when ON, a member's pass whose consuming
    // Liberation would arrive with a short gauge gets that member's OWN
    // pre-Liberation cycle spliced in as real filler casts (energy shortfall
    // becomes TIME, honestly), or — when no filler can generate energy — the
    // Liberation is GATED (dropped + reported). Default OFF at the engine
    // level for a stable contract; the app's team page and the offline team
    // ranking opt IN (the breakpoint sims stay OFF so `minViableEr` keeps
    // meaning "the ER at which the authored rotation loops clean").
    deriveOpeners = false,
    // Two-clock timing model (docs/TIMING_MODEL.md): 'toa' honors each
    // ability's freezeTime (cooldowns + the DPS denominator pause during a
    // frozen Liberation/Tune-Break animation, matching the benchmark content
    // community DPS figures are measured against); 'open' ignores freezeTime
    // (single real-time clock). Numerically identical today — no ability has
    // measured freeze data yet — see sim.js's deriveGameTimes.
    timingMode = 'toa',
} = {}) {
    // ── 1. Resolve occupied slots ─────────────────────────────────────────────
    const allSlots = resolveTeamSlots(team, resolveBuild);
    const occupied = allSlots.filter(slot => slot.build != null);

    if (occupied.length === 0) {
        return emptyResult();
    }

    // Per-member precomputation (stats, inflicts, flat team-wide bundles,
    // window specs, energy/echo constants) — see the stage's header comment.
    const {
        memberStats, memberInflicts, memberTeamWide, echoTeamBuffs,
        memberWindowSpecs, memberCost, memberEchoGain, memberEchoCooldown,
    } = resolveMemberContext(occupied, dataset);
    const statusApplications = [];   // per-cast applications, team-time ordered
    const externalTeamBuffs = (memberIndex) =>
        mergeTeamBundles(memberTeamWide.filter((_, j) => j !== memberIndex));

    // Team-buff TIMELINE (2026-07-15, maintainer-directed literal-overlap
    // model — docs/TEAM-BUFF-TIMELINE-PLAN.md): every team-wide WINDOW buff a
    // member's segment produces (sonata window-path "ATK of all party members",
    // echo shield auras) is accrued here in TEAM time as constant-stack runs,
    // and each LATER-simulated segment receives the accumulated runs as
    // externalBuffWindows — so a teammate is credited a buff only for the steps
    // that literally fall inside its live window. Accumulation order equals
    // simulation order equals chronological order, so "already on the timeline"
    // is exactly "started before this segment plays". The wielder's own copy
    // applies natively inside their own sim (windows re-derived per pass), so
    // schedule application skips same-source entries — no double-count.
    // The team-buff timeline context — the one shared mutable accumulator the
    // turn stages append to (accrueSegmentWindowsToTimeline /
    // accrueChainEffectWindowsToTimeline) and read back (timelineWindowsFor).
    const timeline = { runs: [], memberStackedBuffWindows: new Map() };
    const memberStackedBuffWindows = timeline.memberStackedBuffWindows;

    // ── 2. Walk passes × members via the turn stages (below) ─────────────────
    // `sim` is the pipeline's shared state — everything the per-turn stages
    // read or advance. `cursor` (team time) and `prevSwapReady` (Concerto
    // readiness carried across the outro → next-intro boundary) are the two
    // mutable scalars; the rest are accumulating collections.
    const sim = {
        dataset, target, passCount, timingMode, enforceConcerto, deriveOpeners,
        occupied, memberStats, memberInflicts, memberWindowSpecs, statusApplications,
        externalTeamBuffs, timeline,
        memberCost, memberEchoGain, memberEchoCooldown,
        // Derived-opener support (2026-07-12): a live per-member Resonance
        // Energy ledger, advanced segment-by-segment with the SAME rule the
        // reported trace uses (see creditTraceToLedger's header).
        memberGauge: occupied.map(() => 0),
        segments: [],
        cursor: 0,
        concertoGauge: occupied.map(() => initialConcerto),
        concertoSwaps: [],
        prevSwapReady: true,
        // Per-member set of off-field trigger categories actually FIRED so far
        // (see applyOffFieldContributions' header for the maintainer rule).
        firedTriggers: occupied.map(() => new Set()),
        openerAdjustments: [],
        // Per-member accumulators (across all passes)
        memberAcc: occupied.map(slot => ({
            slotIndex:    slot.slotIndex,
            resonatorId:  slot.build.resonatorId,
            buildId:      slot.build.id,
            damage:       0,
            introDamage:  0,
            offFieldDmg:  0,
            statusDmg:    0,
            heal:         0,
            shield:       0,
            time:         0,
            stepCount:    0,
        })),
    };

    for (let pass = 0; pass < sim.passCount; pass++) {
        for (let memberIndex = 0; memberIndex < occupied.length; memberIndex++) {
            const turn = beginTurn(sim, pass, memberIndex);
            runIntroSegment(sim, turn);
            const onFieldWindow = runRotationSegment(sim, turn);
            if (onFieldWindow) applyOffFieldContributions(sim, turn, onFieldWindow);
            recordOutroSwap(sim, turn);
        }
    }
    const { segments, memberAcc, concertoSwaps, openerAdjustments } = sim;

    // ── 3. Aggregate totals ───────────────────────────────────────────────────
    const totalDamage   = memberAcc.reduce((sum, member) => sum + member.damage, 0);
    const totalOffField = memberAcc.reduce((sum, member) => sum + member.offFieldDmg, 0);
    const totalStatusDmg = memberAcc.reduce((sum, member) => sum + member.statusDmg, 0);
    const totalHeal     = memberAcc.reduce((sum, member) => sum + member.heal, 0);
    const totalShield   = memberAcc.reduce((sum, member) => sum + member.shield, 0);
    const totalTime     = sim.cursor;

    // ── 4. Per-member step arrays + buff windows (P11 §4) ─────────────────────
    const { memberSteps, memberBuffWindows } = collectMemberSteps(segments);
    // memberStackedBuffWindows (stack-aware TEAM-TIME windows for the UI) is
    // accrued in-loop per segment (accrueSegmentBuffWindows) — the SAME
    // extraction feeds the team-buff timeline, so display and cross-member
    // damage credit can never disagree. The echo shield aura needs no special
    // handling here anymore: it's a normal window from the wielder's own sim
    // (computeBuffWindows' synthetic echo buff), and receivers get it (plus
    // per-step activeBuffNames) via their externalBuffWindows.

    // ── 4b. Cooldown overlay + per-member freeze (see stage header) ───────────
    const { cooldownViolations, totalFreeze } =
        annotateTeamCooldowns(memberSteps, memberStats, dataset, timingMode);

    // ── 5. Team energy (P13) — informational only, never gates damage ─────────
    const memberEnergy = computeMemberEnergy(segments, memberStats, dataset);

    return {
        segments,
        memberTotals: memberAcc,
        memberSteps,
        memberBuffWindows,
        memberStackedBuffWindows,
        teamWideEchoBuffs: echoTeamBuffs,   // 2026-07-15 — echo shield/aura DMG-boost auras (Bell-Borne etc.)
        memberEnergy,
        cooldownViolations,
        openerAdjustments,
        concerto: { enforced: enforceConcerto, max: CONCERTO_MAX, swaps: concertoSwaps },
        totals: (() => {
            const gameTime = totalTime - totalFreeze;
            const dpsTime = timingMode === 'toa' ? gameTime : totalTime;
            return {
                damage:       totalDamage,
                offFieldDmg:  totalOffField,
                statusDmg:    totalStatusDmg,
                heal:         totalHeal,
                shield:       totalShield,
                time:         totalTime,
                gameTime,
                dps:          dpsTime > 0 ? totalDamage / dpsTime : 0,
                memberCount:  occupied.length,
                passCount,
            };
        })(),
    };
}

// ── Pipeline stages (S4.3) ────────────────────────────────────────────────────
// simulateTeamRotation is a pipeline; these are its named stages. Each takes
// exactly the state it reads and returns exactly what it produces. The
// team-buff `timeline` context ({ runs, memberStackedBuffWindows }) is the
// one shared mutable accumulator, threaded explicitly.

/**
 * Stage: per-member precomputation, done once up front.
 *
 * - memberStats: resolved TotalStats (avoids re-computing per pass; makes
 *   off-field contribution lookup O(1) per window).
 * - memberInflicts (P13 Team Effect Model L1+L2): the statuses each member
 *   inflicts (kit + resonance mode). A member's status-conditional buffs are
 *   un-gated when the enemy carries the status from ANY member.
 * - memberTeamWide (L3, the FLAT timing-independent half): a receiving member
 *   sees the UNION of the OTHER members' bundles. Two disjoint sources remain
 *   flat (window derivation planned — docs/TEAM-BUFF-TIMELINE-PLAN.md):
 *   teamWideContribution (chain/inherent kit effects) and weaponSonataTeamWide
 *   (weapon/sonata CONDITIONAL clauses). Sonata WINDOW-PATH buffs and echo
 *   auras live on the timeline-aware path instead (literal overlap, not flat).
 * - echoTeamBuffs: echo team-wide DMG Boost aura carriers (informational
 *   result field; damage/display flow through the member's own sim windows).
 * - memberWindowSpecs: WINDOWABLE team-wide chain/inherent effects — effects
 *   with a resolvable castMatch trigger + seconds window (e.g. Changli S4);
 *   non-windowable team effects stay in the FLAT memberTeamWide path.
 * - memberCost/memberEchoGain/memberEchoCooldown: Resonance Energy constants
 *   for the derived-opener ledger (the opener casts the slot-0 Echo Skill on
 *   cooldown as a filler generator — opener.js greedyFiller).
 */
function resolveMemberContext(occupied, dataset) {
    const resonatorOf = (slot) =>
        dataset.resonators.find(resonator => resonator.id === slot.build.resonatorId);
    const slot0EchoOf = (slot) => {
        const slot0 = slot.build.echoes?.[0];
        return slot0 ? dataset.echoes?.find(echo => echo.id === slot0.id) : null;
    };

    const memberStats = occupied.map(slot => ({
        slotIndex: slot.slotIndex,
        build:     slot.build,
        stats:     resolveTotalStats(slot.build, dataset),
    }));
    const memberInflicts = occupied.map(slot =>
        statusesInflictedBy(resonatorOf(slot), dataset, slot.build.resonanceMode ?? null));
    const memberTeamWide = occupied.map((slot, memberIndex) =>
        mergeTeamBundles([
            teamWideContribution(slot.build, resonatorOf(slot)),
            memberStats[memberIndex]?.stats?.weaponSonataTeamWide,
        ]));
    const echoTeamBuffs = occupied.map((slot) => {
        if (!slot.build.rotation?.includes(ECHO_STEP_KEY)) return null;
        const def = slot0EchoOf(slot);
        const boost = def?.activeSkill?.teamBuff?.dmgBoost ?? 0;
        if (!(boost > 0)) return null;
        return {
            echoName: def.name, resonatorId: slot.build.resonatorId,
            memberName: resonatorOf(slot)?.name ?? '?',
            dmgBoost: boost, duration: def.activeSkill.teamBuff.duration ?? null,
        };
    }).filter(Boolean);
    const memberWindowSpecs = occupied.map(slot =>
        teamWideWindowSpecs(slot.build, resonatorOf(slot)));
    const memberCost = occupied.map(slot =>
        dataset.baseStats?.[String(slot.build.resonatorId)]?.energyMax ?? null);
    const memberEchoGain = occupied.map(slot => slot0EchoOf(slot)?.activeSkill?.energyGain ?? 0);
    const memberEchoCooldown = occupied.map(slot => slot0EchoOf(slot)?.activeSkill?.cooldown ?? 0);

    return {
        memberStats, memberInflicts, memberTeamWide, echoTeamBuffs,
        memberWindowSpecs, memberCost, memberEchoGain, memberEchoCooldown,
    };
}

/**
 * Stage: accrue one just-simulated segment's stack-aware windows onto the
 * team-buff timeline + the per-member display map. The SAME extraction feeds
 * both, so display and cross-member damage credit can never disagree.
 */
function accrueSegmentWindowsToTimeline(timeline, segment, memberName) {
    const entries = stackedWindowsForSegment(segment);
    if (!entries.length) return;
    const list = timeline.memberStackedBuffWindows.get(segment.resonatorId) ?? [];
    list.push(...entries);
    timeline.memberStackedBuffWindows.set(segment.resonatorId, list);
    for (const entry of entries) {
        if (!entry.teamWide) continue;
        for (const run of constantStackRuns(entry.samples)) {
            timeline.runs.push({
                start: run.start, end: run.end, stacks: run.stacks,
                bonusPct: entry.bonusPct, bonusKind: entry.bonusKind,
                element: entry.element, dmgType: entry.dmgType,
                label: `${entry.name} · ${memberName}`, sonataName: entry.sonataName,
                sourceId: segment.resonatorId, external: true,
            });
        }
    }
}

/**
 * Stage: the accumulated timeline as one member's LOCAL-time external windows.
 * Same-source entries are skipped — the wielder's own copy applies natively
 * inside their own sim — EXCEPT `selfApplicable` ones (intro/outro-triggered
 * chain effects): those triggers fire only in the AUTO-INJECTED segments,
 * which the wielder's rotation sim never sees (withoutAutoCastSteps strips
 * authored intro/outro steps), so the wielder can never natively self-apply
 * them and receiving their own window is the only honest credit (2026-07-15
 * — until this, Changli's S4 buffed every member EXCEPT Changli).
 */
function timelineWindowsFor(timeline, resonatorId, segStart) {
    return timeline.runs
        .filter(window => (window.sourceId !== resonatorId || window.selfApplicable) && window.end > segStart + 1e-6)
        .map(window => ({ ...window, start: window.start - segStart, end: window.end - segStart }));
}

/**
 * Stage: derive REAL windows for a member's windowable team-wide chain/
 * inherent effects from this segment's team-time cast events (2026-07-15,
 * Increment 2 of the timeline plan) — each trigger fire opens
 * [fireEnd, fireEnd + seconds]; overlapping fires merge (the same
 * most-recent-fire semantics the wielder's own effect resolution uses).
 * Works across segment KINDS: intro/outro casts live in auto-injected
 * segments the wielder's own rotation sim never sees, so cast events — not
 * simResult.effectWindows — are the honest source.
 */
function accrueChainEffectWindowsToTimeline(timeline, windowSpecs, segment, memberName) {
    for (const spec of windowSpecs) {
        // Trigger fire END times inside this segment (team time). Outro
        // segments carry no steps — the auto-injected Outro cast itself is
        // the fire.
        const fires = segment.kind === 'outro'
            ? (spec.triggerSkillType === 'outro' ? [segment.endTime] : [])
            : (segment.steps ?? []).filter(step =>
                spec.triggerSkillKeys
                    ? spec.triggerSkillKeys.includes(step.skillKey)
                    : phraseTypesForStep(step.skillType).includes(spec.triggerSkillType),
              ).map(step => step.endTime);
        if (!fires.length) continue;
        // Merge per-fire windows [f, f+seconds] into union intervals
        // (re-trigger refreshes the duration, never stacks).
        const intervals = [];
        for (const fireTime of fires.sort((timeA, timeB) => timeA - timeB)) {
            const last = intervals[intervals.length - 1];
            if (last && fireTime <= last.end + 1e-6) last.end = fireTime + spec.seconds;
            else intervals.push({ start: fireTime, end: fireTime + spec.seconds });
        }
        const dispName = shortBuffLabel(spec);
        // Intro/outro-triggered → the wielder can never natively self-apply
        // (the trigger fires outside their rotation sim) → the timeline is
        // their own only credit path too (see timelineWindowsFor).
        const selfApplicable = spec.triggerSkillType === 'intro' || spec.triggerSkillType === 'outro';
        for (const interval of intervals) {
            timeline.runs.push({
                start: interval.start, end: interval.end, stacks: 1,
                bonusPct: spec.bonusPct, bonusKind: spec.bonusKind,
                element: spec.element, dmgType: spec.dmgType,
                label: `${dispName} · ${memberName}`, sonataName: spec.label,
                sourceId: segment.resonatorId, external: true, selfApplicable,
            });
        }
        const list = timeline.memberStackedBuffWindows.get(segment.resonatorId) ?? [];
        list.push({
            name: dispName, sonataName: `KIT · ${spec.label}`, trigger: spec.triggerSkillType ?? 'cast',
            bonusPct: spec.bonusPct, bonusKind: spec.bonusKind, element: spec.element, dmgType: spec.dmgType,
            maxStacks: 1, start: intervals[0].start, end: intervals[intervals.length - 1].end,
            samples: intervals.map(interval => ({ start: interval.start, end: interval.end, stacks: 1 })),
            teamWide: true, raw: spec.raw,
        });
        timeline.memberStackedBuffWindows.set(segment.resonatorId, list);
    }
}

/**
 * Stage: per-member team-time step arrays + presence buff windows.
 * memberSteps: resonatorId → all steps across that member's segments
 * (intro + rotation), in team-rotation time order. memberBuffWindows:
 * resonatorId → contiguous buff windows derived from those steps.
 */
function collectMemberSteps(segments) {
    const memberSteps = new Map();
    for (const segment of segments) {
        if (segment.steps && segment.steps.length) {
            const existing = memberSteps.get(segment.resonatorId) ?? [];
            memberSteps.set(segment.resonatorId, [...existing, ...segment.steps]);
        }
    }
    const memberBuffWindows = new Map();
    for (const [rid, steps] of memberSteps) {
        memberBuffWindows.set(rid, deriveBuffWindows(steps));
    }
    return { memberSteps, memberBuffWindows };
}

/**
 * Stage: cooldown overlay (2026-07-12) — re-annotate each member's steps in
 * TEAM time so group timers persist across passes and swap gaps (the
 * per-segment annotation inside simulateRotation can't see either; this
 * overwrites it on the team-time step copies). Diagnostic only — never
 * changes damage/time.
 *
 * Per-member gameTime (docs/TIMING_MODEL.md): derived over each member's
 * OWN steps only, so a member's own frozen-animation casts reduce their
 * own subsequent cooldown ticking. Known scope limit (honest, not silently
 * dropped): a teammate's frozen Liberation does NOT propagate to reduce
 * this member's cooldowns here (true ToA behavior freezes globally) —
 * modeling that needs a team-wide freeze schedule, deferred until real
 * freeze data makes the distinction observable (today freezeTime is 0
 * everywhere, so this is a no-op either way).
 *
 * Returns totalFreeze — freeze consumed across every member's own casts, the
 * honest (member-scoped, see note above) lower bound used for the team-level
 * gameTime/DPS-denominator figure.
 */
function annotateTeamCooldowns(memberSteps, memberStats, dataset, timingMode) {
    const cooldownViolations = [];
    let totalFreeze = 0;
    for (const [rid, steps] of memberSteps) {
        const memberStat = memberStats.find(member => member.build.resonatorId === rid);
        const slot0 = memberStat?.build.echoes?.[0];
        const echoDef = slot0 ? dataset.echoes?.find(echo => echo.id === slot0.id) : null;
        totalFreeze += deriveGameTimes(steps, timingMode);
        const violations = annotateStepCooldowns(steps, {
            skillMap: effectiveSkillMap(dataset, rid) ?? {},
            echoCooldown: echoDef?.activeSkill?.cooldown ?? null,
            timeKey: 'gameStartTime',
        });
        for (const violation of violations) cooldownViolations.push({ resonatorId: rid, ...violation });
    }
    return { cooldownViolations, totalFreeze };
}

/**
 * Stage: per-member Resonance Energy over the team timeline — own casts +
 * the off-field 50% share of the active member's generation, each scaled by
 * the member's OWN ER (team-energy.js).
 */
function computeMemberEnergy(segments, memberStats, dataset) {
    const energyEvents = collectEnergyEvents(segments);
    const memberEnergy = new Map();
    for (const memberStat of memberStats) {
        const rid = memberStat.build.resonatorId;
        const liberationCost = dataset.baseStats?.[String(rid)]?.energyMax ?? null;
        const energyRegen = memberStat.stats.energyRegen;
        memberEnergy.set(rid, {
            er: energyRegen, liberationCost,
            trace: accumulateEnergy(energyEvents.get(rid) ?? [], { er: energyRegen, liberationCost }),
        });
    }
    return memberEnergy;
}

/** Total Concerto (swap-gauge) generation across one sim result's casts. */
function concertoGainOf(simResult) {
    return (simResult?.energyTrace ?? []).reduce((sum, event) => sum + (event.rawConcertoGen ?? 0), 0);
}

/**
 * Stage: advance every member's live Resonance Energy ledger with one
 * just-simulated result (2026-07-12, derived-opener support) — the SAME rule
 * the reported trace uses (team-energy.js applyEnergyEvent — own casts full,
 * others' at the off-field share, × own ER, reset on own consuming
 * Liberation, capped at own cost). It exists so the padding predictor sees
 * the exact gauge each member carries INTO their pass; collectEnergyEvents/
 * accumulateEnergy over the final segments reproduce the same numbers.
 */
function creditTraceToLedger(sim, simResult, activeMemberIndex) {
    for (const event of simResult?.energyTrace ?? []) {
        for (let j = 0; j < sim.occupied.length; j++) {
            const own = j === activeMemberIndex;
            const base = own ? (event.rawGen ?? 0) : OFF_FIELD_SHARE * (event.rawGen ?? 0);
            const isLiberation = own && event.isLiberation === true;
            if (base === 0 && !isLiberation) continue;
            sim.memberGauge[j] = applyEnergyEvent(sim.memberGauge[j], { base, isLiberation },
                { er: sim.memberStats[j].stats.energyRegen, liberationCost: sim.memberCost[j] }).gauge;
        }
    }
}

/**
 * Stage: resolve one turn's cast — who plays, who played before them, and
 * whether the Outro→Intro handoff fires (outgoing member's Concerto full, or
 * enforcement off — see simulateTeamRotation's enforceConcerto note).
 */
function beginTurn(sim, pass, memberIndex) {
    const slot  = sim.occupied[memberIndex];
    const build = slot.build;
    const resonator = sim.dataset.resonators.find(resonator => resonator.id === build.resonatorId);
    const isFirst = pass === 0 && memberIndex === 0;
    const prevSlot  = sim.occupied[(memberIndex - 1 + sim.occupied.length) % sim.occupied.length];
    const prevBuild = (!isFirst) ? prevSlot?.build : null;
    const prevReso  = prevBuild
        ? sim.dataset.resonators.find(resonator => resonator.id === prevBuild.resonatorId)
        : null;
    const handoffFired = !isFirst && (!sim.enforceConcerto || sim.prevSwapReady);
    return {
        pass, memberIndex, slot, build, resonator,
        name: resonator?.name ?? `Resonator ${build.resonatorId}`,
        accum: sim.memberAcc[memberIndex],
        isFirst, prevBuild, prevReso, handoffFired,
        // Outro buffs from the PREVIOUS member that are still active.
        amplifyContext: (handoffFired && prevReso?.outroBuffs?.length) ? prevReso.outroBuffs : null,
    };
}

/**
 * Stage: the auto-injected Intro segment (every member on every entry except
 * the very first). Advances the cursor by the Intro's own cast time.
 */
function runIntroSegment(sim, turn) {
    if (!turn.handoffFired) return;
    const { build, memberIndex, accum } = turn;
    const introResult = simulateIntro(build, sim.dataset, sim.target, turn.amplifyContext,
        timelineWindowsFor(sim.timeline, build.resonatorId, sim.cursor), sim.timingMode);
    const introTime = introResult?.totals.time ?? OUTRO_CAST_TIME;
    const introDmg  = introResult?.totals.damage ?? 0;
    sim.concertoGauge[memberIndex] = Math.min(CONCERTO_MAX, sim.concertoGauge[memberIndex] + concertoGainOf(introResult));

    // Offset every step's timestamps by the current cursor — introResult
    // is simulated in isolation (its own steps start at 0), matching the
    // rotation segment's offsetSteps. Without this, anything that reads
    // step.startTime (memberSteps/buff windows, collectEnergyEvents'
    // energy trace) sees the intro's casts at their LOCAL time instead of
    // their real position in the team rotation — e.g. an intro fired at
    // cursor=15s would report its cast at t≈0, making time-ordered charts
    // jump backwards.
    const offsetIntroSteps = (introResult?.steps ?? []).map(step => ({
        ...step,
        startTime: step.startTime + sim.cursor,
        endTime:   step.endTime   + sim.cursor,
    }));

    const segment = {
        slotIndex:     turn.slot.slotIndex,
        resonatorId:   build.resonatorId,
        resonatorName: turn.name,
        buildId:       build.id,
        kind:          'intro',
        pass:          turn.pass,
        startTime:     sim.cursor,
        endTime:       sim.cursor + introTime,
        damage:        introDmg,
        steps:         offsetIntroSteps,
        simResult:     introResult,
    };
    sim.segments.push(segment);
    accrueSegmentWindowsToTimeline(sim.timeline, segment, turn.name);
    accrueChainEffectWindowsToTimeline(sim.timeline, sim.memberWindowSpecs[memberIndex], segment, turn.name);
    accum.introDamage += introDmg;
    accum.damage      += introDmg;
    accum.time        += introTime;
    sim.cursor        += introTime;
    creditTraceToLedger(sim, introResult, memberIndex);
}

/**
 * Stage: the member's own rotation segment. Strips any manually-placed
 * Intro/Outro step (those casts are accounted for exclusively by the
 * auto-injected segments, so keeping them would double-count), applies
 * team-aware status gating + team-wide buff bundles + Havoc Bane DEF shred,
 * pads/gates via the derived opener when enabled, and advances the cursor.
 *
 * Returns { rotTime, memberTarget } — the on-field window the off-field
 * stage needs — or null when the member has no rotation.
 */
function runRotationSegment(sim, turn) {
    const { build, memberIndex, accum } = turn;
    const teamBuild = withoutAutoCastSteps(build, sim.dataset);
    if (!teamBuild.rotation?.length) return null;

    // Team-aware status gating (L2): statuses present at this point in the
    // team rotation (from earlier members, persisting) PLUS the ones THIS
    // member inflicts during its own window.
    const enemyTl = buildEnemyStatusTimeline(sim.statusApplications);
    const present = enemyTl.presentStatusesAt(sim.cursor);
    const enemyStatuses = new Set([...present, ...sim.memberInflicts[memberIndex]]);
    // Team-wide auras (L3) + the PREVIOUS member's incoming-resonator
    // transfer (e.g. a Wishes wielder's Snowfall Outro → +25% Glacio DMG to
    // whoever swaps in — gated on the prev member's own inflict).
    const prevIncoming = (turn.handoffFired && turn.prevReso)
        ? incomingResonatorContribution(turn.prevBuild, sim.dataset, turn.prevReso) : null;
    // Distinct-applicator tier (Snow Rust-style): how many distinct teammates
    // have, by this point, inflicted a qualifying status — counting earlier
    // members from the shared timeline PLUS this member itself if its own kit
    // inflicts one (same "assume this member's own inflicts apply for its
    // whole window" approximation as the enemyStatuses union above).
    const countDistinct = (statuses) => {
        const set = distinctApplicators(sim.statusApplications, statuses, sim.cursor);
        if (statuses.some(status => sim.memberInflicts[memberIndex].has(status))) set.add(build.resonatorId);
        return set;
    };
    const ownTier = distinctApplicatorTierContribution(build.resonatorId, build.resonanceMode ?? null, countDistinct);
    const teamBuffs = mergeTeamBundles([sim.externalTeamBuffs(memberIndex), prevIncoming, ownTier]);

    // Havoc Bane DEF shred (L4): a teammate's Havoc Bane lowers enemy DEF for
    // everyone — fold the active stacks into target.defShred.
    const havocStacks = Math.min(HAVOC_BANE_MAX, enemyTl.statusStacksAt('havoc_bane', sim.cursor));
    const memberTarget = havocStacks > 0 ? { ...sim.target, defShred: havocStacks * HAVOC_BANE_PER_STACK } : sim.target;

    // Derived opener (2026-07-12): pad or gate this pass's consuming
    // Liberations against the member's LIVE gauge — see opener.js.
    const opener = sim.deriveOpeners ? deriveOpenerPadding({
        rotation: teamBuild.rotation,
        skillMap: effectiveSkillMap(sim.dataset, build.resonatorId) ?? {},
        dataset: sim.dataset,
        echoEnergyGain: sim.memberEchoGain[memberIndex],
        echoCooldown: sim.memberEchoCooldown[memberIndex],
        forteCap: sim.dataset.forte?.[String(build.resonatorId)]?.cap ?? 0,
        er: sim.memberStats[memberIndex].stats.energyRegen,
        liberationCost: sim.memberCost[memberIndex],
        gaugeStart: sim.memberGauge[memberIndex],
        timingMode: sim.timingMode,
    }) : null;
    const simBuild = opener ? { ...teamBuild, rotation: opener.rotation } : teamBuild;

    // Conditional chain/inherent effects auto-resolve from the rotation
    // (trigger × window) — one resolution path for both sims.
    // externalBuffWindows: team-wide buff windows already live on the
    // team-buff timeline (earlier members/passes), shifted to this segment's
    // local time — literal team-time overlap.
    const simResult = simulateRotation({
        build: simBuild, dataset: sim.dataset, target: memberTarget,
        amplifyContext: turn.amplifyContext, enemyStatuses, teamBuffs,
        externalBuffWindows: timelineWindowsFor(sim.timeline, build.resonatorId, sim.cursor),
        timingMode: sim.timingMode,
    });
    const rotTime = simResult.totals.time;
    const rotDmg  = simResult.totals.damage;
    sim.concertoGauge[memberIndex] = Math.min(CONCERTO_MAX, sim.concertoGauge[memberIndex] + concertoGainOf(simResult));

    // Offset every step's timestamps by the current cursor
    const offsetSteps = simResult.steps.map(step => ({
        ...step,
        startTime: step.startTime + sim.cursor,
        endTime:   step.endTime   + sim.cursor,
    }));
    if (opener) {
        for (const index of opener.fillerIndices) {
            if (offsetSteps[index]) offsetSteps[index].openerFiller = true;
        }
        sim.openerAdjustments.push({
            resonatorId: build.resonatorId, pass: turn.pass,
            insertions: opener.insertions, gated: opener.gated,
            addedTime: opener.insertions.reduce((sum, x) => sum + x.addedTime, 0),
        });
    }

    accrueStatusDamage(sim, offsetSteps, memberIndex, memberTarget);

    const segment = {
        slotIndex:     turn.slot.slotIndex,
        resonatorId:   build.resonatorId,
        resonatorName: turn.name,
        buildId:       build.id,
        kind:          'rotation',
        pass:          turn.pass,
        startTime:     sim.cursor,
        endTime:       sim.cursor + rotTime,
        damage:        rotDmg,
        steps:         offsetSteps,
        simResult,
        ...(opener ? { opener: { insertions: opener.insertions, gated: opener.gated } } : {}),
    };
    sim.segments.push(segment);
    accrueSegmentWindowsToTimeline(sim.timeline, segment, turn.name);
    accrueChainEffectWindowsToTimeline(sim.timeline, sim.memberWindowSpecs[memberIndex], segment, turn.name);
    if (prevIncoming) attachIncomingTransferDisplay(sim, turn, prevIncoming, offsetSteps, rotTime);

    accum.damage    += rotDmg;
    accum.time      += rotTime;
    accum.stepCount += simResult.totals.stepCount;
    // Accumulate healing and shielding from this member's steps
    for (const step of simResult.steps) {
        accum.heal   += step.stepHeal   ?? 0;
        accum.shield += step.stepShield ?? 0;
    }
    sim.cursor += rotTime;
    creditTraceToLedger(sim, simResult, memberIndex);
    // Record which off-field trigger categories this member has now actually
    // cast (not just "had a turn") — see applyOffFieldContributions.
    for (const step of simResult.steps) {
        const trigger = triggerOfSkillType(step.skillType);
        if (trigger) sim.firedTriggers[memberIndex].add(trigger);
    }
    return { rotTime, memberTarget };
}

/**
 * Sub-stage: accrue this member's per-cast status applications onto the
 * shared enemy timeline (L1) so subsequent members see them persist. For
 * statuses with their own DMG-on-stack mechanic (Glacio Chafe — L4), each
 * application is its own damage instance scaled to the stack count it
 * produces, credited to whichever resonator applied that stack
 * (docs/NEGATIVE-STATUS-REFERENCE.md §4's "applicator" rule).
 */
function accrueStatusDamage(sim, offsetSteps, memberIndex, memberTarget) {
    const build = sim.occupied[memberIndex].build;
    for (const application of applicationsFromSteps(offsetSteps, sim.memberInflicts[memberIndex], build.resonatorId)) {
        sim.statusApplications.push(application);
        if (!NEGATIVE_STATUS_DEFS[application.status]?.damageOnStack) continue;
        const stackCount = buildEnemyStatusTimeline(sim.statusApplications).statusStacksAt(application.status, application.t);
        const nsDmg = computeNegativeStatusDamage({ status: application.status, stacks: stackCount, atkLv: application.applicatorLevel, target: memberTarget });
        if (nsDmg > 0) {
            const applicatorIdx = sim.occupied.findIndex(slot => slot.build.resonatorId === application.applicatorId);
            if (applicatorIdx >= 0) {
                sim.memberAcc[applicatorIdx].statusDmg += nsDmg;
                sim.memberAcc[applicatorIdx].damage    += nsDmg;
            }
        }
    }
}

/**
 * Sub-stage: incoming-resonator transfer DISPLAY (2026-07-15, closing the
 * "transfers are unrendered" gap): the Outro→Intro handoff bundle (e.g.
 * Wishes' "+25% Glacio DMG to the incoming Resonator") is applied FLAT to
 * this whole rotation by the teamBuffs merge — so its honest strips span
 * exactly this segment, in the RECEIVING member's own lane (it buffs this
 * member specifically, not the team). Display-only: never accrued to the
 * team-buff timeline (it's already applied), never team-wide. Steps list it
 * for tooltip transparency.
 */
function attachIncomingTransferDisplay(sim, turn, prevIncoming, offsetSteps, rotTime) {
    const entries = incomingDisplayEntries(prevIncoming, sim.cursor, sim.cursor + rotTime, turn.prevReso?.name ?? '?');
    if (!entries.length) return;
    const list = sim.timeline.memberStackedBuffWindows.get(turn.build.resonatorId) ?? [];
    list.push(...entries);
    sim.timeline.memberStackedBuffWindows.set(turn.build.resonatorId, list);
    for (const step of offsetSteps) {
        for (const entry of entries) (step.activeBuffNames ??= []).push(`${entry.name} · from ${entry.sourceName}`);
    }
}

/**
 * Stage: every OTHER occupied member's off-field damage while the current
 * member was on-field (turrets, coordinated attacks, companion summons, …),
 * computed from each off-field member's pre-resolved stats + offFieldActions.
 *
 * An action requires its SPECIFIC trigger to have actually fired at least
 * once — OffFieldAction.trigger ('liberation'|'outro'|'skill'|'forte') names
 * the cast that sets the mechanic up (maintainer-confirmed 2026-07-11:
 * "needs actual condition verification if the off-field damage has been
 * activated e.g. by a Liberation cast", not merely "has ever been on-field"
 * — a member who has only Basic-Attacked so far hasn't set up their
 * Liberation-gated mechanic yet). sim.firedTriggers tracks the categories
 * each member has fired, populated as their own segments simulate.
 */
function applyOffFieldContributions(sim, turn, { rotTime, memberTarget }) {
    for (let offMemberIndex = 0; offMemberIndex < sim.occupied.length; offMemberIndex++) {
        if (offMemberIndex === turn.memberIndex) continue;   // skip the on-field member
        const offSlot  = sim.occupied[offMemberIndex];
        const offStats = sim.memberStats[offMemberIndex].stats;
        const offReso  = sim.dataset.resonators.find(resonator => resonator.id === offSlot.build.resonatorId);
        if (!offReso?.offFieldActions?.length) continue;

        // Compute states ever active in the off-field member's rotation,
        // used to gate requiresState actions (P10-2).
        const offStateDefs = stateDefsForResonator(offSlot.build.resonatorId);
        let offMemberStates = null;
        if (offStateDefs.length > 0) {
            const offSkillMap = sim.dataset.autoSkillMap?.[String(offSlot.build.resonatorId)] ?? {};
            const timeline = computeStateTimeline(offSlot.build.rotation ?? [], offSkillMap, offStateDefs);
            offMemberStates = new Set();
            for (const stateSet of timeline.activeAt) for (const stateName of stateSet) offMemberStates.add(stateName);
        }

        const contrib = computeOffFieldContribution({
            build:         offSlot.build,
            dataset:       sim.dataset,
            stats:         offStats,
            windowSeconds: rotTime,
            target:        memberTarget,   // shares the window's Havoc Bane DEF shred
            computeDamage,
            memberStates:  offMemberStates,
            firedTriggers: sim.firedTriggers[offMemberIndex],
        });

        if (contrib.totalDamage > 0) {
            sim.memberAcc[offMemberIndex].offFieldDmg += contrib.totalDamage;
            sim.memberAcc[offMemberIndex].damage      += contrib.totalDamage;

            sim.segments.push({
                slotIndex:     offSlot.slotIndex,
                resonatorId:   offSlot.build.resonatorId,
                resonatorName: offReso.name,
                buildId:       offSlot.build.id,
                kind:          'offField',
                pass:          turn.pass,
                startTime:     sim.cursor - rotTime,
                endTime:       sim.cursor,
                damage:        contrib.totalDamage,
                steps:         [],
                offFieldActions: contrib.actions,
                simResult:     null,
            });
        }
    }
}

/**
 * Stage: the Outro swap boundary (every member that has a successor). Fires
 * only on a FULL Concerto gauge (consumed by the cast); the readiness is
 * recorded per swap either way, and gates the segment only under
 * enforceConcerto.
 *
 * The Outro plays IN PARALLEL with the incoming member's Intro Skill (both
 * animations run concurrently on swap), not before it — so it must not push
 * the shared cursor forward; only the following Intro's own cast time
 * advances the timeline (maintainer-directed 2026-07-12). The segment keeps
 * its own OUTRO_CAST_TIME-wide display window (a real block on the timeline
 * chart), it just overlaps the next Intro segment instead of preceding it.
 * `accum.time` (this member's own active-time tally) is left untouched for
 * the same reason — the window isn't exclusively theirs.
 */
function recordOutroSwap(sim, turn) {
    const { memberIndex, build } = turn;
    const hasNext = memberIndex < sim.occupied.length - 1 || turn.pass < sim.passCount - 1;
    if (!hasNext) return;
    const nextSlot = sim.occupied[(memberIndex + 1) % sim.occupied.length];
    const ready = sim.concertoGauge[memberIndex] >= CONCERTO_MAX;
    sim.concertoSwaps.push({
        time: sim.cursor, pass: turn.pass,
        outgoingId: build.resonatorId,
        incomingId: nextSlot.build.resonatorId,
        gauge: Math.round(sim.concertoGauge[memberIndex] * 10) / 10,
        ready,
    });
    if (ready) sim.concertoGauge[memberIndex] = 0;   // the handoff consumes it
    sim.prevSwapReady = ready;

    if (!sim.enforceConcerto || ready) {
        const segment = {
            slotIndex:     turn.slot.slotIndex,
            resonatorId:   build.resonatorId,
            resonatorName: turn.name,
            buildId:       build.id,
            kind:          'outro',
            pass:          turn.pass,
            startTime:     sim.cursor,
            endTime:       sim.cursor + OUTRO_CAST_TIME,
            damage:        0,          // Outro skills have no damage params
            steps:         [],
            simResult:     null,
        };
        sim.segments.push(segment);
        accrueChainEffectWindowsToTimeline(sim.timeline, sim.memberWindowSpecs[memberIndex], segment, turn.name);
        sim.firedTriggers[memberIndex].add('outro');
    }
}


// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Team-TIME, stack-aware buff windows per member (2026-07-14) — the data the
 * UI needs to plot a stacking sonata buff's real ramp/decay on the team
 * timeline, instead of memberBuffWindows' flat boolean-presence blocks.
 *
 * Each team-sim segment already carries BOTH a team-time-shifted `steps`
 * array AND the original `simResult` (with sim.js's rich, LOCAL-time
 * `buffWindows[*].stacksByStepIndex`) — `segment.steps[i]` and
 * `segment.simResult.steps[i]` are the same step, index-aligned, shifted by the
 * constant `segment.startTime` (team-sim.js always builds `segment.steps` as
 * `simResult.steps.map(s => ({...s, startTime: s.startTime + cursor, ...}))`
 * — see the intro/rotation segment construction above). So a rich window's
 * LOCAL [start,end] converts to TEAM time by adding that same shift, and its
 * per-step stack count (windowStacksAtStep, sim.js — the SAME function that
 * already drives damage scaling, so display can never disagree with damage)
 * converts to a team-time sample by pairing it with `segment.steps[i]`.
 *
 * Each segment contributes its own independent window entries (stacks
 * genuinely reset between passes — a fresh simulateRotation call per pass —
 * so entries are never merged across segments, unlike memberBuffWindows'
 * name-based concatenation).
 *
 * Called PER SEGMENT, in-loop, right after the segment simulates
 * (accrueSegmentBuffWindows) — the same entries feed both the display map
 * and the team-buff timeline, so what the UI shows and what teammates are
 * credited can never disagree. RECEIVED (external) windows are skipped:
 * the granting member's own segment already emits them.
 *
 * @param {object} segment — one TeamSimResult segment (must carry simResult)
 * @returns {Array<{name, sonataName, trigger, bonusPct, bonusKind, element,
 *   dmgType, maxStacks, start, end, teamWide, raw,
 *   samples:Array<{start,end,stacks}>}>}
 */
function stackedWindowsForSegment(segment) {
    const rich = segment.simResult?.buffWindows;
    const localSteps = segment.simResult?.steps;
    if (!rich?.length || !localSteps?.length) return [];
    const shift = segment.startTime;
    const lastLocalEnd = localSteps[localSteps.length - 1].endTime;
    const list = [];
    for (const window of rich) {
        if (window.external) continue;   // received from a teammate — not ours to emit
        if (!(window.bonusPct > 0)) continue;
        // TEAM-WIDE tag (2026-07-15): a buff whose recipient is the whole
        // team ("ATK of all party members") reaches every member — the UI
        // renders it in a shared team-wide lane, and the team-buff timeline
        // schedules it into later segments. Structurally-tagged windows (the
        // echo team buff) carry the flag; parsed sonata buffs are classified
        // from the same raw text the timeline distribution uses.
        const teamWide = window.teamWide ?? isTeamWideBuff(window.raw ?? '');
        const samples = localSteps.map(step => ({
            start: step.startTime + shift, end: step.endTime + shift,
            stacks: windowStacksAtStep(window, step),
        }));
        // A TEAM-WIDE buff whose life outlasts the wielder's own segment
        // (e.g. a 30s team-ATK buff triggered late in the rotation) keeps
        // benefiting whoever is on-field AFTER the wielder switches out — so
        // its strip must CONTINUE past the segment boundary to the buff's
        // real end, not cut off at the resonator switch (2026-07-15). Tail
        // stack level: `w.end` for a trigger-derived window is last-gain +
        // duration, and gains are step-END times ≤ the segment end — so a
        // window with w.end past the segment is PROVABLY ≥1 stack live through
        // the whole tail (the final gain's own life), even when no step START
        // ever sampled it (a buff gained on the wielder's very last cast —
        // e.g. a 1-step __echo__ rotation). max(lastStacks, 1) also keeps a
        // higher multi-stack level when the last sample saw one. Self buffs
        // stay capped: once their wielder is off-field they do nothing.
        const lastStacks = samples.length ? samples[samples.length - 1].stacks : 0;
        let end = Math.min(window.end, lastLocalEnd);
        if (teamWide && window.end > lastLocalEnd + 1e-6) {
            samples.push({ start: lastLocalEnd + shift, end: window.end + shift, stacks: Math.max(lastStacks, 1) });
            end = window.end;
        }
        list.push({
            name: window.label, sonataName: window.sonataName, trigger: window.trigger,
            bonusPct: window.bonusPct, bonusKind: window.bonusKind, element: window.element, dmgType: window.dmgType,
            maxStacks: Math.max(0, ...samples.map(sample => sample.stacks)),
            start: window.start + shift, end: end + shift,
            samples,
            teamWide,
            raw: window.raw ?? '',
        });
    }
    return list;
}

// Incoming-resonator transfer bundle → display window entries for the
// RECEIVING member's lane (2026-07-15). The transfer is applied FLAT to the
// receiving member's whole rotation segment (the teamBuffs merge), so each
// non-zero bucket renders as one strip spanning exactly [segStart, segEnd] —
// the display shows what the damage model actually credits. `sourceName`
// names the granting (outgoing) member in the tooltip; the "flat" note
// discloses the duration approximation (transfer clause durations are
// unparsed — the honest v1).
function incomingDisplayEntries(bundle, segStart, segEnd, sourceName) {
    const pct = (value) => { const percent = value * 100; return percent % 1 === 0 ? String(percent) : percent.toFixed(1); };
    const ELEMENT_NAMES = ['', 'Glacio', 'Fusion', 'Electro', 'Aero', 'Spectro', 'Havoc'];
    const DMG_TYPE_NAMES = { basic: 'Basic Attack', heavy: 'Heavy Attack', skill: 'Resonance Skill', liberation: 'Resonance Liberation', echo: 'Echo', intro: 'Intro Skill', outro: 'Outro Skill' };
    const parts = [];
    if (bundle.atkRatio > 0) parts.push({ name: `+${pct(bundle.atkRatio)}% ATK`, bonusPct: bundle.atkRatio, bonusKind: 'atk', element: null, dmgType: null });
    if (bundle.critRate > 0) parts.push({ name: `+${pct(bundle.critRate)}% Crit Rate`, bonusPct: bundle.critRate, bonusKind: 'crit', element: null, dmgType: null });
    if (bundle.critDmg > 0) parts.push({ name: `+${pct(bundle.critDmg)}% Crit DMG`, bonusPct: bundle.critDmg, bonusKind: 'crit', element: null, dmgType: null });
    for (const [el, value] of Object.entries(bundle.dmgByElement ?? {})) if (value > 0)
        parts.push({ name: `+${pct(value)}% ${ELEMENT_NAMES[el] ?? '?'} DMG`, bonusPct: value, bonusKind: 'element', element: Number(el), dmgType: null });
    for (const [type, value] of Object.entries(bundle.dmgBySkillType ?? {})) if (value > 0)
        parts.push({ name: `+${pct(value)}% ${DMG_TYPE_NAMES[type] ?? type} DMG`, bonusPct: value, bonusKind: 'unknown', element: null, dmgType: type });
    const amp = (bundle.amplifyAll ?? 0)
        + Object.values(bundle.amplifyByElement ?? {}).reduce((sum, value) => sum + value, 0)
        + Object.values(bundle.amplifyByType ?? {}).reduce((sum, value) => sum + value, 0);
    if (amp > 0) parts.push({ name: `+${pct(amp)}% DMG Amplify`, bonusPct: amp, bonusKind: 'amplify', element: null, dmgType: null });
    return parts.map(part => ({
        ...part, sourceName,
        sonataName: `${sourceName} · Outro transfer (flat)`, trigger: 'outro',
        maxStacks: 1, start: segStart, end: segEnd,
        samples: [{ start: segStart, end: segEnd, stacks: 1 }],
        teamWide: false, raw: '',
    }));
}

// Merge adjacent same-level ACTIVE samples (stacks > 0) into constant-stack
// runs — the shape the team-buff timeline schedules into later segments
// (windowStacksAtStep reads flat {start,end,stacks} windows directly).
function constantStackRuns(samples) {
    const runs = [];
    let current = null;
    for (const sample of (samples ?? [])) {
        if ((sample.stacks ?? 0) > 0) {
            if (current && current.stacks === sample.stacks && Math.abs(current.end - sample.start) < 1e-6) current.end = sample.end;
            else { current = { start: sample.start, end: sample.end, stacks: sample.stacks }; runs.push(current); }
        } else current = null;
    }
    return runs;
}

/**
 * Simulate only the Intro Skill for a build.
 * Returns a SimResult with a single step, or null if no intro data.
 */
// Maps a step's mechanical skillType to the OffFieldAction.trigger category
// it satisfies ('liberation'|'outro'|'skill'|'forte' — see off-field.js).
// 'outro' is handled separately (team-sim auto-injects Outro casts as their
// own segment kind, never a step inside a member's own rotation). Everything
// else (basic/heavy/midair/intro) sets up no off-field mechanic.
function triggerOfSkillType(skillType) {
    if (skillType === 'liberation') return 'liberation';
    if (skillType === 'skill') return 'skill';
    if (skillType?.startsWith('forte')) return 'forte';
    return null;
}

function simulateIntro(build, dataset, target, amplifyContext = null, externalBuffWindows = null, timingMode = 'toa') {
    const introKey = introKeyFor(dataset, build.resonatorId);
    if (!introKey) return null;
    const introBuild = { ...build, rotation: [introKey] };
    try {
        const result = simulateRotation({ build: introBuild, dataset, target, amplifyContext, externalBuffWindows, timingMode });
        if (result.totals.missingSteps > 0 || result.totals.stepCount === 0) return null;
        return result;
    } catch { return null; }
}

// The dict key nanoka assigns a resonator's Intro Skill varies per resonator
// (e.g. 'intro' vs 'intro_time_to_show_some_colors') — look it up by
// skillType rather than assuming a fixed key, so every resonator's
// auto-injected intro segment resolves, not just the ones keyed 'intro'.
function introKeyFor(dataset, resonatorId) {
    const skillMap = effectiveSkillMap(dataset, resonatorId);
    if (!skillMap) return null;
    const found = Object.entries(skillMap).find(([k, def]) => !k.startsWith('_') && def?.skillType === 'intro');
    return found ? found[0] : null;
}

// Drop any Intro/Outro-type step from a member's own authored rotation
// before simulating it in team context (see AUTO_CAST_SKILL_TYPES above).
function withoutAutoCastSteps(build, dataset) {
    const skillMap = effectiveSkillMap(dataset, build.resonatorId);
    if (!skillMap || !build.rotation?.length) return build;
    const filtered = build.rotation.filter(key => !AUTO_CAST_SKILL_TYPES.has(skillMap[key]?.skillType));
    return filtered.length === build.rotation.length ? build : { ...build, rotation: filtered };
}

function emptyResult() {
    return {
        segments:     [],
        memberTotals: [],
        memberSteps:       new Map(),
        memberBuffWindows: new Map(),
        memberStackedBuffWindows: new Map(),
        teamWideEchoBuffs: [],
        memberEnergy:      new Map(),
        cooldownViolations: [],
        openerAdjustments:  [],
        concerto:     { enforced: false, max: 100, swaps: [] },
        totals: {
            damage: 0, time: 0, gameTime: 0, dps: 0, memberCount: 0, passCount: 0,
        },
    };
}
