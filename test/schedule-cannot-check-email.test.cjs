'use strict';
/**
 * A schedule that looks in the mailbox, on an agent whose email is off, says so
 * beside the job (TODOS: Say "cannot check email" beside a schedule). The hook
 * refuses the mail call, so without the note each run is a silent wasted turn.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { cannotCheckEmail } = loadTs('src/shared/missions.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const HOUR = 3_600_000;
const mk = (over = {}) => ({ id: 'm1', label: 'Inbox to zero', intervalMs: HOUR, to: 'pam', body: '', enabled: true, ...over });
const on = { enabled: true, mailboxes: ['mb1'], send: false, sending: 'draft' };
const off = { enabled: false, mailboxes: [], send: false, sending: 'draft' };

test('a mail job on an agent with email off is flagged; absent email counts as off', () => {
  assert.equal(cannotCheckEmail(mk(), off), true);
  assert.equal(cannotCheckEmail(mk(), undefined), true);
});

test('no note when the agent can check email', () => {
  assert.equal(cannotCheckEmail(mk(), on), false);
});

test('the job is recognised by its name, its focus or an older prompt', () => {
  assert.equal(cannotCheckEmail(mk({ label: 'Morning run', focus: 'Check the sales mailbox and report what is new.' }), off), true);
  assert.equal(cannotCheckEmail(mk({ label: 'Morning run', body: 'Check email every 10 minutes' }), off), true);
  assert.equal(cannotCheckEmail(mk({ label: 'Morning run', focus: 'Triage new emails and tell Michael.' }), off), true);
  assert.equal(cannotCheckEmail(mk({ label: 'Check the sales emails' }), off), true);
});

test('jobs that are not about mail are left alone', () => {
  assert.equal(cannotCheckEmail(mk({ label: 'Weekly money summary', focus: 'Prepare the summary and send it to Michael.' }), off), false);
  assert.equal(cannotCheckEmail(mk({ label: 'Mail the invoices', focus: 'Post the paper invoices.' }), off), false);
  // Checking something else and then emailing about it is not a mail check.
  assert.equal(cannotCheckEmail(mk({ label: 'Stock run', focus: 'Check stock and email the supplier.' }), off), false);
  assert.equal(cannotCheckEmail(mk({ label: 'Totals', focus: 'Read the invoices, then email the totals.' }), off), false);
  assert.equal(cannotCheckEmail(mk({ label: 'Orders', focus: 'Check the order and email it to Michael.' }), off), false);
});

test('a paused job and the heartbeat are never flagged', () => {
  assert.equal(cannotCheckEmail(mk({ enabled: false }), off), false);
  assert.equal(cannotCheckEmail(mk({ kind: 'heartbeat' }), off), false);
});

test('both schedule views pass the note to the row, and every locale has the words', () => {
  const src = read('src/renderer/src/components/triggers/ScheduleList.tsx');
  assert.equal((src.match(/noEmail=\{!!config && cannotCheckEmail\(/g) ?? []).length, 2, 'agent view and office view');
  assert.match(src, /schedulesSection\.cannotCheckEmail/);
  for (const l of ['en', 'ar', 'zh-CN']) {
    const j = JSON.parse(read(`src/renderer/src/i18n/locales/${l}.json`));
    assert.match(j.schedulesSection.cannotCheckEmail, /\{\{name\}\}/, l);
  }
});

test('a member who reads mail through the Gmail connector is not told they cannot check email', () => {
  // Value: protects=no false warning on a job that works; fails_when=only the app's Email capability is checked; why_new=owner review on #218; seam=none
  const { gmailConnectorOn } = loadTs('src/shared/claudeConnectors.ts');
  const cfg = (over = {}) => ({ connectorsOn: { Gmail: true }, agentCapabilities: { pam: { email: off, connectors: ['Gmail'] } }, ...over });
  assert.equal(gmailConnectorOn(cfg(), 'pam'), true);
  assert.equal(cannotCheckEmail(mk(), off, gmailConnectorOn(cfg(), 'pam')), false, 'Gmail granted and on');
  // Granted but switched off in Settings, or on but not granted: still no mail.
  assert.equal(gmailConnectorOn(cfg({ connectorsOn: { Gmail: false } }), 'pam'), false);
  assert.equal(gmailConnectorOn(cfg({ agentCapabilities: { pam: { email: off, connectors: [] } } }), 'pam'), false);
  assert.equal(cannotCheckEmail(mk(), off, gmailConnectorOn(cfg({ connectorsOn: {} }), 'pam')), true);
  // Google Calendar is not mail.
  assert.equal(gmailConnectorOn({ connectorsOn: { 'Google Calendar': true }, agentCapabilities: { pam: { connectors: ['Google Calendar'] } } }, 'pam'), false);
  for (const view of ['AgentSchedules', 'OfficeSchedules']) {
    const src = read('src/renderer/src/components/triggers/ScheduleList.tsx');
    assert.match(src.slice(src.indexOf(`export function ${view}`)), /cannotCheckEmail\(m, \{ enabled: agentMailboxes\(config, \w+\)\.length > 0 \}, gmailConnectorOn\(config, \w+\)\)/, view);
  }
});

test('a member whose mailbox was removed in Settings is told they cannot check email', () => {
  // Value: protects=no silent wasted turn after a mailbox is deleted; fails_when=only the email switch is read, not the mailbox the mail tools need; why_new=#348 review (LK-Bharadwaja's case); seam=none
  const { agentMailboxes } = loadTs('src/shared/mailboxes.ts');
  const cfg = (mailboxes) => ({ mailboxes, agentCapabilities: { pam: { email: on } } });
  const has = (c) => ({ enabled: agentMailboxes(c, 'pam').length > 0 });
  assert.equal(cannotCheckEmail(mk(), has(cfg([{ id: 'mb1' }]))), false, 'its mailbox is there');
  assert.equal(cannotCheckEmail(mk(), has(cfg([]))), true, 'its mailbox was removed');
});
