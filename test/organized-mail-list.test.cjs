'use strict';

/**
 * Pulse's emails organized list (owner, 2026-10-21: "how to see which emails
 * were organized?"): each email a member archived, marked read or moved to
 * junk is kept with its sender and subject in the owner's private folder, and
 * the tile opens the period's list, everyone's or one member's.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const O = loadTs('src/shared/organizedRecord.ts');
const C = loadTs('src/shared/checkedRecord.ts');
const { MailService, handleMailRequest } = loadTs('src/main/mail.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const GMAIL = [{ path: 'INBOX' }, { path: '[Gmail]/All Mail', specialUse: '\\All' }, { path: '[Gmail]/Spam', specialUse: '\\Junk' }];
const OTHER = [{ path: 'INBOX' }, { path: 'Archive', specialUse: '\\Archive' }, { path: 'Junk', specialUse: '\\Junk' }];
const ENVELOPES = {
  11: { from: [{ name: 'Northwind Cafe', address: 'orders@northwind.example' }], subject: 'Invoice 4411' },
  12: { from: [{ address: 'promo@shop.example' }], subject: 'Big sale' }
};

function mailSetup(folders, { fetch = true } = {}) {
  const state = { moved: [], flags: [], audit: [], organized: [] };
  const imap = {
    usable: true, async connect() {}, async logout() {},
    async list() { return folders; }, async getMailboxLock() { return { release() {} }; },
    async search() { return [11, 12]; },
    async messageFlagsAdd(uids, flags) { state.flags.push({ uids, flags }); },
    async messageMove(uids, to) { state.moved.push({ uids, to }); },
    async mailboxCreate() {},
    ...(fetch ? { async *fetch(uids) { for (const uid of uids) yield { uid, envelope: ENVELOPES[uid] }; } } : {})
  };
  const server = { host: 'h', port: 993, secure: true };
  const config = {
    mailboxes: [{ id: 'ceo', address: 'ceo@example.com', provider: 'gmail', imap: server, smtp: server, status: 'connected', createdAt: 1, updatedAt: 1 }],
    agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['ceo'], send: false } } }
  };
  const deps = { getConfig: () => config, getPassword: () => 'x', markStatus() {}, createImap: () => imap, audit: (e) => state.audit.push(e), organized: (m) => state.organized.push(m) };
  const svc = new MailService(deps);
  return { state, call: (op, body) => handleMailRequest(svc, deps, 'pam', op, { mailbox: 'ceo', ...body }) };
}

test('each moved email reaches the private list with its sender and subject; the agent\'s answer and the office log stay as they were', async () => {
  // Value: protects=the owner can see which emails were organized, and where each went; fails_when=the hook gets no words, gets a message that was not moved, or the agent's answer grows; why_new=new list; seam=fake IMAP
  const { state, call } = mailSetup(GMAIL);
  const res = await call('archive', { ids: ['11', '99'], label: 'Finance' });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['done', 'label', 'missing'], 'the agent hears what it heard before');
  assert.deepEqual(state.audit, [{ kind: 'mail-organize', agentId: 'pam', mailbox: 'ceo', action: 'archive', ids: ['11'], label: 'Finance' }], 'the log keeps numbers only');
  assert.deepEqual(state.organized, [{
    agentId: 'pam', mailbox: 'ceo', action: 'archive', folder: 'Finance',
    messages: [{ id: '11', from: 'Northwind Cafe <orders@northwind.example>', subject: 'Invoice 4411' }]
  }]);
  await call('archive', { ids: ['12'] });
  assert.equal(state.organized[1].folder, null, 'Gmail archive with no label goes to All Mail: no folder to name');
  await call('mark_junk', { ids: ['12'] });
  assert.deepEqual([state.organized[2].action, state.organized[2].folder, state.organized[2].messages[0].from], ['mark_junk', null, 'promo@shop.example']);
});

test('elsewhere the archive folder is named; mark read is listed too; a mailbox that cannot say still moves the mail', async () => {
  // Value: protects=the list says where mail went on any server, and reading the words never stops a move; fails_when=the destination is dropped, mark read is left out, or a failed fetch fails the call; why_new=new list; seam=fake IMAP
  const other = mailSetup(OTHER);
  await other.call('archive', { ids: ['11'] });
  await other.call('mark_read', { ids: ['12'] });
  assert.deepEqual(other.state.organized.map((m) => [m.action, m.folder, m.messages[0].subject]), [['archive', 'Archive', 'Invoice 4411'], ['mark_read', null, 'Big sale']]);
  const blind = mailSetup(OTHER, { fetch: false });
  const res = await blind.call('archive', { ids: ['11'] });
  assert.equal(res.status, 200);
  assert.deepEqual(blind.state.moved, [{ uids: [11], to: 'Archive' }], 'the move happened');
  assert.deepEqual(blind.state.organized[0].messages, [{ id: '11', from: '', subject: '' }], 'listed without words');
});

async function office(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-organized-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  return { hive, home };
}
const rows = (home) => fs.readFileSync(path.join(home, 'private', O.ORGANIZED_FILE), 'utf8').split('\n').map(O.parseOrganized).filter(Boolean);

test('the hive keeps one row per email in the private folder, never in the office log', async (t) => {
  // Value: protects=senders and subjects stay in the owner's private folder; fails_when=a row lands in log.jsonl, the name is lost, or a long subject is kept whole; why_new=new record; seam=temporary office folder
  const { hive, home } = await office(t);
  hive.recordOrganized({ agentId: 'pam', mailbox: 'ceo', action: 'archive', folder: 'Receipts', messages: [
    { from: 'Northwind Cafe <orders@northwind.example>', subject: 'Invoice\n4411' },
    { from: '', subject: 'x'.repeat(500) }
  ] });
  const got = rows(home);
  assert.equal(got.length, 2);
  assert.deepEqual({ ...got[0], at: 0 }, { at: 0, agentId: 'pam', agentName: 'Pam', mailbox: 'ceo', action: 'archive', folder: 'Receipts', subject: 'Invoice 4411', from: 'Northwind Cafe <orders@northwind.example>' });
  assert.equal(got[1].subject.length, O.ORGANIZED_TEXT_MAX);
  assert.doesNotMatch(fs.readFileSync(path.join(hive.root(), 'log.jsonl'), 'utf8'), /Invoice|Northwind/);
});

test('after 62 days a row moves to its month in the archive; nothing is dropped', async (t) => {
  // Value: protects=62 days live plus a monthly archive the app never deletes (owner, 2026-10-21); fails_when=old rows are deleted or recent ones archived; why_new=new record; seam=clock argument and a seeded file
  const now = Date.UTC(2026, 9, 21);
  const row = (at, subject) => JSON.stringify({ at, agentId: 'pam', agentName: 'Pam', mailbox: 'ceo', action: 'archive', folder: null, subject, from: '' });
  const old = row(now - 63 * 86_400_000, 'old');
  const fresh = row(now - 61 * 86_400_000, 'new');
  const { keep, archive } = C.splitForArchive([old, fresh, 'not a row', ''], now, O.parseOrganized);
  assert.deepEqual(keep, [fresh, 'not a row']);
  assert.deepEqual([...archive.entries()], [['2026-08', [old]]]);
  const { hive, home } = await office(t);
  fs.mkdirSync(path.join(home, 'private'), { recursive: true });
  fs.writeFileSync(path.join(home, 'private', O.ORGANIZED_FILE), `${row(Date.now() - 70 * 86_400_000, 'old')}\n`);
  hive.recordOrganized({ agentId: 'pam', mailbox: 'ceo', action: 'mark_read', folder: null, messages: [{ from: 'a@b.example', subject: 'today' }] });
  assert.deepEqual(rows(home).map((r) => r.subject), ['today']);
  const dir = path.join(home, 'private', O.ORGANIZED_ARCHIVE_DIR);
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(fs.readFileSync(path.join(dir, files[0]), 'utf8'), /"old"/);
});

test('a reset erases the list and its archive, and a home move takes both', () => {
  // Value: protects=a reset leaves no senders or subjects behind, and a moved office keeps its list; fails_when=either file is missing from a hard list; why_new=new files; seam=source pins
  const { PRIVATE_ENTRIES } = loadTs('src/main/factoryReset.ts');
  for (const n of [O.ORGANIZED_FILE, O.ORGANIZED_ARCHIVE_DIR]) assert.ok(PRIVATE_ENTRIES.includes(n), n);
  assert.match(read('src/main/homeFolder.ts'), /'organized\.jsonl', 'organized-archive'\]/);
});

test('the list reads its span, everyone\'s or one member\'s, newest first', async () => {
  // Value: protects=the period and member the owner clicked are the ones listed; fails_when=another member's or another period's mail shows, or a failed read looks empty; why_new=new reader; seam=readOrganized dep
  const { PulseService } = loadTs('src/main/pulse.ts');
  const row = (at, agentId) => JSON.stringify({ at, agentId, agentName: null, mailbox: 'ceo', action: 'archive', folder: null, subject: String(at), from: '' });
  const text = [row(100, 'pam'), row(200, 'nick'), row(300, 'pam'), row(500, 'pam'), 'junk'].join('\n');
  const svc = Object.create(PulseService.prototype);
  svc.d = { readOrganized: async () => text };
  assert.deepEqual((await svc.organized(150, 400)).rows.map((r) => r.at), [300, 200]);
  const pam = await svc.organized(150, 400, 'pam');
  assert.deepEqual(pam.rows.map((r) => r.at), [300]);
  assert.equal(pam.since, 100);
  svc.d = { readOrganized: () => Promise.reject(new Error('EACCES')) };
  await assert.rejects(() => svc.organized(0, 1), 'a read that fails reaches the list as an error');
});

test('the tile opens the list, a name opens that member\'s, and every string is in three languages', () => {
  // Value: protects=the owner reaches the emails from the tile they asked about; fails_when=a hop drops (IPC, preload, tile, legend) or a string is missing or has a dash; why_new=new list; seam=source pins, the view needs React
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('pulse:organized', \(_evt, fromMs: unknown, toMs: unknown, agentId: unknown\) =>/);
  assert.match(main, /organized: \(moved\) => hive\.recordOrganized\(moved\)/);
  assert.match(read('src/preload/index.ts'), /pulseOrganized: \(fromMs: number, toMs: number, agentId\?: string\): Promise<OrganizedList> => ipcRenderer\.invoke\('pulse:organized', fromMs, toMs, agentId\)/);
  const view = read('src/renderer/src/components/pulse/PulseView.tsx');
  assert.match(view, /o\.kind === 'email' && o\.total > 0 && <button type="button" onClick=\{\(\) => setOrganizedOpen\(\{ agentId: null \}\)\}/);
  assert.match(view, /onPick: \(id: string\) => setOrganizedOpen\(\{ agentId: id \}\)/);
  assert.match(view, /window\.cth\.pulseOrganized\(fromMs, toMs, agentId \?\? undefined\)/);
  const keys = ['open', 'openOne', 'title', 'titleOne', 'noSubject', 'archived', 'archivedTo', 'markedRead', 'movedToJunk', 'byWho', 'none', 'earlier'];
  for (const l of ['en', 'ar', 'zh-CN']) {
    const o = JSON.parse(read(`src/renderer/src/i18n/locales/${l}.json`)).pulse.organized;
    for (const k of keys) {
      assert.ok(typeof o[k] === 'string' && o[k].length > 0, `${l} ${k}`);
      assert.doesNotMatch(o[k], /[–—]| - /, `${l} ${k} has no dash`);
    }
    assert.match(o.archivedTo, /\{\{folder\}\}/, l);
  }
});
