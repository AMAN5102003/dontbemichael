/**
 * Pulse's Learning row (owner, 2026-10-15, proposal 3): is the team learning
 * and leaning on the owner less? Read from each member's memory index, where
 * every note carries the day it was written or last updated and where it came
 * from (shared/memoryIndex.ts), and from the questions the team brought the
 * owner against the requests it took.
 *
 * No electron or node imports: main and the renderer share it, tests load it.
 */
import type { AskFact, DayRange } from './teamPerformance';

/** One memory note, as the index line carries it. */
export interface NoteFact { agentId: string; source: string; date: string }

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
export function learningSpan(input: { notes: NoteFact[]; asks: AskFact[]; turns: Array<{ day: string; turns: number }> }, range: DayRange): LearningSpan {
  const added: Record<NoteFrom, number> = { you: 0, job: 0, michael: 0 };
  for (const n of input.notes) if (n.date >= range.from && n.date <= range.to) added[noteFrom(n.source)]++;
  const asks = input.asks.filter((a) => a.askedAt >= range.fromMs && a.askedAt <= range.toMs).length;
  const turns = input.turns.filter((d) => d.day >= range.from && d.day <= range.to).reduce((sum, d) => sum + d.turns, 0);
  return { added, asks, turns, per100: turns >= MIN_TURNS_FOR_RATE ? Math.round((asks / turns) * 1000) / 10 : null };
}

/** Learning for the period and, with Compare, the span before; plus what the
 *  team holds in all. */
export function learning(input: {
  notes: NoteFact[];
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
