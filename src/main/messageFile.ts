/**
 * Reading a file an agent could have written, with the owner's rights: never
 * through a link, never waiting on a pipe, never a file too big to be a
 * message (red team, third ship). Shared by the hive's router and Pulse's
 * one-time backfill of its lists (ship review 2026-10-17).
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** The most a message file may hold for the app to read it. */
export const MAX_MESSAGE_FILE_BYTES = 4 * 1024 * 1024;

/** A message file read without following a link or waiting on a pipe: an
 *  agent's own folder may hold either. Null for anything but a plain file. */
export function readMessageFile(path: string): string | null {
  let fd = -1;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_MESSAGE_FILE_BYTES) return null;
    return readFileSync(fd, 'utf8');
  } catch { return null; } finally {
    if (fd >= 0) try { closeSync(fd); } catch { /* closed */ }
  }
}

/** `parts` inside `base` when every step is a real folder, not a link an
 *  agent made to somewhere else; null otherwise. Reads only, changes nothing. */
export function realFolderIn(base: string, ...parts: string[]): string | null {
  let cur = base;
  try {
    for (const p of ['', ...parts]) {
      if (p) cur = join(cur, p);
      if (!lstatSync(cur).isDirectory()) return null;
    }
    return realpathSync(cur) === join(realpathSync(base), ...parts) ? cur : null;
  } catch { return null; }
}

/** The id the app gives a Research answer it delivers: the same for the same
 *  file (its name and text), so an answer delivered again after a crash
 *  replaces itself. The backfill finds delivered answers by it. */
export function researchDeliveredId(fileKey: string): string {
  return `research-${createHash('sha256').update(fileKey).digest('hex').slice(0, 24)}`;
}
