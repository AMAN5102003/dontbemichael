import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { Toggle, MiniButton, Disclosure } from './triggers/ui';
import { InfoTip } from './InfoTip';
import { useHarnessConfig } from '@/hooks/useHarnessConfig';
import { connectorOn, removedKeys, unseenKeys, type ClaudeConnector } from '@shared/claudeConnectors';

/** Where the owner adds and signs in to connectors on their Claude account. */
const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors';

/**
 * Settings > Connections > Claude connectors (docs/designs/claude-connectors.md,
 * design review 2026-10-02). Every connector on the owner's Claude account, read
 * with `claude mcp list`: one line each with its status in words and the
 * owner's switch. A connector that is off is blocked for every agent; one that
 * is on can be given to team members on their Access tab.
 *
 * It folds like Mailboxes (design D3): one header line with the count, an info
 * icon and Refresh. It starts closed and opens by itself when a connector is
 * new since the owner last looked, or the last read failed. Opening Settings
 * reads the account again in the background (D11).
 *
 * QuickBooks and Gmail are rows like the rest (E4); QuickBooks' switch is its
 * old one. A connector that needs sign in can be switched on but does nothing
 * until it is connected at claude.ai (E3). One that left the account shows
 * Removed until the owner clears it; its grants do nothing meanwhile.
 */
export function ClaudeConnectorsSettings() {
  const { t } = useTranslation();
  const config = useHarnessConfig();
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const listId = useId();

  // Opening Settings reads the account again, in the background.
  useEffect(() => {
    let alive = true;
    void window.cth.connectorsReading().then((r) => { if (alive) setReading(r); }).catch(() => {});
    const off = window.cth.onConnectorsReading((r) => setReading(r));
    void window.cth.connectorsRefresh('settings').catch(() => {});
    return () => { alive = false; off(); };
  }, []);

  // Open by itself once: for a connector the owner has not seen, or a failed read.
  const decided = useRef(false);
  const state = config?.claudeConnectors;
  useEffect(() => {
    if (decided.current || !config || reading) return;
    if (!state) return;
    decided.current = true;
    if (state.failedAt || unseenKeys(state.list, config.connectorsSeen).length) setOpen(true);
  }, [config, state, reading]);
  // What the owner has looked at is no longer new. Keyed on the names, not the
  // list object: every saved setting arrives as a fresh copy, and this save
  // must not answer its own echo.
  const listKeys = state?.list ? state.list.map((c) => c.key).join('\n') : null;
  useEffect(() => {
    if (open && listKeys !== null) void window.cth.connectorsSeen().catch(() => {});
  }, [open, listKeys]);

  if (!config) return null;
  const list: ClaudeConnector[] = [...(state?.list ?? [])].sort((a, b) => a.key.localeCompare(b.key));
  const removed = removedKeys(config);
  const onCount = list.filter((c) => connectorOn(config, c.key)).length;

  const run = async (p: Promise<{ ok: boolean }>): Promise<void> => {
    setFailed(false);
    try { if (!(await p).ok) setFailed(true); } catch { setFailed(true); }
  };
  const summary = !state && reading
    ? t('connectors.reading')
    : list.length === 0 ? t('connectors.summaryNone')
      : list.length === 1 ? t('connectors.summaryOne', { on: onCount }) : t('connectors.summaryCount', { count: list.length, on: onCount });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)} style={foldButton}>
          <Disclosure open={open} />
          <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, fontWeight: 600, lineHeight: '12px', color: 'var(--cth-ink-500)', textTransform: 'uppercase' }}>
            {t('connectors.title')}
          </span>
          <span style={hint}>{summary}</span>
          {removed.length > 0 && <span style={{ ...badge, ...needsBadge }}><Dot color="var(--cth-coral)" />{t('connectors.removedCount', { count: removed.length })}</span>}
        </button>
        <InfoTip label={t('connectors.title')} text={t('connectors.intro')} />
        <span style={{ flex: 1 }} />
        <PixelButton variant="ghost" size="sm" disabled={reading} onClick={() => { void window.cth.connectorsRefresh('refresh').catch(() => {}); }}>
          {reading ? t('connectors.refreshing') : t('connectors.refresh')}
        </PixelButton>
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
            {state?.failedAt && (
              <div role="status" style={{ ...row, color: 'var(--cth-ink-900)' }}>
                <span style={{ flex: 1, fontSize: 13 }}>
                  ! {state.readAt ? t('connectors.readFailedSince', { when: new Date(state.readAt).toLocaleString() }) : t('connectors.readFailed')}
                </span>
                <MiniButton disabled={reading} onClick={() => { void window.cth.connectorsRefresh('retry').catch(() => {}); }}>{t('connectors.tryAgain')}</MiniButton>
              </div>
            )}
            {state?.list && list.length === 0 && removed.length === 0 && (
              <div style={{ ...row, ...hint }}>
                <span style={{ flex: 1 }}>{t('connectors.empty')}</span>
                <button type="button" style={link} onClick={() => { void window.cth.openExternal(CLAUDE_CONNECTORS_URL); }}>{t('connectors.addAtClaude')}</button>
              </div>
            )}
            {!state?.list && !state?.failedAt && <div style={{ ...row, ...hint }}>{t('connectors.reading')}</div>}
            {(removed.length > 0 || list.length > 0) && (
              <div role="list">
                {/* Removed ones need the owner, so they come first (design D3). */}
                {removed.map((key) => (
                  <div key={`removed-${key}`} role="listitem" style={row}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{key}</span>
                    <span style={{ ...badge, ...needsBadge }}><Dot color="var(--cth-coral)" />{t('connectors.removed')}</span>
                    <MiniButton onClick={() => { void run(window.cth.connectorsClear(key)); }}>{t('connectors.clear')}</MiniButton>
                  </div>
                ))}
                {list.map((c) => {
                  const on = connectorOn(config, c.key);
                  const signIn = c.status === 'needs-sign-in';
                  const unreachable = c.status === 'unreachable';
                  return (
                    <div key={c.key} role="listitem" style={row}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: signIn || unreachable ? 'var(--cth-ink-500)' : undefined }}>{c.key}</span>
                      {signIn ? (
                        <button type="button" style={link} onClick={() => { void window.cth.openExternal(CLAUDE_CONNECTORS_URL); }}>{t('connectors.signIn')}</button>
                      ) : unreachable ? (
                        <span style={hint}>{t('connectors.unreachable')}</span>
                      ) : (
                        <span style={hint}>{t('connectors.connected')}</span>
                      )}
                      <Toggle on={on} label={t('connectors.allow', { name: c.key })} onClick={() => { void run(window.cth.connectorsSetOn(c.key, !on)); }} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ width: 8, height: 8, background: color, display: 'inline-block' }} />;
}

const hint: CSSProperties = { fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-500)' };
const foldButton: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', border: 'none', background: 'transparent',
  cursor: 'pointer', textAlign: 'start', fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink-900)'
};
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--cth-ink-100)' };
const badge: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, lineHeight: '20px', padding: '0 6px', flexShrink: 0 };
const needsBadge: CSSProperties = { background: 'var(--cth-coral-light)', color: 'var(--cth-ink-900)' };
const link: CSSProperties = {
  padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--cth-font-ui)',
  fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-900)', textDecoration: 'underline', textUnderlineOffset: 2
};
