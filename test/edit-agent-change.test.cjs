'use strict';

/**
 * Changing a job by saying what should change (docs/designs/work-style-change-request.md,
 * T2 to T6): Apply saves the job with what Undo and a pack update need, Undo
 * puts it back, the preview's states, the hire wizard's describe once, and a
 * pack's new default with the owner's changes reapplied.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const J = loadTs('src/shared/jobChange.ts');
const { workStyleOffers } = loadTs('src/shared/workStyleUpdates.ts');
const { teamMemberGoal } = loadTs('src/shared/teamPlan.ts');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const pam = {
  goal: 'The owner set this work style for your role at Sunrise.\n\n### The job\nAnswer customers.',
  goalPlain: { text: 'The job: Answers customers.', of: '' },
  description: 'Customer Support: Answers customers. Only the support inbox.',
  jobChanges: [{ text: 'Sign replies with the business name', at: '2026-10-22T10:00:00.000Z' }]
};
pam.goalPlain.of = J.jobFingerprint(pam.goal);

test('a fingerprint tells the same words apart from changed ones; plain words follow their instructions', () => {
  // Value: protects=saved plain words are shown only while they describe the job (eng D5, OV3); fails_when=stale words show after another writer changed the instructions; why_new=T2; seam=pure
  assert.equal(J.jobFingerprint(' a '), J.jobFingerprint('a'));
  assert.notEqual(J.jobFingerprint('a'), J.jobFingerprint('b'));
  assert.match(J.jobFingerprint('x'), /^[0-9a-f]{8}$/);
  assert.equal(J.plainFor(pam, pam.goal), 'The job: Answers customers.');
  assert.equal(J.plainFor(pam, `${pam.goal}\n\nFirst task: chase invoices.`), null, 'another writer changed them');
  assert.equal(J.plainFor({}, pam.goal), null);
  assert.notEqual(J.jobBase(pam), J.jobBase({ ...pam, description: 'Customer Support: Answers customers.' }), 'the role line counts too');
});

test('Apply saves the new job, the old one for Undo, and the change; unchanged duties keep the role line', () => {
  // Value: protects=Apply writes every field Undo and a pack update need (eng D5, D6, D7); fails_when=handles null rewrites the line, the change list loses its order, or the previous version is not kept; why_new=T2; seam=pure
  const now = '2026-10-23T09:00:00.000Z';
  const tone = J.applyJob(pam, { instructions: 'new goal', plain: 'The job: new.', handles: null }, { title: 'Customer Support', change: ' Write more formally ', now });
  assert.equal(tone.goal, 'new goal');
  assert.deepEqual(tone.goalPlain, { text: 'The job: new.', of: J.jobFingerprint('new goal') });
  assert.equal(tone.description, pam.description, 'duties unchanged, line kept word for word');
  assert.deepEqual(tone.jobPrevious, { goal: pam.goal, goalPlain: pam.goalPlain, description: pam.description, jobChanges: pam.jobChanges });
  assert.deepEqual(tone.jobChanges.map((c) => c.text), ['Sign replies with the business name', 'Write more formally']);
  const duty = J.applyJob(pam, { instructions: 'g', plain: 'p', handles: 'Answers customers and refund emails.' }, { title: 'Customer Support', change: 'refunds', now });
  assert.equal(duty.description, 'Customer Support: Answers customers and refund emails.', 'the typed title stays (OV2)');
  const pack = J.applyJob(pam, { instructions: 'g', plain: 'p', handles: null }, { title: 'Customer Support', now });
  assert.equal(pack.jobChanges, pam.jobChanges, 'a pack default is no change of the owner\'s');
  const many = J.applyJob({ ...pam, jobChanges: Array.from({ length: 25 }, (_, i) => ({ text: `c${i}`, at: now })) }, { instructions: 'g', plain: 'p', handles: null }, { title: '', change: 'last', now });
  assert.equal(many.jobChanges.length, J.JOB_CHANGES_MAX);
  assert.equal(many.jobChanges.at(-1).text, 'last');
});

test('Undo puts back the job and the change list as they were, once', () => {
  // Value: protects=Undo restores text only, the routing line with it, and the owner's changes even after a pack update (DR7, OV4); fails_when=Undo drops a change it didn't add or can run twice; why_new=T2; seam=pure
  // A real Apply keeps the binding line (reviseWorkStyle appends it back).
  const applied = { ...pam, ...J.applyJob(pam, { instructions: 'g', plain: 'p', handles: 'New duties. Only the support inbox.' }, { title: 'Customer Support', change: 'x', now: 'n' }) };
  const back = J.undoJob(applied);
  assert.equal(back.goal, pam.goal);
  assert.deepEqual(back.goalPlain, pam.goalPlain);
  assert.equal(back.description, pam.description);
  assert.deepEqual(back.jobChanges, pam.jobChanges);
  assert.equal(back.jobPrevious, undefined);
  assert.equal(J.undoJob({ ...applied, ...back }), null, 'one level');
  const afterPack = { ...pam, ...J.applyJob(pam, { instructions: 'g', plain: 'p', handles: null }, { title: '', now: 'n' }) };
  assert.deepEqual(J.undoJob(afterPack).jobChanges, pam.jobChanges, 'undoing a pack update keeps the owner\'s changes');
});

test('Edit agent: the job saves only through Apply, refused when it moved, routing line first, one-time work as a card', () => {
  // Value: protects=A3 stale base, Michael's routing line saved before the roster, and finding 4; fails_when=Apply saves over a job changed meanwhile, the role patch error is swallowed, or one-time work lands in the job; why_new=T4; seam=source pin
  const src = read('src/renderer/src/components/EditAgentModal.tsx');
  const apply = src.slice(src.indexOf('const applyChange = async'), src.indexOf('const undoChange = async'));
  assert.match(apply, /if \(jobBase\(cur\) !== from\) return 'moved';/);
  assert.match(apply, /const r = await window\.cth\.hivePatchAgentRole\(agent\.id, patch\.description\)\.catch\(\(\) => null\);\s*if \(!r\?\.ok\) return 'failed';/);
  assert.ok(apply.indexOf('hivePatchAgentRole') < apply.indexOf('updateAgent(agent.id, patch)'), 'the registry first');
  assert.match(apply, /setStatus\(t\('jobChange\.applied', \{ name: cur\.name \}\)\);/);
  const undo = src.slice(src.indexOf('const undoChange = async'), src.indexOf('const save = async'));
  assert.match(undo, /const patch = undoJob\(cur\);/);
  assert.match(undo, /setStatus\(t\('jobChange\.undone', \{ name: cur\.name \}\)\);\s*setFocusKey\(\(k\) => k \+ 1\);/, 'focus back in the box (DR10)');
  assert.match(src, /current: \{ instructions: effectiveWorkStyle\(cur\), handles: lead \? '' : split\.roleDescription \},/);
  assert.match(src, /checkOverlap=\{lead \? undefined : checkOverlap\}/);
  assert.match(src, /\{live\.jobPrevious && <button type="button" onClick=\{\(\) => \{ void undoChange\(\); \}\}/, 'Undo shows only with something to undo');
  // DR3: Close until a typed field changes.
  assert.match(src, /footer=\{edited \? \(/);
  assert.match(src, /const edited = name !== agent\.name \|\| role !== splitAgentRole\(agent\.description\)\.role\s*\|\| provider !== inferAgentProvider\(agent\.command, agent\.provider\) \|\| model !== agent\.model;/);
  assert.match(src, /const dirty = edited \|\| draft;/, 'a typed change or an open preview asks before leaving');
});

test('the preview: working, ok, clash, overlap, error and changed meanwhile, with focus and roles for screen readers', () => {
  // Value: protects=DR5, DR6, DR8, DR10, DR11 in the shared preview; fails_when=a state loses its role, Cmd or Ctrl+Enter, the stop on close, or the sticky Apply row; why_new=T3; seam=source pin
  const src = read('src/renderer/src/components/JobChangeReview.tsx');
  assert.match(src, /if \(e\.key === 'Enter' && \(e\.metaKey \|\| e\.ctrlKey\)\) \{ e\.preventDefault\(\); void start\(\); \}/);
  assert.match(src, /panel = <Working who=\{p\.who\} progress=\{state\.progress\} heading=\{head\(t\('jobChange\.working', \{ name: p\.who \}\)\)\} onStop=\{stop\} \/>;/, 'its steps and words (revise-progress.test.cjs)');
  assert.equal((src.match(/<div role="alert" style=\{panelStyle\}>/g) ?? []).length, 3, 'overlap, error and changed meanwhile');
  assert.match(src, /heading\.current\?\.focus\(\{ preventScroll: true \}\);/, 'focus moves to each state\'s heading');
  assert.match(src, /\{state\.at === 'idle' && p\.status && <span role="status"/);
  assert.match(src, /aria-expanded=\{whole\}/);
  assert.match(src, /position: 'sticky', bottom: 0/);
  assert.match(src, /const SUMMARY_SHOWN = 6;/);
  assert.match(src, /background: 'var\(--cth-indigo-soft\)'/);
  assert.doesNotMatch(src.slice(src.indexOf('const panelStyle')), /boxShadow/, 'no border or shadow on the preview (DR8)');
  assert.match(src, /if \(res\.handles && p\.checkOverlap\) \{/, 'the overlap check runs only when duties changed (D6)');
  assert.match(src, /const more = \[\.\.\.extras, t\('jobChange\.leaveWithChange', \{ names, count \}\)\];/, 'Leave it with Kelly adds a change and runs again');
  assert.match(src, /if \(r === 'moved'\) \{ setState\(\{ at: 'moved' \}\); return; \}/);
  assert.match(src, /className=\{on \? 'cth-askme-opt is-on' : 'cth-askme-opt'\}/, 'the Ask me option rows (DR5)');
  assert.match(src, /if \(runId\.current !== requestId\) return; \/\/ stopped, or a newer run/);
});

test('the hire wizard describes the job once, keeps a picked job\'s changes, and keeps its binding', () => {
  // Value: protects=DR12 and DR13, D7 at hire, and finding 1 on a regenerate; fails_when=the hire drops the change list, sends the bare routing, or Next runs before Apply; why_new=T5; seam=source pin
  const src = read('src/renderer/src/components/AddAgentModal.tsx');
  assert.match(src, /current: \{ instructions, handles: routing \},/, 'bindings go to main with the routing and come back word for word');
  assert.match(src, /if \(instructions\.trim\(\) && change\) setHireChanges\(\(c\) => \[\.\.\.c, \{ text: change, at: new Date\(\)\.toISOString\(\) \}\]\);/);
  assert.match(src, /jobChanges: sourceCard && hireChanges\.length \? hireChanges : undefined,/);
  assert.match(src, /box=\{\{ label: tr\('jobChange\.whatWillDo', \{ name: hireWho \}\)/);
  assert.match(src, /box=\{\{ label: tr\('jobChange\.anythingChange'\)/);
  assert.doesNotMatch(src, /suggestWorkStyle|workStyleSuggest/, 'Suggest me is retired');
});

test('a pack update carries the owner\'s changes into the preview, or says earlier edits are replaced', () => {
  // Value: protects=eng D7 and D8 on the offer itself; fails_when=the change list is not passed or the older edits line shows when changes carry over; why_new=T6; seam=pure
  const def = JSON.parse(read('resources/packs/saas-consulting.json')).agents.find((a) => a.id === 'pam');
  const cards = new Map([['saas-consulting/pam', def]]);
  const agents = [
    { id: 'pam', goal: 'old', jobChanges: [{ text: 'Sign replies', at: 'a' }, { text: 'Ask before refunds', at: 'b' }] },
    { id: 'pam-2', name: 'Erin', goal: 'old', sourceCard: 'saas-consulting/pam' }
  ];
  const offers = workStyleOffers(agents, cards, 'saas-consulting', { name: 'Sunrise' }, {});
  assert.deepEqual(offers.map((o) => [o.agentId, o.changes, o.olderEdits]), [['pam', ['Sign replies', 'Ask before refunds'], false], ['pam-2', [], true]]);
  assert.equal(offers[0].goal.trim(), teamMemberGoal(def, { name: 'Sunrise' }).trim());
  const card = read('src/renderer/src/components/WorkStyleUpdateCards.tsx');
  assert.match(card, /if \(offer\.changes\.length\) \{\s*return window\.cth\.workStyleRevise\(\{ requestId, ctx, current: \{ instructions: offer\.goal, handles: split\.roleDescription \}, changes: offer\.changes \}\);/);
  assert.match(card, /applyLabel=\{t\('jobChange\.useIt'\)\}\s*sendsTask=\{false\}\s*autoRun/, 'no card is promised: Use it sends none');
  assert.match(card, /t\('jobChange\.packOlderEdits', \{ name \}\)/);
  const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json')).jobChange;
  assert.equal(en.packTitle, 'A better job description for {{name}}');
  assert.equal(en.packKeptMany, 'Your {{count}} changes will be kept.');
});

test('the new strings have no dashes and say who, never "you" for a team member', () => {
  // Value: protects=the no dashes rule and plain owner copy in every locale; fails_when=a dash or a hyphen used as one slips into the new copy; why_new=T3 copy; seam=pure
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).jobChange;
    const flat = Object.entries(d).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : Object.entries(v).map(([k2, v2]) => [`${k}.${k2}`, v2])));
    for (const [k, v] of flat) assert.doesNotMatch(v, /[—–]| - /, `${loc} ${k}`);
  }
});
