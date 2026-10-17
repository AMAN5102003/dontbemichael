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
import { CHECK_IN_MS, QUIET_MS, neverReports, guardedWithoutReports, type SilentEpisode, type SilentState } from '../shared/silentEngine';

export interface WatchMember {
  id: string;
  /** Its terminal id; '' when it has none. */
  ptyId: string;
  /** False when no terminal runs now (stopped, or not started yet). */
  running: boolean;
  engine: string;
  engineLabel: string;
  version: string | null;
  isMichael: boolean;
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
  event: (e: { type: 'opened' | 'resolved' | 'kept'; episode: SilentEpisode }) => void;
}

interface Watch {
  ptyId: string;
  firstOutputAt: number | null;
  lastHookAt: number | null;
  /** The finding held on the previous beat (two beats in a row, SD9). */
  pending: boolean;
}

export class SilentWatch {
  private watches = new Map<string, Watch>();
  private early = new Map<string, number>();
  private episodes = new Map<string, SilentEpisode>();

  constructor(private deps: WatchDeps) {}

  /** Episodes saved before the app quit (SD8): kept ones stay kept; the rest
   *  wait for the restored member to check in. */
  restore(saved: SilentEpisode[]): void {
    for (const e of saved) {
      if (!e?.agentId) continue;
      this.episodes.set(e.agentId, e.state === 'kept'
        ? { ...e, stopped: false }
        : { ...e, before: e.state === 'checking' ? e.before ?? 'open' : e.state, state: 'checking', stopped: false });
    }
    this.publish();
  }

  list(): SilentEpisode[] { return [...this.episodes.values()]; }
  episode(agentId: string): SilentEpisode | undefined { return this.episodes.get(agentId); }

  /** Every validated hook event, Claude's status ticks included (hooks.ts onEvent). */
  noteHook(agentId: string | undefined, at = this.deps.now()): void {
    if (!agentId) return;
    const w = this.watches.get(agentId);
    if (w) { w.lastHookAt = at; w.pending = false; } else this.early.set(agentId, at);
    const ep = this.episodes.get(agentId);
    if (ep) {
      this.episodes.delete(agentId);
      this.deps.event({ type: 'resolved', episode: ep });
      this.publish();
    }
  }

  /** The fleet beat (every 8 s): every non archived member, running or not. */
  beat(members: readonly WatchMember[]): void {
    const now = this.deps.now();
    let dirty = false;
    const present = new Set(members.map((m) => m.id));
    // A member removed while its card is open drops off the card.
    for (const id of [...this.episodes.keys()]) if (!present.has(id)) { this.episodes.delete(id); dirty = true; }
    for (const id of [...this.watches.keys()]) if (!present.has(id)) this.watches.delete(id);

    for (const m of members) {
      if (!m.reports) continue;
      const ep = this.episodes.get(m.id);
      // A kept member's choice ends when its engine version changes (SD5).
      if (ep?.state === 'kept' && m.version && ep.version && m.version !== ep.version) {
        this.episodes.delete(m.id);
        dirty = true;
      }
      if (!m.running || !m.ptyId) continue;
      let w = this.watches.get(m.id);
      if (!w || w.ptyId !== m.ptyId) {
        // A new terminal (a start or a restart) checks in afresh.
        w = { ptyId: m.ptyId, firstOutputAt: null, lastHookAt: this.early.get(m.id) ?? null, pending: false };
        this.early.delete(m.id);
        this.watches.set(m.id, w);
      }
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
    const busy = m.lastOutputAt > w.lastHookAt && now - m.lastOutputAt < QUIET_MS;
    const typing = m.lastInputAt > 0 && now - m.lastInputAt < QUIET_MS;
    return busy && !typing && now - w.lastHookAt >= QUIET_MS ? 'quiet' : null;
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
      stopped: false, isMichael: m.isMichael, since: now, lastCheckInAt: w.lastHookAt, startedAt: w.firstOutputAt
    };
    this.episodes.set(m.id, fresh);
    if (kind === 'never' && neverReports(m.engine, m.version)) {
      // Known never to report: no restart that can't help (R6).
      fresh.state = 'failed';
    } else if (kind === 'never' && !m.isMichael && this.deps.mayAutoRestart(m.id) && this.deps.restart(m.id, true)) {
      // Michael restarts it once on his own (SD11); the card waits on the result.
      // The restart reuses the terminal id, so its watch starts afresh.
      fresh.state = 'restarting';
      fresh.restartTried = true;
      this.watches.delete(m.id);
    }
    this.deps.event({ type: 'opened', episode: fresh });
    this.maybeStop(m, fresh);
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
    if (guardedWithoutReports(m.engine, this.deps.platform)) return false;
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
      this.watches.delete(id);
    }
    this.publish();
  }

  /** Keep working unchecked (SD5): no card; starts it again if it was stopped. */
  keep(agentIds: string[]): void {
    for (const id of agentIds) {
      const ep = this.episodes.get(id);
      if (!ep) continue;
      if (ep.stopped && this.deps.restart(id, false)) this.watches.delete(id);
      ep.state = 'kept';
      ep.stopped = false;
      delete ep.before;
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
