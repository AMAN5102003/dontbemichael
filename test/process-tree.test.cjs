'use strict';
/**
 * The quit sweep test's process tree walk (test/fixtures/process-tree.cjs).
 * Runs on every platform: it only reads a snapshot, as Windows gives one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { descendantsFromSnapshot } = require('./fixtures/process-tree.cjs');

const T = 1_760_000_000_000; // a creation time in milliseconds

test('a shell, its child and its grandchild are the tree', () => {
  const rows = [
    { ProcessId: 6260, ParentProcessId: 100, Created: T },
    { ProcessId: 7352, ParentProcessId: 6260, Created: T + 50 },
    { ProcessId: 7784, ParentProcessId: 7352, Created: T + 90 },
    { ProcessId: 9000, ParentProcessId: 100, Created: T + 10 }
  ];
  assert.deepEqual(descendantsFromSnapshot(rows, 6260).sort(), [7352, 7784]);
});

test('a process that names a reused id as its parent is not a child (CI run 39170943061)', () => {
  // csrss.exe and winlogon.exe still name their session's smss.exe, which
  // exited at boot; the PTY shell later got the same id.
  const rows = [
    { ProcessId: 6272, ParentProcessId: 6260, Created: T - 3_600_000 }, // csrss.exe
    { ProcessId: 6320, ParentProcessId: 6260, Created: T - 3_600_000 }, // winlogon.exe
    { ProcessId: 6408, ParentProcessId: 6320, Created: T - 3_590_000 }, // dwm.exe, winlogon's child
    { ProcessId: 6260, ParentProcessId: 100, Created: T },              // the PTY shell
    { ProcessId: 7352, ParentProcessId: 6260, Created: T + 50 },
    { ProcessId: 7784, ParentProcessId: 7352, Created: T + 90 }
  ];
  assert.deepEqual(descendantsFromSnapshot(rows, 6260).sort(), [7352, 7784]);
});

test('a child started in the same millisecond as its parent is kept', () => {
  const rows = [
    { ProcessId: 10, ParentProcessId: 1, Created: T },
    { ProcessId: 11, ParentProcessId: 10, Created: T }
  ];
  assert.deepEqual(descendantsFromSnapshot(rows, 10), [11]);
});

test('without creation times the walk falls back to parent ids alone', () => {
  const rows = [
    { ProcessId: 10, ParentProcessId: 1, Created: 0 },
    { ProcessId: 11, ParentProcessId: 10, Created: 0 },
    { ProcessId: 12, ParentProcessId: 11 }
  ];
  assert.deepEqual(descendantsFromSnapshot(rows, 10).sort(), [11, 12]);
});

test('a row with no creation time under a timed parent is left out', () => {
  const rows = [
    { ProcessId: 10, ParentProcessId: 1, Created: T },
    { ProcessId: 11, ParentProcessId: 10, Created: null }
  ];
  assert.deepEqual(descendantsFromSnapshot(rows, 10), []);
});

test('a parent id loop never walks forever and never returns the root', () => {
  const rows = [
    { ProcessId: 10, ParentProcessId: 11, Created: T },
    { ProcessId: 11, ParentProcessId: 10, Created: T }
  ];
  assert.deepEqual(descendantsFromSnapshot(rows, 10), [11]);
});
