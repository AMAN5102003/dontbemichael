import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import type { AgentProvider } from '@shared/agentProvider';
import { ENGINE_INSTALL_PTY, ENGINE_SIGNIN_PTY, engineSetupPhase, engineSetupPhaseOpensOffice, type EngineSetupStatus } from '@shared/engineSetup';
import { useRtl } from '@/i18n/useDirection';
import { Icon, type IconName } from './Icon';
import { InfoTip } from './InfoTip';
import { PixelButton } from './PixelButton';
import { PtyTerminalView } from './PtyTerminalView';

/** How often the step looks again while the owner signs in in the browser. */
const SIGNIN_POLL_MS = 2000;

/**
 * Get Michael ready (docs/designs/get-michael-ready.md): Claude Code on this
 * computer, and the owner's Claude account, as two rows. A missing Claude
 * installs on its own with Claude's standalone installer; sign in opens the
 * browser and the step notices when it is done. The terminals stay behind
 * Show details. Used as setup's last step and in the Ask me card's dialog.
 */
export function GetMichaelReady({ provider, onReadyChange, fix }: {
  provider?: AgentProvider;
  onReadyChange?: (ready: boolean) => void;
  /** Opened from a stop card (office-stopped-account.md): `key` starts on the
   *  key form, `signin` offers a fresh sign in even when Claude still reads
   *  as signed in. */
  fix?: 'signin' | 'key';
}) {
  const { t } = useTranslation();
  const godName = useResolvedGodName();
  const [status, setStatus] = useState<EngineSetupStatus | undefined>();
  const [installing, setInstalling] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);
  const [browser, setBrowser] = useState(false);
  const [signInStuck, setSignInStuck] = useState(false);
  const [details, setDetails] = useState(false);
  const reads = useRef(0);
  const inFlight = useRef(false);
  const autoInstalled = useRef(false);
  // Use an API key instead of a Claude account: the key never comes back.
  const [keyForm, setKeyForm] = useState(fix === 'key');
  // A stop card's sign in finished in the browser (fix 'signin').
  const [signedInAgain, setSignedInAgain] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | undefined>();

  const read = useCallback(async (): Promise<EngineSetupStatus | undefined> => {
    const mine = ++reads.current;
    try {
      const s = await window.cth.engineSetupStatus(provider);
      if (mine === reads.current) setStatus(s);
      return s;
    } catch {
      return undefined;
    }
  }, [provider]);

  const install = useCallback(async () => {
    setInstallFailed(false);
    setInstalling(true);
    const res = await window.cth.engineSetupInstall().catch(() => ({ ok: false }));
    if (!res.ok) { setInstalling(false); setInstallFailed(true); }
  }, []);

  const signIn = useCallback(async () => {
    setSignInStuck(false);
    const res = await window.cth.engineSetupSignIn().catch(() => ({ ok: false }));
    setBrowser(res.ok);
    if (!res.ok) setSignInStuck(true);
  }, []);

  const saveKey = useCallback(async () => {
    if (!keyDraft.trim() || keyBusy) return;
    setKeyBusy(true);
    setKeyError(undefined);
    const res = await window.cth.engineSetupUseApiKey(keyDraft).catch(() => ({ ok: false as const, error: 'unreachable' as const }));
    setKeyBusy(false);
    if (!res.ok) {
      // A refusal shows Anthropic's own reason (a workspace key has its own message).
      // A key the computer cannot store shows what to do about it (keychain or keyring).
      setKeyError(res.error === 'refused' && 'reason' in res && res.reason
        ? t('engineSetup.keyError.refused', { reason: res.reason })
        : res.error === 'store' && 'reason' in res && res.reason
          ? res.reason
          : t(`engineSetup.keyError.${res.error ?? 'unreachable'}`));
      return;
    }
    setKeyDraft('');
    setKeyForm(false);
    setBrowser(false);
    setSignInStuck(false);
    void read();
  }, [keyDraft, keyBusy, read, t]);

  // First look, then install at once when Claude is missing: the owner already
  // pressed Next to get here, so there is nothing to ask.
  useEffect(() => {
    void read().then((s) => {
      if (s && s.applies && !s.installed && !autoInstalled.current) {
        autoInstalled.current = true;
        void install();
      }
    });
  }, [read, install]);

  // A setup terminal ended: read again. An install that ended without Claude
  // found failed; a sign in that ended still signed out did not finish.
  useEffect(() => window.cth.onEngineSetupChanged((e) => {
    void read().then((s) => {
      if (!s) return;
      if (e.id === ENGINE_INSTALL_PTY) {
        setInstalling(false);
        setInstallFailed(!s.installed);
      }
      // The sign in ended: stop waiting on the browser whatever it says, and
      // say it did not finish only when Claude still reads signed out.
      if (e.id === ENGINE_SIGNIN_PTY) {
        setBrowser(false);
        setSignInStuck(s.signedIn === false);
        if (s.signedIn !== false) setSignedInAgain(true);
      }
    });
  }), [read]);

  // While the owner signs in in the browser, look every 2 s, one look at a
  // time: each starts `claude auth status`, which can be slow to answer.
  useEffect(() => {
    if (!browser) return;
    const iv = setInterval(() => {
      if (inFlight.current) return;
      inFlight.current = true;
      void read().finally(() => { inFlight.current = false; });
    }, SIGNIN_POLL_MS);
    return () => clearInterval(iv);
  }, [browser, read]);

  const phase = engineSetupPhase(status, { installing, installFailed, browser });
  // From a stop card, ready means the fix is done too: a new key saved, or a
  // fresh sign in finished.
  const fixPending = (fix === 'key' && keyForm) || (fix === 'signin' && status?.method !== 'apiKey' && !signedInAgain);
  const ready = engineSetupPhaseOpensOffice(phase) && !fixPending;
  useEffect(() => { onReadyChange?.(ready); }, [ready, onReadyChange]);
  // A finished step has nothing to show behind Show details.
  useEffect(() => { if (ready) setDetails(false); }, [ready]);

  const detailsPty = phase === 'installing' || phase === 'installFailed' ? ENGINE_INSTALL_PTY
    : phase === 'browser' ? ENGINE_SIGNIN_PTY : null;
  const detailsToggle = detailsPty && (
    <button type="button" onClick={() => setDetails((d) => !d)} style={linkBtn}>
      {details ? t('engineSetup.hideDetails') : (phase === 'browser' ? t('engineSetup.showClaude') : t('engineSetup.showDetails'))}
    </button>
  );
  const terminal = details && detailsPty && (
    <div style={{ marginTop: 10, height: 168, borderRadius: 'var(--cth-r-md)', overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--cth-line)' }}>
      <PtyTerminalView key={detailsPty} ptyId={detailsPty} embedded />
    </div>
  );

  const claudeRow = (() => {
    switch (phase) {
      case 'checking': return <Row glyph={<Spinner />} tone="wait" label={t('engineSetup.claude')} status={t('engineSetup.checking')} />;
      case 'installing': return (
        <Row glyph={<Spinner />} tone="wait" label={t('engineSetup.claude')} status={t('engineSetup.installing')}>
          <div className="cth-engine-bar" aria-hidden><i /></div>
          <div style={actions}>{detailsToggle}</div>
          {terminal}
        </Row>
      );
      case 'installFailed': return (
        <Row icon="x" tone="bad" label={t('engineSetup.claude')} status={t('engineSetup.installFailed')} bad>
          <div style={actions}>
            <PixelButton variant="primary" size="sm" onClick={() => { setDetails(false); void install(); }}>{t('engineSetup.tryAgain')}</PixelButton>
            {detailsToggle}
          </div>
          {terminal}
        </Row>
      );
      default: return <Row icon="check" tone="ok" label={t('engineSetup.claude')} status={t('engineSetup.installed')} />;
    }
  })();

  // The API key form, from Sign in or from a sign in that could not be read.
  const keyFormRow = (
    <Row icon="arrow-right" tone="idle" label={t('engineSetup.apiKey')} info={<InfoTip text={t('engineSetup.keyInfo')} label={t('engineSetup.apiKey')} />}>
      <form onSubmit={(e) => { e.preventDefault(); void saveKey(); }} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="cth-engine-key" style={visuallyHidden}>{t('engineSetup.apiKey')}</label>
        <input id="cth-engine-key" className="cth-input" type="password" autoComplete="off" spellCheck={false} dir="ltr"
          value={keyDraft} onChange={(e) => { setKeyDraft(e.target.value); setKeyError(undefined); }}
          placeholder="sk-ant-…" aria-invalid={!!keyError} aria-describedby={keyError ? 'cth-engine-key-error' : undefined}
          style={keyInput} />
        {keyError && <div id="cth-engine-key-error" role="alert" style={{ fontSize: 12, lineHeight: '18px', color: 'var(--cth-coral-text)', overflowWrap: 'anywhere' }}>{keyError}</div>}
        <div style={{ ...actions, marginTop: 4 }}>
          <PixelButton variant="primary" size="sm" disabled={keyBusy || !keyDraft.trim()} onClick={() => void saveKey()}>
            {keyBusy ? t('engineSetup.keyChecking') : t('engineSetup.keySave')}
          </PixelButton>
          <PixelButton variant="ghost" size="sm" disabled={keyBusy} onClick={() => { setKeyForm(false); setKeyDraft(''); setKeyError(undefined); }}>{t('common.cancel')}</PixelButton>
        </div>
      </form>
    </Row>
  );

  const accountRow = (() => {
    switch (phase) {
      case 'checking':
      case 'installing':
      case 'installFailed':
        return <Row icon="clock" tone="idle" label={t('engineSetup.account')} status={t('engineSetup.waitingInstall')} dim />;
      case 'signin': return keyForm ? keyFormRow : (
        <Row icon="arrow-right" tone="idle" label={t('engineSetup.account')} status={signInStuck ? t('engineSetup.signInStuck') : t('engineSetup.signInWhy', { godName })} bad={signInStuck}>
          <div style={actions}>
            <PixelButton variant="primary" size="sm" onClick={() => void signIn()}>{t('engineSetup.signIn')}</PixelButton>
            <PixelButton variant="secondary" size="sm" onClick={() => setKeyForm(true)}>{t('engineSetup.useApiKey')}</PixelButton>
          </div>
        </Row>
      );
      case 'browser': return (
        <Row glyph={<Spinner />} tone="wait" label={t('engineSetup.account')} status={t('engineSetup.inBrowser')}>
          <div style={actions}>
            <PixelButton variant="secondary" size="sm" onClick={() => void signIn()}>{t('engineSetup.openBrowserAgain')}</PixelButton>
            {detailsToggle}
          </div>
          {terminal}
        </Row>
      );
      // Sign in could not be read: Michael may still start, but no green check.
      case 'unknown': return keyForm ? keyFormRow : (
        <Row icon="help" tone="idle" label={t('engineSetup.account')} status={t('engineSetup.signInUnknown')}>
          <div style={actions}>
            <PixelButton variant="secondary" size="sm" onClick={() => void signIn()}>{t('engineSetup.signIn')}</PixelButton>
            <PixelButton variant="secondary" size="sm" onClick={() => setKeyForm(true)}>{t('engineSetup.useApiKey')}</PixelButton>
          </div>
        </Row>
      );
      // A stop card's fix: the key form, or a fresh sign in, over the ready row.
      default: if (keyForm) return keyFormRow;
        if (fix === 'signin' && status?.method !== 'apiKey' && !signedInAgain) return (
          <Row icon="arrow-right" tone="idle" label={t('engineSetup.account')} status={signInStuck ? t('engineSetup.signInStuck') : t('engineSetup.signInWhy', { godName })} bad={signInStuck}>
            <div style={actions}>
              <PixelButton variant="primary" size="sm" onClick={() => void signIn()}>{t('engineSetup.signIn')}</PixelButton>
            </div>
          </Row>
        );
        return status?.method === 'apiKey' ? (
        <Row icon="check" tone="ok" label={t('engineSetup.apiKey')} status={t('engineSetup.usingApiKey')} />
      ) : (
        <Row icon="check" tone="ok" label={t('engineSetup.account')}
          status={status?.email ? t('engineSetup.signedInAs', { email: status.email }) : t('engineSetup.signedIn')} />
      );
    }
  })();

  return (
    <div role="group" aria-label={t('engineSetup.title', { godName })} aria-busy={phase === 'checking' || phase === 'installing'}
      style={{ display: 'flex', flexDirection: 'column', borderRadius: 'var(--cth-r-lg)', boxShadow: 'inset 0 0 0 1px var(--cth-line)' }}>
      {claudeRow}
      <div style={{ borderTop: '1px solid var(--cth-line)' }} />
      {accountRow}
    </div>
  );
}

/** The step's heading line: the title with its explanation behind an info icon. */
export function GetMichaelReadyInfo() {
  const { t } = useTranslation();
  const godName = useResolvedGodName();
  return <InfoTip text={t('engineSetup.info', { godName })} label={t('engineSetup.title', { godName })} />;
}

const TONES = {
  ok: { background: 'var(--cth-green-soft)', color: 'var(--cth-green-text)' },
  bad: { background: 'var(--cth-coral-soft)', color: 'var(--cth-coral-text)' },
  wait: { background: 'var(--cth-indigo-soft)', color: 'var(--cth-indigo-text)' },
  idle: { background: 'var(--cth-neutral-soft)', color: 'var(--cth-ink-2)' }
} as const;

/** One row: an outline icon from the set, or a custom glyph (the spinner). */
function Row({ icon, glyph, tone, label, status, info, bad, dim, children }: {
  icon?: IconName; glyph?: ReactNode; tone: keyof typeof TONES; label: string; status?: string; info?: ReactNode; bad?: boolean; dim?: boolean; children?: ReactNode;
}) {
  const rtl = useRtl();
  const shown = icon
    ? <Icon name={icon} size={0.875} style={icon === 'arrow-right' && rtl ? { transform: 'scaleX(-1)' } : undefined} />
    : glyph;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14 }}>
      {/* A waiting row dims its icon only, so its text keeps full contrast. */}
      <span aria-hidden style={{ width: 26, height: 26, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 'var(--cth-r-md)', opacity: dim ? 0.55 : 1, ...TONES[tone] }}>{shown}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: dim ? 'var(--cth-ink-3)' : 'var(--cth-ink)' }}>{label}{info}</div>
        {status && <div role={bad ? 'alert' : undefined} style={{ fontSize: 12, lineHeight: '18px', marginTop: 2, color: bad ? 'var(--cth-coral-text)' : 'var(--cth-ink-3)' }}>{status}</div>}
        {children}
      </div>
    </div>
  );
}

const visuallyHidden: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0
};

export function Spinner() {
  return <span className="cth-engine-spin" />;
}

const keyInput: React.CSSProperties = {
  width: '100%', height: 32, padding: '0 10px', borderRadius: 'var(--cth-r-md)', boxSizing: 'border-box',
  fontFamily: 'var(--cth-font-mono)', fontSize: 12.5, color: 'var(--cth-ink)', background: 'var(--cth-card)'
};
const actions: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' };
const linkBtn: React.CSSProperties = {
  minHeight: 28, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-2)', textDecoration: 'underline'
};
