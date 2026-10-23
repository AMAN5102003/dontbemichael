import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { missionsFor, orderedJobs, type ScheduledMission } from '@shared/missions';
import { whenParts } from '@shared/scheduleTimes';
import { RESEARCH_ID } from '@shared/research';
import { useStore } from '@/store/store';
import { InfoTip } from './InfoTip';
import { fieldLabel, groupName } from './fieldText';
import { useGodId, useMissions, whenText } from './triggers/ScheduleList';

/**
 * An agent's scheduled jobs (docs/designs/edit-agent-scheduled-jobs.md): a
 * labelled group, apart from what the agent handles, so a timer never reads
 * as a duty. Each job shows its name, when it runs and its focus area, read
 * only (schedule-focus-areas.md FA1); the focus reaches the agent only when
 * that job runs (FA2). Jobs are set on the Access tab, one click away.
 */
export function useScheduledJobs(agentId: string): ScheduledMission[] {
  const { missions } = useMissions();
  const godId = useGodId();
  return missionsFor(missions, agentId, godId).filter((m) => (m.kind ?? 'dispatch') === 'dispatch');
}

export interface ScheduledJobsListProps {
  agentId: string;
  /** The agent's name, for the info icon. */
  name: string;
  /** 'label' in Edit agent (the field label style), 'section' on the Profile tab. */
  heading?: 'label' | 'section';
  /** "Change on Access": Edit agent closes itself first; the default opens the
   *  Access tab with On a schedule unfolded. */
  onChange?: () => void;
  /** Michael's jobs are set on his Office schedule tab, not on Access. */
  office?: boolean;
}

export function ScheduledJobsList({ agentId, name, heading = 'label', onChange, office }: ScheduledJobsListProps) {
  const { t } = useTranslation();
  const { status, retry } = useMissions();
  const openSchedules = useStore((s) => s.openSchedules);
  const all = useScheduledJobs(agentId);
  // Research holds no office data, schedules included (research-agent-privacy.md).
  if (agentId === RESEARCH_ID) return null;
  const jobs = orderedJobs(all, Date.now());
  const title = t('scheduledJobs.title');
  const change = onChange ?? (() => openSchedules(agentId));
  return (
    <div role="group" aria-label={jobs.length ? `${title}, ${jobs.length}` : title} data-scheduled-jobs style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          {heading === 'section'
            ? <h3 style={{ ...sectionStyle, margin: 0 }}>{title}</h3>
            : <span style={fieldLabel}>{title}</span>}
          {jobs.length > 0 && <span style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>{jobs.length}</span>}
          <InfoTip text={t(office ? 'scheduledJobs.infoOffice' : 'scheduledJobs.info', { name })} label={title} />
        </div>
        {status !== 'loading' && (
          <button type="button" onClick={change} style={linkStyle}>
            {office ? t('scheduledJobs.changeOnOffice') : status === 'ready' && jobs.length === 0 ? t('scheduledJobs.addOnAccess') : t('scheduledJobs.changeOnAccess')}
          </button>
        )}
      </div>
      {status === 'error' ? (
        <div role="alert" style={{ fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink-2)' }}>
          {t('scheduledJobs.loadError')}{' '}
          <button type="button" onClick={retry} style={linkStyle}>{t('scheduledJobs.tryAgain')}</button>
        </div>
      ) : status === 'ready' && jobs.length === 0 ? (
        <span style={{ fontSize: 12.5, color: 'var(--cth-ink-3)' }}>{t('scheduledJobs.none')}</span>
      ) : jobs.length > 0 ? (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
          {jobs.map((m, i) => <JobRow key={m.id} job={m} first={i === 0} />)}
        </ul>
      ) : null}
    </div>
  );
}

/** One job: the name and when it runs, then its focus (SJ5). The name wraps
 *  whole; the when line wraps only between its parts and drops under the
 *  name when both don't fit (SJ7, R1). */
function JobRow({ job, first }: { job: ScheduledMission; first: boolean }) {
  const { t } = useTranslation();
  const off = !job.enabled;
  // The locale's "and" before the last time, read by filling its template.
  const and = t('schedulesSection.whenAnd', { list: '\u0001', last: '\u0002' });
  const joiner = and.slice(and.indexOf('\u0001') + 1, and.indexOf('\u0002'));
  const parts = whenParts(whenText(job, t), t('schedulesSection.whenSep'), joiner);
  return (
    <li style={{ padding: first ? '2px 0 8px' : '8px 0', borderTop: first ? 'none' : '1px solid var(--cth-line)', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 10, rowGap: 2 }}>
        <span style={{ fontSize: 13, lineHeight: '18px', fontWeight: 600, color: off ? 'var(--cth-ink-3)' : 'var(--cth-ink)', overflowWrap: 'anywhere' }}>
          {job.label}
          {off && <span style={pausedPill}>{t('scheduledJobs.paused')}</span>}
        </span>
        <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '18px', color: 'var(--cth-ink-2)', marginInlineStart: 'auto', textAlign: 'end' }}>
          {parts.map((p, i) => <span key={i} style={{ whiteSpace: 'nowrap' }}>{p}</span>)}
        </span>
      </div>
      {job.focus?.trim() ? (
        <span style={{ ...focusStyle, color: off ? 'var(--cth-ink-3)' : 'var(--cth-ink-2)' }}>{job.focus}</span>
      ) : (
        <span style={{ fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink-3)' }}>{t('scheduledJobs.noFocus')}</span>
      )}
    </li>
  );
}

/** On the Profile tab it reads as the tab's other section names (AS3). */
const sectionStyle: CSSProperties = groupName;
const linkStyle: CSSProperties = {
  flexShrink: 0, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-2)', textDecoration: 'underline', textUnderlineOffset: 2
};
/** Cut at two lines on screen; a screen reader reads it whole (SJ5). */
const focusStyle: CSSProperties = {
  fontSize: 12.5, lineHeight: '18px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
};
/** The "Read only" tag's look (DESIGN.md, Company knowledge). */
const pausedPill: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 7px', marginInlineStart: 6, verticalAlign: 1,
  borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-neutral-soft)', color: 'var(--cth-ink-3)', fontSize: 10.5, fontWeight: 600
};
