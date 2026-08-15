/**
 * The enemy every surface measures against.
 *
 * This exists because the app shipped TWO of them. The optimizer scored teams
 * against `{ level: 90, atkLv: 90, resistances: {} }` — a 0%-RES dummy — while
 * every UI surface (build page, compare page, team page) sims against 10% RES
 * on elements 1–6. A near-uniform ×0.93 separated the two, so the "Suggested
 * Teams" card on the build page and the team page you reach by clicking OPEN IN
 * TEAM SIM could never agree, no matter how the passes were set. Measured on the
 * Chisa/Denia/Aemeath comp: the card read 2,599,423 dmg/pass and the page 2.41M,
 * with the times identical to the centisecond — the tell that only the enemy
 * differed.
 *
 * A number the app contradicts on the next screen is worse than no number, so
 * the target is defined ONCE here and imported by both sides. The build page's
 * enemy panel still varies level/RES freely; it varies THIS shape.
 *
 * Element 0 (physical) is always 0 RES — the panel's single RES value covers
 * elements 1–6, which is what `makeDmgTarget` has always done.
 */

/** Level-90 enemy: the ToA convention the whole app reports against. */
export const DEFAULT_ENEMY_LEVEL = 90;

/** 10% elemental RES — the value the UI has always used. */
export const DEFAULT_ENEMY_RES = 0.1;

/**
 * Build a sim target.
 *
 * @param {object} [opts]
 * @param {number} [opts.level] — enemy level
 * @param {number} [opts.res]   — elemental RES fraction (0.1 = 10%), elements 1–6
 * @param {number} [opts.atkLv] — the ATTACKER's level (defaults to the enemy's)
 * @returns {{level:number, atkLv:number, resistances:Object<number,number>}}
 */
export function makeTarget({ level = DEFAULT_ENEMY_LEVEL, res = DEFAULT_ENEMY_RES, atkLv } = {}) {
    return {
        level,
        atkLv: atkLv ?? level,
        resistances: { 0: 0, 1: res, 2: res, 3: res, 4: res, 5: res, 6: res },
    };
}

/**
 * The target used wherever no enemy panel is in play. Frozen through the
 * resistances map too — it is the one shared instance, and `Object.freeze` is
 * shallow, so freezing only the outer object would leave the RES values
 * writable by every consumer that holds it.
 */
export const DEFAULT_TARGET = (() => {
    const target = makeTarget();
    Object.freeze(target.resistances);
    return Object.freeze(target);
})();
