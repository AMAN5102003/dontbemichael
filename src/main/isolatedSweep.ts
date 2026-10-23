import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ISOLATED_PREFIX } from './hiddenClaude';

/** Settings folders a file check left behind when the app quit or crashed
 *  mid check (hiddenClaude.ts isolateConfig): they hold the checked text.
 *  Removed once a launch; only old ones, so a check under way is never cut
 *  short. Kept out of hiddenClaude.ts, which never lists a folder. */
export function sweepIsolatedLeftovers(olderThanMs = 10 * 60_000, root: string = tmpdir()): void {
  const cutoff = Date.now() - olderThanMs;
  let names: string[] = [];
  try { names = readdirSync(root); } catch { return; }
  for (const n of names) {
    if (!n.startsWith(ISOLATED_PREFIX)) continue;
    try { if (lstatSync(join(root, n)).mtimeMs < cutoff) rmSync(join(root, n), { recursive: true, force: true, maxRetries: 3 }); } catch { /* next launch */ }
  }
}
