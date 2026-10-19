'use strict';

/**
 * Capabilities → QuickBooks (owner, 2026-09-29). The app does not connect to
 * Intuit; agents inherit the QuickBooks connector on the owner's Claude
 * account. Each agent's Capabilities say whether it may use it, and whether it
 * may make changes. The PreToolUse hook enforces it on every call. Before the
 * owner chooses, roles that read the books (Oscar) are on, Read only; everyone
 * else is off.
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

const { isQuickBooksConnectorTool, isQuickBooksReadTool, quickbooksCapability, quickbooksAccessToSave } = loadTs('src/shared/quickbooks.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');

const Q = 'mcp__claude_ai_Intuit_QuickBooks__';

// The connector's tools as agents see them (read from agent transcripts,
// 2026-09-29), split by whether they change anything in QuickBooks.
const READS = [
  'benchmarking_against_industry', 'benchmarking_against_industry_text', 'benchmarking_quickbooks_account', 'benchmarking_quickbooks_account_text',
  'business_health_check_widget', 'cash_flow_generator', 'cash_flow_quickbooks_account', 'cash_flow_quickbooks_account_text', 'company_info',
  'industry_benchmark_widget', 'industry_recommendation', 'money_onboarding_application_metadata', 'profit_loss_generator',
  'profit_loss_quickbooks_account', 'profit_loss_quickbooks_account_text',
  'qbo_accounting_get_ap_aging_detail', 'qbo_accounting_get_ar_aging_summary', 'qbo_accounting_get_balance_sheet',
  'qbo_accounting_get_product_service_list', 'qbo_accounting_get_sales_by_customer_summary_text',
  'qbo_catalog_search_products', 'qbo_contact_search_customer',
  'qbo_lending_estimate_loan_payments', 'qbo_lending_get_loans', 'qbo_lending_help',
  'qbo_payroll_get_company_pay_types', 'qbo_payroll_get_employees', 'qbo_payroll_get_pay_schedules', 'qbo_payroll_get_payslips', 'qbo_payroll_search_employee',
  'qbo_sales_get_estimates', 'qbo_sales_get_invoices', 'qbo_sales_get_settings', 'qbo_sales_get_transaction_document'
];
const CHANGES = [
  'money_onboarding_application_submit', 'qbo_catalog_create_product', 'qbo_contact_create_customer',
  'qbo_payroll_assign_employee_work_location', 'qbo_payroll_create_employee', 'qbo_payroll_save_employee_contract_details', 'qbo_payroll_update_employee',
  'qbo_sales_create_estimate', 'qbo_sales_create_invoice', 'qbo_sales_create_payment_link', 'qbo_sales_delete_invoice',
  'qbo_sales_duplicate_invoice', 'qbo_sales_operate_recurring_invoice', 'qbo_sales_send_invoice', 'qbo_sales_send_invoice_reminder',
  'qbo_sales_update_invoice', 'qbo_sales_update_settings', 'quickbooks_profile_info_update', 'quickbooks_transaction_import',
  // They may share the books with lenders, so Read only refuses them.
  'qbo_lending_shop_loans', 'qbo_lending_get_peer_offers'
];

test('QuickBooks connector tools are recognised, and look-alikes are not', () => {
  for (const name of [
    `${Q}company_info`,
    'mcp__claude_ai_QuickBooks__qbo_sales_get_invoices',
    'mcp__qbo-test__company_info',
    'mcp__bdf9ac2e-2c1f-46a9-bc82-52b54e300aa7__qbo_accounting_get_balance_sheet'
  ]) assert.ok(isQuickBooksConnectorTool(name), name);
  for (const name of [
    'mcp__claude_ai_Gmail__search_threads',
    'mcp__claude_ai_Xero__get_invoices',
    'mcp__md-mail__search',
    'Read',
    'Bash'
  ]) assert.ok(!isQuickBooksConnectorTool(name), name);
});

test('reads and changes are told apart, and an unknown tool counts as a change', () => {
  for (const t of READS) assert.ok(isQuickBooksReadTool(Q + t), `${t} reads`);
  for (const t of CHANGES) assert.ok(!isQuickBooksReadTool(Q + t), `${t} changes`);
  assert.ok(!isQuickBooksReadTool(`${Q}anything`), 'an unknown tool is a change');
  // Value: protects=a tool Intuit adds later is refused under Read only even when it names a read-sounding noun; fails_when=Read only goes back to guessing from words; why_new=ship adversarial review; seam=none
  for (const t of ['qbo_sales_accept_estimate', 'qbo_sales_convert_estimate', 'qbo_banking_reconcile_account', 'qbo_reports_export_report']) {
    assert.ok(!isQuickBooksReadTool(Q + t), `${t} is not a known read`);
  }
});

test('before the owner chooses, a books role is on and Read only; others are off', () => {
  assert.deepEqual(quickbooksCapability(undefined, true), { enabled: true, changes: false });
  assert.deepEqual(quickbooksCapability(undefined, false), { enabled: false, changes: false });
  assert.deepEqual(quickbooksCapability({ enabled: false, changes: false }, true), { enabled: false, changes: false }, 'the owner turned Oscar off');
  assert.deepEqual(quickbooksCapability({ enabled: true, changes: true }, false), { enabled: true, changes: true });
  assert.deepEqual(quickbooksCapability({ enabled: false, changes: true }, false), { enabled: false, changes: false }, 'changes never outlive off');
});

async function floor(t, cfg) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-qbo-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  for (const id of ['oscar', 'pam']) await hive.ensureAgent({ id, name: id, provider: 'claude', cwd: home });
  const sent = [];
  const server = new HookServer(
    hive, () => ({ send: (c, p) => sent.push({ c, p }) }), () => ({ harnessHome: home, ...cfg }),
    undefined, undefined, undefined, undefined, undefined, undefined,
    (id) => id === 'oscar'
  );
  const call = (tool, agent_id) => server.handle({ agent_id, session_id: 's1', hook_event_name: 'PreToolUse', tool_name: Q + tool, tool_input: {}, cwd: home });
  const raw = (tool_name, tool_input, agent_id) => server.handle({ agent_id, session_id: 's1', hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: home });
  return { call, raw, sent };
}

const denied = (r) => r && r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny';

test('by default Oscar reads the books and cannot change them; Pam cannot use QuickBooks', async (t) => {
  const f = await floor(t, { quickbooksClaude: true });
  assert.ok(!denied(await f.call('qbo_accounting_get_balance_sheet', 'oscar')));
  const w = await f.call('qbo_sales_create_invoice', 'oscar');
  assert.ok(denied(w));
  assert.match(w.hookSpecificOutput.permissionDecisionReason, /Read only/);
  const p = await f.call('company_info', 'pam');
  assert.ok(denied(p));
  assert.match(p.hookSpecificOutput.permissionDecisionReason, /not given you QuickBooks/);
});

test('the owner\'s choice wins over the role default, on the very next call', async (t) => {
  const f = await floor(t, { quickbooksClaude: true, agentCapabilities: { oscar: { quickbooks: { enabled: false, changes: false } }, pam: { quickbooks: { enabled: true, changes: true } } } });
  assert.ok(denied(await f.call('qbo_accounting_get_balance_sheet', 'oscar')), 'Oscar switched off');
  assert.ok(!denied(await f.call('qbo_sales_create_invoice', 'pam')), 'Pam can make changes');
  assert.ok(!denied(await f.call('qbo_sales_get_invoices', 'pam')));
});

test('with the Settings switch off (the default), everyone is refused, whatever Capabilities say', async (t) => {
  for (const cfg of [{}, { quickbooksClaude: false }]) {
    const f = await floor(t, { ...cfg, agentCapabilities: { pam: { quickbooks: { enabled: true, changes: true } } } });
    const r = await f.call('qbo_accounting_get_balance_sheet', 'oscar');
    assert.ok(denied(r), 'Oscar too');
    assert.match(r.hookSpecificOutput.permissionDecisionReason, /turned off for the team in Settings/);
    assert.ok(denied(await f.call('qbo_sales_get_invoices', 'pam')), 'Pam\'s Capabilities do not override Settings');
  }
});

test('QuickBooks shows on Capabilities only while its Settings switch is on, as a Claude connector row (E4, design D4)', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const cap = read('src/renderer/src/components/CapabilitiesTab.tsx');
  assert.match(cap, /\.filter\(\(c\) => connectorOn\(config, c\.key\) && \(!isQuickBooksKey\(c\.key\) \|\| booksDefault !== undefined\)\)/, 'only with the switch on, and not before the role default is known');
  assert.match(cap, /\{qbo && on && \(/, 'Read only or Can make changes under its row');
  const { connectorOn } = loadTs('src/shared/claudeConnectors.ts');
  assert.equal(connectorOn({}, 'Intuit QuickBooks'), false, 'off unless turned on');
  assert.equal(connectorOn({ quickbooksClaude: true }, 'Intuit QuickBooks'), true, 'its switch is still quickbooksClaude');
  assert.equal(connectorOn({ connectorsOn: { 'Intuit QuickBooks': true } }, 'Intuit QuickBooks'), false);
  assert.match(read('src/main/index.ts'), /if \(isQuickBooksKey\(key\)\) \{ writeConfig\(\{ quickbooksClaude: on === true \}\); return \{ ok: true \}; \}/);
  assert.match(read('src/renderer/src/components/SettingsModal.tsx'), /<ClaudeConnectorsSettings \/>[\s\S]{0,300}<MailboxesSettings \/>/, 'in the connector list, first in Connections');
});

test('the QuickBooks gate leaves every other tool to its own rule', async (t) => {
  // Other connectors were open to every agent until the connector list (owner,
  // 2026-10-02): now the connector rule refuses them, never as QuickBooks.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-qbo-other-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const s = new HookServer(hive, () => null, () => ({ harnessHome: home }), undefined, undefined, undefined, undefined, undefined, undefined, () => false);
  const call = (tool_name) => s.handle({ agent_id: 'pam', session_id: 's1', hook_event_name: 'PreToolUse', tool_name, tool_input: {}, cwd: home });
  for (const tool_name of ['mcp__claude_ai_Xero__get_invoices', 'mcp__claude_ai_Slack__post']) {
    const r = await call(tool_name);
    assert.ok(denied(r), tool_name);
    assert.doesNotMatch(r.hookSpecificOutput.permissionDecisionReason, /QuickBooks/, tool_name);
  }
  assert.ok(!denied(await call('Read')), 'built-in tools are untouched');
});

test('every bundled pack gives Oscar, and only roles with books.read, the QuickBooks default', () => {
  const { levelFor } = loadTs('src/shared/agentDefinition.ts');
  const dir = path.join(__dirname, '..', 'resources', 'packs');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const pack = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const readers = (pack.agents ?? []).filter((r) => levelFor(r, 'books.read') !== 'off').map((r) => r.id);
    assert.deepEqual(readers, ['oscar'], f);
  }
});

test('Intuit TurboTax and other non-QuickBooks Intuit connectors are left alone', () => {
  // Value: protects=the owner's other Intuit connectors keep working with the QuickBooks switch off; fails_when=the server match includes "intuit"; why_new=ship review found every TurboTax call refused; seam=none
  assert.equal(isQuickBooksConnectorTool('mcp__claude_ai_Intuit_TurboTax__get_tax_estimate'), false);
  assert.equal(isQuickBooksConnectorTool('mcp__claude_ai_Intuit_TurboTax__submit_return'), false);
  assert.equal(isQuickBooksConnectorTool(Q + 'qbo_sales_get_invoices'), true);
});

test('reading a QuickBooks MCP resource follows the same switch and Capabilities', async (t) => {
  // Value: protects=Settings off also stops Claude Code's generic resource tools reaching QuickBooks, and Read only may still read them; fails_when=the hook gates only mcp__ tool names; why_new=ship review D2(b); seam=none
  const server = 'claude.ai Intuit QuickBooks';
  const off = await floor(t, {});
  assert.ok(denied(await off.raw('ReadMcpResourceTool', { server, uri: 'qbo://company' }, 'oscar')), 'Settings off refuses a resource read');
  assert.ok(denied(await off.raw('ListMcpResourcesTool', { server }, 'oscar')), 'and a resource list');
  // A list with no server would show every connected server's resources, so it
  // is refused; naming the server sends it through the rules (owner, 2026-10-02).
  assert.match((await off.raw('ListMcpResourcesTool', {}, 'oscar')).hookSpecificOutput.permissionDecisionReason, /Name the connector's server/);
  const tax = await off.raw('ReadMcpResourceTool', { server: 'claude.ai Intuit TurboTax', uri: 'x' }, 'oscar');
  assert.doesNotMatch(tax.hookSpecificOutput.permissionDecisionReason, /QuickBooks/, 'TurboTax is not QuickBooks; the connector rule decides it');
  const on = await floor(t, { quickbooksClaude: true });
  assert.ok(!denied(await on.raw('ReadMcpResourceTool', { server, uri: 'qbo://company' }, 'oscar')), 'Oscar, Read only, may read');
  assert.ok(denied(await on.raw('ReadMcpResourceTool', { server, uri: 'qbo://company' }, 'pam')), 'Pam has no QuickBooks');
});

test('one server rule for tools and resources: QuickBooks by any spelling, never TurboTax', () => {
  // Value: protects=a QuickBooks server named without separators is still gated, and tool and resource checks agree; fails_when=the two checks use different boundaries or require separators; why_new=ship adversarial review; seam=none
  const { isQuickBooksResourceCall } = loadTs('src/shared/quickbooks.ts');
  for (const server of ['claude_ai_Intuit_QuickBooks', 'claude_ai_QuickBooksOnline', 'quickbooks2', 'qbo-test']) {
    assert.ok(isQuickBooksConnectorTool(`mcp__${server}__company_info`), server);
    assert.ok(isQuickBooksResourceCall('ReadMcpResourceTool', { server }), server);
  }
  for (const server of ['claude_ai_Intuit_TurboTax', 'qboxes', 'claude_ai_Gmail']) {
    assert.ok(!isQuickBooksConnectorTool(`mcp__${server}__company_info`), server);
    assert.ok(!isQuickBooksResourceCall('ReadMcpResourceTool', { server }), server);
  }
});

test('QuickBooks access is saved only for a team member or a hire in progress (issue 132)', () => {
  // Value: protects=a typo or a removed member's id never gets a QuickBooks grant a later member with that id would inherit; fails_when=setAccess saves for any id, or a hire's binding is refused before its spawn; why_new=the handler wrote whatever id it was given; seam=onTeam injected
  const team = new Set(['oscar', 'god']);
  const onTeam = (id) => team.has(id);
  assert.deepEqual(quickbooksAccessToSave('oscar', { enabled: true, changes: true }, onTeam), { enabled: true, changes: true }, 'a member: saved as today');
  assert.deepEqual(quickbooksAccessToSave('god', { enabled: true }, onTeam), { enabled: true, changes: false });
  assert.deepEqual(quickbooksAccessToSave('oscar', { enabled: false, changes: true }, onTeam), { enabled: false, changes: false }, 'changes only with access');
  assert.equal(quickbooksAccessToSave('osacr', { enabled: true, changes: false }, onTeam), null, 'not on the team: refused');
  assert.equal(quickbooksAccessToSave('gone-member', { enabled: false, changes: false }, onTeam), null, 'not even switched off');
  assert.deepEqual(quickbooksAccessToSave('new-hire', { enabled: true, changes: false }, onTeam, true), { enabled: true, changes: false }, 'a hire saves for its new id before the spawn');
  for (const [id, cap] of [[undefined, { enabled: true }], ['', { enabled: true }], [7, { enabled: true }], ['oscar', null], ['oscar', 'yes']]) {
    assert.equal(quickbooksAccessToSave(id, cap, onTeam, true), null, `bad input ${JSON.stringify([id, cap])}`);
  }
});

test('quickbooks:setAccess checks the hive registry and writes nothing when it refuses (issue 132)', () => {
  // Value: protects=the handler uses the roster check before touching the config; fails_when=the check is skipped or comes after the write; why_new=the handler had no roster check; seam=source pin (index.ts does not load under node)
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  const start = main.indexOf("ipcMain.handle('quickbooks:setAccess'");
  const handler = main.slice(start, main.indexOf('\n});', start));
  assert.match(handler, /hasOwnProperty\.call\(hive\.registry\(\)\.agents, id\)/, 'on the team means in the hive registry');
  assert.match(handler, /quickbooksAccessToSave\(agentId, cap, onTeam, \(opts as \{ hiring\?: unknown \} \| undefined\)\?\.hiring === true\)/);
  assert.ok(handler.indexOf('if (!quickbooks) return { ok: false };') < handler.indexOf('readConfig()'), 'refused before the config is read or written');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.ts'), 'utf8'), /ipcRenderer\.invoke\('quickbooks:setAccess', agentId, cap, opts\)/);
});
