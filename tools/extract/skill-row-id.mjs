/**
 * Recovers the DT_SkillInfo row that owns a raw BinData damage id.
 *
 * A damage id is its owning skill row's id followed by a hit index, so the row
 * is the longest known row id that is a prefix of it. Exact identity — nothing
 * is decomposed or scored — which is what lets both consumers (map-timings.mjs
 * for animations, build-skill-join.mjs for rotation-step keys) trust the answer
 * and refuse rather than guess when there is none.
 */

/**
 * @param {string}      hitId        raw BinData damage id, e.g. "15084040010"
 * @param {Set<string>} knownRowIds  that resonator's DT_SkillInfo row ids
 * @returns {string|null} the owning row id, or null when none is a prefix
 */
export function resolveSkillId(hitId, knownRowIds) {
    for (let len = hitId.length; len >= 4; len--) {
        const candidate = hitId.slice(0, len);
        if (knownRowIds.has(candidate)) return candidate;
    }
    // Some resonators (confirmed: Chixia/1202, under her internal codename
    // "Maxiaofang") use a raw row-id skill-index shorter than nanoka's fixed
    // 3-digit zero-padded one -- e.g. hit id "1202001001" (rid "1202" + index
    // "001" + hit "001") has no row matching any length-prefix of itself,
    // because her actual row is "120201" (rid + bare index "01", no padding).
    // If nothing matched by length alone, de-zero-pad the 3 digits right
    // after the 4-digit resonator prefix and retry at plausible bare widths.
    if (hitId.length >= 7) {
        const ridPrefix = hitId.slice(0, 4);
        const bareIndex = String(Number(hitId.slice(4, 7)));
        for (const width of [2, 1, 3]) {
            const candidate = ridPrefix + bareIndex.padStart(width, '0');
            if (knownRowIds.has(candidate)) return candidate;
        }
    }
    return null;
}
