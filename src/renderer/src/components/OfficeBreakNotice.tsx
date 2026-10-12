/**
 * The office break (issue 124): the Claude plan reached its usage limit, so the
 * team waits until it resets. Main keeps the state (src/main/officeBreak.ts)
 * and pushes it here. Two notices, both quiet: a card at the top of Needs you,
 * not counted (there is nothing to decide, like a report), and a chip in the
 * top bar that opens Needs you. Desktop notifications come from main.
 */
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { OfficeBreakView } from '@shared/officeBreak';
import { useStore } from '@/store/store';
import { InfoTip } from './InfoTip';

let view: OfficeBreakView | null = null;
/** Main has answered once (or pushed): until then delivery assumes a break. */
let known = false;
let started = false;
const listeners = new Set<() => void>();

function setView(next: OfficeBreakView | null): void {
  view = next ?? null;
  known = true;
  for (const l of listeners) l();
}

function start(): void {
  if (started) return;
  started = true;
  window.cth.onOfficeBreak?.(setView);
  if (!window.cth.officeBreakView) { known = true; return; }
  void window.cth.officeBreakView().then((v) => { if (!known) setView(v ?? null); }).catch(() => { known = true; });
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The break right now, outside React (the delivery queue reads it). Until
 *  main first answers, a break saved before a restart may still be on, so the
 *  queue holds Claude terminals for that moment rather than type into them. */
export function getOfficeBreak(): OfficeBreakView | null {
  start();
  return known ? view : { until: null, checking: false };
}

export function useOfficeBreak(): OfficeBreakView | null {
  return useSyncExternalStore(subscribe, () => view);
}

function clock(at: number, lng: string): string {
  return new Date(at).toLocaleTimeString(lng, { hour: 'numeric', minute: '2-digit' });
}

/** The card at the top of Needs you. */
export function OfficeBreakCard() {
  const { t, i18n } = useTranslation();
  const b = useOfficeBreak();
  if (!b) return null;
  const title = t('officeBreak.title');
  return (
    <section data-office-break aria-label={title} style={{
      flexShrink: 0, padding: '13px 14px', borderRadius: 'var(--cth-r-xl)', background: 'var(--cth-amber-soft)',
      boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-amber) 40%, transparent)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, lineHeight: '18px', color: 'var(--cth-ink)' }}>
        {title}
        <span style={{ marginInlineStart: 'auto', display: 'inline-flex' }}><InfoTip text={t('officeBreak.info')} align="end" /></span>
      </div>
      <div role="status" style={{ marginTop: 2, fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink-2)' }}>
        {b.until ? t('officeBreak.body', { time: clock(b.until, i18n.language) }) : t('officeBreak.bodyUnknown')}
      </div>
    </section>
  );
}

/** The top bar chip: there for the whole break, opens Needs you. */
export function OfficeBreakChip() {
  const { t, i18n } = useTranslation();
  const b = useOfficeBreak();
  if (!b) return null;
  return (
    <button
      className="cth-titlebar-nodrag"
      data-office-break-chip
      onClick={() => useStore.getState().openNeedsYou()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 26, padding: '0 10px', margin: 0,
        background: 'var(--cth-amber-soft)', color: 'var(--cth-amber-text)',
        border: 'none', borderRadius: 999,
        fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 600, cursor: 'pointer'
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cth-amber)' }} />
      {b.until ? t('officeBreak.chip', { time: clock(b.until, i18n.language) }) : t('officeBreak.chipUnknown')}
    </button>
  );
}
