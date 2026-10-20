/**
 * Company knowledge documents the owner opened from Settings (owner,
 * 2026-10-19): each opens in the owner's own app from the store's copy, and a
 * save there is read in again, so agents search what the owner wrote.
 *
 *   Settings ─ Open ─► open(id) ─► the stored copy in the default app
 *                                   └─ watched: a save with new content ─► reindex ─► changed()
 *   Company foundations ─► a read only copy, never watched: the app rewrites it.
 */
import { chmodSync, copyFileSync, mkdirSync, readFileSync, unwatchFile, watchFile, type StatWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export interface KnowledgeEditsDeps {
  /** The file to open for a document, and its tags. */
  docFile: (id: string) => { path: string; meta: { title?: string; tags?: string[] } } | null;
  /** Read the document in again; throws a plain reason when it can't. */
  reindex: (id: string) => Promise<unknown>;
  /** Open a path in the owner's default app; '' when it opened, else the reason. */
  openPath: (path: string) => Promise<string>;
  /** Where read only copies go. */
  tempDir: () => string;
  /** A document was read in again (search by meaning and the list refresh). */
  changed: (id: string, error?: string) => void;
  intervalMs?: number;
}

/** At most this many opened documents are watched; the oldest stops first. */
export const MAX_WATCHED = 25;

const hashOf = (path: string): string | null => {
  try { return createHash('sha1').update(readFileSync(path)).digest('hex'); } catch { return null; }
};

export class KnowledgeEdits {
  private watched = new Map<string, { path: string; hash: string | null; busy: boolean; listener: () => void; watcher: StatWatcher }>();

  constructor(private readonly d: KnowledgeEditsDeps) {}

  /** The Company foundations copy is the app's own (office-foundations.md):
   *  the owner reads it; editing it comes in a later release. */
  static readOnly(meta: { tags?: string[] }): boolean {
    return Array.isArray(meta.tags) && meta.tags.includes('foundations');
  }

  async open(id: string): Promise<{ ok: true; readOnly: boolean } | { ok: false; error: string }> {
    const f = this.d.docFile(id);
    if (!f) return { ok: false, error: 'missing' };
    if (KnowledgeEdits.readOnly(f.meta)) {
      const dir = join(this.d.tempDir(), 'company-knowledge');
      mkdirSync(dir, { recursive: true });
      const copy = join(dir, `${(f.meta.title ?? id).replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80)}.md`);
      try { chmodSync(copy, 0o644); } catch { /* not there yet */ }
      copyFileSync(f.path, copy);
      try { chmodSync(copy, 0o444); } catch { /* best effort */ }
      const err = await this.d.openPath(copy);
      return err ? { ok: false, error: err } : { ok: true, readOnly: true };
    }
    const err = await this.d.openPath(f.path);
    if (err) return { ok: false, error: err };
    this.watch(id, f.path);
    return { ok: true, readOnly: false };
  }

  private watch(id: string, path: string): void {
    const had = this.watched.get(id);
    if (had?.path === path) return;
    if (had) this.stop(id);
    while (this.watched.size >= MAX_WATCHED) this.stop(this.watched.keys().next().value as string);
    const entry = { path, hash: hashOf(path), busy: false, listener: () => { void this.check(id); }, watcher: undefined as unknown as StatWatcher };
    entry.watcher = watchFile(path, { interval: this.d.intervalMs ?? 1500, persistent: false }, entry.listener);
    this.watched.set(id, entry);
  }

  /** A save with new content is read in; the same bytes (an editor touching
   *  the file, or our own write) are not. */
  async check(id: string): Promise<void> {
    const e = this.watched.get(id);
    if (!e || e.busy) return;
    const hash = hashOf(e.path);
    if (hash === null) { this.stop(id); return; }
    if (hash === e.hash) return;
    e.busy = true;
    try {
      await this.d.reindex(id);
      e.hash = hash;
      this.d.changed(id);
    } catch (err) {
      e.hash = hash;
      this.d.changed(id, err instanceof Error ? err.message : String(err));
    } finally {
      e.busy = false;
    }
  }

  stop(id: string): void {
    const e = this.watched.get(id);
    if (!e) return;
    unwatchFile(e.path, e.listener);
    this.watched.delete(id);
  }

  stopAll(): void {
    for (const id of [...this.watched.keys()]) this.stop(id);
  }

  watching(): string[] {
    return [...this.watched.keys()];
  }
}
