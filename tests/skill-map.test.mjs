/**
 * effectiveSkillMap — the one place that picks a resonator's skill map.
 *
 *   node tests/skill-map.test.mjs
 *
 * Guards:
 *   1. curated (dataset.skillMap) wins over the generated map once it has any
 *      non-`_` key; a curated entry holding only `_` keys falls back;
 *   2. every caller sees the same map: no module under src/ reads
 *      dataset.skillMap / autoSkillMap per resonator except skill-map.js. Six
 *      copies existed, four ignoring the curated map (#55), so the first
 *      curated entry would have reached some screens and not others.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative, resolve } from 'path';
import { effectiveSkillMap } from '../src/core/skill-map.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
function assert(name, condition) {
    console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
    if (!condition) failed++;
}

const curated = { basic_1: { label: 'curated' } };
const auto = { basic_1: { label: 'auto' } };

assert('curated wins when it has a skill key',
    effectiveSkillMap({ skillMap: { 1: curated }, autoSkillMap: { 1: auto } }, 1) === curated);
assert('curated holding only `_` keys falls back to auto',
    effectiveSkillMap({ skillMap: { 1: { _note: 'x' } }, autoSkillMap: { 1: auto } }, 1) === auto);
assert('no curated entry falls back to auto',
    effectiveSkillMap({ skillMap: {}, autoSkillMap: { 1: auto } }, '1') === auto);
assert('empty auto map is null', effectiveSkillMap({ autoSkillMap: { 1: {} } }, 1) === null);
assert('missing dataset is null', effectiveSkillMap(undefined, 1) === null);

function sourceFiles(directory) {
    const files = [];
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
        else if (name.endsWith('.js')) files.push(path);
    }
    return files;
}

const DIRECT_READ = /\b(?:autoSkillMap|skillMap)\s*\??\.?\s*\[/;
const offenders = [];
for (const file of sourceFiles(join(ROOT, 'src'))) {
    const path = relative(ROOT, file).replace(/\\/g, '/');
    if (path === 'src/core/skill-map.js') continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/dataset\??\.(?:auto)?[sS]killMap/.test(line) && DIRECT_READ.test(line)) offenders.push(`${path}:${index + 1}`);
    });
}
assert(`no per-resonator skill-map read outside skill-map.js (${offenders.join(', ') || 'none'})`, offenders.length === 0);

console.log(failed === 0 ? '\nAll passed' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
