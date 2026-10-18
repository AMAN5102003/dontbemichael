'use strict';

// Michael decides team members' schedule requests, run for real with a fake
// config and hive (TODOS: "Test Michael deciding schedule requests end to
// end"): unknown id, stale, escalated, the pending list and the 12 hour
// escalation.

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { makeScheduleRequests, MICHAEL_DECIDES_WITHIN_MS } = loadTs('src/main/scheduleRequests.ts');
const { RESEARCH_ID } = loadTs('src/shared/research.ts');

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 14, 9, 0, 0);

function office(requests = []) {
  const cfg = {
    missions: [
      { id: 'm1', label: 'Check Emails', intervalMs: 2 * H, to: 'pam', body: '', enabled: true },
      { id: 'm2', label: 'Standup', intervalMs: 24 * H, to: 'god', body: '', enabled: true }
    ],
    scheduleRequests: requests
  };
  const sent = [];
  const toasts = [];
  let clock = T0;
  let updates = 0;
  const sr = makeScheduleRequests({
    readConfig: () => JSON.parse(JSON.stringify(cfg)),
    writeConfig: (patch) => { Object.assign(cfg, JSON.parse(JSON.stringify(patch))); },
    applyMissions: (change) => {
      const next = change(JSON.parse(JSON.stringify(cfg.missions)));
      if (!next) return { ok: false, error: 'not found' };
      cfg.missions = next;
      return { ok: true };
    },
    godId: () => 'god',
    michaelName: () => 'Michael',
    agentName: (id) => ({ pam: 'Pam' })[id],
    hive: { enabled: () => true, send: (msg, from) => sent.push({ ...msg, from }) },
    updated: () => { updates++; },
    ownerToast: (title, body) => toasts.push({ title, body }),
    now: () => clock
  });
  return { sr, cfg, sent, toasts, tick: (ms) => { clock += ms; }, updates: () => updates };
}

const pauseM1 = { op: 'pause', id: 'm1' };
const requestId = (o) => o.cfg.scheduleRequests[0].id;

test('a team member\'s request goes to Michael; nothing changes and the owner is not pinged', () => {
  const o = office();
  const reply = o.sr.receiveScheduleRequest('pam', pauseM1, 'Mailbox moved.');
  assert.match(reply, /^Sent to Michael to decide\. Nothing changes until he does/);
  assert.equal(o.cfg.missions[0].enabled, true);
  assert.equal(o.cfg.scheduleRequests.length, 1);
  assert.equal(o.cfg.scheduleRequests[0].sentToMichael, true);
  const toMichael = o.sent.find((m) => m.to === 'god');
  assert.equal(toMichael.act, 'request');
  assert.equal(toMichael.subject, 'Schedule request from Pam');
  assert.match(toMichael.body, new RegExp(`Request id: ${requestId(o)}\\.`));
  assert.deepEqual(o.toasts, []);
  // The same job again joins the first request.
  assert.match(o.sr.receiveScheduleRequest('pam', { op: 'resume', id: 'm1' }, 'Back again.'), /^This joins or replaces your earlier request/);
  assert.equal(o.cfg.scheduleRequests.length, 1);
});

test('Michael approves: the change is applied as his, and the member is told', () => {
  const o = office();
  o.sr.receiveScheduleRequest('pam', pauseM1, 'Mailbox moved.');
  assert.equal(o.sr.receiveScheduleRequest('god', { op: 'approve', request: requestId(o) }), 'Approved and in place.');
  assert.equal(o.cfg.missions[0].enabled, false);
  assert.equal(o.cfg.missions[0].approvedBy, 'michael');
  assert.deepEqual(o.cfg.scheduleRequests, []);
  const told = o.sent.find((m) => m.to === 'pam');
  assert.equal(told.subject, 'Schedule change approved');
  assert.match(told.body, /^Michael approved: pause "Check Emails"/);
});

test('Michael declines with a note: nothing changes, and the note reaches the member', () => {
  const o = office();
  o.sr.receiveScheduleRequest('pam', pauseM1, 'Mailbox moved.');
  assert.equal(o.sr.receiveScheduleRequest('god', { op: 'decline', request: requestId(o), note: 'We still get mail there.' }), 'Declined. Nothing changed.');
  assert.equal(o.cfg.missions[0].enabled, true);
  assert.match(o.sent.find((m) => m.to === 'pam').body, /Nothing changed\. Note: We still get mail there\.$/);
});

test('an unknown id, a stale request and the pending list', () => {
  const o = office();
  assert.equal(o.sr.receiveScheduleRequest('god', { op: 'pending' }), 'No schedule requests are waiting for you.');
  o.sr.receiveScheduleRequest('pam', pauseM1, 'Mailbox moved.');
  assert.match(o.sr.receiveScheduleRequest('god', { op: 'pending' }), new RegExp(`^Schedule requests waiting for you \\(id: request\\):\\n${requestId(o)}: pause "Check Emails"`));
  assert.match(o.sr.receiveScheduleRequest('god', { op: 'approve', request: 'sr_nope' }), /^No waiting request has that id/);
  // The owner changed the schedule meanwhile: the request no longer fits it.
  o.cfg.missions[0].intervalMs = 3 * H;
  assert.match(o.sr.receiveScheduleRequest('god', { op: 'approve', request: requestId(o) }), /^That schedule changed since the request was made/);
  assert.equal(o.cfg.missions[0].enabled, true, 'nothing applied');
  assert.equal(o.cfg.scheduleRequests.length, 1, 'still waiting, to be declined');
});

test('passing a request to the owner needs a note, then it is theirs alone', () => {
  const o = office();
  o.sr.receiveScheduleRequest('pam', pauseM1, 'Mailbox moved.');
  const id = requestId(o);
  assert.match(o.sr.receiveScheduleRequest('god', { op: 'ask-owner', request: id }), /^Add a "note"/);
  assert.equal(o.sr.receiveScheduleRequest('god', { op: 'ask-owner', request: id, note: 'Sources disagree.' }), 'Passed to the owner in ASK ME. You will hear when they decide.');
  assert.equal(o.cfg.scheduleRequests[0].escalated, true);
  assert.equal(o.cfg.scheduleRequests[0].escalation, 'Sources disagree.');
  assert.deepEqual(o.toasts, [{ title: 'Michael', body: 'Pam\'s schedule change needs you in ASK ME.' }]);
  assert.match(o.sr.receiveScheduleRequest('god', { op: 'approve', request: id }), /^That request is with the owner in ASK ME now/);
  assert.match(o.sr.receiveScheduleRequest('god', { op: 'pending' }), /^No schedule requests are waiting for you/, 'no longer his');
  // The owner decides it: applied, and both the member and Michael hear.
  assert.deepEqual(o.sr.decideScheduleRequest(id, true), { ok: true });
  assert.equal(o.cfg.missions[0].approvedBy, 'owner');
  assert.equal(o.sent.filter((m) => m.to === 'pam').at(-1).subject, 'Schedule change approved');
  assert.equal(o.sent.filter((m) => m.to === 'god').at(-1).subject, 'Owner approved a schedule change');
  assert.deepEqual(o.sr.decideScheduleRequest(id, true), { ok: false, error: 'not found' });
});

test('the sweep offers an unheard request to Michael once, and passes one he left 12 hours to the owner', () => {
  const unheard = { id: 'sr_a', agentId: 'pam', op: 'pause', missionId: 'm1', createdAt: T0, reason: 'Mailbox moved.' };
  const o = office([unheard]);
  o.sr.sweepScheduleRequests(T0);
  assert.equal(o.sent.filter((m) => m.to === 'god').length, 1);
  assert.equal(o.cfg.scheduleRequests[0].sentToMichael, true);
  o.sr.sweepScheduleRequests(T0 + MICHAEL_DECIDES_WITHIN_MS);
  assert.equal(o.sent.filter((m) => m.to === 'god').length, 1, 'offered once');
  assert.equal(o.cfg.scheduleRequests[0].escalated, undefined, 'exactly 12 hours is not over');
  o.sr.sweepScheduleRequests(T0 + MICHAEL_DECIDES_WITHIN_MS + 1);
  assert.equal(o.cfg.scheduleRequests[0].escalated, true);
  assert.equal(o.cfg.scheduleRequests[0].escalation, 'Michael did not decide this within 12 hours.');
  assert.deepEqual(o.toasts, [{ title: 'Michael', body: 'A schedule change needs you in ASK ME.' }]);
  o.sr.sweepScheduleRequests(T0 + 2 * MICHAEL_DECIDES_WITHIN_MS);
  assert.equal(o.toasts.length, 1, 'an escalated request is left to the owner');
});

test('Michael\'s own change applies at once; Research has no schedules; list answers with ids', () => {
  const o = office();
  assert.equal(o.sr.receiveScheduleRequest('god', { op: 'pause', id: 'm2' }, 'Quiet week.'), 'Done: pause "Standup".');
  assert.equal(o.cfg.missions[1].enabled, false);
  assert.equal(o.cfg.missions[1].approvedBy, 'michael');
  assert.deepEqual(o.cfg.scheduleRequests, [], 'nothing waits on anyone');
  assert.match(o.sr.receiveScheduleRequest(RESEARCH_ID, pauseM1), /^You have no schedules: you answer the questions/);
  assert.equal(o.sr.receiveScheduleRequest('pam', { op: 'list' }), 'Your schedules (id: job):\nm1: Check Emails, every 2h');
});

test('an approved resume starts from now, so it never runs a slot from before it', () => {
  const o = office();
  o.cfg.missions[0].enabled = false;
  o.tick(H);
  o.sr.receiveScheduleRequest('pam', { op: 'resume', id: 'm1' }, 'Mailbox is back.');
  o.tick(H);
  assert.equal(o.sr.receiveScheduleRequest('god', { op: 'approve', request: requestId(o) }), 'Approved and in place.');
  assert.equal(o.cfg.missions[0].enabled, true);
  assert.equal(o.cfg.missions[0].scheduledSince, T0 + 2 * H);
});
