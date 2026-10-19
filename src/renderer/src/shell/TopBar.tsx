import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { SHOW_FOCUS_MODE } from '@shared/buildFeatures';
import { useTranslation } from 'react-i18next';
import { useStore, type FloorView, ACTION_CLOCKING_IN } from '@/store/store';
import { stillOut } from './clockingIn';
import { Icon } from '@/components/Icon';
import { useAppTheme, toggleAppTheme } from '@/design/theme';
import { notifyThemeChangeAll } from '@/components/terminalPool';
import { UpdateBadge } from '@/components/UpdateBadge';
import { BetaPill } from '@/components/BetaPill';
import { CliUpdateBadge } from '@/components/CliUpdateNotice';
import { OfficeBreakChip } from '@/components/OfficeBreakNotice';
import { pillState, useNeedsYou, useNeedsYouCount } from './useNeedsYou';
import { NEEDS_YOU_PILL_ID } from './rightColumn';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import lockupLight from '@brandkit/logo/lockup/dbm-lockup-horizontal-light.svg?url';
import lockupDark from '@brandkit/logo/lockup/dbm-lockup-horizontal-dark.svg?url';

/**
 * The v2 top bar (branding/DESIGN.md 7.1): lockup, view tabs, then the clock,
 * version, theme, focus mode, Settings and the Needs you button. It is also the
 * window's drag region; every control opts out with cth-titlebar-nodrag.
 */
export function TopBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const fullscreenAgentId = useStore((s) => s.fullscreenAgentId);

  const toggleTheme = () => {
    const next = toggleAppTheme();
    // Running programs are told the theme flipped (DEC mode 2031), and agents
    // started from now on get the matching Claude theme. Scoped to this app's
    // agents; the owner's global Claude theme is never touched.
    notifyThemeChangeAll(next === 'dark' ? 'dark' : 'light');
    void window.cth.updateConfig({ terminalTheme: next });
  };

  const toggleFocus = () => {
    if (fullscreenAgentId) { useStore.getState().setFullscreen(null); return; }
    const all = useStore.getState().agents;
    const target = all.find((x) => x.id === useStore.getState().selectedId && x.ptyId)
      ?? all.find((x) => x.isGod && x.ptyId)
      ?? all.find((x) => x.ptyId);
    if (target) useStore.getState().setFullscreen(target.id);
  };

  return (
    <div
      className="cth-titlebar-drag"
      style={{
        height: 56, minHeight: 56,
        display: 'flex', alignItems: 'center', gap: 10,
        // The macOS traffic lights sit in the top left of a hiddenInset window.
        paddingInlineStart: 88, paddingInlineEnd: 16,
        background: 'color-mix(in srgb, var(--cth-card) 70%, var(--cth-chrome))',
        borderBottom: '1px solid var(--cth-line)',
        userSelect: 'none'
      }}
    >
      <img className="cth-lockup-light" src={lockupLight} alt="Don't Be Michael" style={{ height: 22, width: 'auto', flexShrink: 0 }} />
      <img className="cth-lockup-dark" src={lockupDark} alt="Don't Be Michael" style={{ height: 22, width: 'auto', flexShrink: 0 }} />
      <ViewTabs />
      <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <ClockPill />
        <span className="cth-titlebar-nodrag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <UpdateBadge />
          {/* Beta beside the version, as in Settings (owner, 2026-10-05). Its
              own layer, so its tip opens above the stage (50), the right
              column (60) and the bottom bar (70), and stays under focus mode
              (250) and toasts (400). The bar itself keeps no layer: the update
              badge's cards compete at 400 as before. */}
          <span style={{ position: 'relative', zIndex: 240, display: 'inline-flex' }}>
            <BetaPill info={t('shell.betaInfo')} align="end" />
          </span>
          <CliUpdateBadge />
          <OfficeBreakChip />
        </span>
        <IconButton label={theme === 'dark' ? t('shell.themeLight') : t('shell.themeDark')} onClick={toggleTheme}>
          {theme === 'dark' ? <SunGlyph /> : <MoonGlyph />}
        </IconButton>
        {SHOW_FOCUS_MODE && (
          <IconButton label={fullscreenAgentId ? t('shell.exitFocus') : t('shell.focus')} onClick={toggleFocus}>
            {fullscreenAgentId ? <CollapseGlyph /> : <ExpandGlyph />}
          </IconButton>
        )}
        <IconButton label={t('shell.settings')} onClick={onOpenSettings}>
          <GearGlyph />
        </IconButton>
        <NeedsYouButton />
      </div>
    </div>
  );
}

/* ── View tabs (DESIGN.md 7.2) ─────────────────────────────────────────────── */

export function ViewTabs() {
  const { t } = useTranslation();
  const view = useStore((s) => s.floorView);
  const setView = useStore((s) => s.setFloorView);
  const fileTabs = useStore((s) => s.fileTabs);
  const activeFileTab = useStore((s) => s.activeFileTab);

  // No count on Tasks (owner, 2026-10-01): a blocked count beside the Needs
  // you count read as the same thing with a different number. Coral numbers
  // mean "waiting on you", and only Needs you shows one; blocked work is the
  // board's Blocked column.
  const tab = (key: FloorView, label: string) => {
    const on = view === key;
    return (
      <button
        key={key}
        className="cth-titlebar-nodrag"
        onClick={() => setView(key)}
        aria-pressed={on}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, whiteSpace: 'nowrap',
          height: 32, padding: '0 13px', border: 'none', borderRadius: 'var(--cth-r-md)',
          cursor: 'pointer', fontFamily: 'var(--cth-font-ui)', fontSize: 13, fontWeight: 500,
          background: on ? 'var(--cth-ink)' : 'transparent',
          color: on ? 'var(--cth-bg)' : 'var(--cth-ink-2)',
          transition: 'background var(--cth-dur-fast) var(--cth-ease)'
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div role="group" aria-label={t('floorView.label')} style={{ display: 'flex', alignItems: 'center', gap: 4, marginInlineStart: 26, flex: '0 1 auto', minWidth: 0 }}>
      {tab('office', t('floorView.office'))}
      {tab('tasks', t('floorView.tasks'))}
      {tab('pulse', t('floorView.pulse'))}
      {tab('graph', t('floorView.graph'))}
      {/* Files opened from a reply or a card (docs/designs/open-file-tab.md):
          after a hairline, each a select button and a close button side by
          side. They shrink to fit (DD2); the fixed tabs and Needs you never move. */}
      {fileTabs.length > 0 && <span aria-hidden style={{ width: 1, height: 18, background: 'var(--cth-line-2)', margin: '0 4px', flexShrink: 0 }} />}
      {fileTabs.map((f) => {
        const on = view === 'file' && activeFileTab === f.id;
        const icon = f.kind === 'excel' || f.kind === 'csv' ? 'sheet' : f.kind === 'image' ? 'image' : 'file';
        return (
          <span key={f.id} className="cth-titlebar-nodrag" title={`⁨${f.id}⁩`} style={{
            display: 'inline-flex', alignItems: 'center', height: 32, flex: '0 1 auto', minWidth: 72,
            borderRadius: 'var(--cth-r-md)', background: on ? 'var(--cth-ink)' : 'transparent',
            transition: 'background var(--cth-dur-fast) var(--cth-ease)'
          }}>
            <button
              onClick={() => useStore.getState().selectFileTab(f.id)}
              aria-pressed={on}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, height: 32,
                padding: '0 4px', paddingInlineStart: 11, border: 'none', background: 'transparent', cursor: 'pointer',
                color: on ? 'var(--cth-bg)' : 'var(--cth-ink-2)', fontFamily: 'var(--cth-font-ui)', fontSize: 13, fontWeight: 500
              }}
            >
              <span aria-hidden style={{ display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={icon} size={0.875} /></span>
              <span dir="auto" style={{ minWidth: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', unicodeBidi: 'isolate' }}>{f.title}</span>
            </button>
            <button
              className="cth-file-tab-close"
              onClick={() => useStore.getState().closeFileTab(f.id)}
              aria-label={t('fileTab.close', { name: f.title })}
              style={{
                width: 22, height: 22, flexShrink: 0, marginInlineEnd: 5, display: 'grid', placeItems: 'center',
                border: 'none', borderRadius: 5, background: 'transparent', cursor: 'pointer',
                color: on ? 'var(--cth-bg)' : 'var(--cth-ink-3)', opacity: on ? 0.75 : 1
              }}
            >
              <Icon name="x" size={0.75} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

const countBubble: CSSProperties = {
  minWidth: 18, height: 18, padding: '0 5px', borderRadius: 'var(--cth-r-pill)',
  display: 'inline-grid', placeItems: 'center',
  background: 'var(--cth-coral-strong)', color: 'var(--cth-on-coral)',
  fontFamily: 'var(--cth-font-mono)', fontSize: 10.5, fontWeight: 600, lineHeight: 1
};

/* ── Clock pill (DESIGN.md 7.3) ────────────────────────────────────────────── */

/**
 * The time, and whether the office is open. Office hours are not a setting in
 * this app, so the pill never claims a closing time; its menu opens Michael's
 * Office schedule or starts Closing time (the same flow as quitting).
 */
export function ClockPill() {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // While the office opens, the pill says so and counts who is in, on every
  // view (DESIGN.md 7.3, design review 1A); "Office open" once all are in or
  // at the cap.
  const opening = useStore((s) => s.opening.kind === 'opening');
  const total = useStore((s) => s.agents.length);
  const out = useStore((s) => stillOut(s.agents, ACTION_CLOCKING_IN).length);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const openSchedule = () => {
    setOpen(false);
    const god = useStore.getState().agents.find((a) => a.isGod);
    if (god) useStore.getState().select(god.id);
    useStore.getState().requestCommandCenterTab('triggers');
  };
  const closingTime = () => {
    setOpen(false);
    // Same path as Cmd-Q: closing time when terminals are running, a plain
    // quit when none are (window.close() left the app windowless in the Dock).
    void window.cth.requestQuit();
  };

  return (
    <div ref={ref} className="cth-titlebar-nodrag" style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px 0 12px',
          border: 'none', borderRadius: 'var(--cth-r-pill)', cursor: 'pointer',
          background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line)',
          fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, color: 'var(--cth-ink-2)'
        }}
      >
        <span style={opening
          ? { width: 7, height: 7, borderRadius: '50%', background: 'var(--cth-indigo)', boxShadow: '0 0 0 3px var(--cth-indigo-soft)', animation: 'cth-pulse 1.6s ease-in-out infinite' }
          : { width: 7, height: 7, borderRadius: '50%', background: 'var(--cth-green)', boxShadow: '0 0 0 3px var(--cth-green-soft)' }} />
        <span style={{ fontFamily: 'var(--cth-font-mono)', fontWeight: 600, color: 'var(--cth-ink)' }}>
          {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
        <span>{opening ? t('shell.opening') : t('shell.officeOpen')}</span>
        {opening && total > 0 && <span style={{ fontFamily: 'var(--cth-font-mono)' }}>{t('shell.openingCount', { count: total - out, total })}</span>}
        <ChevronGlyph />
      </button>
      {open && (
        <div role="menu" style={menu}>
          <MenuItem onClick={openSchedule}>{t('shell.officeSchedule')}</MenuItem>
          <MenuItem onClick={closingTime}>{t('shell.closingTime')}</MenuItem>
        </div>
      )}
    </div>
  );
}

const menu: CSSProperties = {
  position: 'absolute', top: 'calc(100% + 6px)', insetInlineEnd: 0, zIndex: 200, minWidth: 190,
  padding: 6, display: 'flex', flexDirection: 'column',
  background: 'var(--cth-card)', borderRadius: 'var(--cth-r-lg)',
  boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)'
};

function MenuItem({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 32, padding: '0 10px', border: 'none', borderRadius: 'var(--cth-r-md)', cursor: 'pointer',
        textAlign: 'start', fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink)',
        background: hover ? 'var(--cth-neutral-soft)' : 'transparent'
      }}
    >{children}</button>
  );
}

/* ── Needs you button (DESIGN.md 7.5) ──────────────────────────────────────── */

export function NeedsYouButton() {
  const { t } = useTranslation();
  const godName = useResolvedGodName();
  const { status, count, reports } = useNeedsYou();
  const state = pillState(status, count);
  // The coral pill shows the board and puts focus in the first reply field
  // (D10). While anything waits the board cannot be closed, so it never
  // closes it (owner, 2026-10-02).
  const openBoard = () => useStore.getState().openNeedsYou();
  // Michael's paper plane lands here (scene/studio/life.tsx): the button bumps.
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const on = () => setBump((n) => n + 1);
    window.addEventListener('cth:needs-you-ping', on);
    return () => window.removeEventListener('cth:needs-you-ping', on);
  }, []);
  // A screen reader hears it once each time the count rises (D10): with the
  // column closed, the pill's color is the only other sign.
  const [announce, setAnnounce] = useState('');
  const lastCount = useRef(0);
  useEffect(() => {
    if (status !== 'ready') return;
    if (count > lastCount.current) setAnnounce(t('shell.needsYouAnnounce', { godName, count }));
    lastCount.current = count;
  }, [status, count, godName, t]);
  const live = <span aria-live="polite" style={visuallyHidden}>{announce}</span>;

  // Unknown (launch, before the first read): an empty quiet pill, never a
  // false "Nothing needs you" (D3).
  if (state === 'blank') {
    return <>{live}<span aria-hidden="true" className="cth-titlebar-nodrag" style={{ ...quietPill, width: 132 }} /></>;
  }
  // Nothing waits: a plain label, not a button (D2).
  if (state === 'quiet') {
    // Only reports waiting: a quiet pill that opens the board, never coral (14A).
    if (reports > 0) {
      return <>{live}<button onClick={openBoard} className="cth-titlebar-nodrag" style={{ ...quietPill, border: 'none', fontFamily: 'var(--cth-font-ui)', cursor: 'pointer', color: 'var(--cth-ink-2)' }}>{t('shell.reports', { count: reports })}</button></>;
    }
    return <>{live}<span className="cth-titlebar-nodrag" style={quietPill}>{t('shell.nothingNeedsYou')}</span></>;
  }
  return (<>{live}
    <button
      key={bump}
      id={NEEDS_YOU_PILL_ID}
      className={bump ? 'cth-titlebar-nodrag cth-needs-bump' : 'cth-titlebar-nodrag'}
      onClick={openBoard}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 6px 0 14px',
        border: 'none', borderRadius: 'var(--cth-r-pill)', cursor: 'pointer',
        background: 'var(--cth-coral-strong)', color: 'var(--cth-on-coral)', boxShadow: 'var(--cth-shadow-coral)',
        fontFamily: 'var(--cth-font-ui)', fontSize: 13, fontWeight: 600
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', animation: 'cth-pulse 1.6s ease-in-out infinite' }} />
      {t('shell.needsYou')}
      <span style={{
        minWidth: 21, height: 21, padding: '0 6px', borderRadius: 'var(--cth-r-pill)', display: 'inline-grid', placeItems: 'center',
        background: 'var(--cth-on-coral)', color: 'var(--cth-coral-strong)',
        fontFamily: 'var(--cth-font-mono)', fontSize: 12, fontWeight: 600
      }}>{count}</span>
    </button>
  </>);
}

const quietPill: CSSProperties = {
  height: 32, padding: '0 14px', borderRadius: 'var(--cth-r-pill)', display: 'inline-flex', alignItems: 'center',
  background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, fontWeight: 500, color: 'var(--cth-ink-3)', cursor: 'default'
};
const visuallyHidden: CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0
};

/** The coral strip at the top of a person's panel (DESIGN.md 7.6). */
export function NeedsYouStrip() {
  const { t } = useTranslation();
  const count = useNeedsYouCount();
  if (count === 0) return null;
  return (
    <button
      onClick={() => useStore.getState().openNeedsYou()}
      aria-label={t('shell.backToBoard')}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 36, padding: '0 12px',
        border: 'none', borderRadius: 'var(--cth-r-lg)', cursor: 'pointer', flexShrink: 0,
        background: 'var(--cth-coral-soft)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-coral-base) 30%, transparent)',
        color: 'var(--cth-coral-text)', fontFamily: 'var(--cth-font-ui)', fontSize: 13, fontWeight: 600
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cth-coral-base)' }} />
      {t('shell.needsYou')}
      <span style={{ ...countBubble, marginInlineStart: 2 }}>{count}</span>
      <span style={{ marginInlineStart: 'auto', display: 'inline-flex' }}><ChevronGlyph rotate={-90} /></span>
    </button>
  );
}


/* ── Icon buttons and glyphs (DESIGN.md 10: outline, 1.75 stroke) ──────────── */

/** The visible tip doubles as the accessible name, so both read in the app's language. */
function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className="cth-titlebar-nodrag cth-settings-btn cth-tip"
      onClick={onClick}
      data-tip={label}
      aria-label={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32, padding: 0, border: 'none', borderRadius: 'var(--cth-r-md)',
        background: 'transparent', color: 'var(--cth-ink-2)', cursor: 'pointer'
      }}
    >{children}</button>
  );
}

function Glyph({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
  );
}
function MoonGlyph() { return <Glyph><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Glyph>; }
function SunGlyph() {
  return <Glyph><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Glyph>;
}
function ExpandGlyph() { return <Glyph><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></Glyph>; }
function CollapseGlyph() { return <Glyph><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5" /></Glyph>; }
function GearGlyph() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Glyph>
  );
}
export function ChevronGlyph({ rotate = 0 }: { rotate?: number }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: `rotate(${rotate}deg)` }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
