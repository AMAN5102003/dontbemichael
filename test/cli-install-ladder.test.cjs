'use strict';

/**
 * Every provider's `installCommand` is `npm install -g …`. On a machine with no
 * Node, the missing-CLI banner used to print that command and RUN it — so a fresh
 * user watched `npm: command not found` scroll past and concluded the app was
 * broken. The ladder classifies first and only ever runs something that can work.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const loadTs = require('./load-ts.cjs');
const { posixOnly, windowsOnly } = require('./platform.cjs');

const { chooseInstallRung, buildMissingCliScript, installSucceeded } = loadTs('src/main/cliInstall.ts');
const { installInfoForProvider, AGENT_PROVIDER_PRESETS } = loadTs('src/shared/agentProvider.ts');
const { PtyManager } = loadTs('src/main/pty.ts');
const { tokenizeCommand } = loadTs('src/shared/commandLine.ts');

// The POSIX shell script unless a test names the platform: the Windows form is
// one cmd.exe line, pinned by its own tests below.
const script = (provider, npmAvailable, platform = 'darwin') =>
  buildMissingCliScript(provider, provider, npmAvailable, platform);

test('with npm present the ladder is unchanged — npm install, for every provider', () => {
  for (const provider of ['claude', 'codex', 'gemini', 'opencode', 'crush', 'copilot']) {
    const info = installInfoForProvider(provider);
    const rung = chooseInstallRung(info, true);
    assert.equal(rung.kind, 'npm', provider);
    assert.equal(rung.command, info.command, provider);
    assert.equal(rung.nodeMissing, false, provider);
  }
});

test('with npm absent, a provider shipping a native installer uses it', () => {
  const rung = chooseInstallRung(installInfoForProvider('claude'), false);
  assert.equal(rung.kind, 'native');
  assert.equal(rung.nodeMissing, true);
  assert.doesNotMatch(rung.command, /\bnpm\b/, 'the whole point is that npm is not there');
});

test('cursor prefers its native curl installer (no npm package)', () => {
  const info = installInfoForProvider('cursor');
  assert.equal(info.command, undefined, 'cursor is not an npm global package');
  assert.ok(info.nativeCommand, 'ships curl|bash / irm|iex installer');
  const withNpm = chooseInstallRung(info, true);
  assert.equal(withNpm.kind, 'native', 'native rung even when npm exists');
  const withoutNpm = chooseInstallRung(info, false);
  assert.equal(withoutNpm.kind, 'native');
  assert.match(withoutNpm.command, /cursor\.com\/install/);
});

test('with npm absent and no native installer, NOTHING is run', () => {
  const info = installInfoForProvider('codex');
  assert.equal(info.nativeCommand, undefined, 'fixture assumes codex has no native installer');
  const rung = chooseInstallRung(info, false);
  assert.equal(rung.kind, 'manual');
  assert.equal(rung.command, undefined, 'a command here would be the doomed `npm install -g`');
});

test('the no-node script explains the real problem instead of failing at it', () => {
  const out = script('codex', false);
  assert.match(out, /Node\.js is not installed/);
  assert.match(out, /nodejs\.org/, 'tell the user where to get it');
  assert.match(out, /Docs: https/, 'and keep the provider docs link');

  // The npm command may still be SHOWN (as the follow-up step) but must never be
  // an executed line: every executable line here is an `echo`.
  const executable = out.split('\n').filter((l) => l.trim() && !/^\s*echo\b/.test(l.trim()));
  assert.deepEqual(executable, [], `these would run on a machine with no node: ${executable}`);
});

test('the native rung actually runs, and says why it differs', () => {
  const out = script('claude', false);
  assert.match(out, /no Node needed/);
  // The script above is the darwin one, so compare with the darwin installer,
  // not the host's (a Windows runner would expect the PowerShell form).
  const native = installInfoForProvider('claude', 'darwin').nativeCommand;
  assert.ok(out.split('\n').includes(native), 'the installer must be an executed line, not only echoed');
});

test('with npm present nothing mentions a missing Node', () => {
  const out = script('claude', true);
  assert.doesNotMatch(out, /Node\.js is not installed/);
  assert.ok(out.split('\n').includes('npm install -g @anthropic-ai/claude-code'));
});

test('the Windows script stays a single quote-free cmd.exe line', () => {
  // It is wrapped verbatim in `cmd /d /s /c "<script>"` — one embedded double
  // quote ends the command line early and the rest executes as garbage.
  for (const provider of ['claude', 'codex']) {
    for (const npm of [true, false]) {
      const out = buildMissingCliScript(provider, provider, npm, 'win32');
      assert.ok(!out.includes('"'), `${provider}/${npm}: embedded quote`);
      assert.ok(!out.includes('\n'), `${provider}/${npm}: must be one line`);
    }
  }
  assert.match(buildMissingCliScript('claude', 'claude', false, 'win32'), /powershell/,
    'the native rung must be the PowerShell form on Windows, not the curl one');
});

test('every Windows native installer runs under cmd.exe as written', () => {
  // A bare `|` pipes the echo banner into the next command, and `irm`/`iex`
  // are PowerShell only: cmd answers "'iex' is not recognized".
  for (const preset of AGENT_PROVIDER_PRESETS) {
    const win32 = preset.nativeInstallCommand?.win32;
    if (!win32) continue;
    const out = buildMissingCliScript(preset.defaultCommand, preset.id, false, 'win32');
    assert.ok(!out.includes('"'), `${preset.id}: embedded quote`);
    assert.doesNotMatch(win32, /(^|[^^])\|/, `${preset.id}: unescaped pipe`);
    if (/\b(irm|iex)\b/.test(win32)) assert.match(win32, /^powershell /, `${preset.id}: PowerShell commands need powershell`);
  }
});

test('a hostile binary name cannot inject a command into the banner', () => {
  for (const platform of ['darwin', 'win32']) {
    const out = script('claude', true, platform).split('\n');
    const evil = buildMissingCliScript("x'; rm -rf /; echo '", 'claude', true, platform).split('\n');
    assert.equal(evil.length, out.length, `${platform}: no extra statements`);
    assert.ok(evil.some((l) => l.includes('xrm-rf')), `${platform}: sanitized to a bare identifier`);
    assert.ok(!evil.some((l) => /rm -rf \//.test(l)), platform);
  }
});

// Run the generated npm-rung script the way PtyManager.spawn runs a shellScript,
// with a fake `npm` first on PATH that exits with `code`. Nothing is installed.
function runWithFakeNpm(platform, shell, code) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-cli-install-'));
  try {
    const script = buildMissingCliScript('codex', 'codex', true, platform);
    if (platform === 'win32') {
      fs.writeFileSync(path.join(dir, 'npm.cmd'), `@echo off\r\necho FAKE-NPM-RAN\r\nexit /b ${code}\r\n`);
      const r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${script}"`], {
        encoding: 'utf8',
        windowsVerbatimArguments: true,
        env: { ...process.env, PATH: `${dir};${process.env.PATH}` }
      });
      return { code: r.status, out: r.stdout + r.stderr };
    }
    fs.writeFileSync(path.join(dir, 'npm'), `#!/bin/sh\necho FAKE-NPM-RAN\nexit ${code}\n`, { mode: 0o755 });
    const r = spawnSync(shell, ['-c', script], { encoding: 'utf8', env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir } });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a relaunch needs a clean installer exit AND the CLI found afterwards', () => {
  // Value: protects=a failed or half-done install never wipes the terminal and respawns a CLI that is not there; fails_when=the exit handler trusts the exit code alone, or probes the CLI before the exit code says it is worth it; why_new=the relaunch rule had no test; seam=none (pure function)
  let probes = 0;
  const found = () => { probes++; return true; };
  assert.equal(installSucceeded(0, found), true);
  assert.equal(installSucceeded(0, () => false), false, 'exit 0 but the CLI is still missing');
  assert.equal(installSucceeded(7, found), false);
  assert.equal(installSucceeded(undefined, found), false, 'killed, no exit code');
  assert.equal(probes, 1, 'the CLI is only looked up after a clean exit');
});

test('the generated script returns the installer exit code in a plain shell', posixOnly('runs the sh script'), () => {
  // Value: protects=a failed npm install is reported as failed, so its "[x] Install exited" message stays on screen; fails_when=the script ends on an echo again and exits 0 whatever npm did; why_new=the existing checks only match the script text, nothing ran it; seam=none (fake npm on PATH, no network)
  const shells = ['/bin/sh', '/bin/bash', '/bin/zsh'].filter((s) => fs.existsSync(s));
  assert.ok(shells.length > 0);
  for (const shell of shells) {
    const failed = runWithFakeNpm('darwin', shell, 7);
    assert.match(failed.out, /FAKE-NPM-RAN/, `${shell}: the installer runs`);
    assert.match(failed.out, /Install exited with code 7/, `${shell}: the failure is explained`);
    assert.equal(failed.code, 7, `${shell}: the installer's failure comes back`);
    const ok = runWithFakeNpm('darwin', shell, 0);
    assert.match(ok.out, /Installed\. Launching the agent/, shell);
    assert.equal(ok.code, 0, `${shell}: a good install ends cleanly`);
  }
});

test('the Windows script returns the installer exit code through cmd.exe', windowsOnly('runs the cmd.exe script'), () => {
  // Value: protects=same as the POSIX test, for the one-line cmd.exe form; fails_when=the line ends on an echo again and cmd /c exits 0 whatever npm did; why_new=nothing ran the Windows script; seam=none (fake npm.cmd on PATH, no network)
  const failed = runWithFakeNpm('win32', null, 7);
  assert.match(failed.out, /FAKE-NPM-RAN/, 'the installer runs');
  assert.equal(failed.code, 7, "the installer's failure comes back");
  const ok = runWithFakeNpm('win32', null, 0);
  assert.equal(ok.code, 0, 'a good install ends cleanly');
});

test('the install exit handler relaunches only on installSucceeded', () => {
  // Value: protects=the relaunch decision stays wired to the tested rule; fails_when=index.ts goes back to `exitCode === 0`, or checks a different binary than the one it relaunches; why_new=the exit handler had no test; seam=source pin, main has no Electron harness
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  const start = src.indexOf('const pending = pendingInstallRelaunch.get(id);');
  assert.ok(start > 0, 'the install exit branch exists');
  const branch = src.slice(start, src.indexOf('teardownPty(id);', start));
  assert.match(branch, /if \(installSucceeded\(exitCode, \(\) => ptyManager\.isCommandAvailable\(pending\.bin\)\)\)/);
  assert.doesNotMatch(branch, /if \(exitCode === 0\)/);
});

test('a CLI installed under a folder with a space is not reported missing', () => {
  // Value: protects=the missing-CLI check probes the same executable pty.spawn runs; fails_when=index.ts splits the command on spaces again and probes `C:\Users\John`; why_new=a user name with a space showed "CLI missing" for an installed CLI; seam=source pin, main has no Electron harness
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  assert.ok(!src.includes(String.raw`opts.command.trim().split(/\s+/)[0]`), 'opts.command is already the bare executable');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'John Smith '));
  try {
    const exe = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
    fs.writeFileSync(exe, '', { mode: 0o755 });
    // What every renderer caller sends main: the executable with its quotes removed.
    const [command] = tokenizeCommand(`"${exe}" --model opus`);
    assert.equal(command, exe);
    assert.equal(new PtyManager().isCommandAvailable(command.trim()), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
