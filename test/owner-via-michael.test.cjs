'use strict';
/**
 * The owner talks to team members through Michael, except in 1:1
 * (docs/designs/owner-talks-via-michael.md).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer, ASK_TOOL_REFUSAL, isTerminalPrompt } = loadTs('src/main/hooks.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

async function office(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-owner-via-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const server = new HookServer(hive, () => null, () => ({ notifications: false }), undefined, undefined);
  return { hive, server };
}

test("a team member's in-terminal question is refused and pointed at Michael", async (t) => {
  const { server } = await office(t);
  const res = await server.handle({ agent_id: 'pam', session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: {} });
  assert.equal(res.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(res.hookSpecificOutput.permissionDecisionReason, ASK_TOOL_REFUSAL);
  assert.match(ASK_TOOL_REFUSAL, /File it as one new file in the hive's triage folder/);
  assert.match(ASK_TOOL_REFUSAL, /Michael checks it and puts it on the owner's ASK ME board\./);
});

test('Michael may still ask the owner in his own session', async (t) => {
  const { server } = await office(t);
  const res = await server.handle({ agent_id: 'god', session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: {} });
  assert.notEqual(res?.hookSpecificOutput?.permissionDecision, 'deny');
});

test('a team member stuck on a prompt is restarted by the app, told to carry on, and Michael asks the owner plainly only if it comes back', async (t) => {
  // Value: protects=the owner is never told to open a terminal or 1:1, a stuck member gets going again, and Ask me never flaps; fails_when=the relay asks for a 1:1 again, a restarted member is left idle, Michael is told a restart worked before the session started, or a returning prompt restarts in a loop; why_new=owner 2026-10-15 (Pete's permission card), ship review 2026-10-16 (D3); seam=HookServer.restartStuck
  const { hive, server } = await office(t);
  // A business office: SessionStart returns the company profile, so it ends early in handle().
  server.getCompanyProfile = () => 'Acme Dental, a clinic in Austin.';
  let clock = 1_000_000;
  server.now = () => clock;
  const restarted = [];
  server.restartStuck = (id) => { restarted.push(id); return true; };
  const prompt = { agent_id: 'pam', session_id: 's', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' };
  await server.handle(prompt);
  clock += 5_000;
  await server.handle(prompt); // the same prompt, still on screen while the restart runs
  await server.handle({ agent_id: 'pam', session_id: 's', hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  assert.deepEqual(restarted, ['pam'], 'one restart, none for idle');
  const told = hive.inbox('pam').find((m) => /You were restarted/.test(m.subject));
  assert.ok(told, 'the member is told to carry on');
  assert.match(told.body, /Carry on with your current work\./);
  assert.equal(hive.inbox('god').length, 0, 'Michael hears nothing until the session starts again');
  const started = await server.handle({ agent_id: 'pam', session_id: 's2', hook_event_name: 'SessionStart', source: 'resume' });
  assert.ok(started?.hookSpecificOutput?.additionalContext, 'the session start carried context, as in a real office');
  let inbox = hive.inbox('god');
  assert.equal(inbox.length, 1);
  assert.match(inbox[0].subject, /Pam was restarted/);
  assert.match(inbox[0].body, /Check that Pam picks their work back up\. This is not for the owner's Ask me board: if you asked the owner whether Pam is stuck, withdraw that question\./);
  // Back again before Pam moved on: stuck for real, one plain ask through Michael, no second restart.
  clock += 10 * 60_000;
  await server.handle(prompt);
  await server.handle(prompt);
  clock += 60 * 60_000;
  await server.handle(prompt);
  assert.deepEqual(restarted, ['pam'], 'no restart loop while the episode lasts');
  inbox = hive.inbox('god');
  assert.equal(inbox.length, 2, 'one ask, no repeats, nothing withdrawn and raised again');
  const ask = inbox.find((m) => /Pam is stuck/.test(m.subject));
  assert.ok(ask);
  assert.match(ask.body, /restarting Pam did not clear it/);
  assert.match(ask.body, /never ask them to, and never mention terminals, prompts, sessions or a 1:1 chat/);
  assert.match(ask.body, /Move Pam's open work to a teammate who fits\./);
  for (const m of [...inbox, told]) {
    assert.doesNotMatch(m.body, /talk 1:1 with|answer it there|in that terminal/i);
    assert.doesNotMatch(m.body, /[\u2013\u2014]/);
  }
  // Once Pam moved on, a new prompt long after the restart is a new episode: restarted again.
  await server.handle({ agent_id: 'pam', session_id: 's2', hook_event_name: 'PostToolUse', tool_name: 'Read' });
  await server.handle(prompt);
  assert.deepEqual(restarted, ['pam', 'pam']);
});

test('the app\'s own wake note never starts a restart loop: a prompt soon after a restart goes to Michael', async (t) => {
  // Value: protects=paid restarts stay bounded; fails_when=the wake prompt or an inbox read ends the episode and the same prompt restarts the member again; why_new=ship re-review 2026-10-16; seam=HookServer.restartStuck
  const { hive, server } = await office(t);
  let clock = 1_000_000;
  server.now = () => clock;
  const restarted = [];
  server.restartStuck = (id) => { restarted.push(id); return true; };
  const prompt = { agent_id: 'pam', session_id: 's', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' };
  await server.handle(prompt);
  await server.handle({ agent_id: 'pam', session_id: 's2', hook_event_name: 'SessionStart', source: 'resume' });
  clock += 90_000;
  await server.handle({ agent_id: 'pam', session_id: 's2', hook_event_name: 'UserPromptSubmit', prompt: 'check your inbox' });
  await server.handle({ agent_id: 'pam', session_id: 's2', hook_event_name: 'PostToolUse', tool_name: 'Read' });
  await server.handle(prompt);
  assert.deepEqual(restarted, ['pam'], 'one restart');
  const stuck = hive.inbox('god').find((m) => /Pam is stuck/.test(m.subject));
  assert.ok(stuck);
  assert.match(stuck.body, /restarting Pam did not clear it/);
});

test('a restart whose new session never starts is no restart: Michael hears the member is still stuck', async (t) => {
  const { hive, server } = await office(t);
  let clock = 1_000_000;
  server.now = () => clock;
  server.restartStuck = () => true;
  await server.handle({ agent_id: 'pam', session_id: 's', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'needs your permission' });
  clock += 30_000;
  server.checkStuckRestarts();
  assert.equal(hive.inbox('god').length, 0, 'still within the minute');
  clock += 31_000;
  server.checkStuckRestarts();
  const inbox = hive.inbox('god');
  assert.equal(inbox.length, 1);
  assert.match(inbox[0].subject, /Pam is stuck/);
  assert.match(inbox[0].body, /the app could not restart Pam/);
});

test('a restart that starts after Michael heard it never did gets one follow up that it went through', async (t) => {
  // Value: protects=Michael doesn't move work or keep an Ask me question about a member whose late restart worked; fails_when=a late session start says nothing, says it twice, or a prompt that comes back after it never reaches Michael; why_new=TODOS "Tell Michael when a timed out restart worked after all"; seam=HookServer.checkStuckRestarts
  const { hive, server } = await office(t);
  let clock = 1_000_000;
  server.now = () => clock;
  server.restartStuck = () => true;
  const prompt = { agent_id: 'pam', session_id: 's', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'needs your permission' };
  await server.handle(prompt);
  clock += 61_000;
  server.checkStuckRestarts();
  assert.equal(hive.inbox('god').length, 1, 'Michael heard Pam is stuck');
  clock += 30_000;
  // A subagent starting is not Pam's session.
  await server.handle({ agent_id: 'pam', subagent_id: 'sub', session_id: 's2', hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(hive.inbox('god').length, 1);
  await server.handle({ agent_id: 'pam', session_id: 's2', hook_event_name: 'SessionStart', source: 'resume' });
  await server.handle({ agent_id: 'pam', session_id: 's3', hook_event_name: 'SessionStart', source: 'resume' });
  server.checkStuckRestarts();
  let inbox = hive.inbox('god');
  assert.equal(inbox.length, 2, 'one follow up, never two');
  const late = inbox.find((m) => m.subject === 'Pam was restarted after all');
  assert.ok(late);
  assert.equal(late.act, 'inform');
  assert.equal(late.from, 'system');
  assert.equal(late.body, "Pam's session started again after all, so the restart went through and Pam is not stuck. Leave Pam's open work with them, and if you asked the owner whether Pam is stuck, withdraw that question.");
  // Back on the prompt after that: Michael was told to withdraw, so he hears it again.
  await server.handle(prompt);
  inbox = hive.inbox('god');
  const stuck = inbox.filter((m) => /Pam is stuck/.test(m.subject));
  assert.equal(stuck.length, 2);
  assert.ok(stuck.some((m) => /restarting Pam did not clear it/.test(m.body)));
});

test('a restart that starts in time gets no follow up', async (t) => {
  const { hive, server } = await office(t);
  let clock = 1_000_000;
  server.now = () => clock;
  server.restartStuck = () => true;
  await server.handle({ agent_id: 'pam', session_id: 's', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'needs your permission' });
  clock += 30_000;
  await server.handle({ agent_id: 'pam', session_id: 's2', hook_event_name: 'SessionStart', source: 'resume' });
  clock += 31_000;
  server.checkStuckRestarts();
  await server.handle({ agent_id: 'pam', session_id: 's3', hook_event_name: 'SessionStart', source: 'resume' });
  assert.deepEqual(hive.inbox('god').map((m) => m.subject), ['Pam was restarted']);
});

test('with no window to restart them, Michael is told the member is stuck', async (t) => {
  const { hive, server } = await office(t);
  server.restartStuck = () => false;
  await server.handle({ agent_id: 'pam', session_id: 's', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'needs your permission' });
  const inbox = hive.inbox('god');
  assert.equal(inbox.length, 1);
  assert.match(inbox[0].subject, /Pam is stuck/);
  assert.match(inbox[0].body, /the app could not restart Pam/);
});

test("Michael's own prompts are not relayed to himself", async (t) => {
  const { hive, server } = await office(t);
  await server.handle({ agent_id: 'god', session_id: 's', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'needs your permission' });
  assert.equal(hive.inbox('god').length, 0);
});

test('isTerminalPrompt: permission and question dialogs, not idle', () => {
  assert.equal(isTerminalPrompt({ notification_type: 'permission_prompt' }), true);
  assert.equal(isTerminalPrompt({ notification_type: 'elicitation_dialog' }), true);
  assert.equal(isTerminalPrompt({ notification_type: 'idle_prompt' }), false);
  assert.equal(isTerminalPrompt({ message: 'Claude needs your permission to use Write' }), true);
  assert.equal(isTerminalPrompt({ message: 'Claude is waiting for your input' }), false);
});

test("outside 1:1 the owner only watches: keys, paste, drop and IME are dropped, the app's writes are not", () => {
  const pool = read('src/renderer/src/components/terminalPool.ts');
  assert.match(pool, /if \(entry\.inputLocked\) \{[\s\S]{0,300}return false;\s*\}/, 'every key is dropped while locked (copy still works)');
  assert.match(pool, /for \(const type of \['paste', 'drop', 'compositionend', 'beforeinput'\] as const\)/);
  assert.match(pool, /if \(!entry\.inputLocked\) pasteClipboard\(\);/);
  assert.match(pool, /export function setTerminalInputLocked\(ptyId: string, locked: boolean\)/);
  // App-originated writes go straight to writePty, never through the locked paths.
  assert.doesNotMatch(pool.slice(pool.indexOf('export function clearTerminalDraft'), pool.indexOf('function leaseWebglRenderer')), /inputLocked/);
});

test('team member panels lock input and swap the message box for the bar outside 1:1', () => {
  for (const f of ['src/renderer/src/components/AgentDetailPanel.tsx', 'src/renderer/src/components/FullscreenTerminal.tsx']) {
    const src = read(f);
    assert.match(src, /inputLocked=\{!agent\.onHold\}/, f);
    assert.match(src, /\{agent\.onHold \? <><OneOnOneLine agent=\{agent\} \/><MessageQueueComposer agent=\{agent\} \/><\/> : <OwnerViaMichaelBar agent=\{agent\} \/>\}/, f);
  }
  const strip = read('src/renderer/src/components/AgentControlStrip.tsx');
  assert.match(strip, /\{inOneOnOne && <div style=\{\{ display: 'flex', gap: 6 \}\}>/, 'steer only in 1:1');
  // 1:1 lives only in the bottom bar now, and the brakes are hidden (owner, 2026-09-25).
  assert.doesNotMatch(strip, /AgentHoldButton/);
  assert.ok(!fs.existsSync(path.resolve(__dirname, '../src/renderer/src/components/AgentHoldButton.tsx')));
  assert.match(strip, /if \(!SHOW_AGENT_BRAKES && !inOneOnOne\) return null;/);
  assert.match(strip, /\{SHOW_AGENT_BRAKES && <div/);
  assert.equal(loadTs('src/shared/buildFeatures.ts').SHOW_AGENT_BRAKES, false);
  const bar = read('src/renderer/src/components/OwnerViaMichaelBar.tsx');
  assert.match(bar, /s\.setDraft\(godId,/);
  assert.match(bar, /s\.requestCommandCenterTab\('terminal'\);/);
  assert.match(bar, /hiveSetAgentHold\?\.\(agentId, on\)/);
  assert.match(bar, /onClick=\{\(\) => setHold\(false\)\}/, 'End 1:1 lives in the bottom line');
  assert.match(bar, /function useSyncedHold\(agentId: string\)/, 'the 1:1 state is read back from the registry at launch');
});

test('new strings exist in every language, Michael by godName', () => {
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).ownerVia;
    for (const k of ['watching', 'aboutPrefix', 'explain', 'stuck', 'message', 'talk', 'holdFailed', 'inOneOnOne', 'inOneOnOneNote', 'endOneOnOne']) assert.ok(d?.[k], `${loc} ${k}`);
    assert.match(d.message, /\{\{godName\}\}/);
  }
});

test('a relay that failed to send is retried on the next prompt event', async (t) => {
  const { hive, server } = await office(t);
  const realSend = hive.send.bind(hive);
  let fail = true;
  hive.send = (...a) => { if (fail) { fail = false; throw new Error('inbox locked'); } return realSend(...a); };
  const prompt = { agent_id: 'pam', session_id: 's', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'needs your permission to use Bash' };
  await server.handle(prompt);
  assert.equal(hive.inbox('god').length, 0);
  await server.handle(prompt);
  assert.equal(hive.inbox('god').length, 1, 'not suppressed by the failed attempt');
});

test('unknown notification types are not treated as prompts', () => {
  assert.equal(isTerminalPrompt({ notification_type: 'permission_granted_info', message: 'fine' }), false);
});

test('the stuck bar keys on the team member prompt marker, and the Michael prefix never stacks', () => {
  const bar = read('src/renderer/src/components/OwnerViaMichaelBar.tsx');
  assert.match(bar, /const stuck = agent\.status === 'waiting' && agent\.action === ACTION_AT_PROMPT;/);
  assert.match(bar, /if \(!current\.trimEnd\(\)\.endsWith\(prefix\.trimEnd\(\)\)\)/);
  assert.match(read('src/renderer/src/hooks/usePtyParser.ts'), /action: ACTION_AT_PROMPT,/);
  assert.match(read('src/renderer/src/hooks/useHive.ts'), /\{ status: 'waiting', action: ACTION_AT_PROMPT[ ,]/);
});

test('agent panel tabs: messages, schedules, then the technical ones', () => {
  const tabs = read('src/renderer/src/components/SidebarTabs.tsx');
  const order = [...tabs.matchAll(/\{ key: '(\w+)',/g)].map((m) => m[1]);
  assert.deepEqual(order, ['profile', 'capabilities', 'messages', 'memory', 'terminal', 'git', 'traces']);
});

// Pre-landing review, 2026-09-25: in 1:1 the owner is at that terminal.
test('in 1:1 a prompt is not relayed to Michael and the agent may ask the owner in its terminal', async (t) => {
  const { hive, server } = await office(t);
  hive.setAgentHold('pam', true);
  await server.handle({ agent_id: 'pam', session_id: 's', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'needs your permission to use Bash' });
  assert.equal(hive.inbox('god').length, 0, 'the owner answers it there');
  const res = await server.handle({ agent_id: 'pam', session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: {} });
  assert.notEqual(res?.hookSpecificOutput?.permissionDecision, 'deny');
  hive.setAgentHold('pam', false);
  const denied = await server.handle({ agent_id: 'pam', session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: {} });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny', 'outside 1:1 it still goes to Michael');
});
