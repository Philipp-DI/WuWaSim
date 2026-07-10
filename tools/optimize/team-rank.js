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
 * ROLE-AWARE BUILDS (2026-07-10): representativeMemberBuild now runs a real
 * search — candidateSonatasFor (role-pruned: HEALER-tagged members also get
 * the real healing sets) × candidateWeaponsFor, with allocateSubstats
 * co-optimizing REAL average-roll substats per sonata (objective='heal' for
 * HEALER roles, 'damage' otherwise) — replacing the previous fixed, always-
 * identical CR/CD/ATK% template package. The result is rendered into a real
 * 5-echo substat layout (allocationToEchoSubstats) with real echo ids
 * (pickEchoId), so the build persisted in the meta and the build materialized
 * by "OPEN IN TEAM SIM" are byte-identical.
 *
 * Remaining modeling gap: a true per-TEAM synergy-aware pick (e.g. matching a
 * support's amp-type sonata to the specific anchor's dominant damage-type
 * bucket) is deliberately deferred — it needs a real classifier over sonata
 * tier EFFECT TEXT (which sets amplify which damage type for teammates), a
 * separate, larger undertaking. This pass's role-awareness is per-RESONATOR
 * (cached across every team they appear in), not per-team.
 *
 * TEAM-LEVEL ER (§5a.2): computed from the team energy model (team-energy.js —
 * own casts at per-hit generation + the off-field 50% share,
 * docs/energy-signal-findings.md). Energy is linear in a member's own ER, so
 * the minimum viable ER is closed-form, no iterative sweep. Evaluated at
 * STEADY STATE (liberations in the last of ENERGY_PASSES; the cold-start first
 * cast is a player-managed pre-charge concern — consistent with the P12
 * mode-based ER posture). With per-hit accounting (P13-fix 2026-07-02) most
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
    templateStats, representativeWeaponId, standardSonatasFor, candidateSonatasFor, curatedRotationFor, curatedModeFor,
    candidateWeaponsFor, scalingStatFor,
} from './reference-build.js';
import { rolesOf, ROLE } from './synergy-hints.js';
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
// Above this, the modeled income (own casts + off-field 50%) is clearly not
// the real energy economy — no guide recommends ER anywhere near it — so the
// number would be dishonest advice. Fall back to provisional instead.
const MAX_CREDIBLE_ER = 1.8;

// Deterministic per resonator → cache (called once per team per member).
const _memberBuildCache = new Map();

// Metric a candidate (sonata × weapon) is judged by, matching the objective
// allocateSubstats optimizes against for the same role.
function metricOf(build, dataset, target, objective) {
    const totals = simulateRotation({ build, dataset, target }).totals;
    return objective === 'heal' ? (totals?.heal ?? 0) : (totals?.damage ?? 0);
}

/**
 * A representative build for a team member: a REAL search over role-pruned
 * candidate sonatas (candidateSonatasFor — HEALER roles also get the real
 * healing sets) × candidate weapons, with allocateSubstats co-optimizing REAL
 * average-roll substats per sonata (objective='heal' for HEALER roles,
 * 'damage' otherwise — a healer's own damage is often near-zero, so ranking
 * substats against it would be meaningless). Rendered into a real 5-echo
 * substat layout with real echo ids — a build a player could actually equip,
 * not a fixed fabricated package. Deterministic + memoized per resonator (not
 * per team — see module header) so every team they appear in reuses one build.
 */
export function representativeMemberBuild(resonator, dataset) {
    if (_memberBuildCache.has(resonator.id)) return _memberBuildCache.get(resonator.id);

    const roles = rolesOf(resonator.id);
    const objective = roles.includes(ROLE.HEALER) ? 'heal' : 'damage';
    const scaling = scalingStatFor(resonator, dataset, roles);
    const template = templateStats(resonator, dataset, roles);
    const rotation = curatedRotationFor(resonator.id) ?? [];
    const mode = curatedModeFor(resonator.id);

    let base = setChain(createBuild(resonator), 0);
    base = { ...base, id: resonator.id, resonanceMode: mode, rotation, rotationMeta: rotation.map(() => ({})) };

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
        let b = build;
        template.forEach((echo, i) => {
            b = setEcho(b, i, {
                id: null, cost: echo.cost, level: 25, sonataId,
                mainStat: echo.mainStat, subStats: subStatsPerEcho ? subStatsPerEcho[i] : [],
            });
        });
        return b;
    };

    let best = null;
    for (const sonataId of sonataPool) {
        // 1) Cheap weapon pre-rank at the fixed template (mirrors suggested-build.js).
        let weaponId = null, bestMetric = -Infinity;
        const templateBuild = withEchoes(base, sonataId, null);
        for (const wid of weapons) {
            const m = metricOf(setWeapon(templateBuild, wid), dataset, TARGET, objective);
            if (m > bestMetric + 1e-6) { bestMetric = m; weaponId = wid; }
        }
        // 2) Co-optimize substats for (sonata × best weapon) — the fair
        // comparison (a set's own crit% shouldn't lose to a template already
        // saturated on the stat it provides).
        const strippedBuild = setWeapon(withEchoes(base, sonataId, null), weaponId);
        const alloc = allocateSubstats({
            baseBuild: strippedBuild, dataset, scaling, target: TARGET, objective,
            perStatCap: MATERIALIZABLE_PER_STAT_CAP,
        });
        if (!best || alloc.damage > best.metric + 1e-6) {
            best = { sonataId, weaponId, counts: alloc.counts, metric: alloc.damage };
        }
    }

    const perEchoSubstats = allocationToEchoSubstats(best.counts, scaling, dataset.statRanges);
    let build = setWeapon(base, best.weaponId);
    template.forEach((echo, i) => {
        build = setEcho(build, i, {
            id: pickEchoId(dataset, best.sonataId, echo.cost, resonator.element),
            cost: echo.cost, level: 25, sonataId: best.sonataId,
            mainStat: echo.mainStat, subStats: perEchoSubstats[i],
        });
    });
    _memberBuildCache.set(resonator.id, build);
    return build;
}

/**
 * Score one candidate team (array of resonator ids) via the team sim.
 *
 * @returns {{ members:number[], teamDamage:number, teamHeal:number, teamShield:number,
 *             perMember:Array, erOverride:object }}
 *          or null when a member can't be built (missing rotation).
 */
export function scoreTeam(memberIds, dataset, target = TARGET) {
    const builds = [];
    for (const id of memberIds) {
        const reso = dataset.resonators.find(r => r.id === id);
        if (!reso) return null;
        const b = representativeMemberBuild(reso, dataset);
        if (!b.rotation.length) return null;          // no curated rotation → can't rank honestly
        builds.push(b);
    }
    const byId = new Map(builds.map(b => [b.id, b]));
    const team = { slots: builds.map(b => b.id) };
    const result = simulateTeamRotation({ team, resolveBuild: (id) => byId.get(id) ?? null, dataset, target });

    const teamTime = result.totals?.time ?? 0;
    const perMember = (result.memberTotals ?? []).map(m => {
        const dmg = m.damage + (m.introDamage ?? 0);
        return {
            id: m.resonatorId,
            damage: dmg,
            dps: teamTime > 0 ? dmg / teamTime : 0,   // share of team DPS (same window)
            offFieldDmg: m.offFieldDmg ?? 0,
            statusDmg: m.statusDmg ?? 0,
            heal: m.heal ?? 0,
            shield: m.shield ?? 0,
        };
    });
    // Team-level ER override (§5a.2): steady-state closed form over the team
    // energy events. A separate multi-pass sim so the 1-pass damage scoring
    // above is untouched; energy never gates damage either way.
    const energyRun = simulateTeamRotation({
        team, resolveBuild: (id) => byId.get(id) ?? null, dataset, target, passCount: ENERGY_PASSES,
    });
    const events = collectEnergyEvents(energyRun.segments);
    const round3 = (x) => Math.round(x * 1000) / 1000;
    const erOverride = Object.fromEntries(memberIds.map(id => {
        const cost = dataset.baseStats?.[String(id)]?.energyMax ?? null;
        const { minViable, achievable } = minViableEr(events.get(id) ?? [], cost, { fromPass: ENERGY_PASSES - 1 });
        if (!achievable || minViable > MAX_CREDIBLE_ER) {
            return [String(id), { minViable: BALANCED_ER_TARGET, recommended: BALANCED_ER_TARGET, provisional: true }];
        }
        const mv = Math.max(1.0, minViable);          // ER cannot go below 100%
        // No safety margin: the per-hit energy/Concerto data behind minViableEr
        // is exact (data-driven, not estimated), so recommended === minViable.
        return [String(id), { minViable: round3(mv), recommended: round3(mv) }];
    }));

    return {
        members: memberIds.slice(),
        teamDamage: result.totals?.damage ?? 0,
        teamTime,
        teamDps: result.totals?.dps ?? 0,
        teamHeal: result.totals?.heal ?? 0,
        teamShield: result.totals?.shield ?? 0,
        perMember,
        erOverride,
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
    const b = representativeMemberBuild(resonator, dataset);
    const st = resolveTotalStats(b, dataset);
    const weapon = dataset.weapons?.find(w => w.id === b.weapon?.id) ?? null;
    const sonataId = b.echoes?.[0]?.sonataId ?? null;
    const sonata = dataset.sonatas?.find(s => s.id === sonataId) ?? null;
    const r3 = (x) => Math.round((x ?? 0) * 1000) / 1000;
    const echoes = (b.echoes ?? []).map(e => ({
        id: e?.id ?? null,
        cost: e?.cost ?? null,
        mainStat: e?.mainStat ? { propId: e.mainStat.propId, addType: e.mainStat.addType, value: e.mainStat.value, isPercent: e.mainStat.isPercent } : null,
        subStats: (e?.subStats ?? []).map(s => ({ propId: s.propId, addType: s.addType, value: s.value, isPercent: s.isPercent })),
    }));
    return {
        name: resonator.name,
        element: resonator.element,
        weaponId: b.weapon?.id ?? null,
        weaponName: weapon?.name ?? null,
        sonataId,
        sonataName: sonata?.name ?? null,
        mode: b.resonanceMode ?? null,
        rotation: b.rotation ?? [],
        stats: {
            atk: Math.round(st.atk), critRate: r3(st.critRate), critDmg: r3(st.critDmg),
            energyRegen: r3(st.energyRegen), healingBonus: r3(st.healingBonus ?? 0),
        },
        echoes,
        // The exact recipe loadTeamIntoSim materializes — same fields as
        // `echoes`/`weaponId`/`sonataId`/`mode`/`rotation` above, shaped for
        // direct consumption so the "inspect" display and the materialized
        // build can never independently drift.
        recipe: { weaponId: b.weapon?.id ?? null, sonataId, mode: b.resonanceMode ?? null, rotation: b.rotation ?? [], echoes },
    };
}

/**
 * Rank candidate teams (from team-enum.generateCandidates) by team damage,
 * normalizing the top to score 1.0. Curated teams keep their flag/reason.
 * Deterministic: stable sort with id tie-break.
 *
 * @param {Array} candidates — [{ members, curated, archetype?, reason? }, …]
 * @returns {Array} ranked [{ members, score, teamDamage, curated, archetype?, reason?, roles?, modes?, erOverride, perMember }]
 */
export function rankTeams(candidates, dataset, target = TARGET) {
    const scored = [];
    for (const cand of candidates) {
        const s = scoreTeam(cand.members, dataset, target);
        if (!s) continue;
        scored.push({ ...cand, ...s });
    }
    const top = Math.max(0, ...scored.map(s => s.teamDamage));
    for (const s of scored) s.score = top > 0 ? s.teamDamage / top : 0;
    // Curated (maintainer-authoritative known-good) teams pin first — the sim
    // does not yet fully model status-synergy DAMAGE (Snow Rust tiers, incoming
    // transfers, NS DoT), so raw-damage ranking under-rates these comps. The sim
    // score then orders the enumerated alternatives (and ties among curated).
    // Matches the spec's (c)→(a): curated knowledge defines WHICH teams; the sim
    // RANKS. `score` stays the honest sim-damage signal for the UI bar.
    scored.sort((a, b) => {
        if (a.curated !== b.curated) return a.curated ? -1 : 1;
        if (b.score !== a.score) return b.score - a.score;
        return a.members.join('+').localeCompare(b.members.join('+'));
    });
    return scored;
}
