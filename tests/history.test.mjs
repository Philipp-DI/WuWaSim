/**
 * Undo/redo stack (src/ui/history.js).
 *
 *   node tests/history.test.mjs
 *
 * Pure logic, no DOM — exercises the record/undo/redo/limit contract the build
 * and team editors rely on.
 */

import { createHistory } from '../src/ui/history.js';

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── empty ─────────────────────────────────────────────────────────────────────
{
    const h = createHistory();
    assert('empty: canUndo false', h.canUndo() === false);
    assert('empty: canRedo false', h.canRedo() === false);
    assert('empty: undo returns null', h.undo('A') === null);
    assert('empty: redo returns null', h.redo('A') === null);
}

// ── record → undo → redo round-trip ──────────────────────────────────────────
{
    const h = createHistory();
    // states A → B → C (record the state being replaced, like commit does)
    h.record('A');            // about to become B
    h.record('B');            // about to become C   (current is now 'C')
    assert('after 2 records: canUndo', h.canUndo() === true);
    assert('after 2 records: canRedo false', h.canRedo() === false);

    const u1 = h.undo('C');   // stash C, restore B
    assert('undo restores B', u1 === 'B');
    assert('undo enables redo', h.canRedo() === true);

    const u2 = h.undo('B');   // stash B, restore A
    assert('undo restores A', u2 === 'A');
    assert('undo to bottom: canUndo false', h.canUndo() === false);
    assert('undo to bottom: undo null', h.undo('A') === null);

    const r1 = h.redo('A');   // restore B
    assert('redo restores B', r1 === 'B');
    const r2 = h.redo('B');   // restore C
    assert('redo restores C', r2 === 'C');
    assert('redo to top: canRedo false', h.canRedo() === false);
    assert('redo to top: redo null', h.redo('C') === null);
}

// ── a new edit after undo clears the redo branch ─────────────────────────────
{
    const h = createHistory();
    h.record('A');            // → B
    h.record('B');            // → C  (current 'C')
    h.undo('C');              // restore B, redo has C
    assert('redo available before new edit', h.canRedo() === true);
    h.record('B');            // new edit off B → D  (current 'D')
    assert('new edit clears redo', h.canRedo() === false);
    assert('new edit keeps undo', h.undo('D') === 'B');
}

// ── limit caps the past stack (oldest dropped) ───────────────────────────────
{
    const h = createHistory({ limit: 3 });
    for (const s of ['A', 'B', 'C', 'D', 'E']) h.record(s); // past capped at 3 → [C,D,E]
    assert('limit: undo E', h.undo('F') === 'E');
    assert('limit: undo D', h.undo('E') === 'D');
    assert('limit: undo C', h.undo('D') === 'C');
    assert('limit: oldest (A,B) dropped', h.canUndo() === false);
}

// ── clear resets both stacks ─────────────────────────────────────────────────
{
    const h = createHistory();
    h.record('A'); h.undo('B');
    h.clear();
    assert('clear: canUndo false', h.canUndo() === false);
    assert('clear: canRedo false', h.canRedo() === false);
}

console.log(`\nhistory: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
