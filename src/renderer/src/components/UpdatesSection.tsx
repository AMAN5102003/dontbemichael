/**
 * The update half of the About card at the top of Settings → General
 * (SettingsHeroCard, docs/designs/about-updates-card.md). It used to be its
 * own "Updates" block; the card now shows the version once, with this status
 * and its one button beside it (owner, 2026-10-01).
 *
 * The toolbar already carries an update chip (UpdateBadge), but a chip that
 * stays blank when everything is fine is not somewhere you go to *ask*, and
 * "is there a new version?" is exactly the question people open Settings with.
 *
 * Same status stream as the badge, same reducer, same states; only the wording
 * differs (`describeUpdateSettings` vs `describeUpdate`), so the two can never
 * disagree about what is installed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { summarizeReleaseNotes } from '@shared/releaseNotes';
import { describeUpdateSettings, manualDownloadUrl, pendingVersion, reduceStatus, clampPercent, type UpdateStatus } from '@shared/updateState';
import { installSteps } from './updateWords';
import { PixelButton } from './PixelButton';

declare const __APP_VERSION__: string;

export function useUpdates() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Subscribe before pulling: main may have emitted while this modal was
    // closed, and `update:current` re-serves the last known state.
    const off = window.cth.onUpdateStatus?.((next) => setStatus((prev) => reduceStatus(prev, next)));
    void window.cth.updateCurrent?.().then((cur) => {
      if (cur) setStatus((prev) => reduceStatus(prev, cur));
    }).catch(() => { /* older main without the handler — the push channel still works */ });
    return off;
  }, []);

  // What the idle line may honestly promise (owner, 2026-10-02: "is this
  // statement really true?"). Every installed build checks on its own; a dev
  // build never checks at all.
  const [packaged, setPackaged] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    window.cth.appInfo().then((i) => { if (alive) setPackaged(i.packaged !== false); }).catch(() => { /* assume installed */ });
    return () => { alive = false; };
  }, []);

  const view = describeUpdateSettings(status, __APP_VERSION__);
  /** The manual path is always on offer next to the automatic one. */
  const pending = pendingVersion(status, __APP_VERSION__);
  const [manualStarted, setManualStarted] = useState<string | null>(null);
  const steps = installSteps(window.cth.platform ?? 'darwin', t);
  const downloadManually = () => {
    if (!status) return;
    const url = manualDownloadUrl(status, window.cth.platform, window.cth.arch);
    if (!url) return;
    void window.cth.updateOpenRelease(url);
    setManualStarted(pending);
  };

  // The shared describeUpdateSettings() renders English prose (the toolbar
  // badge translates its own words in updateWords.ts). For THIS block we
  // re-derive the three prose fields from the status through i18n, keeping the
  // shared function as the single source of truth for tone/action/busy.
  const v = __APP_VERSION__;
  const localized: { headline: string; detail: string; button: string | null } = (() => {
    switch (status?.state) {
      case 'checking':
        return { headline: t('updatesSection.onVersion', { v }), detail: t('updatesSection.checkingDetail'), button: null };
      case 'available':
        return {
          headline: t('updatesSection.availableHeadline', { version: status.version }),
          detail: t('updatesSection.availableDetail', { v }),
          button: t('updatesSection.downloadBtn', { version: status.version })
        };
      case 'downloading':
        return {
          headline: t('updatesSection.downloadingHeadline', { version: status.version }),
          detail: t('updatesSection.downloadingDetail', { percent: clampPercent(status.percent) }),
          button: null
        };
      case 'downloaded':
        return {
          headline: t('updatesSection.downloadedHeadline', { version: status.version }),
          detail: t('updatesSection.downloadedDetail', { v }),
          button: t('updatesSection.restartBtn')
        };
      case 'available-manual':
        return {
          headline: t('updatesSection.availableHeadline', { version: status.version }),
          detail: status.reason
            ? t('updatesSection.manualDetailReason', { reason: status.reason })
            : t('updatesSection.manualDetail'),
          button: t('updatesSection.openReleaseBtn')
        };
      case 'error':
        return {
          headline: t('updatesSection.errorHeadline'),
          detail: t('updatesSection.errorDetail', { message: status.message, v }),
          button: t('updatesSection.retryBtn')
        };
      case 'not-available':
        return {
          headline: t('updatesSection.latestHeadline', { v }),
          detail: t('updatesSection.latestDetail'),
          button: t('updatesSection.checkAgainBtn')
        };
      case 'idle':
      default:
        // A dev build never checks, and its Check button would only fail.
        if (packaged === false) return { headline: t('updatesSection.onVersion', { v }), detail: t('updatesSection.devDetail'), button: null };
        return {
          headline: t('updatesSection.onVersion', { v }),
          detail: t('updatesSection.idleDetail'),
          button: t('updatesSection.checkBtn')
        };
    }
  })();
  const viewText = { ...view, headline: localized.headline, detail: localized.detail, button: localized.button };

  // Same digest the update toast renders (src/shared/releaseNotes.ts), for the
  // same reason: the release body is already in hand, and "what would I get?"
  // is the second question anyone asks after "is there a new version?". Only
  // the states that carry notes have any — the rest render nothing extra.
  const notes = useMemo(
    () => summarizeReleaseNotes(status && 'notes' in status ? status.notes : undefined),
    [status]
  );

  const onClick = useCallback(async () => {
    if (view.action === 'none' || busy) return;
    setBusy(true);
    try {
      if (view.action === 'restart') await window.cth.updateRestartAndInstall();
      else if (view.action === 'download') await window.cth.updateDownload();
      else if (view.action === 'check') await window.cth.updateCheckNow();
      else if (view.action === 'open-release') {
        await window.cth.updateOpenRelease(status?.state === 'available-manual' ? status.url : undefined);
      }
    } catch { /* the emitted status carries the failure — nothing to do here */ }
    setBusy(false);
  }, [view.action, busy, status]);

  // Idle, checking, up to date and just updated say nothing the version beside
  // them does not: only their detail line shows, and no notes. Notes are for a
  // newer version; the ones for this version are behind What's new
  // (about-updates-card.md).
  const quiet = !status || status.state === 'idle' || status.state === 'checking' || status.state === 'not-available' || status.state === 'just-updated';
  return { status, view: viewText, quiet, notes: quiet ? [] : notes, pending, busy, onClick, downloadManually, manualStarted, steps };
}

/** The status line under the app's name: the detail alone when quiet, else
 *  the headline (it names what to do) and the detail. */
export function UpdateStatusLine({ u }: { u: ReturnType<typeof useUpdates> }) {
  return (
    <div style={{ fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-3)' }}>
      {!u.quiet && (
        <span style={{ fontSize: 13, fontWeight: u.view.tone === 'ready' ? 600 : 500, color: 'var(--cth-ink)', marginInlineEnd: 6 }}>
          {u.view.headline}
        </span>
      )}
      {u.view.detail}
    </div>
  );
}

/** The update buttons: download manually whenever a newer version is known,
 *  then the one button that names what pressing it does. */
export function UpdateButtons({ u }: { u: ReturnType<typeof useUpdates> }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
      {u.pending && (
        <PixelButton
          variant="secondary"
          size="sm"
          onClick={u.downloadManually}
          style={{ whiteSpace: 'nowrap' }}
          title={t('updatesSection.downloadManuallyTitle', { version: u.pending })}
        >
          {t('updatesSection.downloadManually')}
        </PixelButton>
      )}
      {u.view.button && (
        <PixelButton
          variant={u.view.tone === 'ready' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => { void u.onClick(); }}
          disabled={u.busy || u.view.busy}
          // A phrase label ("Check for updates") in a flex row beside prose:
          // refuse to shrink or wrap, or the second line prints through the
          // button's bottom edge. The prose column yields instead.
          style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {u.view.button}
        </PixelButton>
      )}
    </div>
  );
}

/** What follows the status: the manual install steps once a download has
 *  started, and the release notes digest when the status carries notes. */
export function UpdateDetails({ u }: { u: ReturnType<typeof useUpdates> }) {
  return (
    <>
      {u.manualStarted && (
        <div style={{
          padding: '10px 12px', fontSize: 12, lineHeight: 1.5, color: 'var(--cth-ink)',
          background: 'var(--cth-card-2)', borderRadius: 'var(--cth-r-lg)', boxShadow: 'inset 0 0 0 1px var(--cth-line)'
        }}>
          <Trans i18nKey="updatesSection.manualDownloadingTitle" values={{ version: u.manualStarted }} components={{ b: <b /> }}>
            v{u.manualStarted} is downloading in your browser.
          </Trans>{' '}
          <Trans i18nKey="updatesSection.manualDownloadingBody" values={{ os: u.steps.os }}>
            When it lands, quit this app, install the new version over the current one, open it and
            pick the same project. On {u.steps.os}:
          </Trans>
          <ol style={{ margin: '4px 0 0', paddingInlineStart: 18, color: 'var(--cth-ink-2)' }}>
            {u.steps.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>
      )}
      {u.notes.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {u.notes.map((line, i) => (
            <li key={i} style={{ display: 'flex', gap: 6, fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-3)' }}>
              <span aria-hidden style={{ color: 'var(--cth-ink-4)' }}>•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
