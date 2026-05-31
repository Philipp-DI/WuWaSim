/**
 * Unified buff model for WuWa Sim.
 *
 * Every source of damage-relevant buffs in the game maps to a BuffEffect:
 *
 *   BuffEffect {
 *     owner:   BuffOwner   — what produced this buff
 *     scope:   BuffScope   — who it applies to
 *     stat:    BuffStat    — which stat (or damage bucket) it modifies
 *     value:   number      — the amount (fraction for %, e.g. 0.10 = +10%)
 *     label?:  string      — human-readable description (for UI tooltips)
 *   }
 *
 * Owner taxonomy (matches thewuwacalculator.com's internal model):
 *   'resonator'  — character passive / inherent skill / sequence node
 *   'weapon'     — weapon passive
 *   'echo'       — single-echo active skill or echo stat
 *   'echoSet'    — sonata 2pc / 5pc set bonus
 *   'outro'      — outro skill buff granted to the incoming resonator
 *   'team'       — party-wide buff (e.g. Verina's Outro, Mornye's Outro)
 *
 * Scope taxonomy:
 *   'self'              — applies only to the resonator that produced it
 *   'active'            — applies to the currently on-field resonator
 *   'teamWide'          — applies to all resonators simultaneously
 *   'incomingResonator' — applies specifically to the resonator switching in
 *
 * Stat taxonomy — maps directly to formula.js context keys and stats keys:
 *   additive DMG bonus (formula.js dmgBonus bucket, additive):
 *     'dmgBonus'      — generic DMG% (stacks with element/type)
 *     'elementBonus'  — element-specific DMG% (payload carries elementId)
 *     'skillTypeBonus'— skill-type DMG% (payload carries skillType)
 *   separate multiplicative buckets:
 *     'amplify'       — Outro amplify bucket: × (1 + amplify)
 *     'deepen'        — deepen bucket: × (1 + deepen)
 *   stat bonuses (fold into resolveTotalStats):
 *     'atkRatio'      — ATK% (multiplicative with base ATK)
 *     'atkFlat'       — flat ATK addition
 *     'hpRatio'       — HP%
 *     'defRatio'      — DEF%
 *     'critRate'      — Crit Rate (additive)
 *     'critDmg'       — Crit DMG (additive)
 *     'healingBonus'  — Healing Bonus (additive)
 *     'energyRegen'   — Energy Regen (additive)
 *
 * Usage: modules that produce buffs (outroBuffs, sonataContribution, etc.)
 * emit BuffEffect[]. Consumers (team-sim, future weapon-passive layer, future
 * chain-effect layer) receive the same shape regardless of source.
 * The formula and stats engine accept buffs through existing context/stat
 * parameters — resolveBuffContext() converts BuffEffect[] to formula context.
 */

// =============================================================================
// Type constants (plain strings — no enum overhead in JS)
// =============================================================================

export const BuffOwner = Object.freeze({
    RESONATOR: 'resonator',
    WEAPON: 'weapon',
    ECHO: 'echo',
    ECHO_SET: 'echoSet',
    OUTRO: 'outro',
    TEAM: 'team',
});

export const BuffScope = Object.freeze({
    SELF: 'self',
    ACTIVE: 'active',
    TEAM_WIDE: 'teamWide',
    INCOMING_RESONATOR: 'incomingResonator',
});

export const BuffStat = Object.freeze({
    // DMG bonus bucket (additive within the bucket)
    DMG_BONUS: 'dmgBonus',
    ELEMENT_BONUS: 'elementBonus',
    SKILL_TYPE_BONUS: 'skillTypeBonus',
    // Separate multiplicative buckets
    AMPLIFY: 'amplify',
    DEEPEN: 'deepen',
    // Stat bonuses
    ATK_RATIO: 'atkRatio',
    ATK_FLAT: 'atkFlat',
    HP_RATIO: 'hpRatio',
    DEF_RATIO: 'defRatio',
    CRIT_RATE: 'critRate',
    CRIT_DMG: 'critDmg',
    HEALING_BONUS: 'healingBonus',
    ENERGY_REGEN: 'energyRegen',
});

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a BuffEffect. All fields are validated; throws on bad input so
 * callers catch schema mistakes at definition time, not silently at runtime.
 *
 * @param {object} args
 * @param {string} args.owner    — BuffOwner constant
 * @param {string} args.scope    — BuffScope constant
 * @param {string} args.stat     — BuffStat constant
 * @param {number} args.value    — numeric amount (fraction for % stats)
 * @param {object} [args.payload]— stat-specific extra data:
 *   elementBonus    → { elementId: number }
 *   skillTypeBonus  → { skillType: string }
 * @param {string} [args.label]  — human-readable description for UI
 * @returns {BuffEffect}
 */
export function makeBuffEffect({ owner, scope, stat, value, payload = {}, label = '' }) {
    if (!Object.values(BuffOwner).includes(owner)) throw new Error(`Invalid BuffOwner: ${owner}`);
    if (!Object.values(BuffScope).includes(scope)) throw new Error(`Invalid BuffScope: ${scope}`);
    if (!Object.values(BuffStat).includes(stat)) throw new Error(`Invalid BuffStat: ${stat}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`BuffEffect value must be a finite number, got ${value}`);
    return Object.freeze({ owner, scope, stat, value, payload, label });
}

// =============================================================================
// Converters — existing buff representations → BuffEffect[]
// =============================================================================

/**
 * Convert outroBuffs[] (preprocess.mjs format) to BuffEffect[].
 * outroBuffs: [{ scope: { type, elementId?, skillType? }, value, duration }]
 *
 * The resulting effects have owner='outro', scope='incomingResonator'.
 * duration is preserved in the payload for time-gating in team-sim.
 */
export function outroBuffsToEffects(outroBuffs, label = '') {
    if (!Array.isArray(outroBuffs)) return [];
    return outroBuffs.map(buff => {
        const { scope: bScope, value, duration } = buff;
        let stat, payload;
        if (bScope.type === 'element') {
            stat = bScope.elementId === null ? BuffStat.DMG_BONUS : BuffStat.ELEMENT_BONUS;
            payload = bScope.elementId !== null ? { elementId: bScope.elementId, duration } : { duration };
        } else {
            stat = BuffStat.AMPLIFY;    // skillType-scoped amplify stays in the amplify bucket
            payload = { skillType: bScope.skillType, duration };
        }
        return makeBuffEffect({
            owner: BuffOwner.OUTRO,
            scope: BuffScope.INCOMING_RESONATOR,
            stat, value, payload, label,
        });
    });
}

/**
 * Convert the amplifyContext format used by team-sim (array of outroBuffs
 * entries passed directly) into BuffEffect[]. Thin wrapper over outroBuffsToEffects.
 */
export function amplifyContextToEffects(amplifyContext) {
    return outroBuffsToEffects(amplifyContext ?? []);
}

/**
 * Convert a sonata parsed buff (sonata-buffs.js ParsedBuff) to BuffEffect[].
 * bonusKind 'element' → elementBonus, 'atk' → atkRatio, 'unknown' → dmgBonus.
 */
export function sonataParsedBuffToEffects(parsedBuff, label = '') {
    if (!parsedBuff) return [];
    const { bonusKind, bonusPct, element } = parsedBuff;
    let stat, payload;
    if (bonusKind === 'element' && element) {
        stat = BuffStat.ELEMENT_BONUS;
        payload = { elementId: element };
    } else if (bonusKind === 'atk') {
        stat = BuffStat.ATK_RATIO;
        payload = {};
    } else {
        stat = BuffStat.DMG_BONUS;
        payload = {};
    }
    return [makeBuffEffect({
        owner: BuffOwner.ECHO_SET,
        scope: BuffScope.SELF,
        stat, value: bonusPct, payload,
        label: label || parsedBuff.raw?.slice(0, 60) || '',
    })];
}

// =============================================================================
// Resolver — BuffEffect[] + hit info → formula context additions
// =============================================================================

/**
 * Given a list of BuffEffect objects and the hit being evaluated, return
 * the additive contributions to formula.js context fields.
 *
 * This is called per-hit in resolveSkill when buffEffects are present,
 * supplementing (not replacing) the existing amplifyContext path.
 *
 * Only effects with stat in {AMPLIFY, DEEPEN, ELEMENT_BONUS, SKILL_TYPE_BONUS,
 * DMG_BONUS} affect per-hit computation — the stat buffs (atkRatio etc.) are
 * already folded into resolveTotalStats and don't need per-hit resolution.
 *
 * @param {BuffEffect[]} effects
 * @param {{ element: number, skillType: string }} hit
 * @returns {{ amplify: number, deepen: number, dmgBonus: number }}
 */
export function resolveBuffContext(effects, hit) {
    let amplify = 0;
    let deepen = 0;
    let dmgBonus = 0;

    for (const eff of effects) {
        switch (eff.stat) {
            case BuffStat.AMPLIFY:
                // If payload has a skillType, only apply to matching hits
                if (!eff.payload.skillType || eff.payload.skillType === hit.skillType) {
                    amplify += eff.value;
                }
                break;
            case BuffStat.DEEPEN:
                deepen += eff.value;
                break;
            case BuffStat.ELEMENT_BONUS:
                if (eff.payload.elementId === hit.element) dmgBonus += eff.value;
                break;
            case BuffStat.DMG_BONUS:
                dmgBonus += eff.value;
                break;
            case BuffStat.SKILL_TYPE_BONUS:
                if (eff.payload.skillType === hit.skillType) dmgBonus += eff.value;
                break;
            // Stat buffs (ATK%, CR, CD, etc.) are handled at the stats layer, not here
            default:
                break;
        }
    }

    return { amplify, deepen, dmgBonus };
}

/**
 * Filter a BuffEffect[] to only those active at a given time offset.
 * Effects without a duration payload are always included.
 * Effects with a duration payload are included if timeOffset < duration.
 *
 * Used by team-sim to check if an Outro buff is still active partway
 * into the incoming resonator's rotation.
 *
 * @param {BuffEffect[]} effects
 * @param {number} timeOffset — seconds since the buff was applied
 * @returns {BuffEffect[]}
 */
export function filterActiveBuffs(effects, timeOffset) {
    return effects.filter(eff => {
        const dur = eff.payload?.duration;
        return dur == null || timeOffset < dur;
    });
}

// =============================================================================
// Resonance Chain & Inherent Skill effects
// =============================================================================
//
// These come from preprocess as plain effect objects:
//   { stat, value, element|null, skillType|null, condition, defaultActive }
// where stat ∈ {dmgBonus, elementBonus, skillTypeBonus, amplify, deepen,
//               atkRatio, critRate, critDmg, healingBonus, multiplierUp}
//
// resolveChainInherentContext() folds a list of ACTIVE effects into the
// per-hit context buckets that computeDamage understands. It is hit-aware:
// element-/skillType-scoped effects only apply to matching hits.
//
// Stat-type effects (atkRatio, critRate, critDmg, healingBonus) are returned
// separately so the caller can add them at the stats layer or as context
// bonuses. We surface them as context bonuses (critRateBonus, critDmgBonus,
// scalingRatio for atkRatio) since they apply per-skill in the damage panel.

/**
 * Fold active chain/inherent effects into context contributions for one hit.
 *
 * @param {Array<object>} effects — active effect objects (already filtered to active)
 * @param {{ element:number, skillType:string }} hit
 * @returns {{
 *   dmgBonus:number, amplify:number, deepen:number,
 *   critRateBonus:number, critDmgBonus:number, atkRatio:number,
 *   healingBonus:number, multiplierUp:number
 * }}
 */
export function resolveChainInherentContext(effects, hit) {
    const out = {
        dmgBonus: 0, amplify: 0, deepen: 0,
        critRateBonus: 0, critDmgBonus: 0, atkRatio: 0,
        healingBonus: 0, multiplierUp: 0,
    };
    if (!effects?.length) return out;

    for (const e of effects) {
        switch (e.stat) {
            case 'dmgBonus':
                out.dmgBonus += e.value;
                break;
            case 'elementBonus':
                if (e.element == null || e.element === hit.element) out.dmgBonus += e.value;
                break;
            case 'skillTypeBonus':
                if (e.skillType == null || e.skillType === hit.skillType) out.dmgBonus += e.value;
                break;
            case 'amplify':
                // Element/skillType-scoped amplify only applies to matching hits
                if ((e.element == null || e.element === hit.element) &&
                    (e.skillType == null || e.skillType === hit.skillType)) {
                    out.amplify += e.value;
                }
                break;
            case 'deepen':
                out.deepen += e.value;
                break;
            case 'critRate':
                out.critRateBonus += e.value;
                break;
            case 'critDmg':
                out.critDmgBonus += e.value;
                break;
            case 'atkRatio':
                out.atkRatio += e.value;
                break;
            case 'healingBonus':
                out.healingBonus += e.value;
                break;
            case 'multiplierUp':
                // Multiplier increase applies only to matching skill type (or all)
                if (e.skillType == null || e.skillType === hit.skillType) {
                    out.multiplierUp += e.value;
                }
                break;
            default:
                break;
        }
    }
    return out;
}

/**
 * Decide whether a single chain/inherent effect is active, given the resolution
 * mode and the user's toggle overrides.
 *
 * Resolution rules (per the P10 conditional-effects design):
 *
 *   unconditional — ALWAYS active once the node is unlocked. Not toggleable.
 *   structural    — "after casting X" / "while in Y state".
 *                   • build mode: governed by the build-page "assume active"
 *                     toggle (defaults on via defaultAssume).
 *                   • teamSim mode: auto-resolved by `resolveStructural(effect)`
 *                     from rotation order / state windows. If no resolver is
 *                     supplied, falls back to OFF (conservative).
 *   duration      — timed window. build: toggle (default on). teamSim: treated
 *                   as a structural "is the buff window open" question; if the
 *                   resolver can answer it, use that, else default on (durations
 *                   are usually maintained within a damage window).
 *   situational / other — depends on un-modeled combat state.
 *                   • build mode: toggle, default OFF.
 *                   • teamSim mode: OFF unless the user set an explicit override.
 *
 * A user toggle override (effectToggles[key] present) ALWAYS wins, in both
 * modes — that is the "flag with a toggle" escape hatch for the team sim.
 *
 * @param {object} e        — effect object (has conditionKind, defaultAssume, structuralTrigger)
 * @param {string} key      — toggle key (e.g. "S2.0", "IH0.1")
 * @param {object} toggles  — build.effectToggles
 * @param {'build'|'teamSim'} mode
 * @param {(e:object)=>boolean|null} [resolveStructural] — team-sim structural resolver
 * @returns {boolean}
 */
function effectIsActive(e, key, toggles, mode, resolveStructural) {
    const kind = e.conditionKind ?? (e.defaultActive ? 'unconditional' : 'situational');

    // Unconditional effects are always on once unlocked — no toggle, no override.
    if (kind === 'unconditional') return true;

    // Explicit user override always wins (the team-sim escape-hatch toggle).
    if (key in toggles) return !!toggles[key];

    if (mode === 'teamSim') {
        if (kind === 'structural') {
            const r = resolveStructural ? resolveStructural(e) : null;
            return r === true;            // unresolved/unknown → OFF (conservative)
        }
        if (kind === 'duration') {
            const r = resolveStructural ? resolveStructural(e) : null;
            return r == null ? true : r;  // durations default on within a window
        }
        // situational / other → OFF unless overridden (handled above)
        return false;
    }

    // build mode: use the assume-active default for the kind.
    return e.defaultAssume ?? false;
}

/**
 * Collect active chain + inherent effects for a build.
 *
 * @param {object} build — { chain, effectToggles?, inherentSkillsActive? }
 * @param {object} reso  — dataset entry with resonanceChain[], inherentSkills[]
 * @param {object} [opts]
 * @param {'build'|'teamSim'} [opts.mode='build'] — resolution surface
 * @param {(e:object)=>boolean|null} [opts.resolveStructural] — team-sim structural resolver
 * @returns {Array<object>} active effect objects
 */
export function collectActiveEffects(build, reso, opts = {}) {
    const mode = opts.mode ?? 'build';
    const resolveStructural = opts.resolveStructural ?? null;
    const active = [];
    const seqLevel = build?.chain ?? build?.sequenceLevel ?? 0;
    const toggles = build?.effectToggles ?? {};

    // Chain effects: unlocked when chain level >= the sequence's level.
    for (const ch of reso?.resonanceChain ?? []) {
        if (ch.level > seqLevel) continue;
        for (let i = 0; i < (ch.effects?.length ?? 0); i++) {
            const e = ch.effects[i];
            const key = `S${ch.level}.${i}`;
            if (effectIsActive(e, key, toggles, mode, resolveStructural)) active.push(e);
        }
    }

    // Inherent skill effects: gated by the inherent node being unlocked/active.
    const inherentActive = build?.inherentSkillsActive ?? [true, true];
    for (let s = 0; s < (reso?.inherentSkills?.length ?? 0); s++) {
        if (inherentActive[s] === false) continue;
        const ih = reso.inherentSkills[s];
        for (let i = 0; i < (ih.effects?.length ?? 0); i++) {
            const e = ih.effects[i];
            const key = `IH${s}.${i}`;
            if (effectIsActive(e, key, toggles, mode, resolveStructural)) active.push(e);
        }
    }

    return active;
}