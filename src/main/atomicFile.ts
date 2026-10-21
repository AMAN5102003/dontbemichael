/**
 * Write a file so a crash or power loss never leaves it half written.
 *
 * The data goes to a temporary file beside the target, is flushed to disk, and
 * only then is renamed over the target (rename is atomic on the same volume).
 * A reader sees the old file or the new one, never a torn mix. If anything
 * fails, the temporary file is removed and the old file is left untouched.
 *
 * First user: the secret store (integrations.ts), which holds every saved
 * password and key (mailboxes, engines, integrations) in one file, so a torn
 * write would lose all of them at once.
 *
 * Electron-free, and `ops` is injectable, so tests can fail any step.
 */
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { closeSync, fsyncSync, lstatSync, openSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';

export interface AtomicFileOps {
  openSync: typeof openSync;
  /** Writes `data` and returns the bytes written. */
  writeSync: (fd: number, data: string) => number;
  fsyncSync: typeof fsyncSync;
  closeSync: typeof closeSync;
  renameSync: typeof renameSync;
  rmSync: typeof rmSync;
  /** Blocks for `ms`; the rename retry's wait. */
  sleepSync: (ms: number) => void;
  /** Which system's rename rules apply; only Windows retries a held rename. */
  platform: NodeJS.Platform;
}

/** Rename errors that mean "the target is briefly held", not "this can never
 *  work": on Windows, antivirus and backup tools open a freshly written file.
 *  Elsewhere these errors are permanent, and the wait would only freeze the
 *  main process, so only Windows retries. */
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** True when a rename that threw `e` on `platform` is worth trying again (see BUSY). */
export function isHeldRename(e: unknown, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' && BUSY.has((e as NodeJS.ErrnoException | undefined)?.code ?? '');
}
/** Block this thread for `ms` (a held file, a git index lock). */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Waits before each retry of a held rename: about 1.3 s in all, at most once
 *  per save (docs/designs/windows-11-installer.md, E2). */
export const RENAME_RETRY_MS = [100, 300, 900];

const defaultOps: AtomicFileOps = {
  openSync,
  // writeFileSync keeps writing until every byte is down; a single
  // fs.writeSync may stop short on a nearly full disk.
  writeSync: (fd, data) => { writeFileSync(fd, data, 'utf8'); return Buffer.byteLength(data, 'utf8'); },
  fsyncSync,
  closeSync,
  renameSync,
  rmSync,
  sleepSync,
  platform: process.platform
};

function renameWithRetry(from: string, to: string, ops: AtomicFileOps): void {
  for (let attempt = 0; ; attempt++) {
    try {
      ops.renameSync(from, to);
      return;
    } catch (e) {
      if (!isHeldRename(e, ops.platform) || attempt >= RENAME_RETRY_MS.length) throw e;
      ops.sleepSync(RENAME_RETRY_MS[attempt]);
    }
  }
}

/** A temp name writeFileAtomic makes beside `path`: `<name>.<12 hex>.tmp`. */
const TEMP_SUFFIX = /^\.[0-9a-f]{12}\.tmp$/;

/** Remove temp files that writeFileAtomic left beside `path` when a crash hit
 *  before the rename. Only ones older than `maxAgeMs` go: a younger one may be
 *  a write still in progress. Best effort; nothing reads these files. */
export function sweepStaleTemps(path: string, maxAgeMs = 60_000, now = Date.now()): void {
  const dir = dirname(path);
  const name = basename(path);
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (!entry.startsWith(name) || !TEMP_SUFFIX.test(entry.slice(name.length))) continue;
    const p = join(dir, entry);
    try {
      const st = lstatSync(p);
      if (st.isFile() && now - st.mtimeMs > maxAgeMs) rmSync(p, { force: true });
    } catch { /* gone already, or not ours to remove */ }
  }
}

export function writeFileAtomic(path: string, data: string, mode = 0o600, ops: AtomicFileOps = defaultOps): void {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  // Only a temp file this call created is removed on failure.
  let created = false;
  try {
    // 'wx': a new file only, never one already there (or a link) at that name.
    const fd = ops.openSync(tmp, 'wx', mode);
    created = true;
    try {
      // A short write must never be renamed into place: that is the torn file
      // this exists to prevent.
      const want = Buffer.byteLength(data, 'utf8');
      const wrote = ops.writeSync(fd, data);
      if (wrote !== want) throw new Error(`short write: ${wrote} of ${want} bytes`);
      ops.fsyncSync(fd);
    } finally {
      ops.closeSync(fd);
    }
    renameWithRetry(tmp, path, ops);
  } catch (e) {
    if (created) { try { ops.rmSync(tmp, { force: true }); } catch { /* nothing left to clean */ } }
    throw e;
  }
  // Flush the folder too, so the rename itself survives a power cut. Best
  // effort: the new file is already in place, and Windows can't open a folder.
  try {
    const dir = ops.openSync(dirname(path), 'r');
    try { ops.fsyncSync(dir); } finally { ops.closeSync(dir); }
  } catch { /* the write already succeeded */ }
}
