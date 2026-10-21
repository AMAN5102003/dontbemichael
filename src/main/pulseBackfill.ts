/**
 * Pulse's backfill (owner, 2026-10-15, proposal 3): a fresh Pulse does not
 * start at zero. Once per office it reads the weeks before Pulse began
 * recording from what the office already keeps, and writes them as points
 * marked `bf` (from the past):
 *
 *   office log (hive/log.jsonl)  ─► emails organized, emails sent, messages,
 *                                   reopened cards, trust layer decisions,
 *                                   frames from a sender the app could not confirm
 *   members' sessions (transcripts) ─► working time per request, steps a setting stopped
 *   cost ledger (hive/cost-ledger.jsonl) ─► value per member and day
 *
 * The processor folds them like any point, except that a past point never
 * touches today's open runs or presence, and never starts recommendations
 * early (firstDay(live)). Finished tasks and scheduled checks are not
 * rebuilt: their past state is not kept anywhere reliable.
 *
 * Only kinds, times and small attributes are written, never text.
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type Database from 'better-sqlite3';
import { CostFold } from '../shared/costFold';
import { dayKey } from '../shared/teamPerformance';
import type { RefusalGate } from '../shared/pulseSafety';
import type { TelemetryEvent } from './telemetryStore';

/** How far back a backfill reads. */
export const BACKFILL_DAYS = 56;
/** One request's working time counts at most this much. */
const TURN_CAP_MS = 60 * 60_000;
const BF = { bf: 1 } as const;

const markerKey = (office: string): string => `pulse:backfill:${office}`;

/** Whether this office was backfilled already. */
export function backfilled(db: Database.Database, office: string): boolean {
  try { return !!db.prepare('SELECT 1 FROM kv WHERE key = ?').get(markerKey(office)); } catch { return true; }
}

// ─── pure readers (tests drive these) ─────────────────────────────────────

const tsOf = (v: unknown): number => (typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN);

/** A refused step's gate, from the tool a transcript names (hooks.ts gates). */
export function gateOfTool(tool: string, reason: string): RefusalGate | null {
  if (/^AskUserQuestion$/.test(tool)) return null;
  // Every floor control refusal (a paused member or a gated tool) counts as paused, as hooks.ts counts it live.
  if (/paused|gated by the operator|Denied by operator/i.test(reason)) return 'paused';
  if (/QuickBooks/i.test(tool)) return 'quickbooks';
  if (/^mcp__md-mail__/.test(tool)) return 'mail';
  if (/^mcp__/.test(tool)) return 'connector';
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'internet';
  if (tool === 'Bash') return 'sandbox';
  if (/^(Write|Edit|MultiEdit|NotebookEdit|Read|Grep|Glob|LS)$/.test(tool)) return /harness|plumbing|office files/i.test(reason) ? 'office-files' : 'folder';
  return null;
}

/** Working time and refused steps from one session's transcript lines: a
 *  request (a user line that is not a tool result) runs to the last line
 *  before the next request, at most an hour. */
export function readTranscript(lines: Iterable<string>, since: number, until: number): { turns: Array<{ ts: number; ms: number }>; refused: Array<{ ts: number; gate: RefusalGate }> } {
  const turns: Array<{ ts: number; ms: number }> = [];
  const refused: Array<{ ts: number; gate: RefusalGate }> = [];
  const seen = new Set<string>();
  let start = 0, last = 0;
  const close = (): void => { if (start && start >= since && start < until) turns.push({ ts: start, ms: Math.min(Math.max(0, last - start), TURN_CAP_MS) }); start = 0; };
  for (const line of lines) {
    if (!line || line[0] !== '{') continue;
    let e: { type?: string; timestamp?: string; message?: { content?: unknown } };
    try { e = JSON.parse(line); } catch { continue; }
    const t = tsOf(e.timestamp);
    if (!Number.isFinite(t)) continue;
    const content = e.message?.content;
    if (e.type === 'user') {
      const results = Array.isArray(content) ? content.filter((x): x is { type: string; tool_use_id?: string; content?: unknown } => !!x && typeof x === 'object' && (x as { type?: unknown }).type === 'tool_result') : [];
      if (typeof content === 'string' || (Array.isArray(content) && !results.length)) { close(); start = t; last = t; continue; }
      last = Math.max(last, t);
      for (const r of results) {
        const text = typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? '');
        const m = /PreToolUse:([A-Za-z0-9_.-]+) hook (?:error|blocking error)[^:]*:\s*(.{0,200})/.exec(text);
        if (!m || t < since || t >= until) continue;
        const id = r.tool_use_id ?? `${t}:${m[1]}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const gate = gateOfTool(m[1], m[2]);
        if (gate) refused.push({ ts: t, gate });
      }
    } else if (e.type === 'assistant' && start) {
      last = Math.max(last, t);
    }
  }
  close();
  return { turns, refused };
}

/** Points from office log entries in [since, until). `members` are the ids a
 *  message must come from to count as a member's work. */
export function logPoints(entries: Iterable<Record<string, unknown>>, since: number, until: number, members: Set<string>): Array<TelemetryEvent> {
  const out: TelemetryEvent[] = [];
  for (const e of entries) {
    const ts = Number(e.ts);
    if (!Number.isFinite(ts) || ts < since || ts >= until) continue;
    const agent = typeof e.agentId === 'string' ? e.agentId : null;
    switch (e.kind) {
      case 'mail-organize': if (agent) out.push({ agentId: agent, kind: 'email', ts, value: Array.isArray(e.ids) ? e.ids.length : 1, attrs: { ...BF } }); break;
      case 'mail-sent': if (agent) out.push({ agentId: agent, kind: 'sent', ts, attrs: { ...BF } }); break;
      case 'message': {
        const from = typeof e.from === 'string' ? e.from : '';
        if (members.has(from)) out.push({ agentId: from, kind: 'message', ts, attrs: { act: typeof e.act === 'string' ? e.act : null, ...BF } });
        break;
      }
      case 'card-reopen': out.push({ agentId: agent, kind: 'card-reopen', ts, attrs: { id: e.id, ...BF } }); break;
      case 'trust-layer': out.push({ agentId: null, kind: 'trust', ts, attrs: { way: e.way, decision: e.decision, by: e.by ?? null, flagged: e.flagged === true, ...(typeof e.v === 'number' ? { v: e.v } : {}), ...BF } }); break;
      case 'trust-checked': if (e.way === 'in' || e.way === 'out') out.push({ agentId: null, kind: 'trust-checked', ts, attrs: { way: e.way, decision: e.decision, flagged: e.flagged === true, ...BF } }); break;
      case 'trust-held': if (e.way === 'in' || e.way === 'out') out.push({ agentId: null, kind: 'trust-held', ts, attrs: { way: e.way, ...BF } }); break;
      // Before 2026-10-15 an old secret was logged as no-secret too, so only a
      // frame naming the wrong member is sure to be an impostor.
      case 'hook-frame-rejected': if (e.reason === 'wrong-sender') out.push({ agentId: agent, kind: 'refused', ts, attrs: { gate: 'impostor', ...BF } }); break;
      default: break;
    }
  }
  return out;
}

/** Value per member and day from cost ledger rows (running totals per agent
 *  and session, folded with the app's own restart rule). Only growth in
 *  [since, until) counts: `until` is Pulse's first live point, and running
 *  totals restart with the app, so a session that goes on live is not
 *  counted twice. Rows go in one at a time, so the ledger is never held whole. */
export class LedgerFold {
  private readonly fold = new CostFold();
  private readonly byDay = new Map<string, number>();
  constructor(private readonly since: number, private readonly until: number) {}
  add(r: { agent_id?: unknown; session_id?: unknown; ts?: unknown; usd?: unknown }): void {
    const ts = Number(r.ts);
    if (!Number.isFinite(ts) || ts >= this.until || typeof r.agent_id !== 'string') return;
    const key = `${r.agent_id}\t${typeof r.session_id === 'string' ? r.session_id : ''}`;
    const inc = this.fold.add(key, Number(r.usd) || 0);
    if (ts < this.since || inc <= 0) return;
    const day = `${r.agent_id}\t${dayKey(ts)}`;
    this.byDay.set(day, (this.byDay.get(day) ?? 0) + inc);
  }
  /** "agent \t day" to value. */
  days(): Map<string, number> { return this.byDay; }
}

export function ledgerDays(rows: Iterable<{ agent_id?: unknown; session_id?: unknown; ts?: unknown; usd?: unknown }>, since: number, until: number): Map<string, number> {
  const f = new LedgerFold(since, until);
  for (const r of rows) f.add(r);
  return f.days();
}

// ─── the run ──────────────────────────────────────────────────────────────

async function* lines(file: string): AsyncGenerator<string> {
  if (!existsSync(file)) return;
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const l of rl) yield l;
}

async function* jsonLines(file: string): AsyncGenerator<Record<string, unknown>> {
  for await (const l of lines(file)) {
    if (!l || l[0] !== '{') continue;
    try { yield JSON.parse(l) as Record<string, unknown>; } catch { /* a torn line */ }
  }
}

export interface BackfillDeps {
  db: Database.Database;
  office: string;
  hiveRoot: string;
  projectsRoot: string;
  members: Set<string>;
  now: number;
}

/** Read the weeks before Pulse began for one office, once. Returns how many points it wrote. */
export async function runBackfill(d: BackfillDeps): Promise<number> {
  const { db, office } = d;
  if (backfilled(db, office)) return 0;
  const firstLive = (db.prepare(`SELECT MIN(ts) AS t FROM telemetry_events WHERE office = ? AND (attrs IS NULL OR json_extract(attrs, '$.bf') IS NULL)`).get(office) as { t: number | null }).t;
  const until = firstLive ?? d.now;
  const since = until - BACKFILL_DAYS * 86_400_000;
  const points: TelemetryEvent[] = [];

  // The office log: work, trust layer decisions, and which session is whose.
  const logEntries: Record<string, unknown>[] = [];
  const sessions = new Map<string, string>();
  for await (const e of jsonLines(join(d.hiveRoot, 'log.jsonl'))) {
    if (e.kind === 'session' && typeof e.sessionId === 'string' && typeof e.agentId === 'string') sessions.set(e.sessionId, e.agentId);
    const ts = Number(e.ts);
    if (Number.isFinite(ts) && ts >= since && ts < until) logEntries.push(e);
  }
  points.push(...logPoints(logEntries, since, until, d.members));

  // Members' sessions: working time and refused steps.
  const files = new Map<string, string>();
  try {
    for (const dir of readdirSync(d.projectsRoot)) {
      let names: string[] = [];
      try { names = readdirSync(join(d.projectsRoot, dir)); } catch { continue; }
      for (const n of names) if (n.endsWith('.jsonl') && sessions.has(n.slice(0, -6))) files.set(n.slice(0, -6), join(d.projectsRoot, dir, n));
    }
  } catch { /* no transcripts: the rest still counts */ }
  for (const [sid, file] of files) {
    try { if (statSync(file).mtimeMs < since) continue; } catch { continue; }
    const agent = sessions.get(sid)!;
    const buf: string[] = [];
    for await (const l of lines(file)) buf.push(l);
    const r = readTranscript(buf, since, until);
    for (const t of r.turns) points.push({ agentId: agent, kind: 'busy', ts: t.ts, value: t.ms, attrs: { ...BF } });
    for (const x of r.refused) points.push({ agentId: agent, kind: 'refused', ts: x.ts, attrs: { gate: x.gate, ...BF } });
  }

  // The cost ledger: value per member and day.
  const ledger = new LedgerFold(since, until);
  for await (const r of jsonLines(join(d.hiveRoot, 'cost-ledger.jsonl'))) ledger.add(r);
  for (const [key, usd] of ledger.days()) {
    const [agent, day] = key.split('\t');
    // One point per member and day, under a key of its own, so the fold counts it whole.
    points.push({ agentId: agent, kind: 'cost', ts: new Date(`${day}T12:00:00`).getTime(), value: usd, attrs: { s: `bf:${day}`, tokens: 0, ...BF } });
  }

  points.sort((a, b) => a.ts - b.ts);
  const ins = db.prepare('INSERT INTO telemetry_events (office, agent_id, kind, ts, value, attrs) VALUES (?, ?, ?, ?, ?, ?)');
  const mark = db.prepare(`INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  // The points and the marker land together or not at all, so a backfill cut
  // short (quit, crash, a full disk) runs again from nothing instead of
  // counting its first rows twice.
  db.transaction(() => {
    for (const e of points) ins.run(office, e.agentId, e.kind, Math.round(e.ts), e.value ?? null, e.attrs ? JSON.stringify(e.attrs) : null);
    mark.run(markerKey(office), JSON.stringify({ v: 1, since, until, points: points.length }), d.now);
  })();
  return points.length;
}
