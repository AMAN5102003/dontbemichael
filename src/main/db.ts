/**
 * PersistStore — durable harness state in SQLite (better-sqlite3, synchronous).
 *
 * Phase A scope (the rest of the renderer state stays in localStorage for now):
 *   - kv:               scalar app state. Today: the main window's bounds.
 *   - command_history:  NET-NEW — every prompt the user submits to an agent.
 *
 * Lives in the Electron MAIN process (better-sqlite3 is native + synchronous);
 * the renderer reaches it over IPC. The DB file sits next to config.json under
 * app.getPath('userData'). WAL mode so reads never block the single writer.
 *
 * Schema evolves via PRAGMA user_version migrations: an ordered array where
 * migration N runs when user_version < N+1, then bumps it. NEVER edit a shipped
 * migration — only append. Phases B/C (agents + message_queue mirror) and the
 * cross-lane cost_ledger are reserved as future additive migrations (see below);
 * they are deliberately NOT built in v1.
 */
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';

/** A captured user prompt, as returned to the renderer (camelCase columns). */
export interface CommandHistoryRow {
  id: number;
  agentId: string;
  cwd: string | null;
  text: string;
  ts: number;
}

/**
 * Ordered, append-only migrations. Index N takes the DB from user_version N to
 * N+1. To evolve the schema, APPEND a new function — never edit an existing one
 * (shipped DBs have already run it).
 *
 * FUTURE (do NOT build in v1 — reserved so the array isn't painted into a corner):
 *   - Phase B: `agents` + `message_queue` mirror of the renderer roster/queues
 *     (dual-write), enabling the eventual authority flip off localStorage.
 *   - Cross-lane (Lane A #6): migrate Jim's cost ledger onto this DB so his
 *     circuit-breaker can move off transcript-polling. Column names match his
 *     <harnessHome>/hive/cost-ledger.jsonl keys 1:1 for a straight INSERT…SELECT
 *     (coordinated w/ jim-mq290qkn 2026-06-06):
 *       cost_ledger(id, agent_id, session_id TEXT, ts, input, output,
 *                   cache_read, cache_creation, model TEXT, usd REAL)
 *     Rows are CUMULATIVE snapshots (one per agent per heartbeat beat) — diff
 *     consecutive rows for velocity; index (agent_id, session_id, ts). Additive;
 *     lands as a later migration.
 */
const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // → user_version 1 (Phase A): scalar kv + net-new command history.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,     -- JSON-encoded
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS command_history (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        cwd      TEXT,
        text     TEXT NOT NULL,
        ts       INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ch_agent_ts ON command_history(agent_id, ts DESC);
    `);
  },
  // → user_version 2: Pulse telemetry (docs/designs/team-performance.md, D16).
  // Data points are written only by main; runs, daily totals and the rest are
  // derived and can be rebuilt from the events. Keyed by office (harness home).
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        office   TEXT NOT NULL,
        agent_id TEXT,
        kind     TEXT NOT NULL,
        ts       INTEGER NOT NULL,
        value    REAL,
        attrs    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_te_office_ts ON telemetry_events(office, ts);
      CREATE TABLE IF NOT EXISTS telemetry_runs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        office     TEXT NOT NULL,
        agent_id   TEXT NOT NULL,
        mission_id TEXT NOT NULL,
        dispatched INTEGER NOT NULL,
        start      INTEGER,
        end        INTEGER,
        usd        REAL NOT NULL DEFAULT 0,
        work       INTEGER NOT NULL DEFAULT 0,
        outcome    TEXT,
        relay      INTEGER NOT NULL DEFAULT 0,
        day        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tr_office_start ON telemetry_runs(office, dispatched);
      CREATE TABLE IF NOT EXISTS telemetry_daily (
        office         TEXT NOT NULL,
        agent_id       TEXT NOT NULL,
        day            TEXT NOT NULL,
        usd            REAL NOT NULL DEFAULT 0,
        run_usd        REAL NOT NULL DEFAULT 0,
        tokens         REAL NOT NULL DEFAULT 0,
        emails         INTEGER NOT NULL DEFAULT 0,
        sent           INTEGER NOT NULL DEFAULT 0,
        tasks          INTEGER NOT NULL DEFAULT 0,
        checks         INTEGER NOT NULL DEFAULT 0,
        checks_nothing INTEGER NOT NULL DEFAULT 0,
        away_pieces    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (office, agent_id, day)
      );
      CREATE TABLE IF NOT EXISTS telemetry_failures (
        office TEXT NOT NULL,
        day    TEXT NOT NULL,
        count  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (office, day)
      );
      CREATE TABLE IF NOT EXISTS telemetry_dismissed (
        office    TEXT NOT NULL,
        advice_id TEXT NOT NULL,
        band      INTEGER NOT NULL,
        at        INTEGER NOT NULL,
        PRIMARY KEY (office, advice_id)
      );
      CREATE TABLE IF NOT EXISTS telemetry_applied (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        office    TEXT NOT NULL,
        advice_id TEXT NOT NULL,
        agent_id  TEXT NOT NULL,
        kind      TEXT NOT NULL,
        before    TEXT NOT NULL,
        after     TEXT NOT NULL,
        at        INTEGER NOT NULL,
        undone_at INTEGER
      );
    `);
  },
  // → user_version 3: Pulse's Team at work and Kept safe (owner, 2026-10-15,
  // proposal 3). Working time and turns per member and day; trust layer
  // decisions and rule refusals per day, one counter per key.
  (db) => {
    db.exec(`
      ALTER TABLE telemetry_daily ADD COLUMN busy_ms INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE telemetry_daily ADD COLUMN turns INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS telemetry_safety (
        office TEXT NOT NULL,
        day    TEXT NOT NULL,
        key    TEXT NOT NULL,
        n      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (office, day, key)
      );
    `);
  },
  // → user_version 4: indexes for Pulse's hot reads, so they stay quick as an
  // office ages (ship review, 2026-10-16): a member's open run, the events
  // after the processor's cursor, and the kinds a snapshot reads by day.
  (db) => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tr_open ON telemetry_runs(office, agent_id, id) WHERE end IS NULL;
      CREATE INDEX IF NOT EXISTS idx_te_office_id ON telemetry_events(office, id);
      CREATE INDEX IF NOT EXISTS idx_te_office_kind_ts ON telemetry_events(office, kind, ts);
    `);
  }
];

export class PersistStore {
  private db: Database.Database | null = null;

  /** @param dbPath  Override the DB location (tests). Defaults to userData/harness.db. */
  constructor(private dbPath?: string) {}

  /** Open (creating if needed) and migrate the DB. Idempotent — a second call is
   *  a no-op. Throws if the native module fails to load or the file is unusable;
   *  callers should guard so a DB failure can't crash app startup. */
  open(): void {
    if (this.db) return;
    const path = this.dbPath ?? join(app.getPath('userData'), 'harness.db');
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    this.migrate(db);
    this.db = db;
  }

  private migrate(db: Database.Database): void {
    const version = db.pragma('user_version', { simple: true }) as number;
    for (let i = version; i < MIGRATIONS.length; i++) {
      // Each migration + its version bump run in one transaction so a crash
      // mid-migration never leaves a half-applied schema at the wrong version.
      const run = db.transaction(() => {
        MIGRATIONS[i](db);
        db.pragma(`user_version = ${i + 1}`);
      });
      run();
    }
  }

  /** Close the handle (checkpoints WAL). Safe to call when already closed. */
  close(): void {
    try { this.db?.close(); } catch { /* best-effort on shutdown */ }
    this.db = null;
  }

  get isOpen(): boolean { return this.db !== null; }

  /** The open handle for main-process stores built on this database (Pulse
   *  telemetry), or null when it is closed or failed to open. */
  database(): Database.Database | null { return this.db; }

  // ─── kv (scalar app state) ─────────────────────────────────────────────────

  /** Read a JSON-decoded scalar, or undefined if absent/unparseable. */
  getKv<T = unknown>(key: string): T | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try { return JSON.parse(row.value) as T; } catch { return undefined; }
  }

  /** Upsert a JSON-encoded scalar. */
  setKv(key: string, value: unknown): void {
    if (!this.db) return;
    this.db.prepare(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, JSON.stringify(value), Date.now());
  }

  // ─── command history (net-new) ─────────────────────────────────────────────

  /** Record one submitted prompt. Empty text or missing agent id are ignored. */
  addHistory(entry: { agentId: string; cwd?: string | null; text: string }): void {
    if (!this.db) return;
    const text = (entry.text ?? '').trim();
    if (!text || !entry.agentId) return;
    this.db.prepare('INSERT INTO command_history (agent_id, cwd, text, ts) VALUES (?, ?, ?, ?)')
      .run(entry.agentId, entry.cwd ?? null, text, Date.now());
  }

  /** Most-recent-first history, optionally scoped to one agent. */
  listHistory(agentId?: string, limit = 100): CommandHistoryRow[] {
    if (!this.db) return [];
    const lim = clampLimit(limit, 100);
    const rows = agentId
      ? this.db.prepare(
          'SELECT id, agent_id AS agentId, cwd, text, ts FROM command_history WHERE agent_id = ? ORDER BY ts DESC, id DESC LIMIT ?'
        ).all(agentId, lim)
      : this.db.prepare(
          'SELECT id, agent_id AS agentId, cwd, text, ts FROM command_history ORDER BY ts DESC, id DESC LIMIT ?'
        ).all(lim);
    return rows as CommandHistoryRow[];
  }

  /** Substring search over prompt text, most-recent-first. */
  searchHistory(query: string, limit = 50): CommandHistoryRow[] {
    if (!this.db) return [];
    const q = (query ?? '').trim();
    if (!q) return [];
    const lim = clampLimit(limit, 50);
    // Escape LIKE wildcards so a literal % or _ in the query isn't a metachar.
    const needle = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    return this.db.prepare(
      "SELECT id, agent_id AS agentId, cwd, text, ts FROM command_history WHERE text LIKE ? ESCAPE '\\' ORDER BY ts DESC, id DESC LIMIT ?"
    ).all(needle, lim) as CommandHistoryRow[];
  }
}

/** Coerce an untrusted limit into [1, 1000] with a sane fallback. */
function clampLimit(n: number, fallback: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(1000, v);
}
