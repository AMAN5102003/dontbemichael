import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCommand, userShellPath } from './shellEnv';
import { expandTilde } from './fs';
import { projectDir } from './transcript';
import { lastAssistantText, transcriptFile } from './transcriptText';
import { ensureKilled } from './procKill';
import { Terminal } from '@xterm/headless';
import { ANSWER_MARK, screenAnswer } from './screenAnswer';

/**
 * Shared helper: run a HIDDEN interactive claude session (ephemeral PTY) and
 * return the assistant's final text response.
 *
 * "Hidden" means: not added to the PtyManager, not emitted to the renderer,
 * not visible in the agent list or OfficeFloor scene. Each call spawns its own
 * session and kills it after capture — no /clear needed, no context bleed.
 *
 * Uses an interactive PTY (not `claude -p`) so calls draw from the user's
 * normal interactive plan quota, not the Agent SDK credit that moves to a
 * separate claim-required pool from 2026-06-15.
 *
 * Session lifecycle:
 *   spawn → boot-quiet detect → bracketed-paste prompt + \r → idle-settle →
 *   transcript JSONL extract (last assistant text block) → kill
 */

/** ms of PTY silence that signals the TUI is ready for input (boot complete). */
const BOOT_QUIET_MS = 1500;

export interface HiddenClaudeOptions {
  /** Model to use (e.g. 'claude-haiku-4-5'). */
  model: string;
  /** Working directory for the claude session. */
  cwd: string;
  /** Base claude command/binary. Defaults to 'claude'. */
  command?: string;
  /** Tools the session is forbidden to use. Defaults to ['Edit','Write','NotebookEdit']. */
  disallowedTools?: string[];
  /** No tools and no MCP servers at all: for a pure text transform that reads
   *  text other agents wrote (the memory tidy up), so nothing in that text can
   *  make it open files or reach the web. Overrides disallowedTools. */
  noTools?: boolean;
  /** Setting sources to load (--setting-sources), e.g. "user" so a project's
   *  settings and hooks in the folder can't change a check. */
  settingSources?: string;
  /** Settings passed with --settings (a JSON string), laid over the sources
   *  above, e.g. {"disableAllHooks": true} so no hook runs in the session. */
  settingsJson?: string;
  /** Directories added via --add-dir (for context gathering). */
  addDirs?: string[];
  /** Hard cap ms before forcing prompt send regardless of boot activity. Default 7000. */
  bootCapMs?: number;
  /** ms of PTY silence after the prompt that signals response is complete. Default 3500. */
  idleMs?: number;
  /** Total timeout ms. Default 180000. */
  timeoutMs?: number;
  /** ms after the prompt by which its transcript must exist. A session stuck
   *  on a sign-in or trust screen never takes the prompt, so the call gives up
   *  then instead of at timeoutMs. Default 20000. */
  promptTakenMs?: number;
  /** Extra env merged over the resolved shell env (e.g. the shared MemPalace). */
  env?: Record<string, string>;
  /** False for a quick judgment (the hire overlap check, the focus check):
   *  no extended thinking. Claude Code thinks by default, and on these short
   *  prompts that took Haiku 18 to 70 seconds of hidden thinking and sometimes
   *  hit the timeout; with MAX_THINKING_TOKENS=0 the same verdict comes in
   *  about a second (measured 2026-10-03). Defaults to the CLI's own setting. */
  thinking?: boolean;
  /** The answer as it is being written, read off the session's screen through
   *  a headless terminal, for a live preview (screenAnswer.ts). The result
   *  still comes from the transcript. */
  onScreenText?: (text: string) => void;
  /** Stops the call: the session is killed and the result is 'cancelled'. */
  signal?: AbortSignal;
  /** Remove this session's transcript once it ends: it holds text that must
   *  not stay where agents can read (Research's, red team third ship). */
  dropTranscript?: boolean;
}

/** How long after a session ends its transcript is removed again, for a
 *  last write as the process exits. */
const DROP_AGAIN_MS = 3_000;

/** How Claude signs in for these checks, set once by the app (index.ts):
 *  the owner's API key when they chose one in Get Michael ready, else nothing. */
let hiddenClaudeAuthEnv: () => Record<string, string> = () => ({});
export function setHiddenClaudeAuthEnv(source: () => Record<string, string>): void {
  hiddenClaudeAuthEnv = source;
}

/** How often the live preview is read off the screen. */
const SCREEN_READ_MS = 300;
/** The hidden terminal's size, shared by the PTY and the preview's screen. */
const COLS = 220;
const ROWS = 50;

/** How often a no tools call looks for its answer in its own transcript. */
const ANSWER_POLL_MS = 250;

/** How often Enter is pressed again while the prompt sits untaken. */
const ENTER_AGAIN_MS = 1_500;

export interface HiddenClaudeResult {
  ok: boolean;
  /** The assistant's final text response (stripped of any TUI framing). */
  text?: string;
  error?: string;
}

export function runHiddenClaude(prompt: string, opts: HiddenClaudeOptions): Promise<HiddenClaudeResult> {
  return new Promise((resolve) => {
    if (!prompt.trim()) { resolve({ ok: false, error: 'empty prompt' }); return; }
    // Defense-in-depth: `~` is shell syntax, not a path Node understands.
    const cwd = opts.cwd ? expandTilde(opts.cwd) : opts.cwd;
    if (!cwd || !existsSync(cwd)) {
      resolve({ ok: false, error: `cwd does not exist: ${opts.cwd}` });
      return;
    }
    opts = { ...opts, cwd };

    const binary = (opts.command || 'claude').trim().split(/\s+/)[0] || 'claude';
    const exe = resolveCommand(binary);
    const disallowed = opts.disallowedTools ?? ['Edit', 'Write', 'NotebookEdit'];
    const addDirs = (opts.addDirs ?? []).filter((d) => d && existsSync(d));

    // This call's own session: its answer is read from this transcript and no
    // other, so two hidden calls in a row can never swap answers.
    const sessionId = randomUUID();
    const args: string[] = [
      '--session-id', sessionId,
      '--model', opts.model,
      '--permission-mode', 'bypassPermissions',
      // No connector or MCP server of the owner's (docs/designs/claude-connectors.md):
      // these runs have no hook to check a call, so none is loaded at all.
      ...(opts.noTools ? ['--tools', '', '--strict-mcp-config'] : ['--strict-mcp-config', '--disallowedTools', ...disallowed]),
    ];
    if (opts.settingSources) args.push('--setting-sources', opts.settingSources);
    if (opts.settingsJson) args.push('--settings', opts.settingsJson);
    for (const d of addDirs) { args.push('--add-dir', d); }

    const bootCapMs = opts.bootCapMs ?? 7000;
    const idleMs = opts.idleMs ?? 3500;
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const promptTakenMs = opts.promptTakenMs ?? 20_000;

    // Windows: node-pty's CreateProcess can't exec the npm `.cmd`/extensionless
    // `claude` shim directly (ERROR_BAD_EXE_FORMAT, error 193) — route non-.exe
    // targets through cmd.exe. A real claude.exe (WinGet) launches directly. (#22)
    const winWrap = process.platform === 'win32' && !/\.(exe|com)$/i.test(exe);
    const spawnFile = winWrap ? (process.env.ComSpec || 'cmd.exe') : exe;
    const spawnArgs = winWrap ? ['/c', exe, ...args] : args;
    let ptyProc: pty.IPty;
    try {
      ptyProc = pty.spawn(spawnFile, spawnArgs, {
        name: 'xterm-color',
        cols: COLS,
        rows: ROWS,
        cwd: opts.cwd,
        env: {
          ...process.env,
          PATH: userShellPath(),
          ...hiddenClaudeAuthEnv(),
          ...(opts.env ?? {}),
          ...(opts.thinking === false ? { MAX_THINKING_TOKENS: '0' } : {}),
          ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
        } as Record<string, string>,
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    let settled = false;
    let promptSent = false;
    let bootTimer: NodeJS.Timeout | null = null;
    let idleTimer: NodeJS.Timeout | null = null;
    let bootMaxTimer: NodeJS.Timeout;
    let globalTimer: NodeJS.Timeout;
    let answerPoll: NodeJS.Timeout | null = null;
    let promptTimer: NodeJS.Timeout | null = null;
    // The live preview: the PTY output rendered by a headless terminal, read
    // a few times a second once the prompt is in.
    const screen = opts.onScreenText ? new Terminal({ cols: COLS, rows: ROWS, scrollback: 2000, allowProposedApi: true }) : null;
    let screenTimer: NodeJS.Timeout | null = null;
    let lastScreenText = '';
    const readScreen = () => {
      if (!screen || !promptSent) return;
      const buf = screen.buffer.active;
      // Only the answer being written counts, and it sits at the bottom: walk
      // back to its marker instead of translating the whole scrollback.
      let from = buf.length - 1;
      while (from >= 0 && !(buf.getLine(from)?.translateToString(true) ?? '').includes(ANSWER_MARK)) from--;
      if (from < 0) return; // still thinking: no answer on screen yet
      const lines: string[] = [];
      for (let i = from; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '');
      const text = screenAnswer(lines);
      if (text && text !== lastScreenText) { lastScreenText = text; try { opts.onScreenText?.(text); } catch { /* a preview never breaks the call */ } }
    };

    // Hidden sessions are ephemeral CHECKS — nothing they spawn (MCP servers,
    // helpers) may outlive them. Kill politely, then sweep the process group so
    // every check releases its PIDs even if `claude` shrugs off the SIGHUP.
    const kill = () => {
      const pid = ptyProc.pid;
      try { ptyProc.kill(); } catch { /* noop */ }
      ensureKilled(pid);
    };

    const finish = (r: HiddenClaudeResult) => {
      if (settled) return;
      settled = true;
      if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (answerPoll) { clearInterval(answerPoll); answerPoll = null; }
      if (promptTimer) { clearInterval(promptTimer); promptTimer = null; }
      if (screenTimer) { clearInterval(screenTimer); screenTimer = null; }
      opts.signal?.removeEventListener('abort', onAbort);
      screen?.dispose();
      clearTimeout(bootMaxTimer);
      clearTimeout(globalTimer);
      kill();
      if (opts.dropTranscript) {
        const drop = () => {
          const dir = projectDir(opts.cwd);
          for (const p of [transcriptFile(dir, sessionId), join(dir, sessionId)]) {
            try { rmSync(p, { recursive: true, force: true }); } catch { /* next time */ }
          }
        };
        drop();
        setTimeout(drop, DROP_AGAIN_MS).unref?.();
      }
      resolve(r);
    };

    const ownAnswer = (): string | null => lastAssistantText(transcriptFile(projectDir(opts.cwd), sessionId));
    // The screen going quiet is not the answer arriving: a model can think for
    // a while with nothing on screen. Until this session's own transcript has
    // an answer, keep waiting (the global timeout still bounds it).
    const captureAndFinish = () => {
      if (settled) return;
      const text = ownAnswer();
      if (text) { finish({ ok: true, text }); return; }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(captureAndFinish, idleMs);
    };

    const sendPrompt = () => {
      if (settled || promptSent) return;
      promptSent = true;
      if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
      // Bracketed paste + enter — same mechanism as submitToPty in useHive.ts.
      ptyProc.write(`\x1b[200~${prompt}\x1b[201~`);
      setTimeout(() => { if (!settled) ptyProc.write('\r'); }, 140);
      // Claude writes the prompt to the session's transcript as soon as it
      // takes it. An Enter that lands while Claude is still starting is
      // swallowed and the prompt waits unsent in its input box: at app launch,
      // with every agent starting at once, that denied the trust layer's checks
      // after 23 s (seen live, 2026-10-15). So Enter is pressed again until the
      // transcript shows the prompt was taken; on an empty input it does
      // nothing. None at all by promptTakenMs means a sign-in or trust screen
      // is waiting, so the caller's fallback answers now, not at the timeout.
      const sentAt = Date.now();
      promptTimer = setInterval(() => {
        if (settled) return;
        if (existsSync(transcriptFile(projectDir(opts.cwd), sessionId))) {
          if (promptTimer) { clearInterval(promptTimer); promptTimer = null; }
          return;
        }
        if (Date.now() - sentAt >= promptTakenMs) { finish({ ok: false, error: 'hidden session never took the prompt (signed out, or a screen is waiting)' }); return; }
        ptyProc.write('\r');
      }, ENTER_AGAIN_MS);
      // With no tools the first answer is the last one, so it is taken the
      // moment it lands in this session's transcript instead of after the
      // screen has been quiet for idleMs (which added 3.5s to every call).
      if (screen) screenTimer = setInterval(readScreen, SCREEN_READ_MS);
      if (opts.noTools) {
        answerPoll = setInterval(() => {
          const text = ownAnswer();
          if (text) finish({ ok: true, text });
        }, ANSWER_POLL_MS);
      }
    };

    bootMaxTimer = setTimeout(sendPrompt, bootCapMs);
    globalTimer = setTimeout(
      () => finish({ ok: false, error: 'hidden session timed out' }),
      timeoutMs,
    );

    const onAbort = () => finish({ ok: false, error: 'cancelled' });
    if (opts.signal?.aborted) { finish({ ok: false, error: 'cancelled' }); return; }
    opts.signal?.addEventListener('abort', onAbort);

    ptyProc.onData((data) => {
      screen?.write(data);
      if (!promptSent) {
        // Boot phase: reset quiet timer; send prompt once output goes quiet.
        if (bootTimer) clearTimeout(bootTimer);
        bootTimer = setTimeout(sendPrompt, BOOT_QUIET_MS);
      } else {
        // Response phase: reset idle timer; capture when output settles.
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(captureAndFinish, idleMs);
      }
    });

    // Session exited cleanly before idle — try to capture the transcript anyway.
    ptyProc.onExit(() => {
      if (settled) return;
      const text = ownAnswer();
      finish(text ? { ok: true, text } : { ok: false, error: 'no assistant response found in transcript' });
    });
  });
}
