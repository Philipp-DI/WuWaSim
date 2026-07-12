/**
 * Forte-gauge extraction (Lever 2, 2026-07-11) — distills per-resonator Forte
 * data from the Arikatsu BinData dump into a small committed overlay
 * (data/forte-data.json) that preprocess.mjs merges into the skill map.
 *
 * Sources (all in docs/, GITIGNORED external dumps — this tool is the manual
 * "import" step, re-run when the dump updates; like tools/fetch-nanoka):
 *   docs/damage.json      — per damage instance: RateLv (rate vector),
 *                           Energy (Resonance ÷100), SpecialEnergy1-5 (Forte)
 *   docs/skill.json       — SkillGroupId (== resonator id), DamageList
 *   docs/baseproperty.json— per entity: SpecialEnergy{1..5}Max (the gauge CAP)
 *   docs/roleinfo.json    — PropertyId (== resonator id) → baseproperty link
 *   data/wuwa-data.json   — our damageTable (mults per damageId) + autoSkillMap
 *
 * Bridge: our `mults × 10000` == BinData `RateLv` (same game numbers). Match on
 * the full 20-level vector (highly unique) → read SpecialEnergy{channel} for
 * each of our damage instances → sum per skill key → per-cast Forte generation.
 * Absent/ambiguous matches are skipped (graceful: the greedy opener falls back
 * to its non-Forte behavior for those skills). See docs/forte-modeling-
 * investigation.md.
 *
 *   node tools/extract-forte.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
const first = (a) => Array.isArray(a) ? a[0] : (a ?? 0);

for (const f of ['docs/damage.json', 'docs/skill.json', 'docs/baseproperty.json']) {
    if (!existsSync(resolve(ROOT, f))) { console.error(`MISSING ${f} — cannot extract Forte data. Aborting (no output written).`); process.exit(1); }
}

const dmg = rd('docs/damage.json');
const skl = rd('docs/skill.json');
const baseProp = rd('docs/baseproperty.json');
const data = rd('data/wuwa-data.json');

// BinData damage instances indexed by character prefix (floor(Id/1e6)).
const binByChar = new Map();
for (const e of dmg) { if (e.Id < 1e6) continue; const c = Math.floor(e.Id / 1e6); (binByChar.get(c) ?? binByChar.set(c, []).get(c)).push(e); }
// SkillGroupId → the same char id (verified) — used only to sanity-check presence.
const groupIds = new Set(skl.map(s => s.SkillGroupId));
// baseproperty: first (lv1) entry per Id (== resonator id via roleinfo.PropertyId).
const capById = new Map();
for (const e of baseProp) if (!capById.has(e.Id)) capById.set(e.Id, e);

// Full-vector rate match: level-0 exact (±1), all sampled levels within 1% or ±2.
function matchInstance(mults, cands) {
    const t = mults.map(m => Math.round(m * 10000));
    for (const b of cands) {
        const rl = b.RateLv;
        if (!Array.isArray(rl) || rl.length < 20) continue;
        let ok = true;
        for (const lv of [0, 5, 10, 15, 19]) if (Math.abs(rl[lv] - t[lv]) > Math.max(2, t[lv] * 0.01)) { ok = false; break; }
        if (ok) return b;
    }
    return null;
}

const out = {};
let rosterInst = 0, rosterMatch = 0, charsWithForte = 0;
const report = [];

for (const id of Object.keys(data.autoSkillMap)) {
    const nid = +id;
    const dt = data.damageTable?.[id];
    const cands = binByChar.get(nid);
    if (!dt || !cands || !groupIds.has(nid)) continue;

    // Per-instance SpecialEnergy by our damageId (matched via rate vector).
    const seByDid = new Map();   // damageId → { se1, se2, se3 }
    let inst = 0, matched = 0;
    for (const it of dt) {
        inst++;
        const m = matchInstance(it.mults, cands);
        if (!m) continue;
        matched++;
        seByDid.set(it.id, { 1: first(m.SpecialEnergy1), 2: first(m.SpecialEnergy2), 3: first(m.SpecialEnergy3) });
    }
    rosterInst += inst; rosterMatch += matched;

    // Channel = the SpecialEnergy the char's abilities actually use most, with a
    // real (non-tiny) cap. Defaults SE3Max=100/SE4=6000/SE5=10000 are global.
    const cap = capById.get(nid);
    const usage = { 1: 0, 2: 0, 3: 0 };
    for (const v of seByDid.values()) for (const ch of [1, 2, 3]) if (v[ch] !== 0) usage[ch]++;
    let channel = null, best = 1;   // require ≥2 using hits and a cap ≥ 10 (excludes tiny counters like SE1Max=3)
    for (const ch of [1, 2, 3]) {
        const c = cap?.[`SpecialEnergy${ch}Max`] ?? 0;
        if (usage[ch] >= 2 && c >= 10 && usage[ch] > best - 1) { channel = ch; best = usage[ch]; }
    }
    if (channel == null) { report.push(`  ${id}: no Forte channel (usage ${JSON.stringify(usage)})`); continue; }
    const forteCap = cap[`SpecialEnergy${channel}Max`];

    // Per skill key: sum this channel's SpecialEnergy over the skill's matched
    // damage instances → per-cast Forte generation (kept only when non-zero).
    const gen = {};
    for (const key of Object.keys(data.autoSkillMap[id])) {
        if (key.startsWith('_')) continue;
        let g = 0, any = false;
        for (const did of (data.autoSkillMap[id][key].damageIds ?? [])) {
            const se = seByDid.get(did);
            if (se) { g += se[channel]; any = true; }
        }
        if (any && g !== 0) gen[key] = g;
    }
    if (Object.keys(gen).length === 0) { report.push(`  ${id}: channel ${channel} but no generating skills matched`); continue; }

    out[id] = { channel, cap: forteCap, gen };
    charsWithForte++;
    report.push(`  ${id}: ch${channel} cap${forteCap} — ${Object.keys(gen).length} gen skills (${matched}/${inst} inst matched)`);
}

writeFileSync(resolve(ROOT, 'data/forte-data.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`Forte extraction: ${charsWithForte} resonators with Forte data | roster rate-match ${rosterMatch}/${rosterInst} (${(100 * rosterMatch / rosterInst).toFixed(1)}%)`);
console.log(report.join('\n'));
console.log('Wrote data/forte-data.json');
