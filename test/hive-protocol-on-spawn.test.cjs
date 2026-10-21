'use strict';

/**
 * Does the office protocol actually REACH the engine on a spawn?
 *
 * The preset registry is only ever checked against itself (engine-readiness.test.cjs
 * reads its own fields), so a preset can be complete on paper and still spawn an
 * agent that was never told what it is. `pi` was exactly that. Its own comment said
 * the protocol arrives positionally, `positionalInitialPrompt` was never set, and
 * `HiveManager.ensureAgent` therefore fell through to a BARE spawn: the bridge,
 * HIVE_SOCK and `canReceiveInbox` were all live, so the router delivered owner mail
 * to an agent that did not know it had a mailbox. That is the same failure
 * `buildCmdCommandLine`'s doc comment describes for the Windows command line, one
 * level up: the agent boots looking healthy and never learns what it is.
 *
 * This drives the consumer instead. Every preset that claims a place in the hive is
 * put through ensureAgent, and the injection it returns has to carry the protocol.
 * The set is DERIVED from the preset (a lifecycle bridge, an inbox, or a resume), so
 * a new engine joins the check the day it is declared, and a preset that claims
 * nothing (kimi, custom) is simply not in it. No exemption list to keep in step
 * with the registry.
 *
 * What this does and does not prove: it pins what the app HANDS the engine, not
 * that the engine reads it. That needs a live CLI with an account, which is what
 * TODOS.md gap 11 (issue #83) waits for. No engine runs here and no call is paid
 * for, so this rides the suite's existing macOS and Windows CI legs unchanged.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { AGENT_PROVIDER_PRESETS, bridgeOf } = loadTs('src/shared/agentProvider.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

// agy and grok install their hook group into the USER's global config
// (`~/.gemini/.../hooks.json`, `~/.grok/hooks`, hive.ts installAgyHooks /
// installGrokHooks). A test must not write those on the machine that runs it, so
// both home variables point into this file's temp tree for the whole run. Every
// preset this touches reads homedir() per call, not at import.
const FAKE_HOME = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-proto-home-')));
process.env.HOME = FAKE_HOME;
process.env.USERPROFILE = FAKE_HOME;
process.on('exit', () => fs.rmSync(FAKE_HOME, { recursive: true, force: true }));

/** Does this preset claim a place in the hive? A bridge, an inbox or a resume all
 *  mean the app will put an office member on it, and an office member that never
 *  receives the protocol does not know what it is. */
function claimsHive(preset) {
  return !!bridgeOf(preset.id) || preset.canReceiveInbox === true || !!(preset.resumeFlag || preset.resumeSubcommand);
}

/** The identity + protocol block ensureAgent builds. Matched on its content and
 *  not on its position, so the test never has to know a flag name to find it. */
function isProtocol(arg) {
  return typeof arg === 'string' && arg.length > 1000 && arg.includes('PROTOCOL.md')
    && arg.includes('inbox') && arg.includes('outbox');
}

/** One office on disk: a harness home and a business folder, the two paths
 *  ensureAgent provisions an agent from. */
function office(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-proto-')));
  const home = path.join(base, 'HarnessAgents');
  const business = path.join(base, 'Documents', 'Pho Bakery');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(business, { recursive: true });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { home, business };
}

/** What index.ts hands the PTY for one agent on this engine. */
async function injectFor(id, t) {
  const { home, business } = office(t);
  const hive = new HiveManager(() => home);
  // A proxy-tier engine (qwen, crush) starts a real loopback sidecar; without
  // this its socket holds the test process open and wedges the whole run.
  t.after(() => { try { hive.stopAllProxyBridges(); } catch { /* already gone */ } });
  return hive.ensureAgent(
    { id: `${id}-1`, name: 'Worker', provider: id, cwd: business, isGod: false },
    { businessFolder: business }
  );
}

test('the check covers every engine that claims the hive, and only those', () => {
  const claimed = AGENT_PROVIDER_PRESETS.filter(claimsHive).map((p) => p.id);
  assert.ok(claimed.includes('pi'), 'the engine this change is about must be in the set');
  assert.ok(claimed.includes('claude'), 'the engine this build offers must be in the set');
  for (const id of ['kimi', 'custom']) {
    assert.ok(!claimed.includes(id), `${id} claims no bridge, inbox or resume, so nothing promises it a seed`);
  }
  assert.ok(claimed.length >= 10, `sanity: ${claimed.length} engines checked`);
});

test('every engine that claims the hive is spawned with the protocol', async (t) => {
  for (const preset of AGENT_PROVIDER_PRESETS.filter(claimsHive)) {
    await t.test(preset.id, async (st) => {
      const injection = await injectFor(preset.id, st);
      // A TUI with no flag and no positional takes the protocol AFTER boot instead
      // (crush, cursor): the renderer types it in, so argv carries nothing. Exactly
      // one delivery, so a preset that grows both would be caught here.
      if (injection.seedPrompt) {
        assert.ok(isProtocol(injection.seedPrompt), `${preset.id}: the seed handed to the TUI is not the protocol`);
        assert.deepEqual(injection.args.filter(isProtocol), [],
          `${preset.id}: the protocol must not also ride argv when it is seeded into the TUI`);
        return;
      }
      const carried = injection.args.filter(isProtocol);
      assert.equal(carried.length, 1,
        `${preset.id}: the protocol must be on argv exactly once, got args ${JSON.stringify(summarise(injection.args))}`);
      // It is a multi line block. Any step that folds argv back into a single shell
      // string loses it at the first newline (buildCmdCommandLine's doc comment).
      assert.ok(carried[0].includes('\n'), `${preset.id}: the protocol arrived folded into one line`);
      // A CLI that takes its first turn POSITIONALLY reads it off the end of argv,
      // after its own flags (codex puts --add-dir pairs in front of it). One that
      // takes it under a flag has no such rule, and Claude's injection appends
      // --settings and --strict-mcp-config after the prompt. This pins what
      // ensureAgent builds; a resumed worker appends its resume args after the
      // prompt, which is the spawn caller's business and not this branch's.
      if (!preset.initialPromptFlag && preset.positionalInitialPrompt) {
        assert.equal(injection.args[injection.args.length - 1], carried[0],
          `${preset.id}: a positional prompt must be the last argument`);
      }
    });
  }
});

test('a pi worker gets the protocol and keeps its hooks bridge', async (t) => {
  // The regression this change fixes, named on its own so it fails loudly: pi was
  // wired on every side except the one that tells the agent it is in an office.
  const injection = await injectFor('pi', t);
  const last = injection.args[injection.args.length - 1];
  assert.ok(isProtocol(last), `pi must be spawned with the protocol, got ${JSON.stringify(summarise(injection.args))}`);
  // The bridge still has to be installed: seeding a worker that reports no
  // lifecycle events would be worse than the bare spawn it replaces.
  const piDir = injection.env.PI_CODING_AGENT_DIR;
  assert.ok(piDir, 'the pi extension dir must still be set');
  assert.ok(fs.existsSync(path.join(piDir, 'extensions', 'hive-bridge.js')),
    `the pi extension must be written under ${piDir}`);
  assert.ok(injection.env.HIVE_SOCK, 'the hook socket must still be passed');
});

/** argv with the long protocol elided, so a failure prints something readable. */
function summarise(args) {
  return args.map((a) => (isProtocol(a) ? `<protocol ${a.length} chars>` : a));
}
