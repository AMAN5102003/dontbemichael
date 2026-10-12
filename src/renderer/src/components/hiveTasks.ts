import { openAskIndexes } from '@shared/askMeRouting';
import { isNextAt } from '@shared/cardGuards';

/* The hive task ledger as the renderer reads it: the card types, the open
 * question rule and the one parser every reader goes through. Plain TypeScript
 * with no UI, so the shared Needs you feed (shell/useNeedsYou.ts) and its tests
 * can load it. TasksKanban.tsx re-exports all of it. */

/** A card on the task kanban. Mirrors HiveTask in the main/preload process —
 *  re-declared locally so the renderer doesn't reach into the preload package
 *  (same convention as store/config.ts). */
export interface HumanQA {
  q: string;
  a?: string;
  askedAt?: string;
  answeredAt?: string;
  /** Set when Michael withdraws the ask without an answer (or the owner closes
   *  the card): the question stays on the card as history and leaves ASK ME. */
  dismissedAt?: string;
  /** Why it was withdrawn, in a few words. */
  dismissedReason?: string;
  /** Set when the card closing withdrew it; shown in the owner's language. */
  dismissedBy?: 'card-closed';
  /** The agent whose work needs the answer, and which learns from it; "god"
   *  when Michael raised it himself. */
  raisedBy?: string;
}

export interface HiveTask {
  id: string;
  title: string;
  description?: string;
  /** When a To do card's one off next step is due (ISO). Cards carry no running
   *  notes: each agent's conversation and the office log keep its activity
   *  (owner, 2026-10-11). */
  nextAt?: string;
  assignee?: string;
  status: 'todo' | 'doing' | 'waiting' | 'blocked' | 'done';
  /** Who a Waiting card waits on, in a few words (Michael writes it). */
  waitingOn?: string;
  dependsOn: string[];
  priority: number;
  createdAt: string;
  /** First-class human feedback: the god appends {q} when a card needs the
   *  human; the ASK ME view fills in {a}. Full history stays on the card. */
  humanQA?: HumanQA[];
  /** Done by the owner's decision rather than finished work (card-lifecycle.md
   *  D2): shown as "Closed by owner". */
  closedBy?: 'owner';
  closedReason?: string;
  /** What came of the card, in Michael's words: he writes it when he marks the
   *  card Done (issue 51). Shown on the card, never checked or invented. */
  result?: string;
}

/** The card's open questions for the human, oldest first: every ask with no
 *  answer and no withdrawal (dismissedAt), whatever the card's status
 *  (askMeRouting.ts openAskIndexes, owner 2026-10-04). */
export function openQuestions(t: HiveTask): HumanQA[] {
  return openAskIndexes(t.humanQA).map((i) => t.humanQA![i]);
}

/** The card's newest open question, if any. */
export function openQuestion(t: HiveTask): HumanQA | undefined {
  const open = openQuestions(t);
  return open[open.length - 1];
}

/** Waiting on the human = a question on the card still open. The card's status
 *  never hides it: a question leaves only when answered or withdrawn. */
export function waitsOnHuman(t: HiveTask): boolean {
  return openQuestions(t).length > 0;
}

export type TaskStatus = HiveTask['status'];

/** Deterministic fallback id derived from a task's content (djb2 → base36).
 *  Used for tasks lacking a valid string id so re-parsing tasks.json on every
 *  5s poll yields the SAME id — no React key churn / card remount. Unlike
 *  shortId() (random, for brand-new tasks), this never changes across polls. */
function stableId(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (((h << 5) + h) ^ seed.charCodeAt(i)) | 0;
  return `t-${(h >>> 0).toString(36)}`;
}

/** Normalize whatever hive:tasks returns into a typed task array. The god
 *  writes this file by hand — every field except the shape itself is optional
 *  in practice, so EVERY consumer must go through this (exported for the
 *  detail overlay; a raw card without dependsOn once crashed it). */
export function parseTasks(raw: unknown): HiveTask[] {
  const list = (raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks))
    ? (raw as { tasks: unknown[] }).tasks
    : [];
  return list
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t, i) => ({
      id: typeof t.id === 'string' && t.id
        ? t.id
        : stableId(`${typeof t.title === 'string' ? t.title : ''}|${typeof t.createdAt === 'string' ? t.createdAt : ''}|${i}`),
      title: typeof t.title === 'string' ? t.title : '(untitled)',
      // The app writes "description" (a Slack or webhook request). Agents' old
      // running "notes" are left in the file but not read: an agent's activity
      // lives in its conversation and the office log (owner, 2026-10-11).
      description: typeof t.description === 'string' ? t.description : undefined,
      nextAt: isNextAt(t.nextAt) ? t.nextAt : undefined,
      assignee: typeof t.assignee === 'string' ? t.assignee : undefined,
      status: (['todo', 'doing', 'waiting', 'blocked', 'done'] as const).includes(t.status as TaskStatus)
        ? (t.status as TaskStatus) : 'todo',
      waitingOn: typeof t.waitingOn === 'string' && t.waitingOn.trim() ? t.waitingOn.trim() : undefined,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter((d): d is string => typeof d === 'string') : [],
      priority: typeof t.priority === 'number' ? t.priority : 3,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
      humanQA: Array.isArray(t.humanQA)
        ? (t.humanQA as unknown[])
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as { q?: unknown }).q === 'string')
          // Every field an entry carries survives the parse (raisedBy routes the
          // answer; Slack options and thread ids ride along). An answer writes
          // these entries back, so a field dropped here was erased from disk
          // (found 2026-10-02).
          .map((e) => ({
            ...e,
            q: e.q as string,
            a: typeof e.a === 'string' ? e.a : undefined,
            askedAt: typeof e.askedAt === 'string' ? e.askedAt : undefined,
            answeredAt: typeof e.answeredAt === 'string' ? e.answeredAt : undefined,
            // Preserve a dismissal across the 5s re-parse, else the card would
            // resurface on the next poll (openQuestion would see it as open).
            dismissedAt: typeof e.dismissedAt === 'string' ? e.dismissedAt : undefined,
            dismissedReason: typeof e.dismissedReason === 'string' ? e.dismissedReason : undefined,
            dismissedBy: e.dismissedBy === 'card-closed' ? 'card-closed' as const : undefined,
            raisedBy: typeof e.raisedBy === 'string' ? e.raisedBy : undefined
          }))
        : undefined,
      closedBy: t.closedBy === 'owner' ? 'owner' as const : undefined,
      closedReason: typeof t.closedReason === 'string' ? t.closedReason : undefined,
      result: typeof t.result === 'string' && t.result.trim() ? t.result : undefined
    }));
}

/** House rule 8 asks for an ISO date and time with its offset (isNextAt).
 *  Anything looser is not shown and wakes nobody: "Mon 12 Oct 13:00" parses as
 *  a 2001 date, and a bare date reads as midnight UTC, the evening before west
 *  of it. */
const nextAtFormats = new Map<string, Intl.DateTimeFormat>();

/** A card's next step time in the viewer's local time and the app's language,
 *  like "Mon, 12 Oct, 8:00 AM". */
export function nextAtLabel(nextAt: string | undefined, lang?: string): string | undefined {
  if (!isNextAt(nextAt)) return undefined;
  const key = lang ?? '';
  let f = nextAtFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(lang || undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    nextAtFormats.set(key, f);
  }
  return f.format(new Date(nextAt));
}

/** The first line of a Done card's result, as plain text for the board: its
 *  markdown heading, bullet, emphasis and code marks taken off. Empty when the
 *  card has no result. */
export function resultHeadline(result: string | undefined): string {
  const line = (result ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, '$2')
    .trim();
}
