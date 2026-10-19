/**
 * Leaving Edit agent with unsaved changes (wide panel WD4 and its eng review):
 * every store action that changes the panel (select, setRightColumn,
 * openNeedsYou, openAgentProfile, openAgentMemory, requestCommandCenterTab)
 * asks here first. While Edit has changes and the change would take its panel
 * away, nothing applies: the change waits, Edit asks "Discard changes?", and
 * every later change waits behind it in order, so a click that makes two calls
 * (a person, then a tab) is never half done. Discard runs them all in order;
 * Keep editing drops them all. A focus handoff joins the line with `afterLeave`,
 * so focus moves only once its change has really happened.
 *
 * Plain TypeScript with no store import, so the tests can run it.
 */

export interface LeaveTarget {
  selectedId: string | null;
  rightColumn: 'closed' | 'board' | 'person';
}

export interface LeaveGuard {
  /** True when this change would lose unsaved changes, so it must wait. */
  holds: (next: LeaveTarget) => boolean;
  /** Show the question; the answer comes back through answerLeave. */
  ask: () => void;
}

let guard: LeaveGuard | null = null;
let waiting: Array<() => void> = [];

/** Edit sets its guard while it is open; the returned function takes it away
 *  (only if it is still the one set). Taking it away runs whatever waited,
 *  since nothing is left to lose. */
export function setLeaveGuard(next: LeaveGuard): () => void {
  guard = next;
  return () => {
    if (guard !== next) return;
    guard = null;
    flush();
  };
}

/** Run `apply` now, or hold it until the owner answers. `next` is where the
 *  panel would go; null means the change does not move it. True when applied. */
export function attemptLeave(next: LeaveTarget | null, apply: () => void): boolean {
  if (waiting.length) { waiting.push(apply); return false; }
  if (!guard || !next || !guard.holds(next)) { apply(); return true; }
  waiting.push(apply);
  guard.ask();
  return false;
}

/** Run `fn` after the changes waiting now, or at once when none wait. */
export function afterLeave(fn: () => void): void {
  if (waiting.length) waiting.push(fn);
  else fn();
}

/** The owner's answer: Discard runs every waiting change in order, Keep
 *  editing drops them. */
export function answerLeave(discard: boolean): void {
  if (!discard) { waiting = []; return; }
  guard = null;
  flush();
}

/** True while a change waits on the question. */
export function leaveWaiting(): boolean {
  return waiting.length > 0;
}

function flush(): void {
  const run = waiting;
  waiting = [];
  for (const fn of run) fn();
}
