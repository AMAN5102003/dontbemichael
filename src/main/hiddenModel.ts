/** Background text checks use Michael's engine, never infer it from a command.
 * Claude keeps its existing runner and models. Codex uses the owner's selected
 * Michael model (or its CLI default), not a model chosen by the app. Other
 * engines fail at once so the callers keep their existing fallbacks. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { runHiddenClaude, type HiddenClaudeOptions, type HiddenClaudeResult } from './hiddenClaude';
import { hardKillTree } from './procKill';
import { parseNpmCmdShim, type ProcessLaunch } from './pty';
import { resolveCommand, userShellPath } from './shellEnv';
import { tokenizeCommand } from '../shared/commandLine';
import type { AgentProvider } from '../shared/agentProvider';

export interface HiddenModelEngine {
  /** Missing on old configs means Claude, regardless of the command's name. */
  engine?: AgentProvider;
  /** The owner's Michael model, used by Codex. Never a Claude fallback model. */
  engineModel?: string;
}

export type HiddenModelOptions = HiddenClaudeOptions & HiddenModelEngine;

export async function runHiddenModel(prompt: string, opts: HiddenModelOptions): Promise<HiddenClaudeResult> {
  if (opts.signal?.aborted) return { ok: false, error: 'cancelled' };
  const { engine = 'claude', engineModel, ...claudeOpts } = opts;
  if (engine === 'claude') return runHiddenClaude(prompt, claudeOpts);
  if (engine !== 'codex' || !opts.noTools) return { ok: false, error: 'engine unavailable' };
  return runHiddenCodex(prompt, opts);
}

/** Use stdin for the prompt: outside text never reaches a shell or the OS
 * command line, and long memory notes do not hit Windows' argv limit. */
export function codexCheckArgs(cwd: string, answer: string, model?: string): string[] {
  return [
    'exec', '--ephemeral', '--ignore-user-config', '--strict-config', '--skip-git-repo-check',
    '-s', 'read-only', '-C', cwd,
    '--disable', 'shell_tool', '--disable', 'unified_exec',
    '--disable', 'apps', '--disable', 'browser_use', '--disable', 'computer_use',
    '--disable', 'multi_agent', '--disable', 'hooks', '--disable', 'remote_plugin',
    '--disable', 'skill_mcp_dependency_install', '--disable', 'view_image',
    '-c', 'agents.enabled=false',
    '-c', 'web_search="disabled"',
    ...(model?.trim() ? ['--model', model.trim()] : []),
    '-o', answer, '-'
  ];
}

/** npm installs Codex as a .cmd shim on Windows. Decode only known npm shims
 * using the terminal's existing parser, then launch the interpreter directly.
 * Unknown batch files are unavailable, never run through cmd.exe. */
export function codexCheckLaunch(
  binary: string, args: string[], platform: string = process.platform,
  resolve: (name: string) => string = resolveCommand
): ProcessLaunch | null {
  const file = resolve(binary);
  if (platform !== 'win32' || /\.(exe|com)$/i.test(file)) return { file, args };
  try {
    const shim = /\.(cmd|bat)$/i.test(file) ? file : `${file}.cmd`;
    if (statSync(shim).size > 8192) return null;
    const target = parseNpmCmdShim(shim, readFileSync(shim, 'utf8'));
    if (!target || !existsSync(target.scriptPath)) return null;
    if (target.interpreter === null) return { file: target.scriptPath, args };
    const adjacent = win32.join(win32.dirname(shim), `${target.interpreter}.exe`);
    const interpreter = existsSync(adjacent) ? adjacent : resolve(target.interpreter);
    if (!/\.(exe|com)$/i.test(interpreter)) return null;
    return { file: interpreter, args: [target.scriptPath, ...args] };
  } catch { return null; }
}

function runHiddenCodex(prompt: string, opts: HiddenModelOptions): Promise<HiddenClaudeResult> {
  if (!prompt.trim()) return Promise.resolve({ ok: false, error: 'empty prompt' });
  return new Promise((resolve) => {
    let root: string | undefined;
    let cwd: string;
    let answer: string;
    let launch: ProcessLaunch | null;
    const cleanup = () => { if (root) { try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ } } };
    try {
      // The workspace is empty. The output is outside it and unique per call;
      // neither company files nor a neighbouring check's answer are visible.
      root = mkdtempSync(join(tmpdir(), 'dbm-model-'));
      cwd = join(root, 'workspace');
      answer = join(root, 'answer.txt');
      mkdirSync(cwd);
    } catch { cleanup(); resolve({ ok: false, error: 'could not prepare background check' }); return; }
    try {
      const binary = tokenizeCommand(opts.command || 'codex')[0];
      launch = binary ? codexCheckLaunch(binary, codexCheckArgs(cwd, answer, opts.engineModel)) : null;
    } catch { cleanup(); resolve({ ok: false, error: 'engine unavailable' }); return; }
    if (!launch) { cleanup(); resolve({ ok: false, error: 'engine unavailable' }); return; }
    if (opts.signal?.aborted) { cleanup(); resolve({ ok: false, error: 'cancelled' }); return; }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(launch.file, launch.args, {
        cwd, env: { ...process.env, PATH: userShellPath(), ...opts.env },
        shell: false, windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['pipe', 'ignore', 'ignore']
      });
    } catch { cleanup(); resolve({ ok: false, error: 'engine unavailable' }); return; }

    let settled = false;
    const finish = (result: HiddenClaudeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      // Hidden checks must not leave a CLI or its descendants behind on cancel,
      // timeout or error. POSIX spawn above owns its process group.
      if (child.pid && child.exitCode === null && child.signalCode === null) hardKillTree(child.pid);
      cleanup();
      resolve(result);
    };
    const onAbort = () => finish({ ok: false, error: 'cancelled' });
    const timer = setTimeout(() => finish({ ok: false, error: 'hidden session timed out' }), opts.timeoutMs ?? 180_000);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', () => finish({ ok: false, error: 'engine unavailable' }));
    child.stdin?.on('error', () => finish({ ok: false, error: 'could not submit background check' }));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) { finish({ ok: false, error: 'background check failed' }); return; }
      try {
        if (statSync(answer).size > 1_048_576) { finish({ ok: false, error: 'background answer too large' }); return; }
        const text = readFileSync(answer, 'utf8').trim();
        if (!text) { finish({ ok: false, error: 'no assistant response' }); return; }
        // Claude retains its streaming preview. Codex publishes only its final
        // answer, never CLI diagnostics as a work-style draft.
        try { opts.onScreenText?.(text); } catch { /* a preview never breaks the call */ }
        finish({ ok: true, text });
      } catch { finish({ ok: false, error: 'no assistant response' }); }
    });
    if (opts.signal?.aborted) { onAbort(); return; }
    child.stdin?.end(prompt);
  });
}
