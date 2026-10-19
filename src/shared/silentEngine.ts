/**
 * A team member whose engine stops reporting to the app (issue #326, design
 * review 2026-10-16, SD1 to SD17, eng review R1 to R7): the shared rules and the
 * shape the window shows. The watch itself runs in the main process
 * (src/main/silentWatch.ts); the card is on Needs you (DESIGN.md §7.6b).
 *
 * Plain TypeScript with no imports from either side, so the tests can run it.
 */

/** Every engine with a bridge must check in this long after its first terminal
 *  output, after any start or restart (SD9). */
export const CHECK_IN_MS = 60_000;
/** Mid work silence, Claude only: its terminal busy, no report this long (SD9). */
export const QUIET_MS = 3 * 60_000;
/** Output this recent means the terminal is still printing. A working Claude
 *  repaints many times a second; an idle screen that redraws once (a refit, a
 *  resize) goes still at once, so a single redraw never starts the quiet clock
 *  (2026-10-17: one redraw flagged ten idle members as not reporting). */
export const BUSY_FRESH_MS = 15_000;
/** The watch beats every 8 s. A longer gap means the beats stopped (the Mac
 *  slept, or the app stalled), so output on either side of it is two separate
 *  redraws, never one unbroken stretch (2026-10-17: a lid closed at 22:55 and
 *  opened at 23:07 flagged eight idle members as not reporting). */
export const BEAT_GAP_MS = 30_000;
/** One tool call (a long build or test run) sends no report until it ends, so
 *  a member inside one is not quiet until it has run this long, longer than
 *  Claude Code's longest shell command (ship review 2026-10-17). */
export const LONG_TOOL_MS = 15 * 60_000;
/** A restart, or a member restored after a relaunch, that has not checked in
 *  this long is settled: a restart that never came back failed, and a restored
 *  card goes back to how it was, so the card offers its buttons again. */
export const RESTART_WAIT_MS = 3 * CHECK_IN_MS;

/** Engine versions known never to report to the app (R6): no automatic restart,
 *  the card opens in its "a restart didn't help" state. One test per entry. */
export const NEVER_REPORTS: ReadonlyArray<{ engine: string; from: string; why: string }> = [
  // Gemini CLI 0.60 reads a system settings file only from a folder owned by
  // root or an administrator, so it skips the agent's hooks (#315).
  { engine: 'gemini', from: '0.60.0', why: 'skips the per agent settings file' }
];

/** a >= b for dotted versions ("0.63.0" >= "0.60.0"). */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** True when this engine version is known never to report. An unknown version
 *  keeps Michael's one restart (R6). */
export function neverReports(engine: string, version: string | null): boolean {
  if (!version) return false;
  return NEVER_REPORTS.some((r) => r.engine === engine && versionAtLeast(version, r.from));
}

/** Whether anything besides the reports guards a member's files (R2, SD13):
 *  Claude and Codex run in an OS sandbox on a Mac and Linux; Windows has none
 *  (Codex's there is unproven, finding 5); Gemini has none anywhere. Research's
 *  file tools have the reports as their only wall, and it has the internet, so
 *  a Research that isn't reporting is never left running (owner, 2026-10-17). */
export function guardedWithoutReports(engine: string, platform: string, isResearch = false): boolean {
  if (platform === 'win32' || isResearch) return false;
  return engine === 'claude' || engine === 'codex';
}

/** How it went quiet: never checked in after starting, or went quiet mid work. */
export type SilentKind = 'never' | 'quiet';
/**
 * open       not reporting; Restart
 * restarting a restart is running; waiting for the check in
 * failed     a restart didn't help (or the version never reports): Change engine
 * kept       the owner chose Keep working unchecked; no card, the tag stays
 * checking   the app reopened; waiting for the restored member to check in
 */
export type SilentState = 'open' | 'restarting' | 'failed' | 'kept' | 'checking';

export interface SilentEpisode {
  agentId: string;
  kind: SilentKind;
  state: SilentState;
  /** Engine family ('claude', 'codex', 'gemini', …) and its version if known. */
  engine: string;
  engineLabel: string;
  version: string | null;
  /** The member's terminal was stopped because nothing else guards its files (R1). */
  stopped: boolean;
  /** A restart was really tried, so the card may say it didn't help. */
  restartTried?: boolean;
  isMichael: boolean;
  /** Research, the one member with the internet: its own card, no Keep. */
  isResearch?: boolean;
  since: number;
  /** When the app last heard from it; null when it never checked in. */
  lastCheckInAt: number | null;
  /** When its terminal first showed output (the start the time line counts from). */
  startedAt: number | null;
  /** The state before the app reopened, while `checking` (SD8). */
  before?: SilentState;
  /** When a restart or a relaunch began the wait for its check in. */
  waitSince?: number;
}

/** One card on Needs you: one engine and version (SD3), or Michael (SD6). */
export interface SilentCard {
  key: string;
  michael: boolean;
  research: boolean;
  agentIds: string[];
  state: SilentState;
  kind: SilentKind;
  stopped: boolean;
  restartTried: boolean;
  engineLabel: string;
  version: string | null;
  lastCheckInAt: number | null;
  startedAt: number | null;
}

const RANK: Record<SilentState, number> = { failed: 4, open: 3, checking: 2, restarting: 1, kept: 0 };

/** The card an episode sits on (SD3): one per engine, version and reason
 *  (never checked in, or went quiet mid work), so each card's time line is
 *  true for every name on it; Michael has his own (SD6). */
export function silentCardKey(e: Pick<SilentEpisode, 'isMichael' | 'isResearch' | 'engine' | 'version' | 'kind'>): string {
  return e.isMichael ? 'michael' : e.isResearch ? 'research' : `${e.engine}@${e.version ?? ''}:${e.kind}`;
}

/** Whether a newly opened episode gets Michael's desktop notice (SD10): only
 *  when it starts a card, never for a name joining a card already shown. The
 *  watch sends no notice on Done or on Keep. */
export function noticeForOpened(opened: SilentEpisode, episodes: SilentEpisode[]): boolean {
  const key = silentCardKey(opened);
  return !episodes.some((e) => e.agentId !== opened.agentId && e.state !== 'kept' && silentCardKey(e) === key);
}

/** The cards Needs you shows: kept members have none; Michael's card first. */
export function silentCards(episodes: SilentEpisode[]): SilentCard[] {
  const groups = new Map<string, SilentEpisode[]>();
  for (const e of episodes) {
    if (e.state === 'kept') continue;
    const key = silentCardKey(e);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const cards = [...groups.entries()].map(([key, list]): SilentCard => {
    // The card shows the state that asks the most of the owner.
    const lead = [...list].sort((a, b) => RANK[b.state] - RANK[a.state] || a.since - b.since)[0];
    const known = list.map((e) => e.lastCheckInAt).filter((t): t is number => t !== null);
    return {
      key,
      michael: key === 'michael',
      research: key === 'research',
      agentIds: list.map((e) => e.agentId),
      state: lead.state,
      kind: list.every((e) => e.kind === 'never') ? 'never' : 'quiet',
      stopped: list.some((e) => e.stopped),
      restartTried: list.some((e) => !!e.restartTried),
      engineLabel: lead.engineLabel,
      version: lead.version,
      lastCheckInAt: known.length ? Math.max(...known) : null,
      startedAt: lead.startedAt
    };
  });
  return cards.sort((a, b) => Number(b.michael) - Number(a.michael));
}

/** The buttons a card offers (SD4, SD5, SD13, R3). Research is never kept
 *  working unchecked: Restart is its way back (owner, 2026-10-17). */
export function silentButtons(card: Pick<SilentCard, 'state' | 'stopped' | 'michael'> & { research?: boolean }): Array<'restart' | 'changeEngine' | 'keep'> {
  if (card.state === 'restarting' || card.state === 'checking' || card.state === 'kept') return [];
  if (card.michael || card.research) return ['restart'];
  if (card.state === 'failed') return ['changeEngine', 'keep'];
  return card.stopped ? ['restart', 'keep'] : ['restart'];
}

/** Whether a member's new mail is held for Michael ('hold'), reaches it by
 *  its terminal because the owner kept it unchecked ('handoff'), or flows as
 *  usual (null) (SD12, R4). Michael's own mail is never held. */
export function mailFor(e: SilentEpisode | undefined): 'hold' | 'handoff' | null {
  if (!e || e.isMichael) return null;
  return e.state === 'kept' ? 'handoff' : 'hold';
}
