/**
 * The installed Claude Code version, for the model floor in
 * src/shared/modelCliFloor.ts.
 *
 * `claude --version` is a process launch, so the answer is cached per binary.
 * The key is the resolved real path plus its mtime: the native installer
 * updates by pointing ~/.local/bin/claude at a new versions/<n> file, and npm
 * rewrites the file in place, so either kind of update is noticed on the next
 * spawn without a restart. A probe that fails or times out answers null
 * ("unknown"), which never blocks a spawn.
 */
import { execFile } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { parseCliVersion } from '../shared/modelCliFloor';

const cache = new Map<string, string | null>();

/** How the probe runs `claude --version`. An npm install on Windows is a .cmd
 *  shim, which Node refuses to start without cmd.exe (EINVAL), so it goes
 *  through cmd.exe, quoted for `/s`, the way claudeAuthStatusCommand does. */
export function versionCommand(platform: string, binPath: string, comSpec?: string): { file: string; args: string[]; verbatim: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(binPath)) {
    return { file: comSpec || 'cmd.exe', args: ['/d', '/s', '/c', `""${binPath}" --version"`], verbatim: true };
  }
  return { file: binPath, args: ['--version'], verbatim: false };
}

export async function claudeCliVersion(binPath: string | null): Promise<string | null> {
  if (!binPath) return null;
  let key: string;
  try {
    const real = realpathSync(binPath);
    key = `${real}:${statSync(real).mtimeMs}`;
  } catch { return null; }
  if (cache.has(key)) return cache.get(key)!;
  const cmd = versionCommand(process.platform, binPath, process.env.ComSpec);
  const version = await new Promise<string | null>((resolve) => {
    // execFile throws, instead of calling back, when it cannot start the file
    // at all. That is "unknown" too, never a rejection into the spawn.
    try {
      execFile(cmd.file, cmd.args, { timeout: 5000, encoding: 'utf8', windowsVerbatimArguments: cmd.verbatim }, (err, stdout) => {
        resolve(err ? null : parseCliVersion(String(stdout)));
      });
    } catch { resolve(null); }
  });
  // Only a real answer is cached: a timeout on a busy machine is worth retrying.
  if (version) cache.set(key, version);
  return version;
}
