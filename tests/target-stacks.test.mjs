/**
 * Target stacks with a per-source internal cooldown (2026-10-03, OPEN-ITEMS 2's
 * "ICD-gated enemy debuff").
 *
 *   node tests/target-stacks.test.mjs
 *
 * Galbrena's Oathbound Hunt needs three properties at once that no existing
 * stack source has together: a per-SOURCE rate limit, a per-stack lifetime, and
 * a cap. A `RESOURCE_DEFS` gauge has no rate limit and never decays;
 * `stackTimeline` decays but grants on every qualifying cast and matches on the
 * mechanical category; a `castMatch` stackTrigger just counts fires.
 *
 * THE ICD IS PER LISTED SKILL, not per category, and the kit's own closing
 * sentence is the proof rather than an assumption: "Resonance Skill - Encroach
 * and Resonance Skill - Ravage are considered the same type of skill" says
 * NOTHING under a per-category reading — both are mechanically Resonance Skills
 * and both read the Heavy bucket (maintainer-confirmed, and visible in the
 * game's own row labels: "Resonance Skill: Encroach" and "Resonance Skill:
 * Ravage · Forte Circuit", where the trailing marker is provenance). Under a
 * per-skill reading it does real work: two names that would otherwise each
 * carry their own 5s.
 *
 * The load-bearing subtlety is ORDERING. A step's start time IS the previous
 * step's end time, so an application and the next cast share one number and must
 * count — that is how a stack reaches the cast it was inflicted for. But a
 * Liberation FREEZES gameTime, so its own gameEnd equals its gameStart, and a
 * purely time-based test lets that cast credit the stack it inflicted itself.
 * Measured on her real rotation before the fix: her Liberation read 4 where 3
 * were standing. No epsilon separates the two cases, so applications carry a
 * step INDEX and a step counts only strictly earlier ones. That is what the
 * `own cast` assertions below pin.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { computeTargetStackTimeline, targetStackAt } from '../src/core/target-stacks.js';
import { TARGET_STACK_DEFS, targetStackDefsForResonator } from '../src/core/rotation-rules.js';
import { simulateRotation } from '../src/core/sim.js';
import { createBuild } from '../src/core/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const references = JSON.parse(readFileSync(resolve(__dirname, '../data/reference-rotations.json'), 'utf8'));
const rotationsById = references.rotations ?? references;
const target = { level: 90, resistances: { 1: 0.1, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 } };

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── The mechanism, on a synthetic def ────────────────────────────────────────
{
    const def = [{
        name: 'Mark', cap: 3, stackSeconds: 10, icdSeconds: 5,
        groups: [{ name: 'A', keys: ['alpha', 'alt'] }, { name: 'B', keys: ['beta'] }],
    }];
    // One second per step, so index i starts at i and ends at i+1.
    const times = (count) => ({
        gameStart: Array.from({ length: count }, (unused, i) => i),
        gameEnd: Array.from({ length: count }, (unused, i) => i + 1),
    });
    const levels = (rotation) => computeTargetStackTimeline(rotation, def, times(rotation.length)).get('mark');

    assert('with no step times the timeline is INERT, never guessed',
        JSON.stringify(computeTargetStackTimeline(['alpha', 'alpha'], def).get('mark')) === '[0,0]');
    assert('a key in no group never applies',
        JSON.stringify(levels(['nothing', 'nothing', 'nothing'])) === '[0,0,0]');
    // alpha ends at 1 and applies there; step 1 starts at 1 and must SEE it —
    // the previous step's end is this step's start.
    assert('an application reaches the very next step',
        JSON.stringify(levels(['alpha', 'nothing'])) === '[0,1]');
    // Repeating ONE skill is rate-limited: only the first of three applies.
    assert('the same source is capped at one application per icdSeconds',
        JSON.stringify(levels(['alpha', 'alpha', 'alpha', 'alpha', 'nothing'])) === '[0,1,1,1,1]');
    // Two keys in ONE group share the cooldown — the kit's Encroach/Ravage merge.
    assert('two keys of one group share the cooldown',
        JSON.stringify(levels(['alpha', 'alt', 'alt', 'nothing'])) === '[0,1,1,1]');
    // DIFFERENT sources build far faster, which is the whole mechanic.
    assert('different sources each apply, so alternating builds faster',
        JSON.stringify(levels(['alpha', 'beta', 'nothing'])) === '[0,1,2]');
    // After the ICD elapses the same source applies again (alpha at 1, then at 6).
    assert('the same source applies again once its cooldown elapses',
        levels(['alpha', 'nothing', 'nothing', 'nothing', 'nothing', 'alpha', 'nothing']).at(-1) === 2);
    // Lifetime: alpha applies at 1, dies at 11, so a step starting at 11 is empty.
    const decayed = levels(['alpha', ...Array(11).fill('nothing')]);
    assert('a stack expires stackSeconds after it landed',
        decayed[10] === 1 && decayed[11] === 0);
    assert('the cap bounds the held total',
        levels(['alpha', 'beta', 'nothing']).every(level => level <= 3));

    // targetStackAt keeps "not modelled" and "empty" distinguishable, which is
    // what lets scaleEffect fall through to the underivable path rather than
    // silently reading an unmodelled stack as zero.
    const timeline = computeTargetStackTimeline(['alpha', 'nothing'], def, times(2));
    assert('targetStackAt returns the level for a modelled stack',
        targetStackAt(timeline, 'Mark', 1) === 1);
    assert('a name is matched case-insensitively', targetStackAt(timeline, 'mArK', 1) === 1);
    assert('an unmodelled stack reads null, NOT zero',
        targetStackAt(timeline, 'Nothing Like This', 1) === null);
    assert('a missing timeline reads null', targetStackAt(null, 'Mark', 0) === null);
}

// ── Galbrena's curated def states the kit, not the rotations ─────────────────
{
    const def = targetStackDefsForResonator(1208)[0];
    assert('Fated End is curated for Galbrena', def?.name === 'Fated End');
    assert('cap 4, 5.5s per stack, 5s ICD — all from her clause',
        def.cap === 4 && def.stackSeconds === 5.5 && def.icdSeconds === 5);
    assert('twelve listed entries collapse to ELEVEN groups after the kit\'s own merge',
        def.groups.length === 11);
    const merged = def.groups.find(group => group.keys.length === 2
        && group.keys.includes('skill_encroach') && group.keys.includes('forte_heavy_ravage'));
    assert('Encroach and Ravage share one group, which is the merge the kit states', !!merged);
    // Every curated key must be a real skillMap key, or a group silently never fires.
    const skillMap = dataset.autoSkillMap['1208'];
    const unknown = def.groups.flatMap(group => group.keys).filter(key => !skillMap[key]);
    assert(`every group key exists in autoSkillMap (${unknown.join(', ') || 'none missing'})`,
        unknown.length === 0);
    // No key may sit in two groups — it would then apply twice per cast.
    const all = def.groups.flatMap(group => group.keys);
    assert('no key belongs to two groups', new Set(all).size === all.length);
    // The def is the KIT's list; it deliberately includes Dodge Counter, which no
    // authored rotation casts (it needs a well-timed dodge, so it is not on
    // demand). Stating it keeps the def about the kit rather than the rotations.
    assert('Dodge Counter is listed, as the kit lists it',
        def.groups.some(group => group.keys.includes('basic_dodge_counter_blood_for_blood')));
    // A BARE CATEGORY NAME COVERS THE WHOLE CATEGORY (maintainer, 2026-10-03):
    // "when a certain exact ability isn't listed, it refers to the whole
    // category". So the bare "Mid-air Attack" entry holds the Forte mid-air too —
    // Hellsent Barrage is a Mid-air Attack reached through the Forte Circuit,
    // which its own label says. An earlier draft of this test asserted the
    // opposite, on the grounds that her S1/S6 clauses name the Forte mid-air
    // explicitly; the category rule outranks that.
    const midair = def.groups.find(group => group.name === 'Mid-air Attack');
    assert('the bare "Mid-air Attack" entry covers the whole category, Forte included',
        midair.keys.length === 4
        && midair.keys.filter(key => key.includes('hellsent_barrage')).length === 2
        && midair.keys.filter(key => key.includes('ashfall_barrage')).length === 2);
    // The same rule, the other way: Basic Attack covers all four basic stages,
    // while Dodge Counter — mechanically a Basic Attack — has its OWN group,
    // because the kit lists it separately and that carves it out of the category.
    // Measured in game: a Dodge Counter applies a stack right after a Basic.
    const basics = def.groups.find(group => group.name === 'Basic Attack');
    assert('Basic Attack covers all four stages, sharing one cooldown',
        basics.keys.length === 4 && basics.keys.every(key => /^basic_basic_attack_[1-4]$/.test(key)));
    assert('Dodge Counter is its OWN group, not folded into Basic Attack',
        !basics.keys.includes('basic_dodge_counter_blood_for_blood'));
    assert('exactly one resonator needs this mechanism today',
        Object.keys(TARGET_STACK_DEFS).length === 1);
}

// ── Her real rotation: the ICD bites, and no cast credits itself ─────────────
{
    const rotation = rotationsById['1208']?.rotation ?? [];
    const resonator = dataset.resonators.find(entry => entry.id === 1208);
    const build = createBuild(resonator);
    build.rotation = rotation;
    const out = simulateRotation({ build, dataset, target });
    const stepTimes = {
        gameStart: out.steps.map(step => step.gameStartTime),
        gameEnd: out.steps.map(step => step.gameEndTime),
    };
    const levels = computeTargetStackTimeline(rotation, targetStackDefsForResonator(1208), stepTimes)
        .get('fated end');

    assert('she opens with no stacks held', levels[0] === 0);
    assert('the stack count never exceeds its cap of 4', levels.every(level => level <= 4));
    assert('and is never negative', levels.every(level => level >= 0));

    // THE ICD, measured on real timings: her rotation casts Seraphic Execution
    // SEVEN times, all inside one 5s window apart from the re-arm, so the group
    // applies far fewer than seven stacks. Without the ICD every cast would.
    const seraphicCasts = rotation.filter(key => key.startsWith('forte_basic_seraphic_execution')).length;
    assert('her rotation really does repeat one source many times', seraphicCasts >= 6);
    const withoutIcd = computeTargetStackTimeline(rotation,
        [{ ...targetStackDefsForResonator(1208)[0], icdSeconds: 0 }], stepTimes).get('fated end');
    assert('dropping the ICD would credit strictly more stacks somewhere',
        withoutIcd.some((level, i) => level > levels[i]));
    assert('with the ICD she is NOT pinned at the cap for the whole tail',
        levels.some(level => level < 4));

    // THE ORDERING. Her Liberation freezes gameTime, so its own gameEnd equals
    // its gameStart — the one shape where a time-only test lets a cast credit
    // the stack it inflicted itself. It read 4 before the index rule; 3 after.
    const liberationAt = rotation.indexOf('liberation_hellfire_absolution');
    assert('her Liberation is in the rotation and freezes the clock',
        liberationAt > 0
        && out.steps[liberationAt].gameEndTime === out.steps[liberationAt].gameStartTime);
    const beforeLiberation = levels[liberationAt - 1];
    assert('the Liberation does not credit the stack it inflicts itself',
        levels[liberationAt] <= Math.max(beforeLiberation, levels[liberationAt - 1]));
    // The step AFTER it must see that application — later steps do get it.
    assert('the next step DOES see the Liberation\'s own application',
        levels[liberationAt + 1] > levels[liberationAt]);
}

// ── End to end: the effect reads the timeline and scales by it ───────────────
{
    const rotation = rotationsById['1208']?.rotation ?? [];
    const resonator = dataset.resonators.find(entry => entry.id === 1208);
    const effect = resonator.inherentSkills[0].effects[0];
    assert('IH0.0 reads Fated End by name',
        effect.stackTrigger?.type === 'targetStack' && effect.stackTrigger.stack === 'Fated End');
    assert('its values stay the parser\'s own (5% per stack, cap 4, 5.5s)',
        effect.perStack === 0.05 && effect.maxStacks === 4 && effect.stackSeconds === 5.5);
    // The scope is the 21 keys whose LABEL category the clause names — every
    // category except Heavy Attack. Read as damage BUCKETS the clause would be
    // nearly inert, since her kit reads only heavy/echo/intro/outro.
    assert('it is scoped to 21 keys by name', effect.skillKeys?.length === 21);
    const excluded = ['heavy_volley_of_death_1', 'heavy_volley_of_death_2', 'heavy_volley_of_death_3',
        'forte_heavy_flamewing_verdict_1', 'forte_heavy_flamewing_verdict_2', 'forte_heavy_flamewing_verdict_3'];
    assert('every Heavy Attack key is EXCLUDED, which is the one category the clause omits',
        excluded.every(key => !effect.skillKeys.includes(key)));
    assert('both Heavy Attacks still TRIGGER the stack, which is the asymmetry the kit states',
        excluded.every(key => targetStackDefsForResonator(1208)[0]
            .groups.some(group => group.keys.includes(key))));
    assert('the Forte mid-air is affected even though it is not a source',
        effect.skillKeys.includes('forte_heavy_hellsent_barrage_plunging_attack'));

    // It must actually move damage, and only on scoped steps.
    const build = createBuild(resonator);
    build.rotation = rotation;
    const live = simulateRotation({ build, dataset, target });
    const dark = simulateRotation({
        build,
        dataset: {
            ...dataset,
            resonators: dataset.resonators.map(entry => (entry.id !== 1208 ? entry : {
                ...entry,
                inherentSkills: [{ ...entry.inherentSkills[0], effects: [] }, ...entry.inherentSkills.slice(1)],
            })),
        },
        target,
    });
    assert('Oathbound Hunt raises her total damage', live.totals.damage > dark.totals.damage);
    // Step 0 is her Intro, which enters on ZERO stacks, so it must be untouched —
    // the proof that the ramp is real rather than a flat bonus.
    assert('the opening step, entering on zero stacks, is unchanged',
        Math.abs(live.steps[0].stepDamage - dark.steps[0].stepDamage) < 1e-6);
    assert('a later step, entering on stacks, is raised',
        live.steps.at(-1).stepDamage > dark.steps.at(-1).stepDamage);
}

console.log(`\ntarget-stacks: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
