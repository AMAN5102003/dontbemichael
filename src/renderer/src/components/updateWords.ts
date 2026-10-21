/**
 * The update chip's words and the manual install steps, in the owner's
 * language. describeUpdate() and manualInstallSteps() keep the English and
 * decide what each state does; this follows the same branches.
 */
import type { TFunction } from 'i18next';
import { APP_NAME } from '@shared/appName';
import { clampPercent, manualInstallSteps, pendingVersion, type UpdateStatus } from '@shared/updateState';

export function badgeWords(status: UpdateStatus | null, v: string, t: TFunction): { label: string | null; title: string } {
  if (status?.state === 'downloading') {
    const percent = clampPercent(status.percent);
    return { label: t('updateBadge.downloadingLabel', { percent }), title: t('updateBadge.downloadingTitle', { version: status.version, percent }) };
  }
  const version = pendingVersion(status, v);
  if (version) {
    if (status?.state === 'downloaded') return { label: t('updateBadge.restartLabel', { version }), title: t('updateBadge.restartTitle', { version }) };
    if (status?.state === 'available') return { label: t('updateBadge.updateLabel', { version }), title: t('updateBadge.updateTitle', { version }) };
    const reason = status?.state === 'available-manual' ? status.reason : undefined;
    return {
      label: t('updateBadge.downloadLabel', { version }),
      title: reason ? t('updateBadge.downloadTitleReason', { version, reason }) : t('updateBadge.downloadTitle', { version })
    };
  }
  switch (status?.state) {
    case 'checking':
      return { label: t('updateBadge.checkingLabel'), title: t('updateBadge.checkingTitle', { v }) };
    case 'error':
      return { label: t('updateBadge.failedLabel'), title: t('updateBadge.failedTitle', { message: status.message }) };
    case 'not-available':
    case 'just-updated':
      return { label: t('updateBadge.latestLabel'), title: t('updateBadge.latestTitle', { v }) };
    default:
      return { label: null, title: t('updateBadge.idleTitle', { v }) };
  }
}

export function installSteps(platform: string, t: TFunction): { os: string; steps: string[] } {
  const key = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux';
  return {
    os: manualInstallSteps(platform).os,
    steps: [t(`updateSteps.${key}1`, { app: APP_NAME }), t(`updateSteps.${key}2`, { app: APP_NAME })]
  };
}
