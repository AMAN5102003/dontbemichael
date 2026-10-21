'use strict';

/**
 * Issue #326 end to end, with no paid calls (eng R5): fake engines that print
 * and either never check in or check in late, through the real hook socket,
 * the real HookServer, the not reporting watch and the hive router. The watch
 * runs on a fake clock so the minute long check in time passes at once.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const { SilentWatch } = loadTs('src/main/silentWatch.ts');
const { mailFor, CHECK_IN_MS } = loadTs('src/shared/silentEngine.ts');

const FAKE = path.join(__dirname, 'fixtures', 'fake-engine.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Waits for an outcome, never for a fixed time: a slow runner only waits longer.
const until = async (cond, what, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await wait(10);
  }
};
const inbox = (hive, id) => {
  const dir = path.join(hive.root(), 'agents', id, 'inbox');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
};
const post = (hive, from, msg, name) => fs.writeFileSync(path.join(hive.root(), 'agents', from, 'outbox', name), JSON.stringify(msg));

test('fake engines through the real socket, watch and router: card, held mail, late check in, hookless and short silence (R5)', { skip: process.platform === 'win32' ? 'unix socket paths' : false }, async (t) => {
  // Value: protects=the wiring between the hook socket, the watch and the router; fails_when=hook events never reach the watch, a silent member's mail is not held, a late check in does not clear it, a hookless command or a short silence raises a card; why_new=#326 asks for it (R5); seam=none; no_claim=real Claude, Codex or Gemini binaries (fake engine)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-silent-e2e-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  for (const [id, name, provider] of [['kelly', 'Kelly', 'claude'], ['dwight', 'Dwight', 'claude'], ['nick', 'Nick', 'custom'], ['pam', 'Pam', 'claude']]) {
    await hive.ensureAgent({ id, name, provider, cwd: home });
  }

  const clock = { t: 1_000_000 };
  const events = [];
  const watch = new SilentWatch({
    now: () => clock.t, platform: 'darwin',
    mayAutoRestart: () => false, restart: () => false, stop: () => {},
    changed: () => {}, event: (e) => events.push([e.type, e.episode.agentId])
  });
  hive.memberMail = (id) => mailFor(watch.episode(id));
  const heard = new Set();
  const server = new HookServer(hive, () => null, () => ({ harnessHome: home }), undefined, undefined, undefined, (agentId) => { heard.add(agentId); watch.noteHook(agentId); });
  server.start();
  t.after(() => server.stop());

  // kelly never checks in; dwight checks in late; nick is a hookless custom
  // command; pam starts last, so its silence stays short.
  const out = {};
  const engines = [];
  const run = (id, env = {}) => {
    const p = spawn(process.execPath, [FAKE], { env: { ...process.env, HIVE_SOCK: hive.sockPath(), HIVE_HOOK_SEAL: hive.mintHookToken(id), AGENT_ID: id, ...env } });
    out[id] = { hasOutput: false, at: 0 };
    p.stdout.on('data', () => { out[id] = { hasOutput: true, at: clock.t }; });
    engines.push(p);
  };
  t.after(() => { for (const p of engines) p.kill(); });
  run('kelly'); run('dwight', { HOOK_AFTER_MS: '400' }); run('nick');
  await until(() => out.kelly.hasOutput && out.dwight.hasOutput && out.nick.hasOutput, 'the fake engines to print');
  await until(() => heard.has('dwight'), "dwight's check in through the socket");

  const snapshot = (id, provider) => ({
    id, ptyId: `p-${id}`, running: true, engine: provider === 'custom' ? 'custom' : 'claude', engineLabel: provider, version: null,
    isMichael: false, reports: provider !== 'custom', statusTicks: provider === 'claude',
    hasOutput: !!out[id]?.hasOutput, lastOutputAt: clock.t - 500, lastInputAt: 0
  });
  const beatUntil = (ms, ids) => { const end = clock.t + ms; while (clock.t < end) { clock.t += 8000; watch.beat(ids.map(([id, p]) => snapshot(id, p))); } };

  beatUntil(CHECK_IN_MS + 16_000, [['kelly', 'claude'], ['dwight', 'claude'], ['nick', 'custom']]);
  run('pam');
  await until(() => out.pam.hasOutput, 'pam to print');
  beatUntil(16_000, [['kelly', 'claude'], ['dwight', 'claude'], ['nick', 'custom'], ['pam', 'claude']]);

  assert.equal(watch.episode('kelly')?.state, 'open', 'never checked in: a card');
  assert.equal(watch.episode('dwight'), undefined, 'checked in late through the socket: no card');
  assert.equal(watch.episode('nick'), undefined, 'a hookless custom command is never flagged');
  assert.equal(watch.episode('pam'), undefined, 'silence shorter than the check in time does nothing');

  // Kelly's new mail is held for Michael; Pam's still reaches Pam.
  post(hive, 'dwight', { to: 'kelly', act: 'inform', subject: 'Invoice 4471', body: 'Please reply to Maria' }, 'm1.json');
  post(hive, 'dwight', { to: 'pam', act: 'inform', subject: 'Board packet', body: 'Numbers are in' }, 'm2.json');
  const held = () => inbox(hive, 'god').some((m) => /^\[held: "Kelly" isn't reporting to the app/.test(m.subject) && /Invoice 4471/.test(m.subject));
  const toPam = () => inbox(hive, 'pam').some((m) => m.subject === 'Board packet');
  await until(() => { hive.routeOnce(); return held() && toPam(); }, 'both messages to be routed');
  assert.equal(inbox(hive, 'kelly').length, 0);
  assert.ok(held());
  assert.ok(toPam(), 'a healthy member is never held (R4)');

  // Kelly checks in late: the card closes and mail flows again.
  run('kelly', { HOOK_AFTER_MS: '0' });
  await until(() => watch.episode('kelly') === undefined, "kelly's late check in");
  assert.deepEqual(events.filter((e) => e[1] === 'kelly').map((e) => e[0]), ['opened', 'resolved']);
  post(hive, 'dwight', { to: 'kelly', act: 'inform', subject: 'Follow up', body: 'Thanks' }, 'm3.json');
  await until(() => { hive.routeOnce(); return inbox(hive, 'kelly').some((m) => m.subject === 'Follow up'); }, 'mail to reach kelly again');
});
