'use strict';

/**
 * The Ask me board reads as a list (owner, 2026-09-30): folded cards show the
 * ask in a line or two; one card is open at a time, the newest by default.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { askHeadline, askTitle, askedAgo } = loadTs('src/renderer/src/components/askHeadline.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('the headline is Michael\'s bold lead, else the first sentence, as plain text', () => {
  assert.equal(askHeadline('**Two deals passed their close date. Where does each stand?**\n\n1. `GammaTile`'), 'Two deals passed their close date. Where does each stand?');
  assert.equal(askHeadline('Refund it, or tell Kelly what to say?'), 'Refund it, or tell Kelly what to say?');
  assert.equal(askHeadline('Please check whether `support@x.it` is reaching. It has shown no mail.'), 'Please check whether support@x.it is reaching.');
  assert.equal(askHeadline('Sign in again\nwith the app password'), 'Sign in again');
});

test('the headline does not truncate at common abbreviations', () => {
  assert.equal(askHeadline('Mr. Davis sent an invoice for $500. Should we pay it?'), 'Mr. Davis sent an invoice for $500.');
  assert.equal(askHeadline('Dr. Watson requested an update on the case. What should I reply?'), 'Dr. Watson requested an update on the case.');
  assert.equal(askHeadline('Invoice No. 42 is ready for review. Can you check it?'), 'Invoice No. 42 is ready for review.');
  assert.equal(askHeadline('The answer was no. What should we do next?'), 'The answer was no.');
  assert.equal(askHeadline('Acme Inc. sent their proposal. Should we review it?'), 'Acme Inc. sent their proposal.');
  assert.equal(askHeadline('e.g. please check whether the payment cleared. It is pending.'), 'e.g. please check whether the payment cleared.');
  assert.equal(askHeadline('U.S. tax forms are ready. Should I file them?'), 'U.S. tax forms are ready.');
  assert.equal(askHeadline('Bring cups, plates, etc. before Friday. Can you order them?'), 'Bring cups, plates, etc. before Friday.');
  assert.equal(askHeadline('The delivery arrives at 9 a.m. tomorrow. Should I confirm it?'), 'The delivery arrives at 9 a.m. tomorrow.');
  assert.equal(askHeadline('Close the register at 6 p.m. tonight. Who has the keys?'), 'Close the register at 6 p.m. tonight.');
});

test('the headline keeps underscores in file names and addresses, and drops them as emphasis', () => {
  assert.equal(askHeadline('Should I send `monthly_report.pdf` to Kelly? It is ready.'), 'Should I send monthly_report.pdf to Kelly?');
  assert.equal(askHeadline('Can I email first_last@acme.com the quote?'), 'Can I email first_last@acme.com the quote?');
  assert.equal(askHeadline('Is `a*b` the right formula?'), 'Is a*b the right formula?');
  assert.equal(askHeadline('**Approve the _final_ invoice?** It is ready.'), 'Approve the final invoice?');
  assert.equal(askHeadline('__Approve__ the *new* price?'), 'Approve the new price?');
});

test('how long ago, in plain words', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  assert.equal(askedAgo('2026-09-30T11:59:30Z', now, 'en'), 'just now');
  assert.equal(askedAgo('2026-09-30T07:00:00Z', now, 'en'), '5h ago');
  assert.equal(askedAgo(undefined, now, 'en'), '');
});

test('one card is open at a time, the newest by default; folded cards show the headline', () => {
  const src = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(src, /const pinned = openId !== undefined && \(openId === null \|\| waiting\.some\(\(x\) => x\.key === openId\)\);/);
  assert.match(src, /const expanded = pinned \? openId === row\.key : idx === 0;/);
  // Typing pins the card, so a newer ask never folds it mid answer (review, 2026-10-01).
  assert.match(src, /onFocus=\{\(\) => setOpenId\(row\.key\)\}/);
  assert.match(src, /\{askHeadline\(open\.q\)\}/);
  assert.match(src, /WebkitLineClamp: 2/);
  // A chevron shows a card folds and opens, and turns as it opens.
  assert.match(src, /className="cth-askme-chevron"/);
  assert.match(src, /transform: expanded \? 'rotate\(180deg\)' : undefined/);
  // Nothing the owner relies on went away: answering, routing and memory are unchanged.
  assert.match(src, /window\.cth\.hiveRememberOwnerAnswer\(/);
  assert.match(src, /\{translate\('askMe\.openTask'\)\}/);
  // The cards sit on the app's own background, no tinted slab behind them.
  assert.match(read('src/renderer/src/shell/NeedsYouBoard.tsx'), /padding: '14px 16px 12px'\n\s+\}\}>/);
});

test('an ask is cleared only by answering it: no dismiss on the board (owner, 2026-10-01)', () => {
  const src = read('src/renderer/src/components/AskMeTab.tsx');
  assert.doesNotMatch(src, /const dismiss = /);
  assert.doesNotMatch(src, /dismissedAt: new Date/);
  assert.doesNotMatch(src, /askMe\.dismiss/);
  // Older dismissed entries are still read as closed (askMeRouting openAskIndexes).
  assert.match(read('src/shared/askMeRouting.ts'), /dismissedAt/);
});

/**
 * Card titles read clean (owner, 2026-10-01: a header full of a user id and
 * "(support@, 1 Oct)" looked cryptic). Agents are told to write plain titles,
 * and the card cleans the ones that aren't.
 */
test('an Ask me card title drops opaque ids and bracketed metadata', () => {
  assert.equal(askTitle('Acme app user Xk29fLq8ZpR3mN7tV2wB requested CRM setup (support@, 1 Oct)'), 'Acme app user requested CRM setup');
  assert.equal(askTitle('Billing export errors (30 Sep)'), 'Billing export errors');
  assert.equal(askTitle('Check mail is reaching help@example.com (nothing since 21 Sep, per Kelly)'), 'Check mail is reaching help@example.com');
  assert.equal(askTitle('Order 550e8400-e29b-41d4-a716-446655440000 is stuck'), 'Order is stuck');
  // Plain titles, and brackets that are part of the name, stay as they are.
  assert.equal(askTitle('New lead: Jane Doe, example.org (website form)'), 'New lead: Jane Doe, example.org (website form)');
  assert.equal(askTitle('Refund for Northwind Cafe, Invoice #4471'), 'Refund for Northwind Cafe, Invoice #4471');
  const tab = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(tab, /\{askTitle\(t\.title\)\}/);
  // And at the source: Michael and the team are told how to title a card.
  const hive = read('src/main/hive.ts');
  assert.match(hive, /The card(\\'|')s title is its headline: a few plain words naming the matter, under 60 characters/);
  assert.match(hive, /Give the card a TITLE the owner can read at a glance/);
  assert.match(hive, /- give the card a title the owner reads at a glance/);
});

/**
 * Task detail (owner, 2026-10-01): the id and close sit on one row with the
 * title below at full width. Owner, 2026-10-11: cards carry no running notes
 * (agents used them as diaries of up to 8,700 characters); an agent's activity
 * lives in its conversation and the office log, and a To do card's next step
 * time shows as "Next: ..." in local time.
 */
test('task detail: title under the id row, no running notes, the next step time shows', () => {
  // Value: protects=cards read as where the work stands, not a diary; fails_when=notes come back on the card or in the prompts, or nextAt stops showing; why_new=owner, 2026-10-11; seam=source pins
  const src = read('src/renderer/src/components/TasksKanban.tsx');
  const model = read('src/renderer/src/components/hiveTasks.ts');
  assert.doesNotMatch(model, /notes: typeof t\.notes/, 'the parser no longer reads notes');
  assert.match(model, /nextAt: isNextAt\(t\.nextAt\) \? t\.nextAt : undefined,/);
  assert.doesNotMatch(src, /task\.notes/);
  assert.equal((src.match(/const next = nextAtLabel\(task\.nextAt, i18n\.language\);/g) || []).length, 2, 'on the card and in the detail, in the app language');
  assert.equal((src.match(/t\('kanban\.nextAt', \{ when: next \}\)/g) || []).length, 2);
  assert.doesNotMatch(read('src/renderer/src/components/TaskDetailOverlay.tsx'), /task\.notes/);
  assert.doesNotMatch(src, /noDescription/);
  assert.match(src, /<div style=\{\{ marginTop: 10, fontSize: 16, fontWeight: 600[^}]*\}\}>\{askTitle\(task\.title\)\}<\/div>/);
  const hive = read('src/main/hive.ts');
  assert.doesNotMatch(hive, /Keep the card\\?'s "notes"/);
  assert.equal((hive.match(/Write no running \\?"notes\\?" on a card \(house rule 8\)/g) || []).length, 2, 'Michael\'s business and legacy prompts');
  assert.doesNotMatch(read('src/main/closingTime.ts'), /says where the work stands and the next step/);
  for (const loc of ['en', 'zh-CN', 'ar']) assert.match(JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).kanban.nextAt, /\{\{when\}\}/, loc);
});

test('a next step time that is not a date never reaches the card', () => {
  // Value: protects=a card shows "Next" only for a real time, in local time; fails_when=the parser keeps an unparseable nextAt or the label prints "Invalid Date"; why_new=the parser and label were only source pinned; seam=none
  // no_claim=the label's exact wording is the runtime locale's; only the local day and the absence of an invalid date are checked
  const { parseTasks, nextAtLabel } = loadTs('src/renderer/src/components/hiveTasks.ts');
  const when = '2026-10-12T08:00:00+05:30';
  const [bad, good] = parseTasks({ tasks: [{ id: 'a', title: 'a', status: 'todo', nextAt: 'Monday after the 20th' }, { id: 'b', title: 'b', status: 'todo', nextAt: when }] });
  assert.equal(bad.nextAt, undefined, 'agent text that is not a date is dropped');
  assert.equal(good.nextAt, when);
  assert.equal(nextAtLabel(undefined), undefined);
  assert.equal(nextAtLabel('not a date'), undefined, 'never "Invalid Date"');
  // Review 2026-10-12: loose agent dates never show (V8 reads the first as 2001,
  // and a bare date as midnight UTC, the evening before west of it).
  const [loose, dateOnly] = parseTasks({ tasks: [{ id: 'l', title: 'l', status: 'todo', nextAt: 'Mon 12 Oct 13:00' }, { id: 'd', title: 'd', status: 'todo', nextAt: '2026-10-12' }] });
  assert.equal(loose.nextAt, undefined);
  assert.equal(dateOnly.nextAt, undefined);
  assert.equal(nextAtLabel('Mon 12 Oct 13:00'), undefined);
  const label = nextAtLabel(when);
  assert.ok(label && !/Invalid/.test(label), label);
  assert.match(label, new RegExp(`\\b${new Date(when).getDate()}\\b`), 'the day in the viewer\'s local time');
});

/** The answer box grows with the text (owner, 2026-10-01). */
test('the Ask me answer box grows with what is typed, then scrolls', () => {
  const tab = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(tab, /<GrowingTextarea\n\s*className="cth-input"/);
  assert.doesNotMatch(tab, /rows=\{draft\.includes/);
  const grow = read('src/renderer/src/components/GrowingTextarea.tsx');
  assert.match(grow, /el\.style\.height = `\$\{Math\.min\(full, maxHeight\)\}px`;/);
  assert.match(grow, /el\.style\.overflowY = full > maxHeight \? 'auto' : 'hidden';/);
  assert.match(grow, /new ResizeObserver/);
});

/** Talk to Michael grows the same way (owner, 2026-10-01). */
test('the Talk to Michael box grows upward; Enter sends, Shift+Enter is a new line', () => {
  const bar = read('src/renderer/src/shell/BottomBar.tsx');
  assert.match(bar, /<GrowingTextarea\n\s*value=\{text\}/);
  assert.match(bar, /if \(e\.key === 'Enter' && !e\.shiftKey\) \{ e\.preventDefault\(\); void send\(\); \}/);
  assert.match(bar, /bottom: 24, zIndex: 70,\n\s*display: 'flex', alignItems: 'flex-end'/);
  assert.match(bar, /<div style=\{\{ height: 50, display: 'flex', alignItems: 'center', gap: 14 \}\}>/);
});

test('card titles and times hold up at the edges', () => {
  // Generated by /ship coverage audit (pass 1).
  // Value: protects=a card header never goes blank, keeps stacked metadata, or shows a broken time; fails_when=askTitle strips only one trailing bracket, empties an all-id title, or askedAgo loses its minute/day steps, its bad-date guard or its clamp for a clock ahead; why_new=only the happy paths were checked; seam=none
  // Every trailing bracket of metadata goes, one after another; a name bracket stays.
  assert.equal(askTitle('Mailbox check (support@) (2026-09-30)'), 'Mailbox check');
  assert.equal(askTitle('Refund (website form) (1 Oct)'), 'Refund (website form)');
  // A title that is only an id is kept as it is rather than shown empty.
  assert.equal(askTitle('Xk29fLq8ZpR3mN7tV2wB'), 'Xk29fLq8ZpR3mN7tV2wB');
  // Removing an id leaves no stray space before punctuation.
  assert.equal(askTitle('User a1b2c3d4e5f6a7b8c9d0 , needs access'), 'User, needs access');
  // The headline drops headings, links and code marks.
  assert.equal(askHeadline('## Sign in to [QuickBooks](https://example.com) now. Then tell me.'), 'Sign in to QuickBooks now.');
  const now = Date.parse('2026-09-30T12:00:00Z');
  assert.equal(askedAgo('2026-09-30T11:55:00Z', now, 'en'), '5m ago');
  assert.equal(askedAgo('2026-09-27T12:00:00Z', now, 'en'), '3d ago');
  assert.equal(askedAgo('not a date', now, 'en'), '', 'a bad timestamp shows nothing');
  assert.equal(askedAgo('2026-09-30T12:05:00Z', now, 'en', 'now'), 'now', 'a clock ahead of ours is just now, never negative');
  assert.notEqual(askedAgo('2026-09-30T11:00:00Z', now, 'ar'), askedAgo('2026-09-30T11:00:00Z', now, 'en'), 'in the app\'s language');
});

/**
 * Review, 2026-10-01: an agent-written card with no string title crashed the
 * Ask me board, and a huge title took about half a second per render.
 */
test('askTitle never throws on agent-written data, stays fast, and keeps readable names', () => {
  for (const bad of [undefined, null, 42, {}]) assert.equal(askTitle(bad), '');
  const t0 = Date.now();
  askTitle('Refund (' + ' '.repeat(50000) + 'x');
  askTitle('A' + ' (1 Oct)'.repeat(5000));
  assert.ok(Date.now() - t0 < 100, 'long titles stay fast');
  assert.equal(askTitle('Upgrade Windows10Enterprise laptops'), 'Upgrade Windows10Enterprise laptops');
  assert.equal(askTitle('Review Q3_2026_budget_final export'), 'Review Q3_2026_budget_final export');
  assert.equal(askTitle('Sign the lease (Suite 100)'), 'Sign the lease (Suite 100)');
  assert.equal(askTitle('Refund for Northwind Cafe (#4471, 30 Sep)'), 'Refund for Northwind Cafe');
  // A word that only starts like a month is part of the name, not a date.
  assert.equal(askTitle('Approve ad spend (3 marketing campaigns)'), 'Approve ad spend (3 marketing campaigns)');
  assert.equal(askTitle('Hire help (2 junior designers)'), 'Hire help (2 junior designers)');
  assert.equal(askTitle('Pick a supplier (Decision 2 of 3)'), 'Pick a supplier (Decision 2 of 3)');
  // Full and dotted month names are still dates.
  assert.equal(askTitle('Renew the lease (March 3)'), 'Renew the lease');
  assert.equal(askTitle('Send the quote (Sept. 30)'), 'Send the quote');
  assert.equal(askTitle('Pay the invoice (3 Sep.)'), 'Pay the invoice');
  const tab = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(tab, /const who = nameFor\(typeof t\.assignee === 'string' \? t\.assignee : undefined\);/);
});

test('See full context shows only when the card holds more than the question, and Michael keeps the background (owner, 2026-10-12)', () => {
  // Value: protects=the link never opens a repeat of the question, and blocked cards carry their background; fails_when=the footer shows unconditionally or the triage rule keeps the description on waiting cards only; why_new=the link and rule had no test; seam=none; no_claim=whether Michael writes a good background (no eval)
  const tab = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(tab, /const moreContext = \(typeof t\.description === 'string' && t\.description\.trim\(\) !== ''\)\n\s+\|\| \(typeof t\.result === 'string' && t\.result\.trim\(\) !== ''\)\n\s+\|\| \(t\.humanQA\?\.length \?\? 0\) > 1;/);
  assert.match(tab, /\{moreContext && \(\n\s+<div style=\{\{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10/, 'the footer and its link need something more to show');
  const hive = read('src/main/hive.ts');
  assert.match(hive, /make a card for it, keeping what they were doing and why in its "description" \(the owner reads it under See full context\): "blocked"/, 'triage keeps the background on blocked cards too');
  assert.doesNotMatch(hive, /the team member as assignee and what they were doing kept in its description/, 'no longer waiting cards only');
  assert.equal((hive.match(/so the owner can read it under See full context/g) ?? []).length, 3, 'ask rule, standing rule and the HIVE doc ask a background for asks Michael writes');
});

test('Task detail lists questions newest first, each with when it was asked (owner, 2026-10-12)', () => {
  // Value: protects=the open question is first on Task detail and each question says when it was asked; fails_when=the reverse, the ledger index key or the askedAgo span is dropped; why_new=no test covers the Q and A list order; seam=none; no_claim=pixel layout (source assertion, no render harness)
  const kanban = read('src/renderer/src/components/TasksKanban.tsx');
  assert.match(kanban, /task\.humanQA!\.map\(\(e, i\) => \[e, i\] as const\)\.reverse\(\)\.map\(\(\[e, i\]\) => \{/, 'newest first');
  assert.match(kanban, /<div key=\{i\} style=\{\{\n\s+padding: '10px 12px'/, 'the key stays the ledger index');
  assert.match(kanban, /const ago = askedAgo\(typeof e\.askedAt === 'string' \? e\.askedAt : undefined, Date\.now\(\), i18n\.language, t\('askMe\.justNow'\)\);/);
  assert.match(kanban, /\{t\('kanban\.question'\)\}<\/span>\n\s+\{ago && <span style=\{\{ fontSize: 11, color: 'var\(--cth-ink-3\)' \}\}>\{ago\}<\/span>\}/, 'the time beside Question, as on Ask me');
});

test('a reply that does not save says so and keeps the draft', () => {
  const tab = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(tab, /catch \{[\s\S]{0,300}setFailed\(row\.key\);[\s\S]{0,80}refreshNeedsYou\(\);/);
  assert.match(tab, /failed === row\.key && \([\s\S]{0,200}role="alert"[\s\S]{0,200}translate\('askMe\.mailFailed'\)/);
});
