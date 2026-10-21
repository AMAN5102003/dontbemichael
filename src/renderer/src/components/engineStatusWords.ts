/**
 * The engine status on the Manager setup step, in the owner's language.
 * engineAvailabilityBadge() and engineAvailabilityMessage() keep the English
 * and decide which states show anything; this follows the same branches.
 */
import type { TFunction } from 'i18next';
import type { EngineAvailability } from '@shared/engineAvailability';

export function engineBadgeWords(a: EngineAvailability, t: TFunction): string | null {
  switch (a.state) {
    case 'installed': return t('onboarding.orchestrator.badgeInstalled');
    case 'installs-on-first-run': return t('onboarding.orchestrator.badgeInstallsOnFirstRun');
    case 'not-installable': return t('onboarding.orchestrator.badgeNotInstalled');
    default: return null;
  }
}

export function engineMissingWords(a: EngineAvailability, label: string, t: TFunction): string | null {
  if (a.state !== 'not-installable') return null;
  return t('onboarding.orchestrator.engineMissing', { label });
}
