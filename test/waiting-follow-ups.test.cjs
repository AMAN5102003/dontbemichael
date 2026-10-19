'use strict';

/**
 * Waiting cards come back (owner, 2026-10-17; eng review D4 E and D5 B; card-
 * lifecycle.md section 8). The team member names when to check back (a date
 * the other side named, else their judgement), the app keeps that time as a
 * clock with three business days when nobody set a sound one, Michael is told
 * once when it comes and keeps a gone quiet list, and after two follow ups with
 * no reply he asks the owner.
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
const G = loadTs('src/shared/cardGuards.ts');
const O = loadTs('src/shared/ownerRequests.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const card = (id, extra = {}) => ({ id, title: id, status: 'waiting', waitingOn: 'customer Gopi', assignee: 'pam', dependsOn: [], priority: 3, createdAt: '2026-10-11T00:00:00Z', ...extra });
/** An ISO time with its offset for a local date. */
const iso = (ms) => {
  const t = new Date(ms);
  const off = -t.getTimezoneOffset();
  const p = (n) => String(Math.abs(n)).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}:00${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
};
const DAY = 86_400_000;

test('three business days skip the weekend', () => {
  // Value: protects=the default check back time never lands on a Saturday; fails_when=weekends count as days; why_new=new rule; seam=pure addBusinessDays()
  const fri = new Date(2026, 9, 16, 10).getTime();
  assert.equal(new Date(G.addBusinessDays(fri, 3)).getDay(), 3, 'Friday plus 3 is Wednesday');
  const mon = new Date(2026, 9, 19, 10).getTime();
  assert.equal(new Date(G.addBusinessDays(mon, 3)).getDay(), 4, 'Monday plus 3 is Thursday');
});

test('the check back time: a sound nextAt, else three business days; told once; follow ups counted; the owner asked after two', () => {
  // Value: protects=D4 E and D5 B: every Waiting card comes back, a named date is kept, nobody is told twice, and silence ends with the owner asked; fails_when=a card without a date never comes back, a far or past date is taken, the note repeats, a reset is not counted, or the third time is another follow up; why_new=new rule; seam=pure waitingChecks()
  const t0 = new Date(2026, 9, 19, 10).getTime(); // a Monday
  let s = G.waitingChecks([card('none'), card('named', { nextAt: iso(t0 + 7 * DAY) }), card('far', { nextAt: iso(t0 + 40 * DAY) }), card('past', { nextAt: iso(t0 - DAY) }), card('todo', { status: 'todo' })], {}, t0);
  assert.deepEqual(Object.keys(s.waiting).sort(), ['far', 'named', 'none', 'past'], 'only Waiting cards get a clock');
  assert.equal(Date.parse(s.waiting.named.checkAt), Date.parse(iso(t0 + 7 * DAY)), 'a date they named is kept');
  for (const id of ['none', 'far', 'past']) assert.equal(Date.parse(s.waiting[id].checkAt), G.addBusinessDays(t0, 3), `${id}: three business days`);
  assert.deepEqual(s.due, []);

  const t1 = G.addBusinessDays(t0, 3) + 60_000;
  s = G.waitingChecks([card('none')], s.waiting, t1);
  assert.deepEqual(s.due.map((d) => [d.card.id, d.askOwner]), [['none', false]], 'told when the time comes');
  assert.deepEqual(s.overdue.map((d) => d.card.id), ['none']);
  s = G.waitingChecks([card('none')], s.waiting, t1 + 60 * 60_000);
  assert.deepEqual(s.due, [], 'told once');
  assert.deepEqual(s.overdue.map((d) => d.card.id), ['none'], 'still listed while overdue');

  // Michael has Pam follow up and sets a new time: follow up 1 done.
  let at = t1 + 2 * 60 * 60_000;
  s = G.waitingChecks([card('none', { nextAt: iso(at + 2 * DAY) })], s.waiting, at);
  assert.equal(s.waiting.none.followUps, 1);
  assert.deepEqual(s.overdue, [], 'off the list once a new time is set');
  at += 2 * DAY + 60_000;
  s = G.waitingChecks([card('none', { nextAt: s.waiting.none.nextAt })], s.waiting, at);
  assert.deepEqual(s.due.map((d) => d.askOwner), [false], 'second check back: still a follow up');
  s = G.waitingChecks([card('none', { nextAt: iso(at + 2 * DAY) })], s.waiting, at + 60_000);
  assert.equal(s.waiting.none.followUps, 2);
  at += 2 * DAY + 2 * 60_000;
  s = G.waitingChecks([card('none', { nextAt: s.waiting.none.nextAt })], s.waiting, at);
  assert.deepEqual(s.due.map((d) => d.askOwner), [true], 'after two follow ups, ask the owner');

  // The customer answers: the card leaves Waiting and its clock goes; back in Waiting it starts afresh.
  s = G.waitingChecks([card('none', { status: 'doing' })], s.waiting, at + 60_000);
  assert.deepEqual(s.waiting, {});
  s = G.waitingChecks([card('none')], s.waiting, at + 120_000);
  assert.equal(s.waiting.none.followUps, 0);
  assert.equal(s.waiting.none.since, new Date(at + 120_000).toISOString());
});

test('Michael\'s notes and gone quiet list say who it waits on, for how long, and what to do', () => {
  // Value: protects=Michael can act on the note without guessing, and the words carry no dash; fails_when=the count, the age, the ask owner step or the list line goes missing; why_new=new notes; seam=pure note builders
  const now = Date.parse('2026-10-20T15:00:00Z');
  const clock = { since: '2026-10-14T15:00:00Z', followUps: 0 };
  const due = O.waitingDueNote(card('refund', { title: 'Refund for order' }), clock, false, now);
  assert.equal(due.subject, 'Follow up due: card refund');
  assert.match(due.body, /Card refund "Refund for order" has waited on customer Gopi for 6 days, and its check back time has come\. This is follow up 1 of 2\. Have pam follow up with them, then set a new "nextAt"/);
  const ask = O.waitingDueNote(card('refund', { title: 'Refund for order' }), { ...clock, followUps: 2 }, true, now);
  assert.equal(ask.subject, 'No reply after 2 follow ups: card refund');
  assert.match(ask.body, /Ask the owner on Ask me whether to keep waiting or close it: add the question to the card's humanQA and move the card to "blocked"\./);
  const list = O.stuckCardsContext([{ id: 'refund', title: 'Refund for order', assignee: 'pam', issue: 'gone-quiet', quiet: { waitingOn: 'customer Gopi', since: new Date(Date.now() - 3 * DAY).toISOString(), followUps: 1 } }]);
  assert.match(list, /^WAITING CARDS GONE QUIET, oldest first\./);
  assert.match(list, /- card refund: Refund for order \(with pam\), waiting on customer Gopi for 3 days, 1 follow up done/);
  for (const text of [due.body, ask.body, list]) assert.doesNotMatch(text, /[–—]| - [a-z]/);
});

test('the fleet tick tells Michael once when a Waiting card\'s time comes, lists it, and remembers across a restart', async (t) => {
  // Value: protects=the clock fires through the real tick, reaches Michael (never the person), survives a restart without repeating, and the card sits on his list; fails_when=the tick skips Waiting, the note goes to Pam, repeats after a restart, or the list misses it; why_new=new path; seam=refreshOwnerRequests() and the private guard file; no_claim=Michael's handling (agent behavior)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-waiting-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home, role: 'Support' });
  const inbox = (id) => {
    const dir = path.join(hive.root(), 'agents', id, 'inbox');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  };
  // A check back time set a minute ago for a minute ago is not sound, so put
  // a sound one on the guard's clock directly: the card waited last week.
  hive.writeTasks([card('refund', { title: 'Refund for order' })]);
  hive.refreshOwnerRequests();
  const file = path.join(home, 'private', 'card-guard.json');
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(st.waiting.refund, 'the clock is kept with the guard');
  st.waiting.refund.since = '2026-10-01T09:00:00.000Z';
  st.waiting.refund.checkAt = '2026-10-06T09:00:00.000Z';
  fs.writeFileSync(file, JSON.stringify(st));
  const fresh = new HiveManager(() => home);
  fresh.refreshOwnerRequests();
  fresh.refreshOwnerRequests();
  const notes = inbox('god').filter((m) => m.subject === 'Follow up due: card refund');
  assert.equal(notes.length, 1, 'to Michael, once');
  assert.equal(notes[0].conversation, 'card:refund');
  assert.ok(!inbox('pam').some((m) => /Follow up due/.test(m.subject)), 'never to the person directly');
  assert.deepEqual(fresh.stuckCards().filter((c) => c.issue === 'gone-quiet').map((c) => c.id), ['refund'], 'on his gone quiet list');
  new HiveManager(() => home).refreshOwnerRequests();
  assert.equal(inbox('god').filter((m) => m.subject === 'Follow up due: card refund').length, 1, 'not again after a restart');
});

test('the rules: team members name a check back time, Michael keeps it on the card, and the standup works the list', () => {
  // Value: protects=the agent behavior changes approved in D4 and D5, and offices on the old standup text get the new one; fails_when=a rule is dropped or the old focus stops being recognised; why_new=prompt changes; seam=source pins; no_claim=how agents follow them
  const hive = read('src/main/hive.ts');
  assert.match(hive, /When it waits on someone, also tell him when to check back: the date they named \(for "next week", the first working morning after it\), else your own judgement of when a reply is due\./);
  assert.match(hive, /and "nextAt" set to when to check back: the date the team member gave you/);
  assert.match(hive, /after two follow ups with no reply, ask the owner on Ask me whether to keep waiting or close it\./);
  const config = loadTs('src/main/config.ts');
  assert.match(config.OPS_STANDUP_FOCUS, /else work the gone quiet list\./, 'the list itself says what to do (WAITING CARDS GONE QUIET)');
  assert.ok(config.OPS_STANDUP_BUILT_IN_FOCUSES.some((f) => f.endsWith('a waiting card returns to doing when they answer; else chase them. Re-engage anyone stalled and keep the board right.')), 'the old text is upgraded');
});
