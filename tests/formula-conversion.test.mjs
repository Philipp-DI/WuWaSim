/**
 * Tests for the P13-fix-4 "considered as X DMG" fallback-path fix
 * (tools/preprocess.mjs parseDescConversions).
 *
 *   node tests/formula-conversion.test.mjs
 *
 * The whole-desc fallback (used whenever section-header matching can't
 * isolate a row's own text — e.g. a header carries a "Resonance Skill - "
 * prefix the row's display name lacks) scanned the RAW description with
 * HTML tags still in it. The game always wraps a reclassified type name in
 * `<color=Highlight>...</color>` ("considered <color=Highlight>Resonance
 * Liberation DMG</color>"), so the regex could never match whenever a row
 * fell through to this path — found via the maintainer's own in-game read
 * that Aemeath deals mostly Resonance Liberation damage, contradicting the
 * compiled data's `formulaType: heavy` for her Seraphic Duet hits.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── Aemeath (1210): the reported case ────────────────────────────────────────
// Her kit text: "cast Resonance Skill Seraphic Duet: Overture ... dealing
// Fusion DMG, considered <color=Highlight>Resonance Liberation DMG</color>."
// mechanical skillType stays forte_heavy (unaffected — only the DMG-bonus/
// amplify bucket moves, per the "considered as X DMG" invariant).
{
    const sm = d.autoSkillMap['1210'];
    assert('Aemeath Seraphic Duet: Overture is skillType forte_heavy (mechanics unchanged)',
        sm.forte_heavy_seraphic_duet_overture.skillType === 'forte_heavy');
    assert('Aemeath Seraphic Duet: Overture reclassifies to formulaType liberation',
        sm.forte_heavy_seraphic_duet_overture.formulaType === 'liberation');
    assert('Aemeath Seraphic Duet: Encore reclassifies to formulaType liberation',
        sm.forte_heavy_seraphic_duet_encore.formulaType === 'liberation');
    assert('Aemeath Tune Rupture Response - Starburst is untouched (not one of the 5 tracked types)',
        sm.forte_heavy_tune_rupture_response_starburst.formulaType === 'heavy');
}

// ── isEchoSkill recovery — matches the maintainer's own domain knowledge ────
// (named from memory before this fix existed, independently confirmed here).
{
    for (const [id, label] of [['1608', 'Phrolova'], ['1607', 'Cantarella'], ['1208', 'Galbrena'], ['1109', 'Lucilla']]) {
        const sm = d.autoSkillMap[id];
        const hasEcho = Object.values(sm).some(def => def.isEchoSkill === true);
        assert(`${label} has at least one isEchoSkill:true row`, hasEcho);
    }
    // Found independently during this investigation (kit text says "considered
    // Echo Skill DMG" too, just not named by the maintainer from memory).
    for (const [id, label] of [['1411', 'Qiuyuan'], ['1412', 'Sigrika']]) {
        const sm = d.autoSkillMap[id];
        const hasEcho = Object.values(sm).some(def => def.isEchoSkill === true);
        assert(`${label} has at least one isEchoSkill:true row`, hasEcho);
    }
    // A character with no Echo-Skill kit text must NOT be flagged.
    assert('Carlotta (no Echo Skill kit text) has zero isEchoSkill rows',
        !Object.values(d.autoSkillMap['1107']).some(def => def.isEchoSkill === true));
}

// ── Roster-wide invariant: the fix must be additive, never contradictory ───
// (locks the zero-regression finding from the pre-ship investigation: no
// row's formulaType should ever be an UNRECOGNIZED value).
{
    const VALID = new Set(['basic', 'heavy', 'skill', 'liberation', 'intro', 'midair', 'echo', 'outro', 'forte_heavy', 'unknown']);
    let bad = 0, total = 0;
    for (const sm of Object.values(d.autoSkillMap)) {
        for (const [k, def] of Object.entries(sm)) {
            if (k.startsWith('_') || !def.formulaType) continue;
            total++;
            if (!VALID.has(def.formulaType)) bad++;
        }
    }
    assert('every formulaType roster-wide is one of the recognized values', bad === 0);
    assert('probed a real number of skill entries', total > 900);
}

console.log(`\nformula-conversion: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
