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
 * SCOPE (this pass): ranks by honest team damage + heal/shield. TWO modeling
 * gaps make this insufficient for STATUS-SYNERGY teams (Glacio Chafe / Fusion
 * Burst / Tune Break) and are the next P13 prerequisites:
 *
 *   1. TEAM-LEVEL TRIGGERABILITY (the dominant gap). Each member's sim still
 *      gates status-conditional buffs by the member's OWN kit (P12
 *      triggerability.js). A teammate applying Glacio Chafe should un-gate the
 *      carry's Chafe-scaling buffs (Wishes sonata, Frostburn weapon). Until the
 *      team sim passes the team's UNION of inflicted statuses into each member's
 *      sim, the synergy is invisible — e.g. Hiyuki gains only ~2% in the curated
 *      Glacio Chafe team (outro buffs only), so the meta comp misranks below a
 *      generic high-DPS pairing. This must land before the meta team pass ships.
 *   2. SYNERGY-AWARE BUILDS. representativeMemberBuild uses the element sonata; a
 *      carry in a Chafe team wants the Chafe-scaling set/weapon. Build selection
 *      should be team-context-aware once (1) makes that gear pay off.
 *
 *   ER sweep (§5a.2) is ALSO deferred until team-energy sharing (off-field 50%)
 *   is modeled (PHASE0-ARCHITECTURE §5). Until then `erOverride` falls back to
 *   the solo balanced target (hard-req #3: never null), flagged `provisional`.
 *
 * Because of (1)/(2), this module is NOT yet wired into the meta team pass — it
 * is the ranking scaffold the synergy modeling will make trustworthy.
 */

import { createBuild, setChain, setEcho, setWeapon } from '../../src/core/build.js';
import { simulateTeamRotation } from '../../src/core/team-sim.js';
import { simulateRotation } from '../../src/core/sim.js';
import { resolveTotalStats } from '../../src/core/stats.js';
import {
    templateStats, representativeWeaponId, standardSonatasFor, curatedRotationFor, curatedModeFor, candidateWeaponsFor,
} from './reference-build.js';
import { TARGET } from './sim-eval.js';

// Balanced solo ER target (matches BALANCED_ER_TARGET in optimize.mjs) — the
// provisional erOverride fallback until the team-context sweep lands.
const BALANCED_ER_TARGET = 1.25;

// Deterministic per resonator → cache (called once per team per member).
const _memberBuildCache = new Map();

/**
 * A representative build for a team member: element sonata + the BEST 5★ weapon
 * of its type (picked by a quick solo sim so the weapon's element/passive count,
 * not just raw base ATK) + the fixed template stats + the member's curated
 * rotation and resonance mode. Deterministic + memoized; every member is built on
 * the same neutral basis so the team ranking compares COMPOSITIONS fairly.
 */
export function representativeMemberBuild(resonator, dataset) {
    if (_memberBuildCache.has(resonator.id)) return _memberBuildCache.get(resonator.id);

    const sonataId = standardSonatasFor(resonator)[0] ?? null;
    const template = templateStats(resonator, dataset);
    const rotation = curatedRotationFor(resonator.id) ?? [];
    const mode = curatedModeFor(resonator.id);

    let base = setChain(createBuild(resonator), 0);
    template.forEach((echo, i) => {
        base = setEcho(base, i, { id: null, cost: echo.cost, level: 25, mainStat: echo.mainStat, subStats: echo.subStats, sonataId });
    });
    base = { ...base, id: resonator.id, resonanceMode: mode, rotation, rotationMeta: rotation.map(() => ({})) };

    // Weapon by SIM (element + passive aware), falling back to highest base ATK.
    let bestWid = representativeWeaponId(resonator, dataset), bestDmg = -1;
    if (rotation.length) {
        for (const wid of candidateWeaponsFor(resonator, dataset)) {
            const dmg = simulateRotation({ build: setWeapon(base, wid), dataset, target: TARGET }).totals.damage;
            if (dmg > bestDmg + 1e-6) { bestDmg = dmg; bestWid = wid; }
        }
    }
    const build = bestWid != null ? setWeapon(base, bestWid) : base;
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
    // Provisional ER override (solo balanced) — replaced by the team sweep later.
    const erOverride = Object.fromEntries(memberIds.map(id => [String(id), {
        minViable: BALANCED_ER_TARGET, recommended: BALANCED_ER_TARGET, provisional: true,
    }]));

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
 * build the ranking used) — weapon, sonata, mode, resolved stats, echo mains,
 * and the rotation. Stored once per member in the meta so the UI can show "show
 * me the build behind this number" rather than an opaque score.
 */
export function summarizeMemberBuild(resonator, dataset) {
    const b = representativeMemberBuild(resonator, dataset);
    const st = resolveTotalStats(b, dataset);
    const weapon = dataset.weapons?.find(w => w.id === b.weapon?.id) ?? null;
    const sonataId = b.echoes?.[0]?.sonataId ?? null;
    const sonata = dataset.sonatas?.find(s => s.id === sonataId) ?? null;
    const r3 = (x) => Math.round((x ?? 0) * 1000) / 1000;
    return {
        name: resonator.name,
        element: resonator.element,
        weaponId: b.weapon?.id ?? null,
        weaponName: weapon?.name ?? null,
        sonataId,
        sonataName: sonata?.name ?? null,
        mode: b.resonanceMode ?? null,
        rotation: b.rotation ?? [],
        stats: { atk: Math.round(st.atk), critRate: r3(st.critRate), critDmg: r3(st.critDmg), energyRegen: r3(st.energyRegen) },
        echoes: (b.echoes ?? []).map(e => ({
            cost: e.cost,
            mainStat: e.mainStat ? { propId: e.mainStat.propId, value: e.mainStat.value, isPercent: e.mainStat.isPercent } : null,
        })),
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
