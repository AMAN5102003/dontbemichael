/**
 * Screenshots the owner pastes into a composer (clipboard:saveImage). Only the
 * file's path goes into the message, and a queued message can wait for a busy
 * team member across a quit or a restart, so the file lives in the app's own
 * folder, not the OS temp folder a restart may clear. Agents read it there as
 * they read the temp folder: it is outside every folder they are kept out of
 * (folderAccess.ts).
 *
 * A file is removed only once it is old, at startup, and never while a saved
 * queue still holds a message naming it. Not on delivery: the path is typed
 * into the agent's terminal, and the agent opens the file later in its turn, or
 * in a later one.
 *
 * Electron-free, so tests run under plain node.
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** How long a pasted screenshot is kept once no queued message names it. */
export const PASTE_KEEP_MS = 14 * 24 * 60 * 60 * 1000;

const PASTE_NAME = /^paste-\d+\.png$/;

export function pastesDir(userData: string): string {
  return join(userData, 'pastes');
}

/** Write one pasted screenshot and say where it is. */
export function savePaste(dir: string, png: Buffer, now = Date.now()): { path: string; name: string } {
  mkdirSync(dir, { recursive: true });
  const name = `paste-${now}.png`;
  const path = join(dir, name);
  writeFileSync(path, png);
  return { path, name };
}

/** Remove pasted screenshots older than `maxAgeMs`, except one named in
 *  `waiting` (the saved queues, as text). Best effort. */
export function sweepOldPastes(dir: string, maxAgeMs = PASTE_KEEP_MS, now = Date.now(), waiting = ''): void {
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!PASTE_NAME.test(name) || waiting.includes(name)) continue;
    const p = join(dir, name);
    try {
      if (now - statSync(p).mtimeMs > maxAgeMs) rmSync(p, { force: true });
    } catch { /* gone already */ }
  }
}
