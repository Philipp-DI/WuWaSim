/**
 * Effect-slot fingerprints: every override target and every persisted slot key
 * still addresses the effect it was written for (roadmap step 1, #99).
 *
 *   node tests/effect-slot-fingerprint.test.mjs
 *
 * Slot keys are positional (CLAUDE.md, "Effect-slot keys are FROZEN before
 * anything reads them"). A pass that adds, drops or reorders an effect moves
 * every curated patch and saved stack after it onto a different effect, and
 * until now no test noticed: #47 reordered the pipeline in a scratch copy and
 * the suite stayed green while Sigrika's curated S6.2 skill list was silently
 * overwritten; Luuk Herssen's S6.0 patch moved twice (90f1d56, 42e11ba).
 *
 * What fails, and when:
 *   1. Override targets are REPLAYED from the committed inputs on every run, so
 *      a parser or scoping change that shifts one fails here with no data regen.
 *   2. Persisted slots (S / IH / SK, the keys `effectStacks` holds) are read
 *      from the committed dataset, so a shift fails once `npm run data` runs.
 *   3. The replay, carried through the overrides and supersession, must equal
 *      the dataset field for field. That catches a pass reordered inside
 *      `preprocess.mjs` `main()` once data is regenerated, including an
 *      in-place overwrite that moves no slot (#47's Sigrika case).
 *
 * A DELIBERATE shift: re-pin with `node tools/effect-slot-pins.mjs --write`,
 * move the affected override keys, and record the shift and the saved-build
 * migration it needs in that session's docs/history/ file.
 */
import { readFileSync } from 'fs';
import {
    PINS_PATH, loadDataset, loadOverrides, overrideTargetPins, persistedSlots, replayPreOverride, replayShipped,
} from '../tools/effect-slot-pins.mjs';

const RE_PIN = 'deliberate? re-pin with `node tools/effect-slot-pins.mjs --write` and record the shift';

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const pins = JSON.parse(readFileSync(PINS_PATH, 'utf8'));
const dataset = loadDataset();
const overrides = loadOverrides();
const replayed = replayPreOverride(dataset);

/** Compare two { resonatorId: { key: fingerprint } } maps key by key. */
function comparePinSets(label, actual, pinned) {
    const resonatorIds = new Set([...Object.keys(actual), ...Object.keys(pinned)]);
    for (const resonatorId of resonatorIds) {
        const now = actual[resonatorId] ?? {}, then = pinned[resonatorId] ?? {};
        for (const key of new Set([...Object.keys(now), ...Object.keys(then)])) {
            assert(`${label} ${resonatorId}.${key}: pinned "${then[key] ?? '(none)'}", now "${now[key] ?? '(none)'}" — ${RE_PIN}`,
                now[key] === then[key]);
        }
    }
}

// ── 1. Override targets, replayed (no data regen needed) ─────────────────────
{
    assert(`the replay covers every dataset resonator (${replayed.length} of ${dataset.resonators.length})`,
        replayed.length === dataset.resonators.length);
    const targets = overrideTargetPins(replayed, overrides);
    comparePinSets('override target', targets, pins.overrideTargets);
    const missingNode = Object.entries(targets).flatMap(([id, byKey]) =>
        Object.entries(byKey).filter(([, pin]) => pin === 'no such node').map(([key]) => `${id}.${key}`));
    assert(`every override key names a real node (missing: ${missingNode.join(', ') || 'none'})`, missingNode.length === 0);
}

// ── 2. Persisted slots of the committed dataset ──────────────────────────────
{
    const persisted = {};
    for (const resonator of dataset.resonators) {
        const slots = persistedSlots(resonator);
        if (Object.keys(slots).length) persisted[resonator.id] = slots;
    }
    comparePinSets('persisted slot', persisted, pins.persisted);
}

// ── 3. The replay agrees with the dataset, field for field ───────────────────
{
    // Key order is not meaning: a reordered pass can rewrite the same fields in
    // a different order, so objects are compared with sorted keys.
    const canonical = value => JSON.stringify(value, (key, field) => (field && typeof field === 'object' && !Array.isArray(field)
        ? Object.fromEntries(Object.entries(field).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
        : field));
    const differing = [];
    for (const resonator of replayShipped(dataset)) {
        const shipped = dataset.resonators.find(entry => entry.id === resonator.id);
        for (const field of ['resonanceChain', 'inherentSkills']) {
            if (canonical(resonator[field]) !== canonical(shipped[field])) differing.push(`${resonator.name} ${field}`);
        }
    }
    assert(`replayed chain/inherent effects equal the dataset (differ: ${differing.join(', ') || 'none'}). Either a pass `
        + 'in preprocess.mjs main() was reordered or added, or tools/effect-slot-pins.mjs no longer mirrors it', differing.length === 0);
}

// ── 4. The check has teeth: a shifted slot is seen ───────────────────────────
{
    // Luuk Herssen's S6.1 patch is the one that moved twice. Insert an effect at
    // the head of his S6 node, as a newly parsed clause would, and the pin must
    // stop matching.
    const shifted = replayPreOverride({ ...dataset, resonators: dataset.resonators.filter(entry => entry.id === 1510) });
    shifted[0].resonanceChain.find(node => node.level === 6).effects.unshift({ stat: 'atkPct', condition: 'injected' });
    const target = overrideTargetPins(shifted, { 1510: overrides['1510'] })['1510']['S6.1'];
    assert('a one-slot shift in Luuk Herssen S6 changes the S6.1 fingerprint', target !== pins.overrideTargets['1510']['S6.1']);
    assert('and the pinned S6.1 is his Endnotes clause', /Endnotes on the Endgame/.test(pins.overrideTargets['1510']['S6.1']));
}

console.log(`effect-slot-fingerprint: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
