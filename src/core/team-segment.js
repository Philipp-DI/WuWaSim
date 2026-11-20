// src/core/team-segment.js — the segment seam (roadmap step 6, #104; decided in #50).
//
// A team run is a sequence of segments: each member's Intro, rotation and
// Outro, plus the benched members' off-field actions. Every segment goes
// through `runSegment`, which takes:
//   - the TEAM CONTEXT, read-only: the inputs the team supplies at this point
//     of the fight (target, buff bundles, the team-buff timeline, ...);
//   - the CROSS-SEGMENT CARRY, per member: the running state a character keeps
//     from one segment to the next (trigger fires, gauge levels, gauge clocks),
//     passed in and returned updated.
//
// Which inputs and which carry a kind reads is stated in the two tables below.
// They reproduce today's behaviour, gaps included, on purpose: Intro and Outro
// miss Tune Strain, the teammates' DEF target and the team buffs. Roadmap steps
// 9, 10 and 16 close those gaps one row at a time, each as its own number change.
import { simulateRotation } from './sim.js';
import { effectiveSkillMap } from './skill-map.js';

export const SEGMENT_KIND = Object.freeze({
    INTRO: 'intro',
    ROTATION: 'rotation',
    OFF_FIELD: 'offField',
    OUTRO: 'outro',
});

/**
 * Why a segment produced no result. The caller decides what an absent segment
 * costs; it never has to guess why it is absent.
 */
export const SEGMENT_REASON = Object.freeze({
    NO_INTRO_KEY: 'noIntroKey',
    NO_OUTRO_KEY: 'noOutroKey',
    // The Outro is paid by the off-field lane (an `outro`-triggered action):
    // two paths, one cast (CLAUDE.md, "An Outro Skill has NO level curve").
    OUTRO_PAID_OFF_FIELD: 'outroPaidOffField',
    MISSING_STEPS: 'missingSteps',
    THREW: 'threw',
});

/** The team-context fields each segment kind passes to `simulateRotation`. */
export const TEAM_INPUTS_READ = Object.freeze({
    [SEGMENT_KIND.INTRO]: ['target', 'amplifyContext', 'externalBuffWindows'],
    [SEGMENT_KIND.ROTATION]: ['target', 'amplifyContext', 'enemyStatuses', 'teamBuffs', 'externalBuffWindows', 'tuneStrainAmplify'],
    [SEGMENT_KIND.OFF_FIELD]: ['target', 'enemyStatuses', 'teamBuffs', 'externalBuffWindows', 'tuneStrainAmplify'],
    [SEGMENT_KIND.OUTRO]: ['target', 'externalBuffWindows'],
});

/** The carry fields each kind reads in, and writes back when it produced a result. */
export const CARRY_READ = Object.freeze({
    [SEGMENT_KIND.INTRO]: ['resources', 'resourceTicks'],
    [SEGMENT_KIND.ROTATION]: ['fires', 'resources', 'resourceTicks'],
    [SEGMENT_KIND.OFF_FIELD]: ['fires'],
    [SEGMENT_KIND.OUTRO]: [],
});
export const CARRY_WRITTEN = Object.freeze({
    [SEGMENT_KIND.INTRO]: ['resources', 'resourceTicks'],
    [SEGMENT_KIND.ROTATION]: ['fires', 'resources', 'resourceTicks'],
    [SEGMENT_KIND.OFF_FIELD]: [],
    [SEGMENT_KIND.OUTRO]: [],
});

/** An empty carry for a member who has not played a segment yet. */
export function emptyCarry() {
    return { fires: null, resources: null, resourceTicks: null };
}

/**
 * A member's trigger-fire ledger, moved between the team clock and a segment's
 * local clock. Local times come out NEGATIVE for fires that happened in an
 * earlier team cycle, which is exactly what a 'seconds' window needs to decide
 * how much of itself is left (`carryInFires` in sim.js). Nothing is dropped: a
 * fire too old to matter resolves to a window that has already expired.
 */
function shiftFires(fires, delta) {
    if (!fires) return null;
    return {
        types: fires.types.map(([name, time]) => [name, time + delta]),
        keys: fires.keys.map(([name, time]) => [name, time + delta]),
    };
}

const SIM_PARAM_OF_INPUT = {
    target: 'target', amplifyContext: 'amplifyContext', enemyStatuses: 'enemyStatuses',
    teamBuffs: 'teamBuffs', externalBuffWindows: 'externalBuffWindows', tuneStrainAmplify: 'tuneStrainAmplify',
};

/** Carry (team clock) → `simulateRotation` params (segment clock). */
function carryInParams(kind, carry, startTime) {
    const params = {};
    for (const field of CARRY_READ[kind]) {
        if (field === 'fires') params.carryInFires = shiftFires(carry.fires, -startTime);
        if (field === 'resources') params.carryInResources = carry.resources;
        if (field === 'resourceTicks') params.carryInResourceTicks = carry.resourceTicks;
    }
    return params;
}

/** The carry after a segment that produced `result` (segment clock → team clock). */
function carryOut(kind, carry, result, startTime) {
    const next = { ...carry };
    for (const field of CARRY_WRITTEN[kind]) {
        if (field === 'fires') next.fires = shiftFires(result.fires, startTime);
        if (field === 'resources') next.resources = result.resourceEndLevels;
        if (field === 'resourceTicks') next.resourceTicks = result.resourceEndTickPhases;
    }
    return next;
}

/**
 * The rotation a segment casts. Intro and Outro pick their own key from the
 * kit; rotation and off-field segments arrive with it already built.
 *
 * @returns {{ rotation: string[] } | { reason: string }}
 */
function rotationFor(kind, build, dataset) {
    if (kind === SEGMENT_KIND.INTRO) {
        const introKey = introKeyFor(dataset, build.resonatorId, build);
        return introKey ? { rotation: [introKey] } : { reason: SEGMENT_REASON.NO_INTRO_KEY };
    }
    if (kind === SEGMENT_KIND.OUTRO) {
        const resonator = dataset.resonators?.find(entry => entry.id === build.resonatorId);
        if (resonator?.offFieldActions?.some(action => action.trigger === 'outro')) {
            return { reason: SEGMENT_REASON.OUTRO_PAID_OFF_FIELD };
        }
        const outroKey = outroKeyFor(dataset, build.resonatorId);
        return outroKey ? { rotation: [outroKey] } : { reason: SEGMENT_REASON.NO_OUTRO_KEY };
    }
    return { rotation: build.rotation };
}

/**
 * Run one team segment.
 *
 * @param {string} segmentKind — a SEGMENT_KIND
 * @param {{ build: object }} member — the member's build; for rotation and
 *        off-field segments its `rotation` is the one to cast
 * @param {object} teamContext — read-only: { dataset, timingMode, startTime,
 *        target, amplifyContext, enemyStatuses, teamBuffs, externalBuffWindows,
 *        tuneStrainAmplify }; `startTime` is the segment's start on the team clock
 * @param {object} carry — this member's { fires, resources, resourceTicks }, team clock
 * @returns {{ result: object|null, carry: object, reason?: string }}
 *          `result` is the `simulateRotation` result; null with a `reason`
 *          when the segment produced nothing, and `carry` is then unchanged.
 */
export function runSegment(segmentKind, member, teamContext, carry) {
    const { dataset, timingMode, startTime } = teamContext;
    const cast = rotationFor(segmentKind, member.build, dataset);
    if (cast.reason) return { result: null, carry, reason: cast.reason };

    const params = {
        build: segmentKind === SEGMENT_KIND.ROTATION || segmentKind === SEGMENT_KIND.OFF_FIELD
            ? member.build
            : { ...member.build, rotation: cast.rotation },
        dataset, timingMode,
        ...carryInParams(segmentKind, carry, startTime),
    };
    for (const input of TEAM_INPUTS_READ[segmentKind]) params[SIM_PARAM_OF_INPUT[input]] = teamContext[input];

    // An Intro or Outro that fails is a missing cast, not a failed team: it is
    // reported with a reason and the team run goes on. A rotation or off-field
    // segment that throws is a bug and propagates.
    const isHandoff = segmentKind === SEGMENT_KIND.INTRO || segmentKind === SEGMENT_KIND.OUTRO;
    let result;
    try {
        result = simulateRotation(params);
    } catch (error) {
        if (!isHandoff) throw error;
        return { result: null, carry, reason: SEGMENT_REASON.THREW };
    }
    if (isHandoff && (result.totals.missingSteps > 0 || result.totals.stepCount === 0)) {
        return { result: null, carry, reason: SEGMENT_REASON.MISSING_STEPS };
    }
    return { result, carry: carryOut(segmentKind, carry, result, startTime) };
}

function outroKeyFor(dataset, resonatorId) {
    const skillMap = effectiveSkillMap(dataset, resonatorId);
    if (!skillMap) return null;
    const found = Object.entries(skillMap).find(([key, def]) => !key.startsWith('_') && def?.skillType === 'outro');
    return found ? found[0] : null;
}

// The dict key nanoka assigns a resonator's Intro Skill varies per resonator
// (e.g. 'intro' vs 'intro_time_to_show_some_colors') — look it up by
// skillType rather than assuming a fixed key, so every resonator's
// auto-injected intro segment resolves, not just the ones keyed 'intro'.
//
// THE ROTATION PICKS, when it names one. An Intro node can ship SEVERAL damage
// rows — Aemeath has `intro_songs_across_the_universe` and
// `intro_debut_of_meteoric_radiance`, Denia `intro_it_s_been_a_while` and
// `intro_knock_knock` — and taking whichever the skill map happened to list
// first cast a different Intro than the build asked for. It cost more than a
// label: Aemeath's reference rotation opens on `skill_mech_3`, which the Intro
// she names unlocks and the one the map listed first does not, so the team ran
// a sequence its own validator calls illegal. `withoutAutoCastSteps` then
// removed the authored step, leaving nothing to explain the swap. A rotation is
// performed as authored, and that includes WHICH Intro it authored.
function introKeyFor(dataset, resonatorId, build = null) {
    const skillMap = effectiveSkillMap(dataset, resonatorId);
    if (!skillMap) return null;
    const isIntro = (key) => !key.startsWith('_') && skillMap[key]?.skillType === 'intro';
    const authored = (build?.rotation ?? []).find(isIntro);
    if (authored) return authored;
    return Object.keys(skillMap).find(isIntro) ?? null;
}
