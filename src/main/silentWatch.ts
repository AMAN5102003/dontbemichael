/**
 * The watch for team members whose engine stops reporting to the app (issue
 * #326; the rules in src/shared/silentEngine.ts). It runs on the fleet beat with
 * a snapshot of each member and hears every hook event, and decides when a
 * member is not reporting, when Michael restarts it once (SD11, R4, R6), when
 * its terminal is stopped (SD13, R1, R2), and when it is reporting again.
 *
 * Every side effect is passed in, so the tests drive it with a fake clock.
 * Built on PR #345's watchdog (thanks to its author), with the owner's rules.
 */
import { BEAT_GAP_MS, BUSY_FRESH_MS, CHECK_IN_MS, LONG_TOOL_MS, QUIET_MS, RESTART_WAIT_MS, neverReports, guardedWithoutReports, type SilentEpisode, type SilentState } from '../shared/silentEngine';

export interface WatchMember {
  id: string;
  /** Its terminal id; '' when it has none. */
  ptyId: string;
  /** False when no terminal runs now (stopped, archived, or not started yet). */
  running: boolean;
  /** The process behind the terminal: a new one (a restart from anywhere, the
   *  terminal id is kept) checks in afresh (ship review 2026-10-17). */
  pid?: number;
  engine: string;
  engineLabel: string;
  version: string | null;
  isMichael: boolean;
  /** Research: stopped wherever it isn't reporting, never kept (owner, 2026-10-17). */
  isResearch?: boolean;
  /** Its engine has a bridge that reports to the app; a hookless custom command
   *  is never watched (R4). */
  reports: boolean;
  /** Claude: its status line reports many times a minute, so mid work silence
   *  means something (SD9). */
  statusTicks: boolean;
  /** Its terminal has shown output since it started. */
  hasOutput: boolean;
  lastOutputAt: number;
  /** The owner's last keystroke into its terminal (pty:write), or 0. */
  lastInputAt: number;
}

export interface WatchDeps {
  now: () => number;
  platform: string;
  /** The shared once per 30 min limit with the stuck path (R4). */
  mayAutoRestart: (agentId: string) => boolean;
  /** Ask the window to restart it keeping its conversation; true when sent. */
  restart: (agentId: string, auto: boolean) => boolean;
  /** End its terminal (R1). */
  stop: (member: WatchMember) => void;
  /** Episodes changed: save them and tell the window. */
  changed: (episodes: SilentEpisode[]) => void;
  /** A member's story moved on: Michael and the owner hear (SD10, SD12). */
  /** `dropped`: it now runs an engine the app doesn't watch, so its card goes. */
  /** `removed`: it left the team, or the owner closed it. */
  event: (e: { type: 'opened' | 'resolved' | 'kept' | 'dropped' | 'removed'; episode: SilentEpisode }) => void;
}

interface Watch {
  ptyId: string;
  pid?: number;
  /** Tool calls under way (PreToolUse with no end yet), several at once
   *  included, and when the latest began: no report comes until they end, so
   *  it is no sign of silence (LONG_TOOL_MS from the latest start, so a call
   *  the app's gate refused, which never ends, can't use up a later one's). */
  openTools: number;
  toolSince: number | null;
  /** The last beat that saw this process, and the last report's event. A
   *  SessionStart after that beat is the next process's first report, carried
   *  over when the restart is noticed; any other report may be the old one's. */
  seenAt: number | null;
  lastEvent: string | null;
  firstOutputAt: number | null;
  lastHookAt: number | null;
  /** When the terminal began printing without a report since: the start of
   *  one unbroken stretch of output, cleared by a report or a pause. */
  busySince: number | null;
  /** The finding held on the previous beat (two beats in a row, SD9). */
  pending: boolean;
  /** A beat saw no process behind it: reports from now on are the next
   *  process's, held as early ones until a beat sees it (2026-10-17: a
   *  restarted Pete's first reports landed here and were lost). */
  gone?: boolean;
}

/** Hook events that end the turn, and with it any tool call left open (one
 *  the app's own gate refused gets no PostToolUse). */
const TURN_ENDS: ReadonlySet<string> = new Set(['Stop', 'StopFailure', 'SessionStart', 'SessionEnd', 'UserPromptSubmit']);

export class SilentWatch {
  private watches = new Map<string, Watch>();
  private early = new Map<string, number>();
  private episodes = new Map<string, SilentEpisode>();
  /** Members with no terminal on the last beat (stopped, crashed, not started). */
  private notRunning = new Set<string>();

  constructor(private deps: WatchDeps) {}

  /** When the last beat ran, so a gap in the beats is seen. */
  private lastBeatAt: number | null = null;

  /** Episodes saved before the app quit (SD8): kept ones stay kept; the rest
   *  wait for the restored member to check in. */
  restore(saved: SilentEpisode[]): void {
    const now = this.deps.now();
    for (const e of saved) {
      if (!e?.agentId) continue;
      this.episodes.set(e.agentId, e.state === 'kept'
        // A keep still waiting on its terminal waits from this launch.
        ? { ...e, stopped: false, ...(e.waitSince !== undefined ? { waitSince: now } : {}) }
        : { ...e, before: e.state === 'checking' ? e.before ?? 'open' : e.state, state: 'checking', stopped: false, waitSince: now });
    }
    this.publish();
  }

  list(): SilentEpisode[] { return [...this.episodes.values()]; }
  episode(agentId: string): SilentEpisode | undefined { return this.episodes.get(agentId); }

  /** Every validated hook event, Claude's status ticks included (hooks.ts onEvent). */
  noteHook(agentId: string | undefined, event?: string, at = this.deps.now()): void {
    if (!agentId) return;
    const w = this.watches.get(agentId);
    if (w && !w.gone) {
      w.lastHookAt = at;
      w.busySince = null;
      w.lastEvent = event ?? null;
      w.pending = false;
      if (event === 'PreToolUse') { w.openTools++; w.toolSince = at; }
      else if (event === 'PostToolUse' || event === 'PostToolUseFailure') { if (w.openTools > 0 && --w.openTools === 0) w.toolSince = null; }
      else if (event && TURN_ENDS.has(event)) { w.openTools = 0; w.toolSince = null; }
    } else this.early.set(agentId, at);
    const ep = this.episodes.get(agentId);
    if (ep) {
      this.episodes.delete(agentId);
      this.deps.event({ type: 'resolved', episode: ep });
      this.publish();
    }
  }

  /** The fleet beat (every 8 s): every member in the registry, archived ones
   *  included (not running), so a card outlives a relaunch, a break or a closed
   *  tab and goes only with the member (SD8; ship review 2026-10-17). */
  beat(members: readonly WatchMember[]): void {
    const now = this.deps.now();
    let dirty = false;
    // After a gap in the beats (sleep, a stall) no stretch of printing or wait
    // for a first report carries over: each starts again from this beat.
    if (this.lastBeatAt !== null && now - this.lastBeatAt > BEAT_GAP_MS) {
      for (const w of this.watches.values()) {
        w.busySince = null;
        w.pending = false;
        if (w.firstOutputAt !== null) w.firstOutputAt = now;
      }
    }
    this.lastBeatAt = now;
    const present = new Set(members.map((m) => m.id));
    // A member removed, closed or deleted while its card is open drops off the
    // card, and Michael hears its mail is his to route (ship review).
    for (const [id, ep] of [...this.episodes]) {
      if (present.has(id)) continue;
      this.episodes.delete(id);
      this.deps.event({ type: 'removed', episode: ep });
      dirty = true;
    }
    for (const id of [...this.watches.keys()]) if (!present.has(id)) this.watches.delete(id);
    for (const id of [...this.notRunning]) if (!present.has(id)) this.notRunning.delete(id);

    for (const m of members) {
      let ep = this.episodes.get(m.id);
      if (!m.reports) {
        // Now on an engine the app doesn't watch: no report can end its card.
        this.watches.delete(m.id);
        if (ep) { this.episodes.delete(m.id); this.deps.event({ type: 'dropped', episode: ep }); dirty = true; }
        continue;
      }
      // A kept member's choice ends when its engine version changes (SD5).
      if (ep?.state === 'kept' && m.version && ep.version && m.version !== ep.version) {
        this.episodes.delete(m.id);
        ep = undefined;
        dirty = true;
      }
      // A keep whose restart never brought a terminal: the card comes back.
      if (ep?.state === 'kept' && ep.waitSince !== undefined) {
        if (m.running) { delete ep.waitSince; delete ep.before; }
        else if (now - ep.waitSince >= RESTART_WAIT_MS) {
          ep.state = ep.before && ep.before !== 'kept' ? ep.before : 'open';
          ep.stopped = true;
          delete ep.before;
          delete ep.waitSince;
          this.deps.event({ type: 'opened', episode: ep });
          dirty = true;
        }
      }
      // A restart that never came back, or a restored member never started:
      // settled, so the card offers its buttons again.
      if (ep && (ep.state === 'restarting' || ep.state === 'checking') && ep.waitSince !== undefined && now - ep.waitSince >= RESTART_WAIT_MS) {
        if (ep.state === 'restarting') { ep.state = 'failed'; ep.restartTried = true; }
        else { ep.state = ep.before && ep.before !== 'restarting' && ep.before !== 'checking' ? ep.before : 'open'; delete ep.before; }
        delete ep.waitSince;
        if (m.running) this.maybeStop(m, ep);
        dirty = true;
      }
      if (!m.running || !m.ptyId) {
        this.notRunning.add(m.id);
        const old = this.watches.get(m.id);
        if (old) old.gone = true;
        continue;
      }
      this.notRunning.delete(m.id);
      let w = this.watches.get(m.id);
      if (!w || w.ptyId !== m.ptyId || (m.pid !== undefined && w.pid !== undefined && w.pid !== m.pid)) {
        // A new terminal or a new process behind it (a start or a restart from
        // anywhere) checks in afresh.
        const fresh = !!w;
        // A report since the old process was last seen came from the new one:
        // it reported before this beat noticed the restart.
        const carried = w && w.lastHookAt !== null && w.seenAt !== null && w.lastHookAt > w.seenAt && w.lastEvent === 'SessionStart' ? w.lastHookAt : null;
        w = { ptyId: m.ptyId, pid: m.pid, firstOutputAt: null, lastHookAt: this.early.get(m.id) ?? carried, busySince: null, pending: false, openTools: 0, toolSince: null, seenAt: null, lastEvent: null };
        this.early.delete(m.id);
        this.watches.set(m.id, w);
        // Its card waits on the new process, on the engine it runs now.
        if (fresh && ep && ep.state !== 'kept') dirty = this.restarted(m, ep, now) || dirty;
        else if (ep?.stopped) { ep.stopped = false; dirty = true; }
        // A restored member's wait counts from its start, not the app's.
        if (ep?.state === 'checking') ep.waitSince = now;
      } else {
        if (w.pid === undefined && m.pid !== undefined) w.pid = m.pid;
        // The same process back after a beat that missed it: its reports since
        // were held as early ones.
        if (w.gone) {
          w.gone = false;
          const early = this.early.get(m.id);
          if (early !== undefined && (w.lastHookAt === null || early > w.lastHookAt)) { w.lastHookAt = early; w.busySince = null; }
          this.early.delete(m.id);
        }
      }
      w.seenAt = now;
      // The clock starts at the first real output, not at spawn (outside voice 1).
      if (m.hasOutput && w.firstOutputAt === null) w.firstOutputAt = now;
      const kind = this.silence(m, w, now);
      if (!kind) { w.pending = false; continue; }
      if (!w.pending) { w.pending = true; continue; }
      dirty = this.confirmed(m, w, kind, now) || dirty;
    }
    if (dirty) this.publish();
  }

  private silence(m: WatchMember, w: Watch, now: number): 'never' | 'quiet' | null {
    if (w.lastHookAt === null) {
      return w.firstOutputAt !== null && now - w.firstOutputAt >= CHECK_IN_MS ? 'never' : null;
    }
    if (!m.statusTicks) return null;
    // Busy means still printing since the last report, and quiet means busy
    // for QUIET_MS without one: an idle screen that redraws once is never quiet.
    // The stretch is tracked through a long tool call, which only defers it.
    const printing = m.lastOutputAt > w.lastHookAt && now - m.lastOutputAt < BUSY_FRESH_MS;
    if (!printing) { w.busySince = null; return null; }
    w.busySince ??= now;
    if (w.toolSince !== null && now - w.toolSince < LONG_TOOL_MS) return null;
    const typing = m.lastInputAt > 0 && now - m.lastInputAt < QUIET_MS;
    return !typing && now - w.busySince >= QUIET_MS && now - w.lastHookAt >= QUIET_MS ? 'quiet' : null;
  }

  /** Silence held on two beats in a row. True when an episode changed. */
  private confirmed(m: WatchMember, w: Watch, kind: 'never' | 'quiet', now: number): boolean {
    const ep = this.episodes.get(m.id);
    if (ep) {
      if (ep.state === 'restarting') return this.fail(m, ep);
      if (ep.state === 'checking') {
        const back: SilentState = ep.before === 'restarting' || !ep.before ? 'open' : ep.before;
        if (back === 'kept') { ep.state = 'kept'; return true; }
        ep.state = back;
        delete ep.before;
        this.maybeStop(m, ep);
        return true;
      }
      if (ep.state === 'open' || ep.state === 'failed') return this.maybeStop(m, ep);
      return false;
    }
    const fresh: SilentEpisode = {
      agentId: m.id, kind, state: 'open', engine: m.engine, engineLabel: m.engineLabel, version: m.version,
      stopped: false, isMichael: m.isMichael, ...(m.isResearch ? { isResearch: true } : {}), since: now, lastCheckInAt: w.lastHookAt, startedAt: w.firstOutputAt
    };
    this.episodes.set(m.id, fresh);
    if (kind === 'never' && neverReports(m.engine, m.version)) {
      // Known never to report: no restart that can't help (R6).
      fresh.state = 'failed';
    } else if (kind === 'never' && !m.isMichael && !m.isResearch && this.deps.mayAutoRestart(m.id) && this.deps.restart(m.id, true)) {
      // Michael restarts it once on his own (SD11); the card waits on the result.
      // Not Research: it is stopped until the owner restarts it (2026-10-17).
      // The restart reuses the terminal id, so its watch starts afresh.
      fresh.state = 'restarting';
      fresh.restartTried = true;
      fresh.waitSince = now;
      this.watches.delete(m.id);
    }
    this.deps.event({ type: 'opened', episode: fresh });
    this.maybeStop(m, fresh);
    return true;
  }

  /** A member started again outside its card (Restart and Continue, a stuck
   *  restart, Change engine): its card waits on the new process like a
   *  restart, and a stop no longer holds, since its terminal runs again. */
  private restarted(m: WatchMember, ep: SilentEpisode, now: number): boolean {
    ep.stopped = false;
    if (ep.state === 'checking') return true;
    if (ep.state !== 'restarting') { ep.state = 'restarting'; ep.restartTried = true; }
    ep.engine = m.engine;
    ep.engineLabel = m.engineLabel;
    if (m.version) ep.version = m.version;
    ep.waitSince = now;
    return true;
  }

  private fail(m: WatchMember, ep: SilentEpisode): boolean {
    ep.state = 'failed';
    this.maybeStop(m, ep);
    return true;
  }

  /** Where nothing else guards its files, a silent member is stopped (SD13, R1,
   *  R2). Never Michael, never while a restart runs. */
  private maybeStop(m: WatchMember, ep: SilentEpisode): boolean {
    if (ep.stopped || ep.isMichael || (ep.state !== 'open' && ep.state !== 'failed')) return false;
    if (guardedWithoutReports(m.engine, this.deps.platform, m.isResearch)) return false;
    this.deps.stop(m);
    ep.stopped = true;
    return true;
  }

  /** The owner pressed Restart (one member or a whole card). */
  restart(agentIds: string[]): void {
    for (const id of agentIds) {
      const ep = this.episodes.get(id);
      if (!ep || ep.state === 'kept') continue;
      if (!this.deps.restart(id, false)) continue;
      ep.state = 'restarting';
      ep.restartTried = true;
      ep.stopped = false;
      ep.waitSince = this.deps.now();
      this.watches.delete(id);
    }
    this.publish();
  }

  /** Keep working unchecked (SD5): no card; starts it again if it was stopped. */
  keep(agentIds: string[]): void {
    for (const id of agentIds) {
      const ep = this.episodes.get(id);
      // Research is never kept unchecked: Restart is its way back (owner, 2026-10-17).
      if (!ep || ep.isResearch) continue;
      // A stopped member is kept only once its terminal is started again;
      // otherwise its card stays, since nothing would reach it.
      // A member with no terminal (stopped by the watch, crashed, or not started
      // after a relaunch) is started again for the keep.
      const wasStopped = ep.stopped || this.notRunning.has(id);
      if (wasStopped) {
        if (!this.deps.restart(id, false)) continue;
        this.watches.delete(id);
      }
      const prior = ep.state;
      ep.state = 'kept';
      ep.stopped = false;
      delete ep.before;
      delete ep.waitSince;
      // Started again for the keep: until its terminal runs, the card can come
      // back (a spawn that failed must not leave a keep with nothing running).
      if (wasStopped) { ep.before = prior; ep.waitSince = this.deps.now(); }
      this.deps.event({ type: 'kept', episode: ep });
    }
    this.publish();
  }

  /** Check again (SD14): drop the keep; the watch looks afresh. */
  checkAgain(agentId: string): void {
    if (this.episodes.get(agentId)?.state !== 'kept') return;
    this.episodes.delete(agentId);
    this.watches.delete(agentId);
    this.publish();
  }

  private publish(): void { this.deps.changed(this.list()); }
}
