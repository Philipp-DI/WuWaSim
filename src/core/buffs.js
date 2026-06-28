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

import { stateActive } from './rotation-state.js';

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

// =============================================================================
// P11 §A — unified trigger × window resolution
//
// Every effect carries (from the parser):
//   trigger: { type:'none' | 'castMatch'(skillType?,phrase?) | 'stateEnter'(state) | 'unknown' }
//   window:  { type:'always' | 'persist' | 'seconds'(seconds) | 'stateBound'(state) }
//   plus, for stackables: stackable / perStack / maxStacks / stackTrigger
//
// Resolution is STEP-AWARE and identical for the build-page and team sims:
//   none/always   — active whenever the node is unlocked
//   castMatch      — window opens at the END of the triggering step; a step
//                    benefits if its startTime is inside an open window.
//                    persist → until rotation end; seconds(N) → N s from the
//                    most recent fire (re-triggering refreshes).
//   stateEnter     — active for steps where the bound state is active (state
//                    timeline from rotation-state.js).
//   unknown        — OFF, conservatively (flagged for the PRE-P12 override table;
//                    a silent wrong-ON is worse than a visible OFF).
//
// Effects with no rotation context (damage panel single cards) only get the
// unconditional ones — see collectActiveEffects below (§A4.5).
// =============================================================================

// Is an effect unconditional (active whenever its node is unlocked)?
function isUnconditional(e) {
    if (e.window) return e.window.type === 'always';
    // Back-compat for data predating the taxonomy.
    return (e.conditionKind ?? (e.defaultActive ? 'unconditional' : 'situational')) === 'unconditional';
}

/**
 * The full pool of UNLOCKED chain + inherent effects for a build, each with its
 * stable key. Gating is by node unlock only (chain level / inherent active) —
 * NOT by condition. The step-aware resolver decides per-step activeness.
 *
 * @returns {Array<{ effect:object, key:string }>}
 */
export function unlockedEffects(build, reso) {
    const out = [];
    const seqLevel = build?.chain ?? build?.sequenceLevel ?? 0;

    for (const ch of reso?.resonanceChain ?? []) {
        if (ch.level > seqLevel) continue;
        const effs = ch.effects ?? [];
        for (let i = 0; i < effs.length; i++) out.push({ effect: effs[i], key: `S${ch.level}.${i}` });
    }
    const inherentActive = build?.inherentSkillsActive ?? [true, true];
    const ihs = reso?.inherentSkills ?? [];
    for (let s = 0; s < ihs.length; s++) {
        if (inherentActive[s] === false) continue;
        const effs = ihs[s].effects ?? [];
        for (let i = 0; i < effs.length; i++) out.push({ effect: effs[i], key: `IH${s}.${i}` });
    }
    return out;
}

/**
 * Resolve active chain/inherent effects with NO rotation context: only the
 * unconditional ones apply (§A4.5). Used by single-skill damage cards.
 *
 * @param {object} build
 * @param {object} reso
 * @returns {Array<object>} active (unconditional) effect objects, stack-scaled
 */
export function collectActiveEffects(build, reso) {
    const resonanceMode = build?.resonanceMode ?? null;
    return unlockedEffects(build, reso)
        .filter(({ effect }) => isUnconditional(effect) && modeGateOk(effect, resonanceMode))
        .map(({ effect }) => scaleEffect(effect, { fireCountByType: new Map() }));
}

// Resonance Mode gate (RESONANCE-MODE-SPEC.md §5). An effect with a build-level
// `mode` is active only when the build's selected mode matches; effects with no
// mode are unaffected. Checked before any window/trigger evaluation.
function modeGateOk(e, resonanceMode) {
    return !e.mode || e.mode === resonanceMode;
}

/**
 * Step-aware resolution: which unlocked effects are active at one rotation step,
 * scaled by stack count. Both sims call this per step.
 *
 * @param {Array<{effect,key}>} unlocked  — from unlockedEffects()
 * @param {object} ctx
 * @param {number} ctx.startTime          — step start time (seconds)
 * @param {Set<string>} ctx.activeStates  — state names active at this step
 * @param {Set<string>} ctx.firedTypes    — phrase-types cast strictly before this step
 * @param {Map<string,number>} ctx.lastFireEndByType — type → end time of most recent earlier cast
 * @param {Map<string,number>} ctx.fireCountByType   — type → count of earlier casts
 * @param {Set<string>} ctx.firedKeys     — exact rotation step keys cast strictly before this step
 * @param {Map<string,number>} ctx.lastFireEndByKey  — key → end time of most recent earlier cast
 * @returns {Array<object>} active effect objects (stack-scaled)
 */
export function effectsActiveAtStep(unlocked, ctx) {
    const active = [];
    for (const { effect } of unlocked) {
        if (isEffectOnAtStep(effect, ctx)) active.push(scaleEffect(effect, ctx));
    }
    return active;
}

// A trigger may name an OR of several EXACT rotation step keys via
// `skillKeys` (e.g. Changli's Enflamement buff refreshes on True Sight
// Conquest, True Sight Charge, OR Liberation — three different skill keys
// that don't share a tighter category than each other; her base skillType
// 'skill' would also wrongly match True Sight Capture). `skillKeys` takes
// precedence over the coarser `skillType` category match when both are
// absent it falls back to the broad-category match as before.
function castMatchFiredBefore(trigger, ctx) {
    if (Array.isArray(trigger.skillKeys)) return trigger.skillKeys.some(k => ctx.firedKeys?.has(k));
    if (trigger.skillType == null) return false;   // phrase-only → unresolved → OFF
    return ctx.firedTypes.has(trigger.skillType);
}

// Most recent fire end-time for a trigger, across whichever match mode applies.
function mostRecentFireEnd(trigger, ctx) {
    if (Array.isArray(trigger.skillKeys)) {
        let latest = null;
        for (const k of trigger.skillKeys) {
            const end = ctx.lastFireEndByKey?.get(k);
            if (end != null && (latest == null || end > latest)) latest = end;
        }
        return latest;
    }
    if (trigger.skillType == null) return null;
    return ctx.lastFireEndByType.get(trigger.skillType) ?? null;
}

function isEffectOnAtStep(e, ctx) {
    // Resonance Mode gate first (cheap, build-level): if it fails, inactive
    // regardless of any window/trigger (RESONANCE-MODE-SPEC.md §5).
    if (e.mode && ctx.resonanceMode !== e.mode) return false;

    const win = e.window, trig = e.trigger;
    // Back-compat for data predating the taxonomy: unconditional on, else off.
    if (!win || !trig) return isUnconditional(e);

    switch (win.type) {
        case 'always':
            return true;
        case 'stateBound':
            // win.states (array) is an OR of several state names — e.g. Phoebe's
            // "When in the Absolution status and Confession status" actually means
            // EITHER (the two states are explicitly mutually exclusive in her own
            // kit text — a literal AND is impossible). Mirrors trigger.skillKeys'
            // OR-of-several-identifiers shape for castMatch.
            return Array.isArray(win.states)
                ? win.states.some(s => stateActive(ctx.activeStates, s))
                : stateActive(ctx.activeStates, win.state);
        case 'persist':
            return trig.type === 'castMatch' ? castMatchFiredBefore(trig, ctx) : false;
        case 'seconds': {
            if (trig.type !== 'castMatch' || (trig.skillKeys == null && trig.skillType == null)) return false;
            const lastEnd = mostRecentFireEnd(trig, ctx);
            return lastEnd != null && ctx.startTime + 1e-9 < lastEnd + win.seconds;
        }
        default:
            return false;
    }
}

/**
 * Stack-scale an effect. Non-stackable → returned unchanged.
 *
 * Stack count:
 *   - resolvable stackTrigger (castMatch with a skillType) → number of fires so
 *     far (ctx.fireCountByType), capped at maxStacks.
 *   - unextractable stackTrigger → fall back to maxStacks (or 1) — the realistic
 *     ceiling, applied only because the effect is already ON for this step. The
 *     PRE-P12 override table will supply real stack triggers.
 */
function scaleEffect(e, ctx) {
    if (!e.stackable) return e;
    let stacks;
    const st = e.stackTrigger;
    if (st && st.type === 'castMatch' && st.skillType != null) {
        const fires = ctx.fireCountByType.get(st.skillType) ?? 0;
        stacks = e.maxStacks != null ? Math.min(fires, e.maxStacks) : fires;
    } else {
        stacks = e.maxStacks ?? 1;
    }
    return { ...e, value: e.perStack * stacks };
}

// =============================================================================
// Team-wide buff propagation (P13 Team Effect Model L3)
// =============================================================================

// A chain/inherent effect is TEAM-WIDE only when the team is the RECIPIENT of
// the stat increase ("ATK of all team members", "all team members' ATK",
// "Resonators in the team gain X") — NOT when the team is the ACTOR of a
// condition ("when Resonators in the team inflict Fusion Burst, <self>'s ...",
// which is a SELF buff gated on a team condition). The recipient phrasing below
// excludes the actor case by construction.
const TEAM_RECIPIENT_RE = new RegExp([
    /\b(?:of|to|for)\s+all\s+(?:nearby\s+)?(?:team members|resonators(?:\s+in\s+the\s+team)?|characters(?:\s+nearby)?|party members)\b/,
    /\ball\s+team\s+members['’]/,
    /\ball\s+team\s+members\s+(?:is|are|gains?)\b/,
    /\b(?:all\s+)?(?:nearby\s+)?resonators\s+in\s+the\s+team\s+gain\b/,
    /\ball\s+(?:nearby\s+)?party\s+members\b/,
    /\ball\s+characters\s+nearby\b/,
    /\bnearby\s+party\s+members\b/,
].map(r => r.source).join('|'), 'i');

/** Does this effect's condition describe a buff GRANTED TO the whole team? */
export function isTeamWideBuff(conditionText) {
    return TEAM_RECIPIENT_RE.test(conditionText || '');
}

function emptyTeamBundle() {
    return { atkRatio: 0, critRate: 0, critDmg: 0, energyRegen: 0,
        dmgByElement: {}, dmgBySkillType: {},
        amplifyByElement: {}, amplifyByType: {}, amplifyAll: 0 };
}

/**
 * The team-wide buff bundle a member GIVES the rest of the team — the sum of its
 * unlocked team-wide effects (stat + amplify buckets). v1 applies them at full
 * value for the receiving member's window (most are long intro/outro/skill auras
 * covering a rotation cycle); mode-gated effects respect the build's mode. The
 * member's OWN damage already gets these via its per-step effect resolution, so
 * the team sim applies this bundle only to OTHER members (no double-count).
 *
 * @returns {{atkRatio,critRate,critDmg,energyRegen,dmgByElement,dmgBySkillType,
 *            amplifyByElement,amplifyByType,amplifyAll}}
 */
export function teamWideContribution(build, reso) {
    const mode = build?.resonanceMode ?? null;
    const out = emptyTeamBundle();
    for (const { effect } of unlockedEffects(build, reso)) {
        if (!isTeamWideBuff(effect.condition)) continue;
        if (effect.mode && effect.mode !== mode) continue;        // resonance-mode gate
        const e = scaleEffect(effect, { fireCountByType: new Map() });
        const v = e.value ?? 0;
        if (!(v > 0)) continue;
        switch (e.stat) {
            case 'atkRatio':       out.atkRatio += v; break;
            case 'critRate':       out.critRate += v; break;
            case 'critDmg':        out.critDmg += v; break;
            case 'energyRegen':    out.energyRegen += v; break;
            case 'elementBonus':   if (e.element != null) out.dmgByElement[e.element] = (out.dmgByElement[e.element] || 0) + v; break;
            case 'skillTypeBonus': if (e.skillType) out.dmgBySkillType[e.skillType] = (out.dmgBySkillType[e.skillType] || 0) + v; break;
            case 'amplify':
                if (e.element != null) out.amplifyByElement[e.element] = (out.amplifyByElement[e.element] || 0) + v;
                else if (e.skillType) out.amplifyByType[e.skillType] = (out.amplifyByType[e.skillType] || 0) + v;
                else out.amplifyAll += v;
                break;
            default: break;   // hp/def/atkFlat/healing — out of v1 scope
        }
    }
    return out;
}

/** Sum several team-wide bundles into one (for the union of OTHER members). */
export function mergeTeamBundles(bundles) {
    const out = emptyTeamBundle();
    for (const b of bundles) {
        if (!b) continue;
        out.atkRatio += b.atkRatio || 0;
        out.critRate += b.critRate || 0;
        out.critDmg += b.critDmg || 0;
        out.energyRegen += b.energyRegen || 0;
        for (const [k, v] of Object.entries(b.dmgByElement || {})) out.dmgByElement[k] = (out.dmgByElement[k] || 0) + v;
        for (const [k, v] of Object.entries(b.dmgBySkillType || {})) out.dmgBySkillType[k] = (out.dmgBySkillType[k] || 0) + v;
        for (const [k, v] of Object.entries(b.amplifyByElement || {})) out.amplifyByElement[k] = (out.amplifyByElement[k] || 0) + v;
        for (const [k, v] of Object.entries(b.amplifyByType || {})) out.amplifyByType[k] = (out.amplifyByType[k] || 0) + v;
        out.amplifyAll += b.amplifyAll || 0;
    }
    return out;
}