import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { InfoTip } from './InfoTip';
import { useStore } from '@/store/store';
import { AgentAvatar } from './AgentAvatar';
import { splitAgentRole } from '@shared/agentRole';
import { jobBase } from '@shared/jobChange';
import { roleLabel } from '@shared/workStyleText';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { decisionId, type WorkStyleOffer } from '@shared/workStyleUpdates';
import { decideWorkStyleOffer, adoptWorkStyleOffer } from '@/shell/workStyleOffers';
import { refreshNeedsYou } from '@/shell/useNeedsYou';
import { JobChangeReview, type ReviseResult, type ReviseRun } from './JobChangeReview';

/**
 * A better default job description for someone already hired
 * (shared/workStyleUpdates.ts): what changed in one line, whether the owner's
 * changes carry over, and the choice. "See it" opens the same preview Edit
 * agent shows, with the owner's changes reapplied; nothing saves before "Use
 * it" (work-style-change-request.md, D7, D8, DR9). Same frame as a schedule
 * request card.
 */
export function WorkStyleUpdateCards({ offers }: { offers: WorkStyleOffer[] }) {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  const godName = useResolvedGodName();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Offers whose plain words came from the rules rewrite: shown, never kept,
  // so Edit agent writes them with the model once (eng D5).
  const rulesPlain = useRef(new Set<string>());

  const keep = async (offer: WorkStyleOffer) => {
    const id = decisionId(offer.key, offer.agentId);
    setBusy(id);
    setFailed(null);
    try { await decideWorkStyleOffer(offer, 'keep'); } catch { setFailed(id); }
    setBusy(null);
    refreshNeedsYou();
  };

  /** The preview's rewrite: the owner's changes on the new text, or, with
   *  none, the new text in plain words with what changed in it. */
  const preview = (offer: WorkStyleOffer, name: string) => async ({ requestId }: ReviseRun): Promise<ReviseResult> => {
    const config = await window.cth.getConfig() as { businessName?: string; businessCity?: string };
    const split = splitAgentRole(offer.description);
    const ctx = { name, title: split.role || undefined, business: { name: config.businessName, city: config.businessCity }, manager: godName };
    if (offer.changes.length) {
      return window.cth.workStyleRevise({ requestId, ctx, current: { instructions: offer.goal, handles: split.roleDescription }, changes: offer.changes });
    }
    const plain = await window.cth.workStyleConvert({ to: 'plain', text: offer.goal, ctx }).catch(() => null);
    if (!plain?.text) return { kind: 'error', reason: 'failed' };
    const id = decisionId(offer.key, offer.agentId);
    if (plain.source === 'ai') rulesPlain.current.delete(id); else rulesPlain.current.add(id);
    const agent = useStore.getState().agents.find((a) => a.id === offer.agentId);
    return {
      kind: 'ok',
      instructions: offer.goal,
      plain: plain.text,
      handles: agent?.description === offer.description ? null : split.roleDescription,
      summary: [t(offer.whyKey)]
    };
  };

  return (
    <>
      {offers.map((offer) => {
        const id = decisionId(offer.key, offer.agentId);
        const agent = agents.find((a) => a.id === offer.agentId);
        const name = agent?.name ?? offer.agentId;
        const carry = offer.olderEdits ? t('jobChange.packOlderEdits', { name })
          : offer.changes.length === 1 ? t('jobChange.packKeptOne')
            : t('jobChange.packKeptMany', { count: offer.changes.length });
        return (
          <section key={id} data-work-style-offer aria-label={t('jobChange.packTitle', { name })} style={{
            position: 'relative', flexShrink: 0, padding: '12px 14px', borderRadius: 'var(--cth-r-xl)',
            background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-sm)',
            display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--cth-font-ui)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, lineHeight: '17px', color: 'var(--cth-ink)' }}>
              <AgentAvatar id={offer.agentId} name={name} size={17} />
              {t('jobChange.packTitle', { name })}
            </div>
            <div style={{ fontSize: 12, lineHeight: '16.5px', color: 'var(--cth-ink)' }}>
              {t(offer.whyKey)} <InfoTip text={t('askMe.workStyleReplaces', { name })} label={t('jobChange.packTitle', { name })} />
            </div>
            <div style={{ fontSize: 12, lineHeight: '16.5px', color: 'var(--cth-ink-2)' }}>{carry}</div>
            {failed === id && (
              <div role="alert" style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-coral-text)' }}>{t('schedulesSection.saveFailed')}</div>
            )}
            {open === id ? (
              <JobChangeReview
                who={name || roleLabel(splitAgentRole(offer.description).role)}
                run={preview(offer, name)}
                base={() => { const a = useStore.getState().agents.find((x) => x.id === offer.agentId); return a ? jobBase(a) : ''; }}
                apply={async (ok, _change, from) => {
                  const r = await adoptWorkStyleOffer(offer, ok, from);
                  if (r === 'applied' && !offer.changes.length && rulesPlain.current.has(id)) useStore.getState().updateAgent(offer.agentId, { goalPlain: undefined });
                  if (r === 'applied') { setOpen(null); refreshNeedsYou(); }
                  return r;
                }}
                applyLabel={t('jobChange.useIt')}
                sendsTask={false}
                autoRun
                onCancel={() => setOpen(null)}
              />
            ) : (
              <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
                <PixelButton variant="secondary" size="sm" disabled={busy === id} onClick={() => void keep(offer)}>{t('askMe.workStyleKeep')}</PixelButton>
                <PixelButton variant="primary" size="sm" disabled={busy === id} onClick={() => { setFailed(null); setOpen(id); }}>{t('jobChange.seeIt')}</PixelButton>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
