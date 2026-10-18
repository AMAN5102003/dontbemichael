/**
 * KnowledgeManager — the Electron-main façade over the file-backed enterprise
 * Knowledge Graph store. Owns ingestion (in-app, over IPC) and exposes the same
 * keyword search the agent CLI uses; agents themselves query out-of-process via
 * `resources/kg.cjs` (see docs/design/knowledge-graph.md).
 *
 * All heavy lifting lives in the pure-JS `kg-core.cjs` sidecar (no native deps),
 * required the same way `slack.ts` requires `slack-trigger.cjs`. Mirrors the
 * MemoryManager surface (`active()` / `env()` / `status()`) so it slots into the
 * existing spawn-injection flow.
 */
import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from './config';
import { extractDocumentText, type DocExtraction } from './docText';
import { extractDocumentTextApart } from './docTextProcess';

// Pure-JS core, copied to out/main at build (like slack-trigger.cjs) and shipped
// to process.resourcesPath for the agent CLI (electron-builder extraResources).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('./kg-core.cjs') as KgCore;

interface KgMeta {
  id: string; title: string; source: string; modality: string; mime: string | null;
  origExt: string; bytes: number; tags: string[]; caption: string | null;
  chunkCount: number; addedAt: string; extractor: string; truncated: boolean;
}
interface KgHit {
  docId: string; title: string; source: string; modality: string;
  chunkIdx: number; score: number; snippet: string;
}
interface KgIngestInput {
  srcPath?: string; text?: string; title?: string; tags?: string[];
  caption?: string; modality?: string; source?: string;
  /** How the text was produced, when it was converted before ingest. */
  extractor?: string; mime?: string;
}
interface KgCore {
  ingest(root: string, input: KgIngestInput): { docId: string; chunkCount: number; meta: KgMeta };
  search(root: string, query: string, opts?: { limit?: number }): KgHit[];
  list(root: string): KgMeta[];
  getDoc(root: string, docId: string): { meta: KgMeta; text: string } | null;
  removeDoc(root: string, docId: string): boolean;
  stats(root: string): { docCount: number; chunkCount: number; byModality: Record<string, number> };
}

export interface KnowledgeStatus {
  enabled: boolean;
  root: string;
  docCount: number;
  chunkCount: number;
  byModality: Record<string, number>;
}

export class KnowledgeManager {
  /** Whether the feature flag is on. */
  active(): boolean {
    return readConfig().knowledgeGraph?.enabled === true;
  }

  /** The store directory (config override or <userData>/knowledge). */
  root(): string {
    const override = readConfig().knowledgeGraph?.rootPath;
    if (override && override.trim()) return override;
    return join(app.getPath('userData'), 'knowledge');
  }

  /** Absolute path to the agent CLI (dev: repo resources/; packaged: resourcesPath). */
  private cliPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'kg.cjs')
      : join(app.getAppPath(), 'resources', 'kg.cjs');
  }

  /** Absolute path to the pure-JS core for the out-of-process CLI to require. */
  private corePath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'kg-core.cjs')
      : join(app.getAppPath(), 'src', 'main', 'kg-core.cjs');
  }

  /** Env merged into each agent's spawn so its `kg` CLI hits this store. Empty
   *  when company knowledge is off, so nothing is injected then. */
  env(): Record<string, string> {
    if (!this.active()) return {};
    return { KG_ROOT: this.root(), KG_CLI: this.cliPath(), KG_CORE: this.corePath() };
  }

  /**
   * Company knowledge searched by meaning (owner, 2026-09-25): MemPalace, the
   * local vector store the app already drives for agents' memory, indexes a
   * mirror of the store, one file per document named by its id, with the title
   * and id on top so every search result says which document to `get`.
   * Brought up to date here (missing files written, removed documents' files
   * deleted); MemoryManager indexes the folder into the palace's "company"
   * section. Null when company knowledge is off. `signature` changes whenever
   * the set of documents does, so an unchanged store isn't indexed again.
   */
  meaningMirror(): { dir: string; signature: string } | null {
    if (!this.active()) return null;
    const root = this.root();
    const dir = join(root, 'meaning');
    try { mkdirSync(dir, { recursive: true }); } catch { return null; }
    const docs = existsSync(root) ? core.list(root) : [];
    const ids = new Set<string>();
    for (const meta of docs) {
      const id = String(meta.id ?? '');
      if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
      ids.add(id);
      const file = join(dir, `${id}.md`);
      if (existsSync(file)) continue;
      const doc = core.getDoc(root, id);
      if (!doc) continue;
      try {
        writeFileSync(file, `Title: ${meta.title ?? id}\nDocument id: ${id}\n\n${doc.text}\n`, 'utf8');
      } catch { /* the next pass retries */ }
    }
    let files: string[] = [];
    try { files = readdirSync(dir); } catch { /* none */ }
    for (const f of files) {
      if (f.endsWith('.md') && !ids.has(f.slice(0, -3))) {
        try { rmSync(join(dir, f), { force: true }); } catch { /* next pass */ }
      }
    }
    return { dir, signature: [...ids].sort().join(',') };
  }

  /** What a running agent needs to search the store: whether it's on, the CLI,
   *  and the store's folder (passed as --root, so no restart is needed). */
  agentAccess(): { active: boolean; cliPath?: string; root?: string } {
    if (!this.active()) return { active: false };
    return { active: true, cliPath: this.cliPath(), root: this.root() };
  }

  status(): KnowledgeStatus {
    const enabled = this.active();
    const root = this.root();
    const s = enabled && existsSync(root)
      ? core.stats(root)
      : { docCount: 0, chunkCount: 0, byModality: {} };
    return { enabled, root, docCount: s.docCount, chunkCount: s.chunkCount, byModality: s.byModality };
  }

  /** Ingest a file from disk. No-op-safe when off (callers gate on status).
   *
   *  Word, Excel, PowerPoint and PDF are converted to text first (docText.ts);
   *  kg-core keeps the original file either way. A file that can't be read
   *  THROWS with a plain-English reason rather than being stored: storing it
   *  anyway is what used to index a .docx as zip bytes and report success. */
  async ingestFile(srcPath: string, opts: { title?: string; tags?: string[]; caption?: string } = {}) {
    const ex = await this.readDocument(srcPath);
    if (ex.kind === 'unreadable') throw new Error(ex.reason);
    if (ex.kind === 'text') {
      return core.ingest(this.root(), {
        srcPath, ...opts, text: ex.text, modality: ex.modality, extractor: ex.extractor, mime: ex.mime
      });
    }
    return core.ingest(this.root(), { srcPath, ...opts });
  }

  /** Parsed in a process of its own: a big or crafted file parsed here would
   *  freeze every window. Without the built doc-text script, it is read here. */
  private readDocument(srcPath: string): Promise<DocExtraction> {
    const script = join(app.getAppPath(), 'out', 'main', 'docTextCli.js');
    if (!existsSync(script)) return extractDocumentText(srcPath);
    return extractDocumentTextApart(srcPath, { file: process.execPath, args: [script], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  }

  /** Ingest inline text (e.g. pasted content). */
  ingestText(text: string, opts: { title?: string; tags?: string[] } = {}) {
    return core.ingest(this.root(), { text, ...opts });
  }

  search(query: string, limit?: number): KgHit[] {
    if (!existsSync(this.root())) return [];
    return core.search(this.root(), query, { limit });
  }

  list(): KgMeta[] {
    if (!existsSync(this.root())) return [];
    return core.list(this.root());
  }

  get(docId: string): { meta: KgMeta; text: string } | null {
    return core.getDoc(this.root(), docId);
  }

  remove(docId: string): boolean {
    return core.removeDoc(this.root(), docId);
  }
}
