/**
 * The cost running total rule, shared by the lifetime ledger fold
 * (`src/main/costLifetime.ts`) and the telemetry processor.
 *
 * A cost sample is a running total per (agent, session) that only climbs, and
 * restarts near zero when the app restarts under the same session. So a drop
 * is a restart and nothing else: the new value counts whole. Any drop counts,
 * with only a float noise allowance (see costLifetime.ts for why there is no
 * dollar threshold).
 *
 * No electron or node imports: main and tests load it directly.
 */

/** Float noise guard: real restarts drop by cents at least. */
export const COST_EPS = 1e-9;

/** Whether `next` after `prev` is a restart of the running total. */
export function isCostReset(prev: number, next: number): boolean {
  return next < prev - COST_EPS;
}

/** How much a running total grew from `prev` to `next`: the difference, or
 *  all of `next` after a restart (or for the first sample). Never negative. */
export function costIncrement(prev: number | undefined, next: number): number {
  if (!Number.isFinite(next) || next <= 0) return 0;
  if (prev === undefined || isCostReset(prev, next)) return next;
  return Math.max(0, next - prev);
}

/** Running totals per key (agent and session), turned into increments. */
export class CostFold {
  private readonly last = new Map<string, number>();

  /** The increment for one sample, remembering it as the new last value. */
  add(key: string, value: number): number {
    const inc = costIncrement(this.last.get(key), value);
    if (Number.isFinite(value) && value >= 0) this.last.set(key, value);
    return inc;
  }

  /** The last value seen for a key (for saving the fold between runs). */
  lastFor(key: string): number | undefined {
    return this.last.get(key);
  }

  /** Restore a saved last value. */
  seed(key: string, value: number): void {
    if (Number.isFinite(value) && value >= 0) this.last.set(key, value);
  }
}
