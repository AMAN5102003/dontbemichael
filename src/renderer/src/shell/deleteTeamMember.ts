import type { Agent } from '@/store/store';
import { RESEARCH_ID } from '../../../shared/research';

/**
 * Deleting a team member for good, from the Danger zone in Edit agent (owner,
 * 2026-10-14). It replaces the red close button hidden on 2026-09-24, which
 * archived the member with no way back: this says so plainly and is meant to
 * be final, so nothing offers to bring them back.
 *
 * Michael and his assistant run the office, and Research is switched off in
 * Settings, so none of them has it.
 */
export function canDeleteTeamMember(agent: Pick<Agent, 'id' | 'isGod' | 'isAssistant'>): boolean {
  return !agent.isGod && !agent.isAssistant && agent.id !== RESEARCH_ID;
}

/** The app calls behind a delete, passed in so the order can be tested. */
export interface DeleteTeamMemberDeps {
  /** Pause their schedules and mark them closed by the owner (design 6A). */
  closeByOwner: (id: string) => Promise<unknown>;
  /** Work bound to them goes back to the teammates it was taken from. */
  releaseBindings: (id: string) => Promise<void>;
  /** Stop their terminal; the main process archives them in the registry. */
  killPty: (ptyId: string) => Promise<unknown>;
  disposeTerminal: (ptyId: string) => void;
  /** Archive them in the registry when no terminal is running to do it. */
  archiveInRegistry: (id: string) => Promise<unknown>;
  /** Withdraw their open Ask me questions and tell Michael about their open
   *  cards (hive.memberDeleted). */
  settleWork: (id: string) => Promise<unknown>;
  /** Take them off the floor, the archived list and the restore list. */
  forget: (id: string) => void;
}

/**
 * Stop the member and take them off the team. The registry keeps an archived
 * record, the same one every closed member leaves, so Michael's roster skips
 * them; their open questions leave Ask me and Michael hears which cards to
 * give to someone else or close. Each step is best effort:
 * one failing never leaves them half on the floor.
 */
export async function deleteTeamMember(agent: Pick<Agent, 'id' | 'ptyId' | 'isGod' | 'isAssistant'>, deps: DeleteTeamMemberDeps): Promise<boolean> {
  if (!canDeleteTeamMember(agent)) return false;
  await deps.closeByOwner(agent.id).catch(() => undefined);
  // Before forget: the release reads their name from the roster.
  await deps.releaseBindings(agent.id).catch(() => undefined);
  if (agent.ptyId) {
    await deps.killPty(agent.ptyId).catch(() => undefined);
    deps.disposeTerminal(agent.ptyId);
  } else {
    await deps.archiveInRegistry(agent.id).catch(() => undefined);
  }
  // After the stop, so they raise nothing more.
  await deps.settleWork(agent.id).catch(() => undefined);
  deps.forget(agent.id);
  return true;
}
