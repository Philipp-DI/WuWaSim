#!/usr/bin/env node
// update-game-version/update.mjs — the orchestrator (docs/VERSION-UPDATE-SPEC.md §5).
//
//   node update-game-version/update.mjs status --version 3.7   # readiness + where the run stands
//   node update-game-version/update.mjs all --version 3.7      # run to the next USER or GATE step
//   node update-game-version/update.mjs <step> --version 3.7   # one step; a USER step: "done"
//   node update-game-version/update.mjs hotfix                 # steps 7–12 at the pinned version
//
// Resumable: staging/<version>/state.json records each finished step and a
// hash of its outputs; re-running a step forgets every later one. Never
// commits or pushes.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NANOKA, ROOT, UPDATE_DIR, flag, loadLocal, readGameVersion, stagingDir } from './sources.mjs';

export function loadSteps() {
    return JSON.parse(readFileSync(resolve(UPDATE_DIR, 'steps.json'), 'utf8'));
}

/** Fill a steps.json template. Paths stay repo-relative with forward slashes. */
export function expand(template, { version, exportRoot = '' }) {
    const python = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
    return template
        .replaceAll('{staging}', `update-game-version/staging/${version}`)
        .replaceAll('{reports}', `update-game-version/reports/${version}`)
        .replaceAll('{version}', version)
        .replaceAll('{python}', python)
        .replaceAll('{exportRoot}', exportRoot);
}

/** The first step of `order` (ids) with no finished record. */
export function firstUnfinished(steps, state, order) {
    return order.map(id => steps.find(step => step.id === id)).find(step => !state.steps[step.id]) ?? null;
}

/** Forget a step and every step after it. */
export function forgetFrom(state, steps, id) {
    for (const step of steps.slice(steps.findIndex(entry => entry.id === id))) delete state.steps[step.id];
}

/** Record a step as finished; every later step must run again. */
export function recordFinished(state, steps, id, hash) {
    forgetFrom(state, steps, id);
    state.steps[id] = { finishedAt: new Date().toISOString(), hash };
}

/** The review gate opens only on `decision: install` for the CURRENT diff. */
export function gateDecision(reviewText, diffHash) {
    if (reviewText == null) return { open: false, reason: 'no review file yet' };
    const reviewed = /^diff:\s*(\S+)/m.exec(reviewText)?.[1];
    if (reviewed !== diffHash) return { open: false, reason: `the review is for diff ${reviewed ?? '(none)'}, the current diff is ${diffHash}` };
    if (!/^decision:\s*install\s*$/m.test(reviewText)) return { open: false, reason: 'no `decision: install` line' };
    return { open: true, reason: 'decision: install' };
}

function* walkFiles(path) {
    if (!existsSync(path)) return;
    if (!statSync(path).isDirectory()) { yield path; return; }
    for (const name of readdirSync(path).sort()) yield* walkFiles(join(path, name));
}

/** sha256 over every file under the given repo-relative paths, cut to 16 hex. */
export function hashPaths(paths) {
    const hash = createHash('sha256');
    for (const path of paths) {
        hash.update(`${path}\0`);
        for (const file of walkFiles(resolve(ROOT, path))) hash.update(file.slice(ROOT.length)).update(readFileSync(file));
    }
    return hash.digest('hex').slice(0, 16);
}

const statePath = (version) => resolve(stagingDir(version), 'state.json');
function loadState(version) {
    return existsSync(statePath(version)) ? JSON.parse(readFileSync(statePath(version), 'utf8')) : { version, steps: {} };
}
function saveState(state) {
    mkdirSync(stagingDir(state.version), { recursive: true });
    writeFileSync(statePath(state.version), `${JSON.stringify(state, null, 2)}\n`);
}

function readmeSection(id) {
    const readme = readFileSync(resolve(UPDATE_DIR, 'README.md'), 'utf8');
    return new RegExp(`^### ${id}\\n([\\s\\S]*?)(?=^##)`, 'm').exec(readme)?.[1].trim() ?? '(no README section)';
}

async function nanokaReachable() {
    try { return (await fetch(`${NANOKA}/manifest.json`, { method: 'HEAD' })).ok; }
    catch { return false; }
}

function runCommand(command) {
    const [program, ...args] = command.split(/\s+/);
    console.log(`\n$ ${command}`);
    const executable = program === 'node' ? process.execPath : resolve(ROOT, program);
    return spawnSync(executable, args, { cwd: ROOT, stdio: 'inherit' }).status === 0;
}

function writeReviewTemplate(path, diffPath, diffHash) {
    writeFileSync(path, [
        `# Review of ${diffPath.split('/').slice(-2).join('/')}`,
        '',
        `diff: ${diffHash}`,
        'decision: pending',
        '',
        'Answer each before changing the decision to `install`:',
        '',
        '- [ ] Semantic kit-text changes (nanoka `text`/`param` lines): each read and its sim effect named.',
        '- [ ] Changed effect-slot keys: every **overridden** key re-checked against `data/effect-overrides.json`.',
        '- [ ] Shells: every resonator in one half only explained.',
        '',
    ].join('\n'));
}

function runUser(step, context, confirm, finish) {
    if (confirm) return finish();
    console.log(readmeSection(step.id));
    console.log(`\nWhen done: node update-game-version/update.mjs ${step.id} --version ${context.version}`);
    return 'stop';
}

function runGate(step, context, finish) {
    const file = expand(step.gate.file, context);
    const against = expand(step.gate.against, context);
    const diffHash = hashPaths([against]);
    if (!existsSync(resolve(ROOT, file))) writeReviewTemplate(resolve(ROOT, file), against, diffHash);
    const verdict = gateDecision(readFileSync(resolve(ROOT, file), 'utf8'), diffHash);
    if (verdict.open) return finish();
    console.log(`GATE closed (${verdict.reason}).\nRead ${against}, answer ${file}, and set \`decision: ${step.gate.decision}\`.`);
    return 'stop';
}

/**
 * Run one step. Returns 'done', 'stop' (waits for the maintainer) or 'fail'.
 * `confirm` marks a USER step done: the maintainer ran it by name.
 */
async function runStep(step, state, context, { confirm = false } = {}) {
    const { steps } = loadSteps();
    const outputs = (step.outputs ?? []).map(path => expand(path, context));
    const finish = () => { recordFinished(state, steps, step.id, hashPaths(outputs)); saveState(state); return 'done'; };
    console.log(`\n== ${step.id} (${step.kind}, runs on ${step.runsOn}) ==`);

    if (step.kind === 'USER') return runUser(step, context, confirm, finish);
    if (step.kind === 'GATE') return runGate(step, context, finish);
    if (step.pendingPhase != null) {
        // Not automated yet, so it is done by hand like a USER step: running it
        // BY NAME afterwards records it as done.
        if (confirm) return finish();
        console.log(`Not automated until Phase ${step.pendingPhase} of docs/VERSION-UPDATE-SPEC.md. Do it by hand (README, "### ${step.id}"),`);
        console.log(`then: node update-game-version/update.mjs ${step.id} --version ${context.version}`);
        return 'stop';
    }
    if (step.runsOn === 'local' && !await nanokaReachable()) {
        console.log(`Refused: ${NANOKA} is unreachable, so this is not the maintainer's machine (the CDN blocks datacenter IPs).`);
        return 'fail';
    }
    for (const command of step.run) {
        if (!runCommand(expand(command, context))) { console.log(`\n✗ ${step.id} failed.`); return 'fail'; }
    }
    return finish();
}

function printProgress(steps, state, order) {
    console.log('\nProgress:');
    for (const id of order) console.log(`  ${state.steps[id] ? '✓' : '·'} ${id}${state.steps[id] ? `  ${state.steps[id].finishedAt}` : ''}`);
    const next = firstUnfinished(steps, state, order);
    console.log(next ? `Next: ${next.id} (${next.kind})` : 'All steps finished.');
}

function parseCommand(ids) {
    const [command] = process.argv.slice(2);
    const version = command === 'hotfix' ? readGameVersion().arikatsu : flag(process.argv, '--version');
    if (!['all', 'hotfix', ...ids].includes(command) || !version) {
        console.error('Usage: node update-game-version/update.mjs <all|hotfix|step> --version <x.y>');
        console.error(`Steps: ${ids.join(', ')}`);
        process.exit(2);
    }
    return { command, version };
}

async function main() {
    const { steps, hotfix } = loadSteps();
    const ids = steps.map(step => step.id);
    const { command, version } = parseCommand(ids);
    const context = { version, exportRoot: loadLocal().exportRoot ?? '' };
    const state = loadState(version);

    if (command === 'status') {
        // REPORTS only. Recording it would forget every later step (that is
        // what re-running a step does), and every session starts here: on
        // 2026-10-19 it wiped a finished 3.7 run's state.
        const ready = steps[0].run.every(line => runCommand(expand(line, context)));
        printProgress(steps, state, ids);
        process.exit(ready ? 0 : 1);
    }
    if (command !== 'all' && command !== 'hotfix') {
        const outcome = await runStep(steps.find(step => step.id === command), state, context, { confirm: true });
        process.exit(outcome === 'fail' ? 1 : 0);
    }
    if (command === 'hotfix') {
        // A hotfix re-ships ConfigDB: everything from the export on is stale.
        forgetFrom(state, steps, hotfix[0]);
        saveState(state);
    }
    const order = command === 'hotfix' ? hotfix : ids;
    for (let step = firstUnfinished(steps, state, order); step; step = firstUnfinished(steps, state, order)) {
        const outcome = await runStep(step, state, context);
        if (outcome !== 'done') { printProgress(steps, state, order); process.exit(outcome === 'fail' ? 1 : 0); }
    }
    printProgress(steps, state, order);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
