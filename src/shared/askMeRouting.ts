/**
 * Where an owner's Ask me answer goes (owner, 2026-09-25). Ask me is how the
 * office reaches the owner when it can't decide or do something itself.
 * The owner only talks to Michael (owner, 2026-10-04): the answer goes to him
 * as a request to route the follow-up, and into the memory notes of the agent
 * that raised it. When Michael raised it himself (a job no one fits, a
 * technical failure), both are Michael.
 */

export const MICHAEL_ID = 'god';

/**
 * The agent that raised a question: its recorded `raisedBy`, else the card's
 * assignee, else Michael. Only an agent this office knows counts, so a stale
 * or mistyped id falls through instead of sending the answer nowhere.
 */
export function raiserOf(
  entry: { raisedBy?: string },
  task: { assignee?: string },
  knownIds: ReadonlySet<string>
): string {
  for (const id of [entry.raisedBy, task.assignee]) {
    if (id && (id === MICHAEL_ID || knownIds.has(id))) return id;
  }
  return MICHAEL_ID;
}

/** The conversation an owner's answer opens with Michael for a card, so his
 *  reply (in_reply_to) and the card can always be matched up. */
export function cardConversation(taskId: string): string {
  return `card:${taskId}`;
}

/** The card a conversation is about, if it is one opened by cardConversation. */
export function cardOfConversation(conversation: string | undefined): string | undefined {
  return conversation?.startsWith('card:') ? conversation.slice(5) || undefined : undefined;
}

/** One message an answer sends. */
export interface AnswerMessage {
  to: string;
  act: 'request' | 'inform';
  subject: string;
  body: string;
  conversation?: string;
  requires_reply?: boolean;
}

/** Card text an agent wrote, as one short line: it goes into messages that
 *  come from the owner and into Michael's context, so it can never pass for a
 *  new line of instructions. */
export function cardText(s: string | undefined, max = 120): string {
  const one = (s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * The messages an answer sends (docs/designs/card-lifecycle.md): one, a REQUEST
 * to Michael about the card, so the answer is his open work until he closes it
 * with done; it used to be an inform, a note he could read and set aside, and
 * answered cards stalled in Blocked (owner, 2026-10-02). The team member who
 * raised the question used to get the answer straight from the owner too; now
 * Michael routes the follow-up, to them or someone else (owner, 2026-10-04:
 * the owner only talks to Michael).
 */
export function answerMessages(p: {
  raiser: string;
  raiserName: string;
  taskId: string;
  title: string;
  q: string;
  a: string;
}): AnswerMessage[] {
  const title = cardText(p.title);
  // The card id comes from the ledger agents write, so it is cleaned like the title.
  const id = cardText(p.taskId, 60);
  const qa = [`Q: ${p.q}`, `A: ${p.a}`];
  const forMichael: AnswerMessage = {
    to: MICHAEL_ID,
    act: 'request',
    requires_reply: true,
    conversation: cardConversation(p.taskId),
    subject: `OWNER ANSWER on card ${id}: ${title}`.slice(0, 200),
    body: [
      p.raiser === MICHAEL_ID
        ? `The owner answered the question you raised on card ${id} ("${title}"):`
        : `The owner answered the question ${p.raiserName} raised on card ${id} ("${title}"):`,
      ...qa,
      p.raiser === MICHAEL_ID
        ? 'It is on the card and in your memory notes.'
        : `It is in ${p.raiserName}'s memory notes.`,
      'Route the follow-up: hand the card to the same team member or another, or ask the owner again. Then close this request with a "done" reply (in_reply_to this message). It stays open until you do.',
      // A bundle answered in part comes back with the rest (owner, 2026-10-11).
      'Check each question of the ask against the answer. If any is left unanswered, first add one new ask on this card holding only those questions and keep the card Blocked, or, when this card is done, make a new card that asks them, so none is lost.'
    ].join('\n')
  };
  return [forMichael];
}

/**
 * An open ask stays open until the owner answers it or Michael withdraws it
 * ("dismissedAt"), whatever the card's status and however many asks follow it
 * (owner, 2026-10-04: an open question must never vanish). It used to be only
 * the card's newest ask, so a second, different question on a card silently
 * withdrew the first, and a card moved out of Blocked hid its ask; replaying
 * the ledger found six questions lost that way.
 */
export interface AskEntry { q?: unknown; a?: unknown; dismissedAt?: unknown; kind?: unknown }

/** A report Michael put on Ask me (docs/designs/michael-replies.md, 14A): an
 *  outcome to read, not a question. It never turns the pill coral, never needs
 *  the card Blocked, and "Got it" clears it. */
export const isReport = (e: AskEntry | null | undefined): boolean => !!e && e.kind === 'report';

/** Whether an ask carries a real answer or a real withdrawal: text, never a
 *  blank or a stray value, so a worker writing " " into tasks.json cannot hide
 *  a question from the owner (Codex adversarial review, 2026-10-05). */
const filled = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';
export const isAnswered = (e: AskEntry | null | undefined): boolean => !!e && filled(e.a);
export const isWithdrawn = (e: AskEntry | null | undefined): boolean => !!e && filled(e.dismissedAt);

/** Indexes of a card's open entries of one kind (asks or reports), oldest first. */
function openIndexes(qa: readonly (AskEntry | null | undefined)[] | undefined, reports: boolean): number[] {
  if (!Array.isArray(qa)) return [];
  const out: number[] = [];
  qa.forEach((e, i) => { if (e && typeof e.q === 'string' && isReport(e) === reports && !isAnswered(e) && !isWithdrawn(e)) out.push(i); });
  return out;
}

/** Indexes of the card's open asks, oldest first. Reports are not asks. */
export function openAskIndexes(qa: readonly (AskEntry | null | undefined)[] | undefined): number[] {
  return openIndexes(qa, false);
}

/** Indexes of the card's open reports (not yet read with "Got it" or answered). */
export function openReportIndexes(qa: readonly (AskEntry | null | undefined)[] | undefined): number[] {
  return openIndexes(qa, true);
}

/** The renderer's humanQA merged onto the card's list on disk. The renderer
 *  can only add an answer: the list stays the disk's, entry for entry, and a
 *  slot takes the renderer's "a" and "answeredAt" only while the question is
 *  the same and still open on disk. Its list is a few seconds old, so a
 *  withdrawal (dismissedAt) Michael wrote since, a slot whose question changed
 *  and an entry added on disk all stand (pre-landing review, 2026-10-05).
 *  `added`: the slots that took an answer. */
export function mergeHumanQA(onDisk: unknown[], incoming: unknown[]): { humanQA: unknown[]; added: number[] } {
  const added: number[] = [];
  const humanQA = onDisk.map((d, i) => {
    const e = incoming[i];
    if (!d || typeof d !== 'object' || !e || typeof e !== 'object') return d;
    const disk = d as AskEntry;
    const next = e as AskEntry & { answeredAt?: unknown };
    if (typeof disk.q !== 'string' || disk.q !== next.q || isAnswered(disk) || isWithdrawn(disk)) return d;
    if (typeof next.a !== 'string' || !next.a.trim()) return d;
    added.push(i);
    return { ...d, a: next.a, ...(typeof next.answeredAt === 'string' ? { answeredAt: next.answeredAt } : {}) };
  });
  return { humanQA, added };
}
