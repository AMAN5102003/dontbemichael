/**
 * The Pulse service (docs/designs/team-performance.md): builds what the Pulse
 * view shows from the telemetry store, and carries out the owner's clicks on
 * ways to save. Nothing here changes a schedule or a model on its own: apply,
 * undo and dismiss run only from the owner's click (memory 2026-10-10, D10).
 *
 *   view ─ pulse:snapshot ─► snapshot() ─► pulseSnapshot + adviceFor + savings + headroom
 *   view ─ pulse:apply    ─► apply()    ─► schedule: compare and set in config
 *                                          model: checked here, set by the renderer's roster
 *   view ─ pulse:undo / pulse:dismiss
 */
import type Database from 'better-sqlite3';
import type { ScheduledMission } from '../shared/missions';
import {
  dayKey, keptAsIs, measuredSaving, periodRange, planHeadroom, pulseSnapshot,
  type AskFact, type Period, type PlanReading
} from '../shared/teamPerformance';
import { adviceFor, visibleAdvice, ADVICE_WINDOW_MS, type Advice, type Dismissal, type LadderModel, type MissionFact } from '../shared/teamAdvice';
import { keptSafe, REFUSAL_GATES } from '../shared/pulseSafety';
import { planCostFor, scaleSnapshot, type PlanPrice } from '../shared/claudePlan';
import { learning, type Learning, type NoteFact } from '../shared/teamLearning';
import type { TelemetryStore } from './telemetryStore';
import type { TelemetryProcessor } from './telemetryProcessor';

export interface PulseDeps {
  db: () => Database.Database | null;
  store: TelemetryStore;
  processor: TelemetryProcessor;
  office: () => string | null;
  members: () => Array<{ id: string; isGod: boolean }>;
  godId: () => string | null;
  /** Cards with their asks (humanQA), from the board. */
  tasks: () => Array<{ humanQA?: Array<{ kind?: string; askedAt?: string; answeredAt?: string; raisedBy?: string }> }>;
  missions: () => ScheduledMission[];
  /** Each member's provider and model, from the roster. */
  models: () => Array<{ agentId: string; provider: string; model: string | null }>;
  ladder: () => LadderModel[];
  priceOf: (model: string) => number | undefined;
  applyMissions: (change: (list: ScheduledMission[]) => ScheduledMission[] | null) => { ok: boolean; error?: string };
  billing: () => 'account' | 'apiKey';
  /** The owner's plan and its monthly price (Settings first, else detected); null on an API key. */
  plan: () => PlanPrice | null;
  /** Members' memory notes (date and source only) and procedure counts. */
  memory: () => { notes: NoteFact[]; procedures: Record<string, number> };
  now?: () => number;
}

export type { AppliedChange, PulseView } from '../shared/pulseView';
import type { AppliedChange, PulseView, PulseWeeks } from '../shared/pulseView';

/** Window lengths by Claude Code's rate limit names. */
function windowMs(name: string): number {
  return /five_hour|5h/i.test(name) ? 5 * 3_600_000 : 7 * 86_400_000;
}

export class PulseService {
  private reading: PlanReading | null = null;
  constructor(private readonly d: PulseDeps) {}
  private now(): number { return this.d.now ? this.d.now() : Date.now(); }

  /** A status line's usage windows: keep the most constrained one (E6). */
  noteRateLimits(rateLimits: unknown, at = this.now()): void {
    if (!rateLimits || typeof rateLimits !== 'object') return;
    let best: PlanReading | null = null;
    for (const [name, w] of Object.entries(rateLimits as Record<string, { used_percentage?: unknown; resets_at?: unknown }>)) {
      const pct = typeof w?.used_percentage === 'number' ? w.used_percentage : NaN;
      const resets = typeof w?.resets_at === 'number' ? w.resets_at * 1000 : NaN;
      if (!(pct >= 0) || !(resets > at)) continue;
      if (!best || pct > best.usedPct) best = { usedPct: pct, resetsAt: resets, windowMs: windowMs(name), at };
    }
    if (best) this.reading = best;
  }

  private asks(): AskFact[] {
    const out: AskFact[] = [];
    for (const c of this.d.tasks()) for (const e of c.humanQA ?? []) {
      if (!e || e.kind === 'report' || !e.raisedBy || !e.askedAt) continue;
      const askedAt = Date.parse(e.askedAt);
      if (!Number.isFinite(askedAt)) continue;
      const answeredAt = e.answeredAt ? Date.parse(e.answeredAt) : NaN;
      out.push({ raisedBy: e.raisedBy, askedAt, ...(Number.isFinite(answeredAt) ? { answeredAt } : {}) });
    }
    return out;
  }

  private dismissed(office: string): Dismissal[] {
    const db = this.d.db();
    if (!db) return [];
    return (db.prepare('SELECT advice_id AS id, band, at FROM telemetry_dismissed WHERE office = ?').all(office) as Dismissal[]);
  }

  appliedChanges(office: string): AppliedChange[] {
    const db = this.d.db();
    if (!db) return [];
    return (db.prepare('SELECT * FROM telemetry_applied WHERE office = ? ORDER BY id').all(office) as Array<Record<string, unknown>>).map((r) => ({
      id: Number(r.id), adviceId: String(r.advice_id), agentId: String(r.agent_id), kind: String(r.kind),
      before: JSON.parse(String(r.before)), after: JSON.parse(String(r.after)), at: Number(r.at), undoneAt: r.undone_at === null ? null : Number(r.undone_at)
    }));
  }

  /** Every suggestion the last 14 days support, before dismissals. */
  private allAdvice(office: string): Advice[] {
    const now = this.now();
    const since = now - ADVICE_WINDOW_MS;
    const days = this.d.processor.days(office, dayKey(since)).filter((x) => x.day >= dayKey(since));
    const cards = this.d.processor.cards(office, since);
    const decisions = this.d.processor.decisions(office, since);
    const godId = this.d.godId();
    const missions: MissionFact[] = this.d.missions()
      .filter((m) => m.enabled && (m.kind ?? 'dispatch') === 'dispatch')
      .map((m) => ({ id: m.id, to: m.to === 'god' && godId ? godId : m.to, label: m.label, intervalMs: m.intervalMs, timed: !!(m.times?.length || m.weekly) }));
    const members = this.d.models().map((m) => {
      const mine = days.filter((x) => x.agentId === m.agentId);
      const kept = keptAsIs(m.agentId, decisions, cards);
      return {
        agentId: m.agentId, provider: m.provider, model: m.model, isGod: m.agentId === godId,
        pieces: mine.reduce((s, x) => s + x.emails + x.sent + x.tasks + x.checks, 0),
        mailDecisions: decisions.filter((x) => x.agentId === m.agentId && x.decision !== 'cancelled').length,
        keptShare: kept.share, keptDecisions: kept.decisions,
        reopens: cards.filter((c) => c.assignee === m.agentId && c.reopened).length,
        usdPerWeek: mine.reduce((s, x) => s + x.usd, 0) / 2
      };
    });
    // A change the owner applied in the window makes the evidence before it
    // stale: that suggestion waits for 14 days of new records.
    const recent = new Set(this.appliedChanges(office).filter((a) => a.undoneAt === null && a.at >= since).map((a) => a.adviceId));
    return adviceFor({
      now, runs: this.d.processor.runs(office, since), missions, members,
      ladder: this.d.ladder(), gapDays: this.d.store.failureDays(office), priceOf: this.d.priceOf
    }).filter((a) => !recent.has(a.id));
  }

  snapshot(period: Period): PulseView {
    const office = this.d.office();
    const now = this.now();
    const billing = this.d.billing();
    const godId = this.d.godId();
    const db = this.d.db();
    const empty = pulseSnapshot({ period, now, days: [], cards: [], decisions: [], asks: [], members: [] });
    if (!office || !db) return { available: false, billing, collectingSince: null, liveSince: null, snapshot: empty, advice: [], adviceFrom: null, saved: { state: 'none' }, headroom: null, applied: [], trend: {}, keptSafe: keptSafe([]), learning: learning({ now, notes: [], procedures: {}, asks: [], turns: [] }), plan: null, weeks: null };
    const range = periodRange(period, now);
    const from = Math.min(range.fromMs, now - ADVICE_WINDOW_MS);
    const ids = this.d.members().map((m) => m.id);
    const raw = pulseSnapshot({
      period, now,
      days: this.d.processor.days(office, dayKey(from)),
      cards: this.d.processor.cards(office, from),
      decisions: this.d.processor.decisions(office, from),
      asks: this.asks(),
      members: ids,
      sentAsWritten: this.d.processor.decisions(office, range.fromMs).filter((x) => x.decision === 'approve' && x.at <= range.toMs).length,
      gapDays: this.d.store.failureDays(office),
      ...(godId ? { michael: { agentId: godId, ...this.d.processor.michaelCounts(office, godId, range.fromMs) } } : {})
    });
    // On a plan, each member's dollars are their part of the plan's real cost
    // for the period, by share of the work (owner, 2026-10-15).
    const price = billing === 'account' ? this.planPrice() : null;
    const periodCost = price ? planCostFor(price.monthly, range.fromMs, range.toMs, now) : 0;
    const snapshot = price && raw.totalUsd > 0 ? scaleSnapshot(raw, periodCost / raw.totalUsd) : raw;
    const plan = price ? { label: price.label, monthly: price.monthly, source: price.source, periodCost, payPerUse: raw.totalUsd } : null;
    const first = this.d.processor.firstDay(office);
    // Recommendations count from live recording, never from a backfill.
    const live = this.d.processor.firstDay(office, true);
    const firstMs = live ? new Date(`${live}T00:00:00`).getTime() : now;
    const adviceReady = now - firstMs >= ADVICE_WINDOW_MS;
    const applied = this.appliedChanges(office);
    return {
      available: true,
      billing,
      collectingSince: first,
      liveSince: live,
      snapshot,
      advice: adviceReady ? visibleAdvice(this.allAdvice(office), this.dismissed(office), now) : [],
      adviceFrom: adviceReady ? null : dayKey(firstMs + ADVICE_WINDOW_MS),
      saved: this.saved(office, applied),
      headroom: billing === 'account' ? planHeadroom(this.reading) : null,
      applied,
      trend: this.trend(office, ids, price),
      keptSafe: keptSafe(this.d.processor.safetyRows(office, range.from, range.to)),
      learning: this.learning(office),
      plan,
      weeks: period === '4-weeks' ? this.weeks(office, range.fromMs, price) : null
    };
  }

  /** Last 4 weeks, week by week, for the tiles' trend charts (owner, 2026-10-15). */
  private weeks(office: string, startMs: number, price: PlanPrice | null): PulseWeeks {
    const now = this.now();
    const week = 7 * 86_400_000;
    const starts = [0, 1, 2, 3].map((w) => startMs + w * week);
    const keys = starts.map((t) => dayKey(t));
    const days = this.d.processor.days(office, keys[0]);
    const asks = this.asks();
    const out: PulseWeeks = { from: keys, emails: [], sent: [], tasks: [], checks: [], usd: [], asks: [], away: [], toInternet: [], cleaned: [], held: [], rules: [] };
    starts.forEach((t0, w) => {
      const from = keys[w];
      const to = dayKey(t0 + 6 * 86_400_000);
      const mine = days.filter((d) => d.day >= from && d.day <= to);
      const sum = (f: (d: typeof mine[number]) => number): number => mine.reduce((s, d) => s + f(d), 0);
      const pieces = sum((d) => d.emails + d.sent + d.tasks + d.checks);
      const value = sum((d) => d.usd);
      out.emails.push(sum((d) => d.emails));
      out.sent.push(sum((d) => d.sent));
      out.tasks.push(sum((d) => d.tasks));
      out.checks.push(sum((d) => d.checks + d.checksNothing));
      out.usd.push(price && value > 0 ? planCostFor(price.monthly, t0, t0 + week - 1, now) : value);
      out.asks.push(asks.filter((a) => a.askedAt >= t0 && a.askedAt < t0 + week).length);
      out.away.push(pieces > 0 ? sum((d) => d.awayPieces) / pieces : null);
      const k = keptSafe(this.d.processor.safetyRows(office, from, to));
      out.toInternet.push(k.toInternet.pass + k.toInternet.clean + k.toInternet.stop);
      out.cleaned.push(k.webAnswers.clean);
      out.held.push(k.held);
      out.rules.push(REFUSAL_GATES.reduce((s, g) => s + (k.rules[g] ?? 0), 0));
    });
    return out;
  }

  private planPrice(): PlanPrice | null {
    try { return this.d.plan(); } catch { return null; }
  }

  /** Learning: eight weeks of notes and of questions per request; the view picks the period's. */
  private learning(office: string): Learning {
    const now = this.now();
    // Eight weeks, so the Last 4 weeks period has four before it to compare with.
    const from = dayKey(periodRange('4-weeks', now).fromMs - 28 * 86_400_000);
    const turns = new Map<string, number>();
    for (const d of this.d.processor.days(office, from)) turns.set(d.day, (turns.get(d.day) ?? 0) + (d.turns ?? 0));
    let mem: { notes: NoteFact[]; procedures: Record<string, number> } = { notes: [], procedures: {} };
    try { mem = this.d.memory(); } catch { /* memory unreadable: the row shows what it has */ }
    return learning({ now, notes: mem.notes, procedures: mem.procedures, asks: this.asks(), turns: [...turns].map(([day, t]) => ({ day, turns: t })), count: 8 });
  }

  /** Value per week, last four weeks (this week last), per member; on a plan,
   *  each week's part of the plan's cost for that week. */
  private trend(office: string, ids: string[], price: PlanPrice | null): Record<string, number[]> {
    const now = this.now();
    const start = periodRange('4-weeks', now).fromMs;
    const days = this.d.processor.days(office, dayKey(start));
    const out: Record<string, number[]> = {};
    for (const id of ids) out[id] = [0, 0, 0, 0];
    for (const d of days) {
      const w = Math.floor((new Date(`${d.day}T12:00:00`).getTime() - start) / (7 * 86_400_000));
      if (w >= 0 && w < 4) (out[d.agentId] ??= [0, 0, 0, 0])[w] += d.usd;
    }
    if (price) {
      const week = 7 * 86_400_000;
      for (let w = 0; w < 4; w++) {
        const total = Object.values(out).reduce((s, v) => s + v[w], 0);
        if (total <= 0) continue;
        const factor = planCostFor(price.monthly, start + w * week, start + (w + 1) * week - 1, now) / total;
        for (const v of Object.values(out)) v[w] *= factor;
      }
    }
    return out;
  }

  /** D16: measured savings of every change still in place. */
  private saved(office: string, applied: AppliedChange[]): PulseView['saved'] {
    const live = applied.filter((a) => a.undoneAt === null);
    if (!live.length) return { state: 'none' };
    const now = this.now();
    let usd = 0, measuring: number | null = null;
    for (const a of live) {
      const days = this.d.processor.days(office, dayKey(a.at - ADVICE_WINDOW_MS)).filter((x) => x.agentId === a.agentId);
      // Up to this member's next change still in place, so changes never overlap.
      const next = live.filter((b) => b.agentId === a.agentId && b.at > a.at).reduce<number | undefined>((m, b) => (m === undefined || b.at < m ? b.at : m), undefined);
      const r = measuredSaving(days, a.at, now, next);
      if (r.state === 'measuring') measuring = Math.min(measuring ?? r.firstAt, r.firstAt);
      else usd += r.usd;
    }
    const measuredAny = live.some((a) => now >= a.at + 7 * 86_400_000);
    if (!measuredAny && measuring !== null) return { state: 'measuring', firstAt: measuring };
    return { state: 'measured', usd, since: Math.min(...live.map((a) => a.at)) };
  }

  private record(office: string, adviceId: string, agentId: string, kind: string, before: unknown, after: unknown): number {
    const db = this.d.db();
    if (!db) return 0;
    const at = this.now();
    const r = db.prepare('INSERT INTO telemetry_applied (office, advice_id, agent_id, kind, before, after, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(office, adviceId, agentId, kind, JSON.stringify(before), JSON.stringify(after), at);
    this.d.store.record({ agentId, kind: 'advice-applied', ts: at, attrs: { advice: adviceId } });
    return Number(r.lastInsertRowid);
  }

  /** The owner's Apply. A schedule change is made here, compare and set; a
   *  model change is checked here and made by the renderer (it owns models). */
  apply(adviceId: string, expected: unknown): { ok: true; kind: 'schedule'; appliedId: number } | { ok: true; kind: 'model'; agentId: string; to: string; from: string | null } | { ok: false; error: 'stale' | 'unavailable' | 'failed' } {
    const office = this.d.office();
    if (!office || !this.d.db()) return { ok: false, error: 'unavailable' };
    const a = this.allAdvice(office).find((x) => x.id === adviceId);
    if (!a) return { ok: false, error: 'stale' };
    // The change the owner saw must still be the change: a double click or an
    // edit elsewhere since the view loaded is refused, never applied twice.
    if (JSON.stringify(expected) !== JSON.stringify(a.change)) return { ok: false, error: 'stale' };
    if (a.change.kind === 'interval') {
      const { fromMs, toMs } = a.change;
      const res = this.d.applyMissions((list) => {
        const m = list.find((x) => x.id === a.missionId);
        if (!m || m.intervalMs !== fromMs || m.times?.length || m.weekly) return null;
        return list.map((x) => (x.id === m.id ? { ...x, intervalMs: toMs } : x));
      });
      if (!res.ok) return { ok: false, error: res.error === 'not found' ? 'stale' : 'failed' };
      return { ok: true, kind: 'schedule', appliedId: this.record(office, a.id, a.agentId, 'schedule', { missionId: a.missionId, intervalMs: fromMs }, { missionId: a.missionId, intervalMs: toMs }) };
    }
    if (a.change.kind === 'model') {
      const current = this.d.models().find((m) => m.agentId === a.agentId)?.model ?? null;
      if (current !== a.change.from) return { ok: false, error: 'stale' };
      return { ok: true, kind: 'model', agentId: a.agentId, to: a.change.to, from: a.change.from };
    }
    return { ok: false, error: 'failed' };
  }

  /** After the renderer set the model, record it for savings and Undo. */
  modelApplied(adviceId: string, agentId: string, from: string | null, to: string): number {
    const office = this.d.office();
    return office ? this.record(office, adviceId, agentId, 'model', { model: from }, { model: to }) : 0;
  }

  /** Undo restores the exact previous setting, if nothing changed it since. */
  undo(appliedId: number): { ok: true; kind: 'schedule' } | { ok: true; kind: 'model'; agentId: string; to: string | null } | { ok: false; error: 'stale' | 'unavailable' } {
    const office = this.d.office();
    const db = this.d.db();
    if (!office || !db) return { ok: false, error: 'unavailable' };
    const a = this.appliedChanges(office).find((x) => x.id === appliedId && x.undoneAt === null);
    if (!a) return { ok: false, error: 'stale' };
    const mark = (): void => { db.prepare('UPDATE telemetry_applied SET undone_at = ? WHERE id = ?').run(this.now(), a.id); };
    if (a.kind === 'schedule') {
      const before = a.before as { missionId: string; intervalMs: number };
      const after = a.after as { intervalMs: number };
      const res = this.d.applyMissions((list) => {
        const m = list.find((x) => x.id === before.missionId);
        if (!m || m.intervalMs !== after.intervalMs) return null;
        return list.map((x) => (x.id === m.id ? { ...x, intervalMs: before.intervalMs } : x));
      });
      if (!res.ok) return { ok: false, error: 'stale' };
      mark();
      return { ok: true, kind: 'schedule' };
    }
    // The model too: only while it is still the one the change set.
    // (Still the old one is fine too: the roster may not have saved the change yet.)
    const current = this.d.models().find((m) => m.agentId === a.agentId)?.model ?? null;
    if (current !== (a.after as { model: string | null }).model && current !== (a.before as { model: string | null }).model) return { ok: false, error: 'stale' };
    mark();
    return { ok: true, kind: 'model', agentId: a.agentId, to: (a.before as { model: string | null }).model };
  }

  /** Not now: hidden until the evidence crosses its next band (D13). */
  dismiss(adviceId: string): boolean {
    const office = this.d.office();
    const db = this.d.db();
    if (!office || !db) return false;
    const a = this.allAdvice(office).find((x) => x.id === adviceId);
    if (!a) return false;
    db.prepare(`INSERT INTO telemetry_dismissed (office, advice_id, band, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(office, advice_id) DO UPDATE SET band = excluded.band, at = excluded.at`).run(office, a.id, a.band, this.now());
    return true;
  }
}
