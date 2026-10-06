// tools/hooks/hook-lib.mjs
/**
 * Shared helpers for the Claude Code hooks in tools/hooks/, registered in
 * .claude/settings.json. The pure functions are unit-tested in
 * tests/hooks.test.mjs; the spawn helpers only wire them to Node and ESLint.
 *
 * Hook contract (Claude Code docs, "Hooks reference"): the event arrives as
 * JSON on stdin. Exit 0 = no objection. Exit 2 = block, and stderr goes to
 * Claude. Any other exit code is a non-blocking error that only the user sees,
 * so a hook that crashes never blocks, but it is never silent either.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const EXIT_OK = 0;
export const EXIT_BLOCK = 2;
// Claude Code caps hook output at 10,000 characters; stay well below it.
export const MAX_REPORT_CHARS = 6000;

export async function readHookInput() {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    return raw ? JSON.parse(raw) : {};
}

export function projectDirOf(input) {
    return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

const toPosix = (path) => path.replace(/\\/g, '/');

/**
 * Absolute tool path → project-relative POSIX path, or null when the file is
 * outside the project. On Windows the path arrives with backslashes, and the
 * drive letter may differ in case from the project root (g:\ vs G:\).
 */
export function toProjectPath(filePath, projectDir) {
    if (!filePath || !projectDir) return null;
    const file = toPosix(filePath);
    const root = `${toPosix(projectDir).replace(/\/+$/, '')}/`;
    const head = file.slice(0, root.length);
    const driveLetterRoot = /^[a-z]:\//i.test(root);
    const insideProject = driveLetterRoot ? head.toLowerCase() === root.toLowerCase() : head === root;
    return insideProject ? file.slice(root.length) : null;
}

export const isScript = (relPath) => /\.m?js$/.test(relPath);
/** Files Claude Code reads as instructions: CLAUDE.md, rules, agents, skill definitions. */
export const isInstructionFile = (relPath) => relPath === 'CLAUDE.md'
    || /^\.claude\/rules\/[^/]+\.md$/.test(relPath)
    || /^\.claude\/agents\/.+\.md$/.test(relPath)
    || /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(relPath);

/** Which fast checks an edit to `relPath` needs. */
export function checksForEdit(relPath) {
    const checks = [];
    if (isScript(relPath)) checks.push('lint');
    if (relPath.startsWith('src/')) checks.push('sweep');
    if (isInstructionFile(relPath)) checks.push('guard');
    return checks;
}

/**
 * `git status --porcelain=v1 -z -uall` → [{ status, path, from? }]. A rename or
 * copy keeps its new path and records the original as `from` (git prints it next).
 */
export function parsePorcelain(output) {
    const tokens = output.split('\0').filter(Boolean);
    const entries = [];
    for (let i = 0; i < tokens.length; i++) {
        const entry = { status: tokens[i].slice(0, 2), path: tokens[i].slice(3) };
        if (entry.status[0] === 'R' || entry.status[0] === 'C') entry.from = tokens[++i];
        entries.push(entry);
    }
    return entries;
}

/**
 * The warnings in `after` that `before` doesn't account for. Matched by rule and
 * message, because line numbers shift when code moves; when identical warnings
 * exist, the later ones are reported.
 */
export function addedWarnings(before, after) {
    const keyOf = (warning) => `${warning.ruleId}\0${warning.message}`;
    const budget = new Map();
    for (const warning of before) budget.set(keyOf(warning), (budget.get(keyOf(warning)) ?? 0) + 1);
    return after.filter(warning => {
        const remaining = budget.get(keyOf(warning)) ?? 0;
        budget.set(keyOf(warning), remaining - 1);
        return remaining <= 0;
    });
}

/** Changes that need the stop gate: everything outside docs/. */
export const needsGate = (entries) => entries.filter(entry => !entry.path.startsWith('docs/'));

/**
 * How many consecutive blocks this stop chain reaches if the gate blocks now.
 * Claude Code sets `stop_hook_active` while Claude is continuing because a
 * Stop hook blocked it; a fresh stop (or another session) starts a new chain.
 */
export function nextBlockCount(chain, sessionId, stopHookActive) {
    const continuing = stopHookActive && chain && chain.sessionId === sessionId;
    return continuing ? chain.count + 1 : 1;
}

/** Unattended runs set WUWASIM_STOP_GATE=strict: nobody is there to answer a question. */
export const isStrict = (env) => env.WUWASIM_STOP_GATE === 'strict';

/** Does Claude's final message end on a question to the user? */
export function endsWithQuestion(message) {
    if (typeof message !== 'string') return false;
    return message.trim().replace(/[*_`)"'\]\s]+$/, '').endsWith('?');
}

/**
 * What the stop gate does with a red tree:
 * - 'still-handed-over': the user already got this exact red state (interactive only)
 * - 'handoff': Claude ends on a question, so the decision goes to the user (interactive only)
 * - 'give-up': `maxBlocks` consecutive blocks didn't fix it
 * - 'block': keep Claude working
 */
export function decideOnRed({ strict, handedOver, lastMessage, count, maxBlocks }) {
    if (!strict && handedOver) return 'still-handed-over';
    if (!strict && endsWithQuestion(lastMessage)) return 'handoff';
    return count > maxBlocks ? 'give-up' : 'block';
}

/** One line for the user: which test files failed. */
export function failingTestsHeadline(output) {
    const failedLine = output.split(/\r?\n/).find(line => line.startsWith('Failed: '));
    return failedLine ? `failing tests: ${failedLine.slice('Failed: '.length).trim()}` : 'the test suite failed';
}

/** A warning line for the user's chat (Claude Code reads stdout JSON on every exit code). */
export function userNotice(text) {
    process.stdout.write(JSON.stringify({ systemMessage: text }));
}

export function capReport(text) {
    return text.length <= MAX_REPORT_CHARS ? text : `${text.slice(0, MAX_REPORT_CHARS)}\n… (truncated)`;
}

/** The useful part of a red `npm test` run: failing files, failed assertions, errors, totals. */
export function summarizeTestFailure(output) {
    const lines = output.split(/\r?\n/);
    const relevant = lines.filter(line => /^FAIL |✗|^Failed: |\bError\b|test files passed/.test(line));
    return capReport((relevant.length > 0 ? relevant : lines.slice(-40)).join('\n').trim());
}

/** Run a Node script inside the project. Never throws. */
export function runNode(projectDir, args, timeoutMs) {
    const run = spawnSync(process.execPath, args, {
        cwd: projectDir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
    });
    return {
        ok: run.status === 0,
        timedOut: run.error?.code === 'ETIMEDOUT',
        output: `${run.stdout ?? ''}${run.stderr ?? ''}`,
    };
}

const eslintBin = (projectDir) => join(projectDir, 'node_modules', 'eslint', 'bin', 'eslint.js');
export const hasEslint = (projectDir) => existsSync(eslintBin(projectDir));

/** ESLint errors in `relPaths`, or null. Warnings are ratcheted separately (addedLintWarnings). */
export function lintErrors(projectDir, relPaths) {
    if (relPaths.length === 0 || !hasEslint(projectDir)) return null;
    const run = runNode(projectDir, [eslintBin(projectDir), '--quiet', '--no-warn-ignored', ...relPaths], 120000);
    return run.ok ? null : capReport(run.output.trim());
}

/** ESLint's JSON report: one { filePath, warnings } per linted file. Throws if ESLint printed no JSON. */
function eslintWarnings(projectDir, args, input) {
    const run = spawnSync(process.execPath, [eslintBin(projectDir), '--format', 'json', '--no-warn-ignored', ...args], {
        cwd: projectDir, encoding: 'utf8', input, timeout: 120000, maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(run.stdout || '[]').map(result => ({
        filePath: result.filePath,
        warnings: result.messages.filter(message => message.severity === 1),
    }));
}

function committedText(projectDir, relPath) {
    const run = spawnSync('git', ['show', `HEAD:${relPath}`], { cwd: projectDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return run.status === 0 ? run.stdout : null;
}

/**
 * Lint warnings each changed script adds over its committed version (a new
 * file starts from zero), as report lines, or null. The warning count may only
 * go down: this is the ratchet the S3/S4 cleanup describes, made mechanical.
 */
export function addedLintWarnings(projectDir, entries) {
    if (entries.length === 0 || !hasEslint(projectDir)) return null;
    const current = new Map(eslintWarnings(projectDir, entries.map(entry => entry.path))
        .map(result => [toProjectPath(result.filePath, projectDir), result.warnings]));
    const lines = [];
    for (const entry of entries) {
        const committed = committedText(projectDir, entry.from ?? entry.path);
        const before = committed === null ? [] : (eslintWarnings(projectDir, ['--stdin', '--stdin-filename', entry.path], committed)[0]?.warnings ?? []);
        for (const warning of addedWarnings(before, current.get(entry.path) ?? [])) {
            lines.push(`${entry.path}:${warning.line}:${warning.column}  ${warning.message}  (${warning.ruleId})`);
        }
    }
    return lines.length === 0 ? null : capReport(lines.join('\n'));
}
