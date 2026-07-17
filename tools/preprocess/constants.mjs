// tools/preprocess/constants.mjs — shared game-id tables (elements, weapon types, rarity classes).
// Split from the monolithic preprocess.mjs (Simplification Plan S4.1);
// bodies moved verbatim — LOCK A (byte-identical wuwa-data.json) verifies.

// =============================================================================
// Canonical lookups (hard-coded so the UI can map without runtime joins).
// =============================================================================

export const ELEMENT_COLORS = {
    0: '#9aa4b2', // Physical
    1: '#88dfff', // Glacio
    2: '#ff7755', // Fusion
    3: '#bb88ff', // Electro
    4: '#66ddaa', // Aero
    5: '#ffd44d', // Spectro
    6: '#ff66cc', // Havoc
};

export const WEAPON_TYPES = {
    1: 'Broadblade',
    2: 'Sword',
    3: 'Pistols',
    4: 'Gauntlets',
    5: 'Rectifier',
};

// PhantomItem.Rarity is the **class tier**, NOT the in-game star rating.
// The in-game star rating lives in PhantomItem.QualityId (2..5).
//
// Absolute truth (verified via MainProp.RandGroupId cross-check):
//   3 = Calamity (4-cost) — world-boss echoes, e.g. Bell-Borne Geochelone, Dreamless
//   2 = Overlord (4-cost) — overlord-monster echoes, e.g. Tempest Mephis, Inferno Rider
//   1 = Elite    (3-cost) — elite-enemy echoes
//   0 = Common   (1-cost) — basic enemy echoes
//
// Verification: Rarity 2 and 3 both use MainProp.RandGroupId 501 (4-cost pool),
// Rarity 1 uses RandGroupId 502 (3-cost pool), Rarity 0 uses 503 (1-cost pool).
export const RARITY_TO_COST  = { 0: 1, 1: 3, 2: 4, 3: 4 };

export const RARITY_TO_CLASS = { 0: 'Common', 1: 'Elite', 2: 'Overlord', 3: 'Calamity' };

// Echoes with IDs in the 60200000-60299999 range are named after
// resonators (Jinhsi, Camellya, etc.) and aren't real in-game echoes —
// likely event leftovers or unreleased content. They all share
// `starLevel: 2` (lowest tier) in the source. Filter them out so the
// picker only shows playable echoes.
export function isEventLeftoverEcho(itemId) {
    return itemId >= 60200000 && itemId < 60300000;
}

// ── Echo full projection from data/extracted-nanoka/echoes/{id}.json ─────────
// nanoka keys echoes by monsterId (390xxxxxx). Provides the active skill
// (damage.rate_lv), sonata groups with pre-split descParams, and class rank.
//
// intensity_code → class + cost (authoritative; matches verified truth):
//   3 = Calamity (4-cost)
//   2 = Overlord (4-cost)
//   1 = Elite    (3-cost)
//   0 = Common   (1-cost)
export const INTENSITY_TO_COST  = { 3: 4, 2: 4, 1: 3, 0: 1 };

export const INTENSITY_TO_CLASS = { 3: 'Calamity', 2: 'Overlord', 1: 'Elite', 0: 'Common' };

// =============================================================================
// Effect parsing for Resonance Chains & Inherent Skills
// =============================================================================
//
// Chains and inherent skills carry conditional buffs. We parse the description
// text + params into structured effect objects the sim can apply as toggles.
//
// Effect shape:
//   {
//     stat:      'dmgBonus'|'elementBonus'|'skillTypeBonus'|'amplify'|'deepen'
//                |'atkRatio'|'critRate'|'critDmg'|'healingBonus'|'multiplierUp'
//     value:     number          (fraction, e.g. 0.15 for 15%)
//     element:   number|null     (elementId, for element-specific DMG bonus)
//     skillType: string|null     (basic/heavy/skill/liberation/intro, for type-specific)
//     condition: string          (human-readable trigger, shown in UI)
//     defaultActive: boolean     (whether to enable by default — passive/unconditional)
//   }
//
// We only extract HIGH-CONFIDENCE effects (clear "increases X by N%" patterns).
// Ambiguous text is left as display-only description (no effect emitted).

export const ELEMENT_NAME_TO_ID = {
    glacio: 1, fusion: 2, electro: 3, aero: 4, spectro: 5, havoc: 6,
};
