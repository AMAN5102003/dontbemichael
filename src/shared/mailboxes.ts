/**
 * Mailboxes and agent Capabilities (docs/designs/multi-mailbox.md).
 *
 * Shared by main (broker, hook gate, mail client) and the renderer (Settings >
 * Mailboxes, the Capabilities tab). No electron / node imports.
 *
 * A mailbox is connected once, in Settings, with an address and an app password
 * held only by the broker's secret store. Each agent's Capabilities say which
 * one mailbox it may use (at most one, owner 2026-09-26) and whether it may send
 * or only draft. `mailAccess` is the one rule both enforcement points call: the
 * broker and the PreToolUse hook for md-mail tools.
 */

import type { QuickBooksCapability } from './quickbooks';

export type MailProvider = 'gmail' | 'google-workspace' | 'icloud' | 'yahoo' | 'zoho' | 'other';

export interface MailServer {
  host: string;
  port: number;
  /** true = TLS from the first byte (993 / 465); false = STARTTLS (587). */
  secure: boolean;
}

export interface MailboxRecord {
  /** Stable slug; also the secret handle `mail:<id>`. */
  id: string;
  address: string;
  provider: MailProvider;
  imap: MailServer;
  smtp: MailServer;
  /** Set by the broker: connected, or needs the owner (MB-7). */
  status: 'connected' | 'needs-attention';
  /** Plain words for the owner when status is needs-attention. */
  statusReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface EmailCapability {
  /** "Can check email". */
  enabled: boolean;
  /** The mailbox id (added in Settings) this agent may use: at most one
   *  (owner, 2026-09-26). Kept a list so older records still read. */
  mailboxes: string[];
  /** true = Can send; false = Draft only or Send on approval. Kept in step
   *  with `sending` so older readers still read it. */
  send: boolean;
  /** Can send, Send on approval or Draft only (owner, 2026-10-05). Absent on
   *  older records: read `send` (sendingMode). */
  sending?: SendingMode;
}

/** How an agent's mail leaves (docs/designs/send-on-approval.md). */
export type SendingMode = 'send' | 'approval' | 'draft';

/** A Sending choice from any value: one of the three, else Draft only. */
export function asSendingMode(v: unknown): SendingMode {
  return v === 'send' || v === 'approval' || v === 'draft' ? v : 'draft';
}

/** An agent's Sending choice: `sending`, or for an older record `send`. */
export function sendingMode(email: Pick<EmailCapability, 'send' | 'sending'> | undefined): SendingMode {
  const m = email?.sending;
  if (m === 'send' || m === 'approval' || m === 'draft') return m;
  return email?.send === true ? 'send' : 'draft';
}

/** The words for a Sending choice in text agents and Michael read. */
export function sendingWords(mode: SendingMode): string {
  return mode === 'send' ? 'can send' : mode === 'approval' ? 'send on approval' : 'draft only';
}

/**
 * Send only from a mailbox another member owns (docs/designs/shared-mailboxes.md,
 * owner 2026-10-06). The member may list, draft, propose and send from it under
 * its own Sending choice, and never read, search or organize it: the mailbox
 * keeps one owner, who reads the replies. At most one per member (S1). Kept
 * beside `email`, not inside it, because every writer of `email` replaces the
 * whole object.
 */
export interface SendOnlyGrant {
  mailbox: string;
  sending: SendingMode;
}

export interface AgentCapabilities {
  email?: EmailCapability;
  /** Send only from another member's mailbox (SendOnlyGrant). */
  sendOnly?: SendOnlyGrant;
  /** QuickBooks through the owner's Claude account (shared/quickbooks.ts).
   *  Absent until the owner chooses: the role default applies. */
  quickbooks?: QuickBooksCapability;
  /** Connectors on the owner's Claude account this agent may use, by key
   *  (shared/claudeConnectors.ts). QuickBooks is under `quickbooks`. */
  connectors?: string[];
}

export type MailOp = 'list' | 'read' | 'organize' | 'draft' | 'propose' | 'send';

/** Each md-mail tool and the access it needs. The broker and the PreToolUse
 *  hook both check tools against this one map. `organize` (archive, mark read,
 *  mark junk) moves mail out of the inbox and never deletes it, so it can be
 *  undone in the mailbox: it needs the mailbox, like reading (inbox zero,
 *  owner 2026-10-03). It has no prototype: the name looked up comes from the
 *  agent's call, and on a plain object "constructor" or "__proto__" would read
 *  as a known tool and pass both checks. */
export const MAIL_TOOL_OPS: Record<string, MailOp> = Object.assign(Object.create(null) as Record<string, MailOp>, {
  list_mailboxes: 'list', search: 'read', read: 'read',
  archive: 'organize', mark_read: 'organize', mark_junk: 'organize',
  draft: 'draft', propose: 'propose', send: 'send'
});

/** Standard mail ports: IMAP over TLS, SMTP over TLS, and SMTP submission
 *  (STARTTLS). */
export const IMAPS_PORT = 993;
export const SMTPS_PORT = 465;
export const SUBMISSION_PORT = 587;

/** Server settings each service fills in, so an owner never types a server
 *  name. The help text shown for each service lives in the locale files
 *  (mailboxes.help.<provider>). */
export const PROVIDER_PRESETS: Record<Exclude<MailProvider, 'other'>, { label: string; imap: MailServer; smtp: MailServer }> = {
  gmail: {
    label: 'Gmail',
    imap: { host: 'imap.gmail.com', port: IMAPS_PORT, secure: true },
    smtp: { host: 'smtp.gmail.com', port: SMTPS_PORT, secure: true }
  },
  'google-workspace': {
    label: 'Google Workspace',
    imap: { host: 'imap.gmail.com', port: IMAPS_PORT, secure: true },
    smtp: { host: 'smtp.gmail.com', port: SMTPS_PORT, secure: true }
  },
  icloud: {
    label: 'iCloud Mail',
    imap: { host: 'imap.mail.me.com', port: IMAPS_PORT, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: SUBMISSION_PORT, secure: false }
  },
  yahoo: {
    label: 'Yahoo',
    imap: { host: 'imap.mail.yahoo.com', port: IMAPS_PORT, secure: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: SMTPS_PORT, secure: true }
  },
  zoho: {
    label: 'Zoho',
    imap: { host: 'imap.zoho.com', port: IMAPS_PORT, secure: true },
    smtp: { host: 'smtp.zoho.com', port: SMTPS_PORT, secure: true }
  }
};

/** The service list the Add dialog shows, in order (design review 9B: no Outlook). */
export const PROVIDER_ORDER: MailProvider[] = ['gmail', 'google-workspace', 'icloud', 'yahoo', 'zoho', 'other'];

/** Outlook and Microsoft 365 stopped accepting app passwords for IMAP; phase 1
 *  cannot connect them (design review 9B: the test fails with this reason). */
export function isMicrosoftAddress(address: string): boolean {
  return /@(outlook|hotmail|live|msn)\.[a-z.]+$/i.test(address.trim());
}

/** One MX exchange pointing at Microsoft 365 (issue 39: custom domains). */
export function isMicrosoftMxExchange(exchange: string): boolean {
  return /\.mail\.protection\.outlook\.com\.?$/i.test(exchange.trim());
}

/** True when any MX exchange points at Microsoft 365. Pure so tests run
 *  without a network (issue 39). */
export function mxPointsToMicrosoft(exchanges: string[]): boolean {
  return exchanges.some(isMicrosoftMxExchange);
}

/** "Other" guesses (design review 10A): mail.<domain> for both servers. */
export function guessServers(address: string): { imap: MailServer; smtp: MailServer } {
  const domain = address.split('@')[1]?.trim().toLowerCase() || 'example.com';
  return { imap: { host: `mail.${domain}`, port: IMAPS_PORT, secure: true }, smtp: { host: `mail.${domain}`, port: SMTPS_PORT, secure: true } };
}

export interface MailAccessConfig {
  mcpDefaults?: { [id: string]: { enabled: boolean } };
  mailboxes?: MailboxRecord[];
  agentCapabilities?: { [agentId: string]: AgentCapabilities };
}

export type MailAccessResult = { ok: true } | { ok: false; reason: string };

/** What a call names besides its mailbox, and who is on the team now. */
export interface MailAccessOptions {
  /** The call's references: a forward and attachments' source emails (a
   *  reply under a grant is checked against its own sends in the broker). */
  refs?: { forward?: boolean; attachFrom?: boolean };
  /** Whether a member is on the team now (shared-mailboxes.md, EV1). Absent:
   *  everyone the config names counts, as before. */
  present?: (agentId: string) => boolean;
}

/** True when the agent owns this mailbox: Can check email on with it picked. */
function ownsMailbox(email: EmailCapability | undefined, mailboxId: string | undefined): boolean {
  return !!mailboxId && !!email?.enabled && email.mailboxes[0] === mailboxId;
}

/** The member's Send only grant, when it names a connected mailbox the member
 *  does not own. */
export function sendOnlyGrant(cfg: MailAccessConfig, agentId: string): SendOnlyGrant | undefined {
  const c = cfg.agentCapabilities?.[agentId];
  const g = c?.sendOnly;
  if (!g || typeof g.mailbox !== 'string' || !g.mailbox) return undefined;
  if (ownsMailbox(c?.email, g.mailbox)) return undefined;
  if (!(cfg.mailboxes ?? []).some((m) => m.id === g.mailbox)) return undefined;
  return { mailbox: g.mailbox, sending: asSendingMode(g.sending) };
}

/** Whether nobody on the team can read a mailbox now, so a grant on it pauses
 *  (S3, D10): no current owner (the member with Can check email on and it
 *  picked), or the mailbox needs attention, since a broken login can stop the
 *  reading while sending still works (ship D10). */
export function grantPaused(cfg: MailAccessConfig, mailboxId: string, present?: (agentId: string) => boolean): boolean {
  if ((cfg.mailboxes ?? []).find((m) => m.id === mailboxId)?.status === 'needs-attention') return true;
  const holder = mailboxHolder(cfg.agentCapabilities, mailboxId);
  return !holder || (present ? !present(holder) : false);
}

/** A mailbox's address, or its id when it is gone. */
export const mailboxAddress = (cfg: Pick<MailAccessConfig, 'mailboxes'>, mailboxId: string): string =>
  (cfg.mailboxes ?? []).find((m) => m.id === mailboxId)?.address ?? mailboxId;

/** The rule for a Send only member on its grant's mailbox. */
function grantAccess(cfg: MailAccessConfig, grant: SendOnlyGrant, op: MailOp, proposal: string | undefined, opts: MailAccessOptions | undefined): MailAccessResult {
  const address = mailboxAddress(cfg, grant.mailbox);
  if (op === 'list') return { ok: true };
  if (op === 'read' || op === 'organize') {
    return { ok: false, reason: `You send only from ${address}: you can't read, search or organize it. Its owner reads the replies and passes them on through Michael; ask Michael for anything in that inbox.` };
  }
  if (opts?.refs?.forward || opts?.refs?.attachFrom) {
    return { ok: false, reason: `You send only from ${address}, so you can't forward or attach mail from it. Write the email new, or ask Michael to have its owner send it.` };
  }
  if (grantPaused(cfg, grant.mailbox, opts?.present)) {
    return { ok: false, reason: `Nobody reads ${address} right now, so its replies would go unanswered; tell Michael.` };
  }
  if ((op === 'send' || op === 'propose') && grant.sending === 'draft') {
    return { ok: false, reason: `You are Draft only from ${address}, the owner's choice on your Access tab (Email, Also sends from). Save the email as a draft instead, and the owner will send it.` };
  }
  if (op === 'propose' && grant.sending === 'send') {
    return { ok: false, reason: `You can send from ${address} without approval, the owner's choice on your Access tab (Email, Also sends from). Send the email yourself with send; nothing goes on Ask me. This holds over any memory note that says to propose or wait for the owner's approval.` };
  }
  if (op === 'send' && grant.sending === 'approval' && !proposal) {
    return { ok: false, reason: `You send on approval from ${address}, the owner's choice on your Access tab (Email, Also sends from). Use propose to put the email on Ask me; once the owner approves it, send it with its proposal id. A kind the owner let you send without approval goes with its standing id (list_mailboxes lists them).` };
  }
  return { ok: true };
}

/**
 * The one access rule (MB-3, E3). Refuses unless: the agent has "Can check
 * email"; the mailbox is one of its mailboxes and still exists in Settings;
 * to propose, the agent sends on approval (Can send sends itself and puts
 * nothing on Ask me, owner 2026-10-09); and to send, the agent
 * can send, or sends on approval with the id of a proposal the owner approved
 * or of a standing approval (`proposal`; the broker checks either one itself).
 * Michael follows the same rule.
 * `list` needs "Can check email" or a Send only grant: it returns the agent's
 * own mailbox and the one it sends only from.
 * A Send only member (sendOnlyGrant) may list, draft, propose and send from the
 * grant's mailbox under the grant's Sending choice, never read, search,
 * organize, forward or attach from it, and nothing while nobody reads it.
 * Refusal reasons are read by the agent (and shown on the floor), so they say
 * what happened and what to do.
 */
export function mailAccess(cfg: MailAccessConfig, agentId: string, mailboxId: string | undefined, op: MailOp, proposal?: string, opts?: MailAccessOptions): MailAccessResult {
  const email = cfg.agentCapabilities?.[agentId]?.email;
  // A Send only grant is checked before the Can check email gate: a member may
  // hold one with email off (shared-mailboxes.md, item 2).
  const grant = sendOnlyGrant(cfg, agentId);
  if (grant && mailboxId === grant.mailbox) return grantAccess(cfg, grant, op, proposal, opts);
  if (op === 'list' && grant) return { ok: true };
  if (!email?.enabled) {
    return { ok: false, reason: 'The owner has not given you email in your Capabilities. Do not try another way; tell Michael what you need.' };
  }
  if (op === 'list') return { ok: true };
  // One mailbox per agent (owner, 2026-09-26): only the first listed counts.
  if (!mailboxId || email.mailboxes[0] !== mailboxId) {
    return { ok: false, reason: `The owner has not given you the mailbox "${mailboxId ?? ''}". Use list_mailboxes to see yours.` };
  }
  if (!(cfg.mailboxes ?? []).some((m) => m.id === mailboxId)) {
    return { ok: false, reason: `The mailbox "${mailboxId}" was removed in Settings.` };
  }
  const mode = sendingMode(email);
  if ((op === 'send' || op === 'propose') && mode === 'draft') {
    return { ok: false, reason: 'You are Draft only, the owner\'s choice on your Access tab (Email, Sending); the mailbox itself can send. Save the reply as a draft instead, and the owner will send it.' };
  }
  if (op === 'propose' && mode === 'send') {
    return { ok: false, reason: 'You can send without approval, the owner\'s choice on your Access tab (Email, Sending). Send the email yourself with send; nothing goes on Ask me. This holds over any memory note that says to propose or wait for the owner\'s approval.' };
  }
  if (op === 'send' && mode === 'approval' && !proposal) {
    return { ok: false, reason: 'You send on approval, the owner\'s choice on your Access tab (Email, Sending). Use propose to put the email on Ask me; once the owner approves it, send it with its proposal id. A kind the owner let you send without approval goes with its standing id (list_mailboxes lists them).' };
  }
  return { ok: true };
}

/** How an agent sends from a mailbox it keeps: its Send only grant there, or
 *  its own mailbox's Sending. Null when it keeps no such mailbox. */
export function sendingFor(cfg: MailAccessConfig, agentId: string, mailboxId: string): SendingMode | null {
  const grant = sendOnlyGrant(cfg, agentId);
  if (grant && grant.mailbox === mailboxId) return grant.sending;
  const email = cfg.agentCapabilities?.[agentId]?.email;
  return email?.enabled && email.mailboxes[0] === mailboxId ? sendingMode(email) : null;
}

/** The mailbox an agent may use, as a list of at most one (list_mailboxes).
 *  An agent has one mailbox at most (owner, 2026-09-26); an older record with
 *  more keeps only its first. */
export function agentMailboxes(cfg: MailAccessConfig, agentId: string): string[] {
  const email = cfg.agentCapabilities?.[agentId]?.email;
  if (!email?.enabled) return [];
  const known = new Set((cfg.mailboxes ?? []).map((m) => m.id));
  return email.mailboxes.slice(0, 1).filter((id) => known.has(id));
}

/**
 * The agent holding a mailbox, other than `except` (one agent per mailbox:
 * owner, 2026-09-27, so no inbox is ever worked twice). An agent holds a
 * mailbox while its email is on with that mailbox picked.
 */
export function mailboxHolder(
  caps: { [agentId: string]: AgentCapabilities } | undefined,
  mailboxId: string,
  except?: string
): string | undefined {
  for (const [id, c] of Object.entries(caps ?? {})) {
    if (id !== except && c?.email?.enabled && c.email.mailboxes[0] === mailboxId) return id;
  }
  return undefined;
}

/** Who else sends from a mailbox under a Send only grant, for the owner's
 *  side and Settings (E3): read only, the grant lives on the sender's tab. */
export function sendersFrom(caps: { [agentId: string]: AgentCapabilities } | undefined, mailboxId: string): Array<{ agentId: string; sending: SendingMode }> {
  return Object.entries(caps ?? {})
    .filter(([, c]) => c?.sendOnly?.mailbox === mailboxId && !ownsMailbox(c.email, mailboxId))
    .map(([agentId, c]) => ({ agentId, sending: asSendingMode(c.sendOnly!.sending) }));
}

/** Whether an agent gets the md-mail tools at spawn: it owns a mailbox or holds
 *  a Send only grant. */
export function hasMailTools(caps: AgentCapabilities | undefined): boolean {
  return !!caps?.email?.enabled || !!caps?.sendOnly?.mailbox;
}

/** True when the mail tools go from not attached to attached: that agent needs
 *  a restart, because md-mail is attached only at spawn (E2, OV10). */
export function mailToolsJustAttached(before: AgentCapabilities | undefined, after: AgentCapabilities | undefined): boolean {
  return !hasMailTools(before) && hasMailTools(after);
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

/** A mailbox id from its address: sales@example.com -> sales-example-com. */
export function mailboxIdFor(address: string, taken: string[] = []): string {
  const base = address.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mailbox';
  let id = SLUG_RE.test(base) ? base : `mb-${base}`.slice(0, 40).replace(/-+$/, '');
  let n = 2;
  while (taken.includes(id)) id = `${base.slice(0, 36)}-${n++}`;
  return id;
}

export function secretRefForMailbox(id: string): string {
  return `mail:${id}`;
}
