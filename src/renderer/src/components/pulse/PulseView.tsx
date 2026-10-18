/**
 * Pulse: the office's performance and cost, as pictures (docs/designs/team-performance.md,
 * approved mockups pulse-final.html and pulse-v3.html). Top to bottom:
 * recommendations, what got done, kept safe, learning, the office row, then
 * team at work (owner, 2026-10-15, proposal 3). Fields first; each explanation sits
 * behind an (i). Advice is amber, savings green, coral never: Ask me stays the
 * only thing that needs the owner.
 *
 *   Pulse ─ pulse:snapshot (on open, on period change, on pulse:updated)
 *         ─ Apply ─ pulse:apply ─► schedule (main) | model (this store) ─► "Applied." + Undo
 *         ─ Not now ─ pulse:dismiss
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PulseView as PulseData } from '@shared/pulseView';
import type { Advice } from '@shared/teamAdvice';
import { teamAtWork, type Outcome, type Period, type WorkChip, type WorkKind } from '@shared/teamPerformance';
import { keptSafe, REFUSAL_GATES, type RefusalGate } from '@shared/pulseSafety';
import { MIN_TURNS_FOR_RATE } from '@shared/teamLearning';
import { useStore } from '@/store/store';
import { useAppTheme } from '@/design/theme';
import { family } from '@/scene/studio/theme';
import { departmentOf, roleOf } from '@/scene/studio/layout';
import { useMissions } from '../triggers/ScheduleList';
import { AgentAvatar } from '../AgentAvatar';
import { InfoTip } from '../InfoTip';
import { Icon, type IconName } from '../Icon';
import { useDialog } from '@/shell/useDialog';
import { useBackdropClose } from '@/hooks/useBackdropClose';

const LS_PERIOD = 'cth.pulsePeriod';
const PERIODS: Period[] = ['this-week', 'last-week', '4-weeks'];
const KIND_ICON: Record<WorkKind, IconName> = { email: 'mail', sent: 'send', task: 'check', check: 'clock' };

/** The team average mark: a dashed line drawn as a gradient. */
const AVG_DASH = 'repeating-linear-gradient(to bottom, var(--cth-ink-3) 0 3px, transparent 3px 6px)';
const money = (v: number): string => `$${(Math.round(v * 100) / 100).toFixed(2)}`;
const dollars = (v: number): string => `$${Math.round(v)}`;
const pct = (v: number): string => `${Math.round(v * 100)}%`;
function duration(ms: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return t('pulse.minutes', { m });
  const h = Math.floor(m / 60);
  return t('pulse.hoursMinutes', { h, m: m % 60 });
}
function every(ms: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  return ms % 3_600_000 === 0 ? t('pulse.hoursShort', { h: ms / 3_600_000 }) : t('pulse.minutesShort', { m: Math.round(ms / 60_000) });
}

/** Layout by the stage's width (design D14). */
type Layout = 'wide' | 'mid' | 'narrow';
function useLayout(ref: React.RefObject<HTMLElement | null>): Layout {
  const [w, setW] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(e[0]?.contentRect.width ?? 1200));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w >= 1100 ? 'wide' : w >= 760 ? 'mid' : 'narrow';
}

const card: CSSProperties = { background: 'var(--cth-card)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-md)' };
const label: CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cth-ink-3)', display: 'flex', gap: 6, alignItems: 'center' };
const mono: CSSProperties = { fontFamily: 'var(--cth-font-mono)' };
const btn = (primary: boolean): CSSProperties => ({
  height: 28, padding: '0 12px', borderRadius: 'var(--cth-r-md)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--cth-font-ui)', cursor: 'pointer',
  border: 'none', background: primary ? 'var(--cth-ink)' : 'var(--cth-card)', color: primary ? 'var(--cth-bg)' : 'var(--cth-ink)',
  boxShadow: primary ? 'none' : 'inset 0 0 0 1px var(--cth-line-2)'
});

function Section({ title, tip, children }: { title: string; tip?: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', display: 'flex', gap: 6, alignItems: 'center' }}>
        {title}{tip && <InfoTip text={tip} />}
      </h2>
      {children}
    </section>
  );
}

/** A bar of who did it, members of one department in its acc, m then d shades (D13). */
function WhoBar({ by, colorOf, nameOf, height = 10, aria }: { by: Array<{ agentId: string; count: number }>; colorOf: (id: string, nth: number) => string; nameOf: (id: string) => string; height?: number; aria: string }) {
  const total = by.reduce((s, b) => s + b.count, 0) || 1;
  const seen = new Map<string, number>();
  const shades = by.map((b) => {
    const dept = colorOf(b.agentId, -1);
    const n = seen.get(dept) ?? 0;
    seen.set(dept, n + 1);
    return colorOf(b.agentId, n);
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div role="img" aria-label={aria} style={{ display: 'flex', height, borderRadius: 'var(--cth-r-pill)', overflow: 'hidden', gap: 2 }}>
        {by.map((b, i) => <i key={b.agentId} style={{ display: 'block', width: `${(b.count / total) * 100}%`, background: shades[i] }} />)}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--cth-ink-2)' }} aria-hidden>
        {by.map((b, i) => (
          <span key={b.agentId} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <b style={{ width: 8, height: 8, borderRadius: '50%', background: shades[i], display: 'inline-block' }} />
            {nameOf(b.agentId)} <span style={mono}>{b.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function PulseView() {
  const { t, i18n } = useTranslation();
  const agents = useStore((s) => s.agents);
  const updateAgent = useStore((s) => s.updateAgent);
  const openAgentProfile = useStore((s) => s.openAgentProfile);
  const dark = useAppTheme() === 'dark';
  const { missions } = useMissions();
  const host = useRef<HTMLDivElement | null>(null);
  const layout = useLayout(host);
  const [period, setPeriod] = useState<Period>(() => {
    try { const v = window.localStorage.getItem(LS_PERIOD); return PERIODS.includes(v as Period) ? (v as Period) : 'this-week'; } catch { return 'this-week'; }
  });
  const [data, setData] = useState<PulseData | null>(null);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [applied, setApplied] = useState<Array<{ advice: Advice; appliedId: number; text: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');

  const load = useCallback(async () => {
    try { setData(await window.cth.pulseSnapshot(period)); setFailed(false); } catch { setFailed(true); }
  }, [period]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => window.cth.onPulseUpdated(() => { void load(); }), [load]);

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const nameOf = useCallback((id: string) => byId.get(id)?.name ?? id, [byId]);
  const colorOf = useCallback((id: string, nth: number): string => {
    const a = byId.get(id);
    const f = family(a ? departmentOf(a) : 'team', dark);
    if (nth < 0) return a ? departmentOf(a) : 'team';
    return [f.acc, f.m, f.d][nth % 3];
  }, [byId, dark]);
  const fmtShort = (day: string): string => new Date(`${day}T12:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const listNames = (names: string[]): string => { try { return new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(names); } catch { return names.join(', '); } };
  const fmtDay = (day: string | number): string => new Date(typeof day === 'number' ? day : `${day}T12:00:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' });
  const jobOf = (id?: string): string => missions.find((m) => m.id === id)?.label ?? '';

  const adviceText = (a: Advice): { title: string; evidence: string } => {
    const name = nameOf(a.agentId);
    const job = jobOf(a.missionId);
    const e = a.evidence;
    switch (a.kind) {
      case 'run-less': return { title: t('pulse.advice.runLess', { name, job }), evidence: t('pulse.advice.runLessWhy', { nothing: e.nothing, runs: e.runs }) + (a.change.kind === 'interval' ? ` ${t('pulse.advice.everyChange', { from: every(a.change.fromMs, t), to: every(a.change.toMs, t) })}` : '') };
      case 'run-more': return { title: t('pulse.advice.runMore', { name, job }), evidence: t('pulse.advice.runMoreWhy', { didWork: e.didWork, runs: e.runs }) + (a.change.kind === 'interval' ? ` ${t('pulse.advice.everyChange', { from: every(a.change.fromMs, t), to: every(a.change.toMs, t) })}` : '') };
      case 'cheaper-model': return { title: t('pulse.advice.tryModel', { name, model: a.change.kind === 'model' ? a.change.toLabel : '' }), evidence: t('pulse.advice.cheaperWhy', { kept: e.kept, decisions: e.decisions }) };
      default: return { title: t('pulse.advice.tryModel', { name, model: a.change.kind === 'model' ? a.change.toLabel : '' }), evidence: e.reopens && e.reopens >= 3 ? t('pulse.advice.reopenedWhy', { reopens: e.reopens }) : t('pulse.advice.strongerWhy', { kept: e.kept, decisions: e.decisions }) };
    }
  };

  const apply = async (a: Advice): Promise<void> => {
    if (a.change.kind === 'editor') { openAgentProfile(a.agentId); return; }
    if (busy) return;
    setBusy(a.id);
    try {
      const r = await window.cth.pulseApply(a.id, a.change);
      if (!r.ok) { setNotice(t(r.error === 'stale' ? 'pulse.staleApply' : 'pulse.applyFailed')); await load(); return; }
      let appliedId = r.kind === 'schedule' ? r.appliedId : 0;
      let text = '';
      if (r.kind === 'schedule' && a.change.kind === 'interval') text = t('pulse.appliedSchedule', { name: nameOf(a.agentId), job: jobOf(a.missionId), to: every(a.change.toMs, t) });
      if (r.kind === 'model') {
        updateAgent(r.agentId, { model: r.to });
        appliedId = await window.cth.pulseModelApplied(a.id, r.agentId, r.from, r.to);
        text = t('pulse.appliedModel', { name: nameOf(r.agentId), model: a.change.kind === 'model' ? a.change.toLabel : r.to });
      }
      setApplied((list) => [...list, { advice: a, appliedId, text }]);
      setNotice(text);
      await load();
    } finally { setBusy(null); }
  };
  const undo = async (item: { advice: Advice; appliedId: number }): Promise<void> => {
    const r = await window.cth.pulseUndo(item.appliedId);
    if (!r.ok) { setNotice(t('pulse.staleUndo')); return; }
    if (r.kind === 'model') updateAgent(r.agentId, { model: r.to ?? undefined });
    setApplied((list) => list.filter((x) => x.appliedId !== item.appliedId));
    setNotice(t('pulse.undone'));
    await load();
  };
  const notNow = async (a: Advice): Promise<void> => { await window.cth.pulseDismiss(a.id); await load(); };

  const view = data;
  const cols = layout === 'wide' ? 4 : layout === 'mid' ? 2 : 1;
  const sugCols = layout === 'wide' ? 3 : layout === 'mid' ? 2 : 1;
  const grid = (n: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 12 });

  let body: ReactNode;
  if (failed || (view && !view.available)) {
    body = (
      <div style={{ ...card, padding: 26, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{t('pulse.unavailable')}</div>
        <div style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>{t('pulse.unavailableHint')}</div>
        <button type="button" style={{ ...btn(false), marginTop: 6 }} onClick={() => { void load(); }}>{t('pulse.tryAgain')}</button>
      </div>
    );
  } else if (!view) {
    body = null;
  } else {
    const s = view.snapshot;
    const godId = s.michael?.agentId;
    const shownAdvice = view.advice.filter((a) => !applied.some((x) => x.advice.id === a.id));
    // A snapshot from a main process older than this view (before a restart) has neither.
    const safe = view.keptSafe ?? keptSafe([]);
    const toNet = safe.toInternet.pass + safe.toInternet.clean + safe.toInternet.stop;
    const answers = safe.webAnswers.pass + safe.webAnswers.clean;
    // Only the gates this view can name: a count from another build is left out.
    const rules = (Object.entries(safe.rules) as Array<[RefusalGate, number]>).filter(([g, n]) => REFUSAL_GATES.includes(g) && n > 0);
    const rulesTotal = rules.reduce((n, [, x]) => n + x, 0);
    const learn = view.learning ?? { weeks: [], notes: 0, procedures: 0, knows: {} };
    // Learning, money and your time: one row of four tiles.
    const row4: CSSProperties = { display: 'grid', gridTemplateColumns: layout === 'wide' ? 'repeat(4, minmax(0, 1fr))' : layout === 'mid' ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 12 };
    const tight: CSSProperties = { ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 };
    // Learning follows the period (owner, 2026-10-15): this week, last week or
    // the last four, against the same span just before it.
    const span = s.period === '4-weeks' ? 4 : 1;
    const off = s.period === 'last-week' ? 1 : 0;
    const wk = learn.weeks;
    const sumWeeks = (ws: typeof wk) => ws.reduce((a, w) => ({ you: a.you + w.added.you, job: a.job + w.added.job, michael: a.michael + w.added.michael, asks: a.asks + w.asks, turns: a.turns + w.turns }), { you: 0, job: 0, michael: 0, asks: 0, turns: 0 });
    const cur = sumWeeks(wk.slice(Math.max(0, wk.length - off - span), wk.length - off));
    const prevWeeks = wk.slice(Math.max(0, wk.length - off - 2 * span), Math.max(0, wk.length - off - span));
    const prev = sumWeeks(prevWeeks);
    const rateOf = (x: { asks: number; turns: number }): number | null => (x.turns >= MIN_TURNS_FOR_RATE ? Math.round((x.asks / x.turns) * 1000) / 10 : null);
    const rate = rateOf(cur);
    const prevRate = prevWeeks.length === span ? rateOf(prev) : null;
    const curAdded = cur.you + cur.job + cur.michael;
    // Last 4 weeks: each tile shows its week by week trend (owner, 2026-10-15).
    const wks = view.weeks ?? null;
    const wkLabels = (wks?.from ?? []).map(fmtShort);
    const lastFour = wk.slice(-4);
    // Team at work: everyone on the team now, Michael included, busiest first.
    const rows = s.members.filter((m) => byId.has(m.agentId))
      .map((m) => ({ ...m, busyMs: m.busyMs ?? 0, turns: m.turns ?? 0, dayBusy: m.dayBusy ?? [] }))
      .sort((a, b) => b.busyMs - a.busyMs);
    const work = teamAtWork(rows);
    const maxBusy = Math.max(1, ...rows.map((m) => m.busyMs));
    const workGrid: CSSProperties = { display: 'grid', alignItems: 'center', gap: 14, gridTemplateColumns: layout === 'wide' ? '190px minmax(0, 1fr) 66px 86px' : layout === 'mid' ? '170px minmax(0, 1fr) 66px 76px' : 'minmax(0, 1fr) minmax(0, 1fr) 60px 70px' };
    // On a plan or an API key the dollars are a real cost; otherwise a pay per use value.
    const costWord = view.plan || view.billing === 'apiKey' ? 'pulse.work.cost' : 'pulse.work.value';
    const outcomeLabel = (o: Outcome): string => t(`pulse.outcome.${o.kind}`, { sub: o.sub ?? 0 });
    const outcomeAria = (o: Outcome): string => `${outcomeLabel(o)}: ${o.by.map((b) => `${nameOf(b.agentId)} ${b.count}`).join(', ')}`;
    // Saved by your changes shows only once a change was applied (owner, 2026-10-15).
    const savedShown = view.saved.state !== 'none';
    body = (
      <>
        {s.gapDays.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--cth-ink-2)', background: 'var(--cth-neutral-soft)', borderRadius: 'var(--cth-r-lg)', padding: '8px 11px' }}>
            <Icon name="info" /> {t('pulse.gapNotice', { days: s.gapDays.map(fmtDay).join(', ') })}
          </div>
        )}

        <Section title={t('pulse.recommendations')} tip={t('pulse.recommendationsTip')}>
          <div style={grid(sugCols)}>
            {applied.map((x) => (
              <div key={`a-${x.appliedId}`} style={{ background: 'var(--cth-green-soft)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-green) 35%, transparent)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t('pulse.applied')} {x.text}</div>
                <div><button type="button" style={btn(false)} onClick={() => { void undo(x); }}>{t('pulse.undo')}</button></div>
              </div>
            ))}
            {shownAdvice.slice(0, Math.max(0, 3 - applied.length)).map((a) => {
              const txt = adviceText(a);
              return (
                <div key={a.id} style={{ background: 'var(--cth-amber-soft)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-amber) 40%, transparent)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <AgentAvatar id={a.agentId} name={nameOf(a.agentId)} size={22} />
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: '18px' }}>{txt.title}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--cth-amber-text)', lineHeight: '17px' }}>{txt.evidence}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button type="button" style={btn(true)} disabled={busy === a.id} onClick={() => { void apply(a); }}>
                      {a.change.kind === 'editor' ? t('pulse.openSchedules') : t('pulse.apply')}
                    </button>
                    <button type="button" style={btn(false)} onClick={() => { void notNow(a); }}>{t('pulse.notNow')}</button>
                    {a.savesPerWeek !== null && a.savesPerWeek > 0 && (
                      <span style={{ marginInlineStart: 'auto', fontSize: 11, fontWeight: 600, color: 'var(--cth-green-text)', background: 'var(--cth-green-soft)', borderRadius: 'var(--cth-r-pill)', padding: '2px 8px' }}>
                        {t('pulse.savesAbout', { usd: money(a.savesPerWeek) })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {shownAdvice.length === 0 && applied.length === 0 && (
              <div style={{ ...card, padding: '12px 14px', fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-2)', display: 'flex', alignItems: 'center', gridColumn: savedShown ? (sugCols > 1 ? `span ${sugCols - 1}` : undefined) : '1 / -1' }}>
                {view.adviceFrom ? t('pulse.adviceStarts', { day: fmtDay(view.adviceFrom), since: fmtDay(view.liveSince ?? Date.now()) }) : t('pulse.nothingToChange')}
              </div>
            )}
            {savedShown && <div style={{ ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
              <div style={label}>{t('pulse.savedByChanges')}<InfoTip text={t('pulse.savedTip')} /></div>
              {view.saved.state === 'measuring' && <><div style={{ fontSize: 22, fontWeight: 600 }}>{t('pulse.measuring')}</div><div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.firstResult', { day: fmtDay(view.saved.firstAt) })}</div></>}
              {view.saved.state === 'measured' && <><div style={{ ...mono, fontSize: 22, fontWeight: 600, color: view.saved.usd >= 0 ? 'var(--cth-green-text)' : 'var(--cth-ink)' }}>{view.saved.usd < 0 ? '−' : ''}{money(Math.abs(view.saved.usd))}</div><div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t(view.saved.usd < 0 ? 'pulse.costMore' : 'pulse.since', { day: fmtDay(view.saved.since) })}</div></>}
            </div>}
          </div>
        </Section>

        <Section title={t('pulse.whatGotDone')}>
          <div style={grid(cols)}>
            {s.outcomes.map((o) => (
              <div key={o.kind} style={{ ...card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div aria-hidden style={{ width: 30, height: 30, borderRadius: 'var(--cth-r-md)', background: 'var(--cth-card-2)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'grid', placeItems: 'center', color: 'var(--cth-ink-2)' }}><Icon name={KIND_ICON[o.kind]} size={1.125} /></div>
                <div style={{ ...mono, fontSize: 28, fontWeight: 600, lineHeight: '30px' }}>{o.total.toLocaleString(i18n.language)}</div>
                <div style={{ fontSize: 12, color: 'var(--cth-ink-2)' }}>{outcomeLabel(o)}</div>
                {wks ? <WeekBars labels={wkLabels} series={[{ values: wks[o.kind === 'email' ? 'emails' : o.kind === 'sent' ? 'sent' : o.kind === 'task' ? 'tasks' : 'checks'], color: 'var(--cth-ink-2)' }]} aria={outcomeLabel(o)} />
                  : o.kind === 'check'
                  ? <WhoBar by={[{ agentId: '__work', count: o.sub ?? 0 }, { agentId: '__none', count: o.total - (o.sub ?? 0) }]} colorOf={(id) => (id === '__work' ? 'var(--cth-ink-2)' : 'var(--cth-line-2)')} nameOf={(id) => t(id === '__work' ? 'pulse.foundWork' : 'pulse.nothingToDo')} aria={outcomeLabel(o)} />
                  : <WhoBar by={o.by} colorOf={colorOf} nameOf={nameOf} aria={outcomeAria(o)} />}
              </div>
            ))}
          </div>
        </Section>

        {/* Kept safe (owner, 2026-10-15): no header; each tile says what it guards. */}
        <section aria-label={t('pulse.safe.title')}>
          <div style={grid(cols)}>
            <StatTile icon="shield" value={toNet} trend={wks && <WeekBars labels={wkLabels} series={[{ values: wks.toInternet, color: 'var(--cth-ink-2)' }]} aria={t('pulse.safe.toInternet')} />} tip={t('pulse.safe.trustTip')} text={t(toNet > 0 && safe.toInternet.clean + safe.toInternet.stop === 0 ? 'pulse.safe.toInternetNone' : 'pulse.safe.toInternet')}
              parts={[{ n: safe.toInternet.pass, name: t('pulse.safe.sentAsWritten'), color: 'var(--cth-ink-2)' }, { n: safe.toInternet.clean, name: t('pulse.safe.privateOut'), color: 'var(--cth-green)' }, { n: safe.toInternet.stop, name: t('pulse.safe.stopped'), color: 'var(--cth-amber)' }]} />
            <StatTile icon="search" value={safe.webAnswers.clean} of={answers} trend={wks && <WeekBars labels={wkLabels} series={[{ values: wks.cleaned, color: 'var(--cth-green)' }]} aria={t('pulse.safe.answersCleaned')} />} tip={t('pulse.safe.trustTip')} text={t('pulse.safe.answersCleaned')}
              parts={[{ n: safe.webAnswers.clean, name: t('pulse.safe.cleaned'), color: 'var(--cth-green)' }, { n: safe.webAnswers.pass, name: t('pulse.safe.nothingToRemove'), color: 'var(--cth-ink-4)' }, { n: safe.webAnswers.flagged, name: t('pulse.safe.flagged'), color: 'var(--cth-amber)' }]} />
            <StatTile icon="pause" value={safe.held} trend={wks && <WeekBars labels={wkLabels} series={[{ values: wks.held, color: 'var(--cth-amber)' }]} aria={t('pulse.safe.held')} />} tip={t('pulse.safe.heldTip')} text={t(safe.held > 0 ? 'pulse.safe.held' : 'pulse.safe.heldNone')} amber={safe.held > 0} />
            <StatTile icon="lock" value={rulesTotal} trend={wks && <WeekBars labels={wkLabels} series={[{ values: wks.rules, color: 'var(--cth-ink-3)' }]} aria={t('pulse.safe.rules')} />} tip={t('pulse.safe.rulesTip')} text={t(rulesTotal > 0 ? 'pulse.safe.rules' : 'pulse.safe.rulesNone')}
              parts={[...rules].sort((a, b) => b[1] - a[1]).map(([g, n], i) => ({ n, name: t(`pulse.safe.gate.${g}`), color: ['var(--cth-ink-2)', 'var(--cth-ink-3)', 'var(--cth-ink-4)', 'var(--cth-line-2)'][Math.min(i, 3)] }))} />
          </div>
        </section>

        {/* Learning, money and your time in one row of four (owner, 2026-10-15):
            each tile only as big as what it shows. */}
        <section aria-label={t('pulse.learning.title')} style={row4}>
          <div style={tight}>
            <TileTitle icon="book" title={t('pulse.learning.learned')} sub={t(`pulse.learning.sub.${s.period}`)} tip={t('pulse.learning.tip')} />
            <div style={{ ...mono, fontSize: 24, fontWeight: 600, lineHeight: '26px' }}>{curAdded.toLocaleString(i18n.language)}</div>
            {wks && <WeekBars labels={wkLabels} series={[{ values: lastFour.map((w) => w.added.you), color: 'var(--cth-green)' }, { values: lastFour.map((w) => w.added.job), color: 'var(--cth-ink-4)' }, { values: lastFour.map((w) => w.added.michael), color: 'var(--cth-indigo)' }]} aria={t(`pulse.learning.sub.${s.period}`)} />}
            {!wks && curAdded > 0 && <Stack parts={[{ n: cur.you, color: 'var(--cth-green)' }, { n: cur.job, color: 'var(--cth-ink-4)' }, { n: cur.michael, color: 'var(--cth-indigo)' }]} aria={`${t('pulse.learning.fromYou')} ${cur.you}, ${t('pulse.learning.onJob')} ${cur.job}, ${t('pulse.learning.fromMichael')} ${cur.michael}`} />}
            {curAdded > 0 && <Legend items={[[t('pulse.learning.fromYou'), 'var(--cth-green)', cur.you], [t('pulse.learning.onJob'), 'var(--cth-ink-4)', cur.job], [t('pulse.learning.fromMichael'), 'var(--cth-indigo)', cur.michael]]} />}
            <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{t('pulse.learning.inAll', { notes: learn.notes.toLocaleString(i18n.language), procedures: learn.procedures })}</div>
          </div>
          <div style={tight}>
            <TileTitle icon="help" title={t('pulse.learning.questions')} sub={t('pulse.learning.questionsSub')} />
            <div style={{ ...mono, fontSize: 24, fontWeight: 600, lineHeight: '26px' }}>{rate !== null ? rate.toFixed(1) : '…'}</div>
            <div style={{ fontSize: 11, color: 'var(--cth-ink-2)', lineHeight: '15px' }}>
              {rate === null ? t('pulse.learning.tooFewRate')
                : prevRate === null ? t('pulse.learning.counts', { asks: cur.asks, turns: cur.turns.toLocaleString(i18n.language) })
                : t(rate < prevRate ? 'pulse.learning.down' : rate > prevRate ? 'pulse.learning.up' : 'pulse.learning.same', { from: prevRate.toFixed(1), before: t(`pulse.learning.before.${s.period}`) })}
            </div>
            {rate !== null && prevRate !== null && <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{t('pulse.learning.counts', { asks: cur.asks, turns: cur.turns.toLocaleString(i18n.language) })}</div>}
            {wks && <WeekLine labels={wkLabels} values={lastFour.map((w) => w.per100)} format={(v) => v.toFixed(1)} aria={t('pulse.learning.questionsSub')} />}
          </div>
          {/* One total (owner, 2026-10-15): who spent what is Team at work's job.
              Plan use sits at the foot of the same tile, as a bar, so the tile
              is filled top to bottom like its neighbours. */}
          <div style={{ ...tight, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={label}>
                {t('pulse.whereMoneyWent')}
                <InfoTip text={view.plan ? t('pulse.plan.tip', { monthly: dollars(view.plan.monthly), payPerUse: money(view.plan.payPerUse) }) : t('pulse.valueTip')} />
              </div>
              <div style={{ ...mono, fontSize: 24, fontWeight: 600, lineHeight: '26px' }}>{money(s.totalUsd)}</div>
              <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>
                {view.plan
                  ? t('pulse.plan.ofPlan', { plan: view.plan.label ?? t('pulse.plan.yourPlan'), monthly: dollars(view.plan.monthly) })
                  : t(view.billing === 'apiKey' ? 'pulse.spentApiKey' : 'pulse.plan.noPrice')}
              </div>
            </div>
            {wks && <WeekBars labels={wkLabels} series={[{ values: wks.usd, color: 'var(--cth-ink-2)' }]} format={(v) => `$${Math.round(v)}`} aria={t('pulse.whereMoneyWent')} />}
            {view.headroom && (
              <div role="img" aria-label={t('pulse.planAria', { pct: Math.round(view.headroom.usedPct) })} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={label}>{t('pulse.planUse')}<InfoTip text={t('pulse.planTip')} /></span>
                  <span style={{ ...mono, fontSize: 12, fontWeight: 600, marginInlineStart: 'auto' }}>{Math.round(view.headroom.usedPct)}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-neutral-soft)', overflow: 'hidden' }}>
                  <i style={{ display: 'block', height: '100%', width: `${Math.min(100, view.headroom.usedPct)}%`, background: view.headroom.runsOutAt ? 'var(--cth-amber)' : 'var(--cth-ink-2)', borderRadius: 'var(--cth-r-pill)' }} />
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 10.5, color: 'var(--cth-ink-3)' }}>
                  {t('pulse.resets', { day: fmtDay(view.headroom.resetsAt) })}
                  {view.headroom.runsOutAt && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--cth-amber-text)', background: 'var(--cth-amber-soft)', borderRadius: 'var(--cth-r-pill)', padding: '1px 6px' }}>{t('pulse.runsOut', { day: fmtDay(view.headroom.runsOutAt) })}</span>}
                </div>
              </div>
            )}
          </div>
          {/* Your time and while you were away: both about you, one tile; the
              number at the top, what it means at the foot. */}
          <div style={{ ...tight, flexDirection: 'row', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={label}>{t('pulse.yourTime')}<InfoTip text={t('pulse.yourTimeTip')} /></div>
                <div style={{ ...mono, fontSize: 24, fontWeight: 600, lineHeight: '26px' }}>{s.yourTime.asks}</div>
                <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{s.yourTime.medianWaitMs !== null ? t('pulse.questionsAnswered', { time: duration(s.yourTime.medianWaitMs, t) }) : t('pulse.questions')}</div>
              </div>
              {wks ? <WeekBars labels={wkLabels} series={[{ values: wks.asks, color: 'var(--cth-ink-2)' }]} aria={t('pulse.yourTime')} />
                : prevWeeks.length === span && <div style={{ fontSize: 11, color: 'var(--cth-ink-2)', lineHeight: '15px' }}>{t('pulse.asksBefore', { n: prev.asks, before: t(`pulse.learning.before.${s.period}`) })}</div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0, paddingInlineStart: 14, boxShadow: 'inset 1px 0 0 var(--cth-line)', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={label}>{t('pulse.whileAway')}<InfoTip text={t('pulse.awayTip')} /></div>
                <div style={{ ...mono, fontSize: 24, fontWeight: 600, lineHeight: '26px' }}>{s.awayShare === null ? '0%' : pct(s.awayShare)}</div>
              </div>
              {wks ? <WeekLine compact labels={wkLabels} values={wks.away} format={(v) => pct(v)} aria={t('pulse.whileAway')} />
                : <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{t('pulse.awayLine')}</div>}
            </div>
          </div>
        </section>

        <Section title={t('pulse.work.title')} tip={t('pulse.work.tip')}>
          <div style={{ ...card, padding: '12px 16px 10px' }}>
            {work.totalMs <= 0 ? <div style={{ fontSize: 13, color: 'var(--cth-ink-2)', padding: '6px 0' }}>{t('pulse.work.none')}</div> : <>
              <div style={{ fontSize: 13, color: 'var(--cth-ink-2)', lineHeight: '19px' }}>
                {work.topTwo && <b style={{ color: 'var(--cth-ink)' }}>{t('pulse.work.headTop', { a: nameOf(work.topTwo.ids[0]), b: nameOf(work.topTwo.ids[1]), pct: pct(work.topTwo.share) })}</b>}
                {work.quiet.length > 0 && <> {t(work.quiet.length === 1 ? 'pulse.work.headQuietOne' : 'pulse.work.headQuiet', { names: listNames(work.quiet.map(nameOf)) })}</>}
                {work.costliest && <> {t('pulse.work.headCostly', { name: nameOf(work.costliest.agentId), usd: money(work.costliest.usd), time: duration(work.costliest.busyMs, t) })}</>}
              </div>
              <div role="list" aria-label={t('pulse.work.title')} style={{ marginTop: 6 }}>
                <div aria-hidden style={{ ...workGrid, height: 26 }}>
                  <span style={label}>{t('pulse.work.member')}</span>
                  <span style={label}>{t('pulse.work.time')}</span>
                  <span style={label}>{t('pulse.work.hours')}</span>
                  <span style={{ ...label, justifyContent: 'flex-end' }}>{t(costWord)}</span>
                </div>
                {rows.map((m) => {
                  const chip = work.chips[m.agentId];
                  const quiet = chip?.kind === 'quiet';
                  const color = m.agentId === godId ? 'var(--cth-indigo)' : colorOf(m.agentId, 0);
                  const role = m.agentId === godId ? t('pulse.officeManager') : byId.get(m.agentId) ? roleOf(byId.get(m.agentId)!) : '';
                  return (
                    <div key={m.agentId} role="listitem"><button type="button" onClick={() => setDetail(m.agentId)}
                      aria-label={t('pulse.work.rowAria', { name: nameOf(m.agentId), time: duration(m.busyMs, t), value: money(m.usd) })}
                      style={{ ...workGrid, width: '100%', minHeight: 44, border: 'none', borderTop: '1px solid var(--cth-line)', background: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink)', padding: 0 }}>
                      <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, opacity: quiet ? 0.7 : 1 }}>
                        <span style={{ borderRadius: '50%', boxShadow: `0 0 0 1.5px ${color}`, display: 'inline-flex', flex: 'none' }}><AgentAvatar id={m.agentId} name={nameOf(m.agentId)} size={24} /></span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(m.agentId)}</span>
                          <span style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{role}</span>
                        </span>
                      </span>
                      <span style={{ position: 'relative', height: 14, borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-neutral-soft)' }}>
                        <i style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${(m.busyMs / maxBusy) * 100}%`, background: color, borderRadius: 'var(--cth-r-pill)' }} />
                        <b style={{ position: 'absolute', top: -6, bottom: -6, width: 1.5, insetInlineStart: `${(work.avgMs / maxBusy) * 100}%`, background: AVG_DASH }} />
                        {chip && <span style={{ position: 'absolute', insetInlineEnd: 0, top: -3 }}><WorkChipView chip={chip} /></span>}
                      </span>
                      <span style={{ ...mono, fontSize: 13, fontWeight: 600, opacity: quiet ? 0.7 : 1 }}>{duration(m.busyMs, t)}</span>
                      <span style={{ ...mono, fontSize: 13, fontWeight: 600, textAlign: 'end' }}>{money(m.usd)}</span>
                    </button></div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--cth-ink-3)', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--cth-line)' }}>
                <span><span style={{ display: 'inline-block', width: 1.5, height: 12, background: AVG_DASH, marginInlineEnd: 5, verticalAlign: 'middle' }} />{t('pulse.work.average', { time: duration(work.avgMs, t) })}</span>
                <span>{t(view.plan ? 'pulse.work.planLegend' : view.billing === 'apiKey' ? 'pulse.work.valueSpent' : 'pulse.work.valueLegend')}</span>
                <span style={{ marginInlineStart: 'auto' }}>{t('pulse.work.open')}</span>
              </div>
            </>}
          </div>
        </Section>
      </>
    );
  }

  return (
    <div ref={host} role="region" aria-label={t('floorView.pulse')} style={{ flex: 1, overflow: 'auto', padding: '22px 28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>{t('floorView.pulse')}</h1>
        <select
          aria-label={t('pulse.period')}
          value={period}
          onChange={(e) => { const v = e.target.value as Period; setPeriod(v); try { window.localStorage.setItem(LS_PERIOD, v); } catch { /* per-Mac nicety */ } }}
          className="cth-input"
          style={{ height: 30, fontSize: 12, borderRadius: 'var(--cth-r-md)' }}
        >
          {PERIODS.map((p) => <option key={p} value={p}>{t(`pulse.periods.${p}`)}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        {view?.collectingSince && <span style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.collectingSince', { day: fmtDay(view.collectingSince) })}</span>}
      </div>
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{notice}</div>
      {body}
      {detail && view && <MemberDetail id={detail} data={view} name={nameOf(detail)} onClose={() => setDetail(null)} money={money} />}
    </div>
  );
}

/** A Kept safe tile: an icon, a number, what it counts, and its parts (proposal 3). */
function StatTile({ icon, value, of, text, parts, amber, tip, trend }: { icon: IconName; value: number; of?: number; text: string; parts?: Array<{ n: number; name: string; color: string }>; amber?: boolean; tip?: string; trend?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const shown = (parts ?? []).filter((p) => p.n > 0 || (parts ?? []).length <= 3);
  return (
    <div style={{ ...(amber ? { background: 'var(--cth-amber-soft)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-amber) 40%, transparent)' } : card), padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div aria-hidden style={{ width: 30, height: 30, borderRadius: 'var(--cth-r-md)', background: amber ? 'var(--cth-card)' : 'var(--cth-card-2)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'grid', placeItems: 'center', color: amber ? 'var(--cth-amber-text)' : 'var(--cth-ink-2)' }}><Icon name={icon} size={1.125} /></div>
      <div style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 28, fontWeight: 600, lineHeight: '30px' }}>{value.toLocaleString(i18n.language)}{of !== undefined && <span style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 400, color: 'var(--cth-ink-3)', marginInlineStart: 6 }}>{t('pulse.safe.of', { n: of })}</span>}</div>
      <div style={{ fontSize: 12, color: 'var(--cth-ink-2)', lineHeight: '17px' }}>{text}{tip && <> <InfoTip text={tip} /></>}</div>
      {trend ? trend : <>
        {shown.length > 0 && shown.some((p) => p.n > 0) && <Stack parts={shown} aria={shown.map((p) => `${p.name} ${p.n}`).join(', ')} />}
        {shown.length > 0 && <Legend items={shown.map((p) => [p.name, p.color, p.n])} />}
      </>}
    </div>
  );
}

function Stack({ parts, aria }: { parts: Array<{ n: number; color: string }>; aria: string }) {
  return (
    <div role="img" aria-label={aria} style={{ display: 'flex', height: 8, borderRadius: 'var(--cth-r-pill)', overflow: 'hidden', gap: 2, background: 'var(--cth-neutral-soft)' }}>
      {parts.filter((p) => p.n > 0).map((p, i) => <i key={i} style={{ display: 'block', flex: p.n, background: p.color }} />)}
    </div>
  );
}

function Legend({ items }: { items: Array<[string, string, number?]> }) {
  return (
    <div aria-hidden style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: 11, color: 'var(--cth-ink-3)' }}>
      {items.map(([name, color, n]) => (
        <span key={name} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          <b style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'inline-block' }} />
          {name}{n !== undefined && <span style={{ fontFamily: 'var(--cth-font-mono)', color: 'var(--cth-ink-2)' }}>{n}</span>}
        </span>
      ))}
    </div>
  );
}

function TileTitle({ icon, title, sub, tip }: { icon: IconName; title: string; sub: string; tip?: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <div aria-hidden style={{ width: 26, height: 26, borderRadius: 'var(--cth-r-md)', background: 'var(--cth-card-2)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'grid', placeItems: 'center', color: 'var(--cth-ink-2)', flex: 'none' }}><Icon name={icon} size={1} /></div>
      <div>
        <div style={label}>{title}{tip && <InfoTip text={tip} />}</div>
        <div style={{ fontSize: 12, color: 'var(--cth-ink-2)' }}>{sub}</div>
      </div>
    </div>
  );
}

/** Four weeks as small bars, stacked when there is more than one series, the
 *  total above each and the week below (owner, 2026-10-15). */
function WeekBars({ labels, series, aria, format = (v) => String(v) }: { labels: string[]; series: Array<{ values: number[]; color: string }>; aria: string; format?: (v: number) => string }) {
  const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div role="img" aria-label={`${aria}: ${labels.map((l, i) => `${l} ${format(totals[i])}`).join(', ')}`} style={{ display: 'grid', gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))`, gap: 6, alignItems: 'end' }}>
      {labels.map((l, i) => (
        <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 10, color: 'var(--cth-ink-2)' }}>{format(totals[i])}</span>
          <div style={{ width: '70%', maxWidth: 28, height: Math.max(2, (totals[i] / max) * 34), display: 'flex', flexDirection: 'column-reverse', borderRadius: 3, overflow: 'hidden', background: 'var(--cth-neutral-soft)' }}>
            {series.map((x, k) => <i key={k} style={{ display: 'block', flex: x.values[i] ?? 0, background: x.color }} />)}
          </div>
          <span style={{ fontSize: 10, color: 'var(--cth-ink-3)', whiteSpace: 'nowrap' }}>{l}</span>
        </div>
      ))}
    </div>
  );
}

/** Four weeks of a rate as a small line; a week with no rate is a gap. */
/** compact: a narrow tile, where text in the scaled chart would fall under the
 *  10 px floor (DESIGN.md 4.2), so the line shows alone and its spoken label
 *  carries the weeks and values (ship review, 2026-10-16). */
function WeekLine({ labels, values, aria, format, compact = false }: { labels: string[]; values: Array<number | null>; aria: string; format: (v: number) => string; compact?: boolean }) {
  const W = 200, H = 52;
  const vals = values.filter((v): v is number => v !== null);
  const hi = Math.max(0.0001, ...vals) * 1.2;
  const x = (i: number): number => 14 + (i * (W - 28)) / Math.max(1, labels.length - 1);
  const y = (v: number): number => H - 14 - (v / hi) * (H - 28);
  const pts = values.map((v, i) => (v === null ? null : `${x(i).toFixed(0)},${y(v).toFixed(0)}`)).filter(Boolean).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${aria}: ${labels.map((l, i) => `${l} ${values[i] === null ? '…' : format(values[i]!)}`).join(', ')}`} style={{ maxWidth: 260 }}>
      {vals.length > 1 && <polyline points={pts} fill="none" stroke="var(--cth-ink-2)" strokeWidth={1.75} />}
      {values.map((v, i) => (
        <g key={i}>
          {v !== null && <>
            <circle cx={x(i)} cy={y(v)} r={3} fill="var(--cth-card)" stroke="var(--cth-ink)" strokeWidth={1.75} />
            {!compact && <text x={x(i)} y={y(v) - 7} textAnchor="middle" fontFamily="var(--cth-font-mono)" fontSize={9.5} fill="var(--cth-ink-2)">{format(v)}</text>}
          </>}
          {!compact && <text x={x(i)} y={H - 1} textAnchor="middle" fontSize={8.5} fill="var(--cth-ink-3)">{labels[i]}</text>}
        </g>
      ))}
    </svg>
  );
}

function WorkChipView({ chip }: { chip: WorkChip }) {
  const { t } = useTranslation();
  const base: CSSProperties = { fontSize: 10.5, fontWeight: 600, borderRadius: 'var(--cth-r-pill)', padding: '2px 8px', whiteSpace: 'nowrap' };
  if (chip.kind === 'costly') return <span style={{ ...base, background: 'var(--cth-amber-soft)', color: 'var(--cth-amber-text)' }}>{t('pulse.work.costly')}</span>;
  if (chip.kind === 'quiet') return <span style={{ ...base, background: 'var(--cth-neutral-soft)', color: 'var(--cth-ink-3)' }}>{t('pulse.work.quiet')}</span>;
  return <span style={{ ...base, background: 'var(--cth-card)', color: 'var(--cth-ink)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)' }}>{chip.kind === 'busiest' ? t('pulse.work.busiest') : t('pulse.work.times', { times: chip.times })}</span>;
}

function MemberDetail({ id, data, name, onClose, money }: { id: string; data: PulseData; name: string; onClose: () => void; money: (v: number) => string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  useDialog(ref, onClose);
  const backdrop = useBackdropClose(onClose);
  const m = data.snapshot.members.find((x) => x.agentId === id);
  const trend = data.trend[id] ?? [0, 0, 0, 0];
  const max = Math.max(...trend, 0.0001);
  const fact = (lbl: string, v: string, d: string, tip?: string): ReactNode => (
    <div style={{ background: 'var(--cth-card-2)', borderRadius: 'var(--cth-r-lg)', padding: '9px 11px', boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={label}>{lbl}{tip && <InfoTip text={tip} />}</div>
      <div style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 15, fontWeight: 600 }}>{v}</div>
      <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{d}</div>
    </div>
  );
  return (
    <div {...backdrop} style={{ position: 'fixed', inset: 0, background: 'var(--cth-backdrop)', zIndex: 300, display: 'grid', placeItems: 'start center', paddingTop: 80 }}>
      <div ref={ref} role="dialog" aria-modal aria-label={name} style={{ width: 560, maxWidth: 'calc(100% - 32px)', ...card, borderRadius: 'var(--cth-r-2xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)', padding: '18px 20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <AgentAvatar id={id} name={name} size={30} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>{name}</div>
          <button type="button" aria-label={t('common.close')} onClick={onClose} style={{ marginInlineStart: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--cth-ink-3)' }}><Icon name="x" /></button>
        </div>
        {m && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            {fact(t(data.plan || data.billing === 'apiKey' ? 'pulse.work.cost' : 'pulse.value'), money(m.usd), t('pulse.shareOfOffice', { pct: Math.round(m.share * 100) }), t(data.plan ? 'pulse.plan.memberTip' : 'pulse.valueTip'))}
            {fact(t('pulse.perPiece'), m.costForWork.perPiece !== null ? `$${m.costForWork.perPiece.toFixed(2)}` : '…', m.costForWork.kind ? t(`pulse.per.${m.costForWork.kind}`) : t('pulse.tooFew'), t('pulse.perPieceTip'))}
            {fact(t('pulse.yourTime'), t('pulse.asksCount', { count: m.asks }), m.askWaitMs !== null ? t('pulse.waited', { time: duration(m.askWaitMs, t) }) : '', t('pulse.yourTimeTip'))}
            {fact(t('pulse.keptAsIs'), m.kept.share !== null ? `${Math.round(m.kept.share * 100)}%` : `${m.kept.kept}/${m.kept.decisions}`, t('pulse.keptLine', { kept: m.kept.kept, decisions: m.kept.decisions }), t('pulse.keptTip'))}
            {fact(t('pulse.speed'), m.speedMs !== null ? duration(m.speedMs, t) : '…', t('pulse.speedLine'), t('pulse.speedTip'))}
            {fact(t('pulse.whileAway'), m.awayShare !== null ? `${Math.round(m.awayShare * 100)}%` : '…', t('pulse.awayMine'), t('pulse.awayTip'))}
          </div>
        )}
        <div>
          <div style={{ ...label, marginBottom: 6 }}>{t('pulse.fourWeeks')}</div>
          <div role="img" aria-label={trend.map((v) => money(v)).join(', ')} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 44 }}>
            {trend.map((v, i) => <div key={i} style={{ flex: 1, height: `${Math.max(4, (v / max) * 100)}%`, background: i === 3 ? 'var(--cth-ink-2)' : 'var(--cth-line-2)', borderRadius: '4px 4px 0 0' }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
