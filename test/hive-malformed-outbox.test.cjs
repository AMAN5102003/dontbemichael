'use strict';

/**
 * Regression coverage for #430: agents can publish JSON manually and leave
 * literal line-break bytes inside a string value. The router should narrowly
 * repair that malformed class, while irreparable JSON remains quarantined and
 * becomes observable in the hive log.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-malformed-outbox-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god-1', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'worker-1', name: 'Creed', provider: 'claude', cwd: home });

  const outbox = path.join(home, 'hive', 'agents', 'worker-1', 'outbox');
  return { hive, outbox };
}

/** An unreadable file older than the write grace, so it is quarantined. */
function age(outbox, filename) {
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(outbox, filename), old, old);
}

function writeOutbox(outbox, filename, raw) {
  const file = path.join(outbox, filename);
  fs.writeFileSync(file, raw, 'utf8');
  return file;
}

function eventsFor(hive, filename) {
  return hive.logTail(500).filter((entry) => entry.file === filename);
}

test('valid JSON with an escaped newline keeps the fast path', async (t) => {
  const { hive, outbox } = await floor(t);
  const filename = 'valid.json';
  const body = 'first line\nsecond line';
  writeOutbox(outbox, filename, JSON.stringify({
    to: 'god', act: 'done', subject: 'done', body, requires_reply: false
  }));

  assert.equal(hive.routeOnce(), 1);
  assert.equal(hive.inbox('god-1')[0].body, body);
  assert.equal(fs.existsSync(path.join(outbox, '.sent', filename)), true);
  assert.deepEqual(eventsFor(hive, filename), []);
});

test('literal LF inside a JSON string is repaired and routed', async (t) => {
  const { hive, outbox } = await floor(t);
  const filename = 'literal-lf.json';
  const LF = String.fromCharCode(0x0A);
  const raw = '{"to":"god","act":"done","subject":"done","body":"first line'
    + LF
    + 'second line","requires_reply":false}';
  const file = writeOutbox(outbox, filename, raw);

  assert.equal(fs.readFileSync(file).includes(Buffer.from([0x0A])), true);
  assert.throws(() => JSON.parse(raw));
  assert.equal(hive.routeOnce(), 1);
  assert.equal(hive.inbox('god-1')[0].body, `first line${LF}second line`);
  assert.equal(fs.existsSync(path.join(outbox, '.sent', filename)), true);
  // Archived as delivered, so readers of .sent (owner requests) can parse it
  // (Codex adversarial review, ship 2026-10-03).
  assert.equal(JSON.parse(fs.readFileSync(path.join(outbox, '.sent', filename), 'utf8')).body, `first line${LF}second line`);
  assert.equal(fs.existsSync(file), false, 'the original is gone from the outbox');
  assert.equal(fs.existsSync(path.join(outbox, '.sent', `bad-${filename}`)), false);
  const events = eventsFor(hive, filename);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'outbox-repair');
  assert.equal(events[0].from, 'worker-1');
  assert.equal(events[0].repair, 'literal-line-break');
});

test('a report ending in a list and a small table, written with literal line breaks, keeps every line', async (t) => {
  // Value: protects=team reports may end with figures one per line or a small table (owner D6, 2026-10-17); fails_when=the repair drops or merges lines of a multi line body; why_new=existing cases have one broken line; seam=none
  const { hive, outbox } = await floor(t);
  const LF = String.fromCharCode(0x0A);
  const lines = ['Done. Costs so far this year:', '- Rent: $1,200.00', '- Software: $310.50', '', '| Item | Amount |', '|---|--:|', '| Travel | $890.00 |'];
  const raw = '{"to":"god","act":"done","subject":"Costs","body":"' + lines.join(LF) + '","requires_reply":false}';
  writeOutbox(outbox, 'report-lines.json', raw);
  assert.throws(() => JSON.parse(raw));
  assert.equal(hive.routeOnce(), 1);
  assert.equal(hive.inbox('god-1')[0].body, lines.join(LF));
});

test('literal CRLF inside a JSON string is repaired and preserved', async (t) => {
  const { hive, outbox } = await floor(t);
  const filename = 'literal-crlf.json';
  const CRLF = String.fromCharCode(0x0D, 0x0A);
  const raw = '{"to":"god","act":"done","subject":"done","body":"first line'
    + CRLF
    + 'second line","requires_reply":false}';
  const file = writeOutbox(outbox, filename, raw);

  assert.equal(fs.readFileSync(file).includes(Buffer.from([0x0D, 0x0A])), true);
  assert.throws(() => JSON.parse(raw));
  assert.equal(hive.routeOnce(), 1);
  assert.equal(hive.inbox('god-1')[0].body, `first line${CRLF}second line`);
  assert.equal(eventsFor(hive, filename).filter((entry) => entry.kind === 'outbox-repair').length, 1);
  assert.equal(eventsFor(hive, filename).some((entry) => entry.kind === 'drop'), false);
});

test('irreparable structural JSON is logged and quarantined', async (t) => {
  const { hive, outbox } = await floor(t);
  const filename = 'structural.json';
  writeOutbox(outbox, filename, '{"to":"god","body":');
  // A fresh unreadable file may still be being written (outbox-partial-write.test.cjs).
  assert.equal(hive.routeOnce(), 0);
  assert.equal(fs.existsSync(path.join(outbox, filename)), true, 'read again on a later tick first');
  age(outbox, filename);
  assert.equal(hive.routeOnce(), 0);
  assert.equal(hive.inbox('god-1').length, 0);
  assert.equal(fs.existsSync(path.join(outbox, filename)), false);
  assert.equal(fs.existsSync(path.join(outbox, '.sent', `bad-${filename}`)), true);

  const events = eventsFor(hive, filename);
  assert.equal(events.filter((entry) => entry.kind === 'outbox-repair').length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'drop');
  assert.equal(events[0].reason, 'malformed-json');
  assert.equal(events[0].from, 'worker-1');
  assert.equal('error' in events[0], false, 'parser context and raw payload must not enter the durable log');
});

test('escaped quotes and backslashes keep their JSON semantics', async (t) => {
  const { hive, outbox } = await floor(t);
  const filename = 'escaped.json';
  const body = 'quoted: "hello"; path: C:\\tmp; escaped newline: \\n';
  writeOutbox(outbox, filename, JSON.stringify({ to: 'god', body }));

  assert.equal(hive.routeOnce(), 1);
  assert.equal(hive.inbox('god-1')[0].body, body);
  assert.deepEqual(eventsFor(hive, filename), []);
});

test('an irreparable poison file does not block a valid file in the same pass', async (t) => {
  const { hive, outbox } = await floor(t);
  writeOutbox(outbox, 'a-poison.json', '{"to":"god","body":');
  age(outbox, 'a-poison.json');
  writeOutbox(outbox, 'b-good.json', JSON.stringify({ to: 'god', act: 'inform', body: 'still routed' }));

  assert.equal(hive.routeOnce(), 1);
  assert.equal(hive.inbox('god-1').length, 1);
  assert.equal(hive.inbox('god-1')[0].body, 'still routed');
  assert.equal(fs.existsSync(path.join(outbox, '.sent', 'bad-a-poison.json')), true);
  assert.equal(fs.existsSync(path.join(outbox, '.sent', 'b-good.json')), true);
  assert.equal(eventsFor(hive, 'a-poison.json')[0].reason, 'malformed-json');
});

test('a name already in .sent is archived beside it, not over it, and not routed again', async (t) => {
  const { hive, outbox } = await floor(t);
  fs.writeFileSync(path.join(outbox, '.sent', 'repeat.json'), '{"old":true}');
  writeOutbox(outbox, 'repeat.json', JSON.stringify({ to: 'god', act: 'inform', body: 'routed cleanly' }));

  assert.equal(hive.routeOnce(), 1);
  assert.equal(fs.existsSync(path.join(outbox, 'repeat.json')), false, 'source removed from outbox');
  assert.equal(hive.inbox('god-1').length, 1);
  assert.equal(hive.inbox('god-1')[0].body, 'routed cleanly');
  assert.equal(fs.readFileSync(path.join(outbox, '.sent', 'repeat.json'), 'utf8'), '{"old":true}', 'prior sent message retained in archive');
  assert.ok(fs.readdirSync(path.join(outbox, '.sent')).some((n) => n.endsWith('-repeat.json')), 'the new one is archived under a unique name');
  assert.equal(hive.routeOnce(), 0);
});
