'use strict';

// Reading a big email downloads its body text, never the attachments (TODOS:
// "Read one email without downloading its attachments"). Runs against a real
// IMAP server (hoodiecrow) and the real ImapFlow client.

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const hoodiecrow = require('hoodiecrow-imap');
const { ImapFlow } = require('imapflow');
const MailComposer = require('nodemailer/lib/mail-composer');

const { MailService } = loadTs('src/main/mail.ts');

const USER = 'sales@shop.test';
const PASS = 'app-pass-123';
const big = Buffer.alloc(3 * 1024 * 1024, 'x');
const pdf = { filename: 'spec sheet.pdf', content: big, contentType: 'application/pdf' };

const build = (opts) => new MailComposer({ from: 'acme@buyer.test', to: USER, date: new Date('2026-09-25T10:00:00Z'), ...opts }).compile().build();

// Hand-written multipart/mixed, for shapes MailComposer doesn't make.
const mixed = (subject, parts) => Buffer.from([
  'From: acme@buyer.test', `To: ${USER}`, `Subject: ${subject}`, 'Date: Fri, 25 Sep 2026 10:00:00 +0000',
  'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', '',
  ...parts.flatMap((p) => ['--b', ...p.headers, '', p.body]), '--b--', ''
].join('\r\n'));
const textPart = (body, ...headers) => ({ headers: ['Content-Type: text/plain; charset=utf-8', ...headers], body });
const filePart = (type, disposition, name) => ({
  headers: [`Content-Type: ${type}; name="${name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: ${disposition}; filename="${name}"`],
  body: big.toString('base64').replace(/.{76}(?!$)/g, '$&\r\n')
});

// Built once, so every server holds the same bytes.
const built = Promise.all([
  build({ subject: 'Quote with the spec', messageId: '<a1@x.test>', text: 'Quote for 40 units attached.\nDelivery in two weeks.', html: '<p>Quote for 40 units attached.</p>', attachments: [pdf] }),
  mixed('=?ISO-8859-1?Q?Men=FC?=', [
    { headers: ['Content-Type: text/html; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable'], body: '<p>Caf=E9 &amp; cr=E8me br=FBl=E9e</p>' },
    filePart('application/pdf', 'attachment', 'menu.pdf')
  ]),
  build({ subject: 'Long one', text: 'y'.repeat(60_000), attachments: [pdf] }),
  mixed('Photo', [textPart('Hi, the photo is below.'), filePart('image/png', 'inline', 'photo.png'), textPart('Thanks, Acme')]),
  mixed('Notes', [textPart('See the notes.'), textPart('n'.repeat(2000), 'Content-Disposition: attachment; filename="notes.txt"'), filePart('application/pdf', 'attachment', 'spec.pdf')]),
  build({ subject: 'Small', text: 'Just a note.\nSee you.' }),
  build({ subject: 'Unsent', text: 'Not yet' })
]);

async function setup(t, { download = true, refuseParts = false } = {}) {
  const messages = await built;
  const imap = hoodiecrow({
    plugins: ['SPECIAL-USE', 'ID', 'UNSELECT', 'ENABLE', 'LITERALPLUS'],
    users: { [USER]: { password: PASS } },
    storage: { INBOX: { messages: messages.map((m, i) => ({ raw: m.toString('binary'), flags: i === 6 ? ['\\Draft'] : [] })) } }
  });
  const port = await new Promise((resolve) => { imap.listen(0, '127.0.0.1', function () { resolve(this.address().port); }); });
  t.after(() => imap.close());
  const seen = { sources: 0, parts: [] };
  const config = { mailboxes: [{ id: 'sales', address: USER, provider: 'other', imap: { host: '127.0.0.1', port, secure: false }, smtp: { host: '127.0.0.1', port: 1, secure: false }, status: 'connected', createdAt: 1, updatedAt: 1 }] };
  const svc = new MailService({
    getConfig: () => config,
    getPassword: () => PASS,
    markStatus() {},
    createImap: (s, user, pass) => {
      const c = new ImapFlow({ host: s.host, port: s.port, secure: false, doSTARTTLS: false, auth: { user, pass }, logger: false });
      const fetchOne = c.fetchOne.bind(c);
      c.fetchOne = (seq, query, opts) => { if (query.source) seen.sources++; return fetchOne(seq, query, opts); };
      const dl = c.download.bind(c);
      c.download = !download ? undefined : async (range, part, opts) => {
        seen.parts.push(part);
        if (refuseParts) throw Object.assign(new Error('Command failed'), { responseText: 'Part not available' });
        return dl(range, part, opts);
      };
      return c;
    }
  });
  t.after(() => svc.closeAll());
  return { svc, seen };
}

test('an email with a 3 MB attachment is read from its text part alone', async (t) => {
  const { svc, seen } = await setup(t);
  const r = await svc.read('sales', '1');
  assert.equal(r.text, 'Quote for 40 units attached.\nDelivery in two weeks.');
  assert.deepEqual([r.subject, r.messageId, r.from, r.truncated], ['Quote with the spec', '<a1@x.test>', 'acme@buyer.test', false]);
  assert.deepEqual(r.attachments, [{ name: 'spec sheet.pdf', size: big.length }], 'its real size, from the structure');
  assert.equal(seen.sources, 0, 'the whole message was never fetched');
  assert.deepEqual(seen.parts, ['1.1'], 'only the plain text part was downloaded');
});

test('text on both sides of an inline image is all read, in order', async (t) => {
  const { svc, seen } = await setup(t);
  const r = await svc.read('sales', '4');
  assert.equal(r.text, 'Hi, the photo is below.\nThanks, Acme');
  assert.deepEqual(r.attachments, [{ name: 'photo.png', size: big.length }]);
  assert.deepEqual(seen.parts, ['1', '3']);
});

test('a text file sent as an attachment is listed, not read', async (t) => {
  const { svc, seen } = await setup(t);
  const r = await svc.read('sales', '5');
  assert.equal(r.text, 'See the notes.');
  assert.deepEqual(r.attachments.map((a) => a.name), ['notes.txt', 'spec.pdf']);
  assert.deepEqual(seen.parts, ['1']);
});

test('an HTML-only Latin-1 email reads as text, and its subject is decoded', async (t) => {
  const { svc } = await setup(t);
  const r = await svc.read('sales', '2');
  assert.match(r.text, /Café & crème brûlée/);
  assert.doesNotMatch(r.text, /<p>|&amp;/);
  assert.equal(r.subject, 'Menü');
  assert.deepEqual(r.attachments, [{ name: 'menu.pdf', size: big.length }]);
});

test('a long text is still cut at 50,000 characters', async (t) => {
  const { svc } = await setup(t);
  const r = await svc.read('sales', '3');
  assert.equal(r.truncated, true);
  assert.match(r.text, /^y{50000}\n\n\[message cut at 50000 characters\]$/);
});

test('a small email is read whole, as before, and drafts and missing ids are refused', async (t) => {
  const { svc, seen } = await setup(t);
  const r = await svc.read('sales', '6');
  assert.equal(r.text, 'Just a note.\nSee you.\n');
  assert.equal(seen.sources, 1);
  assert.deepEqual(seen.parts, []);
  await assert.rejects(svc.read('sales', '7'), /unsent draft/);
  await assert.rejects(svc.read('sales', '99'), /No message with id 99 in the inbox/);
});

test('a server that won\'t send a part gets the whole message read instead', async (t) => {
  const { svc, seen } = await setup(t, { refuseParts: true });
  const r = await svc.read('sales', '1');
  assert.equal(r.text, 'Quote for 40 units attached.\nDelivery in two weeks.');
  assert.deepEqual(seen.parts, ['1.1']);
  assert.equal(seen.sources, 1);
});

test('reading by parts gives the same answer as reading the whole message', async (t) => {
  const fast = await setup(t);
  const whole = await setup(t, { download: false });
  for (const id of ['1', '3', '4', '5']) {
    assert.deepEqual(await fast.svc.read('sales', id), await whole.svc.read('sales', id), `message ${id}`);
  }
  // HTML with no plain twin: a whole read only strips its tags.
  const a = await fast.svc.read('sales', '2');
  const b = await whole.svc.read('sales', '2');
  assert.equal(b.text, ' Café &amp; crème brûlée ');
  assert.deepEqual({ ...a, text: '' }, { ...b, text: '' });
  assert.equal(fast.seen.sources, 0);
  assert.equal(whole.seen.sources, 5);
});
