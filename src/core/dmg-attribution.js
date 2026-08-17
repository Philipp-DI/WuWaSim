// src/core/dmg-attribution.js
/**
 * A hit's DMG-TYPE ATTRIBUTION — which bonus bucket it reads.
 *
 * The project keeps three questions apart, and this module owns the third:
 *
 *   skillType   MECHANICAL. Which input casts the move. Drives energy, cast
 *               time, cooldowns, rotation gating, `castMatch` triggers and
 *               `multiplierUp`. Never a category of damage.
 *   formulaType ONE type, used as the skill-LEVEL key (`FORMULA_TO_SKILL_KEY`)
 *               and as the attribution fallback. Single by construction: there
 *               is exactly one level table per hit.
 *   attribution WHICH bonus bucket the hit reads, from the game's own
 *               per-instance `type` tag. ALSO exactly one — see below.
 *
 * EXACTLY ONE, because the client says so. `CharacterDamageCalculations.js`:
 *
 *     static GetAttackTypeDamageBonus(snapshot, type) {
 *       switch (type) {
 *         case 0: return Proto_DamageChangeAuto          // basic
 *         case 1: return Proto_DamageChangeCast          // heavy
 *         case 2: return Proto_DamageChangeUltra         // liberation
 *         case 3: return Proto_DamageChangeQte           // intro
 *         case 4: return Proto_DamageChangeNormalSkill   // skill
 *         case 5: return Proto_DamageChangePhantom       // echo
 *       }
 *       return 0;
 *     }
 *
 * fed the instance's own `Type` and folded in as
 * `1 + Proto_DamageChange + elementBonus + attackTypeBonus`. A `switch` with a
 * single `return`: a type-5 instance reads Phantom and NOTHING else, even when
 * the move that fired it is mechanically a Heavy Attack. There is no overlap
 * between the six buckets, so nothing here may ever SUM two of them.
 *
 * What the game does branch is WHICH type an instance carries. A display row can
 * therefore carry more than one attribution across its instances, and `dmgTypes`
 * on the row records what the tags actually said. Two shapes exist:
 *
 *   one member    the ordinary case, including the 24 rows attributed to echo
 *                 ALONE — those keep their mechanical `formulaType` for level
 *                 and scaling, but it is NOT their attribution.
 *   two members   a BRANCH, not a mixture. Lucilla's [Letting It Go] ships
 *                 `1109014011` (Type 0) and `1109014012` (Type 5) — consecutive
 *                 ids, identical RateLv, identical element, identical energy —
 *                 because her Resonance MODE decides which one fires: the skill
 *                 computes as Basic Attack DMG in Resonance Mode - Glacio Chafe
 *                 and as Echo Skill DMG in Resonance Mode - Echo. Exactly one is
 *                 live for a given build, and a mode is a build-level toggle
 *                 locked for the fight, so the build resolves it.
 *
 * A branch this module cannot resolve falls back to `formulaType`, which is the
 * behaviour the row already had.
 */

/**
 * The single bonus bucket this hit reads.
 *
 * @param {{dmgTypes?: string[]}|null} row  a `damageTable` row
 * @param {string|null} formulaType         the fallback
 * @param {{modes?: Array<{key: string}>, resonanceMode?: string|null}} [build]
 *        the resonator's Resonance Modes and the one this build has chosen —
 *        needed only to resolve a branch.
 * @returns {string|null}
 */
export function attributionOf(row, formulaType, build = {}) {
    const stated = row?.dmgTypes;
    if (!Array.isArray(stated) || stated.length === 0) return formulaType;
    if (stated.length === 1) return stated[0];
    return branchForMode(stated, build) ?? formulaType;
}

/**
 * Pick a branch by the build's Resonance Mode.
 *
 * The link is the mode's own KEY, which the game names after the mechanic the
 * mode switches to — Lucilla's two are `glacio_chafe` and `echo`, and `echo` is
 * a damage type. So: the mode named after one of the branch's types selects that
 * type, and any other mode selects the remaining one. Resolvable only for a
 * two-way branch where exactly one mode is named after exactly one of the two
 * types; anything else returns null and the caller falls back rather than
 * guessing which half of a branch a build is on.
 */
function branchForMode(types, { modes, resonanceMode } = {}) {
    if (types.length !== 2 || !Array.isArray(modes) || modes.length !== 2) return null;
    const named = modes.filter(mode => types.includes(mode?.key));
    if (named.length !== 1) return null;
    const namedType = named[0].key;
    const otherType = types.find(type => type !== namedType);
    return resonanceMode === namedType ? namedType : otherType;
}
