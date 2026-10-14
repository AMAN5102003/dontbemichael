/** Maximum JSON payload bytes in one newline-delimited hook frame. The hook
 *  server drops a bigger frame; the hook shim trims an MCP call to fit
 *  (src/main/hive.ts HOOK_SHIM). */
export const MAX_HOOK_FRAME_BYTES = 256 * 1024;

/** A file tool call whose path could not reach the app's check whole (ship
 *  review pass 2): refused, never let through unchecked. */
export const HOOK_PATH_UNCHECKED = 'The app could not check where this step reads or saves, so it did not run. Use a shorter file path.';

/** Renderer-facing hook event shared across the Electron IPC boundary. */
export interface HookEvent {
  agentId?: string;
  event: string;
  tool?: string;
  notificationType?: string;
  source?: string;
  message?: string;
  /** PreToolUse only: a safe one-line summary of the call (toolLine in
   *  src/main/hooks.ts: redacted, one line, at most 80 characters), e.g.
   *  Claude's description of a command. */
  detail?: string;
  /** PreToolUse and PostToolUse: the call's id (Claude's tool_use_id), so
   *  parallel calls can be told apart. */
  toolUseId?: string;
  blocked?: boolean;
}

const OPTIONAL_STRING_FIELDS = ['tool', 'notificationType', 'source', 'message', 'detail', 'toolUseId'] as const;

/** Validate an untrusted payload before it crosses the Electron IPC boundary. */
export function validateHookEvent(value: unknown): value is HookEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.event !== 'string' || candidate.event.length === 0) return false;
  if (
    candidate.agentId !== undefined &&
    (typeof candidate.agentId !== 'string' || candidate.agentId.length === 0)
  ) return false;

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (candidate[field] !== undefined && typeof candidate[field] !== 'string') return false;
  }

  return candidate.blocked === undefined || typeof candidate.blocked === 'boolean';
}

/** A Notification that means the session is stopped on a prompt a person must
 *  answer in the terminal: a permission request or a question dialog, never the
 *  plain idle "waiting for your input". */
export const TERMINAL_PROMPT_TYPES = new Set(['permission_prompt', 'elicitation_dialog']);

export function isTerminalPrompt(
  p: { notificationType?: string; notification_type?: string; message?: string } | null | undefined
): boolean {
  if (!p) return false;
  const rawType = p.notificationType ?? p.notification_type ?? '';
  const type = rawType.toLowerCase();
  if (type) return TERMINAL_PROMPT_TYPES.has(type);
  return /needs your permission|needs your approval/i.test(p.message ?? '');
}
