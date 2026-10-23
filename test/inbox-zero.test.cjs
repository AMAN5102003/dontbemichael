'use strict';

/**
 * Inbox zero for the Executive Admin (owner, 2026-10-03): every email gets an
 * outcome and leaves the inbox, nothing is deleted. The mail tools can now
 * archive (with a label), mark read and mark junk; every pack's Pam is written
 * to that method; how often she runs is her schedule's, never her Work style's;
 * offices that hired her before are offered the new text on Ask me.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { MailService, handleMailRequest } = loadTs('src/main/mail.ts');
const { mailAccess, MAIL_TOOL_OPS } = loadTs('src/shared/mailboxes.ts');
const { parseStarterSchedule, starterMissionsFor } = loadTs('src/shared/starterJobs.ts');
const { workStyleOffers, decisionId } = loadTs('src/shared/workStyleUpdates.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const PACKS = ['saas-consulting', 'pro-services', 'restaurant-food', 'retail-shop', 'home-services'];
const pack = (n) => JSON.parse(read(`resources/packs/${n}.json`));

function mailSetup({ gmail }) {
  const state = { inbox: [11, 12, 13], moved: [], flags: [], created: [] };
  const folders = gmail
    ? [{ path: 'INBOX' }, { path: '[Gmail]/All Mail', specialUse: '\\All' }, { path: '[Gmail]/Spam', specialUse: '\\Junk' }]
    : [{ path: 'INBOX' }, { path: 'Junk', specialUse: '\\Junk' }];
  const imap = {
    usable: true,
    async connect() {}, async logout() {},
    async list() { return folders; },
    async getMailboxLock() { return { release() {} }; },
    async search() { return state.inbox; },
    async messageFlagsAdd(uids, flags, opts) { state.flags.push({ uids, flags, labels: !!opts?.useLabels }); },
    async messageMove(uids, to) { state.moved.push({ uids, to }); state.inbox = state.inbox.filter((u) => !uids.includes(u)); },
    async mailboxCreate(p) { state.created.push(p); folders.push({ path: p }); }
  };
  const server = { host: 'h', port: 993, secure: true };
  const config = {
    mailboxes: [{ id: 'ceo', address: 'ceo@example.com', provider: gmail ? 'gmail' : 'other', imap: server, smtp: server, status: 'connected', createdAt: 1, updatedAt: 1 }],
    agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['ceo'], send: false } } }
  };
  const deps = { getConfig: () => config, getPassword: () => 'x', markStatus() {}, createImap: () => imap };
  const svc = new MailService(deps);
  return { state, call: (op, body, agent = 'pam') => handleMailRequest(svc, deps, agent, op, { mailbox: 'ceo', ...body }) };
}

test('archive marks read and moves out of the inbox, under a Gmail label; nothing is deleted', async () => {
  // Value: protects=the tool inbox zero needs exists and never deletes; fails_when=archive leaves mail unread, loses the label, deletes, or a missing id fails the batch; why_new=new tools; seam=fake IMAP
  const { state, call } = mailSetup({ gmail: true });
  const res = await call('archive', { ids: ['11', '12', '99'], label: 'Finance' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { done: ['11', '12'], missing: ['99'], label: 'Finance' });
  assert.deepEqual(state.flags, [{ uids: [11, 12], flags: ['Finance'], labels: true }, { uids: [11, 12], flags: ['\\Seen'], labels: false }]);
  assert.deepEqual(state.moved, [{ uids: [11, 12], to: '[Gmail]/All Mail' }]);
  const junk = await call('mark_junk', { ids: ['13'] });
  assert.equal(junk.status, 200);
  assert.deepEqual(state.moved[1], { uids: [13], to: '[Gmail]/Spam' });
  assert.doesNotMatch(read('src/main/mail.ts'), /messageDelete|expunge/i);
});

test('on other servers a label is a folder, made when missing; mark_read leaves mail in place', async () => {
  // Value: protects=inbox zero on iCloud, Yahoo, Zoho and custom servers; fails_when=the label folder is not created or archive has no destination; why_new=new tools; seam=fake IMAP
  const { state, call } = mailSetup({ gmail: false });
  await call('mark_read', { ids: ['11'] });
  assert.deepEqual(state.moved, [], 'mark_read moves nothing');
  await call('archive', { ids: ['12'], label: 'Waiting' });
  await call('archive', { ids: ['13'] });
  assert.deepEqual(state.created, ['Waiting', 'Archive']);
  assert.deepEqual(state.moved.map((m) => m.to), ['Waiting', 'Archive']);
});

test('organizing needs the mailbox, not sending rights, and refuses a bad batch', async () => {
  // Value: protects=a draft only assistant can still clear the inbox, and only its own; fails_when=organize needs send, works on another agent's mailbox, or takes unbounded batches; why_new=new op; seam=none
  assert.deepEqual(['archive', 'mark_read', 'mark_junk'].map((t) => MAIL_TOOL_OPS[t]), ['organize', 'organize', 'organize']);
  const cfg = { mailboxes: [{ id: 'ceo' }], agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['ceo'], send: false } } } };
  assert.equal(mailAccess(cfg, 'pam', 'ceo', 'organize').ok, true);
  assert.equal(mailAccess(cfg, 'kelly', 'ceo', 'organize').ok, false);
  const { call } = mailSetup({ gmail: true });
  assert.equal((await call('archive', {})).status, 400);
  assert.equal((await call('archive', { ids: Array.from({ length: 51 }, (_, i) => String(i + 1)) })).status, 400);
  assert.equal((await call('archive', { ids: ['11'] }, 'kelly')).status, 403);
});

test('every pack\'s Executive Admin works to inbox zero, and her Work style names no frequency', () => {
  // Value: protects=the owner's method in every install, with timing only in schedules; fails_when=a pack goes back to sorting some mail, deletes, or writes "every morning" or "each evening" into the Work style; why_new=seed rewrite; seam=none
  for (const n of PACKS) {
    const pam = pack(n).agents.find((a) => a.id === 'pam');
    const ws = pam.workStyle;
    assert.match(ws, /You keep the business inbox at zero: every message that arrives is dealt with and leaves the inbox/, n);
    for (const outcome of ['Route it:', 'Track it:', 'File it:', 'Clear it:']) assert.ok(ws.includes(outcome), `${n} ${outcome}`);
    assert.match(ws, /Finish each run with the inbox empty/, n);
    assert.match(ws, /Delete nothing: archiving keeps every email findable/, n);
    assert.doesNotMatch(ws, /\bevery (morning|evening|day|hour|\d)|each (morning|evening)|\bhourly\b|\bdaily\b|\b\d{1,2}(:\d{2})? ?(am|pm)\b|\bat \d{1,2}:\d{2}/i, `${n}: frequency belongs to the schedule`);
    assert.match(pam.summary, /inbox at zero/, n);
    assert.deepEqual(pam.wontDo, ['Delete any email'], 'how replies leave is the Sending setting, never a fixed rule');
    const jobs = (pack(n).starterMissions || []).filter((j) => j.agentId === 'pam');
    assert.deepEqual(jobs[0], { agentId: 'pam', title: 'Inbox to zero', schedule: 'every 2h during office hours', focus: 'Bring the inbox to zero: give every new message its outcome, bring back the Waiting items you noted as due today, and tell Michael what is left and why. If you have no email tools yet, from Mailboxes or a Claude connector such as Gmail, stop without messaging anyone.' }, n);
  }
  assert.equal(pack('home-services').starterMissions.find((j) => j.title === "Tomorrow's jobs").schedule, '18:00 on office days');
});

test('a starter job\'s timing follows the pack\'s office hours, and a hire gets each job once', () => {
  // Value: protects=a hire arrives with its schedules and their focus, timed to its business; fails_when=office hours are ignored, a job is added twice, or a job lands without its focus; why_new=starter jobs were never seeded; seam=none
  const hours = { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], work: { start: '07:00', end: '18:00' } };
  const every = parseStarterSchedule('every 2h during office hours', hours);
  assert.deepEqual(every.times, [{ kind: 'every', everyMs: 7_200_000, days: [1, 2, 3, 4, 5, 6], from: 420, to: 1080 }]);
  assert.deepEqual(parseStarterSchedule('18:00 on office days', hours).weekly, { days: [1, 2, 3, 4, 5, 6], minute: 1080 });
  assert.deepEqual(parseStarterSchedule('mon 09:00', hours).weekly, { days: [1], minute: 540 });
  assert.equal(parseStarterSchedule('twice a day', hours), null);
  const jobs = pack('home-services').starterMissions;
  const added = starterMissionsFor(jobs, hours, 'pam', 'pam-2', [], 'god', (i) => `m${i}`);
  assert.deepEqual(added.map((m) => [m.label, m.to, m.createdBy, !!m.focus]), [['Inbox to zero', 'pam-2', 'owner', true], ["Tomorrow's jobs", 'pam-2', 'owner', true]]);
  assert.deepEqual(starterMissionsFor(jobs, hours, 'pam', 'pam-2', added, 'god', (i) => `x${i}`), [], 'once');
  assert.match(read('src/renderer/src/components/AddAgentModal.tsx'), /void seedStarterJobs\(sourceCard, id\);/);
  assert.match(read('src/renderer/src/hooks/useHive.ts'), /if \(cardPack\) \{\n      await seedStarterJobs\(`\$\{cardPack\.businessType\}\/\$\{id\}`, id\);/);
});

test('offices that already hired her are offered the new text once, never given it silently', () => {
  // Value: protects=an owner's edited Work style is never overwritten without asking; fails_when=the offer is skipped, repeats after a decision, shows when the text is already current, or reaches Michael or another card; why_new=new offer; seam=none
  const def = pack('saas-consulting').agents.find((a) => a.id === 'pam');
  const oscar = pack('saas-consulting').agents.find((a) => a.id === 'oscar');
  const cards = new Map([['saas-consulting/pam', def], ['saas-consulting/oscar', oscar]]);
  const agents = [
    { id: 'pam', goal: 'old text' },
    { id: 'pam-2', goal: 'mine', sourceCard: 'saas-consulting/pam' },
    { id: 'oscar', goal: 'old' },
    { id: 'god', isGod: true }
  ];
  const offers = workStyleOffers(agents, cards, 'saas-consulting', { name: 'Sunrise Bakery' }, {});
  assert.deepEqual(offers.map((o) => o.agentId), ['pam', 'pam-2']);
  assert.match(offers[0].goal, /at Sunrise Bakery\./);
  assert.match(offers[0].description, /^Executive Admin: Runs the business inbox to zero/);
  assert.deepEqual(workStyleOffers(agents, cards, 'saas-consulting', { name: 'Sunrise Bakery' }, { [decisionId(offers[0].key, 'pam')]: 'keep' }).map((o) => o.agentId), ['pam-2'], 'decided once');
  assert.deepEqual(workStyleOffers([{ id: 'pam', goal: offers[0].goal }], cards, 'saas-consulting', { name: 'Sunrise Bakery' }, {}), [], 'already current');
  assert.match(read('src/renderer/src/components/AskMeTab.tsx'), /<WorkStyleUpdateCards offers=\{offers\} \/>/);
  assert.match(read('src/renderer/src/App.tsx'), /setWorkStyleOffersSource\(readWorkStyleOffers\)/);
  const decide = read('src/renderer/src/shell/workStyleOffers.ts');
  // Use it saves what the preview showed: the new text with the owner's
  // changes reapplied (work-style-change-request.md, D7).
  const adopt = decide.slice(decide.indexOf('export async function adoptWorkStyleOffer'));
  assert.match(adopt, /const patch = applyJob\(agent, \{ \.\.\.revised, handles: revised\.handles \?\? split\.roleDescription \}, \{ title: split\.role, now: new Date\(\)\.toISOString\(\) \}\);/);
  assert.match(adopt, /useStore\.getState\(\)\.updateAgent\(offer\.agentId, patch\);\s*await seedStarterJobs\(offer\.sourceCard, offer\.agentId\);[\s\S]{0,400}await decideWorkStyleOffer\(offer, 'use'\)\.catch\(\(\) => decideWorkStyleOffer\(offer, 'use'\)\.catch\(\(\) => undefined\)\);\s*return 'applied';/);
  // Value: protects=Use it on a pack update never saves over a job changed since its preview began, and a role that can't be saved changes nothing and records no decision (A3); fails_when=the stale check goes, or a failed role save still updates the member or records Use; why_new=the pins above cover the applied order only; seam=none; no_claim=source pins on the renderer function, not a rendered click
  assert.match(adopt, /if \(!agent\) return 'failed';\s*if \(jobBase\(agent\) !== from\) return 'moved';/);
  assert.match(adopt, /const role = await window\.cth\.hivePatchAgentRole\(offer\.agentId, patch\.description\)\.catch\(\(\) => null\);\s*if \(!role\?\.ok\) return 'failed';\s*useStore\.getState\(\)\.updateAgent/, 'the registry first, and a failure stops before the member or the decision');
});

test('someone hired from the card under another name is never offered the card character\'s name', () => {
  // Value: protects=an offer never renames a team member's job to the card's character; fails_when=Erin, hired from Pam's card, is offered "Pam runs the business inbox"; why_new=regression found 2026-10-03 (cards now name nobody; a name an older card carries is swapped); seam=none
  const def = pack('saas-consulting').agents.find((a) => a.id === 'pam');
  const cards = new Map([['saas-consulting/pam', def]]);
  const [offer] = workStyleOffers([{ id: 'erin-x', name: 'Erin', goal: 'old', sourceCard: 'saas-consulting/pam' }], cards, 'saas-consulting', { name: 'Sunrise Bakery' }, {});
  assert.match(offer.description, /^Executive Admin: Runs the business inbox to zero/);
  assert.doesNotMatch(offer.description + offer.goal, /\b(Pam|Erin)\b/);
  const older = { ...def, routing: 'Pam sorts the inbox.' };
  const [swapped] = workStyleOffers([{ id: 'erin-x', name: 'Erin', goal: 'old', sourceCard: 'saas-consulting/pam' }], new Map([['saas-consulting/pam', older]]), 'saas-consulting', {}, {});
  assert.equal(swapped.description, 'Executive Admin: Erin sorts the inbox.', 'a name an older card carries is swapped, as hiring does');
});

test('organize cleans its ids and label, and fails plainly when it cannot move mail', async () => {
  // Value: protects=an agent's bad batch or an odd mailbox never moves the wrong mail or reads as done; fails_when=duplicate or junk ids reach IMAP, a single "id" is refused, a label carries a line break, a vanished batch or a mailbox without a junk folder or move support reports success, or a server's own Archive folder is ignored for a new one; why_new=the inbox zero tests cover only the happy paths; seam=fake IMAP
  const { state, call } = mailSetup({ gmail: false });
  await call('mark_read', { ids: ['11', '11', 'abc', '-3', '12.5', 11] });
  assert.deepEqual(state.flags[0].uids, [11], 'deduped, only whole positive ids');
  await call('mark_read', { id: '12' });
  assert.deepEqual(state.flags[1].uids, [12], 'a single id is accepted');
  const labelled = await call('archive', { ids: ['12'], label: ' Wait\r\ning ' });
  assert.equal(labelled.body.label, 'Wait  ing');
  assert.deepEqual(state.moved.at(-1), { uids: [12], to: 'Wait  ing' });
  const gone = await call('archive', { ids: ['98', '99'] });
  assert.deepEqual([gone.status, gone.body.kind], [404, 'not-found']);
  assert.equal(state.moved.length, 1, 'nothing moved for a vanished batch');

  // A server without a junk folder, with its own Archive.
  const imapFolders = [{ path: 'INBOX' }, { path: 'Archive', specialUse: '\\Archive' }];
  const st = { moved: [], created: [], flags: [] };
  const imap = {
    usable: true, async connect() {}, async logout() {},
    async list() { return imapFolders; }, async getMailboxLock() { return { release() {} }; },
    async search() { return [11, 12]; }, async messageFlagsAdd(uids, flags) { st.flags.push({ uids, flags }); },
    async messageMove(uids, to) { st.moved.push({ uids, to }); }, async mailboxCreate(p) { st.created.push(p); }
  };
  const server = { host: 'h', port: 993, secure: true };
  const config = {
    mailboxes: [{ id: 'ceo', address: 'ceo@example.com', provider: 'other', imap: server, smtp: server, status: 'connected', createdAt: 1, updatedAt: 1 }],
    agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['ceo'], send: false } } }
  };
  const deps = { getConfig: () => config, getPassword: () => 'x', markStatus() {}, createImap: () => imap };
  const svc = new MailService(deps);
  const junk = await handleMailRequest(svc, deps, 'pam', 'mark_junk', { mailbox: 'ceo', ids: ['11'] });
  assert.deepEqual([junk.status, junk.body.kind], [404, 'not-found']);
  assert.match(junk.body.error, /no junk folder/);
  assert.deepEqual(st.moved, [], 'no junk folder, nothing moved');
  assert.deepEqual(st.flags, [], 'and nothing marked read: the mail is left exactly as it was');
  await handleMailRequest(svc, deps, 'pam', 'archive', { mailbox: 'ceo', ids: ['11'], label: '' });
  assert.deepEqual([st.moved[0].to, st.created], ['Archive', []], 'the server\'s Archive is used, nothing made');
  delete imap.messageMove;
  const cannot = await handleMailRequest(svc, deps, 'pam', 'archive', { mailbox: 'ceo', ids: ['12'] });
  assert.equal(cannot.body.kind, 'unsupported');
  assert.notEqual(cannot.status, 200);
});

test('a server with its own All folder that is not Gmail archives to its Archive, where a search looks', async () => {
  // Value: protects=archive and search agree on where archived mail lives off Gmail, so the team can find what inbox zero filed; fails_when=organize takes the Gmail label path for any \All folder; why_new=Codex adversarial review 2026-10-04; seam=fake IMAP
  const folders = [{ path: 'INBOX' }, { path: 'All Mail', specialUse: '\\All' }, { path: 'Archive', specialUse: '\\Archive' }];
  const st = { moved: [], flags: [], created: [] };
  const imap = {
    usable: true, async connect() {}, async logout() {},
    async list() { return folders; }, async getMailboxLock() { return { release() {} }; },
    async search() { return [11, 12]; },
    async messageFlagsAdd(uids, flags, opts) { st.flags.push({ flags, labels: !!opts?.useLabels }); },
    async messageMove(uids, to) { st.moved.push(to); }, async mailboxCreate(p) { st.created.push(p); folders.push({ path: p }); }
  };
  const server = { host: 'h', port: 993, secure: true };
  const config = {
    mailboxes: [{ id: 'ceo', address: 'ceo@example.com', provider: 'other', imap: server, smtp: server, status: 'connected', createdAt: 1, updatedAt: 1 }],
    agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['ceo'], send: false } } }
  };
  const deps = { getConfig: () => config, getPassword: () => 'x', markStatus() {}, createImap: () => imap };
  const svc = new MailService(deps);
  await handleMailRequest(svc, deps, 'pam', 'archive', { mailbox: 'ceo', ids: ['11'] });
  await handleMailRequest(svc, deps, 'pam', 'archive', { mailbox: 'ceo', ids: ['12'], label: 'Waiting' });
  assert.deepEqual(st.moved, ['Archive', 'Waiting']);
  assert.ok(st.flags.every((f) => !f.labels), 'no Gmail labels off Gmail');
});
