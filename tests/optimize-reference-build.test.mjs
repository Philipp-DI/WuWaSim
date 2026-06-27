/**
 * Tests for the P12 reference build / anchor (tools/optimize/reference-build.js).
 *
 *   node tests/optimize-reference-build.test.mjs
 *
 * Covers: rotation synthesis validity, template stat-set shape + realism,
 * sonata selection, full anchor construction, rotation/template reuse, and
 * determinism (same inputs → byte-identical build).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const {
    referenceBuild, synthesizeReferenceRotation, templateStats,
    standardSonatasFor, scalingStatFor, elementDmgProp,
} = await import('../tools/optimize/reference-build.js');
const { validateRotation } = await import('../src/core/rotation-graph.js');
const { rulesForResonator } = await import('../src/core/rotation-rules.js');
const { resolveTotalStats, PROP } = await import('../src/core/stats.js');
const { simulateRotation } = await import('../src/core/sim.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const SEED = [1107, 1108, 1304, 1205, 1506, 1607];
const target = { level: 90, atkLv: 90, resistances: {} };

// ── Rotation synthesis: valid + representative for every seed character ───────
for (const id of SEED) {
    const r = d.resonators.find(x => x.id === id);
    const rot = synthesizeReferenceRotation(r, d);
    const warns = validateRotation(rot, rulesForResonator(id), d.autoSkillMap[String(id)]);
    assert(`${r.name}: synthesized rotation is non-empty`, rot.length > 0);
    assert(`${r.name}: synthesized rotation has zero validateRotation warnings`, warns.length === 0);
    const map = d.autoSkillMap[String(id)];
    const hasType = (t) => rot.some(k => (map[k]?.skillType ?? map[k]?.formulaType ?? '').startsWith(t));
    assert(`${r.name}: rotation includes an Intro`, hasType('intro'));
    assert(`${r.name}: rotation includes a Liberation`, hasType('liberation'));
}

// ── Template stat-set: shape, cost layout, element-correct main ──────────────
for (const id of SEED) {
    const r = d.resonators.find(x => x.id === id);
    const tmpl = templateStats(r, d);
    assert(`${r.name}: template has 5 echoes`, tmpl.length === 5);
    assert(`${r.name}: cost layout is 4/3/3/1/1`, tmpl.map(e => e.cost).join('') === '43311');
    assert(`${r.name}: 4-cost main is Crit DMG`, tmpl[0].mainStat.propId === PROP.CRIT_DMG);
    assert(`${r.name}: a 3-cost main is this element's DMG bonus`,
        tmpl.some(e => e.cost === 3 && e.mainStat.propId === elementDmgProp(r.element)));
    assert(`${r.name}: every echo carries 5 substats`, tmpl.every(e => e.subStats.length === 5));
    assert(`${r.name}: all main stats resolved (no nulls)`, tmpl.every(e => e.mainStat && e.mainStat.value > 0));
}

// ── Anchor stat realism: crit well below 100% (so CR keeps weight, §4b) ───────
for (const id of SEED) {
    const r = d.resonators.find(x => x.id === id);
    const b = referenceBuild({ resonator: r, dataset: d, sequenceLevel: 0, sonataId: standardSonatasFor(r)[0] });
    const s = resolveTotalStats(b, d);
    assert(`${r.name}: effective Crit Rate is realistic (0.2 < CR < 0.95)`, s.critRate > 0.2 && s.critRate < 0.95);
    assert(`${r.name}: Crit DMG is substantial (> 2.0)`, s.critDmg > 2.0);
    assert(`${r.name}: Energy Regen in a plausible band (1.1 < ER < 1.6)`, s.energyRegen > 1.1 && s.energyRegen < 1.6);
    const sim = simulateRotation({ build: b, dataset: d, target });
    assert(`${r.name}: anchor produces nonzero damage`, sim.totals.damage > 0);
}

// ── Sonata selection: element-matching 5pc set ───────────────────────────────
{
    const carlotta = d.resonators.find(x => x.id === 1107);     // Glacio
    assert('Carlotta (Glacio) standard sonata is Freezing Frost (id 1)', standardSonatasFor(carlotta)[0] === 1);
    const jinhsi = d.resonators.find(x => x.id === 1304);        // Spectro
    assert('Jinhsi (Spectro) standard sonata is Celestial Light (id 5)', standardSonatasFor(jinhsi)[0] === 5);
    assert('scaling stat defaults to atk for the seed set', SEED.every(id => scalingStatFor(d.resonators.find(x => x.id === id)) === 'atk'));
}

// ── Anchor construction: chain level, echoes, sonata applied ─────────────────
{
    const r = d.resonators.find(x => x.id === 1107);
    const b = referenceBuild({ resonator: r, dataset: d, sequenceLevel: 4, sonataId: 1 });
    assert('anchor sets the requested sequence level', b.chain === 4);
    assert('anchor equips 5 echoes', b.echoes.filter(Boolean).length === 5);
    assert('every echo carries the requested sonata', b.echoes.every(e => e.sonataId === 1));
    assert('anchor rotation is populated', b.rotation.length > 0);
    assert('rotationMeta is index-aligned with rotation', b.rotationMeta.length === b.rotation.length);
}

// ── Reuse: passing rotation/template avoids resynthesis (and matches) ─────────
{
    const r = d.resonators.find(x => x.id === 1205);
    const rot = synthesizeReferenceRotation(r, d);
    const tmpl = templateStats(r, d);
    const b = referenceBuild({ resonator: r, dataset: d, sequenceLevel: 2, sonataId: 2, rotation: rot, template: tmpl });
    assert('reused rotation is carried through verbatim', b.rotation.join() === rot.join());
    assert('reused template main stats are carried through', b.echoes[0].mainStat.propId === tmpl[0].mainStat.propId);
}

// ── Determinism: same inputs → byte-identical build (modulo volatile fields) ──
{
    const r = d.resonators.find(x => x.id === 1304);
    const strip = (b) => { const { id, createdAt, updatedAt, ...rest } = b; return JSON.stringify(rest); };
    const a = referenceBuild({ resonator: r, dataset: d, sequenceLevel: 0, sonataId: 5 });
    const b = referenceBuild({ resonator: r, dataset: d, sequenceLevel: 0, sonataId: 5 });
    assert('anchor build is deterministic (ignoring id/timestamps)', strip(a) === strip(b));
}

console.log(`\noptimize-reference-build: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
