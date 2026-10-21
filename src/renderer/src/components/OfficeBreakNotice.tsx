/**
 * The office break (issue 124) and the stops that share it
 * (docs/designs/office-stopped-account.md). Main keeps the state
 * (src/main/officeBreak.ts) and pushes it here. Two notices: a card at the top
 * of Needs you and a chip in the top bar that opens Needs you. The plan limit is
 * quiet (amber, not counted: it ends on its own). Out of credit and a sign in
 * that stopped working wait on the owner: a plain card that counts in Needs you
 * (useNeedsYou), a coral chip, and the owner's action. Desktop notifications
 * come from main.
 */
import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { stopNeedsOwner, type OfficeBreakView } from '@shared/officeBreak';
import { useStore } from '@/store/store';
import { Dialog } from '@/shell/Dialog';
import { refreshNeedsYou, useNeedsYou } from '@/shell/useNeedsYou';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { InfoTip } from './InfoTip';
import { Icon } from './Icon';
import { PixelButton } from './PixelButton';
import { GetMichaelReady, Spinner } from './GetMichaelReady';

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
  return known ? view : { until: null, checking: false, reason: 'limit', again: false };
}

export function useOfficeBreak(): OfficeBreakView | null {
  return useSyncExternalStore(subscribe, () => view);
}

function clock(at: number, lng: string): string {
  return new Date(at).toLocaleTimeString(lng, { hour: 'numeric', minute: '2-digit' });
}

/** The card at the top of Needs you. */
export function OfficeBreakCard() {
  const b = useOfficeBreak();
  if (!b) return null;
  return stopNeedsOwner(b) ? <OfficeStopCard view={b} /> : <LimitBreakCard view={b} />;
}

/** Out of credit or a sign in that stopped working: the owner's to do. */
function OfficeStopCard({ view }: { view: OfficeBreakView }) {
  const { t } = useTranslation();
  const godName = useResolvedGodName();
  const { engineSetup } = useNeedsYou();
  const [fix, setFix] = useState<'signin' | 'key' | null>(null);
  const [ready, setReady] = useState(false);
  const credit = view.reason === 'credit';
  // How the office signs in decides the words and the fix (design D3).
  const key = !credit && engineSetup?.method === 'apiKey';
  const title = t('officeStop.title');
  const line = view.checking ? null
    : credit ? (view.again ? t('officeStop.creditAgain') : t('officeStop.credit'))
    : key ? t('officeStop.keyStopped') : t('officeStop.signIn');
  const info = credit ? t('officeStop.creditInfo') : key ? t('officeStop.keyInfo') : t('officeStop.signInInfo');
  const closeFix = (): void => {
    // A finished sign in moves the stop to checking; a saved key does so in
    // main, with the terminals' restart (owner, B1).
    if (fix === 'signin' && ready) void window.cth.officeRetry?.();
    setFix(null);
    refreshNeedsYou();
  };
  return (
    <section data-office-stop={view.reason} aria-label={title} style={stopCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, lineHeight: '18px', color: 'var(--cth-ink)' }}>
        {title}
        <span style={{ marginInlineStart: 'auto', display: 'inline-flex' }}><InfoTip text={info} align="end" /></span>
      </div>
      <div role="status" style={{ marginTop: 2, fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink-2)' }}>
        {view.checking ? <><Spinner /> {t('officeStop.checking')}</> : line}
      </div>
      {!view.checking && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {credit ? (
            <>
              <PixelButton variant="primary" size="sm" onClick={() => { void window.cth.officeAddCredit?.(); }}>
                {t('officeStop.addCredit')}{'\u2060'}
                <Icon name="external" size={0.75} style={{ verticalAlign: -1, marginInlineStart: 3 }} />
                <span className="cth-sr-only"> {t('markdown.opensInBrowser')}</span>
              </PixelButton>
              <PixelButton variant="secondary" size="sm" onClick={() => { void window.cth.officeRetry?.(); }}>{t('officeStop.tryAgain')}</PixelButton>
            </>
          ) : (
            <PixelButton variant="primary" size="sm" onClick={() => { setReady(false); setFix(key ? 'key' : 'signin'); }}>
              {key ? t('officeStop.changeKey') : t('officeStop.signInAction')}
            </PixelButton>
          )}
        </div>
      )}
      {fix && (
        <Dialog
          title={t('engineSetup.title', { godName })}
          onClose={closeFix}
          footer={<PixelButton variant="primary" size="md" onClick={closeFix}>{ready ? t('engineSetup.done') : t('common.close')}</PixelButton>}
        >
          <GetMichaelReady fix={fix} onReadyChange={setReady} />
        </Dialog>
      )}
    </section>
  );
}

/** A plain Ask me card (DESIGN.md §7.8): no side rule, coral only on the count
 *  and the chip (design D5). */
const stopCard: CSSProperties = {
  flexShrink: 0, padding: '13px 14px', borderRadius: 'var(--cth-r-xl)', background: 'var(--cth-card)',
  boxShadow: 'inset 0 0 0 1px var(--cth-line), 0 1px 2px rgba(30, 27, 46, .04), 0 4px 12px rgba(62, 52, 140, .06)'
};

/** The plan limit: quiet, it ends on its own (issue 124). */
function LimitBreakCard({ view: b }: { view: OfficeBreakView }) {
  const { t, i18n } = useTranslation();
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
  const owner = stopNeedsOwner(b);
  return (
    <button
      className="cth-titlebar-nodrag"
      data-office-break-chip
      data-office-stop={owner ? b.reason : undefined}
      onClick={() => useStore.getState().openNeedsYou()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 26, padding: '0 10px', margin: 0,
        background: owner ? 'var(--cth-coral-soft)' : 'var(--cth-amber-soft)', color: owner ? 'var(--cth-coral-text)' : 'var(--cth-amber-text)',
        border: 'none', borderRadius: 999,
        fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 600, cursor: 'pointer'
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: owner ? 'var(--cth-coral)' : 'var(--cth-amber)' }} />
      {owner ? t('officeStop.chip') : b.until ? t('officeBreak.chip', { time: clock(b.until, i18n.language) }) : t('officeBreak.chipUnknown')}
    </button>
  );
}
