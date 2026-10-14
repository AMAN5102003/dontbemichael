'use strict';

/**
 * Regression for the untrusted message `id`/`to` path traversal.
 *
 * Agents author their own outbox JSON, so both `id` (used as the inbox file
 * name in deliver()) and `to` (used as the agent directory name) are attacker
 * controlled. Before the fix, a crafted `"id": "../../../../pwned"` made the
 * main process write the message JSON to that path, escaping the hive; the same
 * id also flowed into the wake nudge typed at another agent's terminal. This
 * covers that neither field can leave the hive, and that a nudge never carries
 * control characters that could submit keystrokes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');
const { inboxNudgeText } = loadTs('src/shared/hiveNudge.ts');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-id-safety-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god-1', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'worker-1', name: 'Creed', provider: 'claude', cwd: home });

  const outbox = path.join(home, 'hive', 'agents', 'worker-1', 'outbox');
  return { home, hive, outbox };
}

function writeOutbox(outbox, filename, raw) {
  const file = path.join(outbox, filename);
  fs.writeFileSync(file, raw, 'utf8');
  return file;
}

test('a crafted ".." message id cannot write outside the hive', async (t) => {
  const { home, hive, outbox } = await floor(t);
  const escaped = path.join(home, 'pwned.json');
  writeOutbox(outbox, 'evil.json', JSON.stringify({
    id: '../../../../pwned',
    to: 'god',
    act: 'inform',
    subject: 'hi',
    body: 'x'
  }));

  assert.equal(hive.routeOnce(), 1, 'the message still routes');

  // The escape target must not exist...
  assert.equal(fs.existsSync(escaped), false, 'nothing is written outside the hive');
  // ...and the message arrived under a harness-generated id, not the crafted one.
  const got = hive.inbox('god-1');
  assert.equal(got.length, 1);
  assert.doesNotMatch(got[0].id, /[\\/]|\.\./, 'the delivered id is a plain generated id');
});

test('a crafted ".." recipient cannot deliver into another hive\'s inbox', async (t) => {
  // A second hive whose agent's inbox exists — the target a traversal would
  // reach. The guard must refuse it even though the inbox directory is real.
  const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), 'md-id-safety-other-'));
  t.after(() => fs.rmSync(otherHome, { recursive: true, force: true }));
  const other = new HiveManager(() => otherHome);
  await other.ensureAgent({ id: 'victim-1', name: 'Victim', provider: 'claude', cwd: otherHome, isGod: true });

  const { hive, outbox } = await floor(t);
  // Relative to this hive's agents dir, climb out and back into the other hive.
  const evilTo = path.relative(
    path.join(hive.root(), 'agents'),
    path.join(other.root(), 'agents', 'victim-1')
  ).split(path.sep).join('/');
  writeOutbox(outbox, 'evil-to.json', JSON.stringify({
    to: evilTo,
    act: 'inform',
    subject: 'hi',
    body: 'x'
  }));

  hive.routeOnce();

  assert.equal(other.inbox('victim-1').length, 0, 'nothing reaches the other hive');
  const drops = hive.logTail(500).filter((e) => e.kind === 'drop' && e.reason === 'no-inbox');
  assert.equal(drops.length >= 1, true, 'a bogus recipient is logged as a drop');
});

test('the wake nudge strips control characters and newlines from ids', () => {
  const text = inboxNudgeText(['ok-1', 'bad\n/rm -rf x', 'bell\x07']);
  assert.doesNotMatch(text, /[\x00-\x1f\x7f]/, 'no control characters survive');
  assert.match(text, /ok-1/);
});