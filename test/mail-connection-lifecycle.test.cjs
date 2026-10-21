'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const loadTs = require('./load-ts.cjs');

const { MailService } = loadTs('src/main/mail.ts');

function setup(t, configure = () => {}, mailboxIds = ['sales']) {
  const clients = [];
  const server = { host: 'mail.example.test', port: 993, secure: true };
  const svc = new MailService({
    getConfig: () => ({ mailboxes: mailboxIds.map((id) => ({
      id, address: `${id}@example.test`, provider: 'other',
      imap: server, smtp: server, status: 'connected', createdAt: 1, updatedAt: 1
    })) }),
    getPassword: () => 'test-password',
    markStatus: () => {},
    createImap: () => {
      const client = Object.assign(new EventEmitter(), {
        usable: true,
        logouts: 0,
        closes: 0,
        async connect() {},
        close() { this.closes++; this.usable = false; },
        // Model the delayed socket event separately from starting logout.
        async logout() { this.logouts++; this.usable = false; },
        async getMailboxLock() { return { release() {} }; },
        async search() { return []; }
      });
      configure(client, clients.length);
      clients.push(client);
      return client;
    }
  });
  t.after(() => svc.closeAll());
  return { svc, clients, search: (id = 'sales') => svc.search(id, {}) };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('simultaneous reads wait for one mailbox login and leave one connection to close', async (t) => {
  // Value: protects=parallel tools share the mailbox login; fails_when=each call opens a socket and an overwritten connection leaks; why_new=existing tests only acquired connections sequentially; seam=deferred IMAP login
  const login = deferred();
  let locks = 0;
  const { svc, clients, search } = setup(t, (client) => {
    client.usable = false;
    client.connect = async () => { await login.promise; client.usable = true; };
    client.getMailboxLock = async () => { locks++; return { release() {} }; };
  });
  const reads = Promise.all([search(), search(), search()]);
  try {
    assert.equal(clients.length, 1, 'one connection is created while login is pending');
    assert.equal(locks, 0, 'no call uses the connection before login finishes');
    login.resolve();
    await reads;
    assert.equal(locks, 3, 'all reads continue after the shared login');
    await search();
    assert.equal(clients.length, 1, 'later reads reuse the same connection');
    svc.closeAll();
    assert.equal(clients[0].logouts, 1, 'shutdown owns and closes the only socket');
  } finally { login.resolve(); await reads.catch(() => {}); svc.closeAll(); }
});

test('a shared failed login is cleaned up and a later call can try again', async (t) => {
  // Value: protects=a rejected shared login does not poison the cache; fails_when=failed sockets leak or later reads inherit the rejected promise; why_new=concurrent authentication failures; seam=deferred IMAP login
  const login = deferred();
  const { clients, search } = setup(t, (client, index) => {
    if (index === 0) client.connect = () => login.promise;
  });
  const reads = Promise.allSettled([search(), search()]);
  login.reject(Object.assign(new Error('Login refused'), { authenticationFailed: true }));
  const results = await reads;
  assert.ok(results.every((r) => r.status === 'rejected' && r.reason.kind === 'auth'));
  assert.equal(clients.length, 1);
  assert.equal(clients[0].closes, 1, 'the failed socket is closed once');
  await search();
  await search();
  assert.equal(clients.length, 2, 'the fresh login succeeds and is reused');
});

test('concurrent readers share one reconnect after a failed login connection', async (t) => {
  // Value: protects=one retry cannot tear down another reader's replacement; fails_when=an old acquisition error drops the newly opening socket; why_new=concurrent network failure; seam=deferred IMAP login
  const login = deferred();
  const { clients, search } = setup(t, (client, index) => {
    if (index === 0) client.connect = () => login.promise;
  });
  const reads = Promise.all([search(), search()]);
  login.reject(Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }));
  await reads;
  assert.equal(clients.length, 2, 'both readers use the same replacement');
  assert.equal(clients[0].closes, 1);
  assert.equal(clients[1].logouts, 0);
  assert.equal(clients[1].closes, 0);
});

test('closing a pending login prevents its late completion from replacing a new connection', async (t) => {
  // Value: protects=closing a mailbox also closes its pending socket; fails_when=a late login resurrects a closed connection or overwrites the replacement; why_new=close during connection establishment; seam=deferred IMAP login
  const login = deferred();
  const started = deferred();
  const { svc, clients, search } = setup(t, (client, index) => {
    if (index === 0) client.connect = () => { started.resolve(); return login.promise; };
  });
  const oldRead = search().then(() => ({ ok: true }), (error) => ({ error }));
  try {
    await started.promise;
    svc.close('sales');
    assert.equal(clients[0].closes, 1, 'close reaches the pending connection');
    await search();
    const replacement = clients[1];
    login.resolve();
    assert.equal((await oldRead).error?.kind, 'refused', 'a closed login cannot resume the old read');
    await search();
    assert.equal(clients.length, 2);
    assert.equal(replacement.logouts, 0);
    assert.equal(replacement.closes, 0);
  } finally { login.resolve(); await oldRead; svc.closeAll(); }
});

test('closing all mailboxes includes pending logins without serializing different mailboxes', async (t) => {
  // Value: protects=shutdown owns every connecting mailbox; fails_when=pending sockets survive shutdown or unrelated mailboxes share a global queue; why_new=parallel login and shutdown; seam=deferred IMAP logins
  const login = deferred();
  const started = deferred();
  let connections = 0;
  const { svc, clients, search } = setup(t, (client) => {
    client.connect = () => { if (++connections === 2) started.resolve(); return login.promise; };
  }, ['sales', 'support']);
  const reads = Promise.allSettled([search('sales'), search('support')]);
  try {
    await started.promise;
    assert.equal(clients.length, 2, 'different mailboxes connect independently');
    svc.closeAll();
    assert.ok(clients.every((c) => c.closes === 1), 'both pending sockets are closed');
    login.resolve();
    assert.ok((await reads).every((r) => r.status === 'rejected' && r.reason.kind === 'refused'));
    assert.ok(clients.every((c) => c.closes === 1), 'late completion does not close a socket twice');
  } finally { login.resolve(); await reads; svc.closeAll(); }
});

test('a login rejected by closing its socket does not reconnect the closed mailbox', async (t) => {
  // Value: protects=explicit close is not mistaken for a retryable network failure; fails_when=closing the login socket immediately opens another one; why_new=real IMAP clients reject connect when closed; seam=deferred IMAP login
  const login = deferred();
  const started = deferred();
  const { svc, clients, search } = setup(t, (client, index) => {
    if (index === 0) client.connect = () => { started.resolve(); return login.promise; };
  });
  const read = search();
  await started.promise;
  svc.close('sales');
  login.reject(Object.assign(new Error('Socket closed'), { code: 'ECONNRESET' }));
  await assert.rejects(read, (error) => error.kind === 'refused');
  assert.equal(clients.length, 1, 'cancellation never retries the login');
  assert.equal(clients[0].closes, 1);
  await search();
  assert.equal(clients.length, 2, 'a later explicit read can open a fresh connection');
});

test('closing a mailbox before its scheduled login starts never opens the socket', async (t) => {
  // Value: protects=an immediate close cannot be followed by a deferred login; fails_when=the connection starts after close already ran; why_new=ownership is recorded before the login microtask; seam=injected IMAP client
  let connections = 0;
  const { svc, clients, search } = setup(t, (client) => {
    client.connect = async () => { connections++; };
  });
  const read = search();
  svc.close('sales');
  await assert.rejects(read, (error) => error.kind === 'refused');
  assert.equal(connections, 0);
  assert.equal(clients[0].closes, 1);
});

test('an older read failure cannot close the replacement connection', async (t) => {
  // Value: protects=a late operation error only retires its own socket; fails_when=retry drops a replacement opened since the old read began; why_new=existing stale-event tests did not cover promise rejections; seam=deferred IMAP search
  const started = deferred();
  const answer = deferred();
  const { svc, clients, search } = setup(t, (client, index) => {
    if (index === 0) client.search = () => { started.resolve(); return answer.promise; };
  });
  const oldRead = search();
  try {
    await started.promise;
    svc.close('sales');
    await search();
    answer.reject(Object.assign(new Error('Old read disconnected'), { code: 'ECONNRESET' }));
    await oldRead;
    assert.equal(clients.length, 2, 'the old read retries through the current connection');
    assert.equal(clients[1].logouts, 0);
    assert.equal(clients[1].closes, 0);
  } finally { answer.resolve([]); await oldRead.catch(() => {}); svc.closeAll(); }
});

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
