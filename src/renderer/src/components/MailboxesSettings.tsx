import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { Toggle, MiniButton, Disclosure } from './triggers/ui';
import { InfoTip } from './InfoTip';
import { AddMailboxDialog } from './AddMailboxDialog';
import { useHarnessConfig } from '@/hooks/useHarnessConfig';
import { useStore } from '@/store/store';
import { PROVIDER_PRESETS, sendersFrom, type MailboxRecord } from '@shared/mailboxes';
import { SENDING_LABEL_KEY } from './sendingLabels';
import { groupName, hint, panelStyle } from './fieldText';

/**
 * Settings > Connections > Mailboxes (docs/designs/multi-mailbox.md, design
 * review D-T1). One line per mailbox: address, service, who uses it, status,
 * then Fix or Edit. Status is always a word as well as a colour (DESIGN.md
 * 3.4). Removing a mailbox names who loses it (design 8A).
 *
 * The list folds (docs/designs/mailboxes-fold.md, owner 2026-10-01), so many
 * mailboxes never mean a long scroll: one header line with the count, the
 * coral "N needs you", an info icon for the intro and Add a mailbox. It
 * starts closed and opens by itself when a mailbox needs you, so a Fix pill
 * on the stage lands on the broken row, which sorts first.
 *
 * Gmail on the owner's Claude account is not here: it is a row under Claude
 * connectors, given per agent like any connector (docs/designs/claude-connectors.md, E4).
 */
export function MailboxesSettings() {
  const { t } = useTranslation();
  const config = useHarnessConfig();
  const agents = useStore((s) => s.agents);
  const [dialog, setDialog] = useState<{ fix?: MailboxRecord } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const listId = useId();
  // Open by itself only when Settings first shows the list with a mailbox that
  // needs you; fixing it later leaves the fold open (mailboxes-fold.md, 4A).
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || !config) return;
    decided.current = true;
    if ((config.mailboxes ?? []).some((m) => m.status === 'needs-attention')) setOpen(true);
  }, [config]);
  // Where keyboard focus goes back to when a confirm or the dialog closes.
  const rootRef = useRef<HTMLDivElement>(null);
  const refocus = (key: string): void => {
    setTimeout(() => rootRef.current?.querySelector<HTMLElement>(`[data-focus="${key}"] button`)?.focus(), 0);
  };

  if (!config) return null;
  // Mailboxes that need you first, then A to Z (mailboxes-fold.md, 5A).
  const needsFirst = (m: MailboxRecord): number => (m.status === 'needs-attention' ? 0 : 1);
  const mailboxes = [...(config.mailboxes ?? [])].sort((a, b) => needsFirst(a) - needsFirst(b) || a.address.localeCompare(b.address));
  const needs = mailboxes.filter((m) => m.status === 'needs-attention').length;

  const nameOf = (id: string): string => agents.find((a) => a.id === id)?.name ?? id;
  const usersOf = (mailboxId: string): string[] =>
    Object.entries(config.agentCapabilities ?? {})
      .filter(([, c]) => c.email?.enabled && c.email.mailboxes?.[0] === mailboxId)
      .map(([id]) => nameOf(id));
  const list = (names: string[]): string => names.join(t('profile.listJoiner'));
  // Who else sends from a mailbox under Send only (E3), read only: current
  // members only (on the team or waiting to respawn), never archived ones (3d).
  const current = (id: string): boolean => agents.some((a) => a.id === id) || useStore.getState().restorableAgents.some((a) => a.id === id);
  const sendersOf = (mailboxId: string): string[] =>
    sendersFrom(config.agentCapabilities, mailboxId).filter((x) => current(x.agentId)).map((x) => `${nameOf(x.agentId)} (${t(SENDING_LABEL_KEY[x.sending])})`);

  const remove = async (id: string): Promise<void> => {
    setConfirming(null);
    let ok = false;
    try {
      const res = await window.cth.mailRemove(id);
      ok = res.ok;
    } catch { /* reported below */ }
    if (!ok) setFailed(true);
    // The row is gone after a removal, so focus goes to Add; after a failure it
    // goes back to that row's Remove.
    refocus(ok ? 'add' : `remove-${id}`);
  };

  return (
    <div ref={rootRef} style={{ ...panelStyle, gap: 10 }}>
      {/* One header line: the fold, its count, the intro behind an info icon
          and Add a mailbox, which works while the list is closed. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)} style={foldButton}>
          <Disclosure open={open} />
          <span style={groupName}>
            {t('mailboxes.title')}
          </span>
          <span style={hint}>
            {mailboxes.length === 0 ? t('mailboxes.summaryNone') : mailboxes.length === 1 ? t('mailboxes.summaryOne') : t('mailboxes.summaryCount', { count: mailboxes.length })}
          </span>
          {needs > 0 && <span style={{ ...badge, ...needsBadge }}><Dot color="var(--cth-coral)" />{t('mailboxes.needsCount', { count: needs })}</span>}
        </button>
        <InfoTip label={t('mailboxes.title')} text={`${t('mailboxes.intro')}${mailboxes.length ? '' : ` ${t('mailboxes.empty')}`} ${t('mailboxes.gmailIsConnector')}`} />
        <span style={{ flex: 1 }} />
        <span data-focus="add"><PixelButton variant="primary" size="sm" onClick={() => setDialog({})}>{t('mailboxes.add')}</PixelButton></span>
      </div>

      {failed && <div role="alert" style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>! {t('capabilities.saveFailed')}</div>}

      <div style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        transition: 'grid-template-rows var(--cth-dur-base) var(--cth-ease)',
      }}>
        {/* Closed, the rows leave the Tab order and screen readers too, as the
            `hidden` attribute did; visibility flips after the slide. */}
        <div style={{
          overflow: 'hidden', minHeight: 0,
          visibility: open ? 'visible' : 'hidden',
          transition: `visibility 0s linear ${open ? '0s' : 'var(--cth-dur-base)'}`
        }}>
          <div id={listId}>
            {mailboxes.length > 0 && (
              <div role="list">
                {mailboxes.map((m) => {
                  const users = usersOf(m.id);
                  const senders = sendersOf(m.id);
                  const losing = [...users, ...sendersFrom(config.agentCapabilities, m.id).filter((x) => current(x.agentId)).map((x) => nameOf(x.agentId))];
                  const needsYou = m.status === 'needs-attention';
                  return (
                    <div key={m.id} role="listitem" style={row}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-all' }}>{m.address}</div>
                        <div style={hint}>
                          {m.provider === 'other' ? t('mailboxes.other') : PROVIDER_PRESETS[m.provider].label}
                          {' · '}
                          {users.length ? t('mailboxes.usedBy', { names: list(users) }) : t('mailboxes.usedByNobody')}
                        </div>
                        {senders.length > 0 && <div style={hint}>{t('capabilities.alsoSendsFromHere', { names: list(senders) })}</div>}
                        {needsYou && m.statusReason && <div style={{ fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-900)' }}>! {m.statusReason}</div>}
                        {confirming === m.id && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13 }}>{t('mailboxes.sure')}{losing.length ? ` ${t('mailboxes.removeAffects', { names: list(losing) })}` : ''}</span>
                            <MiniButton tone="destructive" autoFocus onClick={() => { void remove(m.id); }}>{t('mailboxes.removeIt')}</MiniButton>
                            <MiniButton onClick={() => { setConfirming(null); refocus(`remove-${m.id}`); }}>{t('mailboxes.keep')}</MiniButton>
                          </div>
                        )}
                      </div>
                      <span style={{ ...badge, ...(needsYou ? needsBadge : okBadge) }}>
                        <Dot color={needsYou ? 'var(--cth-coral)' : 'var(--cth-mint)'} />
                        {needsYou ? t('mailboxes.statusNeeds') : t('mailboxes.statusConnected')}
                      </span>
                      <span data-focus={`fix-${m.id}`}>
                        <PixelButton variant={needsYou ? 'secondary' : 'ghost'} size="sm" onClick={() => setDialog({ fix: m })}>
                          {needsYou ? t('mailboxes.fix') : t('mailboxes.edit')}
                        </PixelButton>
                      </span>
                      {confirming !== m.id && <span data-focus={`remove-${m.id}`}><PixelButton variant="ghost" size="sm" onClick={() => setConfirming(m.id)}>{t('mailboxes.remove')}</PixelButton></span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {dialog && (
        <AddMailboxDialog
          fix={dialog.fix}
          onClose={() => { refocus(dialog.fix ? `fix-${dialog.fix.id}` : 'add'); setDialog(null); }}
          onSaved={() => { refocus(dialog.fix ? `fix-${dialog.fix.id}` : 'add'); setDialog(null); }}
        />
      )}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ width: 8, height: 8, background: color, display: 'inline-block' }} />;
}

const foldButton: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', border: 'none', background: 'transparent',
  cursor: 'pointer', textAlign: 'start', fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink-900)'
};
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--cth-ink-100)' };
const badge: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, lineHeight: '20px', padding: '0 6px', flexShrink: 0 };
const okBadge: CSSProperties = { background: 'var(--cth-mint-light)', color: 'var(--cth-ink-900)' };
const needsBadge: CSSProperties = { background: 'var(--cth-coral-light)', color: 'var(--cth-ink-900)' };
