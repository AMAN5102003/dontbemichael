'use strict';

/**
 * The Claude account's Gmail and Google Calendar are connectors like any other
 * (docs/designs/claude-connectors.md, owner 2026-10-02, D6). They used to be
 * one Settings switch for every agent alike (owner, 2026-09-26); now the owner
 * turns each on in Settings > Connections > Claude connectors and gives it to
 * an agent on its Access tab. Off, or not given, the PreToolUse hook refuses
 * every call, Michael's included. The app's own mailboxes (md-mail) follow
 * Capabilities > Email alone.
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

const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');

const LIST = {
  list: [
    { key: 'Gmail', url: 'https://gmailmcp.googleapis.com/mcp/v1', status: 'connected' },
    { key: 'Google Calendar', url: 'https://calendarmcp.googleapis.com/mcp/v1', status: 'connected' }
  ],
  servers: [],
  readAt: 1
};

async function floor(t, cfg) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-mail-switch-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const sent = [];
  const server = new HookServer(hive, () => ({ send: (c, p) => sent.push({ c, p }) }), () => ({ harnessHome: home, claudeConnectors: LIST, ...cfg }), undefined, undefined);
  const call = (tool_name, agent_id = 'pam') => server.handle({
    agent_id, session_id: 's1', hook_event_name: 'PreToolUse', tool_name, tool_input: {}, cwd: home
  });
  return { call, sent, server, home };
}

const denied = (r) => r && r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny';

test('with Gmail off in Settings, an agent reading Gmail is refused through the hook', async (t) => {
  const f = await floor(t, { agentCapabilities: { pam: { connectors: ['Gmail'] } } });
  const r = await f.call('mcp__claude_ai_Gmail__search_threads');
  assert.ok(denied(r));
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /Gmail turned off for the team in Settings/);
  assert.ok(denied(await f.call('mcp__claude_ai_Google_Calendar__list_events')));
  assert.ok(denied(await f.call('mcp__claude_ai_Gmail__search_threads', 'god')), 'Michael too');
});

test('on in Settings, only the agents given Gmail or Calendar use them, Michael like anyone', async (t) => {
  const f = await floor(t, {
    connectorsOn: { Gmail: true, 'Google Calendar': true },
    agentCapabilities: { pam: { connectors: ['Gmail'] }, god: { connectors: ['Gmail', 'Google Calendar'] } }
  });
  assert.ok(!denied(await f.call('mcp__claude_ai_Gmail__search_threads')));
  assert.ok(!denied(await f.call('mcp__claude_ai_Gmail__send_message')));
  const cal = await f.call('mcp__claude_ai_Google_Calendar__list_events');
  assert.ok(denied(cal), 'Pam was given Gmail, not Calendar');
  assert.match(cal.hookSpecificOutput.permissionDecisionReason, /not given you Google Calendar/);
  assert.ok(!denied(await f.call('mcp__claude_ai_Google_Calendar__list_events', 'god')), 'Michael was given both');
  assert.ok(!denied(await f.call('mcp__claude_ai_Gmail__some_future_tool')), 'a tool added later under a granted connector works');
  assert.ok(denied(await f.call('mcp__claude_ai_Mailchimp__list_campaigns')), 'a connector the app never read is refused');
});

test('the old team-wide switch no longer opens Gmail by itself', async (t) => {
  const f = await floor(t, { mcpDefaults: { 'email-calendar': { enabled: true } } });
  assert.ok(denied(await f.call('mcp__claude_ai_Gmail__search_threads')), 'carried over once as grants (D9), never read again');
});

test('md-mail calls are checked against the named mailbox', async (t) => {
  const f = await floor(t, {
    mcpDefaults: { 'email-calendar': { enabled: true } },
    mailboxes: [{ id: 'sales', address: 'sales@x.com', provider: 'gmail', imap: { host: 'h', port: 993, secure: true }, smtp: { host: 'h', port: 465, secure: true }, status: 'connected', createdAt: 1, updatedAt: 1 }],
    agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['sales'], send: false } } }
  });
  const call = (tool, input) => f.server.handle({ agent_id: 'pam', session_id: 's1', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: f.home });
  assert.ok(!denied(await call('mcp__md-mail__list_mailboxes', {})));
  assert.ok(!denied(await call('mcp__md-mail__search', { mailbox: 'sales' })));
  assert.ok(denied(await call('mcp__md-mail__search', { mailbox: 'ceo' })));
  assert.ok(denied(await call('mcp__md-mail__send', { mailbox: 'sales' })), 'Draft only');
});

test('Gmail on the Claude account and md-mail mailboxes are separate: md-mail follows Capabilities alone', async (t) => {
  const f = await floor(t, {
    mailboxes: [{ id: 'sales', address: 'sales@x.com', provider: 'gmail', imap: { host: 'h', port: 993, secure: true }, smtp: { host: 'h', port: 465, secure: true }, status: 'connected', createdAt: 1, updatedAt: 1 }],
    agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['sales'], send: true } } }
  });
  const call = (tool, input) => f.server.handle({ agent_id: 'pam', session_id: 's1', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: f.home });
  assert.ok(!denied(await call('mcp__md-mail__search', { mailbox: 'sales' })), 'Gmail off, added mailbox still works');
  assert.ok(denied(await call('mcp__claude_ai_Gmail__search_threads', {})), 'Gmail off, Claude account blocked');
});

test('an md-mail tool the gate does not know is refused, and md-mail never reads the connector switches (ship audit)', async (t) => {
  const f = await floor(t, {
    mcpDefaults: { 'email-calendar': { enabled: false } },
    mailboxes: [{ id: 'sales', address: 'sales@x.com', provider: 'gmail', imap: { host: 'h', port: 993, secure: true }, smtp: { host: 'h', port: 465, secure: true }, status: 'connected', createdAt: 1, updatedAt: 1 }],
    agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['sales'], send: true } } }
  });
  const call = (tool, input, agent = 'pam') => f.server.handle({ agent_id: agent, session_id: 's1', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: f.home });
  const unknown = await call('mcp__md-mail__delete_everything', { mailbox: 'sales' });
  assert.ok(denied(unknown));
  assert.match(unknown.hookSpecificOutput.permissionDecisionReason, /Unknown mail tool/);
  assert.ok(denied(await call('mcp__md-mail__search', {})), 'no mailbox named');
  assert.ok(denied(await call('mcp__md-mail__search', { mailbox: 42 })), 'a mailbox that is not a string');
  assert.ok(!denied(await call('mcp__md-mail__send', { mailbox: 'sales' })), 'Can send, switch off: still allowed');
  assert.ok(denied(await call('mcp__md-mail__list_mailboxes', {}, 'god')), 'Michael follows the same rule: no capability, no mail');
});
