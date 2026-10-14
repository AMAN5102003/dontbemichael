'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const loadTs = require('./load-ts.cjs');

const { MailService } = loadTs('src/main/mail.ts');

function setup(t) {
  const clients = [];
  const server = { host: 'mail.example.test', port: 993, secure: true };
  const svc = new MailService({
    getConfig: () => ({ mailboxes: [{
      id: 'sales', address: 'sales@example.test', provider: 'other',
      imap: server, smtp: server, status: 'connected', createdAt: 1, updatedAt: 1
    }] }),
    getPassword: () => 'test-password',
    markStatus: () => {},
    createImap: () => {
      const client = Object.assign(new EventEmitter(), {
        usable: true,
        logouts: 0,
        async connect() {},
        // Model the delayed socket event separately from starting logout.
        async logout() { this.logouts++; this.usable = false; },
        async getMailboxLock() { return { release() {} }; },
        async search() { return []; }
      });
      clients.push(client);
      return client;
    }
  });
  t.after(() => svc.closeAll());
  return { svc, clients, search: () => svc.search('sales', {}) };
}

for (const event of ['close', 'error']) {
  for (const replace of ['closed', 'unusable']) {
    test(`the ${event} event from a connection replaced as ${replace} leaves its replacement open`, async (t) => {
      const { svc, clients, search } = setup(t);
      await search();
      const old = clients[0];
      if (replace === 'closed') svc.close('sales');
      else old.usable = false;
      await search();
      assert.equal(clients.length, 2);
      const current = clients[1];

      old.emit(event, new Error('Old socket finished closing'));

      assert.equal(current.logouts, 0, 'a stale event must not log out the replacement');
      await search();
      assert.equal(clients.length, 2, 'the replacement is still reused');
      assert.equal(old.logouts, 1, 'the old connection is cleaned up once');
    });
  }

  test(`the ${event} event from the current connection still reconnects on the next call`, async (t) => {
    const { clients, search } = setup(t);
    await search();
    const old = clients[0];

    old.emit(event, new Error('Current socket disconnected'));

    assert.equal(old.logouts, 1);
    await search();
    assert.equal(clients.length, 2, 'the next call opens a new connection');
    assert.equal(clients[1].logouts, 0);
  });
}
