import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { Disclosure, Toggle } from './triggers/ui';
import { useRtl } from '@/i18n/useDirection';
import { Field, Panel, hint } from './fieldText';
import {
  IMAPS_PORT, PROVIDER_ORDER, PROVIDER_PRESETS, SMTPS_PORT, SUBMISSION_PORT, guessServers,
  type MailProvider, type MailServer, type MailboxRecord
} from '@shared/mailboxes';

/**
 * Add a mailbox, or fix one that needs you (docs/designs/multi-mailbox.md,
 * design review D-T2). The owner picks a service, types the address and an app
 * password; listed services fill in their own servers. "Other" asks for the two
 * server names and hides ports behind More settings (design 10A). Nothing is
 * saved until main has tested the login (design 3A).
 *
 * Accessibility (design 7A): focus starts on the first field and stays in the
 * dialog, Escape closes, the password has a Show/Hide button, and the testing
 * and failure lines are announced politely.
 */
export function AddMailboxDialog({ fix, onClose, onSaved }: {
  /** The mailbox being fixed; absent when adding. */
  fix?: MailboxRecord;
  onClose: () => void;
  onSaved: (rec: MailboxRecord) => void;
}) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<MailProvider>(fix?.provider ?? 'gmail');
  const [address, setAddress] = useState(fix?.address ?? '');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const guessed = guessServers(address);
  const [imapHost, setImapHost] = useState(fix?.provider === 'other' ? fix.imap.host : '');
  const [smtpHost, setSmtpHost] = useState(fix?.provider === 'other' ? fix.smtp.host : '');
  const [imapPort, setImapPort] = useState(String(fix?.imap.port ?? IMAPS_PORT));
  const [smtpPort, setSmtpPort] = useState(String(fix?.smtp.port ?? SMTPS_PORT));
  const [tls, setTls] = useState(fix?.imap.secure ?? true);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  // Adding starts on the service choice; fixing starts on the new password.
  useEffect(() => { (fix ? passRef.current : firstRef.current)?.focus(); }, [fix]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Escape waits for a running login test, like the backdrop and Cancel.
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.stopPropagation(); if (!busy) onClose(); return; }
    if (e.key !== 'Tab' || !boxRef.current) return;
    const items = [...boxRef.current.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), input:not([disabled])')];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const save = async (): Promise<void> => {
    setBusy(true); setError(null);
    const server = (host: string, port: string, fallback: MailServer): MailServer =>
      ({ host: host.trim() || fallback.host, port: Number(port) || fallback.port, secure: tls });
    const res = await window.cth.mailSave({
      id: fix?.id, provider, address: address.trim(), password,
      ...(provider === 'other' ? { imap: server(imapHost, imapPort, guessed.imap), smtp: server(smtpHost, smtpPort, { ...guessed.smtp, port: tls ? SMTPS_PORT : SUBMISSION_PORT }) } : {})
    }).catch((e: unknown) => ({ ok: false as const, kind: 'unknown', reason: e instanceof Error ? e.message : String(e) }));
    setBusy(false);
    if (res.ok) onSaved(res.record);
    else setError(res.reason);
  };

  const label = (p: MailProvider): string => (p === 'other' ? t('mailboxes.other') : PROVIDER_PRESETS[p].label);

  // Arrow keys move and choose within the service tiles (DESIGN.md 7.10a);
  // left and right follow reading direction.
  const rtl = useRtl();
  const onProviderKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    const step = e.key === fwd || e.key === 'ArrowDown' ? 1 : e.key === back || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = PROVIDER_ORDER.indexOf(provider);
    const next = PROVIDER_ORDER[(at + step + PROVIDER_ORDER.length) % PROVIDER_ORDER.length];
    setProvider(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-provider="${next}"]`)?.focus();
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--cth-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-mailbox-title"
        onKeyDown={onKeyDown}
        style={{ width: 460, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--cth-card)', borderRadius: 'var(--cth-r-2xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)', padding: '18px 22px', fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink)' }}
      >
        <div id="add-mailbox-title" style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: '22px', marginBottom: 8 }}>
          {fix ? t('mailboxes.dialogFixTitle', { address: fix.address }) : t('mailboxes.dialogTitle')}
        </div>

        {!fix && (
          <>
            <div style={hint}>{t('mailboxes.which')}</div>
            <div role="radiogroup" aria-label={t('mailboxes.which')} onKeyDown={onProviderKey} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
              {PROVIDER_ORDER.map((p) => (
                <button
                  key={p}
                  ref={provider === p ? firstRef : undefined}
                  type="button"
                  role="radio"
                  data-provider={p}
                  aria-checked={provider === p}
                  tabIndex={provider === p ? 0 : -1}
                  onClick={() => setProvider(p)}
                  style={{
                    border: 'none', cursor: 'pointer', padding: '9px 6px', fontSize: 12.5, lineHeight: '18px', borderRadius: 'var(--cth-r-lg)',
                    fontFamily: 'var(--cth-font-ui)', fontWeight: provider === p ? 600 : 500, color: 'var(--cth-ink)',
                    background: provider === p ? 'var(--cth-indigo-soft)' : 'var(--cth-card)',
                    boxShadow: `inset 0 0 0 ${provider === p ? 1.5 : 1}px ${provider === p ? 'var(--cth-indigo)' : 'var(--cth-line-2)'}`
                  }}
                >{label(p)}</button>
              ))}
            </div>
          </>
        )}

        {/* The login on one soft panel (app-style-rollout.md AS2). */}
        <Panel style={{ marginTop: 12 }}>
        <Field label={t('mailboxes.address')}>
          <input type="email" value={address} disabled={!!fix || busy} onChange={(e) => setAddress(e.target.value)} className="cth-input" style={input} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label={t('mailboxes.password')}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={passRef}
              type={showPass ? 'text' : 'password'} value={password} disabled={busy}
              onChange={(e) => setPassword(e.target.value)} className="cth-input" style={{ ...input, flex: 1 }} autoComplete="off" spellCheck={false}
            />
            <PixelButton variant="secondary" size="md" onClick={() => setShowPass((v) => !v)}>{showPass ? t('mailboxes.hide') : t('mailboxes.show')}</PixelButton>
          </div>
        </Field>

        {provider === 'other' && (
          <>
            <Field label={t('mailboxes.incoming')}>
              <input value={imapHost} placeholder={guessed.imap.host} disabled={busy} onChange={(e) => setImapHost(e.target.value)} className="cth-input" style={input} spellCheck={false} />
            </Field>
            <Field label={t('mailboxes.outgoing')}>
              <input value={smtpHost} placeholder={guessed.smtp.host} disabled={busy} onChange={(e) => setSmtpHost(e.target.value)} className="cth-input" style={input} spellCheck={false} />
            </Field>
            <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} style={{ ...linkButton, marginTop: 0, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Disclosure open={more} />{t('mailboxes.moreSettings')}</button>
            {more && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Field label={t('mailboxes.incomingPort')}><input inputMode="numeric" value={imapPort} onChange={(e) => setImapPort(e.target.value.replace(/\D/g, ''))} className="cth-input" style={{ ...input, width: 100 }} /></Field>
                <Field label={t('mailboxes.outgoingPort')}><input inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value.replace(/\D/g, ''))} className="cth-input" style={{ ...input, width: 100 }} /></Field>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-end', paddingBottom: 6, fontSize: 13 }}>
                  <span>{t('mailboxes.tls')}</span>
                  <Toggle on={tls} label={t('mailboxes.tls')} onClick={() => setTls((v) => !v)} />
                </div>
              </div>
            )}
          </>
        )}
        </Panel>

        <div style={{ background: 'var(--cth-blue-soft)', borderRadius: 'var(--cth-r-md)', padding: '9px 12px', fontSize: 12.5, lineHeight: '18px', marginTop: 14, color: 'var(--cth-ink)' }}>
          {t(`mailboxes.help.${provider}`)}
        </div>

        <div aria-live="polite" style={{ minHeight: 0 }}>
          {busy && <div style={{ ...hint, marginTop: 10 }}>{t('mailboxes.testing', { address: address.trim() })}</div>}
          {error && !busy && (
            <div role="alert" style={{ background: 'var(--cth-coral-soft)', color: 'var(--cth-coral-text)', borderRadius: 'var(--cth-r-md)', padding: '8px 12px', fontSize: 12.5, lineHeight: '18px', marginTop: 10 }}>{error}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <PixelButton variant="secondary" onClick={onClose} disabled={busy}>{t('mailboxes.cancel')}</PixelButton>
          <PixelButton variant="primary" onClick={() => { void save(); }} disabled={busy || !address.trim() || !password.trim()}>
            {error ? t('mailboxes.tryAgain') : t('mailboxes.save')}
          </PixelButton>
        </div>
      </div>
    </div>
  );
}

const input: CSSProperties = {
  height: 34, border: 'none', background: 'var(--cth-card)', outline: 'none',
  padding: '0 10px', fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink)', minWidth: 0
};
const linkButton: CSSProperties = {
  border: 'none', background: 'transparent', padding: 0, marginTop: 10, cursor: 'pointer', textDecoration: 'underline',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, color: 'var(--cth-indigo-text)'
};
