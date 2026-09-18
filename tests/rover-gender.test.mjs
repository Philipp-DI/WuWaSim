/**
 * Rover is FEMALE, and nothing else is forced to be.
 *
 *   node tests/rover-gender.test.mjs
 *
 * The rule has been broken TWICE with nothing guarding it: 40 keys had landed on
 * the male build before 2026-07-29, and 5 more were still on it until 2026-09-16
 * because the fix rewrote the DIRECTORY (`MaleM/`->`FemaleM/`) while the female
 * build renames the FILE (`AM_Attack10` -> `AM_W_Attack10`, and the male typo
 * `AM_LimitAtatck_01` -> `AM_LimitAttack_01`). Both times the sim kept running
 * and nothing failed. This is the guard that was missing.
 *
 * It reads the COMMITTED `actionable-times.json` — not `timing-data.json` or
 * `bullet-timings.json`, which are gitignored and absent in CI.
 */
import { readFileSync } from 'node:fs';

const load = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const dataset = load('wuwa-data.json');
const actionable = load('actionable-times.json').actionableTimes;

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const nameById = new Map(dataset.resonators.map(resonator => [String(resonator.id), resonator.name]));
// Derived, never hardcoded: a fifth element ships and this test covers it too.
const roverIds = [...nameById].filter(([, name]) => name.includes('Rover')).map(([id]) => id);
assert('the dataset ships four Rovers', roverIds.length === 4);

const isMaleAsset = path => typeof path === 'string' && (/(^|\/)MaleM\//.test(path) || path.includes('Nanzhu'));

// A key whose female mirror genuinely cannot be identified is REFUSED rather
// than guessed, and keeps the male asset so it does not lose its timing. This
// list is a CONTRACT: it may only SHRINK. Spectro's Intro is the one case —
// five `AM_SkillQte*` montages apply its damage id (1502009003) and none
// normalises to the male name, so picking one would be the arbitrary choice the
// identity match exists to remove.
const REFUSED = { 1501: ['intro'] };

const maleRoverKeys = [];
for (const rid of roverIds) {
    for (const [key, def] of Object.entries(actionable[rid] ?? {})) {
        if (isMaleAsset(def?.sourceMontage)) maleRoverKeys.push(`${rid}.${key}`);
    }
}
const allowed = Object.entries(REFUSED).flatMap(([rid, keys]) => keys.map(key => `${rid}.${key}`));
const unexpected = maleRoverKeys.filter(entry => !allowed.includes(entry));

assert(`no Rover key takes a MALE animation (got ${unexpected.join(', ') || 'none'})`, unexpected.length === 0);
// The other direction: an entry that stops being male has been FIXED, and the
// contract must shrink to say so rather than silently over-permitting.
for (const entry of allowed) {
    assert(`the refusal ${entry} is still real — remove it from REFUSED once it resolves`,
        maleRoverKeys.includes(entry));
}

// `genderMirroredFrom` is PROVENANCE, not a leak: it records the male original a
// key was mirrored away from. Assert the substitution actually happened, so a
// regression that keeps the male asset while still stamping the field is caught.
let mirrored = 0;
for (const rid of roverIds) {
    for (const [key, def] of Object.entries(actionable[rid] ?? {})) {
        if (!def?.genderMirroredFrom) continue;
        mirrored++;
        assert(`${rid}.${key} mirrored away from a male asset onto a female one`,
            isMaleAsset(def.genderMirroredFrom) && !isMaleAsset(def.sourceMontage));
    }
}
assert('the mirror is load-bearing (some key actually uses it)', mirrored > 0);

// THE OPPOSITE ERROR. The rule is about Rover, who ships both builds — it must
// never be widened into "no character may use a male asset". Jingran and Xiangli
// Yao ARE male and their assets are correct; a future over-broad rewrite that
// forced everyone female would break them silently.
const MALE_CHARACTERS = ['1212', '1305'];
for (const rid of MALE_CHARACTERS) {
    const keys = Object.entries(actionable[rid] ?? {});
    const male = keys.filter(([, def]) => isMaleAsset(def?.sourceMontage));
    assert(`${nameById.get(rid)} (${rid}) is male and keeps male assets (${male.length} of ${keys.length} keys)`,
        male.length > 0);
}

console.log(`\nrover-gender: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
