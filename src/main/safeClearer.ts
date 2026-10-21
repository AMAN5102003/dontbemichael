/**
 * SafeClearer: clears a team member's conversation only when it is worth it
 * and safe, after a handoff, and so it can be undone (owner, 2026-09-25; the
 * rules are in src/shared/safeClear.ts).
 *
 * Each beat (once a minute), per agent:
 *   idle      and clearBlocker() says nothing is in the way → ask for a handoff
 *   asked     new work arrived or it went on too long       → cancel
 *             spoken to after the handoff was written        → cancel
 *             handoff written after the ask, agent quiet     → type /clear
 * Nothing is typed while the agent waits on the owner at a prompt.
 * The conversation id before the clear is kept (memory/cleared.json) so the
 * owner can bring it back; the new conversation gets the handoff at session
 * start (hooks.ts). Nothing is typed into a busy terminal.
 *
 * No electron import: every side effect comes in through `deps`, so it tests
 * as a plain module.
 */
import { existsSync, statSync, rmSync } from 'node:fs';
import { classifyHook } from './workerWake';
import {
  CLEAR_IDLE_MS, HANDOFF_SETTLE_MS, HANDOFF_TIMEOUT_MS,
  clearBlocker, handoffRequest, type ClearFacts
} from '../shared/safeClear';

export interface SafeClearDeps {
  /** Every team member that has a live terminal. */
  agents(): Array<{ id: string; ptyId: string; facts: Omit<ClearFacts, 'idleMs'>; lastOutputAt: number }>;
  handoffPath(id: string): string;
  memoryInboxPath(id: string): string;
  lastSession(id: string): string | undefined;
  recordClear(id: string, state: { at: number; oldSession: string; tokensBefore: number }): void;
  /** Type text and submit it into a terminal. */
  type(ptyId: string, text: string): void;
  log(event: Record<string, unknown>): void;
  now?(): number;
}

type Phase = { kind: 'asked'; at: number };

export class SafeClearer {
  private phase = new Map<string, Phase>();
  /** Last hook event per agent, so a turn in progress counts as activity. */
  private lastHookAt = new Map<string, number>();
  /** When each agent last finished a turn (Stop hook). */
  private lastStopAt = new Map<string, number>();
  /** When each agent last got a prompt (UserPromptSubmit). */
  private lastPromptAt = new Map<string, number>();
  /** When each agent last asked for the owner (a permission or approval
   *  prompt), and when it last moved on from one. */
  private lastNeedsOwnerAt = new Map<string, number>();
  private lastMovedOnAt = new Map<string, number>();

  constructor(private deps: SafeClearDeps) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  /** Fed by the hook server for every event. `subagent` is true for a Task
   *  subagent's frame: it counts as activity, but its tool calls go on under an
   *  open prompt, so they never count as moving on. */
  noteHook(agentId: string | undefined, event: string, message?: string, subagent = false): void {
    if (!agentId) return;
    const t = this.now();
    this.lastHookAt.set(agentId, t);
    if (event === 'Stop') this.lastStopAt.set(agentId, t);
    if (event === 'UserPromptSubmit') this.lastPromptAt.set(agentId, t);
    const kind = classifyHook(event, message);
    if (kind === 'needsHuman') this.lastNeedsOwnerAt.set(agentId, t);
    // A new session means the prompt is gone too (a dismissed one ends the
    // turn with no Stop). An idle notice doesn't: Claude Code can send one
    // while a permission prompt is still open.
    else if (!subagent && (event === 'SessionStart' || event === 'PreToolUse' || event === 'PostToolUse' || event === 'UserPromptSubmit' || event === 'Stop')) {
      this.lastMovedOnAt.set(agentId, t);
    }
  }

  /** Waiting on the owner at a prompt: typing there could answer it (review,
   *  2026-09-25), so nothing is typed until the agent moves on. */
  private waitingOnOwner(id: string): boolean {
    return (this.lastNeedsOwnerAt.get(id) ?? 0) > (this.lastMovedOnAt.get(id) ?? 0);
  }

  beat(): void {
    const now = this.now();
    for (const a of this.deps.agents()) {
      const lastActive = Math.max(a.lastOutputAt, this.lastHookAt.get(a.id) ?? 0);
      const facts: ClearFacts = { ...a.facts, idleMs: now - lastActive };
      const phase = this.phase.get(a.id);

      if (this.waitingOnOwner(a.id)) {
        if (phase) this.cancel(a.id, 'waiting-for-owner');
        continue;
      }

      if (!phase) {
        if (clearBlocker(facts) !== null) continue;
        // Start clean: a handoff left from a cancelled attempt is stale.
        this.removeHandoff(a.id);
        this.deps.type(a.ptyId, handoffRequest(this.deps.handoffPath(a.id), this.deps.memoryInboxPath(a.id)));
        this.phase.set(a.id, { kind: 'asked', at: now });
        this.deps.log({ kind: 'clear-handoff-asked', agentId: a.id, tokens: facts.contextTokens });
        continue;
      }

      // Asked for a handoff. New work means the conversation is needed after all.
      const blocker = clearBlocker(facts, 0);
      if (blocker && blocker !== 'active') {
        this.cancel(a.id, blocker);
        continue;
      }
      if (now - phase.at > HANDOFF_TIMEOUT_MS) {
        this.cancel(a.id, 'no-handoff');
        continue;
      }
      const writtenAt = this.handoffWrittenAt(a.id, phase.at);
      if (writtenAt === null) continue;
      // Someone spoke to it after the handoff was written: that exchange isn't
      // in the handoff, so the conversation is kept (review, 2026-09-25).
      if ((this.lastPromptAt.get(a.id) ?? 0) > writtenAt) {
        this.cancel(a.id, 'new-prompt');
        continue;
      }
      const stopped = (this.lastStopAt.get(a.id) ?? 0) >= writtenAt;
      if (!stopped || facts.idleMs < HANDOFF_SETTLE_MS) continue;

      const oldSession = this.deps.lastSession(a.id);
      if (!oldSession) { this.cancel(a.id, 'no-session'); continue; }
      this.deps.recordClear(a.id, { at: now, oldSession, tokensBefore: facts.contextTokens });
      this.deps.type(a.ptyId, '/clear');
      this.phase.delete(a.id);
      this.deps.log({ kind: 'clear', agentId: a.id, tokensBefore: facts.contextTokens, oldSession });
    }
  }

  private cancel(id: string, reason: string): void {
    this.phase.delete(id);
    this.removeHandoff(id);
    this.deps.log({ kind: 'clear-cancelled', agentId: id, reason });
  }

  /** When the handoff was written, if it was written after the ask. */
  private handoffWrittenAt(id: string, at: number): number | null {
    try {
      const p = this.deps.handoffPath(id);
      if (!existsSync(p)) return null;
      const m = statSync(p).mtimeMs;
      return m >= at - 1000 ? m : null;
    } catch { return null; }
  }

  private removeHandoff(id: string): void {
    try { rmSync(this.deps.handoffPath(id), { force: true }); } catch { /* none */ }
  }
}

export { CLEAR_IDLE_MS };
