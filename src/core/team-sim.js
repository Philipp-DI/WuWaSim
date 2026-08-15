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
 *     statusDamageGaps: [{ status, applications, reason }],   // 2026-08-01 — statuses
 *                        // that DO deal damage but have no confirmed per-stack
 *                        // multiplier yet, so their damage is absent, not zero
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
 *     openerAdjustments: [{              // energy shortfalls (opener.js) — REPORT
 *       resonatorId, pass,               // ONLY: the rotation always runs as
 *       shortfalls: [{ key, deficit, requiredEr }],   // authored, nothing spliced
 *       requiredEr,                      // and nothing gated. Present only when
 *     }],                                // deriveOpeners is on AND a cast is short
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

import { simulateRotation, ECHO_STEP_KEY, TUNE_BREAK_STEP_KEY, echoStepTimeOf, effectiveSkillMap, phraseTypesForStep, deriveGameTimes } from './sim.js';
import { deriveBuffWindows, windowStacksAtStep, shortBuffLabel } from './buffs/buff-windows.js';
import { resolveTuneStrain } from './tune-break.js';
import { DERIVED_SOURCE } from './buffs/external-buffs.js';
import { resolveTotalStats } from './stats.js';
import { resolveTeamSlots } from './team.js';
import { computeOffFieldContribution, offFieldActionIsSimulable } from './off-field.js';
import { computeDamage } from './formula.js';
import { computeStateTimeline } from './rotation-state.js';
import { stateDefsForResonator } from './rotation-rules.js';
import { statusesInflictedBy, applicationsFromSteps, statusApplyRules, statusBurstRules, buildEnemyStatusTimeline, distinctApplicators, computeNegativeStatusDamage, capRaiseWindowsFromSteps, capRaiseGateWindows, capRaiseOutroGates, capRaiseWindowsFromInflicts,
    resolveStatusOverTimeDamage, statusDamageGaps, resolveAfflictionTriggers,
    computeAfflictionDamage, NEGATIVE_STATUS_DEFS,
    defIgnoreOutroGates, defIgnoreForMemberAt } from './enemy-status.js';
import { teamWideContribution, teamWideWindowSpecs, mergeTeamBundles, isTeamWideBuff } from './buffs.js';
import { incomingResonatorContribution, distinctApplicatorTierContribution } from './buffs/conditional-buffs.js';
import { collectEnergyEvents, accumulateEnergy, applyEnergyEvent, OFF_FIELD_SHARE } from './team-energy.js';
import { annotateStepCooldowns } from './cooldowns.js';
import { deriveEnergyShortfalls } from './opener.js';

// Havoc Bane has no DoT — it reduces enemy DEF for the WHOLE team (−2%/stack).
// It feeds the DefMult bucket of computeDamage via target.defShred
// (docs/NEGATIVE-STATUS-REFERENCE.md §5), not the negative-status DoT path.
// The stack COUNT is whatever the shared enemy timeline reports, which is
// already clamped to the cap in force — base 3, or more while a kit's raise
// window is open (enemy-status.js STATUS_CAP_RAISES).
const HAVOC_BANE_PER_STACK = NEGATIVE_STATUS_DEFS.havoc_bane?.defReductionPerStack ?? 0.02;

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
        memberWindowSpecs, memberCost, memberEchoGain, memberEchoCooldown, memberEchoLock,
    } = resolveMemberContext(occupied, dataset);
    const statusApplications = [];   // per-cast applications, team-time ordered
    const statusCapRaises = [];      // kit windows that LIFT a status's base cap
    const raiseGates = [];           // enclosing windows an inflict-triggered raise needs open
    // Thread-of-Bane-style DEF IGNORE (enemy-status.js DEF_IGNORE_GRANTS): the
    // OUTRO-opened gates inside which a status-inflicting member holds the buff.
    // Only the gates are accumulated — see defIgnoreForMemberAt for why the buff
    // is resolved from the gate rather than from realised applications.
    const defIgnoreGates = [];
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
        occupied, memberStats, memberInflicts, memberWindowSpecs, statusApplications, statusCapRaises, raiseGates,
        defIgnoreGates,
        externalTeamBuffs, timeline,
        memberCost, memberEchoGain, memberEchoCooldown, memberEchoLock,
        // A live per-member Resonance Energy ledger, advanced segment-by-segment
        // with the SAME rule the reported trace uses (see creditTraceToLedger).
        //
        // IT STARTS FULL (2026-08-14, maintainer-directed). ~~The cold-start
        // convention was an empty gauge~~, which is not how the mode this app
        // exists to model works: in Tower of Adversity every resonator enters
        // with a full Resonance Energy meter. Starting at zero made the FIRST
        // Liberation of a rotation unpayable, and the engine bought the
        // shortfall with derived filler — 50.4s of it on the benchmark team,
        // against arabwuwa's entire cold-start cost of 1.59s.
        //
        // OVERCAP IS NOT POSSIBLE, and here that is load-bearing rather than
        // incidental: `applyEnergyEvent` already clamps to `liberationCost`, and
        // since the cost IS the meter's size, a full start means every point
        // generated before the first Liberation is SPILLED. That is correct and
        // cheap — a Liberation is placed for its buff window, not for its energy
        // efficiency (Chisa's feeds the +120% on Sawring Blitz; a support's is
        // cast late so it spans the next two members' turns) — and it is exactly
        // what makes the ER target meaningful: the target is the ER at which a
        // full meter is REBUILT within one loop, so the cast can be placed where
        // the kit wants it rather than where the gauge allows.
        //
        // Concerto and the Forte/SpecialEnergy gauges deliberately do NOT get
        // this treatment: they start empty, which is why pass 1 is still the
        // weakest pass (no Concerto banked, no buff ramp, nothing built up).
        memberGauge: occupied.map((_, index) => memberCost[index] ?? 0),
        // Per-member trigger-fire ledger in TEAM time, carried across that
        // member's passes (2026-08-02). A member's own timed effects are
        // resolved inside their segment's isolated simulateRotation, so without
        // this a 30s self-buff opened late in pass 1 silently restarts from
        // nothing when they swap back in — the window is truncated at the
        // segment boundary and the remainder is lost. Team-WIDE buffs never had
        // this problem: they live on `timeline` with their true end.
        memberFires: occupied.map(() => null),
        // Curated gauge levels each member is holding, carried between the
        // segments of one turn and across their passes. A turn is simulated as
        // several rotations — the auto-injected Intro is its own segment — but a
        // gauge belongs to the character, not to a segment: Denia earns a Dark
        // Core on Intro and spends it in the segment after.
        memberResources: occupied.map(() => null),
        segments: [],
        cursor: 0,
        concertoGauge: occupied.map(() => initialConcerto),
        concertoSwaps: [],
        prevSwapReady: true,
        // Per-member set of off-field trigger categories actually FIRED so far
        // (see applyOffFieldContributions' header for the maintainer rule).
        firedTriggers: occupied.map(() => new Set()),
        openerAdjustments: [],
        // Tune Break is capped at one per PASS for the whole team; surplus
        // slotted responses are recorded here so the UI can say what it dropped.
        tuneBreakUsedInPass: false,
        tuneBreaksDropped: [],
        // The Tune Strain chain, resolved once for the whole roster. Tune Breaks
        // LANDED equals the pass count when any member slots one, because the
        // cap above guarantees exactly one per pass.
        tuneStrain: resolveTuneStrain({
            members: occupied.map(slot => ({
                resonatorId: slot.build.resonatorId,
                chain: slot.build.chain ?? 0,
                resonanceMode: slot.build.resonanceMode ?? null,
                rotation: slot.build.rotation ?? [],
            })),
            dataset,
            tuneBreaks: occupied.some(slot => (slot.build.rotation ?? []).includes(TUNE_BREAK_STEP_KEY))
                ? passCount : 0,
            shifting: occupied.some((slot, index) => memberInflicts[index]?.has('tune_strain')),
        }),
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
        // One Tune Break per PASS, for the whole team — not one per member. The
        // response is to the TARGET's Off-Tune bar, and the bar refills once per
        // cycle, so three members moving through one pass share a single
        // opportunity (maintainer ruling 2026-08-03). Reset here rather than
        // per member, which is the whole point.
        sim.tuneBreakUsedInPass = false;
        for (let memberIndex = 0; memberIndex < occupied.length; memberIndex++) {
            const turn = beginTurn(sim, pass, memberIndex);
            runIntroSegment(sim, turn);
            const onFieldWindow = runRotationSegment(sim, turn);
            if (onFieldWindow) applyOffFieldContributions(sim, turn, onFieldWindow);
            recordOutroSwap(sim, turn);
        }
    }
    const { segments, memberAcc, concertoSwaps, openerAdjustments } = sim;

    // ── 2b. Status damage that is not one-per-application ────────────────────
    // Periodic ticks and burst-on-max need the FINISHED timeline: a tick has to
    // know how long the status survived, a burst has to know the cap in force.
    // Resolved here, once, and attributed to whoever last applied the status.
    const finalTimeline = buildEnemyStatusTimeline(sim.statusApplications, sim.statusCapRaises);
    // Burst thresholds belong to whoever is IN the team: one member's kit lowers
    // the detonation point on the shared enemy for everyone.
    const teamBurstRules = sim.occupied.flatMap(slot =>
        statusBurstRules(slot.build.resonatorId, slot.build.resonanceMode ?? null) ?? []);
    const overTime = resolveStatusOverTimeDamage(finalTimeline, sim.cursor, (status, stacks, atkLv) =>
        computeNegativeStatusDamage({ status, stacks, atkLv, target, dataset }), dataset, teamBurstRules);
    for (const instance of overTime) {
        const index = sim.occupied.findIndex(slot => slot.build.resonatorId === instance.applicatorId);
        if (index < 0) continue;
        sim.memberAcc[index].statusDmg += instance.damage;
        sim.memberAcc[index].damage    += instance.damage;
    }
    // Statuses that DO deal damage but have no confirmed multiplier yet —
    // reported rather than silently contributing nothing (Aemeath's whole kit).
    const statusGaps = statusDamageGaps(finalTimeline, dataset);

    // Per-member step arrays are needed here (not just for display): a
    // kit-triggered affliction fires on a specific CAST, so the accrual below
    // reads them before the totals are summed.
    const { memberSteps, memberBuffWindows } = collectMemberSteps(segments);

    // Kit-TRIGGERED affliction damage: a member consuming a mark on the target
    // to fire one big instance, at that kit's OWN multiplier (Aemeath's Seraphic
    // Duet consuming Fusion Trail). Resolved here for the same reason as the
    // ticks — the mark's stack count needs the finished application timeline.
    for (let index = 0; index < sim.occupied.length; index++) {
        const memberBuild = sim.occupied[index].build;
        const steps = memberSteps.get(memberBuild.resonatorId) ?? [];
        for (const instance of resolveAfflictionTriggers(finalTimeline, steps, memberBuild, dataset,
            (status, multiplier, atkLv) => computeAfflictionDamage({ status, multiplier, atkLv, target, dataset }))) {
            sim.memberAcc[index].statusDmg += instance.damage;
            sim.memberAcc[index].damage    += instance.damage;
        }
    }

    // ── 3. Aggregate totals ───────────────────────────────────────────────────
    const totalDamage   = memberAcc.reduce((sum, member) => sum + member.damage, 0);
    const totalOffField = memberAcc.reduce((sum, member) => sum + member.offFieldDmg, 0);
    const totalStatusDmg = memberAcc.reduce((sum, member) => sum + member.statusDmg, 0);
    const totalHeal     = memberAcc.reduce((sum, member) => sum + member.heal, 0);
    const totalShield   = memberAcc.reduce((sum, member) => sum + member.shield, 0);
    const totalTime     = sim.cursor;

    // ── 4. Per-member buff windows (P11 §4; the step arrays are built above) ──
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
        statusDamageGaps: statusGaps,
        memberSteps,
        memberBuffWindows,
        memberStackedBuffWindows,
        teamWideEchoBuffs: echoTeamBuffs,   // 2026-07-15 — echo shield/aura DMG-boost auras (Bell-Borne etc.)
        memberEnergy,
        cooldownViolations,
        openerAdjustments,
        tuneBreaksDropped: sim.tuneBreaksDropped,
        // The Tune Strain chain, so the UI can show WHY a responder is amplified
        // (cap, stacks, and each member's Boost points) rather than only the
        // damage it produced.
        tuneStrain: {
            cap: sim.tuneStrain.cap,
            stacks: sim.tuneStrain.stacks,
            members: [...sim.tuneStrain.perMember].map(([resonatorId, entry]) => ({ resonatorId, ...entry })),
        },
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
 * - memberCost/memberEchoGain/memberEchoCooldown/memberEchoLock: Resonance
 *   Energy constants for the per-member Resonance Energy ledger (opener.js
 *   greedyFiller — and charges it the same timeline time the sim does).
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
    // Timeline time the echo step costs — 0 for a parallel echo, ECHO_CAST_TIME
    // for a Transform echo. Same classifier the sim uses, so the opener's
    // energy projection is paced like the rotation it pads.
    const memberEchoLock = occupied.map(slot => echoStepTimeOf(slot0EchoOf(slot)));

    return {
        memberStats, memberInflicts, memberTeamWide, echoTeamBuffs,
        memberWindowSpecs, memberCost, memberEchoGain, memberEchoCooldown, memberEchoLock,
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
/**
 * A member's trigger-fire ledger, moved between the team clock and a segment's
 * local clock. Local times come out NEGATIVE for fires that happened in an
 * earlier pass, which is exactly what a 'seconds' window needs to decide how
 * much of itself is left (`carryInFires` in sim.js).
 *
 * Both directions drop nothing: a fire too old to matter simply resolves to a
 * window that has already expired, and letting the window logic decide that is
 * cheaper than duplicating each effect's duration here.
 */
const shiftFires = (fires, delta) => (fires ? {
    types: fires.types.map(([name, time]) => [name, time + delta]),
    keys: fires.keys.map(([name, time]) => [name, time + delta]),
} : null);
const shiftFiresToLocal = (fires, segStart) => shiftFires(fires, -segStart);
const shiftFiresToTeam = (fires, segStart) => shiftFires(fires, segStart);

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
        // Outro buffs from the PREVIOUS member that are still active, filtered to
        // the Resonance Mode that member is actually in. Four outros are a MENU
        // keyed by mode (`outroBuffs[*].mode`), and only one branch of a menu can
        // be live — Denia's Tune Strain grant was reaching Fusion Burst teams.
        amplifyContext: (handoffFired && prevReso?.outroBuffs?.length)
            ? outroBuffsInMode(prevReso.outroBuffs, prevBuild?.resonanceMode ?? null)
            : null,
    };
}

/**
 * The outro grants live for a member in `resonanceMode`. An ungated grant always
 * applies; a gated one only in its own mode. Returns null when nothing survives,
 * so the caller's "no outro buffs" path is unchanged.
 */
function outroBuffsInMode(outroBuffs, resonanceMode) {
    const live = outroBuffs.filter(buff => !buff.mode || buff.mode === resonanceMode);
    return live.length ? live : null;
}

/**
 * Stage: the auto-injected Intro segment (every member on every entry except
 * the very first). Advances the cursor by the Intro's own cast time.
 */
function runIntroSegment(sim, turn) {
    if (!turn.handoffFired) return;
    const { build, memberIndex, accum } = turn;
    const introResult = simulateIntro(build, sim.dataset, sim.target, turn.amplifyContext,
        timelineWindowsFor(sim.timeline, build.resonatorId, sim.cursor), sim.timingMode,
        sim.memberResources[memberIndex]);
    // Hand the gauge on to the rotation segment of this same turn — the Intro
    // is a cast like any other and its income has to reach the cast that spends
    // it. Only on a real intro: a refused one (null) leaves the gauge alone.
    if (introResult?.resourceEndLevels) sim.memberResources[memberIndex] = introResult.resourceEndLevels;
    const introTime = introResult?.totals.time ?? OUTRO_CAST_TIME;
    // SKILL damage only — see the note on rotDmg below.
    const introDmg  = introResult?.totals.skillDamage ?? 0;
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
 * reports any Resonance Energy shortfall when enabled, and advances the cursor.
 *
 * Returns { rotTime, memberTarget } — the on-field window the off-field
 * stage needs — or null when the member has no rotation.
 */
function runRotationSegment(sim, turn) {
    const { build, memberIndex, accum } = turn;
    const teamBuild = capTuneBreaksPerPass(withoutAutoCastSteps(build, sim.dataset), sim, turn);
    if (!teamBuild.rotation?.length) return null;

    // Team-aware status gating (L2): statuses present at this point in the
    // team rotation (from earlier members, persisting) PLUS the ones THIS
    // member inflicts during its own window.
    const enemyTl = buildEnemyStatusTimeline(sim.statusApplications, sim.statusCapRaises);
    const present = enemyTl.presentStatusesAt(sim.cursor);
    const enemyStatuses = new Set([...present, ...sim.memberInflicts[memberIndex]]);
    // Team-wide auras (L3) + the PREVIOUS member's incoming-resonator
    // transfer (e.g. a Wishes wielder's Snowfall Outro → +25% Glacio DMG to
    // whoever swaps in — gated on the prev member's own inflict).
    // Pact of Neonlight Leap's second half scales off the Tune Break Boost of
    // the resonator swapping IN — which is THIS member, not the one handing the
    // buff over (the game reads the buff HOLDER's attribute set, policy[2] = 0).
    // `sim.tuneStrain.perMember` already holds each member's total for the whole
    // team, so this reads it rather than recomputing a second, divergable one.
    const incomingSources = {
        [DERIVED_SOURCE.TUNE_BREAK_BOOST]:
            sim.tuneStrain?.perMember?.get(build.resonatorId)?.points ?? 0,
    };
    const prevIncoming = (turn.handoffFired && turn.prevReso)
        ? incomingResonatorContribution(turn.prevBuild, sim.dataset, turn.prevReso, incomingSources) : null;
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
    const ownTier = distinctApplicatorTierContribution(
        build.resonatorId, build.resonanceMode ?? null, countDistinct, build.chain ?? 0);
    const teamBuffs = mergeTeamBundles([sim.externalTeamBuffs(memberIndex), prevIncoming, ownTier]);

    // Havoc Bane DEF shred (L4): a teammate's Havoc Bane lowers enemy DEF for
    // everyone — fold the active stacks into target.defShred.
    // statusStacksAt already clamps to the cap in force at this instant — which
    // a teammate's raise may have lifted above the base (enemy-status.js
    // STATUS_CAP_RAISES) — so clamping again to the BASE here would undo it.
    const havocStacks = enemyTl.statusStacksAt('havoc_bane', sim.cursor);
    // Thread-of-Bane DEF IGNORE (L4b): a SEPARATE multiplicative factor from
    // defShred — the formula is (1−defShred)(1−defIgnore) — earned by THIS
    // member's own inflicts inside the granting kit's Outro gate. Sampled at
    // segment start, the same point-sample convention the Havoc Bane shred above
    // already uses; a window opening mid-segment is therefore credited from the
    // NEXT segment on, never retroactively.
    const memberDefIgnore = defIgnoreForMemberAt(
        sim.defIgnoreGates,
        sim.occupied.map(slot => ({ resonatorId: slot.build.resonatorId, chain: slot.build.chain ?? 0 })),
        sim.memberInflicts[memberIndex],
        sim.cursor,
        build.resonatorId);
    const memberTarget = (havocStacks > 0 || memberDefIgnore > 0)
        ? { ...sim.target,
            ...(havocStacks > 0 ? { defShred: havocStacks * HAVOC_BANE_PER_STACK } : {}),
            ...(memberDefIgnore > 0 ? { defIgnore: (sim.target.defIgnore ?? 0) + memberDefIgnore } : {}) }
        : sim.target;

    // Derived opener (2026-07-12): pad or gate this pass's consuming
    // Liberations against the member's LIVE gauge — see opener.js.
    // REPORT-ONLY. The rotation runs exactly as authored either way; this names
    // the Liberations the build cannot pay for and the ER that would fund them.
    const energy = sim.deriveOpeners ? deriveEnergyShortfalls({
        rotation: teamBuild.rotation,
        skillMap: effectiveSkillMap(sim.dataset, build.resonatorId) ?? {},
        echoEnergyGain: sim.memberEchoGain[memberIndex],
        er: sim.memberStats[memberIndex].stats.energyRegen,
        liberationCost: sim.memberCost[memberIndex],
        gaugeStart: sim.memberGauge[memberIndex],
    }) : null;
    // The rotation is never rewritten now — no filler spliced, no cast dropped.
    const simBuild = teamBuild;

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
        carryInFires: shiftFiresToLocal(sim.memberFires[turn.memberIndex], sim.cursor),
        carryInResources: sim.memberResources[turn.memberIndex],
        // The Tune Strain chain is a TEAM fact — the stack cap is the sum of the
        // responders present and the Boost points are pooled — so it is resolved
        // once for the roster and handed to each member, never re-derived from
        // one build in isolation.
        tuneStrainAmplify: sim.tuneStrain.perMember.get(build.resonatorId)?.amplify ?? 0,
    });
    // Hand this segment's ending ledger to this member's NEXT pass.
    sim.memberFires[turn.memberIndex] = shiftFiresToTeam(simResult.fires, sim.cursor);
    sim.memberResources[turn.memberIndex] = simResult.resourceEndLevels;
    const rotTime = simResult.totals.time;
    // SKILL damage only. simulateRotation resolves negative-status damage against
    // an enemy of its OWN (2026-08-01, so the build page stops omitting it), but
    // in a team there is ONE enemy: statuses stack across members, a raise armed
    // by one member caps another's stack, and the damage is attributed to whoever
    // last applied it. accrueStatusDamage below owns that shared timeline, so
    // taking totals.damage here would count this member's status damage twice.
    const rotDmg  = simResult.totals.skillDamage;
    sim.concertoGauge[memberIndex] = Math.min(CONCERTO_MAX, sim.concertoGauge[memberIndex] + concertoGainOf(simResult));

    // Offset every step's timestamps by the current cursor
    const offsetSteps = simResult.steps.map(step => ({
        ...step,
        startTime: step.startTime + sim.cursor,
        endTime:   step.endTime   + sim.cursor,
    }));
    if (energy) {
        sim.openerAdjustments.push({
            resonatorId: build.resonatorId, pass: turn.pass,
            shortfalls: energy.shortfalls,
            // The ER that would fund every underfunded cast in this pass — the
            // single number a build page can act on.
            requiredEr: energy.shortfalls.reduce(
                (worst, one) => one.requiredEr == null ? worst : Math.max(worst ?? 0, one.requiredEr), null),
        });
    }

    // Cap raises this member's casts arm, on the SHARED enemy: recorded before
    // status damage so a stack landing under the raise is capped correctly.
    sim.statusCapRaises.push(...capRaiseWindowsFromSteps(
        offsetSteps, build.resonatorId, build.chain ?? 0));

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
        ...(energy ? { energyShortfalls: energy.shortfalls } : {}),
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
    const own = applicationsFromSteps(offsetSteps, sim.memberInflicts[memberIndex], build.resonatorId,
        build.level ?? 90, statusApplyRules(build.resonatorId, build.resonanceMode ?? null, sim.dataset,
            build.chain ?? 0));

    // Cap raises on the SHARED enemy, recorded BEFORE any stack lands so a stack
    // gained under a raise is capped correctly. Three kinds, in order:
    //   1. gates this member's casts open, which outlive its segment;
    //   2. raises this member's own casts arm;
    //   3. raises the applications themselves arm, for ANY member owning an
    //      inflict-triggered raise — a raise belongs to the enemy, so one
    //      teammate's Ceaseless Landscape lifts the cap for whoever inflicts.
    sim.raiseGates.push(...capRaiseGateWindows(offsetSteps, build.resonatorId, build.chain ?? 0));
    sim.statusCapRaises.push(...capRaiseWindowsFromSteps(offsetSteps, build.resonatorId, build.chain ?? 0));
    sim.statusCapRaises.push(...capRaiseWindowsFromInflicts(
        own,
        sim.occupied.map(slot => ({ resonatorId: slot.build.resonatorId, chain: slot.build.chain ?? 0 })),
        sim.raiseGates));

    for (const application of own) {
        sim.statusApplications.push(application);
        if (!NEGATIVE_STATUS_DEFS[application.status]?.damageOnStack) continue;
        const stackCount = buildEnemyStatusTimeline(sim.statusApplications, sim.statusCapRaises)
            .statusStacksAt(application.status, application.t);
        const nsDmg = computeNegativeStatusDamage({ status: application.status, stacks: stackCount, atkLv: application.applicatorLevel, target: memberTarget, dataset: sim.dataset });
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

        // Re-price every action the pipeline CAN resolve (one with a real
        // skillKey) through the ordinary damage lane, so it takes the owner's
        // buffs and can drive triggers/conditions like any other cast. The bare
        // formula figure is replaced, never added to.
        const { damage: simulatedDamage, steps: offFieldSteps } =
            simulateOffFieldActions(sim, offMemberIndex, contrib, memberTarget, rotTime);
        const bareDamage = contrib.actions
            .filter(entry => !offFieldSteps.some(step => step.offFieldAction === entry.action))
            .reduce((sum, entry) => sum + entry.damage, 0);
        const totalDamage = bareDamage + simulatedDamage;

        if (totalDamage > 0) {
            sim.memberAcc[offMemberIndex].offFieldDmg += totalDamage;
            sim.memberAcc[offMemberIndex].damage      += totalDamage;

            const segment = {
                slotIndex:     offSlot.slotIndex,
                resonatorId:   offSlot.build.resonatorId,
                resonatorName: offReso.name,
                buildId:       offSlot.build.id,
                kind:          'offField',
                pass:          turn.pass,
                startTime:     sim.cursor - rotTime,
                endTime:       sim.cursor,
                damage:        totalDamage,
                steps:         offFieldSteps,
                offFieldActions: contrib.actions,
                simResult:     null,
            };
            sim.segments.push(segment);
            // Real steps mean real status applications: an Erosion Field tick is
            // a damaging instance from its owner, so it builds Fusion Burst the
            // same way her on-field casts do — which is most of why the lane
            // matters (more stacks → more detonations), not the tick damage.
            if (offFieldSteps.length) accrueStatusDamage(sim, offFieldSteps, offMemberIndex, memberTarget);
        }
    }
}

/**
 * Sub-stage: re-price the off-field actions the pipeline can actually resolve.
 *
 * An off-field hit is ORDINARY damage that happens to land while its owner is
 * benched. The bare `computeOffFieldDamage` path prices it with a naked
 * computeDamage call, which skips everything that makes damage correct here —
 * the owner's conditional effects and buff windows, the team-wide bundles, the
 * DMG-type bucket, and (the part that compounds) status application. So any
 * action naming a real `skillKey` is simulated instead, with exactly the context
 * its owner's own rotation segment would get.
 *
 * Two things deliberately do NOT follow:
 *   - TIME. Off-field damage occupies no slice of the shared timeline, so the
 *     synthesized steps are spread across the window that just elapsed and are
 *     never allowed to advance the cursor.
 *   - ENERGY / CONCERTO. creditTraceToLedger is not called: the gauge model
 *     credits an off-field member a 50% share of the ACTIVE member's generation
 *     (team-energy.js OFF_FIELD_SHARE) and crediting these casts as well would
 *     double-count the same benched member.
 *
 * @returns {{ damage: number, steps: Array }}
 */
function simulateOffFieldActions(sim, offMemberIndex, contrib, memberTarget, rotTime) {
    const offSlot = sim.occupied[offMemberIndex];
    const build = offSlot.build;
    const skillMap = effectiveSkillMap(sim.dataset, build.resonatorId) ?? {};
    const windowStart = sim.cursor - rotTime;

    let damage = 0;
    const steps = [];
    for (const entry of contrib.actions) {
        if (!offFieldActionIsSimulable(entry.action, skillMap)) continue;
        const hits = Math.max(0, Math.floor(entry.hits ?? 0));
        if (hits === 0) continue;

        const rotation = Array.from({ length: hits }, () => entry.action.skillKey);
        const result = simulateRotation({
            build: { ...build, rotation, rotationMeta: rotation.map(() => ({})) },
            dataset: sim.dataset,
            target: memberTarget,
            enemyStatuses: sim.memberInflicts[offMemberIndex],
            teamBuffs: sim.externalTeamBuffs(offMemberIndex),
            externalBuffWindows: timelineWindowsFor(sim.timeline, build.resonatorId, windowStart),
            timingMode: sim.timingMode,
            carryInFires: shiftFiresToLocal(sim.memberFires[offMemberIndex], windowStart),
            tuneStrainAmplify: sim.tuneStrain.perMember.get(build.resonatorId)?.amplify ?? 0,
        });
        damage += result.totals.skillDamage;

        // Spread the hits evenly across the elapsed window at their real cadence
        // — the status timeline reads these times, so they have to be ordered
        // and inside the window, not stacked at one instant.
        const spacing = hits > 0 ? rotTime / hits : 0;
        result.steps.forEach((step, index) => {
            steps.push({
                ...step,
                startTime: windowStart + index * spacing,
                endTime:   windowStart + index * spacing,
                stepDuration: 0,
                freezeTime: 0,
                offField: true,
                offFieldAction: entry.action,
            });
        });
    }
    return { damage, steps };
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
        // 13 Outro Skills deal real damage (up to 795% of ATK). Their rows were
        // invisible until 2026-08-07 — an Outro node's `level` map is empty, so
        // preprocess walked no params and produced nothing, and this segment
        // scored a hard-coded 0 for every swap in every team.
        const outroResult = simulateOutro(build, sim.dataset, sim.target,
            timelineWindowsFor(sim.timeline, build.resonatorId, sim.cursor), sim.timingMode);
        const outroDmg = outroResult?.totals.skillDamage ?? 0;
        const offsetOutroSteps = (outroResult?.steps ?? []).map(step => ({
            ...step,
            startTime: step.startTime + sim.cursor,
            endTime:   step.endTime   + sim.cursor,
        }));
        const segment = {
            slotIndex:     turn.slot.slotIndex,
            resonatorId:   build.resonatorId,
            resonatorName: turn.name,
            buildId:       build.id,
            kind:          'outro',
            pass:          turn.pass,
            startTime:     sim.cursor,
            endTime:       sim.cursor + OUTRO_CAST_TIME,
            damage:        outroDmg,
            steps:         offsetOutroSteps,
            simResult:     outroResult,
        };
        sim.segments.push(segment);
        accrueChainEffectWindowsToTimeline(sim.timeline, sim.memberWindowSpecs[memberIndex], segment, turn.name);
        sim.firedTriggers[memberIndex].add('outro');
        // A cap raise the kit hangs on the OUTRO (Chisa's Resonant Thread of
        // Closure) opens its gate here — the swap is the cast, and it is never a
        // step. Pushed before the next member's rotation segment consumes gates.
        sim.raiseGates.push(...capRaiseOutroGates(sim.cursor, build.resonatorId, build.chain ?? 0));
        // The SAME Outro opens the Thread of Bane gate — one node, two bullets.
        sim.defIgnoreGates.push(...defIgnoreOutroGates(sim.cursor, build.resonatorId, build.chain ?? 0));
        // Credited to the OUTGOING member, and NOT to accum.time: the cast runs
        // in parallel with the incoming Intro, so it occupies no exclusive slice
        // of the timeline (see this function's own note on the cursor).
        turn.accum.damage += outroDmg;
        creditTraceToLedger(sim, outroResult, memberIndex);
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
    if (bundle.atkRatio > 0) parts.push({ name: `+${pct(bundle.atkRatio)}% ATK`, bonusPct: bundle.atkRatio, bonusKind: 'atk', element: null, dmgType: null, bucket: 'atkRatio', bucketKey: null });
    if (bundle.critRate > 0) parts.push({ name: `+${pct(bundle.critRate)}% Crit Rate`, bonusPct: bundle.critRate, bonusKind: 'crit', element: null, dmgType: null, bucket: 'critRate', bucketKey: null });
    if (bundle.critDmg > 0) parts.push({ name: `+${pct(bundle.critDmg)}% Crit DMG`, bonusPct: bundle.critDmg, bonusKind: 'crit', element: null, dmgType: null, bucket: 'critDmg', bucketKey: null });
    for (const [el, value] of Object.entries(bundle.dmgByElement ?? {})) if (value > 0)
        parts.push({ name: `+${pct(value)}% ${ELEMENT_NAMES[el] ?? '?'} DMG`, bonusPct: value, bonusKind: 'element', element: Number(el), dmgType: null, bucket: 'dmgByElement', bucketKey: Number(el) });
    for (const [type, value] of Object.entries(bundle.dmgBySkillType ?? {})) if (value > 0)
        parts.push({ name: `+${pct(value)}% ${DMG_TYPE_NAMES[type] ?? type} DMG`, bonusPct: value, bonusKind: 'unknown', element: null, dmgType: type, bucket: 'dmgBySkillType', bucketKey: type });
    const amp = (bundle.amplifyAll ?? 0)
        + Object.values(bundle.amplifyByElement ?? {}).reduce((sum, value) => sum + value, 0)
        + Object.values(bundle.amplifyByType ?? {}).reduce((sum, value) => sum + value, 0);
    if (amp > 0) parts.push({ name: `+${pct(amp)}% DMG Amplify`, bonusPct: amp, bonusKind: 'amplify', element: null, dmgType: null, bucket: 'amplifyAll', bucketKey: null });

    // WHAT ADDS UP TO THAT NUMBER. A strip reading "+37% Fusion DMG" is two
    // unrelated pieces of gear — Chromatic Foam's 25% and a Reminiscence: Denia
    // echo's 12% — and the sum alone tells a reader neither which set earned it
    // nor which piece to change. Only split when there IS more than one addend;
    // a single source repeated under the headline is noise.
    return parts.map(({ bucket, bucketKey, ...part }) => {
        const addends = (bundle.sources ?? [])
            .filter(source => source.bucket === bucket && source.key === bucketKey);
        return {
            ...part, sourceName,
            breakdown: addends.length > 1
                ? addends.map(source => ({ label: source.label, value: source.value }))
                : null,
            sonataName: `${sourceName} · Outro transfer (flat)`, trigger: 'outro',
            maxStacks: 1, start: segStart, end: segEnd,
            samples: [{ start: segStart, end: segEnd, stacks: 1 }],
            teamWide: false, raw: '',
        };
    });
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

function simulateIntro(build, dataset, target, amplifyContext = null, externalBuffWindows = null, timingMode = 'toa', carryInResources = null) {
    const introKey = introKeyFor(dataset, build.resonatorId, build);
    if (!introKey) return null;
    const introBuild = { ...build, rotation: [introKey] };
    try {
        const result = simulateRotation({ build: introBuild, dataset, target, amplifyContext, externalBuffWindows, timingMode, carryInResources });
        if (result.totals.missingSteps > 0 || result.totals.stepCount === 0) return null;
        return result;
    } catch { return null; }
}

/**
 * The Outro Skill's own damage, or null when the resonator's outro deals none.
 *
 * Refused for a resonator whose off-field actions carry an `outro` trigger
 * (Galbrena's burst, Calcharo's and Rover: Havoc's summons): that lane already
 * pays the same cast, and running both would count it twice. The refusal lives
 * here, not only in preprocess, because it is a fact about the ENGINE — two
 * paths, one cast.
 */
function simulateOutro(build, dataset, target, externalBuffWindows = null, timingMode = 'toa') {
    const resonator = dataset.resonators?.find(entry => entry.id === build.resonatorId);
    if (resonator?.offFieldActions?.some(action => action.trigger === 'outro')) return null;
    const outroKey = outroKeyFor(dataset, build.resonatorId);
    if (!outroKey) return null;
    try {
        const result = simulateRotation({
            build: { ...build, rotation: [outroKey] }, dataset, target, externalBuffWindows, timingMode });
        if (result.totals.missingSteps > 0 || result.totals.stepCount === 0) return null;
        return result;
    } catch { return null; }
}

function outroKeyFor(dataset, resonatorId) {
    const skillMap = effectiveSkillMap(dataset, resonatorId);
    if (!skillMap) return null;
    const found = Object.entries(skillMap).find(([key, def]) => !key.startsWith('_') && def?.skillType === 'outro');
    return found ? found[0] : null;
}

// The dict key nanoka assigns a resonator's Intro Skill varies per resonator
// (e.g. 'intro' vs 'intro_time_to_show_some_colors') — look it up by
// skillType rather than assuming a fixed key, so every resonator's
// auto-injected intro segment resolves, not just the ones keyed 'intro'.
//
// THE ROTATION PICKS, when it names one. An Intro node can ship SEVERAL damage
// rows — Aemeath has `intro_songs_across_the_universe` and
// `intro_debut_of_meteoric_radiance`, Denia `intro_it_s_been_a_while` and
// `intro_knock_knock` — and taking whichever the skill map happened to list
// first cast a different Intro than the build asked for. It cost more than a
// label: Aemeath's reference rotation opens on `skill_mech_3`, which the Intro
// she names unlocks and the one the map listed first does not, so the team ran
// a sequence its own validator calls illegal. `withoutAutoCastSteps` then
// removed the authored step, leaving nothing to explain the swap. A rotation is
// performed as authored, and that includes WHICH Intro it authored.
function introKeyFor(dataset, resonatorId, build = null) {
    const skillMap = effectiveSkillMap(dataset, resonatorId);
    if (!skillMap) return null;
    const isIntro = (key) => !key.startsWith('_') && skillMap[key]?.skillType === 'intro';
    const authored = (build?.rotation ?? []).find(isIntro);
    if (authored) return authored;
    return Object.keys(skillMap).find(isIntro) ?? null;
}

// Drop any Intro/Outro-type step from a member's own authored rotation
// before simulating it in team context (see AUTO_CAST_SKILL_TYPES above).
function withoutAutoCastSteps(build, dataset) {
    const skillMap = effectiveSkillMap(dataset, build.resonatorId);
    if (!skillMap || !build.rotation?.length) return build;
    const filtered = build.rotation.filter(key => !AUTO_CAST_SKILL_TYPES.has(skillMap[key]?.skillType));
    return filtered.length === build.rotation.length ? build : { ...build, rotation: filtered };
}

/**
 * Keep at most ONE Tune Break per pass, across the whole team.
 *
 * A Tune Break is a response to the TARGET's Off-Tune bar, not a cast off a
 * gauge of ours, so the opportunity belongs to the fight rather than to any
 * member: three members moving through one pass share one bar. Without the cap
 * a three-member team would take three, and since the animation stops the
 * combat clock (measured — see sim.js resolveFreezeSchedule) each extra one is
 * damage at zero game-time cost, which compounds straight into DPS.
 *
 * Enforced by REMOVING the surplus steps rather than zeroing them, so nothing
 * downstream — energy, cooldowns, buff windows, the clock — sees a cast that
 * did not happen. The count is reported (`tuneBreaksDropped`) so the UI can say
 * the rotation asked for more than the fight allows.
 */
function capTuneBreaksPerPass(build, sim, turn) {
    const rotation = build.rotation ?? [];
    if (!rotation.includes(TUNE_BREAK_STEP_KEY)) return build;
    const kept = [];
    let dropped = 0;
    for (const key of rotation) {
        if (key !== TUNE_BREAK_STEP_KEY) { kept.push(key); continue; }
        if (sim.tuneBreakUsedInPass) { dropped++; continue; }
        sim.tuneBreakUsedInPass = true;
        kept.push(key);
    }
    if (!dropped) return { ...build, rotation: kept };
    sim.tuneBreaksDropped.push({
        pass: turn.pass, memberIndex: turn.memberIndex,
        resonatorId: build.resonatorId, resonatorName: turn.name, dropped,
    });
    return { ...build, rotation: kept };
}

function emptyResult() {
    return {
        segments:     [],
        memberTotals: [],
        statusDamageGaps: [],
        memberSteps:       new Map(),
        memberBuffWindows: new Map(),
        memberStackedBuffWindows: new Map(),
        teamWideEchoBuffs: [],
        memberEnergy:      new Map(),
        cooldownViolations: [],
        openerAdjustments:  [],
        tuneBreaksDropped:  [],
        tuneStrain:         { cap: 0, stacks: 0, members: [] },
        concerto:     { enforced: false, max: 100, swaps: [] },
        totals: {
            damage: 0, time: 0, gameTime: 0, dps: 0, memberCount: 0, passCount: 0,
        },
    };
}
