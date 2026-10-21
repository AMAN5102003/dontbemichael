'use strict';

/**
 * The Tasks board's open columns read earliest Next first (owner, 2026-10-17;
 * design review D3 to D6): cards with no Next time after the dated ones, ties
 * by priority then the order made, and the Next line carries the year when it
 * is not this year so the sorted column reads right across the turn of the year.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { byNext, nextAtLabel } = loadTs('src/renderer/src/components/hiveTasks.ts');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const card = (id, nextAt, priority = 3) => ({ id, nextAt, priority });

test('earliest Next first, no Next after, ties by priority then the order made', () => {
  // Value: protects=D3 A and D4 A; fails_when=the column keeps the made order, undated cards jump to the top, ties swap between refreshes, or priority is ignored at the same time; why_new=new order; seam=pure byNext(); no_claim=the rendered board (live check)
  // The owner's column as made: Oct 19, Oct 20, Jan 4 2027, Oct 19, Jan 4 2027, Nov 2.
  const made = [
    card('pipeline', '2026-10-19T08:00:00-05:00'),
    card('inbox', '2026-10-20T09:00:00-05:00'),
    card('build', '2027-01-04T09:00:00-06:00'),
    card('prospects', '2026-10-19T08:00:00-05:00', 5),
    card('signin', '2027-01-04T09:00:00-06:00'),
    card('tax', '2026-11-02T09:00:00-06:00'),
    card('undated-low', undefined, 1),
    card('undated-high', undefined, 4),
    card('loose', 'Mon 12 Oct 13:00', 5)
  ];
  assert.deepEqual(byNext(made).map((c) => c.id),
    ['prospects', 'pipeline', 'inbox', 'tax', 'build', 'signin', 'loose', 'undated-high', 'undated-low'], 'a loose time counts as none');
  assert.deepEqual(made.map((c) => c.id)[0], 'pipeline', 'the board\'s own list is left as it was');
  const passed = [card('later', '2026-10-30T09:00:00-05:00'), card('overdue', '2026-10-01T09:00:00-05:00')];
  assert.deepEqual(byNext(passed).map((c) => c.id), ['overdue', 'later'], 'a time already passed is earliest');
});

test('every open column sorts by Next; Done keeps newest first', () => {
  // Value: protects=D6 A, one rule for To do, Doing, Waiting and Blocked; fails_when=a column skips the sort or Done is re-sorted by Next; why_new=new order; seam=source pin (no DOM harness)
  const kanban = read('src/renderer/src/components/TasksKanban.tsx');
  assert.match(kanban, /const cards = col\.key === 'done' \? \(showAllDone \|\| filtering \? \[\.\.\.all\]\.reverse\(\) : all\.slice\(-DONE_SHOWN\)\.reverse\(\)\) : byNext\(all\);/);
});

test('the Next line shows the year only when it is not this year', () => {
  // Value: protects=D5 A, a 2027 card under Nov 2 reads as next year; fails_when=the year is never shown, or this year's dates grow a year; why_new=new label; seam=now passed in; no_claim=every language's exact wording
  const now = Date.parse('2026-10-17T12:00:00-05:00');
  const thisYear = nextAtLabel('2026-11-02T09:00:00-06:00', 'en-US', now);
  const nextYear = nextAtLabel('2027-01-04T09:00:00-06:00', 'en-US', now);
  assert.doesNotMatch(thisYear, /2026/);
  assert.match(nextYear, /2027/);
  assert.match(nextAtLabel('2027-01-04T09:00:00-06:00', 'zh-CN', now), /2027/, 'in another language too');
  assert.equal(nextAtLabel('Mon 12 Oct 13:00', 'en-US', now), undefined, 'a loose time is still not shown');
});

const { nextGroup } = loadTs('src/renderer/src/components/hiveTasks.ts');
/** An ISO time with its offset for a local date, as house rule 8 asks. */
const iso = (y, mo, d, h = 9) => {
  const t = new Date(y, mo, d, h, 0, 0);
  const off = -t.getTimezoneOffset();
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  return `${y}-${pad(mo + 1)}-${pad(d)}T${pad(h)}:00:00${off >= 0 ? '+' : '-'}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
};

test('time groups in October: Overdue, Today, Tomorrow, This month, Later this year, Next quarter, Next year, Later, No date', () => {
  // Value: protects=the owner's groups (2026-10-17: calendar, in time order, Overdue on top, No date last); fails_when=a card lands in the wrong group or groups stop running earliest to latest; why_new=new rule; seam=pure nextGroup() with now passed in, local calendar; no_claim=the rendered headings (live check)
  const now = new Date(2026, 9, 17, 18, 0).getTime();
  const rows = [
    [iso(2026, 9, 17, 8), 'overdue'], [iso(2026, 9, 1), 'overdue'],
    [iso(2026, 9, 17, 20), 'today'], [iso(2026, 9, 18), 'tomorrow'],
    [iso(2026, 9, 19), 'thisMonth'], [iso(2026, 9, 31), 'thisMonth'],
    [iso(2026, 10, 2), 'laterThisYear'], [iso(2026, 11, 31), 'laterThisYear'],
    [iso(2027, 0, 4), 'nextQuarter'], [iso(2027, 2, 31), 'nextQuarter'],
    [iso(2027, 3, 1), 'nextYear'], [iso(2027, 11, 31), 'nextYear'],
    [iso(2028, 0, 1), 'later'], [undefined, 'none'], ['Mon 12 Oct 13:00', 'none']
  ];
  for (const [at, want] of rows) assert.equal(nextGroup(at, now), want, String(at));
});

test('time groups earlier in the year: This quarter, then Next quarter, then Later this year', () => {
  // Value: protects=groups stay in time order in every quarter, and Tomorrow wins across a month or year end; fails_when=the rest of a quarter is mislabelled or Later this year comes before Next quarter; why_new=new rule; seam=pure nextGroup()
  const feb = new Date(2026, 1, 10, 12).getTime();
  assert.equal(nextGroup(iso(2026, 2, 5), feb), 'thisQuarter');
  assert.equal(nextGroup(iso(2026, 3, 1), feb), 'nextQuarter');
  assert.equal(nextGroup(iso(2026, 5, 30), feb), 'nextQuarter');
  assert.equal(nextGroup(iso(2026, 6, 1), feb), 'laterThisYear');
  assert.equal(nextGroup(iso(2027, 1, 1), feb), 'nextYear');
  const aug = new Date(2026, 7, 20, 12).getTime();
  assert.equal(nextGroup(iso(2026, 8, 1), aug), 'thisQuarter');
  assert.equal(nextGroup(iso(2026, 9, 1), aug), 'nextQuarter');
  const eve = new Date(2026, 11, 31, 12).getTime();
  assert.equal(nextGroup(iso(2027, 0, 1), eve), 'tomorrow', 'tomorrow across the year end');
});

test('open lanes show a heading where the group changes; Done has none; every language has the words', () => {
  // Value: protects=the headings and their words in three languages, no dashes; fails_when=a heading repeats per card, Done grows headings, or a language misses a group; why_new=new UI; seam=source pins (no DOM harness)
  const kanban = read('src/renderer/src/components/TasksKanban.tsx');
  assert.match(kanban, /const group = col\.key === 'done' \|\| !dated \? null : nextGroup\(x\.nextAt, now\);/);
  assert.match(kanban, /const dated = cards\.some\(\(c\) => nextGroup\(c\.nextAt, now\) !== 'none'\);/, 'a lane with no dates has no headings');
  assert.match(kanban, /group !== nextGroup\(cards\[i - 1\]\.nextAt, now\)/);
  assert.match(kanban, /role="heading" aria-level=\{3\}/);
  const keys = ['overdue', 'today', 'tomorrow', 'thisMonth', 'thisQuarter', 'laterThisYear', 'nextQuarter', 'nextYear', 'later', 'none'];
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const g = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).kanban.group;
    for (const k of keys) {
      assert.equal(typeof g[k], 'string', `${loc} ${k}`);
      assert.doesNotMatch(g[k], /[–—]| - /, `${loc} ${k} has no dash`);
    }
  }
});
