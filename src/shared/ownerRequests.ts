import { isNextAt } from './cardGuards';
import { ownValue } from './ownValue';
import { answerMessages, cardOfConversation, cardText, isAnswered, isWithdrawn, MICHAEL_ID, openAskIndexes, raiserOf, type AnswerMessage } from './askMeRouting';

/**
 * Michael's open requests from the owner (docs/designs/card-lifecycle.md): an
 * owner's Ask me answer reaches him as a request about its card, and it stays
 * his open work until he replies to it (in_reply_to), the same request and
 * reply loop he runs with the team. Read from the messages that already exist;
 * nothing else is stored.
 */

/** The fields this reads from a hive message. */
export interface MessageLike {
  id: string;
  from: string;
  act: string;
  conversation?: string;
  in_reply_to?: string | null;
  subject?: string;
  created_at: string;
  to?: string;
  /** The answer an owner's answer request carries (askMeRouting answeredAtOf). */
  answeredAt?: string;
}

/** Most cards listed in one context block; the rest are counted. */
const LIST_MAX = 20;

/** Names a message to the owner may use (the router sends them all to
 *  Michael, the owner's proxy). Callers add Michael's display name. */
export const OWNER_ALIASES: ReadonlySet<string> = new Set(['human', 'god', 'michael']);

/** Owner requests read from this date on (owner, 2026-10-06): it replaces the
 *  rolling 30 day window, so an open request never drops out of Michael's list
 *  (TODOS.md), while requests settled before it stay settled. */
export const OWNER_REQUESTS_FLOOR = '2026-09-06T00:00:00.000Z';

export interface OwnerRequest {
  id: string;
  taskId: string;
  subject: string;
  createdAt: string;
}

/**
 * `toMichael`: messages delivered to Michael (his inbox and inbox/.done).
 * `fromMichael`: messages he sent (his outbox/.sent and outbox).
 * Every owner request on a card stays open until Michael replies to it or to
 * a newer one on the same card: a card can hold answers to several questions,
 * and a second answer must not hide the first. A reply settles the card's
 * requests up to it. Oldest first.
 */
export function openOwnerRequests(toMichael: MessageLike[], fromMichael: MessageLike[], ownerAliases: ReadonlySet<string> = OWNER_ALIASES): OwnerRequest[] {
  // Only his reply to the owner closes it; a hand-off to a teammate in the
  // same thread is routing, not the closure. Any name that reaches the owner
  // counts (TODOS.md reply alias).
  const replied = new Set(fromMichael.filter((m) => ownerAliases.has((m.to ?? '').toLowerCase())).map((m) => m.in_reply_to).filter((id): id is string => !!id));
  const byCard = new Map<string, MessageLike[]>();
  const seen = new Set<string>();
  for (const m of toMichael) {
    if (m.from !== 'human' || m.act !== 'request' || seen.has(m.id)) continue;
    const taskId = cardOfConversation(m.conversation);
    if (!taskId) continue;
    seen.add(m.id);
    byCard.set(taskId, [...(byCard.get(taskId) ?? []), m]);
  }
  const out: OwnerRequest[] = [];
  for (const [taskId, list] of byCard) {
    const settled = list.reduce((at, m) => (replied.has(m.id) && m.created_at > at ? m.created_at : at), '');
    for (const m of list) {
      if (!replied.has(m.id) && m.created_at > settled) out.push({ id: m.id, taskId, subject: m.subject ?? '', createdAt: m.created_at });
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** How Michael's open owner requests read in his context each turn. Null when
 *  there are none, so nothing is added. */
export function ownerRequestsContext(open: OwnerRequest[], now: number): string | null {
  if (!open.length) return null;
  const age = (iso: string): string => {
    const h = Math.max(0, Math.floor((now - Date.parse(iso)) / 3_600_000));
    return h < 1 ? 'under an hour' : h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`;
  };
  return [
    'OPEN REQUESTS FROM THE OWNER. Each is an answer the owner gave on a card. Route the follow-up (hand the card to the same team member or another, or ask the owner again), then close the request with a "done" reply, in_reply_to its id. They stay here until you do.',
    ...open.slice(0, LIST_MAX).map((r) => `- card ${cardText(r.taskId, 60)}: ${cardText(r.subject)} (open ${age(r.createdAt)}, id ${r.id})`),
    ...(open.length > LIST_MAX ? [`- and ${open.length - LIST_MAX} more`] : [])
  ].join('\n');
}

/** The fields this reads from a task card. */
export interface CardLike {
  id: string;
  title?: string;
  status?: string;
  assignee?: string;
  humanQA?: Array<{ q?: string; a?: string; answeredAt?: string; dismissedAt?: string; raisedBy?: string }>;
}

/**
 * Answers the owner gave on a card that is not done, with no owner request to
 * Michael sent on that card since: the launch catch-up's candidates
 * (card-lifecycle.md section 5). Every answered, timed entry counts, not only
 * the newest on a Blocked card, because a card can hold several questions and
 * an answered card often leaves Blocked. A request that names its answer
 * covers that answer only, so a failed send stays caught up after the owner
 * answers another question on the card; an older request without one covers
 * every answer before it. catchUpRequests keeps only the answers the app
 * recorded itself.
 */
export function answersWithoutRequest(
  tasks: CardLike[],
  toMichael: MessageLike[]
): Array<{ task: CardLike; q: string; a: string; raisedBy?: string; answeredAt?: string }> {
  const lastRequestAt = new Map<string, string>();
  const requested = new Set<string>();
  for (const m of toMichael) {
    if (m.from !== 'human' || m.act !== 'request') continue;
    const taskId = cardOfConversation(m.conversation);
    if (!taskId) continue;
    if (m.answeredAt) requested.add(`${taskId}|${m.answeredAt}`);
    else if (!lastRequestAt.has(taskId) || m.created_at > lastRequestAt.get(taskId)!) lastRequestAt.set(taskId, m.created_at);
  }
  const out: Array<{ task: CardLike; q: string; a: string; raisedBy?: string; answeredAt?: string }> = [];
  for (const t of tasks) {
    if (!t || t.status === 'done' || !Array.isArray(t.humanQA)) continue;
    const sent = lastRequestAt.get(t.id);
    for (const e of t.humanQA) {
      if (!e || typeof e.q !== 'string' || !isAnswered(e) || isWithdrawn(e) || typeof e.answeredAt !== 'string') continue;
      if (requested.has(`${t.id}|${e.answeredAt}`) || (sent && sent >= e.answeredAt)) continue;
      out.push({ task: t, q: e.q, a: e.a as string, raisedBy: e.raisedBy, answeredAt: e.answeredAt });
    }
  }
  return out;
}

/** How the app records an answer the owner gave on Ask me (security review,
 *  2026-10-03): the card, the answer's time and a digest of its question and
 *  answer. Agents write tasks.json too, so only an answer the app saved itself,
 *  word for word, may be relayed as the owner's. */
export const answerKey = (taskId: string, answeredAt: string, digest: string): string => `${taskId}|${answeredAt}|${digest}`;

/** Digest of an answer's question and answer text (main passes a sha256). */
export type AnswerDigest = (q: string, a: string) => string;

/**
 * The launch catch-up's requests to Michael (card-lifecycle.md section 5):
 * one per stuck answered card whose answer the app recorded. An answer the
 * app has no record of (an agent wrote it into the card) is never relayed.
 */
export function catchUpRequests(
  candidates: Array<{ task: CardLike; q: string; a: string; raisedBy?: string; answeredAt?: string }>,
  recorded: ReadonlySet<string>,
  agents: Record<string, { name?: string }>,
  digest: AnswerDigest
): AnswerMessage[] {
  const known = new Set(Object.keys(agents));
  const out: AnswerMessage[] = [];
  for (const { task, q, a, raisedBy, answeredAt } of candidates) {
    if (!answeredAt || !recorded.has(answerKey(task.id, answeredAt, digest(q, a)))) continue;
    const raiser = raiserOf({ raisedBy }, { assignee: typeof task.assignee === 'string' ? task.assignee : undefined }, known);
    const m = answerMessages({ raiser, raiserName: agents[raiser]?.name ?? raiser, taskId: task.id, title: task.title ?? task.id, q, a, answeredAt }).find((x) => x.to === MICHAEL_ID);
    if (m) out.push(m);
  }
  return out;
}

/** How long an owner request may sit with Michael, in office time, before the
 *  Tasks view says he hasn't moved it (card-lifecycle.md section 3, D4): one
 *  working day. With no office hours known, a working day is 24 hours of an
 *  office day; with hours, it is the length of the work day. */
export const MICHAEL_STALL_MS = 24 * 3_600_000;

/** An office's work hours, 'HH:MM' local (the pack's officeHours.work). */
export interface WorkHours { start: string; end: string }

const minutesOf = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
};

/** The work day as minutes from midnight, or null when unusable. */
function workWindow(work: WorkHours | undefined): [number, number] | null {
  if (!work) return null;
  const s = minutesOf(work.start);
  const e = minutesOf(work.end);
  return s !== null && e !== null && e > s ? [s, e] : null;
}

const WEEK: readonly string[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Time between two moments that falls in the office's open hours, in local
 * time. `days` is the office pack's officeHours.days ('mon'...'sun'); an empty
 * list counts every day. `work` limits each day to the work hours; without it
 * the whole day counts. A weekend or a night the office is closed does not
 * count against Michael.
 */
export function workingMsBetween(fromMs: number, toMs: number, days: readonly string[], work?: WorkHours): number {
  if (!(toMs > fromMs)) return 0;
  const open = new Set(days.length ? days : WEEK);
  const window = workWindow(work);
  let total = 0;
  const cursor = new Date(fromMs);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() < toMs) {
    const day = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1); // handles daylight saving days
    if (!open.has(WEEK[day.getDay()])) continue;
    let start = day.getTime();
    let end = cursor.getTime();
    if (window) {
      start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, window[0]).getTime();
      end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, window[1]).getTime();
    }
    total += Math.max(0, Math.min(end, toMs) - Math.max(start, fromMs));
  }
  return total;
}

/** What a card with an open owner request shows on the Tasks view. */
export function michaelCardState(createdAt: string, now: number, days: readonly string[], work?: WorkHours): 'with' | 'stalled' {
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return 'with';
  const window = workWindow(work);
  const workingDay = window ? (window[1] - window[0]) * 60_000 : MICHAEL_STALL_MS;
  return workingMsBetween(at, now, days, work) > workingDay ? 'stalled' : 'with';
}

/** An owner's change to a card, as Michael hears about it (card-lifecycle.md
 *  section 4): a note, since nothing needs his reply, in the card's
 *  conversation. */
export type OwnerCardChange =
  | { kind: 'closed'; reason?: string }
  | { kind: 'moved'; from: string; to: string; reason?: string }
  | { kind: 'finished'; result: string; withdrew: number };

const STATUS_WORDS: Record<string, string> = { triage: 'Triage', todo: 'To do', doing: 'Doing', waiting: 'Waiting', blocked: 'Blocked', done: 'Done' };

export function ownerChangeNote(task: { id: string; title?: string }, change: OwnerCardChange): { subject: string; body: string } {
  const card = `card ${cardText(task.id, 60)}${task.title ? ` "${cardText(task.title)}"` : ''}`;
  if (change.kind === 'closed') {
    return {
      subject: `OWNER CLOSED card ${cardText(task.id, 60)}`,
      body: [
        `The owner closed ${card} as Done.${change.reason ? ` Reason: ${change.reason}` : ''}`,
        'This is the owner\'s decision, not finished work. Treat the card as closed: stop work on it and tell whoever has it. Do not reopen it unless the owner asks.'
      ].join('\n')
    };
  }
  if (change.kind === 'finished') {
    return {
      subject: `OWNER FINISHED card ${cardText(task.id, 60)}`,
      body: [
        `The owner marked ${card} Done with a result: ${cardText(change.result, 500)}`,
        `That withdrew ${change.withdrew === 1 ? 'its open question' : `its ${change.withdrew} open questions`} from Ask me, unanswered. Tell whoever raised ${change.withdrew === 1 ? 'it' : 'them'}. If one still needs an answer, ask it again on a new card.`
      ].join('\n')
    };
  }
  return {
    subject: `OWNER MOVED card ${cardText(task.id, 60)} to ${ownValue(STATUS_WORDS, change.to) ?? change.to}`,
    body: `The owner moved ${card} from ${ownValue(STATUS_WORDS, change.from) ?? change.from} to ${ownValue(STATUS_WORDS, change.to) ?? change.to}.${change.reason ? ` Reason: ${cardText(change.reason, 500)}` : ''} Take it from there: check who has it and route the work to match.`
  };
}

/** The owner deleted a team member for good (owner, 2026-10-14): Michael
 *  hears once, with their open cards, so he gives each one to someone else or
 *  closes it. Their open Ask me questions were withdrawn by the app. */
export function memberDeletedNote(
  member: { id: string; name?: string },
  cards: ReadonlyArray<{ id: string; title?: string; status?: string }>,
  withdrawn: number,
  setAside = 0
): { subject: string; body: string } {
  const who = cardText(member.name?.trim() || member.id, 60);
  const shown = cards.slice(0, 20);
  return {
    subject: `OWNER DELETED ${who} from the team`,
    body: [
      `The owner deleted ${who} (${cardText(member.id, 60)}) from the team for good. Never route work to them again.`,
      ...(shown.length ? [
        'Their open cards. Give each one to a teammate who fits, or close it when the work is no longer needed:',
        ...shown.map((c) => `- card ${cardText(c.id, 60)}${c.title ? `: ${cardText(c.title)}` : ''}${c.status ? ` (${ownValue(STATUS_WORDS, c.status) ?? cardText(c.status, 20)})` : ''}`),
        ...(cards.length > shown.length ? [`- and ${cards.length - shown.length} more`] : [])
      ] : []),
      ...(withdrawn > 0 ? [`The app withdrew their ${withdrawn === 1 ? 'open question' : `${withdrawn} open questions`} on Ask me. When the work still needs an answer, ask it again on the card.`] : []),
      ...(setAside > 0 ? [`The app also set aside ${setAside === 1 ? 'a filing' : `${setAside} filings`} they made that you had not worked yet, so nothing new is asked for them.`] : [])
    ].join('\n')
  };
}

/** The app put back a Done card an agent reopened (card-lifecycle.md section
 *  10): only the owner takes a card out of Done. Status only: a question asked
 *  on it meanwhile is still open, so Michael moves it to a new card. */
export function reopenedNote(task: { id: string; title?: string }, to: string, openAsk = false): { subject: string; body: string } {
  const card = `card ${cardText(task.id, 60)}${task.title ? ` "${cardText(task.title)}"` : ''}`;
  return {
    subject: `DONE CARD PUT BACK: card ${cardText(task.id, 60)}`,
    body: [
      `${card} was moved out of Done to ${ownValue(STATUS_WORDS, to) ?? cardText(to, 20)} by an agent, so the app put it back to Done: only the owner takes a card out of Done. If the work needs more, make a new card for it, and tell whoever moved it.`,
      ...(openAsk ? ['It has a question open on Ask me. Withdraw it on this card ("dismissedAt" and a short "dismissedReason"), and when the work still needs the answer, ask it on the new card.'] : [])
    ].join('\n')
  };
}

/** The app put back a Done card that vanished from the board: a card ends only
 *  as Done and is never deleted. */
export function restoredDoneNote(task: { id: string; title?: string }): { subject: string; body: string } {
  const card = `card ${cardText(task.id, 60)}${task.title ? ` "${cardText(task.title)}"` : ''}`;
  return {
    subject: `DONE CARD RESTORED: card ${cardText(task.id, 60)}`,
    body: `${card} disappeared from tasks.json, so the app put it back as it was when it was last Done. Never delete a card: a card ends only as Done. When you rewrite tasks.json, start from the file as it is now.`
  };
}

/** The app moved a card back out of Triage: Triage is only the way a new card
 *  comes in. */
export function untriagedNote(task: { id: string; title?: string }, to: string): { subject: string; body: string } {
  const card = `card ${cardText(task.id, 60)}${task.title ? ` "${cardText(task.title)}"` : ''}`;
  return {
    subject: `CARD MOVED BACK FROM TRIAGE: card ${cardText(task.id, 60)}`,
    body: `${card} was moved into Triage after it was on the board, so the app moved it back to ${ownValue(STATUS_WORDS, to) ?? cardText(to, 20)}. Triage is only for new filings; move the card to where its work stands.`
  };
}

/** A To do card's nextAt has come: its person does the step (house rule 8).
 *  `whose`: the card's person's, Michael's own, or nobody's (it goes to Michael). */
export function nextStepDueNote(task: { id: string; title?: string; nextAt?: string; description?: unknown }, godName: string, whose: 'person' | 'own' | 'nobody' = 'person'): { subject: string; body: string } {
  const what = typeof task.description === 'string' && task.description.trim() ? ` What it is about: ${cardText(task.description, 500).replace(/[.!?]+$/, '')}.` : '';
  return {
    subject: `Next step due: ${cardText(task.title ?? task.id)}`,
    body: `The next step on card ${cardText(task.id, 60)} "${cardText(task.title ?? task.id)}" was set for ${cardText(String(task.nextAt ?? ''), 40)} and is due now.${what} ${whose === 'nobody'
      ? 'Nobody on the team has this card: do the step or hand it to someone, then move the card to where its work stands.'
      : whose === 'own'
        ? 'It is your own card: do the step, then move the card to where its work stands.'
        : `Do it, then tell ${cardText(godName, 40)} where the card stands.`}`
  };
}

/** Michael's one backstop: a card still in To do long after its step came due.
 *  `reminded`: the team member who got the reminder, when it was not him. */
export function nextStepBackstopNote(task: { id: string; title?: string; nextAt?: string }, reminded?: string): { subject: string; body: string } {
  return {
    subject: `STILL IN TO DO: card ${cardText(task.id, 60)}`,
    body: `Card ${cardText(task.id, 60)} "${cardText(task.title ?? task.id)}" had its next step due at ${cardText(String(task.nextAt ?? ''), 40)}${reminded ? `, and ${cardText(reminded, 40)} was reminded` : ''}, but it is still in To do. ${reminded ? 'Check with them' : 'Check who should do it'}, then move the card to where its work stands, with a new "nextAt" if the step moved.`
  };
}

/** A card Michael has to tidy: in Blocked with nothing asked (no `issue`), or
 *  holding an open question the wrong way (`issue`). */
export interface StuckCard { id: string; title: string; assignee?: string; issue?: 'filing' | 'triage' | 'ask-off-blocked' | 'several-asks' | 'bad-next' | 'ask-as-list' }

const stuckOf = (t: CardLike, issue?: StuckCard['issue']): StuckCard => ({
  id: t.id,
  title: String(t.title ?? t.id).trim() || t.id,
  ...(t.assignee ? { assignee: t.assignee } : {}),
  ...(issue ? { issue } : {})
});

/**
 * Blocked cards with nothing asked (card-lifecycle.md section 7): in Blocked,
 * but with no open question for the owner on Ask me and no open owner request
 * to Michael. Blocked means waiting on the owner's answer, so such a card is
 * waiting on nobody. Found 2026-10-03: Michael closed six owner requests and
 * left all six cards Blocked, their next questions never asked.
 */
export function blockedWithNothingAsked(tasks: CardLike[], open: Pick<OwnerRequest, 'taskId'>[]): StuckCard[] {
  const withMichael = new Set(open.map((r) => r.taskId));
  return tasks
    .filter((t) => !!t && typeof t.id === 'string' && t.status === 'blocked' && openAskIndexes(t.humanQA as never).length === 0 && !withMichael.has(t.id))
    .map((t) => stuckOf(t));
}

/** Two or more lines that start like a numbered or bulleted list. */
const LIST_LINES = /^[ \t]*(?:\d+[.)]|[-*\u2022])[ \t]+\S/gm;

/**
 * An open ask written as a list in its text, with no options or parts, asked
 * since `since` (ms). The owner can only type an answer to it, so Michael is
 * told to rewrite it (docs/designs/ask-me-options.md; owner, 2026-10-15: his
 * habit beat the instruction). Older asks keep their look (decision 1A).
 */
export function askAsList(entry: { q?: unknown; askedAt?: unknown; options?: unknown; parts?: unknown } | null | undefined, since: number): boolean {
  if (!entry || typeof entry.q !== 'string' || entry.options !== undefined || entry.parts !== undefined) return false;
  const at = typeof entry.askedAt === 'string' ? Date.parse(entry.askedAt) : NaN;
  if (!Number.isFinite(at) || at < since) return false;
  return (entry.q.match(LIST_LINES) ?? []).length >= 2;
}

/**
 * Open questions held the wrong way (owner, 2026-10-04). A question stays on
 * Ask me until the owner answers it or Michael withdraws it, so a card that
 * left Blocked, or that gained a second question, still shows the old one.
 * Michael is told each turn until he moves the card back to Blocked, folds the
 * questions into one, or withdraws what no longer matters. An ask written as
 * a list since `since` (ms) is listed too (askAsList).
 */
export function asksToTidy(tasks: CardLike[], since = Infinity): StuckCard[] {
  const out: StuckCard[] = [];
  for (const t of tasks) {
    if (!t || typeof t.id !== 'string') continue;
    // Filed by a team member, waiting for Michael to check and release it
    // (card-lifecycle.md section 10); its ask is not on Ask me yet.
    if (t.status === 'triage') { out.push(stuckOf(t, 'triage')); continue; }
    // A next step time the app cannot read wakes nobody (cardGuards.ts).
    const next = (t as { nextAt?: unknown }).nextAt;
    if (t.status === 'todo' && next !== undefined && next !== null && next !== '' && !isNextAt(next)) out.push(stuckOf(t, 'bad-next'));
    const open = openAskIndexes(t.humanQA as never).length;
    if (!open) continue;
    if (t.status !== 'blocked') out.push(stuckOf(t, 'ask-off-blocked'));
    else if (open > 1) out.push(stuckOf(t, 'several-asks'));
    const qa = t.humanQA as unknown as Parameters<typeof askAsList>[0][] | undefined;
    if (openAskIndexes(t.humanQA as never).some((i) => askAsList(qa?.[i], since))) out.push(stuckOf(t, 'ask-as-list'));
  }
  return out;
}

const STUCK_HEADS: Record<NonNullable<StuckCard['issue']> | 'nothing-asked', string> = {
  filing: 'NEW FILINGS TO TRIAGE, oldest first. Team members filed these in the triage folder of the hive with what their work needs; the owner does not see them. Work them in this order, one at a time, against the board as it stands. For each one: answer it from your memory or the board when you can, and tell the team member; fold it into an existing card that covers the same matter; route a question a teammate can answer; drop a duplicate; or make a card for it, "blocked" with its ask rewritten into the Ask me shape, or "waiting" with "waitingOn". Keep one card per source of answers. Then move the file to triage/.done.',
  triage: 'CARDS IN TRIAGE ON THE BOARD. The owner does not see these. Handle each like a new filing, then release it: "blocked" when it asks the owner, "waiting" with "waitingOn" when it waits on someone else, or "done" when it needs nothing more.',
  'nothing-asked': 'BLOCKED CARDS WITH NOTHING ASKED. These cards are in Blocked, but none has a question for the owner on Ask me or an open request from the owner, so nothing is moving them. Blocked means waiting on the owner\'s answer. For each one: if it needs the owner, add the question to its humanQA so it shows on Ask me; if it waits on someone outside the office or on a team member, move it to "waiting" and name who in "waitingOn"; if the work is finished, or the owner decided to stop it, move it to "done".',
  'ask-off-blocked': 'OPEN QUESTIONS ON CARDS OUT OF BLOCKED. Each of these cards left Blocked with a question still open, and the owner still sees it on Ask me until they answer it or you withdraw it. For each one: if you moved the card out of Blocked and the work still needs the answer, move it back to "blocked". If the owner moved it, the card is done, or the question no longer matters, withdraw the question by setting "dismissedAt" (the time) and a short "dismissedReason" on that humanQA entry. Never move a card the owner moved.',
  'bad-next': 'CARDS WITH A NEXT TIME THE APP CANNOT READ. Nobody is reminded when it comes. Set "nextAt" on each to an ISO date and time with its offset, such as 2026-10-12T09:00:00+01:00, or remove it.',
  'ask-as-list': 'ASKS WRITTEN AS A LIST. The owner can only type an answer to these. Rewrite the open humanQA entry on each card: keep only the bold sentence and the short context in "q"; put a choice in "options", as [{"label": "..."}] with "recommended": true on the one you recommend, or several questions in "parts", as [{"q": "..."}], giving a question its own "options" when it is a choice. Keep its "askedAt" and "raisedBy".',
  'several-asks': 'CARDS WITH MORE THAN ONE OPEN QUESTION. The owner sees every one of them on Ask me. Keep one open question per card: fold what still matters into the newest, and withdraw the others by setting "dismissedAt" (the time) and a short "dismissedReason" on each.'
};

/** How those cards read in Michael's context each turn. Null when none. */
export function stuckCardsContext(stuck: StuckCard[]): string | null {
  if (!stuck.length) return null;
  const parts: string[] = [];
  for (const kind of ['filing', 'triage', 'nothing-asked', 'ask-off-blocked', 'several-asks', 'ask-as-list', 'bad-next'] as const) {
    const cards = stuck.filter((c) => (c.issue ?? 'nothing-asked') === kind);
    if (!cards.length) continue;
    parts.push([
      STUCK_HEADS[kind],
      ...cards.slice(0, LIST_MAX).map((c) => kind === 'filing'
        ? `- triage/${cardText(c.id, 80)}: ${cardText(c.title)}${c.assignee ? ` (from ${cardText(c.assignee, 40)})` : ''}`
        : `- card ${cardText(c.id, 60)}: ${cardText(c.title)}${c.assignee ? ` (with ${cardText(c.assignee, 40)})` : ''}`),
      ...(cards.length > LIST_MAX ? [`- and ${cards.length - LIST_MAX} more`] : [])
    ].join('\n'));
  }
  return parts.join('\n\n');
}


// ── Michael answers the owner where they asked (docs/designs/michael-replies.md) ──

/** The conversation tag on every message in one owner question's thread. */
const OWNER_CONV_PREFIX = 'owner:';
/** A question the owner asked Michael in the dock opens this conversation. */
export const ownerConversation = (id: string): string => `${OWNER_CONV_PREFIX}${id}`;

/** The question a conversation belongs to, if it is an owner conversation. */
export function ownerQuestionOf(conversation: string | undefined): string | undefined {
  return conversation?.startsWith(OWNER_CONV_PREFIX) ? conversation.slice(OWNER_CONV_PREFIX.length) || undefined : undefined;
}

/** A hive message as the dock reads it. */
export interface ThreadMessage extends MessageLike {
  body?: string;
  /** When Michael expects to answer (a holding reply). */
  expect_by?: string;
  /** Who the work waits on, for "Waiting on Oscar". */
  waiting_on?: string;
  /** Michael's terminal words filed by the app (R8). */
  from_notes?: boolean;
}

/** What the app remembers about each owner request (R5), in
 *  agents/human/state.json. Times are epoch ms. */
export interface OwnerRequestFlags {
  /** Typed into Michael's terminal: he has it (R6). */
  deliveredAt?: number;
  withdrawnAt?: number;
  notSentAt?: number;
  /** The owner saw replies up to this time in the open dock. */
  readAt?: number;
  /** Reply ids a desktop notification went out for (never twice, 12A). */
  notified?: string[];
  remindedAt?: number;
  nudgedAt?: number;
  /** Notes the app filed from Michael's terminal (R8). */
  notes?: string[];
}

export interface OwnerDockState { requests: Record<string, OwnerRequestFlags> }

/** Only these close an owner question: an answer or a reasoned refusal.
 *  A holding reply, a question back or filed notes never do. */
export const closesOwnerQuestion = (act: string | undefined): boolean => act === 'done' || act === 'refuse';

/** Past this long with no time given, Michael is later than he said (6A). */
export const OWNER_LATE_DEFAULT_MS = 2 * 3_600_000;

/** How often Nudge may remind Michael about one request (6A). */
export const OWNER_NUDGE_EVERY_MS = 3_600_000;

export type OwnerQuestionStatus =
  | 'sent' | 'has-it' | 'waiting' | 'late' | 'waiting-for-you' | 'answered' | 'couldnt-finish' | 'withdrawn' | 'not-sent';

export interface DockQuestion {
  kind: 'owner';
  id: string;
  conversation: string;
  text: string;
  at: string;
  status: OwnerQuestionStatus;
  /** "Waiting on Oscar" when the holding reply named someone. */
  waitingOn?: string;
  /** When Michael said he would answer, or the default late time. */
  dueAt?: number;
  /** The question of Michael's this message answers, if any. */
  answers?: string;
  /** Not yet seen in the open dock. */
  unread: boolean;
}

export interface DockReply {
  kind: 'michael';
  id: string;
  /** The owner message it replies to. */
  replyTo: string;
  act: string;
  text: string;
  at: string;
  notes: boolean;
}

export type DockItem = DockQuestion | DockReply;

export interface OwnerDock {
  items: DockItem[];
  /** Questions Michael has not closed. */
  open: number;
  /** Replies not yet seen in the open dock. */
  unread: number;
  /** Questions where Michael is waiting on the owner. */
  waitingForYou: number;
}

const tsOf = (iso: string | undefined): number => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : 0;
};

/**
 * When each owner conversation was last closed (owner:<id>): a `done` or
 * `refuse` to any question in it closes every question in it asked up to that
 * reply, so the owner's answer to Michael's question back never stays open on
 * its own after Michael finished the thread.
 */
function conversationsClosed(questions: ThreadMessage[], replies: ThreadMessage[], ownerAliases: ReadonlySet<string>): Map<string, { at: number; act: string }> {
  const convOf = new Map(questions.map((q) => [q.id, q.conversation ?? ownerConversation(q.id)]));
  const out = new Map<string, { at: number; act: string }>();
  for (const r of replies) {
    if (!r.in_reply_to || r.from_notes || !closesOwnerQuestion(r.act) || !ownerAliases.has((r.to ?? '').toLowerCase())) continue;
    const conv = convOf.get(r.in_reply_to);
    if (conv && (out.get(conv)?.at ?? 0) < tsOf(r.created_at)) out.set(conv, { at: tsOf(r.created_at), act: r.act });
  }
  return out;
}

/**
 * The owner's conversation with Michael, for the dock. `ownerSent` is the
 * owner's sent mail (agents/human/outbox/.sent, filed by the app at send);
 * `fromMichael` his outbox history; `verified` keeps only owner messages the
 * app recorded (answer keys), so a message an agent forged is never shown as
 * the owner's. A reply counts only when it names an owner message by
 * `in_reply_to`; notes count only when the app filed them (`flags.notes`).
 */
export function ownerDock(
  ownerSent: ThreadMessage[],
  fromMichael: ThreadMessage[],
  state: OwnerDockState,
  now: number,
  verified: (m: ThreadMessage) => boolean = () => true,
  ownerAliases: ReadonlySet<string> = OWNER_ALIASES
): OwnerDock {
  const owner = ownerSent.filter((m) => m.from === 'human' && ownerQuestionOf(m.conversation) && verified(m));
  const ownerIds = new Set(owner.map((m) => m.id));
  const notesIds = new Set(Object.values(state.requests ?? {}).flatMap((f) => f?.notes ?? []));
  const replies = fromMichael.filter((m) =>
    ownerAliases.has((m.to ?? '').toLowerCase()) && m.in_reply_to && ownerIds.has(m.in_reply_to)
    && (!m.from_notes || notesIds.has(m.id)));
  const byQuestion = new Map<string, ThreadMessage[]>();
  for (const r of replies) byQuestion.set(r.in_reply_to!, [...(byQuestion.get(r.in_reply_to!) ?? []), r]);
  // A question back is answered when the owner replies to it.
  const answeredQueries = new Set(owner.map((m) => m.in_reply_to).filter((x): x is string => !!x));
  const threadClosed = conversationsClosed(owner, replies, ownerAliases);

  const items: DockItem[] = [];
  let open = 0;
  let unread = 0;
  let waitingForYou = 0;
  for (const q of owner) {
    const flags = state.requests?.[q.id] ?? {};
    const mine = (byQuestion.get(q.id) ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    const real = mine.filter((r) => !r.from_notes);
    const last = real[real.length - 1];
    let status: OwnerQuestionStatus;
    let waitingOn: string | undefined;
    let dueAt: number | undefined;
    if (flags.withdrawnAt) status = 'withdrawn';
    else if (flags.notSentAt && !flags.deliveredAt) status = 'not-sent';
    else if (last && closesOwnerQuestion(last.act)) status = last.act === 'refuse' ? 'couldnt-finish' : 'answered';
    else if ((threadClosed.get(q.conversation ?? ownerConversation(q.id))?.at ?? 0) >= tsOf(q.created_at)) {
      status = threadClosed.get(q.conversation ?? ownerConversation(q.id))!.act === 'refuse' ? 'couldnt-finish' : 'answered';
    }
    else if (last?.act === 'query' && !answeredQueries.has(last.id)) status = 'waiting-for-you';
    else if (!flags.deliveredAt) status = 'sent';
    else {
      const holding = [...real].reverse().find((r) => r.act === 'inform');
      waitingOn = holding?.waiting_on?.trim() || undefined;
      dueAt = tsOf(holding?.expect_by) || flags.deliveredAt + OWNER_LATE_DEFAULT_MS;
      status = now > dueAt ? 'late' : holding ? 'waiting' : 'has-it';
    }
    const closed = status === 'answered' || status === 'couldnt-finish' || status === 'withdrawn';
    if (!closed) open++;
    if (status === 'waiting-for-you') waitingForYou++;
    const seen = flags.readAt ?? 0;
    const newer = mine.filter((r) => tsOf(r.created_at) > seen).length;
    unread += newer;
    items.push({
      kind: 'owner', id: q.id, conversation: q.conversation ?? ownerConversation(q.id), text: q.body ?? q.subject ?? '', at: q.created_at,
      status, ...(waitingOn ? { waitingOn } : {}), ...(dueAt ? { dueAt } : {}),
      ...(q.in_reply_to ? { answers: q.in_reply_to } : {}), unread: newer > 0
    });
    for (const r of mine) items.push({ kind: 'michael', id: r.id, replyTo: q.id, act: r.act, text: r.body ?? r.subject ?? '', at: r.created_at, notes: !!r.from_notes });
  }
  items.sort((a, b) => a.at.localeCompare(b.at));
  return { items, open, unread, waitingForYou };
}

/** An owner question Michael still owes a reply, for his context. */
export interface OpenOwnerQuestion { id: string; text: string; createdAt: string }

/**
 * Questions the owner asked in the dock that Michael has been handed and not
 * closed with `done` or `refuse`: they stay in his context each turn.
 * `toMichael` holds his copies (filed in inbox/.done when typed, R6).
 */
export function openOwnerQuestions(
  toMichael: ThreadMessage[],
  fromMichael: ThreadMessage[],
  ownerAliases: ReadonlySet<string> = OWNER_ALIASES,
  /** Only messages the owner really sent (the dock's check), so a file an agent
   *  drops in Michael's inbox never reaches him as the owner's question (ship D4). */
  verified: (m: ThreadMessage) => boolean = () => true
): OpenOwnerQuestion[] {
  const questions = toMichael.filter((m) => m.from === 'human' && ownerQuestionOf(m.conversation) && verified(m));
  const closed = new Set(fromMichael
    .filter((m) => ownerAliases.has((m.to ?? '').toLowerCase()) && closesOwnerQuestion(m.act) && !m.from_notes)
    .map((m) => m.in_reply_to).filter((x): x is string => !!x));
  const threadClosed = conversationsClosed(questions, fromMichael, ownerAliases);
  const seen = new Set<string>();
  const out: OpenOwnerQuestion[] = [];
  for (const m of questions) {
    if (seen.has(m.id) || closed.has(m.id)) continue;
    if ((threadClosed.get(m.conversation ?? ownerConversation(m.id))?.at ?? 0) >= tsOf(m.created_at)) continue;
    seen.add(m.id);
    out.push({ id: m.id, text: m.body ?? m.subject ?? '', createdAt: m.created_at });
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** How those questions read in Michael's context each turn. Null when none. */
export function ownerQuestionsContext(open: OpenOwnerQuestion[]): string | null {
  if (!open.length) return null;
  return [
    'QUESTIONS FROM THE OWNER IN YOUR CONVERSATION. Each is waiting for your answer in the owner\'s conversation with you. Route the work as you would any request, then answer the owner: a message "to": "human" with "in_reply_to" the id. Use "act": "done" with the answer, "refuse" with a one line reason when it cannot be done, "query" to ask the owner something about it, or "inform" with "expect_by" (a time) and "waiting_on" (who) while it is in progress. They stay here until you send done or refuse.',
    ...open.slice(0, LIST_MAX).map((q) => `- id ${cardText(q.id, 60)}: ${cardText(q.text)}`),
    ...(open.length > LIST_MAX ? [`- and ${open.length - LIST_MAX} more`] : [])
  ].join('\n');
}

/** The system note when Michael writes to the owner without naming the
 *  question (R2). */
export function unmatchedReplyNote(open: OpenOwnerQuestion[]): { subject: string; body: string } {
  return {
    subject: 'Which question does this answer?',
    body: [
      'Your message to the owner names no question, so it was not shown in their conversation. Send it again with "in_reply_to" set to the id it answers:',
      ...open.slice(0, LIST_MAX).map((q) => `- id ${cardText(q.id, 60)}: ${cardText(q.text)}`)
    ].join('\n')
  };
}

/** The work order typed into Michael's terminal for one owner question (R6). */
export function ownerWorkOrder(id: string, text: string): string {
  return `The owner asks you (id ${id}): ${text}\n\nAnswer in the owner's conversation: a message "to": "human" with "in_reply_to": "${id}" (act done, refuse with a reason, query, or inform with expect_by and waiting_on while it is in progress).`;
}

/** Where a composer message goes (R3, R7): a slash command in the engine's
 *  list goes straight to the terminal; anything else is an owner question. */
export function ownerComposeTarget(text: string, commands: ReadonlySet<string>): 'terminal' | 'question' {
  const first = text.trim().split(/\s+/)[0] ?? '';
  return first.startsWith('/') && commands.has(first.toLowerCase()) ? 'terminal' : 'question';
}

/** The "Attached files:" block both composers use. */
export function withAttachments(text: string, attachments: Array<{ path: string; name: string }>): string {
  if (!attachments.length) return text;
  return (text.trim() ? `${text}\n\nAttached files:\n` : 'Attached files:\n') + attachments.map((a) => `- ${a.path} (${a.name})`).join('\n');
}
