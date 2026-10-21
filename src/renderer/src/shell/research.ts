/**
 * Turning Research on and off from the renderer (issue #230,
 * docs/designs/research-agent-privacy.md). Research is hired the way the
 * onboarding team is: the main process saves the owner's choice and makes its
 * desk, then it is spawned on Claude (the privacy wall leans on Claude Code's
 * hooks and sandbox) and its card is added. Turning it off sends its waiting
 * asks back, closes its terminal and archives it; turning it on again brings
 * the same member back, notes included.
 */
import { useStore } from '@/store/store';
import { ACTION_CLOCKING_IN } from '@/store/store';
import { buildSpawnCommand, type HarnessConfig } from '@/store/config';
import { tokenizeCommand } from '../../../shared/commandLine';
import { teamAccent } from '../../../shared/teamPlan';
import { RESEARCH_ID, RESEARCH_NAME, RESEARCH_ROLE, RESEARCH_WORK_STYLE } from '../../../shared/research';
import { disposeTerminal } from '@/components/terminalPool';
import { RESEARCH_CHARACTER } from '@/scene/office/cast';
import { browserStorage, forgetWelcome } from '@/scene/office/peteWelcome';
import { ROSTER_BOOT_HOME } from '@/store/store';

export const RESEARCH_PTY_ID = `pty-${RESEARCH_ID}`;
/** Its role line on the floor and in the roster. */
export const RESEARCH_DESCRIPTION = `${RESEARCH_ROLE}: looks things up on the internet for the team`;

/** Research's current name (owner, ship 2 D17: the owner may rename it, Pete by
 *  default): as the floor or the archive has it. */
type NameLists = { agents: Array<{ id: string; name?: string }>; archivedAgents: Array<{ id: string; name?: string }>; restorableAgents?: Array<{ id: string; name?: string }> };
const nameIn = (s: NameLists): string =>
  [s.agents, s.archivedAgents, s.restorableAgents ?? []].map((l) => l.find((a) => a.id === RESEARCH_ID)).find(Boolean)?.name?.trim() || RESEARCH_NAME;

export function researchNameNow(): string {
  return nameIn(useStore.getState() as unknown as NameLists);
}

/** The same, for a component that redraws when it changes. */
export function useResearchName(): string {
  return useStore((s) => nameIn(s as unknown as NameLists));
}

/** Is Research on the floor now, with a terminal. */
export function researchOnFloor(): boolean {
  return useStore.getState().agents.some((a) => a.id === RESEARCH_ID && !!a.ptyId);
}

export async function startResearch(config: HarnessConfig): Promise<{ ok: true } | { ok: false; error?: string }> {
  if (researchOnFloor()) return { ok: true };
  const name = researchNameNow();
  const prep = await window.cth.researchPrepare().catch(() => ({ ok: false as const }));
  if (!prep.ok) return { ok: false };
  const command = buildSpawnCommand(config, config.defaultModel, 'claude');
  const [exe, ...args] = tokenizeCommand(command.trim());
  const res = await window.cth.spawnPty({
    id: RESEARCH_PTY_ID,
    cwd: prep.cwd,
    command: exe,
    provider: 'claude',
    args,
    cols: 100,
    rows: 30,
    hive: { id: RESEARCH_ID, name, provider: 'claude', cwd: prep.cwd, role: RESEARCH_DESCRIPTION }
  }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e), cwd: undefined, seedPrompt: undefined }));
  if (!res.ok) {
    // Nothing started, so the owner's choice goes back to off.
    await window.cth.researchOff().catch(() => undefined);
    return { ok: false, error: res.error };
  }
  // Turned on for real: the office welcomes Pete in its next quiet moment
  // (owner, 2026-10-13, D7). Not on the early return above, where he is
  // already on the floor, and never on a restore, which does not come here.
  forgetWelcome(browserStorage(), ROSTER_BOOT_HOME);
  const store = useStore.getState();
  store.removeArchivedAgent(RESEARCH_ID);
  const cwd = res.cwd || prep.cwd;
  store.addAgent({
    id: RESEARCH_ID,
    // The name the app gave it (its settings), over the one this floor kept.
    name: res.name || name,
    character: RESEARCH_CHARACTER,
    accent: teamAccent(store.agents.length),
    description: RESEARCH_DESCRIPTION,
    project: cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd,
    tmuxTarget: '',
    cwd,
    goal: RESEARCH_WORK_STYLE,
    status: 'idle',
    action: ACTION_CLOCKING_IN,
    progress: 0,
    currentStation: 'desk',
    ptyId: RESEARCH_PTY_ID,
    command: command.trim(),
    provider: 'claude',
    model: config.defaultModel,
    seedPrompt: res.seedPrompt,
    recentTextTs: Date.now()
  }, { select: false });
  return { ok: true };
}

export async function stopResearch(): Promise<{ ok: boolean; returned: number }> {
  const res = await window.cth.researchOff().catch(() => ({ ok: false, returned: 0 }));
  const store = useStore.getState();
  const agent = store.agents.find((a) => a.id === RESEARCH_ID);
  if (agent?.ptyId) {
    await window.cth.closeAgentByOwner(agent.id).catch(() => undefined);
    await window.cth.killPty(agent.ptyId).catch(() => undefined);
    disposeTerminal(agent.ptyId);
  }
  if (agent) store.archiveAgent(RESEARCH_ID);
  return res;
}
