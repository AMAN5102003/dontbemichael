'use strict';

/**
 * An open question never vanishes (owner, 2026-10-04). It leaves Ask me only
 * when the owner answers it or Michael withdraws it (dismissedAt). Until then a
 * card held one open ask, its newest: replaying a real office ledger found six
 * questions that left Ask me unanswered, because a second, different question
 * on the same card silently withdrew the first (a supplier approval, lost
 * five days), or a card moved out of Blocked hid its ask (a worker closed his
 * own card with the owner's approval still open).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { openAskIndexes } = loadTs('src/shared/askMeRouting.ts');
const { openQuestions, waitsOnHuman } = loadTs('src/renderer/src/components/hiveTasks.ts');
const { asksToTidy, stuckCardsContext } = loadTs('src/shared/ownerRequests.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const older = { q: 'Approve the fix for the lost reminder emails?', askedAt: '2026-09-28T04:59Z', raisedBy: 'nick' };
const newer = { q: 'Was the integration fully reconnected since Thursday?', askedAt: '2026-09-28T15:25Z', raisedBy: 'nick' };

test('a newer, different question on a card leaves the older one open', () => {
  // Value: protects=a second ask never wipes the first; fails_when=only the newest unanswered ask counts as open; why_new=owner 2026-10-04, six asks lost; seam=none
  assert.deepEqual(openAskIndexes([older, newer]), [0, 1]);
  assert.deepEqual(openAskIndexes([older, { ...newer, a: 'i replied them' }]), [0], 'answering the newer one leaves the older one open');
  assert.deepEqual(openAskIndexes([{ ...older, dismissedAt: '2026-09-28T16:00Z' }, newer]), [1], 'only a withdrawal closes it unanswered');
  assert.deepEqual(openAskIndexes([{ ...older, a: 'yes' }, { ...newer, a: 'no' }]), []);
});

test('the card status never hides an open question', () => {
  // Value: protects=a card moved to Doing or Done keeps its question on Ask me; fails_when=waitsOnHuman requires Blocked again; why_new=a worker closed his card with the owner approval open; seam=none
  for (const status of ['blocked', 'doing', 'waiting', 'todo', 'done']) {
    const card = { id: 'c', title: 'Supplier emails', status, dependsOn: [], priority: 3, createdAt: '', humanQA: [older, newer] };
    assert.equal(waitsOnHuman(card), true, status);
    assert.equal(openQuestions(card).length, 2, status);
  }
});

test('Michael is told each turn about open questions held the wrong way', () => {
  // Value: protects=stale or doubled questions get cleaned up by Michael, not left for the owner; fails_when=asksToTidy misses an off Blocked or doubled card; why_new=new; seam=none
  const tidy = asksToTidy([
    { id: 'done-open', title: 'Supplier emails', status: 'done', assignee: 'nick', humanQA: [older] },
    { id: 'two-open', title: 'Pipeline', status: 'blocked', humanQA: [older, newer] },
    { id: 'fine', title: 'One ask', status: 'blocked', humanQA: [older] },
    { id: 'withdrawn', title: 'Old', status: 'done', humanQA: [{ ...older, dismissedAt: 'x' }] }
  ]);
  assert.deepEqual(tidy.map((c) => [c.id, c.issue]), [['done-open', 'ask-off-blocked'], ['two-open', 'several-asks']]);
  const ctx = stuckCardsContext(tidy);
  assert.match(ctx, /OPEN QUESTIONS ON CARDS OUT OF BLOCKED[\s\S]*- card done-open: Supplier emails \(with nick\)/);
  assert.match(ctx, /CARDS WITH MORE THAN ONE OPEN QUESTION[\s\S]*- card two-open: Pipeline/);
  assert.match(ctx, /"dismissedAt" \(the time\) and a short "dismissedReason"/);
  assert.doesNotMatch(ctx, /[–—]/);
});

test('every open ask holds its agent open for safe clear, and the owner closing a card withdraws its asks', async (t) => {
  // Value: protects=an agent with an unanswered question is never reset, and an owner closed card leaves Ask me; fails_when=openQuestionsRaisedBy counts only the newest, or ownerCloseTask leaves asks open; why_new=newest-only rule removed; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-ask-open-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'nick', name: 'Nick', provider: 'claude', cwd: home });
  fs.writeFileSync(path.join(home, 'hive', 'tasks.json'), JSON.stringify({ tasks: [
    { id: 'T1', title: 'Supplier emails', status: 'blocked', assignee: 'nick', humanQA: [older, { ...newer, raisedBy: 'god' }] }
  ] }));
  assert.equal(hive.openQuestionsRaisedBy('nick'), 1, "Nick's older ask is still open");
  assert.equal(hive.openQuestionsRaisedBy('god'), 1);
  assert.equal(hive.ownerCloseTask('T1', 'drop it'), true);
  const card = JSON.parse(fs.readFileSync(path.join(home, 'hive', 'tasks.json'), 'utf8')).tasks[0];
  assert.deepEqual(openAskIndexes(card.humanQA), []);
  assert.ok(card.humanQA.every((e) => e.dismissedAt && e.dismissedBy === 'card-closed' && e.dismissedReason === undefined), 'a marker, shown in the owner\'s language');
  assert.equal(hive.openQuestionsRaisedBy('nick'), 0);
});

test('Ask me shows a row per open question, and the card history and rules agree', () => {
  const tab = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(tab, /pick\(t\.humanQA\)\.map\(\(index\) => \(\{ key: `\$\{t\.id\}#\$\{index\}`/);
  assert.match(tab, /i === index && e\.q === open\.q && !isAnswered\(e\) && !isWithdrawn\(e\)/, 'an answer lands on its own question only');
  const kanban = read('src/renderer/src/components/TasksKanban.tsx');
  assert.match(kanban, /const open = !isAnswered\(e\) && !isWithdrawn\(e\);/);
  assert.match(kanban, /e\.dismissedBy === 'card-closed'\s*\? t\('kanban\.askWithdrawnCardClosed'\)/);
  assert.match(kanban, /t\('kanban\.askWithdrawnBecause', \{ reason: `\\u2068\$\{e\.dismissedReason\.trim\(\)\}\\u2069` \}\)/, "Michael's reason is isolated");
  const hive = read('src/main/hive.ts');
  assert.match(hive, /BEFORE YOU ADD AN ASK, read the asks already open on the board/);
  assert.match(hive, /Never move a card with an open question out of Blocked, or close it, until the owner has answered it or you have withdrawn it\./);
  assert.match(hive, /Only god writes tasks\.json: never change a card yourself, file what your work needs as one new file in the triage folder of the hive, and tell god what changed\./, 'workers leave every card, one with an open question included, to Michael (ship review D8)');
  assert.match(hive, /this\.stuckCardsCache = \[\.\.\.blockedWithNothingAsked\(tasks, this\.ownerRequestsCache\), \.\.\.this\.goneQuiet, \.\.\.asksToTidy\(tasks, this\.askListSince\(\)\)\];/, 'Waiting cards gone quiet join the list (waiting-follow-ups.test.cjs)');
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const k = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).kanban;
    assert.ok(k.askWithdrawn, loc);
    assert.match(k.askWithdrawnBecause, /\{\{reason\}\}/, loc);
    assert.ok(k.askWithdrawnCardClosed, loc);
    assert.doesNotMatch(k.askWithdrawnCardClosed, /[\u2013\u2014]| - /, loc);
  }
});

test('Michael\'s stuck card note keeps each list under its own heading, in a fixed order, capped per list', () => {
  // Value: protects=Michael still sees blocked cards with nothing asked when tidy cards join the same note, each under the right instructions; fails_when=cards without an issue stop defaulting to the nothing asked list, the headings follow input order, or the 20 card cap spans lists; why_new=hive now concatenates blockedWithNothingAsked and asksToTidy into one note and only each half was tested alone; seam=none
  const { blockedWithNothingAsked } = loadTs('src/shared/ownerRequests.ts');
  const nothing = blockedWithNothingAsked([{ id: 'bare', title: 'Supplier contract', status: 'blocked', assignee: 'sam' }], []);
  const offBlocked = asksToTidy(Array.from({ length: 22 }, (_, i) => ({ id: `off${i}`, title: `Card ${i}`, status: 'doing', humanQA: [older] })));
  const doubled = asksToTidy([{ id: 'two', title: 'Pipeline', status: 'blocked', humanQA: [older, newer] }]);
  const ctx = stuckCardsContext([...doubled, ...offBlocked, ...nothing]);
  const parts = ctx.split('\n\n');
  assert.deepEqual(parts.map((p) => p.split('.')[0]), ['BLOCKED CARDS WITH NOTHING ASKED', 'OPEN QUESTIONS ON CARDS OUT OF BLOCKED', 'CARDS WITH MORE THAN ONE OPEN QUESTION']);
  assert.deepEqual(parts[0].split('\n').slice(1), ['- card bare: Supplier contract (with sam)']);
  const off = parts[1].split('\n').slice(1);
  assert.equal(off.length, 21, '20 cards and a count of the rest');
  assert.equal(off.at(-1), '- and 2 more');
  assert.deepEqual(parts[2].split('\n').slice(1), ['- card two: Pipeline']);
});

test('the owner closing a card withdraws only its open questions; answered and earlier withdrawn ones stay as they were', async (t) => {
  // Value: protects=a card's decision history keeps its answers and Michael's own withdrawal reasons when the owner closes it; fails_when=ownerCloseTask stamps every humanQA entry, overwriting an earlier dismissedReason or marking an answered question withdrawn, or rewrites humanQA on a card with nothing open; why_new=the existing test closes a card whose entries were all open; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-ask-close-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  const answered = { q: 'Send the quote to the customer?', askedAt: '2026-09-27T09:00Z', a: 'Yes, today.', answeredAt: '2026-09-27T10:00Z', raisedBy: 'god' };
  const withdrawn = { ...older, dismissedAt: '2026-09-28T16:00Z', dismissedReason: 'folded into the newer question' };
  const history = [{ ...answered }];
  fs.writeFileSync(path.join(home, 'hive', 'tasks.json'), JSON.stringify({ tasks: [
    { id: 'T1', title: 'Reminder emails', status: 'blocked', humanQA: [answered, withdrawn, newer] },
    { id: 'T2', title: 'Quote', status: 'doing', humanQA: history }
  ] }));
  assert.equal(hive.ownerCloseTask('T1'), true);
  assert.equal(hive.ownerCloseTask('T2'), true);
  const [t1, t2] = JSON.parse(fs.readFileSync(path.join(home, 'hive', 'tasks.json'), 'utf8')).tasks;
  assert.deepEqual(t1.humanQA[0], answered, 'an answered question is history, not withdrawn');
  assert.deepEqual(t1.humanQA[1], withdrawn, 'an earlier withdrawal keeps its own time and reason');
  assert.equal(t1.humanQA[2].dismissedBy, 'card-closed');
  assert.ok(t1.humanQA[2].dismissedAt);
  assert.deepEqual(t2.humanQA, history, 'nothing open, nothing rewritten');
  assert.equal(t2.status, 'done');
});

test('the app closing a card withdraws its open questions, like the owner closing it', async (t) => {
  // Value: protects=a mailbox card fixed or a voice "done" never leaves its question on Ask me for good; fails_when=hive.patchTask sets done without withdrawing open asks, rewrites answered or withdrawn entries, touches a card already done, or overrides a patch that carries its own humanQA; why_new=pre-landing review 2026-10-05; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-ask-app-close-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  const answered = { q: 'Send the quote?', a: 'Yes.', answeredAt: '2026-09-27T10:00Z' };
  const withdrawn = { ...older, dismissedAt: '2026-09-28T16:00Z', dismissedReason: 'folded into the newer question' };
  const doneOpen = { id: 'T3', title: 'Already done', status: 'done', humanQA: [newer] };
  fs.writeFileSync(path.join(home, 'hive', 'tasks.json'), JSON.stringify({ tasks: [
    { id: 'T1', title: 'Mailbox needs you', status: 'blocked', humanQA: [answered, withdrawn, newer] },
    { id: 'T2', title: 'Own list', status: 'blocked', humanQA: [newer] },
    doneOpen
  ] }));
  assert.equal(hive.patchTask('T1', { status: 'done', result: 'connected again' }), true);
  assert.equal(hive.patchTask('T2', { status: 'done', humanQA: [newer] }), true);
  assert.equal(hive.patchTask('T3', { status: 'done', result: 'again' }), true);
  const [t1, t2, t3] = JSON.parse(fs.readFileSync(path.join(home, 'hive', 'tasks.json'), 'utf8')).tasks;
  assert.deepEqual(t1.humanQA.slice(0, 2), [answered, withdrawn]);
  assert.equal(t1.humanQA[2].dismissedBy, 'card-closed');
  assert.ok(t1.humanQA[2].dismissedAt);
  assert.deepEqual(openAskIndexes(t1.humanQA), []);
  assert.deepEqual(t2.humanQA, [newer], 'a patch with its own humanQA is taken as written');
  assert.deepEqual(t3.humanQA, doneOpen.humanQA, 'a card already done is not rewritten');
});

test('a blank answer or withdrawal never closes a question', () => {
  // Value: protects=only a real answer or a real withdrawal takes a question off Ask me; fails_when=any truthy a or dismissedAt counts again; why_new=Codex adversarial review 2026-10-05, a worker could write " "; seam=none
  const qa = [{ q: 'A?', a: ' ' }, { q: 'B?', dismissedAt: '  ' }, { q: 'C?', a: 42 }, { q: 'D?', a: 'Yes' }, { q: 'E?', dismissedAt: '2026-10-05T10:00:00Z' }];
  assert.deepEqual(openAskIndexes(qa), [0, 1, 2]);
});
