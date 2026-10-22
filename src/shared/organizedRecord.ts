/**
 * Pulse's organized mail list (owner, 2026-10-21: "how to see which emails
 * were organized?"): each email a member archived, marked read or moved to
 * junk, with its sender and subject as they were when it moved. The office
 * log keeps only the inbox numbers, which find nothing once the mail has
 * moved, so the words are kept here, in the owner's private folder.
 *
 *   move ─ mail ─┬─ mail-organize (ids only) ─► office log ─► telemetry ─► the count
 *                └─ rows ─ hive ─► private/organized.jsonl ─(daily, > 62 days)─► private/organized-archive/YYYY-MM.jsonl
 *   view ─ pulse:organized ─► rows ─► the list
 *
 * No electron or node imports: main and the renderer share it, tests load it.
 */

export type OrganizeAction = 'archive' | 'mark_read' | 'mark_junk';

export interface OrganizedRow {
  at: number;
  agentId: string;
  /** The member's name when the mail moved; null when it had none. */
  agentName: string | null;
  mailbox: string;
  action: OrganizeAction;
  /** Where archived mail went: the folder, or the label on Gmail. Null for
   *  mail marked read, moved to junk, or archived to Gmail's All Mail. */
  folder: string | null;
  /** Empty when the mailbox did not say (the move still happened). */
  subject: string;
  from: string;
}

/** Rows show 62 days, all Pulse can show, as the checks record keeps them;
 *  older rows move to the archive, which the app never deletes. */
export const ORGANIZED_FILE = 'organized.jsonl';
export const ORGANIZED_ARCHIVE_DIR = 'organized-archive';
export const ORGANIZED_TEXT_MAX = 300;

const ACTIONS: readonly string[] = ['archive', 'mark_read', 'mark_junk'];

/** A sender or subject as kept: one line, cut at the cap. */
export function organizedText(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, ORGANIZED_TEXT_MAX);
}

/** One row as stored, or null for a line that is not one. */
export function parseOrganized(line: string): OrganizedRow | null {
  try {
    const r = JSON.parse(line) as Partial<OrganizedRow>;
    if (typeof r?.at !== 'number' || typeof r.agentId !== 'string' || typeof r.mailbox !== 'string' || !ACTIONS.includes(String(r.action))) return null;
    return {
      at: r.at, agentId: r.agentId, agentName: typeof r.agentName === 'string' ? r.agentName : null,
      mailbox: r.mailbox, action: r.action as OrganizeAction, folder: typeof r.folder === 'string' && r.folder ? r.folder : null,
      subject: typeof r.subject === 'string' ? r.subject : '', from: typeof r.from === 'string' ? r.from : ''
    };
  } catch { return null; }
}

/** A span's rows for the list, and the time of the first row ever kept
 *  (null: none yet), so the list can say from when mail is named. */
export interface OrganizedList { rows: OrganizedRow[]; since: number | null }
