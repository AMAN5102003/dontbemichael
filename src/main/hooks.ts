/**
 * HookServer — the bridge between `claude` lifecycle hooks and the harness.
 *
 * Each spawned agent is launched with `--settings` pointing its hooks at a tiny
 * shim (see HOOK_SHIM in hive.ts) that forwards the hook payload to the Unix
 * domain socket this server listens on. We then:
 *   - drive avatar state from PreToolUse/PostToolUse/Notification/etc., and
 *   - report lifecycle boundaries while renderer-side guarded queues deliver
 *     inbox work only after the session reaches a safe idle prompt.
 *
 * Runs in the Electron main process.
 */
import { createServer, type Server } from 'node:net';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { Notification, type WebContents } from 'electron';
import { redactSecrets, type HiveManager } from './hive';
import type { HarnessConfig } from './config';
import type { ControlRegistry } from './control';
import type { CircuitBreaker } from './breaker';
import { estimateCostUsd } from './pricing';
import { MAX_HOOK_FRAME_BYTES, validateHookEvent } from '../shared/hookEvents';
import { resolveGodName } from '../shared/godIdentity';
import { APP_NAME } from '../shared/appName';

/** The same terminal prompt is relayed to Michael at most once in this window. */
const PROMPT_RELAY_DEDUPE_MS = 10 * 60_000;

/** A Claude Code session transcript: a .jsonl file in Claude's own projects
 *  folder (CLAUDE_CONFIG_DIR when set, as Claude Code uses it), where agents
 *  don't write. */
function isClaudeTranscript(path: string): boolean {
  const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects') + sep;
  const real = resolve(path);
  return real.startsWith(projects) && real.endsWith('.jsonl');
}

/** Desktop notification bodies. The title is the agent's name (displayName). */
export const NOTIFY_FINISHED = 'Finished and ready for the next thing.';

/** Michael gone idle at his prompt. Nothing is needed from the owner (a real
 *  ask goes on ASK ME), so never "waiting for you": a line saying he's free and
 *  the office can take on more (owner, 2026-10-02). Read under his name. */
export const NOTIFY_IDLE_LINES = [
  'All caught up. Got anything for the team?',
  'My desk is clear. Send something my way.',
  'Nothing to manage right now. The office can take on a lot more.',
  "I've reorganized the paper clips twice. Please send work.",
  'Quiet in here. Too quiet. Got a project you keep putting off?',
  "World's best boss, currently underused.",
  'Inbox zero. The team is ready when you are.',
  'Free for the next thing. Big or small, the office can handle it.'
] as const;

/** The idle line shows at most once in this window, so it stays a light touch
 *  rather than a toast after every task (owner, 2026-10-02). */
export const IDLE_NOTIFY_GAP_MS = 3 * 60 * 60_000;

/** A random idle line, never the one shown last. */
export function pickIdleLine(previous: string | null, rand: () => number = Math.random): string {
  const pool = NOTIFY_IDLE_LINES.filter((l) => l !== previous);
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/** Claude Code's in-terminal question tool. Refused for team members. */
export const ASK_TOOL = 'AskUserQuestion';
export const ASK_TOOL_REFUSAL =
  "Don't ask the owner here: nobody answers your terminal. File it as one new file in the hive's triage folder (your questions as one \"ask\", what you were doing in \"description\"). Michael checks it and puts it on the owner's ASK ME board.";

/** A Notification that means the session is stopped on a prompt a person must
 *  answer in the terminal: a permission request or a question dialog, never the
 *  plain idle "waiting for your input". */
const TERMINAL_PROMPT_TYPES = new Set(['permission_prompt', 'elicitation_dialog']);
export function isTerminalPrompt(p: { notification_type?: string; message?: string }): boolean {
  const type = (p.notification_type ?? '').toLowerCase();
  if (type) return TERMINAL_PROMPT_TYPES.has(type);
  return /needs your permission|needs your approval/i.test(p.message ?? '');
}
import { GUARDED_TOOLS, harnessWriteDecision } from './harnessGuard';
import { FOLDER_READ_TOOLS, FOLDER_WRITE_TOOLS, folderDecision, folderToolTarget } from '../shared/folderAccess';
import { folderLayoutFor } from './officeFile';
import { expandTilde } from './fs';
import { CONNECTOR_UNDECIDED, connectorAccess, MCP_RESOURCE_TOOLS } from '../shared/claudeConnectors';
import { accessLine, agentAccessSummary } from '../shared/agentAccess';
import { MAIL_TOOL_OPS, mailAccess } from '../shared/mailboxes';
import { isQuickBooksConnectorTool, isQuickBooksResourceCall, quickbooksAccess, quickbooksCapability } from '../shared/quickbooks';
import { handoffContext } from '../shared/safeClear';
import { ownerQuestionsContext, ownerRequestsContext, stuckCardsContext } from '../shared/ownerRequests';
import { lastAssistantText } from './transcriptText';

/** An MCP tool, or Claude Code's tools for MCP resources. */
function isMcpCall(tool: string | undefined): boolean {
  return /^mcp__/.test(tool ?? '') || MCP_RESOURCE_TOOLS.has(tool ?? '');
}

function mcpDeny(reason: string): unknown {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}


interface HookPayload {
  hook_event_name?: string;
  agent_id?: string | null;
  /** Set by the shim when the call came from a Task subagent of agent_id. */
  subagent_id?: string;
  session_id?: string;
  transcript_path?: string;
  /** Status-line payloads only: the session's live context accounting. */
  context_window?: { total_input_tokens?: number; context_window_size?: number };
  /** Status-line payloads only, on a Claude plan: each usage window's fill and
   *  reset time (`five_hour`, `seven_day`, ...). */
  rate_limits?: unknown;
  /** StopFailure only: why the turn ended (`rate_limit` is the usage limit). */
  error?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
  stop_hook_active?: boolean;
  prompt?: string;
  source?: string;
  notification_type?: string;
  /** Notification hook text, e.g. "Claude is waiting for your input" (idle) vs a
   *  permission request. Used to tell "needs you" from "just done / lingering". */
  message?: string;
  /** CostSample payloads only (synthesized by the proxy-bridge sidecar for
   *  qwen). Raw token counts for one response, fed to the cost ledger. */
  model?: string;
  input?: number;
  output?: number;
  cache_read?: number;
  cache_creation?: number;
}

/** What the hook stream tells the office break (src/main/officeBreak.ts). */
export type PlanSignal =
  | { kind: 'limits'; agentId: string; rateLimits: unknown }
  | { kind: 'limit'; agentId: string }
  | { kind: 'prompt'; agentId: string }
  | { kind: 'turn'; agentId: string };

export class HookServer {
  private server: Server | null = null;
  /** agentId → the live session's transcript file, learned from hook payloads.
   *  Lets the harness read per-agent telemetry (e.g. current context size)
   *  even when several agents share one cwd. */
  private transcriptPaths = new Map<string, string>();
  /** agentId → the latest context-window accounting from the statusLine shim
   *  (current tokens + the REAL window size — 200k vs 1M, which nothing else
   *  exposes). The renderer already gets this pushed live on `hive:contextUpdate`;
   *  we also retain the last value here so a main-side read (the voice read-layer's
   *  get_agent_detail / list_agents) can report "how full is each agent's context"
   *  without depending on a renderer round-trip. */
  private contextById = new Map<string, { tokens: number; limit: number; ts: number }>();
  /** The goal last delivered to each agent's current session. Goals are durable
   *  roster state, so repeating an unchanged multi-kilobyte briefing on every
   *  prompt only bloats the transcript. One entry per agent is sufficient: an
   *  agent has one live session, and a new session id replaces the old entry. */
  private deliveredGoalByAgent = new Map<string, { sessionId: string | null; goal: string | null }>();
  /** The company profile last delivered to each agent's session: same once per
   *  session, again on change, rule as the goal. */
  private deliveredProfileByAgent = new Map<string, { sessionId: string | null; text: string | null }>();
  /** What roster each agent's session was last given, so it is sent again only on a change. */
  private deliveredRosterByAgent = new Map<string, { sessionId: string | null; layoutKey: string; statusKey: string }>();
  /** The session each agent was last given its memory index in. */
  private deliveredMemoryByAgent = new Map<string, string | null>();
  /** Whether Michael's last turn showed open owner requests, per session, so
   *  the list emptying is said once. */
  private ownerRequestsShown = new Map<string, { sessionId: string | null; any: boolean }>();
  private stuckCardsShown = new Map<string, { sessionId: string | null; any: boolean }>();
  private ownerQuestionsShown = new Map<string, { sessionId: string | null; any: boolean }>();
  /** The idle toast line shown last, so the next one differs, and when. */
  private lastIdleLine: string | null = null;
  private lastIdleAt: number | null = null;
  /** The clock, swappable so tests can step past the idle gap. */
  now: () => number = Date.now;

  /** When Michael's last turn ended, for the notes fallback (R8). Starts at
   *  launch, so his first turn never files words for an older question. */
  private lastGodStopAt = this.now();
  /** The transcript Michael's current session started with (ship D4). */
  private godSessionTranscript: string | undefined;

  /** R8: after a turn in which Michael was handed an owner question and sent
   *  no message at all (no reply, nothing to a teammate), file his last words
   *  for that question once, as "From Michael's notes". */
  private ownerNotesAtStop(agentId: string, transcript: string | undefined): void {
    const since = this.lastGodStopAt;
    this.lastGodStopAt = this.now();
    if (typeof this.hive.ownerState !== 'function' || !transcript) return;
    const state = this.hive.ownerState();
    const handed = this.hive.ownerQuestions()
      .map((q) => ({ q, at: state.requests[q.id]?.deliveredAt ?? 0 }))
      .filter((x) => x.at > since && !(state.requests[x.q.id]?.notes ?? []).length)
      .sort((a, b) => b.at - a.at);
    const latest = handed[0];
    if (!latest || this.hive.godSentSince(agentId, latest.at)) return;
    const words = lastAssistantText(transcript);
    if (words) this.hive.fileOwnerNotes(latest.q.id, words);
  }

  /** A note shown on every turn while `items` has any, and once, in the same
   *  session, when it empties. */
  private everyTurnNote<T>(
    shownBy: Map<string, { sessionId: string | null; any: boolean }>,
    agentId: string,
    sessionId: string | null,
    items: T[],
    render: (items: T[]) => string | null,
    none: string
  ): string | null {
    const shown = shownBy.get(agentId);
    shownBy.set(agentId, { sessionId, any: items.length > 0 });
    if (items.length) return render(items);
    return shown?.any && shown.sessionId === sessionId ? none : null;
  }

  constructor(
    private hive: HiveManager,
    private getWebContents: () => WebContents | null,
    private getConfig: () => HarnessConfig,
    /** #7C — operator control state. Optional so tests can omit it. */
    private control?: ControlRegistry,
    /** Circuit breaker (Lane A #6.6b) — fed the hook-derived signals (session id,
     *  repeated identical tool calls). Optional so the server still runs without it. */
    private breaker?: CircuitBreaker,
    /** Standing goal text for an agent (from the durable roster). Optional so
     *  tests can omit it; when set, injected at session start and when changed. */
    private getStandingGoal?: (agentId: string) => string | null,
    /** Optional observer of every hook boundary (agentId, event, message). The
     *  worker inbox-wake watchdog (workerWake.ts) feeds on this to learn when an
     *  agent is parked on a permission/HITL prompt so it never types into it. */
    private onEvent?: (agentId: string | undefined, event: string, message: string | undefined) => void,
    /** Company knowledge's live state, so turning it on or off reaches running
     *  agents on their next prompt instead of at their next start. */
    private getKnowledge?: () => { active: boolean; cliPath?: string; root?: string; meaning?: { bin: string; palace: string } },
    /** The company profile as agents read it (companyProfileContext), or null. */
    private getCompanyProfile?: () => string | null,
    /** Whether an agent's role reads the books (Oscar), which turns QuickBooks
     *  on, Read only, until the owner chooses. Optional so tests can omit it. */
    private roleReadsBooks?: (agentId: string) => boolean,
    /** Whether a member is on the team now (roster agents or restorable), so a
     *  Send only grant pauses when nobody reads its mailbox (shared-mailboxes.md,
     *  EV1). Optional so tests can omit it: then the config alone decides. */
    private memberPresent?: (agentId: string) => boolean,
    /** The office break's signals (issue 124): a status line's usage windows,
     *  a turn cut off by the usage limit, a prompt taken, a turn finished.
     *  Optional so tests can omit it. */
    private onPlan?: (signal: PlanSignal) => void
  ) {}

  start(): void {
    const sock = this.hive.sockPath();
    if (!sock || this.server) return;
    // Clear a stale socket file left by a previous run.
    try { if (existsSync(sock)) rmSync(sock); } catch { /* noop */ }

    this.server = createServer((conn) => {
      let pending = Buffer.alloc(0);
      const rejectOversizedFrame = (bytes: number): void => {
        this.hive.appendLog({
          kind: 'hook-frame-rejected',
          reason: 'frame-too-large',
          bytes,
          limit: MAX_HOOK_FRAME_BYTES,
        });
        conn.destroy();
      };
      conn.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        const nl = pending.indexOf(0x0a);
        if (nl === -1) {
          if (pending.length > MAX_HOOK_FRAME_BYTES) rejectOversizedFrame(pending.length);
          return; // wait for the full line
        }
        // The byte limit covers the JSON payload and excludes its newline.
        if (nl > MAX_HOOK_FRAME_BYTES) {
          rejectOversizedFrame(nl);
          return;
        }
        // Hook shims send one newline-delimited request per connection and stop writing.
        // conn.end() below closes the connection after that single frame is handled.
        const frame = pending.subarray(0, nl).toString('utf8');
        let payload: HookPayload = {};
        try { payload = JSON.parse(frame); } catch { /* ignore */ }
        let res: unknown = {};
        // A gate that throws allows a built-in tool as before, but never an MCP
        // call: connectors fail closed (D8).
        try { res = this.handle(payload); } catch { res = payload.hook_event_name === 'PreToolUse' && isMcpCall(payload.tool_name) ? mcpDeny(CONNECTOR_UNDECIDED) : {}; }
        conn.end(JSON.stringify(res ?? {}));
      });
      conn.on('error', () => { /* shim hung up — ignore */ });
    });
    const server = this.server;
    server.on('error', (e) => {
      console.error('[hive] hook server error:', e);
      const code = (e as NodeJS.ErrnoException).code ?? null;
      try { this.hive.appendLog({ kind: 'hook-server-error', code }); } catch { /* noop */ }
      // An error once the channel is open (a refused connection, out of file
      // handles) leaves it open; only a channel that never opened blocks spawns.
      if (server.listening) return;
      // Without this channel agents run unwatched, or, on Windows, a pipe taken
      // by something else would hear them (S1): no agent starts until a restart.
      const inUse = code === 'EADDRINUSE' || (code === 'EACCES' && process.platform === 'win32');
      this.listenError = `The office can't start its team: its private channel on this computer ${inUse ? 'is in use' : 'could not open'} (${code ?? 'error'}). Quit Don't Be Michael and open it again.`;
    });
    server.on('listening', () => { this.listenError = null; });
    // Settles when the channel opens or fails, so a spawn that races the
    // first listen waits for the answer instead of slipping past the guard
    // (Codex adversarial review, 2026-10-05).
    this.opened = new Promise<void>((resolve) => { server.once('listening', () => resolve()); server.once('error', () => resolve()); });
    server.listen(sock);
  }

  /** Waits, up to `ms`, until the channel has opened or failed. */
  async whenOpen(ms = 5000): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.opened, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); timer.unref?.(); })]);
    if (timer) clearTimeout(timer);
  }
  private opened: Promise<void> = Promise.resolve();

  /** Why agents cannot start, when the hook channel failed to open; else null. */
  channelError(): string | null {
    return this.listenError;
  }
  private listenError: string | null = null;

  stop(): void {
    try { this.server?.close(); } catch { /* noop */ }
    this.server = null;
    const sock = this.hive.sockPath();
    try { if (sock && existsSync(sock)) rmSync(sock); } catch { /* noop */ }
  }

  /** The transcript file of an agent's CURRENT session, if any hook has fired. */
  transcriptPath(agentId: string): string | undefined {
    return this.transcriptPaths.get(agentId);
  }

  /** The latest context-window accounting for an agent (current tokens + the real
   *  window size), or undefined if no statusLine tick has fired for it yet. */
  contextFor(agentId: string): { tokens: number; limit: number; ts: number } | undefined {
    return this.contextById.get(agentId);
  }

  private handle(p: HookPayload): unknown {
    const agentId = p.agent_id ?? undefined;
    const event = p.hook_event_name ?? 'Unknown';
    // A Task subagent's calls are checked as its team member (every gate below),
    // but its own finish, transcript and session are not the agent's: a
    // subagent stopping must not mark the agent idle or replace its transcript.
    const subagent = typeof p.subagent_id === 'string' && p.subagent_id.length > 0;
    if (subagent && event === 'SubagentStop') return {};
    this.onEvent?.(agentId, event, p.message);
    if (agentId && !subagent && typeof p.transcript_path === 'string' && p.transcript_path) {
      this.transcriptPaths.set(agentId, p.transcript_path);
      // Michael's notes fallback reads only the transcript his own session
      // started with, inside Claude's own folder (ship D4): a later event can't
      // point it at a file an agent wrote.
      if (event === 'SessionStart' && this.isGod(agentId) && isClaudeTranscript(p.transcript_path)) this.godSessionTranscript = p.transcript_path;
    }

    // Status-line payloads carry the session's EXACT context accounting —
    // current tokens AND the real window size (200k vs 1M, which nothing else
    // exposes). Forward to the renderer for the agent-card context gauge.
    // Handled FIRST and returned early: this is pure telemetry from the
    // statusLine shim, not a real hook boundary — it must never trip the
    // HALT gate or feed the breaker's loop detector below. The early return
    // also (deliberately) skips recordSession for status ticks: a statusLine
    // payload's session_id adds nothing the real hooks don't already record,
    // and telemetry should never write to the registry. transcript_path IS
    // still captured above, where every payload shape benefits from it.
    if (event === 'Status') {
      const cw = p.context_window;
      if (agentId && cw && typeof cw.total_input_tokens === 'number'
        && typeof cw.context_window_size === 'number' && cw.context_window_size > 0) {
        // Retain for main-side reads (voice get_agent_detail / list_agents) …
        this.contextById.set(agentId, {
          tokens: cw.total_input_tokens,
          limit: cw.context_window_size,
          ts: Date.now()
        });
        // … and forward live to the renderer's agent-card context gauge.
        this.getWebContents()?.send('hive:contextUpdate', {
          agentId,
          tokens: cw.total_input_tokens,
          limit: cw.context_window_size
        });
      }
      if (agentId && p.rate_limits) this.plan({ kind: 'limits', agentId, rateLimits: p.rate_limits });
      return {};
    }

    // A turn that ended on an API error (issue 124). Claude Code ignores the
    // answer; the usage limit starts the office break. Registered with the
    // `rate_limit` matcher, and checked again here.
    if (event === 'StopFailure') {
      if (agentId && !subagent && p.error === 'rate_limit') this.plan({ kind: 'limit', agentId });
      return {};
    }
    if (event === 'UserPromptSubmit' && agentId && !subagent) this.plan({ kind: 'prompt', agentId });
    if (event === 'Stop' && agentId && !subagent && !p.stop_hook_active) this.plan({ kind: 'turn', agentId });

    // 7C.3 — a graceful operator HALT overrides everything (incl. the inbox
    // drain below): stop the agent CLEANLY at this hook boundary rather than
    // killing the PTY. session_id is in the payload for a later --resume.
    if (agentId && this.control?.shouldHalt(agentId)) {
      this.emit(agentId, event, p);
      return { continue: false, stopReason: 'Halted by the operator from the floor.' };
    }

    // Capture the Claude Code session id for idempotent --resume + cost dedup
    // (Lane A #6.6a). Cheap: recordSession writes only when it changes.
    if (agentId && !subagent && p.session_id) this.hive.recordSession(agentId, p.session_id);

    // CostSample — synthesized by the proxy-bridge sidecar (qwen) on every
    // response with usage. Persist it to the SAME cost ledger as Claude's OTel
    // path, keyed by the synthesized session_id, then return early so cost stays
    // OUT of the Claude-only OTel/breaker/drain paths below. `usd` is the fallback
    // per-model estimate (a local model normally costs ~$0, but the row keeps the
    // accounting schema uniform). Pure telemetry — never feeds the loop detector.
    if (event === 'CostSample') {
      if (agentId && p.session_id) {
        const input = p.input ?? 0;
        const output = p.output ?? 0;
        const cacheRead = p.cache_read ?? 0;
        const cacheCreation = p.cache_creation ?? 0;
        this.hive.appendCostLedger({
          agentId,
          sessionId: p.session_id,
          ts: Date.now(),
          input,
          output,
          cacheRead,
          cacheCreation,
          model: p.model ?? '',
          usd: estimateCostUsd(p.model, {
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: cacheRead,
            cacheWriteTokens: cacheCreation
          })
        });
      }
      return {};
    }

    // Feed the breaker its hook-derived loop signal: a tool that actually ran.
    // A repeated identical (name+input) PostToolUse is the runaway-loop tell.
    // A subagent's tool calls are its own run, not the agent's loop signal.
    if (event === 'PostToolUse' && agentId && !subagent) {
      this.breaker?.recordToolUse(agentId, p.tool_name, p.tool_input);
    }

    // A human just spoke to this agent (issue #376): stamp the third progress
    // clock the no-progress arm reads. A conversation is prose in, prose out —
    // no hive file changes, no tool spans — which the arm otherwise reads as
    // "generating tokens without coordinating". A runaway loop is ONE prompt
    // followed by many tool calls, so this clock goes stale exactly when it
    // should and blinds nothing.
    if (event === 'UserPromptSubmit' && agentId) {
      this.breaker?.recordUserPrompt(agentId);
    }

    // Compaction exemption (issue #109): PreCompact opens it so the compaction
    // token burst can't trip the Δoutput arms; PostCompact — or any SessionStart,
    // since a fresh session makes in-flight compaction state moot — closes it
    // down to the trailing grace (a no-op when nothing was compacting).
    if (event === 'PreCompact' && agentId) this.breaker?.recordCompactStart(agentId);
    // Logged so compaction can be measured (tools/agent-metrics.cjs).
    if (event === 'PreCompact' && agentId) {
      const trigger = (p as { trigger?: unknown }).trigger;
      try { this.hive.appendLog({ kind: 'compact', agentId, trigger: typeof trigger === 'string' ? trigger : 'unknown' }); } catch { /* best-effort */ }
    }
    if ((event === 'PostCompact' || event === 'SessionStart') && agentId) {
      this.breaker?.recordCompactEnd(agentId);
    }

    if ((event === 'Stop' || event === 'SubagentStop') && agentId) {
      // Respect any upstream Stop hook that already re-entered this boundary.
      if (p.stop_hook_active) { this.emit(agentId, event, p); return {}; }
      // Never turn unread hive mail into a forced continuation at Stop. That old
      // path bypassed terminal-draft/HITL safety and could spend credits while a
      // user was answering a question. Inbox files remain durable; the renderer
      // wakes the agent later through its guarded idle-only delivery path.
      // An owner question Michael was handed this turn, with nothing sent
      // about it: his terminal words go to the owner as notes (R8).
      if (event === 'Stop' && this.isGod(agentId) && !p.stop_hook_active) {
        try { this.ownerNotesAtStop(agentId, this.godSessionTranscript); }
        catch (e) { console.error('[owner notes]', e); }
      }
      this.notify(agentId, NOTIFY_FINISHED);
      this.emit(agentId, event, p);
      return {};
    }

    // 7C.1 — HITL gate: deny a tool call at the PreToolUse boundary when the
    // agent is paused or this tool is gated. Race-free (immediate return, no
    // renderer round-trip → can't hit the shim timeout). Slow human APPROVAL is
    // deliberately left to Claude's native permission prompt.
    if (event === 'PreToolUse' && agentId && this.control) {
      const d = this.control.toolDecision(agentId, p.tool_name ?? '');
      if (d.deny) {
        this.emit(agentId, event, p);
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: d.reason ?? 'Denied by operator.'
          }
        };
      }
    }

    // Claude connectors (docs/designs/claude-connectors.md, owner 2026-10-02):
    // every MCP tool and MCP resource call is refused unless it reaches a
    // connector the owner turned on and gave this agent, or the app's own
    // md-mail (decided below by Capabilities > Email). QuickBooks keeps its own
    // rules, next. A call with no agent id, the owner's own servers and plugins,
    // and a connector the app cannot name are refused. Read per call, so a
    // revoke takes effect on the next one.
    // One config read for an MCP call's gates (connector, QuickBooks, md-mail).
    let mcpCfg: HarnessConfig | undefined;
    const mcpConfig = (): HarnessConfig => (mcpCfg ??= this.getConfig());
    if (event === 'PreToolUse' && isMcpCall(p.tool_name)) {
      const cfg = mcpConfig();
      const d = connectorAccess(cfg, agentId, p.tool_name ?? '', p.tool_input, agentId ? (this.roleReadsBooks?.(agentId) ?? false) : false);
      if (!d.ok) {
        console.log(`[connectors] refused ${p.tool_name} for ${agentId ?? 'no agent'}: ${d.reason}`);
        this.emit(agentId, event, p);
        return mcpDeny(d.reason);
      }
    }

    // QuickBooks (owner, 2026-09-29): its row's switch in Settings > Connections >
    // Claude connectors refuses everyone when off; then, per agent, off refuses
    // every call and Read only refuses any call that could change the books. The
    // connector gate above lets QuickBooks calls through to this one. The name
    // check comes first so other tools never read config.
    if (event === 'PreToolUse' && agentId && (isQuickBooksConnectorTool(p.tool_name ?? '') || isQuickBooksResourceCall(p.tool_name ?? '', p.tool_input))) {
      const cfg = mcpConfig();
      const cap = quickbooksCapability(cfg.agentCapabilities?.[agentId]?.quickbooks, this.roleReadsBooks?.(agentId) ?? false);
      const d = quickbooksAccess(cfg.quickbooksClaude === true, cap, p.tool_name ?? '');
      if (!d.ok) {
        this.emit(agentId, event, p);
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: d.reason
          }
        };
      }
    }

    // Mailboxes added in Settings (md-mail): the agent's Capabilities for the
    // mailbox named in the call (the broker checks it again). The Claude
    // account's Gmail and Calendar are connectors like any other, above.
    if (event === 'PreToolUse' && agentId && /^mcp__md-mail__/.test(p.tool_name ?? '')) {
      const cfg = mcpConfig();
      const mdMail = /^mcp__md-mail__([a-z_]+)$/.exec(p.tool_name ?? '');
      const op = mdMail ? MAIL_TOOL_OPS[mdMail[1]] : undefined;
      const input = (p.tool_input ?? {}) as { mailbox?: unknown; proposal?: unknown; standing?: unknown; forward?: unknown; attach_from?: unknown };
      // An approved proposal or a standing approval; the broker checks either.
      const ticket = [input.proposal, input.standing].find((v) => typeof v === 'string' && v.trim());
      const proposal = typeof ticket === 'string' ? ticket : undefined;
      // The call's references, so a Send only member's forward or attachment is
      // refused here too; its reply_to is checked against its own sends in the broker.
      const named = (v: unknown): boolean => !!v && typeof v === 'object';
      const refs = { forward: named(input.forward), attachFrom: Array.isArray(input.attach_from) && input.attach_from.some(named) };
      const d = op ? mailAccess(cfg, agentId, typeof input.mailbox === 'string' ? input.mailbox : undefined, op, proposal, { refs, present: this.memberPresent }) : { ok: false as const, reason: 'Unknown mail tool.' };
      if (!d.ok) {
        this.emit(agentId, event, p);
        return mcpDeny(d.reason);
      }
    }

    // Decision 48 — the harness folder is plumbing only. On a business install
    // (one with a business folder), a file write into it is refused unless it's a
    // protocol file; the reason tells the agent where the work belongs instead.
    // The tool check comes first so ordinary tool calls never read config.
    if (event === 'PreToolUse' && agentId && GUARDED_TOOLS.has(p.tool_name ?? '')) {
      const cfg = this.getConfig();
      const hiveRoot = this.hive.root();
      if ((cfg.businessFolder || cfg.officeFolder) && cfg.harnessHome && hiveRoot) {
        const d = harnessWriteDecision({
          tool: p.tool_name ?? '',
          toolInput: p.tool_input,
          cwd: p.cwd,
          agentId,
          isGod: agentId === 'god',
          harnessHome: cfg.harnessHome,
          hiveRoot,
          caseInsensitive: process.platform !== 'linux'
        });
        if (d.deny) {
          this.emit(agentId, event, p);
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: d.reason
            }
          };
        }
      }
    }

    // A team member never asks the owner in its own terminal: team members wait
    // on Michael at most (docs/designs/owner-talks-via-michael.md). Refusing the
    // question tool turns the question into a message to him; he answers it or
    // puts it on ASK ME.
    // In 1:1 the owner is at that terminal, so the question may go to them there.
    if (event === 'PreToolUse' && agentId && p.tool_name === ASK_TOOL && !this.isGod(agentId) && !this.onHold(agentId)) {
      this.emit(agentId, event, p);
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: ASK_TOOL_REFUSAL
        }
      };
    }

    // Folder privacy (src/shared/folderAccess.ts). The spawn's settings already
    // deny the folders known then; this catches everything else: folders made
    // after the agent started, and Michael's own files, which a settings rule
    // can't hide without hiding the folders inside his.
    const toolName = p.tool_name ?? '';
    if (event === 'PreToolUse' && agentId && (FOLDER_READ_TOOLS.has(toolName) || FOLDER_WRITE_TOOLS.has(toolName))) {
      const d = this.folderCheck(agentId, toolName, p.tool_input, p.cwd);
      if (d.deny) {
        this.emit(agentId, event, p);
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: d.reason
          }
        };
      }
    }

    // Memory pays off only if it's used (owner, 2026-09-25): record each time an
    // agent opens one of its procedure files, next to the tidy-up's own counts.
    if (event === 'PostToolUse' && agentId && toolName === 'Read') {
      const file = folderToolTarget('Read', p.tool_input, p.cwd);
      const root = this.hive.root();
      if (file && root && /[\\/]memory[\\/]procedures[\\/][^\\/]+\.md$/.test(file) && file.startsWith(root)) {
        try { this.hive.appendLog({ kind: 'memory-read', agentId, file: file.slice(root.length + 1) }); } catch { /* best-effort */ }
      }
    }

    // 7C.2 — mid-run steering: inject queued operator guidance as context on the
    // next eligible hook (no fragile typing into the TUI). Delivered once.
    // Merged with the roster line below so the two injections never displace each
    // other (only ONE additionalContext can be returned per hook).
    let steer: string | null = null;
    // Never on a subagent's hook: the steer is for the agent, and a subagent
    // would take it and end with it.
    if ((event === 'UserPromptSubmit' || event === 'PostToolUse') && agentId && !subagent && this.control) {
      steer = this.control.takeSteer(agentId) ?? null;
    }

    // Keep god's roster CURRENT. fleet.json is always fresh on disk, but god's
    // context is not: after a restart it resumes a transcript describing the old
    // floor and messages agents that are long gone. Push the live roster in as
    // additionalContext at the start of each session and on every prompt, so god
    // knows the floor all the time instead of only when it remembers to Read.
    // God-only and one line — every other agent is unaffected.
    const wantsRoster = (event === 'SessionStart' || event === 'UserPromptSubmit')
      && !!agentId && this.hive.isGod(agentId);
    // Hand the roster the LIVE context-window occupancy (contextById) so each
    // agent line can carry a `ctx NN%` — god then sees whose context is nearly
    // full when it routes work, instead of guessing from cumulative token spend.
    // A business office (owner, 2026-09-25) sends the full roster at the start
    // of a session and when the team changes, a one line status when only who
    // is busy or on hold changed, and nothing otherwise. Older installs keep
    // the live roster on every prompt.
    let roster: string | null = null;
    if (wantsRoster && this.getConfig().businessFolder && typeof this.hive.teamRoster === 'function') {
      // Each member's real access, read per prompt, so a grant or a new
      // mailbox changes the layout key and the full roster goes out again.
      const cfg = this.getConfig();
      const r = this.hive.teamRoster((id) => accessLine(agentAccessSummary(cfg, id, this.roleReadsBooks?.(id) ?? false, this.memberPresent)));
      const sessionId = p.session_id ?? null;
      const last = this.deliveredRosterByAgent.get(agentId!);
      if (r) {
        if (event === 'SessionStart' || !last || last.sessionId !== sessionId || last.layoutKey !== r.layoutKey) {
          roster = r.full;
        } else if (last.statusKey !== r.statusKey) {
          roster = r.status;
        }
        this.deliveredRosterByAgent.set(agentId!, { sessionId, layoutKey: r.layoutKey, statusKey: r.statusKey });
      }
    } else if (wantsRoster) {
      roster = this.hive.rosterContext((id) => this.contextFor(id));
    }

    // Standing goal (hire Briefing) — durable roster field, re-read every cycle so
    // an Edit Agent save is picked up on the next UserPromptSubmit without
    // restarting the worker. Deliver it once at SessionStart, then only when its
    // value changes; repeating an unchanged briefing on every prompt can make it
    // one of the largest elements in a long transcript. Kept out of
    // --append-system-prompt (volatile-free cache invariant); lives on the live
    // hook channel instead.
    const wantsGoal = (event === 'SessionStart' || event === 'UserPromptSubmit') && !!agentId;
    const goalRaw = wantsGoal ? (this.getStandingGoal?.(agentId) ?? null) : null;
    let goal: string | null = null;
    if (wantsGoal) {
      const sessionId = p.session_id ?? null;
      const delivered = this.deliveredGoalByAgent.get(agentId);
      const newSession = !delivered || delivered.sessionId !== sessionId;
      const changed = !!delivered && delivered.sessionId === sessionId && delivered.goal !== goalRaw;
      if (event === 'SessionStart' || newSession || changed) {
        this.deliveredGoalByAgent.set(agentId, { sessionId, goal: goalRaw });
        if (goalRaw) {
          goal = `<goal>\n${goalRaw}\n</goal>`;
        } else if (changed && delivered?.goal) {
          // Silence would leave the old briefing alive in the model's context.
          // Explicitly revoke it when the operator clears the durable field.
          goal = '<goal>\n[Cleared by the operator. Stop following the previous standing goal.]\n</goal>';
        }
      }
    }

    // The company profile (owner, 2026-09-25): key facts every agent, Michael
    // included, works from. Delivered at the start of each session and again
    // when the owner changes it, never repeated unchanged.
    let profile: string | null = null;
    if ((event === 'SessionStart' || event === 'UserPromptSubmit') && agentId && this.getCompanyProfile) {
      const text = this.getCompanyProfile();
      const sessionId = p.session_id ?? null;
      const delivered = this.deliveredProfileByAgent.get(agentId);
      const fresh = event === 'SessionStart' || !delivered || delivered.sessionId !== sessionId;
      if (fresh || delivered.text !== text) {
        this.deliveredProfileByAgent.set(agentId, { sessionId, text });
        if (text) profile = text;
        else if (!fresh && delivered?.text) profile = 'COMPANY PROFILE. The owner cleared the company profile; the facts given earlier no longer apply.';
      }
    }

    // The agent's memory index (owner, 2026-09-25): once at the start of each
    // session, and never again within it, so it stays in the prompt cache. The
    // tidy-up's changes arrive with the next session.
    let memoryIndex: string | null = null;
    if ((event === 'SessionStart' || event === 'UserPromptSubmit') && agentId) {
      const sessionId = p.session_id ?? null;
      if (event === 'SessionStart' || this.deliveredMemoryByAgent.get(agentId) !== sessionId) {
        this.deliveredMemoryByAgent.set(agentId, sessionId);
        memoryIndex = this.hive.memoryIndexFor?.(agentId) ?? null;
      }
    }

    // A handoff the agent wrote just before its conversation was cleared
    // (safeClearer.ts): given once, at the start of the new conversation.
    // Only a conversation that was really cleared takes it: a restart or a
    // compaction mid-handoff leaves it for the clearer (review, 2026-09-25).
    const handoffText = event === 'SessionStart' && p.source === 'clear' && agentId ? (this.hive.takeHandoff?.(agentId) ?? null) : null;
    const handoff = handoffText ? handoffContext(handoffText) : null;

    // Michael's open requests from the owner (docs/designs/card-lifecycle.md)
    // and Blocked cards nothing is moving (section 7): on every turn while any
    // exist, so neither a compaction nor a busy stretch can lose one; once,
    // when the last one goes.
    const michaelTurn = (event === 'SessionStart' || event === 'UserPromptSubmit') && !!agentId && this.isGod(agentId);
    const ownerRequests = michaelTurn && typeof this.hive.ownerRequests === 'function'
      ? this.everyTurnNote(this.ownerRequestsShown, agentId!, p.session_id ?? null, this.hive.ownerRequests(),
        (open) => ownerRequestsContext(open, this.now()), 'OPEN REQUESTS FROM THE OWNER: none open now.')
      : null;
    const stuckCards = michaelTurn && typeof this.hive.stuckCards === 'function'
      ? this.everyTurnNote(this.stuckCardsShown, agentId!, p.session_id ?? null, this.hive.stuckCards(),
        stuckCardsContext, 'CARDS TO TIDY (new filings, Blocked with nothing asked, or open questions held the wrong way): none now.')
      : null;
    // Questions the owner asked in the dock that he still owes an answer
    // (docs/designs/michael-replies.md): every turn until he sends done or refuse.
    const ownerQuestions = michaelTurn && typeof this.hive.ownerQuestions === 'function'
      ? this.everyTurnNote(this.ownerQuestionsShown, agentId!, p.session_id ?? null, this.hive.ownerQuestions(),
        ownerQuestionsContext, 'QUESTIONS FROM THE OWNER IN YOUR CONVERSATION: none open now.')
      : null;

    // Company knowledge turned on or off since this agent was last told.
    const knowledgeNote = (event === 'SessionStart' || event === 'UserPromptSubmit') && agentId && this.getKnowledge
      ? this.hive.knowledgeUpdate(agentId, this.getKnowledge())
      : null;

    if (steer || roster || goal || knowledgeNote || profile || memoryIndex || handoff || ownerRequests || ownerQuestions || stuckCards) {
      this.emit(agentId, event, p);
      return {
        hookSpecificOutput: {
          hookEventName: event,
          additionalContext: [roster, profile, memoryIndex, handoff, goal, knowledgeNote, ownerRequests, ownerQuestions, stuckCards, steer].filter(Boolean).join('\n\n')
        }
      };
    }

    // A Notification hook that means the agent is idle at its prompt, done and
    // free. Not a request: a permission request surfaces natively in the
    // agent's own Claude Code session (approvable remotely via /remote-control).
    if (
      event === 'Notification' &&
      (p.notification_type === 'idle' ||
        (p.message ?? '').toLowerCase().includes('waiting for your input'))
    ) {
      // Our own words, not Claude Code's ("Claude is waiting for your input"),
      // which read as the owner owing an action (owner, 2026-10-02). At most
      // once per IDLE_NOTIFY_GAP_MS; only a shown toast starts the gap.
      const at = this.now();
      if (this.lastIdleAt === null || at - this.lastIdleAt >= IDLE_NOTIFY_GAP_MS) {
        const line = pickIdleLine(this.lastIdleLine);
        if (this.notify(agentId, line)) {
          this.lastIdleLine = line;
          this.lastIdleAt = at;
        }
      }
    }

    // A team member's session stopped on a prompt only a person can answer in
    // that terminal (a permission, a sign-in, a trust dialog). Tell Michael
    // what it says; he can't type there, so he puts it on ASK ME for the owner
    // to answer in a 1:1 (docs/designs/owner-talks-via-michael.md).
    // Not in 1:1: the owner is already at that terminal to answer it. The cheap
    // prompt check runs first; the registry is read only for a real prompt.
    if (event === 'Notification' && agentId && isTerminalPrompt(p) && !this.isGod(agentId) && !this.onHold(agentId)) {
      this.relayPromptToMichael(agentId, (p.message ?? '').trim());
    }

    // Forward everything else to the renderer so avatars reflect real activity.
    this.emit(agentId, event, p);
    return {};
  }

  /** Fire a native desktop notification — gated on the user's `notifications`
   *  setting. Only the OS toast is gated; the hive:hookEvent emit is always sent
   *  so avatars/UI stay live regardless. Best-effort: never throw into the hook.
   *
   *  Only Michael notifies (owner, 2026-09-25): team members talk to Michael and
   *  at most wait on him, so their stops and idles never reach the desktop.
   *  Michael raises anything the owner must decide on ASK ME
   *  (docs/designs/michael-only-notifications.md). */
  private notify(agentId: string | undefined, body: string): boolean {
    if (!this.getConfig().notifications) return false;
    if (!agentId || !this.isGod(agentId)) return false;
    try {
      if (!Notification.isSupported()) return false;
      new Notification({ title: this.displayName(agentId), body }).show();
      return true;
    } catch { return false; /* notifications unsupported on this platform — ignore */ }
  }

  /** Hands a signal to the office break; it never breaks the hook. */
  private plan(signal: PlanSignal): void {
    try { this.onPlan?.(signal); } catch (e) { console.error('[office break]', e); }
  }

  /** Is the owner in 1:1 with this agent (registry `onHold`)? */
  private onHold(agentId: string): boolean {
    try { return !!this.hive.registry().agents[agentId]?.onHold; } catch { return false; }
  }

  /** agentId → last prompt relayed, so one prompt isn't relayed twice. */
  private relayedPrompts = new Map<string, { text: string; at: number }>();

  private relayPromptToMichael(agentId: string, text: string): void {
    const last = this.relayedPrompts.get(agentId);
    if (last && last.text === text && Date.now() - last.at < PROMPT_RELAY_DEDUPE_MS) return;
    try {
      const name = this.displayName(agentId);
      this.hive.send({
        to: this.hive.registry().godId ?? 'god',
        act: 'inform',
        subject: `${name} is waiting on something in their terminal`,
        body: `${name}'s session stopped on a prompt only the owner can answer in that terminal${text ? `: "${text}"` : '.'} You can't answer it there. Put it on the owner's ASK ME board (a card for ${agentId}, status "blocked", one humanQA ask with "raisedBy": "${agentId}") saying what it is waiting on and to talk 1:1 with ${name} to answer it.`
      }, 'system');
      // Stamped only once it went out, so a failed send is retried on the
      // next prompt event (adversarial review, 2026-09-25).
      this.relayedPrompts.set(agentId, { text, at: Date.now() });
    } catch { /* best-effort: the panel offers Talk 1:1 meanwhile */ }
  }

  private isGod(agentId: string): boolean {
    try {
      const reg = this.hive.registry();
      return agentId === (reg.godId ?? 'god') || !!reg.agents?.[agentId]?.isGod;
    } catch {
      return false;
    }
  }

  /** The name the owner knows an agent by, for a notification title. Never the
   *  internal id: Michael's id is `god` and nobody in the office is called that
   *  (2026-09-24). Michael's name follows a rename; an agent the registry does
   *  not know is announced as the app. */
  /** One file tool call judged against the office's folder rules. Offices
   *  without a business folder (older installs) have no rules to apply. */
  private folderCheck(agentId: string, tool: string, input: unknown, cwd: string | undefined): { deny: boolean; reason?: string } {
    const cfg = this.getConfig();
    // Without a business folder there are no team folders to keep apart, but
    // the app's private folder is still nobody's to open (issue #63).
    const home = cfg.harnessHome ? expandTilde(cfg.harnessHome) : undefined;
    if (!cfg.businessFolder && !home) return { deny: false };
    const target = folderToolTarget(tool, input, cwd);
    if (!target) return { deny: false };
    const reg = this.hive.registry();
    const me = reg.agents[agentId];
    if (!me?.cwd || me.isAssistant) return { deny: false };
    const folders = cfg.businessFolder ? (cfg.businessTeam ?? []).map((m) => m.folder) : [];
    if (cfg.businessFolder) {
      for (const a of Object.values(reg.agents)) {
        if (!a.isGod && !a.isAssistant && a.cwd) folders.push(a.cwd);
      }
    }
    const layout = folderLayoutFor(cfg.businessFolder, folders, home);
    const godName = resolveGodName(reg.agents[reg.godId ?? 'god']?.name);
    const agent = { isGod: !!me.isGod, cwd: me.cwd };
    const ci = process.platform !== 'linux';
    // Judge the path as asked and the file it really is: a link inside the
    // agent's own folder can point anywhere (review, 2026-09-25).
    const asked = folderDecision(agent, layout, tool, target, ci, godName);
    if (asked.deny) return asked;
    const real = realPathOf(target);
    if (!real || real === target) return asked;
    // The folders in the layout are real paths, so the agent's own is too here.
    return folderDecision({ ...agent, cwd: realPathOf(me.cwd) ?? me.cwd }, layout, tool, real, ci, godName);
  }

  private displayName(agentId: string | undefined): string {
    if (!agentId) return APP_NAME;
    try {
      const reg = this.hive.registry();
      const name = reg.agents?.[agentId]?.name;
      if (agentId === (reg.godId ?? 'god')) return resolveGodName(name);
      return name?.trim() || APP_NAME;
    } catch {
      return APP_NAME;
    }
  }

  private emit(agentId: string | undefined, event: string, p: HookPayload, blocked = false): void {
    const payload = {
      agentId,
      event,
      tool: p.tool_name,
      notificationType: p.notification_type,
      source: p.source,
      message: p.message,
      detail: event === 'PreToolUse' ? toolLine(p.tool_name, p.tool_input) : undefined,
      blocked
    };
    if (!validateHookEvent(payload)) {
      console.warn('[hive] rejected invalid hook event:', event);
      return;
    }
    this.getWebContents()?.send('hive:hookEvent', payload);
  }
}

/**
 * A one-line summary of a tool call for the owner to read (closing time,
 * owner 2026-09-29): Claude's own description of a command, never the command
 * itself, which can carry a token; a file's name; a site's host. Undefined
 * when there is nothing safe to say. Pure; the caller redacts and caps.
 */
export function toolDetail(tool: unknown, input: unknown): string | undefined {
  if (typeof tool !== 'string') return undefined;
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  const baseName = (v: unknown): string | undefined => str(v)?.split(/[\\/]/).filter(Boolean).pop();
  switch (tool) {
    case 'Bash':
    case 'Task':
    case 'Agent':
      return str(i.description);
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return baseName(i.file_path);
    case 'NotebookEdit':
      return baseName(i.notebook_path);
    case 'WebFetch':
      try { return new URL(String(i.url)).host || undefined; } catch { return undefined; }
  }
  // mcp__<server>__<tool>: the same split as the connector matchers.
  const mcp = /^mcp__.+?__(.+)$/.exec(tool);
  return mcp ? mcp[1].replace(/_+/g, ' ').trim() || undefined : undefined;
}

/** Longest agent text redacted for the closing-time line. The text is the
 *  agent's own and unbounded, and redaction is slow on very long runs (2.6 s
 *  at 64 KB, ~9 ms at 4 KB), so it is cut first. A private key cut off by
 *  this window no longer matches its BEGIN...END pattern, so toolLine drops
 *  any line that still shows a key header. */
const TOOL_LINE_SCAN_MAX = 4096;
/** The closing-time line's length, in code points. */
const TOOL_LINE_MAX = 80;

/** toolDetail, redacted, on one line and at most 80 characters. Control and
 *  invisible format characters (bidi overrides, zero-width) are dropped so an
 *  agent cannot disguise the line the owner decides by. */
export function toolLine(tool: unknown, input: unknown): string | undefined {
  const d = toolDetail(tool, input);
  if (!d) return undefined;
  // Invisible format characters are removed, not spaced, so one hidden
  // inside a token cannot split it past redaction.
  const plain = d.replace(/\p{Cf}+/gu, '').replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, TOOL_LINE_SCAN_MAX);
  // Cut by code point so an emoji is never split in half.
  const redacted = redactSecrets(plain);
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(redacted)) return undefined;
  const line = Array.from(redacted).slice(0, TOOL_LINE_MAX).join('').trim();
  return line || undefined;
}

/** The real path of `p`, following links and taking the letter case on disk.
 *  A file that doesn't exist yet takes the real path of its nearest existing
 *  folder. Null when nothing along the way can be read. */
export function realPathOf(p: string): string | null {
  let dir = p;
  const rest: string[] = [];
  for (;;) {
    try { return join(realpathSync.native(dir), ...rest); } catch { /* not there yet */ }
    const up = dirname(dir);
    if (up === dir) return null;
    rest.unshift(basename(dir));
    dir = up;
  }
}
