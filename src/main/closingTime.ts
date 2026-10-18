/**
 * Closing Time — the graceful, data-loss-free shutdown protocol.
 *
 * Killing the PTYs mid-thought loses whatever the agents were holding in
 * working memory: uncommitted WIP, unrecorded decisions, task cards that
 * don't say where the work stands. "Closing time" closes the floor the way a real office
 * does: the human announces it, every worker packs up and confirms, the
 * manager locks the door.
 *
 *   1. The human clicks "closing time" in the quit dialog.
 *   2. We mail the god agent a shutdown brief: broadcast closing time to the
 *      team; every worker commits/parks WIP, then replies with subject
 *      CLOSING-TIME-ACK saying where each of its cards stands (and when a
 *      step is due at a set time). Michael alone moves the cards (ship
 *      review D8); cards carry no running notes (owner, 2026-10-11).
 *   3. The god waits for every ACK (the harness shows live progress by
 *      watching the same inbox traffic), updates board.md, and sends a
 *      message with subject CLOSING-TIME-COMPLETE.
 *   4. The router observer spots that message → the app tears down and quits.
 *
 * While it runs, the dialog lists who is still working, who confirmed and who
 * the owner chose to close without (owner, 2026-09-29). The owner can remind
 * one agent (Michael included) or close without one team member: that agent
 * is no longer waited on, nothing is stopped now, and its terminal ends with
 * every other one at quit, so it is back tomorrow.
 *
 * Everything rides the existing hive rails: inbox delivery, the idle
 * inbox-wake nudge, and Stop-hook draining already guarantee the messages
 * get acted on. This module only injects the kickoff mail and watches the
 * routed traffic — it never types into terminals.
 *
 * Runs in the Electron main process.
 */
import type { WebContents } from 'electron';
import type { HiveManager, HiveMessage } from './hive';
import type { ControlRegistry } from './control';
import { CLOSING_COMPLETE_RE, CLOSING_TIME_REMIND_MS } from '../shared/closingTime';
import { RESEARCH_ID } from '../shared/research';

export type ClosingTimePhase =
  | 'started' | 'progress' | 'complete' | 'timeout' | 'cancelled';

export interface ClosingTimeEvent {
  phase: ClosingTimePhase;
  /** Workers that have ACKed so far / every worker closing time started
   *  with, including any later closed without or whose terminal ended (see
   *  `waiting` for who is still waited on). */
  acked: number;
  total: number;
  /** Team members who confirmed. */
  confirmed: string[];
  /** Team members still being waited on: not confirmed, not excused, and
   *  with a live terminal. */
  waiting: string[];
  /** Team members the owner chose to close without. */
  excused: string[];
  /** Michael's id, for his own row. */
  godId: string;
  /** False once Michael's terminal has ended: closing time cannot finish. */
  godLive: boolean;
  /** The app reopens itself after closing (a Claude Code update, cliUpdate.ts). */
  relaunch: boolean;
}

export type ClosingTimeActionResult = { ok: true } | { ok: false; error: string };

/** Subject markers. Deliberately forgiving (case, -/_/space) — agents write
 *  these by hand, so "Closing Time Ack" must count as well as the canonical
 *  CLOSING-TIME-ACK the brief asks for. */
const ACK_RE = /CLOSING[-_\s]*TIME[-_\s]*ACK/i;
const COMPLETE_RE = CLOSING_COMPLETE_RE;

/** How long to wait before surfacing "this is taking long — force quit?".
 *  Compaction or a long tool call can easily hold an ACK for a few minutes. */
const TIMEOUT_MS = 6 * 60_000;
/** Grace after COMPLETE before tearing down, so the god's final commit/log
 *  writes land on disk and the floor visibly concludes. */
const TEARDOWN_GRACE_MS = 2_500;

/** What each team member is told when closing time starts, and on Remind. */
const WORKER_STEER = 'Closing time: the office is closing. Finish your current step but do not start new work. Save any work in progress, then send Michael ("to": "michael") a message with the subject exactly "CLOSING-TIME-ACK" saying where each of your cards stands, with the time when its next step is due at a set time.';
/** Why closing time cannot run: no live Michael to collect the reports. */
const NO_GOD_ERROR = 'No orchestrator is running. Closing time needs the god agent to collect the reports.';
/** What Michael is told when closing time starts, and on Remind. */
const GOD_STEER = 'The owner pressed closing time: pause your current work at the next sensible point and read your inbox, where the closing steps are waiting. Close the office before anything else.';

export class ClosingTimeController {
  private active = false;
  private godId = 'god';
  private relaunch = false;
  private workers = new Set<string>();
  private acked = new Set<string>();
  private excused = new Set<string>();
  private lastRemind = new Map<string, number>();
  /** Set once COMPLETE is accepted. `active` stays true through the teardown
   *  grace, so this is what keeps a late refresh from reopening the rows. */
  private concluded = false;
  /** Set when the 6-minute timeout fires, so later row updates keep the
   *  "still wrapping up" view instead of flipping back to plain progress. */
  private timedOut = false;
  /** Team members whose ended terminal Michael has been told about. */
  private toldEnded = new Set<string>();
  private timeoutTimer: NodeJS.Timeout | null = null;
  private teardownTimer: NodeJS.Timeout | null = null;

  constructor(
    private hive: HiveManager,
    /** Agent ids that have a LIVE PTY right now. The hive registry alone is
     *  not enough: agents that died with the app (hard quit, crash) keep
     *  their registry record without ever being flagged `archived`, so a
     *  registry-based roster waits on ghosts that can never ACK. */
    private getLiveAgentIds: () => string[],
    private getWebContents: () => WebContents | null,
    /** Called once the god concluded — runs the real teardown + app.quit(),
     *  relaunching first when the closing was started with `relaunch`. */
    private onConcluded: (relaunch: boolean) => void,
    /** Mid-run steering (#7C.2): lets closing time reach DEEPLY BUSY agents at
     *  their next hook boundary instead of waiting for the Stop-hook inbox
     *  drain — the graceful interrupt. Optional so tests can omit it. */
    private control?: ControlRegistry
  ) {}

  isActive(): boolean {
    return this.active;
  }

  /** Kick off the protocol. Returns an error string when the floor cannot run
   *  it (no live god agent) so the UI can fall back to the hard quit. */
  start(opts: { relaunch?: boolean } = {}): { ok: boolean; error?: string } {
    if (this.active) {
      // Already closing down after COMPLETE: nothing to restart.
      if (this.concluded) return { ok: false, error: 'Closing time has finished; the app is closing.' };
      // Re-pressed while running (e.g. from the timeout view): keep waiting,
      // unless Michael is gone, when waiting can never end.
      if (!this.getLiveAgentIds().includes(this.godId)) {
        return { ok: false, error: NO_GOD_ERROR };
      }
      // A reopen asked for on the way out still counts.
      if (opts.relaunch) this.relaunch = true;
      this.timedOut = false;
      this.armTimeout();
      this.emitProgress();
      return { ok: true };
    }
    const reg = this.hive.registry();
    this.godId = reg.godId ?? 'god';
    const live = new Set(this.getLiveAgentIds());
    if (!reg.agents[this.godId] || !live.has(this.godId)) {
      return { ok: false, error: NO_GOD_ERROR };
    }

    // Only agents with a live terminal are waited on — the registry is just
    // metadata here (names + god/assistant flags), never the roster source.
    this.workers = new Set(
      [...live].filter((id) => {
        const a = reg.agents[id];
        // Research holds no cards and reaches nobody's turn unchecked, so
        // closing time neither waits on it nor steers it (ship review pass 3).
        return id !== this.godId && id !== RESEARCH_ID && !!a && !a.isGod;
      })
    );
    this.acked = new Set();
    this.excused = new Set();
    this.lastRemind = new Map();
    this.concluded = false;
    this.timedOut = false;
    this.toldEnded = new Set();
    this.active = true;
    this.relaunch = opts.relaunch === true;

    const names = [...this.workers]
      .map((id) => `${reg.agents[id]?.name ?? id} (${id})`)
      .join(', ') || '(none: the office is just you)';

    this.hive.send({
      to: 'god',
      act: 'request',
      subject: 'Closing time: close the office now',
      body: [
        'The owner pressed "closing time". The app closes as soon as you confirm the office is safe to close. Do this now, before anything else:',
        '',
        `1. Tell the team it is closing time (a message with "to": "broadcast"). Team members now: ${names}.`,
        '   Ask each to save any work in progress and then reply to you with the subject exactly "CLOSING-TIME-ACK", saying where each of its cards stands.',
        '2. Keep working your inbox until every team member above has sent CLOSING-TIME-ACK. Remind anyone slow once if needed.',
        '3. Move each card on tasks.json to match what the team told you, with nextAt when its next step is due at a set time, and update board.md so it says where every piece of work stands. Session logs do not go in memory: it holds only lessons worth keeping.',
        '4. Then send a message with "to": "human" and the subject exactly "CLOSING-TIME-COMPLETE"; the app watches for it and closes. Send it only after every team member has acknowledged: the app checks the acknowledgements and rejects an early one.',
        '',
        this.workers.size === 0
          ? 'Nobody else is in the office right now, so do steps 3 and 4 straight away.'
          : 'This is a shutdown: do not start new work or accept new tasks.',
        ...(this.workers.size === 0 ? ['This is a shutdown: do not start new work or accept new tasks.'] : [])
      ].join('\n')
    }, 'human');

    // Graceful interrupt for the deeply busy (#7C.2): the inbox brief above
    // only lands when an agent next STOPS — a worker hours into a task would
    // hold the whole shutdown. A steer note rides the next hook boundary
    // (PostToolUse/UserPromptSubmit) instead, so every live agent learns about
    // closing time within one tool call. Idle agents are covered by the
    // inbox-wake nudge; busy ones by the steer — both rails, no PTY typing.
    this.control?.steer(this.godId, GOD_STEER);
    for (const id of this.workers) this.control?.steer(id, WORKER_STEER);

    this.armTimeout();
    this.emitState('started');
    return { ok: true };
  }

  /** Human changed their mind — stand the floor back up. */
  cancel(): void {
    if (!this.active) return;
    this.cleanup();
    this.excused = new Set();
    this.lastRemind = new Map();
    // Drop closing-time steers that no hook boundary has consumed yet, so a
    // busy agent doesn't get told to shut down AFTER the human cancelled.
    // Agents that already saw the note get corrected via the god (below).
    this.control?.clearSteers(this.godId);
    for (const id of this.workers) this.control?.clearSteers(id);
    this.emitState('cancelled');
    // Everyone, not only Michael: a team member who already acknowledged was
    // told not to start new work (office open, owner 2026-09-26).
    try {
      this.hive.send({
        to: 'broadcast',
        act: 'inform',
        subject: 'Closing time cancelled',
        body: 'The owner cancelled closing time. The office stays open: carry on as normal, and do anything you held because of closing time. Anything already saved stays saved.'
      }, 'human');
    } catch { /* best-effort */ }
  }

  /**
   * Remind one agent (owner, 2026-09-29): the steer again, for an agent busy
   * in a tool call, plus an inbox note, for an idle one that no hook boundary
   * will reach. Michael can be reminded too. At most once per agent per 30 s.
   */
  remind(id: unknown, now: number = Date.now()): ClosingTimeActionResult {
    if (!this.active || this.concluded) return { ok: false, error: 'Closing time is not running.' };
    if (typeof id !== 'string') return { ok: false, error: 'Unknown team member.' };
    const isGod = id === this.godId;
    if (isGod && !this.getLiveAgentIds().includes(this.godId)) return { ok: false, error: "Michael's terminal has ended." };
    if (!isGod && (!this.workers.has(id) || this.acked.has(id) || this.excused.has(id) || !this.getLiveAgentIds().includes(id))) {
      return { ok: false, error: 'Nobody to remind.' };
    }
    const at = this.lastRemind.get(id);
    // One per agent per CLOSING_TIME_REMIND_MS, so a double click sends one.
    if (at !== undefined && now - at < CLOSING_TIME_REMIND_MS) return { ok: true };
    this.lastRemind.set(id, now);
    // Once nobody is left, Remind on Michael is the owner's only move: retry
    // any "terminal ended" note that has not gone through yet.
    if (isGod) this.tellMichaelAboutEnded();
    try {
      this.hive.send(isGod
        ? { to: this.godId, act: 'request', subject: 'Closing time: reminder', body: 'Reminder: the owner is waiting to close the office. Pause your current work, read the closing steps in your inbox, and send CLOSING-TIME-COMPLETE once every team member has acknowledged.' }
        : { to: id, act: 'request', subject: 'Closing time: reminder', body: `Reminder: ${WORKER_STEER}` }, 'human');
    } catch (e) {
      // An idle agent is reached only by the note, so a failed note is a
      // failed Remind: say so and allow a retry at once (owner, 2026-09-29).
      console.error('[closing-time] remind mail:', e);
      this.lastRemind.delete(id);
      return { ok: false, error: 'The reminder could not be sent. Try again.' };
    }
    // Steered only once the note went out. Any undelivered copy is dropped
    // first, so repeated Reminds leave one copy in the agent's queue.
    const steer = isGod ? GOD_STEER : WORKER_STEER;
    this.control?.removeSteer(id, steer);
    this.control?.steer(id, steer);
    console.log(`[closing-time] remind ${id}`);
    return { ok: true };
  }

  /**
   * Close without one team member (owner, 2026-09-29): stop waiting on it and
   * tell Michael. Nothing is stopped here. Its terminal ends with every other
   * one when the app quits, which keeps the agent for tomorrow; `pty:kill`
   * would archive it. Never for Michael, who closes the office.
   */
  excuse(id: unknown): ClosingTimeActionResult {
    if (!this.active || this.concluded) return { ok: false, error: 'Closing time is not running.' };
    if (typeof id !== 'string' || id === this.godId || !this.workers.has(id) || this.acked.has(id) || this.excused.has(id)) {
      return { ok: false, error: 'Nobody to close without.' };
    }
    const name = this.hive.registry().agents[id]?.name ?? id;
    // Michael must hear about it, or he keeps waiting for this agent's ACK and
    // the office never closes: if the note fails, nothing changes and the
    // owner can try again (owner, 2026-09-29).
    try {
      this.hive.send({
        to: this.godId,
        act: 'inform',
        subject: `Closing time: closing without ${name}`,
        body: `The owner chose to close without ${name} (${id}). Do not wait for their CLOSING-TIME-ACK; send CLOSING-TIME-COMPLETE once everyone else has acknowledged.`
      }, 'human');
    } catch (e) {
      console.error('[closing-time] excuse mail:', e);
      return { ok: false, error: `Michael could not be told. ${name} is still being waited on; try again.` };
    }
    this.excused.add(id);
    // Only the closing-time note: the owner's other notes still reach it.
    this.control?.removeSteer(id, WORKER_STEER);
    console.log(`[closing-time] excuse ${id}`);
    this.emitProgress();
    return { ok: true };
  }

  /** Re-send the rows when a terminal ended or a team member was archived
   *  mid-close, so its row goes. Only for Michael or a team member being
   *  waited on: ephemeral workers end all the time and are not part of
   *  closing time. */
  refresh(agentId?: string): void {
    if (!this.active || this.concluded) return;
    if (agentId !== undefined && agentId !== this.godId && !this.workers.has(agentId)) return;
    this.emitProgress();
  }

  /**
   * A waited-on team member's terminal is running again mid-close (restarted,
   * or brought back from the archive). It is waited on again: the new session
   * never saw closing time, so it gets the closing note and the steer, and
   * Michael, if he was told its terminal ended, is told to wait for it after all.
   */
  revive(agentId: string): void {
    if (!this.active || this.concluded || !this.workers.has(agentId)) return;
    if (this.acked.has(agentId) || this.excused.has(agentId) || !this.getLiveAgentIds().includes(agentId)) return;
    const name = this.hive.registry().agents[agentId]?.name ?? agentId;
    try {
      this.hive.send({ to: agentId, act: 'request', subject: 'Closing time', body: WORKER_STEER }, 'human');
      if (this.toldEnded.delete(agentId)) {
        this.hive.send({
          to: this.godId,
          act: 'inform',
          subject: `Closing time: ${name} is back`,
          body: `${name} (${agentId}) is running again, so wait for their CLOSING-TIME-ACK after all before you send CLOSING-TIME-COMPLETE.`
        }, 'human');
      }
    } catch (e) { console.error('[closing-time] revive mail:', e); }
    this.control?.removeSteer(agentId, WORKER_STEER);
    this.control?.steer(agentId, WORKER_STEER);
    this.emitProgress();
  }

  /** A row update: first tells Michael about any waited-on terminal that
   *  ended, then keeps the "still wrapping up" view once the timeout fired. */
  private emitProgress(): void {
    this.tellMichaelAboutEnded();
    this.emitState(this.timedOut ? 'timeout' : 'progress');
  }

  /**
   * A waited-on team member whose terminal ended, or who was archived, is off
   * the list. Michael was told to wait for everyone, so he is told to stop
   * waiting for this one, or he waits until the timeout while the rows look
   * done (owner, 2026-09-29).
   * Marked told only once the note went out, so a failed note is retried on
   * the next row update.
   */
  private tellMichaelAboutEnded(): void {
    try { this.tellMichaelAboutEndedUnsafe(); } catch (e) { console.error('[closing-time] ended check:', e); }
  }

  private tellMichaelAboutEndedUnsafe(): void {
    const live = new Set(this.getLiveAgentIds());
    const reg = this.hive.registry();
    const ended = [...this.workers].filter(
      (id) => !this.acked.has(id) && !this.excused.has(id) && !this.toldEnded.has(id) && (!live.has(id) || reg.agents[id]?.archived)
    );
    for (const id of ended) {
      const name = reg.agents[id]?.name ?? id;
      const archived = live.has(id);
      try {
        this.hive.send({
          to: this.godId,
          act: 'inform',
          subject: archived ? `Closing time: ${name} was archived` : `Closing time: ${name}'s terminal ended`,
          body: `${name} (${id}) ${archived ? 'was archived' : 'is no longer running'}, so no CLOSING-TIME-ACK will come from them. Do not wait for it; send CLOSING-TIME-COMPLETE once everyone else has acknowledged.`
        }, 'human');
        this.toldEnded.add(id);
      } catch (e) { console.error('[closing-time] ended mail:', e); }
    }
  }

  /** Team members still being waited on: not confirmed, not excused, and
   *  with a live terminal that is not archived (a dead one can never ACK). */
  private pendingIds(reg = this.hive.registry()): string[] {
    const liveNow = new Set(this.getLiveAgentIds());
    return [...this.workers].filter(
      (id) => !this.acked.has(id) && !this.excused.has(id) && liveNow.has(id) && !reg.agents[id]?.archived
    );
  }

  /** Router observer — called by the hive for every routed message. */
  onRouted(msg: HiveMessage, targets: string[]): void {
    // Nothing reopens a concluded close during its teardown grace, e.g. a late
    // ACK from an agent the owner closed without.
    if (!this.active || this.concluded) return;
    // A worker reporting in. Counted only for known workers, and only when the
    // ACK actually reached the god (not e.g. a stray broadcast echo).
    if (ACK_RE.test(msg.subject) && this.workers.has(msg.from) && targets.includes(this.godId)) {
      if (!this.acked.has(msg.from)) {
        this.acked.add(msg.from);
        // Closed without, but confirmed anyway: it moves to confirmed.
        this.excused.delete(msg.from);
        this.emitProgress();
      }
      return;
    }
    // The god concluding. COMPLETE is only honored from the god itself — a
    // worker can't (accidentally or otherwise) shut down the whole floor.
    if (COMPLETE_RE.test(msg.subject) && msg.from === this.godId) {
      // Trust but VERIFY: the god is told to wait for every ACK, but the
      // whole point of closing time is that no worker loses unsaved state —
      // so a premature COMPLETE must not close the floor. Workers whose
      // terminal died mid-protocol (tab closed, crash) are not waited on
      // (pendingIds drops them): their ACK can never arrive and their session
      // is gone either way.
      const reg = this.hive.registry();
      const pending = this.pendingIds(reg);
      if (pending.length > 0) {
        const names = pending.map((id) => `${reg.agents[id]?.name ?? id} (${id})`).join(', ');
        this.hive.send({
          to: 'god',
          act: 'refuse',
          subject: 'Closing time: still waiting on the team',
          body: [
            `The app has no CLOSING-TIME-ACK yet from: ${names}.`,
            'It stays open until every team member has confirmed its work is saved.',
            'Ask each of them again, wait for their acknowledgements, then send CLOSING-TIME-COMPLETE again.'
          ].join('\n')
        }, 'human');
        this.emitProgress();
        return;
      }
      this.cleanup();
      this.active = true; // stays "active" through the grace so the UI holds
      this.concluded = true;
      this.emitState('complete');
      this.teardownTimer = setTimeout(() => {
        this.active = false;
        this.onConcluded(this.relaunch);
      }, TEARDOWN_GRACE_MS);
    }
  }

  private armTimeout(): void {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = setTimeout(() => {
      if (this.active) { this.timedOut = true; this.tellMichaelAboutEnded(); this.emitState('timeout'); }
    }, TIMEOUT_MS);
  }

  private cleanup(): void {
    if (this.timeoutTimer) { clearTimeout(this.timeoutTimer); this.timeoutTimer = null; }
    if (this.teardownTimer) { clearTimeout(this.teardownTimer); this.teardownTimer = null; }
    this.active = false;
  }

  private emitState(phase: ClosingTimePhase): void {
    const waiting = this.active && !this.concluded ? this.pendingIds() : [];
    const ev: ClosingTimeEvent = {
      phase,
      acked: this.acked.size,
      total: this.workers.size,
      confirmed: [...this.acked],
      waiting,
      excused: [...this.excused],
      godId: this.godId,
      godLive: this.getLiveAgentIds().includes(this.godId),
      relaunch: this.relaunch
    };
    try { this.getWebContents()?.send('app:closingTime', ev); } catch { /* window tore down */ }
  }
}
