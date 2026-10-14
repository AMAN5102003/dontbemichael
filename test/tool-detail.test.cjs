'use strict';

/**
 * The one-line tool summary the closing-time rows show (owner, 2026-09-29).
 * The rule that matters: a raw Bash command never leaves the main process,
 * because a command can carry a token. Only Claude's own description does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { toolDetail, toolLine, HookServer } = loadTs('src/main/hooks.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

test('each tool is summarised without its raw input', () => {
  const rows = [
    ['Bash', { command: 'curl -H "Authorization: Bearer abc" x', description: 'Run the full test suite' }, 'Run the full test suite'],
    ['Bash', { command: 'npm test' }, undefined],
    ['Task', { description: 'Research competitors' }, 'Research competitors'],
    ['Agent', { description: 'Draft the newsletter' }, 'Draft the newsletter'],
    ['Read', { file_path: '/Users/x/office/salaries-2026.xlsx' }, 'salaries-2026.xlsx'],
    ['Edit', { file_path: 'C:\\office\\plan.md' }, 'plan.md'],
    ['Write', { file_path: 'notes.txt' }, 'notes.txt'],
    ['NotebookEdit', { notebook_path: '/a/b/model.ipynb' }, 'model.ipynb'],
    ['MultiEdit', { file_path: '/a/b/c.ts' }, 'c.ts'],
    ['mcp__srv____', {}, undefined],
    ['WebFetch', { url: 'https://example.com/private?token=abc' }, 'example.com'],
    ['WebFetch', { url: 'not a url' }, undefined],
    ['mcp__claude_ai_Intuit_QuickBooks__qbo_sales_get_invoices', {}, 'qbo sales get invoices'],
    ['mcp__md-mail__search', { mailbox: 'sales' }, 'search'],
    ['Grep', { pattern: 'password' }, undefined],
    ['Bash', null, undefined],
    ['Bash', 'nonsense', undefined],
    [undefined, {}, undefined]
  ];
  for (const [tool, input, want] of rows) assert.equal(toolDetail(tool, input), want, `${tool} ${JSON.stringify(input)}`);
});

async function hookServer(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-detail-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const sent = [];
  const server = new HookServer(hive, () => ({ send: (c, p) => sent.push({ c, p }) }), () => ({ harnessHome: home }), undefined, undefined);
  const call = (event, tool_name, tool_input, extra = {}) => server.handle({ agent_id: 'pam', session_id: 's1', hook_event_name: event, tool_name, tool_input, cwd: home, ...extra });
  const lastHook = () => sent.filter((s) => s.c === 'hive:hookEvent').pop()?.p;
  return { call, lastHook };
}

test('the hook sends the detail on PreToolUse only, redacted and at most 80 characters', async (t) => {
  const h = await hookServer(t);
  await h.call('PreToolUse', 'Bash', { command: 'x', description: 'Deploy with key sk-ant-abcdefghijklmnopqrstuvwxyz0123' });
  assert.equal(h.lastHook().detail, 'Deploy with key [redacted]');
  await h.call('PreToolUse', 'Bash', { command: 'x', description: 'a'.repeat(200) });
  assert.equal(h.lastHook().detail.length, 80);
  // Value: protects=a multi-line Bash description reaches the row as one single-spaced line; fails_when=toolLine stops collapsing whitespace; why_new=only redaction and the 80-char cap were checked; seam=none
  await h.call('PreToolUse', 'Bash', { command: 'x', description: '  Run\n\tthe   tests\r\nnow  ' });
  assert.equal(h.lastHook().detail, 'Run the tests now');
  await h.call('PostToolUse', 'Bash', { command: 'x', description: 'Run tests' });
  assert.equal(h.lastHook().detail, undefined);
  await h.call('PreToolUse', 'Bash', { command: 'secret-command --token abc' });
  assert.equal(h.lastHook().detail, undefined, 'no description: nothing, never the command');
});

test('the hook passes on the call id, so parallel calls can be told apart', async (t) => {
  // Value: protects=the panel can match a PostToolUse to its PreToolUse; fails_when=emit drops tool_use_id or passes a non-string; why_new=TODOS "Parallel tool calls clear each other's detail"; seam=none
  const h = await hookServer(t);
  await h.call('PreToolUse', 'Read', { file_path: '/a/plan.md' }, { tool_use_id: 'toolu_1' });
  assert.equal(h.lastHook().toolUseId, 'toolu_1');
  await h.call('PostToolUse', 'Read', { file_path: '/a/plan.md' }, { tool_use_id: 'toolu_1' });
  assert.equal(h.lastHook().toolUseId, 'toolu_1');
  await h.call('PostToolUse', 'Read', {}, { tool_use_id: 42 });
  assert.equal(h.lastHook().toolUseId, undefined);
});

test('a huge agent-written description is cut before redaction, so the hook stays fast', () => {
  // Value: protects=an agent cannot freeze the main process with a 256 KB description; fails_when=toolLine redacts the full text before cutting it; why_new=ship adversarial review measured 2.6 s at 64 KB; seam=none
  const big = 'a-'.repeat(128 * 1024);
  const t0 = process.hrtime.bigint();
  const line = toolLine('Bash', { command: 'x', description: big });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 200, `took ${ms.toFixed(0)} ms`);
  assert.equal(line.length, 80);
});

test('the line drops hidden and direction-reversing characters and never splits an emoji', () => {
  // Value: protects=the owner sees the real text of the line they decide by; fails_when=bidi/zero-width characters survive or the 80 cut splits a surrogate pair; why_new=ship adversarial review; seam=none
  assert.equal(toolLine('Bash', { description: 'Run \u202Etset\u200B the suite' }), 'Run tset the suite', 'removed, not spaced');
  const emoji = '😀'.repeat(100);
  const line = toolLine('Bash', { description: emoji });
  assert.equal(Array.from(line).length, 80);
  assert.ok(!/[\uD800-\uDBFF]$/.test(line), 'no lone high surrogate at the end');
});

test('a private key that starts in the line but ends past the old 512 cut is still redacted', () => {
  // Value: protects=a key straddling the scan window never shows its opening on screen; fails_when=the scan window shrinks below real key sizes; why_new=ship review run 3 (red team); seam=none
  const key = '-----BEGIN RSA PRIVATE KEY-----' + 'A'.repeat(1600) + '-----END RSA PRIVATE KEY-----';
  const line = toolLine('Bash', { description: `Use ${key} to sign` });
  assert.doesNotMatch(line, /BEGIN|AAAA/);
});

test('a private key too long for the scan window drops the line instead of showing its start', () => {
  // Value: protects=an 8192-bit key cut off by the window never shows its header or first bytes; fails_when=the key-header guard is removed; why_new=ship review cycle 2; seam=none
  const key = '-----BEGIN RSA PRIVATE KEY-----' + 'A'.repeat(5000) + '-----END RSA PRIVATE KEY-----';
  assert.equal(toolLine('Bash', { description: `Use ${key} to sign` }), undefined);
});

test('an invisible character inside a token does not split it past redaction', () => {
  // Value: protects=a zero-width character hidden in a token cannot keep it on screen; fails_when=format characters are replaced with a space before redaction; why_new=ship run 3 Step 11 adversarial F3; seam=none
  const token = 'ghp_' + 'A'.repeat(10) + '\u200b' + 'B'.repeat(26);
  const line = toolLine('Bash', { description: `push with ${token}` });
  assert.doesNotMatch(line, /AAAAAAAAAA|BBBBBBBBBB/);
});

test('a refused tool call sends no detail', async (t) => {
  // Value: protects=a denied tool call never leaves a phantom step description in the closing-time row; fails_when=PreToolUse sends detail even when refused; why_new=TODOS.md "A refused tool call still shows its detail"; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-detail-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const sent = [];
  const control = { shouldHalt: () => false, toolDecision: () => ({ deny: true, reason: 'Paused by the owner.' }) };
  const server = new HookServer(hive, () => ({ send: (c, p) => sent.push({ c, p }) }), () => ({ harnessHome: home }), control);
  const res = await server.handle({ agent_id: 'pam', session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'x', description: 'Run the tests' }, cwd: home });
  assert.equal(res.hookSpecificOutput?.permissionDecision, 'deny');
  assert.equal(sent.filter((s) => s.c === 'hive:hookEvent').pop()?.p.detail, undefined);
});

/* Generated by the /ship coverage audit (Step 7, 2026-10-13): every gate that
 * refuses a call sends no step, not only the owner's pause (#261 merged onto
 * the gates this branch added). */

/** A business office on disk: Michael in the business folder, Pam in a team
 *  folder inside it, Research on at its desk. Every hook event is recorded. */
async function businessOffice(t) {
  const R = loadTs('src/shared/research.ts');
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-detail-office-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'HarnessAgents');
  const business = path.join(base, 'Harbor Pizza');
  const pamDir = path.join(business, 'Admin');
  const desk = path.join(home, R.RESEARCH_DESK_DIR);
  for (const d of [home, business, pamDir, desk]) fs.mkdirSync(d, { recursive: true });
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: business, isGod: true });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: pamDir });
  await hive.ensureAgent({ id: R.RESEARCH_ID, name: 'Research', provider: 'claude', cwd: desk, isResearch: true });
  hive.setResearchEnabled(() => true);
  const cfg = { harnessHome: home, businessFolder: business, businessTeam: [{ agentId: 'pam', folder: pamDir }] };
  const sent = [];
  const server = new HookServer(hive, () => ({ send: (c, p) => sent.push({ c, p }) }), () => cfg);
  const cwdOf = (id) => (id === 'god' ? business : pamDir);
  /** One PreToolUse call: was it refused, and the detail its hook event carried. */
  const call = (agentId, tool, input) => {
    const before = sent.length;
    const res = server.handle({ agent_id: agentId, session_id: 's1', hook_event_name: 'PreToolUse', cwd: cwdOf(agentId), tool_name: tool, tool_input: input });
    const ev = sent.slice(before).filter((s) => s.c === 'hive:hookEvent').pop();
    return { denied: res?.hookSpecificOutput?.permissionDecision === 'deny', sent: !!ev, detail: ev?.p.detail };
  };
  return { home, desk, call };
}

test('a call refused by the folder or hive guard sends no step either', async (t) => {
  // Value: protects=a file call the folder wall or the hive guard refuses shows no phantom step for the owner; fails_when=either refusal goes back to emit with detail; why_new=the #261 test drives only the owner pause gate; seam=none; no_claim=the renderer drawing the row (hook event payload only)
  const o = await businessOffice(t);
  const rows = [
    ['Pam reads Research\'s notes', 'pam', 'Read', { file_path: path.join(o.desk, 'notes.md') }],
    ['Pam writes into the app\'s home', 'pam', 'Write', { file_path: path.join(o.home, 'draft.md'), content: 'x' }]
  ];
  for (const [label, id, tool, input] of rows) {
    const r = o.call(id, tool, input);
    assert.ok(r.denied, `${label}: refused`);
    assert.ok(r.sent, `${label}: the hook event still goes out`);
    assert.equal(r.detail, undefined, `${label}: no step`);
  }
});

test('a web page or a command outside the sandbox, refused in a business office, sends no step', async (t) => {
  // Value: protects=a refused WebFetch or unsandboxed Bash shows no phantom step (its host or description); fails_when=the web or sandbox gate emits detail on refusal, as hooks.ts does at d8df65e2; why_new=those gates came after #261 and still call emit; seam=none; no_claim=the renderer drawing the row (hook event payload only)
  const o = await businessOffice(t);
  const rows = [
    ['Pam fetches a page', 'pam', 'WebFetch', { url: 'https://example.com/prices', prompt: 'prices' }],
    ['Michael runs a command outside the sandbox', 'god', 'Bash', { command: 'curl https://example.com', description: 'Fetch the price list', dangerouslyDisableSandbox: true }],
    // A connector the owner never turned on (testing review: the connector gate's refusal too).
    ['Pam searches a connector she was not given', 'pam', 'mcp__claude_ai_HubSpot__search_crm_objects', { query: 'Acme' }]
  ];
  for (const [label, id, tool, input] of rows) {
    const r = o.call(id, tool, input);
    assert.ok(r.denied, `${label}: refused`);
    assert.ok(r.sent, `${label}: the hook event still goes out`);
    assert.equal(r.detail, undefined, `${label}: no step`);
  }
});

test('a denied PreToolUse is emitted as blocked=true with no detail (issue: refused tool shows its detail)', async (t) => {
  // Value: protects=the owner never sees a "using Tool · N min" line for a call the hook refused; fails_when=blocked is omitted or detail is populated on a denial; why_new=every denial branch called emit() with default blocked=false, leaking the tool detail to the renderer; seam=control.toolDecision injected
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-detail-denied-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const sent = [];
  const control = { shouldHalt: () => false, toolDecision: () => ({ deny: true, reason: 'Paused by operator.' }) };
  const server = new HookServer(hive, () => ({ send: (c, p) => sent.push({ c, p }) }), () => ({ harnessHome: home }), control, undefined);
  await server.handle({ agent_id: 'pam', session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'x', description: 'Run the full test suite' }, cwd: home });
  const hook = sent.filter((s) => s.c === 'hive:hookEvent').pop()?.p;
  assert.ok(hook, 'a hook event was emitted');
  assert.equal(hook.blocked, true, 'denied call must be emitted as blocked');
  assert.equal(hook.detail, undefined, 'denied call must not carry a detail');
});

test('an allowed PreToolUse is emitted as blocked=false with its detail intact', async (t) => {
  // Value: protects=the happy path still reaches the renderer with detail and blocked=false after the denial guard; fails_when=the guard also suppresses allowed calls; why_new=regression check for the fix above; seam=no control (denial gate skipped)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-detail-allowed-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const sent = [];
  const server = new HookServer(hive, () => ({ send: (c, p) => sent.push({ c, p }) }), () => ({ harnessHome: home }), undefined, undefined);
  await server.handle({ agent_id: 'pam', session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'x', description: 'Run the full test suite' }, cwd: home });
  const hook = sent.filter((s) => s.c === 'hive:hookEvent').pop()?.p;
  assert.ok(hook, 'a hook event was emitted');
  assert.equal(hook.blocked, false, 'allowed call must not be marked blocked');
  assert.equal(hook.detail, 'Run the full test suite', 'allowed call must carry its detail');
});
