'use strict';

// mail-proposals.json is kept in memory and read again only when the file
// changes on disk (TODOS: "Keep the approvals file in memory").

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { MailApprovals } = loadTs('src/main/mailApprovals.ts');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md approvals cache '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'mail-proposals.json');
  const changed = [];
  const approvals = new MailApprovals({
    path: file,
    send: () => true,
    remember: () => {},
    toast: () => {},
    agentName: (id) => id,
    godId: () => 'god',
    changed: () => changed.push(Date.now()),
    now: () => 1_000_000
  });
  return { approvals, file, changed };
}

/** How many times `fn` reads `file`. */
function readsOf(file, fn) {
  const real = fs.readFileSync;
  let n = 0;
  fs.readFileSync = (p, ...rest) => { if (p === file) n++; return real(p, ...rest); };
  try { fn(); } finally { fs.readFileSync = real; }
  return n;
}

const email = { agentId: 'pam', mailbox: 'ceo', to: 'a@b.com', subject: 'Hi', body: 'Hello' };

test('the file is read once and then served from memory until it changes', (t) => {
  const { approvals, file } = setup(t);
  const p = approvals.file(email);
  assert.equal(readsOf(file, () => {
    for (let i = 0; i < 5; i++) approvals.waiting();
    approvals.get(p.id);
    approvals.standing('pam');
  }), 0, 'our own save left it in memory');

  // Someone else changes the file: it is read again, once.
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  onDisk.proposals[0].subject = 'Changed elsewhere, and longer';
  fs.writeFileSync(file, JSON.stringify(onDisk, null, 2));
  let subject;
  assert.equal(readsOf(file, () => { subject = approvals.get(p.id).subject; approvals.waiting(); }), 1);
  assert.equal(subject, 'Changed elsewhere, and longer');
});

test('a file that became unreadable is still never saved over', (t) => {
  const { approvals, file } = setup(t);
  approvals.file(email);
  fs.writeFileSync(file, '{"proposals": [');
  assert.throws(() => approvals.file({ ...email, subject: 'Another' }), /could not be read/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"proposals": [', 'left as it was');
  assert.deepEqual(approvals.waiting(), [], 'reads still answer, as before');
});

test('the screens are told about proposals and sends, not about pause bookkeeping', (t) => {
  const { approvals, changed } = setup(t);
  approvals.file(email);
  assert.equal(changed.length, 1, 'a new proposal');
  approvals.recordSend({ agentId: 'pam', mailbox: 'ceo', messageId: '<m1@x.com>', references: [], to: 'a@b.com', subject: 'Hi', sentAt: 1 });
  assert.equal(changed.length, 2, 'a send record: the Access tab lists recent sends');
  approvals.pausedDue(['pam:ceo']);
  assert.equal(changed.length, 2, 'a paused grant noted: nothing on screen changes');
});
