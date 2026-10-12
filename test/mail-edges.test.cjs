'use strict';

/**
 * Multi-mailbox edge and error paths (ship coverage audit, 2026-09-26):
 * Settings add / fix / remove, the Capabilities save, and the broker mail
 * route's refusals and error mapping, against an injected fake IMAP/SMTP
 * client. The happy paths live in mail-service.test.cjs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  PROVIDER_PRESETS, guessServers, mailboxIdFor, secretRefForMailbox, mailAccess, agentMailboxes, mailToolsJustAttached
} = loadTs('src/shared/mailboxes.ts');
const { emailCalendarAllowed } = loadTs('src/shared/mcpCatalog.ts');
const { MailService, MailError, handleMailRequest, classifyMailError, saveMailbox, removeMailbox, setAgentCapabilities, cannotStoreReason } = loadTs('src/main/mail.ts');

const server = { host: 'h', port: 993, secure: true };
const box = (id, address, provider = 'gmail') => ({ id, address, provider, imap: server, smtp: server, status: 'connected', createdAt: 1, updatedAt: 1 });

const raw = (subject, id) => Buffer.from(`From: a@b.com\r\nTo: sales@x.com\r\nSubject: ${subject}\r\nMessage-ID: <${id}@x.com>\r\nDate: Fri, 25 Sep 2026 10:00:00 +0000\r\n\r\nbody ${id}\r\n`);

function fakeImap(state) {
  let folder = 'INBOX';
  return {
    usable: true,
    async connect() { state.connects = (state.connects ?? 0) + 1; if (state.failConnect) throw state.failConnect; },
    async logout() { state.logouts = (state.logouts ?? 0) + 1; },
    close() { state.closes = (state.closes ?? 0) + 1; },
    async list() { return [{ path: 'INBOX' }, { path: 'Drafts', specialUse: '\\Drafts' }, { path: 'Sent', specialUse: '\\Sent' }]; },
    async getMailboxLock(p) { folder = p; return { release() {} }; },
    async search(q) {
      state.queries = [...(state.queries ?? []), q];
      if (q.header) return state.sentHit ? [1] : [];
      return state.folders[folder].map((m) => m.uid);
    },
    async *fetch(uids) { for (const m of state.folders[folder]) if (uids.includes(m.uid)) yield { uid: m.uid, envelope: { from: [{ address: 'a@b.com' }], subject: m.subject, date: new Date('2026-09-25') }, flags: new Set() }; },
    async fetchOne(uid) { const m = state.folders[folder].find((x) => String(x.uid) === String(uid)); return m ? { source: m.source } : false; },
    async append(p, content) { state.folders[p].push({ uid: 100 + state.folders[p].length, subject: '', source: content }); }
  };
}

function setup(over = {}) {
  const inbox = [];
  for (let uid = 1; uid <= 7; uid++) inbox.push({ uid, subject: `m${uid}`, source: raw(`m${uid}`, `m${uid}`) });
  const state = { folders: { INBOX: inbox, Drafts: [], Sent: [] }, sends: [], statuses: [] };
  const config = {
    mailboxes: [box('sales', 'sales@x.com'), box('ceo', 'ceo@x.com', 'icloud')],
    agentCapabilities: {
      dwight: { email: { enabled: true, mailboxes: ['sales'], send: true } },
      pam: { email: { enabled: true, mailboxes: ['ceo'], send: true } }
    },
    ...(over.config ?? {})
  };
  const deps = {
    getConfig: () => config,
    getPassword: over.getPassword ?? ((id) => (id === 'sales' || id === 'ceo' ? 'app-pass' : undefined)),
    markStatus: (id, status, reason) => state.statuses.push({ id, status, reason }),
    createImap: () => fakeImap(state),
    createSmtp: () => ({
      async sendMail(m) { if (state.smtpError) throw state.smtpError; state.sends.push(m); return { messageId: m.messageId }; },
      async verify() { if (state.verifyError) throw state.verifyError; },
      close() { state.smtpCloses = (state.smtpCloses ?? 0) + 1; }
    }),
    log: over.log
  };
  const svc = new MailService(deps);
  return { state, svc, config, call: (agent, op, body) => handleMailRequest(svc, deps, agent, op, body) };
}

// ── shared/mailboxes.ts helpers ─────────────────────────────────────────────

test('helpers and the access rule edges: server guesses, the Claude account switch, ids, a read with no mailbox, email off', () => {
  assert.deepEqual(guessServers('me@Shop.Example.com'), {
    imap: { host: 'mail.shop.example.com', port: 993, secure: true },
    smtp: { host: 'mail.shop.example.com', port: 465, secure: true }
  });
  assert.equal(guessServers('no-at-sign').imap.host, 'mail.example.com', 'no domain yet: a placeholder, not a crash');
  assert.equal(emailCalendarAllowed(undefined), false);
  assert.equal(emailCalendarAllowed({ 'email-calendar': { enabled: false } }), false);
  assert.equal(emailCalendarAllowed({ 'email-calendar': { enabled: true } }), true);
  assert.equal(mailboxIdFor('!!!'), 'mailbox', 'nothing usable in the address');
  assert.equal(mailboxIdFor('a@b'), 'a-b');
  assert.equal(mailboxIdFor('x', []), 'mb-x', 'a one character base is not a valid slug');
  assert.ok(mailboxIdFor(`${'a'.repeat(60)}@x.com`).length <= 40, 'ids are capped');
  assert.equal(mailboxIdFor('s@x.com', ['s-x-com', 's-x-com-2']), 's-x-com-3');
  assert.equal(secretRefForMailbox('sales'), 'mail:sales');
  const cfg = { mailboxes: [box('sales', 's@x.com')], agentCapabilities: { dwight: { email: { enabled: true, mailboxes: ['sales'], send: true } }, off: { email: { enabled: false, mailboxes: ['sales'], send: true } } } };
  const r = mailAccess(cfg, 'dwight', undefined, 'read');
  assert.equal(r.ok, false);
  assert.match(r.reason, /list_mailboxes/);
  assert.equal(mailAccess(cfg, 'off', 'sales', 'read').ok, false, 'switched off keeps the old pick but grants nothing');
  assert.deepEqual(agentMailboxes(cfg, 'off'), []);
  assert.equal(mailToolsJustAttached({ email: { enabled: true, mailboxes: [], send: false } }, { email: { enabled: false, mailboxes: [], send: false } }), false, 'turning off never restarts');
});

// ── classifyMailError ───────────────────────────────────────────────────────

test('classifyMailError: timeouts, unknown errors and MailError pass through', () => {
  assert.equal(classifyMailError({ message: 'Command timed out' }).kind, 'timeout');
  const unknown = classifyMailError(new Error('NO [ALERT] mailbox is full'));
  assert.equal(unknown.kind, 'unknown');
  assert.match(unknown.message, /mailbox is full/);
  const own = new MailError('not-found', 'x');
  assert.equal(classifyMailError(own), own);
  assert.equal(classifyMailError({ response: '535 5.7.8 Username and Password not accepted' }).kind, 'auth');
  assert.equal(classifyMailError({ responseText: 'Please log in via your web browser' }).kind, 'provider-blocked');
});

// ── handleMailRequest: refusals and error mapping ───────────────────────────

test('mail route: unknown tool 404, missing id or subject 400, numeric id reads, missing message 404', async () => {
  const { call, state } = setup();
  assert.equal((await call('dwight', 'delete_all', { mailbox: 'sales' })).status, 404);
  const noId = await call('dwight', 'read', { mailbox: 'sales' });
  assert.equal(noId.status, 400);
  assert.match(noId.body.error, /message id/);
  const noSubject = await call('dwight', 'draft', { mailbox: 'sales', to: 'a@b.com', body: 'x' });
  assert.equal(noSubject.status, 400);
  const noTo = await call('dwight', 'send', { mailbox: 'sales', subject: 's', body: 'x' });
  assert.equal(noTo.status, 400);
  assert.equal(state.sends.length, 0);
  assert.equal(state.folders.Drafts.length, 0);
  {
  const { call } = setup();
  const r = await call('dwight', 'read', { mailbox: 'sales', id: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.body.subject, 'm3');
  const missing = await call('dwight', 'read', { mailbox: 'sales', id: '999' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.kind, 'not-found');
  }
});

test('mail route: one log line per call with agent, mailbox, tool, result and time, never the email itself', async () => {
  const lines = [];
  const { call } = setup({ log: (line) => lines.push(line) });
  await call('dwight', 'search', { mailbox: 'sales' });
  await call('dwight', 'read', { mailbox: 'sales', id: '999' });
  await call('dwight', 'draft', { mailbox: 'sales', to: 'client@private.com', subject: 'Private offer', body: 'x' });
  await call('dwight', 'delete_all', { mailbox: 'sales\n[mail] forged' });
  assert.equal(lines.length, 4, 'one line per call, refusals included');
  assert.match(lines[0], /^\[mail\] dwight sales search 200 \d+ms$/);
  assert.match(lines[1], /^\[mail\] dwight sales read 404 not-found \d+ms$/);
  assert.match(lines[2], /^\[mail\] dwight sales draft 200 \d+ms$/);
  assert.doesNotMatch(lines.join('\n'), /client@private|Private offer/, 'no recipient or subject');
  assert.match(lines[3], /^\[mail\] dwight sales\?\?mail\?\?forged unknown 404 \d+ms$/, 'what the agent names stays on one line');
});

test('search pages newest first, caps the page size, and ignores a bad date', async () => {
  const { call, state } = setup();
  const p0 = await call('dwight', 'search', { mailbox: 'sales', limit: 3 });
  assert.deepEqual(p0.body.messages.map((m) => m.id), ['7', '6', '5']);
  assert.equal(p0.body.total, 7);
  assert.equal(p0.body.more, true);
  const p2 = await call('dwight', 'search', { mailbox: 'sales', limit: 3, page: 2 });
  assert.deepEqual(p2.body.messages.map((m) => m.id), ['1']);
  assert.equal(p2.body.more, false);
  const huge = await call('dwight', 'search', { mailbox: 'sales', limit: 5000 });
  assert.equal(huge.body.messages.length, 7, 'every one of the seven');
  // With more than 50 messages the page is capped at 50 (SEARCH_MAX).
  const big = setup();
  for (let uid = 8; uid <= 60; uid++) big.state.folders.INBOX.push({ uid, subject: `m${uid}`, source: raw(`m${uid}`, `m${uid}`) });
  const capped = await big.call('dwight', 'search', { mailbox: 'sales', limit: 5000 });
  assert.equal(capped.body.messages.length, 50);
  assert.equal(capped.body.more, true);
  await call('dwight', 'search', { mailbox: 'sales', since: 'not a date' });
  assert.deepEqual(state.queries.at(-1), { all: true, draft: false }, 'a bad date is dropped, not sent to the server; drafts never come back');
  const zero = await call('dwight', 'search', { mailbox: 'sales', limit: 0 });
  assert.equal(zero.body.messages.length, 1, 'a limit under one becomes one');
});

test('a mailbox with no saved password is refused in plain words and marked needs-attention', async () => {
  const { call, state } = setup({ getPassword: () => undefined });
  const r = await call('dwight', 'search', { mailbox: 'sales' });
  assert.equal(r.status, 502);
  assert.equal(r.body.kind, 'auth');
  assert.match(r.body.error, /no saved password/);
  assert.equal(state.statuses.at(-1).status, 'needs-attention');
});

// ── send failures ───────────────────────────────────────────────────────────

test('send failures: a refusal says "Not sent" and is not remembered; a timeout not found in Sent is held as maybe sent', async () => {
  const { call, state } = setup();
  state.smtpError = Object.assign(new Error('535 Authentication failed'), { code: 'EAUTH' });
  const msg = { mailbox: 'sales', to: 'a@b.com', subject: 's', body: 'b' };
  const r = await call('dwight', 'send', msg);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /^Not sent\./);
  assert.equal(state.statuses.at(-1).status, 'needs-attention');
  assert.ok(state.smtpCloses >= 1, 'the SMTP connection is closed on failure');
  state.smtpError = null;
  const retry = await call('dwight', 'send', msg);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.repeated, undefined, 'a failed send is not answered from memory');
  assert.equal(state.sends.length, 1);
  {
  const { call, state } = setup();
  state.smtpError = Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' });
  state.sentHit = false;
  const r = await call('dwight', 'send', { mailbox: 'sales', to: 'a@b.com', subject: 's', body: 'b' });
  assert.equal(r.status, 502, 'ETIMEDOUT classifies as network');
  // A drop mid-send may have delivered it (issue 101): held, never reported as not sent.
  assert.match(r.body.error, /^This email may already have gone out/);
  assert.ok(state.queries.some((q) => q.header && q.header['message-id']), 'Sent was checked first');
  }
  {
  // The connection closing mid-send may have delivered it too (adversarial review).
  const { call, state } = setup();
  state.smtpError = Object.assign(new Error('Connection closed unexpectedly'), { code: 'ECONNECTION' });
  state.sentHit = false;
  const r = await call('dwight', 'send', { mailbox: 'sales', to: 'a@b.com', subject: 's', body: 'b' });
  assert.match(r.body.error, /^This email may already have gone out/);
  }
  // A server that was never reached took nothing: that is plainly not sent, and a retry may send it.
  for (const never of [
    Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:465'), { code: 'ESOCKET', syscall: 'connect' }),
    Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }),
    Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' })
  ]) {
    const { call, state } = setup();
    state.smtpError = never;
    state.sentHit = false;
    const r = await call('dwight', 'send', { mailbox: 'sales', to: 'a@b.com', subject: 's', body: 'b' });
    assert.match(r.body.error, /^Not sent\./, never.message);
    state.smtpError = null;
    assert.equal((await call('dwight', 'send', { mailbox: 'sales', to: 'a@b.com', subject: 's', body: 'b' })).status, 200, `${never.message}: the retry sends`);
  }
});

test('a send from a non Gmail mailbox files a copy in Sent; Gmail does not', async () => {
  const icloud = setup();
  const r = await icloud.call('pam', 'send', { mailbox: 'ceo', to: 'a@b.com', subject: 'Hi', body: 'Copy me' });
  assert.equal(r.status, 200);
  assert.equal(icloud.state.folders.Sent.length, 1);
  assert.match(icloud.state.folders.Sent[0].source.toString(), /Copy me/);
  const gmail = setup();
  await gmail.call('dwight', 'send', { mailbox: 'sales', to: 'a@b.com', subject: 'Hi', body: 'x' });
  assert.equal(gmail.state.folders.Sent.length, 0, 'Gmail files sent mail itself');
});

test('forwarding from the same mailbox attaches the original message', async () => {
  const { call, state } = setup();
  const r = await call('dwight', 'send', { mailbox: 'sales', to: 'a@b.com', subject: 'Fwd', body: 'see below', forward: { mailbox: 'sales', id: '2' } });
  assert.equal(r.status, 200);
  const att = state.sends[0].attachments;
  assert.equal(att.length, 1);
  assert.equal(att[0].contentType, 'message/rfc822');
  assert.match(att[0].content.toString(), /Subject: m2/);
});

// ── Settings test() ─────────────────────────────────────────────────────────

test('Settings test: says which half is broken, and a failed login closes its socket', async () => {
  const { svc, state } = setup();
  state.verifyError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  const r = await svc.test({ address: 'sales@x.com', imap: server, smtp: server }, 'p');
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'network');
  assert.match(r.reason, /^Incoming mail works, but sending does not\./);
  assert.ok(state.smtpCloses >= 1);
  {
  const { svc, state } = setup();
  state.failConnect = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
  const r = await svc.test({ address: 'sales@x.com', imap: server, smtp: server }, 'bad');
  assert.equal(r.kind, 'auth');
  assert.equal(state.closes, 1);
  }
});

// ── saveMailbox / removeMailbox / setAgentCapabilities ──────────────────────

function admin(initial) {
  const state = { cfg: { mailboxes: [], agentCapabilities: {}, ...initial }, secrets: {}, deleted: [], setSecretFails: false };
  return {
    state,
    getConfig: () => state.cfg,
    saveConfig: (patch) => { state.cfg = { ...state.cfg, ...patch }; },
    setSecret: (ref, value) => { if (state.setSecretFails) return { ok: false, error: typeof state.setSecretFails === 'string' ? state.setSecretFails : 'OS secret encryption is unavailable; refusing to store a secret in plaintext' }; state.secrets[ref] = value; return { ok: true }; },
    deleteSecret: (ref) => { state.deleted.push(ref); delete state.secrets[ref]; }
  };
}

test('saveMailbox refuses bad input before any login', async () => {
  const { svc, state } = setup();
  const a = admin();
  const bad = (input) => saveMailbox(svc, a, PROVIDER_PRESETS, { provider: 'gmail', address: 'sales@x.com', password: 'p', ...input });
  assert.equal((await bad({ address: 'not-an-address' })).kind, 'invalid');
  assert.match((await bad({ password: '   ' })).reason, /app password/);
  const other = await bad({ provider: 'other', address: 'me@shop.com' });
  assert.equal(other.kind, 'invalid');
  assert.match(other.reason, /servers/);
  assert.equal(state.connects, undefined, 'nothing tried to log in');
  assert.deepEqual(a.state.cfg.mailboxes, []);
});

test('saveMailbox tests first: a failed login stores nothing', async () => {
  const { svc, state } = setup();
  state.failConnect = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
  const a = admin();
  const r = await saveMailbox(svc, a, PROVIDER_PRESETS, { provider: 'gmail', address: 'sales@x.com', password: 'wrong' });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'auth');
  assert.deepEqual(a.state.secrets, {});
  assert.deepEqual(a.state.cfg.mailboxes, []);
});

test('saveMailbox: a good login stores the password (spaces removed); listed services use presets, Other uses typed servers', async () => {
  const { svc } = setup();
  const a = admin();
  const r = await saveMailbox(svc, a, PROVIDER_PRESETS, { provider: 'gmail', address: '  Sales@Shop.com ', password: 'abcd efgh ijkl mnop', imap: { host: 'evil', port: 1, secure: false } });
  assert.equal(r.ok, true);
  assert.equal(r.record.id, 'sales-shop-com');
  assert.equal(r.record.address, 'Sales@Shop.com');
  assert.deepEqual(r.record.imap, PROVIDER_PRESETS.gmail.imap, 'a listed service always uses its own servers');
  assert.equal(a.state.secrets['mail:sales-shop-com'], 'abcdefghijklmnop', 'Google shows app passwords in groups of four');
  assert.equal(a.state.cfg.mailboxes.length, 1);
  const dup = await saveMailbox(svc, a, PROVIDER_PRESETS, { provider: 'gmail', address: 'sales@shop.com', password: 'p' });
  assert.equal(dup.ok, false);
  assert.match(dup.reason, /already connected/);
  {
  const { svc } = setup();
  const a = admin();
  const imap = { host: 'imap.shop.com', port: 993, secure: true };
  const smtp = { host: 'smtp.shop.com', port: 587, secure: false };
  const r = await saveMailbox(svc, a, PROVIDER_PRESETS, { provider: 'other', address: 'me@shop.com', password: 'p', imap, smtp });
  assert.equal(r.ok, true);
  assert.deepEqual(r.record.imap, imap);
  assert.deepEqual(r.record.smtp, smtp);
  }
});

test('saveMailbox: fixing keeps the id and created time, clears needs-attention, and drops the old connection', async () => {
  const { svc } = setup();
  const prior = { ...box('sales-shop-com', 'sales@shop.com'), status: 'needs-attention', statusReason: 'bad password', createdAt: 42 };
  const a = admin({ mailboxes: [prior] });
  let closed;
  const orig = svc.close.bind(svc);
  svc.close = (id) => { closed = id; orig(id); };
  const r = await saveMailbox(svc, a, PROVIDER_PRESETS, { id: 'sales-shop-com', provider: 'gmail', address: 'sales@shop.com', password: 'new' });
  assert.equal(r.ok, true);
  assert.equal(r.record.id, 'sales-shop-com');
  assert.equal(r.record.createdAt, 42);
  assert.equal(r.record.status, 'connected');
  assert.equal(r.record.statusReason, undefined);
  assert.equal(a.state.cfg.mailboxes.length, 1, 'replaced, not added');
  assert.equal(closed, 'sales-shop-com');
});

test('saveMailbox: when the password cannot be stored, the mailbox is not saved', async () => {
  const { svc } = setup();
  const a = admin();
  a.state.setSecretFails = true;
  const r = await saveMailbox(svc, a, PROVIDER_PRESETS, { provider: 'gmail', address: 'sales@shop.com', password: 'p' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /store the password/);
  assert.doesNotMatch(r.reason, /plaintext|refusing/, 'the owner never reads the raw error');
  assert.deepEqual(a.state.cfg.mailboxes, []);
});

test('saveMailbox: a damaged secrets file keeps its own words, not the keychain message (PR 136)', async () => {
  // Value: protects=the owner is told what is actually wrong; fails_when=every store failure blames the keychain; why_new=the keychain message covered all failures; seam=fake secret store
  const { SECRETS_FILE_UNREADABLE } = loadTs('src/shared/secretStore.ts');
  const { svc } = setup();
  const a = admin();
  a.canStoreSecrets = () => true;
  a.state.setSecretFails = SECRETS_FILE_UNREADABLE;
  const r = await saveMailbox(svc, a, PROVIDER_PRESETS, { provider: 'gmail', address: 'sales@shop.com', password: 'p' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, SECRETS_FILE_UNREADABLE);
  assert.doesNotMatch(r.reason, /keychain|keyring/);
  assert.deepEqual(a.state.cfg.mailboxes, []);
});

test('saveMailbox: when this computer cannot encrypt, it says so before any login and saves nothing', async () => {
  const { svc, state } = setup();
  const a = admin();
  a.canStoreSecrets = () => false;
  const r = await saveMailbox(svc, a, PROVIDER_PRESETS, { provider: 'gmail', address: 'sales@shop.com', password: 'p' });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'unsupported');
  assert.equal(r.reason, cannotStoreReason());
  assert.equal(state.connects, undefined, 'nothing tried to log in');
  assert.deepEqual(a.state.secrets, {});
  assert.deepEqual(a.state.cfg.mailboxes, []);
});

test('cannotStoreReason says what to do on each platform, in plain words', () => {
  assert.match(cannotStoreReason('darwin'), /keychain/);
  assert.match(cannotStoreReason('linux'), /keyring/);
  assert.match(cannotStoreReason('win32'), /Restart the computer/);
  for (const p of ['darwin', 'linux', 'win32']) {
    const reason = cannotStoreReason(p);
    assert.match(reason, /nothing was saved/);
    assert.match(reason, /try again/);
    assert.doesNotMatch(reason, /[-‐-―−]/, `no dashes: ${reason}`);
  }
});

test('removeMailbox takes the mailbox, its password and every grant to it, and names who lost it', () => {
  const { svc } = setup();
  const a = admin({
    mailboxes: [box('sales', 's@x.com'), box('ceo', 'c@x.com')],
    agentCapabilities: {
      dwight: { email: { enabled: true, mailboxes: ['sales'], send: true } },
      pam: { email: { enabled: true, mailboxes: ['ceo'], send: false } },
      kelly: {}
    }
  });
  const r = removeMailbox(svc, a, 'sales');
  assert.deepEqual(r, { ok: true, affected: ['dwight'] });
  assert.deepEqual(a.state.cfg.mailboxes.map((m) => m.id), ['ceo']);
  assert.deepEqual(a.state.cfg.agentCapabilities.dwight.email.mailboxes, []);
  assert.deepEqual(a.state.cfg.agentCapabilities.pam.email.mailboxes, ['ceo'], 'others untouched');
  assert.deepEqual(a.state.deleted, ['mail:sales']);
});

test('removeMailbox logs when the saved password could not be removed, and still removes the mailbox (issue 133)', () => {
  // Value: protects=a mailbox removal never passes silently while its password is still on disk; fails_when=removeMailbox ignores deleteSecret's answer; why_new=the removal path reported nothing; seam=console.error captured
  const { svc } = setup();
  const removeWith = (secretGone) => {
    const a = admin({ mailboxes: [box('sales', 's@x.com')] });
    a.deleteSecret = (ref) => { a.state.deleted.push(ref); return secretGone; };
    const logged = [];
    const real = console.error;
    console.error = (...args) => { logged.push(args.join(' ')); };
    let r;
    try { r = removeMailbox(svc, a, 'sales'); } finally { console.error = real; }
    return { r, logged, a };
  };
  const gone = removeWith(true);
  assert.deepEqual(gone.r, { ok: true, affected: [] });
  assert.deepEqual(gone.logged, [], 'removed: nothing logged');
  const kept = removeWith(false);
  assert.deepEqual(kept.r, { ok: true, affected: [] }, 'the mailbox still goes');
  assert.deepEqual(kept.a.state.cfg.mailboxes, []);
  assert.deepEqual(kept.a.state.deleted, ['mail:sales']);
  assert.equal(kept.logged.length, 1);
  assert.match(kept.logged[0], /^\[mail\] .*saved password could not be: sales$/);
});

test('setAgentCapabilities: unknown mailboxes are dropped; restart only on first enable', () => {
  const a = admin({ mailboxes: [box('sales', 's@x.com')] });
  const first = setAgentCapabilities(a, 'dwight', { email: { enabled: true, mailboxes: ['ghost'], send: 1 } });
  assert.equal(first.restartNeeded, true);
  // Only a real true counts: the renderer is not trusted with the shape.
  assert.deepEqual(a.state.cfg.agentCapabilities.dwight.email, { enabled: true, mailboxes: [], send: false, sending: 'draft' });
  const again = setAgentCapabilities(a, 'dwight', { email: { enabled: true, mailboxes: ['sales'], send: false } });
  assert.equal(again.restartNeeded, false, 'already on');
  const off = setAgentCapabilities(a, 'dwight', {});
  assert.equal(off.restartNeeded, false);
  assert.equal(a.state.cfg.agentCapabilities.dwight.email, undefined);
});

test('setAgentCapabilities: one agent per mailbox; a move needs confirming and turns the holder off', () => {
  const a = admin({
    mailboxes: [box('sales', 's@x.com'), box('ceo', 'c@x.com')],
    agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['sales'], send: true } } }
  });
  const refused = setAgentCapabilities(a, 'erin', { email: { enabled: true, mailboxes: ['sales'], send: false } });
  assert.deepEqual(refused, { ok: false, restartNeeded: false, heldBy: 'pam' });
  assert.equal(a.state.cfg.agentCapabilities.erin, undefined, 'nothing saved');
  // A free mailbox, or email on with none picked, is fine.
  assert.equal(setAgentCapabilities(a, 'erin', { email: { enabled: true, mailboxes: [], send: false } }).ok, true);
  assert.equal(setAgentCapabilities(a, 'erin', { email: { enabled: true, mailboxes: ['ceo'], send: false } }).ok, true);
  // Pam keeping her own mailbox is not a clash with herself.
  assert.equal(setAgentCapabilities(a, 'pam', { email: { enabled: true, mailboxes: ['sales'], send: false } }).ok, true);
  const moved = setAgentCapabilities(a, 'erin', { email: { enabled: true, mailboxes: ['sales'], send: false }, move: true });
  assert.equal(moved.ok, true);
  assert.equal(moved.movedFrom, 'pam');
  assert.deepEqual(a.state.cfg.agentCapabilities.pam.email, { enabled: false, mailboxes: [], send: false, sending: 'draft' });
  assert.deepEqual(a.state.cfg.agentCapabilities.erin.email.mailboxes, ['sales']);
});

test('closeAll logs out every open connection', async () => {
  const { svc, call, state } = setup();
  await call('dwight', 'search', { mailbox: 'sales' });
  await call('pam', 'search', { mailbox: 'ceo' });
  assert.equal(state.connects, 2);
  await call('dwight', 'search', { mailbox: 'sales' });
  assert.equal(state.connects, 2, 'the open connection is reused');
  svc.closeAll();
  await new Promise((r) => setImmediate(r));
  assert.equal(state.logouts, 2);
});

// ── Pre-landing review fixes (ship, 2026-09-26) ─────────────────────────────

test('setAgentCapabilities: a malformed payload saves no mailbox instead of throwing', () => {
  const a = admin({ mailboxes: [box('sales', 's@x.com')] });
  assert.doesNotThrow(() => setAgentCapabilities(a, 'dwight', { email: { enabled: true, mailboxes: 'sales', send: true } }));
  assert.deepEqual(a.state.cfg.agentCapabilities.dwight.email, { enabled: true, mailboxes: [], send: true, sending: 'send' });
  setAgentCapabilities(a, 'pam', { email: { enabled: 'yes', mailboxes: [7, 'sales'], send: 'true' } });
  assert.deepEqual(a.state.cfg.agentCapabilities.pam.email, { enabled: false, mailboxes: ['sales'], send: false, sending: 'draft' });
});

test('saveMailbox: a made up id cannot add a second record for a connected address', async () => {
  const { svc } = setup();
  const a = admin({ mailboxes: [box('sales-shop-com', 'sales@shop.com')] });
  const r = await saveMailbox(svc, a, PROVIDER_PRESETS, { id: 'not-a-real-id', provider: 'gmail', address: 'Sales@Shop.com', password: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /already connected/);
  assert.equal(a.state.cfg.mailboxes.length, 1);
});

test('saveMailbox: fixing writes the new password under the same mailbox', async () => {
  const { svc } = setup();
  const a = admin({ mailboxes: [box('sales-shop-com', 'sales@shop.com')] });
  const r = await saveMailbox(svc, a, PROVIDER_PRESETS, { id: 'sales-shop-com', provider: 'gmail', address: 'sales@shop.com', password: 'new' });
  assert.equal(r.ok, true);
  assert.equal(a.state.secrets['mail:sales-shop-com'], 'new');
  assert.equal(Object.keys(a.state.secrets).length, 1);
});

test('removeMailbox: an older record listing two mailboxes never falls through to the second', () => {
  const a = admin({ mailboxes: [box('a', 'a@x.com'), box('b', 'b@x.com')], agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['a', 'b'], send: false } }, kelly: { email: { enabled: true, mailboxes: ['b', 'a'], send: false } } } });
  const r = removeMailbox(new MailService({ getConfig: () => a.state.cfg, getPassword: () => 'x', markStatus() {} }), a, 'a');
  assert.deepEqual(a.state.cfg.agentCapabilities.pam.email.mailboxes, [], 'pam never saw b as granted');
  assert.deepEqual(a.state.cfg.agentCapabilities.kelly.email.mailboxes, ['b'], 'kelly keeps the one she uses');
  assert.deepEqual(r.affected, ['pam'], 'only an agent actually using a loses it');
});

test('a working mailbox writes its status once, not on every call', async () => {
  const { call, state } = setup();
  await call('dwight', 'search', { mailbox: 'sales' });
  await call('dwight', 'search', { mailbox: 'sales' });
  await call('dwight', 'read', { mailbox: 'sales', id: '1' });
  assert.equal(state.statuses.filter((s) => s.id === 'sales' && s.status === 'connected').length, 1);
});
