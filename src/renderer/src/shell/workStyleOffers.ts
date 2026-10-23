import type { AgentDefinitionV2 } from '@shared/agentDefinition';
import { decisionId, workStyleOffers, type WorkStyleOffer } from '@shared/workStyleUpdates';
import { useStore } from '@/store/store';
import { splitAgentRole } from '@shared/agentRole';
import { applyJob, jobBase, type RevisedJob } from '@shared/jobChange';
import { seedStarterJobs } from './seedStarterJobs';

/**
 * The renderer side of job description offers (src/shared/workStyleUpdates.ts):
 * read them for the Needs you feed, and carry out the owner's choice.
 */

let cards: Promise<Map<string, AgentDefinitionV2>> | null = null;

/** Decisions made this session, kept even when writing them failed: an
 *  offer already used must not come back before the next launch, or a second
 *  Use it would leave Undo with the adopted job (ship review, 2026-10-23). */
const decidedHere: Record<string, 'use' | 'keep'> = {};
function loadCards(): Promise<Map<string, AgentDefinitionV2>> {
  if (!cards) {
    cards = window.cth.packsList()
      .then(({ packs, core }) => {
        const map = new Map<string, AgentDefinitionV2>();
        for (const p of [...packs.map((x) => x.pack), core]) {
          for (const a of p?.agents ?? []) map.set(`${p!.businessType}/${a.id}`, a);
        }
        return map;
      })
      .catch(() => { cards = null; return new Map(); });
  }
  return cards;
}

/** The offers due now, for the team on the floor. */
export async function readWorkStyleOffers(): Promise<WorkStyleOffer[]> {
  const [map, config] = await Promise.all([loadCards(), window.cth.getConfig()]);
  const c = config as { businessType?: string; businessName?: string; businessCity?: string; workStyleUpdatesDecided?: Record<string, string> };
  return workStyleOffers(useStore.getState().agents, map, c.businessType, { name: c.businessName, city: c.businessCity }, { ...c.workStyleUpdatesDecided, ...decidedHere });
}

/** The owner's decision, Keep mine or Use it (after adoptWorkStyleOffer
 *  saved the job): recorded once, so the offer never returns. */
export async function decideWorkStyleOffer(offer: WorkStyleOffer, choice: 'use' | 'keep'): Promise<void> {
  decidedHere[decisionId(offer.key, offer.agentId)] = choice;
  const config = await window.cth.getConfig() as { workStyleUpdatesDecided?: Record<string, 'use' | 'keep'> };
  await window.cth.updateConfig({ workStyleUpdatesDecided: { ...(config.workStyleUpdatesDecided ?? {}), [decisionId(offer.key, offer.agentId)]: choice } });
}

/**
 * "Use it" in the preview: the new text with the owner's changes reapplied, as
 * the preview showed it (eng D7). The role line is the new default's unless
 * the changes moved duties; the previous job is kept for Undo. Refused when
 * the member's job changed since the preview began (A3).
 */
export async function adoptWorkStyleOffer(offer: WorkStyleOffer, revised: RevisedJob, from: string): Promise<'applied' | 'moved' | 'failed'> {
  const agent = useStore.getState().agents.find((a) => a.id === offer.agentId);
  if (!agent) return 'failed';
  if (jobBase(agent) !== from) return 'moved';
  const split = splitAgentRole(offer.description);
  const patch = applyJob(agent, { ...revised, handles: revised.handles ?? split.roleDescription }, { title: split.role, now: new Date().toISOString() });
  // The registry role first: Michael routes by it. If it can't be saved,
  // nothing changes and the decision isn't recorded, so the offer stays.
  const role = await window.cth.hivePatchAgentRole(offer.agentId, patch.description).catch(() => null);
  if (!role?.ok) return 'failed';
  useStore.getState().updateAgent(offer.agentId, patch);
  await seedStarterJobs(offer.sourceCard, offer.agentId);
  // The member is saved now. A decision that fails to write is tried once
  // more and never reported as a failed Use it: that would offer the update
  // again, and a second Use it would leave Undo with the adopted job instead
  // of the owner's own (ship review, 2026-10-23).
  await decideWorkStyleOffer(offer, 'use').catch(() => decideWorkStyleOffer(offer, 'use').catch(() => undefined));
  return 'applied';
}
