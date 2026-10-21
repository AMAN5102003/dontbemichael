import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, actionText, type Agent } from '@/store/store';
import { useDockCentered } from '@/hooks/useCenter';
import { PixelBadge, type StatusKind } from '@/components/PixelBadge';
import { useRtl } from '@/i18n/useDirection';
import { isComposingKey } from '@shared/imeGuard';
import { PersonAvatar } from '@/scene/office/props';
import { Icon } from '@/components/Icon';
import { NotReportingTag, useSilentEpisode } from '@/components/SilentEngine';
import { closeTarget, columnLocked, focusNeedsYouPill } from './rightColumn';
import { getNeedsYouFeed } from './useNeedsYou';

/**
 * The header of a person's panel and of Michael's (branding/DESIGN.md 7.10):
 * avatar in their department's colors, name, role, status and what they are
 * doing, Edit, and close (back to the Needs you board while anything waits,
 * otherwise the column closes and the office takes the window). A team member's private
 * note sits under it; it used to live on their card in the agent strip.
 */
export function PanelHeader({ agent, role, onEdit, extra, withNote = true }: {
  agent: Agent; role: string; onEdit?: () => void; extra?: ReactNode; withNote?: boolean;
}) {
  const { t } = useTranslation();
  const raw = agent.action?.trim() ? actionText(agent.action.trim(), t) : '';
  // Not reporting: the app can't vouch for its status, so the tag replaces it (SD14).
  const silent = useSilentEpisode(agent.id);
  const caption = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
  return (
    <div style={{ flexShrink: 0, padding: '14px 14px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
        <PersonAvatar who={agent} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--cth-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
            {silent ? <NotReportingTag style={{ fontSize: 10.5, lineHeight: '14px', padding: '1px 8px' }} /> : <PixelBadge status={agent.status as StatusKind} style={{ fontSize: 10.5, lineHeight: '14px', padding: '1px 8px' }} />}
          </div>
          <div style={{ fontSize: 12, color: 'var(--cth-ink-3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{role}</div>
          {caption && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 11.5, color: 'var(--cth-ink-2)', minWidth: 0 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--cth-blue)', flexShrink: 0 }} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{caption}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {extra}
          {onEdit && (
            <button onClick={onEdit} aria-label={t('panel.editAria', { name: agent.name })} style={headerBtn}>
              <PencilGlyph /> {t('panel.edit')}
            </button>
          )}
          <WideButton />
          <button onClick={() => { const f = getNeedsYouFeed(); const to = closeTarget(columnLocked(f.status, f.count)); useStore.getState().setRightColumn(to); if (to === 'closed') focusNeedsYouPill(); }} aria-label={t('panel.close')} title={t('panel.close')} style={{ ...headerBtn, width: 32, padding: 0, justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
      {/* Keyed by person, so a half written note never saves onto whoever is picked next. */}
      {withNote && !agent.isGod && <NoteRow key={agent.id} agent={agent} />}
    </div>
  );
}

/** Opens the panel wide in the center of the window and back (wide panel WD6,
 *  WD7). The choice is remembered; the button keeps focus as it switches. */
/** `size` matches the header it sits in: 32 in a panel header, 30 beside a
 *  dialog's close button (design review). `on` and `onToggle` let the 1:1 with
 *  Michael use it for its own choice; a panel shows wide only while the 1:1
 *  does not hold the center (8A). */
export function WideButton({ disabled = false, size = 32, on, onToggle }: {
  disabled?: boolean; size?: number; on?: boolean; onToggle?: () => void;
}) {
  const { t } = useTranslation();
  const dockWide = useDockCentered();
  const panelWide = useStore((s) => s.panelWide) && !dockWide;
  const wide = on ?? panelWide;
  const label = wide ? t('panel.backToSide') : t('panel.openWide');
  return (
    <button
      type="button"
      data-wide-button
      onClick={onToggle ?? (() => useStore.getState().setPanelWide(!wide))}
      disabled={disabled}
      aria-label={label}
      aria-pressed={wide}
      title={label}
      style={{ ...headerBtn, width: size, height: size, padding: 0, justifyContent: 'center', color: 'var(--cth-ink-2)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}
    >
      <Icon name={wide ? 'minimize' : 'expand'} />
    </button>
  );
}

const headerBtn = {
  height: 32, padding: '0 11px', display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer',
  borderRadius: 'var(--cth-r-md)', background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, fontWeight: 600, color: 'var(--cth-ink)'
} as const;

/** The owner's private note on a team member (only the owner sees it). */
function NoteRow({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(agent.note ?? '');
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (!editing) setDraft(agent.note ?? ''); }, [agent.note, editing]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  const save = () => { useStore.getState().setAgentNote(agent.id, draft.trim()); setEditing(false); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingKey(e)) return;
    if (e.key === 'Escape') { setEditing(false); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  };
  if (editing) {
    return (
      <div style={{ ...noteBox, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <textarea ref={ref} className="cth-input" dir="auto" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
          placeholder={t('panel.notePlaceholder')}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '6px 8px', border: 'none', background: 'var(--cth-card)', fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink)', outline: 'none' }} />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={() => setEditing(false)} style={{ ...headerBtn, height: 26, fontSize: 11.5 }}>{t('panel.cancel')}</button>
          <button onClick={save} style={{ ...headerBtn, height: 26, fontSize: 11.5, background: 'var(--cth-ink)', color: 'var(--cth-bg)', boxShadow: 'none' }}>{t('panel.save')}</button>
        </div>
      </div>
    );
  }
  const first = (agent.note ?? '').split('\n')[0];
  return (
    <button onClick={() => setEditing(true)} title={agent.note || undefined} style={{ ...noteBox, cursor: 'pointer', border: 'none', textAlign: 'start', fontFamily: 'var(--cth-font-ui)' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, color: 'var(--cth-amber-text)' }}>
        <path d="M4 4h16v12l-4 4H4z" /><path d="M16 20v-4h4" />
      </svg>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: first ? 'var(--cth-ink)' : 'var(--cth-ink-3)' }}>
        {first ? <><b style={{ fontWeight: 600 }}>{t('panel.note')}</b> {first}</> : t('panel.addNote')}
      </span>
      <PencilGlyph />
    </button>
  );
}

const noteBox = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 32, padding: '6px 10px',
  borderRadius: 'var(--cth-r-md)', background: 'var(--cth-amber-soft)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-amber) 35%, transparent)', color: 'var(--cth-ink-2)'
} as const;

function PencilGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    </svg>
  );
}

/**
 * Underline tabs (DESIGN.md 7.11), with the ARIA tabs keyboard model: arrows
 * move between tabs (mirrored in RTL), Home and End jump to the ends, and only
 * the selected tab is in the Tab order. Scrolls sideways when the panel is too
 * narrow for every label: the mouse wheel moves the row, and an edge fades out
 * while tabs are hidden past it, since the scrollbar itself is hidden.
 */
export function PanelTabs<K extends string>({ tabs, current, onChange }: {
  tabs: { key: K; label: string }[]; current: K; onChange: (k: K) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const rtl = useRtl();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((tab) => tab.key === current);
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next = -1;
    if (e.key === forward) next = (i + 1) % tabs.length;
    else if (e.key === back) next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].key);
    requestAnimationFrame(() => stripRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus());
  };
  useEffect(() => {
    stripRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  // Which physical edges have tabs hidden past them. scrollLeft runs 0 to
  // negative in RTL, so the distance from the start is its absolute value.
  const [hidden, setHidden] = useState({ left: false, right: false });
  const tabKeys = tabs.map((tab) => tab.key).join(' ');
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const fromStart = Math.abs(el.scrollLeft);
      const start = max > 1 && fromStart > 1;
      const end = max > 1 && fromStart < max - 1;
      const next = rtl ? { left: end, right: start } : { left: start, right: end };
      setHidden((was) => (was.left === next.left && was.right === next.right ? was : next));
    };
    // A plain mouse wheel only scrolls vertically; turn it sideways while the
    // row overflows. Native and not passive, so preventDefault holds.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth - el.clientWidth <= 1) return;
      e.preventDefault();
      el.scrollLeft += rtl ? -e.deltaY : e.deltaY;
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    // Watch each tab too: a language switch or the font loading changes the
    // labels' widths without resizing the row itself.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const tab of el.children) ro.observe(tab);
    return () => {
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
  }, [rtl, tabKeys]);
  const fade = hidden.left || hidden.right
    ? `linear-gradient(to right, ${hidden.left ? 'transparent, #000 28px' : '#000'}, ${hidden.right ? '#000 calc(100% - 28px), transparent' : '#000'})`
    : undefined;
  return (
    // The rule under the row sits on this wrapper so the edge fade never cuts it.
    <div style={{ flexShrink: 0, boxShadow: 'inset 0 -1px 0 var(--cth-line)' }}>
      <div ref={stripRef} role="tablist" onKeyDown={onKeyDown} className="cth-tabbar" style={{
        display: 'flex', gap: 16, padding: '0 14px', overflowX: 'auto',
        maskImage: fade, WebkitMaskImage: fade
      }}>
        {tabs.map((tab) => {
          const active = current === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(tab.key)}
              style={{
                flexShrink: 0, height: 36, padding: '0 1px', border: 'none', cursor: 'pointer', background: 'transparent',
                boxShadow: active ? 'inset 0 -2px 0 var(--cth-ink)' : 'none',
                fontFamily: 'var(--cth-font-ui)', fontSize: 13, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap',
                color: active ? 'var(--cth-ink)' : 'var(--cth-ink-3)'
              }}
            >{tab.label}</button>
          );
        })}
      </div>
    </div>
  );
}

/** The white card a panel sits in. */
export function PanelCard({ children }: { children: ReactNode }) {
  return (
    // data-panel-card: Edit agent lays itself exactly over this card.
    <div data-panel-card style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden',
      background: 'var(--cth-card)', borderRadius: 'var(--cth-r-xl)',
      boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-sm)'
    }}>{children}</div>
  );
}
