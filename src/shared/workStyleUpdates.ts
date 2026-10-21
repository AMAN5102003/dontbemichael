/**
 * When the app ships a better default job description for a pack card, every
 * office that already hired from that card is offered it on Ask me, never
 * given it silently: the owner may have edited the Work style (owner,
 * 2026-10-03, inbox zero). "Use the new one" replaces the role line and the
 * Work style and adds the card's starter jobs; "Keep mine" keeps everything.
 * Each update is offered once per team member.
 */
import type { AgentDefinitionV2 } from './agentDefinition';
import { teamMemberGoal, teamMemberName, teamMemberRole } from './teamPlan';
import { appendOnce, swapName } from './hireTemplates';

export interface WorkStyleUpdate {
  /** Stable id, recorded once the owner decides. */
  key: string;
  /** The pack card id it applies to, in every pack unless `packs` names some. */
  cardId: string;
  /** The business types whose card changed, when the others did not: a Kelly
   *  in another pack is offered nothing, since her text is the same. */
  packs?: readonly string[];
  /** Locale key for the one line saying what changed. */
  whyKey: string;
}

/** Newest first: a card is offered the first update that matches it, and the
 *  newest text already holds the older changes. */
export const WORK_STYLE_UPDATES: readonly WorkStyleUpdate[] = [
  // Replies leave as the Sending setting allows, never "always a draft" (owner, 2026-10-05).
  { key: 'pam-sending-2026-10', cardId: 'pam', whyKey: 'askMe.workStyleWhy.sendingSetting' },
  { key: 'kelly-sending-2026-10', cardId: 'kelly', packs: ['saas-consulting'], whyKey: 'askMe.workStyleWhy.sendingSetting' },
  { key: 'pam-inbox-zero-2026-10', cardId: 'pam', whyKey: 'askMe.workStyleWhy.pamInboxZero' },
  // Facts come from the teammate who has them, Michael only when they can't help (owner, 2026-10-03).
  { key: 'kelly-ask-teammates-2026-10', cardId: 'kelly', packs: ['saas-consulting'], whyKey: 'askMe.workStyleWhy.askTeammates' },
  { key: 'ryan-ask-teammates-2026-10', cardId: 'ryan', packs: ['retail-shop'], whyKey: 'askMe.workStyleWhy.askTeammates' }
];

export interface WorkStyleOffer {
  key: string;
  whyKey: string;
  agentId: string;
  /** "<businessType>/<card id>", for the starter jobs. */
  sourceCard: string;
  goal: string;
  description: string;
}

/** Where an owner's decision is kept: `${key}:${agentId}`. */
export const decisionId = (key: string, agentId: string): string => `${key}:${agentId}`;

/**
 * The offers due now. `cards` maps "<businessType>/<card id>" to the card. A
 * team member matches by the card it was hired from, else (a member started
 * at setup) by its id in this office's own pack. Nothing is offered when its
 * text is already the new text, or the owner already decided.
 */
export function workStyleOffers(
  agents: Array<{ id: string; name?: string; goal?: string; description?: string; sourceCard?: string; isGod?: boolean; isAssistant?: boolean }>,
  cards: Map<string, AgentDefinitionV2>,
  businessType: string | undefined,
  business: { name?: string; city?: string },
  decided: Record<string, unknown> | undefined
): WorkStyleOffer[] {
  const out: WorkStyleOffer[] = [];
  for (const a of agents) {
    if (a.isGod || a.isAssistant) continue;
    const sourceCard = a.sourceCard ?? (businessType ? `${businessType}/${a.id}` : undefined);
    if (!sourceCard) continue;
    const [pack, cardId] = sourceCard.split('/');
    const update = WORK_STYLE_UPDATES.find((u) => u.cardId === cardId && (!u.packs || u.packs.includes(pack)));
    const def = cards.get(sourceCard);
    if (!update || !def || decided?.[decisionId(update.key, a.id)]) continue;
    // Someone hired from the card under another name gets the text with their
    // own name in it, as hiring does (2026-10-03: Erin, hired from Pam's
    // card, was given "Pam runs the business inbox").
    const cardName = teamMemberName(def);
    const name = a.name?.trim() || cardName;
    const goal = swapName(teamMemberGoal(def, business), cardName, name);
    // The lines a hire binding wrote ("Only <scope>." on the bound member,
    // "Not for <scope>; that goes to <Name>." on teammates) stay: Michael routes
    // by them, and the new default text knows nothing about them. Lazy up to
    // the full stop that ends the line, as bindingRe in hireTemplates is, so a
    // scope with a period or a semicolon in it stays whole: "the
    // owner@sunrise.com mailbox", "orders over $1.5k", "refunds; returns".
    const bindings = (a.description ?? '').match(/Only (?:(?!Only |Not for ).)+?\.(?![\p{L}\p{N}])|Not for (?:(?!Not for ).)+?; that goes to [^.]+?\.(?![\p{L}\p{N}])/gu) ?? [];
    const description = bindings.reduce((d, line) => appendOnce(d, line), swapName(teamMemberRole(def), cardName, name));
    if ((a.goal ?? '').trim() === goal.trim()) continue;
    out.push({ key: update.key, whyKey: update.whyKey, agentId: a.id, sourceCard, goal, description });
  }
  return out;
}
