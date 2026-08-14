// src/core/tune-break.js
/**
 * The Tune Strain chain: Shifting → Tune Break → Interfered → damage.
 *
 * ── The mechanic, in the game's own terms ───────────────────────────────────
 *   1. A cast inflicts **Tune Strain - Shifting** on the target (25s).
 *   2. A **Tune Break** on a Shifting target converts it to **Tune Strain -
 *      Interfered**.
 *   3. A resonator who *"can respond to Tune Strain - Interfered"* then gets
 *      *"For each stack of Tune Strain - Interfered on the target, each point
 *      of X's Tune Break Boost increases X's total DMG against the target by
 *      0.12%."*
 *
 * Steps 1 and 3 are derived per resonator from its own Tune Break node
 * (`resonator.tuneBreak.strain`, tools/preprocess/tune-strain.mjs). What lives
 * here is the part that is NOT a template: the Tune Break Boost GRANTS, which
 * sit in scattered chain/inherent/skill nodes with genuinely varied phrasing.
 * There are five, and each carries its quote.
 *
 * ── Why the stack cap needs no curated base ─────────────────────────────────
 * All four responders state the same clause: *"While X is in the team, the max
 * stack limit of Tune Strain - Interfered on a target is increased by 1."* No
 * kit states a base. The limit therefore IS the number of responders on the
 * team — any other base would make four identical statements arbitrary. A solo
 * responder caps the target at 1; a full Denia/Lynae/Luuk team caps it at 3.
 *
 * ── What this deliberately does NOT model ───────────────────────────────────
 * ~~`Off-Tune Buildup Rate` is a real property (`WeaknessMastery` in the game's
 * baseproperty table) and Denia's inherent scales Boost off the part of it that
 * runs over 100%. It reads **0 for every resonator row** — only 7 rows in the
 * whole 2,740-row table carry a value at all — so the grant evaluates to zero
 * and is omitted rather than guessed at.~~
 *
 * CORRECTED 2026-08-14 — the two attributes were swapped, and reading the wrong
 * one is what made both look empty. The client's enum and the game's own sonata
 * buff rows agree:
 *   141 `Proto_BreakWeaknessRatio` = **Off-Tune Buildup Rate**, a PERCENTAGE.
 *       It reads 10000 (100%) on all 2,740 rows — not 0. Halo of Starry
 *       Radiance's "every 1% of Off-Tune Buildup Rate" scales off it with the
 *       game's per-percent divisor (`Ratio 100`).
 *   142 `Proto_WeaknessMastery` = **Tune Break Boost**, counted in POINTS
 *       (`Ratio 1`). It reads 10 on exactly the seven Tune-family responders,
 *       which is this stat's BASE — see TUNE_BREAK_BOOST_GRANTS below.
 * `140 Proto_WeaknessTotalBonus`, the field this module used to read, is 0 on
 * every resonator and non-zero only on 11 enemy rows.
 *
 * The Tune Rupture and Hack families are the same SHAPE but a different payoff:
 * their responders cast a real RESPONSE SKILL (Mornye's Particle Jet, Lynae's
 * Spectral Analysis, Rebecca's Meltdown, Lucy's Data Crash), and those are
 * ordinary damage rows already in the skill map — slottable today, and so not
 * this module's business. Only Tune Strain pays out as a stat.
 */

/**
 * Grants of Tune Break Boost POINTS, ON TOP of the base the resonator ships
 * with (`resonator.tuneBreakBoostBase`, attribute 142 `WeaknessMastery` — 10 for
 * each of the seven Tune-family responders, absent for everyone else).
 *
 * ~~The stat's base is 0 — `WeaknessTotalBonus` reads 0 on 2,729 of the 2,740
 * baseproperty rows, the exceptions being enemies — so a team's total is exactly
 * the sum of what its kits grant.~~ That read the wrong attribute; see the
 * module header. A base of 10 is also what makes Luuk's "every 10 points of Tune
 * Break Boost" pay one tick with no grants at all.
 *
 * `whileInterfered` marks a grant whose stated trigger is a teammate inflicting
 * Shifting. That is implied by the chain having fired at all: Interfered cannot
 * exist without a Shifting mark to convert. Modelling the 15s/30s windows
 * literally would need the inflicting cast's timestamp, which buys nothing here
 * — the grant is live exactly when there is something for it to multiply.
 */
export const TUNE_BREAK_BOOST_GRANTS = Object.freeze({
    // Denia, inherent "Etched Colors":
    //   "- Resonance Mode - Tune Strain: All Resonators in the team gain 10
    //    Tune Break Boost."
    // Mode-gated, permanent, team-wide.
    1211: [
        { points: 10, teamWide: true, mode: 'tune_strain',
          quote: 'Resonance Mode - Tune Strain: All Resonators in the team gain 10 Tune Break Boost.' },
        // Denia S2:
        //   "After a Resonator in the team inflicts Tune Strain - Shifting on
        //    the target, their Tune Break Boost is increased by 20 for 15s"
        { points: 20, teamWide: true, mode: 'tune_strain', minChain: 2, whileInterfered: true,
          quote: 'After a Resonator in the team inflicts Tune Strain - Shifting on the target, '
              + 'their Tune Break Boost is increased by 20 for 15s.' },
    ],
    // Lynae, Forte "Iridescent Splash":
    //   "This skill consumes 3 points of [True Color] and grants all nearby
    //    Resonators in the team 40 points of Tune Break Boost for 30s."
    // Its own cast is the trigger, so it is gated on the skill being in the
    // rotation rather than on the chain.
    1509: [
        { points: 40, teamWide: true, requiresKey: 'forte_basic_iridescent_splash',
          quote: 'Grants all nearby Resonators in the team 40 points of Tune Break Boost for 30s.' },
    ],
    // Rebecca, inherent "Tag, You're It!":
    //   "When a Resonator in the team inflicts Hack - Shifting, their Tune Break
    //    Boost is increased by 30 for 30s."
    // A HACK trigger granting the same stat — Tune Break Boost is one stat, not
    // one per family, so this reaches a Tune Strain responder too.
    1308: [
        { points: 30, teamWide: true, whileInterfered: true,
          quote: 'When a Resonator in the team inflicts Hack - Shifting, their Tune Break Boost '
              + 'is increased by 30 for 30s.' },
    ],
});

/**
 * Extra Interfered stacks a kit applies on top of the base one per Tune Break.
 *
 * The base is one: a Tune Break on a Shifting target makes it Interfered.
 * Denia's S6 is explicit that hers is ON TOP of that ("additionally inflict 1"),
 * which is also the evidence that a base of one exists.
 */
export const INTERFERED_EXTRA_STACKS = Object.freeze({
    // Denia S6: "While Denia is in Resonance Mode - Tune Strain, when Resonators
    // in the team deal Tune Break DMG to Mistuned enemies in Tune Strain -
    // Shifting, they additionally inflict 1 of Tune Strain - Interfered."
    1211: [{ stacks: 1, minChain: 6, mode: 'tune_strain' }],
});

/**
 * A responder's OWN extra amplify against an Interfered target, on top of the
 * per-stack payout. Only Luuk Herssen states one, and unlike the shared clause
 * it is flat rather than per-stack — it reads the Boost points alone.
 */
export const INTERFERED_SELF_AMPLIFY = Object.freeze({
    // Luuk Herssen, inherent "Uncaused Diagnosis":
    //   "When Luuk Herssen's skills directly damage targets affected by Tune
    //    Strain - Interfered, every 10 points of Tune Break Boost he has
    //    Amplifies this instance of damage by 5%, up to 30%."
    // S2 REPLACES the rate rather than adding to it — "Inherent Skill Uncaused
    // Diagnosis is enhanced: … now Amplify this instance of damage by 10%" —
    // so the highest applicable entry wins, the same way a chain-scaled value
    // does elsewhere. S2 restates no cap, so the inherent's 30% stands.
    1510: [
        { perPoints: 10, value: 0.05, cap: 0.30, minChain: 0,
          quote: 'Every 10 points of Tune Break Boost he has Amplifies this instance of damage '
              + 'by 5%, up to 30%.' },
        { perPoints: 10, value: 0.10, cap: 0.30, minChain: 2,
          quote: 'Inherent Skill Uncaused Diagnosis is enhanced: … now Amplify this instance '
              + 'of damage by 10%.' },
    ],
});

/** The flat self-amplify a member gets against an Interfered target. */
export function selfAmplifyFor(member, points) {
    const rules = (INTERFERED_SELF_AMPLIFY[Number(member.resonatorId)] ?? [])
        .filter(rule => (rule.minChain ?? 0) <= (member.chain ?? 0))
        .sort((low, high) => (high.minChain ?? 0) - (low.minChain ?? 0));
    const rule = rules[0];
    if (!rule) return 0;
    return Math.min(rule.cap, Math.floor(points / rule.perPoints) * rule.value);
}

/** Stacks one Tune Break lands, given the members present. */
function stacksPerBreak(members) {
    let stacks = 1;
    for (const member of members) {
        for (const rule of INTERFERED_EXTRA_STACKS[Number(member.resonatorId)] ?? []) {
            if ((rule.minChain ?? 0) > (member.chain ?? 0)) continue;
            if (rule.mode && rule.mode !== member.resonanceMode) continue;
            stacks += rule.stacks;
        }
    }
    return stacks;
}

/**
 * The target's Tune Strain - Interfered stack LIMIT: the sum of what the
 * present responders each contribute (+1 apiece, stated identically by all
 * four). Zero when nobody on the team can respond, which is the common case.
 */
export function interferedCap(members, dataset) {
    let cap = 0;
    for (const member of members) {
        const resonator = dataset?.resonators?.find(entry => entry.id === member.resonatorId);
        cap += resonator?.tuneBreak?.strain?.interferedCapRaise ?? 0;
    }
    return cap;
}

/**
 * Tune Break Boost points one member holds: the base they ship with, plus every
 * grant on the team that reaches them.
 *
 * `dataset` is optional so the existing call sites that only care about grants
 * keep working; without it the base reads 0, which is what this function did
 * before the base was extracted.
 */
export function boostPointsFor(member, members, options = {}) {
    const { interfered = false, keysCast = null, dataset = null } = options;
    let points = dataset?.resonators?.find(entry => entry.id === member.resonatorId)
        ?.tuneBreakBoostBase ?? 0;
    for (const source of members) {
        for (const grant of TUNE_BREAK_BOOST_GRANTS[Number(source.resonatorId)] ?? []) {
            if (!grant.teamWide && source.resonatorId !== member.resonatorId) continue;
            if ((grant.minChain ?? 0) > (source.chain ?? 0)) continue;
            if (grant.mode && grant.mode !== source.resonanceMode) continue;
            if (grant.whileInterfered && !interfered) continue;
            // A grant whose trigger is one specific cast needs that cast to be
            // in the rotation. Absent a rotation to check, it does not apply —
            // never assumed.
            if (grant.requiresKey && !keysCast?.has(grant.requiresKey)) continue;
            points += grant.points;
        }
    }
    return points;
}

/**
 * Resolve the whole chain for one team.
 *
 * @param {object} args
 * @param {Array<{resonatorId, chain, resonanceMode, rotation?}>} args.members
 * @param {object} args.dataset
 * @param {number} args.tuneBreaks   — Tune Breaks this run lands
 * @param {boolean} args.shifting    — is Tune Strain - Shifting on the target
 * @returns {{ cap, stacks, perMember: Map<number, {points, amplify}> }}
 */
export function resolveTuneStrain({ members = [], dataset, tuneBreaks = 0, shifting = false }) {
    const cap = interferedCap(members, dataset);
    const perMember = new Map();
    // No responder, no Tune Break, or no mark to convert → the chain never
    // starts, and every member's amplify is zero.
    const stacks = (cap > 0 && tuneBreaks > 0 && shifting)
        ? Math.min(cap, tuneBreaks * stacksPerBreak(members))
        : 0;

    const keysCast = new Set(members.flatMap(member => member.rotation ?? []));
    for (const member of members) {
        const resonator = dataset?.resonators?.find(entry => entry.id === member.resonatorId);
        const strain = resonator?.tuneBreak?.strain;
        const points = boostPointsFor(member, members, { interfered: stacks > 0, keysCast, dataset });
        // Only a RESPONDER converts points into damage. A teammate can hold
        // Boost points and get nothing for them, which is the kit text: the
        // payout clause lives on the responder's own Tune Break node.
        const perStack = (strain?.respondsToStrain && strain.boostPerPoint > 0)
            ? points * strain.boostPerPoint * stacks
            : 0;
        // The flat branch is gated on the target being Interfered at all, not on
        // the stack count, and it does NOT require the holder to be a responder
        // — Luuk's clause is on his own inherent, not on his Tune Break node.
        const flat = stacks > 0 ? selfAmplifyFor(member, points) : 0;
        perMember.set(member.resonatorId, {
            points, perStack, flat, amplify: perStack + flat,
            responds: !!strain?.respondsToStrain,
        });
    }
    return { cap, stacks, perMember };
}
