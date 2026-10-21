'use strict';

/**
 * Hook events carry a per start secret (issue #61; docs/designs/team-performance.md,
 * eng review E2 and E3). The hook server takes the sender from the secret, never
 * from the frame: a frame without one, naming someone else, or using a retired
 * one reaches no consumer, a tool check from it is refused, and the refusal is
 * counted. The secret lives in main process memory and the agent's environment
 * only, never in a file.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] ??= {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const { HOOK_SENDER_UNCHECKED } = loadTs('src/shared/hookEvents.ts');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

function office(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-hookauth-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, hive: new HiveManager(() => home) };
}

test('a frame is its secret owner\'s; a missing, wrong, cross agent or retired secret is refused and counted', (t) => {
  // Value: protects=no agent can speak as another or as nobody; fails_when=the server trusts the frame's agent_id or keeps an old secret alive; why_new=#61; seam=none; no_claim=none beyond protects
  const { hive } = office(t);
  const server = new HookServer(hive, () => null, () => ({}));
  const pam = hive.mintHookToken('pam');
  const dwight = hive.mintHookToken('dwight');
  hive.mintHookToken('god');

  const ok = { hook_event_name: 'Stop', agent_id: 'pam', hook_token: pam };
  assert.equal(server.authenticate(ok), true);
  assert.equal(ok.agent_id, 'pam');
  assert.equal('hook_token' in ok, false, 'the secret never reaches a consumer');

  const unnamed = { hook_event_name: 'Stop', hook_token: pam };
  assert.equal(server.authenticate(unnamed), true);
  assert.equal(unnamed.agent_id, 'pam', 'the sender comes from the secret');

  const sub = { hook_event_name: 'PreToolUse', agent_id: 'pam', subagent_id: 'task-1', hook_token: pam };
  assert.equal(server.authenticate(sub), true, 'a Task subagent speaks under its agent\'s secret');

  assert.equal(server.authenticate({ hook_event_name: 'Stop', agent_id: 'god' }), false, 'no secret');
  assert.equal(server.authenticate({ hook_event_name: 'Stop', agent_id: 'god', hook_token: 'made-up' }), false, 'unknown secret');
  assert.equal(server.authenticate({ hook_event_name: 'Stop', agent_id: 'god', hook_token: dwight }), false, 'Dwight naming Michael');

  hive.mintHookToken('pam'); // a new start retires the old secret
  assert.equal(server.authenticate({ hook_event_name: 'Stop', agent_id: 'pam', hook_token: pam }), false, 'retired secret');

  assert.equal(server.rejectedFrames().get('god'), 3);
  assert.equal(server.rejectedFrames().get('pam'), 1);
});

test('every refused frame and every gated step reaches Pulse with its gate; a question sent on to Michael does not', () => {
  // Value: protects=Kept safe's "Your rules held" counts; fails_when=a refusal is not reported, is reported without its gate, or routing to Michael counts as a protection; why_new=owner proposal 3; seam=source pins on hooks.ts gates; no_claim=each gate's own decision (their own tests)
  const fsm = require('node:fs');
  const src = fsm.readFileSync(require('node:path').join(__dirname, '..', 'src/main/hooks.ts'), 'utf8');
  for (const g of ['paused', 'connector', 'quickbooks', 'mail', 'sandbox', 'internet', 'office-files', 'folder']) assert.match(src, new RegExp(`this\\.emitRefused\\(agentId, event, p, '${g}'\\)`), g);
  assert.match(src, /permissionDecisionReason: ASK_TOOL_REFUSAL/);
  assert.match(src, /this\.emitRefused\(agentId, event, p\);\n\s+return \{\n\s+hookSpecificOutput: \{\n\s+hookEventName: 'PreToolUse',\n\s+permissionDecision: 'deny',\n\s+permissionDecisionReason: ASK_TOOL_REFUSAL/, 'the question tool passes no gate');
  assert.match(src, /if \(reason !== 'old-secret' && [^\n]*\n[^\n]*\n\s+try \{ this\.onRefused\?\.\(who === 'unknown' \? undefined : who, 'impostor'\)/);
});

test('a frame with no secret or another member\'s is reported to Pulse; one from a leftover process is not', (t) => {
  // Value: protects=Kept safe sender count; fails_when=authenticate stops reporting; why_new=owner proposal 3; seam=none; no_claim=none beyond protects
  const { hive } = office(t);
  const server = new HookServer(hive, () => null, () => ({}));
  const seen = [];
  server.onRefused = (agentId, gate) => seen.push([agentId, gate]);
  const pam = hive.mintHookToken('pam');
  hive.mintHookToken('god');
  hive.mintHookToken('dwight');
  server.authenticate({ hook_event_name: 'Stop', agent_id: 'god' });                       // no secret
  server.authenticate({ hook_event_name: 'Stop', agent_id: 'dwight', hook_token: pam });   // Pam's secret
  server.authenticate({ hook_event_name: 'Status', agent_id: 'pam', hook_token: 'from-an-earlier-start' }); // a leftover process
  assert.deepEqual(seen, [['god', 'impostor'], ['dwight', 'impostor']], 'a leftover process is refused but not counted');
});

test('a refused frame naming no member counts as unknown, and the counts stay bounded', async (t) => {
  // Value: protects=a process without a secret can't grow the maps, the office log or Pulse's impostor tile with made up names; fails_when=a refusal is counted, logged or reported under whatever agent_id the frame claims, or Pulse hears every frame; why_new=TODOS "Bound the refused hook frame counters"; seam=none; no_claim=the socket itself (tested below)
  const { home, hive } = office(t);
  await hive.ensureAgent({ id: 'kelly', name: 'Kelly', provider: 'claude', cwd: home });
  const server = new HookServer(hive, () => null, () => ({}));
  const seen = [];
  server.onRefused = (agentId, gate) => seen.push([agentId, gate]);
  const logged = [];
  const append = hive.appendLog.bind(hive);
  hive.appendLog = (e) => { if (e.kind === 'hook-frame-rejected') logged.push(e.agentId); return append(e); };
  hive.mintHookToken('pam');
  let reads = 0;
  const registry = hive.registry.bind(hive);
  hive.registry = () => { reads++; return registry(); };

  for (let i = 0; i < 1000; i++) server.authenticate({ hook_event_name: 'Stop', agent_id: `made-up-${i}` });
  server.authenticate({ hook_event_name: 'Stop', agent_id: '__proto__' });
  assert.deepEqual([...server.rejectedFrames()], [['unknown', 1001]], 'made up names are one "unknown" count');
  assert.deepEqual(logged, ['unknown'], 'logged once');
  assert.deepEqual(seen, [[undefined, 'impostor']], 'Pulse hears it once, under no member');
  assert.ok(reads <= 2, `a flood is not a registry read per frame (${reads})`);

  server.authenticate({ hook_event_name: 'Stop', agent_id: 'pam' });
  server.authenticate({ hook_event_name: 'Stop', agent_id: 'pam' });
  server.authenticate({ hook_event_name: 'Stop', agent_id: 'kelly' });
  assert.equal(server.rejectedFrames().get('pam'), 2, 'a member started this run keeps its own count');
  assert.equal(server.rejectedFrames().get('kelly'), 1, 'a member in the registry keeps its own count');
  assert.deepEqual(seen.slice(1), [['pam', 'impostor'], ['kelly', 'impostor']], 'once per name in ten minutes');

  const cap = HookServer.MAX_REFUSED_NAMES;
  HookServer.MAX_REFUSED_NAMES = 3;
  t.after(() => { HookServer.MAX_REFUSED_NAMES = cap; });
  hive.mintHookToken('dwight');
  server.authenticate({ hook_event_name: 'Stop', agent_id: 'dwight' });
  assert.equal(server.rejectedFrames().has('dwight'), false, 'past the cap a member counts as unknown');
  assert.equal(server.rejectedFrames().size, 3);
});

test('over the socket, a tool check without a valid secret is refused and nothing else reaches a consumer', { skip: process.platform === 'win32' ? 'unix socket paths' : false }, async (t) => {
  // Value: protects=an unauthenticated tool check fails closed, never allowed; fails_when=a refused frame answers {} to PreToolUse or still calls handle; why_new=#61 strict contract; seam=none; no_claim=named pipes on Windows (POSIX socket here)
  const { home, hive } = office(t);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const server = new HookServer(hive, () => null, () => ({}));
  const handled = [];
  server.handle = (p) => { handled.push(p); return {}; };
  server.start();
  t.after(() => server.stop());
  await server.whenOpen();
  const ask = (payload) => new Promise((resolve, reject) => {
    let out = '';
    const c = net.createConnection(hive.sockPath(), () => c.write(JSON.stringify(payload) + '\n'));
    c.setEncoding('utf8');
    c.on('data', (d) => { out += d; });
    c.on('end', () => resolve(JSON.parse(out)));
    c.on('error', reject);
  });
  const pre = await ask({ hook_event_name: 'PreToolUse', agent_id: 'pam', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(pre.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(pre.hookSpecificOutput.permissionDecisionReason, HOOK_SENDER_UNCHECKED);
  assert.deepEqual(await ask({ hook_event_name: 'Stop', agent_id: 'pam' }), {});
  assert.equal(handled.length, 0, 'refused frames reach no consumer');
  await ask({ hook_event_name: 'Stop', agent_id: 'pam', hook_token: hive.mintHookToken('pam') });
  assert.equal(handled.length, 1);
  assert.equal(handled[0].agent_id, 'pam');
  assert.ok(fs.readFileSync(path.join(hive.root(), 'log.jsonl'), 'utf8').includes('"kind":"hook-frame-rejected"'));
});

test('every engine bridge sends the secret, and the spawn hands it over without writing it anywhere', async (t) => {
  // Value: protects=each bridge kind is authenticated the same way and the secret stays out of files; fails_when=a shim drops hook_token or ensureAgent writes it to disk; why_new=#61 asks for one check per bridge kind; seam=none; no_claim=live runs of non Claude engines
  const hiveSrc = read('src/main/hive.ts');
  const shimBody = (name) => {
    const start = hiveSrc.indexOf(`const ${name} = \``);
    assert.ok(start >= 0, name);
    return hiveSrc.slice(start, hiveSrc.indexOf('\n`;', start));
  };
  for (const name of ['HOOK_SHIM', 'AGY_HOOK_SHIM', 'PROXY_BRIDGE_SHIM', 'GEMINI_HOOK_SHIM', 'GROK_HOOK_SHIM']) {
    assert.match(shimBody(name), /hook_token[:= ]+process\.env\.HIVE_HOOK_SEAL/, name);
  }
  // Pi and OpenCode post from their in-process plugins.
  assert.equal((hiveSrc.match(/payload\.hook_token = process\.env\.HIVE_HOOK_SEAL \|\| null;/g) || []).length >= 4, true, 'Claude shim, pi, opencode and the proxy emit');
  assert.match(hiveSrc, /HIVE_HOOK_SEAL: this\.hookTokens\.get\(agentId\) \?\? ''/, 'the proxy sidecar gets its agent\'s secret');

  const { home, hive } = office(t);
  const inj = await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const token = inj.env.HIVE_HOOK_SEAL;
  assert.match(token, /^[0-9a-f]{48}$/);
  assert.equal(hive.hookTokenOwner(token), 'pam');
  const again = await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  assert.notEqual(again.env.HIVE_HOOK_SEAL, token, 'a new start gets a new secret');
  assert.equal(hive.hookTokenOwner(token), undefined);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  for (const f of walk(home)) {
    assert.ok(!fs.readFileSync(f).includes(again.env.HIVE_HOOK_SEAL), `secret written to ${path.relative(home, f)}`);
  }
});

test('the hook secret survives Research\'s subprocess scrub: its name is not one a scrub strips', () => {
  // Value: protects=Research's every step (2026-10-15: with HIVE_HOOK_TOKEN, Claude Code's CLAUDE_CODE_SUBPROCESS_ENV_SCRUB stripped it from Pete's hooks and status line, so each of his steps was refused); fails_when=the secret is renamed to a token, key, pass or auth like name, or the shim and the spawn disagree on it; why_new=live regression; seam=the app's own scrub rule, which follows Claude Code's; no_claim=every future Claude Code scrub pattern
  const fsm = require('node:fs');
  const pathm = require('node:path');
  const { isInheritedSecret } = loadTs('src/main/ptyEnv.ts');
  const hiveSrc = fsm.readFileSync(pathm.join(__dirname, '..', 'src/main/hive.ts'), 'utf8');
  const names = [...new Set([...hiveSrc.matchAll(/HIVE_HOOK_[A-Z]+(?=: this\.mintHookToken)/g)].map((m) => m[0]))];
  assert.deepEqual(names, ['HIVE_HOOK_SEAL']);
  assert.equal(isInheritedSecret('HIVE_HOOK_SEAL', 'a'.repeat(48)), false, 'the scrub keeps it');
  assert.equal(isInheritedSecret('HIVE_HOOK_TOKEN', 'a'.repeat(48)), true, 'the old name was stripped');
  assert.match(hiveSrc, /payload\.hook_token = process\.env\.HIVE_HOOK_SEAL \|\| null;/, 'the shim reads the same name');
  assert.doesNotMatch(hiveSrc, /HIVE_HOOK_TOKEN/);
});
