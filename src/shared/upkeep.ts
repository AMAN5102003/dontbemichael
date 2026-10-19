/**
 * The app's own upkeep notes to a team member (owner, 2026-10-17; research
 * report "Message type stamping for trust layer"): not work, and never a
 * question for the internet.
 *
 * A message is upkeep only when app code says so as it sends it (hive.send's
 * `upkeep` argument). Nothing in a message's file or words can make it upkeep,
 * so an agent can never pass a question to Research off as one. For Research:
 *   - a fixed note (its words exactly one of the app's own below) goes straight
 *     to Research, without the paid privacy check, and is never listed;
 *   - an upkeep note carrying anyone's words (a schedule decision with a note)
 *     is still checked, and is never listed or counted either.
 * Everything a teammate, Michael or the owner sends Research is research.
 *
 * No electron / node imports: main calls it, tests load it directly.
 */
import { OFFICE_OPEN_SUBJECT, officeOpenBody } from './officeOpen';

export type UpkeepKind = 'office-open' | 'restarted' | 'carry-on' | 'schedule-decision';

interface Words { subject: string; body: string }

/** A stuck member's session was restarted (hooks.ts). */
export const RESTARTED_NOTE: Words = {
  subject: 'You were restarted',
  body: 'Your session stopped on a prompt only a person could answer, so the app restarted it. Carry on with your current work.'
};

const CARRY = 'Continue the task you were working on when it stopped; do not repeat work that is already done.';
/** The office is back after a stop (index.ts stopWords): what each member cut
 *  off mid task is told, by why it stopped. */
export const CARRY_ON_NOTES = {
  credit: { subject: 'Credit may be back', body: `The Anthropic account has credit again. ${CARRY}` },
  apiKey: { subject: 'New API key', body: `The Anthropic API key works again. ${CARRY}` },
  signin: { subject: 'Signed in again', body: `Claude is signed in again. ${CARRY}` },
  limit: {
    subject: 'Usage limit reset',
    body: 'The Claude plan\'s usage limit has reset. Continue the task you were working on when it was reached; do not repeat work that is already done.'
  }
} as const satisfies Record<string, Words>;

/** Every fixed note, word for word, by kind. A kind with none here (a schedule
 *  decision) always carries someone's words. */
const FIXED: Partial<Record<UpkeepKind, readonly Words[]>> = {
  'office-open': [{ subject: OFFICE_OPEN_SUBJECT, body: officeOpenBody() }],
  restarted: [RESTARTED_NOTE],
  'carry-on': Object.values(CARRY_ON_NOTES)
};

/** True when a note is word for word one of the app's fixed notes, of any
 *  kind: Research's inbox keeps no kind, so this is how a delivered one is known. */
export function isAnyFixedUpkeep(subject: unknown, body: unknown): boolean {
  return Object.values(FIXED).some((list) => list.some((w) => w.subject === subject && w.body === body));
}

/** True when an upkeep note is exactly one of the app's fixed notes of its
 *  kind: the free check that lets it skip the paid one. */
export function isFixedUpkeep(kind: UpkeepKind, subject: unknown, body: unknown): boolean {
  return (FIXED[kind] ?? []).some((w) => w.subject === subject && w.body === body);
}
