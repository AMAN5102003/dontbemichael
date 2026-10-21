'use strict';

/**
 * Agent schedule requests (docs/designs/per-agent-schedules.md, R3 and R6) and
 * the owner-close pause (R1).
 *
 * An agent never changes a schedule itself (owner, 2026-09-25): a message to
 * "scheduler" carrying a `schedule` object goes to main's handler, which files a
 * request for ASK ME and returns the reply the agent gets. The sender is the
 * outbox folder, never anything the message claims.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-sched-req-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god-1', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'pam-1', name: 'Pam', provider: 'claude', cwd: home });
  const outbox = (id) => path.join(home, 'hive', 'agents', id, 'outbox');
  const drop = (id, msg) => fs.writeFileSync(path.join(outbox(id), `m-${Date.now()}-${Math.random()}.json`), JSON.stringify(msg));
  return { hive, drop };
}

test('a schedule request goes to the handler with the folder as the actor, and the reply goes back to that agent only', async (t) => {
  const { hive, drop } = await floor(t);
  const calls = [];
  hive.onScheduleRequest((actor, payload) => { calls.push({ actor, payload }); return 'Sent to the owner.'; });

  // The message claims to be from god; the folder says Pam, and the folder wins.
  drop('pam-1', { to: 'scheduler', from: 'god-1', act: 'request', subject: 'schedule', body: '', schedule: { op: 'add', label: 'Check invoices', when: { every: '1d' } } });
  hive.routeOnce();

  assert.deepEqual(calls, [{ actor: 'pam-1', payload: { op: 'add', label: 'Check invoices', when: { every: '1d' } } }]);
  const pamInbox = hive.inbox('pam-1');
  assert.equal(pamInbox.length, 1);
  assert.equal(pamInbox[0].from, 'scheduler');
  assert.equal(pamInbox[0].body, 'Sent to the owner.');
  assert.equal(hive.inbox('god-1').length, 0, 'Michael is not copied');
});

test('a plain message to the scheduler is still dropped quietly', async (t) => {
  const { hive, drop } = await floor(t);
  let called = false;
  hive.onScheduleRequest(() => { called = true; return ''; });
  drop('pam-1', { to: 'scheduler', act: 'inform', subject: 'standup done', body: '' });
  hive.routeOnce();
  assert.equal(called, false);
  assert.equal(hive.inbox('pam-1').length, 0);
  assert.equal(hive.inbox('god-1').length, 0);
});

test('a handler that throws still answers the agent and never crashes the router', async (t) => {
  const { hive, drop } = await floor(t);
  hive.onScheduleRequest(() => { throw new Error('boom'); });
  drop('pam-1', { to: 'scheduler', act: 'request', subject: 's', body: '', schedule: { op: 'list' } });
  assert.doesNotThrow(() => hive.routeOnce());
  assert.match(hive.inbox('pam-1')[0].body, /not sent/);
});

test('closedByOwner is set on purpose and cleared when the agent starts again', async (t) => {
  const { hive } = await floor(t);
  hive.setClosedByOwner('pam-1', true);
  assert.equal(hive.registry().agents['pam-1'].closedByOwner, true);
  hive.setArchived('pam-1', true);
  await hive.ensureAgent({ id: 'pam-1', name: 'Pam', provider: 'claude', cwd: hive.registry().agents['pam-1'].cwd });
  assert.equal(hive.registry().agents['pam-1'].closedByOwner, false);
});

test('only the owner closing an agent pauses its schedules; a crash, quit or boot never does', () => {
  const main = read('src/main/index.ts');
  // The PTY exit path and boot orphaning archive, and must not pause.
  const exit = main.slice(main.indexOf('// 1) Archive the agent'), main.indexOf('// 2) Remove the isolated worktree'));
  assert.match(exit, /hive\.setArchived\(agentId, true\)/);
  assert.doesNotMatch(exit, /closeAgentByOwner|pauseMissionsOf/);
  const orphan = main.slice(main.indexOf('function archiveOrphanedAgents(): void {'), main.indexOf('function archiveOrphanedAgents(): void {') + 1200);
  assert.doesNotMatch(orphan, /closeAgentByOwner|pauseMissionsOf/);
  const migrate = main.slice(main.indexOf('function migrateMissionOwners(): void {'), main.indexOf('function hiveGodId'));
  assert.doesNotMatch(migrate, /archived|pause/i, 'the upgrade pauses nothing');
  // The owner's close paths do pause.
  for (const f of ['src/renderer/src/components/AgentDetailPanel.tsx', 'src/renderer/src/components/FullscreenTerminal.tsx']) {
    const src = read(f);
    const kill = src.slice(src.indexOf('const onKill = async () => {'));
    assert.ok(kill.indexOf('closeAgentByOwner(agent.id)') < kill.indexOf('killPty(agent.ptyId)'), `${f} pauses before the terminal closes`);
  }
  assert.match(main, /if \(archived\) closeAgentByOwner\(id\);/, 'voice archive is the owner closing it');
});

test('the renderer can only change one schedule at a time', () => {
  const main = read('src/main/index.ts');
  const preload = read('src/preload/index.ts');
  assert.doesNotMatch(main, /'missions:save'/, 'the whole-list save is gone');
  assert.doesNotMatch(preload, /saveMissions/);
  for (const ch of ['missions:upsert', 'missions:delete', 'missions:setEnabled', 'scheduleRequests:decide']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${ch}'`));
  }
});

test('approving a request goes through the stale check and the one-schedule write', () => {
  const requests = read('src/main/scheduleRequests.ts');
  const fn = requests.slice(requests.indexOf('function decideScheduleRequest('));
  // Applied inside the single writer, against the list as it is when written;
  // applyScheduleRequest refuses a stale request itself.
  assert.match(fn, /applyMissions\(\(list\) => \{\s*const applied = applyScheduleRequest\(req, list,/);
  assert.match(fn, /if \(refused\) return \{ ok: false, error: refused \};/);
  assert.ok(fn.indexOf('describeScheduleRequest(req, cfg.missions') < fn.indexOf('if (approve)'), 'the schedule is named before a delete removes it');
  assert.ok(fn.indexOf('if (approve)') < fn.indexOf('applyMissions('), 'decline never writes schedules');
});

test('new schedule strings exist in every language', () => {
  const keys = {
    schedulesSection: ['officeEmpty', 'emptyAgent', 'addFor', 'agentSummary', 'agentSummaryPlural', 'loading',
      'loadError', 'saveFailed', 'sure', 'deleteIt', 'keep', 'addedBy', 'runAria', 'closedGroup', 'closedNote', 'relayHint'],
    askMe: ['scheduleTitle', 'scheduleAdd', 'scheduleUpdate', 'schedulePause', 'scheduleResume', 'scheduleDelete', 'scheduleStale', 'approve', 'decline'],
    agentDetail: ['killConfirmSchedules', 'killConfirmSchedulesPlural'],
    capabilities: ['schedules', 'schedulesBlurb', 'schedulesOn', 'schedulesNone', 'emailBlurb', 'emailNone', 'pickMailbox', 'addMailbox']
  };
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    for (const [sec, ks] of Object.entries(keys)) for (const k of ks) assert.ok(d[sec]?.[k], `${loc} ${sec}.${k}`);
    assert.equal(d.schedulesSection.goesTo, undefined, `${loc}: GOES TO is gone`);
    assert.ok(d.commandCenter.tabs.officeSchedule, `${loc} commandCenter.tabs.officeSchedule`);
  }
});

test('agents are told how to ask, in both protocols', () => {
  const hive = read('src/main/hive.ts');
  // One copy, used by both protocol files (simplification review, 2026-09-25).
  assert.equal((hive.match(/## Your schedules/g) ?? []).length, 1);
  assert.equal((hive.match(/\$\{SCHEDULES_PROTOCOL\}/g) ?? []).length, 2);
  assert.match(hive, /You never change a schedule yourself: you ask, and Michael, who manages the office, approves or declines it/);
  assert.match(hive, /'## Schedule requests',/, "Michael is told how to decide them");
});

test('only Michael notifies: every desktop toast in main is his, or one of the app\'s own warnings', () => {
  // docs/designs/michael-only-notifications.md. Team members never toast.
  const main = read('src/main/index.ts');
  const titles = [...main.matchAll(/new Notification\(\{ title: ([^,]+),/g)].map((m) => m[1].trim());
  for (const t of titles) assert.ok(['michaelName()', 'title'].includes(t), `unexpected toast title ${t}`);
  const toasts = [...main.matchAll(/ownerToast\(([^,]+),/g)].map((m) => m[1].trim()).filter((t) => t !== 'title: string');
  // Two of Michael's are the office break starting and ending (issue 124).
  assert.deepEqual(toasts.sort(), ["'Agent running degraded'", "'Agents need a restart'", 'michaelName()', 'michaelName()', 'michaelName()', 'michaelName()'].sort());
  // Schedule requests (scheduleRequests.ts) toast only as Michael too.
  const requests = read('src/main/scheduleRequests.ts');
  assert.deepEqual([...requests.matchAll(/deps\.ownerToast\(([^,]+),/g)].map((m) => m[1].trim()), ['deps.michaelName()', 'deps.michaelName()']);
  assert.match(main, /toast: \(body\) => ownerToast\(michaelName\(\), body\)/, 'an email to approve is announced by Michael');
  assert.doesNotMatch(main, /constrained`/, 'a constrain no longer toasts');
  assert.match(main, /ownerToast\(michaelName\(\), `I stopped \$\{name\}: \$\{reason\}`\);/);
  assert.match(requests, /deps\.ownerToast\(deps\.michaelName\(\), `\$\{name\}'s schedule change needs you in ASK ME\.`\);/, 'only when Michael passes it on');
  assert.match(read('src/main/hooks.ts'), /if \(!agentId \|\| !this\.isGod\(agentId\)\) return(?: false)?;/);
});

test('a save that landed is reported as saved even if re-arming the timers fails', () => {
  const main = read('src/main/index.ts');
  const fn = main.slice(main.indexOf('function applyMissions('), main.indexOf('const isMission ='));
  assert.match(fn, /writeConfig\(\{ missions: next \}\);\s*\n(?:\s*\/\/.*\n)*\s*try \{ syncMissions\(\); \} catch/);
});

test('voice unarchive clears closed-by-owner', () => {
  const main = read('src/main/index.ts');
  assert.match(main, /if \(archived\) closeAgentByOwner\(id\);\s*\n(?:\s*\/\/.*\n)*\s*else hive\.setClosedByOwner\(id, false\);/);
});
