/**
 * Cast-time sensitivity analysis — see docs/cast-time-sensitivity-findings.md.
 *   node docs/cast-time-sensitivity.mjs
 *
 * Scores every unique meta team through the REAL ranking path
 * (representativeMemberBuild + simulateTeamRotation, 3-pass, openers ON),
 * holding member builds fixed (warmed once at baseline), and re-scores under
 * three ±20% cast-time error models applied to the sole cast-time source
 * (autoSkillMap[*][*].castTime). Compares rank orderings vs baseline.
 *
 * Not perturbed: ECHO_CAST_TIME (1.20s const, ~1 step/rotation). Game-data
 * windows (buff/off-field durations, state seconds) are NOT cast times and stay
 * fixed by design. VERDICT IS CONDITIONAL — cooldowns are diagnostic-only in the
 * current sim, so this cannot see cooldown-gated damage; see the findings doc.
 */

import { readFileSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');   // docs/ -> repo root
const imp = (p) => import(pathToFileURL(resolve(REPO, p)).href);

const [teamRank, teamSimMod, simEval] = await Promise.all([
    imp('tools/optimize/team-rank.js'),
    imp('src/core/team-sim.js'),
    imp('tools/optimize/sim-eval.js'),
]);
const { representativeMemberBuild } = teamRank;
const { simulateTeamRotation } = teamSimMod;
const { TARGET } = simEval;

const d = JSON.parse(readFileSync(resolve(REPO, 'data/wuwa-data.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(REPO, 'data/wuwa-meta.json'), 'utf8'));

// ── Collect unique teams from meta.teams.byCharacter ────────────────────────
const byChar = meta.teams.byCharacter;
const seen = new Set();
const teams = [];
for (const anchorId of Object.keys(byChar)) {
    for (const t of byChar[anchorId]) {
        const key = [...t.members].sort((a, b) => a - b).join('+');
        if (seen.has(key)) continue;
        seen.add(key);
        teams.push({ members: t.members.slice(), curated: !!t.curated, label: key });
    }
}
console.log(`unique teams from meta: ${teams.length}`);

// ── Lean scorer: the real ranking sim, builds held fixed (cache) ────────────
function leanScore(memberIds) {
    const builds = [];
    for (const id of memberIds) {
        const reso = d.resonators.find(r => r.id === id);
        if (!reso) return null;
        const b = representativeMemberBuild(reso, d);   // memoized after baseline warm
        if (!b.rotation.length) return null;
        builds.push(b);
    }
    const byId = new Map(builds.map(b => [b.id, b]));
    const team = { slots: builds.map(b => b.id) };
    const res = simulateTeamRotation({
        team, resolveBuild: (id) => byId.get(id) ?? null, dataset: d, target: TARGET,
        passCount: 3, deriveOpeners: true,
    });
    return { damage: res.totals?.damage ?? 0, time: res.totals?.time ?? 0, dps: res.totals?.dps ?? 0 };
}

// ── Cast-time slots (baseline snapshot) ─────────────────────────────────────
const slots = [];
const typeSet = new Set();
for (const id of Object.keys(d.autoSkillMap)) {
    for (const k of Object.keys(d.autoSkillMap[id])) {
        if (k.startsWith('_')) continue;
        const e = d.autoSkillMap[id][k];
        if (typeof e.castTime === 'number') { slots.push({ e, base: e.castTime, type: e.skillType }); typeSet.add(e.skillType); }
    }
}
console.log(`cast-time slots: ${slots.length}, skill types: ${[...typeSet].sort().join(',')}`);
const reset = () => { for (const s of slots) s.e.castTime = s.base; };
const applyUniform = (f) => { for (const s of slots) s.e.castTime = s.base * f; };
const applyPerType = (fbt) => { for (const s of slots) s.e.castTime = s.base * (fbt[s.type] ?? 1); };
const applyPerSkill = (rng) => { for (const s of slots) s.e.castTime = s.base * (0.8 + 0.4 * rng()); };

// ── Metrics ─────────────────────────────────────────────────────────────────
function ranksOf(values) {                       // 1 = highest
    const order = values.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const rank = new Array(values.length);
    order.forEach(([, i], r) => { rank[i] = r + 1; });
    return rank;
}
function spearman(a, b) {
    const ra = ranksOf(a), rb = ranksOf(b), n = a.length;
    let s = 0; for (let i = 0; i < n; i++) { const dd = ra[i] - rb[i]; s += dd * dd; }
    return 1 - (6 * s) / (n * (n * n - 1));
}
function topKset(values, labels, k) {
    return new Set(values.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]).slice(0, k).map(([, i]) => labels[i]));
}
function maxDisp(baseVals, pertVals) {
    const rb = ranksOf(baseVals), rp = ranksOf(pertVals);
    let m = 0; for (let i = 0; i < rb.length; i++) m = Math.max(m, Math.abs(rb[i] - rp[i]));
    return m;
}
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pct = (x) => (100 * x).toFixed(2);
const quantile = (arr, q) => { const s = [...arr].sort((a, b) => a - b); const p = (s.length - 1) * q; const lo = Math.floor(p), hi = Math.ceil(p); return s[lo] + (s[hi] - s[lo]) * (p - lo); };

// ── Baseline (warms the build cache) ────────────────────────────────────────
const t0 = Date.now();
reset();
const base = teams.map(t => ({ ...t, ...leanScore(t.members) })).filter(t => t.damage != null && t.damage > 0);
const labels = base.map(t => t.label);
const baseDmg = base.map(t => t.damage);
const baseDps = base.map(t => t.dps);
const baseTop5D = topKset(baseDmg, labels, 5);
const baseTop5P = topKset(baseDps, labels, 5);
const baseTopLabelD = labels[ranksOf(baseDmg).indexOf(1)];
console.log(`baseline: ${base.length} scorable teams in ${((Date.now() - t0) / 1000).toFixed(1)}s (per team ~${((Date.now() - t0) / base.length).toFixed(0)}ms)`);
console.log(`baseline #1 by damage: ${baseTopLabelD}`);

// ── Run a model → aggregate stats over trials ───────────────────────────────
function runTrials(name, makeTrial, N) {
    const spD = [], spP = [], t5D = [], t5P = [], dispD = [], top1D = [];
    const dmgPctAbs = [], dpsPctAbs = [];
    for (let tr = 0; tr < N; tr++) {
        makeTrial(tr);
        const pert = base.map(t => leanScore(t.members));
        reset();
        const pDmg = pert.map(p => p.damage), pDps = pert.map(p => p.dps);
        spD.push(spearman(baseDmg, pDmg));
        spP.push(spearman(baseDps, pDps));
        const p5D = topKset(pDmg, labels, 5), p5P = topKset(pDps, labels, 5);
        t5D.push([...baseTop5D].filter(x => p5D.has(x)).length / 5);
        t5P.push([...baseTop5P].filter(x => p5P.has(x)).length / 5);
        dispD.push(maxDisp(baseDmg, pDmg));
        top1D.push(labels[ranksOf(pDmg).indexOf(1)] === baseTopLabelD ? 1 : 0);
        for (let i = 0; i < base.length; i++) {
            dmgPctAbs.push(Math.abs(pDmg[i] - baseDmg[i]) / baseDmg[i]);
            dpsPctAbs.push(Math.abs(pDps[i] - baseDps[i]) / baseDps[i]);
        }
    }
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const min = (a) => Math.min(...a);
    const max = (a) => Math.max(...a);
    console.log(`\n== Model ${name}  (N=${N} trials) ==`);
    console.log(`  Spearman ρ  (damage-rank): mean ${mean(spD).toFixed(4)}  min ${min(spD).toFixed(4)}`);
    console.log(`  Spearman ρ  (DPS-rank)   : mean ${mean(spP).toFixed(4)}  min ${min(spP).toFixed(4)}`);
    console.log(`  Top-5 overlap (damage)   : mean ${(mean(t5D) * 100).toFixed(1)}%  worst ${(min(t5D) * 100).toFixed(0)}%`);
    console.log(`  Top-5 overlap (DPS)      : mean ${(mean(t5P) * 100).toFixed(1)}%  worst ${(min(t5P) * 100).toFixed(0)}%`);
    console.log(`  Max rank displacement    : mean ${mean(dispD).toFixed(2)}  worst ${max(dispD)} (of ${base.length})`);
    console.log(`  #1-by-damage unchanged   : ${(mean(top1D) * 100).toFixed(0)}% of trials`);
    console.log(`  |Δ damage| per team      : median ${pct(quantile(dmgPctAbs, 0.5))}%  p90 ${pct(quantile(dmgPctAbs, 0.9))}%  max ${pct(max(dmgPctAbs))}%`);
    console.log(`  |Δ DPS| per team         : median ${pct(quantile(dpsPctAbs, 0.5))}%  p90 ${pct(quantile(dpsPctAbs, 0.9))}%  max ${pct(max(dpsPctAbs))}%`);
}

// ── Model U: uniform sweep (deterministic control) ──────────────────────────
console.log('\n== Model U (uniform global scale) ==');
for (const f of [0.8, 0.9, 1.1, 1.2]) {
    applyUniform(f);
    const pert = base.map(t => leanScore(t.members));
    reset();
    const pDmg = pert.map(p => p.damage), pDps = pert.map(p => p.dps);
    const dmgPctAbs = pDmg.map((v, i) => Math.abs(v - baseDmg[i]) / baseDmg[i]);
    const dpsPctAbs = pDps.map((v, i) => Math.abs(v - baseDps[i]) / baseDps[i]);
    console.log(`  ×${f}: ρ_dmg ${spearman(baseDmg, pDmg).toFixed(4)}  ρ_dps ${spearman(baseDps, pDps).toFixed(4)}  ` +
        `top5_dmg ${([...baseTop5D].filter(x => topKset(pDmg, labels, 5).has(x)).length / 5 * 100).toFixed(0)}%  ` +
        `medΔdmg ${pct(quantile(dmgPctAbs, 0.5))}%  medΔdps ${pct(quantile(dpsPctAbs, 0.5))}%  maxΔdps ${pct(Math.max(...dpsPctAbs))}%`);
}

// ── Models T and S: Monte Carlo ─────────────────────────────────────────────
const types = [...typeSet];
const rngT = mulberry32(0xC0FFEE);
runTrials('T (per-type ±20%)', () => {
    const fbt = {}; for (const ty of types) fbt[ty] = 0.8 + 0.4 * rngT();
    applyPerType(fbt);
}, 24);

const rngS = mulberry32(0x1234567);
runTrials('S (per-skill ±20%)', () => { applyPerSkill(rngS); }, 24);

console.log(`\ntotal wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
