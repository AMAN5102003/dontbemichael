'use strict';

// A spoken "mark it done" with a result withdraws the card's open questions
// (Hive.patchTask), and Michael is told, as he is for a close from Tasks
// (TODOS: "Tell Michael when finishing by voice withdrew a question").
// Run for real: a hive on disk, the voice action handler, Michael's inbox.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const handlers = new Map();
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager } = loadTs('src/main/hive.ts');
const { registerRealtimeActionIpc } = loadTs('src/main/realtimeActions.ts');

const card = (id, extra) => ({ id, title: id, status: 'todo', dependsOn: [], priority: 3, createdAt: '2026-10-14T08:00:00.000Z', ...extra });

test('done with a result tells Michael which open questions it withdrew', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-voice-done-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', cwd: os.tmpdir(), isGod: true });
  hive.writeTasks([
    card('t1', { status: 'blocked', title: 'Pay the supplier', humanQA: [{ q: 'Which account?', raisedBy: 'god' }, { q: 'Now or Friday?', raisedBy: 'god' }, { q: 'Old one', a: 'Main account' }] }),
    card('t2', { status: 'doing', title: 'Quarterly newsletter' })
  ]);
  registerRealtimeActionIpc({
    hiveEnabled: () => true,
    hiveSend: (m, from) => hive.send(m, from),
    hiveTasks: () => hive.tasks(),
    hiveRegistry: () => hive.registry(),
    hiveLog() {},
    hivePatchTask: (id, patch) => hive.patchTask(id, patch),
    hiveMoveTask: (id, status) => hive.ownerMoveTask(id, status),
    hiveCloseTask: (id, reason) => hive.ownerCloseTask(id, reason),
    listMissions: () => [],
    saveMissions() {}
  });
  const act = (p) => handlers.get('realtime:action')(null, p);
  const ownerNotes = () => {
    const dir = path.join(hive.root(), 'agents', 'god', 'inbox');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
      .filter((m) => m.subject.startsWith('OWNER'));
  };

  assert.equal((await act({ verb: 'update_task', task: 'Pay the supplier', status: 'done', result: 'Paid from the main account' })).ok, true);
  const qa = hive.tasks().tasks.find((c) => c.id === 't1').humanQA;
  assert.deepEqual(qa.map((e) => e.dismissedBy), ['card-closed', 'card-closed', undefined], 'both open questions left Ask me');
  const notes = ownerNotes();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].subject, 'OWNER FINISHED card t1');
  assert.deepEqual([notes[0].act, notes[0].from, notes[0].conversation], ['inform', 'human', 'card:t1']);
  assert.equal(notes[0].body, [
    'The owner marked card t1 "Pay the supplier" Done with a result: Paid from the main account',
    'That withdrew its 2 open questions from Ask me, unanswered. Tell whoever raised them. If one still needs an answer, ask it again on a new card.'
  ].join('\n'));

  // Nothing was withdrawn: no note beyond the voice heads-up.
  assert.equal((await act({ verb: 'update_task', task: 'Quarterly newsletter', status: 'done', result: 'Sent' })).ok, true);
  assert.equal(hive.tasks().tasks.find((c) => c.id === 't2').status, 'done');
  assert.equal(ownerNotes().length, 1);
});
