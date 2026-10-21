import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { useAppTheme } from '@/design/theme';
import lockupLight from '@brandkit/logo/lockup/dbm-lockup-horizontal-light.svg?url';
import lockupDark from '@brandkit/logo/lockup/dbm-lockup-horizontal-dark.svg?url';
import { clearLocalState, restoreLocalState, snapshotLocalState } from '@/store/localState';
import type { HarnessConfig } from '@/store/config';

// Split on both separators: a Windows office path holds no '/' at all.
function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * "We can't find your office." Shown at launch ONLY when the office folder
 * (config.harnessHome) has gone missing: moved, renamed or deleted. Every normal
 * launch goes straight to the floor; switching folders on purpose lives in
 * Settings → General (owner, 2026-09-24). It replaced a picker that asked on
 * EVERY launch which "harness config" to open.
 *
 * Main has not bootstrapped anything at this point (homeFolder.ts), so nothing
 * rebuilt an empty office at the old path behind the owner's back. Each way out
 * relaunches the app against a real office.
 */
export function OfficeFolderMissing({ config }: { config: HarnessConfig }) {
  const { t } = useTranslation();
  const dark = useAppTheme() === 'dark';
  const missing = config.harnessHome ?? '';
  const [recents, setRecents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirmStartOver, setConfirmStartOver] = useState(false);

  // Offer only recent folders that still hold an office: a dead entry here
  // would lead straight back to this screen.
  useEffect(() => {
    let alive = true;
    const candidates = (config.recentHives ?? []).filter((h) => h && h !== missing);
    void Promise.all(candidates.map((h) => window.cth.homeStatus(h).then((s) => (s.hasOffice ? h : null)).catch(() => null)))
      .then((ok) => { if (alive) setRecents(ok.filter((h): h is string => !!h)); });
    return () => { alive = false; };
  }, [config.recentHives, missing]);

  /** Switch to a folder that holds an office. The same office, moved, so the
   *  renderer's saved state stays. Success relaunches and never returns. */
  const openOffice = async (path: string) => {
    setError(undefined);
    setBusy(true);
    const status = await window.cth.homeStatus(path).catch(() => null);
    if (!status?.hasOffice) {
      setError(t('officeMissing.notAnOffice'));
      setBusy(false);
      return;
    }
    const res = await window.cth.changeHome(path, 'fresh').catch((e) => ({ ok: false, error: String(e) }));
    if (!res.ok) { setError(res.error ?? t('officeMissing.couldNotOpen')); setBusy(false); }
  };

  const find = async () => {
    setError(undefined);
    const res = await window.cth.chooseFolder();
    if (res.ok) void openOffice(res.path);
    else if (res.error !== 'cancelled') setError(res.error);
  };

  const startOver = async () => {
    setError(undefined);
    setBusy(true);
    // An empty office: the old team's cards must not come back with it. Kept
    // aside first, so a start over that fails leaves things as they were.
    const snap = snapshotLocalState();
    clearLocalState();
    const res = await window.cth.startOverHere().catch((e) => ({ ok: false, error: String(e) }));
    if (!res.ok) { restoreLocalState(snap); setError(res.error ?? t('officeMissing.couldNotOpen')); setBusy(false); }
  };

  const sectionLabel = { fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-2)', marginBottom: 6 } as const;
  const hint = { fontSize: 12.5, color: 'var(--cth-ink-3)' } as const;

  // A launch screen, not a dialog over the app: nothing is behind it yet.
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--cth-bg)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20,
      zIndex: 200, padding: 32, fontFamily: 'var(--cth-font-ui)'
    }}>
      <img src={dark ? lockupDark : lockupLight} alt="Don't Be Michael" style={{ height: 30, width: 'auto' }} />
      <div role="dialog" aria-modal="true" aria-label={t('officeMissing.title')} style={{
        width: 560, maxWidth: '94vw', display: 'flex', flexDirection: 'column', gap: 14, padding: '22px 24px',
        background: 'var(--cth-card)', borderRadius: 'var(--cth-r-2xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)'
      }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--cth-ink)' }}>{t('officeMissing.title')}</h1>
        <p style={{ margin: 0, fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-2)' }}>
          {t('officeMissing.body')}
        </p>
        <div style={{
          padding: '9px 12px', fontFamily: 'var(--cth-font-mono)', fontSize: 12.5, color: 'var(--cth-ink-2)', borderRadius: 'var(--cth-r-md)',
          background: 'var(--cth-card-2)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', wordBreak: 'break-all'
        }}>{missing}</div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-2)' }}>
          {t('officeMissing.whyItMatters')}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <PixelButton variant="primary" size="md" onClick={find} disabled={busy}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <FolderGlyph /> {t('officeMissing.find')}
            </span>
          </PixelButton>
          <span style={hint}>{t('officeMissing.findHint')}</span>
        </div>

        {recents.length > 0 && (
          <div>
            <div style={sectionLabel}>{t('officeMissing.recent')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
              {recents.map((h) => (
                <button
                  key={h}
                  onClick={() => { void openOffice(h); }}
                  disabled={busy}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 'var(--cth-r-lg)',
                    background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', color: 'var(--cth-ink-2)',
                    border: 'none', cursor: busy ? 'default' : 'pointer', textAlign: 'start'
                  }}
                >
                  <FolderGlyph />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 13, fontWeight: 600, color: 'var(--cth-ink)' }}>
                      {folderName(h)}
                    </div>
                    <div style={{
                      fontFamily: 'var(--cth-font-mono)', fontSize: 11.5, color: 'var(--cth-ink-3)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left'
                    }}>{h}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--cth-line)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!confirmStartOver ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <PixelButton variant="secondary" size="sm" onClick={() => setConfirmStartOver(true)} disabled={busy}>
                {t('officeMissing.startOver')}
              </PixelButton>
              <span style={hint}>{t('officeMissing.startOverHint')}</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--cth-ink)' }}>{t('officeMissing.startOverConfirm')}</span>
              <PixelButton variant="destructive" size="sm" onClick={() => { void startOver(); }} disabled={busy}>
                {t('officeMissing.startOverYes')}
              </PixelButton>
              <PixelButton variant="ghost" size="sm" onClick={() => setConfirmStartOver(false)} disabled={busy}>
                {t('common.cancel')}
              </PixelButton>
            </div>
          )}
        </div>

        {error && (
          <div role="alert" style={{
            padding: '8px 12px', borderRadius: 'var(--cth-r-md)', fontSize: 12.5, lineHeight: '18px',
            color: 'var(--cth-coral-text)', background: 'var(--cth-coral-soft)'
          }}>{error}</div>
        )}
      </div>
    </div>
  );
}

function FolderGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}
