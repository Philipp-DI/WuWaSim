/**
 * Tests for auto-triggered rotation actions (Phase 11 §7, §13).
 *
 *   node test/rotation-triggers.test.mjs
 *
 * Covers:
 *   - data integrity: every after/inserts key references a real autoSkillMap entry
 *   - a trigger proposes the correct follow-up at the right position
 *   - an already-present follow-up is not duplicated
 *   - non-trigger keys / unknown resonators propose nothing
 *   - build.rotationMeta tags the inserted step and stays aligned through edits
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
    TRIGGER_RULES, triggersForResonator, proposeTriggeredInsert,
} from '../src/core/rotation-triggers.js';
import {
    createBuild, appendRotationStep, removeRotationStep, moveRotationStep, setRotationMeta,
} from '../src/core/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── Data integrity: all keys reference real autoSkillMap entries ────────────
{
    let invalid = 0;
    for (const [rid, rules] of Object.entries(TRIGGER_RULES)) {
        const keys = new Set(Object.keys(d.autoSkillMap[rid] ?? {}));
        for (const r of rules) {
            if (!keys.has(r.after)) { invalid++; console.error(`    bad after: ${rid}/${r.after}`); }
            if (!keys.has(r.inserts)) { invalid++; console.error(`    bad inserts: ${rid}/${r.inserts}`); }
        }
    }
    assert('all trigger keys reference real skill-map entries', invalid === 0);
}

// ── triggersForResonator ────────────────────────────────────────────────────
{
    assert('Carlotta has trigger rules', triggersForResonator(1107).length > 0);
    assert('string id resolves too', triggersForResonator('1107').length > 0);
    assert('unknown resonator → no triggers', triggersForResonator(99999).length === 0);
}

// ── proposeTriggeredInsert ──────────────────────────────────────────────────
{
    // Carlotta: adding 'skill' proposes 'skill_chromatic_splendor' right after.
    const rot = ['skill'];
    const p = proposeTriggeredInsert(1107, rot, 0);
    assert('trigger proposes the correct follow-up', p?.skillKey === 'skill_chromatic_splendor');
    assert('proposal inserts immediately after the trigger', p?.insertAt === 1);
    assert('proposal carries a note', typeof p?.note === 'string' && p.note.length > 0);

    // Already present → no duplicate proposal.
    const rot2 = ['skill', 'skill_chromatic_splendor'];
    assert('already-present follow-up is not duplicated', proposeTriggeredInsert(1107, rot2, 0) === null);

    // Non-trigger key → nothing.
    assert('non-trigger key proposes nothing', proposeTriggeredInsert(1107, ['liberation'], 0) === null);
    // Out-of-range index → nothing.
    assert('out-of-range index proposes nothing', proposeTriggeredInsert(1107, ['skill'], 5) === null);
    // Unknown resonator → nothing.
    assert('unknown resonator proposes nothing', proposeTriggeredInsert(99999, ['skill'], 0) === null);
}

// ── Full flow: append trigger → apply proposal → meta stays aligned ─────────
{
    const carlotta = d.resonators.find(r => r.id === 1107);
    let b = createBuild(carlotta);
    b = appendRotationStep(b, 'skill');                       // user adds the trigger
    const p = proposeTriggeredInsert(b.resonatorId, b.rotation, b.rotation.length - 1);
    assert('proposal fires after appending trigger', p != null);

    // Apply: append the follow-up tagged autoInserted (it lands at the end = insertAt).
    b = appendRotationStep(b, p.skillKey, { autoInserted: true });
    assert('rotation has trigger + follow-up', JSON.stringify(b.rotation) === JSON.stringify(['skill', 'skill_chromatic_splendor']));
    assert('follow-up step is tagged autoInserted', b.rotationMeta[1]?.autoInserted === true);
    assert('trigger step is not tagged', !b.rotationMeta[0]?.autoInserted);

    // Move the pair around — meta must travel with the steps.
    b = appendRotationStep(b, 'liberation');                 // ['skill','splendor','liberation']
    b = moveRotationStep(b, 2, 0);                           // ['liberation','skill','splendor']
    assert('after move, autoInserted marker tracks its step',
        b.rotation[2] === 'skill_chromatic_splendor' && b.rotationMeta[2]?.autoInserted === true);
    assert('moved liberation has clean meta', JSON.stringify(b.rotationMeta[0]) === '{}');

    // Remove the follow-up — both arrays shrink in lockstep.
    b = removeRotationStep(b, 2);
    assert('removing follow-up keeps arrays aligned',
        b.rotation.length === 2 && b.rotationMeta.length === 2);
    assert('no autoInserted marker remains', !b.rotationMeta.some(m => m?.autoInserted));

    // setRotationMeta clears back to default.
    b = setRotationMeta(b, 0, { autoInserted: true });
    assert('setRotationMeta sets a marker', b.rotationMeta[0]?.autoInserted === true);
    b = setRotationMeta(b, 0, null);
    assert('setRotationMeta(null) reverts to default', JSON.stringify(b.rotationMeta[0]) === '{}');
}

console.log(`\nrotation-triggers: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
