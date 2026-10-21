/**
 * Closing-time values shared by main (src/main/closingTime.ts) and the quit
 * dialog, so the two cannot drift apart.
 */

/** One Remind per agent per this long; the dialog shows "reminded" as long. */
export const CLOSING_TIME_REMIND_MS = 30_000;

/** A team member's closing time acknowledgement, in any spelling closing time
 *  accepts: agents write it by hand, so "Closing Time Ack" counts as well as
 *  the canonical CLOSING-TIME-ACK the brief asks for. */
export const CLOSING_ACK_RE = /CLOSING[-_\s]*TIME[-_\s]*ACK/i;

/** Michael's closing time complete message, in any spelling closing time accepts. */
export const CLOSING_COMPLETE_RE = /CLOSING[-_\s]*TIME[-_\s]*COMPLETE/i;
