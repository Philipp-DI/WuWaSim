// src/ui/history.js — a tiny undo/redo stack for the app's immutable editor
// documents (build, team). Those editors produce a NEW immutable object on every
// edit and funnel each through a single commit point, so nothing here ever
// mutates a snapshot — undo/redo is just two stacks of past references.
//
// Usage:
//   const history = createHistory();
//   // in commit(next): record the state being REPLACED, then apply next
//   history.record(current);
//   // undo/redo hand the CURRENT state in (to stash for the opposite move) and
//   // return the state to restore, or null when there is nothing to do:
//   const restored = history.undo(current);

export function createHistory({ limit = 200 } = {}) {
  let past = []; // snapshots replaced by an edit; top of stack = next undo target
  let future = []; // snapshots removed by undo, awaiting redo

  return {
    // Record the state an edit is about to replace. Any real edit invalidates the
    // redo branch (you can't redo into a future that no longer follows).
    record(previous) {
      past.push(previous);
      if (past.length > limit) past.shift();
      future = [];
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undo(current) {
      if (past.length === 0) return null;
      future.push(current);
      return past.pop();
    },
    redo(current) {
      if (future.length === 0) return null;
      past.push(current);
      return future.pop();
    },
    // Drop all history — e.g. when a fresh document is mounted.
    clear() {
      past = [];
      future = [];
    },
  };
}
