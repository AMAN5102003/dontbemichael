import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, ACTION_CLOCKING_IN } from '@/store/store';
import { useClockingIn } from '@/hooks/useClockingIn';
import { restoreInFlight } from '@/hooks/useRestoreTeam';
import { DONE_SHOWN_MS, SHORT_SHOWN_MS, namesShown, nextOpening, stillOut } from '@/shell/clockingIn';
import { OpeningCard } from './OpeningCard';

/** How long the end card takes to fade, inside its shown time. */
const FADE_MS = 300;

/**
 * The office opening (DESIGN.md 7.24, design review 2026-10-18). Always
 * mounted, so the opening moves on whatever view is up (the clock pill reads
 * it too); the card itself shows on the office floor only. While people clock
 * in: who is in, a bar and who is still coming. Then "Everyone's in" for 2 s,
 * or at the one minute cap who has not clocked in, for 4 s. After that the
 * opening is over for the session: a mid-day hire clocks in on their desk only.
 */
export function TeamClockingIn({ show }: { show: boolean }) {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  const opening = useStore((s) => s.opening);
  const godStatus = useStore((s) => s.godStatus);
  const arriving = useClockingIn(agents);
  const [, tick] = useState(0);
  // What the screen reader heard when this opening began, kept for its whole run.
  const said = useRef<{ since: number; text: string } | null>(null);

  const live = opening.kind !== 'over';
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [live]);
  useEffect(() => {
    const next = nextOpening(opening, {
      team: agents, arriving: arriving.size, michaelStarting: godStatus === 'booting',
      restoring: restoreInFlight(), marker: ACTION_CLOCKING_IN
    }, Date.now());
    if (next !== opening) useStore.getState().setOpening(next);
  });

  if (!show) return null;
  const joined = (names: string[]) => names.join(t('office.opening.nameSep'));

  if (opening.kind === 'opening') {
    const out = stillOut(agents, ACTION_CLOCKING_IN);
    if (!agents.length || !out.length) return null;
    const total = agents.length;
    const inCount = total - out.length;
    if (said.current?.since !== opening.since) said.current = { since: opening.since, text: t('office.opening.announce', { count: inCount, total }) };
    const shown = namesShown(out);
    return (
      <OpeningCard tone="indigo" pulse
        title={t('office.opening.title')}
        count={t('office.clockedInCount', { count: inCount, total })}
        progress={{ value: inCount, max: total, label: t('office.opening.title') }}
        line={shown.more
          ? t('office.opening.stillComingMore', { names: joined(shown.names), count: shown.more })
          : t('office.opening.stillComing', { names: joined(shown.names) })}
        say={said.current.text} />
    );
  }
  if (opening.kind === 'done') {
    const title = t('office.opening.allIn');
    return (
      <OpeningCard tone="green" check fadeAfterMs={DONE_SHOWN_MS - FADE_MS}
        title={title}
        count={t('office.clockedInCount', { count: opening.total, total: opening.total })}
        progress={{ value: opening.total, max: opening.total, label: title }}
        say={title} />
    );
  }
  if (opening.kind === 'short') {
    const title = t('office.clockedInCount', { count: opening.total - opening.missing.length, total: opening.total });
    const [first, ...rest] = opening.missing;
    const line = rest.length
      ? t('office.opening.missingMore', { name: first, count: rest.length })
      : t('office.opening.missingOne', { name: first });
    return <OpeningCard tone="amber" fadeAfterMs={SHORT_SHOWN_MS - FADE_MS} title={title} line={line} say={`${title}. ${line}`} />;
  }
  return null;
}
