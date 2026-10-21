'use strict';

/**
 * A hire's first task is a card, not a line in the Work style
 * (docs/designs/first-task-card.md). Owner, 2026-10-03: what is the First task
 * for, what if the agent never does it, and what happens to it once done?
 * Before this, nothing started it, nothing tracked it, and it stayed in the
 * Work style forever.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const pack = (n) => JSON.parse(read(`resources/packs/${n}.json`));
const PACKS = ['core', 'home-services', 'pro-services', 'restaurant-food', 'retail-shop', 'saas-consulting'];
const { firstTaskCard, firstTaskCardId, withoutLegacyFirstTask } = loadTs('src/shared/firstTask.ts');
const { LEGACY_FIRST_TASKS } = loadTs('src/shared/legacyFirstTasks.ts');
const W = loadTs('src/shared/workStyleText.ts');
const { openOwnerRequests } = loadTs('src/shared/ownerRequests.ts');
const { parseStarterSchedule } = loadTs('src/shared/starterJobs.ts');

test('one-time first tasks are cards; recurring ones are scheduled jobs; waiting ones are gone', () => {
  // Value: protects=each kind of first task lands where it works (D1 table); fails_when=a one-time task is lost, a recurring one has no schedule, or a Kelly still waits on a first question; why_new=new; seam=none
  const withCard = (n) => pack(n).agents.filter((a) => a.firstTask).map((a) => a.id).sort();
  assert.deepEqual(withCard('saas-consulting'), ['creed', 'darryl', 'dwight', 'meredith', 'nick', 'pam', 'ryan', 'sadiq', 'toby']);
  assert.deepEqual(withCard('home-services'), ['creed', 'darryl', 'dwight', 'meredith', 'nick', 'pam', 'ryan', 'sadiq', 'toby']);
  assert.deepEqual(withCard('pro-services'), ['creed', 'darryl', 'dwight', 'meredith', 'nick', 'pam', 'sadiq', 'toby']);
  assert.deepEqual(withCard('restaurant-food'), ['creed', 'darryl', 'dwight', 'meredith', 'nick', 'pam', 'sadiq', 'toby']);
  assert.deepEqual(withCard('retail-shop'), ['creed', 'darryl', 'dwight', 'meredith', 'nick', 'pam', 'sadiq', 'toby']);
  assert.deepEqual(withCard('core'), []);
  for (const n of PACKS) {
    const p = pack(n);
    for (const id of ['kelly', 'oscar']) assert.equal(p.agents.find((a) => a.id === id)?.firstTask, undefined, `${n}/${id}`);
    const jobs = p.starterMissions || [];
    const oscar = jobs.find((j) => j.agentId === 'oscar');
    assert.deepEqual([oscar?.title, oscar?.schedule], ['Weekly money summary', 'mon 09:00'], n);
    for (const j of jobs) assert.ok(parseStarterSchedule(j.schedule, p.officeHours), `${n}: ${j.title}`);
  }
  const ryan = (n) => (pack(n).starterMissions || []).find((j) => j.agentId === 'ryan');
  assert.equal(ryan('restaurant-food').schedule, '09:00 on office days');
  assert.match(ryan('restaurant-food').focus, /If nothing has come in about what is on, ask the owner through Michael\./);
  assert.equal(ryan('retail-shop').schedule, 'mon 09:00');
  assert.match(ryan('pro-services').focus, /^On the first Monday of the month, draft the note to past clients[\s\S]*On other Mondays, stop without messaging anyone\.$/);
});

test('the card and Michael\'s request name the hire, once per agent id', () => {
  // Value: protects=Michael knows who to hand it to and a rerun never doubles it; fails_when=the id is not stable, the business is not filled, or a renamed hire gets the card name; why_new=new; seam=none
  const pam = pack('saas-consulting').agents.find((a) => a.id === 'pam');
  const now = new Date('2026-10-03T10:00:00Z');
  const first = firstTaskCard(pam, { agentId: 'pam-2', name: 'Erin' }, { name: 'Sunrise Bakery' }, now);
  assert.equal(first.card.id, firstTaskCardId('pam-2'));
  assert.equal(first.card.id, 'first-pam-2');
  assert.deepEqual([first.card.title, first.card.status, first.card.createdAt], ['Clear the inbox backlog', 'todo', now.toISOString()]);
  assert.equal(first.card.description, pam.firstTask.ask);
  assert.match(first.body, /^Erin \(Executive Admin\) just joined the team\. Their first task is on the card "Clear the inbox backlog":/);
  assert.match(first.body, /Hand it to Erin \(id pam-2\), then reply done to this request\. The card stays yours until the work is done\.$/);
  assert.doesNotMatch(first.body, /[–—]| - /);
  const filled = firstTaskCard({ id: 'x', role: 'Admin', firstTask: { title: 'Files at {Business}', ask: 'List the files at {Business}, {City}.' } }, { agentId: 'x' }, { name: 'Taco Shop', city: 'Austin' }, now);
  assert.deepEqual([filled.card.title, filled.card.description], ['Files at Taco Shop', 'List the files at Taco Shop, Austin.']);
  assert.equal(firstTaskCard(pack('saas-consulting').agents.find((a) => a.id === 'kelly'), { agentId: 'kelly' }, {}, now), null);
});

test('the request stays Michael\'s open work until he replies, and is sent only for a new card', () => {
  // Value: protects=a first task nobody hands out stays visible to Michael; fails_when=the request is not an owner request on the card, or a second call sends again; why_new=new; seam=source pin for the IPC
  const msg = { id: 'm1', from: 'human', act: 'request', conversation: 'card:first-pam', subject: 'Clear the inbox backlog', created_at: '2026-10-03T10:00:00Z', to: 'god' };
  assert.deepEqual(openOwnerRequests([msg], []).map((r) => r.taskId), ['first-pam']);
  assert.deepEqual(openOwnerRequests([msg], [{ id: 'r1', from: 'god', act: 'done', to: 'human', in_reply_to: 'm1', created_at: '2026-10-03T10:05:00Z' }]), []);
  const main = read('src/main/index.ts');
  const handler = main.slice(main.indexOf("ipcMain.handle('hive:firstTask'"), main.indexOf("ipcMain.handle('hive:addTask'"));
  assert.match(handler, /if \(!hive\.addTask\(first\.card\)\) \{\n\s+if \(!rawAsk\) return \{ ok: true, sent: false \};/, 'an existing card stops a pack first task');
  assert.match(handler, /hive\.send\(\{ to: MICHAEL_ID, act: 'request', subject: first\.card\.title, body: first\.body, conversation: cardConversation\(first\.card\.id\), requires_reply: true \}, 'human'\)/);
  assert.match(read('src/preload/index.ts'), /hiveFirstTask: \(sourceCard: string \| undefined, agentId: string, name: string, edited\?: \{ ask: string; role\?: string; existing\?: boolean \}\)/);
});

test('both hire paths send the first task; a job description update does not', () => {
  // Value: protects=a hire from Add agent and the onboarding team both get their card, and an existing member never does, a retried first start does; fails_when=a path forgets it or an update offer sends one; why_new=new; seam=source pin
  assert.match(read('src/renderer/src/components/AddAgentModal.tsx'), /void seedStarterJobs\(sourceCard, id\);[\s\S]{0,600}else if \(sourceCard && chosenJob\?\.source === 'card'\) void window\.cth\.hiveFirstTask\(sourceCard, id, name\.trim\(\)\)/);
  assert.match(read('src/renderer/src/hooks/useHive.ts'), /await seedStarterJobs\(`\$\{cardPack\.businessType\}\/\$\{id\}`, id\);[\s\S]{0,300}if \(retry \|\| !reg\?\.agents\?\.\[id\]\) await window\.cth\.hiveFirstTask\(`\$\{cardPack\.businessType\}\/\$\{id\}`, id, name\)/);
  assert.doesNotMatch(read('src/renderer/src/shell/workStyleOffers.ts'), /hiveFirstTask/);
});

test('team members hired before lose the pack\'s First task, and keep one the owner edited', () => {
  // Value: protects=old first tasks stop repeating while owner words stay (D1); fails_when=an unedited section stays, an edited one goes, or it runs twice; why_new=new; seam=source pin for the once flag
  const ws = pack('saas-consulting').agents.find((a) => a.id === 'dwight').workStyle;
  const old = LEGACY_FIRST_TASKS.find((t) => t.startsWith('Ask the owner, through Michael, for the open deals'));
  assert.equal(withoutLegacyFirstTask(`${ws}\n\n### First task\n${old}`), ws);
  assert.equal(withoutLegacyFirstTask(`${ws}\n\n### First task\nAsk the owner for the deals and the forecast.`), null, 'edited');
  assert.equal(withoutLegacyFirstTask(ws), null);
  assert.equal(withoutLegacyFirstTask(undefined), null);
  // Value: protects=a pack's old first task still comes out when it was rewrapped or kept as the owner's "First task:" label, and later sections stay; fails_when=the match stops ignoring line breaks and spacing, the label form is missed, or the section end swallows the next part; why_new=only the heading form at the end was checked; seam=none
  const wrapped = old.replace('who, value,', 'who,\n  value,');
  assert.equal(withoutLegacyFirstTask(`${ws}\n\n### First task\n${wrapped}\n\n### Needs the owner's approval\nRefunds.`), `${ws}\n\n### Needs the owner's approval\nRefunds.`);
  assert.equal(withoutLegacyFirstTask(`The job: Keeps the pipeline.\n\nFirst task: ${old}\n\nAsks the owner first: discounts.`), 'The job: Keeps the pipeline.\n\nAsks the owner first: discounts.');
  assert.equal(LEGACY_FIRST_TASKS.length, 29);
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /if \(config\.firstTasksRemoved\) return;/);
  assert.match(hive, /await window\.cth\.updateConfig\(\{ firstTasksRemoved: true \}\)/);
  assert.match(hive, /\.then\(\(\) => removeLegacyFirstTasks\(config\)\)\.catch\(\(\) => undefined\)\.then\(\(\) => startBusinessTeam\(config\)\);/);
});

test('an owner edit never brings a first task back into the Work style', () => {
  // Value: protects=a one-time job never becomes a standing duty through a rewrite (FT5); fails_when=a fallback keeps it or a prompt does not say to leave it out; why_new=the three section prompts folded or dropped it; seam=none
  const ws = '### The job\nSort mail.\n\n### First task\nAsk the owner for the suppliers.';
  const plain = W.plainFallback(ws, 'Erin');
  assert.doesNotMatch(plain, /first task|suppliers/i);
  assert.match(plain, /^The job:\nSort mail\.$/);
  const back = W.instructionsFallback('The job: Sorts mail.\n\nFirst task: ask the owner for the suppliers.\n\nAsks the owner first: refunds.', { name: 'Erin' });
  assert.doesNotMatch(back, /first task|suppliers/i);
  assert.match(back, /### Needs the owner's approval\nrefunds\./);
  assert.match(W.toPlainPrompt(ws, { name: 'Erin' }), /Leave out any first task: one time work is a card on the board/);
  assert.match(W.toInstructionsPrompt('The job: sorts mail.', { name: 'Erin' }), /Leave out any first task or other one time job: it goes on a card on the board/);
});

test('a duty sentence that starts with "First task" stays in the Work style', () => {
  // Value: protects=an owner duty like "First task each morning is the inbox" survives the First task cleanup and the plain and instructions fallbacks; fails_when=the heading match accepts prose without a heading or a colon; why_new=ship review 2026-10-03 (testing specialist, QA probe 002 deleted the whole How to work section); seam=none
  const W = loadTs('src/shared/workStyleText.ts');
  const ws = "### How to work\nFirst task each morning is the inbox, so nothing waits.\nThen reply to customers.\n\n### Needs the owner's approval\nRefunds.";
  assert.equal(W.firstTaskSection(ws), null);
  assert.match(W.plainFallback(ws, 'This role'), /inbox, so nothing waits[\s\S]*reply to customers/);
  // The real forms still come out: a heading, a heading with a colon, the owner's label.
  for (const head of ['### First task', '### First task:', 'First task:']) {
    const s = W.firstTaskSection(`### How to work\nSort mail.\n\n${head}\nWork out who is unpaid.\n\n### Needs the owner's approval\nRefunds.`);
    assert.equal(s?.body, 'Work out who is unpaid.', head);
  }
  assert.equal(W.firstTaskSection('First task: work out who is unpaid.')?.body, 'work out who is unpaid.');
});


test('an owner edited First task becomes a card for an existing hire, and a clone gets none', () => {
  // Value: protects=a First task the owner edited is handed to Michael as a card instead of silently dropped by the next save, and a clone does not repeat the teammate's one-time task; fails_when=the cleanup keeps edited text in the Work style, sends it as a new hire, or a team job sends the pack's first task; why_new=ship review SR1 and SR2, 2026-10-03; seam=none
  const F = loadTs('src/shared/firstTask.ts');
  const { card, body } = F.firstTaskCardFromText({ agentId: 'oscar', name: 'Oscar', role: 'Finance' }, 'First task for Oscar', 'Find every unpaid invoice.', new Date('2026-10-03T00:00:00Z'), { existing: true });
  assert.equal(card.id, F.firstTaskCardId('oscar'));
  assert.equal(card.description, 'Find every unpaid invoice.');
  assert.match(body, /had a first task in their Work style that the owner set/);
  assert.doesNotMatch(body, /just joined/);
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /edited\.push\(\{ a, ask: section\.body\.trim\(\) \}\);\n\s+patches\.push\(\{ id: a\.id, description: a\.description \?\? '', goal: section\.without \}\);/);
  assert.match(hive, /if \(!sent\.ok\) keep\(a\.id\);/, 'kept in the Work style when the card could not be made');
  const main = read('src/main/index.ts');
  assert.match(main, /const first = rawAsk\n\s+\? firstTaskCardFromText\(/);
  assert.match(main, /if \(typeof p\.agentId !== 'string' \|\| !\/\^\[A-Za-z0-9_-\]\{1,64\}\$\/\.test\(p\.agentId\)\) return \{ ok: false, error: 'invalid first task' \};/);
});

test('the old packs\' bare "First task" line is a heading, and a renamed manager still matches the pack text', () => {
  // Value: protects=the one-time cleanup removes an unedited pack First task written as a bare "First task" line (17 old cards) and still recognises it after Michael was renamed; fails_when=the heading match needs ### or a colon again, or the manager name is not mapped back; why_new=ship review pass 2 red team; seam=none
  const F = loadTs('src/shared/firstTask.ts');
  const { LEGACY_FIRST_TASKS } = loadTs('src/shared/legacyFirstTasks.ts');
  const body = LEGACY_FIRST_TASKS.find((t) => /through Michael/.test(t));
  const goal = `How to work\nKeep the pipeline current.\n\nFirst task\n${body}`;
  assert.equal(F.withoutLegacyFirstTask(goal), 'How to work\nKeep the pipeline current.');
  const renamed = goal.replace(/Michael/g, 'Scott');
  assert.equal(F.withoutLegacyFirstTask(renamed), null, 'without the name it reads as edited');
  assert.equal(F.withoutLegacyFirstTask(renamed, 'Scott'), 'How to work\nKeep the pipeline current.');
  assert.equal(F.FIRST_TASK_EDITED_MAX, 2000);
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /withoutLegacyFirstTask\(a\.goal, manager\)/);
  assert.match(hive, /closed\.has\(a\.id\) \|\| section\.body\.trim\(\)\.length > FIRST_TASK_EDITED_MAX\) continue;/);
});

test('a bare First task section ends at the old packs\' bare headings, a typed First task becomes a card, and the cleanup keeps standing duties scheduled', () => {
  // Value: protects=an old format First task stops at the next bare heading, a First task the owner types in the wizard or Edit goes to Michael as a card (its own id if the hire's first card exists), and hires cleaned of a pack First task get that card's starter jobs; fails_when=sections run into later ones, typed text is dropped, or the cleanup removes a standing duty with no schedule; why_new=ship review pass 3 (SR4, SR5); seam=none
  const W = loadTs('src/shared/workStyleText.ts');
  const s = W.firstTaskSection("The job\nSort mail.\n\nFirst task\nFind the suppliers.\n\nNeeds the owner's approval\nRefunds.");
  assert.equal(s.body, 'Find the suppliers.');
  assert.equal(s.without, "The job\nSort mail.\n\nNeeds the owner's approval\nRefunds.");
  const add = read('src/renderer/src/components/AddAgentModal.tsx');
  assert.match(add, /const typedFirstTask = firstTaskSection\(workStyle\)\?\.body\.trim\(\)\.slice\(0, FIRST_TASK_EDITED_MAX\) \|\| '';/);
  assert.match(add, /if \(typedFirstTask\) void sendTypedFirstTask\(sourceCard, id, name\.trim\(\), \{ ask: typedFirstTask, role: title\.trim\(\), existing: false \}\);/);
  const edit = read('src/renderer/src/components/EditAgentModal.tsx');
  assert.match(edit, /void sendTypedFirstTask\(agent\.sourceCard, agent\.id, trimmedName, \{ ask: typedFirstTask, role: role\.trim\(\), existing: true \}\);/);
  const main = read('src/main/index.ts');
  assert.match(main, /first\.card\.id = `\$\{first\.card\.id\}-\$\{now\.getTime\(\)\.toString\(36\)\}`;/);
  assert.match(main, /existing: p\.existing !== false/);
  assert.match(read('src/renderer/src/hooks/useHive.ts'), /if \(!\(await seedStarterJobs\(a\.sourceCard, a\.id, \{ paused: closed\.has\(a\.id\) \}\)\)\) \{ keep\(a\.id\); retry = true; \}/, 'cleaned hires keep their standing duties, switched off when closed');
});


test('a typed First task is never lost, and the cleanup schedules before it removes and tries again after a failure', async () => {
  // Value: protects=an owner's typed First task survives a failed card (it goes back under "First task:"), the cleanup never removes a standing duty it could not schedule, retries next launch, and adds a closed hire's jobs switched off; fails_when=the card send is fire and forget, seeding failures are swallowed, firstTasksRemoved is set after a failure, or a closed hire gets live schedules; why_new=Codex adversarial review pass 2, 2026-10-04; seam=fake window.cth and store
  const W = loadTs('src/shared/workStyleText.ts');
  // The kept words read back as a First task section.
  assert.equal(W.firstTaskSection('Sort the inbox.\n\nFirst task: Find the suppliers.').body, 'Find the suppliers.');
  const helper = read('src/renderer/src/shell/typedFirstTask.ts');
  assert.match(helper, /const res = await window\.cth\.hiveFirstTask\(sourceCard, agentId, name, edited\)\.catch\(\(\) => null\);\n  if \(res\?\.ok\) return;/);
  assert.match(helper, /s\.updateAgent\(agentId, \{ goal: `\$\{\(agent\.goal \?\? ''\)\.trim\(\)\}\\n\\nFirst task: \$\{edited\.ask\}`\.trim\(\) \}\);/);
  const seed = read('src/renderer/src/shell/seedStarterJobs.ts');
  assert.match(seed, /upsertMission\(opts\.paused \? \{ \.\.\.m, enabled: false \} : m\)\.then\(\(r\) => \(r as \{ ok\?: boolean \} \| undefined\)\?\.ok !== false, \(\) => false\)/);
  assert.match(seed, /catch \{\n    \/\/ The hire stands; the owner can add the job on the Access tab\.\n    return false;/);
  const hive = read('src/renderer/src/hooks/useHive.ts');
  const fn = hive.slice(hive.indexOf('async function removeLegacyFirstTasks'), hive.indexOf('async function', hive.indexOf('async function removeLegacyFirstTasks') + 10));
  assert.ok(fn.indexOf('seedStarterJobs(a.sourceCard, a.id))') < fn.indexOf('window.cth.hiveFirstTask('), 'an edited hire is scheduled before its card goes out');
  assert.ok(fn.indexOf('seedStarterJobs(') < fn.indexOf('rewriteInstructions(patches)'), 'scheduled before the words come out');
  assert.match(fn, /if \(!retry\) await window\.cth\.updateConfig\(\{ firstTasksRemoved: true \}\)/);
});
