'use strict';

/**
 * Hooks run under `/bin/sh` with a bare PATH (`/usr/bin:/bin:…`). A hook command
 * of `node "<shim>"` therefore exits 127 — "node: command not found" — on every
 * machine where node lives in a shell-managed prefix (nvm, volta, Homebrew).
 *
 * The fix is `<hive>/bin/hive-node`: a one-line wrapper around Electron's OWN
 * bundled node (`ELECTRON_RUN_AS_NODE=1 exec "<execPath>"`). Every hook installer
 * must route through it.
 *
 * A wrapper SCRIPT rather than an inline `ELECTRON_RUN_AS_NODE=1 "<exe>" …`
 * prefix, because that prefix is POSIX-sh syntax and a hard error under cmd.exe —
 * which is what runs hook commands on Windows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const loadTs = require('./load-ts.cjs');
const { windowsOnly } = require('./platform.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

const POSIX = process.platform !== 'win32';
const STRIPPED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

function tmpHome(prefix = 'md-hive-node-', root = os.tmpdir()) {
  return fs.mkdtempSync(path.join(root, prefix));
}

function isolatedHomes(t, prefix, root) {
  const base = tmpHome(prefix, root);
  const home = path.join(base, 'user');
  const harness = path.join(base, 'harness');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const realHome = process.env.HOME;
  const realProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
    if (realProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = realProfile;
  });
  assert.equal(os.homedir(), home, 'home redirect failed — aborting before touching the real home');
  return { home, harness };
}

const launcherIn = (home) =>
  path.join(home, 'hive', 'bin', POSIX ? 'hive-node' : 'hive-node.cmd');

/** The two bundled-node shims: the launcher and the PATH-visible `node`. */
const shimsIn = (hive, home) => [launcherIn(home), path.join(hive.runtimeBinDir(), POSIX ? 'node' : 'node.cmd')];

/** Every file under `dir`. */
function walk(dir, out = []) {
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Sweep every config an installer wrote for commands that invoke one of our
 *  shims. Path-agnostic on purpose, so a new installer cannot be missed. */
function hookCommandsUnder(home) {
  const shim = /(cth-hook\.cjs|agy-hook\.cjs|grok-hook\.cjs|gemini-hook\.cjs)/;
  const found = [];
  for (const file of walk(home)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!shim.test(text)) continue;
    // JSON hook configs: "command": "<…>"      TOML (codex): command = "<…>"
    for (const m of text.matchAll(/"command"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) found.push(JSON.parse(`"${m[1]}"`));
    for (const m of text.matchAll(/^command\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*$/gm)) {
      found.push(m[1].startsWith('"') ? JSON.parse(m[1]) : m[1].slice(1, -1));
    }
  }
  return found.filter((c) => shim.test(c));
}

const usesLauncher = (cmd, launcher) => cmd.startsWith(launcher) || cmd.startsWith(`"${launcher}"`);

async function run(cmd, env) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', cmd], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    // These commands are EXPECTED to exit before the payload lands — the control
    // case below asserts `node "<shim>"` exits 127 under a stripped PATH. A child
    // that is already gone makes this write EPIPE, and an unhandled 'error' on
    // stdin rejects the test rather than the command under test failing. The exit
    // code is what this helper reports, so a lost write is not a lost signal.
    // Narrow on purpose: EPIPE is the expected one and is swallowed, anything
    // else (EACCES, ERR_STREAM_DESTROYED) is surfaced through the stderr this
    // helper already returns, so an unexpected stdin fault names itself instead
    // of vanishing.
    child.stdin.on('error', (e) => {
      if (e.code !== 'EPIPE') stderr += `stdin: ${e.message}\n`;
    });
    child.stdin.end(JSON.stringify({ hook_event_name: 'Stop', session_id: 's1' }));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

test('ensureHive writes an executable bundled-node launcher', async (t) => {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: home });

  const launcher = launcherIn(home);
  assert.equal(fs.existsSync(launcher), true);
  const body = fs.readFileSync(launcher, 'utf8');
  assert.match(body, /ELECTRON_RUN_AS_NODE=1/, 'without this the binary opens a second app window');
  assert.ok(body.includes(process.execPath), 'execPath is re-baked when it differs, so an app move/update heals');
  if (POSIX) assert.ok(fs.statSync(launcher).mode & 0o111, 'must be executable');
});

test('a second bootstrap leaves unchanged bundled-node shims alone', async (t) => {
  // ensureHive runs on every task write and every spawn. On Windows something
  // holds a running .cmd open while a hook runs through it, so a rewrite of the
  // same bytes failed with EBUSY and logged an error on every board change. A
  // read-only file refuses a write the same way on every platform (as a normal
  // user, which CI is), so it stands in for that lock here: an unchanged shim
  // must not be written at all.
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  hive.ensureHive();
  const shims = shimsIn(hive, home);
  const bodies = shims.map((p) => fs.readFileSync(p, 'utf8'));
  const before = shims.map((p) => fs.statSync(p).mtimeMs);

  const errors = [];
  const realError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };
  for (const p of shims) fs.chmodSync(p, 0o444);
  try {
    hive.ensureHive();
  } finally {
    console.error = realError;
    for (const p of shims) fs.chmodSync(p, 0o644);
  }

  assert.deepEqual(errors.filter((line) => /writeNodeLauncher|writeRuntimeShims/.test(line)), [], 'no write was attempted');
  shims.forEach((p, i) => {
    assert.equal(fs.readFileSync(p, 'utf8'), bodies[i], p);
    assert.equal(fs.statSync(p).mtimeMs, before[i], `${p} was not touched`);
  });
});

test('shims left by another binary are re-baked on the next bootstrap', async (t) => {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  hive.ensureHive();
  const shims = shimsIn(hive, home);
  const bodies = shims.map((p) => fs.readFileSync(p, 'utf8'));

  // An app update or move: the shims on disk name the old executable.
  shims.forEach((p, i) => fs.writeFileSync(p, bodies[i].replace(process.execPath, path.join(home, 'old-app')), 'utf8'));
  hive.ensureHive();

  shims.forEach((p, i) => {
    assert.equal(fs.readFileSync(p, 'utf8'), bodies[i], `execPath is re-baked in ${p} when it differs`);
    if (POSIX) assert.ok(fs.statSync(p).mode & 0o111, `${p} must still be executable`);
  });
});

test('the claude hook + statusLine commands run through the launcher', async (t) => {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: home });

  const launcher = launcherIn(home);
  const settings = JSON.parse(fs.readFileSync(path.join(home, 'agent-settings/a1.json'), 'utf8'));
  const commands = [
    ...Object.values(settings.hooks).flatMap((matchers) => matchers.flatMap((m) => m.hooks.map((h) => h.command))),
    settings.statusLine.command
  ];

  assert.ok(commands.length > 0);
  for (const cmd of commands) assert.equal(usesLauncher(cmd, launcher), true, cmd);
});

test('every hook installer routes through the launcher — none left on bare node', async (t) => {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: home });

  // agy and grok install into the USER's home. Redirect it, and refuse to run
  // rather than write into the developer's real ~/.gemini / ~/.grok.
  const realHome = process.env.HOME;
  const realProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
    if (realProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = realProfile;
  });
  assert.equal(os.homedir(), home, 'home redirect failed — aborting before touching the real home');

  hive.installAgyHooks();
  hive.installGrokHooks();
  hive.installGeminiHooks(path.join(home, 'hive/agents/a1'));
  hive.installCodexHooks(path.join(home, 'hive/agents/a1'), 'a1');

  const launcher = launcherIn(home);
  const commands = hookCommandsUnder(home);
  // claude (Stop/statusLine/…) + agy + grok + codex.
  assert.ok(commands.length >= 4, `expected commands from all installers, got ${commands.length}`);
  const bare = commands.filter((c) => !usesLauncher(c, launcher));
  assert.deepEqual(bare, [], 'these hook commands would exit 127 wherever node is not on the bare PATH');

  for (const shim of ['agy-hook.cjs', 'grok-hook.cjs', 'gemini-hook.cjs']) {
    assert.ok(commands.some((c) => c.includes(shim)), `${shim} installer produced no command`);
  }
});

test('Codex hook commands survive a hive path containing spaces', { skip: !POSIX, timeout: 10_000 }, async (t) => {
  // Keep this root short enough for macOS's Unix-domain socket path limit while
  // putting the literal space after a unique component. The shell's first token
  // is then guaranteed absent, which makes the exit-127 negative control stable.
  const isolated = isolatedHomes(t, undefined, '/tmp');
  const home = isolated.home;
  const harness = `${isolated.harness} space`;
  const hive = new HiveManager(() => harness);
  hive.ensureHive();
  const agentDir = path.join(harness, 'hive', 'agents', 'a1');
  const codexHome = hive.installCodexHooks(agentDir, 'a1');
  const config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
  const commands = [...config.matchAll(/^command\s*=\s*(.+)$/gm)].map((m) => {
    const literal = m[1].trim();
    return literal.startsWith('"') ? JSON.parse(literal) : literal.slice(1, -1);
  });

  assert.equal(commands.length, 8, 'every Codex lifecycle hook must be generated');
  const launcher = launcherIn(harness);
  const shim = path.join(harness, 'hive', 'bin', 'cth-hook.cjs');
  const sock = path.join(harness, 'hive', 'hooks.sock');
  const env = { PATH: STRIPPED_PATH, HIVE_SOCK: sock, AGENT_ID: 'a1', HOME: home };

  const before = await run(`${launcher} ${shim}`, env);
  assert.equal(before.code, 127, 'negative control: the current unquoted command must fail at the first space');

  try { fs.unlinkSync(sock); } catch { /* not there */ }
  const received = [];
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('error', () => { /* the shim may hang up first */ });
    conn.on('data', (d) => { buf += d; });
    conn.on('close', () => { if (buf) received.push(buf); });
    conn.write(JSON.stringify({ ok: true }) + '\n', () => conn.end());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(sock, resolve);
  });
  t.after(() => server.close());

  const after = await run(commands[0], env);
  assert.equal(after.code, 0, `Codex hook failed from a space-containing hive path: ${after.stderr}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(received.length > 0, 'the quoted hook command never reached HIVE_SOCK');
});

/** Run `command` the way Codex runs a hook on Windows: ComSpec, `/C`, then the
 *  command. `raw` is today's Codex (codex-rs command_runner.rs wraps it in one
 *  pair of quotes, unescaped); otherwise it goes as an ordinary escaped
 *  argument, as codex-cli 0.162.1 passes it. */
function runLikeCodexOnWindows(command, env, raw) {
  return new Promise((resolve) => {
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/C', raw ? `"${command}"` : command], {
      env, windowsVerbatimArguments: raw, stdio: ['pipe', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.on('error', () => { /* the shim may exit before reading */ });
    child.stdin.end(JSON.stringify({ hook_event_name: 'Stop', session_id: 's1' }));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

test('Windows Codex hook commands survive a hive path containing spaces', { ...windowsOnly('cmd.exe runs Codex hooks there'), timeout: 20_000 }, async (t) => {
  // The default office is ~/HarnessAgents, so a Windows user name with a space
  // ("Jane Smith") puts one in every hook path.
  const isolated = isolatedHomes(t);
  const harness = `${isolated.harness} space`;
  const hive = new HiveManager(() => harness);
  hive.ensureHive();
  const codexHome = hive.installCodexHooks(path.join(harness, 'hive', 'agents', 'a1'), 'a1');
  const config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
  const commands = [...config.matchAll(/^command\s*=\s*(.+)$/gm)].map((m) => JSON.parse(m[1].trim()));

  assert.equal(commands.length, 8, 'every Codex lifecycle hook must be generated');
  for (const c of commands) assert.doesNotMatch(c, /[\s"]/, `no space or quote for cmd.exe to split or mangle: ${c}`);
  const body = fs.readFileSync(path.join(hive.runtimeBinDir(), `${commands[0]}.cmd`), 'utf8');
  assert.match(body, /ELECTRON_RUN_AS_NODE=1/, 'without this the binary opens a second app window');

  // The agent's PATH ends with the runtime folder (pty.ts withHiveRuntimeFallback).
  const pipe = `\\\\.\\pipe\\md-codex-space-${process.pid}-${Date.now()}`;
  const received = [];
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('error', () => { /* the shim may hang up first */ });
    conn.on('data', (d) => { buf += d; });
    conn.on('close', () => { if (buf) received.push(buf); });
    conn.write(JSON.stringify({ ok: true }) + '\n', () => conn.end());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, resolve);
  });
  t.after(() => server.close());
  const env = { ...process.env, PATH: `${process.env.PATH};${hive.runtimeBinDir()}`, HIVE_SOCK: pipe, AGENT_ID: 'a1' };

  for (const raw of [true, false]) {
    const before = received.length;
    const r = await runLikeCodexOnWindows(commands[0], env, raw);
    assert.equal(r.code, 0, `${raw ? 'raw' : 'escaped'} Codex hook failed from a space-containing hive path: ${r.stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(received.length > before, `the ${raw ? 'raw' : 'escaped'} hook command never reached HIVE_SOCK`);
  }
});

test('POSIX Gemini and Antigravity hooks survive a hive path containing spaces', { skip: !POSIX }, async (t) => {
  // Keep the socket short enough for macOS sun_path while retaining a literal
  // space in the user-selected harness root.
  const base = fs.mkdtempSync('/tmp/md-provider-space-');
  const home = path.join(base, 'user');
  const harness = path.join(base, 'harness space');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const realHome = process.env.HOME;
  const realProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
    if (realProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = realProfile;
  });
  assert.equal(os.homedir(), home, 'home redirect failed — aborting before touching the real home');

  const hive = new HiveManager(() => harness);
  hive.ensureHive();
  hive.installAgyHooks();
  hive.installGeminiHooks(path.join(harness, 'hive/agents/a1'));

  const commands = hookCommandsUnder(home);
  const providerCommands = [
    ['antigravity', commands.find((candidate) => candidate.includes('agy-hook.cjs'))],
    ['gemini', hookCommandsUnder(harness).find((candidate) => candidate.includes('gemini-hook.cjs'))]
  ];

  const sock = path.join(harness, 'hive', 'hooks.sock');
  const received = [];
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('error', () => { /* shim may hang up first */ });
    conn.on('data', (d) => { buf += d; });
    conn.on('close', () => { if (buf) received.push(buf); });
    conn.write(JSON.stringify({ ok: true }) + '\n', () => conn.end());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(sock, resolve);
  });
  t.after(() => server.close());

  for (const [provider, command] of providerCommands) {
    assert.ok(command, `${provider} installer produced no command`);
    const result = await run(command, {
      PATH: STRIPPED_PATH,
      HOME: home,
      AGENT_ID: 'a1',
      HIVE_SOCK: sock
    });
    assert.equal(result.code, 0, `${provider} command failed: ${command}\n${result.stderr}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(received.length, 2, 'both provider hook shims must reach HIVE_SOCK');
});

test('Codex rollouts remain isolated and are visible under the standard scan roots', (t) => {
  const { home, harness } = isolatedHomes(t);
  const hive = new HiveManager(() => harness);
  hive.ensureHive();
  const agentDir = path.join(harness, 'hive', 'agents', 'a1');
  const codexHome = path.join(agentDir, '.codex');
  const files = {
    sessions: path.join('2026', '08', '21', 'rollout-live.jsonl'),
    archived_sessions: 'rollout-archived.jsonl'
  };
  for (const [kind, relative] of Object.entries(files)) {
    const file = path.join(codexHome, kind, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${kind}\n`, 'utf8');
  }

  hive.installCodexHooks(agentDir, 'a1');

  const targets = {};
  for (const [kind, relative] of Object.entries(files)) {
    const isolated = path.join(codexHome, kind);
    assert.equal(fs.lstatSync(isolated).isSymbolicLink(), true,
      `${kind} must stay reachable from the isolated CODEX_HOME`);
    targets[kind] = fs.realpathSync(isolated);
    assert.equal(targets[kind].startsWith(
      path.join(fs.realpathSync(home), '.codex', kind, 'munder-difflin') + path.sep
    ), true, `${targets[kind]} is outside the standard Codex scan root under ${home}`);
    assert.equal(fs.readFileSync(path.join(isolated, relative), 'utf8'), `${kind}\n`,
      `existing ${kind} data was lost during exposure`);
  }

  hive.installCodexHooks(agentDir, 'a1');
  for (const kind of Object.keys(files)) {
    assert.equal(fs.realpathSync(path.join(codexHome, kind)), targets[kind],
      `reinstalling hooks moved ${kind} again`);
  }
});

test('bootstrap exposes archived Codex agents without respawning them', (t) => {
  const { home, harness } = isolatedHomes(t);
  const root = path.join(harness, 'hive');
  const agentDir = path.join(root, 'agents', 'a1');
  const sessions = path.join(agentDir, '.codex', 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, 'rollout-old.jsonl'), 'old\n', 'utf8');
  fs.writeFileSync(path.join(root, 'registry.json'), JSON.stringify({
    godId: null,
    agents: { a1: { id: 'a1', name: 'A', provider: 'codex', cwd: harness, archived: true } }
  }), 'utf8');

  new HiveManager(() => harness).ensureHive();

  assert.equal(fs.lstatSync(sessions).isSymbolicLink(), true,
    'an archived agent is never respawned, so bootstrap must expose its rollouts');
  assert.equal(fs.realpathSync(sessions).startsWith(
    path.join(fs.realpathSync(home), '.codex', 'sessions', 'munder-difflin') + path.sep
  ), true);
  assert.equal(fs.readFileSync(path.join(sessions, 'rollout-old.jsonl'), 'utf8'), 'old\n');
});

test('a missing exposed directory is repaired on the next spawn', (t) => {
  const { home, harness } = isolatedHomes(t);
  const hive = new HiveManager(() => harness);
  hive.ensureHive();
  const agentDir = path.join(harness, 'hive', 'agents', 'a1');
  const sessions = path.join(agentDir, '.codex', 'sessions');
  const staleTarget = path.join(home, '.codex', 'sessions', 'munder-difflin', 'stale', 'a1');
  fs.mkdirSync(staleTarget, { recursive: true });
  fs.mkdirSync(path.dirname(sessions), { recursive: true });
  fs.symlinkSync(staleTarget, sessions, process.platform === 'win32' ? 'junction' : 'dir');
  fs.rmSync(staleTarget, { recursive: true, force: true });

  hive.installCodexHooks(agentDir, 'a1');

  assert.equal(fs.lstatSync(sessions).isSymbolicLink(), true);
  assert.equal(fs.statSync(sessions).isDirectory(), true, 'the stale link still has no writable target');
});

test('an unsafe agent id cannot escape the Munder scan namespace', (t) => {
  const { home, harness } = isolatedHomes(t);
  const hive = new HiveManager(() => harness);
  hive.ensureHive();
  const codexHome = path.join(harness, 'hive', 'agents', 'safe', '.codex');
  const sessions = path.join(codexHome, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, 'rollout.jsonl'), 'safe\n', 'utf8');

  assert.throws(() => hive.exposeCodexDataDir(
    codexHome, path.join(home, '.codex'), '../outside', 'sessions'
  ), /invalid agent id/);
  assert.equal(fs.readFileSync(path.join(sessions, 'rollout.jsonl'), 'utf8'), 'safe\n');
  assert.equal(fs.existsSync(path.join(home, '.codex', 'sessions', 'munder-difflin', 'outside')), false);
});

test('reset cleanup removes only exposed Munder rollouts', (t) => {
  const { home, harness } = isolatedHomes(t);
  const hive = new HiveManager(() => harness);
  hive.ensureHive();
  const agentDir = path.join(harness, 'hive', 'agents', 'a1');
  const isolated = path.join(agentDir, '.codex', 'sessions');
  fs.mkdirSync(isolated, { recursive: true });
  fs.writeFileSync(path.join(isolated, 'rollout-munder.jsonl'), 'munder\n', 'utf8');
  const personal = path.join(home, '.codex', 'sessions', '2026', '08', '21', 'rollout-personal.jsonl');
  fs.mkdirSync(path.dirname(personal), { recursive: true });
  fs.writeFileSync(personal, 'personal\n', 'utf8');
  hive.installCodexHooks(agentDir, 'a1');
  const exposed = fs.realpathSync(isolated);

  hive.removeExposedCodexData();

  assert.equal(fs.existsSync(exposed), false, 'reset left Munder rollout data behind');
  assert.equal(fs.readFileSync(personal, 'utf8'), 'personal\n', 'reset touched a personal Codex session');
});

test('Gemini gets isolated lifecycle settings and an interactive protocol seed', async (t) => {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  const injection = await hive.ensureAgent({
    id: 'gemini-1',
    name: 'Gemini',
    provider: 'gemini',
    cwd: home
  });

  const settingsPath = injection.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
  assert.equal(typeof settingsPath, 'string');
  assert.ok(settingsPath.startsWith(path.join(home, 'hive', 'agents', 'gemini-1')));
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.deepEqual(
    Object.keys(settings.hooks),
    ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'AfterAgent']
  );
  assert.equal(settings.hooksConfig.enabled, true);
  assert.equal(settings.hooks.BeforeTool[0].matcher, '.*');
  assert.ok(settings.hooks.AfterAgent[0].hooks[0].command.includes('gemini-hook.cjs'));
  // The seed comes after Gemini's own flags (its workspace folders).
  const seed = injection.args.indexOf('-i');
  assert.ok(seed >= 0, 'gemini spawn carries -i');
  assert.equal(seed, injection.args.length - 2);
  assert.match(injection.args[seed + 1], /HIVE PROTOCOL/);
});

test('a hook fires with NO node on PATH, and its payload reaches HIVE_SOCK', { skip: !POSIX }, async (t) => {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: home });

  const sock = path.join(home, 'hive', 'hooks.sock');
  try { fs.unlinkSync(sock); } catch { /* not there */ }

  const received = [];
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('error', () => { /* the shim may hang up first */ });
    conn.on('data', (d) => { buf += d; });
    // The shim writes its payload and waits for OUR end() — it never half-closes,
    // so the payload is only complete on 'close', not 'end'.
    conn.on('close', () => { if (buf) received.push(buf); });
    conn.write(JSON.stringify({ ok: true }) + '\n', () => conn.end());
  });
  server.on('error', () => { /* keep a socket error out of the test process */ });
  await new Promise((resolve) => server.listen(sock, resolve));
  t.after(() => server.close());

  const env = { PATH: STRIPPED_PATH, HIVE_SOCK: sock, AGENT_ID: 'a1', HOME: home };
  const shim = path.join(home, 'hive/bin/cth-hook.cjs');

  // Control: the command shape used before the fix. Only meaningful if node is
  // genuinely absent from the stripped PATH (it is on a dev machine using nvm,
  // volta or Homebrew; it is not on an image with /usr/bin/node).
  const probe = await run('command -v node', env);
  if (probe.code !== 0) {
    const before = await run(`node "${shim}"`, env);
    assert.equal(before.code, 127, 'the bug: bare `node` is not resolvable from a hook');
  }

  // NOTE: async spawn, not spawnSync — the shim connects back to a socket THIS
  // process is serving, so a sync call would block our own event loop and
  // deadlock the handshake.
  const settings = JSON.parse(fs.readFileSync(path.join(home, 'agent-settings/a1.json'), 'utf8'));
  const after = await run(settings.hooks.Stop[0].hooks[0].command, env);
  assert.equal(after.code, 0, `hook failed under a stripped PATH: ${after.stderr}`);

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(received.length > 0, 'nothing arrived at HIVE_SOCK');
  assert.match(received[0], /"hook_event_name"\s*:\s*"Stop"/);
});
