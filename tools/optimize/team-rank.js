// tools/optimize/team-rank.js
/**
 * P13 §5 — team ranking (sim-based).
 *
 * Scores a candidate team by running the real team sim (team-sim.js) on
 * representative per-member builds, each using its curated reference rotation +
 * resonance mode (synergy-hints.js CURATED_TEAMS / reference-rotations.json). The
 * team sim already folds in outro-buff hand-offs and off-field damage, so the
 * total reflects the team's actual mechanical interactions, not a sum of solos.
 *
 * SCOPE: ranks by honest team damage + heal/shield, with the L1–L4 team-effect
 * model folded in by team-sim.js (shared enemy-status timeline, team-aware
 * status gating, team-wide buff propagation, Havoc Bane DEF shred,
 * incoming-resonator transfers). Wired into the meta team pass (optimize.mjs).
 *
 * ROLE-AWARE BUILDS (2026-07-10): representativeMemberBuild runs a real
 * search — candidateSonatasFor (role-pruned: HEALER/BUFFER-tagged members
 * also get the real healing + team-amp sets) × candidateWeaponsFor, with
 * allocateSubstats co-optimizing REAL average-roll substats per sonata —
 * replacing the previous fixed, always-identical CR/CD/ATK% template package.
 * The result is rendered into a real 5-echo substat layout
 * (allocationToEchoSubstats) with real echo ids (pickEchoId), so the build
 * persisted in the meta and the build materialized by "OPEN IN TEAM SIM" are
 * byte-identical.
 *
 * TEAM-CONTEXT GEAR SEARCH (2026-07-13, maintainer-directed): the weapon/
 * sonata pre-rank (metricOf) now scores candidates by TEAM total damage
 * against up to 2 real teammates (synergy-hints.js contextTeammatesFor —
 * curated teams first, else the highest tag-affinity partners), not a solo
 * sim. Fixes a confirmed bug (Chisa spot-check): a solo metric structurally
 * can't see a team-recipient mechanic (Kumokiri's max-stack All-Attribute DMG
 * Bonus; a support's team-amp sonata newly added to the pool above) — the
 * candidate whose ENTIRE value is helping teammates always lost to a purely
 * self-buffing alternative, regardless of which was actually better for the
 * team. Context teammates use a cheap, non-recursive referenceBuild() (P12's
 * anchor pattern) — not their own representativeMemberBuild, which would
 * recurse. Falls back to solo scoring only for isolated characters with no
 * tag-derived affinity at all (never a regression — they'd have gotten a
 * solo number before too). Substat co-optimization stays solo/own-damage:
 * team-wide set bonuses are flat, not substat-scaled, so this remains a fair
 * approximation without the cost of re-simulating the team per candidate
 * ROLL (that would be the "materially larger, separate capability" a true
 * team-DPS-uplift substat objective would need). Per maintainer direction,
 * the HEALER-role 'heal' substat/gear objective was ALSO dropped in favor of
 * personal damage uniformly ("healing is secondary, buffing/amping DMG is
 * the primary focus of a support unit") — a real DPS-Dealer-anchored team
 * context is what actually values a team-amp choice, not her own heal total.
 *
 * RANKING (2026-07-12, maintainer-directed): teams are scored on a MULTI-pass
 * sim (ENERGY_PASSES) with derived openers ON (src/core/opener.js) — the
 * cold-start pass counts, but a Liberation the gauge can't cover becomes real
 * filler time (or a gated cast), never free damage. This replaced the former
 * single-pass cold-start scoring, one confirmed reason generated teams were
 * out-ranking curated ones.
 *
 * TEAM-LEVEL ER (§5a.2): computed from the team energy model (team-energy.js —
 * own casts at per-hit generation + the off-field 50% share,
 * docs/energy-signal-findings.md). ~~On a separate openers-OFF run, because
 * padding at the equipped ER would make every cast castable by construction and
 * destroy the breakpoint's meaning.~~ There is no padding any more, so that
 * hazard is gone; the gauge simply starts FULL and the requirement binds from
 * the SECOND pass. Energy is linear in a member's own ER, so
 * the minimum viable ER is closed-form, no iterative sweep. Evaluated at
 * STEADY STATE (liberations in the last of ENERGY_PASSES; the cold-start first
 * cast is covered by the derived opener on the ranking side). With per-hit accounting (P13-fix 2026-07-02) most
 * energy-gated members land in a credible 1.3–1.8 band and get real overrides;
 * the fallback to the solo balanced target flagged `provisional` (hard-req #3:
 * never null; §13.5 never fabricate) remains for kits that aren't energy-gated
 * (Hiyuki/Lucilla) and for requirements beyond MAX_CREDIBLE_ER, where the
 * still-unmodeled enemy-dependent sources (damage taken, kill orbs — out of
 * scope by maintainer direction) and the Concerto/intro economy dominate.
 */

import { createBuild, setChain, setEcho, setWeapon, pickEchoId } from '../../src/core/build.js';
import { simulateTeamRotation } from '../../src/core/team-sim.js';
import { simulateRotation } from '../../src/core/sim.js';
import { resolveTotalStats } from '../../src/core/stats.js';
import { collectEnergyEvents, minViableEr } from '../../src/core/team-energy.js';
import { allocateSubstats, allocationToEchoSubstats } from '../../src/core/substat-allocate.js';
import {
    templateStats, representativeWeaponId, standardSonatasFor, candidateSonatasFor, curatedRotationFor, curatedOpenerFor, curatedModeFor,
    candidateWeaponsFor, scalingStatFor, referenceBuild,
} from './reference-build.js';
import { rolesOf, contextTeammatesFor } from './synergy-hints.js';
import { TARGET } from './sim-eval.js';

// Max rolls of any single stat when the result must be MATERIALIZABLE into a
// real 5-echo build: a stat can appear at most once per echo (5 echoes total),
// unlike suggested-build.js's solo-suggestion search (perStatCap 10), whose
// output is deliberately left as an unrolled substat TARGET, never a literal
// per-echo layout.
const MATERIALIZABLE_PER_STAT_CAP = 5;

// Balanced solo ER target (matches BALANCED_ER_TARGET in optimize.mjs) — the
// provisional erOverride fallback when no honest team-context number exists.
const BALANCED_ER_TARGET = 1.25;
// Passes for the steady-state energy evaluation: passes 0..n−2 warm the gauge,
// only last-pass liberations bind the requirement.
const ENERGY_PASSES = 3;
// The first pass that BINDS the ER requirement. Pass 0 is funded by the full
// meter every resonator enters with, so it can never bind; the target is
// therefore "can you rebuild a full meter within one loop", which is pass 1 —
// the second pass (maintainer-directed 2026-08-14). ~~Was ENERGY_PASSES - 1~~,
// i.e. only the LAST pass, which let a member coast on two passes of warm-up
// that a full start no longer gives them.
const ER_BINDING_PASS = 1;
// Above this, the modeled income (own casts + off-field 50%) is clearly not
// the real energy economy — no guide recommends ER anywhere near it — so the
// number would be dishonest advice. Fall back to provisional instead.
const MAX_CREDIBLE_ER = 1.8;

// Deterministic per resonator → cache (called once per team per member).
const _memberBuildCache = new Map();

// A cheap, NON-recursive stand-in build for a gear-search CONTEXT teammate
// (2026-07-13) — deliberately NOT representativeMemberBuild (which would
// recurse: A's context could include B, whose own search could include A).
// Uses reference-build.js's existing P12 anchor pattern (synthesized
// rotation, template stats, representative weapon) — good enough to make
// team-wide/off-field mechanics fire; this teammate's OWN gear quality isn't
// what's under test. Memoized (module-level, unbounded by team membership —
// same rationale as _memberBuildCache).
const _contextBuildCache = new Map();
function contextBuildFor(teammateId, dataset) {
    if (_contextBuildCache.has(teammateId)) return _contextBuildCache.get(teammateId);
    const resonator = dataset.resonators.find(resonator => resonator.id === teammateId);
    const roles = resonator ? rolesOf(teammateId) : [];
    const sonataId = resonator ? (candidateSonatasFor(resonator, dataset, roles)[0] ?? standardSonatasFor(resonator)[0] ?? null) : null;
    let build = null;
    if (resonator && sonataId != null) {
        try {
            // synthesizeReferenceRotation THROWS on a curated rotation with
            // validateRotation warnings (a data-quality gate, P12 §2a.1) —
            // this is the first caller that exercises referenceBuild()
            // roster-wide rather than only the P12 six, so a latent bad
            // curated entry (e.g. Denia's) surfaces here for the first time.
            // A context teammate is a nice-to-have, not load-bearing: treat
            // a throw as "unavailable for context" (metricOf falls back to
            // fewer teammates, or solo) rather than crashing the whole
            // optimizer run over one unrelated resonator's curation bug.
            build = { ...referenceBuild({ resonator: resonator, dataset, sequenceLevel: 0, sonataId }), id: teammateId };
        } catch { build = null; }
    }
    if (build && !build.rotation?.length) build = null;
    _contextBuildCache.set(teammateId, build);
    return build;
}

// Metric a candidate (sonata × weapon) is judged by: TEAM total damage with
// up to 2 real teammates present (contextTeammatesFor), not a solo sim — a
// team-recipient mechanic (Kumokiri's max-stack All-Attribute DMG Bonus, a
// support's team-amp sonata) is otherwise invisible to a solo number,
// structurally undervaluing exactly the gear whose entire point is helping
// teammates (2026-07-13, maintainer-confirmed via a Chisa/Kumokiri spot-
// check). Falls back to a solo sim only when the resonator has no tag-
// derived affinity/curated teammate at all — never regresses those cases,
// since they'd have gotten a solo number before too. A single pass (no
// derived openers) is enough for this RELATIVE ranking probe — the real,
// full-fidelity number comes later from scoreTeam.
function metricOf(build, dataset, target) {
    const teammates = contextTeammatesFor(build.id).map(id => contextBuildFor(id, dataset)).filter(Boolean);
    if (!teammates.length) {
        return simulateRotation({ build, dataset, target }).totals?.damage ?? 0;
    }
    const byId = new Map([[build.id, build], ...teammates.map(teammate => [teammate.id, teammate])]);
    const team = { slots: [build.id, ...teammates.map(teammate => teammate.id)] };
    const result = simulateTeamRotation({ team, resolveBuild: (id) => byId.get(id) ?? null, dataset, target, passCount: 1 });
    return result.totals?.damage ?? 0;
}

/**
 * A representative build for a team member: a REAL search over role-pruned
 * candidate sonatas (candidateSonatasFor — HEALER/BUFFER roles also get the
 * real healing + team-amp sets) × candidate weapons, scored by TEAM-CONTEXT
 * damage (metricOf, above) — not a solo number — with allocateSubstats
 * co-optimizing REAL average-roll substats against the resonator's OWN
 * damage (2026-07-13: "healing is secondary, buffing/amping DMG is the
 * primary focus of a support unit" — maintainer direction; a personal-damage
 * substat objective stays correct even for support roles since team-wide set
 * bonuses are flat, not substat-scaled). Rendered into a real 5-echo substat
 * layout with real echo ids — a build a player could actually equip, not a
 * fixed fabricated package. Deterministic + memoized per resonator (not per
 * team — see module header) so every team they appear in reuses one build.
 */
export function representativeMemberBuild(resonator, dataset) {
    if (_memberBuildCache.has(resonator.id)) return _memberBuildCache.get(resonator.id);

    const roles = rolesOf(resonator.id);
    const scaling = scalingStatFor(resonator, dataset, roles);
    const template = templateStats(resonator, dataset, roles);
    const rotation = curatedRotationFor(resonator.id) ?? [];
    // Optional curated opening pass — team-sim runs it for pass 0 only.
    const openerRotation = curatedOpenerFor(resonator.id) ?? [];
    const mode = curatedModeFor(resonator.id);

    let base = setChain(createBuild(resonator), 0);
    base = { ...base, id: resonator.id, resonanceMode: mode, rotation, rotationMeta: rotation.map(() => ({})), openerRotation };

    if (!rotation.length) {
        // No curated rotation → nothing to sim-search against; keep the old
        // fixed-template fallback (this member gets filtered out of any real
        // team by scoreTeam's rotation check anyway).
        template.forEach((echo, i) => {
            base = setEcho(base, i, { id: null, cost: echo.cost, level: 25, mainStat: echo.mainStat, subStats: echo.subStats, sonataId: null });
        });
        const wid = representativeWeaponId(resonator, dataset);
        const build = wid != null ? setWeapon(base, wid) : base;
        _memberBuildCache.set(resonator.id, build);
        return build;
    }

    const sonatas = candidateSonatasFor(resonator, dataset, roles);
    const sonataPool = sonatas.length ? sonatas : [standardSonatasFor(resonator)[0]].filter(Boolean);
    const weapons = candidateWeaponsFor(resonator, dataset);

    const withEchoes = (build, sonataId, subStatsPerEcho) => {
        let trial = build;
        template.forEach((echo, i) => {
            trial = setEcho(trial, i, {
                id: null, cost: echo.cost, level: 25, sonataId,
                mainStat: echo.mainStat, subStats: subStatsPerEcho ? subStatsPerEcho[i] : [],
            });
        });
        return trial;
    };

    let best = null;
    for (const sonataId of sonataPool) {
        // 1) Team-context weapon pre-rank at the fixed template (mirrors
        // suggested-build.js's cheap-prerank shape, now team-aware).
        let weaponId = null, bestMetric = -Infinity;
        const templateBuild = withEchoes(base, sonataId, null);
        for (const wid of weapons) {
            const metric = metricOf(setWeapon(templateBuild, wid), dataset, TARGET);
            if (metric > bestMetric + 1e-6) { bestMetric = metric; weaponId = wid; }
        }
        // 2) Co-optimize substats for (sonata × best weapon) — the fair
        // comparison (a set's own crit% shouldn't lose to a template already
        // saturated on the stat it provides). Substat allocation itself stays
        // solo/own-damage (team-wide set bonuses are flat, not substat-scaled
        // — see docstring), but the SONATA is then RANKED by team context
        // (2026-07-14): a team-amp set (Rejuvenating Glow's party-wide ATK)
        // raises the TEAM's damage, not the wielder's own, so ranking sonatas
        // by solo `alloc.damage` — as this did through 2026-07-13 — still
        // structurally lost every team-amp set to a personal-damage one. Only
        // the weapon pre-rank had been made team-aware; the outer sonata
        // choice hadn't. metricOf on the co-optimized build closes that.
        const strippedBuild = setWeapon(withEchoes(base, sonataId, null), weaponId);
        const alloc = allocateSubstats({
            baseBuild: strippedBuild, dataset, scaling, target: TARGET,
            perStatCap: MATERIALIZABLE_PER_STAT_CAP,
        });
        const teamMetric = metricOf(alloc.build, dataset, TARGET);
        if (!best || teamMetric > best.metric + 1e-6) {
            best = { sonataId, weaponId, counts: alloc.counts, metric: teamMetric };
        }
    }

    const perEchoSubstats = allocationToEchoSubstats(best.counts, scaling, dataset.statRanges, 5, 5, dataset.echoSubStats);
    let build = setWeapon(base, best.weaponId);
    const usedEchoIds = new Set();
    template.forEach((echo, i) => {
        const id = pickEchoId(dataset, best.sonataId, echo.cost, resonator.element, usedEchoIds);
        if (id != null) usedEchoIds.add(id);
        build = setEcho(build, i, {
            id, cost: echo.cost, level: 25, sonataId: best.sonataId,
            mainStat: echo.mainStat, subStats: perEchoSubstats[i],
        });
    });
    _memberBuildCache.set(resonator.id, build);
    return build;
}

/**
 * Score one candidate team (array of resonator ids) via the team sim.
 *
 * teamDamage/teamTime(gameTime)/teamDps/teamHeal/teamShield/perMember are the
 * AVERAGE OF THE THREE PASSES of the openers-ON multi-pass run — one number, one
 * sim, and the same one `rankTeams` scores the bar on. `passes` carries the
 * three marginals behind that average so the card can show its working.
 *
 * @returns {{ members:number[], teamDamage:number, teamTime:number, teamDps:number,
 *             teamHeal:number, teamShield:number,
 *             passes:Array<{pass,damage,time,dps}>, openerCredible:boolean,
 *             perMember:Array, erOverride:object,
 *             opener:Object<id,{shortfalls,requiredEr}> }}  // energy honesty detail
 *          or null when a member can't be built (missing rotation).
 */
export function scoreTeam(memberIds, dataset, target = TARGET) {
    const builds = [];
    for (const id of memberIds) {
        const resonator = dataset.resonators.find(resonator => resonator.id === id);
        if (!resonator) return null;
        const memberBuild = representativeMemberBuild(resonator, dataset);
        if (!memberBuild.rotation.length) return null;          // no curated rotation → can't rank honestly
        builds.push(memberBuild);
    }
    const byId = new Map(builds.map(memberBuild => [memberBuild.id, memberBuild]));
    const team = { slots: builds.map(memberBuild => memberBuild.id) };
    // Ranking sim (2026-07-12, maintainer-directed honesty pass): MULTI-pass
    // with derived openers ON — the cold-start pass is included but modeled
    // properly (a short gauge becomes real filler time / a gated cast, never
    // fabricated Liberation damage), and the later passes carry the settled
    // loop. This replaces the former single-pass cold-start scoring, which
    // silently credited uncastable Liberations at full value. Feeds ONLY
    // `rankingDamage` (which team) and the opener transparency detail below —
    // not the numbers shown on the card (see displayRun).
    const result = simulateTeamRotation({
        team, resolveBuild: (id) => byId.get(id) ?? null, dataset, target,
        passCount: ENERGY_PASSES, deriveOpeners: true,
    });
    // ── ONE SIM FAMILY, AVERAGED PER PASS (2026-08-14, maintainer-directed) ──
    //
    // ~~A separate no-opener single-pass `displayRun` produced the card's
    // numbers while `rankingDamage` produced its bar.~~ Two sims meant the bar
    // and the numbers could disagree in both directions, and they did: a card
    // reading 90% could out-DPS one reading 95%, which reads as a broken
    // calculator no matter how defensible each half is on its own.
    //
    // Now everything the card shows comes from THIS run, reported as the
    // AVERAGE of its passes rather than the cumulative total — a 3-pass sum is
    // not a number anyone can compare to a rotation they know. Averaging is
    // also what makes the multi-pass worth running: a buff that only pays from
    // pass 2 (a 35s sonata window, a carried gauge) is valued, while the
    // cold-start cost stays in the average instead of being dropped.
    //
    // PER-PASS FIGURES ARE MARGINALS — the N-pass total minus the (N−1)-pass
    // total — not per-segment sums. Damage lanes that accrue post-hoc over the
    // whole timeline (negative-status DoT, kit afflictions) belong to no single
    // segment, so summing segments would silently drop them; marginals cannot,
    // because every lane is inside both totals. They sum to the 3-pass total
    // exactly, which `passes` below is asserted on.
    const marginalRuns = [];
    for (let passes = 1; passes <= ENERGY_PASSES; passes++) {
        marginalRuns.push(passes === ENERGY_PASSES ? result : simulateTeamRotation({
            team, resolveBuild: (id) => byId.get(id) ?? null, dataset, target,
            passCount: passes, deriveOpeners: true,
        }));
    }
    const round2 = (x) => Math.round(x * 100) / 100;
    const passFigures = marginalRuns.map((run, index) => {
        const previous = index > 0 ? marginalRuns[index - 1] : null;
        const damage = (run.totals?.damage ?? 0) - (previous?.totals?.damage ?? 0);
        const time = (run.totals?.gameTime ?? 0) - (previous?.totals?.gameTime ?? 0);
        return { pass: index + 1, damage: Math.round(damage), time: round2(time),
                 dps: time > 0 ? Math.round(damage / time) : 0 };
    });

    const totalDamage = result.totals?.damage ?? 0;
    const totalTime = result.totals?.gameTime ?? 0;
    // The headline: one pass's worth. DPS is total/total, which is identical to
    // average/average — the ratio does not care that both were divided by 3.
    const teamTime = totalTime / ENERGY_PASSES;
    const perMember = (result.memberTotals ?? []).map(member => {
        const dmg = (member.damage + (member.introDamage ?? 0)) / ENERGY_PASSES;
        return {
            id: member.resonatorId,
            damage: dmg,
            dps: teamTime > 0 ? dmg / teamTime : 0,   // share of team DPS (same window)
            offFieldDmg: (member.offFieldDmg ?? 0) / ENERGY_PASSES,
            statusDmg: (member.statusDmg ?? 0) / ENERGY_PASSES,
            heal: (member.heal ?? 0) / ENERGY_PASSES,
            shield: (member.shield ?? 0) / ENERGY_PASSES,
        };
    });
    // ENERGY transparency for the meta. ~~How much filler time the cold start
    // cost each member, and any gated Liberations.~~ Neither exists any more:
    // the rotation runs as authored and the gauge starts FULL, so what is left
    // to report is the honest one — which members cannot pay for a cast at their
    // equipped ER, and the ER that would fix it.
    const openerByMember = {};
    for (const adjustment of result.openerAdjustments ?? []) {
        const entry = (openerByMember[String(adjustment.resonatorId)] ??= { shortfalls: 0, requiredEr: null });
        entry.shortfalls += (adjustment.shortfalls ?? []).length;
        if (adjustment.requiredEr != null) {
            entry.requiredEr = Math.max(entry.requiredEr ?? 0, adjustment.requiredEr);
        }
    }

    // Team-level ER override (§5a.2): steady-state closed form over the team
    // energy events. A separate multi-pass sim with openers OFF — padding
    // would make every Liberation castable by construction at the equipped
    // ER, destroying the breakpoint's meaning; unpadded, `minViableEr` stays
    // "the ER at which the authored rotation loops clean".
    const energyRun = simulateTeamRotation({
        team, resolveBuild: (id) => byId.get(id) ?? null, dataset, target, passCount: ENERGY_PASSES,
    });
    const events = collectEnergyEvents(energyRun.segments);
    const round3 = (x) => Math.round(x * 1000) / 1000;
    const erOverride = Object.fromEntries(memberIds.map(id => {
        const cost = dataset.baseStats?.[String(id)]?.energyMax ?? null;
        const { minViable, achievable } = minViableEr(events.get(id) ?? [], cost, { fromPass: ER_BINDING_PASS });
        if (!achievable || minViable > MAX_CREDIBLE_ER) {
            return [String(id), { minViable: BALANCED_ER_TARGET, recommended: BALANCED_ER_TARGET, provisional: true }];
        }
        const minimumEr = Math.max(1.0, minViable);          // ER cannot go below 100%
        // No safety margin: the per-hit energy/Concerto data behind minViableEr
        // is exact (data-driven, not estimated), so recommended === minViable.
        return [String(id), { minViable: round3(minimumEr), recommended: round3(minimumEr) }];
    }));

    // CAN THIS TEAM ACTUALLY PAY FOR ITS ROTATION? ~~A credible opener costs no
    // more than one rotation of the team it opens~~ — that bound measured the
    // derived filler, which no longer exists. The honest question left is
    // whether the rotation is FUNDED: every resonator now starts on a full
    // meter, so a shortfall means the build cannot rebuild its meter within a
    // loop, at any pass beyond the first.
    //
    // ~~A team is suggestable when at least ONE member funds their whole
    // rotation at their equipped ER.~~ Measured, that dropped 206 of 416 team
    // slots and cost FIVE anchors every suggestion they had — because under the
    // new model a shortfall is not a defect, it is the ordinary state of a build
    // that has not been geared for ER yet. The median requirement across the
    // pool is 1.33, which is a perfectly normal target.
    //
    // ~~Every member must be fundable within MAX_CREDIBLE_ER.~~ Also measured,
    // also wrong: that left 45 anchors of 56. Requiring a whole team to be
    // ER-solved before it may be SUGGESTED inverts what the suggestion is for —
    // the app is telling you what to build toward, and the ER target is part of
    // that answer, not a precondition for hearing it.
    //
    // So the filter drops only what no build can ever fix: a Liberation with
    // ZERO generation before it, where `requiredEr` is null because no
    // multiplier on zero reaches the cost. Everything else is playable at a
    // stated ER, and `requiredEr` is displayed alongside the flag.
    const openerCredible = memberIds.every(id => {
        const entry = openerByMember[String(id)];
        return !entry || entry.requiredEr != null;
    });

    return {
        members: memberIds.slice(),
        // Averages, not totals — see the marginal block above.
        teamDamage: totalDamage / ENERGY_PASSES,
        teamTime,
        teamDps: totalTime > 0 ? totalDamage / totalTime : 0,
        teamHeal: (result.totals?.heal ?? 0) / ENERGY_PASSES,
        teamShield: (result.totals?.shield ?? 0) / ENERGY_PASSES,
        // The three runs behind that average, so the card can show its working.
        passes: passFigures,
        openerCredible,
        perMember,
        erOverride,
        opener: openerByMember,
    };
}

/**
 * A compact, INSPECTABLE summary of a member's representative build (the exact
 * build the ranking used) — weapon, sonata, mode, resolved stats, and the
 * rotation. Stored once per member in the meta so the UI can show "show me
 * the build behind this number" rather than an opaque score.
 *
 * `echoes` carries the FULL recipe (real echo id + mainStat + the co-
 * optimized subStats, not just a mainStat label) so `recipe` below —
 * everything needed to materialize this exact build 1:1 — is not duplicated
 * data; recipe just re-shapes the same fields for direct build.js consumption.
 */
export function summarizeMemberBuild(resonator, dataset) {
    const memberBuild = representativeMemberBuild(resonator, dataset);
    const totals = resolveTotalStats(memberBuild, dataset);
    const weapon = dataset.weapons?.find(weapon => weapon.id === memberBuild.weapon?.id) ?? null;
    const sonataId = memberBuild.echoes?.[0]?.sonataId ?? null;
    const sonata = dataset.sonatas?.find(sonata => sonata.id === sonataId) ?? null;
    const round3 = (x) => Math.round((x ?? 0) * 1000) / 1000;
    // Carries `name` alongside propId/addType — the build editor's substat
    // chips (renderEchoSlotCard) key off `.name` for their abbreviation and
    // tooltip, same as every real user-picked substat (build-editor-v2.js's
    // echo picker always attaches it from dataset.echoSubStats); without it
    // they throw on `s.name.slice(...)`, which is exactly the "open in
    // editor" black-page bug (2026-07-11).
    const mainStatNameFor = (cost, propId, addType) =>
        (dataset.echoMainStats?.[String(cost)] ?? []).find(option => option.propId === propId && option.addType === addType)?.name ?? null;
    const echoes = (memberBuild.echoes ?? []).map(echo => ({
        id: echo?.id ?? null,
        cost: echo?.cost ?? null,
        mainStat: echo?.mainStat ? { propId: echo.mainStat.propId, addType: echo.mainStat.addType, name: echo.mainStat.name ?? mainStatNameFor(echo.cost, echo.mainStat.propId, echo.mainStat.addType), value: echo.mainStat.value, isPercent: echo.mainStat.isPercent } : null,
        subStats: (echo?.subStats ?? []).map(sub => ({ propId: sub.propId, addType: sub.addType, name: sub.name ?? null, value: sub.value, isPercent: sub.isPercent })),
    }));
    return {
        name: resonator.name,
        element: resonator.element,
        weaponId: memberBuild.weapon?.id ?? null,
        weaponName: weapon?.name ?? null,
        sonataId,
        sonataName: sonata?.name ?? null,
        mode: memberBuild.resonanceMode ?? null,
        rotation: memberBuild.rotation ?? [],
        // Optional; `[]` for the 55 resonators whose loop opens the fight too.
        openerRotation: memberBuild.openerRotation ?? [],
        stats: {
            atk: Math.round(totals.atk), critRate: round3(totals.critRate), critDmg: round3(totals.critDmg),
            energyRegen: round3(totals.energyRegen), healingBonus: round3(totals.healingBonus ?? 0),
        },
        echoes,
        // The exact recipe loadTeamIntoSim materializes — same fields as
        // `echoes`/`weaponId`/`sonataId`/`mode`/`rotation` above, shaped for
        // direct consumption so the "inspect" display and the materialized
        // build can never independently drift.
        recipe: { weaponId: memberBuild.weapon?.id ?? null, sonataId, mode: memberBuild.resonanceMode ?? null, rotation: memberBuild.rotation ?? [], openerRotation: memberBuild.openerRotation ?? [], echoes },
    };
}

/**
 * Rank candidate teams (from team-enum.generateCandidates) by the SAME number
 * the card displays — average per-pass DPS — normalizing the top to score 1.0.
 * Curated teams keep their flag/reason. Deterministic: stable sort with id
 * tie-break.
 *
 * THE BAR AND THE NUMBERS ARE ONE MEASUREMENT. ~~The bar was the openers-ON
 * multi-pass total damage while the card showed a no-opener single pass.~~ Both
 * halves were individually defensible and the pairing was not: the pool shipped
 * a 90% card out-DPSing a 95% one, which is indistinguishable from a broken
 * calculator. Scoring on `teamDps` — the figure the card headlines — makes
 * "higher DPS ⇒ longer bar" true by construction rather than by coincidence.
 *
 * @param {Array} candidates — [{ members, curated, archetype?, reason? }, …]
 * @returns {Array} ranked [{ members, score, teamDamage, teamTime, teamDps, passes, curated, archetype?, reason?, roles?, modes?, erOverride, perMember }]
 */
export function rankTeams(candidates, dataset, target = TARGET) {
    const scored = [];
    for (const cand of candidates) {
        const score = scoreTeam(cand.members, dataset, target);
        if (!score) continue;
        // No member can honestly open the fight → not a suggestable team (see
        // scoreTeam's openerCredible). CURATED teams are exempt: they are the
        // maintainer's assertion that the comp is real, and silently dropping
        // one because a DERIVED opener misjudged it would hide the finding
        // rather than report it.
        if (!score.openerCredible && !cand.curated) continue;
        scored.push({ ...cand, ...score });
    }
    const top = Math.max(0, ...scored.map(entry => entry.teamDps));
    for (const entry of scored) entry.score = top > 0 ? entry.teamDps / top : 0;
    // Curated (maintainer-authoritative known-good) teams pin first — the sim
    // does not yet fully model status-synergy DAMAGE (Snow Rust tiers, incoming
    // transfers, NS DoT), so raw-damage ranking under-rates these comps. The sim
    // score then orders the enumerated alternatives (and ties among curated).
    // Matches the spec's (c)→(a): curated knowledge defines WHICH teams; the sim
    // RANKS.
    scored.sort((teamA, teamB) => {
        if (teamA.curated !== teamB.curated) return teamA.curated ? -1 : 1;
        if (teamB.score !== teamA.score) return teamB.score - teamA.score;
        return teamA.members.join('+').localeCompare(teamB.members.join('+'));
    });
    return scored;
}
