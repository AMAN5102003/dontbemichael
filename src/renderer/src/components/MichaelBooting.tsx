import { useTranslation } from 'react-i18next';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { OpeningCard } from './OpeningCard';

/**
 * Loader shown on the empty floor while the god agent is clocking in on
 * launch. Replaces the "add agent" prompt so a returning user doesn't see the
 * empty-floor call-to-action before god has booted.
 *
 * Rendered while `agentCount === 0` — before the store has god's live agent
 * object (and so before `agent.name` exists anywhere to read) — so this reads
 * the persisted name directly, the same way useHive.ts's spawn effect does,
 * rather than assuming the default.
 */
export function MichaelBooting() {
  const { t } = useTranslation();
  const godName = useResolvedGodName();
  // DESIGN.md 7.24: the same card as the team's opening (design review 6A),
  // with no count, bar or names.
  const title = t('office.opening.michael', { name: godName });
  return (
    <OpeningCard tone="indigo" pulse title={title} say={title}
      line={t('office.opening.michaelLine', { name: godName })} />
  );
}
