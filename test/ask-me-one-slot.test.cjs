'use strict';

// An Ask me answer lands only on the question the owner answered (TODOS:
// "Answer only the question being answered"). The renderer sends the card's
// whole list, a few seconds old; an old answer in it must not land on a slot
// where Michael cleared the answer and asked the same text again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { mergeHumanQA } = loadTs('src/shared/askMeRouting.ts');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('a stale answer in the list never lands on a question asked again since', () => {
  // On disk, Michael cleared the answer to Q1 and asked the same text again.
  const disk = [{ q: 'Which account?', askedAt: 't5' }, { q: 'Pay today?', askedAt: 't2' }];
  // The owner's snapshot still holds the old answer to Q1, and answers Q2.
  const stale = [{ q: 'Which account?', a: 'Savings.', answeredAt: 't1' }, { q: 'Pay today?', a: 'Yes.', answeredAt: 't6' }];
  const { humanQA, added } = mergeHumanQA(disk, stale, 1);
  assert.deepEqual(added, [1]);
  assert.deepEqual(humanQA[0], disk[0], 'the question asked again stays open');
  assert.deepEqual(humanQA[1], { q: 'Pay today?', askedAt: 't2', a: 'Yes.', answeredAt: 't6' });
  // Without a slot, both would have landed.
  assert.deepEqual(mergeHumanQA(disk, stale).added, [0, 1]);
  // The answered slot still follows every other rule: a withdrawal stands.
  assert.deepEqual(mergeHumanQA([{ q: 'Pay today?', dismissedAt: 't7' }], [{ q: 'Pay today?', a: 'Yes.' }], 0).added, []);
});

test('the slot goes from the answer box to main, and main refuses a patch without one', () => {
  assert.match(read('src/renderer/src/components/AskMeTab.tsx'), /await window\.cth\.hivePatchTask\(task\.id, \{ humanQA: updated\.humanQA \}, index\)/);
  assert.match(read('src/preload/index.ts'), /ipcRenderer\.invoke\('hive:patchTask', id, patch, index\)/);
  const main = read('src/main/index.ts');
  const h = main.slice(main.indexOf("ipcMain.handle('hive:patchTask'"), main.indexOf("ipcMain.handle('hive:moveTask'"));
  assert.match(h, /if \(typeof index !== 'number' \|\| !Number\.isInteger\(index\) \|\| index < 0\) return \{ ok: false, landed: false,/);
  assert.ok(h.indexOf('Number.isInteger(index)') < h.indexOf('hive.patchTask('), 'refused before anything is written');
  assert.match(h, /mergeHumanQA\(onDisk, qa, index\)/);
});
