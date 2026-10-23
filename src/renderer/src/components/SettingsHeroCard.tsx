/**
 * The About card at the top of Settings → General: what this install is and
 * whether it is current, in one v2 card (docs/designs/about-updates-card.md,
 * owner 2026-10-01). It merged the old hero card and the Updates block, which
 * said the version twice and offered release notes three ways.
 *
 * Top row: the name, the version once, the plan pill (its blurb behind an info
 * icon), then the update buttons. Under it the update status, the manual
 * install steps and release notes when there are any, then hero.json's notice
 * and sponsor when set. A quiet footer carries the app level links.
 *
 * The plan, notice and sponsor come from docs/hero.json IN THIS REPO, fetched
 * at runtime and cached, so copy can change without shipping a build. That
 * payload is DATA, never markup: every field below is a React text node, and
 * shared/heroPayload.ts validates types, caps lengths and requires https. It
 * renders from built in defaults first and fills in when the fetch lands.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { InfoTip } from './InfoTip';
import { BetaPill } from './BetaPill';
import { useWhatsNew, WhatsNewPopover } from './WhatsNewPopover';
import { useUpdates, UpdateButtons, UpdateDetails, UpdateStatusLine } from './UpdatesSection';
import { DEFAULT_HERO, type HeroPayload } from '@shared/heroPayload';
import { REPO_URL } from '@shared/updateState';
import { reportProblemUrl } from '@shared/reportProblem';
import { groupName, hint, panelStyle } from './fieldText';

declare const __APP_VERSION__: string;

// This app's repo. The upstream project's Pro announcement, Founders' Wall
// offer and Discord were removed with it (owner, 2026-09-24).
const GITHUB_REPO_URL = REPO_URL;

export function SettingsHeroCard() {
  const { t } = useTranslation();
  const u = useUpdates();
  // Starts on the compiled in defaults, so there is no empty frame or spinner
  // while the fetch is in flight; it just fills in if anything changed.
  const [hero, setHero] = useState<HeroPayload>(DEFAULT_HERO);
  useEffect(() => {
    let alive = true;
    window.cth.heroPayload()
      .then((r) => { if (alive) setHero(r.hero); })
      .catch(() => { /* defaults already rendered */ });
    return () => { alive = false; };
  }, []);

  // What's new opens a popover right under its link (owner, 2026-10-02).
  const whatsNew = useWhatsNew();
  const [notesOpen, setNotesOpen] = useState(false);
  const whatsNewRef = useRef<HTMLButtonElement | null>(null);
  const toggleNotes = () => { if (!notesOpen) whatsNew.load(); setNotesOpen((v) => !v); };
  const open = (url: string) => () => { void window.cth.openExternal(url); };

  return (
    // It sits in Settings' scrolling flex column: never shrink. With overflow
    // hidden a flex item may shrink below its content, and the column crushed
    // the whole card to 1px (owner, 2026-10-01). Nothing here needs clipping.
    // On the shared soft panel like every Settings group (app-style-rollout.md AS2).
    <div style={{ flexShrink: 0, background: panelStyle.background, borderRadius: panelStyle.borderRadius }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={groupName}>
                Don&apos;t Be Michael
              </h3>
              <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--cth-ink-2)' }}>v{__APP_VERSION__}</span>
              <BetaPill info={t('settingsHero.betaInfo')} />
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 'var(--cth-r-pill)', padding: '1px 8px',
                fontSize: 10, lineHeight: '14px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
                background: 'var(--cth-mint-light)', color: 'var(--cth-ink)'
              }}>{hero.plan.label}</span>
              <InfoTip label={hero.plan.label} text={hero.plan.blurb} />
            </div>
            <div style={{ marginTop: 3 }}><UpdateStatusLine u={u} /></div>
          </div>
          <UpdateButtons u={u} />
        </div>

        <UpdateDetails u={u} />

        {/* A one line notice (an incident, a migration heads up), when set. */}
        {hero.notice && (
          <div style={{ padding: '8px 10px', fontSize: 12, lineHeight: 1.5, color: 'var(--cth-ink)', background: 'var(--cth-lemon-light)', borderRadius: 'var(--cth-r-lg)' }}>
            {hero.notice}
          </div>
        )}

        {/* Sponsor, only when there is one. */}
        {hero.sponsor && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px',
            background: 'var(--cth-card)', borderRadius: 'var(--cth-r-lg)'
          }}>
            <span style={{ ...hint, flexShrink: 0 }}>
              {t('settingsHero.sponsoredBy')}
            </span>
            <span style={{ fontSize: 13, color: 'var(--cth-ink)', flexShrink: 0 }}>{hero.sponsor.name}</span>
            <span style={{ flex: 1, minWidth: 120, fontSize: 12, color: 'var(--cth-ink-2)' }}>{hero.sponsor.blurb}</span>
            <PixelButton variant="ghost" size="sm" onClick={open(hero.sponsor.url)}>{t('settingsHero.visit')}</PixelButton>
          </div>
        )}
      </div>

      {/* App level links, quiet (DESIGN.md 7.7). What's new opens the notes in
          the app, with the full changelog one link inside (owner, 2026-10-02). */}
      <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 18, padding: '9px 16px', borderTop: '1px solid var(--cth-line)' }}>
        <button type="button" ref={whatsNewRef} style={footLink} onClick={toggleNotes} aria-expanded={notesOpen} aria-haspopup="dialog">{t('settingsHero.whatsNew')}</button>
        <button type="button" style={footLink} onClick={open(GITHUB_REPO_URL)}>{t('settingsHero.starOnGitHub')}</button>
        <button type="button" style={footLink} onClick={open(reportProblemUrl({ appVersion: __APP_VERSION__, platform: window.cth.platform, arch: window.cth.arch, osVersion: window.cth.osVersion }))}>{t('settingsHero.reportProblem')}</button>
        {notesOpen && <WhatsNewPopover notes={whatsNew.notes} loading={whatsNew.loading} anchor={whatsNewRef} onClose={() => setNotesOpen(false)} />}
      </div>
    </div>
  );
}

const footLink: CSSProperties = {
  padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '18px', fontWeight: 600, color: 'var(--cth-ink-2)'
};
