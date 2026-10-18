'use strict';

/**
 * Connectors on the owner's Claude account (docs/designs/claude-connectors.md,
 * owner 2026-10-02): discovered with `claude mcp list`, off until the owner
 * turns one on in Settings, used by an agent only once its Access tab grants
 * it. Held at start (no connector at all, or deny rules for what was not given)
 * and on every call (the PreToolUse hook, failing closed).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const loadTs = require('./load-ts.cjs');
const R = loadTs('src/shared/research.ts');
const W = loadTs('src/shared/webAccess.ts');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const C = loadTs('src/shared/claudeConnectors.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// `claude mcp list` as Claude Code 2.1.287 printed it on 2026-10-02 (addresses shortened).
const MCP_LIST = [
  'Checking MCP server health…',
  '',
  'claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected',
  'claude.ai Intuit QuickBooks: https://ai-inc.quickbooks.intuit.com/v1/mcp - ✔ Connected',
  'claude.ai Intuit TurboTax: https://ai-inc.turbotax.intuit.com/x/v1/mcp - ✔ Connected',
  'claude.ai Windsor.ai: https://mcp.windsor.ai - ! Needs authentication',
  'claude.ai HubSpot: https://mcp.hubspot.com/anthropic - ✔ Connected',
  'claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected',
  'claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected',
  'claude.ai Google Calendar: https://calendarmcp.googleapis.com/mcp/v1 - ✔ Connected',
  'plugin:enterprise-search:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication',
  'plugin:enterprise-search:google calendar:  (HTTP) - - Not configured',
  'headroom: /opt/homebrew/bin/headroom mcp serve - ✔ Connected',
  'serena: uvx --from git+https://github.com/oraios/serena serena start-mcp-server --project-from-cwd - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed',
  'HubSpotDev: hs mcp start --ai-agent claude - ✔ Connected'
].join('\n');

test('`claude mcp list` gives the account connectors and the owner\'s other servers', () => {
  const r = C.parseMcpList(MCP_LIST);
  assert.deepEqual(r.connectors.map((c) => c.key), ['Claude Docs', 'Intuit QuickBooks', 'Intuit TurboTax', 'Windsor.ai', 'HubSpot', 'Google Drive', 'Gmail', 'Google Calendar']);
  assert.equal(r.connectors.find((c) => c.key === 'Windsor.ai').status, 'needs-sign-in');
  assert.equal(r.connectors.find((c) => c.key === 'HubSpot').status, 'connected');
  assert.equal(r.connectors.find((c) => c.key === 'Gmail').url, 'https://gmailmcp.googleapis.com/mcp/v1');
  assert.deepEqual(r.servers, ['plugin:enterprise-search:slack', 'plugin:enterprise-search:google calendar', 'headroom', 'serena', 'HubSpotDev']);
  assert.equal(C.parseMcpList('Checking MCP server health…\n\n'), null, 'nothing listed is a failed read');
  assert.equal(C.parseMcpList('Error: not logged in'), null);
});

test('the tool prefix is the server name with every other character turned into _', () => {
  assert.equal(C.connectorRule('Intuit QuickBooks'), 'mcp__claude_ai_Intuit_QuickBooks');
  assert.equal(C.connectorRule('Google Drive'), 'mcp__claude_ai_Google_Drive');
  assert.equal(C.connectorRule('Windsor.ai'), 'mcp__claude_ai_Windsor_ai');
  assert.equal(C.serverRule('plugin:enterprise-search:slack'), 'mcp__plugin_enterprise-search_slack');
  assert.equal(C.serverRule('serena'), 'mcp__serena');
  assert.equal(C.serverRule('HubSpotDev'), 'mcp__HubSpotDev');
});

const LIST = { list: C.parseMcpList(MCP_LIST).connectors, servers: C.parseMcpList(MCP_LIST).servers, readAt: 1 };

async function floor(t, cfg) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-conn-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  for (const id of ['oscar', 'pam']) await hive.ensureAgent({ id, name: id, provider: 'claude', cwd: home });
  const sent = [];
  const server = new HookServer(
    hive, () => ({ send: (c, p) => sent.push({ c, p }) }), () => ({ harnessHome: home, claudeConnectors: LIST, ...cfg }),
    undefined, undefined, undefined, undefined, undefined, undefined, (id) => id === 'oscar'
  );
  const call = (tool_name, agent_id = 'pam', tool_input = {}) => server.handle({ agent_id, session_id: 's1', hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: home });
  return { call, sent, hive, home };
}
const denied = (r) => !!(r && r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny');
const reason = (r) => r.hookSpecificOutput.permissionDecisionReason;

test('every connector is refused until the owner turns it on and gives it to the agent', async (t) => {
  const off = await floor(t, { agentCapabilities: { pam: { connectors: ['HubSpot'] } } });
  assert.match(reason(await off.call('mcp__claude_ai_HubSpot__search_crm_objects')), /HubSpot turned off for the team in Settings/);
  const on = await floor(t, { connectorsOn: { HubSpot: true, 'Google Drive': true }, agentCapabilities: { pam: { connectors: ['HubSpot'] } } });
  assert.ok(!denied(await on.call('mcp__claude_ai_HubSpot__search_crm_objects')), 'on and granted');
  assert.match(reason(await on.call('mcp__claude_ai_Google_Drive__search_files')), /not given you Google Drive/, 'on, not granted');
  assert.match(reason(await on.call('mcp__claude_ai_HubSpot__search_crm_objects', 'oscar')), /not given you HubSpot/, 'another agent');
  assert.ok(!denied(await on.call('Bash')), 'built-in tools are untouched');
});

test('removed, unknown and personal servers are refused; no agent id is refused', async (t) => {
  const f = await floor(t, { connectorsOn: { 'Old Tool': true, HubSpot: true }, agentCapabilities: { pam: { connectors: ['Old Tool', 'HubSpot'] } } });
  assert.match(reason(await f.call('mcp__claude_ai_Old_Tool__x')), /no longer on the owner's Claude account/, 'removed: grants do nothing');
  assert.match(reason(await f.call('mcp__claude_ai_Brand_New__x')), /not turned on for the team/, 'a connector the app has not read');
  assert.match(reason(await f.call('mcp__serena__find_symbol')), /"serena" is not one of the office's connections/, 'the owner\'s own server (E1)');
  assert.ok(denied(await f.call('mcp__plugin_enterprise-search_slack__post')), 'a plugin server (E1)');
  assert.ok(denied(await f.call('mcp__claude_ai_HubSpot__x', null)), 'no agent id (D8)');
});

test('the longest connector name wins, so Google never stands in for Google Drive', () => {
  const cfg = { claudeConnectors: { list: [{ key: 'Google', url: 'a', status: 'connected' }, { key: 'Google Drive', url: 'b', status: 'connected' }] } };
  assert.deepEqual(C.mcpTarget(cfg, 'mcp__claude_ai_Google_Drive__search', {}), { kind: 'connector', key: 'Google Drive' });
  assert.deepEqual(C.mcpTarget(cfg, 'mcp__claude_ai_Google__search', {}), { kind: 'connector', key: 'Google' });
});

test('MCP resource tools follow the connector named in their input', async (t) => {
  const f = await floor(t, { connectorsOn: { HubSpot: true }, agentCapabilities: { pam: { connectors: ['HubSpot'] } } });
  assert.ok(!denied(await f.call('ReadMcpResourceTool', 'pam', { server: 'claude.ai HubSpot', uri: 'x' })));
  assert.ok(denied(await f.call('ReadMcpResourceTool', 'pam', { server: 'claude.ai Google Drive', uri: 'x' })));
  assert.ok(denied(await f.call('ListMcpResourcesTool', 'pam', { server: 'serena' })));
  // Deny rules hide a server's tools, not its resources: an unnamed list would
  // show every connected server's, so the server must be named (owner, 2026-10-02).
  assert.match(reason(await f.call('ListMcpResourcesTool', 'pam', {})), /Name the connector's server/);
  assert.ok(!denied(await f.call('ListMcpResourcesTool', 'pam', { server: 'claude.ai HubSpot' })), 'a granted server by name');
});

test('QuickBooks keeps its switch, Read only and the role default (D10); md-mail keeps Capabilities > Email', async (t) => {
  const f = await floor(t, { quickbooksClaude: true });
  assert.ok(!denied(await f.call('mcp__claude_ai_Intuit_QuickBooks__company_info', 'oscar')), 'Oscar reads the books by default');
  assert.match(reason(await f.call('mcp__claude_ai_Intuit_QuickBooks__qbo_sales_create_invoice', 'oscar')), /Read only/);
  assert.match(reason(await f.call('mcp__claude_ai_Intuit_QuickBooks__company_info', 'pam')), /not given you QuickBooks/);
  assert.match(reason(await f.call('mcp__md-mail__search', 'pam', { mailbox: 'sales' })), /mail|mailbox|email/i, 'md-mail is decided by its own gate');
});

test('an agent with no connector starts with none; one with grants starts with deny rules for the rest (D2, D8, E1)', () => {
  const base = { claudeConnectors: LIST };
  assert.deepEqual(C.spawnConnectorPlan(base, 'pam', false), { strip: true, deny: [] }, 'no grants');
  assert.deepEqual(C.spawnConnectorPlan({ connectorsOn: { HubSpot: true }, agentCapabilities: { pam: { connectors: ['HubSpot'] } } }, 'pam', false), { strip: true, deny: [] }, 'never read: none');
  assert.equal(C.spawnConnectorPlan({ ...base, agentCapabilities: { pam: { connectors: ['HubSpot'] } } }, 'pam', false).strip, true, 'granted but off');
  const oscar = C.spawnConnectorPlan({ ...base, quickbooksClaude: true }, 'oscar', true);
  assert.equal(oscar.strip, false, 'the QuickBooks role default counts as a grant');
  assert.ok(!oscar.deny.includes('mcp__claude_ai_Intuit_QuickBooks'));
  const pam = C.spawnConnectorPlan({ ...base, connectorsOn: { HubSpot: true }, agentCapabilities: { pam: { connectors: ['HubSpot'] } } }, 'pam', false);
  assert.equal(pam.strip, false);
  assert.ok(!pam.deny.includes('mcp__claude_ai_HubSpot'));
  for (const rule of ['mcp__claude_ai_Google_Drive', 'mcp__claude_ai_Intuit_QuickBooks', 'mcp__claude_ai_Windsor_ai', 'mcp__serena', 'mcp__plugin_enterprise-search_slack', 'mcp__HubSpotDev']) {
    assert.ok(pam.deny.includes(rule), rule);
  }
});

test('spawn: stripped agents get the env and strict mode; others get deny rules in their settings', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-conn-spawn-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  const none = await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home }, {});
  assert.equal(none.env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false', 'no plan: none');
  assert.ok(none.args.includes('--strict-mcp-config'));
  const strip = await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home }, { connectors: { strip: true, deny: [] } });
  assert.equal(strip.env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
  const deny = ['mcp__claude_ai_Google_Drive', 'mcp__serena'];
  const granted = await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home }, { connectors: { strip: false, deny } });
  assert.equal(granted.env.ENABLE_CLAUDEAI_MCP_SERVERS, undefined);
  assert.ok(!granted.args.includes('--strict-mcp-config'));
  const settings = JSON.parse(fs.readFileSync(granted.args[granted.args.indexOf('--settings') + 1], 'utf8'));
  for (const rule of deny) assert.ok(settings.permissions.deny.includes(rule), rule);
  // No settings file means no hook and no deny rules: no connectors whatever the grants.
  const src = read('src/main/hive.ts');
  assert.match(src, /const stripConnectors = !opts\.connectors \|\| opts\.connectors\.strip \|\| !settingsWritten;/);
  // Hidden runs have no hook: never any connector.
  const hidden = read('src/main/hiddenClaude.ts');
  assert.match(hidden, /ENABLE_CLAUDEAI_MCP_SERVERS: 'false',/);
  assert.match(hidden, /\['--strict-mcp-config', '--disallowedTools', \.\.\.disallowed\]/);
});

test('a claude an agent starts from its shell loads no connector, even when the agent has grants', { skip: process.platform === 'win32' ? 'bash shell env file' : false }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md conn shell-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  const granted = await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home }, { connectors: { strip: false, deny: [] } });
  // The agent keeps its connectors; only its shell commands get the switch.
  assert.equal(granted.env.ENABLE_CLAUDEAI_MCP_SERVERS, undefined);
  const file = granted.env.CLAUDE_ENV_FILE;
  assert.ok(file && fs.existsSync(file), 'shell env file written');
  // Beside the settings file, outside the hive, so no agent's shell rewrites it.
  const settings = granted.args[granted.args.indexOf('--settings') + 1];
  assert.equal(path.dirname(file), path.dirname(settings));
  const out = spawnSync('bash', ['-c', `source "$1"; printf %s "$ENABLE_CLAUDEAI_MCP_SERVERS"`, 'x', file], { encoding: 'utf8' });
  assert.equal(out.stdout, 'false');
});

test('the hook shim refuses MCP calls when it cannot reach the app, and leaves other tools alone (D8)', { skip: process.platform === 'win32' ? 'unix socket paths' : false }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-conn-shim-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const shim = hive.shimPath();
  const run = (tool_name, env) => spawnSync(process.execPath, [shim], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input: {} }),
    env: { PATH: process.env.PATH, AGENT_ID: 'pam', ...env }, encoding: 'utf8', timeout: 10_000
  });
  for (const env of [{}, { HIVE_SOCK: path.join(home, 'nobody-here.sock') }]) {
    const mcp = run('mcp__claude_ai_HubSpot__search', env);
    assert.equal(mcp.status, 0);
    assert.equal(JSON.parse(mcp.stdout).hookSpecificOutput.permissionDecision, 'deny', JSON.stringify(env));
    assert.equal(JSON.parse(run('ReadMcpResourceTool', env).stdout).hookSpecificOutput.permissionDecision, 'deny');
    const bash = run('Bash', env);
    assert.equal(bash.status, 0);
    assert.equal(bash.stdout, '', 'built-in tools go on as before');
    // Research's every call fails closed: the hook is its file tools' only wall (ship review pass 3).
    for (const tool of ['Read', 'Grep', 'Write', 'Bash']) {
      const r = JSON.parse(run(tool, { ...env, AGENT_ID: 'research' }).stdout);
      assert.equal(r.hookSpecificOutput.permissionDecisionReason, R.RESEARCH_UNCHECKED_TOOL, `Research ${tool} ${JSON.stringify(env)}`);
    }
    // A save into the shared temp folders, which Research's shell reads, fails closed too (Codex review).
    for (const file_path of ['/tmp/draft.md', '/private/var/folders/ab/T/x.md', '/TMP/draft.md']) {
      const r = spawnSync(process.execPath, [shim], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path } }), env: { PATH: process.env.PATH, AGENT_ID: 'pam', ...env }, encoding: 'utf8', timeout: 10_000 });
      assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny', file_path);
    }
    assert.equal(spawnSync(process.execPath, [shim], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(os.homedir(), 'Office', 'x.md') } }), env: { PATH: process.env.PATH, AGENT_ID: 'pam', ...env }, encoding: 'utf8', timeout: 10_000 }).stdout, '', 'its own folders go on as before');
    // Web pages and search fail closed too, for everyone but Research (issue #230, ship review pass 2).
    for (const tool of ['WebFetch', 'WebSearch']) {
      assert.equal(JSON.parse(run(tool, env).stdout).hookSpecificOutput.permissionDecision, 'deny', `${tool} ${JSON.stringify(env)}`);
      assert.equal(JSON.parse(run(tool, { ...env, AGENT_ID: 'research' }).stdout).hookSpecificOutput.permissionDecision, 'deny', `Research ${tool}: its every call fails closed`);
    }
  }
});

test('the one-time carry-over keeps the owner\'s yes and names what the update turned off (D9, E2)', () => {
  const list = LIST.list;
  const mailOn = C.connectorCarryOver({ mcpDefaults: { 'email-calendar': { enabled: true } }, quickbooksClaude: true }, list, ['pam', 'god']);
  assert.deepEqual(mailOn.connectorsOn, { Gmail: true, 'Google Calendar': true });
  for (const id of ['pam', 'god']) assert.deepEqual(mailOn.agentCapabilities[id].connectors, ['Gmail', 'Google Calendar'], `${id}, Michael included`);
  assert.deepEqual(mailOn.switchedOff, ['Claude Docs', 'Intuit TurboTax', 'HubSpot', 'Google Drive'], 'connected, not carried over; not QuickBooks, not Windsor (needs sign in)');
  const mailOff = C.connectorCarryOver({}, list, ['pam']);
  assert.deepEqual(mailOff.connectorsOn, {});
  assert.equal(mailOff.agentCapabilities.pam, undefined);
  assert.deepEqual(C.connectorCarryOver({}, list, []).switchedOff, [], 'a new office had nothing to lose: no card');
  const main = read('src/main/index.ts');
  // Once, after a read that found connectors, in an open office (red team, 2026-10-02).
  assert.match(main, /if \(!cfg\.connectorsMigrated && hive\.enabled\(\) && carryable\) \{/);
  assert.match(main, /if \(carried\.switchedOff\.length\) connectorsUpgradeCard\(carried\.switchedOff\);/);
  assert.match(main, /if \(connectors\.length === 0 && connectorsEmptyReads < 2 && \(\(prev\?\.list\?\.length \?\? 0\) > 0 \|\| \(!cfg\.connectorsMigrated && emailCalendarAllowed\(cfg\.mcpDefaults\)\)\)\) \{/, 'an account that lists no connector after one that did is not answering, unless it says so twice in a row');
});

test('a read that fails keeps the last good list; renames keep switches and grants; removed and new are told apart', async (t) => {
  const main = read('src/main/index.ts');
  assert.match(main, /writeConfig\(\{ claudeConnectors: \{ list: prev\?\.list \?\? null, servers: prev\?\.servers, readAt: prev\?\.readAt, failedAt: Date\.now\(\) \} \}\);/);
  assert.match(main, /\.catch\(\(e\) => \{\s*connectorsEmptyReads = 0;\s*console\.error\('\[connectors\] read:', e\);\s*try \{ connectorsReadFailed\(/, 'a read that throws is a failed read too');
  assert.match(main, /if \(connectorsSeen\?\.includes\(from\)\) connectorsSeen = connectorsSeen\.map/, 'a rename keeps the seen mark');
  assert.match(main, /void refreshClaudeConnectors\('start'\);/, 'read at app start (D11)');
  assert.match(main, /if \(connectorsRead\) return connectorsRead;/, 'one read at a time');
  const prev = [{ key: 'Drive', url: 'https://drive', status: 'connected' }, { key: 'Gone', url: 'https://gone', status: 'connected' }];
  const next = [{ key: 'Google Drive', url: 'https://drive', status: 'connected' }];
  assert.deepEqual(C.renamedKeys(prev, next), [{ from: 'Drive', to: 'Google Drive' }]);
  assert.deepEqual(C.removedKeys({ claudeConnectors: { list: next }, connectorsOn: { Gone: true }, agentCapabilities: { pam: { connectors: ['Other'] } } }), ['Gone', 'Other']);
  assert.deepEqual(C.unseenKeys(next, ['Google Drive']), []);
  assert.deepEqual(C.unseenKeys(next, undefined), ['Google Drive'], 'first visit: everything is new');
  if (process.platform === 'win32') return;
  const { readClaudeMcpList } = loadTs('src/main/claudeMcpList.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = (name, body) => { const f = path.join(dir, name); fs.writeFileSync(f, `#!/bin/sh\n${body}\n`); fs.chmodSync(f, 0o755); return f; };
  assert.deepEqual(await readClaudeMcpList(bin('dies', "echo 'Checking MCP server health…'; exit 1")), { ok: false, why: 'no-servers' });
  const ok = await readClaudeMcpList(bin('lists', "echo 'claude.ai HubSpot: https://x - ✔ Connected'; echo 'serena: uvx - ✘ Failed to connect'; exit 1"));
  assert.equal(ok.ok, true, 'a failing health check still lists');
  assert.deepEqual(ok.list.connectors.map((c) => c.key), ['HubSpot']);
  assert.deepEqual(await readClaudeMcpList(bin('empty', "echo 'No MCP servers configured. Use `claude mcp add` to add a server.'")), { ok: true, list: { connectors: [], servers: [] }, complete: true });
  assert.equal(ok.complete, false, 'a non-zero run is marked incomplete, so it can add but never remove');
  assert.deepEqual(await readClaudeMcpList(null), { ok: false, why: 'no-cli' });
  // A run killed mid-list printed only part of it: a failed read, not the list.
  assert.deepEqual(await readClaudeMcpList(bin('killed', "echo 'claude.ai HubSpot: https://x - ✔ Connected'; kill -TERM $$")), { ok: false, why: 'timeout' });
});

test('a change to an agent\'s connectors restarts it when idle, or at once with Restart now (D2, eng D2)', () => {
  const main = read('src/main/index.ts');
  assert.match(main, /onConfigWritten\(\(cfg\) => \{\s*for \(const rec of connectorPlans\.values\(\)\) \{/);
  assert.match(main, /liveWebContents\(\)\?\.send\('connectors:restartNeeded', \{ agentId: rec\.agentId \}\)/);
  // The plan the agent started with is the one recorded, so a change made
  // while it was starting still asks for a restart; signing in counts too.
  assert.match(main, /const connectorPlan = opts\.hive && claudeProvider && !isResearch \? connectorStart\(readConfig\(\), opts\.hive\.id\) : undefined;/);
  assert.match(main, /connectors: connectorPlan\?\.plan/);
  assert.match(main, /connectorPlans\.set\(opts\.id, \{ agentId: opts\.hive\.id, sig: failures === 1 \? 'unapplied' : connectorPlan\.sig \}\);/, 'one retry after a failed injection, then quiet');
  assert.match(main, /const signedIn = usableConnectors\(cfg, agentId, books\)\.map\(\(c\) => `\$\{c\.key\}:\$\{c\.status\}`\)/);
  assert.match(main, /connectorPlans\.delete\(id\);/);
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /if \(a\?\.ptyId\) useStore\.getState\(\)\.setPendingRestart\(agentId, \{ at: Date\.now\(\), reason: 'connectors' \}\);/);
  const cap = read('src/renderer/src/components/CapabilitiesTab.tsx');
  assert.match(cap, /\{!pending\.now && <MiniButton onClick=\{restartNow\}>\{t\('capabilities\.restartNow'\)\}<\/MiniButton>\}/);
  assert.match(cap, /pending\.failed \? t\('capabilities\.restartFailed', \{ name \}\)\s*: pending\.now \? t\('capabilities\.restarting', \{ name \}\)/, 'Restart now shows it is restarting, and a failure says so');
  assert.match(hive, /if \(cur\) setPendingRestart\(agentId, \{ \.\.\.cur, now: false, failed: true \}\);/, 'a failed restart gives Restart now back');
});

test('Settings: the connector list folds, starts closed, opens for something new or a failed read (design D3)', () => {
  const ui = read('src/renderer/src/components/ClaudeConnectorsSettings.tsx');
  assert.match(ui, /const \[open, setOpen\] = useState\(false\);/);
  assert.match(ui, /if \(state\.failedAt \|\| unseenKeys\(state\.list, config\.connectorsSeen\)\.length\) setOpen\(true\);/);
  assert.match(ui, /void window\.cth\.connectorsRefresh\('settings'\)/, 'opening Settings reads the account again (D11)');
  // Marking the list seen must not answer its own echo: every save comes back
  // as a fresh config object (ship review, 2026-10-02: an endless write loop).
  assert.match(ui, /\}, \[open, listKeys\]\);/);
  assert.match(read('src/main/index.ts'), /if \(keys && keys\.join\('\\n'\) !== \(cfg\.connectorsSeen \?\? \[\]\)\.join\('\\n'\)\) writeConfig\(\{ connectorsSeen: keys \}\);/);
  assert.match(ui, /<button type="button" aria-expanded=\{open\} aria-controls=\{listId\}/);
  assert.match(ui, /<Toggle on=\{on\} label=\{t\('connectors\.allow', \{ name: c\.key \}\)\}/);
  assert.ok(ui.indexOf('{removed.map(') < ui.indexOf('{list.map('), 'removed ones first');
  assert.match(ui, /t\('connectors\.signIn'\)/, 'needs sign in shows the way (E3)');
  assert.match(ui, /\) : unreachable \? \(\s*<span style=\{hint\}>\{t\('connectors\.unreachable'\)\}<\/span>/, 'a connector that failed to connect is not sent to sign in');
});

test('Access tab: one Claude connectors card with a row per connector that is on (design D4)', () => {
  const cap = read('src/renderer/src/components/CapabilitiesTab.tsx');
  assert.match(cap, /title=\{t\('capabilities\.connectors'\)\}/);
  assert.match(cap, /<Toggle on=\{on\} label=\{t\('capabilities\.canUseConnector', \{ name, connector: c\.key \}\)\}/);
  assert.match(cap, /\{t\('capabilities\.connectorsNone'\)\}\{' '\}\s*<button type="button" onClick=\{openSettings\} style=\{link\}>\{t\('capabilities\.connectorsTurnOn'\)\}<\/button>/);
  assert.ok(cap.indexOf("title={t('capabilities.email')}") < cap.indexOf("title={t('capabilities.connectors')}"), 'the app\'s own Email card stays above');
  assert.match(cap, /\{c\.status === 'unreachable' && <span style=\{hint\}>\{t\('capabilities\.unreachable'\)\}<\/span>\}/, 'a failed connection says so, not sign in');
});

test('connector copy exists in every language and has no dashes', () => {
  const keys = {
    connectors: ['title', 'intro', 'reading', 'summaryNone', 'summaryOne', 'summaryCount', 'removedCount', 'refresh', 'refreshing', 'readFailed', 'readFailedSince', 'tryAgain', 'empty', 'addAtClaude', 'removed', 'clear', 'signIn', 'unreachable', 'connected', 'allow'],
    capabilities: ['connectors', 'connectorsBlurb', 'connectorsSummary', 'connectorsNone', 'connectorsTurnOn', 'canUseConnector', 'needsSignIn', 'unreachable', 'booksRoleDefault', 'connectorsPending', 'restartNow']
  };
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const j = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    assert.equal(j.quickbooksSettings, undefined, `${loc}: the QuickBooks section is gone`);
    for (const [sec, ks] of Object.entries(keys)) {
      for (const k of ks) {
        assert.ok(j[sec][k], `${loc} ${sec}.${k}`);
        assert.doesNotMatch(j[sec][k], /[—–]| - /, `${loc} ${sec}.${k}`);
      }
    }
  }
});

// ─── Ship audit (2026-10-02): behaviour the source checks above only describe ───

// Value: protects=D8 fail closed at the socket: a gate that throws refuses an MCP call and leaves built-in tools alone; fails_when=the catch in HookServer.start returns {} for every tool, or denies Bash too; why_new=the only check of this catch is a regex over hooks.ts, which passes even if the catch never runs; seam=none
test('over the hook socket, a gate that throws refuses an MCP call and lets a built-in tool go on (D8)', { skip: process.platform === 'win32' ? 'unix socket paths' : false }, async (t) => {
  const net = require('node:net');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-conn-sock-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const token = hive.mintHookToken('pam');
  const server = new HookServer(hive, () => null, () => { throw new Error('config unreadable'); });
  server.start();
  t.after(() => server.stop());
  const ask = (payload) => new Promise((resolve, reject) => {
    let out = '';
    const c = net.createConnection(hive.sockPath(), () => c.write(JSON.stringify({ hook_token: token, ...payload }) + '\n'));
    c.setEncoding('utf8');
    c.on('data', (d) => { out += d; });
    c.on('end', () => resolve(JSON.parse(out)));
    c.on('error', reject);
  });
  const base = { agent_id: 'pam', session_id: 's1', hook_event_name: 'PreToolUse', tool_input: {}, cwd: home };
  for (const tool_name of ['mcp__claude_ai_HubSpot__search_crm_objects', 'ReadMcpResourceTool']) {
    const r = await ask({ ...base, tool_name });
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny', tool_name);
    assert.equal(r.hookSpecificOutput.permissionDecisionReason, C.CONNECTOR_UNDECIDED, tool_name);
  }
  const bash = await ask({ ...base, tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.ok(!denied(bash), 'built-in tools go on as before');
  // Web pages and search fail closed too, for everyone but Research (issue #230, testing review pass 3).
  server.handle = () => { throw new Error('gate threw'); };
  for (const tool_name of ['WebFetch', 'WebSearch']) {
    assert.equal((await ask({ ...base, tool_name })).hookSpecificOutput.permissionDecisionReason, W.WEB_SETTINGS_UNREADABLE, tool_name);
  }
  assert.ok(!denied(await ask({ ...base, tool_name: 'Bash', tool_input: { command: 'ls' } })));
  const researchToken = hive.mintHookToken('research');
  for (const tool_name of ['WebFetch', 'Read', 'Bash']) {
    assert.equal((await ask({ ...base, agent_id: 'research', hook_token: researchToken, tool_name })).hookSpecificOutput.permissionDecisionReason, R.RESEARCH_UNCHECKED_TOOL, `Research ${tool_name}`);
  }
  // A save into the shared temp folders fails closed here too, as in the hook program (api review).
  assert.equal((await ask({ ...base, tool_name: 'Write', tool_input: { file_path: '/TMP/draft.md', content: 'x' } })).hookSpecificOutput.permissionDecisionReason, R.RESEARCH_UNCHECKED_TOOL);
  assert.ok(!denied(await ask({ ...base, tool_name: 'Write', tool_input: { file_path: path.join(os.homedir(), 'Office', 'x.md'), content: 'x' } })), 'a folder outside the temp folders goes on');
});

// Value: protects=the no-agent check runs before the md-mail skip, and a needs-sign-in connector the owner turned on and gave works without a re-read; fails_when=connectorAccess checks the app server before agentId (md-mail calls with no agent id then pass, since the md-mail gate needs an agent id), or the gate starts reading the stale saved status; why_new=no test calls md-mail without an agent id or a needs-sign-in connector that is on and granted; seam=none
test('md-mail with no agent id is refused; a connector saved as needs sign in works once on and given (D8, E3)', async (t) => {
  const f = await floor(t, { connectorsOn: { 'Windsor.ai': true }, agentCapabilities: { pam: { connectors: ['Windsor.ai'] } } });
  assert.match(reason(await f.call('mcp__md-mail__search', null, { mailbox: 'sales' })), /only for the team/);
  assert.ok(denied(await f.call('ReadMcpResourceTool', null, { server: 'md-mail', uri: 'x' })), 'a resource read of md-mail with no agent id too');
  assert.equal(LIST.list.find((c) => c.key === 'Windsor.ai').status, 'needs-sign-in');
  assert.ok(!denied(await f.call('mcp__claude_ai_Windsor_ai__get_data')), 'the saved status can be stale: signing in at claude.ai is enough');
  assert.match(reason(await f.call('mcp__claude_ai_Windsor_ai__get_data', 'oscar')), /not given you Windsor\.ai/);
});

// Value: protects=the one-time carry-over keeps what each agent already had (its QuickBooks choice and other grants) and adds Gmail and Calendar once; fails_when=connectorCarryOver replaces an agent's capabilities or connectors instead of merging, or duplicates a key already granted; why_new=the existing carry-over test starts from empty capabilities only; seam=none
test('the carry-over merges into what each agent already has, QuickBooks untouched, no key twice (D9)', () => {
  const qb = { enabled: true, mode: 'read' };
  const cfg = {
    mcpDefaults: { 'email-calendar': { enabled: true } },
    connectorsOn: { HubSpot: true },
    agentCapabilities: { pam: { quickbooks: qb, connectors: ['HubSpot', 'Gmail'], email: { enabled: true, mailboxes: ['sales'], send: false } } }
  };
  const r = C.connectorCarryOver(cfg, LIST.list, ['pam', 'oscar']);
  assert.deepEqual(r.connectorsOn, { HubSpot: true, Gmail: true, 'Google Calendar': true });
  assert.deepEqual(r.agentCapabilities.pam.quickbooks, qb, 'QuickBooks keeps each agent\'s choice');
  assert.deepEqual(r.agentCapabilities.pam.email, cfg.agentCapabilities.pam.email, 'the app\'s own mailboxes too');
  assert.deepEqual(r.agentCapabilities.pam.connectors, ['HubSpot', 'Gmail', 'Google Calendar']);
  assert.deepEqual(r.agentCapabilities.oscar.connectors, ['Gmail', 'Google Calendar']);
  assert.deepEqual(cfg.agentCapabilities.pam.connectors, ['HubSpot', 'Gmail'], 'the saved config is not changed in place');
});

// Value: protects=a rename only moves switches and grants to a name the account did not have before; fails_when=renamedKeys drops the "not already in prev" guard (a connector that changed address onto another's would take its grants) or follows an empty address; why_new=the existing rename test covers only the plain rename; seam=none
test('a rename never hands grants to a connector that was already there, and needs an address (D11)', () => {
  const prev = [{ key: 'Drive', url: 'https://drive', status: 'connected' }, { key: 'Docs', url: 'https://docs', status: 'connected' }];
  assert.deepEqual(C.renamedKeys(prev, [{ key: 'Docs', url: 'https://drive', status: 'connected' }]), [], 'Docs was already on the account');
  assert.deepEqual(C.renamedKeys([{ key: 'Old', url: '', status: 'connected' }], [{ key: 'New', url: '', status: 'connected' }]), [], 'no address, no rename');
  assert.deepEqual(C.renamedKeys(null, [{ key: 'New', url: 'https://x', status: 'connected' }]), [], 'first read: nothing moved');
});

// ─── Ship review fixes (2026-10-02) ───

// Value: protects=the parser the app uses reads Claude Code's status words, a repeated line is one connector, and the Claude CLI is asked whatever engine the team runs; fails_when=the line pattern requires a status mark, "Not connected" or "Failed" reads as connected, or claudeBinFor takes a non-Claude or env-prefixed first word; why_new=moved from the retired QuickBooks status check, whose parser was deleted; seam=none
test('`claude mcp list` status words: only a real Connected counts', () => {
  const one = (st) => C.parseMcpList(`claude.ai Intuit QuickBooks: https://ai-inc.quickbooks.intuit.com/v1/mcp - ${st}`).connectors[0].status;
  assert.equal(one('✔ Connected'), 'connected');
  assert.equal(one('Not connected'), 'needs-sign-in');
  assert.equal(one('✘ Failed to connect'), 'unreachable', 'a failed connection is not a sign in problem');
  assert.equal(one('✘ Failed to connect — CONNECTION_CLOSED: Connection closed'), 'unreachable');
  assert.equal(one('✗ Error: fetch failed'), 'unreachable');
  assert.equal(one('! Needs authentication'), 'needs-sign-in');
  assert.equal(one('✘ Needs authentication'), 'needs-sign-in', 'a sign in problem stays one whatever the mark');
  const twice = C.parseMcpList('claude.ai HubSpot: https://a - ✔ Connected\nclaude.ai HubSpot: https://a - ✔ Connected');
  assert.equal(twice.connectors.length, 1, 'a repeated line is one connector');
  const { claudeBinFor } = loadTs('src/main/claudeMcpList.ts');
  // Whatever engine the team runs, the Claude CLI is the one asked.
  assert.equal(claudeBinFor('claude --model opus'), 'claude');
  assert.equal(claudeBinFor('/opt/bin/claude'), '/opt/bin/claude');
  assert.equal(claudeBinFor('codex'), 'claude');
  assert.equal(claudeBinFor('npx something'), 'claude');
  assert.equal(claudeBinFor('FOO=1 claude'), 'claude');
  assert.equal(claudeBinFor(undefined), 'claude');
});

/** Runs the real hook shim against a started HookServer and returns its stdout. */
async function throughShim(t, cfg, payload) {
  const { spawn } = require('node:child_process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-conn-shim2-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const server = new HookServer(hive, () => null, () => ({ harnessHome: home, claudeConnectors: LIST, ...cfg }));
  server.start();
  t.after(() => server.stop());
  await new Promise((r) => setTimeout(r, 50));
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [hive.shimPath()], { env: { PATH: process.env.PATH, AGENT_ID: 'pam', HIVE_SOCK: hive.sockPath(), HIVE_HOOK_SEAL: hive.mintHookToken('pam') } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out));
    p.stdin.end(JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', cwd: home, ...payload }));
  });
}
const shimDecision = (out) => (out ? JSON.parse(out).hookSpecificOutput?.permissionDecision ?? 'allow' : 'allow');
const GRANTED = { connectorsOn: { HubSpot: true }, agentCapabilities: { pam: { connectors: ['HubSpot'] } } };

// Value: protects=a granted connector call with a big input (a long document) still works and is still checked; fails_when=the shim sends the full payload, which the server drops at 256 KB, so the call is refused every time; why_new=the shim was only tested with no socket or a dead one; seam=none
test('an MCP call over the hook frame limit is checked on its short fields and allowed when granted', { skip: process.platform === 'win32' ? 'unix socket paths' : false }, async (t) => {
  const big = { body: 'x'.repeat(300_000), title: 'Notes' };
  assert.equal(shimDecision(await throughShim(t, GRANTED, { tool_name: 'mcp__claude_ai_HubSpot__x', tool_input: big })), 'allow');
  assert.equal(shimDecision(await throughShim(t, GRANTED, { tool_name: 'mcp__claude_ai_Google_Drive__x', tool_input: big })), 'deny', 'still refused when not given');
  assert.equal(await throughShim(t, GRANTED, { tool_name: 'Bash', tool_input: big }), '', 'built-in tools are unchanged');
});

// Value: protects=inside a Task subagent every gate checks the call as the team member, and a subagent finishing is not the agent finishing; fails_when=the shim keeps Claude Code's subagent id in agent_id (grants refused, folder privacy skipped) or the hook treats SubagentStop as the agent's stop; why_new=Claude Code 2.1.287 sets agent_id inside subagents and no test sent one; seam=none
test('a Task subagent is checked as its team member, and its finish is not the agent\'s (Claude Code sets agent_id)', { skip: process.platform === 'win32' ? 'unix socket paths' : false }, async (t) => {
  assert.equal(shimDecision(await throughShim(t, GRANTED, { agent_id: 'subagent-1', tool_name: 'mcp__claude_ai_HubSpot__x', tool_input: {} })), 'allow', 'granted to Pam, so to her subagent');
  assert.equal(shimDecision(await throughShim(t, {}, { agent_id: 'subagent-1', tool_name: 'mcp__claude_ai_HubSpot__x', tool_input: {} })), 'deny');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-conn-sub-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const sent = [];
  const server = new HookServer(hive, () => ({ send: (c, p) => sent.push({ c, p }) }), () => ({ harnessHome: home }));
  assert.deepEqual(server.handle({ agent_id: 'pam', subagent_id: 'subagent-1', hook_event_name: 'SubagentStop', session_id: 'sub' }), {});
  assert.equal(sent.length, 0, 'nothing tells the floor Pam finished');
  server.handle({ agent_id: 'pam', subagent_id: 'subagent-1', hook_event_name: 'PostToolUse', session_id: 'sub', transcript_path: '/tmp/sub.jsonl', tool_name: 'Read' });
  assert.equal(server.transcriptPath('pam'), undefined, 'the subagent transcript is not Pam\'s');
  const shim = read('src/main/hive.ts');
  assert.match(shim, /if \(me && payload\.agent_id && payload\.agent_id !== me\) payload\.subagent_id = payload\.agent_id;/);
});

// Value: protects=a Claude agent whose hive injection failed or is off starts with no connector and no personal server (D8); fails_when=the spawn path continues with no --settings and no strip flags after ensureAgent throws; why_new=only the hive.ts strip path was tested, not the spawn path around it; seam=none
test('an agent whose hive settings could not be written starts with no connectors', () => {
  const main = read('src/main/index.ts');
  assert.match(main, /if \(connectorPlan && !connectorsApplied\) \{[\s\S]{0,300}'--strict-mcp-config'[\s\S]{0,120}ENABLE_CLAUDEAI_MCP_SERVERS: 'false'/);
  assert.match(main, /opts\.args = \[\.\.\.\(opts\.args \?\? \[\]\), \.\.\.inj\.args\];(?:\s*\/\/[^\n]*)*\s*if \(isResearch\) opts\.args = \[\.\.\.opts\.args, '--setting-sources', ''\];\s*connectorsApplied = true;/, 'only a completed injection counts as applied');
});

// Value: protects=connector deny rules sit beside the folder privacy rules in one permissions.deny list; fails_when=hookSettings writes deny: connectorDeny (or only the folder rules) and one set silently disappears; why_new=folder and connector rules were only tested apart; seam=none
test('connector deny rules sit beside the folder rules, never in place of them', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-conn-fold-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  const folderPolicy = { sandbox: { denyWrite: [], denyRead: [], allowRead: [] }, deny: ['Read(//Users/me/Documents/Biz/Admin/**)'], sandboxOnly: true };
  const inj = await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home }, { folderPolicy, connectors: { strip: false, deny: ['mcp__serena', 'mcp__claude_ai_Google_Drive'] } });
  const settings = JSON.parse(fs.readFileSync(inj.args[inj.args.indexOf('--settings') + 1], 'utf8'));
  for (const r of ['Read(//Users/me/Documents/Biz/Admin/**)', 'mcp__serena', 'mcp__claude_ai_Google_Drive']) assert.ok(settings.permissions.deny.includes(r), r);
});

// ─── Codex adversarial review fixes (2026-10-02) ───

// Value: protects=after a read, only the discovered QuickBooks connector reaches the QuickBooks gate, and a removed QuickBooks is refused; fails_when=the unknown-connector carve-out matches any server named like QuickBooks (a project .mcp.json "claude.ai QuickBooks Backdoor") or QuickBooks skips the list check; why_new=QuickBooks tests run with no list, so the spoof and the removal were never exercised; seam=none
test('a server named like QuickBooks is not QuickBooks, and a removed QuickBooks is refused', async (t) => {
  const on = { quickbooksClaude: true };
  const f = await floor(t, on);
  assert.ok(!denied(await f.call('mcp__claude_ai_Intuit_QuickBooks__company_info', 'oscar')), 'the real one, read only for Oscar');
  assert.match(reason(await f.call('mcp__claude_ai_QuickBooks_Backdoor__company_info', 'oscar')), /not turned on for the team/, 'a look-alike tool');
  assert.ok(denied(await f.call('ReadMcpResourceTool', 'oscar', { server: 'claude.ai QuickBooks Backdoor', uri: 'x' })), 'a look-alike resource');
  const gone = await floor(t, { ...on, claudeConnectors: { list: LIST.list.filter((c) => c.key !== 'Intuit QuickBooks'), servers: [], readAt: 1 } });
  assert.ok(denied(await gone.call('mcp__claude_ai_Intuit_QuickBooks__company_info', 'oscar')), 'QuickBooks left the account');
});

// Value: protects=a quoted Claude path with spaces is asked, not swapped for plain claude, and a run that stopped part way never removes connectors or servers; fails_when=claudeBinFor splits on spaces inside quotes, or refreshClaudeConnectors saves a shorter incomplete list; why_new=Codex adversarial review found both; seam=none
test('the Claude path survives quotes, and an incomplete run can only add', () => {
  const { claudeBinFor } = loadTs('src/main/claudeMcpList.ts');
  assert.equal(claudeBinFor('"/Applications/Claude Code/bin/claude" --model opus'), '/Applications/Claude Code/bin/claude');
  assert.equal(claudeBinFor('FOO=1 /opt/bin/claude'), '/opt/bin/claude');
  const main = read('src/main/index.ts');
  assert.match(main, /connectors = \[\.\.\.connectors, \.\.\.\(prev\?\.list \?\? \[\]\)\.filter\(\(c\) => !seen\.has\(c\.key\) && !\(c\.url && urls\.has\(c\.url\)\)\)\];/, 'an incomplete run keeps every connector the last good read had');
  assert.match(main, /servers = \[\.\.\.new Set\(\[\.\.\.servers, \.\.\.\(prev\?\.servers \?\? \[\]\)\]\)\];/, 'and every server, so none leaves the deny list');
  assert.match(main, /if \(!cfg\.connectorsMigrated && hive\.enabled\(\) && carryable\) \{/, 'the carry-over waits for a list good enough to carry');
  assert.match(main, /const carryable = emailOn\s*\? listed && \(r\.complete \|\| r\.list\.connectors\.some\(\(c\) => isEmailCalendarKey\(c\.key\)\)\)\s*: r\.complete \|\| listed;/, 'an empty list never uses up the Gmail carry-over');
  assert.match(main, /!\(c\.url && urls\.has\(c\.url\)\)/, 'an incomplete run still lets a rename through');
});

// Value: protects=only the exact Intuit QuickBooks connector keeps QuickBooks' own switch; any other connector naming QuickBooks needs its own switch and grant; fails_when=isQuickBooksKey goes back to a substring match, so a new "QuickBooks Payroll" connector rides quickbooksClaude; why_new=Codex adversarial review (second pass) found the substring match; seam=none
test('a second connector that mentions QuickBooks gets its own switch and grants', async (t) => {
  assert.equal(C.isQuickBooksKey('Intuit QuickBooks'), true);
  assert.equal(C.isQuickBooksKey('QuickBooks Payroll'), false);
  const list = { list: [...LIST.list, { key: 'QuickBooks Payroll', url: 'https://payroll.example', status: 'connected' }], servers: [], readAt: 1 };
  const f = await floor(t, { claudeConnectors: list, quickbooksClaude: true, agentCapabilities: { pam: { quickbooks: { enabled: true, changes: true } } } });
  assert.match(reason(await f.call('mcp__claude_ai_QuickBooks_Payroll__run_payroll')), /QuickBooks Payroll turned off for the team in Settings/, 'the QuickBooks switch does not open it');
  assert.ok(!denied(await f.call('mcp__claude_ai_Intuit_QuickBooks__qbo_sales_create_invoice')), 'the real QuickBooks still follows its own rules');
});

// Value: protects=only two successful empty reads in a row replace the list, and a window that missed the restart push can ask for it; fails_when=a failed read leaves the empty count standing, or the renderer only learns of restarts from a live push; why_new=Codex adversarial review (second pass); seam=none
test('a failed read resets the empty count, and missed restarts can be asked for', () => {
  const main = read('src/main/index.ts');
  assert.match(main, /if \(!r\.ok\) \{ connectorsEmptyReads = 0; connectorsReadFailed/);
  assert.match(main, /\.catch\(\(e\) => \{\s*connectorsEmptyReads = 0;/);
  assert.match(main, /ipcMain\.handle\('connectors:pendingRestarts', \(\) => \{/);
  assert.match(read('src/renderer/src/hooks/useHive.ts'), /void window\.cth\.connectorsPendingRestarts\?\.\(\)\.then\(\(ids\) => ids\.forEach\(queue\)\)/);
});

// Value: protects=md-mail resource calls never skip the mailbox check, and two connector names with the same tool prefix are both refused; fails_when=connectorAccess allows resource tools for the app server, or mcpTarget picks the first of two colliding keys; why_new=Codex adversarial review (third pass); seam=none
test('md-mail resources are refused, and connectors whose names collide are refused', async (t) => {
  const f = await floor(t, { agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['sales'], send: true } } } });
  assert.match(reason(await f.call('ReadMcpResourceTool', 'pam', { server: 'md-mail', uri: 'mail://x' })), /no resources/);
  const cfg = { claudeConnectors: { list: [{ key: 'Foo Bar', url: 'a', status: 'connected' }, { key: 'Foo_Bar', url: 'b', status: 'connected' }] }, connectorsOn: { 'Foo Bar': true }, agentCapabilities: { pam: { connectors: ['Foo Bar'] } } };
  assert.equal(C.mcpTarget(cfg, 'mcp__claude_ai_Foo_Bar__x', {}).kind, 'unknown-connector', 'neither name wins');
  assert.equal(C.connectorAccess(cfg, 'pam', 'mcp__claude_ai_Foo_Bar__x', {}, false).ok, false);
});

