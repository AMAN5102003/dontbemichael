'use strict';

/**
 * A message to or from Research whose privacy check could not run waits and
 * is tried again, instead of being held at once (owner, 2026-10-16: "why
 * messages are not queued and waited to Pete during such events?"; D1: up to
 * 30 minutes). Seen live: at app start the check's hidden session took over a
 * minute while the whole team started, and the app's "Office open" note to
 * Pete was held after one 15 second retry. Nothing goes out unchecked while it
 * waits; what the check refuses outright (too long, private data, settings)
 * is still refused at once.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
const { HiveManager } = loadTs('src/main/hive.ts');
const R = loadTs('src/shared/research.ts');
const { heldWaits } = loadTs('src/shared/heldRecord.ts');

// Tried again at once, so the tests need no clock.
HiveManager.trustRetryDelayMs = () => 0;

const NO_ANSWER = { decision: 'deny', reason: R.REFUSAL_CHECK_FAILED, by: 'no-answer', error: 'hidden session never took the prompt' };
const pass = (m) => ({ decision: 'pass', subject: String(m.subject ?? ''), body: String(m.body ?? ''), flagged: false });

/** A layer that cannot run `down` times, then passes. */
function flakyLayer(down, fail = () => NO_ANSWER) {
  const calls = { inbound: 0, outbound: 0 };
  return {
    calls,
    inbound: async (m) => (++calls.inbound <= down ? fail() : pass(m)),
    outbound: async (m) => (++calls.outbound <= down ? fail() : pass(m))
  };
}

async function office(t, layer) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-check-wait-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'research', name: 'Pete', provider: 'claude', cwd: path.join(home, 'research-desk'), isResearch: true });
  hive.setResearchEnabled(() => true);
  hive.setTrustLayer(layer);
  return { hive, home };
}
const msgsIn = (hive, id) => {
  const dir = path.join(hive.root(), 'agents', id, 'inbox');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
};
const send = (hive, from, msg, name = 'm1.json') => fs.writeFileSync(path.join(hive.root(), 'agents', from, 'outbox', name), JSON.stringify(msg));
const tick = () => new Promise((r) => setImmediate(r));
// A retry runs on a timer (0 ms here), so each step lets one fire.
const settle = async () => { for (let i = 0; i < 4; i++) { await tick(); await new Promise((r) => setTimeout(r, 2)); } };
const heldRows = (home) => {
  const f = path.join(home, 'private', 'held.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
};
const log = (hive, kind) => fs.readFileSync(path.join(hive.root(), 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.kind === kind);
const route = async (hive, n) => { for (let i = 0; i < n; i++) { hive.routeOnce(); await settle(); } };

test('only a check that could not run waits; one the check refused does not', () => {
  // Value: protects=too long, settings and a missing check are still refused at once; fails_when=a permanent refusal is retried; why_new=owner 2026-10-16 wait; seam=none
  for (const w of ['no-answer', 'unreadable', 'failed']) assert.equal(heldWaits(w), true, w);
  for (const w of ['too-long', 'settings', 'no-layer', null]) assert.equal(heldWaits(w), false, String(w));
});

test('the gaps grow from 30 seconds to every 5 minutes, and the wait is 30 minutes', () => {
  // Value: protects=the owner's D1 window and a paced retry that never hammers the check; fails_when=the window or gaps change; why_new=owner 2026-10-16 wait; seam=none
  const fresh = loadTs('src/main/hive.ts').HiveManager;
  assert.equal(fresh.TRUST_WAIT_MS, 30 * 60_000);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/hive.ts'), 'utf8');
  assert.match(src, /static trustRetryDelayMs\(tries: number\): number \{ return Math\.min\(5 \* 60_000, 30_000 \* 2 \*\* Math\.max\(0, tries\)\); \}/);
});

test('a teammate\'s question waits in its outbox while the check cannot run, then reaches Pete; nobody is told it failed', async (t) => {
  // Value: protects=a startup hiccup no longer drops a teammate's question; fails_when=the gate refuses after the first failed check, tells the sender, or lists a hold; why_new=owner 2026-10-16 wait; seam=fake layer
  const layer = flakyLayer(2);
  const { hive, home } = await office(t, layer);
  send(hive, 'pam', { to: 'research', act: 'query', subject: 'Flour', body: 'Flour prices this month' });
  await route(hive, 8);
  assert.equal(layer.calls.inbound, 3, 'two failed tries, then the one that ran');
  const got = msgsIn(hive, 'research').filter((m) => m.from === 'pam');
  assert.equal(got.length, 1);
  assert.equal(got[0].body, 'Flour prices this month');
  assert.equal(msgsIn(hive, 'pam').filter((m) => m.subject === R.NOT_SENT_SUBJECT).length, 0, 'the sender heard no refusal');
  assert.equal(msgsIn(hive, 'god').filter((m) => /not sent/i.test(m.subject)).length, 0, 'nor Michael');
  assert.equal(heldRows(home).length, 0);
  assert.deepEqual(log(hive, 'trust-wait').map((e) => [e.way, e.tries]), [['in', 1], ['in', 2]]);
});

test('a question still unchecked when the wait runs out is held as before', async (t) => {
  // Value: protects=a real outage still reaches the sender, Michael and the held list; fails_when=a message waits forever; why_new=owner 2026-10-16 wait; seam=fake layer, wait set to 0
  const before = HiveManager.TRUST_WAIT_MS;
  HiveManager.TRUST_WAIT_MS = 0;
  t.after(() => { HiveManager.TRUST_WAIT_MS = before; });
  const layer = flakyLayer(99);
  const { hive, home } = await office(t, layer);
  send(hive, 'pam', { to: 'research', act: 'query', subject: 'Flour', body: 'Flour prices this month' });
  await route(hive, 3);
  assert.equal(layer.calls.inbound, 1);
  assert.equal(msgsIn(hive, 'pam').filter((m) => m.subject === R.NOT_SENT_SUBJECT).length, 1);
  assert.equal(heldRows(home).length, 1);
});

test('a question too long to check is refused at once, without waiting', async (t) => {
  // Value: protects=a refusal the check reached is never retried; fails_when=length denies wait; why_new=owner 2026-10-16 wait; seam=fake layer
  const layer = flakyLayer(99, () => ({ decision: 'deny', reason: R.REFUSAL_TOO_LONG, by: 'length' }));
  const { hive } = await office(t, layer);
  send(hive, 'pam', { to: 'research', act: 'query', subject: 'Flour', body: 'Flour prices this month' });
  await route(hive, 3);
  assert.equal(layer.calls.inbound, 1);
  assert.equal(log(hive, 'trust-wait').length, 0);
  assert.equal(msgsIn(hive, 'pam').filter((m) => m.subject === R.NOT_SENT_SUBJECT).length, 1);
});

test('the app\'s and the owner\'s notes to Pete wait too, and stay pending until they go', async (t) => {
  // Value: protects=the "Office open" note seen held on 2026-10-16 reaches Pete once the check runs; fails_when=queueForResearch refuses after one failed check or drops the pending row early; why_new=owner 2026-10-16 wait; seam=fake layer
  let release;
  let calls = 0;
  const layer = { inbound: async (m) => { calls++; if (calls === 1) return NO_ANSWER; if (calls === 2) await new Promise((r) => { release = r; }); return pass(m); }, outbound: async (m) => pass(m) };
  const { hive, home } = await office(t, layer);
  hive.rememberOwnerNote('research', 'Focus on flour');
  await settle();
  assert.equal(calls, 2, 'tried again after the first could not run');
  const pending = JSON.parse(fs.readFileSync(path.join(home, 'private', 'research-pending.json'), 'utf8'));
  assert.equal(pending.length, 1, 'still pending while it waits, so a crash is told to Michael');
  release();
  await settle();
  assert.ok(msgsIn(hive, 'research').some((m) => /Focus on flour/.test(m.body)), 'delivered once the check ran');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'private', 'research-pending.json'), 'utf8')), []);
  assert.equal(msgsIn(hive, 'god').filter((m) => m.subject === R.NOT_SENT_SUBJECT).length, 0);
  assert.equal(heldRows(home).length, 0);
});

test('Pete\'s answer waits for the check too, then reaches the teammate who asked', async (t) => {
  // Value: protects=an answer is not lost to a startup hiccup; fails_when=the outbound gate holds after one failed check; why_new=owner 2026-10-16 wait, both directions; seam=fake layer
  const layer = flakyLayer(0);
  const { hive, home } = await office(t, layer);
  send(hive, 'pam', { to: 'research', act: 'query', subject: 'q', body: 'Pizza trends' }, 'ask.json');
  await route(hive, 2);
  const ask = msgsIn(hive, 'research').filter((m) => m.from === 'pam').pop().id;
  let down = 2;
  layer.outbound = async (m) => (down-- > 0 ? { decision: 'deny', reason: R.REFUSAL_CHECK_FAILED, by: 'unreadable' } : pass(m));
  send(hive, 'research', { to: 'pam', in_reply_to: ask, act: 'inform', subject: 'Pizza answer', body: 'Thin crust is up' }, 'a.json');
  await route(hive, 8);
  assert.ok(msgsIn(hive, 'pam').some((m) => m.from === 'research' && /Thin crust is up/.test(m.body)));
  assert.equal(msgsIn(hive, 'pam').filter((m) => m.subject === R.ANSWER_UNCHECKED_SUBJECT).length, 0);
  assert.equal(heldRows(home).length, 0);
  assert.deepEqual(log(hive, 'trust-wait').map((e) => e.way), ['out', 'out']);
});
