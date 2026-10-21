'use strict';

/**
 * Send only from a mailbox another member owns (docs/designs/shared-mailboxes.md,
 * owner 2026-10-06). The mailbox keeps one owner, who reads it; a Send only
 * member may list, draft, propose and send from it under its own Sending
 * choice, and never read, search, organize, forward or attach from it. Replies
 * thread only on its own sends; nothing is fetched from the mailbox for it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { mailAccess, mailboxAddress, sendOnlyGrant, sendingFor, grantPaused, hasMailTools, mailToolsJustAttached, sendersFrom } = loadTs('src/shared/mailboxes.ts');
const { OWN_SENDS_ONLY, addSendRecord, SEND_RECORDS_KEPT, proposalSendProblem } = loadTs('src/shared/mailProposals.ts');
const { MailService, handleMailRequest, setAgentCapabilities, setSendOnly, removeMailbox } = loadTs('src/main/mail.ts');
const { MailApprovals, PAUSE_NOTICE_MS } = loadTs('src/main/mailApprovals.ts');
const { agentAccessSummary, accessLine } = loadTs('src/shared/agentAccess.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const server = { host: 'h', port: 993, secure: true };
const box = (id, address) => ({ id, address, provider: 'gmail', imap: server, smtp: server, status: 'connected', createdAt: 1, updatedAt: 1 });
const raw = (subject, id) => Buffer.from(`From: a@b.com\r\nTo: ceo@x.com\r\nSubject: ${subject}\r\nMessage-ID: <${id}@x.com>\r\nDate: Fri, 25 Sep 2026 10:00:00 +0000\r\n\r\nbody ${id}\r\n`);

/** Pam owns ceo@; Dwight owns sales@ and sends only from ceo@. */
function office(grantSending = 'send', over = {}) {
  return {
    mailboxes: [box('ceo', 'ceo@x.com'), box('sales', 'sales@x.com')],
    agentCapabilities: {
      pam: { email: { enabled: true, mailboxes: ['ceo'], send: false, sending: 'approval' } },
      dwight: { email: { enabled: true, mailboxes: ['sales'], send: true, sending: 'send' }, sendOnly: { mailbox: 'ceo', sending: grantSending } },
      ...(over.caps ?? {})
    }
  };
}

function fakeImap(state) {
  let folder = 'INBOX';
  return {
    usable: true,
    async connect() { state.connects = (state.connects ?? 0) + 1; },
    async logout() {},
    close() {},
    async list() { return [{ path: 'INBOX' }, { path: 'Drafts', specialUse: '\\Drafts' }, { path: 'Sent', specialUse: '\\Sent' }]; },
    async getMailboxLock(p) { folder = p; return { release() {} }; },
    async search() { return state.folders[folder].map((m) => m.uid); },
    async *fetch() {},
    async fetchOne(uid) { state.fetched = [...(state.fetched ?? []), String(uid)]; const m = state.folders[folder].find((x) => String(x.uid) === String(uid)); return m ? { source: m.source } : false; },
    async append(p, content) { state.folders[p].push({ uid: 100 + state.folders[p].length, source: content }); }
  };
}

/** A real MailService on a fake server, real approvals, a mutable config. */
function setup(t, cfg = office(), opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-grants-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = { folders: { INBOX: [{ uid: 2, source: raw('From the prospect', 'm2') }], Drafts: [], Sent: [] }, sends: [] };
  const out = { messages: [], memory: [], audit: [] };
  let clock = opts.now ?? 1_000_000;
  const present = opts.present ?? (() => true);
  const approvals = new MailApprovals({
    path: path.join(dir, 'mail-proposals.json'),
    send: (m) => out.messages.push(m),
    remember: (id, line) => out.memory.push([id, line]),
    toast: () => {},
    agentName: (id) => id,
    godId: () => 'god',
    changed: () => {},
    canSend: (agentId, mailbox, pid) => mailAccess(cfg, agentId, mailbox, 'send', pid, { present }).ok,
    now: () => clock
  });
  const deps = {
    getConfig: () => cfg,
    getPassword: () => 'app-pass',
    markStatus() {},
    createImap: () => fakeImap(state),
    createSmtp: () => ({ async sendMail(m) { state.sends.push(m); return { messageId: m.messageId }; }, async verify() {}, close() {} })
  };
  const svc = new MailService(deps);
  const brokerDeps = { getConfig: () => cfg, proposals: approvals, present, audit: (e) => out.audit.push(e), fitCheck: async () => ({ fits: true }) };
  const call = (agent, op, body) => handleMailRequest(svc, brokerDeps, agent, op, body);
  const admin = {
    getConfig: () => cfg,
    saveConfig: (patch) => Object.assign(cfg, patch),
    setSecret: () => ({ ok: true }),
    deleteSecret() {},
    endGrant: (a, m, r) => approvals.endGrant(a, m, r),
    cancelFor: (a, m, r) => approvals.cancel({ agentId: a, mailbox: m }, r),
    sendingChanged: (a, m, addr, s, hb) => approvals.sendingChanged(a, m, addr, s, hb),
    present
  };
  return { cfg, state, out, approvals, call, admin, svc, dir, tick: (ms) => { clock += ms; } };
}

test('the access table: a Send only member lists, drafts and sends, and never reads or organizes', () => {
  // Value: protects=a grantee never reads the owner's mailbox; fails_when=the grant branch lets a read op through or comes after the email gate; why_new=mail-edges covers owners only; seam=none
  const cfg = office('send');
  for (const op of ['list', 'draft', 'send']) assert.equal(mailAccess(cfg, 'dwight', 'ceo', op).ok, true, op);
  assert.match(mailAccess(cfg, 'dwight', 'ceo', 'propose').reason, /You can send from ceo@x\.com without approval/);
  for (const op of ['read', 'organize']) {
    const r = mailAccess(cfg, 'dwight', 'ceo', op);
    assert.equal(r.ok, false, op);
    assert.match(r.reason, /You send only from ceo@x\.com: you can't read, search or organize it/);
  }
  for (const refs of [{ forward: true }, { attachFrom: true }]) {
    const r = mailAccess(cfg, 'dwight', 'ceo', 'send', undefined, { refs });
    assert.equal(r.ok, false);
    assert.match(r.reason, /can't forward or attach mail from it/);
  }
  // Its own mailbox keeps its own rule, and the owner is untouched.
  assert.equal(mailAccess(cfg, 'dwight', 'sales', 'read').ok, true);
  assert.equal(mailAccess(cfg, 'pam', 'ceo', 'read').ok, true);

  // The grant's own Sending: Draft only and Send on approval.
  const draft = office('draft');
  assert.equal(mailAccess(draft, 'dwight', 'ceo', 'draft').ok, true);
  assert.match(mailAccess(draft, 'dwight', 'ceo', 'send').reason, /You are Draft only from ceo@x\.com/);
  assert.equal(mailAccess(draft, 'dwight', 'ceo', 'propose').ok, false);
  const approval = office('approval');
  assert.match(mailAccess(approval, 'dwight', 'ceo', 'send').reason, /You send on approval from ceo@x\.com/);
  assert.equal(mailAccess(approval, 'dwight', 'ceo', 'send', 'mp_1').ok, true);

  // With email off, the grant still works, and list is allowed.
  const off = office('send');
  off.agentCapabilities.dwight.email = { enabled: false, mailboxes: [], send: false, sending: 'draft' };
  assert.equal(mailAccess(off, 'dwight', 'ceo', 'send').ok, true);
  assert.equal(mailAccess(off, 'dwight', undefined, 'list').ok, true);
  assert.equal(mailAccess(off, 'dwight', 'sales', 'read').ok, false, 'its own mailbox is off');
  // A grant on its own mailbox or on a removed one is no grant.
  const own = office('send');
  own.agentCapabilities.dwight.sendOnly = { mailbox: 'sales', sending: 'send' };
  assert.equal(sendOnlyGrant(own, 'dwight'), undefined);
  const gone = office('send');
  gone.mailboxes = gone.mailboxes.filter((m) => m.id !== 'ceo');
  assert.equal(sendOnlyGrant(gone, 'dwight'), undefined);
});

test('a grant pauses while nobody on the team reads the mailbox, and resumes with an owner', () => {
  // Value: protects=no outreach goes out with nobody to read the replies (D10); fails_when=the pause ignores the owner's email or team presence; why_new=new rule; seam=none
  const cfg = office('send');
  assert.equal(grantPaused(cfg, 'ceo'), false);
  const away = (id) => id !== 'pam';
  const r = mailAccess(cfg, 'dwight', 'ceo', 'send', undefined, { present: away });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Nobody reads ceo@x.com right now, so its replies would go unanswered; tell Michael.');
  assert.equal(mailAccess(cfg, 'dwight', 'ceo', 'draft', undefined, { present: away }).ok, false, 'drafts wait too');
  assert.equal(mailAccess(cfg, 'dwight', 'ceo', 'list', undefined, { present: away }).ok, true, 'it can still see why');
  cfg.agentCapabilities.pam.email.enabled = false;
  assert.equal(grantPaused(cfg, 'ceo'), true, 'the owner turned email off');
  cfg.agentCapabilities.kelly = { email: { enabled: true, mailboxes: ['ceo'], send: false } };
  assert.equal(mailAccess(cfg, 'dwight', 'ceo', 'send').ok, true, 'a new owner resumes it');
});

test('main counts roster agents and restorable members as on the team; the terminal flag is not used', () => {
  // Value: protects=a grant does not pause at every launch, when members sit in restorable until respawn (EV1); fails_when=presence reads the hive registry archived flag or roster agents alone; why_new=no presence check existed; seam=source pin
  const main = read('src/main/index.ts');
  const fn = main.slice(main.indexOf('function memberPresent('), main.indexOf('function standingGoalFromRoster('));
  assert.match(fn, /return has\(snap\.agents\) \|\| has\(snap\.restorable\);/);
  assert.match(fn, /if \(!snap\) return true;/, 'no roster: the config alone decides');
  assert.doesNotMatch(fn, /registry\(\)/, 'the registry keeps deleted members and its archived flag means no live terminal');
  // The Access tab asks before moving a mailbox from a restorable owner.
  const tab = read('src/renderer/src/components/CapabilitiesTab.tsx');
  assert.match(tab, /useStore\.getState\(\)\.restorableAgents\.some\(\(a\) => a\.id === id\)\n    \|\| useStore\.getState\(\)\.archivedAgents/);
});

test('the hook refuses reads and forwards for a Send only member, and a paused grant, before the broker', async (t) => {
  // Value: protects=the hook and the broker apply one rule; fails_when=the hook drops the references or the team check; why_new=mail-folders pins the wiring only; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-grant-hook-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  for (const id of ['pam', 'dwight']) await hive.ensureAgent({ id, name: id, provider: 'claude', cwd: home });
  let pamHere = true;
  const cfg = office('send');
  const hook = new HookServer(hive, () => null, () => ({ harnessHome: home, ...cfg }), undefined, undefined, undefined, undefined, undefined, undefined, undefined, (id) => id !== 'pam' || pamHere);
  const call = (tool, input) => hook.handle({ agent_id: 'dwight', session_id: 's1', hook_event_name: 'PreToolUse', tool_name: `mcp__md-mail__${tool}`, tool_input: input, cwd: home });
  const denied = (r) => r?.hookSpecificOutput?.permissionDecision === 'deny';
  assert.ok(denied(await call('search', { mailbox: 'ceo' })));
  assert.ok(denied(await call('archive', { mailbox: 'ceo', ids: [1] })));
  assert.ok(denied(await call('send', { mailbox: 'ceo', to: 'a@b.com', subject: 's', body: 'b', forward: { mailbox: 'ceo', id: '2' } })));
  assert.ok(denied(await call('draft', { mailbox: 'ceo', to: 'a@b.com', subject: 's', body: 'b', attach_from: [{ mailbox: 'ceo', id: '2' }] })));
  assert.ok(!denied(await call('send', { mailbox: 'ceo', to: 'a@b.com', subject: 's', body: 'b' })));
  pamHere = false;
  const paused = await call('send', { mailbox: 'ceo', to: 'a@b.com', subject: 's', body: 'b' });
  assert.ok(denied(paused));
  assert.match(paused.hookSpecificOutput.permissionDecisionReason, /Nobody reads ceo@x\.com right now/);
});

test('a send under a grant is recorded, and a reply to it threads from the record with nothing fetched', async (t) => {
  // Value: protects=follow ups thread without the grantee reading the mailbox (E1b); fails_when=compose fetches for a grant, the record is not kept, or the thread is lost; why_new=compose always fetched; seam=none
  const { call, state, approvals, out } = setup(t);
  const first = await call('dwight', 'send', { mailbox: 'ceo', to: 'lead@client.com', subject: 'Intro', body: 'Hello' });
  assert.equal(first.status, 200);
  const id = first.body.messageId;
  assert.deepEqual(approvals.recentSends('dwight', 'ceo').map((r) => [r.messageId, r.to, r.subject]), [[id, 'lead@client.com', 'Intro']]);
  // The office log has ids only (D14).
  const logged = out.audit.find((e) => e.kind === 'mail-sent');
  assert.deepEqual(logged, { kind: 'mail-sent', agentId: 'dwight', mailbox: 'ceo', messageId: id, grant: true });

  const reply = await call('dwight', 'send', { mailbox: 'ceo', to: 'lead@client.com', subject: 'Re: Intro', body: 'Following up', reply_to: { mailbox: 'ceo', id } });
  assert.equal(reply.status, 200);
  const sent = state.sends[1];
  assert.equal(sent.inReplyTo, id);
  assert.deepEqual(sent.references, [id]);
  assert.equal(state.fetched, undefined, 'nothing was read from the mailbox');
  // A third reply carries the whole chain.
  await call('dwight', 'send', { mailbox: 'ceo', to: 'lead@client.com', subject: 'Re: Intro', body: 'Once more', reply_to: { mailbox: 'ceo', id: reply.body.messageId } });
  assert.deepEqual(state.sends[2].references, [id, reply.body.messageId]);

  // Any other id: one refusal, before any lookup, whether or not it exists.
  for (const other of ['2', '<nope@x.com>', 'sent:5']) {
    const r = await call('dwight', 'send', { mailbox: 'ceo', to: 'a@b.com', subject: 'x', body: 'y', reply_to: { mailbox: 'ceo', id: other } });
    assert.equal(r.status, 403, other);
    assert.equal(r.body.error, OWN_SENDS_ONLY);
  }
  assert.equal(state.fetched, undefined);
  assert.equal(state.sends.length, 3);
});

test('two follow ups with the same words in different threads both go out', async (t) => {
  // Value: protects=send once never folds two threads into one (EV6); fails_when=the send once key leaves out the thread; why_new=the key knew replyTo only; seam=none
  const { call, state } = setup(t);
  const a = (await call('dwight', 'send', { mailbox: 'ceo', to: 'x@client.com', subject: 'Intro', body: 'A' })).body.messageId;
  const b = (await call('dwight', 'send', { mailbox: 'ceo', to: 'x@client.com', subject: 'Intro', body: 'B' })).body.messageId;
  const same = { mailbox: 'ceo', to: 'x@client.com', subject: 'Re: Intro', body: 'Checking in' };
  const r1 = await call('dwight', 'send', { ...same, reply_to: { mailbox: 'ceo', id: a } });
  const r2 = await call('dwight', 'send', { ...same, reply_to: { mailbox: 'ceo', id: b } });
  assert.notEqual(r1.body.repeated, true);
  assert.notEqual(r2.body.repeated, true);
  assert.equal(state.sends.length, 4);
});

test('list_mailboxes shows the grant with its own sending, standing approvals and recent sends', async (t) => {
  // Value: protects=a grantee knows what it may do and how to reply in a thread (OV4, OV7); fails_when=the grant is missing or a grant only member is told a sending it does not have; why_new=list knew one mailbox; seam=none
  const cfg = office('approval');
  cfg.agentCapabilities.dwight.email = { enabled: false, mailboxes: [], send: false, sending: 'draft' };
  let pamHere = true;
  const { call, approvals } = setup(t, cfg, { present: (id) => id !== 'pam' || pamHere });
  approvals.recordSend({ agentId: 'dwight', mailbox: 'ceo', messageId: '<s1@x.com>', references: [], to: 'lead@client.com', subject: 'Intro', sentAt: 5 });
  const r = await call('dwight', 'list_mailboxes', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.sending, undefined, 'no own mailbox: no top level sending');
  assert.equal(r.body.how, undefined);
  assert.equal(r.body.mailboxes.length, 1);
  const g = r.body.mailboxes[0];
  assert.equal(g.access, 'send only');
  assert.equal(g.address, 'ceo@x.com');
  assert.equal(g.sending, 'send on approval');
  assert.match(g.how, /You send only from this mailbox/);
  assert.match(g.how, /propose puts the email on Ask me/);
  assert.deepEqual(g.your_recent_sends.map((x) => x.message_id), ['<s1@x.com>']);
  assert.equal(g.paused, undefined);
  pamHere = false;
  assert.match((await call('dwight', 'list_mailboxes', {})).body.mailboxes[0].paused, /Nobody reads ceo@x\.com/);
  // Its own mailbox, when it has one, comes first with the top level sending.
  const both = setup(t);
  const b = await both.call('dwight', 'list_mailboxes', {});
  assert.deepEqual(b.body.mailboxes.map((m) => m.mailbox), ['sales', 'ceo']);
  assert.equal(b.body.sending, 'can send');
  // Value: protects=a Can send member is told propose is refused where it learns how it sends (owner, 2026-10-09); fails_when=the Can send how or the propose tool text goes back to inviting a proposal, so the member proposes and is refused every time; why_new=only the refusal itself was tested; seam=none
  for (const how of [b.body.how, b.body.mailboxes[1].how]) {
    assert.match(how, /propose is refused: nothing goes on Ask me/);
    assert.doesNotMatch(how, /may still propose/);
  }
  assert.match(read('resources/md-mail-mcp.cjs'), /name: 'propose',\n\s+description: 'Put an email on Ask me for the owner to approve \(Send on approval only; Can send and Draft only refuse it\)\./);
});

test('send on approval under a grant: the thread is kept on the card and the approved email threads', async (t) => {
  // Value: protects=an approved follow up threads and is recorded; fails_when=the proposal loses the thread or the approved send fetches; why_new=proposals stored only replyTo; seam=none
  const { call, state, approvals, out } = setup(t, office('approval'));
  approvals.recordSend({ agentId: 'dwight', mailbox: 'ceo', messageId: '<s1@x.com>', references: ['<r0@x.com>'], to: 'lead@client.com', subject: 'Intro', sentAt: 5 });
  const p = await call('dwight', 'propose', { mailbox: 'ceo', to: 'lead@client.com', subject: 'Re: Intro', body: 'Following up', reply_to: { mailbox: 'ceo', id: '<s1@x.com>' } });
  assert.equal(p.status, 200);
  const stored = approvals.get(p.body.proposal);
  assert.equal(stored.replyTo, undefined);
  assert.deepEqual(stored.thread, { inReplyTo: '<s1@x.com>', references: ['<r0@x.com>', '<s1@x.com>'] });
  approvals.decide(p.body.proposal, 'approve', {}, '');
  const sent = await call('dwight', 'send', { mailbox: 'ceo', proposal: p.body.proposal });
  assert.equal(sent.status, 200);
  assert.equal(state.sends[0].inReplyTo, '<s1@x.com>');
  assert.equal(state.fetched, undefined);
  assert.equal(approvals.recentSends('dwight', 'ceo')[0].messageId, sent.body.messageId);
  assert.equal(out.audit.find((e) => e.kind === 'mail-sent-approved').grant, true);
});

test('an owner approved reply still threads through the fetch (regression)', async (t) => {
  // Value: protects=the owner's own Send on approval replies keep their thread after the approved send path changed; fails_when=the stored reference rules drop replyTo for an owner; why_new=reply_to was tested only on direct send and draft; seam=none
  const { call, state, approvals } = setup(t);
  const p = await call('pam', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 'Re: From the prospect', body: 'Thanks', reply_to: { mailbox: 'ceo', id: '2' } });
  approvals.decide(p.body.proposal, 'approve', {}, '');
  const sent = await call('pam', 'send', { mailbox: 'ceo', proposal: p.body.proposal });
  assert.equal(sent.status, 200);
  assert.equal(state.sends[0].inReplyTo, '<m2@x.com>');
});

test('a proposal can never forward or attach mail from another mailbox, at propose or at send (D1)', async (t) => {
  // Value: protects=an approved card never forwards an unrelated email; fails_when=the same mailbox check stays draft and send only, or the stored card is not checked; why_new=mail-edges covers same mailbox forwards only; seam=none
  const { call, state, approvals } = setup(t);
  const r = await call('pam', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 's', body: 'b', forward: { mailbox: 'sales', id: '2' } });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /You can't forward, attach or reply to mail from "sales" while writing from "ceo"\./);
  // Draft and send keep their refusal text (regression).
  for (const [agent, op, from, other] of [['pam', 'draft', 'ceo', 'sales'], ['dwight', 'send', 'sales', 'ceo']]) {
    const d = await call(agent, op, { mailbox: from, to: 'a@b.com', subject: 's', body: 'b', attach_from: [{ mailbox: other, id: '2' }] });
    assert.equal(d.status, 403, op);
    assert.equal(d.body.error, `You can't forward, attach or reply to mail from "${other}" while writing from "${from}".`);
  }
  // A card filed before the fix: refused at send, and withdrawn so the sweep never nags.
  const old = approvals.file({ agentId: 'pam', mailbox: 'ceo', to: 'a@b.com', subject: 'old', body: 'b', forward: { mailbox: 'sales', id: '2' } });
  approvals.decide(old.id, 'approve', {}, '');
  const s = await call('pam', 'send', { mailbox: 'ceo', proposal: old.id });
  assert.equal(s.status, 403);
  assert.match(s.body.error, /The email was withdrawn/);
  assert.equal(approvals.get(old.id).state, 'cancelled');
  assert.equal(state.sends.length, 0);
  assert.equal(state.fetched, undefined);
});

test('a cancelled email can never be sent, and only an approved one goes (allowlist)', () => {
  // Value: protects=the agent's unapproved text never leaves (EV2); fails_when=a new state falls through to null; why_new=the check refused named states only; seam=none
  const p = { id: 'mp_1', agentId: 'dwight', mailbox: 'ceo', to: 'a', subject: 's', body: 'b', createdAt: 1 };
  assert.match(proposalSendProblem({ ...p, state: 'cancelled', cancelReason: 'the grant ended' }, 'dwight', 'ceo'), /withdrawn: the grant ended/);
  assert.notEqual(proposalSendProblem({ ...p, state: 'approved' }, 'dwight', 'ceo'), null, 'approved needs the approved text');
  assert.equal(proposalSendProblem({ ...p, state: 'approved', approved: { subject: 's', body: 'b' } }, 'dwight', 'ceo'), null);
  assert.equal(proposalSendProblem({ ...p, state: 'sent' }, 'dwight', 'ceo'), null);
  assert.notEqual(proposalSendProblem({ ...p, state: 'something new' }, 'dwight', 'ceo'), null);
});

test('send records survive every other write to the approvals file', async (t) => {
  // Value: protects=threading data and pause notices are not wiped (EV3, OV9); fails_when=save keeps only proposals and standing; why_new=save wrote two lists; seam=none
  const { approvals, dir } = setup(t);
  approvals.recordSend({ agentId: 'dwight', mailbox: 'ceo', messageId: '<s1@x.com>', references: [], to: 'a', subject: 's', sentAt: 1 });
  approvals.pausedDue(['dwight\u0000ceo']);
  const p = approvals.file({ agentId: 'pam', mailbox: 'ceo', to: 'a@b.com', subject: 'x', body: 'y' });
  approvals.decide(p.id, 'approve', {}, '', 'Thank you notes');
  approvals.markSent(p.id, '<z@x.com>');
  approvals.sweep();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'mail-proposals.json'), 'utf8'));
  assert.equal(saved.sends.length, 1);
  assert.ok(saved.paused['dwight\u0000ceo']);
  assert.equal(saved.standing.length, 1);
  // One record per Message-ID, and the newest per member are kept.
  let list = [];
  for (let i = 0; i < SEND_RECORDS_KEPT + 5; i++) list = addSendRecord(list, { agentId: 'd', mailbox: 'ceo', messageId: `<${i}>`, references: [], to: 'a', subject: 's', sentAt: i });
  list = addSendRecord(list, { agentId: 'd', mailbox: 'ceo', messageId: `<${SEND_RECORDS_KEPT + 4}>`, references: [], to: 'a', subject: 's', sentAt: 1e9 });
  assert.equal(list.length, SEND_RECORDS_KEPT);
  assert.equal(list[0].messageId, '<5>');
});

test('a damaged approvals file is not replaced with a new empty store', (t) => {
  const { approvals, dir } = setup(t);
  const file = path.join(dir, 'mail-proposals.json');
  const damaged = '{"proposals": [';
  fs.writeFileSync(file, damaged, 'utf8');

  assert.throws(
    () => approvals.file({ agentId: 'pam', mailbox: 'ceo', to: 'a@b.com', subject: 'x', body: 'y' }),
    /saved mail approvals file could not be read/i
  );
  assert.equal(fs.readFileSync(file, 'utf8'), damaged, 'left exactly as it was');
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'no replacement temp file is left behind');
});

test('list_mailboxes ignores malformed saved send records instead of crashing', async (t) => {
  // Value: protects=a damaged send record cannot break every mail tool for its member; fails_when=coerceStore accepts a non-date sentAt or malformed thread fields; why_new=list_mailboxes formats sentAt with toISOString; seam=none
  const { call, dir } = setup(t);
  fs.writeFileSync(path.join(dir, 'mail-proposals.json'), JSON.stringify({
    proposals: [],
    standing: [],
    paused: {},
    sends: [
      { agentId: 'dwight', mailbox: 'ceo', messageId: '<good@x.com>', references: [], to: 'lead@client.com', subject: 'Intro', sentAt: 1_000 },
      { agentId: 'dwight', mailbox: 'ceo', messageId: '<bad-date@x.com>', references: [], to: 'lead@client.com', subject: 'Intro', sentAt: 'yesterday' },
      { agentId: 'dwight', mailbox: 'ceo', messageId: '<out-of-range-date@x.com>', references: [], to: 'lead@client.com', subject: 'Intro', sentAt: 1e20 },
      { agentId: 'dwight', mailbox: 'ceo', messageId: '<bad-thread@x.com>', references: '<good@x.com>', to: 'lead@client.com', subject: 'Re: Intro', sentAt: 2_000 }
    ]
  }), 'utf8');

  const listed = await call('dwight', 'list_mailboxes', {});
  assert.equal(listed.status, 200);
  const grant = listed.body.mailboxes.find((m) => m.mailbox === 'ceo');
  assert.deepEqual(grant.your_recent_sends, [{
    message_id: '<good@x.com>',
    to: 'lead@client.com',
    subject: 'Intro',
    sent_at: new Date(1_000).toISOString()
  }]);
});

test('ending a grant withdraws its emails and revokes its standing approvals in one message; Draft only withdraws', async (t) => {
  // Value: protects=no dead errands and no silently revived trust (D13, OV6); fails_when=cancel or revoke is skipped, or one message per rule; why_new=no grant lifecycle existed; seam=none
  const { call, approvals, admin, out, cfg } = setup(t, office('approval'));
  const waiting = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 'One', body: 'b' })).body.proposal;
  const p2 = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'c@d.com', subject: 'Two', body: 'b', offer_standing: 'Intro emails' })).body.proposal;
  approvals.decide(p2, 'approve', {}, '', 'Intro emails');
  const p3 = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'e@f.com', subject: 'Three', body: 'b', offer_standing: 'Meeting notes' })).body.proposal;
  approvals.decide(p3, 'approve', {}, '', 'Meeting notes');
  out.messages.length = 0;
  out.memory.length = 0;

  assert.deepEqual(setSendOnly(admin, 'dwight', null), { ok: true, restartNeeded: false });
  assert.equal(cfg.agentCapabilities.dwight.sendOnly, undefined);
  for (const id of [waiting, p2, p3]) assert.equal(approvals.get(id).state, 'cancelled', id);
  assert.equal(approvals.waiting().length, 0, 'the cards leave Ask me');
  assert.equal(approvals.standing('dwight').filter((r) => !r.revokedAt).length, 0);
  const told = out.messages.filter((m) => m.to === 'dwight');
  assert.equal(told.length, 2, 'one message for the emails, one for the standing approvals');
  assert.match(told[0].subject, /3 emails withdrawn/);
  assert.match(told[1].body, /"Intro emails", "Meeting notes"/);
  assert.equal(out.memory.length, 2, 'a memory note per revoked approval');
  const sent = await call('dwight', 'send', { mailbox: 'ceo', proposal: p2 });
  assert.equal(sent.status, 403, 'no grant now');

  // Draft only withdraws waiting emails but keeps the grant.
  cfg.agentCapabilities.dwight.sendOnly = { mailbox: 'ceo', sending: 'approval' };
  const w = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'g@h.com', subject: 'Four', body: 'b' })).body.proposal;
  assert.equal(setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'draft' }).ok, true);
  assert.equal(approvals.get(w).state, 'cancelled');
  assert.match(approvals.get(w).cancelReason, /Draft only from ceo@x\.com/);
});

test('a paused grant holds its approved email: the late sweep skips it and it goes after resume', async (t) => {
  // Value: protects=Michael is never sent on a dead errand, and nothing the owner approved is lost to a pause (EV1, OV6); fails_when=the sweep ignores canSend or a pause cancels; why_new=sweep asked about every late email; seam=none
  let pamHere = true;
  const { call, approvals, out, tick } = setup(t, office('approval'), { present: (id) => id !== 'pam' || pamHere });
  const p = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 'Hold me', body: 'b' })).body.proposal;
  approvals.decide(p, 'approve', {}, '');
  pamHere = false;
  tick(2 * 60 * 60 * 1000);
  approvals.sweep();
  assert.equal(out.messages.filter((m) => m.to === 'god').length, 0);
  assert.equal(approvals.get(p).state, 'approved', 'held, not cancelled');
  assert.equal((await call('dwight', 'send', { mailbox: 'ceo', proposal: p })).status, 403);
  pamHere = true;
  assert.equal((await call('dwight', 'send', { mailbox: 'ceo', proposal: p })).status, 200);
});

test('Michael hears of a pause once, after five minutes, across a restart; a resume forgets it', (t) => {
  // Value: protects=one notice per pause and none at launch (D10, EV1); fails_when=the notice repeats, fires at once, or is lost on restart; why_new=new; seam=none
  const { approvals, dir, tick } = setup(t);
  const key = 'dwight\u0000ceo';
  assert.deepEqual(approvals.pausedDue([key]), []);
  tick(PAUSE_NOTICE_MS - 1);
  assert.deepEqual(approvals.pausedDue([key]), []);
  tick(1);
  assert.deepEqual(approvals.pausedDue([key]), [key]);
  const again = new MailApprovals({ path: path.join(dir, 'mail-proposals.json'), send() {}, remember() {}, toast() {}, agentName: (x) => x, godId: () => 'god', changed() {}, now: () => 1_000_000 + PAUSE_NOTICE_MS * 3 });
  assert.deepEqual(again.pausedDue([key]), [], 'told once, even after a restart');
  assert.deepEqual(again.pausedDue([]), [], 'resumed');
  assert.deepEqual(again.pausedDue([key]), [], 'a new pause starts its wait again');
  const main = read('src/main/index.ts');
  assert.match(main, /try \{ noticePausedGrants\(\); \} catch/);
  assert.match(main, /if \(!g \|\| !memberPresent\(agentId\)\) continue;/, 'a grant of someone off the team is nobody\'s news');
});

test('a damaged saved pause notice starts its wait again, and Michael still hears once', (t) => {
  // Value: protects=a hand edited or damaged pause entry cannot silence the notice forever or set it off at once (D10, EV1); fails_when=coerceStore keeps an entry whose since is not a past finite number or whose told is not a boolean; why_new=paused entries were cast without a check; seam=none
  const key = 'dwight\u0000ceo';
  const start = 1_000_000;
  const damaged = {
    'since is text': { since: 'yesterday', told: false },
    'since is missing': { told: false },
    'since is null': { since: null, told: false },
    'since is far in the future': { since: 9e15, told: false },
    'told is text': { since: start - PAUSE_NOTICE_MS, told: 'false' },
    'told is missing': { since: start - PAUSE_NOTICE_MS },
    'entry is a boolean': true,
    'entry is text': 'paused',
    'entry is null': null,
    'entry is a list': [start, false]
  };
  for (const [name, entry] of Object.entries(damaged)) {
    const { approvals, dir, tick } = setup(t, office(), { now: start });
    const file = path.join(dir, 'mail-proposals.json');
    fs.writeFileSync(file, JSON.stringify({ proposals: [], standing: [], sends: [], paused: { [key]: entry } }), 'utf8');
    assert.deepEqual(approvals.pausedDue([key]), [], `${name}: nothing at once`);
    tick(PAUSE_NOTICE_MS - 1);
    assert.deepEqual(approvals.pausedDue([key]), [], `${name}: not before the wait is over`);
    tick(1);
    assert.deepEqual(approvals.pausedDue([key]), [key], `${name}: told after exactly PAUSE_NOTICE_MS`);
    assert.deepEqual(approvals.pausedDue([key]), [], `${name}: told once`);
    tick(PAUSE_NOTICE_MS);
    assert.deepEqual(approvals.pausedDue([key]), [], `${name}: still once`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).paused[key], { since: start, told: true }, `${name}: the file is repaired`);
  }
});

test('a saved pause notice whose time reads as infinite starts its wait again', (t) => {
  // Value: protects=a time that JSON text turns into Infinity (1e999) cannot fire the notice at once or silence it forever (D10, EV1); fails_when=coerceStore stops requiring a finite since; why_new=JSON.stringify writes Infinity as null, so only raw JSON text reaches this; seam=none
  const key = 'dwight\u0000ceo';
  const start = 1_000_000;
  // Written as raw text: JSON.parse reads these as Infinity and -Infinity.
  const raws = { 'since is 1e999': '1e999', 'since is -1e999': '-1e999' };
  for (const [name, literal] of Object.entries(raws)) {
    const { approvals, dir, tick } = setup(t, office(), { now: start });
    fs.writeFileSync(path.join(dir, 'mail-proposals.json'), `{"proposals":[],"standing":[],"sends":[],"paused":{${JSON.stringify(key)}:{"since":${literal},"told":false}}}`, 'utf8');
    assert.deepEqual(approvals.pausedDue([key]), [], `${name}: nothing at once`);
    tick(PAUSE_NOTICE_MS - 1);
    assert.deepEqual(approvals.pausedDue([key]), [], `${name}: not before the wait is over`);
    tick(1);
    assert.deepEqual(approvals.pausedDue([key]), [key], `${name}: told after exactly PAUSE_NOTICE_MS`);
    assert.deepEqual(approvals.pausedDue([key]), [], `${name}: told once`);
  }
});

test('a damaged pause notice does not disturb the good ones beside it', (t) => {
  // Value: protects=only the damaged entry is dropped (D10); fails_when=coerceStore drops or rewrites a valid entry; why_new=paused entries were cast without a check; seam=none
  const { approvals, dir } = setup(t, office(), { now: 1_000_000 });
  const told = 'dwight\u0000ceo';
  const waiting = 'pam\u0000ceo';
  const damaged = 'kelly\u0000ceo';
  fs.writeFileSync(path.join(dir, 'mail-proposals.json'), JSON.stringify({
    proposals: [], standing: [], sends: [],
    paused: {
      [told]: { since: 1, told: true },
      [waiting]: { since: 1_000_000 - PAUSE_NOTICE_MS, told: false },
      [damaged]: { since: 'yesterday', told: false }
    }
  }), 'utf8');
  assert.deepEqual(approvals.pausedDue([told, waiting, damaged]), [waiting], 'the told one stays quiet, the due one is told, the damaged one waits');
  assert.deepEqual(approvals.pausedDue([told, waiting, damaged]), [], 'nothing repeats');
});

test('setters: a grant survives email off and moves, owning the mailbox replaces it, and removing the mailbox ends it', (t) => {
  // Value: protects=the grant is its own field (OV2) with the plan's lifecycle (3b); fails_when=an email write erases it, or a removed mailbox leaves a grant; why_new=new field; seam=none
  const { admin, cfg, approvals } = setup(t);
  // Validation: unknown or own mailbox is refused; Sending defaults to Draft only.
  assert.equal(setSendOnly(admin, 'dwight', { mailbox: 'nope' }).ok, false);
  assert.equal(setSendOnly(admin, 'dwight', { mailbox: 'sales' }).ok, false, 'its own mailbox');
  assert.equal(setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'weird' }).ok, true);
  assert.deepEqual(cfg.agentCapabilities.dwight.sendOnly, { mailbox: 'ceo', sending: 'draft' });
  // Email off keeps it, and turning on the mail tools for a grant alone needs a restart.
  setAgentCapabilities(admin, 'dwight', { email: { enabled: false, mailboxes: [], send: false } });
  assert.deepEqual(cfg.agentCapabilities.dwight.sendOnly, { mailbox: 'ceo', sending: 'draft' });
  assert.equal(hasMailTools(cfg.agentCapabilities.dwight), true);
  assert.equal(mailToolsJustAttached({ email: { enabled: false, mailboxes: [], send: false } }, { sendOnly: { mailbox: 'ceo', sending: 'draft' } }), true);
  assert.equal(mailToolsJustAttached({ sendOnly: { mailbox: 'ceo', sending: 'draft' } }, { email: { enabled: true, mailboxes: ['sales'], send: false } }), false, 'already attached');
  cfg.agentCapabilities.oscar = {};
  assert.equal(setSendOnly(admin, 'oscar', { mailbox: 'ceo', sending: 'send' }).restartNeeded, true);
  // Moving ceo@ from Pam to Kelly keeps Dwight's grant and Pam's own.
  cfg.agentCapabilities.pam.sendOnly = { mailbox: 'sales', sending: 'draft' };
  cfg.agentCapabilities.kelly = {};
  const moved = setAgentCapabilities(admin, 'kelly', { email: { enabled: true, mailboxes: ['ceo'], send: false }, move: true });
  assert.equal(moved.movedFrom, 'pam');
  assert.deepEqual(cfg.agentCapabilities.pam.sendOnly, { mailbox: 'sales', sending: 'draft' }, 'the old holder keeps its own grant');
  assert.deepEqual(cfg.agentCapabilities.dwight.sendOnly, { mailbox: 'ceo', sending: 'draft' });
  assert.deepEqual(sendersFrom(cfg.agentCapabilities, 'ceo').map((x) => x.agentId).sort(), ['dwight', 'oscar']);
  // Owning the mailbox it sent only from replaces the grant, without ending it.
  const p = approvals.file({ agentId: 'oscar', mailbox: 'ceo', to: 'a', subject: 's', body: 'b' });
  setAgentCapabilities(admin, 'oscar', { email: { enabled: true, mailboxes: ['ceo'], send: false }, move: true });
  assert.equal(cfg.agentCapabilities.oscar.sendOnly, undefined);
  assert.equal(approvals.get(p.id).state, 'waiting', 'its emails stay: they are keyed by agent and mailbox');
  // Removing ceo@ in Settings drops Dwight's grant and ends it.
  const res = removeMailbox({ close() {} }, admin, 'ceo');
  assert.ok(res.affected.includes('dwight'));
  assert.equal(cfg.agentCapabilities.dwight.sendOnly, undefined);
});

test('Michael\'s roster and the profile name the grant, and say when it is paused', () => {
  // Value: protects=Michael routes outreach to the member who may send as an address (S2); fails_when=the roster leaves out the grant or its pause; why_new=accessLine knew one mailbox; seam=none
  const cfg = office('approval');
  const line = accessLine(agentAccessSummary(cfg, 'dwight', false));
  assert.match(line, /mailbox sales@x\.com \(connected in Settings, Connections, Mailboxes; can send, set on their Access tab, Email, Sending\)/);
  assert.match(line, /sends only from ceo@x\.com \(Settings, Connections, Mailboxes; send on approval, set on their Access tab, Email\)/);
  const paused = accessLine(agentAccessSummary(cfg, 'dwight', false, (id) => id !== 'pam'));
  assert.match(paused, /sends only from ceo@x\.com \([^)]*; paused: nobody reads it now\)/);
  assert.doesNotMatch(paused, /[–—]/);
  const profile = read('src/renderer/src/components/ProfileTab.tsx');
  assert.match(profile, /i\.kind === 'send-only' \? t\('capabilities\.sendOnlyUse'/);
});

test('screens: Add a mailbox greys what it can\'t do, the owner side and Settings list senders, the card names forwards', () => {
  // Value: protects=the owner sees and controls who sends as each address (E3, D2); fails_when=a line or key is missing; why_new=new UI; seam=source pin
  const tab = read('src/renderer/src/components/CapabilitiesTab.tsx');
  // Add a mailbox lists every address the member doesn't use yet, and greys a choice it can't make, with the reason.
  assert.match(tab, /const addable = mailboxes\.filter\(\(m\) => m\.id !== current && m\.id !== sendFrom\?\.mailbox\);/);
  assert.match(tab, /desc: !canWatch \? t\('capabilities\.addWatchTaken'/);
  assert.match(tab, /desc: !canSendOnly \? t\('capabilities\.addSendOnlyTaken'/);
  assert.match(tab, /window\.cth\.mailSetSendOnly\(agent\.id, next\)/);
  assert.match(tab, /t\('capabilities\.sendOnlyPaused', \{ name \}\)/);
  assert.match(tab, /<StandingApprovals agentId=\{agent\.id\} mailbox=\{sendFrom\.mailbox\} \/>/);
  assert.match(tab, /t\('capabilities\.alsoSendsFromHere'/);
  assert.match(read('src/renderer/src/components/MailboxesSettings.tsx'), /t\('capabilities\.alsoSendsFromHere', \{ names: list\(senders\) \}\)/);
  const card = read('src/renderer/src/components/MailProposalCards.tsx');
  assert.match(card, /\{p\.forward && <div>\{t\('askMe\.mailForwards'\)\}<\/div>\}/);
  assert.match(card, /t\('askMe\.mailAttaches', \{ count: p\.attachFrom!\.length \}\)/);
  assert.match(read('src/main/index.ts'), /const line = `sends only from \$\{address\}: \$\{sendingWords\(grant\.sending\)\}`;/, 'the focus check knows the grant');
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const l = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    for (const k of ['sendOnlyPaused', 'alsoSendsFromHere', 'sendOnlyUse', 'inboxSendOnly', 'inboxNobody', 'addSendOnly']) {
      assert.ok(l.capabilities[k], `${loc} capabilities.${k}`);
      assert.doesNotMatch(l.capabilities[k], /[–—]| - /, `${loc} ${k} has no dash`);
    }
    for (const k of ['mailForwards', 'mailAttaches']) assert.ok(l.askMe[k], `${loc} askMe.${k}`);
  }
  const mcp = read('resources/md-mail-mcp.cjs');
  assert.match(mcp, /any mailbox you send only from \(at most one, marked "send only"/);
  assert.match(mcp, /the message_id of one of your own sends there \(your_recent_sends in list_mailboxes\)/);
});

test('moving a grant to another mailbox ends the old one; a card from before the grant that replies in the mailbox is withdrawn at send', async (t) => {
  // Value: protects=trust given on one address never carries to another (D13), and an approved card never reads the mailbox a member now sends only from (OV5); fails_when=setSendOnly ends the grant only on removal, a Sending change that is not Draft only withdraws cards, or the stored reference rule skips grants; why_new=only removal and Draft only were tested, and only the foreign mailbox stored rule; seam=none
  const cfg = office('approval');
  cfg.mailboxes.push(box('support', 'support@x.com'));
  cfg.agentCapabilities.kelly = { email: { enabled: true, mailboxes: ['support'], send: false, sending: 'draft' } };
  const { call, approvals, admin, out, state } = setup(t, cfg);
  const p = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 'One', body: 'b', offer_standing: 'Intro emails' })).body.proposal;
  approvals.decide(p, 'approve', {}, '', 'Intro emails');
  const keep = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'c@d.com', subject: 'Two', body: 'b' })).body.proposal;

  // Send on approval to Can send on the same mailbox: the approved card and
  // the standing approval stay; the waiting one is handed back.
  assert.equal(setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'send' }).ok, true);
  assert.equal(approvals.get(p).state, 'approved');
  assert.equal(approvals.get(keep).state, 'cancelled');
  assert.equal(approvals.standing('dwight').length, 1);
  const keep2 = approvals.file({ agentId: 'dwight', mailbox: 'ceo', to: 'c@d.com', subject: 'Two', body: 'b' }).id;

  out.messages.length = 0;
  assert.equal(setSendOnly(admin, 'dwight', { mailbox: 'support', sending: 'approval' }).ok, true);
  assert.deepEqual(cfg.agentCapabilities.dwight.sendOnly, { mailbox: 'support', sending: 'approval' });
  assert.equal(approvals.get(p).state, 'cancelled');
  assert.equal(approvals.get(keep2).state, 'cancelled');
  assert.match(approvals.get(keep2).cancelReason, /removed your Send only access to ceo@x\.com/);
  assert.equal(approvals.standing('dwight').length, 0, 'the standing approval on ceo@ is revoked, not moved');
  assert.ok(out.messages.some((m) => m.to === 'dwight' && /revoked/.test(m.subject)));

  // Dwight once owned support@ and left an approved reply that reads it.
  const old = approvals.file({ agentId: 'dwight', mailbox: 'support', to: 'a@b.com', subject: 'Re: From the prospect', body: 'Thanks', replyTo: { mailbox: 'support', id: '2' } });
  approvals.decide(old.id, 'approve', {}, '');
  const s = await call('dwight', 'send', { mailbox: 'support', proposal: old.id });
  assert.equal(s.status, 403);
  assert.match(s.body.error, /You send only from this mailbox, so this email can't forward, attach or reply to mail in it\. The email was withdrawn/);
  assert.equal(approvals.get(old.id).state, 'cancelled');
  assert.equal(state.fetched, undefined, 'nothing was read');
  assert.equal(state.sends.length, 0);
});

test('under a grant, a new email under a standing approval goes out and is kept; a reply is held for the owner with its thread', async (t) => {
  // Value: protects=a standing send from a grant is recorded for threading, and a reply, whose message the check can't read (it is in the owner's inbox), goes to the owner in the same thread (E1b, ship D8); fails_when=the standing path drops the thread or record, or sends a reply it could not judge; why_new=standing sends were tested only on an owned mailbox; seam=fake fit check
  const cfg = office('approval');
  const t0 = setup(t, cfg);
  const { call, approvals, state, out } = t0;
  const checked = [];
  const brokerCall = (agent, op, body) => handleMailRequest(t0.svc, { getConfig: () => cfg, proposals: approvals, audit: (e) => out.audit.push(e), fitCheck: async (k, e) => { checked.push(e); return { fits: true }; } }, agent, op, body);
  approvals.recordSend({ agentId: 'dwight', mailbox: 'ceo', messageId: '<s1@x.com>', references: [], to: 'lead@client.com', subject: 'Intro', sentAt: 5 });
  const pid = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'x@y.com', subject: 'First', body: 'b', offer_standing: 'Intros' })).body.proposal;
  approvals.decide(pid, 'approve', {}, '', 'Intros');
  const rule = approvals.standing('dwight')[0];

  const ok = await brokerCall('dwight', 'send', { mailbox: 'ceo', to: 'new@client.com', subject: 'Intro', body: 'Hello', standing: rule.id });
  assert.equal(ok.status, 200);
  assert.equal(approvals.recentSends('dwight', 'ceo')[0].messageId, ok.body.messageId, 'kept for the next reply');
  assert.equal(out.audit.find((e) => e.kind === 'mail-sent-standing').grant, true);

  const held = await brokerCall('dwight', 'send', { mailbox: 'ceo', to: 'lead@client.com', subject: 'Re: Intro', body: 'Yes, that works.', standing: rule.id, reply_to: { mailbox: 'ceo', id: '<s1@x.com>' } });
  assert.equal(held.body.sent, false);
  assert.match(held.body.why, /answers an email the check could not read/);
  assert.equal(checked.length, 1, 'the reply never reached the check');
  const card = approvals.get(held.body.proposal);
  assert.equal(card.replyTo, undefined, 'no reference into the mailbox');
  assert.deepEqual(card.thread, { inReplyTo: '<s1@x.com>', references: ['<s1@x.com>'] });
  assert.equal(state.sends.length, 1);
  assert.equal(state.fetched, undefined, 'nothing read from the owner mailbox');
});

test('the owner sees a Send only member\'s recent sends on its Access tab, and Settings lists only current senders', (t) => {
  // Value: protects=who wrote as an address is visible to the owner without the office log (O1b, D14), and an archived grantee is not listed as a sender (3d); fails_when=the tab, IPC or filter is dropped, or the list grows past five or loses its order; why_new=recent sends reached only the agent; seam=none
  const { approvals } = setup(t);
  for (let i = 1; i <= 7; i++) approvals.recordSend({ agentId: 'dwight', mailbox: 'ceo', messageId: `<s${i}@x.com>`, references: [], to: `lead${i}@client.com`, subject: `Intro ${i}`, sentAt: i });
  approvals.recordSend({ agentId: 'kelly', mailbox: 'ceo', messageId: '<k1@x.com>', references: [], to: 'x@y.com', subject: 'Not his', sentAt: 9 });
  assert.deepEqual(approvals.recentSends('dwight', 'ceo', 5).map((r) => r.subject), ['Intro 7', 'Intro 6', 'Intro 5', 'Intro 4', 'Intro 3']);
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('mail:recentSends', \(_evt, agentId: unknown, mailbox: unknown\) =>\n  \(typeof agentId === 'string' && typeof mailbox === 'string' \? mailApprovals\.recentSends\(agentId, mailbox, 5\)\.map\(\(r\) => \(\{ to: r\.to, subject: r\.subject, sentAt: r\.sentAt \}\)\) : \[\]\)\);/);
  const tab = read('src/renderer/src/components/CapabilitiesTab.tsx');
  assert.match(tab, /<RecentSends agentId=\{agent\.id\} mailbox=\{sendFrom\.mailbox\} \/>/);
  assert.match(tab, /window\.cth\.mailRecentSends\(agentId, mailbox\)/);
  assert.match(tab, /const list = useMailList\(\(\) => window\.cth\.mailRecentSends\(agentId, mailbox\), \[agentId, mailbox\]\);/);
  assert.match(tab, /const off = window\.cth\.onMailProposalsUpdated\(load\);/);
  const settings = read('src/renderer/src/components/MailboxesSettings.tsx');
  assert.match(settings, /sendersFrom\(config\.agentCapabilities, mailboxId\)\.filter\(\(x\) => current\(x\.agentId\)\)/);
  assert.match(settings, /const current = \(id: string\): boolean => agents\.some\(\(a\) => a\.id === id\) \|\| useStore\.getState\(\)\.restorableAgents\.some\(\(a\) => a\.id === id\);/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const c = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).capabilities;
    for (const k of ['recentSends', 'recentSend']) {
      assert.equal(typeof c[k], 'string', `${loc} ${k}`);
      assert.doesNotMatch(c[k], /[–—]| - /, `${loc} ${k} has no dash`);
    }
    for (const v of ['{{subject}}', '{{to}}', '{{date}}']) assert.ok(c.recentSend.includes(v), `${loc} recentSend names ${v}`);
  }
});

test('a member\'s own mailbox follows the same rule: Draft only withdraws, losing it revokes (ship D3)', async (t) => {
  // Value: protects=no card the owner can approve but never see sent, and no standing approval returning unseen when an own mailbox changes (ship D3); fails_when=setAgentCapabilities or removeMailbox stop withdrawing or revoking; why_new=only grants had this lifecycle; seam=none
  const { call, approvals, admin, cfg, out } = setup(t, office('send'));
  const waiting = (await call('pam', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 'One', body: 'b' })).body.proposal;
  const offered = (await call('pam', 'propose', { mailbox: 'ceo', to: 'c@d.com', subject: 'Two', body: 'b', offer_standing: 'Thank you notes' })).body.proposal;
  approvals.decide(offered, 'approve', {}, '', 'Thank you notes');
  // Can send to Send on approval: nothing withdrawn.
  setAgentCapabilities(admin, 'pam', { email: { enabled: true, mailboxes: ['ceo'], send: false, sending: 'approval' } });
  assert.equal(approvals.get(waiting).state, 'waiting');
  // Draft only: emails withdrawn, standing approvals kept.
  setAgentCapabilities(admin, 'pam', { email: { enabled: true, mailboxes: ['ceo'], send: false, sending: 'draft' } });
  assert.equal(approvals.get(waiting).state, 'cancelled');
  assert.equal(approvals.get(offered).state, 'cancelled');
  assert.match(approvals.get(waiting).cancelReason, /Draft only from ceo@x\.com/);
  assert.equal(approvals.standing('pam').filter((r) => !r.revokedAt).length, 1);
  // Moving the mailbox to Kelly: Pam's standing approvals there are revoked.
  out.messages.length = 0;
  cfg.agentCapabilities.kelly = {};
  const moved = setAgentCapabilities(admin, 'kelly', { email: { enabled: true, mailboxes: ['ceo'], send: false }, move: true });
  assert.equal(moved.movedFrom, 'pam');
  assert.equal(approvals.standing('pam').filter((r) => !r.revokedAt).length, 0);
  assert.ok(out.messages.some((m) => m.to === 'pam' && /gave ceo@x\.com to another team member/.test(m.body)));
  // Turning email off withdraws, and removing the mailbox in Settings does the same for its owner.
  const k = (await call('kelly', 'propose', { mailbox: 'ceo', to: 'e@f.com', subject: 'Three', body: 'b' }));
  assert.equal(k.status, 403, 'Kelly starts on Draft only');
  cfg.agentCapabilities.kelly.email.sending = 'approval';
  const kp = (await call('kelly', 'propose', { mailbox: 'ceo', to: 'e@f.com', subject: 'Three', body: 'b' })).body.proposal;
  removeMailbox({ close() {} }, admin, 'ceo');
  assert.equal(approvals.get(kp).state, 'cancelled');
  assert.match(approvals.get(kp).cancelReason, /ceo@x\.com was removed in Settings/);
});

test('Can send puts nothing on Ask me: switching to it hands back waiting cards, tells the member and overrides an old note to propose', async (t) => {
  // Value: protects=a member the owner moved to Can send stops filing Ask me cards even when its memory says to propose (owner, 2026-10-09: Dwight kept raising cards on Can send); fails_when=propose or a standing send files a card on Can send, a switch to Can send leaves waiting cards on Ask me, or the member is not told and its memory not updated; why_new=a switch to Can send did nothing and propose stayed open on it; seam=none
  const { call, approvals, admin, cfg, out, svc } = setup(t, office('approval'));
  const sent = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 'Batch 1', body: 'b', offer_standing: 'Follow ups' })).body.proposal;
  approvals.decide(sent, 'approve', {}, '', 'Follow ups');
  const rule = approvals.standing('dwight')[0];
  const waiting = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'lead@client.com', subject: 'Batch 2', body: 'b' })).body.proposal;
  assert.equal(approvals.waiting().length, 1);
  out.messages.length = 0; out.memory.length = 0;

  assert.equal(setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'send' }).ok, true);
  assert.equal(approvals.waiting().length, 0, 'off Ask me');
  assert.equal(approvals.get(waiting).state, 'cancelled');
  assert.match(approvals.get(waiting).cancelReason, /Can send from ceo@x\.com, so it is yours to send/);
  assert.equal(approvals.get(sent).state, 'approved', 'an approved card can still go by its id');
  const msg = out.messages.find((m) => m.to === 'dwight');
  assert.equal(msg.subject, 'Sending changed');
  assert.match(msg.body, /to Can send\. Send each email yourself with send; propose is refused and nothing goes on Ask me\./);
  assert.match(msg.body, /replaces any memory note about how you send from there/);
  assert.match(msg.body, /"Batch 2" to lead@client\.com \(mp_/);
  assert.equal(out.messages.filter((m) => m.to === 'dwight').length, 1, 'one message');
  assert.equal(out.memory.length, 1);
  assert.match(out.memory[0][1], /your Sending from ceo@x\.com is Can send\. .*replaces any earlier note about how you send from there/);

  // An old note to propose no longer reaches Ask me, and neither does an old standing id.
  const ask = await call('dwight', 'propose', { mailbox: 'ceo', to: 'x@y.com', subject: 'Batch 3', body: 'b' });
  assert.equal(ask.status, 403);
  assert.match(ask.body.error, /Send the email yourself with send; nothing goes on Ask me/);
  // A fit check that says no would have filed a card under Send on approval.
  const brokerCall = (op, body) => handleMailRequest(svc, { getConfig: () => cfg, proposals: approvals, fitCheck: async () => ({ fits: false, reason: 'no' }) }, 'dwight', op, body);
  const viaStanding = await brokerCall('send', { mailbox: 'ceo', to: 'x@y.com', subject: 'Batch 3', body: 'b', standing: rule.id });
  assert.equal(viaStanding.status, 200);
  assert.equal(viaStanding.body.sent, true);
  assert.equal(approvals.waiting().length, 0, 'nothing filed for the owner');
  const direct = await call('dwight', 'send', { mailbox: 'ceo', to: 'z@y.com', subject: 'Batch 4', body: 'b' });
  assert.equal(direct.status, 200);

  // Back to Send on approval: told and noted, nothing withdrawn.
  out.messages.length = 0; out.memory.length = 0;
  setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'approval' });
  assert.equal(approvals.get(sent).state, 'approved');
  assert.match(out.messages.find((m) => m.to === 'dwight').body, /to Send on approval\. Propose each email/);
  assert.doesNotMatch(out.messages.find((m) => m.to === 'dwight').body, /were waiting on Ask me/);
  assert.match(out.memory[0][1], /is Send on approval\./);
  assert.match(out.memory[0][1], /still goes with its standing id/, 'the note keeps standing approvals in force');
  // The same Sending again is no change: nothing is said.
  out.messages.length = 0;
  setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'approval' });
  assert.equal(out.messages.length, 0);

  // A member's own mailbox follows the same rule.
  const pw = (await call('pam', 'propose', { mailbox: 'ceo', to: 'q@r.com', subject: 'Own', body: 'b' })).body.proposal;
  setAgentCapabilities(admin, 'pam', { email: { enabled: true, mailboxes: ['ceo'], send: true, sending: 'send' } });
  assert.equal(approvals.get(pw).state, 'cancelled');
  assert.ok(out.messages.some((m) => m.to === 'pam' && m.subject === 'Sending changed' && /"Own" to q@r\.com/.test(m.body)));
  assert.equal((await call('pam', 'propose', { mailbox: 'ceo', to: 'q@r.com', subject: 'Own', body: 'b' })).status, 403);
  // Saving the same Sending again, or an older record with only send: true, is no change.
  out.messages.length = 0; out.memory.length = 0;
  setAgentCapabilities(admin, 'pam', { email: { enabled: true, mailboxes: ['ceo'], send: true, sending: 'send' } });
  setAgentCapabilities(admin, 'pam', { email: { enabled: true, mailboxes: ['ceo'], send: true } });
  assert.equal(out.messages.filter((m) => m.to === 'pam').length, 0, 'the same Sending saved again says nothing');
  assert.equal(out.memory.length, 0);

  // Wired in the app, and every new line the member reads has no dash.
  assert.match(read('src/main/index.ts'), /sendingChanged: \(agentId: string, mailbox: string, address: string, sending: SendingMode, handBack: boolean\) => mailApprovals\.sendingChanged\(agentId, mailbox, address, sending, handBack\)/);
  for (const text of [msg.body, out.memory.map((m) => m[1]).join(''), ask.body.error, approvals.get(waiting).cancelReason]) assert.doesNotMatch(text, /[–—]| - /);
});

test('at launch, cards waiting from a member already on Can send go back to it once, with the notice', async (t) => {
  // Value: protects=an office switched to Can send before this rule (Dwight: six cards and a memory note to propose) gets the same hand back as a switch, with no data patch; fails_when=the launch sweep is dropped, hands back cards of a member on Send on approval, or repeats; why_new=the switch hook never fires for a member already on Can send; seam=none
  const { call, approvals, cfg, out } = setup(t, office('approval'));
  const d1 = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 'One', body: 'b' })).body.proposal;
  const d2 = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'c@d.com', subject: 'Two', body: 'b' })).body.proposal;
  const p1 = (await call('pam', 'propose', { mailbox: 'ceo', to: 'e@f.com', subject: 'Three', body: 'b' })).body.proposal;
  // The owner moved Dwight to Can send on a build without the switch notice.
  cfg.agentCapabilities.dwight.sendOnly.sending = 'send';
  out.messages.length = 0; out.memory.length = 0;
  const canSend = (a, m) => (sendingFor(cfg, a, m) === 'send' ? mailboxAddress(cfg, m) : null);
  assert.equal(approvals.handBackCanSend(canSend), 1);
  assert.equal(approvals.get(d1).state, 'cancelled');
  assert.equal(approvals.get(d2).state, 'cancelled');
  assert.equal(approvals.get(p1).state, 'waiting', 'Send on approval keeps its card');
  const told = out.messages.filter((m) => m.to === 'dwight');
  assert.equal(told.length, 1, 'one message for both cards');
  assert.match(told[0].body, /"One" to a@b\.com[\s\S]*"Two" to c@d\.com/);
  assert.equal(out.memory.filter(([id]) => id === 'dwight').length, 1);
  assert.equal(approvals.handBackCanSend(canSend), 0, 'nothing twice');
  assert.equal(sendingFor(cfg, 'dwight', 'sales'), 'send', 'its own mailbox');
  assert.equal(sendingFor(cfg, 'dwight', 'support'), null, 'a mailbox it does not keep');
  const main = read('src/main/index.ts');
  assert.match(main, /const cfg = readConfig\(\);\n[^\n]*\n\s+mailApprovals\.handBackCanSend\(\(agentId, mailbox\) => \(memberPresent\(agentId\) && sendingFor\(cfg, agentId, mailbox\) === 'send' && mailAccess\(cfg, agentId, mailbox, 'send', undefined, \{ present: memberPresent \}\)\.ok \? mailboxAddress\(cfg, mailbox\) : null\)\);/, 'only where the member can send now, with the same presence check as the approval sweep');
});

test('a switch to Draft only withdraws, then tells the member its new Sending and notes it', async (t) => {
  // Value: protects=a member set to Draft only gets the Sending changed notice and memory note that replace an old note to send or propose (owner, 2026-10-09); fails_when=the Draft only branch skips sendingChanged, it runs before the withdraw, or the note names the wrong mode; why_new=the new Can send test covers send and approval only; seam=none
  const { call, approvals, admin, out } = setup(t, office('approval'));
  const w = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 'Draft me', body: 'b' })).body.proposal;
  out.messages.length = 0; out.memory.length = 0;
  assert.equal(setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'draft' }).ok, true);
  assert.equal(approvals.get(w).state, 'cancelled');
  assert.match(approvals.get(w).cancelReason, /Draft only from ceo@x\.com/, 'withdrawn by the Draft only cancel, not the Can send hand back');
  const told = out.messages.filter((m) => m.to === 'dwight');
  assert.equal(told.length, 2, 'the withdraw notice, then the Sending notice');
  assert.equal(told[1].subject, 'Sending changed');
  assert.match(told[1].body, /to Draft only\. Save each email as a draft for the owner to send; send and propose are refused\./);
  assert.doesNotMatch(told[1].body, /were waiting on Ask me/, 'nothing handed back to send');
  assert.equal(out.memory.length, 1);
  assert.match(out.memory[0][1], /your Sending from ceo@x\.com is Draft only\. Save each email as a draft/);

  // A member's own mailbox follows the same rule.
  out.messages.length = 0; out.memory.length = 0;
  setAgentCapabilities(admin, 'pam', { email: { enabled: true, mailboxes: ['ceo'], send: false, sending: 'draft' } });
  assert.ok(out.messages.some((m) => m.to === 'pam' && m.subject === 'Sending changed' && /to Draft only\./.test(m.body)));
  assert.match(out.memory.find(([id]) => id === 'pam')[1], /is Draft only\./);
});

test('after a switch to Can send, an email the owner already approved still goes out by its id, as approved', async (t) => {
  // Value: protects=the promise in the Sending notice that approved cards stay and send by their id on Can send (owner, 2026-10-09); fails_when=the proposal id branch is skipped on Can send like the standing id, so the call's own text goes out or the send is refused; why_new=the Can send test checks the card stays approved but never sends it; seam=none
  const { call, approvals, admin, state } = setup(t, office('approval'));
  const p = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 'Draft subject', body: 'first' })).body.proposal;
  approvals.decide(p, 'approve', { subject: 'Owner subject', body: 'owner body' }, '');
  setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'send' });
  assert.equal(approvals.get(p).state, 'approved');
  const r = await call('dwight', 'send', { mailbox: 'ceo', proposal: p, to: 'other@b.com', subject: 'Agent subject', body: 'agent body' });
  assert.equal(r.status, 200);
  assert.equal(state.sends.length, 1);
  assert.equal(state.sends[0].subject, 'Owner subject', 'the approved version, never the call\'s text');
  assert.equal(state.sends[0].to, 'a@b.com');
  assert.equal(approvals.get(p).state, 'sent');
});

test('a standing send whose check is still running when the owner picks Can send goes out, and nothing lands on Ask me', async (t) => {
  // Value: protects=Can send puts nothing on Ask me even when the switch lands during a standing send's fit check (owner, 2026-10-09); fails_when=the filing after a failed check ignores the member's current Sending; why_new=QA probe 002 reproduced a waiting card for a Can send member; seam=none
  const { approvals, admin, cfg, out, svc, state } = setup(t, office('approval'));
  let release;
  const gate = new Promise((r) => { release = r; });
  const call = (agent, op, body) => handleMailRequest(svc, { getConfig: () => cfg, proposals: approvals, present: () => true, audit: (e) => out.audit.push(e), fitCheck: async () => { await gate; return { fits: false, reason: 'not this kind' }; } }, agent, op, body);
  const p = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 'Intro', body: 'b', offer_standing: 'Intros' })).body.proposal;
  approvals.decide(p, 'approve', {}, '', 'Intros');
  const rule = approvals.standing('dwight')[0];
  const sends = state.sends.length;
  const pending = call('dwight', 'send', { mailbox: 'ceo', to: 'new@client.com', subject: 'Hello', body: 'Hi', standing: rule.id });
  await new Promise((r) => setTimeout(r, 10));
  setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'send' });
  release();
  const res = await pending;
  assert.equal(res.status, 200);
  assert.equal(res.body.proposal, undefined, 'no card was filed');
  assert.equal(approvals.waiting().filter((x) => x.agentId === 'dwight').length, 0, 'nothing on Ask me');
  assert.equal(state.sends.length, sends + 1, 'it went out');
  assert.equal(approvals.getStanding(rule.id).sends.length, 0, 'not counted as a standing send');
  assert.ok(out.audit.some((e) => e.kind === 'mail-sent' && e.grant === true), 'logged as a grant send');

  // Still on Send on approval, a failed check files the card as before.
  setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'approval' });
  const p2 = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'c@d.com', subject: 'Intro 2', body: 'b', offer_standing: 'Intros two' })).body.proposal;
  approvals.decide(p2, 'approve', {}, '', 'Intros two');
  const rule2 = approvals.standing('dwight').find((r) => r.kind === 'Intros two');
  const held = await call('dwight', 'send', { mailbox: 'ceo', to: 'x@y.com', subject: 'Held', body: 'Hi', standing: rule2.id });
  assert.equal(held.body.sent, false);
  assert.equal(approvals.get(held.body.proposal).state, 'waiting');
});

test('a paused grant moved to Can send keeps its waiting emails on Ask me, at the switch and at launch', async (t) => {
  // Value: protects=an email is never taken off Ask me for a member that cannot send it, so its text is not stranded (Codex adversarial review, 2026-10-09); fails_when=sendingChanged or the launch hand back ignores a paused grant; why_new=hand back keyed only off the Sending mode; seam=none
  const { call, approvals, admin, cfg, out } = setup(t, office('approval'));
  const w = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'lead@client.com', subject: 'Held', body: 'b' })).body.proposal;
  // Nobody reads ceo@ any more, so Dwight's grant there is paused.
  cfg.agentCapabilities.pam.email = { enabled: false, mailboxes: [], send: false, sending: 'draft' };
  out.messages.length = 0;
  setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'send' });
  assert.equal(approvals.get(w).state, 'waiting', 'still on Ask me');
  const told = out.messages.find((m) => m.to === 'dwight');
  assert.equal(told.subject, 'Sending changed', 'still told about the change');
  assert.doesNotMatch(told.body, /were waiting on Ask me/, 'nothing handed back');
  const canSendNow = (a, m) => (sendingFor(cfg, a, m) === 'send' && mailAccess(cfg, a, m, 'send').ok ? mailboxAddress(cfg, m) : null);
  assert.equal(approvals.handBackCanSend(canSendNow), 0, 'launch keeps it too');
  assert.equal(approvals.get(w).state, 'waiting');
  // Once someone reads ceo@ again, the next launch hands it back.
  cfg.agentCapabilities.pam.email = { enabled: true, mailboxes: ['ceo'], send: false, sending: 'approval' };
  assert.equal(approvals.handBackCanSend(canSendNow), 1);
  assert.equal(approvals.get(w).state, 'cancelled');
});

test('a standing send whose approval is revoked while its check runs still goes out once the owner picks Can send', async (t) => {
  // Value: protects=on Can send a standing id is ignored for the whole send, so a revoke during the check can't refuse it (Codex adversarial review, 2026-10-09); fails_when=the standing re-check runs before the Can send check; why_new=the pass 1 race fix only covered a failed check; seam=none
  const { approvals, admin, cfg, out, svc, state } = setup(t, office('approval'));
  let release;
  const gate = new Promise((r) => { release = r; });
  const call = (agent, op, body) => handleMailRequest(svc, { getConfig: () => cfg, proposals: approvals, present: () => true, audit: (e) => out.audit.push(e), fitCheck: async () => { await gate; return { fits: true }; } }, agent, op, body);
  const p = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'a@b.com', subject: 'Intro', body: 'b', offer_standing: 'Intros' })).body.proposal;
  approvals.decide(p, 'approve', {}, '', 'Intros');
  const rule = approvals.standing('dwight')[0];
  const sends = state.sends.length;
  const pending = call('dwight', 'send', { mailbox: 'ceo', to: 'new@client.com', subject: 'Hello', body: 'Hi', standing: rule.id });
  await new Promise((r) => setTimeout(r, 10));
  setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'send' });
  assert.deepEqual(approvals.revokeStanding(rule.id), { ok: true });
  release();
  const res = await pending;
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(state.sends.length, sends + 1, 'it went out');
});

test('a grant whose mailbox reader left the team counts as paused: moving it to Can send keeps its cards on Ask me', async (t) => {
  // Value: protects=a waiting email stays on Ask me when nobody on the team reads the mailbox the member sends from (Codex adversarial review pass 2, 2026-10-09); fails_when=the hand back checks the config only and not who is on the roster; why_new=the paused check ignored presence; seam=none
  let pamHere = true;
  const { call, approvals, admin, cfg } = setup(t, office('approval'), { present: (id) => id !== 'pam' || pamHere });
  const w = (await call('dwight', 'propose', { mailbox: 'ceo', to: 'lead@client.com', subject: 'Held', body: 'b' })).body.proposal;
  pamHere = false; // Pam, who reads ceo@, was archived
  setSendOnly(admin, 'dwight', { mailbox: 'ceo', sending: 'send' });
  assert.equal(approvals.get(w).state, 'waiting', 'still on Ask me');
  const present = (id) => id !== 'pam' || pamHere;
  const canSendNow = (a, m) => (present(a) && sendingFor(cfg, a, m) === 'send' && mailAccess(cfg, a, m, 'send', undefined, { present }).ok ? mailboxAddress(cfg, m) : null);
  assert.equal(approvals.handBackCanSend(canSendNow), 0, 'launch keeps it too');
  pamHere = true;
  assert.equal(approvals.handBackCanSend(canSendNow), 1, 'handed back once she is back');
});
