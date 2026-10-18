/**
 * Team members' schedule requests (owner, 2026-09-27). Office management is
 * Michael's: a team member's request goes to him to approve or decline, and he
 * passes it to the owner in ASK ME only when the facts can't settle it,
 * sources conflict, or it is sensitive. Michael's own changes apply at once.
 *
 * Moved out of index.ts with everything it touches passed in, so tests can run
 * it with a fake config and hive (TODOS: "Test Michael deciding schedule
 * requests end to end").
 */
import { randomBytes } from 'node:crypto';
import { RESEARCH_ID } from '../shared/research';
import {
  applyScheduleRequest, buildScheduleRequest, fileScheduleRequest, foldScheduleRequests, missionsFor, requestSummary, whenWords,
  type ScheduledMission, type ScheduleRequest
} from '../shared/missions';

/** How long Michael has to decide a request before it goes to the owner. */
export const MICHAEL_DECIDES_WITHIN_MS = 12 * 60 * 60 * 1000;

export interface ScheduleRequestDeps {
  readConfig: () => { missions?: ScheduledMission[]; scheduleRequests?: ScheduleRequest[] };
  writeConfig: (patch: { scheduleRequests: ScheduleRequest[] }) => void;
  /** Saves a change to the schedules (index.ts applyMissions); null from `change` refuses it. */
  applyMissions: (change: (list: ScheduledMission[]) => ScheduledMission[] | null) => { ok: true } | { ok: false; error: string };
  godId: () => string;
  michaelName: () => string;
  /** A team member's name, or undefined when unknown. */
  agentName: (id: string) => string | undefined;
  hive: { enabled: () => boolean; send: (msg: { to: string; act: 'request' | 'inform'; subject: string; body: string }, from: string) => void };
  /** The window's request list changed. */
  updated: () => void;
  ownerToast: (title: string, body: string) => void;
  now?: () => number;
}

export function makeScheduleRequests(deps: ScheduleRequestDeps) {
  const { readConfig, writeConfig, applyMissions, hive } = deps;
  const now = deps.now ?? Date.now;
  const updated = (): void => { try { deps.updated(); } catch { /* window gone */ } };

  /**
   * An agent asked (from its outbox) about one of its schedules. The return
   * text is the scheduler's reply to the asking agent.
   */
  function receiveScheduleRequest(actor: string, payload: unknown, why = ''): string {
    if (actor === RESEARCH_ID) return 'You have no schedules: you answer the questions teammates send you.';
    const cfg = readConfig();
    const godId = deps.godId();
    const op = payload && typeof payload === 'object' ? (payload as { op?: unknown }).op : undefined;
    // Michael deciding a team member's request.
    if (actor === godId && (op === 'approve' || op === 'decline' || op === 'ask-owner' || op === 'pending')) {
      return michaelDecides(payload as { op: string; request?: unknown; note?: unknown });
    }
    // "list" is a question, not a change: answer it directly with the ids an
    // update, pause, resume or delete request needs.
    if (op === 'list') {
      const mine = missionsFor(cfg.missions ?? [], actor, godId);
      return mine.length === 0
        ? 'You have no schedules.'
        : ['Your schedules (id: job):', ...mine.map((m) => `${m.id}: ${m.label}, ${whenWords(m)}${m.enabled ? '' : ' (paused)'}`)].join('\n');
    }
    const at = now();
    const built = buildScheduleRequest(actor, payload, cfg.missions ?? [], godId, at, `sr_${at.toString(36)}_${randomBytes(3).toString('hex')}`, why);
    if (!built.ok) return `Schedule request not sent: ${built.reason}`;
    // Michael's own schedules: he manages the office, so the change applies now.
    if (actor === godId) {
      let refused = '';
      const res = applyMissions((list) => {
        const applied = applyScheduleRequest(built.request, list, `m_${now().toString(36)}`, now());
        if (!applied.ok) { refused = applied.error; return null; }
        return applied.missions.map((m) => (m.id === applied.missionId ? { ...m, approvedBy: 'michael' as const } : m));
      });
      if (refused || !res.ok) return `Schedule not changed: ${refused || (!res.ok ? res.error : '')}.`;
      return `Done: ${requestSummary(built.request, cfg.missions ?? [])}.`;
    }
    // A request about a job this agent already has waiting joins it as one
    // (owner, 2026-09-27).
    const before = cfg.scheduleRequests ?? [];
    const filed = fileScheduleRequest(before, built.request, cfg.missions ?? []);
    const joined = filed.length === before.length;
    const request = filed.find((r) => r.id === built.request.id) ?? built.request;
    writeConfig({ scheduleRequests: filed.map((r) => (r.id === request.id ? { ...r, sentToMichael: true, sentToMichaelAt: now() } : r)) });
    updated();
    tellMichaelAboutRequest(request, cfg.missions ?? []);
    return joined
      ? 'This joins or replaces your earlier request about the same job, and Michael decides it as one. Nothing changes until he does; you will get a message either way.'
      : 'Sent to Michael to decide. Nothing changes until he does; you will get a message either way.';
  }

  /** Michael hears about a team member's request, with how to decide it. */
  function tellMichaelAboutRequest(req: ScheduleRequest, missions: ScheduledMission[]): void {
    if (!hive.enabled()) return;
    let name = req.agentId;
    try { name = deps.agentName(req.agentId)?.trim() || name; } catch { /* keep the id */ }
    hive.send({
      to: deps.godId(), act: 'request',
      subject: `Schedule request from ${name}`,
      body: [
        `${name} asks to ${requestSummary(req, missions)}.${req.reason ? ` Why: ${req.reason}` : ''}`,
        `Request id: ${req.id}. You decide it: send the scheduler {"op": "approve", "request": "${req.id}"} or {"op": "decline", "request": "${req.id}", "note": "why"}.`,
        `Pass it to the owner only when the facts can't settle it, sources conflict, or it is sensitive: {"op": "ask-owner", "request": "${req.id}", "note": "what you can't settle"}.`
      ].join('\n')
    }, 'scheduler');
  }

  /**
   * Keep every waiting schedule request moving: one Michael hasn't heard about
   * (filed before he decided them) is offered to him once, and one he hasn't
   * decided within MICHAEL_DECIDES_WITHIN_MS goes to the owner in ASK ME, so no
   * request is stranded (pre-landing review, 2026-09-27). Runs at launch and
   * every half hour.
   */
  function sweepScheduleRequests(at = now()): void {
    const cfg = readConfig();
    const before = cfg.scheduleRequests ?? [];
    const pending = foldScheduleRequests(before, cfg.missions ?? []);
    const fresh = pending.filter((r) => !r.escalated && !r.sentToMichael);
    const overdue = pending.filter((r) => !r.escalated && r.sentToMichael && at - (r.sentToMichaelAt ?? r.createdAt) > MICHAEL_DECIDES_WITHIN_MS);
    if (!fresh.length && !overdue.length) {
      if (pending.length !== before.length) writeConfig({ scheduleRequests: pending });
      return;
    }
    for (const r of fresh) tellMichaelAboutRequest(r, cfg.missions ?? []);
    const note = `${deps.michaelName()} did not decide this within 12 hours.`;
    writeConfig({
      scheduleRequests: pending.map((r) => {
        if (fresh.includes(r)) return { ...r, sentToMichael: true, sentToMichaelAt: at };
        if (overdue.includes(r)) return { ...r, escalated: true, escalation: note };
        return r;
      })
    });
    updated();
    if (overdue.length) deps.ownerToast(deps.michaelName(), `${overdue.length === 1 ? 'A schedule change needs' : `${overdue.length} schedule changes need`} you in ASK ME.`);
  }

  /** Michael's answer to a request: approve, decline, pass it to the owner, or
   *  list what is waiting. */
  function michaelDecides(p: { op: string; request?: unknown; note?: unknown }): string {
    const cfg = readConfig();
    const pending = cfg.scheduleRequests ?? [];
    if (p.op === 'pending') {
      const open = pending.filter((r) => !r.escalated);
      return open.length
        ? ['Schedule requests waiting for you (id: request):', ...open.map((r) => `${r.id}: ${requestSummary(r, cfg.missions ?? [])}`)].join('\n')
        : 'No schedule requests are waiting for you.';
    }
    const id = typeof p.request === 'string' ? p.request : '';
    const note = typeof p.note === 'string' ? p.note.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    const req = pending.find((r) => r.id === id);
    if (!req) return 'No waiting request has that id: it may have been decided, or joined with a newer one. Send {"op": "pending"} to see what is waiting.';
    // Once it is with the owner it is theirs to decide.
    if (req.escalated) return 'That request is with the owner in ASK ME now; you will hear when they decide.';
    if (p.op === 'ask-owner') {
      if (!note) return 'Add a "note" saying what you can\'t settle, for the owner\'s card.';
      writeConfig({ scheduleRequests: pending.map((r) => (r.id === id ? { ...r, escalated: true, escalation: note } : r)) });
      updated();
      let name = 'A team member';
      try { name = deps.agentName(req.agentId)?.trim() || name; } catch { /* keep the fallback */ }
      // Only Michael notifies the owner (docs/designs/michael-only-notifications.md).
      deps.ownerToast(deps.michaelName(), `${name}'s schedule change needs you in ASK ME.`);
      return 'Passed to the owner in ASK ME. You will hear when they decide.';
    }
    const res = decideScheduleRequest(id, p.op === 'approve', 'michael', note);
    if (!res.ok) {
      return res.error === 'stale'
        ? 'That schedule changed since the request was made, so it can\'t be applied. Decline it and ask the team member to send a new one.'
        : `Not applied: ${res.error}.`;
    }
    return p.op === 'approve' ? 'Approved and in place.' : 'Declined. Nothing changed.';
  }

  /** A request was approved or declined, by Michael or by the owner in ASK ME.
   *  Approval applies exactly that one change; a request whose schedule changed
   *  since it was asked is refused. The asking agent is told either way. */
  function decideScheduleRequest(id: string, approve: boolean, by: 'owner' | 'michael' = 'owner', note = ''): { ok: true } | { ok: false; error: string } {
    const cfg = readConfig();
    const req = (cfg.scheduleRequests ?? []).find((r) => r.id === id);
    if (!req) return { ok: false, error: 'not found' };
    // Name the schedule before the change: after an approved delete it's gone.
    const described = requestSummary(req, cfg.missions ?? []);
    if (approve) {
      let refused = '';
      // Apply against the list as it is when written (applyMissions reads it fresh).
      const res = applyMissions((list) => {
        const applied = applyScheduleRequest(req, list, `m_${now().toString(36)}`, now());
        if (!applied.ok) { refused = applied.error; return null; }
        return applied.missions.map((m) => (m.id === applied.missionId ? { ...m, approvedBy: by } : m));
      });
      if (refused) return { ok: false, error: refused };
      if (!res.ok) return res;
    }
    writeConfig({ scheduleRequests: (readConfig().scheduleRequests ?? []).filter((r) => r.id !== id) });
    updated();
    if (hive.enabled()) {
      const who = by === 'michael' ? deps.michaelName() : 'The owner';
      hive.send({
        to: req.agentId, act: 'inform',
        subject: approve ? 'Schedule change approved' : 'Schedule change declined',
        body: `${who} ${approve ? 'approved' : 'declined'}: ${described}. ${approve ? 'It is in place now.' : 'Nothing changed.'}${note ? ` Note: ${note}` : ''}`
      }, 'scheduler');
      // The owner decided one Michael passed on: he hears the outcome too.
      if (by === 'owner' && req.escalated) {
        hive.send({ to: deps.godId(), act: 'inform', subject: `Owner ${approve ? 'approved' : 'declined'} a schedule change`, body: `${described}.` }, 'scheduler');
      }
    }
    return { ok: true };
  }

  return { receiveScheduleRequest, michaelDecides, decideScheduleRequest, sweepScheduleRequests };
}
