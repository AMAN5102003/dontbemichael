/**
 * Confirm that a line typed into an agent's terminal was actually submitted
 * (2026-10-03). Text and its Enter go as two writes 140 ms apart so the TUI
 * reads the Enter as a keystroke, not as part of a paste. That gap only holds
 * while the agent reads its input promptly: Oscar, just resumed on a 174k
 * conversation, read three nudges and their Enters as bursts, so the first
 * Enter became a line break in his input box, the second vanished, and he sat
 * on closing time until a third arrived. Nothing noticed, because nothing
 * checked.
 *
 * Claude Code fires UserPromptSubmit for every prompt it accepts, so the
 * typing side waits for it and presses Enter again when it does not come. An
 * extra Enter on an empty prompt does nothing, so a slow confirmation costs
 * nothing; a missed one now submits what was typed.
 */

/** How long to wait for the agent to accept the prompt before pressing Enter again. */
export const SUBMIT_CONFIRM_MS = 3000;
/** Extra Enters before giving up (the text then stays on the prompt, as before). */
export const SUBMIT_RETRIES = 2;
const POLL_MS = 100;

/** When each agent last accepted a prompt (its UserPromptSubmit hook), and
 *  when it last asked for attention (a Notification hook: a permission prompt
 *  or a question), when no extra Enter may be pressed. */
export class PromptSubmits {
  private last = new Map<string, number>();
  private attention = new Map<string, number>();
  note(agentId: string, at = Date.now()): void { this.last.set(agentId, at); }
  since(agentId: string, at: number): boolean { const t = this.last.get(agentId); return t !== undefined && t >= at; }
  noteAttention(agentId: string, at = Date.now()): void { this.attention.set(agentId, at); }
  attentionSince(agentId: string, at: number): boolean { const t = this.attention.get(agentId); return t !== undefined && t >= at; }
}

/**
 * After the first Enter: wait for `accepted()`, pressing Enter again up to
 * `retries` times. Resolves whether the prompt was accepted.
 */
export async function confirmSubmit(opts: {
  accepted: () => boolean;
  pressEnter: () => unknown | Promise<unknown>;
  /** Checked before each extra Enter: false (someone started typing, a menu or
   *  permission prompt opened) stops the retries, so a blind Enter never
   *  submits the owner's text or picks a default. */
  stillSafe?: () => boolean;
  confirmMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const confirmMs = opts.confirmMs ?? SUBMIT_CONFIRM_MS;
  for (let attempt = 0; attempt <= (opts.retries ?? SUBMIT_RETRIES); attempt++) {
    if (attempt > 0) {
      if (opts.accepted()) return true;
      if (opts.stillSafe && !opts.stillSafe()) return opts.accepted();
      await opts.pressEnter();
    }
    for (let waited = 0; waited < confirmMs; waited += POLL_MS) {
      if (opts.accepted()) return true;
      await sleep(POLL_MS);
    }
  }
  return opts.accepted();
}
