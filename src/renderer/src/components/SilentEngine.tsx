/**
 * A team member whose engine stopped reporting to the app (issue #326; design
 * SD1 to SD17, DESIGN.md §7.6b; approved picture silent-engine-v2.html). Main
 * keeps the episodes (src/main/silentWatch.ts) and pushes them; the Needs you
 * feed carries them. Three pieces here: the card on Needs you, the amber
 * "Not reporting" tag that replaces a member's status, and the line above its
 * panel's tabs. Names only, never he or she, in every language.
 */
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { silentButtons, silentCards, type SilentCard, type SilentEpisode } from '@shared/silentEngine';
import { useStore } from '@/store/store';
import { useNeedsYou } from '@/shell/useNeedsYou';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { InfoTip } from './InfoTip';
import { PixelButton } from './PixelButton';
import { Spinner } from './GetMichaelReady';

/** This member's episode, if its engine isn't reporting (any state). */
export function useSilentEpisode(agentId: string | undefined): SilentEpisode | undefined {
  const { silent } = useNeedsYou();
  return agentId ? silent.find((e) => e.agentId === agentId) : undefined;
}

function useNames(): (ids: string[]) => string {
  const { i18n } = useTranslation();
  const agents = useStore((s) => s.agents);
  return (ids) => {
    const names = ids.map((id) => agents.find((a) => a.id === id)?.name ?? id);
    try { return new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(names); } catch { return names.join(', '); }
  };
}

const minutesAgo = (at: number | null): number => (at ? Math.max(1, Math.round((Date.now() - at) / 60_000)) : 1);

/** The cards at the top of Needs you, under an office stop (SD3, SD6). */
export function SilentEngineCards() {
  const { silent } = useNeedsYou();
  const cards = silentCards(silent);
  if (!cards.length) return null;
  return <>{cards.map((c) => <SilentEngineCard key={c.key} card={c} />)}</>;
}

function SilentEngineCard({ card }: { card: SilentCard }) {
  const { t } = useTranslation();
  const godName = useResolvedGodName();
  const names = useNames();
  const one = card.agentIds.length === 1;
  const name = card.michael ? godName : names(card.agentIds);
  const engine = card.version ? `${card.engineLabel} ${card.version}` : card.engineLabel;
  const n = { name, engine, count: card.agentIds.length };
  const paused = card.stopped && !card.michael;
  const title = card.michael ? t('silent.titleMichael', { name: godName })
    : paused ? t(one ? 'silent.paused' : 'silent.pausedMany', n)
    : t(one ? 'silent.title' : 'silent.titleMany', n);
  const busy = card.state === 'restarting' || card.state === 'checking';
  const line = card.state === 'restarting' ? t(one ? 'silent.restarting' : 'silent.restartingMany', n)
    : card.state === 'checking' ? t(one ? 'silent.checking' : 'silent.checkingMany', n)
    : card.michael ? t('silent.michaelLine', { name: godName })
    : card.state === 'failed' && card.restartTried ? t(one ? 'silent.restartFailed' : 'silent.restartFailedMany', n)
    : card.state === 'failed' ? t(one ? 'silent.engineNever' : 'silent.engineNeverMany', n)
    : paused ? t(one ? 'silent.pausedLine' : 'silent.pausedLineMany', n)
    : t(one ? 'silent.stillWorking' : 'silent.stillWorkingMany', n);
  const when = busy || card.state === 'failed' ? null
    : card.kind === 'never' ? t(one ? 'silent.neverIn' : 'silent.neverInMany', { name, count: minutesAgo(card.startedAt) })
    : t('silent.lastIn', { count: minutesAgo(card.lastCheckInAt) });
  const buttons = silentButtons(card);
  const editAgent = useStore((s) => s.requestEditAgent);
  return (
    <section data-silent-card={card.key} aria-label={title} style={card.michael ? officeCard : plainCard}>
      {card.michael && <div style={kicker}>{t('silent.office')}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, lineHeight: '18px', color: 'var(--cth-ink)' }}>
        <span dir="auto" style={{ minWidth: 0 }}>{title}</span>
        <span style={{ marginInlineStart: 'auto', display: 'inline-flex' }}><InfoTip text={t(one || card.michael ? 'silent.info' : 'silent.infoMany', n)} align="end" /></span>
      </div>
      <div role="status" dir="auto" style={{ marginTop: 2, fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink-2)' }}>
        {busy ? <><Spinner /> {line}</> : line}
      </div>
      {when && <div dir="auto" style={{ marginTop: 3, fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-3)' }}>{when}</div>}
      {buttons.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {buttons.map((b, i) => (
            <PixelButton
              key={b}
              variant={i === 0 ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                if (b === 'restart') void window.cth.silentRestart?.(card.agentIds);
                else if (b === 'keep') void window.cth.silentKeep?.(card.agentIds);
                else editAgent(card.agentIds[0], { engine: true });
              }}
            >
              {b === 'restart' ? (card.michael || one ? t('silent.restart', { name }) : t('silent.restartAll', n))
                : b === 'keep' ? t('silent.keep')
                : t('silent.changeEngine')}
            </PixelButton>
          ))}
        </div>
      )}
    </section>
  );
}

/** The amber tag that replaces a member's status pill while its engine isn't
 *  reporting, kept unchecked included (SD14). */
export function NotReportingTag({ style }: { style?: CSSProperties }) {
  const { t } = useTranslation();
  return <span data-not-reporting="" style={{ ...tag, ...style }}>{t('silent.tag')}</span>;
}

/** One amber line above a member's panel tabs (SD14); with Check again when
 *  the owner kept it working unchecked (SD5). */
export function SilentPanelLine({ agentId, name }: { agentId: string; name: string }) {
  const { t } = useTranslation();
  const ep = useSilentEpisode(agentId);
  if (!ep) return null;
  const engine = ep.version ? `${ep.engineLabel} ${ep.version}` : ep.engineLabel;
  const kept = ep.state === 'kept';
  return (
    <div data-silent-line="" style={strip}>
      <span dir="auto" style={{ minWidth: 0 }}>{kept ? t('silent.keptLine', { name, engine }) : t('silent.panelLine', { name })}</span>
      {kept && (
        <button type="button" onClick={() => { void window.cth.silentCheckAgain?.(agentId); }} style={stripButton}>{t('silent.checkAgain')}</button>
      )}
    </div>
  );
}

/** A plain Ask me card (DESIGN.md §7.8: no side rule, no "from" line). */
const plainCard: CSSProperties = {
  flexShrink: 0, padding: '13px 14px', borderRadius: 'var(--cth-r-xl)', background: 'var(--cth-card)',
  boxShadow: 'inset 0 0 0 1px var(--cth-line), 0 1px 2px rgba(30, 27, 46, .04), 0 4px 12px rgba(62, 52, 140, .06)'
};
/** The office's own card, like The office stopped (§7.6a, SD6). */
const officeCard: CSSProperties = {
  ...plainCard,
  boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, var(--cth-coral-base) 55%, transparent), 0 1px 2px rgba(30, 27, 46, .04)'
};
const kicker: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--cth-coral-text)', marginBottom: 3 };
const tag: CSSProperties = {
  display: 'inline-block', fontSize: 10, fontWeight: 600, lineHeight: '13px', padding: '1px 7px', borderRadius: 999,
  background: 'var(--cth-amber-soft)', color: 'var(--cth-amber-text)', whiteSpace: 'nowrap'
};
const strip: CSSProperties = {
  margin: '0 14px 10px', padding: '8px 10px', borderRadius: 'var(--cth-r-lg)', fontSize: 12, lineHeight: '17px',
  background: 'var(--cth-amber-soft)', color: 'var(--cth-amber-text)', display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-amber) 35%, transparent)', flexShrink: 0
};
const stripButton: CSSProperties = {
  border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'var(--cth-font-ui)',
  fontSize: 12, fontWeight: 600, color: 'var(--cth-ink)', whiteSpace: 'nowrap'
};
