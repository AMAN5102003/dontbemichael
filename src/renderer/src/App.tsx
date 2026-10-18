import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useStore, selectedAgent, ROSTER_BOOT_HOME, ACTION_CLOCKING_IN } from '@/store/store';
import { rosterNeedsReload } from '@/store/rosterSource';
import { startMockLoop, stopMockLoop } from '@/store/mockEvents';
import type { HarnessConfig } from '@/store/config';
import { DEFAULT_ORG_TRIGGER } from '@shared/triggers';
import { StudioStage } from '@/scene/studio/StudioStage';
import { TasksKanban } from '@/components/TasksKanban';
import { PulseView } from '@/components/pulse/PulseView';
import { FileTabView } from '@/components/FileTabView';
import { MemoryGraphPanel } from '@/components/MemoryGraphPanel';
import { useHive } from '@/hooks/useHive';
import { useGodNameSync } from '@/i18n/useGodNameSync';
import { useDirectionSync } from '@/i18n/useDirection';
import { useCopyLinkLabelSync } from '@/i18n/useCopyLinkLabelSync';
import { useArabicTerminalSync } from '@/terminal/useArabicTerminalSync';
import { AgentDetailPanel } from '@/components/AgentDetailPanel';
import { AddAgentModal } from '@/components/AddAgentModal';
import { MichaelBooting } from '@/components/MichaelBooting';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { OfficeFolderMissing } from '@/components/OfficeFolderMissing';
import { ClosingTimeBar, type ClosingTimeState } from '@/components/ClosingTimeBar';
import { CompletionToast } from '@/realtime/CompletionToast';
import { UpdateToast } from '@/components/UpdateToast';
import { CliUpdateToast } from '@/components/CliUpdateNotice';
import { SettingsModal, type Section as SettingsSection } from '@/components/SettingsModal';
import { PixelButton } from '@/components/PixelButton';
import { SidebarSplitter } from '@/components/SidebarSplitter';
import { acquireTerminal } from '@/components/terminalPool';
import { FullscreenTerminal } from '@/components/FullscreenTerminal';
import { TaskDetailOverlay } from '@/components/TaskDetailOverlay';
import { IdePanel } from '@/ide/IdePanel';
import { SHOW_IDE } from '@shared/buildFeatures';
import { useHoldOptionToTalk } from '@/freeflow/holdOption';
import { useTranslation } from 'react-i18next';
import { TopBar, NeedsYouStrip } from '@/shell/TopBar';
import { setDialogsSuspended } from '@/shell/useDialog';
import { useRestoreTeam } from '@/hooks/useRestoreTeam';
import { NeedsYouBoard, RestoreTeamBanner } from '@/shell/NeedsYouBoard';
import { setWorkStyleOffersSource, useNeedsYou } from '@/shell/useNeedsYou';
import { readWorkStyleOffers } from '@/shell/workStyleOffers';
import { columnAfterGoneHome } from '@/shell/closingFloor';
import { watchReturningBindings } from '@/shell/releaseBindings';
import { NEEDS_YOU_PILL_ID, columnEscAction, columnLocked, focusNeedsYouPill } from '@/shell/rightColumn';
import { BottomBar } from '@/shell/BottomBar';

// Injected at build time from package.json (see electron.vite.config.ts).
declare const __APP_VERSION__: string;

export function App() {
  // Point every {{godName}} string at the orchestrator's real, renameable name.
  useGodNameSync();
  // Mirror the document only for a user who has picked an RTL app language.
  useDirectionSync();
  // Give main the right-click "Copy link address" label in the app language.
  useCopyLinkLabelSync();
  // Let terminals that are ALREADY open follow a language switch too.
  useArabicTerminalSync();
  const agent = useStore(selectedAgent);
  const agents = useStore(s => s.agents);
  const agentCount = agents.length;
  const addAgentOpen = useStore(s => s.addAgentOpen);
  const setAddAgentOpen = useStore(s => s.setAddAgentOpen);
  const clearPendingHires = useStore(s => s.clearPendingHires);
  const godStatus = useStore(s => s.godStatus);
  const fullscreenAgentId = useStore(s => s.fullscreenAgentId);
  const { t } = useTranslation();
  const rightColumn = useStore(s => s.rightColumn);
  const sidebarWidth = useStore(s => s.sidebarWidth);
  const setSidebarWidth = useStore(s => s.setSidebarWidth);
  const ideOpen = useStore(s => s.ideOpen);
  const setIdeOpen = useStore(s => s.setIdeOpen);
  const floorView = useStore(s => s.floorView);
  const godId = useStore(s => s.agents.find((a) => a.isGod)?.id) ?? 'god';

  const [config, setConfig] = useState<HarnessConfig | null>(null);
  // Is the office folder there? Checked once per launch. 'ok' goes straight to
  // the floor; 'missing' (moved, renamed or deleted) shows OfficeFolderMissing.
  // There is no picker on a normal launch any more: switching folders on
  // purpose lives in Settings → General (owner, 2026-09-24).
  const [homeState, setHomeState] = useState<'checking' | 'ok' | 'missing'>('checking');
  const hiveOpened = homeState === 'ok';
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which tab Settings opens on. Set by a `cth:open-settings` deep link, reset
   *  to undefined (→ General) whenever the modal is opened the normal way. */
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);
  // Closing time on the floor (ClosingTimeBar): shown from the quit request
  // until the office closes or the owner goes back to work.
  const [closingOpen, setClosingOpen] = useState(false);
  const [closing, setClosing] = useState<ClosingTimeState | null>(null);
  const [vpWidth, setVpWidth] = useState<number>(window.innerWidth);

  // A closed bound hire who comes back gets their bindings back (SR3).
  useEffect(() => watchReturningBindings(), []);
  // Deep link into Settings from anywhere in the tree. Settings' open state is
  // local to App, so a nested control (e.g. "set it now" beside a disabled Talk
  // button) has no path to it without threading a prop through every layer
  // between; a window event keeps that plumbing out of the components in
  // between, matching the existing `cth:` CustomEvent convention.
  useEffect(() => {
    const onOpenSettings = (e: Event): void => {
      const section = (e as CustomEvent<{ section?: SettingsSection }>).detail?.section;
      setSettingsSection(section);
      setSettingsOpen(true);
    };
    window.addEventListener('cth:open-settings', onOpenSettings);
    return () => window.removeEventListener('cth:open-settings', onOpenSettings);
  }, []);

  // Initial config load
  useEffect(() => {
    let cancelled = false;
    window.cth.getConfig().then(c => {
      if (cancelled) return;
      setConfig(c);
      // Mirror the Free Flow flag into the store so the composer mic button shows
      // only when enabled (Settings keeps this in sync on save).
      useStore.getState().setFreeflowEnabled(!!c.freeflowEnabled);
      // Mirror boolean key-presence ONLY (never the key value) so the composer can
      // show the voice button disabled-with-tooltip when Free Flow is on but no
      // Groq key is set (Settings keeps this in sync on save).
      useStore.getState().setHasGroqKey(!!c.groqApiKey);
      // Mirror the triggers so Settings → Connections and the Command Center's
      // Triggers tab read one list, not two copies that drift — whichever surface
      // saves calls these same setters and the other repaints. No extra IPC: main
      // deep-fills both fields on every config read (withTriggerDefaults), so
      // getConfig() already serves what listWebhooks()/getOrgTrigger() would.
      // `c` is typed as the PRELOAD's HarnessConfig, which hasn't picked the two
      // fields up yet (another lane's file); the renderer mirror type declares them.
      const withTriggers = c as HarnessConfig;
      useStore.getState().setWebhookTriggers(withTriggers.webhookTriggers ?? []);
      useStore.getState().setOrgTrigger(withTriggers.orgTrigger ?? DEFAULT_ORG_TRIGGER);
    });
    // Mirror BYOK OpenAI key presence (boolean only; the key never leaves main) so the
    // Realtime Michael voice toggle can gate on it. Lives in the secret broker, not
    // config — so fetch it rather than derive from c.
    window.cth.realtimeHasOpenAiKey().then(has => {
      if (!cancelled) useStore.getState().setHasOpenAiKey(has);
    });
    return () => { cancelled = true; };
  }, []);

  // Free Flow entry point B — hold-Option (⌥) to talk. In-renderer push-to-talk
  // for whichever agent the user is viewing; gated on the flag, terminal-safe
  // (solo-hold threshold, aborts on any other key). See freeflow/holdOption.ts.
  useHoldOptionToTalk();

  // Config subscription — the copy loaded above would otherwise go stale the
  // moment anything saves a setting.
  useEffect(() => window.cth.onConfigChanged(setConfig), []);

  // Last session's team comes back on launch from here, where it is always
  // mounted: the Needs you board also shows its banner, but it unmounts when a
  // person is picked, which used to cancel the pending restore (review,
  // 2026-10-01). The hook's state is shared, so the two never double restore.
  useRestoreTeam(config);

  // Quitting with people at work starts closing time straight away (owner,
  // 2026-09-30: no dialog; the floor shows the lights going out). The bar
  // offers Cancel and Force quit. A second quit request while closing is a no-op.
  const closingOpenRef = useRef(false);
  closingOpenRef.current = closingOpen;
  // However closing time starts (quit, the update toast, main), open dialogs
  // stay as they are but let go of the keyboard while the bar is up.
  useEffect(() => { setDialogsSuspended(closingOpen); }, [closingOpen]);
  useEffect(() => window.cth.onCloseRequested(() => {
    if (closingOpenRef.current) return;
    closingOpenRef.current = true; // a second request in the same tick sees it before the render
    setClosingOpen(true);
    void startClosingTimeRef.current(reopenAsked.current ? { relaunch: true } : undefined);
  }), []);

  // Shareable hires: a validated manifest arriving via the dontbemichael://
  // deep link (or file import) pre-fills the Add-Agent modal. Never spawns by itself.
  const enqueuePendingHires = useStore(s => s.enqueuePendingHires);
  const closeAddAgentReview = () => {
    clearPendingHires();
    setAddAgentOpen(false);
  };
  useEffect(() => {
    const unsub = window.cth.onHireImport?.((m) => {
      enqueuePendingHires([m]);
      setAddAgentOpen(true);
    });
    // Pull anything that arrived before this subscription existed (cold-start
    // deep links; packaged renderers load too fast for push-on-load).
    void window.cth.drainPendingHires?.().then((queued) => {
      if (queued && queued.length > 0) {
        enqueuePendingHires(queued);
        setAddAgentOpen(true);
      }
    });
    return unsub;
  }, [enqueuePendingHires, setAddAgentOpen]);
  useEffect(() => window.cth.onHireError?.((info) => {
    console.error('[hire] import failed:', info.error);
  }), []);

  // Closing-time progress: drives the closing bar. It stays up through the
  // whole protocol; on 'complete' the main process tears down and quits by
  // itself moments later.
  useEffect(() => window.cth.onClosingTime?.((ev) => {
    const { phase, ...rows } = ev;
    if (phase === 'cancelled') { setClosing(null); setClosingOpen(false); return; }
    // Every field main sends reaches the bar; none is copied by hand.
    setClosing({ phase, ...rows });
    if (phase === 'started' || phase === 'progress') setClosingOpen(true);
    // The lights going out play on the office floor, so closing time shows it,
    // whatever tab was open (owner, 2026-10-11). Only at the start: a tab the
    // owner picks while closing stays picked. Not saved as the remembered view,
    // so the next launch still opens where the owner left off.
    if (phase === 'started') useStore.setState({ floorView: 'office' });
  }), []);

  // Who has gone home: they leave the floor and open from nowhere until
  // closing is cancelled (docs/designs/closing-floor.md).
  useEffect(() => window.cth.onClosingTime?.((ev) => {
    const r = ev as { phase: string; confirmed?: string[]; excused?: string[] };
    useStore.getState().setGoneHome(r.phase === 'cancelled' ? [] : [...(r.confirmed ?? []), ...(r.excused ?? [])]);
  }), []);

  const startClosingTime = async (opts?: { relaunch?: boolean }): Promise<boolean> => {
    const res = await window.cth.startClosingTime(opts);
    if (!res.ok) setClosing({ phase: 'error', acked: 0, total: 0, error: res.error });
    return res.ok;
  };
  const startClosingTimeRef = useRef(startClosingTime);
  startClosingTimeRef.current = startClosingTime;
  // The owner asked to reopen (CliUpdateNotice). Kept until they cancel, so a
  // retry from the closing bar (after a refused start) still reopens.
  const reopenAsked = useRef(false);
  // A Claude Code update is waiting (CliUpdateNotice): the owner's click closes
  // the office the safe way, then the app reopens on the new version.
  const closeOfficeAndReopen = (): Promise<boolean> => {
    reopenAsked.current = true;
    setClosingOpen(true);
    return startClosingTime({ relaunch: true });
  };
  const cancelClosingTime = () => {
    void window.cth.cancelClosingTime();
    setClosing(null);
  };

  // The hive: god-agent bootstrap, hook-driven avatars, idle-agent waking. Held
  // off (passing null no-ops the hook) until the office folder check passes
  // (homeState 'ok'), so Michael never boots against a missing office.
  useEffect(() => {
    if (!config?.onboardingComplete || homeState !== 'checking') return;
    let alive = true;
    window.cth.homeStatus()
      .then((st) => { if (alive) setHomeState(st.hasOffice ? 'ok' : 'missing'); })
      // A failed check must not lock the owner out of a healthy office.
      .catch(() => { if (alive) setHomeState('ok'); });
    return () => { alive = false; };
  }, [config?.onboardingComplete, homeState]);
  useHive(hiveOpened ? config : null);

  // Pre-warm a persistent terminal for every live agent so its output is
  // buffered from spawn. Switching agents then re-attaches an already-rendered
  // terminal instantly (with full history) instead of building a blank one.
  useEffect(() => {
    for (const a of agents) if (a.ptyId) acquireTerminal(a.ptyId);
  }, [agents]);

  // Synthetic demo loop — CAGED (#5B). It must never animate alongside a live
  // hive (it would fire fake envelope handoffs and step seeded agents). Run it
  // only as an explicit showcase (VITE_CTH_DEMO=1 in dev) or on a genuinely
  // empty floor, and stop it the instant the first real PTY agent appears
  // (Michael always spawns, so in normal operation it effectively never runs).
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const DEMO = import.meta.env.DEV && import.meta.env.VITE_CTH_DEMO === '1';
    const evaluate = () => {
      const hasLive = useStore.getState().agents.some((a) => a.ptyId);
      if (DEMO || !hasLive) startMockLoop();
      else stopMockLoop();
    };
    evaluate();
    const unsub = useStore.subscribe(evaluate);
    return () => { unsub(); stopMockLoop(); };
  }, [config?.onboardingComplete]);

  // Reconcile restored agents against the PTYs still alive in the main process.
  // After a renderer reload (e.g. the laptop slept and Vite reloaded the page),
  // this keeps agents whose process survived and drops any that truly died.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    let cancelled = false;
    window.cth.listPtys().then((list) => {
      if (cancelled) return;
      useStore.getState().reconcileWithLivePtys(list.map((p) => p.id));
      // A terminal that survived the reload and has already printed was never
      // away: it is not clocking in, so its desk light and caption must not
      // say so (the saved roster loads everyone as clocking in).
      const running = new Set(list.filter((p) => p.hasOutput).map((p) => p.id));
      for (const a of useStore.getState().agents) {
        if (a.ptyId && running.has(a.ptyId) && a.action === ACTION_CLOCKING_IN) useStore.getState().updateAgent(a.id, { action: '' });
      }
    }).catch(() => { /* ignore — keep restored agents as-is */ });
    return () => { cancelled = true; };
  }, [config?.onboardingComplete]);

  // Re-apply the persisted focus-mode preference as the roster fills in.
  //
  // Not a one-shot at store construction: at launch every restored agent still
  // carries the PREVIOUS session's PTY id, so the reconcile above prunes the lot
  // and correctly drops focus mode to null before god has respawned. The
  // preference therefore has to be re-checked once agents with live terminals
  // actually exist. `restoreFocusMode` is a no-op unless the preference is on and
  // focus mode is currently off, so re-running it on every roster change is safe
  // and pressing Esc stays sticky.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    useStore.getState().restoreFocusMode();
  }, [config?.onboardingComplete, agents]);

  // The right column (docs/designs/needs-you-empty-state.md): while anything
  // waits on the owner it is open and cannot be closed; only when nothing at
  // all waits may the office take the window (owner, 2026-10-02).
  const feed = useNeedsYou();
  // New default job descriptions are offered on Needs you (workStyleUpdates.ts).
  useEffect(() => { setWorkStyleOffersSource(readWorkStyleOffers); }, []);
  const locked = columnLocked(feed.status, feed.count);
  // The open person goes home: their panel closes and the closing bar takes
  // the focus (4A).
  const goneHome = useStore((s) => s.goneHome);
  useEffect(() => {
    const st = useStore.getState();
    const next = columnAfterGoneHome(st.rightColumn, st.selectedId, goneHome, locked);
    if (!next) return;
    st.setRightColumn(next);
    document.querySelector<HTMLElement>('[data-closing-bar]')?.focus({ preventScroll: true });
  }, [goneHome, locked]);
  const columnOpen = rightColumn !== 'closed';
  // Tasks and Who talks to whom take the whole window (owner, 2026-10-03). The
  // column stays mounted there, only hidden, so a person's terminal and a half
  // written reply survive the switch; opening it goes back to the office.
  // A file tab keeps it beside the file, so an Ask me card stays answerable
  // while its file is read (docs/designs/open-file-tab.md, F1). Pulse takes the
  // whole window like Tasks, without the bottom bar either (owner, 2026-10-15).
  const columnView = floorView === 'office' || floorView === 'file';
  const columnShown = columnOpen && columnView;
  const columnRef = useRef<HTMLDivElement>(null);
  const lastColumnMode = useRef<'board' | 'person'>('board');
  // An ask arriving, or waiting at launch, opens the board. Focus stays put.
  useEffect(() => {
    if (locked && useStore.getState().rightColumn === 'closed') useStore.getState().setRightColumn('board');
  }, [locked, rightColumn]);
  // D4: after the last answer the board shows All clear and closes on the next
  // click outside it (not the pill, which toggles it, nor the splitter).
  // Off the office the column is hidden, so a click on Tasks or the graph is
  // not "outside" it (ship review 2026-10-03).
  const allClear = rightColumn === 'board' && floorView === 'office' && feed.status === 'ready' && feed.count === 0;
  useEffect(() => {
    if (!allClear) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || columnRef.current?.contains(target)) return;
      if (target.closest(`#${NEEDS_YOU_PILL_ID}, .cth-splitter`)) return;
      useStore.getState().setRightColumn('closed');
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [allClear]);
  // D9: the column slides out over the office for 240 ms after it closes; it
  // has already left the layout, so the office takes its new size at once.
  // Decided during render, so the column is never unmounted for a frame
  // between closing and sliding out (a person's terminal would remount).
  const [prevColumnOpen, setPrevColumnOpen] = useState(columnOpen);
  const [exiting, setExiting] = useState(false);
  if (prevColumnOpen !== columnOpen) {
    setPrevColumnOpen(columnOpen);
    setExiting(!columnOpen && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }
  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setExiting(false), 240);
    return () => clearTimeout(timer);
  }, [exiting]);

  // Track viewport width for splitter clamping
  useEffect(() => {
    const onResize = () => setVpWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!config) {
    return <div style={{ width: '100vw', height: '100vh', background: 'var(--cth-cream-100)' }} />;
  }

  if (!config.onboardingComplete) {
    // Just-onboarded users go straight into the office they set up (homeState 'ok').
    // If setup chose an office the store was not built for, reload first so the
    // floor reads that office's roster instead of saving an empty one over it
    // (rosterSource.ts, rosterNeedsReload).
    return <OnboardingWizard onComplete={(next) => {
      if (rosterNeedsReload(ROSTER_BOOT_HOME, next.harnessHome)) { window.location.reload(); return; }
      setConfig(next); setHomeState('ok');
    }} />;
  }

  if (homeState === 'checking') {
    return <div style={{ width: '100vw', height: '100vh', background: 'var(--cth-cream-100)' }} />;
  }
  if (homeState === 'missing') {
    return <OfficeFolderMissing config={config} />;
  }

  // Esc closes the column only when focus is inside it and nothing else took
  // the key; a reply with text in it is left first (eng R2). The terminal
  // keeps its Esc.
  const onColumnKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const field = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target : null;
    const action = columnEscAction({
      key: e.key,
      defaultPrevented: e.defaultPrevented || !!target.closest('.xterm'),
      inColumn: e.currentTarget.contains(target),
      fieldHasText: !!field?.value.trim(),
      locked
    });
    if (action === 'none') return;
    e.preventDefault();
    if (action === 'blur') {
      field?.blur();
      e.currentTarget.querySelector<HTMLElement>('[data-needs-you-heading]')?.focus();
      return;
    }
    useStore.getState().setRightColumn('closed');
    focusNeedsYouPill();
  };
  // While it slides out, the column keeps showing what it showed.
  const columnMode: 'board' | 'person' = !columnOpen ? lastColumnMode.current
    : rightColumn === 'board' || !agent ? 'board' : 'person';
  lastColumnMode.current = columnMode;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: '100vw', height: '100vh',
      overflow: 'hidden', background: 'var(--cth-bg)'
    }}>
      {/* Toasts: voice completions, app updates, Claude Code updates. Each one
          positions itself and renders null until it has something to say. */}
      <CompletionToast />
      <UpdateToast />
      <CliUpdateToast onCloseAndReopen={closeOfficeAndReopen} />

      {/* Design v2 shell (branding/DESIGN.md 5.2): top bar, the stage with the
          bottom bar floating over it, and the right column. No agent strip and
          no permanent Command Center: people live on the stage. */}
      <TopBar onOpenSettings={() => { setSettingsSection(undefined); setSettingsOpen(true); }} />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative', background: 'var(--cth-bg)' }}>
          <StudioStage config={config} bleed={columnShown ? sidebarWidth + 10 : 0} />
          {/* Over the office only, never over Tasks or the graph (DESIGN.md 7.6). */}
          {floorView === 'office' && <RestoreTeamBanner config={config} />}
          {agentCount === 0 && godStatus === 'booting' && <MichaelBooting />}
          {agentCount === 0 && godStatus !== 'booting' && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none'
            }}>
              <div style={{ pointerEvents: 'auto', width: 340 }}>
                <div style={{ background: 'var(--cth-card)', borderRadius: 'var(--cth-r-2xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)' }}>
                  <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em' }}>{t('shell.noAgentTitle')}</div>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-2)' }}>{t('shell.noAgentBody')}</p>
                    <PixelButton variant="primary" size="md" onClick={() => setAddAgentOpen(true)}>{t('shell.hire')}</PixelButton>
                  </div>
                </div>
              </div>
            </div>
          )}
          {floorView !== 'office' && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 50,
              display: 'flex', flexDirection: 'column',
              // Room for the floating bottom bar, so it never covers the last cards.
              paddingBottom: floorView === 'pulse' ? 0 : 96,
              background: 'var(--cth-bg)'
            }}>
              {floorView === 'tasks' && <TasksKanban />}
              {floorView === 'pulse' && <PulseView />}
              {floorView === 'file' && <FileTabView />}
              {floorView === 'graph' && (
                <MemoryGraphPanel godId={godId} onJumpToMemory={(id) => useStore.getState().openAgentMemory(id)} />
              )}
            </div>
          )}
          {/* The bottom bar stays mounted behind the closing bar and on Pulse,
              so a Cancel or a tab switch finds Talk to Michael with its
              attached files still there. */}
          <div style={{ display: closingOpen || floorView === 'pulse' ? 'none' : 'contents' }}>
            <BottomBar />
          </div>
          {closingOpen && (
            <ClosingTimeBar
              closing={closing}
              onCancel={() => {
                reopenAsked.current = false;
                // Closing time starts the moment the quit is asked, so Cancel
                // always stops it, even before its first progress event; main
                // ignores a cancel when nothing is running.
                if (closing?.phase !== 'error') cancelClosingTime();
                window.cth.cancelClose();
                setClosing(null);
                setClosingOpen(false);
              }}
              onForceQuit={() => { void window.cth.confirmClose(); }}
              onRetry={() => { void startClosingTime(reopenAsked.current ? { relaunch: true } : undefined); }}
            />
          )}
        </div>

        {columnShown && (
          <SidebarSplitter
            width={sidebarWidth}
            onChange={setSidebarWidth}
            viewportWidth={vpWidth}
          />
        )}

        {/* The right column has no ground of its own (owner, 2026-09-30): its
            cards, and the person and Michael panels (cards themselves), sit
            straight on the office, which runs on underneath. It is not there
            at all while nothing waits and nobody is open (D1). */}
        {(columnOpen || exiting) && (
          <div
            ref={columnRef}
            data-right-column
            onKeyDown={onColumnKey}
            aria-hidden={columnOpen ? undefined : true}
            className={columnOpen ? 'cth-col-in' : 'cth-col-out'}
            style={{
              width: sidebarWidth, flexShrink: 0, minHeight: 0, zIndex: 60,
              display: columnView ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden',
              ...(columnOpen
                ? { position: 'relative', margin: '4px 6px 0 0' }
                : { position: 'absolute', top: 4, bottom: 0, insetInlineEnd: 6 })
            }}
          >
            {columnMode === 'board' || !agent ? (
              <NeedsYouBoard />
            ) : (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 12px 0' }}>
                <NeedsYouStrip />
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <AgentDetailPanel agent={agent} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {addAgentOpen && (
        <AddAgentModal
          onClose={closeAddAgentReview}
          config={config}
          onConfigChange={setConfig}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          config={config}
          initialSection={settingsSection}
          onClose={() => { setSettingsOpen(false); setSettingsSection(undefined); }}
        />
      )}


      {fullscreenAgentId && <FullscreenTerminal config={config} />}
      {SHOW_IDE && ideOpen && <IdePanel />}
      <TaskDetailOverlay />
    </div>
  );
}
