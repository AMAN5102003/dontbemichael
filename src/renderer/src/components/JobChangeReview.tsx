import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isComposingKey } from '@shared/imeGuard';
import { PixelButton } from './PixelButton';
import { InfoTip } from './InfoTip';
import { Disclosure } from './triggers/ui';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { useRtl } from '@/i18n/useDirection';
import { JobParts, fieldLabel, hint } from './fieldText';
import { Spinner } from './GetMichaelReady';

export type ReviseResult = Awaited<ReturnType<Window['cth']['workStyleRevise']>>;
export type ReviseOk = Extract<ReviseResult, { kind: 'ok' }>;
type Question = Extract<ReviseResult, { kind: 'question' }>;
type Progress = Parameters<Parameters<Window['cth']['onWorkStyleProgress']>[1]>[0];
type Answer = { question: string; answer: string };

/** What a run is given: the typed change, any change added on the way (Leave
 *  it with Kelly), the owner's answer to a question, and its stop id. */
export interface ReviseRun {
  typed: string;
  extras: string[];
  answer?: Answer;
  requestId: string;
}

export interface JobChangeReviewProps {
  /** Whose job, for the copy ("Working out what changes for Pam…"). */
  who: string;
  /** Michael or his assistant: no "What X handles" in the preview. */
  lead?: boolean;
  /** The change box; absent on the pack update card, which runs at once. */
  box?: { label: string; info?: string; placeholder?: string; button: string };
  /** The preview's heading; "Here's what changes" unless given. */
  previewTitle?: string;
  /** The rewrite: main's revise call, or the pack card's own. */
  run: (r: ReviseRun) => Promise<ReviseResult>;
  /** Only when the duties changed (eng D6): who already does the new work. */
  checkOverlap?: (ok: ReviseOk) => Promise<{ names: string[]; why: string } | null>;
  /** The job the run starts from, compared again at Apply (A3). */
  base?: () => string;
  /** Saves the job: 'moved' when it changed since `startedFrom`. */
  apply: (ok: ReviseOk, change: string, startedFrom: string) => Promise<'applied' | 'moved' | 'failed'>;
  applyLabel: string;
  /** The pack card: run on mount, Cancel closes it. */
  autoRun?: boolean;
  onCancel?: () => void;
  /** The line under the box after Apply or Undo (role=status). */
  status?: string | null;
  /** Bumped by the parent (Undo) to put focus back in the box. */
  focusKey?: number;
  /** Something typed or shown that leaving would lose. */
  onDraft?: (draft: boolean) => void;
  /** A run or a preview is up: the parent holds its own buttons. */
  onBusy?: (busy: boolean) => void;
  /** False where Apply sends no card for a one-time task (Michael's own job,
   *  the pack update card), so the preview never promises one. */
  sendsTask?: boolean;
}

type State =
  | { at: 'idle' }
  | { at: 'working'; progress?: Progress }
  | { at: 'ok'; ok: ReviseOk; from: string }
  | { at: 'question'; q: Question }
  | { at: 'overlap'; names: string[]; why: string }
  | { at: 'error' }
  | { at: 'moved' };

const SUMMARY_SHOWN = 6;

/**
 * "What should change?" and its preview (docs/designs/work-style-change-request.md,
 * DESIGN.md §7.26): the owner types what should change, the app shows what
 * changes, and nothing saves before Apply. The preview takes the box's place
 * on the indigo-soft fill (DR8); a clash asks with option rows (DR5); an
 * overlap names the teammate (DR6). Edit agent, the hire wizard and the pack
 * update card share it.
 */
export function JobChangeReview(p: JobChangeReviewProps) {
  const { t, i18n } = useTranslation();
  const rtl = useRtl();
  const [typed, setTyped] = useState('');
  const [extras, setExtras] = useState<string[]>([]);
  const [state, setState] = useState<State>({ at: p.autoRun ? 'working' : 'idle' });
  const [applying, setApplying] = useState(false);
  const [failed, setFailed] = useState(false);
  const runId = useRef<string | null>(null);
  /** Bumped by every start, Stop and Cancel: a run that awaited something
   *  (the overlap check) shows nothing once a newer step has happened. */
  const runSeq = useRef(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const answerRef = useRef<Answer | undefined>(undefined);

  const stopRun = (): void => {
    const id = runId.current;
    runId.current = null;
    if (id) void window.cth.workStyleConvertStop?.(id)?.catch(() => undefined);
  };
  // Closing the dialog mid rewrite stops it (eng D9).
  useEffect(() => () => stopRun(), []);

  const start = async (more: string[] = extras, answer?: Answer): Promise<void> => {
    if (!p.autoRun && !typed.trim()) return;
    stopRun();
    const seq = ++runSeq.current;
    const requestId = `revise-${crypto.randomUUID()}`;
    runId.current = requestId;
    answerRef.current = answer;
    setFailed(false);
    setState({ at: 'working' });
    // Real steps and the words as they are written, from main (owner,
    // 2026-10-23: a still box for up to a minute read as stuck).
    const off = window.cth.onWorkStyleProgress?.(requestId, (progress) => {
      if (runId.current !== requestId) return;
      setState((s) => (s.at === 'working' ? { at: 'working', progress } : s));
    });
    const from = p.base?.() ?? '';
    const res = await p.run({ typed: typed.trim(), extras: more, answer, requestId }).catch((): ReviseResult => ({ kind: 'error', reason: 'failed' }));
    off?.();
    if (runId.current !== requestId) return; // stopped, or a newer run
    runId.current = null;
    if (res.kind === 'error') { setState(res.reason === 'cancelled' ? { at: 'idle' } : { at: 'error' }); return; }
    if (res.kind === 'question') { setState({ at: 'question', q: res }); return; }
    if (res.handles && p.checkOverlap) {
      const overlap = await p.checkOverlap(res).catch(() => null);
      if (runSeq.current !== seq) return; // stopped or replaced during the check
      if (overlap?.names.length) { setState({ at: 'overlap', names: overlap.names, why: overlap.why }); return; }
    }
    setState({ at: 'ok', ok: res, from });
  };
  useEffect(() => { if (p.autoRun) void start([]); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = (): void => { runSeq.current++; stopRun(); setState({ at: 'idle' }); if (p.autoRun) p.onCancel?.(); };
  const cancel = (): void => { runSeq.current++; setState({ at: 'idle' }); setExtras([]); if (p.autoRun) p.onCancel?.(); };
  const doApply = async (ok: ReviseOk, from: string): Promise<void> => {
    setApplying(true);
    setFailed(false);
    // The owner's answer to a clash goes with the change, so a pack update
    // that replays the list never asks the same clash again.
    const answered = answerRef.current?.answer.trim();
    const change = [typed.trim(), ...extras, ...(answered ? [`(${answered})`] : [])].filter(Boolean).join(' ');
    const r = await p.apply(ok, change, from).catch(() => 'failed' as const);
    setApplying(false);
    if (r === 'moved') { setState({ at: 'moved' }); return; }
    if (r === 'failed') { setFailed(true); return; }
    setTyped('');
    setExtras([]);
    setState({ at: 'idle' });
  };

  // Focus follows the state: each new state's heading, the box when back
  // (DR10). Not on opening: the dialog's first field keeps it.
  const shown = useRef(false);
  useEffect(() => {
    if (!shown.current) { shown.current = true; if (state.at === 'idle') return; }
    if (state.at === 'idle') { if (!p.autoRun) box.current?.focus({ preventScroll: true }); return; }
    heading.current?.focus({ preventScroll: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.at]);
  useEffect(() => { if (p.focusKey) box.current?.focus({ preventScroll: true }); }, [p.focusKey]);
  const draft = !!typed.trim() || state.at !== 'idle';
  useEffect(() => { p.onDraft?.(draft); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = state.at !== 'idle';
  useEffect(() => { p.onBusy?.(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const onBoxKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isComposingKey(e)) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void start(); }
  };
  const shortcut = window.cth.platform === 'darwin' ? t('jobChange.shortcutMac') : t('jobChange.shortcutOther');

  const head = (text: string, tone: 'ink' | 'coral' = 'ink'): ReactNode => (
    <div ref={heading} tabIndex={-1} style={{ ...headStyle, color: tone === 'coral' ? 'var(--cth-coral-text)' : 'var(--cth-ink)' }}>{text}</div>
  );

  let panel: ReactNode = null;
  if (state.at === 'working') {
    panel = <Working who={p.who} progress={state.progress} heading={head(t('jobChange.working', { name: p.who }))} onStop={stop} />;
  } else if (state.at === 'ok') {
    panel = <Preview ok={state.ok} who={p.who} lead={p.lead} sendsTask={p.sendsTask ?? true} title={p.previewTitle ?? t('jobChange.previewTitle')} heading={heading}
      applyLabel={p.applyLabel} applying={applying} failed={failed} onCancel={cancel} onApply={() => { void doApply(state.ok, state.from); }} />;
  } else if (state.at === 'question') {
    panel = <Clash q={state.q} who={p.who} heading={heading} onCancel={cancel}
      onAnswer={(answer) => { void start(extras, { question: state.q.question, answer }); }} />;
  } else if (state.at === 'overlap') {
    // The language's own list ("Pam, Erin and Dwight") and the verb agreeing
    // with how many (owner, 2026-10-23: "Pam and Erin already does").
    const names = ((): string => { try { return new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(state.names); } catch { return state.names.join(', '); } })();
    const count = state.names.length;
    panel = (
      <div role="alert" style={panelStyle}>
        {head(t('jobChange.overlapTitle', { names, count }))}
        {state.why && <span style={bodyStyle}>{state.why}</span>}
        <div style={rowEnd}>
          <PixelButton variant="secondary" size="sm" onClick={() => { setExtras([]); setState({ at: 'idle' }); }}>{t('jobChange.editMine')}</PixelButton>
          <PixelButton variant="primary" size="sm" onClick={() => {
            const more = [...extras, t('jobChange.leaveWithChange', { names, count })];
            setExtras(more);
            void start(more, answerRef.current);
          }}>{t('jobChange.leaveWith', { names })}</PixelButton>
        </div>
      </div>
    );
  } else if (state.at === 'error') {
    panel = (
      <div role="alert" style={panelStyle}>
        {head(t('jobChange.errorTitle'))}
        <span style={noteStyle}>{t(p.autoRun ? 'jobChange.errorNoteCard' : 'jobChange.errorNote')}</span>
        <div style={rowEnd}>
          <PixelButton variant="secondary" size="sm" onClick={cancel}>{t('jobChange.cancel')}</PixelButton>
          <PixelButton variant="primary" size="sm" onClick={() => { void start(extras, answerRef.current); }}>{t('jobChange.tryAgain')}</PixelButton>
        </div>
      </div>
    );
  } else if (state.at === 'moved') {
    panel = (
      <div role="alert" style={panelStyle}>
        {head(t('jobChange.movedTitle', { name: p.who }))}
        <span style={noteStyle}>{t(p.autoRun ? 'jobChange.movedNoteCard' : 'jobChange.movedNote')}</span>
        {!p.autoRun && <span style={{ ...bodyStyle, padding: '8px 10px', borderRadius: 'var(--cth-r-md)', background: 'var(--cth-card)' }}>{typed}</span>}
        <div style={rowEnd}>
          <PixelButton variant="secondary" size="sm" onClick={cancel}>{t('jobChange.cancel')}</PixelButton>
          <PixelButton variant="primary" size="sm" onClick={() => { void start(extras, answerRef.current); }}>{t('jobChange.seeAgain')}</PixelButton>
        </div>
      </div>
    );
  }

  if (!p.box) return <>{panel}</>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={fieldLabel}>{p.box.label}</span>
          {p.box.info && <InfoTip text={p.box.info} label={p.box.label} />}
        </span>
        {state.at === 'idle' && (
          <textarea
            ref={box}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={onBoxKey}
            placeholder={p.box.placeholder}
            aria-label={p.box.label}
            rows={3}
            className="cth-input"
            dir={rtl ? 'auto' : undefined}
            style={{ width: '100%', minHeight: 74, padding: '7px 10px', background: 'var(--cth-card)', border: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--cth-font-ui)', fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink)', resize: 'vertical' }}
          />
        )}
      </label>
      {state.at === 'idle' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          <span aria-hidden="true" style={{ fontSize: 11.5, color: 'var(--cth-ink-3)' }}>{shortcut}</span>
          <PixelButton variant="secondary" size="sm" onClick={() => { void start(); }} disabled={!typed.trim()}>{p.box.button}</PixelButton>
        </div>
      ) : panel}
      {state.at === 'idle' && p.status && <span role="status" style={{ fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink-2)' }}>{p.status}</span>}
    </div>
  );
}

/** The three real steps of a run, as main reports them. */
const STEPS = ['starting', 'reading', 'writing'] as const;

/**
 * While a run works: its three real steps, ticked off as main reports them,
 * and what is written so far (the summary lines, then the plain words, or the
 * question). Only the steps are announced; the words would chatter.
 */
function Working({ who, progress, heading, onStop }: { who: string; progress?: Progress; heading: ReactNode; onStop: () => void }) {
  const { t } = useTranslation();
  const at = STEPS.indexOf(progress?.stage ?? 'starting');
  const seen = progress?.preview;
  const any = !!seen && (seen.summary.length > 0 || !!seen.plain || !!seen.question);
  return (
    <div style={panelStyle}>
      {heading}
      <ol role="status" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {STEPS.map((step, i) => (
          <li key={step} data-step={step} data-at={i < at ? 'done' : i === at ? 'now' : 'next'} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, lineHeight: '18px', color: i < at ? 'var(--cth-ink-2)' : i === at ? 'var(--cth-ink)' : 'var(--cth-ink-3)', fontWeight: i === at ? 600 : 400 }}>
            <span aria-hidden="true" style={stepMark}>
              {i < at ? <span style={{ color: 'var(--cth-green-text)' }}>✓</span> : i === at ? <Spinner /> : <span style={{ ...dot, background: 'var(--cth-ink-4)', transform: 'none' }} />}
            </span>
            <span>{t(`jobChange.steps.${step}`, { name: who })}</span>
          </li>
        ))}
      </ol>
      {any && seen && (
        <div aria-live="off" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 'var(--cth-r-md)', background: 'var(--cth-card)' }}>
          <span style={hint}>{t('jobChange.soFar')}</span>
          {seen.question && <span style={bodyStyle}>{seen.question}</span>}
          {seen.summary.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {seen.summary.map((l, i) => <li key={i} style={dotLine}><span aria-hidden="true" style={dot} /><span>{l}</span></li>)}
            </ul>
          )}
          {seen.plain && <JobParts plain={seen.plain} />}
        </div>
      )}
      <div style={rowEnd}><PixelButton variant="secondary" size="sm" onClick={onStop}>{t('jobChange.stop')}</PixelButton></div>
    </div>
  );
}

/** The new job: what changes, the new "What X handles", the whole job folded. */
function Preview({ ok, who, lead, sendsTask, title, heading, applyLabel, applying, failed, onCancel, onApply }: {
  ok: ReviseOk; who: string; lead?: boolean; sendsTask: boolean; title: string; heading: React.RefObject<HTMLDivElement>;
  applyLabel: string; applying: boolean; failed: boolean; onCancel: () => void; onApply: () => void;
}) {
  const { t } = useTranslation();
  const manager = useResolvedGodName();
  const [all, setAll] = useState(false);
  const [whole, setWhole] = useState(false);
  const lines = all ? ok.summary : ok.summary.slice(0, SUMMARY_SHOWN);
  return (
    <div style={panelStyle}>
      <div ref={heading} tabIndex={-1} style={headStyle}>{title}</div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {lines.map((l, i) => <li key={i} style={dotLine}><span aria-hidden="true" style={dot} /><span>{l}</span></li>)}
        {sendsTask && ok.oneTimeTask && <li style={dotLine}><span aria-hidden="true" style={dot} /><span>{t('jobChange.oneTimeTask', { task: ok.oneTimeTask, manager })}</span></li>}
      </ul>
      {ok.summary.length > SUMMARY_SHOWN && (
        <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} style={linkStyle}>{all ? t('jobChange.showLess') : t('jobChange.showAll')}</button>
      )}
      {!lead && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={fieldLabel}>{t('jobChange.handles', { name: who })}</span>
          {ok.handles
            ? <span style={bodyStyle}>{ok.handles}</span>
            : <span style={unchangedTag}>{t('jobChange.unchanged')}</span>}
        </div>
      )}
      <button type="button" aria-expanded={whole} onClick={() => setWhole((v) => !v)} style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
        <Disclosure open={whole} />{t('jobChange.seeWhole')}
      </button>
      {whole && <div style={{ padding: '8px 10px', borderRadius: 'var(--cth-r-md)', background: 'var(--cth-card)' }}><JobParts plain={ok.plain} /></div>}
      {failed && <span role="alert" style={{ fontSize: 12, color: 'var(--cth-coral-text)' }}>{t('jobChange.applyFailed')}</span>}
      {/* The decision stays in reach on a short window (DR11). */}
      <div style={{ ...rowEnd, position: 'sticky', bottom: 0, paddingTop: 6, background: 'var(--cth-indigo-soft)' }}>
        <PixelButton variant="secondary" size="sm" onClick={onCancel} disabled={applying}>{t('jobChange.cancel')}</PixelButton>
        <PixelButton variant="primary" size="sm" onClick={onApply} disabled={applying}>{applyLabel}</PixelButton>
      </div>
    </div>
  );
}

/** A clash: two or three answers, one suggested, or the owner's own (DR5). */
function Clash({ q, who, heading, onCancel, onAnswer }: {
  q: Question; who: string; heading: React.RefObject<HTMLDivElement>; onCancel: () => void; onAnswer: (answer: string) => void;
}) {
  const { t } = useTranslation();
  const rtl = useRtl();
  const [pick, setPick] = useState<number | undefined>(undefined);
  const [own, setOwn] = useState('');
  const rows = [...q.choices.map((c) => c.label), t('jobChange.somethingElse')];
  const ownAt = rows.length - 1;
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const answer = pick === undefined ? '' : pick === ownAt ? own.trim() : rows[pick];
  const send = (): void => { if (answer) onAnswer(answer); };
  const move = (to: number): void => { const n = (to + rows.length) % rows.length; setPick(n); refs.current[n]?.focus(); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>, i: number): void => {
    if (isComposingKey(e)) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(i + 1); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1); return; }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setPick(i); }
  };
  return (
    <div style={panelStyle}>
      <div ref={heading} tabIndex={-1} style={headStyle}>{t('jobChange.questionTitle')}</div>
      <span style={bodyStyle}>{q.question}</span>
      <div role="radiogroup" aria-label={t('jobChange.questionTitle')} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((label, i) => {
          const on = pick === i;
          return (
            <div key={i} ref={(el) => { refs.current[i] = el; }} role="radio" aria-checked={on}
              tabIndex={on || (pick === undefined && i === 0) ? 0 : -1}
              onClick={() => setPick(i)} onKeyDown={(e) => onKey(e, i)}
              className={on ? 'cth-askme-opt is-on' : 'cth-askme-opt'}>
              <span className="cth-askme-dot" aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
              {i < ownAt && q.choices[i].suggested && <span style={suggestedTag}>{t('jobChange.suggested')}</span>}
            </div>
          );
        })}
      </div>
      {pick === ownAt && (
        <input value={own} onChange={(e) => setOwn(e.target.value)} autoFocus dir={rtl ? 'auto' : undefined}
          onKeyDown={(e) => { if (!isComposingKey(e) && e.key === 'Enter') { e.preventDefault(); send(); } }}
          placeholder={t('jobChange.somethingElsePlaceholder', { name: who })} aria-label={t('jobChange.somethingElse')}
          className="cth-input" style={{ width: '100%', minHeight: 34, padding: '7px 10px', background: 'var(--cth-card)', border: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink)' }} />
      )}
      <div style={rowEnd}>
        <PixelButton variant="secondary" size="sm" onClick={onCancel}>{t('jobChange.cancel')}</PixelButton>
        <PixelButton variant="primary" size="sm" onClick={send} disabled={!answer}>{t('jobChange.continue')}</PixelButton>
      </div>
    </div>
  );
}

/** The preview sits on indigo-soft in the box's place: no border, no shadow (DR8). */
const panelStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 'var(--cth-r-xl)',
  background: 'var(--cth-indigo-soft)', fontFamily: 'var(--cth-font-ui)'
};
const headStyle: CSSProperties = { fontSize: 13, fontWeight: 600, lineHeight: '18px', outline: 'none' };
const stepMark: CSSProperties = { width: 14, height: 14, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 };
const noteStyle: CSSProperties = { fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink-2)' };
const bodyStyle: CSSProperties = { fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink)' };
const rowEnd: CSSProperties = { display: 'flex', gap: 7, justifyContent: 'flex-end', alignItems: 'center' };
const dotLine: CSSProperties = { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink)' };
const dot: CSSProperties = { flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: 'var(--cth-indigo)', transform: 'translateY(-1px)' };
const linkStyle: CSSProperties = {
  alignSelf: 'flex-start', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-2)', textDecoration: 'underline', textUnderlineOffset: 2
};
const unchangedTag: CSSProperties = {
  alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 'var(--cth-r-pill)',
  background: 'var(--cth-card)', color: 'var(--cth-ink-3)', fontSize: 11.5, fontWeight: 600
};
const suggestedTag: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', flexShrink: 0, height: 18, padding: '0 7px', borderRadius: 'var(--cth-r-pill)',
  background: 'var(--cth-green-soft)', color: 'var(--cth-green-text)', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap'
};
