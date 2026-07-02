/**
 * Team-level ER override resolution (P13 §7) — the hybrid contract from
 * PHASE0-ARCHITECTURE §5:
 *
 *   - No team context → the character-level default (build page). Under the
 *     P12 mode-based ER deviation this is the balanced target, flagged
 *     `provisional` (a mode choice, not a computed breakpoint).
 *   - Team context with a matching simulated team in meta.teams → that team's
 *     per-member erOverride (which itself may be provisional — see
 *     tools/optimize/team-rank.js: kits that aren't energy-gated, or whose
 *     modeled income can't credibly cover the cost, keep the balanced target).
 *   - Team context with NO matching team → fall back to character-level;
 *     never null when a character-level value exists (hard-req #3).
 *   - Meta absent/stale (loader returned null) or character uncovered → null;
 *     the UI shows "unavailable" rather than a fabricated number (§13.5).
 *
 * Pure over the meta object — no imports from the data layer; callers pass
 * the loaded meta (src/data/meta-loader.js loadMeta()).
 */

// Canonical order-independent team key.
function teamKey(members) {
    return [...members].map(Number).sort((a, b) => a - b).join('+');
}

/**
 * Find a simulated team in meta.teams matching `members` (order-agnostic).
 * Deterministic: anchors and teams are scanned in sorted/stored order; any
 * match carries identical erOverride values (scoring is deterministic per
 * member set), so the first hit is canonical.
 */
export function findMetaTeam(meta, members) {
    if (!members?.length) return null;
    const key = teamKey(members);
    const byCharacter = meta?.teams?.byCharacter ?? {};
    for (const anchor of Object.keys(byCharacter).sort()) {
        for (const t of byCharacter[anchor]) {
            if (teamKey(t.members) === key) return t;
        }
    }
    return null;
}

/**
 * Resolve the ER target for a resonator, optionally in a team context.
 *
 * @param {object|null} meta         — loaded wuwa-meta.json (null = absent/stale)
 * @param {number}      resonatorId
 * @param {number}      sequenceLevel
 * @param {number|null} sonataId
 * @param {object|null} [teamContext] — { members: number[] } when the resonator
 *                                      is placed in a team (team-sim/compare)
 * @returns {object|null}
 *   {
 *     source: 'team' | 'character',
 *     recommended: number,        // the ER target to surface
 *     minViable: number|null,     // computed minimum (null when provisional)
 *     provisional: boolean,       // true = balanced default, not a breakpoint
 *     libCostKnown: boolean,      // false = Liberation isn't energy-gated
 *     scalesWithEr: boolean,      // Mornye-type kits: ER is also a DMG stat
 *     team: { members } | null,   // the matched team when source === 'team'
 *   }
 *   or null when neither a team nor a character-level value exists.
 */
export function resolveErTarget(meta, resonatorId, sequenceLevel, sonataId, teamContext = null) {
    if (!meta) return null;

    const erMode = meta.characters?.[String(resonatorId)]
        ?.bySequence?.[String(sequenceLevel)]?.bySonata?.[String(sonataId)]?.erMode ?? null;

    if (teamContext?.members?.length) {
        const match = findMetaTeam(meta, teamContext.members);
        const o = match?.erOverride?.[String(resonatorId)];
        if (o) {
            return {
                source: 'team',
                recommended: o.recommended,
                minViable: o.provisional === true ? null : o.minViable,
                provisional: o.provisional === true,
                libCostKnown: erMode ? erMode.libCostKnown === true : o.provisional !== true,
                scalesWithEr: erMode?.scalesWithEr === true,
                team: { members: match.members.slice() },
            };
        }
        // No matching simulated team → character-level fallback (hard-req #3).
    }

    if (!erMode) return null;   // uncovered → no number, never fabricated
    return {
        source: 'character',
        recommended: erMode.balancedTarget,
        minViable: null,
        provisional: true,      // mode-based-v1: a mode choice, not a breakpoint
        libCostKnown: erMode.libCostKnown === true,
        scalesWithEr: erMode.scalesWithEr === true,
        team: null,
    };
}
