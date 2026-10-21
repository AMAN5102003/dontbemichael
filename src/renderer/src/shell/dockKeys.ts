/**
 * One key per conversation item. Message ids come from the agent's own file
 * and can repeat, so a repeat gets its place in the list added; one More
 * then opens one reply, never every reply that shares the id.
 */
export function dockKeys(items: ReadonlyArray<{ kind: string; id: string }>): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const base = `${it.kind}:${it.id}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
}
