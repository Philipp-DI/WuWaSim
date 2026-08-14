/**
 * Derived opener padding (2026-07-12) — the honest cold-start model.
 *
 * Maintainer direction (partially revoking "energy never gates damage" for
 * the team path): a rotation whose Liberation can't actually be cast at that
 * point must not contribute as-is to team damage. Instead of hand-curating
 * ~50 opener rotations (the P12 kit-blind-synthesizer trap), the opener is
 * DERIVED mechanically: when a consuming Liberation arrives with a short
 * projected gauge, splice in k repetitions of the member's OWN pre-Liberation
 * cycle — the shortfall becomes real filler TIME (and real filler damage/
 * generation), not fabricated Liberation damage. ~~Steady-state passes need no
 * padding by construction~~ (see below), so the ER breakpoint (`minViableEr`,
 * computed over an UNPADDED run) keeps its meaning: "the ER at which the
 * authored rotation loops clean".
 *
 * THAT "BY CONSTRUCTION" IS FALSE, and measurably so (2026-08-14). It holds only
 * for a rotation that pays for its own Liberations. One that does NOT
 * self-sustain arrives short on EVERY pass, is padded on every pass, and this
 * stops being a cold-start model at all: measured on the arabwuwa
 * Chisa/Denia/Aemeath rotations, pass 2 runs 39.64s against a clean steady state
 * of 29.86s, and passes 2 and 3 do not even agree with each other (openers OFF,
 * they are byte-identical). The arithmetic is right — Chisa's rotation generates
 * 25.3 Resonance Energy against a 125 cost, because the steady-state rotation a
 * guide publishes omits the Resonance Skill and assumes the gauge is already
 * flowing — but the RESULT is filler forever, which is not what a reader of the
 * word "opener" expects. `docs/OPEN-ITEMS.md` item 2c owns the decision.
 *
 * The projection mirrors team-energy.js's accumulation rule exactly
 * (castability judged before the cast's own generation; reset to 0 on cast;
 * gain = base × own ER, capped at the cost): the padding computed here is
 * what the reported memberEnergy trace will confirm.
 *
 * Filler model (2026-07-11 — CD-aware greedy, replacing the former
 * fixed-cycle-×k loop that looped ONLY the pre-Liberation prefix and so spun a
 * kit's weakest hits when its energy generators sat after the Liberation, e.g.
 * Aero Rover's ~313s pathology). Mirrors how a player actually charges a
 * Liberation: at each step cast the highest-yield ability that is OFF COOLDOWN
 * — the whole rotation's cooldown-gated generators (Resonance Skills) plus the
 * equipped Echo Skill — and fill the gaps between cooldowns with the CD-free
 * basic chain (universal, CD-free in the data, cold-start valid).
 *
 * FORTE GAUGE (Lever 2, 2026-07-11): when the member has real BinData Forte data
 * (`dataset.forte` → `forteCap` + per-skill `forteGen`, from
 * tools/extract-forte.mjs), the greedy tracks the Forte gauge, uses Forte
 * GENERATORS (incl. `forte_*` fillers like Aero Rover's Cloudburst) to build it,
 * and fires the PAYOFF ability (the "big gainer") at full gauge — closing the
 * ~60% generation gap the maintainer measured in-game (opener ~68s → realistic).
 * Without Forte data the greedy is UNCHANGED: `forte_*` casts stay excluded, so
 * uncovered kits honestly over-pad rather than fabricating a payoff, and never
 * regress. When nothing generates energy, or the farm would exceed
 * `MAX_FILLER_TIME`, the Liberation is GATED instead: the cast and its
 * cost-free continuation stages are dropped from the pass and reported, never
 * silently kept.
 */

import { resolveStepDuration, resolveFreezeTime, ECHO_STEP_KEY,
    TUNE_BREAK_STEP_KEY, TUNE_BREAK_CAST_TIME } from './sim.js';

const EPS = 1e-6;

// Compute bound, not a game rule: beyond this much filler per insertion the
// Liberation is gated (dropped + flagged) instead of padded. Deliberately
// generous — a long farm is still honestly performable and the DPS penalty
// already carries the cost (e.g. a 125-cost healer ult over a ~7-energy
// basic cycle legitimately needs ~60s at 100% ER); the bound only stops
// pathological near-zero-generation kits from exploding the segment.
export const MAX_FILLER_TIME = 120;

// The character's plain basic chain (stage-1 family walked upward), the
// universal cold-start-safe filler fallback. Multi-form kits (e.g. Hiyuki's
// present/fore forms) yield the FIRST stage-1 family in data order — the
// default form.
function basicChainOf(skillMap) {
    const entries = Object.entries(skillMap).filter(([k, def]) => !k.startsWith('_') && def?.skillType === 'basic');
    const stage1 = entries.find(([k]) => /_1$/.test(k));
    if (!stage1) return entries.length ? [entries[0][0]] : [];
    const family = stage1[0].replace(/_1$/, '');
    const chain = [];
    for (let stage = 1; skillMap[`${family}_${stage}`]; stage++) chain.push(`${family}_${stage}`);
    return chain;
}

// Default echo-skill cooldown when the equipped echo generates energy but its
// data carries no cooldown — keeps the greedy from casting it every step.
const DEFAULT_ECHO_CD = 8;

// Skill types that can never be scheduled as cold-start filler: Forte-gauge-
// gated casts (needs a Forte model), and swap-/resource-bound casts.
const FILLER_EXCLUDED_TYPES = new Set(['forte_basic', 'forte_heavy', 'liberation', 'intro', 'outro']);

const isForteType = (type) => type === 'forte_basic' || type === 'forte_heavy';

/**
 * Greedily build the shortest realistic filler that raises `gauge` to `cost`
 * from the member's own generation (2026-07-11 — replaces the fixed-cycle-×k
 * loop). At each step cast the highest-yield ability that is OFF COOLDOWN (the
 * rotation's cooldown-gated Resonance Skills + the equipped Echo Skill), else
 * fill with the CD-free basic chain.
 *
 * FORTE LAYER (Lever 2, gated on `forteCap > 0` — real BinData; else this is
 * byte-for-byte the non-Forte greedy, so uncovered kits never regress): Forte
 * GENERATORS (abilities with `forteGen > 0`, incl. `forte_*` fillers like Aero
 * Rover's Cloudburst) enter the pool and build a tracked Forte gauge; the moment
 * it reaches `forteCap`, the PAYOFF (a `forte_*` ability with high `energyGen`
 * that isn't itself a generator — the "big gainer") fires, emitting its energy
 * and spending the gauge. Every candidate (Forte generators AND basics) is
 * ranked by full-CHAIN throughput — `(energyGen + forteShare·bestPayoff) /
 * (stepDuration + forteShare·bestPayoffActionableAt)` — so a Forte filler is only
 * preferred when the "fill gauge → cash payoff" loop genuinely beats a fast
 * basic on energy-per-second (this is what keeps the layer from ever
 * regressing). The ranking now runs on MEASURED animation times for most of the
 * roster (docs/TIMING_MODEL.md), so the fill-and-cash loop is chosen on real
 * throughput rather than the per-type estimates it used to be opportunistic on.
 *
 * @returns {?{ sequence:string[], time:number, reached:boolean }}
 *   null only when the kit has NO positive generator at all.
 */
function greedyFiller({ rotation, skillMap, dataset, echoEnergyGain, echoCooldown, echoLockTime = 0, er, gauge, cost, forteCap = 0, readySeed = null }) {
    const genOf   = (k) => k === ECHO_STEP_KEY ? echoEnergyGain : (skillMap[k]?.energyGen ?? 0);
    const ctOf    = (k) => k === ECHO_STEP_KEY ? echoLockTime : resolveStepDuration(skillMap[k], dataset);
    const forteOf = (k) => k === ECHO_STEP_KEY ? 0 : Math.max(0, skillMap[k]?.forteGen ?? 0);
    const forteModel = forteCap > 0;
    // A Tune Break is MANUAL and generates nothing, so it can never be filler.
    // It is excluded by key rather than by its (absent) skillMap entry, so the
    // exclusion says why.
    const rotKeys = [...new Set(rotation)]
        .filter(k => k !== ECHO_STEP_KEY && k !== TUNE_BREAK_STEP_KEY);

    // Cooldown-gated generators the kit actually uses (Resonance Skills), plus
    // the equipped Echo Skill.
    const cdPool = rotKeys
        .filter(k => skillMap[k]?.cooldown > 0 && !FILLER_EXCLUDED_TYPES.has(skillMap[k]?.skillType) && genOf(k) > EPS)
        .map(k => ({ key: k, gen: genOf(k), ct: ctOf(k), cd: skillMap[k].cooldown, forte: forteModel ? forteOf(k) : 0 }));
    if (echoEnergyGain > EPS) {
        cdPool.push({ key: ECHO_STEP_KEY, gen: echoEnergyGain, ct: echoLockTime, cd: echoCooldown > 0 ? echoCooldown : DEFAULT_ECHO_CD, forte: 0 });
    }
    // Forte generators (incl. Forte-gated fillers) not already in the CD pool.
    const inCd = new Set(cdPool.map(action => action.key));
    const forteGens = forteModel
        ? rotKeys.filter(k => forteOf(k) > EPS && !inCd.has(k))
            .map(k => ({ key: k, gen: genOf(k), ct: ctOf(k), cd: skillMap[k]?.cooldown ?? 0, forte: forteOf(k) }))
        : [];
    // Payoffs: forte_* abilities that spend rather than build the gauge.
    const payoffs = forteModel
        ? rotKeys.filter(k => isForteType(skillMap[k]?.skillType) && forteOf(k) <= EPS && genOf(k) > EPS)
            .map(k => ({ key: k, gen: genOf(k), ct: ctOf(k), cd: skillMap[k]?.cooldown ?? 0 }))
            .sort((actionA, actionB) => actionB.gen - actionA.gen)
        : [];
    const bestPayoff = payoffs[0]?.gen ?? 0;
    const bestPayoffCt = payoffs[0]?.ct ?? 0;

    const chain = basicChainOf(skillMap).filter(k => genOf(k) > EPS || forteOf(k) > EPS);
    const pool = [...cdPool, ...forteGens];
    if (pool.length === 0 && chain.length === 0 && payoffs.length === 0) return null;

    // Rank by effective energy PER SECOND (the opener minimises TIME). A Forte
    // generator is credited with the payoff share it builds toward — but the
    // payoff's OWN cast time is amortized into the denominator too, so the full
    // "fill Forte → cash payoff" CHAIN throughput is compared fairly against a
    // fast basic. A slow filler that only unlocks a slow payoff correctly loses
    // (this is what keeps the Forte layer from ever regressing the opener).
    const eff = (action) => {
        const share = action.forte > 0 ? action.forte / forteCap : 0;
        return (action.gen + share * bestPayoff) / Math.max(action.ct + share * bestPayoffCt, EPS);
    };
    // key → filler-local time it next comes off cooldown. SEEDED from the
    // authored prefix (readySeed) so the filler can't re-cast an ability the
    // rotation JUST used — e.g. the Echo Skill cast right before a consuming
    // Liberation (2026-07-15 fix; previously this map started empty, so the
    // filler fired the Echo Skill again immediately, ignoring its cooldown).
    const ready = { ...(readySeed ?? {}) };
    const sequence = [];
    let time = 0, currentGauge = gauge, forte = 0, chainIndex = 0;
    while (currentGauge + EPS < cost && time <= MAX_FILLER_TIME) {
        // Cash in a full Forte gauge the moment the payoff is available.
        const payoff = (forteModel && forte + EPS >= forteCap)
            ? payoffs.find(payoff => (ready[payoff.key] ?? 0) <= time + EPS) : null;
        let step;
        if (payoff) {
            step = payoff; if (step.cd) ready[step.key] = time + step.cd; forte = 0;
        } else {
            // Every candidate — off-cooldown pool abilities AND the next basic —
            // competes on throughput. (The basic chain is not a mere fallback: a
            // fast basic must be able to beat a slow Resonance/Forte cast.)
            const cands = pool.filter(action => (ready[action.key] ?? 0) <= time + EPS);
            if (chain.length) {
                const basicKey = chain[chainIndex % chain.length];
                cands.push({ key: basicKey, gen: genOf(basicKey), ct: ctOf(basicKey), forte: forteModel ? forteOf(basicKey) : 0, basic: true });
            }
            if (!cands.length) break;
            cands.sort((x, y) => eff(y) - eff(x));
            step = cands[0];
            if (step.basic) chainIndex++;
            else if (step.cd) ready[step.key] = time + step.cd;
            if (step.forte > 0) forte = Math.min(forte + step.forte, forteCap);
        }
        currentGauge = Math.min(currentGauge + step.gen * er, cost);
        time += step.ct;
        sequence.push(step.key);
    }
    return { sequence, time: time, reached: currentGauge + EPS >= cost };
}

/**
 * Derive the padded (or gated) rotation for one member's pass.
 *
 * @param {object}  args
 * @param {string[]} args.rotation      — authored rotation (intro/outro already stripped)
 * @param {object}  args.skillMap       — effectiveSkillMap for this resonator
 * @param {object}  args.dataset        — for resolveStepDuration defaults
 * @param {number}  [args.echoEnergyGain=0] — equipped slot-0 echo's base energy per cast
 * @param {number}  [args.echoCooldown=0]   — that echo's cooldown (s); 0 → DEFAULT_ECHO_CD
 * @param {number}  [args.echoLockTime=0]   — timeline time the echo step occupies
 *   (sim.js's echoStepTimeOf: 0 for a parallel Summon / direct-attack echo,
 *   ECHO_CAST_TIME for a Transform echo that locks the resonator). Defaults to
 *   the parallel case, which is the majority of the roster.
 * @param {number}  [args.forteCap=0]       — Forte-gauge cap (dataset.forte); 0 → no Forte model
 * @param {number}  args.er             — the member's built Energy Regen (1.0 = 100%)
 * @param {?number} args.liberationCost — baseStats energyMax; null = not evaluable
 * @param {number}  [args.gaugeStart=0] — energy carried into this pass (team ledger)
 * @param {string}  [args.timingMode='toa'] — docs/TIMING_MODEL.md two-clock
 *   mode. The `tNow`/readySeed axis below tracks gameTime (what cooldowns tick
 *   against), so a cast's freezeTime shortens its own advance in 'toa' mode.
 * @returns {?object} null when nothing changes (no cost known / no consuming
 *   Liberation / no deficit); otherwise
 *   { rotation, fillerIndices, insertions: [{ beforeKey, sequence, addedTime }],
 *     gated: [{ key, deficit, reason }] }
 */
export function deriveOpenerPadding({ rotation, skillMap, dataset, echoEnergyGain = 0, echoCooldown = 0, echoLockTime = 0, forteCap = 0, er, liberationCost, gaugeStart = 0, timingMode = 'toa' }) {
    if (liberationCost == null || liberationCost <= 0 || !rotation?.length) return null;

    const genOf = (key) => key === ECHO_STEP_KEY ? echoEnergyGain
        : key === TUNE_BREAK_STEP_KEY ? 0
        : (skillMap[key]?.energyGen ?? 0);
    const ctOf  = (key) => key === ECHO_STEP_KEY ? echoLockTime
        : key === TUNE_BREAK_STEP_KEY ? TUNE_BREAK_CAST_TIME
        : resolveStepDuration(skillMap[key], dataset);
    // resolveFreezeTime needs the stepDuration (it clamps the freeze to it, and
    // the fraction fallback scales by it) and the liberationCost (its cinematic
    // gate) — passing neither silently zeroed every estimated freeze here while
    // the sim applied it, so the two clocks disagreed on cooldown readiness.
    const ftOf  = (key) => key === ECHO_STEP_KEY || key === TUNE_BREAK_STEP_KEY ? 0
        : resolveFreezeTime(skillMap[key], dataset, ctOf(key), liberationCost);
    const cdOf  = (key) => key === ECHO_STEP_KEY ? (echoCooldown > 0 ? echoCooldown : DEFAULT_ECHO_CD)
        : key === TUNE_BREAK_STEP_KEY ? 0
        : (skillMap[key]?.cooldown ?? 0);
    const out = [], fillerIndices = [], insertions = [], gated = [];
    let gauge = gaugeStart;
    let i = 0;

    // Absolute time + last-cast-start of every ability, tracked across BOTH the
    // authored steps AND spliced filler, so a Liberation's filler is seeded with
    // the cooldowns still running from everything cast before it (the Echo Skill
    // in particular — see greedyFiller's readySeed). Tracks gameTime, not
    // realTime (docs/TIMING_MODEL.md): a cast's freezeTime is subtracted in
    // 'toa' mode, since cooldowns (what readySeed feeds) tick against gameTime.
    let tNow = 0;
    const lastCast = new Map();
    // One animation's freeze counts once, exactly as sim.js's
    // resolveFreezeSchedule does it — several keys can share one montage, and a
    // repeated key is a genuine re-cast that freezes again.
    const freezeCreditedTo = new Map();
    const freezeOf = (key) => {
        const freeze = ftOf(key);
        const source = skillMap[key]?.freezeSource;
        if (!(freeze > 0) || !source) return freeze > 0 ? freeze : 0;
        if (!freezeCreditedTo.has(source)) freezeCreditedTo.set(source, key);
        return freezeCreditedTo.get(source) === key ? freeze : 0;
    };
    const record = (key) => {
        lastCast.set(key, tNow);
        tNow += ctOf(key) - (timingMode === 'toa' ? freezeOf(key) : 0);
    };

    while (i < rotation.length) {
        const key = rotation[i];
        const def = skillMap[key];
        const consuming = def?.skillType === 'liberation' && def.consumesResource !== false;

        if (consuming && gauge + EPS < liberationCost) {
            const deficit = liberationCost - gauge;
            // Remaining cooldown (filler-local, i.e. relative to tNow) of every
            // CD ability still cooling down from the authored prefix.
            const readySeed = {};
            for (const [k, castT] of lastCast) {
                const remaining = castT + cdOf(k) - tNow;
                if (remaining > EPS) readySeed[k] = remaining;
            }
            const filler = greedyFiller({ rotation, skillMap, dataset, echoEnergyGain, echoCooldown, echoLockTime, forteCap, er, gauge, cost: liberationCost, readySeed });

            if (!filler || !filler.reached) {
                // Gate: the cast can't honestly happen — drop it and its
                // contiguous cost-free continuation stages, and report why.
                gated.push({ key, deficit, reason: !filler ? 'no-filler' : 'unreachable' });
                i++;
                while (i < rotation.length &&
                       skillMap[rotation[i]]?.skillType === 'liberation' &&
                       skillMap[rotation[i]]?.consumesResource === false) i++;
                continue;
            }

            insertions.push({ beforeKey: key, sequence: [...filler.sequence], addedTime: filler.time });
            for (const fillerKey of filler.sequence) {
                fillerIndices.push(out.length);
                out.push(fillerKey);
                gauge = Math.min(gauge + genOf(fillerKey) * er, liberationCost);
                record(fillerKey);
            }
            // fall through: gauge is at cost now — the Liberation executes.
        }

        // Same event order as team-energy.js applyEnergyEvent: a consuming
        // cast resets the gauge, THEN its own generation lands, capped.
        if (consuming) gauge = 0;
        gauge = Math.min(gauge + genOf(key) * er, liberationCost);
        out.push(key);
        record(key);
        i++;
    }

    if (insertions.length === 0 && gated.length === 0) return null;
    return { rotation: out, fillerIndices, insertions, gated };
}
