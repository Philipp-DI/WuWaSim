/**
 * Kit view and static hit inputs (roadmap step 2, #100).
 *
 *   node tests/kit-view.test.mjs
 *
 * The build page's ability cards price each ability solo, as a cold standalone
 * cast, with the gear's static hit inputs (weapon and sonata amplify scopes and
 * target mods). Pinned against the sim itself: for every ability whose one-cast
 * sim step has no buff window active and no chain-locked substitution, the
 * kit-view price equals that step's price. A cast that opens its own buffs is
 * the expected, documented deviation (maintainer, 2026-11-20).
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { kitView } from '../src/core/kit-view.js';
import { staticHitInputs } from '../src/core/static-hit-inputs.js';
import { simulateRotation } from '../src/core/sim.js';
import { resolveSkill } from '../src/core/skill.js';
import { resolveTotalStats } from '../src/core/stats.js';
import { createBuild, setWeapon } from '../src/core/build.js';
import { DEFAULT_TARGET } from '../src/core/target.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, condition) { if (condition) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const resonatorNamed = (name) => dataset.resonators.find(resonator => resonator.name === name);
const weaponNamed = (name) => dataset.weapons.find(weapon => weapon.name === name);
const buildWith = (resonatorName, weaponName) =>
    setWeapon(createBuild(resonatorNamed(resonatorName)), weaponNamed(weaponName).id);
const close = (left, right) => Math.abs(left - right) <= 1e-6 * Math.max(1, Math.abs(right));

// A one-cast sim step, and whether the kit view is allowed to differ from it:
// the cast has a buff window of its own active, or the sim substituted the
// key because the build's chain level has not created it (CHAIN_LOCKED_SKILLS).
function oneCastStep(build, key) {
    const result = simulateRotation({ build: { ...build, rotation: [key], rotationMeta: [{}] }, dataset, target: DEFAULT_TARGET });
    const step = result.steps[0];
    const substituted = (result.chainLockedSubstitutions ?? []).length > 0;
    return { step, mayDiffer: substituted || (step.activeBuffNames?.length ?? 0) > 0 };
}

// Every cold ability's kit-view price equals its one-cast sim step.
function checkColdAbilitiesMatchSim(resonatorName, weaponName) {
    const build = buildWith(resonatorName, weaponName);
    const abilities = kitView({ build, dataset, target: DEFAULT_TARGET });
    let cold = 0, coldMatching = 0;
    for (const { key, resolved } of abilities) {
        if (!resolved) continue;
        const { step, mayDiffer } = oneCastStep(build, key);
        if (mayDiffer) continue;
        cold++;
        if (close(resolved.totalExpected, step.stepDamage)) coldMatching++;
    }
    assert(`${resonatorName} + ${weaponName}: has cold abilities to compare`, cold > 0);
    assert(`${resonatorName} + ${weaponName}: ${coldMatching} of ${cold} cold abilities match the sim`, coldMatching === cold);
    return build;
}

// The price before step 2: resolveSkill with no gear inputs.
function gearlessPrice(build, key) {
    const def = kitView({ build, dataset, target: DEFAULT_TARGET }).find(ability => ability.key === key).def;
    const stats = resolveTotalStats(build, dataset);
    return resolveSkill({ skillDef: def, build, dataset, stats, target: DEFAULT_TARGET, skillKey: key }).totalExpected;
}

// ── Amplify weapon: Frostburn on Hiyuki (the #48 example) ────────────────────
{
    const build = checkColdAbilitiesMatchSim('Hiyuki', 'Frostburn');
    const liberation = kitView({ build, dataset, target: DEFAULT_TARGET })
        .find(ability => ability.key === 'liberation_blade_liberation');
    assert('Hiyuki Blade Liberation card: 9,310.8 (was 6,910.3)', Math.abs(liberation.resolved.totalExpected - 9310.8) < 0.05);
    assert('the old card price was 6,910.3', Math.abs(gearlessPrice(build, 'liberation_blade_liberation') - 6910.3) < 0.05);
    assert('Frostburn yields an amplify scope for Hiyuki', staticHitInputs({ build, dataset }).amplify.length > 0);
}

// ── Target-mod weapons: a DEF ignore and a RES shred ─────────────────────────
for (const [resonatorName, weaponName, abilityKey] of [
    ['Yuanwu', "Moongazer's Sigil", null],     // Liberation DEF ignore
    ['Hsin', 'Blooming Jadehaven', null],      // Resonance Skill RES shred
]) {
    const build = checkColdAbilitiesMatchSim(resonatorName, weaponName);
    const inputs = staticHitInputs({ build, dataset });
    assert(`${weaponName} yields target mods for ${resonatorName}`, inputs.targetMods.length > 0);
    const moved = kitView({ build, dataset, target: DEFAULT_TARGET })
        .filter(ability => ability.resolved && (abilityKey == null || ability.key === abilityKey))
        .some(ability => !close(ability.resolved.totalExpected, gearlessPrice(build, ability.key)));
    assert(`${resonatorName} + ${weaponName}: the target mods move at least one card`, moved);
}

// ── A weapon without per-hit gear inputs leaves every card as it was ─────────
{
    const build = buildWith('Hiyuki', 'Stonard');
    const inputs = staticHitInputs({ build, dataset });
    assert('Stonard: no static hit inputs', inputs.amplify.length === 0 && inputs.targetMods.length === 0);
    const unchanged = kitView({ build, dataset, target: DEFAULT_TARGET })
        .filter(ability => ability.resolved)
        .every(ability => ability.resolved.totalExpected === gearlessPrice(build, ability.key));
    assert('Stonard: every card equals the gearless price', unchanged);
}

// ── Roster-wide, blank builds: every difference is an expected one ─────────
{
    let compared = 0, unexplained = 0;
    for (const resonator of dataset.resonators) {
        const build = createBuild(resonator);
        for (const { key, resolved } of kitView({ build, dataset, target: DEFAULT_TARGET }) ?? []) {
            if (!resolved) continue;
            compared++;
            const { step, mayDiffer } = oneCastStep(build, key);
            if (!mayDiffer && !close(resolved.totalExpected, step.stepDamage)) {
                unexplained++;
                console.error(`    ${resonator.name} ${key}: kit ${resolved.totalExpected} vs sim ${step.stepDamage}`);
            }
        }
    }
    assert('roster: abilities were compared', compared > 1000);
    assert(`roster: ${unexplained} of ${compared} cards differ from the sim without a reason`, unexplained === 0);
}

// ── A cast that opens its own buffs is the expected deviation ────────────────
{
    const build = createBuild(resonatorNamed('Denia'));
    const card = kitView({ build, dataset, target: DEFAULT_TARGET })
        .find(ability => ability.key === 'liberation_final_act_stagecraft_form');
    const { step, mayDiffer } = oneCastStep(build, card.key);
    assert('Denia Final Act: the sim step has a buff window of its own', mayDiffer);
    assert('Denia Final Act: the cold card stays below that sim step', card.resolved.totalExpected < step.stepDamage);
}

assert('no skill map → null', kitView({ build: { resonatorId: -1 }, dataset, target: DEFAULT_TARGET }) === null);

console.log(`\nkit-view: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
