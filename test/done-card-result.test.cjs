'use strict';

/**
 * A Done card says what came of it (issue 51). Michael is told to write a
 * "result" when he marks a card Done, and the app saved it, but the board
 * dropped the field when it read the ledger, so only the Slack notifier ever
 * showed it. The card detail now shows it first, files as chips, and the board
 * shows its first line on the Done card. Michael's words only: nothing is
 * checked or invented, and a card with no result shows nothing new.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { parseTasks, resultHeadline } = loadTs('src/renderer/src/components/hiveTasks.ts');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const card = (extra) => ({ id: '42', title: 'Customer feedback report', status: 'done', assignee: 'pam', ...extra });

test('the board keeps the result Michael wrote on a card', () => {
  // Value: protects=the owner sees what a Done card produced; fails_when=parseTasks drops result again; why_new=issue 51, the field never reached the card; seam=none
  const result = '**The September feedback report is ready.**\n- 48 replies read\n- `~/Documents/Office/feedback-september.md`';
  const [kept, blank, wrong] = parseTasks({ tasks: [card({ result }), card({ id: '43', result: '   ' }), card({ id: '44', result: 7 })] });
  assert.equal(kept.result, result, 'kept exactly as written');
  assert.equal(blank.result, undefined, 'a blank result is no result');
  assert.equal(wrong.result, undefined, 'only text is a result');
});

test('the board line is the result\'s first line as plain text', () => {
  // Value: protects=a readable one line summary on the Done card; fails_when=markdown marks or a blank first line leak onto the board; why_new=issue 51 board line; seam=none
  assert.equal(resultHeadline('**The report is ready.**\n- 48 replies read'), 'The report is ready.');
  assert.equal(resultHeadline('\n\n## Sent to the supplier\nMore'), 'Sent to the supplier');
  assert.equal(resultHeadline('- Saved `report.md` in *Office*'), 'Saved report.md in Office');
  assert.equal(resultHeadline('1. Booked the van for Monday'), 'Booked the van for Monday');
  assert.equal(resultHeadline(undefined), '');
  assert.equal(resultHeadline('   \n  '), '');
  // An underscore inside a name is part of it, not emphasis.
  assert.equal(resultHeadline('Saved q3_sales_report.md in Office'), 'Saved q3_sales_report.md in Office');
  assert.equal(resultHeadline('Emailed first_last_name@acme.com'), 'Emailed first_last_name@acme.com');
  assert.equal(resultHeadline('Sent the _final_ quote to __Kelly__'), 'Sent the final quote to Kelly');
});

test('the card detail shows the result first on a Done card, and the board shows its first line', () => {
  // Value: protects=where the result shows and when it does not; fails_when=the section is dropped, shown on cards not Done, or the board line shows on an owner closed card; why_new=issue 51, owner chose detail plus board line from the mockup; seam=none
  const kanban = read('src/renderer/src/components/TasksKanban.tsx');
  const detail = kanban.slice(kanban.indexOf('export function TaskDetail'));
  assert.match(detail, /\{task\.status === 'done' && task\.result && \(\s*<div data-result>\{label\(t\('kanban\.result'\)\)\}/);
  assert.match(detail, /<FileText source=\{task\.result\} who=\{\{ assignee: qaAssignee \}\} \/>/, 'files in it open like Ask me files');
  assert.ok(detail.indexOf('data-result') < detail.indexOf("label(t('kanban.description'))"), 'the result comes before the description');
  assert.match(kanban, /\{done && task\.closedBy !== 'owner' && resultHeadline\(task\.result\) && \(\s*<span data-result/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const kanbanStrings = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).kanban;
    assert.equal(typeof kanbanStrings.result, 'string', `${loc} names the Result section`);
  }
});
