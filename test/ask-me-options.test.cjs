'use strict';

/**
 * Ask me cards with options or several questions (docs/designs/ask-me-options.md,
 * owner 2026-10-15). A numbered list in the question left the owner guessing
 * whether to reply "1", "option 1" or the whole sentence. Michael now writes a
 * choice in "options" and several questions in "parts"; the card shows rows to
 * pick and a line per question, Reply on its own row says what it will send,
 * and the answer reaches Michael in words, never a bare number.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { readAskShape, labeledAnswer, askAsText, partAnswerText, mergeHumanQA, openAskIndexes } = loadTs('src/shared/askMeRouting.ts');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const pete = {
  q: '**Pete has stopped on a permission prompt that only you can answer.**',
  options: [{ label: "I'll open Pete's chat and answer it", recommended: true }, { label: 'Leave Pete paused for now' }]
};
const dwight = {
  q: '**Dwight needs three calls on the live deals.**',
  parts: [
    { q: 'Follow ups: where should Dwight start?', options: [{ label: 'Batches of 20', recommended: true }, { label: 'Not now' }] },
    { q: 'Close date: new date?' },
    { q: 'Allucent: subscription, retainer or project?', options: [{ label: 'Subscription' }, { label: 'Retainer' }, { label: 'Project' }] }
  ]
};

test('the card reads a choice, several questions, or falls back to the plain card', () => {
  // Value: protects=only readable fields change the card; fails_when=a missing or bad field is treated as an empty choice; why_new=new reader; seam=none
  assert.deepEqual(readAskShape(pete), { kind: 'choice', options: [{ label: "I'll open Pete's chat and answer it", recommended: true }, { label: 'Leave Pete paused for now' }] });
  const parts = readAskShape(dwight);
  assert.equal(parts.kind, 'parts');
  assert.equal(parts.parts.length, 3);
  assert.equal(parts.parts[1].options, undefined);
  assert.equal(parts.parts[2].options.length, 3);
  for (const bad of [
    { q: '1. A 2. B' },
    { q: 'x', options: 'Yes or no' },
    { q: 'x', options: [] },
    { q: 'x', options: [{ label: '' }] },
    { q: 'x', options: [{ text: 'Yes' }] },
    { q: 'x', options: [{ label: 'Yes' }], parts: [{ q: 'A?' }] },
    { q: 'x', parts: [{ q: 'A?' }, { nope: 1 }] },
    { q: 'x', parts: [{ q: 'A?', options: [{ label: 3 }] }] },
    null
  ]) assert.deepEqual(readAskShape(bad), { kind: 'plain' }, JSON.stringify(bad));
  // No limits on count or length (owner, eng review D2).
  const many = Array.from({ length: 12 }, (_, i) => ({ label: `Option ${i} ${'x'.repeat(300)}` }));
  assert.equal(readAskShape({ q: 'x', options: many }).options.length, 12);
});

test('the answer is the option\'s own words, with a note when one was typed', () => {
  // Value: protects=Michael and memory read the pick in words, never a bare number; fails_when=labeledAnswer sends the index or drops the note; why_new=decision 5A; seam=none
  const shape = readAskShape(pete);
  assert.equal(labeledAnswer(shape, { pick: 0 }), "Picked: I'll open Pete's chat and answer it");
  assert.equal(labeledAnswer(shape, { pick: 1, note: ' after lunch ' }), 'Picked: Leave Pete paused for now. Note: after lunch');
  assert.equal(labeledAnswer(shape, { note: 'Do it for me' }), 'Do it for me', 'own words with no pick');
  assert.equal(labeledAnswer(shape, {}), '', 'nothing to send');
  assert.equal(labeledAnswer(shape, { pick: 9 }), '', 'a pick that is no option sends nothing');
  assert.equal(labeledAnswer(readAskShape({ q: 'plain' }), { note: 'yes' }), 'yes');
});

test('several questions: any can be left blank, and the answer names the unanswered ones', () => {
  // Value: protects=the owner is never forced to answer all, and Michael knows what to route back; fails_when=a blank part is dropped silently or blocks the reply; why_new=owner, eng review D1; seam=none
  const shape = readAskShape(dwight);
  assert.equal(labeledAnswer(shape, { parts: [{ chip: 0 }, undefined, { chip: 2, text: 'one year' }] }), '1: Batches of 20. 3: Project (one year). Not answered: 2');
  assert.equal(labeledAnswer(shape, { parts: [undefined, { text: 'Dec 15' }] , note: 'call me' }), '2: Dec 15. Not answered: 1, 3. Also: call me');
  assert.equal(labeledAnswer(shape, { parts: [{ text: '  ' }] }), '', 'blank lines are not answers');
  assert.equal(partAnswerText(shape.parts[1], { chip: 0, text: 'x' }), 'x', 'a part with no options ignores a chip');
});

test('Michael and memory notes see the options or questions with the answer', () => {
  assert.equal(askAsText(pete.q, readAskShape(pete)), `${pete.q}\n1. I'll open Pete's chat and answer it (recommended)\n2. Leave Pete paused for now`);
  assert.equal(askAsText(dwight.q, readAskShape(dwight)), `${dwight.q}\n1. Follow ups: where should Dwight start? (Batches of 20 / Not now)\n2. Close date: new date?\n3. Allucent: subscription, retainer or project? (Subscription / Retainer / Project)`);
  assert.equal(askAsText('plain', readAskShape({ q: 'plain' })), 'plain');
});

test('the pick and part answers are kept only with the owner\'s own answer', () => {
  // Value: protects=an agent cannot put answers in the owner's mouth (eng review R2); fails_when=mergeHumanQA lands picked or partAnswers without the owner's a, or keeps a bad one; why_new=merge only knew a; seam=none
  const onDisk = [{ ...pete, askedAt: 't0' }, { ...dwight, askedAt: 't0' }];
  const incoming = [
    { ...onDisk[0], a: "Picked: I'll open Pete's chat and answer it", answeredAt: 't1', picked: 0 },
    { ...onDisk[1], a: '1: Batches of 20. Not answered: 2, 3', answeredAt: 't1', partAnswers: ['Batches of 20', null, null] }
  ];
  const { humanQA, added } = mergeHumanQA(onDisk, incoming);
  assert.deepEqual(added, [0, 1]);
  assert.equal(humanQA[0].picked, 0);
  assert.deepEqual(humanQA[1].partAnswers, ['Batches of 20', null, null]);
  // No answer, no detail: an agent writing partAnswers into an open ask changes nothing.
  const agent = mergeHumanQA(onDisk, [{ ...onDisk[0], picked: 1 }, { ...onDisk[1], partAnswers: ['remove', null, null] }]);
  assert.deepEqual(agent.added, []);
  assert.equal(agent.humanQA[0].picked, undefined);
  assert.equal(agent.humanQA[1].partAnswers, undefined);
  // A detail that does not fit the ask on disk is dropped, the answer still lands.
  const odd = mergeHumanQA(onDisk, [{ ...onDisk[0], a: 'x', picked: 7 }, { ...onDisk[1], a: 'y', partAnswers: ['only one'] }]);
  assert.deepEqual(odd.added, [0, 1]);
  assert.equal(odd.humanQA[0].picked, undefined);
  assert.equal(odd.humanQA[1].partAnswers, undefined);
  // A pick or part answers an agent left on the open ask never ride along when the owner types a note.
  const planted = [{ ...pete, askedAt: 't0', picked: 1 }, { ...dwight, askedAt: 't0', partAnswers: ['remove', null, null] }];
  const typed = mergeHumanQA(planted, [{ ...pete, askedAt: 't0', a: 'use your judgment' }, { ...dwight, askedAt: 't0', a: 'later' }]);
  // and the card sends only its own: it drops what was on the ask before adding the Reply's pick.
  assert.match(read('src/renderer/src/components/AskMeTab.tsx'), /\? \{ \.\.\.withoutDetail\(e\), a: text, answeredAt, \.\.\.detail \}/);
  assert.deepEqual(typed.added, [0, 1]);
  assert.equal(typed.humanQA[0].picked, undefined);
  assert.equal(typed.humanQA[1].partAnswers, undefined);
  // An entry an agent filled with part answers but no answer is still open.
  assert.deepEqual(openAskIndexes([{ ...dwight, partAnswers: ['remove', null, null] }]), [0]);
});

test('the card: rows to pick, a line per question, Reply on its own row saying what it sends', () => {
  const tab = read('src/renderer/src/components/AskMeTab.tsx');
  const fields = read('src/renderer/src/components/AskAnswerFields.tsx');
  assert.match(fields, /role="radiogroup"/);
  assert.match(fields, /role="radio"\s*\n\s*aria-checked=\{on\}/);
  assert.match(fields, /onPick\(on \? undefined : i\)/, 'clicking the picked row unpicks it');
  assert.match(fields, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowRight'/);
  assert.match(fields, /if \(e\.key === 'Enter' && \(e\.metaKey \|\| e\.ctrlKey\)\) \{ e\.preventDefault\(\); onSend\(\); return; \}/);
  assert.match(fields, /aria-pressed=\{on\}/, 'a question\'s choices are toggle chips');
  // Nothing starts picked (4B): the pick comes only from the draft store.
  assert.match(tab, /pick=\{pk\.pick\}/);
  assert.doesNotMatch(tab, /recommended\)\s*\?\?|findIndex\(\(o\) => o\.recommended/);
  // A1: with options or questions, Reply is its own row under the box.
  assert.match(tab, /\{shape\.kind !== 'plain' \? <>[\s\S]*?<GrowingTextarea[\s\S]*?<div style=\{\{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 \}\}>\s*<PixelButton/);
  assert.match(tab, /translate\(draft\.trim\(\) \? 'askMe\.replyOptionNote' : 'askMe\.replyOption', \{ n: pk\.pick \+ 1 \}\)/);
  assert.match(tab, /translate\('askMe\.replyPartial', \{ n: partsAnswered, total: shape\.parts\.length \}\)/);
  // The plain card keeps today's one row.
  assert.match(tab, /\/\* One row: the answer, and Reply\. \*\/\s*<div style=\{\{ display: 'flex', alignItems: 'flex-end', gap: 6 \}\}>/);
  // A pick is a draft too (3A), and goes with the answer to main.
  assert.match(tab, /const hasDraft = !!draft\.trim\(\) \|\| pk\.pick !== undefined \|\| partsAnswered > 0;/);
  assert.match(tab, /\? \{ answeredAt, \.\.\.detail \}|answeredAt, \.\.\.detail \}/);
  assert.match(tab, /setAnswerPick\(row\.key, \{\}\);/, 'a sent pick is cleared');
  assert.match(tab, /answerMessages\(\{ raiser, raiserName, taskId: task\.id, title: task\.title, q: asked, a: text, answeredAt \}\)/);
  assert.match(read('src/renderer/src/components/TasksKanban.tsx'), /q: askAsText\(e\.q, readAskShape\(e\)\)/, 'Task detail shows the options and parts');
});

test('Michael writes options and parts, and team members settle what the owner left unanswered', () => {
  const hive = read('src/main/hive.ts');
  assert.match(hive, /When you offer choices, put them in "options" on the ask, as \[\{"label": "\.\.\."\}\], with "recommended": true on the one you recommend, and leave them out of the text\./);
  assert.match(hive, /An ask has options or parts, never both, and the owner may answer only some of the parts\./);
  assert.match(hive, /make the first option "Done, I did it"/);
  assert.match(hive, /When the owner's answers come back through \$\{michael\} with questions left unanswered, settle what you can yourself and file again only for what you still need\./);
  assert.doesNotMatch(hive, /Give each option its own bullet or number/);
});

test('the new strings exist in every language, with no dashes', () => {
  const keys = ['recommended', 'ownAnswer', 'addNote', 'replyOption', 'replyOptionNote', 'replyOptionAria', 'replyPartial', 'partAnswer', 'partOwn', 'anythingElse'];
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).askMe;
    for (const k of keys) {
      assert.equal(typeof d[k], 'string', `${loc} askMe.${k}`);
      assert.doesNotMatch(d[k], /[–—]| - /, `${loc} askMe.${k}`);
    }
    assert.match(d.replyPartial, /\{\{n\}\}[\s\S]*\{\{total\}\}|\{\{total\}\}[\s\S]*\{\{n\}\}/, loc);
  }
});

test('a list-style ask written since the office started is flagged for Michael to rewrite', () => {
  // Value: protects=asks Michael writes as a list get turned into options or parts; fails_when=the check misses a numbered or bulleted ask, flags one with fields, or flags asks from before the start; why_new=owner 2026-10-15, Michael kept writing lists; seam=asksToTidy since
  const { askAsList, asksToTidy, stuckCardsContext } = loadTs('src/shared/ownerRequests.ts');
  const since = Date.parse('2026-10-15T12:00:00Z');
  const list = '**Should Dwight close three deals?** Context.\n\n1. Close all three (recommended)\n\n2. Close one\n\n3. Leave them';
  const bullets = '**Pick one.**\n- Yes\n- No';
  const after = '2026-10-15T15:01:22Z', before = '2026-10-14T15:01:22Z';
  assert.equal(askAsList({ q: list, askedAt: after }, since), true);
  assert.equal(askAsList({ q: bullets, askedAt: after }, since), true);
  assert.equal(askAsList({ q: list, askedAt: before }, since), false, 'older asks keep their look (1A)');
  assert.equal(askAsList({ q: list, askedAt: after, options: [{ label: 'Close' }] }, since), false, 'already has fields');
  assert.equal(askAsList({ q: '**One question?** Plain text, no list. Costs `$1.50` this month.', askedAt: after }, since), false);
  assert.equal(askAsList({ q: 'Only\n1. one item', askedAt: after }, since), false, 'one item is not a list');
  const cards = [
    { id: 'new-list', title: 'Close deals', status: 'blocked', humanQA: [{ q: list, askedAt: after, raisedBy: 'dwight' }] },
    { id: 'old-list', title: 'Old', status: 'blocked', humanQA: [{ q: list, askedAt: before }] },
    { id: 'answered', title: 'Done ask', status: 'blocked', humanQA: [{ q: list, askedAt: after, a: 'yes' }] }
  ];
  const tidy = asksToTidy(cards, since);
  assert.deepEqual(tidy.filter((c) => c.issue === 'ask-as-list').map((c) => c.id), ['new-list']);
  assert.deepEqual(asksToTidy(cards).filter((c) => c.issue === 'ask-as-list'), [], 'no start time, no flags');
  const ctx = stuckCardsContext(tidy);
  assert.match(ctx, /ASKS WRITTEN AS A LIST\. The owner can only type an answer to these\./);
  assert.match(ctx, /put a choice in "options", as \[\{"label": "\.\.\."\}\] with "recommended": true on the one you recommend, or several questions in "parts"/);
  assert.match(ctx, /- card new-list: Close deals/);
  assert.doesNotMatch(ctx, /[–—]/);
});

test('the list reminder keeps its start across restarts, so a list written before one is still flagged', () => {
  // Value: protects=a restart never exempts a list-style ask from the rewrite reminder; fails_when=the cutoff moves to each start; why_new=owner 2026-10-15, restarting to test made new list asks look old; seam=HiveManager.askListSince
  const os = require('node:os');
  const electron = require.resolve('electron');
  require.cache[electron] ??= { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
  const { HiveManager } = loadTs('src/main/hive.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-asklist-'));
  try {
    const first = new HiveManager(() => home);
    const at = first.askListSince();
    assert.equal(at, first.startedAt);
    const later = new HiveManager(() => home);
    later.startedAt = at + 60_000; // a restart a minute later
    assert.equal(later.askListSince(), at, 'the saved start wins');
    assert.ok(fs.existsSync(path.join(home, 'private', 'ask-list-since.json')));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
