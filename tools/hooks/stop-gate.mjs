// tools/hooks/stop-gate.mjs
/**
 * Stop hook (see .claude/settings.json): a turn can't end as "finished" while
 * the working tree is red. When files outside docs/ changed, it runs the
 * module sweep, ESLint on the changed scripts (no errors, and no warnings
 * beyond their committed versions), then the full suite, failing fast in that
 * order. Red → exit 2: Claude keeps working with
 * the report, and the user sees a one-line notice.
 *
 * Cheap when nothing changed, so Q&A turns pass instantly. Verdicts are cached
 * by fingerprint in .claude/stop-gate.json (ignored by git): a green change set
 * passes instantly, and a red one re-blocks without re-running the suite.
 *
 * Red trees in interactive sessions can be handed to the user: when Claude's
 * final message ends on a question, or after MAX_BLOCKS consecutive blocks,
 * the turn ends with the red report shown to the user. Later turns on that
 * same unchanged tree only remind the user. Unattended runs set
 * WUWASIM_STOP_GATE=strict: no handoffs, nobody is there to answer.
 *
 * Honesty over results: the message to Claude forbids silencing a check to
 * get past the gate, and asks for a report of what is red and what was not
 * verified.
 *
 * Known gap: a commit made mid-turn leaves a clean tree, so the gate skips
 * it; the commit convention and CI cover that case for now.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    EXIT_BLOCK, EXIT_OK, addedLintWarnings, capReport, decideOnRed, failingTestsHeadline, hasEslint, isScript, isStrict,
    lintErrors, needsGate, nextBlockCount, parsePorcelain, projectDirOf, readHookInput, runNode,
    summarizeTestFailure, userNotice,
} from './hook-lib.mjs';

const MAX_BLOCKS = 3;
const SUITE_TIMEOUT_MS = 10 * 60 * 1000;
const USER_REPORT_CHARS = 1500;
const STRICT = isStrict(process.env);

const input = await readHookInput();
const projectDir = projectDirOf(input);
const statePath = join(projectDir, '.claude', 'stop-gate.json');
const state = readState();

const status = git(['status', '--porcelain=v1', '-z', '-uall']);
if (status === null) finish('Stop gate: `git status` failed here, so the changes were not checked.');

const changes = needsGate(parsePorcelain(status));
if (changes.length === 0) finish();

const fingerprint = fingerprintOf(changes);
if (fingerprint === state.greenFingerprint) finish();

const verdict = state.red?.fingerprint === fingerprint ? state.red : verify(changes);
if (verdict.ok) {
    state.greenFingerprint = fingerprint;
    delete state.red;
    delete state.handedOver;
    finish(verdict.notice);
}
if (verdict.timedOut) {
    finish(`Stop gate: the test suite did not finish within ${SUITE_TIMEOUT_MS / 60000} minutes, so these changes are unverified. Run \`npm test\` yourself.`);
}
state.red = { fingerprint, headline: verdict.headline, report: verdict.report };

const count = nextBlockCount(state.blockChain, input.session_id, input.stop_hook_active === true);
const decision = decideOnRed({
    strict: STRICT, handedOver: state.handedOver === fingerprint,
    lastMessage: input.last_assistant_message, count, maxBlocks: MAX_BLOCKS,
});
if (decision === 'still-handed-over') {
    finish(`Stop gate: the tree is still red (${verdict.headline}); this state was handed to you earlier.`);
}
if (decision !== 'block') {
    if (!STRICT) state.handedOver = fingerprint;
    const why = decision === 'handoff'
        ? 'Claude handed the decision to you instead of finishing'
        : `still red after ${MAX_BLOCKS} fix attempts, so Claude stopped anyway`;
    finish(`Stop gate: ${verdict.headline}; ${why}. Unresolved:\n${capReport(verdict.report).slice(0, USER_REPORT_CHARS)}`);
}

state.blockChain = { sessionId: input.session_id, count };
writeState();
userNotice(`Stop gate blocked Claude from finishing (${count} of ${MAX_BLOCKS}): ${verdict.headline}.`);
process.stderr.write(blockMessage(count, verdict.report));
process.exit(EXIT_BLOCK);

/** Sweep → lint errors → new lint warnings → suite, failing fast. */
function verify(changedEntries) {
    const sweep = runNode(projectDir, ['tools/sweep-modules.mjs'], 120000);
    if (!sweep.ok) return { ok: false, headline: 'the module sweep failed', report: capReport(`Module sweep failed:\n${sweep.output.trim()}`) };

    const scriptEntries = changedEntries.filter(entry => isScript(entry.path) && !entry.status.includes('D'));
    const scripts = scriptEntries.map(entry => entry.path);
    const lint = lintErrors(projectDir, scripts);
    if (lint) return { ok: false, headline: 'ESLint errors in changed scripts', report: `ESLint errors:\n${lint}` };

    const newWarnings = addedLintWarnings(projectDir, scriptEntries);
    if (newWarnings) {
        return {
            ok: false,
            headline: 'new lint warnings in changed scripts',
            report: `New lint warnings (the count may only go down; fix the new ones, don't sweep old ones):\n${newWarnings}`,
        };
    }

    const suite = runNode(projectDir, ['tools/run-tests.mjs'], SUITE_TIMEOUT_MS);
    if (suite.timedOut) return { ok: false, timedOut: true };
    if (!suite.ok) return { ok: false, headline: failingTestsHeadline(suite.output), report: summarizeTestFailure(suite.output) };

    const lintSkipped = scripts.length > 0 && !hasEslint(projectDir);
    return {
        ok: true,
        notice: lintSkipped ? 'Stop gate: tests pass, but ESLint is not installed here (`npm install`), so the changed scripts were not linted.' : null,
    };
}

function blockMessage(count, report) {
    const askLine = STRICT
        ? `- This is an unattended (strict) run: nobody can answer a question. If you can't fix the cause honestly, state exactly what is red and why, then end your turn; after ${MAX_BLOCKS} blocks the gate hands back.`
        : '- If the user told you to leave it this way, or the fix needs their decision, ask them: end your final message with the question, and the gate hands the decision to them.';
    return [
        `Stop gate (block ${count} of ${MAX_BLOCKS}): the working tree is red, so this turn can't end as finished.`,
        '',
        report,
        '',
        'What to do:',
        '- Fix the cause, then end your turn again.',
        askLine,
        '- Never silence a check to get past the gate: no `_`-prefixed dead variables, skipped or weakened tests, disabled lint rules, or edits to the hooks.',
        '- Report honestly: what is red, what you changed, what you did not verify. Honesty and transparency trump results.',
    ].join('\n');
}

/** HEAD plus each changed path's status, size and mtime: cheap, and conservative on any touch. */
function fingerprintOf(changedEntries) {
    const hash = createHash('sha256').update(git(['rev-parse', 'HEAD']) ?? 'no-head');
    for (const entry of changedEntries) {
        const fullPath = join(projectDir, entry.path);
        const stats = existsSync(fullPath) ? statSync(fullPath) : null;
        hash.update(`${entry.status}\0${entry.path}\0${stats ? `${stats.size}:${stats.mtimeMs}` : 'gone'}\0`);
    }
    return hash.digest('hex');
}

function git(args) {
    const run = spawnSync('git', args, { cwd: projectDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return run.status === 0 ? run.stdout : null;
}

function readState() {
    if (!existsSync(statePath)) return {};
    try {
        return JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
        return {}; // a corrupt cache only costs one extra verification run
    }
}

function writeState() {
    try {
        writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    } catch {
        // a read-only checkout only loses the cache; the verdict itself is unaffected
    }
}

/** Let the turn end, closing any block chain; `notice` goes to the user's chat. */
function finish(notice) {
    delete state.blockChain;
    writeState();
    if (notice) userNotice(notice);
    process.exit(EXIT_OK);
}
