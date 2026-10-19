'use strict';

/**
 * Pulse's measures (docs/designs/team-performance.md): cost for the work against
 * the office's usual (D6), kept as is (E2), speed (E3), away share (E4), cost per
 * piece (E5), plan headroom (E6), measured savings (D16), and the cost fold the
 * lifetime ledger and the processor share.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const P = loadTs('src/shared/teamPerformance.ts');
const F = loadTs('src/shared/costFold.ts');
const { lifetimeUsdFromLedger } = loadTs('src/main/costLifetime.ts');

const day = (agentId, d, o = {}) => ({ agentId, day: d, usd: 0, runUsd: 0, emails: 0, sent: 0, tasks: 0, checks: 0, checksNothing: 0, awayPieces: 0, ...o });
// Thursday 16 Oct 2026, noon local.
const NOW = new Date(2026, 9, 16, 12).getTime();

test('Today, this week and this month cover what they say, and Compare sets each against the same days before', () => {
  // Value: protects=D5 periods and D7 spans (owner, 2026-10-16); fails_when=a week starts on Sunday, a month overruns, the span before is not cut at the same day, the cap or the year wrap is wrong, or a DST week loses a day; why_new=new periods; seam=none; no_claim=time zones other than the test machine's
  const r = (p, now) => [P.periodRange(p, now).from, P.periodRange(p, now).to];
  const b = (p, now) => [P.previousRange(p, now).from, P.previousRange(p, now).to];
  const at = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  assert.deepEqual(P.PERIODS, ['today', 'this-week', 'this-month']);
  assert.deepEqual(r('today', NOW), ['2026-10-16', '2026-10-16']);
  assert.deepEqual(r('this-week', NOW), ['2026-10-12', '2026-10-18']);
  assert.deepEqual(r('this-month', NOW), ['2026-10-01', '2026-10-31']);
  assert.deepEqual(b('today', NOW), ['2026-10-15', '2026-10-15'], 'all of yesterday');
  assert.deepEqual(b('this-week', NOW), ['2026-10-05', '2026-10-09'], 'Monday to the same weekday, a Friday');
  assert.deepEqual(b('this-week', at(2026, 10, 12)), ['2026-10-05', '2026-10-05'], 'on a Monday, only last Monday');
  assert.deepEqual(b('this-month', NOW), ['2026-09-01', '2026-09-16']);
  assert.deepEqual(b('this-month', at(2026, 10, 31)), ['2026-09-01', '2026-09-30'], 'the 31st is capped at a 30 day month');
  assert.deepEqual(b('this-month', at(2026, 3, 31)), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(b('this-month', at(2028, 3, 30)), ['2028-02-01', '2028-02-29'], 'a leap year');
  assert.deepEqual(b('today', at(2027, 1, 1)), ['2026-12-31', '2026-12-31']);
  assert.deepEqual(b('this-month', at(2027, 1, 1)), ['2026-12-01', '2026-12-01']);
  assert.deepEqual(r('this-week', at(2026, 3, 8)), ['2026-03-02', '2026-03-08'], 'a week ending on a DST change (US)');
  assert.deepEqual(r('this-week', at(2026, 3, 29)), ['2026-03-23', '2026-03-29'], 'a week ending on a DST change (EU)');
  const busyDays = (now) => P.pulseSnapshot({ period: 'this-month', now, days: [], cards: [], decisions: [], asks: [], members: ['pam'] }).members[0].dayBusy.length;
  assert.equal(busyDays(at(2026, 10, 15)), 31, 'October keeps 31 days across a DST change');
  assert.equal(busyDays(at(2026, 11, 15)), 30, 'November keeps 30 days across a DST change');
});

test('Compare waits until the span before starts on or after the first live recorded day', () => {
  // Value: protects=D8 (owner, 2026-10-16); fails_when=a period compares against days Pulse never recorded, or waits longer than it must; why_new=new rule; seam=none; no_claim=backfilled data
  assert.equal(P.compareFrom('today', '2026-10-15'), '2026-10-16');
  assert.equal(P.compareFrom('this-week', '2026-10-15'), '2026-10-26');
  assert.equal(P.compareFrom('this-month', '2026-10-15'), '2026-12-01');
  assert.equal(P.compareFrom('this-month', '2026-10-01'), '2026-11-01', 'live from the 1st: the next month compares');
});

test('cost for the work compares like with like, and needs five pieces of a kind', () => {
  // Value: protects=D6 fairness; fails_when=unlike work is summed or a member with 4 pieces is compared; why_new=design D6; seam=none; no_claim=none beyond protects
  const days = [
    day('pam', '2026-10-13', { usd: 10, emails: 50 }),       // $0.20 an email
    day('kelly', '2026-10-13', { usd: 20, emails: 50 }),     // $0.40 an email
    day('erin', '2026-10-13', { usd: 15, emails: 50 }),      // $0.30 an email (the median)
    day('oscar', '2026-10-13', { usd: 8, tasks: 4 }),        // too few tasks
    day('toby', '2026-10-13', { usd: 14, runUsd: 14, checks: 2, checksNothing: 12 })
  ];
  const s = P.pulseSnapshot({ period: 'this-week', now: NOW, days, cards: [], decisions: [], asks: [], members: [] });
  const m = (id) => s.members.find((x) => x.agentId === id);
  assert.equal(m('pam').costForWork.verdict, 'cheaper');
  assert.equal(m('kelly').costForWork.verdict, 'pricier');
  assert.equal(m('erin').costForWork.verdict, 'usual');
  assert.ok(Math.abs(m('erin').costForWork.position - 0.5) < 1e-9);
  assert.equal(m('oscar').costForWork.verdict, 'too-few');
  assert.equal(m('toby').costForWork.verdict, 'too-few', '2 checks that did work is under five');
  assert.ok(m('pam').costForWork.position < 0.5 && m('kelly').costForWork.position > 0.5);
  assert.equal(s.totalUsd, 67);
  const checks = s.outcomes.find((o) => o.kind === 'check');
  assert.deepEqual([checks.total, checks.sub], [14, 2], 'checks run, checks that found work');
});

test('kept as is counts drafts and cards, leaves out cancelled drafts, reports and owner closes, and shares only from ten', () => {
  // Value: protects=E2 definition; fails_when=cancelled or excluded items count, or a share shows under 10; why_new=new; seam=none; no_claim=none beyond protects
  const t = NOW - 86_400_000;
  const decisions = [
    ...Array.from({ length: 6 }, () => ({ agentId: 'pam', decision: 'approve', at: t })),
    { agentId: 'pam', decision: 'approve-edited', at: t },
    { agentId: 'pam', decision: 'changes', at: t },
    { agentId: 'pam', decision: 'cancelled', at: t }
  ];
  const cards = [
    { id: 'a', assignee: 'pam', createdAt: t - 3600_000, doneAt: t, heldMs: 0, reopened: false, excluded: false },
    { id: 'b', assignee: 'pam', createdAt: t - 3600_000, doneAt: t, heldMs: 0, reopened: true, excluded: false },
    { id: 'r', assignee: 'pam', createdAt: t - 3600_000, doneAt: t, heldMs: 0, reopened: false, excluded: true }
  ];
  assert.deepEqual(P.keptAsIs('pam', decisions, cards), { kept: 7, decisions: 10, share: 0.7 });
  assert.equal(P.keptAsIs('pam', decisions.slice(0, 3), []).share, null, 'under ten decisions: counts only');
});

test('speed leaves out held time, and your time and away share come from the records', () => {
  // Value: protects=E3, E1 and E4; fails_when=Blocked time counts against a member or away share divides by the wrong total; why_new=new; seam=none; no_claim=none beyond protects
  const t = NOW - 86_400_000;
  const s = P.pulseSnapshot({
    period: 'this-week', now: NOW,
    days: [day('nick', '2026-10-15', { tasks: 2, emails: 2, awayPieces: 1 })],
    cards: [{ id: 'x', assignee: 'nick', createdAt: t - 5 * 3600_000, doneAt: t, heldMs: 3 * 3600_000, reopened: false, excluded: false }],
    decisions: [],
    asks: [{ raisedBy: 'nick', askedAt: t, answeredAt: t + 30 * 60_000 }, { raisedBy: 'nick', askedAt: t }],
    members: ['nick']
  });
  const nick = s.members[0];
  assert.equal(nick.speedMs, 2 * 3600_000);
  assert.equal(nick.asks, 2);
  assert.equal(nick.askWaitMs, 30 * 60_000);
  assert.equal(nick.awayShare, 0.25);
  assert.equal(s.yourTime.asks, 2);
});

test('a quiet week shows zeros, not missing members, and gap days carry through', () => {
  // Value: protects=empty state and D15; fails_when=a member with no days disappears or gaps are dropped; why_new=new; seam=none; no_claim=none beyond protects
  const s = P.pulseSnapshot({ period: 'this-week', now: NOW, days: [], cards: [], decisions: [], asks: [], members: ['pam'], gapDays: ['2026-10-14', '2026-09-01'] });
  assert.equal(s.members[0].usd, 0);
  assert.equal(s.totalUsd, 0);
  assert.deepEqual(s.gapDays, ['2026-10-14']);
  assert.ok(s.outcomes.every((o) => o.total === 0));
});

test('plan headroom warns only past 20% of the window and when the pace is over 100%', () => {
  // Value: protects=E6 formula; fails_when=the warning fires early in a window or under pace; why_new=new; seam=none; no_claim=several accounts (the caller passes the tightest)
  const week = 7 * 86_400_000;
  const resetsAt = NOW + 4 * 86_400_000; // 3 of 7 days gone
  assert.equal(P.planHeadroom({ usedPct: 62, resetsAt, windowMs: week, at: NOW }).runsOutAt !== null, true, '62% after 3/7 is over pace');
  assert.equal(P.planHeadroom({ usedPct: 30, resetsAt, windowMs: week, at: NOW }).runsOutAt, null);
  assert.equal(P.planHeadroom({ usedPct: 15, resetsAt: NOW + 6.5 * 86_400_000, windowMs: week, at: NOW }).runsOutAt, null, 'too early to tell');
  assert.equal(P.planHeadroom(null), null);
});

test('saved by your changes is measured after a week, and can be negative', () => {
  // Value: protects=D16; fails_when=it shows a promise before 7 days or hides a change that cost more; why_new=design D16; seam=none; no_claim=noise on low volume members
  const applied = new Date(2026, 9, 1, 12).getTime();
  const days = [
    day('toby', '2026-09-25', { usd: 20, checks: 10 }), // $2 a piece before
    day('toby', '2026-10-05', { usd: 10, checks: 10 })  // $1 a piece after
  ];
  assert.deepEqual(P.measuredSaving(days, applied, applied + 86_400_000).state, 'measuring');
  assert.deepEqual(P.measuredSaving(days, applied, NOW), { state: 'measured', usd: 10 });
  const worse = [day('toby', '2026-09-25', { usd: 10, checks: 10 }), day('toby', '2026-10-05', { usd: 20, checks: 10 })];
  assert.equal(P.measuredSaving(worse, applied, NOW).usd, -10);
  // A second change on the same member later: the first is measured only up to it, so no work counts twice.
  const second = new Date(2026, 9, 6, 12).getTime();
  const both = [...days, day('toby', '2026-10-08', { usd: 5, checks: 10 })];
  assert.deepEqual(P.measuredSaving(both, applied, NOW, second), { state: 'measured', usd: 10 }, 'Oct 8 belongs to the second change');
  assert.deepEqual(P.measuredSaving(both, applied, NOW), { state: 'measured', usd: 25 }, 'without the bound it would count Oct 8 too');
});

test('the cost fold counts a restart whole, the same rule as the lifetime ledger', () => {
  // Value: protects=one restart rule for both cost readers; fails_when=costFold and costLifetime disagree on a drop; why_new=eng review Section 2 extraction; seam=none; no_claim=the CLI copy in tools/agent-metrics.cjs (own test)
  const fold = new F.CostFold();
  const incs = [0.5, 1.2, 0.3, 0.9].map((v) => fold.add('pam\ts1', v));
  assert.deepEqual(incs.map((x) => Math.round(x * 10) / 10), [0.5, 0.7, 0.3, 0.6]);
  const ledger = [0.5, 1.2, 0.3, 0.9].map((usd) => JSON.stringify({ agent_id: 'pam', session_id: 's1', usd })).join('\n');
  const total = incs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(lifetimeUsdFromLedger(ledger).get('pam') - total) < 1e-9, 'same total as the ledger fold');
  assert.equal(F.costIncrement(1, 1), 0);
});
