import { useEffect, useRef, useState } from 'react';
import { ACTION_CLOCKING_IN, type Agent } from '@/store/store';
import { clockingIn } from '@/shell/clockingIn';

/** The office floor's opening: who is still clocking in, refreshed while
 *  anyone is, so the dark desks and the card that explains them agree. */
export function useClockingIn(agents: ReadonlyArray<Pick<Agent, 'id' | 'action'>>): Set<string> {
  const since = useRef(new Map<string, number>());
  const [, tick] = useState(0);
  const out = clockingIn(agents, since.current, Date.now(), ACTION_CLOCKING_IN);
  const waiting = out.size > 0;
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, [waiting]);
  return out;
}
