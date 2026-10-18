'use strict';

/**
 * A file opened from Task detail shows at once (docs/designs/open-file-tab.md).
 * Task detail is a dialog over the whole window, so the file tab used to open
 * behind it: the owner clicked Open and nothing seemed to happen until they
 * closed the dialog.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

// The store reads its saved state from localStorage when it loads.
const saved = {};
const storage = {
  getItem: (k) => saved[k] ?? null,
  setItem: (k, v) => { saved[k] = String(v); },
  removeItem: (k) => { delete saved[k]; }
};
globalThis.window = { localStorage: storage, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
globalThis.localStorage = storage;

const { useStore } = loadTs('src/renderer/src/store/store.ts');
const report = { id: '/Users/me/Office/IT/report.md', title: 'report.md', kind: 'markdown', who: {} };

test('opening a file from Task detail closes the dialog and shows the file', () => {
  // Value: protects=the owner sees the file they opened from a task; fails_when=the dialog stays open over the file tab; why_new=the file tab opened behind Task detail; seam=none
  const s = useStore.getState();
  s.setFloorView('tasks');
  s.openTaskDetail('t-42');
  assert.equal(useStore.getState().taskDetailId, 't-42');

  useStore.getState().openFileTab(report);
  assert.equal(useStore.getState().taskDetailId, null, 'Task detail closes');
  assert.equal(useStore.getState().floorView, 'file', 'the file tab shows');
  assert.equal(useStore.getState().activeFileTab, report.id);

  useStore.getState().closeFileTab(report.id);
  assert.equal(useStore.getState().floorView, 'tasks', 'closing the file goes back to the Tasks board');
});
