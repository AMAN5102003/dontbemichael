/**
 * Only Michael assigns work (owner, 2026-09-27: "yes never break this promise.
 * only michael should be the assigner. agent should feel free to check other
 * agents without michael for extra info to do their job. if they still cant
 * then they should tell michael to hand off").
 *
 * The router enforces it, so an agent that ignores its instructions still can't
 * hand a teammate a job: a `request` or `propose` from one team member to
 * another (or to everyone) is delivered to Michael instead, who decides who
 * does it. A `query` and its `inform` answer go straight through, because
 * asking for a fact does not move a job. `done` and `inform` are terminal and
 * pass as well. Nothing here touches messages from Michael, the owner, the
 * scheduler or the app.
 *
 * No electron or node imports: hive.ts calls it, tests load it directly.
 */

export const ASSIGNING_ACTS: ReadonlySet<string> = new Set(['request', 'propose']);

interface RosterEntry { name?: string; isGod?: boolean; isAssistant?: boolean }

/** True when `from` is handing `to` a job and only Michael may do that. */
export function isPeerAssignment(
  msg: { from: string; to: string; act: string },
  agents: Record<string, RosterEntry | undefined>,
  godId: string,
  resolvedTo: string
): boolean {
  if (!ASSIGNING_ACTS.has(msg.act)) return false;
  const sender = agents[msg.from];
  if (!sender || sender.isGod || msg.from === godId) return false;
  if (msg.to === 'broadcast') return true;
  if (resolvedTo === godId || resolvedTo === msg.from) return false;
  const target = agents[resolvedTo];
  return !!target && !target.isGod;
}

/** The message as Michael receives it: who asked whom, and his choice. */
export function rerouteToMichael<M extends { from: string; to: string; subject: string; body: string }>(
  msg: M,
  agents: Record<string, RosterEntry | undefined>,
  godId: string
): M {
  const name = (id: string) => agents[id]?.name?.trim() || id;
  const asker = name(msg.from);
  const target = msg.to === 'broadcast' ? 'the whole team' : name(msg.to);
  return {
    ...msg,
    to: godId,
    subject: `[handoff: ${asker} asked ${target}] ${msg.subject}`.slice(0, 200),
    body: `${asker} asked ${target} to do this. Only you assign work: hand it to the right teammate, or answer ${asker} yourself.\n\n${msg.body}`
  };
}

/** The note Michael gets when the loop guard drops a runaway message, so a
 *  ping pong is never silent. */
export function hopDropNotice(
  msg: { from: string; to: string; subject: string; hops: number },
  agents: Record<string, RosterEntry | undefined>
): { subject: string; body: string } {
  const name = (id: string) => agents[id]?.name?.trim() || id;
  return {
    subject: `Dropped a message going in circles: ${msg.subject}`.slice(0, 200),
    body: `A message from ${name(msg.from)} to ${name(msg.to)} passed between agents ${msg.hops} times, so the app stopped it. Subject: "${msg.subject}". Decide who owns this and tell them once.`
  };
}
