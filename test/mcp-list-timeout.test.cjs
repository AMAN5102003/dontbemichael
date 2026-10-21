'use strict';

/**
 * The `claude mcp list` time limit stops the whole process tree (TODOS.md,
 * "Status check side effects"). `claude mcp list` starts every MCP server the
 * owner has; a plain execFile timeout signalled only its direct child (cmd.exe
 * for a Windows npm install), so `claude` and those servers kept running.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { readClaudeMcpList } = loadTs('src/main/claudeMcpList.ts');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function gone(pid, ms = 5_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !alive(pid);
}

// Value: protects=a timed out connector read leaves no process behind, on every platform and from a folder with a space; fails_when=the time limit goes back to execFile's own timeout (one signal to the direct child) or the POSIX run stops leading its own process group; why_new=the only timeout check kills the fake CLI from inside, so nothing below it was ever left running; seam=none
test('a timed out `claude mcp list` stops the CLI and the servers it started', async (t) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-list-')), 'with space');
  fs.mkdirSync(dir);
  const pidFile = (name) => path.join(dir, `${name}.pid`);
  const pids = [];
  t.after(() => {
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  // Stands in for `claude`: starts a long lived "MCP server", then hangs.
  const fake = path.join(dir, 'fake-claude.js');
  fs.writeFileSync(fake, [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "const server = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });",
    `fs.writeFileSync(${JSON.stringify(pidFile('server'))}, String(server.pid));`,
    `fs.writeFileSync(${JSON.stringify(pidFile('claude'))}, String(process.pid));`,
    'setTimeout(() => {}, 120000);'
  ].join('\n'));
  // Launched the way an install puts it on PATH: a .cmd launcher on Windows
  // (run through cmd.exe), a shell script elsewhere.
  let bin;
  if (process.platform === 'win32') {
    bin = path.join(dir, 'claude.cmd');
    fs.writeFileSync(bin, `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`);
  } else {
    bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, `#!/bin/sh\n"${process.execPath}" "${fake}" "$@"\n`);
    fs.chmodSync(bin, 0o755);
  }

  const res = await readClaudeMcpList(bin, 3_000);
  assert.deepEqual(res, { ok: false, why: 'timeout' });
  const names = ['claude', 'server'];
  for (const name of names) {
    assert.ok(fs.existsSync(pidFile(name)), `the fake ${name} started before the time limit`);
    pids.push(Number(fs.readFileSync(pidFile(name), 'utf8')));
  }
  for (const [i, name] of names.entries()) assert.ok(await gone(pids[i]), `the ${name} process is stopped with the read`);
});
