/**
 * Drill-down for docs/cast-time-sensitivity-findings.md — WHICH teams are
 * cast-time-sensitive and WHY. Characterizes the Δdamage tail under uniform ×1.2
 * (longer casts) and separates the two mechanisms: opener GATE FLIPS (a
 * Liberation crossing MAX_FILLER_TIME) vs. smooth duration-bounded off-field
 * emitters.  node docs/cast-time-drilldown.mjs
 */
import { readFileSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(resolve(REPO, p)).href);
const [teamRank, teamSimMod, simEval] = await Promise.all([
    imp('tools/optimize/team-rank.js'), imp('src/core/team-sim.js'), imp('tools/optimize/sim-eval.js'),
]);
const { representativeMemberBuild } = teamRank;
const { simulateTeamRotation } = teamSimMod;
const { TARGET } = simEval;
const d = JSON.parse(readFileSync(resolve(REPO, 'data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(REPO, 'data/wuwa-meta.json'), 'utf8'));

const byChar = meta.teams.byCharacter, seen = new Set(), teams = [];
for (const a of Object.keys(byChar)) for (const t of byChar[a]) {
    const key = [...t.members].sort((x, y) => x - y).join('+');
    if (!seen.has(key)) { seen.add(key); teams.push({ members: t.members.slice(), curated: !!t.curated, label: key }); }
}
const nameOf = (id) => d.resonators.find(r => r.id === id)?.name ?? id;
const labelNames = (mem) => mem.map(nameOf).join(' + ');

function score(memberIds) {
    const builds = [];
    for (const id of memberIds) { const r = d.resonators.find(x => x.id === id); if (!r) return null; const b = representativeMemberBuild(r, d); if (!b.rotation.length) return null; builds.push(b); }
    const byId = new Map(builds.map(b => [b.id, b]));
    const res = simulateTeamRotation({ team: { slots: builds.map(b => b.id) }, resolveBuild: (id) => byId.get(id) ?? null, dataset: d, target: TARGET, passCount: 3, deriveOpeners: true });
    const gated = (res.openerAdjustments ?? []).reduce((s, a) => s + a.gated.length, 0);
    const added = (res.openerAdjustments ?? []).reduce((s, a) => s + a.addedTime, 0);
    return { damage: res.totals?.damage ?? 0, time: res.totals?.time ?? 0, dps: res.totals?.dps ?? 0, gated, added };
}

const slots = [];
for (const id of Object.keys(d.autoSkillMap)) for (const k of Object.keys(d.autoSkillMap[id])) {
    if (k.startsWith('_')) continue; const e = d.autoSkillMap[id][k]; if (typeof e.actionableAt === 'number') slots.push({ e, base: e.actionableAt });
}
const reset = () => { for (const s of slots) s.e.actionableAt = s.base; };
const apply = (f) => { for (const s of slots) s.e.actionableAt = s.base * f; };

reset();
const rows = teams.map(t => ({ ...t, b: score(t.members) })).filter(t => t.b && t.b.damage > 0);
apply(1.2);
for (const r of rows) r.p = score(r.members);
reset();

for (const r of rows) { r.dDmg = (r.p.damage - r.b.damage) / r.b.damage; r.dDps = (r.p.dps - r.b.dps) / r.b.dps; r.gateFlip = r.p.gated - r.b.gated; }

const fmt = (x) => (x >= 0 ? '+' : '') + (100 * x).toFixed(1) + '%';
console.log(`\n=== Top 12 teams by |Δdamage| under uniform ×1.2 (longer casts) ===`);
console.log(`(gated = # opener-gated Liberations base→pert; a flip is the cliff mechanism)\n`);
for (const r of [...rows].sort((a, b) => Math.abs(b.dDmg) - Math.abs(a.dDmg)).slice(0, 12)) {
    console.log(`Δdmg ${fmt(r.dDmg).padStart(7)}  Δdps ${fmt(r.dDps).padStart(7)}  gated ${r.b.gated}→${r.p.gated}${r.gateFlip ? '  <-- GATE FLIP' : ''}  addT ${r.b.added.toFixed(1)}→${r.p.added.toFixed(1)}s  ${r.curated ? '[curated] ' : ''}${labelNames(r.members)}`);
}

const flips = rows.filter(r => r.gateFlip !== 0);
const bigDmg = rows.filter(r => Math.abs(r.dDmg) > 0.05);
console.log(`\nteams with an opener GATE FLIP (±casts change which Libs are performable): ${flips.length} / ${rows.length}`);
console.log(`teams with |Δdamage| > 5%: ${bigDmg.length} / ${rows.length}`);
console.log(`of those >5%, how many are gate-flips: ${bigDmg.filter(r => r.gateFlip !== 0).length} / ${bigDmg.length}`);
console.log(`median |Δdamage| across all teams: ${(100 * [...rows].map(r => Math.abs(r.dDmg)).sort((a, b) => a - b)[Math.floor(rows.length / 2)]).toFixed(2)}%`);
