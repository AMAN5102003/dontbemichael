/**
 * QuickBooks through the owner's Claude account (owner, 2026-09-29): the app
 * does not connect to Intuit itself. Agents inherit the account's QuickBooks
 * connector (mcp__claude_ai_Intuit_QuickBooks__*), and each agent's
 * Capabilities say whether it may use it, and whether it may make changes,
 * once the owner turns QuickBooks on in Settings (off by default).
 * The PreToolUse hook applies this rule on every call, so a change takes
 * effect on the agent's next call without a restart.
 */

export interface QuickBooksCapability {
  /** "Can use QuickBooks". */
  enabled: boolean;
  /** true = Can make changes; false = Read only. */
  changes: boolean;
}

/** A server name that is QuickBooks: "claude_ai_Intuit_QuickBooks",
 *  "claude.ai Intuit QuickBooks", "QuickBooksOnline", "qbo-test". Not bare
 *  "intuit", which Intuit TurboTax shares. One rule for tools and resources. */
function namesQuickBooks(server: string): boolean {
  return /quickbooks/i.test(server) || /(^|[^a-z0-9])qbo([^a-z0-9]|$)/i.test(server);
}

/** An MCP tool from a QuickBooks connector: its server names QuickBooks, or,
 *  for a server with an opaque name, the tool is one of the connector's qbo_ /
 *  quickbooks_ tools. */
export function isQuickBooksConnectorTool(toolName: string): boolean {
  const m = /^mcp__(.+?)__(.+)$/.exec(toolName ?? '');
  if (!m) return false;
  const [, server, tool] = m;
  if (namesQuickBooks(server)) return true;
  return /^(qbo|quickbooks)_/i.test(tool);
}

/** Claude Code's own tools for a connector's MCP resources. They name the
 *  server in their input (e.g. "claude.ai Intuit QuickBooks") and only read. */
const MCP_RESOURCE_TOOLS = new Set(['ListMcpResourcesTool', 'ReadMcpResourceTool']);

/** A resource list or read aimed at a QuickBooks connector, so the Settings
 *  switch and Capabilities cover it too. A list with no server names no
 *  resource contents and is left alone. */
export function isQuickBooksResourceCall(toolName: string, input: unknown): boolean {
  if (!MCP_RESOURCE_TOOLS.has(toolName)) return false;
  const server = input && typeof input === 'object' ? (input as { server?: unknown }).server : undefined;
  return typeof server === 'string' && namesQuickBooks(server);
}

/** The connector's tools that only look (its catalog as agents saw it,
 *  2026-09-29). Read only allows these and nothing else, so a tool Intuit adds
 *  later is refused until it is added here. Shopping for loans and pulling
 *  peer loan offers are left out: they may share the books with lenders. */
const READ_TOOLS = new Set([
  'benchmarking_against_industry', 'benchmarking_against_industry_text', 'benchmarking_quickbooks_account',
  'benchmarking_quickbooks_account_text', 'business_health_check_widget', 'cash_flow_generator',
  'cash_flow_quickbooks_account', 'cash_flow_quickbooks_account_text', 'company_info',
  'industry_benchmark_widget', 'industry_recommendation', 'money_onboarding_application_metadata',
  'profit_loss_generator', 'profit_loss_quickbooks_account', 'profit_loss_quickbooks_account_text',
  'qbo_accounting_get_ap_aging_detail', 'qbo_accounting_get_ap_aging_summary',
  'qbo_accounting_get_ar_aging_detail', 'qbo_accounting_get_ar_aging_summary',
  'qbo_accounting_get_ar_aging_summary_text', 'qbo_accounting_get_balance_sheet',
  'qbo_accounting_get_balance_sheet_text', 'qbo_accounting_get_product_service_list',
  'qbo_accounting_get_sales_by_customer_summary', 'qbo_accounting_get_sales_by_customer_summary_text',
  'qbo_accounting_get_sales_by_product_summary', 'qbo_accounting_get_sales_by_product_summary_text',
  'qbo_catalog_search_products', 'qbo_contact_search_customer', 'qbo_lending_estimate_loan_payments',
  'qbo_lending_get_loans', 'qbo_lending_help', 'qbo_payroll_get_company_deductions_contributions',
  'qbo_payroll_get_company_info', 'qbo_payroll_get_company_last_payroll_run',
  'qbo_payroll_get_company_pay_types', 'qbo_payroll_get_company_payroll_readiness',
  'qbo_payroll_get_company_timeoff_details', 'qbo_payroll_get_employee_compensations',
  'qbo_payroll_get_employee_contract_details', 'qbo_payroll_get_employee_deductions',
  'qbo_payroll_get_employee_details', 'qbo_payroll_get_employee_manager_details',
  'qbo_payroll_get_employee_payroll_readiness', 'qbo_payroll_get_employee_timeoff_assignments',
  'qbo_payroll_get_employees', 'qbo_payroll_get_employees_by_work_location',
  'qbo_payroll_get_employer_tax_setup', 'qbo_payroll_get_pay_schedules', 'qbo_payroll_get_payslip_details',
  'qbo_payroll_get_payslips', 'qbo_payroll_get_tax_filings_summary', 'qbo_payroll_search_employee',
  'qbo_sales_get_estimates', 'qbo_sales_get_invoices', 'qbo_sales_get_payment_links',
  'qbo_sales_get_recurring_invoices', 'qbo_sales_get_settings', 'qbo_sales_get_transaction_document'
]);

/** True when a QuickBooks tool only reads: a known read tool, or a resource
 *  list or read. */
export function isQuickBooksReadTool(toolName: string): boolean {
  if (MCP_RESOURCE_TOOLS.has(toolName)) return true;
  const tool = /^mcp__.+?__(.+)$/.exec(toolName ?? '')?.[1] ?? '';
  return READ_TOOLS.has(tool);
}

/** An agent's QuickBooks capability: its saved choice, or, before the owner
 *  chose, on and Read only for roles that read the books (Oscar), off for the
 *  rest (owner, 2026-09-29). */
export function quickbooksCapability(saved: QuickBooksCapability | undefined, roleReadsBooks: boolean): QuickBooksCapability {
  if (saved) return { enabled: saved.enabled === true, changes: saved.enabled === true && saved.changes === true };
  return { enabled: roleReadsBooks, changes: false };
}

/** What `quickbooks:setAccess` saves for `agentId`, or null to refuse it
 *  (issue 132). An id must be on the team: one that is not (a typo, a member
 *  who was removed) would quietly apply to a later member who gets that id. A
 *  hire saves for its new id before the spawn, so the agent starts holding the
 *  connector, and says so with `hiring`. */
export function quickbooksAccessToSave(agentId: unknown, cap: unknown, onTeam: (id: string) => boolean, hiring = false): QuickBooksCapability | null {
  if (typeof agentId !== 'string' || !agentId || !cap || typeof cap !== 'object') return null;
  if (!hiring && !onTeam(agentId)) return null;
  const c = cap as { enabled?: unknown; changes?: unknown };
  return { enabled: c.enabled === true, changes: c.enabled === true && c.changes === true };
}

/** Refuses a QuickBooks connector call the Settings switch (`officeOn`) or
 *  the agent's Capabilities don't allow. The reason is read by the agent and
 *  shown on the floor. */
export function quickbooksAccess(officeOn: boolean, cap: QuickBooksCapability, toolName: string): { ok: true } | { ok: false; reason: string } {
  if (!officeOn) {
    return { ok: false, reason: 'The owner has QuickBooks turned off for the team in Settings. Do not try another way; tell Michael what you need.' };
  }
  if (!cap.enabled) {
    return { ok: false, reason: 'The owner has not given you QuickBooks in your Capabilities. Do not try another way; tell Michael what you need.' };
  }
  if (!cap.changes && !isQuickBooksReadTool(toolName)) {
    return { ok: false, reason: 'You are Read only in QuickBooks: do not create, change, send or delete anything there. Tell Michael what you would change, and the owner will do it.' };
  }
  return { ok: true };
}
