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

import { simulateRotation, resolveCastTime, ECHO_STEP_KEY, deriveBuffWindows, effectiveSkillMap, windowStacksAtStep, phraseTypesForStep, shortBuffLabel } from './sim.js';
import { resolveTotalStats } from './stats.js';
import { resolveTeamSlots, TEAM_SLOTS } from './team.js';
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
} = {}) {
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

    // P13 Team Effect Model (L1+L2): the statuses each member inflicts (from its
    // resonance mode + kit) and a SHARED enemy-status timeline accrued as we walk.
    // A member's status-conditional buffs are un-gated when the enemy carries the
    // status from ANY member (persisting across switches), not just their own kit.
    const memberInflicts = occupied.map(s =>
        statusesInflictedBy(dataset.resonators.find(r => r.id === s.build.resonatorId), dataset, s.build.resonanceMode ?? null));
    const statusApplications = [];   // per-cast applications, team-time ordered

    // L3 team-wide buffs — the FLAT (timing-independent) half. A receiving
    // member sees the UNION of the OTHER members' bundles (its own already
    // apply via its effect resolution). Two disjoint sources remain flat
    // (window derivation for them is planned, see docs/TEAM-BUFF-TIMELINE-PLAN.md):
    //   1. teamWideContribution — chain/inherent kit effects
    //   2. weaponSonataTeamWide (stats.js) — weapon/sonata CONDITIONAL clauses
    //      (crit/amplify/defIgnore buckets)
    // The former source 3 (sonata WINDOW-PATH buffs, "ATK of all party
    // members") and the echo shield auras moved to the TIMELINE-AWARE path
    // below (teamBuffTimeline, 2026-07-15) — credited by literal team-time
    // overlap, not flat.
    const memberTeamWide = occupied.map((s, mi) =>
        mergeTeamBundles([
            teamWideContribution(s.build, dataset.resonators.find(r => r.id === s.build.resonatorId)),
            memberStats[mi]?.stats?.weaponSonataTeamWide,
        ]));
    const externalTeamBuffs = (mi) =>
        mergeTeamBundles(memberTeamWide.filter((_, j) => j !== mi));

    // Echo team-wide DMG Boost aura carriers (informational result field; the
    // aura's damage/display both flow through the member's own sim windows —
    // sim.js computeBuffWindows' synthetic echo buff — and the timeline below).
    const echoTeamBuffs = occupied.map((s) => {
        if (!s.build.rotation?.includes(ECHO_STEP_KEY)) return null;
        const slot0 = s.build.echoes?.[0];
        const def = slot0 ? dataset.echoes?.find(e => e.id === slot0.id) : null;
        const boost = def?.activeSkill?.teamBuff?.dmgBoost ?? 0;
        if (!(boost > 0)) return null;
        return {
            echoName: def.name, resonatorId: s.build.resonatorId,
            memberName: dataset.resonators.find(r => r.id === s.build.resonatorId)?.name ?? '?',
            dmgBoost: boost, duration: def.activeSkill.teamBuff.duration ?? null,
        };
    }).filter(Boolean);

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
    const teamBuffTimeline = [];
    const memberStackedBuffWindows = new Map();
    const accrueSegmentBuffWindows = (seg, memberName) => {
        const entries = stackedWindowsForSegment(seg);
        if (!entries.length) return;
        const list = memberStackedBuffWindows.get(seg.resonatorId) ?? [];
        list.push(...entries);
        memberStackedBuffWindows.set(seg.resonatorId, list);
        for (const e of entries) {
            if (!e.teamWide) continue;
            for (const run of constantStackRuns(e.samples)) {
                teamBuffTimeline.push({
                    start: run.start, end: run.end, stacks: run.stacks,
                    bonusPct: e.bonusPct, bonusKind: e.bonusKind,
                    element: e.element, dmgType: e.dmgType,
                    label: `${e.name} · ${memberName}`, sonataName: e.sonataName,
                    sourceId: seg.resonatorId, external: true,
                });
            }
        }
    };
    // The accumulated timeline as a member's LOCAL-time external windows.
    // Same-source entries are skipped — the wielder's own copy applies natively
    // inside their own sim — EXCEPT `selfApplicable` ones (intro/outro-triggered
    // chain effects): those triggers fire only in the AUTO-INJECTED segments,
    // which the wielder's rotation sim never sees (withoutAutoCastSteps strips
    // authored intro/outro steps), so the wielder can never natively self-apply
    // them and receiving their own window is the only honest credit (2026-07-15
    // — until this, Changli's S4 buffed every member EXCEPT Changli).
    const externalWindowsFor = (resonatorId, segStart) =>
        teamBuffTimeline
            .filter(w => (w.sourceId !== resonatorId || w.selfApplicable) && w.end > segStart + 1e-6)
            .map(w => ({ ...w, start: w.start - segStart, end: w.end - segStart }));

    // WINDOWABLE team-wide chain/inherent effects (2026-07-15, Increment 2 of
    // the timeline plan): effects with a resolvable castMatch trigger + seconds
    // window (e.g. Changli S4 "after Intro, all team members' ATK +20% for
    // 30s") derive REAL windows from the member's team-time cast events — each
    // trigger fire opens [fireEnd, fireEnd + seconds], overlapping fires merge
    // (the same most-recent-fire semantics the wielder's own effect resolution
    // uses). Works across segment KINDS: intro/outro casts live in auto-
    // injected segments the wielder's own rotation sim never sees, so cast
    // events — not simResult.effectWindows — are the honest source.
    // Non-windowable team effects (unconditional auras, unresolved triggers,
    // crit kinds) remain in the FLAT memberTeamWide path above.
    const memberWindowSpecs = occupied.map(s =>
        teamWideWindowSpecs(s.build, dataset.resonators.find(r => r.id === s.build.resonatorId)));
    const accrueChainEffectWindows = (seg, mi, memberName) => {
        for (const spec of memberWindowSpecs[mi]) {
            // Trigger fire END times inside this segment (team time). Outro
            // segments carry no steps — the auto-injected Outro cast itself is
            // the fire.
            const fires = seg.kind === 'outro'
                ? (spec.triggerSkillType === 'outro' ? [seg.endTime] : [])
                : (seg.steps ?? []).filter(st =>
                    spec.triggerSkillKeys
                        ? spec.triggerSkillKeys.includes(st.skillKey)
                        : phraseTypesForStep(st.skillType).includes(spec.triggerSkillType),
                  ).map(st => st.endTime);
            if (!fires.length) continue;
            // Merge per-fire windows [f, f+seconds] into union intervals
            // (re-trigger refreshes the duration, never stacks).
            const intervals = [];
            for (const f of fires.sort((a, b) => a - b)) {
                const last = intervals[intervals.length - 1];
                if (last && f <= last.end + 1e-6) last.end = f + spec.seconds;
                else intervals.push({ start: f, end: f + spec.seconds });
            }
            const dispName = shortBuffLabel(spec);
            // Intro/outro-triggered → the wielder can never natively self-apply
            // (the trigger fires outside their rotation sim) → the timeline is
            // their own only credit path too (see externalWindowsFor).
            const selfApplicable = spec.triggerSkillType === 'intro' || spec.triggerSkillType === 'outro';
            for (const iv of intervals) {
                teamBuffTimeline.push({
                    start: iv.start, end: iv.end, stacks: 1,
                    bonusPct: spec.bonusPct, bonusKind: spec.bonusKind,
                    element: spec.element, dmgType: spec.dmgType,
                    label: `${dispName} · ${memberName}`, sonataName: spec.label,
                    sourceId: seg.resonatorId, external: true, selfApplicable,
                });
            }
            const list = memberStackedBuffWindows.get(seg.resonatorId) ?? [];
            list.push({
                name: dispName, sonataName: `KIT · ${spec.label}`, trigger: spec.triggerSkillType ?? 'cast',
                bonusPct: spec.bonusPct, bonusKind: spec.bonusKind, element: spec.element, dmgType: spec.dmgType,
                maxStacks: 1, start: intervals[0].start, end: intervals[intervals.length - 1].end,
                samples: intervals.map(iv => ({ start: iv.start, end: iv.end, stacks: 1 })),
                teamWide: true, raw: spec.raw,
            });
            memberStackedBuffWindows.set(seg.resonatorId, list);
        }
    };

    const segments   = [];
    let cursor       = 0;

    // Concerto gauge state (see param note above). `prevSwapReady` carries the
    // outgoing member's readiness across the outro → next-intro boundary.
    const CONCERTO_MAX  = 100;
    const concertoGauge = occupied.map(() => initialConcerto);
    const concertoSwaps = [];
    let prevSwapReady   = true;
    const concertoGainOf = (simResult) =>
        (simResult?.energyTrace ?? []).reduce((s, e) => s + (e.rawConcertoGen ?? 0), 0);

    // Off-field damage (turrets, coordinated attacks, companion summons, …)
    // requires its SPECIFIC trigger to have actually fired at least once —
    // OffFieldAction.trigger ('liberation'|'outro'|'skill'|'forte') names the
    // cast that sets the mechanic up (maintainer-confirmed 2026-07-11: "needs
    // actual condition verification if the off-field damage has been
    // activated e.g. by a Liberation cast", not merely "has ever been
    // on-field" — a member who has only Basic-Attacked so far hasn't set up
    // their Liberation-gated mechanic yet). Per-member set of trigger
    // categories fired so far this team rotation; populated as each member's
    // own segments are simulated below, checked before crediting any OTHER
    // member's off-field contribution during the current window.
    const firedTriggers = occupied.map(() => new Set());

    // Derived-opener support (2026-07-12): a live per-member Resonance Energy
    // ledger, advanced segment-by-segment with the SAME rule the reported
    // trace uses (team-energy.js applyEnergyEvent — own casts full, others'
    // at the off-field share, × own ER, reset on own consuming Liberation,
    // capped at own cost). It exists so the padding predictor sees the exact
    // gauge each member carries INTO their pass; collectEnergyEvents/
    // accumulateEnergy over the final segments reproduce the same numbers.
    const memberCost = occupied.map(s => dataset.baseStats?.[String(s.build.resonatorId)]?.energyMax ?? null);
    const memberEchoGain = occupied.map(s => {
        const slot0 = s.build.echoes?.[0];
        const def = slot0 ? dataset.echoes?.find(e => e.id === slot0.id) : null;
        return def?.activeSkill?.energyGain ?? 0;
    });
    // The slot-0 echo's cooldown — the derived opener casts the Echo Skill on
    // cooldown as a filler generator (opener.js greedyFiller).
    const memberEchoCooldown = occupied.map(s => {
        const slot0 = s.build.echoes?.[0];
        const def = slot0 ? dataset.echoes?.find(e => e.id === slot0.id) : null;
        return def?.activeSkill?.cooldown ?? 0;
    });
    const memberGauge = occupied.map(() => 0);
    const openerAdjustments = [];
    const creditTraceToLedger = (simResult, activeMi) => {
        for (const e of simResult?.energyTrace ?? []) {
            for (let j = 0; j < occupied.length; j++) {
                const own = j === activeMi;
                const base = own ? (e.rawGen ?? 0) : OFF_FIELD_SHARE * (e.rawGen ?? 0);
                const isLiberation = own && e.isLiberation === true;
                if (base === 0 && !isLiberation) continue;
                memberGauge[j] = applyEnergyEvent(memberGauge[j], { base, isLiberation },
                    { er: memberStats[j].stats.energyRegen, liberationCost: memberCost[j] }).gauge;
            }
        }
    };

    // Per-member accumulators (across all passes)
    const memberAcc = occupied.map(s => ({
        slotIndex:    s.slotIndex,
        resonatorId:  s.build.resonatorId,
        buildId:      s.build.id,
        damage:       0,
        introDamage:  0,
        offFieldDmg:  0,
        statusDmg:    0,
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
            // The Outro→Intro handoff only fires when the outgoing member's
            // Concerto was full (or enforcement is off — see param note).
            const handoffFired = !isFirst && (!enforceConcerto || prevSwapReady);
            const amplifyContext = (handoffFired && prevReso?.outroBuffs?.length) ? prevReso.outroBuffs : null;
            if (handoffFired) {
                const introResult = simulateIntro(build, dataset, target, amplifyContext,
                    externalWindowsFor(build.resonatorId, cursor));
                const introTime   = introResult?.totals.time ?? OUTRO_CAST_TIME;
                const introDmg    = introResult?.totals.damage ?? 0;
                concertoGauge[mi] = Math.min(CONCERTO_MAX, concertoGauge[mi] + concertoGainOf(introResult));

                // Offset every step's timestamps by the current cursor — introResult
                // is simulated in isolation (its own steps start at 0), matching the
                // rotation segment's offsetSteps below. Without this, anything that
                // reads step.startTime (memberSteps/buff windows, collectEnergyEvents'
                // energy trace) sees the intro's casts at their LOCAL time instead of
                // their real position in the team rotation — e.g. an intro fired at
                // cursor=15s would report its cast at t≈0, making time-ordered charts
                // jump backwards.
                const offsetIntroSteps = (introResult?.steps ?? []).map(s => ({
                    ...s,
                    startTime: s.startTime + cursor,
                    endTime:   s.endTime   + cursor,
                }));

                segments.push({
                    slotIndex:     slot.slotIndex,
                    resonatorId:   build.resonatorId,
                    resonatorName: name,
                    buildId:       build.id,
                    kind:          'intro',
                    pass,
                    startTime:     cursor,
                    endTime:       cursor + introTime,
                    damage:        introDmg,
                    steps:         offsetIntroSteps,
                    simResult:     introResult,
                });
                accrueSegmentBuffWindows(segments[segments.length - 1], name);
                accrueChainEffectWindows(segments[segments.length - 1], mi, name);
                accum.introDamage += introDmg;
                accum.damage      += introDmg;
                accum.time        += introTime;
                cursor            += introTime;
                creditTraceToLedger(introResult, mi);
            }

            // ── Member's own rotation ─────────────────────────────────────────
            // Strip any manually-placed Intro/Outro step here — those casts
            // are accounted for exclusively by the auto-injected segments
            // above/below, so keeping them would double-count the damage.
            const teamBuild = withoutAutoCastSteps(build, dataset);
            if (teamBuild.rotation?.length) {
                // Team-aware status gating (L2): statuses present at this point in
                // the team rotation (from earlier members, persisting) PLUS the
                // ones THIS member inflicts during its own window.
                const enemyTl = buildEnemyStatusTimeline(statusApplications);
                const present = enemyTl.presentStatusesAt(cursor);
                const enemyStatuses = new Set([...present, ...memberInflicts[mi]]);
                // Team-wide auras (L3) + the PREVIOUS member's incoming-resonator
                // transfer (e.g. a Wishes wielder's Snowfall Outro → +25% Glacio
                // DMG to whoever swaps in — gated on the prev member's own inflict).
                const prevIncoming = (handoffFired && prevReso) ? incomingResonatorContribution(prevBuild, dataset, prevReso) : null;
                // Distinct-applicator tier (Snow Rust-style): how many distinct
                // teammates have, by this point, inflicted a qualifying status —
                // counting earlier members from the shared timeline PLUS this
                // member itself if its own kit inflicts one (same "assume this
                // member's own inflicts apply for its whole window" approximation
                // as the enemyStatuses union above).
                const countDistinct = (statuses) => {
                    const set = distinctApplicators(statusApplications, statuses, cursor);
                    if (statuses.some(s => memberInflicts[mi].has(s))) set.add(build.resonatorId);
                    return set;
                };
                const ownTier = distinctApplicatorTierContribution(build.resonatorId, build.resonanceMode ?? null, countDistinct);
                const teamBuffs = mergeTeamBundles([externalTeamBuffs(mi), prevIncoming, ownTier]);

                // Havoc Bane DEF shred (L4): a teammate's Havoc Bane lowers enemy
                // DEF for everyone — fold the active stacks into target.defShred.
                const havocStacks = Math.min(HAVOC_BANE_MAX, enemyTl.statusStacksAt('havoc_bane', cursor));
                const memberTarget = havocStacks > 0 ? { ...target, defShred: havocStacks * HAVOC_BANE_PER_STACK } : target;

                // Derived opener (2026-07-12): pad or gate this pass's
                // consuming Liberations against the member's LIVE gauge —
                // see opener.js and the deriveOpeners param note.
                const opener = deriveOpeners ? deriveOpenerPadding({
                    rotation: teamBuild.rotation,
                    skillMap: effectiveSkillMap(dataset, build.resonatorId) ?? {},
                    dataset,
                    echoEnergyGain: memberEchoGain[mi],
                    echoCooldown: memberEchoCooldown[mi],
                    forteCap: dataset.forte?.[String(build.resonatorId)]?.cap ?? 0,
                    er: memberStats[mi].stats.energyRegen,
                    liberationCost: memberCost[mi],
                    gaugeStart: memberGauge[mi],
                }) : null;
                const simBuild = opener ? { ...teamBuild, rotation: opener.rotation } : teamBuild;

                // Conditional chain/inherent effects auto-resolve from the
                // rotation (trigger × window) — one resolution path for both sims.
                // externalBuffWindows: team-wide buff windows already live on the
                // team-buff timeline (earlier members/passes), shifted to this
                // segment's local time — literal team-time overlap.
                const simResult = simulateRotation({
                    build: simBuild, dataset, target: memberTarget, amplifyContext, enemyStatuses, teamBuffs,
                    externalBuffWindows: externalWindowsFor(build.resonatorId, cursor),
                });
                const rotTime   = simResult.totals.time;
                const rotDmg    = simResult.totals.damage;
                concertoGauge[mi] = Math.min(CONCERTO_MAX, concertoGauge[mi] + concertoGainOf(simResult));

                // Offset every step's timestamps by the current cursor
                const offsetSteps = simResult.steps.map(s => ({
                    ...s,
                    startTime: s.startTime + cursor,
                    endTime:   s.endTime   + cursor,
                }));
                if (opener) {
                    for (const idx of opener.fillerIndices) {
                        if (offsetSteps[idx]) offsetSteps[idx].openerFiller = true;
                    }
                    openerAdjustments.push({
                        resonatorId: build.resonatorId, pass,
                        insertions: opener.insertions, gated: opener.gated,
                        addedTime: opener.insertions.reduce((s, x) => s + x.addedTime, 0),
                    });
                }

                // Accrue this member's per-cast status applications onto the shared
                // timeline (L1) so subsequent members see them persist. For statuses
                // with their own DMG-on-stack mechanic (Glacio Chafe — L4), each
                // application is its own damage instance scaled to the stack count
                // it produces, credited to whichever resonator applied that stack
                // (docs/NEGATIVE-STATUS-REFERENCE.md §4's "applicator" rule).
                for (const a of applicationsFromSteps(offsetSteps, memberInflicts[mi], build.resonatorId)) {
                    statusApplications.push(a);
                    if (!NEGATIVE_STATUS_DEFS[a.status]?.damageOnStack) continue;
                    const stackCount = buildEnemyStatusTimeline(statusApplications).statusStacksAt(a.status, a.t);
                    const nsDmg = computeNegativeStatusDamage({ status: a.status, stacks: stackCount, atkLv: a.applicatorLevel, target: memberTarget });
                    if (nsDmg > 0) {
                        const applicatorIdx = occupied.findIndex(s => s.build.resonatorId === a.applicatorId);
                        if (applicatorIdx >= 0) {
                            memberAcc[applicatorIdx].statusDmg += nsDmg;
                            memberAcc[applicatorIdx].damage    += nsDmg;
                        }
                    }
                }

                segments.push({
                    slotIndex:     slot.slotIndex,
                    resonatorId:   build.resonatorId,
                    resonatorName: name,
                    buildId:       build.id,
                    kind:          'rotation',
                    pass,
                    startTime:     cursor,
                    endTime:       cursor + rotTime,
                    damage:        rotDmg,
                    steps:         offsetSteps,
                    simResult,
                    ...(opener ? { opener: { insertions: opener.insertions, gated: opener.gated } } : {}),
                });
                accrueSegmentBuffWindows(segments[segments.length - 1], name);
                accrueChainEffectWindows(segments[segments.length - 1], mi, name);
                // Incoming-resonator transfer DISPLAY (2026-07-15, closing the
                // "transfers are unrendered" gap): the Outro→Intro handoff
                // bundle (e.g. Wishes' "+25% Glacio DMG to the incoming
                // Resonator") is applied FLAT to this whole rotation by the
                // teamBuffs merge above — so its honest strips span exactly
                // this segment, in the RECEIVING member's own lane (it buffs
                // this member specifically, not the team). Display-only: never
                // accrued to the team-buff timeline (it's already applied),
                // never team-wide. Steps list it for tooltip transparency.
                if (prevIncoming) {
                    const entries = incomingDisplayEntries(prevIncoming, cursor, cursor + rotTime, prevReso?.name ?? '?');
                    if (entries.length) {
                        const list = memberStackedBuffWindows.get(build.resonatorId) ?? [];
                        list.push(...entries);
                        memberStackedBuffWindows.set(build.resonatorId, list);
                        for (const st of offsetSteps) {
                            for (const e of entries) (st.activeBuffNames ??= []).push(`${e.name} · from ${e.sourceName}`);
                        }
                    }
                }
                accum.damage    += rotDmg;
                accum.time      += rotTime;
                accum.stepCount += simResult.totals.stepCount;
                // Accumulate healing and shielding from this member's steps
                for (const step of simResult.steps) {
                    accum.heal   += step.stepHeal   ?? 0;
                    accum.shield += step.stepShield ?? 0;
                }
                cursor += rotTime;
                creditTraceToLedger(simResult, mi);
                // Record which off-field trigger categories this member has now
                // actually cast (not just "had a turn") — see firedTriggers above.
                for (const step of simResult.steps) {
                    const t = triggerOfSkillType(step.skillType);
                    if (t) firedTriggers[mi].add(t);
                }

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
                        target:        memberTarget,   // shares the window's Havoc Bane DEF shred
                        computeDamage,
                        memberStates:  offMemberStates,
                        firedTriggers: firedTriggers[oi],
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
                            pass,
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
            // Fires only on a FULL Concerto gauge (consumed by the cast); the
            // readiness is recorded per swap either way, and gates the segment
            // only under enforceConcerto (see param note).
            const hasNext = mi < occupied.length - 1 || pass < passCount - 1;
            if (hasNext) {
                const nextSlot = occupied[(mi + 1) % occupied.length];
                const ready = concertoGauge[mi] >= CONCERTO_MAX;
                concertoSwaps.push({
                    time: cursor, pass,
                    outgoingId: build.resonatorId,
                    incomingId: nextSlot.build.resonatorId,
                    gauge: Math.round(concertoGauge[mi] * 10) / 10,
                    ready,
                });
                if (ready) concertoGauge[mi] = 0;   // the handoff consumes it
                prevSwapReady = ready;

                if (!enforceConcerto || ready) {
                    // The Outro plays IN PARALLEL with the incoming member's
                    // Intro Skill (both animations run concurrently on
                    // swap), not before it — so it must not push the shared
                    // cursor forward; only the following Intro's own cast
                    // time advances the timeline (maintainer-directed
                    // 2026-07-12). The segment keeps its own OUTRO_CAST_TIME-
                    // wide display window (a real block on the timeline
                    // chart), it just overlaps the next Intro segment
                    // instead of preceding it. `accum.time` (this member's
                    // own active-time tally) is left untouched for the same
                    // reason — the window isn't exclusively theirs.
                    segments.push({
                        slotIndex:     slot.slotIndex,
                        resonatorId:   build.resonatorId,
                        resonatorName: name,
                        buildId:       build.id,
                        kind:          'outro',
                        pass,
                        startTime:     cursor,
                        endTime:       cursor + OUTRO_CAST_TIME,
                        damage:        0,          // Outro skills have no damage params
                        steps:         [],
                        simResult:     null,
                    });
                    accrueChainEffectWindows(segments[segments.length - 1], mi, name);
                    firedTriggers[mi].add('outro');
                }
            }
        }
    }

    // ── 3. Aggregate totals ───────────────────────────────────────────────────
    const totalDamage   = memberAcc.reduce((s, m) => s + m.damage, 0);
    const totalOffField = memberAcc.reduce((s, m) => s + m.offFieldDmg, 0);
    const totalStatusDmg = memberAcc.reduce((s, m) => s + m.statusDmg, 0);
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
    // memberStackedBuffWindows (stack-aware TEAM-TIME windows for the UI) is
    // accrued in-loop per segment (accrueSegmentBuffWindows) — the SAME
    // extraction feeds the team-buff timeline, so display and cross-member
    // damage credit can never disagree. The echo shield aura needs no special
    // handling here anymore: it's a normal window from the wielder's own sim
    // (computeBuffWindows' synthetic echo buff), and receivers get it (plus
    // per-step activeBuffNames) via their externalBuffWindows.

    // ── 4b. Cooldown overlay (2026-07-12) — re-annotate each member's steps
    // in TEAM time so group timers persist across passes and swap gaps (the
    // per-segment annotation inside simulateRotation can't see either; this
    // overwrites it on the team-time step copies). Diagnostic only — never
    // changes damage/time.
    const cooldownViolations = [];
    for (const [rid, steps] of memberSteps) {
        const ms = memberStats.find(m => m.build.resonatorId === rid);
        const slot0 = ms?.build.echoes?.[0];
        const echoDef = slot0 ? dataset.echoes?.find(e => e.id === slot0.id) : null;
        const v = annotateStepCooldowns(steps, {
            skillMap: effectiveSkillMap(dataset, rid) ?? {},
            echoCooldown: echoDef?.activeSkill?.cooldown ?? null,
        });
        for (const x of v) cooldownViolations.push({ resonatorId: rid, ...x });
    }

    // ── 5. Team energy (P13) — per-member Resonance Energy over the team
    // timeline: own casts + the off-field 50% share of the active member's
    // generation, each scaled by the member's OWN ER. Informational only —
    // never gates damage (P11.5 invariant).
    const energyEvents = collectEnergyEvents(segments);
    const memberEnergy = new Map();
    for (const ms of memberStats) {
        const rid = ms.build.resonatorId;
        const liberationCost = dataset.baseStats?.[String(rid)]?.energyMax ?? null;
        const er = ms.stats.energyRegen;
        memberEnergy.set(rid, {
            er, liberationCost,
            trace: accumulateEnergy(energyEvents.get(rid) ?? [], { er, liberationCost }),
        });
    }

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
        totals: {
            damage:       totalDamage,
            offFieldDmg:  totalOffField,
            statusDmg:    totalStatusDmg,
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
 * Team-TIME, stack-aware buff windows per member (2026-07-14) — the data the
 * UI needs to plot a stacking sonata buff's real ramp/decay on the team
 * timeline, instead of memberBuffWindows' flat boolean-presence blocks.
 *
 * Each team-sim segment already carries BOTH a team-time-shifted `steps`
 * array AND the original `simResult` (with sim.js's rich, LOCAL-time
 * `buffWindows[*].stacksByStepIndex`) — `seg.steps[i]` and
 * `seg.simResult.steps[i]` are the same step, index-aligned, shifted by the
 * constant `seg.startTime` (team-sim.js always builds `seg.steps` as
 * `simResult.steps.map(s => ({...s, startTime: s.startTime + cursor, ...}))`
 * — see the intro/rotation segment construction above). So a rich window's
 * LOCAL [start,end] converts to TEAM time by adding that same shift, and its
 * per-step stack count (windowStacksAtStep, sim.js — the SAME function that
 * already drives damage scaling, so display can never disagree with damage)
 * converts to a team-time sample by pairing it with `seg.steps[i]`.
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
 * @param {object} seg — one TeamSimResult segment (must carry simResult)
 * @returns {Array<{name, sonataName, trigger, bonusPct, bonusKind, element,
 *   dmgType, maxStacks, start, end, teamWide, raw,
 *   samples:Array<{start,end,stacks}>}>}
 */
function stackedWindowsForSegment(seg) {
    const rich = seg.simResult?.buffWindows;
    const localSteps = seg.simResult?.steps;
    if (!rich?.length || !localSteps?.length) return [];
    const shift = seg.startTime;
    const lastLocalEnd = localSteps[localSteps.length - 1].endTime;
    const list = [];
    for (const w of rich) {
        if (w.external) continue;   // received from a teammate — not ours to emit
        if (!(w.bonusPct > 0)) continue;
        // TEAM-WIDE tag (2026-07-15): a buff whose recipient is the whole
        // team ("ATK of all party members") reaches every member — the UI
        // renders it in a shared team-wide lane, and the team-buff timeline
        // schedules it into later segments. Structurally-tagged windows (the
        // echo team buff) carry the flag; parsed sonata buffs are classified
        // from the same raw text the timeline distribution uses.
        const teamWide = w.teamWide ?? isTeamWideBuff(w.raw ?? '');
        const samples = localSteps.map(s => ({
            start: s.startTime + shift, end: s.endTime + shift,
            stacks: windowStacksAtStep(w, s),
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
        let end = Math.min(w.end, lastLocalEnd);
        if (teamWide && w.end > lastLocalEnd + 1e-6) {
            samples.push({ start: lastLocalEnd + shift, end: w.end + shift, stacks: Math.max(lastStacks, 1) });
            end = w.end;
        }
        list.push({
            name: w.label, sonataName: w.sonataName, trigger: w.trigger,
            bonusPct: w.bonusPct, bonusKind: w.bonusKind, element: w.element, dmgType: w.dmgType,
            maxStacks: Math.max(0, ...samples.map(s => s.stacks)),
            start: w.start + shift, end: end + shift,
            samples,
            teamWide,
            raw: w.raw ?? '',
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
    const pct = (v) => { const p = v * 100; return p % 1 === 0 ? String(p) : p.toFixed(1); };
    const ELEMENT_NAMES = ['', 'Glacio', 'Fusion', 'Electro', 'Aero', 'Spectro', 'Havoc'];
    const DMG_TYPE_NAMES = { basic: 'Basic Attack', heavy: 'Heavy Attack', skill: 'Resonance Skill', liberation: 'Resonance Liberation', echo: 'Echo', intro: 'Intro Skill', outro: 'Outro Skill' };
    const parts = [];
    if (bundle.atkRatio > 0) parts.push({ name: `+${pct(bundle.atkRatio)}% ATK`, bonusPct: bundle.atkRatio, bonusKind: 'atk', element: null, dmgType: null });
    if (bundle.critRate > 0) parts.push({ name: `+${pct(bundle.critRate)}% Crit Rate`, bonusPct: bundle.critRate, bonusKind: 'crit', element: null, dmgType: null });
    if (bundle.critDmg > 0) parts.push({ name: `+${pct(bundle.critDmg)}% Crit DMG`, bonusPct: bundle.critDmg, bonusKind: 'crit', element: null, dmgType: null });
    for (const [el, v] of Object.entries(bundle.dmgByElement ?? {})) if (v > 0)
        parts.push({ name: `+${pct(v)}% ${ELEMENT_NAMES[el] ?? '?'} DMG`, bonusPct: v, bonusKind: 'element', element: Number(el), dmgType: null });
    for (const [t, v] of Object.entries(bundle.dmgBySkillType ?? {})) if (v > 0)
        parts.push({ name: `+${pct(v)}% ${DMG_TYPE_NAMES[t] ?? t} DMG`, bonusPct: v, bonusKind: 'unknown', element: null, dmgType: t });
    const amp = (bundle.amplifyAll ?? 0)
        + Object.values(bundle.amplifyByElement ?? {}).reduce((a, b) => a + b, 0)
        + Object.values(bundle.amplifyByType ?? {}).reduce((a, b) => a + b, 0);
    if (amp > 0) parts.push({ name: `+${pct(amp)}% DMG Amplify`, bonusPct: amp, bonusKind: 'amplify', element: null, dmgType: null });
    return parts.map(p => ({
        ...p, sourceName,
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
    let cur = null;
    for (const s of (samples ?? [])) {
        if ((s.stacks ?? 0) > 0) {
            if (cur && cur.stacks === s.stacks && Math.abs(cur.end - s.start) < 1e-6) cur.end = s.end;
            else { cur = { start: s.start, end: s.end, stacks: s.stacks }; runs.push(cur); }
        } else cur = null;
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

function simulateIntro(build, dataset, target, amplifyContext = null, externalBuffWindows = null) {
    const introKey = introKeyFor(dataset, build.resonatorId);
    if (!introKey) return null;
    const introBuild = { ...build, rotation: [introKey] };
    try {
        const result = simulateRotation({ build: introBuild, dataset, target, amplifyContext, externalBuffWindows });
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
            damage: 0, time: 0, dps: 0, memberCount: 0, passCount: 0,
        },
    };
}
