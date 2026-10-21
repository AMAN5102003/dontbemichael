'use strict';

/**
 * The trigger ledger (src/main/triggerHistory.ts) is the plaintext record the
 * History tab shows for webhook and organisation messages. It is built field by
 * field so a webhook secret or API key never reaches disk, it is capped and
 * newest first, only the owner's verdict on an entry can change, and a missing,
 * damaged or hand-edited file degrades to an empty or shorter ledger instead of
 * throwing on the request path.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-trigger-history-'));
const ledgerFile = path.join(userData, 'trigger-history.json');
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: { app: { getPath: () => userData } }
};

const { appendTriggerHistory, listTriggerHistory, updateTriggerHistory, clearTriggerHistory } = loadTs('src/main/triggerHistory.ts');
const { TRIGGER_HISTORY_LIMIT } = loadTs('src/shared/triggers.ts');

test.after(() => fs.rmSync(userData, { recursive: true, force: true }));
test.beforeEach(() => clearTriggerHistory());

const input = (over = {}) => ({
  source: 'webhook',
  sourceId: 'hook-1',
  sourceName: 'Orders',
  direction: 'inbound',
  peer: 'shop.example',
  body: 'a message',
  kind: 'directive',
  ...over
});

test('a secret or API key on the caller\'s object is never written to the ledger', () => {
  // Value: protects=a webhook secret or org key never lands in plaintext userData; fails_when=an entry is built by spreading the caller's object; why_new=the field by field rule is documented in the module header but nothing enforced it
  const SECRET = 'whsec-DO-NOT-PERSIST';
  const KEY = 'sk-org-DO-NOT-PERSIST';
  const returned = appendTriggerHistory(input({ secret: SECRET, apiKey: KEY, token: KEY, nested: { secret: SECRET } }));

  for (const field of ['secret', 'apiKey', 'token', 'nested']) {
    assert.equal(field in returned, false, `returned entry carries ${field}`);
    assert.equal(field in listTriggerHistory()[0], false, `listed entry carries ${field}`);
  }
  const onDisk = fs.readFileSync(ledgerFile, 'utf8');
  assert.equal(onDisk.includes(SECRET), false, 'the secret is in the file');
  assert.equal(onDisk.includes(KEY), false, 'the API key is in the file');
});

test('entries come back newest first', () => {
  // Value: protects=the History tab shows the latest message on top; fails_when=an append goes to the end of the list; why_new=ordering was only implied by a comment
  appendTriggerHistory(input({ body: 'first' }));
  appendTriggerHistory(input({ body: 'second' }));
  appendTriggerHistory(input({ body: 'third' }));
  assert.deepEqual(listTriggerHistory().map((e) => e.body), ['third', 'second', 'first']);
});

test('the ledger keeps only the newest 500 entries', () => {
  // Value: protects=trigger-history.json cannot grow forever; fails_when=the cap is dropped or keeps the oldest instead of the newest; why_new=nothing exercised the cap
  const extra = 5;
  for (let i = 0; i < TRIGGER_HISTORY_LIMIT + extra; i++) appendTriggerHistory(input({ body: `m${i}` }));

  const list = listTriggerHistory();
  assert.equal(list.length, TRIGGER_HISTORY_LIMIT);
  assert.equal(list[0].body, `m${TRIGGER_HISTORY_LIMIT + extra - 1}`, 'newest is kept');
  assert.equal(list[list.length - 1].body, `m${extra}`, 'oldest kept is the first one inside the cap');
  assert.equal(list.some((e) => e.body === 'm0'), false, 'the oldest entries were dropped');
});

test('an update changes only the decision, task id, correlation id and title', () => {
  // Value: protects=an entry's source, direction and body stay the record of what happened; fails_when=the patch is spread onto the entry; why_new=the allowed fields were only listed in a type
  const made = appendTriggerHistory(input({ decision: 'pending', title: 'Old title', body: 'original body' }));

  const updated = updateTriggerHistory(made.id, {
    decision: 'approved',
    taskId: 'task-9',
    correlationId: 'corr-1',
    title: 'New title',
    // Not patchable: extra fields a caller could pass despite the type.
    ...{ body: 'EDITED', source: 'org', sourceId: 'other', sourceName: 'Other', direction: 'outbound', peer: 'evil', kind: 'communication', id: 'forged', at: 1 }
  });

  const stored = listTriggerHistory();
  assert.equal(stored.length, 1);
  assert.deepEqual(updated, stored[0], 'the returned entry is what is stored');
  assert.equal(stored[0].decision, 'approved');
  assert.equal(stored[0].taskId, 'task-9');
  assert.equal(stored[0].correlationId, 'corr-1');
  assert.equal(stored[0].title, 'New title');
  for (const field of ['id', 'source', 'sourceId', 'sourceName', 'direction', 'peer', 'body', 'kind', 'at']) {
    assert.equal(stored[0][field], made[field], `${field} was changed by the update`);
  }
});

test('an update leaves fields it does not mention as they were', () => {
  // Value: protects=approving a message does not wipe its title or task; fails_when=an absent patch field overwrites the stored one; why_new=partial patches were never exercised
  const made = appendTriggerHistory(input({ decision: 'pending', title: 'Keep me', taskId: 'task-1' }));
  const updated = updateTriggerHistory(made.id, { decision: 'rejected' });
  assert.equal(updated.decision, 'rejected');
  assert.equal(updated.title, 'Keep me');
  assert.equal(updated.taskId, 'task-1');
});

test('updating an id that is not in the ledger returns null and changes nothing', () => {
  // Value: protects=an owner answering a message that aged out of the cap gets a quiet null, not a throw or a new row; fails_when=an unknown id throws or is appended; why_new=the aged out case is described in the module but was untested
  appendTriggerHistory(input({ body: 'only' }));
  const before = listTriggerHistory();

  assert.equal(updateTriggerHistory('no-such-id', { decision: 'approved' }), null);
  assert.deepEqual(listTriggerHistory(), before);
});

test('clearing one source keeps the other, and clearing everything removes the file', () => {
  // Value: protects=clearing webhook noise keeps the org conversation, and a full clear leaves no stale file; fails_when=clear(source) removes both halves or a full clear leaves the file; why_new=neither clear path had a test
  appendTriggerHistory(input({ source: 'webhook', body: 'hook 1' }));
  appendTriggerHistory(input({ source: 'org', body: 'org 1' }));
  appendTriggerHistory(input({ source: 'webhook', body: 'hook 2' }));

  clearTriggerHistory('webhook');
  assert.deepEqual(listTriggerHistory().map((e) => e.body), ['org 1']);

  clearTriggerHistory('org');
  assert.deepEqual(listTriggerHistory(), []);

  appendTriggerHistory(input());
  assert.equal(fs.existsSync(ledgerFile), true);
  clearTriggerHistory();
  assert.deepEqual(listTriggerHistory(), []);
  assert.equal(fs.existsSync(ledgerFile), false, 'a full clear removes the persisted file');
});

test('clearing an empty ledger does not throw', () => {
  // Value: protects=a request path that clears before anything was recorded; fails_when=a missing file raises; why_new=the no file case was untested
  assert.equal(fs.existsSync(ledgerFile), false);
  assert.doesNotThrow(() => clearTriggerHistory());
  assert.doesNotThrow(() => clearTriggerHistory('org'));
  assert.deepEqual(listTriggerHistory(), []);
});

test('rows that are not valid entries are dropped and the valid ones stay', () => {
  // Value: protects=a hand edited or half written file loses only its bad rows; fails_when=one bad row empties the ledger or reaches the UI; why_new=row validation was untested
  const good = { id: 'good', source: 'org', direction: 'outbound', body: 'kept', at: 5 };
  const bad = [
    null,
    'a string',
    42,
    { ...good, id: undefined },
    { ...good, id: 7 },
    { ...good, source: 'slack' },
    { ...good, direction: 'sideways' },
    { ...good, body: null },
    { ...good, at: '5' }
  ];
  fs.writeFileSync(ledgerFile, JSON.stringify([bad[0], good, ...bad.slice(1)]), 'utf8');

  assert.deepEqual(listTriggerHistory().map((e) => e.id), ['good']);
});

test('a file that is not a list reads as an empty ledger', () => {
  // Value: protects=a valid JSON file of the wrong shape does not crash the History tab; fails_when=a non array parse result is iterated; why_new=wrong shape was untested
  fs.writeFileSync(ledgerFile, JSON.stringify({ id: 'x', source: 'org' }), 'utf8');
  assert.deepEqual(listTriggerHistory(), []);
});

test('a damaged file reads as empty and the next record starts a fresh, readable ledger', () => {
  // Value: protects=recording an event never fails because the ledger is corrupt; fails_when=corrupt JSON throws on read or on the next append; why_new=the corrupt file path was untested
  fs.writeFileSync(ledgerFile, '{"id": "half written', 'utf8');
  assert.deepEqual(listTriggerHistory(), []);

  assert.doesNotThrow(() => appendTriggerHistory(input({ body: 'after the damage' })));
  assert.deepEqual(listTriggerHistory().map((e) => e.body), ['after the damage']);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(ledgerFile, 'utf8')));
});
