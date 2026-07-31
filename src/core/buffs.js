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
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BUFF-PATH MANIFEST (S5 — mirrors docs/ARCHITECTURE.md §4)
 * ═══════════════════════════════════════════════════════════════════════════
 * A buff flows through exactly ONE application path — the paths are disjoint
 * BY CONSTRUCTION (CLAUDE.md invariant). Adding a buff source means picking
 * its one path below, never duplicating across two.
 *
 * Solo paths (single-resonator sim):
 *   constant   — weapon secondary/passive, echo stats, sonata always-on,
 *                stat nodes, satisfied weapon/sonata conditional clauses
 *                → stats.js resolveTotalStats (buffs/weapon-buffs.js,
 *                  buffs/conditional-buffs.js feed it)
 *   windowed   — chain/inherent effects (trigger × window, THIS module) and
 *                sonata 5pc window buffs + echo auras
 *                (buffs/sonata-buffs.js parse → buffs/buff-windows.js
 *                 computeBuffWindows/applyBuffsToSteps, stack ramps from
 *                 buffs/buff-timeline.js)
 *
 * Team-wide lanes (recipient = whole team; all three disjoint):
 *   LANE 1 — chain/inherent team effects (THIS module):
 *            teamWideWindowSpecs() → windowed via team-sim's
 *            accrueChainEffectWindowsToTimeline (cast events, team time);
 *            teamWideContribution() → the honest FLAT residue for effects
 *            with no derivable timing. One effect appears in exactly one of
 *            the two (partition, never both).
 *   LANE 2 — weapon/sonata conditional clauses with a team recipient:
 *            stats.js weaponSonataTeamWide → team-sim's flat mergeTeamBundles
 *            (window derivation is the documented open item —
 *            docs/TEAM-BUFF-TIMELINE-PLAN.md).
 *   LANE 3 — window-path sonata buffs + echo auras:
 *            the wielder's own sim windows are accrued onto team-sim's
 *            team-buff timeline (accrueSegmentWindowsToTimeline) and later
 *            segments receive them by literal team-time overlap
 *            (timelineWindowsFor → externalBuffWindows).
 *
 * Targeted (NOT team-wide): the Outro→Intro incoming-resonator transfer —
 *   buffs/conditional-buffs.js incomingResonatorContribution, applied flat to
 *   the receiving member's segment only.
 */

import { stateActive } from './rotation-state.js';
import { resourceLevelAt } from './rotation-resources.js';

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

    for (const effect of effects) {
        switch (effect.stat) {
            case 'dmgBonus':
                out.dmgBonus += effect.value;
                break;
            case 'elementBonus':
                if (effect.element == null || effect.element === hit.element) out.dmgBonus += effect.value;
                break;
            case 'skillTypeBonus':
                if (effect.skillType == null || effect.skillType === hit.skillType) out.dmgBonus += effect.value;
                break;
            case 'amplify':
                // Element/skillType-scoped amplify only applies to matching hits
                if ((effect.element == null || effect.element === hit.element) &&
                    (effect.skillType == null || effect.skillType === hit.skillType)) {
                    out.amplify += effect.value;
                }
                break;
            case 'deepen':
                out.deepen += effect.value;
                break;
            case 'critRate':
                out.critRateBonus += effect.value;
                break;
            case 'critDmg':
                out.critDmgBonus += effect.value;
                break;
            case 'atkRatio':
                out.atkRatio += effect.value;
                break;
            case 'healingBonus':
                out.healingBonus += effect.value;
                break;
            case 'multiplierUp':
                // Multiplier increase applies only to matching skill type (or all)
                if (effect.skillType == null || effect.skillType === hit.skillType) {
                    out.multiplierUp += effect.value;
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
function isUnconditional(effect) {
    if (effect.window) return effect.window.type === 'always';
    // Back-compat for data predating the taxonomy.
    return (effect.conditionKind ?? (effect.defaultActive ? 'unconditional' : 'situational')) === 'unconditional';
}

/**
 * The full pool of UNLOCKED chain + inherent effects for a build, each with its
 * stable key. Gating is by node unlock only (chain level / inherent active) —
 * NOT by condition. The step-aware resolver decides per-step activeness.
 *
 * @returns {Array<{ effect:object, key:string }>}
 */
export function unlockedEffects(build, resonator) {
    const out = [];
    const seqLevel = build?.chain ?? build?.sequenceLevel ?? 0;

    for (const chainNode of resonator?.resonanceChain ?? []) {
        if (chainNode.level > seqLevel) continue;
        const effs = chainNode.effects ?? [];
        for (let i = 0; i < effs.length; i++) out.push({ effect: effs[i], key: `S${chainNode.level}.${i}` });
    }
    const inherentActive = build?.inherentSkillsActive ?? [true, true];
    const ihs = resonator?.inherentSkills ?? [];
    for (let nodeIndex = 0; nodeIndex < ihs.length; nodeIndex++) {
        if (inherentActive[nodeIndex] === false) continue;
        const effs = ihs[nodeIndex].effects ?? [];
        for (let i = 0; i < effs.length; i++) out.push({ effect: effs[i], key: `IH${nodeIndex}.${i}` });
    }
    return out;
}

/**
 * Resolve active chain/inherent effects with NO rotation context: only the
 * unconditional ones apply (§A4.5). Used by single-skill damage cards.
 *
 * @param {object} build
 * @param {object} resonator
 * @returns {Array<object>} active (unconditional) effect objects, stack-scaled
 */
export function collectActiveEffects(build, resonator) {
    const resonanceMode = build?.resonanceMode ?? null;
    const ctx = { fireCountByType: new Map(), manualStacks: manualStacksFrom(build) };
    return unlockedEffects(build, resonator)
        .filter(({ effect }) => isUnconditional(effect) && modeGateOk(effect, resonanceMode))
        .map(({ effect, key }) => scaleEffect(effect, ctx, key));
}

// Resonance Mode gate (RESONANCE-MODE-SPEC.md §5). An effect with a build-level
// `mode` is active only when the build's selected mode matches; effects with no
// mode are unaffected. Checked before any window/trigger evaluation.
function modeGateOk(effect, resonanceMode) {
    return !effect.mode || effect.mode === resonanceMode;
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
    return effectsActiveAtStepDetailed(unlocked, ctx).map(x => x.effect);
}

/**
 * Like effectsActiveAtStep, but keeps each active effect paired with its
 * stable slot key (`S<level>.<i>` / `IH<node>.<i>`) so callers can derive
 * per-effect windows (the build page's kit-effect strips).
 *
 * @returns {Array<{ effect:object, key:string }>}
 */
export function effectsActiveAtStepDetailed(unlocked, ctx) {
    const active = [];
    for (const { effect, key } of unlocked) {
        if (isEffectOnAtStep(effect, ctx)) active.push({ effect: scaleEffect(effect, ctx, key), key });
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

// Does the CURRENT step satisfy this trigger? Distinct from castMatchFiredBefore,
// which deliberately asks about STRICTLY EARLIER steps — the ordinary case, where
// a cast opens a window that later steps benefit from. This one is for a buff
// that applies to the triggering cast ITSELF (window 'thisCast').
function castMatchIsThisStep(trigger, ctx) {
    if (ctx.stepKey == null && ctx.stepTypes == null) return false;
    if (Array.isArray(trigger.skillKeys)) return trigger.skillKeys.includes(ctx.stepKey);
    if (trigger.skillType == null) return false;
    return ctx.stepTypes?.includes(trigger.skillType) ?? false;
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

function isEffectOnAtStep(effect, ctx) {
    // Resonance Mode gate first (cheap, build-level): if it fails, inactive
    // regardless of any window/trigger (RESONANCE-MODE-SPEC.md §5).
    if (effect.mode && ctx.resonanceMode !== effect.mode) return false;

    const win = effect.window, trig = effect.trigger;
    // Back-compat for data predating the taxonomy: unconditional on, else off.
    if (!win || !trig) return isUnconditional(effect);

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
                ? win.states.some(stateName => stateActive(ctx.activeStates, stateName))
                : stateActive(ctx.activeStates, win.state);
        case 'persist':
            return trig.type === 'castMatch' ? castMatchFiredBefore(trig, ctx) : false;
        case 'thisCast':
            // ON only for the triggering cast itself: "When casting X, <that
            // cast> gains …" (Changli's Secret Strategist scaling True Sight
            // Conquest/Charge by her Enflamement stacks). 'persist' cannot
            // express this — its castMatch check looks at strictly EARLIER
            // steps, so it would miss the very cast the buff is for and then
            // wrongly apply to every step after it. Curated-only, via
            // data/effect-overrides.json; the parser never emits this window.
            return trig.type === 'castMatch' && castMatchIsThisStep(trig, ctx);
        case 'seconds': {
            if (trig.type !== 'castMatch' || (trig.skillKeys == null && trig.skillType == null)) return false;
            const lastEnd = mostRecentFireEnd(trig, ctx);
            return lastEnd != null && ctx.startTime + 1e-9 < lastEnd + win.seconds;
        }
        case 'untilConsumed': {
            // ON from the trigger's most recent fire until a CONSUMING cast
            // happens ("the next X consumes this buff"). win.consumedBy uses
            // the same identifier shape as triggers ({skillKeys} or
            // {skillType}); re-triggering after consumption re-arms the buff.
            // Authored via data/effect-overrides.json (2026-07-05).
            if (trig.type !== 'castMatch' || (trig.skillKeys == null && trig.skillType == null)) return false;
            const tEnd = mostRecentFireEnd(trig, ctx);
            if (tEnd == null) return false;
            const cEnd = win.consumedBy ? mostRecentFireEnd(win.consumedBy, ctx) : null;
            return cEnd == null || cEnd < tEnd;
        }
        default:
            return false;
    }
}

/**
 * Manual per-effect stack counts from a build, as `scaleEffect` expects them.
 * Keys use the effectToggles key format (CLAUDE.md invariant):
 * `S{level}.{index}` for chain effects, `IH{node}.{index}` for inherent ones.
 * Non-numeric / negative entries are dropped rather than coerced.
 *
 * @param {object} build
 * @returns {Map<string, number>}
 */
export function manualStacksFrom(build) {
    const out = new Map();
    for (const [key, raw] of Object.entries(build?.effectStacks ?? {})) {
        const count = Number(raw);
        if (Number.isFinite(count) && count >= 0) out.set(key, Math.trunc(count));
    }
    return out;
}

/**
 * Unlocked stackable effects whose stack count the rotation CANNOT derive, each
 * with the user's own count when one is set. One row per effect the sim would
 * otherwise credit a bare single stack for.
 *
 * This is what the build editor's stack stepper renders. Showing the row is the
 * point: an underivable number must be visible and fixable, never a silent
 * assumption buried in the damage total (2026-07-31 precedent — a correct-but-
 * unexplained number reads as a broken app).
 *
 * Mode-gated effects the build's mode excludes are omitted, matching every other
 * resolver here.
 *
 * @param {object} build
 * @param {object} resonator
 * @returns {Array<{ key, stat, element, skillType, perStack, maxStacks,
 *                   stacks, stacksSource, condition }>}
 */
export function underivableStacks(build, resonator, resourceNames = null) {
    const resonanceMode = build?.resonanceMode ?? null;
    const manualStacks = manualStacksFrom(build);
    const out = [];
    for (const { effect, key } of unlockedEffects(build, resonator)) {
        if (!effect.stackable) continue;
        if (!modeGateOk(effect, resonanceMode)) continue;
        const trigger = effect.stackTrigger;
        // A gauge-scaled effect is derivable only when the resonator actually
        // HAS a curated definition for that gauge; without one the rotation
        // still cannot answer, so the row stays and the stepper applies.
        const fromResource = trigger?.type === 'resource'
            && (resourceNames == null || resourceNames.has(String(trigger.resource ?? '').toLowerCase()));
        const derivable = fromResource
            || (trigger?.type === 'castMatch' && trigger.skillType != null);
        const manual = manualStacks.get(key);
        if (derivable && manual == null) continue;      // the rotation answers this one
        out.push({
            key,
            stat: effect.stat,
            element: effect.element ?? null,
            skillType: effect.skillType ?? null,
            perStack: effect.perStack,
            maxStacks: effect.maxStacks ?? null,
            stacks: manual ?? 1,
            stacksSource: manual != null ? 'manual' : 'unknown',
            condition: effect.condition ?? '',
        });
    }
    return out;
}

/**
 * Stack-scale an effect. Non-stackable → returned unchanged.
 *
 * Stack count, in precedence order:
 *   1. the user's own count for this slot (`build.effectStacks`, via
 *      ctx.manualStacks) — capped at maxStacks when one is known;
 *   2. a `resource` stackTrigger → the named gauge's level entering this step
 *      (ctx.resourceLevels), divided by what one stack costs;
 *   3. a resolvable castMatch stackTrigger → number of fires so far
 *      (ctx.fireCountByType), capped at maxStacks;
 *   4. none of those → ONE stack, flagged `stacksUnknown`.
 *
 * On (2): the gauge is the exact count, so it is NOT capped at maxStacks — the
 * gauge's own `cap` already bounds it, and the two agree by construction
 * (Changli holds up to 4 Enflamement and her buff reads up to 4 stacks). A
 * gauge with no curated definition returns null, which falls through to (4)
 * rather than reading as an empty gauge — "no definition" and "empty" must stay
 * distinguishable.
 *
 * On (4): the count is genuinely underivable, not zero and not the ceiling.
 * Most remaining stack sources are things the rotation does not describe — a
 * Havoc Bane count on the target (Yangyang: Xuanling), how many distinct
 * teammates cast an Echo Skill (Sigrika), a resource gauge with no curated
 * definition (Changli). Crediting `maxStacks` here would silently multiply a
 * buff by its ceiling: Lynae's Premixed Hue is 55% per stack to 25 stacks, so
 * the difference between the floor and the ceiling is +55% vs +1375% Spectro
 * DMG on an assumption the app cannot support. So it credits the conservative
 * floor and SAYS it did — a number the app cannot derive must be visible as
 * underivable, never quietly picked (2026-07-31; mirrors the zeroReason
 * precedent, see docs/HISTORY.md). The build editor's stack stepper is how the
 * user supplies the real count, which is then path (1).
 *
 * Every scaled effect carries `stacks` and `stacksSource`
 * ('manual' | 'derived' | 'unknown') so the UI can render provenance.
 */
function scaleEffect(effect, ctx, key = null) {
    if (!effect.stackable) return effect;
    const cap = effect.maxStacks ?? null;
    const capped = (count) => (cap != null ? Math.min(count, cap) : count);

    const manual = key != null ? ctx.manualStacks?.get(key) : undefined;
    if (manual != null) {
        const stacks = capped(manual);
        return { ...effect, value: effect.perStack * stacks, stacks, stacksSource: 'manual' };
    }

    const stackTrigger = effect.stackTrigger;
    if (stackTrigger && stackTrigger.type === 'resource') {
        const level = resourceLevelAt(ctx.resourceLevels, stackTrigger.resource, ctx.stepIndex);
        if (level != null) {
            const stacks = Math.floor(level / (stackTrigger.perStackCost ?? 1));
            return { ...effect, value: effect.perStack * stacks, stacks, stacksSource: 'resource' };
        }
    }
    if (stackTrigger && stackTrigger.type === 'castMatch' && stackTrigger.skillType != null) {
        const stacks = capped(ctx.fireCountByType.get(stackTrigger.skillType) ?? 0);
        return { ...effect, value: effect.perStack * stacks, stacks, stacksSource: 'derived' };
    }

    return { ...effect, value: effect.perStack, stacks: 1, stacksSource: 'unknown', stacksUnknown: true };
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
].map(regex => regex.source).join('|'), 'i');

/** Does this effect's condition describe a buff GRANTED TO the whole team? */
export function isTeamWideBuff(conditionText) {
    return TEAM_RECIPIENT_RE.test(conditionText || '');
}

function emptyTeamBundle() {
    return { atkRatio: 0, critRate: 0, critDmg: 0, energyRegen: 0,
        dmgByElement: {}, dmgBySkillType: {},
        amplifyByElement: {}, amplifyByType: {}, amplifyAll: 0 };
}

// Can this team-wide effect's activation be derived as REAL time windows?
// Requires a resolvable castMatch trigger (a mechanical skillType or exact
// skillKeys) + a seconds window + a stat kind the per-step window path can
// apply (atk / element-DMG / skill-type-DMG / amplify). Everything else stays
// in the FLAT bundle: unconditional always-on auras (genuinely
// timing-independent), unresolved-trigger effects (no honest timing
// derivable — e.g. Sanhua/Baizhi S6), and crit kinds (a post-hoc damage
// multiplier can't express a crit-mix change). 11/16 roster team-wide
// effects are windowable as of 2026-07-15.
function isWindowableTeamEffect(effect) {
    return effect.trigger?.type === 'castMatch'
        && (effect.trigger.skillType != null || Array.isArray(effect.trigger.skillKeys))
        && effect.window?.type === 'seconds' && effect.window.seconds > 0
        && (effect.stat === 'atkRatio' || effect.stat === 'elementBonus'
            || effect.stat === 'skillTypeBonus' || effect.stat === 'amplify');
}

/**
 * The FLAT team-wide buff bundle a member GIVES the rest of the team — the sum
 * of its unlocked team-wide effects whose timing CANNOT be honestly windowed
 * (see isWindowableTeamEffect; windowable effects moved to
 * teamWideWindowSpecs + team-sim.js's team-buff timeline, 2026-07-15).
 * Mode-gated effects respect the build's mode. The member's OWN damage already
 * gets these via its per-step effect resolution, so the team sim applies this
 * bundle only to OTHER members (no double-count).
 *
 * @returns {{atkRatio,critRate,critDmg,energyRegen,dmgByElement,dmgBySkillType,
 *            amplifyByElement,amplifyByType,amplifyAll}}
 */
export function teamWideContribution(build, resonator) {
    const mode = build?.resonanceMode ?? null;
    const out = emptyTeamBundle();
    const ctx = { fireCountByType: new Map(), manualStacks: manualStacksFrom(build) };
    for (const { effect, key } of unlockedEffects(build, resonator)) {
        if (!isTeamWideBuff(effect.condition)) continue;
        if (effect.mode && effect.mode !== mode) continue;        // resonance-mode gate
        if (isWindowableTeamEffect(effect)) continue;             // → timeline path
        const scaled = scaleEffect(effect, ctx, key);
        const value = scaled.value ?? 0;
        if (!(value > 0)) continue;
        switch (scaled.stat) {
            case 'atkRatio':       out.atkRatio += value; break;
            case 'critRate':       out.critRate += value; break;
            case 'critDmg':        out.critDmg += value; break;
            case 'energyRegen':    out.energyRegen += value; break;
            case 'elementBonus':   if (scaled.element != null) out.dmgByElement[scaled.element] = (out.dmgByElement[scaled.element] || 0) + value; break;
            case 'skillTypeBonus': if (scaled.skillType) out.dmgBySkillType[scaled.skillType] = (out.dmgBySkillType[scaled.skillType] || 0) + value; break;
            case 'amplify':
                if (scaled.element != null) out.amplifyByElement[scaled.element] = (out.amplifyByElement[scaled.element] || 0) + value;
                else if (scaled.skillType) out.amplifyByType[scaled.skillType] = (out.amplifyByType[scaled.skillType] || 0) + value;
                else out.amplifyAll += value;
                break;
            default: break;   // hp/def/atkFlat/healing — out of v1 scope
        }
    }
    return out;
}

// Window-path bonusKind for a windowable team effect's stat (see
// isWindowableTeamEffect — only these four kinds pass the partition).
const TEAM_EFFECT_BONUS_KIND = {
    atkRatio: 'atk', elementBonus: 'element', skillTypeBonus: 'dmgType', amplify: 'amplify',
};

/**
 * WINDOWABLE team-wide chain/inherent effects as trigger specs (2026-07-15):
 * everything team-sim.js needs to derive REAL activation windows from the
 * member's team-time cast events (each trigger fire opens
 * [fireEnd, fireEnd + seconds]; overlapping fires merge — the same "most
 * recent fire" semantics isEffectOnAtStep uses for the wielder's own copy).
 * Disjoint with teamWideContribution by the SAME predicate — an effect is in
 * exactly one of the two, never both.
 *
 * @returns {Array<{key, label, bonusPct, bonusKind, element, dmgType,
 *   triggerSkillType, triggerSkillKeys, seconds, raw}>}
 */
export function teamWideWindowSpecs(build, resonator) {
    const mode = build?.resonanceMode ?? null;
    const specs = [];
    const ctx = { fireCountByType: new Map(), manualStacks: manualStacksFrom(build) };
    for (const { effect, key } of unlockedEffects(build, resonator)) {
        if (!isTeamWideBuff(effect.condition)) continue;
        if (effect.mode && effect.mode !== mode) continue;
        if (!isWindowableTeamEffect(effect)) continue;
        const scaled = scaleEffect(effect, ctx, key);
        const value = scaled.value ?? 0;
        if (!(value > 0)) continue;
        const kind = TEAM_EFFECT_BONUS_KIND[scaled.stat];
        specs.push({
            key,
            label: key.startsWith('IH') ? `Inherent ${key.split('.')[0]}` : `Chain ${key.split('.')[0]}`,
            bonusPct: value,
            bonusKind: kind === 'dmgType' ? 'unknown' : kind,
            element: kind === 'element' ? scaled.element : null,
            dmgType: kind === 'dmgType' ? scaled.skillType : null,
            triggerSkillType: scaled.trigger.skillType ?? null,
            triggerSkillKeys: Array.isArray(scaled.trigger.skillKeys) ? scaled.trigger.skillKeys : null,
            seconds: scaled.window.seconds,
            raw: scaled.condition ?? '',
        });
    }
    return specs;
}

// NOTE (2026-07-15): the former sonataTeamWideContribution (flat-full-value
// distribution of the sonata window-path family, 2026-07-14) was REPLACED by
// team-sim.js's team-buff TIMELINE: teammates now receive these buffs as
// real windows (externalBuffWindows), credited by literal team-time overlap —
// see docs/TEAM-BUFF-TIMELINE-PLAN.md. Its 'healing' supportTable gate became
// unnecessary too: a non-healer wielding a heal-triggered set simply never
// opens a window in the actual sim (stackTimeline finds no stepHeal gains).

/** Sum several team-wide bundles into one (for the union of OTHER members). */
export function mergeTeamBundles(bundles) {
    const out = emptyTeamBundle();
    for (const bundle of bundles) {
        if (!bundle) continue;
        out.atkRatio += bundle.atkRatio || 0;
        out.critRate += bundle.critRate || 0;
        out.critDmg += bundle.critDmg || 0;
        out.energyRegen += bundle.energyRegen || 0;
        for (const [k, value] of Object.entries(bundle.dmgByElement || {})) out.dmgByElement[k] = (out.dmgByElement[k] || 0) + value;
        for (const [k, value] of Object.entries(bundle.dmgBySkillType || {})) out.dmgBySkillType[k] = (out.dmgBySkillType[k] || 0) + value;
        for (const [k, value] of Object.entries(bundle.amplifyByElement || {})) out.amplifyByElement[k] = (out.amplifyByElement[k] || 0) + value;
        for (const [k, value] of Object.entries(bundle.amplifyByType || {})) out.amplifyByType[k] = (out.amplifyByType[k] || 0) + value;
        out.amplifyAll += bundle.amplifyAll || 0;
    }
    return out;
}