/**
 * Asks the Claude CLI what is on the owner's Claude account: every connector
 * (Settings > Connections > Claude connectors, owner 2026-10-02), with whether
 * each is signed in, and the owner's own servers. `claude mcp list`
 * checks every server, so it takes a few seconds; it runs in the background at
 * app start, when the owner opens Connections, and on Refresh.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { buildPtyEnv } from './ptyEnv';
import { buildCmdCommandLine, type ProcessLaunch } from './pty';
import { hardKillTree } from './procKill';
import { userShellPath } from './shellEnv';
import { parseMcpList, type McpList } from '../shared/claudeConnectors';

/** The Claude CLI to ask: the default command's binary when that is Claude,
 *  else plain `claude`. The connector is on the Claude account whatever
 *  engine the team runs, and another CLI's `mcp list` would say nothing. */
export function claudeBinFor(defaultCommand: string | undefined): string {
  // Words, with a quoted path kept whole ("C:\\Program Files\\...\\claude.exe"),
  // skipping leading VAR=value settings.
  const words = (defaultCommand ?? '').trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const first = (words.find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) ?? '').replace(/^["']|["']$/g, '');
  const leaf = (first.split(/[\\/]/).pop() ?? '').replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
  return leaf === 'claude' ? first : 'claude';
}

/** How to run `claude mcp list`. On Windows an npm install puts a `claude.cmd`
 *  launcher on PATH, and execFile cannot start a `.cmd` file directly, so the
 *  status read was always "Couldn't check" there (docs/designs/
 *  windows-11-installer.md, E2). It runs through cmd.exe with the same quoting
 *  agents' terminals use. */
export function mcpListLaunch(platform: NodeJS.Platform, binPath: string, comSpec = 'cmd.exe'): ProcessLaunch {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(binPath)) {
    return { file: comSpec, args: [buildCmdCommandLine(binPath, ['mcp', 'list'])], windowsVerbatimArguments: true };
  }
  return { file: binPath, args: ['mcp', 'list'] };
}

/** One `claude mcp list` run. Claude Code 2.1.287 exits 0 even when a server
 *  fails its health check; older versions exited non-zero while still printing
 *  the list, so the output is read whenever there is some and the run is marked
 *  incomplete. A run killed at the time limit printed only part of the list, so
 *  it is reported as timed out.
 *
 *  The time limit stops the whole process tree, not just the direct child:
 *  that child is cmd.exe for a Windows npm install, and `claude` starts every
 *  MCP server the owner has, so execFile's own timeout left them running. Off
 *  Windows the run leads its own process group (spawn, since execFile drops
 *  `detached`), which hardKillTree stops. */
function runMcpList(binPath: string, timeoutMs: number): Promise<{ stdout: string; failed: boolean; timedOut: boolean }> {
  // Never read the account with connectors switched off: that flag is for agents.
  const env = buildPtyEnv(process.env, process.platform === 'win32' ? (process.env.PATH ?? '') : userShellPath());
  delete env.ENABLE_CLAUDEAI_MCP_SERVERS;
  // A server that hangs gives up well inside the 30 s limit, so one stuck
  // server of the owner's never turns every read into a timeout.
  env.MCP_TIMEOUT = env.MCP_TIMEOUT || '10000';
  return new Promise((resolve) => {
    let stdout = '';
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const done = (failed: boolean, signal?: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, failed, timedOut: timedOut || !!signal });
    };
    let child: ChildProcess;
    try {
      const launch = mcpListLaunch(process.platform, binPath, process.env.ComSpec || 'cmd.exe');
      child = spawn(launch.file, launch.args, { cwd: homedir(), env, windowsVerbatimArguments: launch.windowsVerbatimArguments, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      // spawn throws at once for a binary it cannot start (e.g. a .cmd on Windows).
      resolve({ stdout: '', failed: true, timedOut: false });
      return;
    }
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.on('error', () => done(true));
    child.on('close', (code, signal) => done(code !== 0, signal));
    timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) hardKillTree(child.pid);
    }, timeoutMs);
  });
}

/** Why a read of the Claude account failed, for the log. */
export type McpListFailure = 'no-cli' | 'no-servers' | 'timeout';

/** Every connector on the Claude account and the owner's own servers, or why
 *  the read failed. A run that printed no server line (signed out, a timeout,
 *  a new format) is a failed read; a signed-in account with no connectors
 *  still lists the owner's other servers or, with none at all, nothing. */
export async function readClaudeMcpList(binPath: string | null, timeoutMs = 30_000): Promise<{ ok: true; list: McpList; complete: boolean } | { ok: false; why: McpListFailure }> {
  if (!binPath) return { ok: false, why: 'no-cli' };
  const { stdout, failed, timedOut } = await runMcpList(binPath, timeoutMs);
  if (timedOut) return { ok: false, why: 'timeout' };
  const list = parseMcpList(stdout);
  // A run that exited non-zero may have stopped part way (Claude Code 2.1.287
  // exits 0 even when a server fails its check), so the caller never lets it
  // remove anything.
  if (list) return { ok: true, list, complete: !failed };
  // "No MCP servers configured." is a successful read of an empty account.
  if (!failed && /no mcp servers configured/i.test(stdout)) return { ok: true, list: { connectors: [], servers: [] }, complete: true };
  return { ok: false, why: 'no-servers' };
}
