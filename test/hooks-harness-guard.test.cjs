'use strict';

/**
 * The harness guard as agents actually meet it: through the PreToolUse hook
 * (Decision 48). harness-guard.test.cjs pins the pure decision; this pins the
 * wiring in HookServer, which is what turns a decision into a refusal Claude
 * Code obeys, and which decides WHEN the guard applies at all.
 *
 * The two ways this can go wrong: the hook never refuses (the pure function is
 * right but nothing calls it, so documents keep landing in the hive), or it
 * refuses on an older install with no Office folder, where Michael still works
 * inside the harness folder and would be locked out of his own memory.
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
  exports: {
    Notification: class {
      show() {}
      static isSupported() { return false; }
    }
  }
};

const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');

async function floor(t, config) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'md-hooks-guard-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  // The harness folder and the owner's Documents are siblings, as on a real Mac.
  const home = path.join(base, 'HarnessAgents');
  const office = path.join(base, 'Documents', 'Pho', 'Office');
  const finance = path.join(base, 'Documents', 'Pho', 'Finance');
  fs.mkdirSync(home, { recursive: true });
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: finance });
  const cfg = typeof config === 'function' ? config({ home, office }) : config;
  const sent = [];
  const wc = { send: (channel, payload) => sent.push({ channel, payload }) };
  const server = new HookServer(hive, () => wc, () => cfg, undefined, undefined);
  const write = (file_path, over = {}) => server.handle({
    agent_id: 'oscar',
    session_id: 's1',
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path, content: 'x' },
    cwd: finance,
    ...over
  });
  return { home, hiveRoot: path.join(home, 'hive'), finance, write, sent };
}

const denied = (r) => r && r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny';

test('on a business install, a document written into the hive is refused through the hook', async (t) => {
  const f = await floor(t, ({ home, office }) => ({ harnessHome: home, officeFolder: office }));
  const r = await f.write(path.join(f.hiveRoot, 'shared', 'brand-voice.md'));
  assert.ok(denied(r), 'Claude Code only obeys a PreToolUse deny in hookSpecificOutput');
  assert.equal(r.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /only for coordination/);
  assert.ok(r.hookSpecificOutput.permissionDecisionReason.includes(f.finance), 'names the agent\'s own folder');
  // The floor hears about it too, so the owner can see an agent was steered.
});

test('the same install still lets an agent write its memory and its work, and read anything', async (t) => {
  const f = await floor(t, ({ home, office }) => ({ harnessHome: home, officeFolder: office }));
  assert.ok(!denied(await f.write(path.join(f.hiveRoot, 'agents', 'oscar', 'memory', 'inbox.md'))));
  assert.ok(!denied(await f.write(path.join(f.finance, 'march-summary.md'))));
  // Tools that do not write a file are never judged, even aimed at the hive.
  const read = await f.write(path.join(f.hiveRoot, 'shared', 'x.md'), { tool_name: 'Read', tool_input: { file_path: path.join(f.hiveRoot, 'board.md') } });
  assert.ok(!denied(read));
});

test('an older install with no Office folder is left exactly as before', async (t) => {
  // Michael on such an install works INSIDE the harness folder; refusing here
  // would lock him out of the only place he has.
  const f = await floor(t, ({ home }) => ({ harnessHome: home }));
  assert.ok(!denied(await f.write(path.join(f.hiveRoot, 'shared', 'brand-voice.md'))));
});

test('Michael keeps his board through the real hook, and is still kept out of the rest of the hive', async (t) => {
  // HookServer decides isGod from the agent id; a broken wiring would refuse
  // Michael his own board on every business install.
  const f = await floor(t, ({ home, office }) => ({ harnessHome: home, officeFolder: office }));
  assert.ok(!denied(await f.write(path.join(f.hiveRoot, 'board.md'), { agent_id: 'god' })));
  assert.ok(denied(await f.write(path.join(f.hiveRoot, 'shared', 'x.md'), { agent_id: 'god' })));
});
