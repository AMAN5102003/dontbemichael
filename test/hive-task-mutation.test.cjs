'use strict';

/**
 * Regression for the 2026-08-15 webhook-card loss: ASK ME had read an eight-card
 * ledger, the webhook appended card nine, then ASK ME overwrote tasks.json with
 * its stale eight-card snapshot while recording an answer. Renderer actions must
 * mutate one card against the latest main-process ledger instead of replacing the
 * whole collection they happened to read earlier.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-task-mutate-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return new HiveManager(() => home);
}

function card(id, extra = {}) {
  return {
    id,
    title: id,
    status: 'todo',
    dependsOn: [],
    priority: 3,
    createdAt: '2026-08-15T08:00:00.000Z',
    ...extra
  };
}

function tasks(hive) {
  return hive.tasks().tasks;
}

test('patching a stale UI card preserves a concurrently appended webhook card', (t) => {
  const hive = floor(t);
  const question = card('needs-human', {
    status: 'blocked',
    humanQA: [{ q: 'Which option?', askedAt: '2026-08-15T08:00:00.000Z' }]
  });
  hive.writeTasks([question]);

  // The renderer still holds this one-card snapshot when the webhook arrives.
  const staleQuestion = structuredClone(tasks(hive)[0]);
  const webhook = card('webhook-1', {
    webhook: { tokenHash: 'a'.repeat(64) }
  });
  assert.equal(hive.addTask(webhook), true);

  staleQuestion.humanQA[0].a = 'Option B';
  staleQuestion.humanQA[0].answeredAt = '2026-08-15T08:00:01.000Z';
  assert.equal(hive.patchTask(staleQuestion.id, { humanQA: staleQuestion.humanQA }), true);

  assert.deepEqual(tasks(hive).map((task) => task.id), ['needs-human', 'webhook-1']);
  assert.equal(tasks(hive)[0].humanQA[0].a, 'Option B');
  assert.equal(tasks(hive)[1].webhook.tokenHash, 'a'.repeat(64));
});

test('atomic add is idempotent, and the app has no way to delete a card', (t) => {
  const hive = floor(t);
  hive.writeTasks([card('existing')]);

  assert.equal(hive.addTask(card('new')), true);
  assert.equal(hive.addTask(card('new', { title: 'duplicate' })), false);
  assert.equal(hive.deleteTask, undefined, 'a card ends only as Done (ship 2026-10-03)');

  assert.deepEqual(tasks(hive).map((task) => task.id), ['existing', 'new']);
  assert.equal(tasks(hive)[1].title, 'new');
});

test('patch refuses an unknown card without rewriting the ledger', (t) => {
  const hive = floor(t);
  hive.writeTasks([card('existing')]);

  assert.equal(hive.patchTask('missing', { status: 'done' }), false);
  assert.deepEqual(tasks(hive), [card('existing')]);
});

test('renderer task actions never send a whole stale ledger back to main', () => {
  const root = path.resolve(__dirname, '..');
  const preload = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');
  const realtimeActions = fs.readFileSync(path.join(root, 'src/main/realtimeActions.ts'), 'utf8');
  const sources = [
    'src/renderer/src/components/AskMeTab.tsx',
    'src/renderer/src/components/TaskDetailOverlay.tsx',
    'src/renderer/src/components/TasksKanban.tsx',
    'src/renderer/src/hooks/useHive.ts'
  ].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));

  for (const source of sources) {
    assert.doesNotMatch(source, /hiveWriteTasks\s*\(/,
      'renderer code must use atomic task IPC rather than overwrite tasks.json');
  }
  assert.doesNotMatch(preload, /hiveWriteTasks\s*:/,
    'the renderer bridge must not expose the unsafe whole-ledger write primitive');
  assert.doesNotMatch(main, /ipcMain\.handle\('hive:writeTasks'/,
    'main must not accept whole-ledger writes from a stale renderer');
  assert.doesNotMatch(realtimeActions, /hiveWriteTasks\s*\(/,
    'voice actions must use atomic task mutations rather than overwrite tasks.json');
  assert.match(realtimeActions, /hiveAddTask\s*\(/);
  assert.match(realtimeActions, /hivePatchTask\s*\(/);
  assert.match(realtimeActions, /hiveCloseTask\s*\(/);
  assert.match(sources[0], /hivePatchTask\s*\(/);
  assert.match(sources[1], /hiveMoveTask\s*\(/);
  assert.match(sources[2], /hiveCloseTask\s*\(/);
  assert.match(sources[3], /hiveAddTask\s*\(/);
});

test('webhook dispatch appends via atomic addTask, not a stale whole-ledger rewrite', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');
  const fn = main.slice(main.indexOf('function dispatchWebhookWork'),
    main.indexOf('function handleWebhookMessage'));
  // The card must be appended through hive.addTask(card) — which reads the LATEST
  // on-disk ledger and is idempotent by task id — never through a re-read of a
  // snapshot the caller happened to hold, which would overwrite a concurrently
  // added card (the 2026-08-15 regression this suite guards).
  assert.match(fn, /hive\.addTask\s*\(card\)/,
    'dispatchWebhookWork must add the card via the atomic addTask');
  assert.doesNotMatch(fn, /writeTasks\s*\(\[\s*\.\.\.existing/,
    'dispatchWebhookWork must not rebuild a stale whole-ledger snapshot');
});

test('the owner closing a card ends it as Done by their decision, keeps it, and tells Michael', async (t) => {
  // Value: protects=D2, a dropped card is Done marked as the owner's call and Michael hears of every owner change; fails_when=dismiss deletes the card, closedBy is missing, moving out of Done keeps the mark, or Michael is not told; why_new=dismiss used to delete (card-lifecycle.md T6); seam=none
  const hive = floor(t);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: os.tmpdir(), isGod: true });
  hive.writeTasks([card('t1', { status: 'blocked', title: 'Pay the supplier', notes: 'kept' })]);
  assert.equal(hive.ownerCloseTask('t1', 'Not needed this month'), true);
  let c = tasks(hive)[0];
  assert.deepEqual([c.status, c.closedBy, c.closedReason, c.notes], ['done', 'owner', 'Not needed this month', 'kept']);
  // Out of Done only into To do, with a reason (owner, 2026-10-11).
  assert.equal(hive.ownerMoveTask('t1', 'doing', 'wrong'), false, 'never straight to Doing');
  assert.equal(hive.ownerMoveTask('t1', 'todo'), false, 'a reason is needed');
  assert.equal(hive.ownerMoveTask('t1', 'todo', 'Marked done by mistake'), true);
  c = tasks(hive)[0];
  assert.deepEqual([c.status, c.closedBy, c.closedReason], ['todo', undefined, undefined], 'moving out of Done clears the mark');
  assert.equal(hive.ownerMoveTask('t1', 'done'), true);
  assert.equal(tasks(hive)[0].closedBy, 'owner', 'a move to Done is the owner\'s decision');
  assert.equal(hive.ownerMoveTask('t1', 'blocked'), false, 'Blocked is Michael\'s, for a question on Ask me');
  assert.equal(tasks(hive)[0].status, 'done');
  assert.equal(hive.ownerCloseTask('missing'), false);
  const inbox = path.join(hive.root(), 'agents', 'god', 'inbox');
  const notes = fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(inbox, f), 'utf8')));
  assert.deepEqual(notes.map((m) => m.subject).sort(), ['OWNER CLOSED card t1', 'OWNER CLOSED card t1', 'OWNER MOVED card t1 to To do'].sort());
  assert.match(notes.find((m) => /MOVED/.test(m.subject)).body, /from Done to To do\. Reason: Marked done by mistake/);
  assert.ok(notes.every((m) => m.act === 'inform' && m.from === 'human' && m.conversation === 'card:t1'));
  assert.match(notes.find((m) => /Reason/.test(m.body)).body, /The owner closed card t1 "Pay the supplier" as Done\. Reason: Not needed this month/);
});

test('the renderer and voice can no longer delete a card', () => {
  // Value: protects=Done is the only ending (D2); fails_when=a delete path comes back to the bridge, IPC or voice; why_new=T6; seam=source pin
  const root = path.resolve(__dirname, '..');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8'), /hiveDeleteTask/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8'), /'hive:deleteTask'/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/main/realtimeActions.ts'), 'utf8'), /hiveDeleteTask/);
});

test('the owner cannot move a card to Blocked or Waiting from Task detail or the IPC', () => {
  // Value: protects=Blocked always means a question waits on Ask me, which only Michael raises; fails_when=the status menu offers Blocked again or the IPC accepts it; why_new=owner, ship 2026-10-03; seam=source pin
  const root = path.resolve(__dirname, '..');
  const kanban = fs.readFileSync(path.join(root, 'src/renderer/src/components/TasksKanban.tsx'), 'utf8');
  // Waiting names who the card waits on, so it is Michael's too (owner, 2026-10-03).
  assert.match(kanban, /COLUMNS\.filter\(\(c\) => \(\(c\.key !== 'blocked' && c\.key !== 'waiting'\) \|\| task\.status === c\.key\) && !\(task\.status === 'done' && c\.key === 'doing'\)\)/);
  assert.match(kanban, /disabled=\{c\.key === 'blocked' \|\| c\.key === 'waiting'\}/);
  assert.match(fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8'), /!\['todo', 'doing', 'done'\]\.includes\(status as string\)/);
});

test('voice: a status change is the owner\'s move, close never deletes, and a new schedule needs its focus', async (t) => {
  // Value: protects=a spoken "mark it done" or "drop that task" reaches Michael and ends the card as the owner's call, and a voice job never lands without a focus; fails_when=update_task patches status directly (no note to Michael, no closedBy), a status only update writes an empty patch, a failed move or close reads as done, the close loses its reason, or create_schedule stages a job without a focus; why_new=the voice paths were only source pinned; seam=electron ipcMain stand-in capturing the handlers
  const handlers = new Map();
  const electron = require.resolve('electron');
  const prev = require.cache[electron];
  require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) } } };
  t.after(() => { if (prev) require.cache[electron] = prev; else delete require.cache[electron]; });
  const { registerRealtimeActionIpc } = loadTs('src/main/realtimeActions.ts');
  const calls = [];
  let moveOk = true;
  let closeOk = true;
  let missions = [];
  const board = { tasks: [card('t1', { title: 'Pay the supplier' }), card('t2', { title: 'Quarterly newsletter' })] };
  const deps = {
    hiveEnabled: () => true,
    hiveSend: (m) => ({ id: 'x', ...m }),
    hiveTasks: () => board,
    hiveRegistry: () => ({ godId: 'god', agents: { god: { name: 'Michael', isGod: true } } }),
    hiveLog() {},
    hivePatchTask: (id, patch) => { calls.push(['patch', id, patch]); return true; },
    hiveMoveTask: (id, status) => { calls.push(['move', id, status]); return moveOk; },
    hiveCloseTask: (id, reason) => { calls.push(['close', id, reason]); return closeOk; },
    listMissions: () => missions,
    saveMissions: (m) => { missions = m; }
  };
  registerRealtimeActionIpc(deps);
  const act = (p) => handlers.get('realtime:action')(null, p);

  let r = await act({ verb: 'update_task', task: 'Pay the supplier', status: 'done' });
  assert.equal(r.ok, true, r.spoken);
  assert.deepEqual(calls, [['move', 't1', 'done']], 'status goes through the owner move, nothing patched');
  calls.length = 0;
  r = await act({ verb: 'update_task', task: 'Pay the supplier', status: 'doing', result: 'Paid by card' });
  assert.deepEqual(calls, [['patch', 't1', { result: 'Paid by card' }], ['move', 't1', 'doing']]);
  calls.length = 0;
  assert.equal((await act({ verb: 'update_task', task: 'Pay the supplier', status: 'later' })).ok, false);
  assert.deepEqual(calls, [], 'an unknown status changes nothing');
  r = await act({ verb: 'update_task', task: 'Pay the supplier', status: 'blocked' });
  assert.equal(r.ok, false);
  assert.match(r.spoken, /only Michael sets it\. Tell Michael what is holding it up/, 'by the name the office uses');
  assert.deepEqual(calls, [], 'the owner never moves a card to Blocked');
  moveOk = false;
  r = await act({ verb: 'update_task', task: 'Pay the supplier', status: 'todo' });
  assert.deepEqual([r.ok, r.spoken], [false, 'I couldn\'t update "Pay the supplier" right now.']);

  calls.length = 0;
  r = await act({ verb: 'delete_task', task: 'Quarterly newsletter', reason: 'Not this quarter' });
  assert.equal(r.ok, true, r.spoken);
  assert.deepEqual(calls, [['close', 't2', 'Not this quarter']]);
  assert.match(r.spoken, /^Closed "Quarterly newsletter" as done, your call\. It stays on the board, and Michael knows\.$/);
  closeOk = false;
  r = await act({ verb: 'delete_task', task: 'Quarterly newsletter' });
  assert.deepEqual([r.ok, r.spoken], [false, 'I couldn\'t close "Quarterly newsletter" right now.']);

  r = await act({ verb: 'create_schedule', label: 'Check invoices', focus: '   ' });
  assert.deepEqual([r.ok, r.needsConfirm], [false, undefined]);
  assert.match(r.spoken, /What should the "Check invoices" run focus on each time\?/);
  r = await act({ verb: 'create_schedule', label: 'Check invoices', focus: ' Unpaid \n past 30 days. ', intervalMinutes: 120 });
  assert.deepEqual([r.ok, r.needsConfirm], [true, true]);
  assert.match(r.spoken, /focused on: Unpaid past 30 days\./);
  r = await handlers.get('realtime:action:confirm')(null, { phrase: 'confirm' });
  assert.equal(r.ok, true, r.spoken);
  assert.deepEqual(missions.map((m) => [m.label, m.focus, m.intervalMs, m.to, m.createdBy]), [['Check invoices', 'Unpaid past 30 days.', 7_200_000, 'god', 'owner']]);
  // Review 2026-10-12: a spoken reopen of a Done card changes nothing on it.
  board.tasks.push(card('d1', { title: 'Settled invoice', status: 'done', result: 'Paid' }));
  calls.length = 0;
  r = await act({ verb: 'update_task', task: 'Settled invoice', status: 'todo', result: 'Not paid after all' });
  assert.equal(r.ok, false);
  assert.match(r.spoken, /is done\. To reopen it, open the card on the board and give a short reason\./);
  assert.deepEqual(calls, [], 'nothing on the Done card changes');
});
