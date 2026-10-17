/**
 * Pulse's health readout (docs/designs/team-performance.md, Section 8; TODOS.md T9):
 * when a Pulse number looks wrong, it shows whether points stopped flowing,
 * writes failed or hook frames were refused. Main notes each point that
 * arrives and each processor batch; `telemetry:health` reads the result.
 *
 * Stalled: an office's points have waited 5 minutes and no batch read them.
 * That is warned once, and again only after a batch and a new stall. The view
 * keeps the numbers of the last batch meanwhile.
 *
 * No electron or node imports, so tests load it.
 */

/** Points left unread this long mean the processor is stalled. */
export const STALL_AFTER_MS = 5 * 60_000;

/** A processor pass that read something. */
export interface PulseBatch { at: number; events: number; ms: number }

export interface PulseHealthView {
  /** The last batch, and the average points a batch read since the app started. */
  lastBatch: PulseBatch | null;
  eventsPerBatch: number;
  /** When a point last arrived. */
  lastPointAt: number | null;
  /** Records that could not be saved, by day (D15). */
  failedWrites: Record<string, number>;
  /** Hook frames refused for a missing or wrong secret, by the member they named (#61). */
  refusedFrames: Record<string, number>;
  stalled: boolean;
}

export class PulseHealth {
  private last: PulseBatch | null = null;
  private batches = 0;
  private events = 0;
  private lastPoint: number | null = null;
  /** The office whose points wait for a batch, and since when. */
  private waiting: { office: string; since: number } | null = null;
  private warned = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** A point arrived for an office. */
  point(office: string): void {
    const at = this.now();
    this.lastPoint = at;
    // A new office's points start their own wait: the ones left in the last
    // office are read when it is open again.
    if (this.waiting?.office !== office) this.waiting = { office, since: at };
  }

  /** A processor pass read `events` points in `ms`. Returns its log line, or
   *  null when it read nothing, so an idle office logs nothing. */
  batch(events: number, ms: number): string | null {
    if (events <= 0) return null;
    this.last = { at: this.now(), events, ms };
    this.batches++;
    this.events += events;
    this.waiting = null;
    this.warned = false;
    return `[pulse] batch: ${events} points in ${ms} ms`;
  }

  stalled(office: string | null): boolean {
    return !!office && this.waiting?.office === office && this.now() - this.waiting.since >= STALL_AFTER_MS;
  }

  /** The warning the first time the processor is seen stalled, else null. */
  stallWarning(office: string | null): string | null {
    if (this.warned || !this.waiting || !this.stalled(office)) return null;
    this.warned = true;
    const mins = Math.round((this.now() - this.waiting.since) / 60_000);
    const as = this.last ? new Date(this.last.at).toISOString() : 'none yet';
    return `[pulse] processor stalled: points have waited ${mins} min unread; Pulse shows the last batch (${as})`;
  }

  view(office: string | null, failedWrites: Record<string, number>, refused: ReadonlyMap<string, number>): PulseHealthView {
    return {
      lastBatch: this.last ? { ...this.last } : null,
      eventsPerBatch: this.batches ? Math.round(this.events / this.batches) : 0,
      lastPointAt: this.lastPoint,
      failedWrites,
      refusedFrames: Object.fromEntries(refused),
      stalled: this.stalled(office)
    };
  }
}
