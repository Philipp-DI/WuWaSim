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

const { scoreTeam, rankTeams } = await import('../tools/optimize/team-rank.js');
const { generateCandidates } = await import('../tools/optimize/team-enum.js');
const { suggestedTeamsFor, appearsInTeams } = await import('../src/data/meta-loader.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const d = JSON.parse(readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(root, 'data/wuwa-meta.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── scoreTeam structure (curated Glacio Chafe team) ──────────────────────────
{
    const s = scoreTeam([1108, 1109, 1508], d);
    assert('scoreTeam returns a teamDamage', s && s.teamDamage > 0);
    assert('scoreTeam returns per-member breakdown', Array.isArray(s.perMember) && s.perMember.length === 3);
    assert('scoreTeam erOverride covers every member', [1108, 1109, 1508].every(id => s.erOverride[String(id)]));
    assert('erOverride recommended ≈ minViable (provisional solo)', Math.abs(s.erOverride['1108'].recommended - s.erOverride['1108'].minViable) < 1e-9);
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

console.log(`\nteam-rank: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
