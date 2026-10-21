import { PRIVACY_CHECK_SENDER } from '../../../shared/research';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { useRtl } from '@/i18n/useDirection';
import { gist, localDay, messageView, verbKey, type ThreadRow } from '@shared/messageView';

type HistoryMessage = Awaited<ReturnType<Window['cth']['hiveHistory']>>[number];

/**
 * MESSAGES: an agent's handoff history (owner, 2026-09-25;
 * docs/designs/messages-tab.md). Read only: the owner talks to a team member
 * through Michael, or in 1:1 under the terminal.
 *
 * Conversations are grouped under the day they last moved. Each is one light
 * row written as sentences ("Dwight asked Pam: ...") with the latest reply
 * under it, so it reads without opening anything; opening it shows every
 * message. The office's own notices (closing time, scheduled runs) are one
 * line at the bottom instead of filling the tab.
 */
export interface ThreadsPanelProps {
  agentId: string;
}

const hairline = '1px solid var(--cth-ink-100)';

export function ThreadsPanel({ agentId }: ThreadsPanelProps) {
  const { t, i18n } = useTranslation();
  const rtl = useRtl();
  const godName = useResolvedGodName();
  const agents = useStore((s) => s.agents);
  const self = agents.find((a) => a.id === agentId);
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showNotices, setShowNotices] = useState(false);

  useEffect(() => {
    let alive = true;
    setOpen({});
    setShowNotices(false);
    const load = async () => {
      try {
        const history = await window.cth.hiveHistory(agentId);
        // The same messages as last time: keep the old array, so nothing re-renders.
        if (alive) setMessages((prev) => (prev.length === history.length && prev.every((m, i) => m.id === history[i].id) ? prev : history));
      } catch { /* keep last good state */ }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [agentId]);

  const view = useMemo(() => messageView(messages), [messages]);

  /** The name the owner knows: Michael by his name, "you" for the owner. */
  const nameOf = (id: string): string => {
    const lower = (id || '').toLowerCase();
    if (lower === 'human') return t('threads.you');
    if (lower === 'god' || lower === 'michael') return godName;
    if (lower === 'broadcast') return t('threads.everyone');
    // A message the trust layer sent back (issue #230, design review D22).
    if (lower === PRIVACY_CHECK_SENDER) return t('research.privacyCheck');
    const a = agents.find((x) => x.id === id);
    if (a?.isGod) return godName;
    return a?.name ?? id;
  };
  /** "Dwight asked Pam", "Pam let Oscar know", "Pam finished". */
  const said = (m: HistoryMessage) => t(`threads.verb.${verbKey(m.act)}`, { from: nameOf(m.from), to: nameOf(m.to) });
  const time = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    try { return d.toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
  };
  const dayLabel = (day: string) => {
    if (!day) return t('threads.undated');
    const now = new Date().toISOString();
    const today = localDay(now);
    const yesterday = localDay(now, -1);
    if (day === today) return t('threads.today');
    if (day === yesterday) return t('threads.yesterday');
    const [y, m, d] = day.split('-').map(Number);
    try { return new Date(y, m - 1, d).toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' }); } catch { return day; }
  };
  const noticeCount = view.notices.messages.length;

  if (view.days.length === 0 && noticeCount === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--cth-paper-200)' }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--cth-ink-700)', textAlign: 'center', maxWidth: 280 }}>
          {t('threads.emptyHistory', { name: self?.name ?? agentId })}
        </p>
      </div>
    );
  }

  const noticeParts = [
    view.notices.scheduled ? t(view.notices.scheduled === 1 ? 'threads.scheduledRun' : 'threads.scheduledRunPlural', { count: view.notices.scheduled }) : '',
    view.notices.closing ? t(view.notices.closing === 1 ? 'threads.closingTime' : 'threads.closingTimePlural', { count: view.notices.closing }) : '',
    view.notices.other ? t(view.notices.other === 1 ? 'threads.otherNotice' : 'threads.otherNoticePlural', { count: view.notices.other }) : ''
  ].filter(Boolean);

  const renderRow = (thread: ThreadRow<HistoryMessage>) => {
    const isOpen = !!open[thread.conversation];
    const count = thread.messages.length;
    return (
      // One ink-100 hairline between rows (DESIGN.md §7.10); see .cth-thread-row.
      <li key={thread.conversation} style={{ padding: '10px 0' }} className="cth-thread-row">
        <p dir={rtl ? 'auto' : undefined} style={{ margin: 0, fontSize: 14, lineHeight: '20px', color: 'var(--cth-ink-900)', wordBreak: 'break-word' }}>
          <span style={{ fontWeight: 600 }}>{said(thread.first)}</span>: {gist(thread.first)}
        </p>
        {thread.latest && !isOpen && (
          <p dir={rtl ? 'auto' : undefined} style={{ margin: '4px 0 0', fontSize: 14, lineHeight: '20px', color: 'var(--cth-ink-700)', wordBreak: 'break-word' }}>
            <span aria-hidden style={{ color: 'var(--cth-ink-500)' }}>↳ </span>
            <span style={{ fontWeight: 600 }}>{said(thread.latest)}</span>: {gist({ subject: '', body: thread.latest.body || thread.latest.subject })}
          </p>
        )}
        {isOpen && (
          <ol style={{ listStyle: 'none', margin: '8px 0 0', padding: '0 0 0 12px', boxShadow: `inset 2px 0 0 var(--cth-ink-100)`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {thread.messages.map((m) => (
              <li key={m.id}>
                <div style={{ fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-500)' }}>{[said(m), time(m.created_at)].filter(Boolean).join(' · ')}</div>
                <div dir={rtl ? 'auto' : undefined} style={{ fontSize: 14, lineHeight: '20px', color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 2 }}>
                  {m.body || m.subject}
                </div>
              </li>
            ))}
          </ol>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-500)' }}>
          <span>{time(thread.lastAt)}</span>
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => setOpen((s) => ({ ...s, [thread.conversation]: !isOpen }))}
            style={{
              marginInlineStart: 'auto', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--cth-font-ui)', fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-700)'
            }}
          >
            {isOpen
              ? t('threads.close')
              : t(count === 1 ? 'threads.readMessage' : 'threads.readMessages', { count })}
          </button>
        </div>
      </li>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 14px 16px', background: 'var(--cth-paper-200)' }}>
      {view.days.length === 0 && (
        <p style={{ margin: '14px 0 0', fontSize: 14, lineHeight: '20px', color: 'var(--cth-ink-700)' }}>
          {t('threads.noHandoffs', { name: self?.name ?? agentId })}
        </p>
      )}
      {view.days.map(({ day, threads }) => (
        <section key={day}>
          <h3 style={{ margin: '14px 0 2px', fontFamily: 'var(--cth-font-ui)', fontSize: 13, lineHeight: '18px', fontWeight: 600, color: 'var(--cth-ink-700)' }}>
            {dayLabel(day)}
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {threads.map(renderRow)}
          </ul>
        </section>
      ))}

      {noticeCount > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: hairline }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-500)' }}>
            <span style={{ flex: 1 }}>{t('threads.notices', { list: noticeParts.join(t('threads.listJoiner')) })}</span>
            <button
              type="button"
              aria-expanded={showNotices}
              onClick={() => setShowNotices((v) => !v)}
              style={{
                padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--cth-font-ui)',
                fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-900)', textDecoration: 'underline', textUnderlineOffset: 2
              }}
            >{showNotices ? t('threads.hide') : t('threads.show')}</button>
          </div>
          {showNotices && (
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {view.notices.messages.map((m) => (
                <li key={m.id} dir={rtl ? 'auto' : undefined} style={{ fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-700)' }}>
                  <span style={{ color: 'var(--cth-ink-500)' }}>{dayLabel(localDay(m.created_at))} {time(m.created_at)} · </span>
                  {gist(m, 120)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
