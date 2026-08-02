// src/core/buff-windows.js
/**
 * Buff-window machinery for the rotation sim (split from sim.js — S4.4).
 *
 * computeBuffWindows derives every window the rotation opens (sonata
 * conditional buffs, echo auras, external/team windows); applyBuffsToSteps
 * scales each step's damage by the windows covering it (the MATH);
 * deriveBuffWindows/deriveEffectWindows/deriveStateWindows produce the
 * window shapes the build page renders; windowStacksAtStep is the ONE
 * stack-count authority shared by damage scaling and display, so the two
 * can never disagree. shortBuffLabel/fmtPctTrim are the label formatters
 * for window names (used by sim + team-sim output, not DOM code).
 */
import { parseSonataBuffs, isIncomingResonatorBuff } from './sonata-buffs.js';
import { stackTimeline, groupStackingBuffs } from './buff-timeline.js';
import { canSatisfyCondition } from '../triggerability.js';

/**
 * Derive contiguous buff windows from per-step `activeBuffNames` (P11 §3c).
 * A window opens when a name first appears and closes when it disappears.
 *
 * @param {Array<object>} steps — steps carrying { index, startTime, endTime, activeBuffNames }
 * @returns {Array<{name, startStep, endStep, startTime, endTime}>}
 */
export function deriveBuffWindows(steps) {
    if (!Array.isArray(steps) || steps.length === 0) return [];
    const open = new Map();   // name → { startStep, startTime }
    const windows = [];
    for (const step of steps) {
        const names = new Set(step.activeBuffNames ?? []);
        // Close windows for buffs that ended at this step.
        for (const [name, window] of open) {
            if (!names.has(name)) {
                windows.push({ name, startStep: window.startStep, endStep: step.index - 1,
                    startTime: window.startTime, endTime: step.startTime });
                open.delete(name);
            }
        }
        // Open windows for buffs that just started.
        for (const name of names) {
            if (!open.has(name)) open.set(name, { startStep: step.index, startTime: step.startTime });
        }
    }
    // Close anything still open at end of rotation.
    const last = steps[steps.length - 1];
    for (const [name, window] of open) {
        windows.push({ name, startStep: window.startStep, endStep: last.index,
            startTime: window.startTime, endTime: last.endTime });
    }
    return windows;
}

/**
 * Contiguous windows for CONDITIONAL chain/inherent effects, one per effect
 * activation span (2026-07-05). `endReason` names why the window closed —
 * derived from the effect's window type ('consumed' for untilConsumed,
 * 'expired' for seconds, 'state ended' for stateBound, 'rotation end' when it
 * was still on at the last step).
 *
 * @returns {Array<{ key, effect, startStep, endStep, start, end, endReason }>}
 */
export function deriveEffectWindows(unlocked, effectKeysByStep, steps) {
    if (!Array.isArray(steps) || steps.length === 0) return [];
    const byKey = new Map(unlocked.map(entry => [entry.key, entry.effect]));
    const makeWindow = (key, startStep, endStep, openEnd) => {
        const effect = byKey.get(key) ?? null;
        const windowType = effect?.window?.type;
        const endReason = openEnd ? 'rotation end'
            : windowType === 'untilConsumed' ? 'consumed'
            : windowType === 'seconds' ? 'expired'
            : windowType === 'stateBound' ? 'state ended'
            : 'ended';
        return { key, effect, startStep: steps[startStep].index, endStep: steps[endStep].index,
                 start: steps[startStep].startTime, end: steps[endStep].endTime, endReason };
    };
    const windows = [];
    const open = new Map();   // key → start index into steps
    for (let i = 0; i < steps.length; i++) {
        const on = effectKeysByStep[i] ?? new Set();
        for (const [key, startIdx] of open) {
            if (!on.has(key)) { windows.push(makeWindow(key, startIdx, i - 1, false)); open.delete(key); }
        }
        for (const key of on) if (!open.has(key)) open.set(key, i);
    }
    for (const [key, startIdx] of open) windows.push(makeWindow(key, startIdx, steps.length - 1, true));
    windows.sort((windowA, windowB) => windowA.startStep - windowB.startStep || String(windowA.key).localeCompare(String(windowB.key)));
    return windows;
}

/**
 * Contiguous windows for character STATES (rotation-state.js timeline), with
 * the closer identified (2026-07-05): `endReason` is 'consumed' when the step
 * that ended the span matches the state's exit keys/types (consumedBy /
 * secondsOrConsumedBy), 'expired' for timed/duration exits, 'until rotation
 * end' for persist states still on at the end. `consumedBy` carries the
 * consuming step's skill key when applicable.
 *
 * `enteredBy` names the cast that OPENED the span (2026-08-01) — the state
 * strip used to show only a name and a duration, leaving the reader to guess
 * which step started it by eyeballing the strip against the rotation rail. The
 * rail is laid out by label width, not time, so that comparison is meaningless
 * and reliably points at the wrong cast. `null` for a state that is on from
 * step 0 with no entering cast (initiallyActive stances).
 *
 * @returns {Array<{ name, startStep, endStep, start, end, endReason, consumedBy, enteredBy }>}
 */
export function deriveStateWindows(stateTimeline, stateDefs, rotation, skillMap, steps) {
    if (!Array.isArray(steps) || steps.length === 0 || !stateDefs?.length) return [];
    const defByName = new Map(stateDefs.map(def => [def.name.toLowerCase(), def]));
    const windows = [];
    for (const name of stateTimeline.states) {
        const def = defByName.get(name);
        let start = null;
        for (let i = 0; i <= steps.length; i++) {
            const active = i < steps.length && (stateTimeline.activeAt[i]?.has(name) ?? false);
            if (active && start == null) start = i;
            if (!active && start != null) {
                windows.push(mkStateWindow(name, def, start, i - 1, i, rotation, skillMap, steps));
                start = null;
            }
        }
    }
    windows.sort((windowA, windowB) => windowA.startStep - windowB.startStep || windowA.name.localeCompare(windowB.name));
    return windows;
}

export function mkStateWindow(name, def, startStep, endStep, closerIdx, rotation, skillMap, steps) {
    let endReason = 'until rotation end';
    let consumedBy = null;
    const exitMatchesKey = (key) => {
        const exit = def?.exit;
        const type = skillMap?.[key]?.skillType ?? null;
        const formulaType = skillMap?.[key]?.formulaType ?? null;
        return !!exit && (
            (exit.keys?.includes(key) ?? false)
            || (exit.types?.includes(type) ?? false)
            || (exit.types?.includes(formulaType) ?? false)
        );
    };
    // A uses-budget exit (rotation-state.js exit.uses) ends AFTER the cast that
    // spends the last use, so the closer is that cast ITSELF — the last ACTIVE
    // step — not the first inactive one. Reading the closer there would name an
    // unrelated step and report "expired" for a state a cast actually consumed.
    const budgetSpender = def?.exit?.uses != null && exitMatchesKey(rotation[endStep])
        ? rotation[endStep] : null;
    if (budgetSpender) { endReason = 'consumed'; consumedBy = budgetSpender; }
    else if (closerIdx < steps.length) {
        const key = rotation[closerIdx];
        const exit = def?.exit;
        if (exitMatchesKey(key)) { endReason = 'consumed'; consumedBy = key; }
        else if (exit?.mode === 'seconds' || exit?.mode === 'secondsOrConsumedBy'
            || exit?.mode === 'duration' || exit?.mode === 'consumedByThenSeconds') endReason = 'expired';
        else endReason = 'ended';
    } else if (def?.exit?.mode && def.exit.mode !== 'persist') {
        endReason = 'active at rotation end';
    }
    // The opening step is an ENTERING cast only if it actually matches the
    // state's enter trigger — a state that was already on before this span
    // (initiallyActive, or one re-opened by a timer rather than a cast) has no
    // entering cast to name, and guessing one would be worse than saying none.
    const openKey = rotation[startStep];
    const enter = def?.enter;
    const openType = skillMap?.[openKey]?.skillType ?? null;
    const openFormulaType = skillMap?.[openKey]?.formulaType ?? null;
    const enteredBy = enter && (
        (enter.keys?.includes(openKey) ?? false)
        || (enter.types?.includes(openType) ?? false)
        || (enter.types?.includes(openFormulaType) ?? false)
    ) ? openKey : null;
    // Time axis: a state ENTERED by a cast opens at that cast's END, the same
    // convention castMatch buff windows use and the same instant the state's own
    // `seconds` timer starts from (rotation-state.js step 3). Drawing it from the
    // cast's START instead put the strip's left edge on the PREVIOUS step's
    // endpoint — which is where the rotation chart plots that step's dot, so
    // Aemeath's Stardust appeared to begin at the Mech Stage 4 before her
    // Liberation. A state with no entering cast still opens at its step's start.
    const start = enteredBy ? steps[startStep].endTime : steps[startStep].startTime;
    return { name, startStep: steps[startStep].index, endStep: steps[endStep].index,
             start, end: Math.max(start, steps[endStep].endTime),
             endReason, consumedBy, enteredBy };
}

// Scale each step's damage by any conditional buffs active during it.
// Mutates the steps array in place. A step is affected when its startTime
// is within a window. Element buffs apply only to hits whose element matches
// the buff's element; atk / unknown buffs apply to the whole step.
export function applyBuffsToSteps(steps, buffWindows) {
    if (!buffWindows.length) return;

    for (const step of steps) {
        if (!step.resolved || step.stepDamage <= 0) continue;

        // Sum applicable bonus fractions by kind for this step's time.
        // Different sonatas stack additively within the same kind (matches
        // WuWa's additive DMG bonus model).
        let elementBonus = 0;   // applies to hits matching the buff element
        let elementId = null;
        let flatBonus = 0;   // atk / generic — applies to whole step
        let amplify = 0;     // DMG amplification (echo team auras) — its own
                             // MULTIPLICATIVE layer per hit, matching how
                             // amplify composes in the per-hit formula path.
        let dmgTypeBonus = null;   // per-DMG-TYPE bonus ("+25% Basic Attack DMG")
                                   // — matched against each HIT's formula
                                   // skillType (the DMG-bonus bucket invariant),
                                   // NOT applied whole-step (2026-07-15 fix; a
                                   // dmgType window used to fall into flatBonus
                                   // and over-credit non-matching hits).

        for (const window of buffWindows) {
            if (window.bonusPct <= 0) continue;
            // Active stack count at this step (ramp/decay/cap for stacking buffs,
            // flat for always-on). 0 → not active here.
            const stk = windowStacksAtStep(window, step);
            if (stk <= 0) continue;

            if (window.bonusKind === 'element' && window.element) {
                // Only the matching element accumulates; mixed-element windows
                // are rare, so last-wins on elementId is acceptable.
                elementBonus += window.bonusPct * stk;
                elementId = window.element;
            } else if (window.bonusKind === 'amplify') {
                amplify += window.bonusPct * stk;
            } else if (window.dmgType) {
                (dmgTypeBonus ??= {})[window.dmgType] = (dmgTypeBonus[window.dmgType] ?? 0) + window.bonusPct * stk;
            } else {
                // atk / unknown → whole-step multiplier
                flatBonus += window.bonusPct * stk;
            }
        }

        if (elementBonus === 0 && flatBonus === 0 && amplify === 0 && !dmgTypeBonus) continue;

        // Rescale each hit. element bonus only multiplies matching-element hits.
        let newExpected = 0, newCrit = 0, newNonCrit = 0;
        let anyApplied = false;
        for (const hit of step.resolved.hits) {
            const hitElement = hit.skill?.element ?? null;
            let multiplier = 1 + flatBonus;
            if (elementBonus > 0 && hitElement === elementId) { multiplier += elementBonus; }
            if (dmgTypeBonus) { multiplier += dmgTypeBonus[hit.skill?.skillType] ?? 0; }
            multiplier *= 1 + amplify;
            if (multiplier !== 1) anyApplied = true;

            newExpected += hit.result.expected * multiplier;
            newCrit += hit.result.crit * multiplier;
            newNonCrit += hit.result.nonCrit * multiplier;
        }

        if (!anyApplied) continue;   // element-guard zeroed everything out

        step.stepDamage = newExpected;
        step.stepCrit = newCrit;
        step.stepNonCrit = newNonCrit;
        step.buffed = true;
    }
}

// One window per logical sonata buff. A buff with a stack cap ramps over its
// qualifying casts and decays — modeled per-step via buff-timeline.js
// (`stacksByStepIndex`), NOT applied at max stacks for the whole window. A buff
// listing several triggers (e.g. "Basic OR Heavy Attack") is grouped into ONE
// window over the UNION of triggers so its bonus is credited once, not per
// trigger phrase.
export function computeBuffWindows(build, dataset, steps, enemyStatuses = null) {
    if (!steps.length) return [];

    // Find active conditional buffs from the resolved sonata metadata.
    // The sonataContribution in stats.js already filters to active tiers
    // (count >= pieces); we just need to know which sonatas are active.
    const echoes = build.echoes ?? [];
    const sonataCounts = {};
    for (const echo of echoes) {
        if (echo?.sonataId != null) sonataCounts[echo.sonataId] = (sonataCounts[echo.sonataId] || 0) + 1;
    }

    const allBuffs = [];
    for (const [idStr, count] of Object.entries(sonataCounts)) {
        const sonata = dataset.sonatas.find(sonata => sonata.id === Number(idStr));
        if (!sonata) continue;
        for (const tier of sonata.tiers) {
            if (count < tier.pieces) continue;
            const parsed = parseSonataBuffs(tier);
            for (const buff of parsed) {
                allBuffs.push({
                    sonataId: sonata.id,
                    sonataName: sonata.name,
                    pieces: tier.pieces,
                    ...buff,
                });
            }
        }
    }

    // Echo shield/aura team buff (2026-07-15, e.g. Bell-Borne Geochelone "+10%
    // DMG Boost for the current team members", 15s): the wielder's own copy is
    // a normal windowed buff — trigger 'echo' (one gain per __echo__ cast), the
    // shield's real duration, 'amplify' kind (a universal per-hit multiplier,
    // exact under applyBuffsToSteps' multiplicative amplify factor). Teammates
    // receive it via team-sim.js's team-buff timeline, built from this SAME
    // window — one derivation for self, teammates, and display.
    const slot0 = echoes[0];
    const echoDef = slot0?.id != null ? dataset.echoes?.find(echo => echo.id === slot0.id) : null;
    const echoTb = echoDef?.activeSkill?.teamBuff;
    if (echoTb?.dmgBoost > 0) {
        allBuffs.push({
            sonataId: `echo-${echoDef.id}`, sonataName: `${echoDef.name} (Echo)`, pieces: 0,
            trigger: 'echo', duration: echoTb.duration ?? 15, bonusPct: echoTb.dmgBoost,
            bonusKind: 'amplify', element: null, dmgType: null, stacks: 1,
            raw: `${echoDef.name}: DMG Boost for the current team members`,
            teamWide: true,
        });
    }
    if (allBuffs.length === 0) return [];

    // Resonator (for triggerability gating below).
    const resonator = dataset.resonators?.find(resonator => resonator.id === build?.resonatorId);

    // Gate before grouping so a group's surviving triggers are all creditable.
    const gated = allBuffs.filter(buff => {
        // Triggerability gate: a buff whose activation requires a STATUS the kit
        // can't inflict (e.g. a Glacio-Chafe set on a non-Chafe resonator) must
        // NOT be credited on a solo build — regardless of which secondary cast
        // trigger the parser latched onto. canSatisfyCondition passes everything
        // that isn't status-gated, so action-triggered buffs are unaffected.
        if (!canSatisfyCondition(resonator, dataset, buff.raw, enemyStatuses)) return false;
        // Incoming-resonator transfer guard (2026-07-14): a buff scoped to the
        // NEXT/incoming resonator (Moonlit Clouds / Pact of Neonlight Leap "ATK
        // of the next Resonator …") is NOT the wielder's — it's modeled by
        // conditional-buffs.js incomingResonatorContribution at the team level.
        // (Latent until the detectBonusKind broadening classified these ATK
        // transfers as 'atk' instead of the 'unknown' that used to drop them.)
        if (isIncomingResonatorBuff(buff.raw)) return false;
        // Unclassified-buff guard: if the parser learned nothing about WHAT the
        // buff boosts (no element, no damage type, kind 'unknown'), don't credit
        // it — applyBuffsToSteps would otherwise apply it as a flat whole-step
        // multiplier, over-valuing sets whose bonus is a mechanic the sim doesn't
        // model (e.g. Empyrean Anthem's "Coordinated Attack DMG +80%" on a
        // non-coordinated carry). Better to omit than to over-credit.
        // ('amplify' is never parser-derived — only the structured echo team
        // buff above sets it — so allowing it can't leak unknowns through.)
        if (buff.bonusKind !== 'element' && buff.bonusKind !== 'atk' && buff.bonusKind !== 'amplify'
            && !buff.dmgType && buff.element == null) return false;
        return true;
    });

    const lastEnd = steps[steps.length - 1].endTime;
    const windows = [];
    for (const buff of groupStackingBuffs(gated)) {
        const meta = {
            sonataId: buff.sonataId, sonataName: buff.sonataName, pieces: buff.pieces,
            trigger: buff.triggerTypes.join('+') || 'unknown', label: shortBuffLabel(buff),
            bonusPct: buff.bonusPct, bonusKind: buff.bonusKind, element: buff.element, dmgType: buff.dmgType,
            stacks: buff.stacks, raw: buff.raw,
            // Structurally team-wide buffs (the echo team buff) carry the flag
            // explicitly; parsed sonata buffs are classified from raw text
            // downstream (team-sim.js, isTeamWideBuff) as before.
            ...(buff.teamWide ? { teamWide: true } : {}),
        };

        const realTriggers = buff.triggerTypes.filter(triggerType => triggerType !== 'unknown');
        if (realTriggers.length === 0) {
            // No recognised cast trigger → applied always-on at full stacks
            // (best available; nothing to ramp against).
            windows.push({ ...meta, start: 0, end: lastEnd });
            continue;
        }

        // Stack timeline: per-step active stack count (ramp + decay + cap),
        // built over the union of the buff's triggers. A trigger never cast in
        // the rotation contributes nothing (gains.length === 0).
        const timeline = stackTimeline(steps, { triggerTypes: realTriggers, maxStacks: buff.stacks ?? 1, duration: buff.duration ?? 15 });
        if (timeline.gains.length === 0) continue;
        windows.push({ ...meta, start: timeline.start, end: timeline.end, stacksByStepIndex: timeline.byStepIndex });
    }
    return windows;
}

// Active stack count of a buff window at a given step. Timeline windows carry a
// per-step map (ramp/decay/cap); always-on windows use their flat stack count.
// Exported so team-sim.js can build team-time-shifted per-step stack samples
// from the same rich windows this module already computes (2026-07-14) —
// one source of truth for "how many stacks at step N", never re-derived.
export function windowStacksAtStep(window, step) {
    if (window.stacksByStepIndex) return window.stacksByStepIndex[step.index] ?? 0;
    if (step.startTime + 1e-6 < window.start || step.startTime >= window.end) return 0;
    return window.stacks ?? 1;
}

// One decimal place ONLY when the value isn't already a whole percent — a
// per-stack magnitude like Havoc Eclipse's 7.5% must never round to "8%"
// (2026-07-14 maintainer report), but a plain "20%" shouldn't grow a
// pointless ".0".
export function fmtPctTrim(value) {
    const text = value.toFixed(1);
    return text.endsWith('.0') ? text.slice(0, -2) : text;
}

// Phrasing matches sonata-buffs.js's DAMAGE_TYPE_PATTERNS exactly (e.g. "Heavy
// Attack DMG", not just "Heavy DMG") so a downstream label-text-only consumer
// (team-editor-v2.js, which never sees the structured ParsedBuff) can still
// re-detect the damage type via detectDamageType(label).
export const DMG_TYPE_LABEL = {
    basic: 'Basic Attack', heavy: 'Heavy Attack', skill: 'Resonance Skill',
    liberation: 'Resonance Liberation', echo: 'Echo', intro: 'Intro Skill', outro: 'Outro Skill',
};

// Exported (2026-07-15): team-sim.js reuses this to label chain-effect
// team-buff windows ("+20% ATK") — one label convention for every buff strip.
export function shortBuffLabel(buff) {
    const pct = buff.bonusPct > 0 ? `+${fmtPctTrim(buff.bonusPct * 100)}%` : '';
    if (buff.bonusKind === 'element' && buff.element) {
        const names = ['', 'Glacio', 'Fusion', 'Electro', 'Aero', 'Spectro', 'Havoc'];
        return `${pct} ${names[buff.element]} DMG`.trim();
    }
    if (buff.bonusKind === 'atk') return `${pct} ATK`.trim();
    if (buff.bonusKind === 'amplify') return `${pct} DMG`.trim();
    if (buff.dmgType) return `${pct} ${DMG_TYPE_LABEL[buff.dmgType]} DMG`.trim();
    return pct || 'Buff';
}
