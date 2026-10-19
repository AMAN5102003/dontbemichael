/**
 * The office break (issue 124) and the stops that share it
 * (docs/designs/office-stopped-account.md): what the owner sees while Claude
 * cannot work. Main keeps the state (src/main/officeBreak.ts); the renderer
 * only shows this view.
 *
 * `reason` is why: `limit` (the Claude plan reached its usage limit; it ends on
 * its own), `credit` (the Anthropic account is out of credit) or `signin` (the
 * login expired, or the API key stopped working). Credit and signin wait on
 * the owner.
 * `until` is when the limit resets, or null when Claude Code did not say (always
 * null for credit and signin).
 * `checking` means the app is waiting for the first finished turn to confirm
 * work can start again: delivery is open then, so that turn can happen.
 * `again` means a check found the same stop still on ("still out").
 */
/** Every stop reason, once: a saved stop is read back against this list. */
export const STOP_REASONS = ['limit', 'credit', 'signin'] as const;
export type OfficeStopReason = typeof STOP_REASONS[number];

export interface OfficeBreakView {
  until: number | null;
  checking: boolean;
  reason: OfficeStopReason;
  again: boolean;
}

/** The StopFailure errors that stop the office, as Claude Code names them. */
const STOP_ERRORS: Readonly<Record<string, OfficeStopReason>> = {
  rate_limit: 'limit',
  billing_error: 'credit',
  authentication_failed: 'signin'
};

/** The hook matcher: StopFailure matches on its `error`. */
export const STOP_FAILURE_MATCHER = Object.keys(STOP_ERRORS).join('|');

/** Why a StopFailure stops the office, or null for an error that ends one
 *  turn only (a server error, a prompt too long). */
export function stopReasonFor(error: unknown): OfficeStopReason | null {
  return typeof error === 'string' && Object.prototype.hasOwnProperty.call(STOP_ERRORS, error) ? STOP_ERRORS[error] : null;
}

/** A stop only the owner can fix: shown as a counted Needs you card. */
export function stopNeedsOwner(view: OfficeBreakView | null | undefined): boolean {
  return !!view && view.reason !== 'limit';
}

/** Whether a team member on this engine is held by the break. Only Claude
 *  agents run on the Claude plan; another engine keeps working. */
export function heldByBreak(view: OfficeBreakView | null | undefined, provider: string | undefined): boolean {
  return !!view && !view.checking && (provider ?? 'claude') === 'claude';
}
