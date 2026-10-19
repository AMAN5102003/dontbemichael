'use strict';

/**
 * Multi-mailbox, protocol level (eng review E4): the real ImapFlow and Nodemailer
 * clients against local test servers, hoodiecrow-imap (IMAP) and smtp-server
 * (SMTP), started inside the test. No network leaves the machine.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const hoodiecrow = require('hoodiecrow-imap');
const { SMTPServer } = require('smtp-server');
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');

const { MailService, handleMailRequest } = loadTs('src/main/mail.ts');

const USER = 'sales@x.test';
const PASS = 'app-pass-123';

const msg = (from, subject, body, id) => `From: ${from}\r\nTo: ${USER}\r\nSubject: ${subject}\r\nMessage-ID: <${id}@x.test>\r\nDate: Fri, 25 Sep 2026 10:00:00 +0000\r\n\r\n${body}\r\n`;

function listen(server, port = 0) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.server.address().port)));
}

async function servers(t, configureImap = () => {}) {
  const imap = hoodiecrow({
    plugins: ['SPECIAL-USE', 'ID', 'UNSELECT', 'ENABLE', 'LITERALPLUS'],
    users: { [USER]: { password: PASS } },
    storage: {
      INBOX: { messages: [
        { raw: msg('acme@buyer.test', 'Quote please', 'Can you quote 40 units?', 'q1') },
        { raw: msg('bob@other.test', 'Lunch', 'Friday?', 'l1'), flags: ['\\Seen'] }
      ] },
      '': { separator: '/', folders: {
        Drafts: { 'special-use': '\\Drafts', messages: [] },
        Sent: { 'special-use': '\\Sent', messages: [] }
      } }
    }
  });
  configureImap(imap);
  const imapPort = await new Promise((resolve) => { imap.listen(0, '127.0.0.1', function () { resolve(this.address().port); }); });
  t.after(() => imap.close());

  const received = [];
  const smtp = new SMTPServer({
    secure: false, disabledCommands: ['STARTTLS'], logger: false,
    onAuth(auth, _s, cb) { cb(auth.username === USER && auth.password === PASS ? null : new Error('535 Invalid credentials'), { user: auth.username }); },
    onData(stream, _s, cb) { let d = ''; stream.on('data', (c) => { d += c; }); stream.on('end', () => { received.push(d); cb(); }); }
  });
  const smtpPort = await listen(smtp);
  t.after(() => smtp.close());
  return { imapPort, smtpPort, received };
}

function service(ports, password = PASS) {
  const statuses = [];
  const clients = [];
  const config = {
    mcpDefaults: { 'email-calendar': { enabled: true } },
    mailboxes: [{ id: 'sales', address: USER, provider: 'other', imap: { host: '127.0.0.1', port: ports.imapPort, secure: false }, smtp: { host: '127.0.0.1', port: ports.smtpPort, secure: false }, status: 'connected', createdAt: 1, updatedAt: 1 }],
    agentCapabilities: { dwight: { email: { enabled: true, mailboxes: ['sales'], send: true } } }
  };
  const deps = {
    getConfig: () => config,
    getPassword: () => password,
    markStatus: (id, status, reason) => statuses.push({ id, status, reason }),
    createImap: (s, user, pass) => {
      const client = new ImapFlow({ host: s.host, port: s.port, secure: false, doSTARTTLS: false, auth: { user, pass }, logger: false });
      clients.push(client);
      return client;
    },
    createSmtp: (s, user, pass) => nodemailer.createTransport({ host: s.host, port: s.port, secure: false, ignoreTLS: true, auth: { user, pass } })
  };
  const svc = new MailService(deps);
  return { svc, statuses, clients, call: (op, body) => handleMailRequest(svc, deps, 'dwight', op, body) };
}

test('a delayed IMAP logout leaves the replacement connection available', { timeout: 10_000 }, async (t) => {
  let finishLogout;
  let onLogout;
  const logoutStarted = new Promise((resolve) => { onLogout = resolve; });
  const ports = await servers(t, (imap) => {
    const logout = imap.getCommandHandler('LOGOUT');
    let first = true;
    imap.setCommandHandler('LOGOUT', (...args) => {
      if (!first) return logout(...args);
      first = false;
      // Hold only A's logout response until B has connected; no timing sleeps.
      finishLogout = () => { finishLogout = undefined; logout(...args); };
      onLogout();
    });
  });
  const { svc, clients, call } = service(ports);
  t.after(() => {
    finishLogout?.();
    svc.closeAll();
    for (const client of clients) client.close();
  });

  assert.equal((await call('search', { mailbox: 'sales' })).status, 200);
  const oldClosed = new Promise((resolve) => clients[0].once('close', resolve));
  svc.close('sales');
  await logoutStarted;
  assert.equal((await call('search', { mailbox: 'sales' })).status, 200);
  assert.equal(clients.length, 2);

  finishLogout();
  await oldClosed;

  const result = await call('search', { mailbox: 'sales' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(clients.length, 2, 'the replacement survives the old socket closing and is reused');
});

test('parallel searches share one real IMAP connection', { timeout: 10_000 }, async (t) => {
  // Value: protects=parallel broker calls share a real login and mailbox lock; fails_when=ImapFlow clients are created per concurrent read; why_new=unit gates alone do not exercise the protocol; seam=local IMAP server
  const ports = await servers(t);
  const { svc, clients, call } = service(ports);
  t.after(() => { svc.closeAll(); for (const client of clients) client.close(); });

  const results = await Promise.all([
    call('search', { mailbox: 'sales', from: 'acme' }),
    call('search', { mailbox: 'sales', from: 'bob' }),
    call('search', { mailbox: 'sales', unread: true })
  ]);
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results));
  assert.deepEqual(results.map((r) => r.body.messages.map((m) => m.subject)), [
    ['Quote please'], ['Lunch'], ['Quote please']
  ]);
  assert.equal(clients.length, 1, 'one authenticated connection serves all three calls');
});

test('search, read, draft and send against real IMAP and SMTP servers', async (t) => {
  const ports = await servers(t);
  const { svc, call } = service(ports);
  t.after(() => svc.closeAll());

  const s = await call('search', { mailbox: 'sales', from: 'acme' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.messages.length, 1);
  assert.equal(s.body.messages[0].subject, 'Quote please');

  const unread = await call('search', { mailbox: 'sales', unread: true });
  assert.deepEqual(unread.body.messages.map((m) => m.subject), ['Quote please']);

  const r = await call('read', { mailbox: 'sales', id: s.body.messages[0].id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.text, /40 units/);

  const d = await call('draft', { mailbox: 'sales', to: 'acme@buyer.test', subject: 'Re: Quote please', body: 'Draft: $400', reply_to: { mailbox: 'sales', id: s.body.messages[0].id } });
  assert.equal(d.status, 200, JSON.stringify(d.body));

  const sent = await call('send', { mailbox: 'sales', to: 'acme@buyer.test', subject: 'Re: Quote please', body: '40 units: $400', reply_to: { mailbox: 'sales', id: s.body.messages[0].id } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const again = await call('send', { mailbox: 'sales', to: 'acme@buyer.test', subject: 'Re: Quote please', body: '40 units: $400', reply_to: { mailbox: 'sales', id: s.body.messages[0].id } });
  assert.equal(again.body.repeated, true);
  assert.equal(ports.received.length, 1, 'one email left the building');
  assert.match(ports.received[0], /In-Reply-To: <q1@x\.test>/);
});

test('a wrong password marks the mailbox needs-attention', async (t) => {
  const ports = await servers(t);
  const { svc, call, statuses } = service(ports, 'wrong');
  t.after(() => svc.closeAll());
  const r = await call('search', { mailbox: 'sales' });
  assert.equal(r.status, 502);
  assert.equal(r.body.kind, 'auth');
  assert.equal(statuses.at(-1).status, 'needs-attention');
});

test('Settings test: good password passes, bad password gives a plain reason', async (t) => {
  const ports = await servers(t);
  const { svc } = service(ports);
  const rec = { address: USER, imap: { host: '127.0.0.1', port: ports.imapPort, secure: false }, smtp: { host: '127.0.0.1', port: ports.smtpPort, secure: false } };
  assert.deepEqual(await svc.test(rec, PASS), { ok: true });
  const bad = await svc.test(rec, 'nope');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /app password/);
});
