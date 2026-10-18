/**
 * Research's notes, read for the team's shared memory (ship review D2.9).
 * Only plain files inside its own folder: the app reads with the owner's
 * rights, so a link Research made would reach what Research can't (Codex
 * review). Anything else is skipped.
 */
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, opendirSync, openSync, readSync, realpathSync, rmdirSync, statSync, unlinkSync, type Stats } from 'node:fs';
import { dirname, join, sep } from 'node:path';

/** The most one note file may hold; a bigger one is skipped, not read whole
 *  into the app's memory. */
export const MAX_NOTE_BYTES = 256 * 1024;
/** All of Research's notes together, per copy, in bytes, and in files. */
export const MAX_NOTES_TOTAL = 1024 * 1024;
export const MAX_NOTE_FILES = 200;
/** Names looked at in the notes folder, whatever they are. */
export const MAX_NOTE_ENTRIES = 2000;

/** One of Research's own files, read the safe way: a plain file inside its
 *  folder, opened without following a link, at most MAX_NOTE_BYTES, or null.
 *  Every app read of a file Research's shell can write goes through here, since
 *  the app reads with the owner's rights (red team, third ship: memory index,
 *  handoff, procedures). */
export function readResearchFile(agentDir: string, file: string): string | null {
  let root = '';
  try { root = realpathSync(agentDir); } catch { return null; }
  return readOwnIn(root, file);
}

function readOwnIn(root: string, file: string): string | null {
  // Its folder, as it really is, must be inside Research's own.
  try {
    const realDir = realpathSync(dirname(file));
    if (realDir !== root && !realDir.startsWith(root + sep)) return null;
  } catch { return null; }
  // Opened without following a link, and read from that same open file, so
  // nothing can be swapped in between; a file with a second name (a hard
  // link) may be one Research can't read, so it is skipped too.
  let fd = -1;
  try {
    // Without waiting: a pipe Research made would otherwise hold the open
    // forever and freeze the app (ship review). Then only a plain file, of
    // a size a note can have.
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > MAX_NOTE_BYTES) return null;
    // The open file must be the one its path names inside the folder now,
    // so a folder swapped for a link between the check and the open is
    // caught (verification of the Codex fix).
    const real = realpathSync(file);
    if (!real.startsWith(root + sep)) return null;
    const now = statSync(real);
    if (now.ino !== st.ino || now.dev !== st.dev) return null;
    // Read to its size from this open file, into a buffer one byte past it:
    // a file that grew since the check is skipped (ship review pass 2).
    const buf = Buffer.allocUnsafe(st.size + 1);
    let n = 0;
    for (let r = 1; r > 0 && n < buf.length; n += r) r = readSync(fd, buf, n, buf.length - n, null);
    return n > st.size ? null : buf.subarray(0, n).toString('utf8');
  } catch { return null; } finally {
    if (fd >= 0) try { closeSync(fd); } catch { /* closed */ }
  }
}

/** A folder inside Research's own, made safe for the app to act in: each
 *  step down from its folder must be a real folder, not a link Research made
 *  to somewhere else, since the app moves and deletes there with the owner's
 *  rights (red team, third ship). A link or file in the way is removed and a
 *  real folder made. Null when that can't be done. */
export function ownResearchDir(agentDir: string, ...parts: string[]): string | null {
  let cur = agentDir;
  for (const p of ['', ...parts]) {
    if (p) cur = join(cur, p);
    let st: Stats | null = null;
    try { st = lstatSync(cur); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
    if (st && !st.isDirectory()) {
      // Only the link or file itself goes, never what a link points at:
      // unlink, or rmdir for a link to a folder on Windows, which can't be
      // unlinked. Not rmSync: newer Node (24 here) refuses a link to a folder
      // with ERR_FS_EISDIR, so a planted link was never replaced.
      try { unlinkSync(cur); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          try { rmdirSync(cur); } catch { return null; }
        }
      }
      st = null;
    }
    if (!st) { try { mkdirSync(cur); } catch { return null; } }
  }
  return isOwnResearchDir(agentDir, cur, ...parts) ? cur : null;
}

/** True while `dir` is still the real folder `parts` names inside Research's
 *  own. Checked again right before the app deletes or moves anything there. */
export function isOwnResearchDir(agentDir: string, dir: string, ...parts: string[]): boolean {
  try {
    return lstatSync(dir).isDirectory() && realpathSync(dir) === join(realpathSync(agentDir), ...parts);
  } catch { return false; }
}

export function readResearchNotes(agentDir: string): string {
  let root = '';
  try { root = realpathSync(agentDir); } catch { return ''; }
  const readOwn = (file: string): string | null => readOwnIn(root, file);
  const parts: string[] = [];
  let total = 0;
  const add = (t: string | null): boolean => {
    if (!t) return true;
    const bytes = Buffer.byteLength(t);
    if (total + bytes > MAX_NOTES_TOTAL || parts.length >= MAX_NOTE_FILES) return false;
    total += bytes;
    parts.push(t);
    return true;
  };
  add(readOwn(join(agentDir, 'memory.md')));
  try {
    // The folder itself must be Research's own, not a link to a big tree
    // elsewhere, and only so many names are looked at (Codex review).
    const dir = join(agentDir, 'memory');
    if (!lstatSync(dir).isDirectory() || realpathSync(dir) !== join(root, 'memory')) return parts.join('\n\n').trim();
    // Read one name at a time and stop at the cap, so a huge folder is never
    // listed whole (Codex review).
    const names: string[] = [];
    const d = opendirSync(dir);
    try {
      for (let e = d.readSync(); e && names.length < MAX_NOTE_ENTRIES; e = d.readSync()) names.push(e.name);
    } finally { d.closeSync(); }
    for (const f of names.sort()) {
      if (!f.endsWith('.md') || f === 'inbox.md') continue;
      // Past the total the rest are not copied (ship review pass 2).
      if (!add(readOwn(join(agentDir, 'memory', f)))) break;
    }
  } catch { /* none */ }
  return parts.join('\n\n').trim();
}
