// tools/hooks/post-edit.mjs
/**
 * PostToolUse hook for Edit|Write (see .claude/settings.json): fast checks on
 * the file Claude just changed. Scripts get ESLint (errors only), anything
 * under src/ gets the module sweep, and CLAUDE.md or a .claude/rules/ file
 * gets the instruction-files guard. A failure exits 2, so Claude sees the
 * report next to its own edit instead of at the end of the turn, and the user
 * sees a one-line notice.
 */
import {
    EXIT_BLOCK, EXIT_OK, capReport, checksForEdit, lintErrors, projectDirOf, readHookInput, runNode,
    toProjectPath, userNotice,
} from './hook-lib.mjs';

const CHECK_SCRIPTS = { sweep: 'tools/sweep-modules.mjs', guard: 'tests/instruction-files.test.mjs' };
const CHECK_NAMES = { lint: 'ESLint errors', sweep: 'the module sweep failed', guard: 'the instruction-files guard failed' };

const input = await readHookInput();
const projectDir = projectDirOf(input);
const relPath = toProjectPath(input.tool_input?.file_path, projectDir);
if (!relPath) process.exit(EXIT_OK);

const failures = checksForEdit(relPath).map(runCheck).filter(Boolean);
if (failures.length === 0) process.exit(EXIT_OK);

userNotice(`Post-edit check failed for ${relPath}: ${failures.map(failure => CHECK_NAMES[failure.check]).join(', ')}.`);
process.stderr.write(capReport([
    `Post-edit check failed for ${relPath}:`,
    '',
    failures.map(failure => failure.report).join('\n\n'),
    '',
    'Fix the cause before moving on. Silencing the check (an `_` prefix on a dead variable, a disabled rule) is not a fix;',
    'if the user wants it this way, say so plainly. Honesty and transparency trump results.',
].join('\n')));
process.exit(EXIT_BLOCK);

function runCheck(check) {
    if (check === 'lint') {
        const errors = lintErrors(projectDir, [relPath]);
        return errors && { check, report: `ESLint errors:\n${errors}` };
    }
    const script = CHECK_SCRIPTS[check];
    const run = runNode(projectDir, [script], 60000);
    return run.ok ? null : { check, report: `${script} failed:\n${run.output.trim()}` };
}
