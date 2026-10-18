'use strict';

/**
 * Cards filed by team members wait in triage for Michael (owner, 2026-10-11,
 * docs/designs/card-lifecycle.md section 10): the owner never sees them, and
 * Michael is shown them each turn until he releases each to Blocked or Waiting.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};
const { HiveManager } = loadTs('src/main/hive.ts');
const { ownerLedger } = loadTs('src/shared/taskLedger.ts');
const { asksToTidy, stuckCardsContext } = loadTs('src/shared/ownerRequests.ts');
const { answerMessages } = loadTs('src/shared/askMeRouting.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const card = (id, extra = {}) => ({ id, title: id, status: 'todo', dependsOn: [], priority: 3, createdAt: '2026-10-11T00:00:00Z', ...extra });

test('the owner never sees a card in triage: board, Ask me, floor and voice all read the owner ledger', () => {
  // Value: protects=a team member's raw card reaches the owner only after Michael releases it; fails_when=any owner read path returns triage cards; why_new=triage is new; seam=ownerLedger plus the three main read paths
  const raw = { tasks: [card('a', { status: 'triage', humanQA: [{ q: '1. What? 2. When?', raisedBy: 'nick' }] }), card('b', { status: 'blocked' })] };
  assert.deepEqual(ownerLedger(raw).tasks.map((t) => t.id), ['b']);
  assert.equal(ownerLedger(null), null);
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('hive:tasks', \(\) => ownerLedger\(hive\.tasks\(\)\)\);/);
  assert.match(main, /  hiveTasks: \(\) => ownerLedger\(hive\.tasks\(\)\),/, 'voice tools');
  assert.match(main, /  tasks: \(\) => ownerLedger\(hive\.tasks\(\)\),\n  ptys:/, 'voice floor updates');
});

test('Michael is shown every triage card first each turn, and the owner cannot move one', async (t) => {
  // Value: protects=a filed card never sits unseen, and only Michael releases it; fails_when=triage drops out of the tidy list or the owner can move it; why_new=triage is new; seam=asksToTidy and ownerMoveTask
  const stuck = asksToTidy([card('a', { status: 'triage' }), card('b', { status: 'triage', humanQA: [{ q: 'x?' }] }), card('c', { status: 'blocked', humanQA: [{ q: 'y?' }] })]);
  assert.deepEqual(stuck.map((s) => [s.id, s.issue]), [['a', 'triage'], ['b', 'triage']]);
  const text = stuckCardsContext([...stuck, { id: 'z', title: 'z' }]);
  assert.ok(text.startsWith('CARDS IN TRIAGE ON THE BOARD.'), 'triage leads the list');
  assert.match(text, /then release it: "blocked" when it asks the owner, "waiting" with "waitingOn" when it waits on someone else, or "done" when it needs nothing more\./);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-triage-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  hive.writeTasks([card('t1', { status: 'triage' })]);
  assert.equal(hive.ownerMoveTask('t1', 'doing'), false);
  assert.equal(hive.tasks().tasks[0].status, 'triage');
});

test('questions the owner left unanswered go to whoever raised them, not straight back to the owner', () => {
  // Value: protects=no question is lost and the owner is never made to answer every one; fails_when=the relay drops the check or keeps the old re-ask line; why_new=owner, 2026-10-15 (ask-me-options.md, eng review D1); seam=answerMessages
  const base = { taskId: 'c1', title: 'T', q: '1. A? 2. B?', a: '1: yes. Not answered: 2' };
  const [m] = answerMessages({ ...base, raiser: 'pam', raiserName: 'Pam' });
  assert.match(m.body, /Check each question of the ask against the answer\. Send any the owner left unanswered to Pam with the answers: they settle what they can and file back to you only what they still need\. Ask the owner again only for that\./);
  const [g] = answerMessages({ ...base, raiser: 'god', raiserName: 'Michael' });
  assert.match(g.body, /Settle any the owner left unanswered yourself where you can, and ask the owner again only for what you still need\./);
  for (const x of [m, g]) {
    assert.doesNotMatch(x.body, /add one new ask on this card holding only those questions/);
    assert.doesNotMatch(x.body, /[\u2013\u2014]/);
  }
});

test('a Done card an agent reopens goes back to Done and Michael is told; the owner reopens with a reason', async (t) => {
  // Value: protects=Done is final except the owner's correction; fails_when=an agent's direct write keeps a reopened card, or an app move out of Done is undone; why_new=owner, 2026-10-11 (Erin reopened a done card); seam=the fleet tick (refreshOwnerRequests)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-done-guard-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  hive.writeTasks([card('d1', { status: 'done', result: 'ok' }), card('d2', { status: 'done', result: 'ok' })]);
  hive.refreshOwnerRequests(); // seeds what was Done
  // An agent edits the file directly, as agents do.
  const file = path.join(hive.root(), 'tasks.json');
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
  ledger.tasks[0].status = 'todo';
  fs.writeFileSync(file, JSON.stringify(ledger));
  hive.refreshOwnerRequests();
  assert.equal(hive.tasks().tasks[0].status, 'done', 'put back');
  const inbox = path.join(hive.root(), 'agents', 'god', 'inbox');
  const notes = fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(inbox, f), 'utf8')));
  const back = notes.find((m) => m.subject === 'DONE CARD PUT BACK: card d1');
  assert.ok(back, 'Michael is told');
  assert.match(back.body, /only the owner takes a card out of Done\. If the work needs more, make a new card for it/);
  // The owner's own reopen stands on the next tick.
  assert.equal(hive.ownerMoveTask('d2', 'todo', 'Marked done by mistake'), true);
  hive.refreshOwnerRequests();
  assert.equal(hive.tasks().tasks[1].status, 'todo');
  // Voice cannot reopen; it points to the board.
  assert.match(read('src/main/realtimeActions.ts'), /is done\. To reopen it, open the card on the board and give a short reason\./);
  const kanban = read('src/renderer/src/components/TasksKanban.tsx');
  assert.match(kanban, /if \(task\.status === 'done' && next !== 'done'\) \{ setReopening\(true\); return; \}/);
  assert.match(kanban, /disabled=\{!why\.trim\(\)\} onClick=\{\(\) => \{ onReopen\(why\.trim\(\)\);/);
  // Value (extension): protects=the owner's reason travels from the card to the main process; fails_when=the overlay, preload or IPC drops the reason, so every reopen is refused; why_new=only the two ends were checked; seam=source pins (no DOM or IPC harness)
  assert.match(read('src/renderer/src/components/TaskDetailOverlay.tsx'), /await window\.cth\.hiveMoveTask\(task\.id, 'todo', reason\);/);
  assert.match(read('src/renderer/src/components/TaskDetailOverlay.tsx'), /onReopen=\{\(reason\) => void reopen\(reason\)\}/);
  assert.match(read('src/preload/index.ts'), /hiveMoveTask: \(id: string, status: HiveTask\['status'\], reason\?: string\)[^\n]*\n\s*ipcRenderer\.invoke\('hive:moveTask', id, status, reason\)/);
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('hive:moveTask', \(_evt, id: unknown, status: unknown, reason: unknown\) => \{/);
  assert.match(main, /hive\.ownerMoveTask\(id, status as HiveTask\['status'\], typeof reason === 'string' \? reason : undefined\)/);
});

test('the Done guard covers cards that end after the first tick, and the app\'s own reopen stands', async (t) => {
  // Value: protects=a card done after launch stays done when an agent reopens it; fails_when=writeTasks or the tick stops recording newly done cards, or patchTask's own reopen is undone; why_new=only cards done at the first tick were checked; seam=the fleet tick (refreshOwnerRequests)
  // no_claim=agents editing tasks.json are simulated by direct file writes in a temp hive; Michael's handling of the note is not checked
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-done-later-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  hive.writeTasks([card('a'), card('b'), card('m', { status: 'done', result: 'connected again' })]);
  hive.refreshOwnerRequests(); // seeds: only m is Done
  const file = path.join(hive.root(), 'tasks.json');
  const agentSets = (id, status) => {
    const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
    ledger.tasks.find((c) => c.id === id).status = status;
    fs.writeFileSync(file, JSON.stringify(ledger));
  };
  const statusOf = (id) => hive.tasks().tasks.find((c) => c.id === id).status;

  // An agent finishes b by writing the file; the next tick sees it Done.
  agentSets('b', 'done');
  hive.refreshOwnerRequests();
  agentSets('b', 'todo');
  hive.refreshOwnerRequests();
  assert.equal(statusOf('b'), 'done', 'a card an agent marked done, then reopened, goes back');

  // The owner closes a; an agent reopens it before any tick runs.
  assert.equal(hive.ownerCloseTask('a', 'Not needed'), true);
  agentSets('a', 'doing');
  hive.refreshOwnerRequests();
  assert.equal(statusOf('a'), 'done', 'a card the app marked done is guarded at once');

  // The app moves a Done card on itself (a mailbox that broke again).
  assert.equal(hive.patchTask('m', { status: 'blocked' }), true);
  hive.refreshOwnerRequests();
  assert.equal(statusOf('m'), 'blocked', 'the app\'s own reopen stands');

  const inbox = path.join(hive.root(), 'agents', 'god', 'inbox');
  const subjects = fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(inbox, f), 'utf8')).subject);
  assert.deepEqual(subjects.filter((s) => s.startsWith('DONE CARD PUT BACK')).sort(), ['DONE CARD PUT BACK: card a', 'DONE CARD PUT BACK: card b']);
});

test('the owner cannot close a card still in triage, and the owner search and webhook never show triage', async (t) => {
  // Value: protects=a triage card stays Michael's until he releases it, on every owner path; fails_when=close lacks the triage guard, search reads raw tasks.json, or the webhook returns "triage"; why_new=review 2026-10-12 found those three paths; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-triage-close-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  hive.writeTasks([card('t1', { status: 'triage' })]);
  assert.equal(hive.ownerCloseTask('t1', 'Not needed'), false);
  assert.equal(hive.tasks().tasks[0].status, 'triage');
  const main = read('src/main/index.ts');
  assert.match(main, /const text = source === 'tasks\.json' \? JSON\.stringify\(ownerLedger\(hive\.tasks\(\)\), null, 2\) : readFileSync\(path, 'utf8'\);/);
  assert.match(main, /return \{ status: t\.status === 'triage' \? 'todo' : t\.status, title: t\.title, result: t\.result \};/);
});


const inboxOf = (hive, id) => {
  const dir = path.join(hive.root(), 'agents', id, 'inbox');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
};
const setOnDisk = (hive, edit) => {
  const file = path.join(hive.root(), 'tasks.json');
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(ledger.tasks);
  fs.writeFileSync(file, JSON.stringify(ledger));
};
const officeWith = async (t, prefix) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  return { home, hive };
};

test('the put back is status only: an ask added on the reopened card stays, and Michael is told to move it', async (t) => {
  // Value: protects=the owner's open question is never withdrawn by the app's put back; fails_when=the put back closes the card through the path that withdraws asks, or the note leaves the open ask out; why_new=review D3, the red team and QA probes 002 and 003; seam=the fleet tick (refreshOwnerRequests)
  const { hive } = await officeWith(t, 'md-putback-ask-');
  hive.writeTasks([card('d1', { status: 'done', result: 'ok' }), card('d2', { status: 'done', result: 'ok' })]);
  hive.refreshOwnerRequests();
  setOnDisk(hive, (tasks) => {
    tasks[0].status = 'blocked';
    tasks[0].humanQA = [{ q: 'Which supplier?', askedAt: '2026-10-11T10:00:00Z', raisedBy: 'god' }];
    tasks[1].status = 'doing';
  });
  hive.refreshOwnerRequests();
  const [d1, d2] = hive.tasks().tasks;
  assert.deepEqual([d1.status, d2.status], ['done', 'done'], 'both put back in one pass');
  assert.equal(d1.humanQA[0].dismissedAt, undefined, 'the ask is not withdrawn');
  const note = inboxOf(hive, 'god').find((m) => m.subject === 'DONE CARD PUT BACK: card d1');
  assert.match(note.body, /It has a question open on Ask me\. Withdraw it on this card \("dismissedAt" and a short "dismissedReason"\), and when the work still needs the answer, ask it on the new card\./);
  assert.doesNotMatch(inboxOf(hive, 'god').find((m) => m.subject === 'DONE CARD PUT BACK: card d2').body, /question open/);
});

test('Triage is only a way in: a card on the board moved back into Triage returns to where it was', async (t) => {
  // Value: protects=the owner never loses sight of a card by it being moved back into Triage; fails_when=the guard lets a seen card turn triage, or moves a new filing; why_new=review D4; seam=the fleet tick
  const { hive } = await officeWith(t, 'md-untriage-');
  hive.writeTasks([card('a', { status: 'waiting', waitingOn: 'customer Gopi' }), card('new', { status: 'triage' })]);
  hive.refreshOwnerRequests();
  setOnDisk(hive, (tasks) => { tasks[0].status = 'triage'; });
  hive.refreshOwnerRequests();
  const [a, fresh] = hive.tasks().tasks;
  assert.equal(a.status, 'waiting', 'back where it was');
  assert.equal(fresh.status, 'triage', 'a new card in triage is left for Michael');
  const note = inboxOf(hive, 'god').find((m) => m.subject === 'CARD MOVED BACK FROM TRIAGE: card a');
  assert.match(note.body, /so the app moved it back to Waiting\. Triage is only for new filings/);
});

test('a Done card that vanishes comes back, across a restart too, and a new office starts clean', async (t) => {
  // Value: protects=a card ends only as Done and is never lost, even when an agent rewrites the file while the app is closed; fails_when=the Done list lives only in memory, a deleted card is not restored, or an old office's cards reach a new one; why_new=review D5; seam=the fleet tick plus the private guard file
  const { home, hive } = await officeWith(t, 'md-done-restore-');
  hive.writeTasks([card('keep', { status: 'done', result: 'sent' }), card('open')]);
  hive.refreshOwnerRequests();
  setOnDisk(hive, (tasks) => { tasks.splice(0, 1); });
  hive.refreshOwnerRequests();
  const back = hive.tasks().tasks.find((c) => c.id === 'keep');
  assert.equal(back?.status, 'done');
  assert.equal(back.result, 'sent', 'as it was when last Done');
  assert.ok(inboxOf(hive, 'god').some((m) => m.subject === 'DONE CARD RESTORED: card keep'));
  // The app closes; an agent reopens the card; the app starts again.
  setOnDisk(hive, (tasks) => { tasks.find((c) => c.id === 'keep').status = 'doing'; });
  const again = new HiveManager(() => home);
  again.refreshOwnerRequests();
  assert.equal(again.tasks().tasks.find((c) => c.id === 'keep').status, 'done', 'guarded from the first tick after a restart');
  // A new office in the same home keeps none of the old one's cards.
  fs.rmSync(again.root(), { recursive: true, force: true });
  const fresh = new HiveManager(() => home);
  await fresh.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  fresh.writeTasks([card('first')]);
  fresh.refreshOwnerRequests();
  assert.deepEqual(fresh.tasks().tasks.map((c) => c.id), ['first']);
  // Value (extension): protects=a board the app cannot read, such as one an agent is writing, is left alone; fails_when=a half written file reads as empty and every Done card is appended to it; why_new=the restore writes the board; seam=the fleet tick
  fresh.writeTasks([card('first'), card('fin', { status: 'done', result: 'ok' })]);
  fresh.refreshOwnerRequests();
  fs.writeFileSync(path.join(fresh.root(), 'tasks.json'), '{"tasks": [');
  fresh.refreshOwnerRequests();
  assert.equal(fs.readFileSync(path.join(fresh.root(), 'tasks.json'), 'utf8'), '{"tasks": [');
});

test('filings in the triage folder reach Michael oldest first, and leave once he moves them to .done', async (t) => {
  // Value: protects=team members write once and Michael works the queue in filing order; fails_when=a filing is missed, the order follows file names instead of filing time, or a done filing stays listed; why_new=review D8; seam=the fleet tick (stuckCards)
  const { hive } = await officeWith(t, 'md-filings-');
  const dir = path.join(hive.root(), 'triage');
  fs.mkdirSync(path.join(dir, '.done'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'b-nick.json'), JSON.stringify({ title: 'Router password', filedBy: 'nick', filedAt: '2026-10-11T09:00:00Z', ask: '1. Which router?' }));
  fs.writeFileSync(path.join(dir, 'a-erin.json'), JSON.stringify({ title: 'Supplier quote', filedBy: 'erin', filedAt: '2026-10-11T10:00:00Z', waitingOn: 'supplier Acme' }));
  fs.writeFileSync(path.join(dir, 'c-pam.json'), JSON.stringify({ title: 'Lunch order', filedBy: 'pam', filedAt: '2026-10-11T09:30:00+00:00', ask: 'Which day?' }));
  // Written at 09:00, 09:30 and 10:00; Erin's file claims an earlier filedAt.
  const at = (name, iso) => { const s = Date.parse(iso) / 1000; fs.utimesSync(path.join(dir, name), s, s); };
  at('b-nick.json', '2026-10-11T09:00:00Z'); at('c-pam.json', '2026-10-11T09:30:00Z'); at('a-erin.json', '2026-10-11T10:00:00Z');
  const erin = JSON.parse(fs.readFileSync(path.join(dir, 'a-erin.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'a-erin.json'), JSON.stringify({ ...erin, filedAt: '2020-01-01T00:00:00Z' }));
  at('a-erin.json', '2026-10-11T10:00:00Z');
  hive.refreshOwnerRequests();
  const filings = hive.stuckCards().filter((c) => c.issue === 'filing');
  assert.deepEqual(filings.map((c) => [c.id, c.title, c.assignee]), [['b-nick.json', 'Router password', 'nick'], ['c-pam.json', 'Lunch order', 'pam'], ['a-erin.json', 'Supplier quote', 'erin']], 'by when each was written, not by name or a typed filedAt (Codex review)');
  fs.renameSync(path.join(dir, 'c-pam.json'), path.join(dir, '.done', 'c-pam.json'));
  assert.ok(!hive.stuckCards().some((c) => c.id === 'c-pam.json'), 'gone at once, not after the next tick');
  const text = stuckCardsContext(hive.stuckCards());
  assert.ok(text.startsWith('NEW FILINGS TO TRIAGE, oldest first.'));
  assert.match(text, /- triage\/b-nick\.json: Router password \(from nick\)\n- triage\/a-erin\.json: Supplier quote \(from erin\)/);
  // Value (extension): protects=a filing still being written waits, a broken one still reaches Michael, and one with no time sorts by when it was written; fails_when=either is listed or dropped wrongly; why_new=review cycle 2; seam=the fleet tick
  fs.writeFileSync(path.join(dir, 'd-half.json'), '{"title": "Hal');
  fs.writeFileSync(path.join(dir, 'e-old.json'), '{"title": "Ol');
  const old = (Date.now() - 60000) / 1000;
  fs.utimesSync(path.join(dir, 'e-old.json'), old, old);
  fs.writeFileSync(path.join(dir, 'f-notime.json'), JSON.stringify({ title: 'No time', filedBy: 'nick' }));
  const ids = hive.stuckCards().filter((c) => c.issue === 'filing').map((c) => c.id);
  assert.ok(!ids.includes('d-half.json'), 'still being written');
  assert.ok(ids.includes('e-old.json'), 'broken but old: listed by its name');
  assert.equal(ids[ids.length - 1], 'f-notime.json', 'its file time, the newest');
  assert.match(text, /Then move the file to triage\/\.done\./);
  fs.renameSync(path.join(dir, 'b-nick.json'), path.join(dir, '.done', 'b-nick.json'));
  hive.refreshOwnerRequests();
  assert.deepEqual(hive.stuckCards().filter((c) => c.issue === 'filing').map((c) => c.id).filter((id) => /^[ab]-/.test(id)), ['a-erin.json']);
  assert.match(read('src/main/hooks.ts'), /File it as one new file in the hive's triage folder/);
});

test('a parked step wakes its person at nextAt once, and Michael gets one backstop when it is still in To do', async (t) => {
  // Value: protects=parked work happens on time with no agent watching the clock and no Michael polling; fails_when=no reminder is sent, it repeats every tick or after a restart, goes to the wrong person, or the backstop never comes; why_new=review D7 (durable reminder pattern); seam=dueReminders plus the fleet tick
  const { dueReminders, NEXT_BACKSTOP_MS } = loadTs('src/shared/cardGuards.ts');
  const now = Date.parse('2026-10-12T09:00:00Z');
  const parked = card('p', { assignee: 'dwight', nextAt: '2026-10-12T08:00:00+00:00' });
  const later = card('l', { nextAt: '2026-10-13T08:00:00+00:00' });
  const first = dueReminders([parked, later, card('x', { status: 'doing', nextAt: '2026-10-01T08:00:00Z' })], {}, now);
  assert.deepEqual(first.due.map((c) => c.id), ['p'], 'only a To do card whose time has come');
  assert.deepEqual(dueReminders([parked], first.reminders, now + 60000).due, [], 'once');
  assert.deepEqual(dueReminders([parked], first.reminders, now + NEXT_BACKSTOP_MS - 1).backstop, []);
  const back = dueReminders([parked], first.reminders, now + NEXT_BACKSTOP_MS);
  assert.deepEqual(back.backstop.map((c) => c.id), ['p']);
  assert.deepEqual(dueReminders([parked], back.reminders, now + 2 * NEXT_BACKSTOP_MS).backstop, [], 'one backstop');
  assert.deepEqual(dueReminders([{ ...parked, nextAt: '2026-10-12T08:30:00+00:00' }], back.reminders, now).due.map((c) => c.id), ['p'], 'a new time is a new reminder');

  const { home, hive } = await officeWith(t, 'md-next-due-');
  await hive.ensureAgent({ id: 'dwight', name: 'Dwight', provider: 'claude', cwd: home, role: 'Sales' });
  hive.writeTasks([card('p', { title: 'Send the Monday quote', assignee: 'dwight', nextAt: '2020-01-06T09:00:00+00:00', description: 'Quote for Northwind' }), card('q', { nextAt: '2020-01-06T09:00:00Z' })]);
  hive.refreshOwnerRequests();
  hive.refreshOwnerRequests();
  const due = inboxOf(hive, 'dwight').filter((m) => m.subject === 'Next step due: Send the Monday quote');
  assert.equal(due.length, 1, 'to the card\'s person, once');
  assert.equal(due[0].conversation, 'card:p');
  assert.match(due[0].body, /was set for 2020-01-06T09:00:00\+00:00 and is due now\. What it is about: Quote for Northwind\. Do it, then tell Michael where the card stands\./);
  assert.equal(inboxOf(hive, 'god').filter((m) => m.subject === 'Next step due: q').length, 1, 'a card with nobody on it goes to Michael');
  new HiveManager(() => home).refreshOwnerRequests();
  assert.equal(inboxOf(hive, 'dwight').filter((m) => m.subject.startsWith('Next step due')).length, 1, 'not again after a restart');
});


test('a guard fix leaves every other entry on the board alone, ids that are not text included', async (t) => {
  // Value: protects=no card is lost when the app puts one back; fails_when=the fix writes only the cards it understood; why_new=review cycle 2 found entries with a numeric or missing id deleted; seam=the fleet tick
  const { hive } = await officeWith(t, 'md-guard-keep-');
  hive.writeTasks([card('d', { status: 'done', result: 'ok' })]);
  hive.refreshOwnerRequests();
  setOnDisk(hive, (tasks) => { tasks[0].status = 'doing'; tasks.push({ id: 7, title: 'numeric' }, { title: 'no id' }); });
  hive.refreshOwnerRequests();
  const tasks = hive.tasks().tasks;
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].status, 'done');
  assert.deepEqual(tasks.slice(1), [{ id: 7, title: 'numeric' }, { title: 'no id' }]);
  setOnDisk(hive, (tasks) => { tasks.push(null); });
  assert.doesNotThrow(() => hive.refreshOwnerRequests(), 'a null entry never stops the tick');
});

test('the owner can still correct a card an agent reopened before the app put it back', async (t) => {
  // Value: protects=the owner's move is not undone and blamed on an agent; fails_when=the owner move skips the Done rule because the file no longer says done, then the tick puts it back; why_new=review cycle 2; seam=ownerMoveTask plus the tick
  const { hive } = await officeWith(t, 'md-owner-race-');
  hive.writeTasks([card('d', { status: 'done', result: 'ok' })]);
  hive.refreshOwnerRequests();
  setOnDisk(hive, (tasks) => { tasks[0].status = 'doing'; });
  assert.equal(hive.ownerMoveTask('d', 'todo'), false, 'still needs a reason');
  assert.equal(hive.ownerMoveTask('d', 'todo', 'Marked done by mistake'), true);
  hive.refreshOwnerRequests();
  assert.equal(hive.tasks().tasks[0].status, 'todo');
  assert.ok(!inboxOf(hive, 'god').some((m) => m.subject === 'DONE CARD PUT BACK: card d'));
  const moved = inboxOf(hive, 'god').find((m) => m.subject.startsWith('OWNER MOVED card d'));
  assert.match(moved.body, /from Done to To do\. Reason: Marked done by mistake/);
});

test('reminders reach the right person, skip times the board cannot show, and the backstop reaches Michael', async (t) => {
  // Value: protects=a reminder goes to someone who reads it, says whose step it is, and the backstop really arrives; fails_when=an archived or unknown person is reminded, Michael is told to tell himself, a loose time fires, or the backstop is only computed; why_new=review cycle 2; seam=the fleet tick plus the private guard file
  const { dueReminders } = loadTs('src/shared/cardGuards.ts');
  const now = Date.parse('2026-10-12T09:00:00Z');
  assert.deepEqual(dueReminders([card('a', { nextAt: '2026-10-12T08:00:00' }), card('b', { nextAt: '2026-10-12' })], {}, now).due, [], 'no offset, no reminder');
  assert.deepEqual(asksToTidy([card('a', { nextAt: 'Monday 9am' }), card('b', { nextAt: '2026-10-12T08:00:00Z' })]).map((c) => [c.id, c.issue]), [['a', 'bad-next']]);
  assert.match(stuckCardsContext([{ id: 'a', title: 'a', issue: 'bad-next' }]), /^CARDS WITH A NEXT TIME THE APP CANNOT READ\./);

  const { home, hive } = await officeWith(t, 'md-next-route-');
  await hive.ensureAgent({ id: 'gone', name: 'Gone', provider: 'claude', cwd: home, role: 'Sales' });
  const reg = path.join(hive.root(), 'registry.json');
  const r = JSON.parse(fs.readFileSync(reg, 'utf8')); r.agents.gone.archived = true; fs.writeFileSync(reg, JSON.stringify(r));
  const past = '2020-01-06T09:00:00Z';
  hive.writeTasks([card('g', { assignee: 'gone', nextAt: past }), card('u', { assignee: 'ghost', nextAt: past }), card('m', { assignee: 'god', nextAt: past })]);
  hive.refreshOwnerRequests();
  assert.ok(!fs.readdirSync(path.join(hive.root(), 'agents', 'gone', 'inbox')).some((f) => f.endsWith('.json')), 'not to an archived team member');
  const due = inboxOf(hive, 'god').filter((m) => m.subject.startsWith('Next step due'));
  assert.equal(due.length, 3, 'each to Michael');
  for (const m of due) {
    assert.match(m.body, m.conversation === 'card:m'
      ? /It is your own card: do the step, then move the card to where its work stands\./
      : /Nobody on the team has this card: do the step or hand it to someone, then move the card to where its work stands\./);
    assert.doesNotMatch(m.body, /tell Michael/);
  }
  // Four hours pass: the guard file says the reminders went out long ago.
  const file = path.join(home, 'private', 'card-guard.json');
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const id of Object.keys(st.reminders)) st.reminders[id].dueSentAt = '2020-01-06T09:00:00.000Z';
  fs.writeFileSync(file, JSON.stringify(st));
  const later = new HiveManager(() => home);
  later.refreshOwnerRequests();
  const still = inboxOf(hive, 'god').filter((m) => m.subject.startsWith('STILL IN TO DO'));
  assert.equal(still.length, 3);
  assert.match(still[0].body, /but it is still in To do\. Check who should do it, then move the card/);
  later.refreshOwnerRequests();
  assert.equal(inboxOf(hive, 'god').filter((m) => m.subject.startsWith('STILL IN TO DO')).length, 3, 'once');
});


test('the owner dragging a just reopened card to Done puts it back, not as the owner\'s close; a restore brings the latest copy', async (t) => {
  // Value: protects=Michael's finished work is not recorded as the owner's close, and a restored card keeps its last result across a restart; fails_when=the owner close stamps closedBy on it, or only the Done ids are saved; why_new=review cycle 3; seam=ownerMoveTask, the tick and the private guard file
  const { home, hive } = await officeWith(t, 'md-cycle3-');
  hive.writeTasks([card('d', { status: 'done', result: 'v1' })]);
  hive.refreshOwnerRequests();
  setOnDisk(hive, (tasks) => { tasks[0].status = 'doing'; });
  assert.equal(hive.ownerMoveTask('d', 'done'), true);
  const d = hive.tasks().tasks[0];
  assert.equal(d.status, 'done');
  assert.equal(d.closedBy, undefined, 'not the owner\'s close');
  setOnDisk(hive, (tasks) => { tasks[0].result = 'v2'; });
  hive.refreshOwnerRequests();
  setOnDisk(hive, (tasks) => { tasks.splice(0, 1); tasks.push({ title: 'no id', status: 'todo', nextAt: 'Monday 9am' }); });
  const again = new HiveManager(() => home);
  assert.doesNotThrow(() => again.refreshOwnerRequests(), 'an entry with no id never stops the tick');
  assert.equal(again.tasks().tasks.find((c) => c.id === 'd').result, 'v2', 'the latest copy');
  // Value (extension): protects=a filing is written once, as a new JSON file; fails_when=a team member may edit filings or claim the .done name; why_new=review cycle 3; seam=harnessWriteDecision
  const { harnessWriteDecision } = loadTs('src/main/harnessGuard.ts');
  const guard = (tool, file) => harnessWriteDecision({ tool, toolInput: { file_path: path.join(hive.root(), 'triage', file) }, cwd: home, agentId: 'pam', isGod: false, harnessHome: home, hiveRoot: hive.root(), caseInsensitive: false }).deny;
  assert.equal(guard('Write', '20261011T143000-pam.json'), false);
  assert.equal(guard('Edit', '20261011T143000-pam.json'), true, 'never changed once written');
  assert.equal(guard('Write', 'notes.md'), true);
  assert.equal(guard('Write', '.done'), true);
  // Value (extension): protects=no filing is overwritten, by its writer or another agent; fails_when=Write may replace an existing filing or use another agent's name; why_new=Codex adversarial review; seam=harnessWriteDecision with a real file
  assert.equal(guard('Write', '20261011T143000-erin.json'), true, 'only under its own id');
  fs.mkdirSync(path.join(hive.root(), 'triage'), { recursive: true });
  fs.writeFileSync(path.join(hive.root(), 'triage', '20261011T150000-pam.json'), '{}');
  assert.equal(guard('Write', '20261011T150000-pam.json'), true, 'never over a filing already there');
});

test('a board that cannot be read at the moment of a fix is left alone, never written as empty', async (t) => {
  // Value: protects=every open card when an agent is writing tasks.json just as the guard fixes it; fails_when=the second read falls back to an empty board and the write deletes every card; why_new=review cycle 3 (critical); seam=fs.readFileSync on the second read of one tick
  const { hive } = await officeWith(t, 'md-guard-reread-');
  hive.writeTasks([card('d', { status: 'done', result: 'ok' }), card('o1', { status: 'doing' }), card('o2', { status: 'blocked', humanQA: [{ q: 'x?' }] })]);
  hive.refreshOwnerRequests();
  setOnDisk(hive, (tasks) => { tasks[0].status = 'doing'; });
  const file = path.join(hive.root(), 'tasks.json');
  const real = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (p, ...rest) {
    if (String(p) === file && ++reads === 2) return '{"tasks": [';
    return real.call(this, p, ...rest);
  };
  try { hive.refreshOwnerRequests(); } finally { fs.readFileSync = real; }
  assert.ok(reads >= 2, 'the guard read the board twice');
  assert.deepEqual(hive.tasks().tasks.map((c) => c.id), ['d', 'o1', 'o2'], 'nothing deleted');
  hive.refreshOwnerRequests();
  assert.equal(hive.tasks().tasks[0].status, 'done', 'fixed on the next tick');
});

test('a put back restores the whole Done card, an untriage the whole open card, and one tick commits once', async (t) => {
  // Value: protects=a reopen cannot rewrite finished work, a move into Triage cannot strip who a card waits on or its next time, and many reminders do not stall the app; fails_when=only the status is restored, or every message commits on its own; why_new=Codex adversarial review; seam=the fleet tick
  const { hive } = await officeWith(t, 'md-whole-card-');
  hive.writeTasks([
    card('d', { status: 'done', title: 'Quote sent', result: 'sent to Acme' }),
    card('w', { status: 'waiting', waitingOn: 'customer Gopi', assignee: 'pam' }),
    card('n', { nextAt: '2099-01-01T09:00:00Z' })
  ]);
  hive.refreshOwnerRequests();
  setOnDisk(hive, (tasks) => {
    Object.assign(tasks[0], { status: 'doing', title: 'Changed', result: 'rewritten', humanQA: [{ q: 'Again?', raisedBy: 'god' }] });
    tasks[1].status = 'triage'; delete tasks[1].waitingOn; tasks[1].assignee = 'someone else'; tasks[1].title = 'Changed';
    tasks[2].status = 'triage'; delete tasks[2].nextAt;
  });
  hive.refreshOwnerRequests();
  const [d, w, n] = hive.tasks().tasks;
  assert.deepEqual([d.status, d.title, d.result], ['done', 'Quote sent', 'sent to Acme'], 'the Done card as it was');
  assert.equal(d.humanQA[0].q, 'Again?', 'the question asked meanwhile stays (D3)');
  assert.deepEqual([w.status, w.waitingOn, w.assignee, w.title], ['waiting', 'customer Gopi', 'pam', 'w'], 'the whole open card (Codex pass 2)');
  assert.deepEqual([n.status, n.nextAt], ['todo', '2099-01-01T09:00:00Z']);

  const { home, hive: h2 } = await officeWith(t, 'md-one-commit-');
  h2.writeTasks(Array.from({ length: 12 }, (_, i) => card(`p${i}`, { nextAt: '2020-01-06T09:00:00Z' })));
  const { execFileSync } = require('node:child_process');
  const count = () => Number(execFileSync('git', ['-C', h2.root(), 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim());
  const before = count();
  h2.refreshOwnerRequests();
  assert.equal(inboxOf(h2, 'god').filter((m) => m.subject.startsWith('Next step due')).length, 12);
  assert.ok(count() - before <= 1, 'one commit for the tick, not one per reminder');
  assert.ok(home);
});


test('a reminder fires again when its card comes back to To do, and the owner drag restores the whole Done card', async (t) => {
  // Value: protects=a parked step that moved on and came back is not silently skipped, and the owner's drag cannot keep an agent's edits to finished work; fails_when=old reminder records outlive the card's To do spell, or the drag patches status only; why_new=Codex adversarial pass 2; seam=dueReminders, guardCards and ownerMoveTask
  const { guardCards, emptyGuardState } = loadTs('src/shared/cardGuards.ts');
  const past = '2020-01-06T09:00:00Z';
  let st = { ...emptyGuardState('x'), reminders: { p: { nextAt: past, dueSentAt: past } } };
  st = guardCards([card('p', { status: 'doing', nextAt: past })], st).state;
  assert.deepEqual(st.reminders, {}, 'forgotten once the card leaves To do');

  const { hive } = await officeWith(t, 'md-drag-whole-');
  hive.writeTasks([card('d', { status: 'done', title: 'Quote sent', result: 'sent to Acme', humanQA: [{ q: 'Which?', a: 'Acme' }] })]);
  hive.refreshOwnerRequests();
  setOnDisk(hive, (tasks) => { Object.assign(tasks[0], { status: 'doing', result: 'rewritten' }); delete tasks[0].humanQA; });
  assert.equal(hive.ownerMoveTask('d', 'done'), true);
  const d = hive.tasks().tasks[0];
  assert.deepEqual([d.status, d.result, d.humanQA?.[0]?.a, d.closedBy], ['done', 'sent to Acme', 'Acme', undefined]);
});

test('a put back trusts only the saved Done card: history stays, a new open question is added, a smuggled field goes; a reopen clears the result', async (t) => {
  // Value: protects=the audit trail of finished work and a stale result never reported as current; fails_when=the live question list or extra fields of a rogue reopen survive, an app write leaves the open card copy stale, or the owner's reopen keeps the old result; why_new=Codex adversarial pass 3; seam=restoreDone, writeTasks and ownerMoveTask
  const { restoreDone } = loadTs('src/shared/cardGuards.ts');
  const was = card('d', { status: 'done', result: 'ok', humanQA: [{ q: 'Which?', a: 'Acme' }] });
  const live = { ...was, status: 'doing', webhook: { tokenHash: 'forged' }, humanQA: [{ q: 'Which?', a: 'Changed' }, { q: 'New one?', raisedBy: 'god' }] };
  const back = restoreDone(was, live);
  assert.deepEqual(back.humanQA.map((e) => [e.q, e.a]), [['Which?', 'Acme'], ['New one?', undefined]]);
  assert.equal(back.status, 'done');
  assert.ok('webhook' in back && back.webhook === undefined, 'dropped when written');

  const { hive } = await officeWith(t, 'md-pass3-');
  hive.writeTasks([card('d', { status: 'done', result: 'ok' })]);
  hive.refreshOwnerRequests();
  setOnDisk(hive, (tasks) => { tasks[0].status = 'doing'; tasks[0].webhook = { tokenHash: 'forged' }; });
  hive.refreshOwnerRequests();
  assert.equal(hive.tasks().tasks[0].webhook, undefined, 'the smuggled field is gone from the board');
  assert.equal(hive.ownerMoveTask('d', 'todo', 'Marked done by mistake'), true);
  assert.equal(hive.tasks().tasks[0].result, undefined, 'no stale result while it is open');
  // An app write refreshes the open card's copy: a later move into Triage brings back this one.
  hive.patchTask('d', { title: 'Renamed by the app' });
  setOnDisk(hive, (tasks) => { tasks[0].status = 'triage'; tasks[0].title = 'x'; });
  hive.refreshOwnerRequests();
  assert.deepEqual([hive.tasks().tasks[0].status, hive.tasks().tasks[0].title], ['todo', 'Renamed by the app']);
});

test('the guard keeps when a card was first seen Done, across ticks and from an older save', () => {
  const { guardCards, emptyGuardState } = loadTs('src/shared/cardGuards.ts');
  let st = guardCards([card('d', { status: 'done' }), card('o', { status: 'doing' })], emptyGuardState('x'), '2026-10-14T09:00:00.000Z').state;
  st = guardCards([card('d', { status: 'done' }), card('o', { status: 'doing' })], st, '2026-10-14T10:00:00.000Z').state;
  assert.deepEqual(st.doneAt, { d: '2026-10-14T09:00:00.000Z' }, 'first seen, not the latest tick; open cards have none');
  const older = { hive: 'x', done: {}, placed: {}, reminders: {} };
  assert.deepEqual(guardCards([card('d', { status: 'done' })], older, '2026-10-14T11:00:00.000Z').state.doneAt, { d: '2026-10-14T11:00:00.000Z' });
});
