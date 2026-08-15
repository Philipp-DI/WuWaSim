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
const { simulateTeamRotation } = await import('../src/core/team-sim.js');
const { TARGET } = await import('../tools/optimize/sim-eval.js');
const { coveredCharacters } = await import('../tools/optimize/synergy-hints.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const d = JSON.parse(readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(root, 'data/wuwa-meta.json'), 'utf8'));
const referenceRotations = JSON.parse(readFileSync(resolve(root, 'data/reference-rotations.json'), 'utf8'));
d.statRanges = JSON.parse(readFileSync(resolve(root, 'data/stat-ranges.json'), 'utf8'))?.stat_ranges ?? {};

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── scoreTeam structure (curated Glacio Chafe team) ──────────────────────────
{
    const s = scoreTeam([1108, 1109, 1508], d);
    assert('scoreTeam returns a teamDamage', s && s.teamDamage > 0);
    assert('scoreTeam returns per-member breakdown', Array.isArray(s.perMember) && s.perMember.length === 3);

    // 2026-08-14: ONE sim, reported as the AVERAGE of its three passes.
    // ~~The card used a single no-opener pass while the bar used a separate
    // openers-ON multi-pass total.~~ Two measurements meant the bar could
    // disagree with the numbers beside it, which it visibly did. Recompute the
    // openers-ON 3-pass run directly and require the averages to match it
    // exactly — that is the whole contract.
    {
        const members = [1108, 1109, 1508];
        const builds = members.map(id => representativeMemberBuild(d.resonators.find(r => r.id === id), d));
        const byId = new Map(builds.map(b => [b.id, b]));
        const team = { slots: builds.map(b => b.id) };
        const rankingRun = simulateTeamRotation({ team, resolveBuild: (id) => byId.get(id) ?? null,
            dataset: d, target: TARGET, passCount: 3, deriveOpeners: true });
        const totalDamage = rankingRun.totals?.damage ?? 0;
        const totalTime = rankingRun.totals?.gameTime ?? 0;
        assert('scoreTeam.teamDamage is the openers-ON 3-pass damage, averaged per pass',
            Math.abs(s.teamDamage - totalDamage / 3) < 1e-6);
        assert('scoreTeam.teamTime is GAME time, averaged per pass',
            Math.abs(s.teamTime - totalTime / 3) < 1e-6);
        assert('scoreTeam.teamDps is total/total (identical to average/average)',
            Math.abs(s.teamDps - totalDamage / totalTime) < 1e-6);
        // The three marginals must ACCOUNT for the average, or the card's
        // "show your working" strip is decoration. Marginals (N − (N−1)) are
        // used precisely so post-hoc lanes — negative-status DoT, kit
        // afflictions, which belong to no single segment — cannot fall out.
        assert('passes reports one entry per pass', Array.isArray(s.passes) && s.passes.length === 3);
        assert('…and they sum to the 3-pass total (no lane dropped)',
            Math.abs(s.passes.reduce((sum, p) => sum + p.damage, 0) - totalDamage) < 3);
        assert('…and their times sum to the 3-pass game time',
            Math.abs(s.passes.reduce((sum, p) => sum + p.time, 0) - totalTime) < 0.05);
        // ~~Pass 1 carries the derived opener's cold start, so it must be the
        // slowest.~~ ~~There is no padding any more and the meter starts FULL,
        // so pass 1 is no LONGER than the rest.~~ Both readings are dead. A
        // resonator may now ship a CURATED opening pass (build.openerRotation),
        // and a real one is free to be longer than the loop — Chisa's arabwuwa
        // Rotation 1 is 11 steps against her 8-step loop, because it spends the
        // opening on charging Chainsaw Mode.
        //
        // What still has to hold is that the difference is EXPLAINED: pass 1
        // may differ only when some member actually authored a different
        // opening pass. No opener anywhere ⇒ no cold-start cost, which is the
        // property the padding retirement bought and the one worth locking.
        {
            const anyOpener = members.some(id =>
                (referenceRotations[String(id)]?.openerRotation ?? []).length > 0);
            assert('pass 1 costs no extra time unless a member authored an opening pass',
                anyOpener || s.passes[0].time <= s.passes[1].time + 1e-6);
        }
        assert('openerCredible is decided and boolean', typeof s.openerCredible === 'boolean');
        assert('rankingDamage is gone — there is only one measurement now',
            !('rankingDamage' in s));
    }
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
    // Hiyuki IS energy-gated (real energyMax 125, libCostKnown:true) — her
    // modeled team income credibly covers the cost, so she gets a REAL computed
    // team ER, not the gating-forced provisional fallback.
    assert('energy-gated Hiyuki gets a real (non-provisional) team ER', !s.erOverride['1108'].provisional);
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
//
// 2026-07-13 (maintainer-directed): the HEALER-only 'heal' objective was
// dropped — "healing is secondary, buffing/amping DMG is the primary focus
// of a support unit" — so substats now co-optimize against her own personal
// damage like every other role (the 4-cost Healing Bonus main + HP-scaling
// mains below are UNCHANGED: a separate, still-correct decision in
// templateStats()/scalingStatFor(), not the objective this pass touched).
{
    const baizhi = d.resonators.find(r => r.id === 1103);
    const build = representativeMemberBuild(baizhi, d);
    assert('HEALER 4-cost main is Healing Bonus (propId 35), not Crit DMG', build.echoes[0].mainStat.propId === 35);
    assert('HEALER 3/1-cost mains scale HP (scalingStatFor derived from her own heal rows)',
        build.echoes.slice(2).every(e => e.mainStat.propId === 10002));
    const allSubs = build.echoes.flatMap(e => e.subStats ?? []);
    assert('HEALER gets real (non-empty) co-optimized substats', allSubs.length > 0);
    assert('every substat slot is filled (25 total — the game never leaves one blank)', allSubs.length === 25);
    assert('HEALER substats now include Crit Rate/DMG (objective is personal damage, not heal)',
        allSubs.some(s => s.propId === 8) && allSubs.some(s => s.propId === 9));
}

// ── Team-context gear search (2026-07-13) — the Chisa/Kumokiri regression ───
// Maintainer spot-check: Chisa's meta build used Thunderflare Dominion (a
// 100% self-buffing weapon) over her signature Kumokiri, whose real payoff is
// a team-wide All-Attribute DMG Bonus at max stacks — invisible to the old
// solo-sim weapon pre-rank. Locks that the team-context search (metricOf)
// now picks it.
{
    const chisa = d.resonators.find(r => r.id === 1508);
    const build = representativeMemberBuild(chisa, d);
    const weapon = d.weapons.find(w => w.id === build.weapon?.id);
    assert('Chisa\'s team-context gear search picks Kumokiri (her team-wide-payoff signature), not a self-only weapon',
        weapon?.name === 'Kumokiri');
}

// ── Every covered resonator's summarized build has fully-resolved main AND
// sub stat NAMES — the direct client-facing contract (data/wuwa-meta.json's
// teams.memberBuilds, which the build page now defaults a fresh resonator's
// echoes from). A null name crashes the build editor's substat chips
// (`s.name.slice(...)`) the moment a fresh build reaches that recipe —
// 2026-08-04, Brant (an ER-scaling healer — his heal formula scales off
// Energy Regen, dataset.supportTable) rendered a blank/black window because
// his 'er' scaling stat fell through templateStats()/substatPool()'s
// atk/hp/def-only propId tables. Roster-wide, not just the 6 P12 anchors —
// that's exactly the gap that let this one through undetected before.
{
    for (const id of coveredCharacters()) {
        const resonator = d.resonators.find(r => r.id === id);
        if (!resonator) continue;
        const summary = summarizeMemberBuild(resonator, d);
        for (const echo of summary.echoes) {
            if (echo.mainStat) {
                assert(`${resonator.name}: main stat name resolved`, typeof echo.mainStat.name === 'string' && echo.mainStat.name.length > 0);
            }
            for (const sub of echo.subStats) {
                assert(`${resonator.name}: substat name resolved`, typeof sub.name === 'string' && sub.name.length > 0);
            }
        }
    }
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
