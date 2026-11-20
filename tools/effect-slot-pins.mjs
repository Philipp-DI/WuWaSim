/**
 * Effect-slot fingerprints (roadmap step 1, #99).
 *
 *   node tools/effect-slot-pins.mjs --write   # re-pin after a DELIBERATE slot change
 *
 * A slot key (`S{level}.{index}`, `IH{node}.{index}`, `SK{node}.{index}`) is an
 * address by position. `data/effect-overrides.json` and saved builds'
 * `effectStacks` both point at effects through it, so a pass that adds, drops
 * or reorders an effect moves every curated patch and saved stack after it onto
 * a different effect, silently (CLAUDE.md, "Effect-slot keys are FROZEN before
 * anything reads them"). A pin records WHICH effect each address held, so
 * `tests/effect-slot-fingerprint.test.mjs` notices when it holds another.
 *
 * Two pin sets, because the two readers see different moments:
 *   - overrideTargets: what each override key addresses at the moment the
 *     overrides apply. Replayed offline from the committed inputs (nanoka
 *     kit text, buff facts, the dataset's own autoSkillMap), so a parser or
 *     scoping change that shifts a target fails `npm test` without a data regen.
 *   - persisted: every S / IH / SK slot of the committed dataset, the keys a
 *     saved build's `effectStacks` can hold. Changes only when data is regenerated.
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { projectNanokaCharacterFull } from './preprocess/resonators.mjs';
import { applyBuffFacts, loadBuffFacts } from './preprocess/buff-facts.mjs';
import { bindSkillScopes } from './preprocess/skill-scope.mjs';
import { applyResonanceModesAndOverrides } from './preprocess/effects.mjs';
import { markSupersededInherents } from './preprocess/inherent-replace.mjs';
import { effectSlot } from './effect-overrides.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
export const PINS_PATH = resolve(ROOT, 'tests/fixtures/effect-slot-pins.json');
export const EMPTY_SLOT = 'empty';

/**
 * The effect's identity: its stat and the clause it was read from. A hash keeps
 * the comparison exact; the readable tail is for the person reading a failure.
 */
export function slotFingerprint(effect) {
    if (!effect) return EMPTY_SLOT;
    const identity = `${effect.stat ?? ''}|${effect.condition ?? ''}`;
    const hash = createHash('sha1').update(identity).digest('hex').slice(0, 10);
    return `${hash} ${effect.stat ?? '?'} · ${String(effect.condition ?? '').slice(0, 48)}`;
}

/** Every S / IH / SK slot of one resonator → fingerprint, keyed as buffs.js unlockedEffects keys them. */
export function persistedSlots(resonator) {
    const slots = {};
    for (const chainNode of resonator.resonanceChain ?? []) {
        (chainNode.effects ?? []).forEach((effect, i) => { slots[`S${chainNode.level}.${i}`] = slotFingerprint(effect); });
    }
    (resonator.inherentSkills ?? []).forEach((node, nodeIndex) => (node.effects ?? []).forEach((effect, i) => {
        slots[`IH${nodeIndex}.${i}`] = slotFingerprint(effect);
    }));
    (resonator.skillNodeEffects ?? []).forEach((node, nodeIndex) => (node.effects ?? []).forEach((effect, i) => {
        slots[`SK${nodeIndex}.${i}`] = slotFingerprint(effect);
    }));
    return slots;
}

/**
 * Rebuild a resonator's chain and inherent effects as they stand when the
 * overrides apply: the nanoka projection, then the two passes `preprocess.mjs`
 * runs on them before `applyResonanceModesAndOverrides` (buff facts, then skill
 * scopes). This mirrors that ORDER, it does not share it: a reorder inside
 * `main()` shows up only after `npm run data`, through the persisted pins and
 * the replay-agrees-with-the-dataset check in the test.
 *
 * @returns {object|null} a resonator-shaped object, or null when no kit source exists
 */
export function replayPreOverrideResonator(datasetResonator, autoSkillMap, buffFacts) {
    const path = resolve(ROOT, `data/extracted-nanoka/characters/${datasetResonator.id}.json`);
    if (!existsSync(path)) return null;
    const projected = projectNanokaCharacterFull(JSON.parse(readFileSync(path, 'utf8')));
    const resonator = {
        id: datasetResonator.id,
        name: datasetResonator.name,
        resonanceChain: projected.resonanceChain?.length ? projected.resonanceChain : undefined,
        inherentSkills: projected.inherentSkills?.length ? projected.inherentSkills : undefined,
    };
    applyBuffFacts(resonator, buffFacts);
    bindSkillScopes(resonator, autoSkillMap?.[String(resonator.id)]);
    return resonator;
}

/** The replayed pre-override resonators for every dataset resonator with a kit source. */
export function replayPreOverride(dataset) {
    const buffFacts = loadBuffFacts();
    return dataset.resonators
        .map(resonator => replayPreOverrideResonator(resonator, dataset.autoSkillMap, buffFacts))
        .filter(Boolean);
}

/**
 * The replay carried through every later pass that edits chain or inherent
 * effects (modes + overrides, then supersession), in `main()`'s order. Its
 * effects must equal the dataset's field for field; a curated field that a
 * reordered pass overwrites in place (#47: Sigrika's S6 skill lists) breaks that
 * without moving any slot.
 */
export function replayShipped(dataset) {
    const replayed = replayPreOverride(dataset);
    applyResonanceModesAndOverrides(replayed);
    for (const resonator of replayed) markSupersededInherents(resonator);
    return replayed;
}

/** Override key → fingerprint of the effect it addresses (EMPTY_SLOT for an `add`). */
export function overrideTargetPins(replayed, overrides) {
    const pins = {};
    for (const [resonatorId, byKey] of Object.entries(overrides)) {
        const resonator = replayed.find(entry => String(entry.id) === resonatorId);
        pins[resonatorId] = {};
        for (const key of Object.keys(byKey)) {
            const slot = resonator ? effectSlot(resonator, key) : null;
            pins[resonatorId][key] = slot ? slotFingerprint(slot.effects[slot.index]) : 'no such node';
        }
    }
    return pins;
}

export function loadOverrides() {
    return JSON.parse(readFileSync(resolve(ROOT, 'data/effect-overrides.json'), 'utf8')).overrides ?? {};
}

export function loadDataset() {
    return JSON.parse(readFileSync(resolve(ROOT, 'data/wuwa-data.json'), 'utf8'));
}

/** Both pin sets, computed from the current tree. */
export function computePins(dataset = loadDataset()) {
    const persisted = {};
    for (const resonator of dataset.resonators) {
        const slots = persistedSlots(resonator);
        if (Object.keys(slots).length) persisted[resonator.id] = slots;
    }
    return { overrideTargets: overrideTargetPins(replayPreOverride(dataset), loadOverrides()), persisted };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (!process.argv.includes('--write')) {
        console.log('Usage: node tools/effect-slot-pins.mjs --write');
        console.log('Re-pins every effect slot. Only after a DELIBERATE slot change, recorded in docs/history/.');
        process.exit(1);
    }
    writeFileSync(PINS_PATH, JSON.stringify(computePins(), null, 2) + '\n');
    console.log(`wrote ${PINS_PATH}`);
}
