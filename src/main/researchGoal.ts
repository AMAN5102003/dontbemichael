/**
 * Research's job text, as the trust layer passed it (ship review D6.4): the
 * owner's Work style and its scheduled jobs are checked like any message for
 * Research. Until a version is checked, or when it is refused, Research works
 * from its built in job text. Only the latest text is remembered.
 */
import type { TrustLayer } from './trustLayer';
import { REFUSAL_CHECK_FAILED as failed } from '../shared/research';

export function makeResearchGoal(
  layer: () => Pick<TrustLayer, 'inbound'>,
  builtIn: string,
  log?: (line: string) => void
): (raw: string | null) => string {
  type Entry = { raw: string; checked?: string | null; retryAt?: number };
  let latest: Entry | null = null;
  const check = (entry: Entry): void => {
    entry.retryAt = undefined;
    layer().inbound({ subject: 'Your Work style', body: entry.raw }).then((v) => {
      if (v.decision === 'deny' && v.reason === failed) { entry.retryAt = Date.now() + 60_000; return; }
      if (v.decision === 'deny') log?.('[research] its Work style was not passed by the trust layer; it keeps its built in job text');
      entry.checked = v.decision === 'deny' ? null : v.body;
    }, () => { entry.retryAt = Date.now() + 60_000; });
  };
  return (raw) => {
    if (!raw || raw.trim() === builtIn.trim()) return builtIn;
    if (latest?.raw !== raw) {
      const entry: Entry = { raw };
      latest = entry;
      check(entry);
      return builtIn;
    }
    // A check that could not run is tried again after a minute; a refusal,
    // including one that names no private kind, stands.
    if (latest.retryAt && Date.now() >= latest.retryAt) check(latest);
    return latest.checked && latest.checked.trim() ? latest.checked : builtIn;
  };
}
