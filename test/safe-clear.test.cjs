'use strict';

/**
 * Clearing a team member's conversation without losing work (owner,
 * 2026-09-25): only when worth it (large, idle past the cache) and safe
 * (nothing open), after a handoff, never for Michael, and undoable.
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

const sc = loadTs('src/shared/safeClear.ts');
const { SafeClearer } = loadTs('src/main/safeClearer.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

const quiet = {
  isGod: false, isAssistant: false, isClaude: true, held: false, paused: false,
  contextTokens: 120_000, idleMs: 45 * 60_000, openCards: 0, inbox: 0, awaitingReplies: 0, openQuestions: 0
};

test('clear only when it\'s worth it and nothing is open; never Michael', () => {
  assert.equal(sc.clearBlocker(quiet), null);
  for (const [k, v, why] of [
    ['isGod', true, 'michael'], ['isAssistant', true, 'assistant'], ['isClaude', false, 'engine'],
    ['held', true, 'held'], ['paused', true, 'held'], ['contextTokens', 20_000, 'small'],
    ['idleMs', 5 * 60_000, 'active'], ['openCards', 1, 'open-card'], ['inbox', 2, 'inbox'],
    ['awaitingReplies', 1, 'awaiting-reply'], ['openQuestions', 1, 'open-question']
  ]) assert.equal(sc.clearBlocker({ ...quiet, [k]: v }), why, k);
});

test('the handoff request and the handoff context read plainly, with no dashes', () => {
  const ask = sc.handoffRequest('/h/memory/handoff.md', '/h/memory/inbox.md');
  assert.match(ask, /write it to \/h\/memory\/handoff\.md/);
  assert.match(ask, /If nothing is, write "Nothing open\." there\./);
  assert.match(sc.handoffContext('Invoice for Acme half done.'), /^HANDOFF FROM YOUR PREVIOUS CONVERSATION\.[\s\S]*Invoice for Acme half done\.$/);
  assert.doesNotMatch(ask + sc.handoffContext('x'), /[–—]/);
});

function rig(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-safeclear-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = 1_000_000_000;
  const typed = [];
  const log = [];
  const clears = [];
  let facts = { ...quiet, ...overrides };
  const handoff = path.join(dir, 'handoff.md');
  const clearer = new SafeClearer({
    agents: () => [{ id: 'oscar', ptyId: 'pty-oscar', lastOutputAt: now - facts.idleMs, facts }],
    handoffPath: () => handoff,
    memoryInboxPath: () => path.join(dir, 'inbox.md'),
    lastSession: () => 'old-session',
    recordClear: (id, s) => clears.push(s),
    type: (pty, text) => typed.push(text),
    log: (e) => log.push(e),
    now: () => now
  });
  return {
    clearer, typed, log, clears, handoff,
    tick: (ms) => { now += ms; },
    set: (f) => { facts = { ...facts, ...f }; },
    writeHandoff: (text) => { fs.writeFileSync(handoff, text); fs.utimesSync(handoff, now / 1000, now / 1000); }
  };
}

test('ask for a handoff, wait for it and for the turn to end, then clear', (t) => {
  const r = rig(t);
  r.clearer.beat();
  assert.equal(r.typed.length, 1);
  assert.match(r.typed[0], /^Fresh start coming/);
  // The agent works on the handoff: activity, then it writes the note and stops.
  r.set({ idleMs: 0 }); r.tick(30_000); r.clearer.beat();
  assert.equal(r.typed.length, 1, 'not while it is writing');
  r.writeHandoff('Nothing open.');
  r.clearer.noteHook('oscar', 'Stop');
  r.tick(30_000); r.set({ idleMs: 30_000 });
  r.clearer.beat();
  assert.deepEqual(r.typed.slice(1), ['/clear']);
  assert.equal(r.clears[0].oldSession, 'old-session', 'the earlier conversation is kept for undo');
  assert.equal(r.log.at(-1).kind, 'clear');
});

test('new work cancels the clear and throws the handoff away', (t) => {
  const r = rig(t);
  r.clearer.beat();
  r.writeHandoff('Half way through the Acme invoice.');
  r.set({ inbox: 1 });
  r.tick(60_000);
  r.clearer.beat();
  assert.equal(r.typed.length, 1, 'no /clear');
  assert.equal(r.log.at(-1).kind, 'clear-cancelled');
  assert.equal(r.log.at(-1).reason, 'inbox');
  assert.equal(fs.existsSync(r.handoff), false);
});

test('nothing is typed while the agent waits on the owner at a prompt', (t) => {
  const r = rig(t);
  r.clearer.noteHook('oscar', 'Notification', 'Claude needs your permission to use Bash');
  r.clearer.beat();
  assert.equal(r.typed.length, 0, 'no handoff typed into a permission prompt');
  r.clearer.noteHook('oscar', 'PostToolUse');
  r.tick(45 * 60_000);
  r.clearer.beat();
  assert.equal(r.typed.length, 1, 'once it moves on and is idle again, the ask can go');
  r.clearer.noteHook('oscar', 'Notification', 'Please approve this command');
  r.clearer.beat();
  assert.equal(r.log.at(-1).reason, 'waiting-for-owner', 'an ask in flight is cancelled');
  r.clearer.noteHook('oscar', 'Notification', 'Claude is waiting for your input');
  r.tick(45 * 60_000);
  r.clearer.beat();
  assert.equal(r.typed.length, 1, 'an idle notice can come while the prompt is still open');
  r.clearer.noteHook('oscar', 'SessionStart');
  r.tick(45 * 60_000);
  r.clearer.beat();
  assert.equal(r.typed.length, 2, 'a new session means the prompt is gone');
});

test("a subagent's tool calls do not end the wait at a prompt, the agent's own do", (t) => {
  // Value: protects=the handoff's Enter never answers a prompt still on screen; fails_when=a Task subagent's PostToolUse counts as moving on; why_new=review of #507, 2026-10-21, the same rule as the worker wake hold; seam=none
  const r = rig(t);
  r.clearer.noteHook('oscar', 'Notification', 'Claude needs your permission to use Bash');
  r.clearer.noteHook('oscar', 'PreToolUse', undefined, true);
  r.clearer.noteHook('oscar', 'PostToolUse', undefined, true);
  r.tick(45 * 60_000);
  r.clearer.beat();
  assert.equal(r.typed.length, 0, 'no handoff typed while the prompt is still open');
  r.clearer.noteHook('oscar', 'PostToolUse');
  r.tick(45 * 60_000);
  r.clearer.beat();
  assert.equal(r.typed.length, 1, 'the agent moving on frees it');
});

test('someone speaking to the agent after its handoff keeps the conversation', (t) => {
  const r = rig(t);
  r.clearer.beat();
  r.writeHandoff('Nothing open.');
  r.clearer.noteHook('oscar', 'Stop');
  r.tick(5_000);
  r.clearer.noteHook('oscar', 'UserPromptSubmit');
  r.clearer.noteHook('oscar', 'Stop');
  r.tick(30_000); r.set({ idleMs: 30_000 });
  r.clearer.beat();
  assert.ok(!r.typed.includes('/clear'));
  assert.equal(r.log.at(-1).reason, 'new-prompt');
});

test('no handoff within ten minutes: give up, leave the conversation alone', (t) => {
  const r = rig(t);
  r.clearer.beat();
  r.tick(11 * 60_000);
  r.clearer.beat();
  assert.equal(r.log.at(-1).reason, 'no-handoff');
  assert.ok(!r.typed.includes('/clear'));
});

test('the hive answers what is open, keeps the handoff for one session start, and restores a session', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-safeclear-hive-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  hive.writeTasks([
    { id: 't1', title: 'A', assignee: 'oscar', status: 'doing', dependsOn: [], priority: 1, createdAt: 'x' },
    { id: 't2', title: 'B', assignee: 'oscar', status: 'done', dependsOn: [], priority: 1, createdAt: 'x' },
    { id: 't3', title: 'C', assignee: 'pam', status: 'blocked', dependsOn: [], priority: 1, createdAt: 'x', humanQA: [{ q: 'ok?', raisedBy: 'oscar' }] }
  ]);
  assert.equal(hive.openCardsFor('oscar'), 1);
  assert.equal(hive.openQuestionsRaisedBy('oscar'), 1);

  const sentDir = path.join(home, 'hive', 'agents', 'oscar', 'outbox', '.sent');
  const msg = { id: 'm1', conversation: 'c1', in_reply_to: null, from: 'oscar', to: 'pam', act: 'query', subject: 's', body: 'b', hops: 0, requires_reply: true, needs_human: false, created_at: new Date().toISOString() };
  fs.writeFileSync(path.join(sentDir, 'm1.json'), JSON.stringify(msg));
  assert.equal(hive.awaitingReplies('oscar'), 1);
  const reply = { ...msg, id: 'm2', in_reply_to: 'm1', from: 'pam', to: 'oscar', act: 'inform', requires_reply: false, created_at: new Date(Date.now() + 1000).toISOString() };
  fs.writeFileSync(path.join(home, 'hive', 'agents', 'oscar', 'inbox', '.done', 'm2.json'), JSON.stringify(reply));
  assert.equal(hive.awaitingReplies('oscar'), 0, 'answered');

  fs.writeFileSync(hive.handoffPath('oscar'), 'Nothing open.');
  assert.equal(hive.takeHandoff('oscar'), 'Nothing open.');
  assert.equal(hive.takeHandoff('oscar'), null, 'given once');

  hive.recordSession('oscar', 'new-session');
  hive.recordClear('oscar', { at: 1, oldSession: 'old-session', tokensBefore: 90_000 });
  assert.equal(hive.clearedState('oscar').oldSession, 'old-session');
  hive.restoreSession('oscar', 'old-session');
  assert.equal(hive.lastSession('oscar'), 'old-session');
});

test('wiring: a beat each minute, the handoff at session start, undo through the resume path, and no clock clearing', () => {
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  const main = read('src/main/index.ts');
  assert.match(main, /safeClearTimer = setInterval\(\(\) => \{ try \{ safeClearer\.beat\(\); \}/);
  assert.match(main, /safeClearer\.noteHook\(agentId, event, message, subagent\)/);
  assert.match(main, /hive\.restoreSession\(id, state\.oldSession\);/);
  assert.match(main, /send\('power:resume', \{ reason: 'restore-conversation', awayMs: 0, dead: \[ptyId\], total: 1 \}\)/);
  const hooks = read('src/main/hooks.ts');
  assert.match(hooks, /const handoffText = event === 'SessionStart' && p\.source === 'clear' && agentId \? \(this\.hive\.takeHandoff\?\.\(agentId\) \?\? null\) : null;/);
  assert.match(read('src/renderer/src/components/AgentDetailPanel.tsx'), /<ClearedBanner agentId=\{agent\.id\} name=\{agent\.name\} \/>/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    assert.ok(d.clearedBanner.bringBack && d.clearedBanner.text, loc);
    assert.doesNotMatch(JSON.stringify(d.clearedBanner), /[–—]/, loc);
  }
});
