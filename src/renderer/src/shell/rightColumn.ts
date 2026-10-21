/**
 * Small rules for the right column (docs/designs/needs-you-empty-state.md).
 * Plain TypeScript so the tests can run them.
 */
import { afterLeave } from '../store/leaveGuard';

/** The top bar pill's id, so closing the column can hand focus back (D10). */
export const NEEDS_YOU_PILL_ID = 'cth-needs-you-pill';

/** While anything waits on the owner the column stays open and cannot be
 *  closed; the office takes the window only when nothing at all waits (owner,
 *  2026-10-02, superseding D1, D6 and D7). */
export function columnLocked(status: 'unknown' | 'ready', count: number): boolean {
  return status === 'ready' && count > 0;
}

/** Where closing a person's or Michael's panel goes: back to the board while
 *  anything waits, otherwise the column closes. */
export function closeTarget(locked: boolean): 'board' | 'closed' {
  return locked ? 'board' : 'closed';
}

/** What Esc does to the column (eng R2): only with focus inside it, only when
 *  nothing else already took the key, never while asks wait, and a reply field
 *  holding text is left first, so a half written answer stays on screen. A
 *  wide panel goes back to the side before anything closes (wide panel WD13). */
export function columnEscAction(e: {
  key: string;
  defaultPrevented: boolean;
  inColumn: boolean;
  fieldHasText: boolean;
  locked: boolean;
  wide?: boolean;
}): 'none' | 'blur' | 'collapse' | 'close' {
  if (e.key !== 'Escape' || e.defaultPrevented || !e.inColumn) return 'none';
  if (e.fieldHasText) return 'blur';
  if (e.wide) return 'collapse';
  return e.locked ? 'none' : 'close';
}

/** Give focus back to the pill after the column closes, when it is a button.
 *  When the close waits on Edit agent's "Discard changes?", only after it. */
export function focusNeedsYouPill(): void {
  afterLeave(() => document.getElementById(NEEDS_YOU_PILL_ID)?.focus());
}
