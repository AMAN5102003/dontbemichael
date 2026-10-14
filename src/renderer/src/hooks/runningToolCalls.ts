/**
 * The tool calls each agent has running, by Claude's tool_use_id, so one call
 * ending doesn't blank the closing-time row while another is still running.
 *
 * A call that fails or is refused never sends PostToolUse. So the first call
 * to start after one ended starts a fresh set, and a call left behind never
 * comes back as running.
 */
export interface RunningCall {
  tool: string;
  detail?: string;
  /** When it started, for the row's minutes. */
  at: number;
}

export class RunningToolCalls {
  private calls = new Map<string, Map<string, RunningCall>>();
  /** Agents whose last tool event was a call ending. */
  private ended = new Set<string>();

  start(agentId: string, id: string, call: RunningCall): void {
    if (this.ended.delete(agentId)) this.calls.delete(agentId);
    const mine = this.calls.get(agentId) ?? new Map<string, RunningCall>();
    mine.set(id, call);
    this.calls.set(agentId, mine);
  }

  /** Ends a call and returns the latest one still running, if any. */
  end(agentId: string, id: string | undefined): RunningCall | undefined {
    const mine = this.calls.get(agentId);
    if (!id || !mine) return undefined;
    mine.delete(id);
    this.ended.add(agentId);
    return [...mine.values()].pop();
  }

  /** A new turn or a stop: nothing is running. */
  clear(agentId: string): void {
    this.calls.delete(agentId);
    this.ended.delete(agentId);
  }
}
