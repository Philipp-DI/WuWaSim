/**
 * P13 §10 — team ranking + meta team lookups.
 *
 *   node tests/team-rank.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { scoreTeam, rankTeams, representativeMemberBuild, summarizeMemberBuild } = await import('../tools/optimize/team-rank.js');
const { generateCandidates } = await import('../tools/optimize/team-enum.js');
const { suggestedTeamsFor, appearsInTeams, teamMemberBuildFor } = await import('../src/data/meta-loader.js');
const { setWeapon, setEcho, createBuild } = await import('../src/core/build.js');
const { resolveTotalStats } = await import('../src/core/stats.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const d = JSON.parse(readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(root, 'data/wuwa-meta.json'), 'utf8'));
d.statRanges = JSON.parse(readFileSync(resolve(root, 'data/stat-ranges.json'), 'utf8'))?.stat_ranges ?? {};

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── scoreTeam structure (curated Glacio Chafe team) ──────────────────────────
{
    const s = scoreTeam([1108, 1109, 1508], d);
    assert('scoreTeam returns a teamDamage', s && s.teamDamage > 0);
    assert('scoreTeam returns per-member breakdown', Array.isArray(s.perMember) && s.perMember.length === 3);
    assert('scoreTeam erOverride covers every member', [1108, 1109, 1508].every(id => s.erOverride[String(id)]));
    // §5a.2 / §10: honest team-context values carry NO safety margin — the
    // per-hit energy/Concerto data is exact, not estimated (maintainer
    // direction, 2026-07-10) — so recommended === minViable exactly. Members
    // whose modeled income can't credibly cover the cost (not energy-gated, or
    // unmodeled sources dominate) fall back to the provisional balanced target.
    for (const id of [1108, 1109, 1508]) {
        const e = s.erOverride[String(id)];
        if (e.provisional) {
            assert(`erOverride[${id}] provisional fallback is the balanced target`, e.minViable === 1.25 && e.recommended === 1.25);
        } else {
            assert(`erOverride[${id}] recommended === minViable (no margin)`, Math.abs(e.recommended - e.minViable) < 1e-9);
            assert(`erOverride[${id}] minViable in the credible band`, e.minViable >= 1.0 && e.minViable <= 1.8);
        }
    }
    // Hiyuki's Liberation is not energy-gated (libCostKnown:false) — she must
    // stay provisional, never a fabricated energy number.
    assert('non-energy-gated kit stays provisional', s.erOverride['1108'].provisional === true);
}

// ── rankTeams: deterministic, normalized, curated pinned first ───────────────
{
    const cands = generateCandidates(1108);
    const a = rankTeams(cands, d);
    const b = rankTeams(cands, d);
    assert('rankTeams is deterministic', JSON.stringify(a.map(x => x.members)) === JSON.stringify(b.map(x => x.members)));
    assert('scores are normalized to [0,1] with a 1.0 top', a.every(x => x.score >= 0 && x.score <= 1) && Math.abs(Math.max(...a.map(x => x.score)) - 1) < 1e-9);
    // curated teams pinned ahead of non-curated
    let seenNon = false, ok = true;
    for (const t of a) { if (!t.curated) seenNon = true; else if (seenNon) ok = false; }
    assert('curated teams are pinned ahead of sim-ranked alternatives', ok);
    assert('Hiyuki gets her curated Glacio Chafe team', a.some(t => t.curated && t.archetype === 'Glacio Chafe'));
}

// ── meta lookups ─────────────────────────────────────────────────────────────
{
    const teams = suggestedTeamsFor(meta, 1108);
    assert('suggestedTeamsFor returns Hiyuki teams', teams.length > 0);
    assert('first suggested team is curated (META pinned)', teams[0].curated === true);
    assert('uncovered char → empty suggestions', suggestedTeamsFor(meta, 99999).length === 0);

    // appearsIn: Lucilla appears in Hiyuki's curated team.
    const apps = appearsInTeams(meta, 1109);
    assert('appearsInTeams finds Lucilla in an anchor team', apps.length > 0 && apps.some(a => a.members.includes(1109)));
}

// ── Role-aware builds (2026-07-10): HEALER gets real, non-fabricated gear ───
// Baizhi (1103) carries the HEALER role tag. Before this fix, EVERY member
// (regardless of role) got the same fixed CR/CD/ATK%-heavy template — a
// healer whose own damage is negligible has no use for Crit DMG main or
// crit substats. This locks the concrete, verifiable correction.
{
    const baizhi = d.resonators.find(r => r.id === 1103);
    const build = representativeMemberBuild(baizhi, d);
    assert('HEALER 4-cost main is Healing Bonus (propId 35), not Crit DMG', build.echoes[0].mainStat.propId === 35);
    assert('HEALER 3/1-cost mains scale HP (scalingStatFor derived from her own heal rows)',
        build.echoes.slice(2).every(e => e.mainStat.propId === 10002));
    const allSubs = build.echoes.flatMap(e => e.subStats ?? []);
    assert('HEALER gets real (non-empty) co-optimized substats (requires totals.heal to exist — sim.js fix)', allSubs.length > 0);
    assert('HEALER substats never include Crit Rate/DMG (her own damage doesn\'t matter — heal objective)',
        !allSubs.some(s => s.propId === 8 || s.propId === 9));
    assert('HEALER substats are predominantly HP-scaling', allSubs.every(s => s.propId === 2 || s.propId === 10002));
}

// ── Fidelity: the meta's stored recipe materializes to the SAME resolved
// stats summarizeMemberBuild reported — the core "1:1, no discrepancy" fix.
// Replicates loadTeamIntoSim's materialization logic directly against
// build.js (no UI/DOM dependency) so this is a pure regression lock.
{
    const carlotta = d.resonators.find(r => r.id === 1107);
    const summary = summarizeMemberBuild(carlotta, d);
    const recipe = teamMemberBuildFor(meta, 1107);
    assert('teamMemberBuildFor returns the same recipe summarizeMemberBuild embedded', JSON.stringify(recipe) === JSON.stringify(summary.recipe));

    let materialized = createBuild(carlotta);
    if (recipe.weaponId != null) materialized = setWeapon(materialized, recipe.weaponId);
    (recipe.echoes ?? []).forEach((e, i) => {
        materialized = setEcho(materialized, i, {
            id: e.id, cost: e.cost, level: 25, sonataId: recipe.sonataId,
            mainStat: e.mainStat, subStats: e.subStats ?? [],
        });
    });
    const resolved = resolveTotalStats(materialized, d);
    const r3 = (x) => Math.round((x ?? 0) * 1000) / 1000;
    assert('materialized recipe ATK matches the inspect panel exactly', Math.round(resolved.atk) === summary.stats.atk);
    assert('materialized recipe Crit Rate matches the inspect panel exactly', r3(resolved.critRate) === summary.stats.critRate);
    assert('materialized recipe Crit DMG matches the inspect panel exactly', r3(resolved.critDmg) === summary.stats.critDmg);
}

console.log(`\nteam-rank: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
