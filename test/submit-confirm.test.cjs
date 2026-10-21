'use strict';

/**
 * 2026-10-03: Oscar sat on closing time. Three nudges reached his session as
 * one prompt: a slow terminal (just resumed on a 174k conversation) read each
 * nudge and its Enter as one burst, so the first Enter became a line break and
 * the second vanished. Typing now waits for Claude Code's UserPromptSubmit and
 * presses Enter again when it does not come.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const loadTs = require('./load-ts.cjs');

const { confirmSubmit, PromptSubmits } = loadTs('src/shared/submitConfirm.ts');
const { RunningToolCalls } = loadTs('src/renderer/src/hooks/runningToolCalls.ts');
const { isClaudeProvider } = loadTs('src/shared/agentProvider.ts');
const { isTerminalPrompt } = loadTs('src/shared/hookEvents.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const instant = () => Promise.resolve();

// Execute the production submitter and hook listener together, replacing only
// Electron/React boundaries and time. This catches missing wiring between them.
function rendererSubmission(onPoll, breaker = 'healthy') {
  const source = read('src/renderer/src/hooks/useHive.ts');
  const ast = ts.createSourceFile('useHive.ts', source, ts.ScriptTarget.Latest, true);
  const submitter = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'submitToPty');
  let listener;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'onHiveHookEvent') listener = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(submitter && listener && ts.isArrowFunction(listener), 'production submission paths exist');
  const compiled = ts.transpileModule(
    `${submitter.getText(ast)}\nconst onHook = ${listener.getText(ast)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  const writes = [];
  const promptSubmits = new PromptSubmits();
  const agents = [{ id: 'alice', ptyId: 'pty-alice', status: 'idle' }, { id: 'bob', ptyId: 'pty-bob', status: 'idle' }];
  let runtime;
  const deps = {
    writeChains: new Map(),
    waitForTerminalReady: instant,
    window: { cth: { writePty: async (_id, data) => { writes.push(data); return { ok: true }; } } },
    isClaudeProvider,
    useStore: { getState: () => ({ agents, updateAgent: (id, update) => Object.assign(agents.find((a) => a.id === id), update) }) },
    promptSubmits,
    runningCalls: new RunningToolCalls(),
    confirmSubmit: (opts) => confirmSubmit({ ...opts, confirmMs: 100, sleep: async () => onPoll(runtime) }),
    isTerminalAutomationSafe: () => true,
    hasTerminalDraft: () => false,
    setTimeout: (callback) => { callback(); return 0; },
    breakerLevel: { current: { alice: breaker } },
    ACTION_AT_PROMPT: 'at prompt',
    isTerminalPrompt,
    console: { warn: () => {} }
  };
  runtime = new Function('deps', `const { ${Object.keys(deps).join(', ')} } = deps;\n${compiled}\nreturn { submitToPty, onHook };`)(deps);
  return { ...runtime, writes, promptSubmits, agents };
}

test('an Enter the terminal swallowed is pressed again until the agent accepts the prompt', async () => {
  // Value: protects=a typed nudge or message is always submitted; fails_when=a missing UserPromptSubmit is not retried, or retries run after acceptance; why_new=regression of the 2026-10-03 Oscar hang; seam=fake clock
  let accepted = false; let enters = 0;
  const ok = await confirmSubmit({ accepted: () => accepted, pressEnter: () => { enters++; if (enters === 1) accepted = true; }, confirmMs: 300, sleep: instant });
  assert.equal(ok, true);
  assert.equal(enters, 1, 'one extra Enter, then it took');
  enters = 0;
  assert.equal(await confirmSubmit({ accepted: () => true, pressEnter: () => { enters++; }, confirmMs: 300, sleep: instant }), true);
  assert.equal(enters, 0, 'accepted at once: no extra Enter');
  enters = 0;
  assert.equal(await confirmSubmit({ accepted: () => false, pressEnter: () => { enters++; }, confirmMs: 300, retries: 2, sleep: instant }), false);
  assert.equal(enters, 2, 'gives up after the retries');
});

test('acceptance counts only from the moment the text was typed', () => {
  // Value: protects=an older prompt never confirms a new one; fails_when=since() ignores the typed-at time; why_new=new; seam=none
  const p = new PromptSubmits();
  p.note('oscar', 1000);
  assert.equal(p.since('oscar', 1500), false);
  p.note('oscar', 2000);
  assert.equal(p.since('oscar', 1500), true);
  assert.equal(p.since('pam', 0), false);
});

test('acceptance during the final poll prevents another Enter at every retry boundary', async () => {
  for (const acceptedOnSleep of [1, 2, 3]) {
    let accepted = false;
    let sleeps = 0;
    let enters = 0;
    const ok = await confirmSubmit({
      accepted: () => accepted,
      pressEnter: () => { enters++; },
      confirmMs: 100,
      retries: 3,
      sleep: async () => { if (++sleeps === acceptedOnSleep) accepted = true; }
    });
    assert.equal(ok, true);
    assert.equal(enters, acceptedOnSleep - 1, `accepted in polling window ${acceptedOnSleep}`);
  }
});

for (const event of ['Notification', 'PermissionRequest']) {
  for (const breaker of ['healthy', 'stopped']) {
    test(`renderer stops retrying after ${event}, breaker ${breaker}`, async () => {
      const runtime = rendererSubmission(({ onHook }) => onHook({ agentId: 'alice', event, message: 'Claude needs your permission to use Bash' }), breaker);
      await runtime.submitToPty('pty-alice', 'report status', 'claude', 0);
      assert.deepEqual(runtime.writes, ['report status', '\r'], 'only the initial Enter is sent');
      assert.equal(runtime.promptSubmits.attentionSince('alice', 0), true, 'hook records attention even while the breaker pins status');
    });
  }
}

test('renderer treats idle notifications conservatively during an unconfirmed submission', async () => {
  const runtime = rendererSubmission(({ onHook }) => onHook({ agentId: 'alice', event: 'Notification', message: 'Claude is waiting for your input' }));
  await runtime.submitToPty('pty-alice', 'report status', 'claude', 0);
  assert.deepEqual(runtime.writes, ['report status', '\r']);
});

test('renderer still retries when only another agent asks for attention', async () => {
  const runtime = rendererSubmission(({ onHook }) => onHook({ agentId: 'bob', event: 'Notification', message: 'Claude needs your permission to use Bash' }));
  await runtime.submitToPty('pty-alice', 'report status', 'claude', 0);
  assert.deepEqual(runtime.writes, ['report status', '\r', '\r', '\r']);
});

test('renderer still retries when attention predates the submission', async () => {
  const runtime = rendererSubmission(() => {});
  runtime.promptSubmits.noteAttention('alice', Date.now() - 10_000);
  await runtime.submitToPty('pty-alice', 'report status', 'claude', 0);
  assert.deepEqual(runtime.writes, ['report status', '\r', '\r', '\r']);
});

test('renderer does not retry when its prompt was accepted at the polling boundary', async () => {
  const runtime = rendererSubmission(({ onHook }) => onHook({ agentId: 'alice', event: 'UserPromptSubmit' }));
  await runtime.submitToPty('pty-alice', 'report status', 'claude', 0);
  assert.deepEqual(runtime.writes, ['report status', '\r']);
});

test('renderer sends non-Claude input without waiting for a Claude prompt hook', async () => {
  const runtime = rendererSubmission(() => assert.fail('Codex must not enter Claude confirmation'));
  await runtime.submitToPty('pty-alice', 'report status', 'codex', 0);
  assert.deepEqual(runtime.writes, ['report status', '\r']);
});

test('renderer sends slash commands without waiting for a prompt hook', async () => {
  const runtime = rendererSubmission(() => assert.fail('slash commands must not enter prompt confirmation'));
  await runtime.submitToPty('pty-alice', '/compact', 'claude', 0);
  assert.deepEqual(runtime.writes, ['/compact', '\r']);
});

test('a tool that finished is no longer named as running', () => {
  // Value: protects=the closing-time row never names a finished tool as running; fails_when=PostToolUse with nothing running keeps "using <tool>"; why_new=TODOS "Row still names a finished tool"; seam=production hook listener with stubbed store
  const runtime = rendererSubmission(() => {});
  const alice = runtime.agents.find((a) => a.id === 'alice');
  Object.assign(alice, { status: 'working', action: 'using Bash', actionDetail: 'Run the tests' });
  runtime.onHook({ agentId: 'alice', event: 'PostToolUse', tool: 'Bash', toolUseId: 'toolu_1' });
  assert.equal(alice.action, 'thinking');
  assert.equal(alice.actionDetail, undefined);
  Object.assign(alice, { action: 'idle' });
  runtime.onHook({ agentId: 'alice', event: 'UserPromptSubmit' });
  assert.equal(alice.action, 'idle', 'only a finished tool changes the caption');
});

test('both typing paths wait for the agent to accept, Claude agents only', () => {
  // Value: protects=the renderer queue and the main wake watchdog both confirm; fails_when=either path goes back to fire and forget; why_new=new; seam=source pins
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /if \(e\.event === 'UserPromptSubmit'\) \{ promptSubmits\.note\(e\.agentId\);/);
  assert.match(hive, /const agentId = isClaudeProvider\(provider\) && !text\.trimStart\(\)\.startsWith\('\/'\) \? useStore\.getState\(\)\.agents\.find\(\(a\) => a\.ptyId === ptyId\)\?\.id : undefined;/, 'slash commands fire no prompt hook, so they are not confirmed');
  assert.match(hive, /stillSafe: \(\) => isTerminalAutomationSafe\(ptyId\) && !hasTerminalDraft\(ptyId\)/, 'an extra Enter never lands on the owner typing or an open menu');
  const main = read('src/main/index.ts');
  assert.match(main, /if \(agentId && event === 'UserPromptSubmit'\) promptSubmits\.note\(agentId\);/);
  assert.match(main, /confirmSubmit\(\{\s*accepted: \(\) => promptSubmits\.since\(agentId, typedAt\),/);
});
