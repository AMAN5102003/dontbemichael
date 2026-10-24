'use strict';

/**
 * A message's target is resolved once, whatever its capitals (review on #533).
 * Agents sometimes write a teammate's id the way it reads on the roster ("Pam"
 * for pam). On a Mac or Windows disk agents/Pam/inbox is pam's inbox, so every
 * check in routeMessage() that looked up the raw id let it through: a request
 * reached Pam without Michael, and mail for the send-only prep assistant landed
 * where nobody reads it. resolveTo() now returns the roster's own id.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-target-case-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'prep', name: 'Prep', provider: 'claude', cwd: home, isAssistant: true });
  return hive;
}

test('a request to a teammate\'s id written with capitals still goes to Michael', async (t) => {
  // Value: protects=only Michael assigns work; fails_when=an agent writes "Pam" for pam and the request lands in her inbox; why_new=routeMessage looked the target up by its raw id; seam=the real HiveManager
  const hive = await floor(t);
  hive.send({ to: 'Pam', act: 'request', subject: 'Chase the Northwind invoice', body: 'Please.' }, 'oscar');
  hive.send({ to: 'PAM', act: 'propose', subject: 'Take the supplier call', body: 'Can you?' }, 'oscar');
  assert.equal(hive.inbox('pam').length, 0, 'nothing reaches Pam directly');
  const michael = hive.inbox('god').map((m) => m.subject);
  assert.deepEqual(michael.filter((s) => s.startsWith('[handoff: Oscar asked')).length, 2);
  // A question for a fact still goes straight to her, under her own id.
  hive.send({ to: 'Pam', act: 'query', subject: 'Which supplier?', body: '?' }, 'oscar');
  assert.deepEqual(hive.inbox('pam').map((m) => m.subject), ['Which supplier?']);
});

test('"Prep" bounces to Michael just like "prep" does', async (t) => {
  // Value: protects=mail for the send-only prep assistant never rots unread in its inbox; fails_when=a capital letter gets past the assistant check; why_new=review on #533; seam=the real HiveManager
  const hive = await floor(t);
  hive.send({ to: 'prep', act: 'inform', subject: 'one', body: 'x' }, 'oscar');
  hive.send({ to: 'Prep', act: 'inform', subject: 'two', body: 'x' }, 'oscar');
  assert.equal(hive.inbox('prep').length, 0);
  const bounced = hive.inbox('god').map((m) => m.subject).filter((s) => s.includes('send-only prep assistant'));
  assert.equal(bounced.length, 2);
  assert.match(bounced[1], /\] two$/);
});
