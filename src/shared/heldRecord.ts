/**
 * Pulse's held list (owner, 2026-10-16): a message to or from Research that
 * was held because the privacy check could not run. The hive writes one row
 * per hold to `<home>/private/held.jsonl` (never the committed office log,
 * never Pulse's telemetry), and Pulse shows the period's rows when the owner
 * opens the held tile.
 *
 *   hold ─ hive ─┬─ row ─► private/held.jsonl ─► pulse:held ─► the held list
 *                └─ trust-held (way only) ─► telemetry ─► the held count
 *
 * No electron or node imports: main and the renderer share it, tests load it.
 */

/** Why a check could not run, in the order the list names them. */
export type HeldWhy = 'no-answer' | 'unreadable' | 'too-long' | 'settings' | 'failed' | 'no-layer';

/** Who heard of the hold. */
export type HeldTold = 'sender+michael' | 'sender' | 'michael' | 'recipient+michael' | 'recipient' | 'nobody';

/** `to` for Research's notes on their way into the team's shared memory. No
 *  new row has it since notes stopped being shared (owner, 2026-10-16: an
 *  agent's memory is private); older rows still show. */
export const HELD_TO_MEMORY = 'memory';

export interface HeldRow {
  at: number;
  /** in: headed to Research (a question for the internet); out: Research's answer. */
  way: 'in' | 'out';
  from: string;
  /** The sender's name when it was held; null for the owner and the app. */
  fromName: string | null;
  to: string;
  toName: string | null;
  /** The subject, at most 80 characters, and the opening of the body, at most 300 (owner, D4). */
  subject: string;
  opening: string;
  why: HeldWhy;
  /** What the check runner said, when it got no answer. */
  error?: string;
  told: HeldTold;
}

/** The owner's private record of holds, in the office's private folder. */
export const HELD_FILE = 'held.jsonl';
/** Rows are kept as long as Pulse keeps raw events (400 days). */
export const HELD_KEEP_MS = 400 * 86_400_000;
export const HELD_SUBJECT_MAX = 80;
export const HELD_OPENING_MAX = 300;

/** Quote marks and line breaks become spaces, so quoted text can't close its
 *  quote in a note written in the app's voice; then cut to `max`. */
export function tidy(text: unknown, max: number): string {
  return String(text ?? '').replace(/[\p{Pi}\p{Pf}"„‟″＂\s]+/gu, ' ').trim().slice(0, max);
}

/** The notes in a Research notes text, without the index page's own lines
 *  (its heading, marker, the app's line about the inbox, file names): what an
 *  owner would call the notes. Empty when there are none (owner, 2026-10-16:
 *  "what note was it?"). */
export function notesPreview(text: string, max = HELD_OPENING_MAX): string {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) =>
    l && !l.startsWith('#') && !/^<!--.*-->$/.test(l) && !/^The app keeps this file\b/.test(l) && !/^[\w.-]+\.md$/.test(l));
  return tidy(lines.map((l) => l.replace(/^[-*]\s+/, '')).join(' \u00b7 '), max);
}

/** Why a hold happened, in the owner's terms (owner, 2026-10-16: "what caused
 *  the privacy check to fail?"), read from the row's why and the check's report. */
export type HeldCause = 'starting' | 'slow' | 'unreadable' | 'settings' | 'off' | 'tooLong' | 'checkDown';
export function heldCause(r: Pick<HeldRow, 'why' | 'error'>): HeldCause {
  if (r.why === 'too-long') return 'tooLong';
  if (r.why === 'unreadable') return 'unreadable';
  if (r.why === 'settings') return 'settings';
  if (r.why === 'no-layer') return 'off';
  if (r.why === 'no-answer' && /never took the prompt/.test(r.error ?? '')) return 'starting';
  if (r.why === 'no-answer' && /no answer within|timed out/.test(r.error ?? '')) return 'slow';
  return 'checkDown';
}

/** A hold whose check may run on a later try: no answer, an unreadable one,
 *  or a failure. The message waits and is tried again before it is held
 *  (owner, 2026-10-16); too long, settings and no check are held at once. */
export function heldWaits(why: HeldWhy | null): boolean {
  return why === 'no-answer' || why === 'unreadable' || why === 'failed';
}

/** A deny is a hold when the check could not run: too long, no answer, an
 *  unreadable answer, settings that could not be read, or no check at all.
 *  A deny the check reached (private data, a pattern) is a stop, not a hold. */
export function heldWhy(v: { reason: string; by?: string }, failed: string, tooLong: string): HeldWhy | null {
  switch (v.by) {
    case 'length': return 'too-long';
    case 'no-answer': return 'no-answer';
    case 'unreadable': return 'unreadable';
    case 'settings': return 'settings';
    case undefined: return v.reason === tooLong ? 'too-long' : v.reason === failed ? 'failed' : null;
    default: return null;
  }
}

/** One row as stored, or null for a line that is not one. */
export function parseHeld(line: string): HeldRow | null {
  try {
    const r = JSON.parse(line) as Partial<HeldRow>;
    if (typeof r?.at !== 'number' || (r.way !== 'in' && r.way !== 'out') || typeof r.from !== 'string' || typeof r.why !== 'string') return null;
    return {
      at: r.at, way: r.way, from: r.from, fromName: typeof r.fromName === 'string' ? r.fromName : null,
      to: typeof r.to === 'string' ? r.to : '', toName: typeof r.toName === 'string' ? r.toName : null,
      subject: typeof r.subject === 'string' ? r.subject : '', opening: typeof r.opening === 'string' ? r.opening : '',
      why: r.why as HeldWhy, ...(typeof r.error === 'string' ? { error: r.error } : {}),
      told: (typeof r.told === 'string' ? r.told : 'sender') as HeldTold
    };
  } catch { return null; }
}
