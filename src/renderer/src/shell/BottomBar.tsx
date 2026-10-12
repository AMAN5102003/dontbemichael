import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { useMissions } from '@/components/triggers/ScheduleList';
import { nextRunAt } from '@shared/missions';
import { isComposingKey } from '@shared/imeGuard';
import { GrowingTextarea } from '@/components/GrowingTextarea';
import { attachmentsFromPaste } from '@/components/pasteAttachments';
import { MichaelDock, useOwnerDock } from './MichaelDock';
import { sendToMichael } from './ownerSend';

/**
 * The v2 bottom bar (branding/DESIGN.md 7.19), floating over the stage: brief
 * Michael, see the next scheduled job, and hire. The composer queues into
 * Michael's terminal exactly like the composer on his Work tab: same store
 * queue, same draft, same attachment convention.
 */
export function BottomBar() {
  return (
    <div style={{
      position: 'absolute', insetInlineStart: 24, insetInlineEnd: 22, bottom: 24, zIndex: 70,
      display: 'flex', alignItems: 'flex-end', gap: 14, pointerEvents: 'none'
    }}>
      <TalkToMichael />
      {/* Centered on the composer's resting height, so they stay put while a
          long message grows the composer upward. */}
      <div style={{ height: 50, display: 'flex', alignItems: 'center', gap: 14 }}>
        <NextJobChip />
        <HireButton />
      </div>
    </div>
  );
}

interface Attachment { path: string; name: string }

function TalkToMichael() {
  const { t } = useTranslation();
  const godName = useResolvedGodName();
  const god = useStore((s) => s.agents.find((a) => a.isGod));
  const godId = god?.id ?? 'god';
  const text = useStore((s) => s.drafts[godId] ?? '');
  const setDraft = useStore((s) => s.setDraft);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // The conversation dock (docs/designs/michael-replies.md).
  const dockOpen = useStore((s) => s.dockOpen);
  const { dock, refresh } = useOwnerDock(dockOpen);
  const setDock = useStore((s) => s.setDock);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [replyTo, setReplyTo] = useState<{ inReplyTo: string; conversation: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  // A notification click opens the dock at its question (12A).
  useEffect(() => window.cth.onOwnerOpenDock?.((id) => setDock(true, id)), [setDock]);

  const add = (incoming: Attachment[]) => setAttachments((prev) => {
    const seen = new Set(prev.map((a) => a.path));
    return [...prev, ...incoming.filter((a) => a.path && !seen.has(a.path))];
  });
  const pick = async () => { const res = await window.cth.attachFiles(); if (res.ok) add(res.files); };
  // A pasted screenshot or Finder files attach, as on Michael's Work tab.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => { void attachmentsFromPaste(e)?.then(add); };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    add(files.map((f) => ({ path: window.cth.pathForFile(f), name: f.name })).filter((a) => a.path));
  };

  const canSend = !!god && !sending && (!!text.trim() || attachments.length > 0);
  // A known command goes to Michael's terminal; anything else is a question
  // for the dock, handed to him as its own work order (R3, R6, R7).
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setSendFailed(false);
    const ok = await sendToMichael(godId, text, attachments, replyTo ? { inReplyTo: replyTo.inReplyTo, conversation: replyTo.conversation } : undefined);
    setSending(false);
    if (!ok) { setSendFailed(true); return; }
    void window.cth.trackMessageSent('composer');
    setDraft(godId, '');
    setAttachments([]);
    setReplyTo(null);
    refresh();
  };
  // One number: Michael answered (indigo), or coral while he waits on you (2A, 16A).
  const waiting = dock.waitingForYou > 0;
  const count = waiting ? dock.waitingForYou : dock.unread;
  const openAt = () => {
    const target = dock.items.find((i) => i.kind === 'owner' && (waiting ? i.status === 'waiting-for-you' : i.unread));
    setDock(true, target?.id);
  };
  // Enter sends; Shift+Enter starts a new line (the box grows with it).
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      // The ring and its focus state live in global.css (.cth-composer).
      className="cth-composer"
      ref={composerRef}
      style={{
        pointerEvents: 'auto', position: 'relative',
        // The buttons stay on the bottom row while the message grows upward.
        // It gives up to 120 px before anything else (owner check at 1280 x 800:
        // squeezed, the placeholder wrapped onto two lines). The conversation
        // button takes its 34 px plus a gap out of the same row, so it adds both.
        flex: `0 1 ${dock.items.length > 0 ? 464 : 420}px`, minWidth: dock.items.length > 0 ? 344 : 300, minHeight: 50, display: 'flex', alignItems: 'flex-end', gap: 10, padding: '7px 7px 7px 8px',
        background: 'var(--cth-card)', borderRadius: 'var(--cth-r-2xl)'
      }}
    >
      <MichaelDock dock={dock} refresh={refresh} godId={godId} composerRef={composerRef}
        onFillComposer={(v) => { setDraft(godId, v); composerRef.current?.querySelector('textarea')?.focus(); }}
        onReply={(target) => { setReplyTo(target); composerRef.current?.querySelector('textarea')?.focus(); }} />
      {/* The way back to the saved conversation once every reply is read (21A: the owner's action). */}
      {dock.items.length > 0 && (
        <button onClick={() => (dockOpen ? setDock(false) : openAt())} aria-expanded={dockOpen}
          aria-label={t('dock.label', { godName })} title={t('dock.label', { godName })} style={{
            width: 34, height: 34, flexShrink: 0, border: 'none', borderRadius: 'var(--cth-r-md)', cursor: 'pointer',
            display: 'grid', placeItems: 'center',
            background: dockOpen ? 'var(--cth-ink)' : 'var(--cth-neutral-soft)', color: dockOpen ? 'var(--cth-bg)' : 'var(--cth-ink-2)'
          }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />
          </svg>
        </button>
      )}
      <button onClick={() => void pick()} aria-label={t('shell.attach')} title={t('shell.attach')} style={{
        width: 34, height: 34, flexShrink: 0, border: 'none', borderRadius: 'var(--cth-r-md)', cursor: 'pointer',
        display: 'grid', placeItems: 'center', background: 'var(--cth-neutral-soft)', color: 'var(--cth-ink-2)'
      }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
        </svg>
      </button>
      <div style={{ flex: 1, minWidth: 0, alignSelf: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {replyTo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--cth-ink-3)' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('dock.replyingTo', { text: `\u2068${replyTo.text}\u2069` })}</span>
            <button onClick={() => setReplyTo(null)} aria-label={t('dock.cancelReply')} title={t('dock.cancelReply')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-3)', fontSize: 13, width: 28, height: 28, display: 'grid', placeItems: 'center', padding: 0, flexShrink: 0 }}>✕</button>
          </div>
        )}
        {sendFailed && <div role="alert" style={{ fontSize: 11, color: 'var(--cth-ink-2)' }}>{t('dock.notSentNow')}</div>}
        {attachments.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {attachments.map((a) => (
              <span key={a.path} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 3px 0 8px',
                borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-neutral-soft)', fontSize: 11, color: 'var(--cth-ink-2)'
              }}>
                {a.name}
                <button onClick={() => setAttachments((p) => p.filter((x) => x.path !== a.path))}
                  aria-label={t('shell.removeAttachment', { name: a.name })}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-3)', fontSize: 10 }}>✕</button>
              </span>
            ))}
          </div>
        )}
        <GrowingTextarea
          value={text}
          onChange={(e) => setDraft(godId, e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          // Focusing the composer with replies unread opens the dock (21A).
          onFocus={() => { if (!dockOpen && (dock.unread > 0 || waiting)) openAt(); }}
          placeholder={t('shell.briefPlaceholder', { godName })}
          aria-label={t('shell.brief', { godName })}
          maxHeight={140}
          style={{
            display: 'block', boxSizing: 'border-box', padding: '1px 0', margin: 0,
            border: 'none', outline: 'none', background: 'transparent', width: '100%',
            fontFamily: 'var(--cth-font-ui)', fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink)'
          }}
        />
      </div>
      <button onClick={() => void send()} disabled={!canSend} style={{
        height: 36, padding: '0 14px', flexShrink: 0, border: 'none', borderRadius: 11,
        display: 'inline-flex', alignItems: 'center', gap: 7, cursor: canSend ? 'pointer' : 'default',
        background: canSend ? 'var(--cth-ink)' : 'var(--cth-neutral-soft)', color: canSend ? 'var(--cth-bg)' : 'var(--cth-ink-3)',
        fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, fontWeight: 600
      }}>
        {t('shell.send')}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
      {count > 0 && (
        // A 28 px target (DESIGN.md) holding the 20 px count pill.
        <button
          onClick={() => (dockOpen ? setDock(false) : openAt())}
          aria-label={waiting ? t('dock.countWaiting', { godName }) : t('dock.countNew', { count, godName })}
          style={{
            position: 'absolute', top: -12, insetInlineEnd: -12, minWidth: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent'
          }}>
          <span style={{
            minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--cth-r-pill)',
            background: waiting ? 'var(--cth-coral-strong)' : 'var(--cth-indigo)', color: waiting ? 'var(--cth-on-coral)' : 'var(--cth-on-indigo)',
            fontFamily: 'var(--cth-font-mono)', fontSize: 11, fontWeight: 600, boxShadow: '0 0 0 2px var(--cth-card)'
          }}>{count}</span>
        </button>
      )}
    </div>
  );
}

/** The next scheduled job across the office. Click opens Michael's Office schedule. */
function NextJobChip() {
  const { t } = useTranslation();
  const { missions } = useMissions();
  const agents = useStore((s) => s.agents);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);

  let best: { at: number; label: string; who?: string } | null = null;
  for (const m of missions) {
    // Auto-compaction is housekeeping, not a job anyone asked for.
    if (!m.enabled || m.kind === 'compact') continue;
    const at = nextRunAt(m, now);
    if (at === null) continue;
    if (!best || at < best.at) {
      const who = (m.to === 'god' ? agents.find((a) => a.isGod) : agents.find((a) => a.id === m.to))?.name;
      best = { at, label: m.label, who };
    }
  }
  if (!best) return null;
  const when = new Date(best.at);
  const sameDay = when.toDateString() === new Date(now).toDateString();
  const time = sameDay
    ? when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : when.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

  const open = () => {
    const god = useStore.getState().agents.find((a) => a.isGod);
    if (god) useStore.getState().select(god.id);
    useStore.getState().requestCommandCenterTab('triggers');
  };
  return (
    <button onClick={open} style={{
      pointerEvents: 'auto', height: 40, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 8,
      maxWidth: 360, border: 'none', borderRadius: 'var(--cth-r-lg)', cursor: 'pointer',
      background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-sm)',
      fontFamily: 'var(--cth-font-ui)', fontSize: 11.5, color: 'var(--cth-ink-2)', whiteSpace: 'nowrap'
    }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
      </svg>
      {t('shell.next')}
      <span style={{ fontFamily: 'var(--cth-font-mono)', fontWeight: 600, color: 'var(--cth-ink)' }}>{time}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{best.who ? `${best.who}, ${best.label}` : best.label}</span>
    </button>
  );
}

/** The Hire button, pushed right (opens the hire wizard). Which pack a job
 *  comes from shows on each job in the wizard, not here (owner, 2026-10-03:
 *  the pack caption beside Hire looked awkward). */
function HireButton() {
  const { t } = useTranslation();
  return (
    <div style={{ marginInlineStart: 'auto', pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
      <button onClick={() => useStore.getState().setAddAgentOpen(true)} style={{
        height: 32, padding: '0 13px', display: 'inline-flex', alignItems: 'center', gap: 6,
        border: 'none', borderRadius: 10, cursor: 'pointer',
        background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2), var(--cth-shadow-sm)',
        fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 600, color: 'var(--cth-ink)'
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {t('shell.hire')}
      </button>
    </div>
  );
}
