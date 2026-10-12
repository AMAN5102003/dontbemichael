'use strict';

/**
 * No agent's shell can rewrite the hook program or any agent's settings
 * (issue 100). The shell sandbox lets an agent write anywhere in the hive, and
 * two files there mattered: `<hive>/bin/cth-hook.cjs`, which Claude Code runs
 * outside the sandbox on every tool call, and each agent's `settings.json`,
 * which sets that agent's sandbox at its next start. The hook's folder is now on
 * every agent's deny-write list, and the settings live outside the hive.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

const inside = (dir, p) => {
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

test('agent settings live outside the hive, and the hook folder is denied to every shell', async (t) => {
  // Value: protects=an agent cannot escape its sandbox by editing the hook or its next start settings; fails_when=settings go back into the hive, or the hook folder leaves denyWrite; why_new=issue 100; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md settings out of hive '));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  const root = path.join(home, 'hive');
  const agentDir = path.join(root, 'agents', 'a1');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'settings.json'), '{"left":"by an older build"}');

  const inj = await hive.ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: home });
  const settingsPath = inj.args[inj.args.indexOf('--settings') + 1];

  assert.ok(!inside(root, settingsPath), 'the settings file is outside the hive');
  assert.equal(settingsPath, path.join(home, 'agent-settings', 'a1.json'));
  assert.equal(fs.existsSync(path.join(agentDir, 'settings.json')), false, 'the old copy in the agent folder is gone');

  const fsx = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).sandbox.filesystem;
  for (const w of fsx.allowWrite) assert.ok(!inside(w, settingsPath), `no writable folder (${w}) reaches the settings`);
  assert.ok(fsx.denyWrite.includes(path.join(root, 'bin')), 'the hook folder is denied to the shell');
  assert.ok(fs.existsSync(path.join(root, 'bin', 'cth-hook.cjs')), 'and the hook it protects is there');
});
