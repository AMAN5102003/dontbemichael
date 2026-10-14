/**
 * The tool calls each agent has running, by Claude's tool_use_id, so one call
 * ending doesn't blank the closing-time row while another is still running.
 *
 * Every call ends by its own id: a finished one with PostToolUse, a failed one
 * with PostToolUseFailure, and a refused one is never started (#261). So a
 * long call stays on the list while others start and end around it. Anything
 * left without an end (an interrupted turn) goes with the next prompt or stop.
 */
export interface RunningCall {
  tool: string;
  detail?: string;
  /** When it started, for the row's minutes. */
  at: number;
}

export class RunningToolCalls {
  private calls = new Map<string, Map<string, RunningCall>>();

  start(agentId: string, id: string, call: RunningCall): void {
    const mine = this.calls.get(agentId) ?? new Map<string, RunningCall>();
    mine.set(id, call);
    this.calls.set(agentId, mine);
  }

  /** Ends a call and returns the latest one still running, if any. */
  end(agentId: string, id: string | undefined): RunningCall | undefined {
    const mine = this.calls.get(agentId);
    if (!id || !mine) return undefined;
    mine.delete(id);
    return [...mine.values()].pop();
  }

  /** A new turn or a stop: nothing is running. */
  clear(agentId: string): void {
    this.calls.delete(agentId);
  }
}
