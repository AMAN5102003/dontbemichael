/**
 * The inbox-wake nudge — the text queued for an agent that has unread hive mail,
 * and the predicate the message queue uses to keep only one of them pending.
 *
 * The nudge is QUEUED the moment fresh mail is seen but TYPED only once the agent
 * is idle and off cooldown, and it survives a renderer reload in the persisted
 * queue. By the time it lands, the agent has often already drained that mail and
 * filed it under `inbox/.done/` — so the nudge arrives against an inbox the agent
 * itself just emptied.
 */

/** The fixed head of every nudge; the ids that follow differ per nudge. */
const NUDGE_HEAD = 'New message in your inbox';
/** The head nudges had before 2026-09-25, still recognised in queues saved then. */
const OLD_NUDGE_HEAD = 'You have new hive inbox message(s)';

/**
 * Build the nudge, naming the messages that prompted it.
 *
 * The ids are diagnostic, NOT a work list: they let an agent tell "I already
 * handled this last turn" (the id sits in `inbox/.done/`) from "the harness woke
 * me for nothing", which is the distinction it otherwise cannot make and burns a
 * round-trip guessing at. The pending inbox stays authoritative — an agent that
 * has a nudge suppressed by the one-pending rule below still finds its mail by
 * reading the directory, so the text must never invite it to stop at the ids.
 */
export function inboxNudgeText(ids: string[]): string {
  // Short and plain (owner cleanup, 2026-09-25): the instructions already say
  // how to work the inbox, so the nudge only says what arrived.
  // The text is typed into a live terminal, so strip control characters and
  // newlines from each id: a crafted id must never submit keystrokes to the agent.
  const clean = ids.map((id) => id.replace(/[\x00-\x1f\x7f]/g, ''));
  const named = clean.length ? `: ${clean.join(', ')}` : '';
  return `${NUDGE_HEAD}${named}. Work everything still pending in your inbox; an id already in inbox/.done/ was handled earlier.`;
}

/**
 * Is this queued text an inbox-wake nudge?
 *
 * Matches the fixed head only, since every nudge carries different ids — the
 * point is to recognise the COMMAND, not one instance of it. Mirrors
 * `isCompactionCommand`, and the queue's one-pending rule leans on it the same way.
 */
export function isInboxNudge(text: string): boolean {
  const t = text.trim();
  return t.startsWith(NUDGE_HEAD) || t.startsWith(OLD_NUDGE_HEAD);
}
