/**
 * The office break (issue 124). On a smaller Claude plan the team reaches its
 * usage limit during the day. Claude Code says so with a StopFailure hook whose
 * `error` is `rate_limit`, and its status line carries when each limit window
 * resets (`rate_limits.<window>.resets_at`, epoch seconds). This class turns
 * those signals into one office state:
 *
 *  - waiting: the limit is reached. Nothing types into a Claude terminal.
 *    Schedules still run as configured: their jobs wait in the inboxes.
 *  - checking: the reset time has passed (a minute later, so Claude Code's own
 *    automatic continue goes first). Delivery opens again and Michael is told,
 *    so one turn can show whether work can start.
 *  - over: a Claude turn finished that was asked for after the limit was
 *    reached (while checking, any finished turn). Team members who were cut
 *    off are told to carry on, and the waiting inbox mail is delivered as usual.
 *
 * A limit hit while checking goes back to waiting. With no reset time known,
 * the app checks again every RETRY_MS. The state is saved, so a restart during
 * a break still shows it. Pure apart from the injected clock and storage.
 */
import type { OfficeBreakView } from '../shared/officeBreak';

/** Wait after the reset before checking, so Claude Code's own continue (when
 *  the owner turned it on) runs first and is not doubled. */
export const RESET_GRACE_MS = 60_000;
/** How often to check again when the reset time is unknown. */
export const RETRY_MS = 15 * 60_000;
/** A check that hears nothing (no turn finished, no limit hit) ends the break:
 *  there is no sign the limit is still on. */
export const CHECK_TIMEOUT_MS = 10 * 60_000;

export interface OfficeBreakState {
  phase: 'waiting' | 'checking';
  since: number;
  /** When the limit resets, or null when unknown. */
  until: number | null;
  /** When the next step runs: the check, or the end of a check. */
  due: number;
  /** Claude team members whose turn the limit cut off. */
  cutOff: string[];
  /** Claude agents given a prompt since the limit was reached: a turn of
   *  theirs that finishes shows the plan answers. Any other turn that finishes
   *  while waiting was already on its way and ends nothing. */
  prompted: string[];
}

type Window = { used_percentage?: unknown; resets_at?: unknown };

/** When the reached limit resets, in ms, from a status line `rate_limits`
 *  object, or null. The status line is read after each reply, so the window
 *  that ran out can read a little under 100: the fullest window is the one
 *  that was reached, and on a tie the later reset. A wrong guess costs one
 *  check that finds the limit still on. */
export function resetFromRateLimits(rateLimits: unknown, now: number): number | null {
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  let best: { pct: number; at: number } | null = null;
  for (const w of Object.values(rateLimits as Record<string, Window>)) {
    if (!w || typeof w !== 'object') continue;
    const pct = typeof w.used_percentage === 'number' ? w.used_percentage : NaN;
    const at = typeof w.resets_at === 'number' ? w.resets_at * 1000 : NaN;
    if (!(pct >= 0) || !(at > now)) continue;
    if (!best || pct > best.pct || (pct === best.pct && at > best.at)) best = { pct, at };
  }
  return best ? best.at : null;
}

export interface OfficeBreakStore {
  load(): OfficeBreakState | null;
  save(state: OfficeBreakState | null): void;
}

export class OfficeBreak {
  /** Undefined until first read: the saved state is loaded on first use, after
   *  the store has opened. */
  private saved: OfficeBreakState | null | undefined;
  /** The newest reset time read from any Claude status line. */
  private lastReset: number | null = null;

  constructor(private store: OfficeBreakStore, private now: () => number = Date.now) {}

  private get state(): OfficeBreakState | null {
    if (this.saved === undefined) {
      let s: OfficeBreakState | null = null;
      try { s = this.store.load(); } catch { /* unreadable: no break */ }
      this.saved = s && (s.phase === 'waiting' || s.phase === 'checking') && typeof s.since === 'number' && typeof s.due === 'number'
        ? {
            ...s, until: typeof s.until === 'number' ? s.until : null,
            cutOff: Array.isArray(s.cutOff) ? s.cutOff : [],
            prompted: Array.isArray(s.prompted) ? s.prompted : []
          }
        : null;
    }
    return this.saved;
  }

  /** The view the owner sees, or null when the office is working. */
  view(): OfficeBreakView | null {
    return this.state ? { until: this.state.until, checking: this.state.phase === 'checking' } : null;
  }

  /** The full state, for the timer and for tests. */
  current(): OfficeBreakState | null {
    return this.state ? { ...this.state, cutOff: [...this.state.cutOff], prompted: [...this.state.prompted] } : null;
  }

  /** Whether Claude terminals are held right now (schedules never are). */
  holding(): boolean {
    return this.state?.phase === 'waiting';
  }

  /** A status line reading: remember when a full window resets. A break that
   *  started before any reading takes the time now, so it checks at the reset
   *  instead of the next retry. Returns true when the break changed. */
  noteRateLimits(rateLimits: unknown): boolean {
    const at = resetFromRateLimits(rateLimits, this.now());
    if (at === null) return false;
    this.lastReset = at;
    const s = this.state;
    if (!s || s.phase !== 'waiting' || s.until !== null) return false;
    this.set({ ...s, until: at, due: at + RESET_GRACE_MS });
    return true;
  }

  /** A Claude turn ended on the usage limit. Returns 'started' for a new
   *  break, 'again' when a check found the limit still on, else 'held'. */
  limitReached(agentId: string): 'started' | 'again' | 'held' {
    const now = this.now();
    const until = this.lastReset !== null && this.lastReset > now ? this.lastReset : null;
    const due = until !== null ? until + RESET_GRACE_MS : now + RETRY_MS;
    const prev = this.state;
    const cutOff = prev ? (prev.cutOff.includes(agentId) ? prev.cutOff : [...prev.cutOff, agentId]) : [agentId];
    if (!prev) {
      this.set({ phase: 'waiting', since: now, until, due, cutOff, prompted: [] });
      return 'started';
    }
    const again = prev.phase === 'checking';
    // While waiting, a later reset time moves the check; an earlier one never
    // pulls it in (another window may still be full).
    const nextUntil = again ? until : (until !== null && (prev.until === null || until > prev.until) ? until : prev.until);
    const nextDue = again ? due : (nextUntil !== null ? Math.max(prev.due, nextUntil + RESET_GRACE_MS) : prev.due);
    const prompted = prev.prompted.filter((id) => id !== agentId);
    this.set({ ...prev, phase: 'waiting', until: nextUntil, due: nextDue, cutOff, prompted });
    return again ? 'again' : 'held';
  }

  /** A Claude agent submitted a prompt: it is no longer cut off (Claude Code's
   *  own continue, or the owner typed), and its next finished turn shows the
   *  plan answers. The break itself goes on. */
  promptSubmitted(agentId: string): void {
    const s = this.state;
    if (!s || (!s.cutOff.includes(agentId) && s.prompted.includes(agentId))) return;
    this.set({
      ...s,
      cutOff: s.cutOff.filter((id) => id !== agentId),
      prompted: s.prompted.includes(agentId) ? s.prompted : [...s.prompted, agentId]
    });
  }

  /** A Claude turn finished, so the plan answers again: the break is over.
   *  While waiting, only a turn asked for after the limit counts: one already
   *  on its way when the limit was reached can still land. Returns the ended
   *  state, or null when there was no break or it goes on. */
  turnFinished(agentId: string): OfficeBreakState | null {
    const s = this.state;
    if (!s || (s.phase === 'waiting' && !s.prompted.includes(agentId))) return null;
    const ended = { ...s, cutOff: s.cutOff.filter((id) => id !== agentId) };
    this.set(null);
    return ended;
  }

  /** The timer ran out. Waiting moves to checking ('check'); a check that
   *  heard nothing ends the break ('over', with the ended state). */
  tick(): { step: 'check' } | { step: 'over'; ended: OfficeBreakState } | null {
    const s = this.state;
    if (!s || this.now() < s.due) return null;
    if (s.phase === 'waiting') {
      this.set({ ...s, phase: 'checking', due: this.now() + CHECK_TIMEOUT_MS });
      return { step: 'check' };
    }
    this.set(null);
    return { step: 'over', ended: s };
  }

  private set(next: OfficeBreakState | null): void {
    this.saved = next;
    try { this.store.save(next); } catch { /* the break still runs this session */ }
  }
}
