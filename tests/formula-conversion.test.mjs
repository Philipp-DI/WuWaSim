/**
 * Tests for the P13-fix-5 DATA-DRIVEN DMG-type classification
 * (tools/preprocess.mjs — resolveInstanceFormula + matchRowHits).
 *
 *   node tests/formula-conversion.test.mjs
 *
 * A row's formulaType (the DMG-bonus / amplify bucket + skill-level key) and
 * isEchoSkill flag are READ from the raw damage-type tag (`skill.damage[*].type`)
 * of the exact instances matchRowHits maps to each display row — no kit-text
 * regex. The mapping is: 0→basic 1→heavy 2→liberation 3→intro 4→skill; type 5
 * (Echo Skill DMG) sets isEchoSkill only (no Echo DMG-bonus bucket exists) and
 * keeps the row's mechanical baseFormula. The mechanical node skillType
 * (energy, cast, gating, multiplierUp) is unaffected — only the DMG-bonus
 * categorisation is data-sourced. Per-display-row matching resolves per-stage
 * conversions naturally (each stage is its own paramK → its own instances).
 *
 * This replaced the former "considered as X DMG" text parser, which mis-scoped
 * compound/staged conversions (confirmed wrong in-game by the maintainer on
 * Aemeath — showed Heavy when she deals Resonance Liberation DMG — and
 * Galbrena, whose Basic Attack Stage 1-3 are Heavy DMG while only Stage 4 is
 * Echo Skill DMG).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const d = JSON.parse(readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Count raw type=5 (Echo Skill DMG) damage instances for a character, straight
// from source — independent of the compiled dataset, so the isEchoSkill checks
// below cross-validate the pipeline rather than restating its own output.
function rawType5Count(cid) {
    const raw = JSON.parse(readFileSync(resolve(root, `data/extracted-nanoka/characters/${cid}.json`), 'utf8'));
    let n = 0;
    for (const node of Object.values(raw.skill_trees ?? {}))
        for (const e of Object.values(node.skill?.damage ?? {})) if (e.type === 5) n++;
    return n;
}
const echoRows = (cid) => Object.values(d.autoSkillMap[cid] ?? {}).filter(def => def.isEchoSkill === true).length;

// ── Aemeath (1210): the reported case ────────────────────────────────────────
// Her Seraphic Duet hits are tagged Resonance Liberation (type 2) in the data;
// mechanical skillType stays forte_heavy (only the DMG-bonus bucket moves).
{
    const sm = d.autoSkillMap['1210'];
    assert('Aemeath Seraphic Duet: Overture keeps mechanical skillType forte_heavy',
        sm.forte_heavy_seraphic_duet_overture.skillType === 'forte_heavy');
    assert('Aemeath Seraphic Duet: Overture reads formulaType liberation from data',
        sm.forte_heavy_seraphic_duet_overture.formulaType === 'liberation');
    assert('Aemeath Seraphic Duet: Encore reads formulaType liberation from data',
        sm.forte_heavy_seraphic_duet_encore.formulaType === 'liberation');
}

// ── Galbrena (1208): per-stage conversion resolved naturally ─────────────────
// Maintainer-confirmed in-game: Basic Attack Stage 1-3 are Heavy Attack DMG,
// ONLY Stage 4 is Echo Skill DMG; Volley of Death is Heavy Attack DMG. Each
// stage is its own display row → its own instances, so no staged text-parsing
// is needed. The former regex wrongly flagged Volley Stage 1/2 as Echo.
{
    const sm = d.autoSkillMap['1208'];
    assert('Galbrena BA Stage 1 → heavy (not echo)',
        sm.basic_basic_attack_1.formulaType === 'heavy' && sm.basic_basic_attack_1.isEchoSkill === false);
    assert('Galbrena BA Stage 3 → heavy (not echo)',
        sm.basic_basic_attack_3.formulaType === 'heavy' && sm.basic_basic_attack_3.isEchoSkill === false);
    assert('Galbrena BA Stage 4 → Echo Skill DMG (isEchoSkill, keeps mechanical basic)',
        sm.basic_basic_attack_4.isEchoSkill === true && sm.basic_basic_attack_4.formulaType === 'basic');
    assert('Galbrena Volley of Death Stage 1 → heavy, NOT echo (old-regex false-positive fixed)',
        sm.heavy_volley_of_death_1.formulaType === 'heavy' && sm.heavy_volley_of_death_1.isEchoSkill === false);
}

// ── Canonical reclassifications preserved, now data-sourced ──────────────────
{
    // Carlotta's Liberation deals Resonance Skill DMG (type 4).
    assert('Carlotta Liberation reads formulaType skill',
        d.autoSkillMap['1107'].liberation.formulaType === 'skill');
    // Phoebe's Skills deal Basic Attack DMG (type 0).
    assert('Phoebe Skill reads formulaType basic',
        d.autoSkillMap['1506'].skill_chamuel_s_star_1.formulaType === 'basic');
    // Phrolova's Scarlet Coda is a Basic Attack dealing Resonance Skill DMG.
    assert('Phrolova Scarlet Coda reads formulaType skill',
        d.autoSkillMap['1608'].basic_scarlet_coda.formulaType === 'skill');
}

// ── isEchoSkill ↔ raw type=5 consistency (cross-validated against source) ────
// A character is flagged iff it actually deals Echo Skill DMG in the data.
// Cantarella's "considered as casting Echo Skill" is a mechanical cast trigger,
// NOT Echo Skill DMG (maintainer-confirmed) — she has zero type=5 instances and
// must NOT be flagged; the old regex wrongly flagged her.
{
    for (const [id, label] of [['1608', 'Phrolova'], ['1208', 'Galbrena'], ['1109', 'Lucilla'], ['1411', 'Qiuyuan'], ['1412', 'Sigrika']]) {
        assert(`${label} deals Echo Skill DMG in source → has ≥1 isEchoSkill row`,
            rawType5Count(id) > 0 && echoRows(id) > 0);
    }
    for (const [id, label] of [['1607', 'Cantarella'], ['1107', 'Carlotta']]) {
        assert(`${label} has no type=5 damage in source → zero isEchoSkill rows`,
            rawType5Count(id) === 0 && echoRows(id) === 0);
    }
}

// ── Roster-wide invariant: every formulaType is a recognized value ──────────
// 'echo' must NEVER be a formulaType (there is no Echo DMG-bonus bucket); it is
// carried only by the isEchoSkill flag. forte_heavy/outro/unknown appear only
// on pure-support stubs (no damage instance to type).
{
    const VALID = new Set(['basic', 'heavy', 'skill', 'liberation', 'intro', 'forte_heavy', 'outro', 'unknown']);
    let bad = 0, echoAsFormula = 0, total = 0;
    for (const sm of Object.values(d.autoSkillMap)) {
        for (const [k, def] of Object.entries(sm)) {
            if (k.startsWith('_') || !def.formulaType) continue;
            total++;
            if (!VALID.has(def.formulaType)) bad++;
            if (def.formulaType === 'echo') echoAsFormula++;
        }
    }
    assert('every formulaType roster-wide is one of the recognized values', bad === 0);
    assert('no row uses "echo" as a formulaType (isEchoSkill flag only)', echoAsFormula === 0);
    assert('probed a real number of skill entries', total > 900);
}

console.log(`\nformula-conversion: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
