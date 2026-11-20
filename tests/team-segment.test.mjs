/**
 * The segment seam: every team segment goes through `runSegment` (roadmap
 * step 6, #104; decided in #50).
 *
 *   node tests/team-segment.test.mjs
 *
 * Pins three things:
 *   1. What each segment kind reads. The tables reproduce today's gaps on
 *      purpose (Intro and Outro get no Tune Strain, no teammates' DEF target,
 *      no team buffs); steps 9, 10 and 16 change one row each, as recorded
 *      number changes, and must update this test when they do.
 *   2. A segment that produces nothing says why, and leaves the carry alone.
 *   3. The carry: read on the segment clock, returned on the team clock.
 * And the status-damage split: team-sim prices a segment by
 * `totals.skillDamage`, never `totals.damage`, because a team has ONE enemy and
 * its own shared timeline owns status damage (CLAUDE.md, "Status damage: solo
 * builds its OWN enemy, teams SHARE one").
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
    runSegment, SEGMENT_KIND, SEGMENT_REASON, TEAM_INPUTS_READ, CARRY_READ, CARRY_WRITTEN, emptyCarry,
} from '../src/core/team-segment.js';
import { representativeMemberBuild } from '../tools/optimize/team-rank.js';
import { DEFAULT_TARGET } from '../src/core/target.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const buildOf = (resonatorId) =>
    representativeMemberBuild(dataset.resonators.find(resonator => resonator.id === resonatorId), dataset);
const context = (overrides = {}) => ({ dataset, timingMode: 'toa', startTime: 0, target: DEFAULT_TARGET, ...overrides });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// ── 1. What each kind reads (today's gaps, pinned) ───────────────────────────
{
    assert('the rotation reads every team input', same(TEAM_INPUTS_READ.rotation,
        ['target', 'amplifyContext', 'enemyStatuses', 'teamBuffs', 'externalBuffWindows', 'tuneStrainAmplify']));
    assert('the Intro misses Tune Strain, statuses and team buffs (steps 9, 16)',
        same(TEAM_INPUTS_READ.intro, ['target', 'amplifyContext', 'externalBuffWindows']));
    assert('the Outro misses those and the outro amplify too (steps 9, 16)',
        same(TEAM_INPUTS_READ.outro, ['target', 'externalBuffWindows']));
    assert('off-field reads all but the incoming amplify',
        same(TEAM_INPUTS_READ.offField, ['target', 'enemyStatuses', 'teamBuffs', 'externalBuffWindows', 'tuneStrainAmplify']));
    assert('carry: rotation reads and writes all three', same(CARRY_READ.rotation, ['fires', 'resources', 'resourceTicks'])
        && same(CARRY_WRITTEN.rotation, ['fires', 'resources', 'resourceTicks']));
    assert('carry: the Intro carries the gauges, not the fires', same(CARRY_READ.intro, ['resources', 'resourceTicks'])
        && same(CARRY_WRITTEN.intro, ['resources', 'resourceTicks']));
    assert('carry: off-field reads the fires and writes nothing', same(CARRY_READ.offField, ['fires'])
        && same(CARRY_WRITTEN.offField, []));
    assert('carry: the Outro neither reads nor writes', same(CARRY_READ.outro, []) && same(CARRY_WRITTEN.outro, []));
    // An input a kind does not read must not reach the sim: a huge amplify on
    // the Outro's context changes nothing.
    const carlotta = buildOf(1107);
    const plain = runSegment(SEGMENT_KIND.OUTRO, { build: carlotta }, context(), emptyCarry());
    const withAmplify = runSegment(SEGMENT_KIND.OUTRO, { build: carlotta },
        context({ tuneStrainAmplify: 5, amplifyContext: [{ scope: { type: 'element', elementId: null }, value: 5 }] }),
        emptyCarry());
    assert(`Carlotta's Outro deals damage (${plain.result?.totals.skillDamage})`, plain.result?.totals.skillDamage > 0);
    assert('an unread input does not reach the Outro',
        withAmplify.result?.totals.skillDamage === plain.result?.totals.skillDamage);
}

// ── 2. Reason codes ──────────────────────────────────────────────────────────
{
    const carry = { fires: null, resources: new Map([['x', 1]]), resourceTicks: null };
    const galbrena = runSegment(SEGMENT_KIND.OUTRO, { build: buildOf(1208) }, context(), carry);
    assert('Galbrena\'s Outro is paid by the off-field lane',
        galbrena.result === null && galbrena.reason === SEGMENT_REASON.OUTRO_PAID_OFF_FIELD);
    const sanhua = runSegment(SEGMENT_KIND.OUTRO, { build: buildOf(1102) }, context(), carry);
    assert('Sanhua has no Outro damage row', sanhua.result === null && sanhua.reason === SEGMENT_REASON.NO_OUTRO_KEY);
    assert('a refused segment returns the carry unchanged', sanhua.carry === carry && galbrena.carry === carry);
    const broken = runSegment(SEGMENT_KIND.INTRO, { build: buildOf(1107) }, context({ dataset: { ...dataset, get baseStats() { throw new Error('forced'); } } }), carry);
    assert(`an Intro that throws says so (got ${broken.reason})`,
        broken.result === null && broken.reason === SEGMENT_REASON.THREW && broken.carry === carry);
}

// ── 3. The carry crosses the clock ───────────────────────────────────────────
{
    const denia = buildOf(1211);
    const intro = runSegment(SEGMENT_KIND.INTRO, { build: denia }, context({ startTime: 40 }), emptyCarry());
    assert('Denia\'s Intro returns her gauge levels', intro.carry.resources instanceof Map && intro.carry.resources.size > 0);
    assert('the Intro leaves the fire ledger alone', intro.carry.fires === null);

    const rotation = runSegment(SEGMENT_KIND.ROTATION, { build: denia }, context({ startTime: 40 }), intro.carry);
    const lastFire = Math.max(...rotation.carry.fires.keys.map(([, time]) => time));
    assert(`fires come back on the team clock (last ${lastFire.toFixed(2)}s, segment ${rotation.result.totals.time.toFixed(2)}s from 40s)`,
        lastFire > 40 && lastFire <= 40 + rotation.result.totals.time + 1e-9);

    const offField = runSegment(SEGMENT_KIND.OFF_FIELD, { build: denia }, context({ startTime: 80 }), rotation.carry);
    assert('an off-field segment writes no carry', offField.carry.fires === rotation.carry.fires
        && offField.carry.resources === rotation.carry.resources);
}

// ── 4. team-sim prices segments by skillDamage only ──────────────────────────
{
    const source = readFileSync(resolve(__dirname, '../src/core/team-sim.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const reads = source.match(/totals\??\.(?:damage|statusDamage)\b/g) ?? [];
    assert(`team-sim reads no segment's totals.damage or totals.statusDamage (found ${reads.length})`, reads.length === 0);
    assert('team-sim reads totals.skillDamage', /totals\??\.skillDamage\b/.test(source));
}

console.log(`team-segment: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
