'use strict';

/**
 * Claude Code runs an agent's hook and status line commands in bash, or on
 * Windows in PowerShell when it finds no Git Bash (2.1.296). A Windows office
 * without Git for Windows got `"<launcher>" "<cth-hook.cjs>"`, which PowerShell
 * refuses to parse ("Unexpected token ... in expression or statement"), so
 * every hook failed and Michael's terminal showed the error (owner, 2026-10-09).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const { findGitBash, hookShell, shellCommand } = loadTs('src/main/hookShell.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

const LAUNCHER = 'C:\\Users\\hello\\HarnessAgents\\hive\\bin\\hive-node.cmd';
const SHIM = 'C:\\Users\\hello\\HarnessAgents\\hive\\bin\\cth-hook.cjs';
const has = (...paths) => (p) => paths.includes(p);

test('Git Bash is found the way Claude Code finds it, and decides the shell', () => {
  // Value: protects=the app and Claude Code agree on the shell, so the status line (which has no shell field) parses; fails_when=the order or the git on PATH rule drifts from Claude Code, or a non bash path is taken; why_new=the app assumed cmd.exe on Windows; seam=fake exists
  const set = 'D:\\Tools\\Git\\bin\\bash.exe';
  assert.equal(findGitBash({ CLAUDE_CODE_GIT_BASH_PATH: set }, has(set, 'C:\\Program Files\\Git\\bin\\bash.exe')), set, 'the set path first');
  assert.equal(findGitBash({ CLAUDE_CODE_GIT_BASH_PATH: 'D:\\Tools\\zsh.exe' }, has('D:\\Tools\\zsh.exe')), null, 'only bash or sh');
  assert.equal(findGitBash({}, has('C:\\Program Files (x86)\\Git\\bin\\bash.exe')), 'C:\\Program Files (x86)\\Git\\bin\\bash.exe');
  const env = { Path: 'C:\\Windows\\System32;D:\\Git\\cmd', PATHEXT: '.COM;.EXE' };
  assert.equal(findGitBash(env, has('D:\\Git\\cmd\\git.exe', 'D:\\Git\\bin\\bash.exe')), 'D:\\Git\\bin\\bash.exe', 'git on PATH, any case of Path');
  assert.equal(findGitBash(env, has('D:\\Git\\cmd\\git.exe')), null, 'git without its bash');
  assert.equal(findGitBash({ PATH: 'C:\\Windows; "E:\\Git Tools\\cmd" ' }, has('E:\\Git Tools\\cmd\\git.exe', 'E:\\Git Tools\\bin\\bash.exe')), 'E:\\Git Tools\\bin\\bash.exe', 'a quoted PATH entry');
  assert.equal(findGitBash({ PATH: 'C:\\Windows\\System32' }, has()), null);

  assert.deepEqual(hookShell('darwin', {}, has()), { shell: 'bash', gitBash: null });
  assert.deepEqual(hookShell('win32', {}, has()), { shell: 'powershell', gitBash: null });
  assert.deepEqual(hookShell('win32', {}, has('C:\\Program Files\\Git\\bin\\bash.exe')), { shell: 'bash', gitBash: 'C:\\Program Files\\Git\\bin\\bash.exe' });
});

test('a PowerShell command calls the quoted launcher; bash keeps its form', () => {
  // Value: protects=hooks run under PowerShell; fails_when=the call operator or single quotes are dropped, or the bash form changes; why_new=two quoted paths in a row are a PowerShell parse error; seam=none
  assert.equal(shellCommand('powershell', LAUNCHER, SHIM), `& '${LAUNCHER}' '${SHIM}'`);
  assert.equal(shellCommand('powershell', LAUNCHER, SHIM, '--status'), `& '${LAUNCHER}' '${SHIM}' --status`);
  assert.equal(shellCommand('powershell', "C:\\O'Brien $x\\n.cmd", SHIM), `& 'C:\\O''Brien $x\\n.cmd' '${SHIM}'`, 'a quote doubled, $ literal');
  assert.equal(shellCommand('powershell', 'C:\\Joe\u2019s \u2018Biz\u201B\u201A\\n.cmd', SHIM), `& 'C:\\Joe\u2019\u2019s \u2018\u2018Biz\u201B\u201B\u201A\u201A\\n.cmd' '${SHIM}'`, 'typographic single quotes are quote marks to PowerShell too');
  assert.equal(shellCommand('bash', '/h/hive/bin/hive-node', '/h/hive/bin/cth-hook.cjs', '--status'), '"/h/hive/bin/hive-node" "/h/hive/bin/cth-hook.cjs" --status');
  // Where PowerShell is installed, it parses the command (here the error came from).
  const pwsh = ['pwsh', 'powershell'].find((c) => spawnSync(c, ['-NoProfile', '-Command', 'exit 0']).status === 0);
  if (pwsh) {
    const parse = (cmd) => spawnSync(pwsh, ['-NoProfile', '-Command', `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseInput(@'\n${cmd}\n'@, [ref]$null, [ref]$e); $e.Count`], { encoding: 'utf8' }).stdout.trim();
    assert.equal(parse(shellCommand('powershell', LAUNCHER, SHIM, '--status')), '0');
    assert.notEqual(parse(shellCommand('bash', LAUNCHER, SHIM)), '0', 'the old form does not parse');
    assert.equal(parse(shellCommand('powershell', "C:\\O'Brien $x\\n.cmd", SHIM)), '0', 'an apostrophe and $ in a path');
    assert.equal(parse(shellCommand('powershell', 'C:\\Joe\u2019s \u2018Biz\u201B\u201A\\n.cmd', SHIM, '--status')), '0', 'typographic quotes in a path');
  }
});

test('on Windows, every Claude hook and the status line are written for the shell Claude Code will use', async (t) => {
  // Value: protects=Michael's hooks run on a Windows office with or without Git for Windows; fails_when=hookSettings writes the bash form under PowerShell, a hook does not name its shell, the found Git Bash is not pinned, or POSIX settings change; why_new=the reported "Unexpected token" on every hook; seam=process.platform and PATH
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-hook-shell-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  const realPath = process.env.PATH;
  const realBash = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.env.PATH = path.join(home, 'nowhere');
  delete process.env.CLAUDE_CODE_GIT_BASH_PATH;
  let launch;
  let expected;
  try {
    // Whatever this host has: no Git Bash off Windows, maybe one on a Windows runner.
    expected = hookShell();
    const hive = new HiveManager(() => home);
    launch = await hive.ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: home });
  } finally {
    Object.defineProperty(process, 'platform', real);
    process.env.PATH = realPath;
    if (realBash === undefined) delete process.env.CLAUDE_CODE_GIT_BASH_PATH; else process.env.CLAUDE_CODE_GIT_BASH_PATH = realBash;
  }
  if (process.platform !== 'win32') assert.equal(expected.shell, 'powershell', 'a Mac or Linux host has no Git Bash');
  const form = expected.shell === 'powershell' ? /^& '.+' '.+cth-hook\.cjs'$/ : /^".+" ".+cth-hook\.cjs"$/;
  const settings = JSON.parse(fs.readFileSync(path.join(home, 'agent-settings/a1.json'), 'utf8'));
  const hooks = Object.values(settings.hooks).flatMap((matchers) => matchers.flatMap((m) => m.hooks));
  assert.ok(hooks.length > 0);
  for (const h of hooks) {
    assert.equal(h.shell, expected.shell);
    assert.match(h.command, form, h.command);
  }
  assert.match(settings.statusLine.command, new RegExp(`${form.source.slice(0, -1)} --status$`));
  assert.equal(settings.statusLine.shell, undefined, 'the status line has no shell field');
  assert.equal(typeof launch.env, 'object');
  assert.equal(launch.env.CLAUDE_CODE_GIT_BASH_PATH, expected.gitBash ?? undefined, 'a found Git Bash is pinned');

  // POSIX is unchanged: no shell field, the quoted form.
  if (process.platform !== 'win32') {
    const posix = fs.mkdtempSync(path.join(os.tmpdir(), 'md-hook-shell-'));
    t.after(() => fs.rmSync(posix, { recursive: true, force: true }));
    await new HiveManager(() => posix).ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: posix });
    const first = Object.values(JSON.parse(fs.readFileSync(path.join(posix, 'agent-settings/a1.json'), 'utf8')).hooks)[0][0].hooks[0];
    assert.equal(first.shell, undefined);
    assert.match(first.command, /^".+" ".+cth-hook\.cjs"$/);
  }
});

test('on Windows with Git Bash found, hooks name bash, keep the quoted form, and that Git Bash is pinned', async (t) => {
  // Value: protects=a Windows office with Git for Windows runs hooks and the status line in the same bash Claude Code picks; fails_when=the found Git Bash is not pinned, hooks name powershell or use the call operator form under bash; why_new=the hive test only reaches this branch on a Windows runner that happens to have Git Bash, so Mac and Linux runs never cover it; seam=process.platform and CLAUDE_CODE_GIT_BASH_PATH
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-hook-bash-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bash = path.join(home, 'Git', 'bin', 'bash.exe');
  fs.mkdirSync(path.dirname(bash), { recursive: true });
  fs.writeFileSync(bash, '');
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  const realBash = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.env.CLAUDE_CODE_GIT_BASH_PATH = bash;
  let launch;
  try {
    launch = await new HiveManager(() => home).ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: home });
  } finally {
    Object.defineProperty(process, 'platform', real);
    if (realBash === undefined) delete process.env.CLAUDE_CODE_GIT_BASH_PATH; else process.env.CLAUDE_CODE_GIT_BASH_PATH = realBash;
  }
  assert.equal(launch.env.CLAUDE_CODE_GIT_BASH_PATH, bash, 'the found Git Bash is pinned');
  const settings = JSON.parse(fs.readFileSync(path.join(home, 'agent-settings/a1.json'), 'utf8'));
  const hooks = Object.values(settings.hooks).flatMap((matchers) => matchers.flatMap((m) => m.hooks));
  assert.ok(hooks.length > 0);
  for (const h of hooks) {
    assert.equal(h.shell, 'bash');
    assert.match(h.command, /^".+" ".+cth-hook\.cjs"$/, h.command);
  }
  assert.match(settings.statusLine.command, /^".+" ".+cth-hook\.cjs" --status$/);
});

test('a found Git Bash is reused between spawns only while it exists, and none is looked for again', (t) => {
  // Value: protects=the shell picked for each spawn follows the Git Bash actually on disk, so hooks and the status line never name a bash that is gone or miss one that came back; fails_when=the cache returns a deleted Git Bash or keeps "none" after one appears; why_new=the cache runs only with the real existsSync, which the injected tests skip; seam=none
  const stock = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find((p) => fs.existsSync(p));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-bash-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bash = path.join(dir, 'bash.exe');
  const env = { PATH: path.join(dir, 'nowhere'), CLAUDE_CODE_GIT_BASH_PATH: bash };
  const none = stock ? { shell: 'bash', gitBash: stock } : { shell: 'powershell', gitBash: null };
  assert.deepEqual(hookShell('win32', env), none, 'nothing there yet');
  fs.writeFileSync(bash, '');
  assert.deepEqual(hookShell('win32', env), { shell: 'bash', gitBash: bash }, 'found once it exists, not stuck on none');
  assert.deepEqual(hookShell('win32', env), { shell: 'bash', gitBash: bash }, 'reused');
  fs.rmSync(bash);
  assert.deepEqual(hookShell('win32', env), none, 'a removed Git Bash is not reused');
});
