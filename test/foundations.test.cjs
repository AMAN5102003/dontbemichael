'use strict';

/**
 * Company foundations (docs/designs/office-foundations.md): the catalog, the
 * one writer's rules, the hive route `foundations`, and delivery through the
 * hook beside the company profile.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };

const F = loadTs('src/shared/foundations.ts');
const { Foundations } = loadTs('src/main/foundations.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const R = loadTs('src/shared/research.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

function tmp(t, name) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), name)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A writer on a temp office, with every side effect captured. */
function writer(t, over = {}) {
  const home = tmp(t, 'md-found-');
  const office = path.join(home, 'Office');
  fs.mkdirSync(office, { recursive: true });
  const events = [], told = [], published = [];
  let profile = over.profile ?? {};
  let now = Date.parse('2026-10-19T10:00:00Z');
  let n = 0;
  const w = new Foundations({
    home: () => home,
    now: () => now,
    record: (ev) => events.push(ev),
    publish: (text, oldId) => { published.push({ text, oldId }); return `doc${++n}`; },
    jobs: () => ['sales', 'marketing'],
    nameOf: (id) => ({ ryan: 'Ryan', dwight: 'Dwight', god: 'Michael' }[id] ?? id),
    godId: () => 'god',
    profile: () => profile,
    setProfile: (patch) => { profile = { ...profile, ...patch }; },
    ownerSaid: (id) => id === 'msg-owner-1',
    inOffice: (p) => p.startsWith(office) && fs.existsSync(p),
    tell: (to, subject, body) => told.push({ to, subject, body }),
    publishDelayMs: 0,
    ...over.deps
  });
  return { w, home, office, events, told, published, get profile() { return profile; }, setProfile: (p) => { profile = p; }, advance: (ms) => { now += ms; } };
}

test('a shared question prints under every job that lists it, with one answer', () => {
  const rec = F.emptyRecord();
  rec.answers.customers = { text: 'Restaurant owners with two to ten sites', by: 'owner', source: 'owner', at: '2026-10-19T10:00:00Z' };
  const doc = F.renderFoundations(rec, ['sales', 'marketing']);
  assert.match(doc, /^# Company foundations/);
  assert.equal(doc.match(/Restaurant owners with two to ten sites/g).length, 2, 'once under Sales, once under Marketing');
  assert.match(doc, /## Sales\n1\. What we sell \[offer\]: <empty>/);
  assert.doesNotMatch(doc, /## Finance/, 'only the jobs the office has');
  assert.match(F.renderFoundations(rec, []), /## Finance/, 'every job before the office has any');
});

test('the count weighs every question the same and a shared answer counts for each job', () => {
  const answered = new Set(['customers', 'offer']);
  assert.deepEqual(F.countFor(answered, ['sales']), { answered: 2, total: 6, missing: ['sales_process', 'market', 'deals', 'prices'] });
  const both = F.countFor(answered, ['sales', 'marketing']);
  assert.equal(both.total, 10, 'shared questions counted once');
  assert.equal(both.answered, 2);
});

test('a member gets its job\'s section with the empty questions, and no section without a job', () => {
  const rec = F.emptyRecord();
  rec.answers.voice = { text: 'Warm, plain, no jargon', by: 'ryan', source: 'file', at: '2026-10-19T10:00:00Z' };
  const s = F.sectionFor(rec, ['marketing'], (id) => (id === 'ryan' ? 'Ryan' : id));
  assert.match(s, /COMPANY FOUNDATIONS for your job/);
  assert.match(s, /How we sound \(brand voice\) \[voice\]: Warm, plain, no jargon \(learned by Ryan, 19 Oct\)/);
  assert.match(s, /Empty now: customers, brand, current_customers, offer, competitors\./);
  assert.equal(F.sectionFor(rec, []), null);
});

test('the record reader keeps only well formed entries for known questions', () => {
  const r = F.cleanRecord({ answers: { offer: { text: 'Pizza', by: 'owner', source: 'owner', at: 'x' }, nope: { text: 'x', by: 'o', source: 'owner', at: 'x' }, voice: { text: 'x' } }, hits: 'bad' });
  assert.deepEqual(Object.keys(r.answers), ['offer']);
  assert.deepEqual(r.hits, {});
});

test('the owner\'s answer always wins, is capped, and reaches the profile and the copy', async (t) => {
  const o = writer(t, { deps: { jobs: () => ['support'] } });
  assert.deepEqual(o.w.ownerAnswer('hours', ''), { ok: false, error: 'empty' });
  assert.deepEqual(o.w.ownerAnswer('hours', 'x'.repeat(F.FOUNDATION_CAP + 1)), { ok: false, error: 'too-long' });
  assert.deepEqual(o.w.ownerAnswer('nope', 'x'), { ok: false, error: 'unknown' });
  assert.deepEqual(o.w.ownerAnswer('hours', 'Mon to Fri 9 to 5'), { ok: true });
  assert.equal(o.w.read().answers.hours.by, 'owner');
  assert.equal(o.profile.hours, 'Mon to Fri 9 to 5', 'one set of facts with the profile');
  assert.deepEqual(o.events.map((e) => [e.kind, e.attrs.q, e.attrs.change]), [['foundation', 'hours', 'answered']]);
  assert.ok(fs.existsSync(path.join(o.home, 'private', 'foundations.json')), 'in the app\'s private folder');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(o.published.length, 1);
  assert.match(o.published[0].text, /Opening hours \[hours\]: Mon to Fri 9 to 5/);
});

test('a member fills only an empty answer, with a verified source; a clash and outside text go to Michael', (t) => {
  const o = writer(t);
  const file = path.join(o.office, 'Marketing', 'brand.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'brand');
  // No source: refused, and the member is told what to send.
  assert.match(o.w.handle('ryan', { question: 'voice', answer: 'Warm' }), /needs its source/);
  // A file in the office folders: saved at once, marked with who and when.
  assert.match(o.w.handle('ryan', { question: 'voice', answer: 'Warm and plain', source: { file } }), /Saved/);
  assert.equal(o.w.read().answers.voice.by, 'ryan');
  assert.equal(o.w.read().answers.voice.source, 'file');
  // A different learned answer: the first stays, Michael decides.
  assert.match(o.w.handle('dwight', { question: 'voice', answer: 'Bold and loud', source: { file } }), /already recorded/);
  assert.equal(o.w.read().answers.voice.text, 'Warm and plain');
  assert.equal(o.told.at(-1).to, 'god');
  assert.match(o.told.at(-1).subject, /differ/);
  // Outside text, or an owner message the log does not hold: to Michael first.
  assert.match(o.w.handle('ryan', { question: 'competitors', answer: 'Acme', source: { outside: 'a web page' } }), /to Michael to check/);
  assert.match(o.w.handle('ryan', { question: 'competitors', answer: 'Acme', source: { owner: 'made-up' } }), /to Michael to check/);
  assert.equal(o.w.read().answers.competitors, undefined);
  // Only Michael can confirm.
  assert.match(o.w.handle('ryan', { question: 'competitors', answer: 'Acme', source: { confirmed: 'trust me' } }), /to Michael to check/);
  assert.match(o.w.handle('god', { question: 'competitors', answer: 'Acme', source: { confirmed: 'the owner named them' } }), /Saved/);
  // An owner message the log holds: owner level, over a learned answer.
  assert.match(o.w.handle('ryan', { question: 'voice', answer: 'Friendly', source: { owner: 'msg-owner-1' } }), /Saved/);
  assert.equal(o.w.read().answers.voice.source, 'owner');
  // Over the owner's answer a file never wins: a suggestion to Michael.
  assert.match(o.w.handle('dwight', { question: 'voice', answer: 'Formal', source: { file } }), /owner's answer .* stands/);
  // The cap.
  assert.match(o.w.handle('ryan', { question: 'brand', answer: 'x'.repeat(F.FOUNDATION_CAP + 1), source: { file } }), /under 300/);
});

test('a gap is kept once per question and told to Michael the first time only', (t) => {
  const o = writer(t);
  assert.equal(o.w.handle('ryan', { question: 'customers', gap: 'Wrote 3 posts for everyone' }), null);
  assert.equal(o.w.handle('dwight', { question: 'customers', gap: 'Sales emails without a target' }), null);
  assert.equal(o.told.filter((x) => x.subject === 'Foundation gap').length, 1, 'once per question');
  const hit = o.w.read().hits.customers;
  assert.equal(hit.count, 2);
  assert.deepEqual(hit.by, ['ryan', 'dwight']);
  assert.equal(o.events.filter((e) => e.attrs.change === 'hit').length, 2, 'each hit is in harness.db');
  // Answered: a later gap report gets the answer back.
  o.w.ownerAnswer('customers', 'Restaurant owners');
  assert.match(o.w.handle('ryan', { question: 'customers', gap: 'x' }), /is answered: Restaurant owners/);
});

test('Have a member draft it: the request reaches the member and the draft comes back into the record', (t) => {
  const o = writer(t);
  assert.match(o.w.handle('ryan', { question: 'customers', draft: 'x' }), /No draft was asked/);
  assert.deepEqual(o.w.requestDraft('customers', 'ryan'), { ok: true });
  assert.equal(o.told.at(-1).to, 'ryan');
  assert.match(o.told.at(-1).body, /"foundation": \{"question": "customers", "draft"/);
  assert.match(o.w.handle('ryan', { question: 'customers', draft: 'Owners of small restaurant groups' }), /Draft saved/);
  assert.equal(o.w.read().drafts.customers.text, 'Owners of small restaurant groups');
  o.w.ownerAnswer('customers', 'Owners of small restaurant groups');
  assert.equal(o.w.read().drafts.customers, undefined, 'saving clears the draft');
});

test('the profile seeds a head start and wins over a learned answer; a cleared field clears its answer', (t) => {
  const o = writer(t, { profile: { hours: 'Daily 11 to 10', fiscalYearStartMonth: 4 } });
  o.w.seed();
  assert.equal(o.w.read().answers.hours.text, 'Daily 11 to 10');
  assert.equal(o.w.read().answers.fiscal_year.text, 'Starts in April');
  assert.equal(o.w.read().answers.hours.source, 'profile');
  // A learned answer for an empty profile field fills it; never one the owner set.
  const p = writer(t);
  const file = path.join(p.office, 'books.md');
  fs.writeFileSync(file, 'books');
  p.w.handle('oscar', { question: 'fiscal_year', answer: 'Our year starts in July', source: { file } });
  assert.equal(p.profile.fiscalYearStartMonth, 7);
  // Settings clears the hours: the answer it gave goes; a changed field wins.
  o.setProfile({ fiscalYearStartMonth: 1 });
  o.w.profileChanged();
  assert.equal(o.w.read().answers.hours, undefined);
  assert.equal(o.w.read().answers.fiscal_year.text, 'Starts in January');
  assert.ok(o.events.some((e) => e.attrs.q === 'hours' && e.attrs.change === 'cleared'));
});

test('Not now hides a question for a week', (t) => {
  const o = writer(t);
  assert.deepEqual(o.w.snooze('customers'), { ok: true });
  assert.equal(o.w.read().snoozed.customers, '2026-10-26T10:00:00.000Z');
  assert.deepEqual(o.w.snooze('nope'), { ok: false });
});

test('Pulse: the strip lists jobs whose work hit an empty question, most hit first; a member missing nothing has no count', () => {
  const ev = (agentId, q, change, ts = 1) => ({ agentId, q, change, ts });
  const state = F.replayFoundations([
    ev('ryan', 'customers', 'hit'), ev('ryan', 'customers', 'hit', 2), ev('ryan', 'voice', 'hit', 3),
    ev('oscar', 'accounting', 'hit', 4), ev(null, 'offer', 'answered', 5),
    ...['accounting', 'fiscal_year', 'money', 'owed', 'results'].map((q, i) => ev(null, q, 'answered', 10 + i))
  ]);
  const p = F.foundationsPulse(state, { ryan: ['marketing'], dwight: ['sales'], oscar: ['finance'], pam: [] });
  assert.deepEqual(p.jobs.map((j) => [j.job, j.answered, j.total, j.waiting]), [['marketing', 1, 6, ['customers', 'voice']]]);
  assert.deepEqual(p.members.ryan, { answered: 1, total: 6, missing: ['customers', 'voice'], more: 3 });
  assert.deepEqual(p.members.dwight.missing, [], 'nothing hit yet: no pills');
  assert.equal(p.members.dwight.more, 5);
  assert.equal(p.members.oscar, undefined, 'all answered: no count (D9)');
  // A cleared answer counts as empty again.
  const cleared = F.replayFoundations([ev(null, 'offer', 'answered', 1), ev(null, 'offer', 'cleared', 2)]);
  assert.equal(cleared.answeredAt.has('offer'), false);
});

test('the hive route hands an answer to the writer as the folder\'s member, replies, and keeps Research out', async (t) => {
  const home = tmp(t, 'md-found-hive-');
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'ryan', name: 'Ryan', provider: 'claude', cwd: home });
  const outbox = (id) => path.join(home, 'hive', 'agents', id, 'outbox');
  const drop = (id, msg) => fs.writeFileSync(path.join(outbox(id), `m-${Date.now()}-${Math.random()}.json`), JSON.stringify(msg));
  const calls = [];
  hive.onFoundations((actor, payload) => { calls.push({ actor, payload }); return payload.gap ? null : 'Saved.'; });
  drop('ryan', { to: 'foundations', from: 'god', act: 'inform', subject: 'f', body: '', foundation: { question: 'voice', answer: 'Warm', source: { file: '/x' } } });
  hive.routeOnce();
  assert.deepEqual(calls, [{ actor: 'ryan', payload: { question: 'voice', answer: 'Warm', source: { file: '/x' } } }]);
  assert.equal(hive.inbox('ryan')[0].from, 'foundations');
  assert.equal(hive.inbox('ryan')[0].body, 'Saved.');
  assert.equal(hive.inbox('god').length, 0, 'never mail');
  // A gap owes no reply.
  drop('ryan', { to: 'foundations', act: 'inform', subject: 'f', body: '', foundation: { question: 'customers', gap: 'posts' } });
  hive.routeOnce();
  assert.equal(hive.inbox('ryan').length, 1);
  // A reply to the app's sender never bounces to Michael.
  const src = read('src/main/hive.ts');
  assert.match(src, /msg\.to === 'mail' \|\| msg\.to === 'foundations' \|\| msg\.to === PRIVACY_CHECK_SENDER/);
  assert.match(src, /\['scheduler', 'heartbeat', 'mail', 'system', 'foundations', PRIVACY_CHECK_SENDER\]/, 'Research\'s message to it is dropped');
  assert.match(src, /msg\.to === 'foundations' && this\.foundationsHandler && !research/);
});

test('the owner check finds only an owner message the hive log recorded', async (t) => {
  const home = tmp(t, 'md-found-log-');
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  const m = hive.send({ to: 'god', act: 'request', subject: 'Answer', body: 'Our ICP is X' }, 'human');
  const other = hive.send({ to: 'god', act: 'inform', subject: 'Hi', body: 'x' }, 'system');
  assert.equal(hive.ownerSaid(m.id), true);
  assert.equal(hive.ownerSaid(other.id), false, 'not the owner');
  assert.equal(hive.ownerSaid('nope'), false);
});

test('the hook gives a member its section and Michael the whole document, again on change, and Research nothing', async (t) => {
  const home = tmp(t, 'md-found-hook-');
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'ryan', name: 'Ryan', provider: 'claude', cwd: home });
  let text = 'COMPANY FOUNDATIONS for your job. v1';
  const server = new HookServer(hive, () => null, () => ({ harnessHome: home }),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    (id) => (id === 'god' ? 'COMPANY FOUNDATIONS. The whole document' : id === R.RESEARCH_ID ? 'LEAK' : text));
  const hook = (agent_id, event, fields = {}) => JSON.stringify(server.handle({ agent_id, session_id: 's1', hook_event_name: event, cwd: home, ...fields }) ?? {});
  assert.match(hook('ryan', 'SessionStart', { source: 'startup' }), /for your job\. v1/);
  assert.doesNotMatch(hook('ryan', 'UserPromptSubmit', { prompt: 'go' }), /COMPANY FOUNDATIONS/, 'never repeated unchanged');
  text = 'COMPANY FOUNDATIONS for your job. v2';
  assert.match(hook('ryan', 'UserPromptSubmit', { prompt: 'go' }), /v2/, 'again on change');
  assert.match(hook('god', 'SessionStart', { source: 'startup' }), /The whole document/);
  assert.doesNotMatch(hook(R.RESEARCH_ID, 'SessionStart', { source: 'startup' }), /LEAK|FOUNDATIONS/);
});

test('instructions: members report gaps and teach the foundations; Michael raises one card per hit question; the weekly check is seeded', () => {
  const hive = read('src/main/hive.ts');
  assert.match(hive, /do the work anyway, add one line where you hand it back/);
  assert.match(hive, /"foundation": \{"question": "<id>", "gap": /);
  assert.match(hive, /"source": \{"outside": "<where it came from>"\}/);
  assert.match(hive, /Fill only empty answers/);
  assert.match(hive, /Raise one card for it on Ask me unless one is open for that question, never one per task or per member/);
  assert.match(hive, /\{"kind": "foundation", "foundation": "<question id>"/);
  assert.match(hive, /Never raise a card for a question no work has hit/);
  const config = read('src/main/config.ts');
  assert.match(config, /id: 'foundations-check',\n  label: 'Foundations check',/);
  const main = read('src/main/index.ts');
  assert.match(main, /if \(!cfgF\.foundationsCheckSeeded\)/);
  assert.match(read('src/main/factoryReset.ts'), /'foundations\.json'/);
});

test('every shipped pack role reads as a job with a foundations section', () => {
  const dir = path.resolve(__dirname, '..', 'resources', 'packs');
  const misses = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const pack = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const a of pack.agents ?? []) {
      if (a.id === 'research') continue;
      const job = F.jobOf({ id: a.id, sourceCard: `${pack.businessType}/${a.id}`, description: a.role ?? a.description });
      if (!job) misses.push(`${f}:${a.id}`);
      else assert.ok(F.JOB_QUESTIONS[job].length > 0);
    }
  }
  assert.deepEqual(misses, []);
  // A custom hire reads its job from its role line, like its studio department.
  assert.equal(F.jobOf({ id: 'x1', description: 'Bookkeeper for the shop' }), 'finance');
  assert.equal(F.jobOf({ id: 'x2', description: 'Helps with odd jobs' }), null);
});

test('the foundation card: evidence first, a labeled box with its hint as description, Save, Draft, Not now, after the decisions', () => {
  const cardSrc = read('src/renderer/src/components/FoundationCard.tsx');
  assert.match(cardSrc, /<FileText source=\{q\}/, 'Michael\'s evidence line');
  assert.match(cardSrc, /aria-describedby=\{hintId\}/, 'the hint describes the box (D12)');
  assert.match(cardSrc, /maxLength=\{FOUNDATION_CAP\}/);
  assert.match(cardSrc, /window\.cth\.foundationsAnswer\(id, text\)[\s\S]*onAnswer\(text\)/, 'written to the foundations, then the card answered');
  assert.match(cardSrc, /role="status"[\s\S]*foundations\.card\.drafting/, 'drafting is a polite status (D8)');
  assert.match(cardSrc, /disabled=\{!text \|\| busy \|\| drafting\}/, 'Save waits for the draft');
  assert.match(cardSrc, /flexWrap: 'wrap'[\s\S]*foundations\.card\.notNow/, 'Not now wraps at 320 px (D13)');
  const ask = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(ask, /\[\.\.\.asks\.filter\(\(r\) => !foundationAsk\(r\.ask\)\), \.\.\.foundationRows, \.\.\.rowsOf\(openReportIndexes\)\]/, 'after the decisions, before reports (D10)');
  assert.match(read('src/renderer/src/shell/useNeedsYou.ts'), /shownQuestions\(t, merged\.foundations\)/, 'Not now leaves the count too');
  assert.match(ask, /if \(ok\) setFoundationSaved\(true\)/, 'a saved answer says so in a polite line (states table)');
  assert.match(ask, /role="status"[^\n]*foundations\.card\.saved/);
  // D5: no card waiting opens the document itself, read only, else where it is listed.
  assert.match(read('src/renderer/src/components/pulse/PulseView.tsx'), /d\.tags\.includes\('foundations'\)[\s\S]{0,200}window\.cth\.kgOpen\(doc\.id\)/);
});

test('Pulse: the strip in Recommendations, the count under the role, the detail box', () => {
  const v = read('src/renderer/src/components/pulse/PulseView.tsx');
  assert.match(v, /foundationJobs\.length > 0 && <div style=\{\{ padding: '6px 16px 4px' \}\}><FoundationsStrip/, 'under the Early look header (D3)');
  assert.match(v, /fm && fm\.answered < fm\.total &&/, 'gone once all answered (D9)');
  assert.match(v, /pulse\.foundations\.jobAria/);
  assert.match(v, /<FoundationsBox f=\{f\} \/>/);
  const p = read('src/main/pulse.ts');
  assert.match(p, /kind = 'foundation'/, 'from harness.db');
  for (const lang of ['en', 'ar', 'zh-CN']) {
    const l = JSON.parse(read(`src/renderer/src/i18n/locales/${lang}.json`));
    assert.equal(Object.keys(l.foundations.q).length, Object.keys(F.FOUNDATION_QUESTIONS).length, lang);
    assert.ok(l.pulse.foundations.count && l.foundations.card.save, lang);
    for (const text of [...Object.values(l.foundations.card), ...Object.values(l.pulse.foundations)]) assert.doesNotMatch(text, /[–—]| - /, `no dashes: ${text}`);
  }
});

/** A writer whose profile goes through the app's own profile cleaner, as main wires it. */
function profileWriter(t) {
  const CP = loadTs('src/shared/companyProfile.ts');
  let stored = {};
  const o = writer(t, { deps: {
    profile: () => CP.cleanCompanyProfile(stored),
    setProfile: (patch) => { stored = { ...CP.cleanCompanyProfile(stored), ...patch }; },
    jobs: () => ['support', 'finance']
  } });
  return { ...o, stored: () => CP.cleanCompanyProfile(stored) };
}

test('the owner\'s hours answer is never cut to the profile\'s short form by the next profile sync', (t) => {
  // Value: protects=the owner's answer always wins: a profile sync (launch seed or any Settings save) never rewrites the owner's own hours words; fails_when=an owner answer longer
  //   than the 200 character profile field is replaced by its cut copy, marked as from the profile; why_new=existing tests use short answers and a stub profile with no 200 cap; seam=none;
  //   no_claim=the Settings save path itself (profileChanged called directly; profile cleaner real, config store stubbed)
  const o = profileWriter(t);
  const hours = 'Mon to Fri 9 to 5. '.repeat(13).trim();
  assert.ok(hours.length > 200 && hours.length <= F.FOUNDATION_CAP, 'longer than the profile field, within the cap');
  const r = o.w.ownerAnswer('hours', hours);
  o.w.profileChanged(); // what the next launch (seed) or a Settings save of the profile runs
  if (r.ok) {
    assert.equal(o.w.read().answers.hours.text, hours, 'the owner\'s words, whole');
    assert.equal(o.w.read().answers.hours.source, 'owner');
  } else {
    assert.equal(r.error, 'too-long', 'or refused up front, never cut later');
  }
});

test('an owner\'s financial year answer gives the profile its start month, not the first month of the calendar it names', (t) => {
  // Value: protects=one set of facts: "July to June" keeps July as the start in the profile and in the answer after a sync; fails_when=the month is picked in calendar order (June),
  //   and the next sync rewrites the owner's answer to the wrong start month; why_new=existing test names one month only; seam=none;
  //   no_claim=free text month parsing beyond a start then end range (profile cleaner real, config store stubbed)
  const o = profileWriter(t);
  assert.deepEqual(o.w.ownerAnswer('fiscal_year', 'July to June'), { ok: true });
  assert.equal(o.stored().fiscalYearStartMonth, 7, 'the year starts in July');
  o.w.profileChanged();
  const text = o.w.read().answers.fiscal_year.text;
  assert.doesNotMatch(text, /^Starts in (?!July\b)/, `the answer keeps July as the start: ${text}`);
});

test('the copy in company knowledge: a failed publish is retried, an unchanged one is not sent again, and a broken record reads as empty', async (t) => {
  // Value: protects=eng finding 5 (publish once per change, retry after a failure, replace the old copy) and a broken foundations.json never blocks the writer; fails_when=publishedText
  //   is kept before a publish succeeds, a launch republishes an unchanged copy, the old id is not passed for replacement, or a broken file throws; why_new=only the first publish is tested; seam=none;
  //   no_claim=knowledge.ingestText and remove themselves (publish stubbed; debounce timer bypassed with publishNow)
  let fail = true;
  const sent = [];
  const o = writer(t, { deps: {
    publish: (text, oldId) => { sent.push({ text, oldId }); if (fail) throw new Error('store busy'); return `doc${sent.length}`; },
    publishDelayMs: 60_000
  } });
  const file = path.join(o.home, 'private', 'foundations.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(o.w.read().answers, {}, 'a broken record reads as empty');
  assert.deepEqual(o.w.ownerAnswer('offer', 'Pizza and salads'), { ok: true });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).answers.offer.text, 'Pizza and salads', 'the next write replaces the broken file');

  o.w.publishNow();
  assert.equal(sent.length, 1);
  assert.equal(o.w.read().publishedId, undefined, 'a failed publish records nothing');
  assert.equal(o.w.read().publishedText, undefined);
  fail = false;
  o.w.publishNow();
  assert.equal(sent.length, 2, 'retried');
  assert.equal(o.w.read().publishedId, 'doc2');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).publishedText, o.w.document(), 'kept on disk for the next launch');
  o.w.publishNow();
  o.w.seed();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.length, 2, 'unchanged: neither a publish nor a launch sends it again');
  o.w.ownerAnswer('customers', 'Families nearby');
  o.w.publishNow();
  assert.equal(sent.length, 3);
  assert.equal(sent[2].oldId, 'doc2', 'the new copy replaces the old one');
  assert.match(sent[2].text, /Families nearby/);
});
