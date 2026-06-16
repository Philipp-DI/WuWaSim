/**
 * Curated Resonance Mode table (RESONANCE-MODE-SPEC.md §2).
 *
 * Resonance Modes are a BUILD-LEVEL choice that gates which effects resolve
 * (distinct from the P10 rotation state timeline). The dataset carries no
 * structured mode field — mode names live only in skill/effect description
 * text — so this table is hand-authored and data-integrity-tested against the
 * dataset (every name here must appear in that resonator's text).
 *
 * Exactly four resonators have modes, exactly two each. The first listed mode
 * is the default on build creation, so the sim is meaningful immediately.
 *
 * Used at preprocess time only: `preprocess.mjs` projects `resonanceModes`
 * (with normalized keys) onto these resonators and tags their mode-gated
 * effects, so all runtime consumers read from the dataset, not this table.
 */

export const RESONANCE_MODES = Object.freeze({
    1210: ['Tune Rupture', 'Fusion Burst'],   // Aemeath
    1509: ['Tune Rupture', 'Tune Strain'],    // Lynae
    1211: ['Fusion Burst', 'Tune Strain'],    // Denia
    1109: ['Glacio Chafe', 'Echo'],           // Lucilla (RESONANCE-MODE-SPEC spells it "Luciall")
});

/** Normalize a mode display name to a stable key ("Tune Rupture" → "tune_rupture"). */
export const modeKey = (name) =>
    String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Mode pair for a resonator, as { key, name } objects (empty array if none).
 * @param {number|string} resonatorId
 */
export function modesForResonator(resonatorId) {
    const pair = RESONANCE_MODES[Number(resonatorId)];
    return pair ? pair.map(name => ({ key: modeKey(name), name })) : [];
}
