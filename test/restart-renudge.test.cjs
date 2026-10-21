'use strict';

/**
 * A restarted agent is told again about mail still in its inbox. Owner report,
 * 2026-10-12: setup skipped the Claude sign in, the office open standup was
 * nudged into Michael's signed out Claude ("Not logged in"), the owner saved an
 * API key on Ask me and Michael restarted, and the office stayed idle: the
 * inbox wake remembers every message it has nudged about, so the standup was
 * never named to the new process.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('a new Claude session reaches the window with its source', async (t) => {
  // Value: protects=the renderer learns that a start or a resume replaced the process; fails_when=SessionStart or its source stops reaching the window; why_new=no test watched what the window receives for SessionStart; seam=none; no_claim=Claude firing SessionStart (its documented hook)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-renudge-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god-1', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  const sent = [];
  const server = new HookServer(hive, () => ({ send: (channel, payload) => sent.push({ channel, payload }) }), () => ({ notifications: false }), undefined, undefined);
  for (const source of ['startup', 'resume', 'compact']) {
    await server.handle({ agent_id: 'god-1', hook_event_name: 'SessionStart', session_id: 's1', source });
  }
  const starts = sent.filter((m) => m.channel === 'hive:hookEvent' && m.payload.event === 'SessionStart');
  assert.deepEqual(starts.map((m) => [m.payload.agentId, m.payload.source]), [['god-1', 'startup'], ['god-1', 'resume'], ['god-1', 'compact']]);
});

test('a start or a resume forgets what the agent was nudged about; a compact or clear does not', () => {
  // Value: protects=unread mail is named again to a restarted agent, and only to a new process; fails_when=the reset is dropped, or fires on compact/clear too; why_new=the inbox wake never forgot an id; seam=none; no_claim=the renderer effect running (source assertion; no React harness)
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /if \(e\.event === 'SessionStart' && \(e\.source === 'startup' \|\| e\.source === 'resume'\)\) delete nudged\.current\[e\.agentId\];/);
  // The reset sits in the hook handler, after the agent id check, before anything that returns early.
  const handler = hive.slice(hive.indexOf('return window.cth.onHiveHookEvent((e) => {'));
  assert.ok(handler.indexOf("delete nudged.current[e.agentId]") < handler.indexOf('const self = agents.find'), 'runs for every agent event, before the lookups that can return');
});
