/**
 * Which Pulse tiles show and which fold into quiet chips (owner, 2026-10-19:
 * "the cards should be dynamic and be visible when they really have any data";
 * docs/designs/pulse-smart-view.md, design 1A, 1B, 1E and eng D2).
 *
 *   tile ─ Spent ─────────────────────────────────────► shown (always, 1B)
 *        ─ something happened now ──────────────────────► shown
 *        ─ Compare on, something in the span before, and
 *          the figures its bars draw differ ────────────► shown
 *          (owner, 2026-10-20: "cards should show when there is some change")
 *        ─ opened from its chip this visit ─────────────► shown
 *        ─ otherwise ───────────────────────────────────► quiet (a chip)
 *
 * "Something happened" is the tile's big number above zero, except where a
 * tile carries two numbers (eng D2): web answers count every answer checked,
 * Questions to you counts the questions, and Your time counts the questions or
 * any work done while the owner was away.
 *
 * No electron, node or React imports: the renderer and the tests share it.
 */
import type { PulseSnapshot } from './teamPerformance';
import { REFUSAL_GATES, type KeptSafe, type RefusalGate } from './pulseSafety';
import type { LearningSpan } from './teamLearning';

/** Every top tile, in the order the grid and the chip row use (design 1E). */
export const PULSE_TILES = ['email', 'sent', 'task', 'check', 'toInternet', 'webAnswers', 'held', 'rules', 'learned', 'questions', 'spent', 'yourTime'] as const;
export type PulseTile = (typeof PULSE_TILES)[number];

/** One span's figures: the period, or the span before with Compare. */
export interface TileSpan {
  snapshot: Pick<PulseSnapshot, 'outcomes' | 'yourTime' | 'awayShare'>;
  keptSafe: KeptSafe;
  learning: LearningSpan | null;
}

/** How much happened in one tile over one span. */
export function tileActivity(id: PulseTile, span: TileSpan): number {
  const s = span.snapshot;
  const k = span.keptSafe;
  const l = span.learning;
  switch (id) {
    case 'email':
    case 'sent':
    case 'task':
    case 'check':
      return s.outcomes.find((o) => o.kind === id)?.total ?? 0;
    case 'toInternet': return k.toInternet.pass + k.toInternet.clean + k.toInternet.stop;
    case 'webAnswers': return k.webAnswers.pass + k.webAnswers.clean;
    case 'held': return k.held;
    // Only the gates the view can name, as its tile counts them.
    case 'rules': return (Object.entries(k.rules) as Array<[RefusalGate, number]>).filter(([g]) => REFUSAL_GATES.includes(g)).reduce((n, [, x]) => n + (Number(x) || 0), 0);
    case 'learned': return l ? l.added.you + l.added.job + l.added.michael : 0;
    case 'questions': return l ? l.asks : 0;
    case 'spent': return 1;
    case 'yourTime': return s.yourTime.asks + (s.awayShare !== null && s.awayShare > 0 ? 1 : 0);
  }
}

/** What a tile's Compare bars draw over one span, as a key two spans compare
 *  by: for most tiles the same as its activity; Web answers draws the cleaned
 *  answers, Questions to you its rate, Learned its three kinds, and Your time
 *  the questions and the away share. */
export function tileFigure(id: PulseTile, span: TileSpan): string {
  const l = span.learning;
  switch (id) {
    case 'webAnswers': return String(span.keptSafe.webAnswers.clean);
    case 'questions': return String(l?.per100 ?? null);
    case 'learned': return l ? `${l.added.you}|${l.added.job}|${l.added.michael}` : '0|0|0';
    case 'yourTime': return `${span.snapshot.yourTime.asks}|${span.snapshot.awayShare ?? null}`;
    default: return String(tileActivity(id, span));
  }
}

/** The tiles the grid shows and the ones that fold into chips, both in grid order. */
export function pulseTiles(now: TileSpan, before: TileSpan | null, opened: ReadonlySet<string>): { shown: PulseTile[]; quiet: PulseTile[] } {
  const shown: PulseTile[] = [];
  const quiet: PulseTile[] = [];
  for (const id of PULSE_TILES) {
    // The span before keeps a quiet tile only when its bars would show a change.
    const changed = before !== null && tileActivity(id, before) > 0 && tileFigure(id, before) !== tileFigure(id, now);
    const has = tileActivity(id, now) > 0 || changed || opened.has(id);
    (has ? shown : quiet).push(id);
  }
  return { shown, quiet };
}
