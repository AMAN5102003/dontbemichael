'use strict';

/**
 * An owner's Ask me answer is never lost between the card and Michael
 * (TODOS.md, second Codex adversarial review, 2026-10-16). The renderer
 * records the answer on the card, then sends Michael's request. When that send
 * failed the ask left Ask me and Michael heard nothing until the next launch,
 * because the catch-up ran once a launch. It now runs again a minute after the
 * owner's last answer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { OwnerAnswerRetry, OWNER_ANSWER_RETRY_MS, answerKey, catchUpRequests } = loadTs('src/shared/ownerRequests.ts');
const { answerMessages } = loadTs('src/shared/askMeRouting.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

// What main records an answer by (index.ts answerDigest).
const digest = (q, a) => createHash('sha256').update(`${q}\u0000${a}`).digest('hex').slice(0, 32);

test('an answer whose request to Michael failed to send reaches him a minute later, once', async (t) => {
  // Value: protects=a failed send no longer leaves an answered card with Michael unaware until a restart; fails_when=the catch-up runs only once a launch, runs while the renderer may still be sending, sends an answer twice, or relays one the app never recorded; why_new=TODOS.md, second Codex adversarial review 2026-10-16; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-owner-retry-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'nick', name: 'Nick', cwd: home });
  const card = (id, title, humanQA) => ({ id, title, status: 'blocked', assignee: 'nick', dependsOn: [], priority: 3, createdAt: 'x', humanQA });
  hive.writeTasks([
    card('refund', 'Refund for Northwind Cafe', [{ q: 'Refund?', raisedBy: 'nick' }]),
    card('invoice', 'Supplier invoice', [{ q: 'Pay it?', raisedBy: 'nick' }]),
    // An agent wrote this answer into the card: the app has no record of it.
    card('forged', 'Forged', [{ q: 'Pay?', a: 'Pay it all.', answeredAt: new Date().toISOString(), raisedBy: 'nick' }])
  ]);
  // The launch catch-up as main runs it (index.ts catchUpOwnerAnswers).
  const recorded = new Set();
  const retry = new OwnerAnswerRetry(() => {
    for (const m of catchUpRequests(hive.ownerAnswersWithoutRequest(), recorded, hive.registry().agents, digest)) {
      hive.send({ to: m.to, act: m.act, subject: m.subject, body: m.body, conversation: m.conversation, requires_reply: true }, 'human');
    }
    return true;
  });
  // The owner answers: the card patch lands and main records the answer.
  const answer = (id, q, a) => {
    const answeredAt = new Date().toISOString();
    hive.patchTask(id, { humanQA: [{ q, raisedBy: 'nick', a, answeredAt }] });
    recorded.add(answerKey(id, answeredAt, digest(q, a)));
    const now = Date.now();
    retry.answered(now);
    return now;
  };
  const inbox = path.join(home, 'hive', 'agents', 'god', 'inbox');
  const ownerRequests = () => fs.readdirSync(inbox).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(inbox, f), 'utf8')))
    .filter((m) => m.from === 'human' && m.act === 'request');
  const requests = () => ownerRequests().map((m) => m.conversation).sort();

  // The renderer's send to Michael fails.
  const at = answer('refund', 'Refund?', 'Yes.');
  retry.tick(at + 30_000);
  assert.deepEqual(requests(), [], 'not while the renderer may still be sending');
  retry.tick(at + OWNER_ANSWER_RETRY_MS);
  assert.deepEqual(requests(), ['card:refund'], 'a minute on, Michael has the request; the forged answer is not relayed');
  assert.match(ownerRequests()[0].body, /The owner answered the question Nick raised on card refund/);
  retry.tick(at + 10 * OWNER_ANSWER_RETRY_MS);
  assert.deepEqual(requests(), ['card:refund'], 'sent once');

  // The next answer's send goes through: the catch-up a minute on sends nothing more.
  const next = answer('invoice', 'Pay it?', 'Yes, today.');
  const [m] = answerMessages({ raiser: 'nick', raiserName: 'Nick', taskId: 'invoice', title: 'Supplier invoice', q: 'Pay it?', a: 'Yes, today.' });
  hive.send({ to: m.to, act: m.act, subject: m.subject, body: m.body, conversation: m.conversation, requires_reply: m.requires_reply }, 'human');
  retry.tick(next + OWNER_ANSWER_RETRY_MS);
  assert.deepEqual(requests(), ['card:invoice', 'card:refund'], 'one request per answer');
});

test('the catch-up runs a minute after the last answer, and again a minute later while it fails', () => {
  // Value: protects=the retry waits for a burst of answers to settle and keeps trying until the catch-up finishes; fails_when=it runs without an answer, before a minute has passed since the last one, keeps running after it finished, or gives up after one failure; why_new=TODOS.md, second Codex adversarial review 2026-10-16; seam=none
  let runs = 0;
  let finishes = false;
  const retry = new OwnerAnswerRetry(() => { runs += 1; return finishes; }, 60_000);
  retry.tick(0);
  retry.tick(600_000);
  assert.equal(runs, 0, 'nothing answered, nothing run');
  retry.answered(1_000);
  retry.answered(20_000);
  retry.tick(61_000);
  assert.equal(runs, 0, 'a later answer moves it back');
  retry.tick(80_000);
  assert.equal(runs, 1);
  retry.tick(100_000);
  assert.equal(runs, 1, 'a failed catch-up waits a minute');
  finishes = true;
  retry.tick(140_000);
  retry.tick(900_000);
  assert.equal(runs, 2, 'it stops once the catch-up finished');
});

test('main runs the catch-up again a minute after it records an owner answer', () => {
  // Value: protects=the retry is armed by the answer main records and run by the fleet tick; fails_when=the patch handler stops arming it, the fleet tick stops ticking it, or the launch catch-up's done flag still blocks it; why_new=TODOS.md, second Codex adversarial review 2026-10-16; seam=source pin
  const main = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
  assert.match(main, /if \(ok && keys\.length\) \{ recordOwnerAnswerKeys\(keys\); ownerAnswerRetry\.answered\(Date\.now\(\)\); \}/);
  const beat = main.slice(main.indexOf('const fleetBeat = (): void => {'), main.indexOf('fleetTimer = setInterval(fleetBeat'));
  assert.match(beat, /ownerAnswerRetry\.tick\(Date\.now\(\)\);/);
  assert.match(main, /new OwnerAnswerRetry\(\(\) => \{\s+ownerCatchUpDone = false;\s+catchUpOwnerAnswers\(\);\s+return ownerCatchUpDone;\s+\}\)/);
});
