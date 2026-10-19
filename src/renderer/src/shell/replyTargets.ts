import type { DockItem, DockQuestion, DockReply } from '@shared/ownerRequests';

/**
 * The replies the owner can answer with Reply: Michael's question back while
 * it waits on them, and his latest reply to an answered question, so an offer
 * he ends with ("Want me to check them?") can be taken up in its thread.
 * Notes and older replies get none.
 */
export function replyTargets(items: readonly DockItem[]): Set<DockReply> {
  const questions = new Map<string, DockQuestion>();
  const latest = new Map<string, DockReply>();
  for (const it of items) {
    if (it.kind === 'owner') questions.set(it.id, it);
    else if (!it.notes) latest.set(it.replyTo, it);
  }
  const out = new Set<DockReply>();
  for (const it of items) {
    if (it.kind !== 'michael' || it.notes) continue;
    const status = questions.get(it.replyTo)?.status;
    if (it.act === 'query' && status === 'waiting-for-you') out.add(it);
    else if (status === 'answered' && latest.get(it.replyTo) === it) out.add(it);
  }
  return out;
}
