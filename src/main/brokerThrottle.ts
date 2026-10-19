/**
 * Rate limits from connected apps (TODOS: "Third-party rate-limit backoff in
 * the broker"). When an app answers 429, or 503 with Retry-After, the broker
 * stops calling it until the app's time is up, instead of every agent retrying
 * blind and burning quota. A short wait is held in the broker; a long one is
 * answered at once with when to try again.
 *
 * No electron / node imports: tests load it directly.
 */

/** Longest a call is held in the broker for a throttled app. */
export const HOLD_MAX_MS = 20_000;
/** A 429 that does not say how long to wait. */
export const DEFAULT_BACKOFF_MS = 30_000;
/** The longest wait the broker takes from an app. Past it, calls go again and
 *  a fresh 429 starts a new wait. */
export const BACKOFF_CAP_MS = 15 * 60_000;

type HeaderSource = { get(name: string): string | null };

/** How long a 429 or 503 answer asks callers to wait, in ms, or undefined when
 *  it is not a rate limit. Reads Retry-After (seconds or a date), then the
 *  common reset headers (seconds left, or a Unix time). A 503 that names no
 *  time is an outage, not a limit. */
export function backoffMs(status: number, headers: HeaderSource, now: number): number | undefined {
  if (status !== 429 && status !== 503) return undefined;
  let ms: number | undefined;
  const retryAfter = headers.get('retry-after')?.trim();
  if (retryAfter) {
    if (/^\d+$/.test(retryAfter)) ms = Number(retryAfter) * 1000;
    else if (!Number.isNaN(Date.parse(retryAfter))) ms = Date.parse(retryAfter) - now;
  }
  if (ms === undefined) {
    const reset = (headers.get('ratelimit-reset') ?? headers.get('x-ratelimit-reset'))?.trim();
    if (reset && /^\d+$/.test(reset)) {
      const n = Number(reset);
      // A count of seconds, or a Unix time (GitHub style).
      ms = n > 1e9 ? n * 1000 - now : n * 1000;
    }
  }
  if (ms === undefined) return status === 429 ? DEFAULT_BACKOFF_MS : undefined;
  return Math.min(Math.max(ms, 1000), BACKOFF_CAP_MS);
}

/** When each connected app may be called again. */
export class ConnectionThrottle {
  private readonly until = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Note an app's answer: a rate limit pushes its next call back. */
  note(id: string, status: number, headers: HeaderSource): void {
    const now = this.now();
    const ms = backoffMs(status, headers, now);
    if (ms !== undefined) this.until.set(id, Math.max(this.until.get(id) ?? 0, now + ms));
  }

  /** How long a call to `id` must still wait, in ms; 0 when it may go. */
  waitFor(id: string): number {
    const at = this.until.get(id);
    if (at === undefined) return 0;
    const left = at - this.now();
    if (left > 0) return left;
    this.until.delete(id);
    return 0;
  }
}
