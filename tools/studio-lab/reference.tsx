/**
 * The reference screens (branding/reference/studio/*.png): the app's real shell
 * and panels on the fictional Harbor & Pine office, one screen per ?shot=.
 * `npm run shoot` builds this page and captures every shot at 1440 x 900.
 *
 *   ?shot=home                    the Office view with the Needs you board
 *   ?shot=kelly-access            Kelly's panel, Access tab
 *   ?shot=kelly-work              Kelly's panel, Work tab
 *   ?shot=michael-office-schedule Michael's panel, Office schedule tab
 *   ?shot=tasks-detail            Tasks, one task open
 *   ?shot=who-talks-to-whom       Who talks to whom
 *   ?shot=file-tab                A report a teammate wrote, open in its own office tab
 *   ?shot=onboarding-team         Setup, the Team step
 *   ?shot=onboarding-business     Setup, step 1 (your business)
 *   ?shot=onboarding-meet         Setup, the Meet step (Michael shows you around)
 *   ?shot=onboarding-ready        Setup, the Ready step (Claude installed, not signed in)
 *   ?shot=kelly-memory            Kelly's panel, Memory tab
 *   ?shot=hire                    The hire wizard over the office
 *   ?shot=settings-autonomy       Settings, Agents
 *   #dark                         dark theme
 *   ?at=10:42                     the time of day the clock shows
 */
import './clock';
import { officeConfig, roster } from './mock';
import '@/design/global.css';
import '@/i18n';
import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from '@/store/store';
import { StudioStage } from '@/scene/studio/StudioStage';
import { TopBar, NeedsYouStrip } from '@/shell/TopBar';
import { BottomBar } from '@/shell/BottomBar';
import { NeedsYouBoard } from '@/shell/NeedsYouBoard';
import { SidebarSplitter } from '@/components/SidebarSplitter';
import { AgentDetailPanel } from '@/components/AgentDetailPanel';
import { TasksKanban } from '@/components/TasksKanban';
import { TaskDetailOverlay } from '@/components/TaskDetailOverlay';
import { MemoryGraphPanel } from '@/components/MemoryGraphPanel';
import { FileTabView } from '@/components/FileTabView';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { AddAgentModal } from '@/components/AddAgentModal';
import { SettingsModal } from '@/components/SettingsModal';
import { renderIndex } from '@shared/memoryIndex';
import pro from '../../resources/packs/pro-services.json';
import core from '../../resources/packs/core.json';

const params = new URLSearchParams(location.search);
const shot = params.get('shot') ?? 'home';
if (location.hash.includes('dark')) document.documentElement.dataset.cthTheme = 'dark';
document.body.style.margin = '0';

/* ── What the bridge returns for these screens ────────────────────────────── */

const w = window as unknown as Record<string, any>;
const hours = (h: number, m = 0) => h * 60 + m;
const WEEKDAYS = [1, 2, 3, 4, 5];
Object.assign(w.cth, {
  packsList: async () => ({ packs: [{ pack: pro }], core, problems: [] }),
  getConfig: async () => config,
  // One schedule change Michael passed to the owner.
  listScheduleRequests: async () => [{
    id: 'r1', agentId: 'dwight', op: 'add', createdAt: Date.now() - 40 * 60e3,
    draft: { label: 'Follow up with open proposals', intervalMs: 0, weekly: { days: WEEKDAYS, minute: hours(9) } },
    reason: '3 proposals went quiet this week.',
    escalated: true, escalation: "Fits Dwight's job, but it emails customers every day, so it's yours to decide."
  }],
  listMissions: async () => [
    { id: 'm1', label: 'Team standup', to: 'god', enabled: true, intervalMs: 3600e3, body: '' },
    { id: 'm2', label: 'Check support inbox', to: 'kelly', enabled: true, intervalMs: 3600e3, body: '' },
    { id: 'm3', label: 'Daily support summary', to: 'kelly', enabled: true, intervalMs: 0, weekly: { days: WEEKDAYS, minute: hours(16, 30) }, body: '', createdBy: 'owner' },
    { id: 'm4', label: 'Pipeline review', to: 'dwight', enabled: true, intervalMs: 0, weekly: { days: [1], minute: hours(9) }, body: '' },
    { id: 'm5', label: 'Payments check', to: 'oscar', enabled: true, intervalMs: 0, weekly: { days: WEEKDAYS, minute: hours(17) }, body: '' },
    { id: 'm6', label: 'Weekly LinkedIn post', to: 'ryan', enabled: true, intervalMs: 0, weekly: { days: [2], minute: hours(14) }, body: '' },
    { id: 'm7', label: 'Timesheet reminders', to: 'toby', enabled: true, intervalMs: 0, weekly: { days: [5], minute: hours(9) }, body: '' },
    { id: 'm8', label: 'Board packet reminder', to: 'pam', enabled: false, intervalMs: 0, weekly: { days: [4], minute: hours(10) }, body: '' }
  ],
  // Kelly's Work tab: what her session printed this morning.
  onPtyData: (_id: string, cb: (chunk: string) => void) => { window.setTimeout(() => cb(KELLY_WORK), 300); return () => {}; },
  onPtyExit: () => () => {},
  // Kelly's Memory tab: what she has learned, as the app keeps it.
  hiveMemoryDetail: async () => ({ waiting: 0, index: renderIndex('Kelly', 'kelly', [
    { id: 'm1', kind: 'preference', text: 'Refunds over $200 go to Oscar first, then to the owner.', source: 'owner', date: '2026-09-21' },
    { id: 'm2', kind: 'preference', text: 'Sign replies "Kelly, Harbor & Pine support". No emoji.', source: 'owner', date: '2026-09-18' },
    { id: 'm3', kind: 'fact', text: 'Northwind Cafe prefers email over phone; Maria handles their billing.', source: 'task', date: '2026-09-29' },
    { id: 'm4', kind: 'fact', text: 'Late fees are waived once per client per year.', source: 'michael', date: '2026-09-24' },
    { id: 'm5', kind: 'reference', text: 'Invoices live in Support/Invoices, one PDF per invoice number.', source: 'task', date: '2026-09-20' },
    { id: 'm6', kind: 'procedure', text: 'Double charge: steps in memory/procedures/double-charge.md', source: 'task', date: '2026-09-29' }
  ]) }),
  onPtyRelaunch: () => () => {},
  // The file tab shot: Dwight's weekly pipeline report, read as the app reads it.
  readAskFile: async () => ({ ok: true, path: REPORT_PATH, kind: 'markdown', text: REPORT, size: REPORT.length, place: 'dwight', folder: ['Sales'] }),
  watchAskFile: async () => ({ ok: true }),
  unwatchAskFile: async () => undefined,
  onAskFileChanged: () => () => {},
  openAskFile: async () => ({ ok: true, action: 'opened' }),
  revealPath: async () => ({ ok: true })
});

const REPORT_PATH = '/Users/owner/Harbor & Pine/Dwight/Sales/Pipeline report 2026-10-09.md';
const REPORT = [
  '# Pipeline report, week of 5 Oct',
  '',
  'Prepared by Dwight on Friday 9 Oct. Three deals moved forward and one closed.',
  '',
  '## Where each deal stands',
  '',
  '| Client | Work | Value | Stage | Next step |',
  '| --- | --- | ---: | --- | --- |',
  '| Lakeview Dental | Website refresh | $10,000 | Proposal sent | Call with Dr. Park, Tue 13 Oct |',
  '| Bayside Books | Staff training | $8,000 | Waiting on budget | Owner to approve a 10% discount |',
  '| Northwind Cafe | Bookkeeping, one year | $13,200 | Won | Oscar sends the first invoice |',
  '| Cedar & Co | Brand refresh | $14,400 | First meeting held | Send scope by Thu 15 Oct |',
  '',
  '## This month',
  '',
  '- **Likely by 31 Oct:** $24,400 (Lakeview Dental and Cedar & Co).',
  '- **Upside:** $8,000 if Bayside Books approves its budget.',
  '- **Won so far:** $13,200 (Northwind Cafe, one year of bookkeeping).',
  '',
  '## What I need from you',
  '',
  'Bayside Books asked for 10% off to fit their budget. Yes or no is on your Ask me board.'
].join('\n');

const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const dot = (s: string) => `\x1b[32m●\x1b[39m ${s}`;
const KELLY_WORK = [
  '~/Harbor & Pine/Kelly', '',
  `> Michael: Reply to Maria at Northwind Cafe.`,
  `  She says she was charged twice.`, '',
  dot('Read support@ email'),
  dim('  └ From Maria Alvarez, Northwind Cafe'),
  dim('    "We see two $240 charges on our card.'),
  dim('     Can you fix this?"'), '',
  dot('Search support@ for invoice 4471'),
  dim('  └ 3 messages, newest Sept 29'), '',
  dot('Read Support/Invoice 4471.pdf'),
  dim('  └ $240.00, paid Sept 3 and again Sept 4'), '',
  dot('Draft reply to Maria'),
  dim('  └ "Hi Maria, sorry about the double'),
  dim('     charge. I am checking the refund'),
  dim('     now and will write back today."'), '',
  dot('Refund needs the owner. Asking Michael.'),
  dim('  └ ask michael "Refund $240 to Northwind?"'), '',
  `\x1b[33m● Waiting for Michael…\x1b[39m ${dim('(1m 12s)')}`
].join('\r\n');

/* ── The office, set for this shot ────────────────────────────────────────── */

const SHOTS: Record<string, Record<string, unknown>> = {
  home: {},
  'kelly-access': { selectedId: 'kelly', needsYouOpen: false, sidebarTab: 'capabilities' },
  'kelly-work': { selectedId: 'kelly', needsYouOpen: false, sidebarTab: 'terminal' },
  'michael-office-schedule': { selectedId: 'god', needsYouOpen: false, ccTabRequest: { tab: 'triggers', seq: 1 } },
  'tasks-detail': { floorView: 'tasks', taskDetailId: 'T112' },
  'who-talks-to-whom': { floorView: 'graph' },
  'file-tab': { floorView: 'file', needsYouOpen: true, fileTabs: [{ id: REPORT_PATH, title: 'Pipeline report 2026-10-09', kind: 'markdown', who: { assignee: 'dwight' }, openedAt: 0 }], activeFileTab: REPORT_PATH },
  'kelly-memory': { selectedId: 'kelly', needsYouOpen: false, sidebarTab: 'memory' },
  hire: {},
  'settings-autonomy': {}
};
const ONBOARDING: Record<string, 'business' | 'welcome' | 'team' | 'ready'> = { 'onboarding-team': 'team', 'onboarding-business': 'business', 'onboarding-meet': 'welcome', 'onboarding-ready': 'ready' };
// The Ready step on a computer where Claude is installed but not signed in yet.
if (shot === 'onboarding-ready') (window as unknown as Record<string, unknown>).__engine = { applies: true, installed: true, signedIn: false, needed: true };

useStore.setState({
  agents: roster().map((a) =>
    a.id === 'god' ? { ...a, ptyId: 'p-god' }
    : a.id === 'kelly' ? { ...a, ptyId: 'p-kelly', note: 'Northwind is a VIP client' }
    : a) as never,
  selectedId: null,
  needsYouOpen: true,
  floorView: 'office',
  godStatus: 'ready',
  ...SHOTS[shot]
} as never);

const config = { ...officeConfig, businessType: pro.businessType, businessName: 'Harbor & Pine Consulting', onboardingComplete: true, quickbooksClaude: true, registeredRepos: [], harnessHome: '/Users/owner/Harbor & Pine' } as never;
const SIDEBAR = 400;

// The home shots show one idle line, fully in. The app's own first line comes
// 8 s or more after load, after the shot (shoot.mjs captures at 7 s).
if (shot === 'home') window.setTimeout(() => window.dispatchEvent(new Event('cth:demo-quote')), 5000);
// Headless Chrome runs timers on virtual time but CSS animations on real
// time, so a capture would catch the bubble still popping in: pin it at rest.
const still = document.createElement('style');
still.textContent = '.cth-st-quote { animation: none !important; transform: translate(var(--q-x), var(--q-y)); }'
  // Setup's glide and fade (onboarding-centered.md) settle at once: the team
  // loads late in the shot's time budget and a still frame must not catch it mid way.
  + ' .cth-onb-body, .cth-onb-glow { transition: none !important; } .cth-onb-studio-in { animation: none !important; }';
document.head.appendChild(still);

/** The app window, as App.tsx lays it out (branding/DESIGN.md 5.2). */
function Shell() {
  const floorView = useStore((s) => s.floorView);
  const needsYouOpen = useStore((s) => s.needsYouOpen);
  const agent = useStore((s) => s.agents.find((a) => a.id === s.selectedId));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden', background: 'var(--cth-bg)' }}>
      <TopBar onOpenSettings={() => {}} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative', background: 'var(--cth-bg)' }}>
          <StudioStage config={config} bleed={SIDEBAR + 10} />
          {floorView !== 'office' && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', paddingBottom: 96, background: 'var(--cth-bg)' }}>
              {floorView === 'tasks' && <TasksKanban />}
              {floorView === 'graph' && <MemoryGraphPanel godId="god" onJumpToMemory={() => {}} />}
              {floorView === 'file' && <FileTabView />}
            </div>
          )}
          <BottomBar />
        </div>
        {/* As in the app: Tasks and Who talks to whom take the whole window. */}
        {(floorView === 'office' || floorView === 'file') && <SidebarSplitter width={SIDEBAR} onChange={() => {}} viewportWidth={1440} />}
        <div style={{ width: SIDEBAR, flexShrink: 0, minHeight: 0, position: 'relative', zIndex: 60, display: floorView === 'office' || floorView === 'file' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden', margin: '4px 6px 0 0' }}>
          {needsYouOpen || !agent ? <NeedsYouBoard config={config} /> : (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 12px 0' }}>
              <NeedsYouStrip />
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><AgentDetailPanel agent={agent} /></div>
            </div>
          )}
        </div>
      </div>
      <TaskDetailOverlay />
      {shot === 'hire' && <AddAgentModal onClose={() => {}} config={config} onConfigChange={() => {}} />}
      {shot === 'settings-autonomy' && <SettingsModal config={config} initialSection="Agents" onClose={() => {}} />}
    </div>
  );
}

/** The window's traffic lights: the app runs in a hiddenInset window, so the
 *  shots draw them where macOS does. */
function TrafficLights() {
  return (
    <div style={{ position: 'fixed', top: 22, left: 20, zIndex: 1000, display: 'flex', gap: 8, pointerEvents: 'none' }}>
      {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
        <span key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c, boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.18)' }} />
      ))}
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() {
    return this.state.error
      ? <pre id="shot-error" style={{ padding: 24, color: 'var(--cth-coral-text)' }}>{String((this.state.error as Error)?.stack ?? this.state.error)}</pre>
      : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <Boundary>
    {ONBOARDING[shot]
      ? <OnboardingWizard onComplete={() => {}} preview={{ step: ONBOARDING[shot], businessType: pro.businessType, businessName: 'Harbor & Pine Consulting' }} />
      : <Shell />}
    <TrafficLights />
  </Boundary>
);
