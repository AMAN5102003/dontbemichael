/**
 * Pulse's Learning row (owner, 2026-10-15, proposal 3): is the team learning
 * and leaning on the owner less? Read from each member's memory index, where
 * every note carries the day it was written or last updated and where it came
 * from (shared/memoryIndex.ts), and from the questions the team brought the
 * owner against the requests it took.
 *
 * No electron or node imports: main and the renderer share it, tests load it.
 */
import { dayKey, type AskFact } from './teamPerformance';

/** One memory note, as the index line carries it. */
export interface NoteFact { agentId: string; source: string; date: string }

/** Where a note came from, as Pulse groups it. */
export type NoteFrom = 'you' | 'job' | 'michael';
export const noteFrom = (source: string): NoteFrom => (source === 'owner' ? 'you' : source === 'michael' ? 'michael' : 'job');

export interface LearningWeek {
  /** The Monday the week starts, YYYY-MM-DD. */
  from: string;
  added: Record<NoteFrom, number>;
  /** Notes known by the end of the week. */
  total: number;
  asks: number;
  turns: number;
  /** Questions to the owner per 100 requests, once the week has enough requests. */
  per100: number | null;
}

export interface Learning {
  weeks: LearningWeek[];
  /** Notes the team holds now. */
  notes: number;
  /** Written ways of working (procedure files). */
  procedures: number;
  /** Notes plus procedures, per member. */
  knows: Record<string, number>;
}

/** A week needs this many requests before its rate is shown: fewer is noise. */
export const MIN_TURNS_FOR_RATE = 20;

const mondayOf = (t: number): Date => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

/** The last `count` weeks, oldest first, ending with the week of `now`. */
export function learning(input: {
  now: number;
  notes: NoteFact[];
  procedures: Record<string, number>;
  asks: AskFact[];
  /** Requests each day, from the processor's daily turns. */
  turns: Array<{ day: string; turns: number }>;
  count?: number;
}): Learning {
  const count = input.count ?? 4;
  const thisMonday = mondayOf(input.now);
  const starts: Date[] = [];
  for (let i = count - 1; i >= 0; i--) { const d = new Date(thisMonday); d.setDate(d.getDate() - 7 * i); starts.push(d); }
  const weeks: LearningWeek[] = starts.map((s) => {
    const from = dayKey(s.getTime());
    const end = new Date(s); end.setDate(s.getDate() + 7);
    const to = dayKey(end.getTime());
    const added: Record<NoteFrom, number> = { you: 0, job: 0, michael: 0 };
    for (const n of input.notes) if (n.date >= from && n.date < to) added[noteFrom(n.source)]++;
    const total = input.notes.filter((n) => n.date < to).length;
    const asks = input.asks.filter((a) => a.askedAt >= s.getTime() && a.askedAt < end.getTime()).length;
    const turns = input.turns.filter((d) => d.day >= from && d.day < to).reduce((sum, d) => sum + d.turns, 0);
    return { from, added, total, asks, turns, per100: turns >= MIN_TURNS_FOR_RATE ? Math.round((asks / turns) * 1000) / 10 : null };
  });
  const knows: Record<string, number> = {};
  for (const n of input.notes) knows[n.agentId] = (knows[n.agentId] ?? 0) + 1;
  for (const [id, p] of Object.entries(input.procedures)) knows[id] = (knows[id] ?? 0) + p;
  return {
    weeks,
    notes: input.notes.length,
    procedures: Object.values(input.procedures).reduce((s, n) => s + n, 0),
    knows
  };
}
