import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, type Agent } from '@/store/store';
import type { HarnessConfig } from '@/store/config';
import { AskMeTab } from '@/components/AskMeTab';
import { InfoTip } from '@/components/InfoTip';
import { PixelButton } from '@/components/PixelButton';
import { useRestoreTeam } from '@/hooks/useRestoreTeam';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { useNeedsYouCount } from './useNeedsYou';
import { focusNeedsYouPill } from './rightColumn';

/**
 * The Needs you board (branding/DESIGN.md 7.6 and 7.8): the questions Michael
 * could not settle, and the schedule requests he passed on. It opens whenever
 * something waits
 * (docs/designs/needs-you-empty-state.md). While anything waits it stays open
 * and has no close; the x appears only when nothing waits (owner, 2026-10-02).
 */
export function NeedsYouBoard() {
  const { t } = useTranslation();
  const godName = useResolvedGodName();
  const count = useNeedsYouCount();
  const [closeHover, setCloseHover] = useState(false);
  const close = () => { useStore.getState().setRightColumn('closed'); focusNeedsYouPill(); };
  return (
    <div style={{
      height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12,
      padding: '14px 16px 12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <h2 tabIndex={-1} data-needs-you-heading className="cth-needs-heading" style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--cth-ink)' }}>
          {t('shell.needsYou')}
        </h2>
        {count > 0 && (
          <span style={{
            minWidth: 20, height: 20, padding: '0 6px', borderRadius: 'var(--cth-r-pill)', display: 'inline-grid', placeItems: 'center',
            background: 'var(--cth-coral-strong)', color: 'var(--cth-on-coral)',
            fontFamily: 'var(--cth-font-mono)', fontSize: 11, fontWeight: 600
          }}>{count}</span>
        )}
        <InfoTip text={t('shell.needsYouInfo', { godName })} />
        {count === 0 && <button
          onClick={close}
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => setCloseHover(false)}
          aria-label={t('panel.close')}
          title={t('panel.close')}
          style={{
            marginInlineStart: 'auto', width: 24, height: 24, padding: 0, border: 'none', borderRadius: 'var(--cth-r-sm)',
            cursor: 'pointer',
            background: closeHover ? 'var(--cth-neutral-soft)' : 'transparent',
            color: closeHover ? 'var(--cth-ink-2)' : 'var(--cth-ink-3)',
            fontSize: 13, lineHeight: 1,
            transition: 'background var(--cth-dur-fast) var(--cth-ease), color var(--cth-dur-fast) var(--cth-ease)'
          }}
        >✕</button>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <AskMeTab />
      </div>
    </div>
  );
}

/** Last session's team, not started yet: bring them all back, or leave one out.
 *  Floats over the office's top left corner (D5): it is about the floor, so it
 *  never opens the column or counts toward Needs you. */
export function RestoreTeamBanner({ config }: { config: HarnessConfig }) {
  const { t } = useTranslation();
  const restorable = useStore((s) => s.restorableAgents);
  const { restoring, autoRestoring, restoreTeam } = useRestoreTeam(config);
  const busy = restoring || autoRestoring;
  if (!restorable.length && !busy) return null;
  return (
    <div style={{
      position: 'absolute', top: 12, insetInlineStart: 16, zIndex: 55, width: 320, maxWidth: 'calc(100% - 32px)',
      padding: '10px 12px', borderRadius: 'var(--cth-r-xl)',
      background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)',
      display: 'flex', flexDirection: 'column', gap: 8
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--cth-ink)' }}>
        {busy ? t('shell.restoring') : t('shell.restoreTitle')}
      </div>
      {!busy && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {restorable.map((a: Agent) => (
              <span key={a.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 4px 0 10px',
                borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-neutral-soft)',
                fontSize: 11.5, fontWeight: 600, color: 'var(--cth-ink-2)'
              }}>
                {a.name}
                <button
                  onClick={() => useStore.getState().removeRestorableAgent(a.id)}
                  aria-label={t('shell.dismiss', { name: a.name })}
                  title={t('shell.dismiss', { name: a.name })}
                  style={{
                    width: 18, height: 18, padding: 0, border: 'none', borderRadius: '50%', cursor: 'pointer',
                    background: 'transparent', color: 'var(--cth-ink-3)', fontSize: 11, lineHeight: 1
                  }}
                >✕</button>
              </span>
            ))}
          </div>
          <div>
            <PixelButton variant="primary" size="sm" onClick={() => void restoreTeam()}>
              {t('shell.restoreAll', { count: restorable.length })}
            </PixelButton>
          </div>
        </>
      )}
    </div>
  );
}
