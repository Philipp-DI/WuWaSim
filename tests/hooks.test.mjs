/**
 * Claude Code hooks — the pure decision helpers in tools/hooks/hook-lib.mjs.
 *
 *   node tests/hooks.test.mjs
 *
 * post-edit.mjs and stop-gate.mjs only wire these helpers to git, ESLint and
 * the test runner; their exit-code behaviour was rehearsed end to end when
 * they were added (docs/history/2026-10-06-stop-gate-hooks.md).
 */

import {
    MAX_REPORT_CHARS, capReport, checksForEdit, decideOnRed, endsWithQuestion, failingTestsHeadline,
    isStrict, needsGate, nextBlockCount, parsePorcelain, summarizeTestFailure, toProjectPath,
} from '../tools/hooks/hook-lib.mjs';

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }
const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

// ── toProjectPath: Windows and POSIX paths, inside and outside the project ──
{
    assert('Windows path whose drive letter differs in case', toProjectPath('g:\\Projects\\WuWaSim\\src\\core\\sim.js', 'G:\\Projects\\WuWaSim') === 'src/core/sim.js');
    assert('POSIX path', toProjectPath('/repo/tools/hooks/post-edit.mjs', '/repo') === 'tools/hooks/post-edit.mjs');
    assert('root with a trailing separator', toProjectPath('/repo/CLAUDE.md', '/repo/') === 'CLAUDE.md');
    assert('file outside the project', toProjectPath('/elsewhere/file.js', '/repo') === null);
    assert('sibling folder sharing a prefix is outside', toProjectPath('/repo-old/file.js', '/repo') === null);
    assert('POSIX paths stay case-sensitive', toProjectPath('/Repo/file.js', '/repo') === null);
    assert('missing path', toProjectPath(undefined, '/repo') === null);
}

// ── checksForEdit: which fast checks an edit triggers ──
{
    assert('engine file: lint and sweep', same(checksForEdit('src/core/sim.js'), ['lint', 'sweep']));
    assert('tool script: lint only', same(checksForEdit('tools/preprocess/effects.mjs'), ['lint']));
    assert('CLAUDE.md: guard only', same(checksForEdit('CLAUDE.md'), ['guard']));
    assert('rules file: guard only', same(checksForEdit('.claude/rules/invariants-status.md'), ['guard']));
    assert('nested markdown under rules is not a rules file', same(checksForEdit('.claude/rules/sub/notes.md'), []));
    assert('data JSON: no fast check', same(checksForEdit('data/effect-overrides.json'), []));
}

// ── parsePorcelain + needsGate ──
{
    const entries = parsePorcelain(' M src/core/sim.js\0R  tools/new.mjs\0tools/old.mjs\0?? docs/history/note.md\0 D tests/gone.test.mjs\0');
    assert('four entries, and a rename keeps its new path', entries.length === 4 && entries[1].path === 'tools/new.mjs');
    assert('untracked file keeps its status', entries[2].status === '??' && entries[2].path === 'docs/history/note.md');
    const gated = needsGate(entries);
    assert('docs/ changes alone never need the gate', gated.length === 3 && gated.every(entry => !entry.path.startsWith('docs/')));
    assert('clean tree', parsePorcelain('').length === 0);
}

// ── nextBlockCount: consecutive blocks within one stop chain ──
{
    assert('first block of a chain', nextBlockCount(undefined, 'session-a', false) === 1);
    assert('continuing chain counts up', nextBlockCount({ sessionId: 'session-a', count: 2 }, 'session-a', true) === 3);
    assert('a fresh stop restarts the count', nextBlockCount({ sessionId: 'session-a', count: 2 }, 'session-a', false) === 1);
    assert('another session restarts the count', nextBlockCount({ sessionId: 'session-a', count: 2 }, 'session-b', true) === 1);
}

// ── summarizeTestFailure + capReport ──
{
    const output = 'PASS a.test.mjs\nFAIL b.test.mjs\n  ✗ FAIL: totals match\nunrelated log line\n\n84/85 test files passed\nFailed: b.test.mjs\n';
    const summary = summarizeTestFailure(output);
    assert('keeps the failing file, the assertion and the totals', ['FAIL b.test.mjs', '✗ FAIL: totals match', '84/85 test files passed', 'Failed: b.test.mjs'].every(line => summary.includes(line)));
    assert('drops passing files and noise', !summary.includes('PASS a.test.mjs') && !summary.includes('unrelated log line'));
    assert('a crash without markers falls back to the tail', summarizeTestFailure('boom\nstack line').includes('stack line'));
    assert('reports are capped for the hook output limit', capReport('x'.repeat(MAX_REPORT_CHARS + 50)).length < MAX_REPORT_CHARS + 30);
}

// ── endsWithQuestion + isStrict ──
{
    assert('a plain question', endsWithQuestion('Tests fail in sim.js. What would you like me to do?'));
    assert('a question wrapped in markdown', endsWithQuestion('Should I revert it?**\n'));
    assert('a statement', !endsWithQuestion('Done. Renamed to `_unusedThing`.'));
    assert('a question mark mid-message only', !endsWithQuestion('Why did it fail? Fixed now.'));
    assert('no message', !endsWithQuestion(undefined) && !endsWithQuestion(''));
    assert('strict mode is opt-in', isStrict({ WUWASIM_STOP_GATE: 'strict' }) && !isStrict({}));
}

// ── decideOnRed: interactive handoffs, strict unattended runs ──
{
    const base = { strict: false, handedOver: false, lastMessage: 'Fixed.', count: 1, maxBlocks: 3 };
    assert('red and no question: block', decideOnRed(base) === 'block');
    assert('red after 3 blocks: give up', decideOnRed({ ...base, count: 4 }) === 'give-up');
    assert('final question: hand the decision to the user', decideOnRed({ ...base, lastMessage: 'Leave it red?' }) === 'handoff');
    assert('unchanged red tree already handed over: remind only', decideOnRed({ ...base, handedOver: true }) === 'still-handed-over');
    assert('strict: a question does not end the turn', decideOnRed({ ...base, strict: true, lastMessage: 'Leave it red?' }) === 'block');
    assert('strict: an earlier handover does not count', decideOnRed({ ...base, strict: true, handedOver: true }) === 'block');
    assert('strict: still gives up after 3 blocks', decideOnRed({ ...base, strict: true, count: 4 }) === 'give-up');
}

// ── failingTestsHeadline ──
{
    assert('names the failing files', failingTestsHeadline('FAIL a.test.mjs\n\n84/86 test files passed\nFailed: a.test.mjs, b.test.mjs\n') === 'failing tests: a.test.mjs, b.test.mjs');
    assert('falls back when the runner crashed', failingTestsHeadline('Error: boom') === 'the test suite failed');
}

console.log(`\nhooks: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
