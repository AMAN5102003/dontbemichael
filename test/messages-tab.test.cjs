'use strict';
/**
 * The Messages tab reads like a history, not a stack of accordions
 * (docs/designs/messages-tab.md, owner 2026-09-25): conversations grouped by
 * day as sentence rows with the latest reply, office notices on one line,
 * and plain verbs instead of message types.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { messageView, isRoutine, verbKey, gist, localDay } = loadTs('src/shared/messageView.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const at = (h, day = 25) => new Date(2026, 8, day, h, 0).toISOString();
const msg = (o) => ({ subject: '', body: '', act: 'inform', to: 'pam', ...o });

test("Kelly's tab: seven closing time notices become one count, no conversations", () => {
  const msgs = Array.from({ length: 7 }, (_, i) => msg({ id: `c${i}`, from: 'god', act: 'request', subject: 'Closing time — save work', conversation: `conv-closing-${i}`, created_at: at(10 + i) }));
  const v = messageView(msgs);
  assert.deepEqual(v.days, []);
  assert.equal(v.notices.closing, 7);
  assert.equal(v.notices.messages.length, 7);
});

test("Pam's tab: scheduled runs are counted; a question and its answer stay together under their day", () => {
  const v = messageView([
    msg({ id: 's1', from: 'scheduler', subject: 'Check emails', created_at: at(9) }),
    msg({ id: 's2', from: 'scheduler', subject: 'Check emails', created_at: at(10) }),
    msg({ id: 'q', from: 'dwight', act: 'request', subject: 'Has Dennis replied?', conversation: 'c1', created_at: at(14) }),
    msg({ id: 'a', from: 'pam', to: 'dwight', act: 'inform', body: 'Not yet.', conversation: 'c1', created_at: at(15) }),
    msg({ id: 'y', from: 'god', act: 'request', subject: 'Inbox summary', conversation: 'c2', created_at: at(15, 24) })
  ]);
  assert.equal(v.notices.scheduled, 2);
  assert.deepEqual(v.days.map((d) => d.day), [localDay(at(15)), localDay(at(15, 24))], 'newest day first');
  const [t] = v.days[0].threads;
  assert.equal(t.first.id, 'q');
  assert.equal(t.latest.id, 'a');
  assert.equal(t.messages.length, 2);
  assert.equal(v.days[1].threads[0].latest, undefined, 'a one-message conversation has no reply line');
});

test('conversations with no usable time share one last group, after every real day', () => {
  const v = messageView([
    msg({ id: 'bad', from: 'dwight', conversation: 'c1', created_at: 'not a time' }),
    msg({ id: 'new', from: 'dwight', conversation: 'c2', created_at: at(15) }),
    msg({ id: 'none', from: 'dwight', conversation: 'c3', created_at: '' }),
    msg({ id: 'old', from: 'dwight', conversation: 'c4', created_at: at(15, 24) })
  ]);
  assert.deepEqual(v.days.map((d) => d.day), [localDay(at(15)), localDay(at(15, 24)), '']);
  assert.deepEqual(v.days[2].threads.map((t) => t.first.id).sort(), ['bad', 'none']);
});

test('a conversation with one broken time stays under its real day, timed by its newest real message', () => {
  const v = messageView([
    msg({ id: 'q', from: 'dwight', act: 'request', subject: 'Has Dennis replied?', conversation: 'c1', created_at: at(14) }),
    msg({ id: 'x', from: 'pam', to: 'dwight', body: 'Still checking.', conversation: 'c1', created_at: 'not a time' }),
    msg({ id: 'a', from: 'pam', to: 'dwight', body: 'Not yet.', conversation: 'c1', created_at: at(15) }),
    msg({ id: 'other', from: 'dwight', conversation: 'c2', created_at: at(13) })
  ]);
  assert.deepEqual(v.days.map((d) => d.day), [localDay(at(15))], 'no Undated group');
  const [t, other] = v.days[0].threads;
  assert.equal(other.first.id, 'other', 'still ordered by its newest real time');
  assert.equal(t.first.id, 'q');
  assert.equal(t.latest.id, 'a', 'the reply line and the time beside it are the same message');
  assert.equal(t.lastAt, at(15));
  assert.deepEqual(t.messages.map((m) => m.id), ['q', 'a', 'x'], 'the undated message reads last');
});

test('one real time and one broken one: the row has no reply line to repeat the first message', () => {
  const v = messageView([
    msg({ id: 'x', from: 'pam', conversation: 'c1', created_at: '' }),
    msg({ id: 'q', from: 'dwight', conversation: 'c1', created_at: at(14) })
  ]);
  const [t] = v.days[0].threads;
  assert.equal(v.days[0].day, localDay(at(14)));
  assert.equal(t.first.id, 'q');
  assert.equal(t.latest, undefined);
  assert.deepEqual(t.messages.map((m) => m.id), ['q', 'x']);
});

test('routine, verbs and the quoted gist', () => {
  assert.equal(isRoutine({ from: 'pam', subject: 'CLOSING-TIME-ACK' }), true);
  assert.equal(isRoutine({ from: 'dwight', subject: 'Deal' }), false);
  assert.equal(verbKey('request'), 'request');
  assert.equal(verbKey('whatever'), 'other');
  assert.equal(gist({ subject: '', body: '\n\nFirst line\nsecond' }), 'First line');
  assert.equal(gist({ subject: 'x'.repeat(200), body: '' }).length, 160);
});

test('business questions about closing time remain conversations', () => {
  const subjects = [
    'What is the closing time for this deal?',
    'Closing time for the deal',
    'Closing time for this shipment?',
    'Meeting notes mention Closing time: reminder'
  ];
  const messages = subjects.map((subject, i) => msg({ id: `business-${i}`, from: i === 1 ? 'human' : 'sales', subject, created_at: at(i + 9) }));
  const v = messageView(messages);
  assert.deepEqual(v.days[0].threads.map((t) => t.first.id).sort(), messages.map((m) => m.id));
  assert.equal(v.notices.closing, 0);
  for (const m of messages) assert.equal(isRoutine(m), false, m.subject);
});

test('closing protocol and controller messages count as closing notices', () => {
  const notices = [
    ['worker', 'CLOSING-TIME-ACK'],
    ['worker', 'Closing Time Ack: cards saved'],
    ['manager-42', 'closing_time_complete'],
    ['manager-42', 'Closing time — save work'],
    ['worker', 'Re: CLOSING-TIME-ACK'],
    ['god', 'Closing time: save your work and send CLOSING-TIME-ACK'],
    ['human', 'Closing time: close the office now'],
    ['human', 'Closing time: reminder'],
    ['human', 'Closing time cancelled'],
    ['human', 'Closing time: closing without Pam'],
    ['human', 'Closing time: Pam was archived'],
    ['human', "Closing time: Pam's terminal ended"],
    ['human', 'Closing time: still waiting on the team']
  ].map(([from, subject], i) => msg({ id: `notice-${i}`, from, subject, created_at: at(i + 9) }));
  const v = messageView([
    ...notices,
    msg({ id: 'scheduled', from: 'scheduler', subject: 'Check emails', created_at: at(20) }),
    msg({ id: 'system', from: 'system', subject: 'Office ready', created_at: at(21) })
  ]);
  assert.equal(v.notices.closing, notices.length);
  assert.equal(v.notices.scheduled, 1);
  assert.equal(v.notices.other, 1);
  assert.deepEqual(v.days, []);
  for (const m of notices) assert.equal(isRoutine(m), true, m.subject);
});

test('every subject closing time sends is a notice, whatever name it carries', () => {
  // Value: protects=closing the office never fills Messages with the app's own notes; fails_when=a closing time subject (plain "Closing time" to each member, someone back, not reporting, wait after all) shows as a conversation; why_new=review of #479 found four the first list missed; seam=source scan of src/main/closingTime.ts
  const src = read('src/main/closingTime.ts');
  const subjects = [];
  for (const line of src.split('\n').filter((l) => /subject: /.test(l))) {
    for (const m of line.matchAll(/(['`])(Closing time[^'`]*)\1/g)) subjects.push(m[2].replace(/\$\{[^}]+\}/g, 'Pam'));
  }
  assert.ok(subjects.length >= 10, `found ${subjects.length} subjects`);
  for (const s of subjects) assert.equal(isRoutine({ from: 'human', subject: s }), true, s);
});

test('no accordion bars: light rows, day headings, one notices line, plain verbs', () => {
  const src = read('src/renderer/src/components/ThreadsPanel.tsx');
  assert.doesNotMatch(src, /PixelPanel/, 'no boxed panel per conversation');
  assert.doesNotMatch(src, /threads\.routine/, "no 'routine 2' label");
  assert.match(src, /t\(`threads\.verb\.\$\{verbKey\(m\.act\)\}`/);
  assert.match(src, /t\('threads\.notices'/);
  assert.match(src, /aria-expanded=\{isOpen\}/);
  assert.match(read('src/renderer/src/design/global.css'), /\.cth-thread-row \+ \.cth-thread-row \{ border-top: 1px solid var\(--cth-ink-100\); \}/);
});

test('strings in every language, no dashes, no literal Michael', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json')).threads;
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).threads;
    assert.deepEqual(keys(d).sort(), keys(en).sort(), loc);
    for (const k of keys(d)) {
      const v = k.split('.').reduce((o, x) => o[x], d);
      assert.doesNotMatch(v, /[–—]| - /, `${loc} ${k}`);
      assert.doesNotMatch(v, /Michael/, `${loc} ${k}`);
    }
  }
});
