/**
 * Pulse's processor (docs/designs/team-performance.md, D16 and eng review E1, E4):
 * reads telemetry points past its cursor every 30 seconds, closes scheduled run
 * windows, folds cost into daily totals, prunes old points, and builds the
 * snapshot the Pulse view shows.
 *
 *   telemetry_events ─(cursor)─► fold ─► telemetry_daily, telemetry_runs ─► pulseSnapshot / adviceFor
 *
 * One synchronous better-sqlite3 handle on the main thread: a batch and its
 * cursor commit in one transaction, so a crash replays the batch and nothing
 * is counted twice. No read is held between ticks (a long reader would stop
 * the WAL from being recycled).
 *
 * A run (E1): it is dispatched as inbox mail and starts at the agent's first
 * turn after that; it ends at the first stop after which the agent stays idle
 * for 2 minutes, at the agent's next dispatched run, or after 60 minutes
 * (outcome unknown). Work inside the window (messages, Write or Edit tool
 * uses, cards finished, mails organized or sent) means it did work.
 */
import type Database from 'better-sqlite3';
import { CostFold } from '../shared/costFold';
import { dayKey, type MemberDay, type CardFact, type MailDecision, type MailDecisionKind } from '../shared/teamPerformance';
import type { TelemetryStore, TelemetryRow } from './telemetryStore';
import type { AddedNote } from '../shared/teamLearning';
import { trustKeys, checkedKeys, refusalKey, REFUSAL_GATES, type RefusalGate } from '../shared/pulseSafety';

export const RUN_IDLE_END_MS = 2 * 60_000;
export const RUN_CAP_MS = 60 * 60_000;
export const RAW_KEEP_MS = 400 * 86_400_000;
/** A session's saved running total is dropped once it has not moved for this
 *  long. Sessions end at closing time, and a new one counts from zero anyway. */
export const COST_KEY_KEEP_MS = 30 * 86_400_000;
/** One request's working time counts at most this much (a reply left open overnight is not work). */
export const TURN_CAP_MS = 60 * 60_000;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

interface AgentState { lastStop: number; lastActivity: number; turnStart?: number }
interface OpenRun { id: number; agentId: string; missionId: string; dispatched: number; start: number | null; usd: number; work: number; relay: boolean }
interface FoldState {
  cursor: number;
  costs: Record<string, number>;
  /** When each of `costs` last moved, so a quiet session's total can go. */
  costsAt: Record<string, number>;
  agents: Record<string, AgentState>;
  away: boolean;
  lastPrune: number;
}

const emptyState = (): FoldState => ({ cursor: 0, costs: {}, costsAt: {}, agents: {}, away: false, lastPrune: 0 });

/** The saved running totals without the ones that have not moved for
 *  COST_KEY_KEEP_MS (two keys per agent and session, kept forever before).
 *  A total from an older save, with no time yet, starts its clock now. */
export function quietCostsDropped(s: Pick<FoldState, 'costs' | 'costsAt'>, now: number): Pick<FoldState, 'costs' | 'costsAt'> {
  const costs: Record<string, number> = {};
  const costsAt: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.costs)) {
    const at = s.costsAt[k] ?? now;
    if (now - at > COST_KEY_KEEP_MS) continue;
    costs[k] = v;
    costsAt[k] = at;
  }
  return { costs, costsAt };
}

export class TelemetryProcessor {
  constructor(
    private readonly db: () => Database.Database | null,
    private readonly store: TelemetryStore,
    private readonly now: () => number = () => Date.now()
  ) {}

  private stateKey(office: string): string { return `pulse:state:${office}`; }

  private loadState(db: Database.Database, office: string): FoldState {
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(this.stateKey(office)) as { value: string } | undefined;
      return row ? { ...emptyState(), ...JSON.parse(row.value) } : emptyState();
    } catch { return emptyState(); }
  }

  private saveState(db: Database.Database, office: string, s: FoldState): void {
    db.prepare(`INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(this.stateKey(office), JSON.stringify(s), this.now());
  }

  /** Fold everything past the cursor for one office. Returns how many points it read. */
  tick(office: string): number {
    this.store.flush();
    const db = this.db();
    if (!db) return 0;
    let read = 0;
    for (let pass = 0; pass < 20; pass++) {
      const state = this.loadState(db, office);
      const rows = this.store.eventsAfter(office, state.cursor, 5000);
      const n = db.transaction(() => {
        const fold = new CostFold();
        for (const [k, v] of Object.entries(state.costs)) fold.seed(k, v);
        for (const r of rows) this.apply(db, office, state, fold, r);
        this.closeRuns(db, office, state);
        // Remember each running total's last value, so the next tick (or the
        // next start) folds from where this one stopped.
        for (const r of rows) {
          if (r.kind !== 'cost' || !r.agentId) continue;
          const key = `${r.agentId}\t${String(r.attrs?.s ?? '')}`;
          for (const k of [key, `${key}#t`]) {
            const v = fold.lastFor(k);
            if (v !== undefined) { state.costs[k] = v; state.costsAt[k] = this.now(); }
          }
        }
        if (rows.length) state.cursor = rows[rows.length - 1].id;
        this.saveState(db, office, state);
        return rows.length;
      })();
      read += n;
      if (n < 5000) break;
    }
    this.prune(db, office);
    return read;
  }

  private bump(db: Database.Database, office: string, agentId: string, day: string, col: string, by: number): void {
    if (!by) return;
    db.prepare(`INSERT INTO telemetry_daily (office, agent_id, day, ${col}) VALUES (?, ?, ?, ?)
      ON CONFLICT(office, agent_id, day) DO UPDATE SET ${col} = ${col} + excluded.${col}`).run(office, agentId, day, by);
  }

  private safety(db: Database.Database, office: string, day: string, key: string, by = 1): void {
    db.prepare(`INSERT INTO telemetry_safety (office, day, key, n) VALUES (?, ?, ?, ?)
      ON CONFLICT(office, day, key) DO UPDATE SET n = n + excluded.n`).run(office, day, key, by);
  }

  /** A request's working time, from the request to its last reply, on the day it began. */
  private endTurn(db: Database.Database, office: string, agentId: string, a: AgentState, end: number): void {
    if (!a.turnStart) return;
    const ms = Math.max(0, Math.min(end - a.turnStart, TURN_CAP_MS));
    const day = dayKey(a.turnStart);
    this.bump(db, office, agentId, day, 'busy_ms', Math.round(ms));
    this.bump(db, office, agentId, day, 'turns', 1);
    a.turnStart = undefined;
  }

  private openRun(db: Database.Database, office: string, agentId: string): OpenRun | null {
    const r = db.prepare('SELECT id, agent_id, mission_id, dispatched, start, usd, work, relay FROM telemetry_runs WHERE office = ? AND agent_id = ? AND end IS NULL ORDER BY id DESC LIMIT 1')
      .get(office, agentId) as { id: number; agent_id: string; mission_id: string; dispatched: number; start: number | null; usd: number; work: number; relay: number } | undefined;
    return r ? { id: r.id, agentId: r.agent_id, missionId: r.mission_id, dispatched: r.dispatched, start: r.start, usd: r.usd, work: r.work, relay: !!r.relay } : null;
  }

  private finish(db: Database.Database, office: string, run: OpenRun, end: number, outcome: 'did-work' | 'nothing' | 'unknown'): void {
    db.prepare('UPDATE telemetry_runs SET end = ?, outcome = ? WHERE id = ?').run(end, outcome, run.id);
    const day = dayKey(run.start ?? run.dispatched);
    if (outcome === 'did-work') this.bump(db, office, run.agentId, day, 'checks', 1);
    else if (outcome === 'nothing') this.bump(db, office, run.agentId, day, 'checks_nothing', 1);
  }

  private work(db: Database.Database, office: string, state: FoldState, agentId: string, ts: number, n: number): void {
    const run = this.openRun(db, office, agentId);
    if (run && run.start !== null && ts >= run.start) db.prepare('UPDATE telemetry_runs SET work = work + ? WHERE id = ?').run(n, run.id);
    const a = state.agents[agentId] ?? (state.agents[agentId] = { lastStop: 0, lastActivity: 0 });
    a.lastActivity = Math.max(a.lastActivity, ts);
  }

  private apply(db: Database.Database, office: string, state: FoldState, fold: CostFold, r: TelemetryRow): void {
    const agent = r.agentId;
    const day = dayKey(r.ts);
    // A point a backfill read from the past: counted for its day, but it never
    // touches today's open runs or presence.
    const past = r.attrs?.bf === 1;
    const away = (n: number): void => { if (agent && state.away && !past) this.bump(db, office, agent, day, 'away_pieces', n); };
    switch (r.kind) {
      case 'presence': state.away = (r.value ?? 0) > 0; return;
      case 'cost': {
        if (!agent) return;
        const key = `${agent}\t${String(r.attrs?.s ?? '')}`;
        const inc = fold.add(key, r.value ?? 0);
        const tok = fold.add(`${key}#t`, Number(r.attrs?.tokens ?? 0));
        this.bump(db, office, agent, day, 'usd', inc);
        this.bump(db, office, agent, day, 'tokens', tok);
        const run = this.openRun(db, office, agent);
        if (run && run.start !== null && r.ts >= run.start && inc > 0) {
          db.prepare('UPDATE telemetry_runs SET usd = usd + ? WHERE id = ?').run(inc, run.id);
          if (!run.relay) this.bump(db, office, agent, dayKey(run.start), 'run_usd', inc);
        }
        return;
      }
      case 'run-dispatch': {
        if (!agent) return;
        const prev = this.openRun(db, office, agent);
        if (prev) this.finish(db, office, prev, r.ts, prev.start === null ? 'unknown' : prev.work > 0 ? 'did-work' : 'nothing');
        db.prepare('INSERT INTO telemetry_runs (office, agent_id, mission_id, dispatched, relay, day) VALUES (?, ?, ?, ?, ?, ?)')
          .run(office, agent, String(r.attrs?.mission ?? ''), r.ts, r.attrs?.relay ? 1 : 0, day);
        return;
      }
      case 'prompt': {
        if (!agent) return;
        const run = this.openRun(db, office, agent);
        if (run && run.start === null && r.ts >= run.dispatched) db.prepare('UPDATE telemetry_runs SET start = ?, day = ? WHERE id = ?').run(r.ts, day, run.id);
        const a = state.agents[agent] ?? (state.agents[agent] = { lastStop: 0, lastActivity: 0 });
        // A request while the last one never stopped (a queued message): the
        // last one ends at its last activity.
        if (a.turnStart) this.endTurn(db, office, agent, a, Math.max(a.turnStart, a.lastActivity));
        a.turnStart = r.ts;
        a.lastActivity = Math.max(a.lastActivity, r.ts);
        return;
      }
      case 'tool':
        if (agent) this.work(db, office, state, agent, r.ts, WRITE_TOOLS.has(String(r.attrs?.tool ?? '')) ? 1 : 0);
        return;
      case 'stop': {
        if (!agent) return;
        const a = state.agents[agent] ?? (state.agents[agent] = { lastStop: 0, lastActivity: 0 });
        a.lastStop = Math.max(a.lastStop, r.ts);
        a.lastActivity = Math.max(a.lastActivity, r.ts);
        this.endTurn(db, office, agent, a, r.ts);
        return;
      }
      case 'busy':
        if (!agent) return;
        this.bump(db, office, agent, day, 'busy_ms', Math.max(0, Math.min(Math.round(r.value ?? 0), TURN_CAP_MS)));
        this.bump(db, office, agent, day, 'turns', 1);
        return;
      case 'trust':
        for (const k of trustKeys(r.attrs ?? {})) this.safety(db, office, day, k);
        return;
      case 'trust-checked':
        for (const k of checkedKeys(r.attrs ?? {})) this.safety(db, office, day, k);
        return;
      case 'trust-held':
        if (r.attrs?.way === 'in' || r.attrs?.way === 'out') this.safety(db, office, day, `${r.attrs.way}-held`);
        return;
      case 'refused': {
        const gate = String(r.attrs?.gate ?? '') as RefusalGate;
        if (REFUSAL_GATES.includes(gate)) this.safety(db, office, day, refusalKey(gate));
        return;
      }
      case 'message': if (agent && !past) this.work(db, office, state, agent, r.ts, 1); return;
      case 'email': {
        if (!agent) return;
        const n = Math.max(1, Math.round(r.value ?? 1));
        this.bump(db, office, agent, day, 'emails', n); away(n);
        if (!past) this.work(db, office, state, agent, r.ts, n);
        return;
      }
      case 'sent':
        if (!agent) return;
        this.bump(db, office, agent, day, 'sent', 1); away(1);
        if (!past) this.work(db, office, state, agent, r.ts, 1);
        return;
      case 'card-status':
        if (agent && r.attrs?.to === 'done' && !r.attrs?.excluded) { this.bump(db, office, agent, day, 'tasks', 1); away(1); }
        if (agent) this.work(db, office, state, agent, r.ts, 1);
        return;
      default: return;
    }
  }

  /** Close runs whose agent went idle after a stop, or that hit the cap. */
  private closeRuns(db: Database.Database, office: string, state: FoldState): void {
    const now = this.now();
    const open = db.prepare('SELECT id, agent_id, mission_id, dispatched, start, usd, work, relay FROM telemetry_runs WHERE office = ? AND end IS NULL').all(office) as
      Array<{ id: number; agent_id: string; mission_id: string; dispatched: number; start: number | null; usd: number; work: number; relay: number }>;
    for (const r of open) {
      const run: OpenRun = { id: r.id, agentId: r.agent_id, missionId: r.mission_id, dispatched: r.dispatched, start: r.start, usd: r.usd, work: r.work, relay: !!r.relay };
      const a = state.agents[run.agentId];
      const from = run.start ?? run.dispatched;
      if (run.start !== null && a && a.lastStop >= run.start && a.lastActivity <= a.lastStop && now - a.lastStop >= RUN_IDLE_END_MS) {
        this.finish(db, office, run, a.lastStop, run.work > 0 ? 'did-work' : 'nothing');
      } else if (now - from >= RUN_CAP_MS) {
        this.finish(db, office, run, from + RUN_CAP_MS, 'unknown');
      }
    }
  }

  /** E4: raw points older than 400 days go, a few thousand at a time, once a day. */
  private prune(db: Database.Database, office: string): void {
    const state = this.loadState(db, office);
    if (this.now() - state.lastPrune < 86_400_000) return;
    try {
      db.prepare('DELETE FROM telemetry_events WHERE id IN (SELECT id FROM telemetry_events WHERE office = ? AND ts < ? ORDER BY id LIMIT 5000)')
        .run(office, this.now() - RAW_KEEP_MS);
      this.saveState(db, office, { ...state, ...quietCostsDropped(state, this.now()), lastPrune: this.now() });
      const pages = db.pragma('page_count', { simple: true }) as number;
      const free = db.pragma('freelist_count', { simple: true }) as number;
      if (pages > 0 && free / pages > 0.5) { db.exec('VACUUM'); db.pragma('wal_checkpoint(TRUNCATE)'); }
    } catch (e) { console.error('[pulse] prune:', e); }
  }

  // ─── reads for the snapshot ─────────────────────────────────────────────

  days(office: string, fromDay: string): MemberDay[] {
    const db = this.db();
    if (!db) return [];
    return (db.prepare('SELECT * FROM telemetry_daily WHERE office = ? AND day >= ?').all(office, fromDay) as Array<Record<string, number | string>>).map((r) => ({
      agentId: String(r.agent_id), day: String(r.day), usd: Number(r.usd), runUsd: Number(r.run_usd),
      emails: Number(r.emails), sent: Number(r.sent), tasks: Number(r.tasks), checks: Number(r.checks),
      checksNothing: Number(r.checks_nothing), awayPieces: Number(r.away_pieces),
      busyMs: Number(r.busy_ms ?? 0), turns: Number(r.turns ?? 0)
    }));
  }

  /** Kept safe counters between two days, inclusive. */
  safetyRows(office: string, fromDay: string, toDay: string): Array<{ key: string; n: number }> {
    const db = this.db();
    if (!db) return [];
    return db.prepare('SELECT key, SUM(n) AS n FROM telemetry_safety WHERE office = ? AND day >= ? AND day <= ? GROUP BY key').all(office, fromDay, toDay) as Array<{ key: string; n: number }>;
  }

  runs(office: string, since: number): Array<{ missionId: string; agentId: string; start: number; outcome: 'did-work' | 'nothing' | 'failed' | 'unknown'; workCount: number; usd: number; day: string }> {
    const db = this.db();
    if (!db) return [];
    return (db.prepare('SELECT * FROM telemetry_runs WHERE office = ? AND dispatched >= ? AND end IS NOT NULL').all(office, since) as Array<Record<string, number | string | null>>).map((r) => ({
      missionId: String(r.mission_id), agentId: String(r.agent_id), start: Number(r.start ?? r.dispatched),
      outcome: (r.outcome as 'did-work' | 'nothing' | 'unknown') ?? 'unknown', workCount: Number(r.work), usd: Number(r.usd), day: String(r.day)
    }));
  }

  private rows(office: string, kinds: string[], since: number): TelemetryRow[] {
    const db = this.db();
    if (!db) return [];
    const marks = kinds.map(() => '?').join(',');
    return (db.prepare(`SELECT id, office, agent_id, kind, ts, value, attrs FROM telemetry_events WHERE office = ? AND kind IN (${marks}) AND ts >= ? ORDER BY id`).all(office, ...kinds, since) as
      Array<{ id: number; office: string; agent_id: string | null; kind: TelemetryRow['kind']; ts: number; value: number | null; attrs: string | null }>).map((r) => {
      let attrs: Record<string, unknown> | undefined;
      try { attrs = r.attrs ? JSON.parse(r.attrs) : undefined; } catch { attrs = undefined; }
      return { id: r.id, office: r.office, agentId: r.agent_id, kind: r.kind, ts: r.ts, ...(r.value !== null ? { value: r.value } : {}), ...(attrs ? { attrs } : {}) };
    });
  }

  /** Notes new to members' memory since a time (Learning, owner 2026-10-18). */
  notesAdded(office: string, since: number): AddedNote[] {
    return this.rows(office, ['note-added'], since)
      .filter((r) => r.agentId && typeof r.attrs?.id === 'string')
      .map((r) => ({ agentId: r.agentId!, id: String(r.attrs!.id), source: String(r.attrs?.source ?? 'task'), at: r.ts }));
  }

  /** When the office's first `note-added` record was made; null before any. */
  firstNoteAdded(office: string): number | null {
    const db = this.db();
    if (!db) return null;
    const r = db.prepare("SELECT MIN(ts) AS t FROM telemetry_events WHERE office = ? AND kind = 'note-added'").get(office) as { t: number | null } | undefined;
    return r?.t ?? null;
  }

  /** Cards finished or reopened since a time, with time held Blocked or Waiting. */
  cards(office: string, since: number): CardFact[] {
    const by = new Map<string, CardFact & { heldFrom: number | null }>();
    for (const r of this.rows(office, ['card-status', 'card-reopen'], since)) {
      const id = String(r.attrs?.id ?? '');
      if (!id) continue;
      const c = by.get(id) ?? { id, assignee: r.agentId ?? '', createdAt: Number(r.attrs?.createdAt ?? r.ts) || r.ts, heldMs: 0, reopened: false, excluded: false, heldFrom: null };
      if (r.agentId) c.assignee = r.agentId;
      if (r.kind === 'card-reopen') { c.reopened = true; by.set(id, c); continue; }
      const to = String(r.attrs?.to ?? '');
      if (c.heldFrom !== null && to !== 'blocked' && to !== 'waiting') { c.heldMs += r.ts - c.heldFrom; c.heldFrom = null; }
      if ((to === 'blocked' || to === 'waiting') && c.heldFrom === null) c.heldFrom = r.ts;
      if (to === 'done') c.doneAt = r.ts;
      if (r.attrs?.excluded) c.excluded = true;
      by.set(id, c);
    }
    return [...by.values()].map(({ heldFrom: _h, ...c }) => c);
  }

  decisions(office: string, since: number): MailDecision[] {
    return this.rows(office, ['mail-decision'], since).filter((r) => r.agentId).map((r) => ({ agentId: r.agentId!, decision: String(r.attrs?.decision) as MailDecisionKind, at: r.ts }));
  }

  /** Requests Michael routed and cards he opened between two times, so a past
   *  span never counts later work (owner, 2026-10-16, D11). */
  michaelCounts(office: string, godId: string, since: number, until = Infinity): { routed: number; cardsOpened: number } {
    const routed = this.rows(office, ['message'], since).filter((r) => r.ts <= until && r.agentId === godId && r.attrs?.act === 'request').length;
    const cardsOpened = this.rows(office, ['card-status'], since).filter((r) => r.ts <= until && r.attrs?.from === null).length;
    return { routed, cardsOpened };
  }

  /** The first day this office has any point, for "Collecting since". With
   *  `live`, only points recorded as they happened: a backfill's points (bf)
   *  never start recommendations early. */
  firstDay(office: string, live = false): string | null {
    const db = this.db();
    if (!db) return null;
    const sql = live
      ? `SELECT MIN(ts) AS t FROM telemetry_events WHERE office = ? AND (attrs IS NULL OR json_extract(attrs, '$.bf') IS NULL)`
      : 'SELECT MIN(ts) AS t FROM telemetry_events WHERE office = ?';
    const r = db.prepare(sql).get(office) as { t: number | null } | undefined;
    return r?.t ? dayKey(r.t) : null;
  }
}
