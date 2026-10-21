'use strict';

// A search's later pages reuse the ids its first page found instead of
// searching the whole folder again (TODOS: "Page a search without searching again").

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { MailService } = loadTs('src/main/mail.ts');

const server = { host: 'h', port: 993, secure: true };

function setup() {
  const state = { inbox: [1, 2, 3, 4, 5], searches: 0 };
  const imap = {
    usable: true,
    async connect() {}, async logout() {}, close() {},
    async list() { return [{ path: 'INBOX' }, { path: 'Archive', specialUse: '\\Archive' }]; },
    async getMailboxLock() { return { release() {} }; },
    async search(q) {
      if (q.uid) return q.uid.split(',').map(Number).filter((u) => state.inbox.includes(u));
      state.searches++;
      return [...state.inbox];
    },
    async *fetch(uids) {
      for (const uid of uids) if (state.inbox.includes(uid)) yield { uid, envelope: { from: [{ address: 'a@b.com' }], subject: `m${uid}`, date: new Date('2026-10-01') }, flags: new Set() };
    },
    async messageFlagsAdd() {},
    async messageMove(uids) { state.inbox = state.inbox.filter((u) => !uids.includes(u)); }
  };
  const config = { mailboxes: [{ id: 'sales', address: 's@x.com', provider: 'other', imap: server, smtp: server, status: 'connected', createdAt: 1, updatedAt: 1 }] };
  const svc = new MailService({ getConfig: () => config, getPassword: () => 'pw', markStatus() {}, createImap: () => imap });
  const ids = (r) => r.messages.map((m) => m.id);
  return { svc, state, ids };
}

test('later pages reuse the first page\'s search', async () => {
  const { svc, state, ids } = setup();
  assert.deepEqual(ids(await svc.search('sales', { limit: 2 })), ['5', '4']);
  assert.deepEqual(ids(await svc.search('sales', { limit: 2, page: 1 })), ['3', '2']);
  const last = await svc.search('sales', { limit: 2, page: 2 });
  assert.deepEqual([ids(last), last.total, last.more], [['1'], 5, false]);
  assert.equal(state.searches, 1);
});

test('page one, another query, and an archive all search again', async () => {
  const { svc, state, ids } = setup();
  await svc.search('sales', { limit: 2 });
  await svc.search('sales', { limit: 2 });
  assert.equal(state.searches, 2, 'page one is always fresh');

  await svc.search('sales', { limit: 2, page: 1, unread: true });
  assert.equal(state.searches, 3, 'a different query has its own list');

  await svc.organize('sales', 'archive', [5]);
  assert.deepEqual(ids(await svc.search('sales', { limit: 2, page: 1 })), ['2', '1']);
  assert.equal(state.searches, 4, 'archiving changed the inbox, so it searched again');
});

test('a kept list expires after a minute', async (t) => {
  const { svc, state } = setup();
  await svc.search('sales', { limit: 2 });
  const start = Date.now();
  t.mock.method(Date, 'now', () => start + 61_000);
  await svc.search('sales', { limit: 2, page: 1 });
  assert.equal(state.searches, 2);
});
