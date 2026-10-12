/**
 * The office break (issue 124): what the owner sees while the Claude plan has
 * reached its usage limit. Main keeps the state (src/main/officeBreak.ts); the
 * renderer only shows this view.
 *
 * `until` is when the limit resets, or null when Claude Code did not say.
 * `checking` means the reset time has passed and the app is waiting for the
 * first finished turn to confirm work can start again: delivery is open then,
 * so that turn can happen.
 */
export interface OfficeBreakView {
  until: number | null;
  checking: boolean;
}

/** Whether a team member on this engine is held by the break. Only Claude
 *  agents run on the Claude plan; another engine keeps working. */
export function heldByBreak(view: OfficeBreakView | null | undefined, provider: string | undefined): boolean {
  return !!view && !view.checking && (provider ?? 'claude') === 'claude';
}
