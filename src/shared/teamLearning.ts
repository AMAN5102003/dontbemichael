/**
 * Pulse's Learning row (owner, 2026-10-15, proposal 3): is the team learning
 * and leaning on the owner less? New notes come from the app's own record of
 * each note added to a member's memory index (`note-added`, owner 2026-10-18:
 * an edit or a repeat is not a new note, and no agent can change its count).
 * Days up to the first such record count by each note's date, which is the
 * day it was written or last updated (shared/memoryIndex.ts). Questions come
 * from the asks the team brought the owner against the requests it took.
 *
 * No electron or node imports: main and the renderer share it, tests load it.
 */
import { dayKey, type AskFact, type DayRange } from './teamPerformance';

/** One memory note, as the index line carries it. */
export interface NoteFact { agentId: string; source: string; date: string; id?: string; text?: string }

/** One `note-added` record: a note new to a member's index. */
export interface AddedNote { agentId: string; id: string; source: string; at: number }

/** A new note as the Learning list shows it. `text` is null once the note is
 *  gone from the member's memory (deleted, or its id given to a later note). */
export interface LearnedNote { agentId: string; id: string; from: NoteFrom; day: string; at: number | null; text: string | null }

/** The first day counted from add records: the day after the first one, so
 *  the day the record began still counts by note date, as before, and no note
 *  added that day before the update is lost. Null: no record yet. */
export function countFromDay(firstAddedAt: number | null): string | null {
  if (firstAddedAt === null) return null;
  const d = new Date(firstAddedAt);
  d.setDate(d.getDate() + 1);
  return dayKey(d.getTime());
}

const FROM_ORDER: NoteFrom[] = ['you', 'job', 'michael'];

/** The new notes in a span, grouped as the legend (from you, on the job, from
 *  Michael), newest first in each. The count and the list are one rule. */
export function learnedNotes(input: { notes: NoteFact[]; added?: AddedNote[]; countFrom?: string | null }, range: DayRange): LearnedNote[] {
  const countFrom = input.countFrom ?? null;
  const out: LearnedNote[] = [];
  for (const n of input.notes) {
    if (n.date < range.from || n.date > range.to || (countFrom !== null && n.date >= countFrom)) continue;
    out.push({ agentId: n.agentId, id: n.id ?? '', from: noteFrom(n.source), day: n.date, at: null, text: n.text ?? null });
  }
  if (countFrom !== null) {
    const key = (agentId: string, id: string): string => `${agentId}\t${id}`;
    const latest = new Map<string, number>();
    for (const a of input.added ?? []) latest.set(key(a.agentId, a.id), Math.max(latest.get(key(a.agentId, a.id)) ?? 0, a.at));
    const text = new Map<string, string>();
    for (const n of input.notes) if (n.id) text.set(key(n.agentId, n.id), n.text ?? '');
    for (const a of input.added ?? []) {
      const day = dayKey(a.at);
      if (day < range.from || day > range.to || day < countFrom) continue;
      const k = key(a.agentId, a.id);
      const current = latest.get(k) === a.at && text.has(k) ? text.get(k)! : null;
      out.push({ agentId: a.agentId, id: a.id, from: noteFrom(a.source), day, at: a.at, text: current });
    }
  }
  const order = (x: LearnedNote): number => x.at ?? new Date(`${x.day}T12:00:00`).getTime();
  return out.sort((a, b) => FROM_ORDER.indexOf(a.from) - FROM_ORDER.indexOf(b.from) || order(b) - order(a));
}

/** Where a note came from, as Pulse groups it. */
export type NoteFrom = 'you' | 'job' | 'michael';
export const noteFrom = (source: string): NoteFrom => (source === 'owner' ? 'you' : source === 'michael' ? 'michael' : 'job');

/** What the team learned and asked in one span of days. */
export interface LearningSpan {
  /** New notes in the span, by where they came from. */
  added: Record<NoteFrom, number>;
  asks: number;
  turns: number;
  /** Questions to the owner per 100 requests, once the span has enough requests. */
  per100: number | null;
}

export interface Learning {
  /** The period's figures (owner, 2026-10-15: Learning follows the period). */
  period: LearningSpan;
  /** The span before, when Compare is on and ready (owner, 2026-10-16). */
  previous: LearningSpan | null;
  /** Notes the team holds now. */
  notes: number;
  /** Written ways of working (procedure files). */
  procedures: number;
  /** Notes plus procedures, per member. */
  knows: Record<string, number>;
}

/** A span needs this many requests before its rate is shown: fewer is noise. */
export const MIN_TURNS_FOR_RATE = 20;

/** One span's notes added, asks, requests and rate. */
export function learningSpan(input: { notes: NoteFact[]; added?: AddedNote[]; countFrom?: string | null; asks: AskFact[]; turns: Array<{ day: string; turns: number }> }, range: DayRange): LearningSpan {
  const added: Record<NoteFrom, number> = { you: 0, job: 0, michael: 0 };
  for (const n of learnedNotes(input, range)) added[n.from]++;
  const asks = input.asks.filter((a) => a.askedAt >= range.fromMs && a.askedAt <= range.toMs).length;
  const turns = input.turns.filter((d) => d.day >= range.from && d.day <= range.to).reduce((sum, d) => sum + d.turns, 0);
  return { added, asks, turns, per100: turns >= MIN_TURNS_FOR_RATE ? Math.round((asks / turns) * 1000) / 10 : null };
}

/** Learning for the period and, with Compare, the span before; plus what the
 *  team holds in all. */
export function learning(input: {
  notes: NoteFact[];
  /** `note-added` records from the earlier span's first day on. */
  added?: AddedNote[];
  /** countFromDay of the office's first `note-added` record. */
  countFrom?: string | null;
  procedures: Record<string, number>;
  asks: AskFact[];
  /** Requests each day, from the processor's daily turns. */
  turns: Array<{ day: string; turns: number }>;
  range: DayRange;
  previous?: DayRange | null;
}): Learning {
  const knows: Record<string, number> = {};
  for (const n of input.notes) knows[n.agentId] = (knows[n.agentId] ?? 0) + 1;
  for (const [id, p] of Object.entries(input.procedures)) knows[id] = (knows[id] ?? 0) + p;
  return {
    period: learningSpan(input, input.range),
    previous: input.previous ? learningSpan(input, input.previous) : null,
    notes: input.notes.length,
    procedures: Object.values(input.procedures).reduce((s, n) => s + n, 0),
    knows
  };
}
