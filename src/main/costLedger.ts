/**
 * The cost ledger, in harness.db (TODOS.md, owner decision D17 in
 * docs/designs/team-performance.md).
 *
 * One row per usage sample, with the keys `hive/cost-ledger.jsonl` had, plus
 * the office like the telemetry tables. Rows are running totals per agent and
 * session; costLifetime.ts folds them with the restart rule.
 *
 *   appendCostLedger ─► before the import: the old file, as before
 *                    └► after it:         cost_ledger (the file is not written again)
 *
 * The old file sits in the hive, where agents can write, and it grows forever.
 * On first use its rows are copied in once, streamed, and from then on nothing
 * the app decides reads it. The file stays on disk: it is the owner's data.
 */
import { closeSync, createReadStream, fstatSync, openSync, readSync, statSync } from 'node:fs';
import type Database from 'better-sqlite3';

/** One ledger row, keys exactly as the file had them. */
export interface CostLedgerRow {
  agent_id: string;
  session_id: string | null;
  ts: number;
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  model: string | null;
  usd: number;
}

/** A row as the lifetime fold reads it back. */
export interface CostLedgerPoint {
  id: number;
  agent_id: string;
  session_id: string | null;
  usd: number;
}

/** How far an office's import got: bytes of the file copied, and whether it is done. */
interface ImportMark { v: 1; offset: number; rows: number; done?: true }

const markerKey = (office: string): string => `cost-ledger:import:${office}`;
/** Bytes per import step; each step's rows land in one transaction. */
const CHUNK = 256 * 1024;
/** Rows per page when the backfill reads the table. */
const PAGE = 5000;

const INSERT = `INSERT INTO cost_ledger (office, agent_id, session_id, ts, input, output, cache_read, cache_creation, model, usd)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const MARK = `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

function readMark(db: Database.Database, office: string): ImportMark | null {
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(markerKey(office)) as { value: string } | undefined;
    const m = row ? JSON.parse(row.value) as ImportMark : null;
    return m && typeof m.offset === 'number' ? m : null;
  } catch { return null; }
}

/** Whether this office's old file has been copied in, so the table is its ledger. */
export function ledgerImported(db: Database.Database, office: string): boolean {
  return readMark(db, office)?.done === true;
}

/** Every row of an office's ledger, oldest first, a page at a time so a long
 *  read never holds the main process (Pulse's backfill). */
export async function* ledgerRows(db: Database.Database, office: string): AsyncGenerator<{ agent_id: string; session_id: string | null; ts: number; usd: number }> {
  const page = db.prepare('SELECT id, agent_id, session_id, ts, usd FROM cost_ledger WHERE office = ? AND id > ? AND ts IS NOT NULL ORDER BY id LIMIT ?');
  let after = 0;
  for (;;) {
    const rows = page.all(office, after, PAGE) as Array<{ id: number; agent_id: string; session_id: string | null; ts: number; usd: number }>;
    for (const r of rows) yield r;
    if (rows.length < PAGE) return;
    after = rows[rows.length - 1].id;
    await new Promise((r) => setImmediate(r));
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A row copied from the old file, where a line may have no time. */
type FileRow = Omit<CostLedgerRow, 'ts'> & { ts: number | null };

/** One line of the old file as a row, or null for a line the fold skips too. */
function rowOf(line: string): FileRow | null {
  let r: Record<string, unknown>;
  try { r = JSON.parse(line); } catch { return null; }
  if (!r || typeof r !== 'object' || typeof r.agent_id !== 'string') return null;
  return {
    agent_id: r.agent_id,
    // Kept as the fold keys it (`session_id ?? ''`), so totals match the file's.
    session_id: r.session_id == null ? null : String(r.session_id),
    // No time stays no time: the backfill skips such a line, as it did in the file.
    ts: typeof r.ts === 'number' && Number.isFinite(r.ts) ? r.ts : null,
    input: num(r.input),
    output: num(r.output),
    cache_read: num(r.cache_read),
    cache_creation: num(r.cache_creation),
    model: typeof r.model === 'string' ? r.model : null,
    usd: num(r.usd)
  };
}

/** The bytes of a file from `offset` to its end right now (none if it is gone). */
function readFrom(file: string, offset: number): Buffer {
  let fd: number | null = null;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    if (size <= offset) return Buffer.alloc(0);
    const buf = Buffer.alloc(size - offset);
    return buf.subarray(0, readSync(fd, buf, 0, buf.length, offset));
  } catch { return Buffer.alloc(0); } finally { if (fd !== null) closeSync(fd); }
}

export class CostLedgerStore {
  /** Prepared once per handle: the breaker beat writes every 30 s. */
  private stmts: { db: Database.Database; ins: Database.Statement; mark: Database.Statement } | null = null;
  /** Offices whose old file is copied in. */
  private readonly done = new Set<string>();
  private readonly importing = new Set<string>();
  /** Offices whose import failed in this process: tried again on the next start, not every tick. */
  private readonly stopped = new Set<string>();
  private loggedFailure = false;

  constructor(
    private readonly db: () => Database.Database | null,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Whether the table is this office's ledger yet. Never throws. */
  imported(office: string): boolean {
    if (this.done.has(office)) return true;
    const db = this.db();
    if (db && ledgerImported(db, office)) this.done.add(office);
    return this.done.has(office);
  }

  /** Write one row. False while the old file is still this office's ledger
   *  (the caller writes the file then). A failed write is dropped and logged
   *  once, like the telemetry store: the next sample carries the running total. */
  append(office: string, row: CostLedgerRow): boolean {
    if (!this.imported(office)) return false;
    try {
      this.statements().ins.run(office, row.agent_id, row.session_id, row.ts, row.input, row.output, row.cache_read, row.cache_creation, row.model, row.usd);
      this.loggedFailure = false;
    } catch (e) {
      if (!this.loggedFailure) { this.loggedFailure = true; console.error('[cost] ledger write failed:', e); }
    }
    return true;
  }

  /** Rows after a cursor, oldest first, for the lifetime fold. Null when the
   *  table cannot be read, so the fold keeps its last good totals. */
  rowsAfter(office: string, afterId: number, limit: number): CostLedgerPoint[] | null {
    const db = this.db();
    if (!db) return null;
    try {
      return db.prepare('SELECT id, agent_id, session_id, usd FROM cost_ledger WHERE office = ? AND id > ? ORDER BY id LIMIT ?')
        .all(office, afterId, limit) as CostLedgerPoint[];
    } catch { return null; }
  }

  /**
   * Copy an office's old file in, once. Streamed a chunk at a time; each
   * chunk's rows and the bytes read so far are saved together, so a quit
   * midway resumes where it stopped and no row is copied twice. The file keeps
   * taking new rows while this runs; the last bytes are read in one go with
   * the switch, so nothing lands in the file after the copy and no row lands
   * in the table out of order. Resolves with the rows copied; never throws.
   */
  async importFile(office: string, file: string): Promise<number> {
    if (this.importing.has(office) || this.stopped.has(office) || this.imported(office) || !this.db()) return 0;
    this.importing.add(office);
    try {
      return await this.copy(office, file);
    } catch (e) {
      this.stopped.add(office);
      console.error('[cost] ledger import stopped, it resumes on the next start:', e);
      return 0;
    } finally {
      this.importing.delete(office);
    }
  }

  private async copy(office: string, file: string): Promise<number> {
    let mark: ImportMark = readMark(this.statements().db, office) ?? { v: 1, offset: 0, rows: 0 };
    const before = mark.rows;
    let size = 0;
    try { size = statSync(file).size; } catch { /* no file: nothing to copy */ }
    if (size > mark.offset) {
      let tail: Buffer = Buffer.alloc(0);
      for await (const chunk of createReadStream(file, { start: mark.offset, end: size - 1, highWaterMark: CHUNK })) {
        const buf = tail.length ? Buffer.concat([tail, chunk as Buffer]) : chunk as Buffer;
        const cut = buf.lastIndexOf(0x0a); // '\n'
        if (cut === -1) { tail = buf; continue; }
        tail = buf.subarray(cut + 1);
        mark = this.save(office, mark, buf.subarray(0, cut + 1), false);
      }
    }
    // Synchronous from here: no beat can write between the last read and the switch.
    mark = this.save(office, mark, readFrom(file, mark.offset), true);
    this.done.add(office);
    return mark.rows - before;
  }

  /** Copy whole lines (and, at the end, a last line with no newline if it
   *  parses) and move the mark past them, in one transaction. */
  private save(office: string, mark: ImportMark, bytes: Buffer, last: boolean): ImportMark {
    const { db, ins, mark: setMark } = this.statements();
    const rows: FileRow[] = [];
    for (const line of bytes.toString('utf8').split('\n')) {
      const r = line ? rowOf(line) : null;
      if (r) rows.push(r);
    }
    const next: ImportMark = { v: 1, offset: mark.offset + bytes.length, rows: mark.rows + rows.length, ...(last ? { done: true as const } : {}) };
    db.transaction(() => {
      for (const r of rows) ins.run(office, r.agent_id, r.session_id, r.ts, r.input, r.output, r.cache_read, r.cache_creation, r.model, r.usd);
      setMark.run(markerKey(office), JSON.stringify(next), this.now());
    })();
    return next;
  }

  private statements(): { db: Database.Database; ins: Database.Statement; mark: Database.Statement } {
    const db = this.db();
    if (!db) throw new Error('harness.db is not open');
    if (this.stmts?.db !== db) this.stmts = { db, ins: db.prepare(INSERT), mark: db.prepare(MARK) };
    return this.stmts;
  }
}
